/**
 * Admin Client Management — New PRD.md §4.C "Screen: Clients (list)" and
 * "Screen: Client Detail (richest screen)". Platform-wide (no coach
 * scoping) generalization of `coach-clients.ts`'s roster query, since
 * admin RLS (`*_admin_all`, confirmed live) grants full read/write on
 * every table involved — no service-role key needed for anything here.
 *
 * Manual Controls card (§4.C): Adjust Sessions, Grant Pause-Days,
 * Transfer Coach, Assign Shadow Coach (reused from admin-shadow.ts),
 * Pause/Resume Subscription, Log Measurement, Log Escalation, Log Refund
 * Request. "Log Refund Request" writes to `client_timeline_events`
 * only — `audit_logs` has no admin INSERT policy (trigger-only,
 * confirmed live), matching the web app's own "audit-trail-only, moves
 * no money" behavior for this action.
 */
import { supabase } from '@/lib/supabase/client';
import { deriveClientStatus, type DerivedClientStatus } from './coach-clients';
import { notifyProfile, resolveProfileIdForCoach } from './notify';
import type { Booking } from './types';

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function summarizeSlots(rows: { day_of_week: number; start_time: string }[]): string | null {
  if (rows.length === 0) return null;
  const days = rows.map((r) => WEEKDAY_SHORT[r.day_of_week]).join('/');
  const hour = Number(rows[0].start_time.slice(0, 2));
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${days} · ${h12}:00 ${hour >= 12 ? 'PM' : 'AM'}`;
}

export type AdminClientListRow = {
  id: string;
  full_name: string;
  photo_url: string | null;
  client_code: string;
  derivedStatus: DerivedClientStatus;
  planName: string | null;
  coachName: string | null;
  startDate: string | null;
  slotSummary: string | null;
  sessionsUsed: number | null;
  sessionsTotal: number | null;
};

export async function listAdminClients(): Promise<AdminClientListRow[]> {
  const [profilesRes, subsRes, slotsRes, demoRes] = await Promise.all([
    supabase.from('client_profiles').select('id, client_code, profiles(full_name, photo_url)').order('created_at', { ascending: false }),
    supabase.from('subscriptions').select('id, client_id, package_id, status, started_at, activated_at, sessions_total'),
    supabase.from('recurring_slots').select('client_id, coach_id, day_of_week, start_time').eq('status', 'active'),
    supabase.from('bookings').select('client_id').eq('session_type', 'assessment'),
  ]);
  if (profilesRes.error) throw profilesRes.error;
  if (subsRes.error) throw subsRes.error;
  if (slotsRes.error) throw slotsRes.error;
  if (demoRes.error) throw demoRes.error;

  const coachIds = [...new Set((slotsRes.data ?? []).map((s) => s.coach_id))];
  const coachesRes = coachIds.length > 0 ? await supabase.from('coach_profiles').select('id, profiles(full_name)').in('id', coachIds) : { data: [], error: null };
  if (coachesRes.error) throw coachesRes.error;
  const coachNameById = new Map(
    (coachesRes.data ?? []).map((c) => {
      const p = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles;
      return [c.id as string, p?.full_name ?? 'Coach'];
    })
  );

  const packageIds = [...new Set((subsRes.data ?? []).map((s) => s.package_id).filter(Boolean))];
  const packagesRes = packageIds.length > 0 ? await supabase.from('package_tiers').select('id, name').in('id', packageIds) : { data: [], error: null };
  if (packagesRes.error) throw packagesRes.error;
  const packageNameById = new Map((packagesRes.data ?? []).map((p) => [p.id, p.name as string]));

  const subIds = (subsRes.data ?? []).map((s) => s.id);
  const completedRes = subIds.length > 0 ? await supabase.from('bookings').select('subscription_id').eq('status', 'completed').in('subscription_id', subIds) : { data: [], error: null };
  if (completedRes.error) throw completedRes.error;
  const completedCountBySub = new Map<string, number>();
  for (const row of completedRes.data ?? []) {
    if (!row.subscription_id) continue;
    completedCountBySub.set(row.subscription_id, (completedCountBySub.get(row.subscription_id) ?? 0) + 1);
  }

  const demoClientIds = new Set((demoRes.data ?? []).map((b) => b.client_id));
  const subsByClient = new Map<string, typeof subsRes.data>();
  for (const s of subsRes.data ?? []) {
    const list = subsByClient.get(s.client_id) ?? [];
    list.push(s);
    subsByClient.set(s.client_id, list as never);
  }
  const slotsByClient = new Map<string, { day_of_week: number; start_time: string; coach_id: string }[]>();
  for (const s of slotsRes.data ?? []) {
    const list = slotsByClient.get(s.client_id) ?? [];
    list.push(s);
    slotsByClient.set(s.client_id, list);
  }

  return (profilesRes.data ?? []).map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    const clientSubs = subsByClient.get(row.id) ?? [];
    const derivedStatus = deriveClientStatus(clientSubs.map((s) => s!.status), demoClientIds.has(row.id));
    const currentSub =
      clientSubs.find((s) => s!.status === 'active' || s!.status === 'awaiting_activation' || s!.status === 'paused') ??
      [...clientSubs].sort((a, b) => new Date(b!.started_at).getTime() - new Date(a!.started_at).getTime())[0];
    const slots = slotsByClient.get(row.id) ?? [];

    return {
      id: row.id,
      full_name: profile?.full_name ?? 'Client',
      photo_url: profile?.photo_url ?? null,
      client_code: row.client_code,
      derivedStatus,
      planName: currentSub ? (packageNameById.get(currentSub.package_id) ?? null) : null,
      coachName: slots[0] ? (coachNameById.get(slots[0].coach_id) ?? null) : null,
      startDate: currentSub ? (currentSub.activated_at ?? currentSub.started_at) : null,
      slotSummary: summarizeSlots(slots),
      sessionsUsed: currentSub ? (completedCountBySub.get(currentSub.id) ?? 0) : null,
      sessionsTotal: currentSub?.sessions_total ?? null,
    };
  });
}

export type AdminClientDetail = AdminClientListRow & {
  phone: string | null;
  coachId: string | null;
  subscriptionId: string | null;
  subscriptionStatus: string | null;
  pauseDaysAllowed: number | null;
  sessionHistory: Booking[];
};

export async function getAdminClientDetail(clientId: string): Promise<AdminClientDetail | null> {
  const { data: profileRow, error } = await supabase
    .from('client_profiles')
    .select('id, client_code, profiles(full_name, photo_url, phone)')
    .eq('id', clientId)
    .maybeSingle();
  if (error) throw error;
  if (!profileRow) return null;
  const profile = Array.isArray(profileRow.profiles) ? profileRow.profiles[0] : profileRow.profiles;

  const [subsRes, slotsRes, demoRes, historyRes] = await Promise.all([
    supabase.from('subscriptions').select('id, package_id, status, started_at, activated_at, sessions_total, pause_days_allowed').eq('client_id', clientId),
    supabase.from('recurring_slots').select('coach_id, day_of_week, start_time').eq('client_id', clientId).eq('status', 'active'),
    supabase.from('bookings').select('id').eq('client_id', clientId).eq('session_type', 'assessment').limit(1),
    supabase.from('bookings').select('*').eq('client_id', clientId).order('scheduled_start', { ascending: false }).limit(30),
  ]);
  if (subsRes.error) throw subsRes.error;
  if (slotsRes.error) throw slotsRes.error;
  if (demoRes.error) throw demoRes.error;
  if (historyRes.error) throw historyRes.error;

  const derivedStatus = deriveClientStatus((subsRes.data ?? []).map((s) => s.status), (demoRes.data ?? []).length > 0);
  const currentSub =
    (subsRes.data ?? []).find((s) => s.status === 'active' || s.status === 'awaiting_activation' || s.status === 'paused') ??
    [...(subsRes.data ?? [])].sort((a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime())[0];

  let planName: string | null = null;
  if (currentSub) {
    const { data: pkg } = await supabase.from('package_tiers').select('name').eq('id', currentSub.package_id).maybeSingle();
    planName = pkg?.name ?? null;
  }
  const completedCount = currentSub
    ? (await supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('subscription_id', currentSub.id).eq('status', 'completed')).count ?? 0
    : null;

  const coachId = slotsRes.data?.[0]?.coach_id ?? null;
  let coachName: string | null = null;
  if (coachId) {
    const { data: coachRow } = await supabase.from('coach_profiles').select('profiles(full_name)').eq('id', coachId).maybeSingle();
    const coachProfile = coachRow ? (Array.isArray(coachRow.profiles) ? coachRow.profiles[0] : coachRow.profiles) : null;
    coachName = coachProfile?.full_name ?? null;
  }

  return {
    id: clientId,
    full_name: profile?.full_name ?? 'Client',
    photo_url: profile?.photo_url ?? null,
    phone: profile?.phone ?? null,
    client_code: profileRow.client_code,
    derivedStatus,
    planName,
    coachName,
    coachId,
    subscriptionId: currentSub?.id ?? null,
    subscriptionStatus: currentSub?.status ?? null,
    pauseDaysAllowed: currentSub?.pause_days_allowed ?? null,
    startDate: currentSub ? (currentSub.activated_at ?? currentSub.started_at) : null,
    slotSummary: summarizeSlots(slotsRes.data ?? []),
    sessionsUsed: completedCount,
    sessionsTotal: currentSub?.sessions_total ?? null,
    sessionHistory: (historyRes.data ?? []) as Booking[],
  };
}

export async function adjustClientSessions(subscriptionId: string, newTotal: number): Promise<void> {
  const { error } = await supabase.from('subscriptions').update({ sessions_total: newTotal }).eq('id', subscriptionId);
  if (error) throw error;
}

export async function grantPauseDays(subscriptionId: string, newPauseDaysAllowed: number): Promise<void> {
  const { error } = await supabase.from('subscriptions').update({ pause_days_allowed: newPauseDaysAllowed }).eq('id', subscriptionId);
  if (error) throw error;
}

/** Resolves the client + assigned coach + plan name for a subscription, for the pause/resume notifications below. */
async function getSubscriptionNotifyContext(subscriptionId: string): Promise<{ clientProfileId: string | null; coachProfileId: string | null; planName: string }> {
  const { data: sub, error: subError } = await supabase.from('subscriptions').select('client_id, package_id').eq('id', subscriptionId).maybeSingle();
  if (subError) throw subError;
  if (!sub) return { clientProfileId: null, coachProfileId: null, planName: 'your plan' };

  const [clientRow, pkgRow, slotRow] = await Promise.all([
    supabase.from('client_profiles').select('profile_id').eq('id', sub.client_id).maybeSingle(),
    sub.package_id ? supabase.from('package_tiers').select('name').eq('id', sub.package_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    supabase.from('recurring_slots').select('coach_id').eq('client_id', sub.client_id).eq('status', 'active').limit(1).maybeSingle(),
  ]);
  if (clientRow.error) throw clientRow.error;

  const coachProfileId = slotRow.data?.coach_id ? await resolveProfileIdForCoach(slotRow.data.coach_id) : null;
  return {
    clientProfileId: clientRow.data?.profile_id ?? null,
    coachProfileId,
    planName: pkgRow.data?.name ?? 'your plan',
  };
}

export async function pauseClientSubscription(subscriptionId: string): Promise<void> {
  const { error } = await supabase.from('subscriptions').update({ status: 'paused', paused_at: new Date().toISOString() }).eq('id', subscriptionId);
  if (error) throw error;

  const { clientProfileId, coachProfileId, planName } = await getSubscriptionNotifyContext(subscriptionId);
  await notifyProfile(clientProfileId, 'system', 'Subscription paused', `Your ${planName} subscription has been paused.`, 'subscription_paused_client');
  await notifyProfile(coachProfileId, 'system', 'Client subscription paused', `A client's ${planName} subscription has been paused.`, 'subscription_paused_coach');
}

