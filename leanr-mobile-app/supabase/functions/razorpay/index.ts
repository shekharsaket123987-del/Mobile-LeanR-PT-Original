/**
 * Razorpay order creation + payment verification — LEANR_PT_MOBILE_PRD.md
 * §8g. This is the server-side endpoint the mobile app's plans.tsx always
 * needed: the Razorpay *key secret* can never live in the mobile bundle
 * (anyone could extract it and forge "paid" signatures), so order
 * creation and signature verification have to happen here instead.
 *
 * Needs two secrets set on this project before it will actually work —
 * `supabase secrets set RAZORPAY_KEY_ID=... RAZORPAY_KEY_SECRET=...`
 * (from the Razorpay dashboard, Settings → API Keys). Until then this
 * function returns a clear 503, not a silent failure.
 *
 * `payments`/`subscriptions` have no client write policy at all (RLS
 * confirmed live) — this uses the service-role key for those writes,
 * exactly like the web app's Server Actions do today.
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const RAZORPAY_KEY_ID = Deno.env.get("RAZORPAY_KEY_ID");
const RAZORPAY_KEY_SECRET = Deno.env.get("RAZORPAY_KEY_SECRET");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** §13 rule 16's threshold — matches the same constant used client-side in admin-renewals/admin-shadow. */
const SESSIONS_LOW_THRESHOLD = 5;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  try {
    return await handleRequest(req);
  } catch (err) {
    console.error("[razorpay] unhandled error:", err);
    return jsonResponse({ error: err instanceof Error ? err.message : "Unexpected server error." }, 500);
  }
});

