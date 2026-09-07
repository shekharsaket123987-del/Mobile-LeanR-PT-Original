/**
 * Subscription lifecycle writes — activate/pause/resume. `subscriptions`
 * has no client write RLS policy at all (confirmed via pg_policies: only
 * `subscriptions_select_own`, `subscriptions_select_by_coach`,
 * `subscriptions_admin_all` exist) — so, exactly like `razorpay/index.ts`
 * already does for creating the row in the first place, these writes have
 * to happen here with the service-role key, not as a direct client-side
 * table update.
 *
 * A separate function from `razorpay` on purpose: that one is scoped to
 * payment/order concerns; this one is scoped to subscription-state
 * transitions, mirroring the web app's own `planPurchase.service.ts` vs
 * `payments.service.ts` split.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Fixed, no-DST offset — IST is always UTC+5:30. Mirrors src/lib/data/booking-wizard.ts's client-side math. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** IST calendar-day key (YYYY-MM-DD) for an ISO instant, ignoring time-of-day. */
function istDateKey(iso: string): string {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** Fire-and-forget — a failed notification insert must never surface as an error on a real state change. */
async function notifyProfile(
  admin: ReturnType<typeof createClient>,
  profileId: string | null,
  type: "booking" | "system",
  title: string,
  message: string,
  templateKey: string
): Promise<void> {
  if (!profileId) return;
  try {
    await admin.from("notifications").insert({ user_id: profileId, type, title, message, template_key: templateKey });
  } catch (err) {
    console.error("[subscription-lifecycle] notification insert failed:", err);
  }
}

/** The client's currently-assigned coach's profiles.id (auth uid), via their active recurring slot, if any. */
async function resolveAssignedCoachProfileId(admin: ReturnType<typeof createClient>, clientId: string): Promise<string | null> {
  const { data: slot } = await admin.from("recurring_slots").select("coach_id").eq("client_id", clientId).eq("status", "active").limit(1).maybeSingle();
  if (!slot?.coach_id) return null;
  const { data: coach } = await admin.from("coach_profiles").select("profile_id").eq("id", slot.coach_id).maybeSingle();
  return (coach?.profile_id as string | undefined) ?? null;
}

Deno.serve(async (req: Request) => {
  try {
    return await handleRequest(req);
  } catch (err) {
    console.error("[subscription-lifecycle] unhandled error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unexpected server error." }, 500);
  }
});

async function handleRequest(req: Request): Promise<Response> {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Not authenticated." }, 401);

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return jsonResponse({ error: "Not authenticated." }, 401);

  const { data: clientProfile, error: clientError } = await supabase
    .from("client_profiles")
    .select("id")
    .eq("profile_id", userData.user.id)
    .single();
  if (clientError || !clientProfile) return jsonResponse({ error: "Only clients can manage a subscription." }, 403);
  const clientId = clientProfile.id as string;

  const body = await req.json().catch(() => ({}));
  const action = body.action;
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const subscriptionId = body.subscriptionId as string | undefined;
  if (!subscriptionId) return jsonResponse({ error: "subscriptionId is required." }, 400);

  const { data: subscription, error: subError } = await admin
    .from("subscriptions")
    .select("id, client_id, status, package_id")
    .eq("id", subscriptionId)
    .single();
  if (subError || !subscription) return jsonResponse({ error: "Subscription not found." }, 404);
  if (subscription.client_id !== clientId) return jsonResponse({ error: "Not your subscription." }, 403);

  if (action === "activate") {
    if (subscription.status !== "awaiting_activation") {
      return jsonResponse({ error: "This plan has already been activated." }, 409);
    }
    const startDate = body.startDate as string | undefined;
    if (!startDate || Number.isNaN(new Date(startDate).getTime())) {
      return jsonResponse({ error: "A valid start date is required." }, 400);
    }
    const tomorrowKey = istDateKey(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
    if (istDateKey(startDate) < tomorrowKey) {
      return jsonResponse({ error: "Start date must be tomorrow or later." }, 400);
    }

    const { error: updateError } = await admin
      .from("subscriptions")
      .update({ status: "active", activated_at: startDate })
      .eq("id", subscriptionId);
    if (updateError) return jsonResponse({ error: updateError.message }, 500);

    // Renewal-supersede: any other still-active subscription for this client becomes inactive.
    await admin
      .from("subscriptions")
      .update({ status: "inactive" })
      .eq("client_id", clientId)
      .eq("status", "active")
      .neq("id", subscriptionId);

    await notifyProfile(admin, userData.user.id, "booking", "Plan activated", `Your plan starts on ${startDate}.`, "plan_activated_client");

    return jsonResponse({ success: true });
  }

  if (action === "pause") {
    if (subscription.status !== "active") {
      return jsonResponse({ error: "Only an active plan can be paused." }, 409);
    }
    const { error: updateError } = await admin
      .from("subscriptions")
      .update({ status: "paused", paused_at: new Date().toISOString() })
      .eq("id", subscriptionId);
    if (updateError) return jsonResponse({ error: updateError.message }, 500);

    const { data: pkg } = await admin.from("package_tiers").select("name").eq("id", subscription.package_id).maybeSingle();
    const planName = pkg?.name ?? "your plan";
    await notifyProfile(admin, userData.user.id, "system", "Plan paused", `Your ${planName} subscription has been paused.`, "subscription_paused_client");
    const coachProfileId = await resolveAssignedCoachProfileId(admin, clientId);
    await notifyProfile(admin, coachProfileId, "system", "Client plan paused", `A client's ${planName} subscription has been paused.`, "subscription_paused_coach");

    return jsonResponse({ success: true });
  }

  if (action === "resume") {
    if (subscription.status !== "paused") {
      return jsonResponse({ error: "Only a paused plan can be resumed." }, 409);
    }
    const { error: updateError } = await admin
      .from("subscriptions")
      .update({ status: "active", resumed_at: new Date().toISOString() })
      .eq("id", subscriptionId);
    if (updateError) return jsonResponse({ error: updateError.message }, 500);

    const { data: pkg } = await admin.from("package_tiers").select("name").eq("id", subscription.package_id).maybeSingle();
    const planName = pkg?.name ?? "your plan";
    await notifyProfile(admin, userData.user.id, "system", "Plan resumed", `Your ${planName} subscription has been resumed.`, "subscription_resumed_client");
    const coachProfileId = await resolveAssignedCoachProfileId(admin, clientId);
    await notifyProfile(admin, coachProfileId, "system", "Client plan resumed", `A client's ${planName} subscription has been resumed.`, "subscription_resumed_coach");

    return jsonResponse({ success: true });
  }

  return jsonResponse({ error: "Unknown action." }, 400);
}