export async function resumeClientSubscription(subscriptionId: string): Promise<void> {
  const { error } = await supabase.from('subscriptions').update({ status: 'active', resumed_at: new Date().toISOString() }).eq('id', subscriptionId);
  if (error) throw error;

  const { clientProfileId, coachProfileId, planName } = await getSubscriptionNotifyContext(subscriptionId);
  await notifyProfile(clientProfileId, 'system', 'Subscription resumed', `Your ${planName} subscription has been resumed.`, 'subscription_resumed_client');
  await notifyProfile(coachProfileId, 'system', 'Client subscription resumed', `A client's ${planName} subscription has been resumed.`, 'subscription_resumed_coach');
}

/**
 * Transfer a client to a new coach — repoints the active recurring
 * pattern and every not-yet-happened `upcoming` booking, mirroring what
 * `assign_shadow_coach` already does for shadow coverage (§ admin-shadow.ts).
 * `force` bypasses the availability warning, same "Transfer Anyway"
 * two-step pattern the web app uses (New PRD.md §4.C).
 */
export async function transferClientCoach(clientId: string, newCoachId: string, force = false): Promise<void> {
  const { data: slots, error: slotsError } = await supabase
    .from('recurring_slots')
    .select('id, coach_id, day_of_week, start_time, duration_minutes')
    .eq('client_id', clientId)
    .eq('status', 'active');
  if (slotsError) throw slotsError;
  const oldCoachId: string | null = slots?.[0]?.coach_id ?? null;

  if (!force) {
    const { data: availability, error: availabilityError } = await supabase
      .from('coach_availability')
      .select('day_of_week')
      .eq('coach_id', newCoachId)
      .eq('is_active', true);
    if (availabilityError) throw availabilityError;
    const availableDays = new Set((availability ?? []).map((a) => a.day_of_week));
    const uncovered = (slots ?? []).some((s) => !availableDays.has(s.day_of_week));
    if (uncovered) {
      throw new Error('This coach has not set availability for one or more of the client’s scheduled days. Use "Transfer Anyway" to proceed regardless.');
    }
  }

  const { error: slotUpdateError } = await supabase.from('recurring_slots').update({ coach_id: newCoachId }).eq('client_id', clientId).eq('status', 'active');
  if (slotUpdateError) throw slotUpdateError;

  const { error: bookingUpdateError } = await supabase
    .from('bookings')
    .update({ coach_id: newCoachId })
    .eq('client_id', clientId)
    .eq('status', 'upcoming');
  if (bookingUpdateError) throw bookingUpdateError;

  // Notifications — Gap Verification Report Area 6: same 3 template keys as an approved coach-change-with-coach.
  const [clientRow, newCoachRow] = await Promise.all([
    supabase.from('client_profiles').select('profile_id, profiles(full_name)').eq('id', clientId).maybeSingle(),
    supabase.from('coach_profiles').select('profile_id, profiles(full_name)').eq('id', newCoachId).maybeSingle(),
  ]);
  if (clientRow.error) throw clientRow.error;
  if (newCoachRow.error) throw newCoachRow.error;

  const clientProfile = clientRow.data ? (Array.isArray(clientRow.data.profiles) ? clientRow.data.profiles[0] : clientRow.data.profiles) : null;
  const clientName = clientProfile?.full_name ?? 'Client';
  const newCoachProfile = newCoachRow.data ? (Array.isArray(newCoachRow.data.profiles) ? newCoachRow.data.profiles[0] : newCoachRow.data.profiles) : null;
  const newCoachName = newCoachProfile?.full_name ?? 'your new coach';

  await notifyProfile(clientRow.data?.profile_id ?? null, 'booking', 'Coach changed', `You've been moved to ${newCoachName}.`, 'coach_changed_client');
  if (oldCoachId) {
    const oldCoachProfileId = await resolveProfileIdForCoach(oldCoachId);
    await notifyProfile(oldCoachProfileId, 'booking', 'Client transferred', `${clientName} has been transferred to another coach.`, 'client_transferred');
  }
  await notifyProfile(newCoachRow.data?.profile_id ?? null, 'booking', 'New client assigned', `${clientName} has been assigned to you.`, 'new_client_assigned');
}