async function handleRequest(req: Request): Promise<Response> {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  if (!RAZORPAY_KEY_ID || !RAZORPAY_KEY_SECRET) {
    return jsonResponse(
      { error: "Razorpay isn't configured on the server yet — RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET secrets are missing." },
      503
    );
  }

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
  if (clientError || !clientProfile) return jsonResponse({ error: "Only clients can purchase plans." }, 403);
  const clientId = clientProfile.id as string;

  const body = await req.json().catch(() => ({}));
  const action = body.action;
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  if (action === "create-order") {
    const packageId = body.packageId as string | undefined;
    if (!packageId) return jsonResponse({ error: "packageId is required." }, 400);

    const { data: pkg, error: pkgError } = await supabase
      .from("package_tiers")
      .select("id, name, price, sessions_count, default_pause_days, is_active")
      .eq("id", packageId)
      .single();
    if (pkgError || !pkg || !pkg.is_active) return jsonResponse({ error: "Plan not found or no longer available." }, 404);

    // §13 rule 16: one active/awaiting plan at a time, renewal exception when sessions_remaining <= threshold.
    const { data: existingSub } = await supabase
      .from("subscriptions")
      .select("id, sessions_total")
      .eq("client_id", clientId)
      .in("status", ["active", "awaiting_activation"])
      .maybeSingle();
    if (existingSub) {
      const { count: completedCount } = await admin
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("subscription_id", existingSub.id)
        .eq("status", "completed");
      const remaining = (existingSub.sessions_total as number) - (completedCount ?? 0);
      if (remaining > SESSIONS_LOW_THRESHOLD) {
        return jsonResponse(
          { error: "You already have an active plan with sessions remaining. Renewal opens up once you're running low." },
          409
        );
      }
    }

    const amountPaise = Math.round(Number(pkg.price) * 100);
    const razorpayRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: amountPaise, currency: "INR", notes: { client_id: clientId, package_id: pkg.id } }),
    });
    if (!razorpayRes.ok) {
      // Not 502/503/504 here: Supabase's own edge gateway intercepts and strips the body
      // of those "gateway" status codes, so the client never sees this error message.
      return jsonResponse({ error: `Razorpay order creation failed: ${await razorpayRes.text()}` }, 400);
    }
    const order = await razorpayRes.json();

    const { data: payment, error: paymentError } = await admin
      .from("payments")
      .insert({
        client_id: clientId,
        purpose: "package_purchase",
        package_id: pkg.id,
        amount: pkg.price,
        currency: "INR",
        razorpay_order_id: order.id,
        status: "created",
      })
      .select("id")
      .single();
    if (paymentError) return jsonResponse({ error: paymentError.message }, 500);

    return jsonResponse({
      orderId: order.id,
      amountPaise,
      currency: "INR",
      keyId: RAZORPAY_KEY_ID,
      packageName: pkg.name,
      paymentId: payment.id,
    });
  }

  if (action === "verify-payment") {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return jsonResponse({ error: "Missing Razorpay payment fields." }, 400);
    }

    const { data: payment, error: paymentError } = await admin
      .from("payments")
      .select("id, client_id, package_id, status, subscription_id")
      .eq("razorpay_order_id", razorpay_order_id)
      .single();
    if (paymentError || !payment) return jsonResponse({ error: "Payment record not found." }, 404);
    if (payment.client_id !== clientId) return jsonResponse({ error: "Not your payment." }, 403);
    // Idempotent: a duplicate callback (client retry, or a future webhook safety net) for an
    // already-fulfilled payment is a safe no-op that returns the same success shape, not an error.
    if (payment.status === "paid") return jsonResponse({ success: true, subscriptionId: payment.subscription_id });
    if (payment.status !== "created") {
      return jsonResponse({ error: `This payment can no longer be verified (reference: ${razorpay_order_id}). Contact support if you were charged.` }, 409);
    }

    const expectedSignature = await hmacSha256Hex(RAZORPAY_KEY_SECRET, `${razorpay_order_id}|${razorpay_payment_id}`);
    if (expectedSignature !== razorpay_signature) {
      await admin.from("payments").update({ status: "failed" }).eq("id", payment.id);
      return jsonResponse({ error: "Payment signature verification failed." }, 400);
    }

    await admin
      .from("payments")
      .update({ status: "paid", razorpay_payment_id, razorpay_signature, paid_at: new Date().toISOString() })
      .eq("id", payment.id);

    const { data: pkg, error: pkgError } = await admin
      .from("package_tiers")
      .select("sessions_count, default_pause_days")
      .eq("id", payment.package_id)
      .single();
    if (pkgError || !pkg) {
      await admin.from("payments").update({ status: "paid_unfulfilled" }).eq("id", payment.id);
      return jsonResponse({ error: `Payment captured but plan lookup failed. Contact support with reference: ${razorpay_order_id}.` }, 500);
    }

    // Second-layer defense against the same TOCTOU race create-order's own check guards against:
    // two parallel purchase flows can both pass that earlier check before either has committed a
    // subscription row. Re-checking here, right before insert, matches web's documented second
    // line of defense inside its own fulfillment step.
    const { data: raceSub } = await admin
      .from("subscriptions")
      .select("id")
      .eq("client_id", clientId)
      .in("status", ["active", "awaiting_activation"])
      .maybeSingle();
    if (raceSub) {
      await admin.from("payments").update({ status: "paid_unfulfilled" }).eq("id", payment.id);
      return jsonResponse(
        { error: `You already have a plan. This payment was captured but not applied — contact support with reference: ${razorpay_order_id}.` },
        409
      );
    }

    const { data: subscription, error: subError } = await admin
      .from("subscriptions")
      .insert({
        client_id: clientId,
        package_id: payment.package_id,
        sessions_total: pkg.sessions_count,
        status: "awaiting_activation",
        started_at: new Date().toISOString(),
        pause_days_allowed: pkg.default_pause_days,
      })
      .select("id")
      .single();
    if (subError) {
      await admin.from("payments").update({ status: "paid_unfulfilled" }).eq("id", payment.id);
      return jsonResponse(
        { error: `Payment captured but activating your plan failed. Contact support with reference: ${razorpay_order_id}.` },
        500
      );
    }

    await admin.from("payments").update({ subscription_id: subscription.id }).eq("id", payment.id);

    return jsonResponse({ success: true, subscriptionId: subscription.id });
  }

  return jsonResponse({ error: "Unknown action." }, 400);
}
