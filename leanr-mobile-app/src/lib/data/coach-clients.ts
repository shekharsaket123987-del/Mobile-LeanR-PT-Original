/**
 * Coach's Clients list + Client Detail — New PRD.md §4.B "Screen: Clients
 * (list)" (search + 7 status pills, Table: Client/Plan/Start Date/Slot/
 * Progress/Status(+Overdue badge if measurements stale)) and "Screen:
 * Client Detail" (100% read-only). Confirmed against real schema: the
 * client_id -> coach relationship lives on `recurring_slots`, not a
 * column on `client_profiles` (same lookup direction as
 * `coach-portal.ts`'s `getCoachClients`, just extended here with the
 * PRD's derived 6-bucket client status (§6) rather than the raw 3-value
 * `client_profiles.status` enum — the web app "always uses the derived
 * status", not the raw column, per New PRD.md line 800.
 */
import { getMyCoachProfileId } from '@/lib/data/identity';
import { logTimelineEvent } from '@/lib/data/timeline';
import { supabase } from '@/lib/supabase/client';
import type { Booking } from './types';

export type DerivedClientStatus = 'paused' | 'active' | 'created' | 'expired' | 'demo' | 'not_paid';

/** New PRD.md §6 "Client status (derived, never stored)" — exact priority order. */
export function deriveClientStatus(subscriptionStatuses: string[], hasDemoBooking: boolean): DerivedClientStatus {
  if (subscriptionStatuses.includes('paused')) return 'paused';
  if (subscriptionStatuses.includes('active')) return 'active';
  if (subscriptionStatuses.includes('awaiting_activation')) return 'created';
  if (subscriptionStatuses.length > 0) return 'expired';
  if (hasDemoBooking) return 'demo';
  return 'not_paid';
}

const STATUS_LABELS: Record<DerivedClientStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  created: 'Created',
  expired: 'Expired',
  demo: 'Demo',
  not_paid: 'Not Paid',
};

/** Single-client version of the roster list's batch status query, for before/after comparison. */
export async function getClientStatusSnapshot(clientId: string): Promise<DerivedClientStatus> {
  const [subsRes, demoRes] = await Promise.all([
    supabase.from('subscriptions').select('status').eq('client_id', clientId),
    supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('client_id', clientId).eq('session_type', 'assessment'),
  ]);
  if (subsRes.error) throw subsRes.error;
  if (demoRes.error) throw demoRes.error;
  return deriveClientStatus((subsRes.data ?? []).map((s) => s.status as string), (demoRes.count ?? 0) > 0);
}

/**
 * mobile-app-reference/audit/timeline.md §3/§7.4: logs client_status_changed only when the
 * derived status actually differs across a mutation -- call with a snapshot taken BEFORE the
 * mutation; this re-derives the AFTER status itself. Best-effort, wired at the highest-value
 * transition points (subscription activation, first assessment booking) rather than every
 * possible status-affecting action -- there's no existing generic "status changed" hook point
 * to generalize from in this app.
 */
export async function logClientStatusChangeIfDifferent(clientId: string, before: DerivedClientStatus): Promise<void> {
  const after = await getClientStatusSnapshot(clientId);
  if (after === before) return;
  await logTimelineEvent(clientId, 'client_status_changed', `Status changed to ${STATUS_LABELS[after]}`, { metadata: { from: before, to: after } });
}