export type MeasurementInput = {
  weight?: number | null;
  body_fat_pct?: number | null;
  muscle_pct?: number | null;
  waist?: number | null;
  chest?: number | null;
  hip?: number | null;
  arms?: number | null;
  thigh?: number | null;
  notes?: string | null;
};

/** Admin has no weekly cap, unlike the client's own self-service log (New PRD.md §4.C). */
export async function logMeasurement(clientId: string, input: MeasurementInput): Promise<void> {
  const { error } = await supabase.from('progress_logs').insert({ client_id: clientId, logged_at: new Date().toISOString(), ...input });
  if (error) throw error;
}

export async function logEscalation(clientId: string, coachId: string | null, reason: string, description: string | null): Promise<void> {
  const { error } = await supabase.from('escalations').insert({ client_id: clientId, coach_id: coachId, reason, description, status: 'open', raised_by: null });
  if (error) throw error;

  if (coachId) {
    const [coachProfileId, clientRow] = await Promise.all([
      resolveProfileIdForCoach(coachId),
      supabase.from('client_profiles').select('profiles(full_name)').eq('id', clientId).maybeSingle(),
    ]);
    const clientProfile = clientRow.data ? (Array.isArray(clientRow.data.profiles) ? clientRow.data.profiles[0] : clientRow.data.profiles) : null;
    const clientName = clientProfile?.full_name ?? 'A client';
    await notifyProfile(coachProfileId, 'feedback', 'Concern raised', `${clientName} raised a concern: ${reason}`, 'escalation_raised_to_coach');
  }
}

/**
 * Log Refund Request — audit-trail-only, moves no money (New PRD.md
 * §4.C explicit disclaimer). Writes to `client_timeline_events` since
 * `audit_logs` has no admin INSERT policy (trigger-only tables, confirmed
 * live) — there is no other admin-writable audit surface for this.
 */
export async function logRefundRequest(clientId: string, amount: number, reason: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from('client_timeline_events').insert({
    client_id: clientId,
    event_type: 'refund_requested',
    title: 'Refund requested',
    description: reason,
    metadata: { amount },
    actor_id: user?.id ?? null,
  });
  if (error) throw error;
}

export type ClientTimelineEvent = { id: string; event_type: string; title: string; description: string | null; created_at: string };

export async function getClientTimeline(clientId: string): Promise<ClientTimelineEvent[]> {
  const { data, error } = await supabase
    .from('client_timeline_events')
    .select('id, event_type, title, description, created_at')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as ClientTimelineEvent[];
}

export type AdminChatMessage = { id: string; sender_role: string; body: string | null; attachment_url: string | null; created_at: string };

/** View-only — admin can see, never send (New PRD.md §4.C). */
export async function getClientChatsForAdmin(clientId: string): Promise<AdminChatMessage[]> {
  const { data: conversation, error: conversationError } = await supabase
    .from('conversations')
    .select('id')
    .eq('client_id', clientId)
    .order('opened_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (conversationError) throw conversationError;
  if (!conversation) return [];

  const { data, error } = await supabase
    .from('messages')
    .select('id, sender_role, body, attachment_url, created_at')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as AdminChatMessage[];
}

export type ClientEscalationRow = { id: string; reason: string; status: string; created_at: string };

export async function listEscalationsForClient(clientId: string): Promise<ClientEscalationRow[]> {
  const { data, error } = await supabase.from('escalations').select('id, reason, status, created_at').eq('client_id', clientId).order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ClientEscalationRow[];
}

export type CoachOption = { id: string; full_name: string };

export async function listAdminCoachOptions(): Promise<CoachOption[]> {
  const { data, error } = await supabase.from('coach_profiles').select('id, status, profiles(full_name)').eq('status', 'active');
  if (error) throw error;
  return (data ?? []).map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return { id: row.id as string, full_name: profile?.full_name ?? 'Coach' };
  });
}