export type CoachClientListRow = {
  id: string;
  full_name?: string;
  photo_url?: string | null;
  client_code?: string;
  derivedStatus: DerivedClientStatus;
  planName: string | null;
  startDate: string | null;
  slotSummary: string | null;
  sessionsUsed: number | null;
  sessionsTotal: number | null;
  isAssignedToMe: true; // this list is always the coach's own roster
};

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function summarizeSlots(rows: { day_of_week: number; start_time: string }[]): string | null {
  if (rows.length === 0) return null;
  const days = rows.map((r) => WEEKDAY_SHORT[r.day_of_week]).join('/');
  const hour = Number(rows[0].start_time.slice(0, 2));
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${days} · ${h12}:00 ${hour >= 12 ? 'PM' : 'AM'}`;
}

export async function getCoachClientsList(): Promise<CoachClientListRow[]> {
  const coachId = await getMyCoachProfileId();
  if (!coachId) return [];

  const [{ data: slots, error: slotsError }, { data: demoBookings, error: demoBookingsError }] = await Promise.all([
    supabase.from('recurring_slots').select('client_id, day_of_week, start_time').eq('coach_id', coachId).eq('status', 'active'),
    // A demo/assessment booking never creates a recurring_slots row (that's
    // reserved for an ongoing weekly PT schedule), so a client who has only
    // booked a demo with this coach and hasn't purchased a plan yet would
    // otherwise never enter the roster at all — silently unreachable via
    // every status filter including "Demo", despite deriveClientStatus
    // explicitly supporting that bucket. Union both sources of "this coach's
    // client" up front so demo-only clients show up like any other.
    supabase.from('bookings').select('client_id').eq('coach_id', coachId).eq('session_type', 'assessment'),
  ]);
  if (slotsError) throw slotsError;
  if (demoBookingsError) throw demoBookingsError;

  const clientIds = [...new Set([...(slots ?? []).map((s) => s.client_id), ...(demoBookings ?? []).map((b) => b.client_id)])];
  if (clientIds.length === 0) return [];

  const slotsByClient = new Map<string, { day_of_week: number; start_time: string }[]>();
  for (const s of slots ?? []) {
    const list = slotsByClient.get(s.client_id) ?? [];
    list.push(s);
    slotsByClient.set(s.client_id, list);
  }

  const [profilesRes, subsRes, demoRes] = await Promise.all([
    supabase.from('client_profiles').select('id, client_code, profiles(full_name, photo_url)').in('id', clientIds),
    supabase
      .from('subscriptions')
      .select('id, client_id, package_id, status, started_at, activated_at, sessions_total')
      .in('client_id', clientIds),
    supabase.from('bookings').select('client_id').eq('session_type', 'assessment').in('client_id', clientIds),
  ]);
  if (profilesRes.error) throw profilesRes.error;
  if (subsRes.error) throw subsRes.error;
  if (demoRes.error) throw demoRes.error;

  const packageIds = [...new Set((subsRes.data ?? []).map((s) => s.package_id).filter(Boolean))];
  const packagesRes = packageIds.length > 0 ? await supabase.from('package_tiers').select('id, name').in('id', packageIds) : { data: [], error: null };
  if (packagesRes.error) throw packagesRes.error;
  const packageNameById = new Map((packagesRes.data ?? []).map((p) => [p.id, p.name as string]));

  const subIds = (subsRes.data ?? []).map((s) => s.id);
  const completedRes =
    subIds.length > 0
      ? await supabase.from('bookings').select('subscription_id').eq('status', 'completed').in('subscription_id', subIds)
      : { data: [], error: null };
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

  return clientIds.map((clientId) => {
    const profileRow = (profilesRes.data ?? []).find((p) => p.id === clientId);
    const profile = profileRow ? (Array.isArray(profileRow.profiles) ? profileRow.profiles[0] : profileRow.profiles) : null;
    const clientSubs = subsByClient.get(clientId) ?? [];
    const derivedStatus = deriveClientStatus(clientSubs.map((s) => s!.status), demoClientIds.has(clientId));

    // Prefer the active/awaiting_activation sub for the displayed plan; else the most recently started one.
    const currentSub =
      clientSubs.find((s) => s!.status === 'active' || s!.status === 'awaiting_activation' || s!.status === 'paused') ??
      [...clientSubs].sort((a, b) => new Date(b!.started_at).getTime() - new Date(a!.started_at).getTime())[0];

    return {
      id: clientId,
      full_name: profile?.full_name,
      photo_url: profile?.photo_url,
      client_code: profileRow?.client_code,
      derivedStatus,
      planName: currentSub ? (packageNameById.get(currentSub.package_id) ?? null) : null,
      startDate: currentSub ? (currentSub.activated_at ?? currentSub.started_at) : null,
      slotSummary: summarizeSlots(slotsByClient.get(clientId) ?? []),
      sessionsUsed: currentSub ? (completedCountBySub.get(currentSub.id) ?? 0) : null,
      sessionsTotal: currentSub?.sessions_total ?? null,
      isAssignedToMe: true,
    };
  });
}

export type SessionNote = {
  booking_id: string;
  notes: string;
  exercises_performed: string | null;
  performance_rating: string | null;
  homework: string | null;
};

export type CoachClientDetail = Omit<CoachClientListRow, 'isAssignedToMe'> & {
  phone?: string | null;
  sessionHistory: Booking[];
  sessionNotes: SessionNote[];
  isAssignedToMe: boolean;
};

/**
 * Client Detail — New PRD.md: "100% read-only — no forms/buttons
 * anywhere on this page." Reachable two ways: the coach's own roster
 * (list/Dashboard preview, `isAssignedToMe: true`) or Global Search,
 * which per the PRD can open ANY client's detail read-only
 * ("Read-only banner ... found via Global Search"). `coach_profiles`/
 * `client_profiles`/`profiles` are readable by any authenticated user per
 * RLS (confirmed in `coach-search.ts`), so the non-roster fallback below
 * is a real, permitted read, not a workaround.
 */
export async function getCoachClientDetail(clientId: string): Promise<CoachClientDetail | null> {
  const list = await getCoachClientsList();
  const rosterRow = list.find((c) => c.id === clientId);

  const coachId = await getMyCoachProfileId();
  const { data: history, error } = await supabase
    .from('bookings')
    .select('*')
    .eq('client_id', clientId)
    .eq('coach_id', coachId ?? '')
    .order('scheduled_start', { ascending: false })
    .limit(20);
  if (error) throw error;

  const { data: profileRow } = await supabase
    .from('client_profiles')
    .select('id, client_code, status, profiles(full_name, photo_url, phone)')
    .eq('id', clientId)
    .maybeSingle();
  if (!profileRow && !rosterRow) return null;
  const profile = profileRow ? (Array.isArray(profileRow.profiles) ? profileRow.profiles[0] : profileRow.profiles) : null;

  const completedIds = (history ?? []).filter((b) => b.status === 'completed').map((b) => b.id);
  const notesRes =
    completedIds.length > 0
      ? await supabase
          .from('workout_notes')
          .select('booking_id, notes, exercises_performed, performance_rating, homework')
          .in('booking_id', completedIds)
      : { data: [], error: null };
  if (notesRes.error) throw notesRes.error;
  const sessionNotes = (notesRes.data ?? []) as SessionNote[];

  if (rosterRow) {
    return {
      ...rosterRow,
      phone: profile?.phone ?? null,
      sessionHistory: (history ?? []) as Booking[],
      sessionNotes,
      isAssignedToMe: true,
    };
  }

  // Not this coach's client — read-only, identity-only fallback (no plan/slot/session data belongs to this coach to show).
  return {
    id: clientId,
    full_name: profile?.full_name,
    photo_url: profile?.photo_url,
    client_code: profileRow?.client_code,
    derivedStatus: 'not_paid',
    planName: null,
    startDate: null,
    slotSummary: null,
    sessionsUsed: null,
    sessionsTotal: null,
    phone: null,
    sessionHistory: [],
    sessionNotes: [],
    isAssignedToMe: false,
  };
}
