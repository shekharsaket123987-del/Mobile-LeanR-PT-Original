/**
 * Admin Shadow Coverage — LEANR_PT_MOBILE_PRD.md §10 "Screen: Client
 * Detail (admin)" Assign Shadow Coach flow, §9 Feature Dependency Map
 * ("Coach Leave → Admin Approval → Shadow Coach Assignment"). Confirmed
 * against the real schema/RLS on 2026-08-19: `assign_shadow_coach(p_client_id,
 * p_primary_coach_id, p_shadow_coach_id, p_starts_on, p_ends_on, p_reason)`
 * is a single RPC that both records the assignment (`shadow_coach_assignments`,
 * status='active') AND reassigns the client's affected `upcoming` bookings'
 * `coach_id` to the shadow coach for that date range — confirmed by
 * reading the function body directly, not assumed from the PRD prose.
 *
 * "Uncovered leave-affected sessions" (the web app's
 * `listShadowCoverageGapsAction`) is reproduced here as a simplified,
 * direct computation rather than a port of that service: for every
 * `approved` leave whose window hasn't fully passed, find the leave-
 * taking coach's `upcoming` bookings that fall inside the leave window
 * and are STILL pointed at that coach (i.e. `assign_shadow_coach` was
 * never called for them) — grouped per client, since the RPC assigns
 * coverage one client at a time.
 *
 * `runLeaveApprovalCascade` (New PRD.md §3.15 "Leave Approval → Automatic
 * Shadow-Coverage Cascade") is a verbatim port of the web repo's
 * `scoreShadowCandidate` (scheduling.service.ts, confirmed by direct source
 * inspection — see the Gap Verification Report): specialization exact-match
 * = +40, else secondary-specialization match = +20 (mutually exclusive);
 * shared languages = +10 each, capped at 3 (max +30); rating × 6 (0–5 → 0–30);
 * (100 − utilization_pct) × 0.2 (max +20); summed with no normalization,
 * rounded to 1 decimal, max 120. Eligibility is "active + free for this exact
 * occurrence" ONLY — specialization/rating/utilization are scoring inputs,
 * never exclusion filters, matching the verified web behavior. "Free for
 * this occurrence" mirrors the same working-hours/shift/leave/booking-conflict
 * check `getOpenSlotsForCoachOnDate` (booking-wizard.ts) already uses for
 * client-facing slot search — the web app's `is_slot_within_working_hours()`/
 * `has_scheduling_conflict()` RPCs, reproduced here since those two RPCs are
 * SECURITY DEFINER server-side helpers this codebase doesn't call directly
 * elsewhere either. Ties (equal scores) are left as whatever order the DB
 * query returns and the array scan finds first — the web app has no
 * deliberate tie-breaker either (unordered query + stable sort), so none is
 * invented here. Assignment is per-occurrence, grouped into contiguous
 * date ranges per the same top-scored coach (one `assign_shadow_coach` RPC
 * call per group) — not one assignment for the whole leave window. Called
 * from `resolveLeaveRequest` (admin-leave.ts) on approval; occurrences with
 * zero eligible candidates are never silently dropped — flagged back to the
 * caller AND raise a `notifications` row for every admin, matching the
 * verified "uncovered occurrences ... admins alerted" behavior (the web app
 * does this via `notifyAdmins("admin_alert", ...)`, an app-layer call, not a
 * DB trigger — same mechanism used here).
 *
 * `assignShadowCoach` additionally notifies the covered client
 * (`shadow_coach_assigned`) and the shadow coach themselves
 * (`shadow_assignment_for_coach`), and `runLeaveApprovalCascade` notifies
 * the leaving coach (`leave_approved`/`leave_rejected`, from
 * admin-leave.ts) and every one of their active clients unconditionally
 * (`coach_on_leave_client`) — Gap Verification Report Area 6.
 */
import { supabase } from '@/lib/supabase/client';
import { notifyAdmins, notifyProfile, resolveProfileIdForClient, resolveProfileIdForCoach, resolveProfileIdsForClients, formatDateRange } from './notify';

/** Fixed, no-DST offset — IST is always UTC+5:30. Matches booking-wizard.ts. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istDateKeyFromIso(iso: string): string {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function istDayOfWeekFromIso(iso: string): number {
  const [y, m, d] = istDateKeyFromIso(iso).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function istTimeOfDay(iso: string, addMinutes = 0): string {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MS + addMinutes * 60_000);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}:00`;
}

export type ShadowGap = {
  leaveId: string;
  clientId: string;
  clientName: string;
  primaryCoachId: string;
  primaryCoachName: string;
  startsOn: string;
  endsOn: string;
  affectedSessions: number;
};

/** Exclusive end bound for a date-only range filter — plain UTC date arithmetic, no timezone ambiguity. */
function dayAfter(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

type Occurrence = { id: string; scheduledStart: string; durationMinutes: number };
type ClientOccurrences = { clientId: string; clientName: string; occurrences: Occurrence[] };

/** Bookings still pointed at `leave.coach_id` inside the leave window, grouped per client, chronological. */
async function computeOccurrenceGapsForLeave(leave: { coach_id: string; starts_on: string; ends_on: string }): Promise<ClientOccurrences[]> {
  const { data: bookings, error: bookingsError } = await supabase
    .from('bookings')
    .select('id, client_id, scheduled_start, duration_minutes, client_profiles(profiles(full_name))')
    .eq('coach_id', leave.coach_id)
    .eq('status', 'upcoming')
    .gte('scheduled_start', `${leave.starts_on}T00:00:00+05:30`)
    .lt('scheduled_start', `${dayAfter(leave.ends_on)}T00:00:00+05:30`)
    .order('scheduled_start', { ascending: true });
  if (bookingsError) throw bookingsError;
  if (!bookings || bookings.length === 0) return [];

  const byClient = new Map<string, ClientOccurrences>();
  for (const b of bookings) {
    const clientProfile = Array.isArray(b.client_profiles) ? b.client_profiles[0] : b.client_profiles;
    const clientProfileRow = clientProfile
      ? Array.isArray(clientProfile.profiles)
        ? clientProfile.profiles[0]
        : clientProfile.profiles
      : null;
    const occurrence: Occurrence = { id: b.id, scheduledStart: b.scheduled_start, durationMinutes: b.duration_minutes };
    const existing = byClient.get(b.client_id);
    if (existing) {
      existing.occurrences.push(occurrence);
    } else {
      byClient.set(b.client_id, { clientId: b.client_id, clientName: clientProfileRow?.full_name ?? 'Client', occurrences: [occurrence] });
    }
  }

  return Array.from(byClient.values());
}

/** New PRD.md §3.15: a partial leave only blocks occurrences whose time-of-day overlaps the leave's own window. */
function filterOccurrencesForLeaveWindow(occurrences: Occurrence[], leave: { leave_type: string; partial_start_time: string | null; partial_end_time: string | null }): Occurrence[] {
  if (leave.leave_type !== 'partial' || !leave.partial_start_time || !leave.partial_end_time) return occurrences;
  const partialStart = leave.partial_start_time;
  const partialEnd = leave.partial_end_time;
  return occurrences.filter((occ) => {
    const slotStartTime = istTimeOfDay(occ.scheduledStart);
    const slotEndTime = istTimeOfDay(occ.scheduledStart, occ.durationMinutes);
    return slotStartTime < partialEnd && slotEndTime > partialStart;
  });
}

export async function getShadowCoverageGaps(): Promise<ShadowGap[]> {
  const today = new Date().toISOString().slice(0, 10);

  const { data: leaves, error } = await supabase
    .from('coach_leave')
    .select('id, coach_id, starts_on, ends_on, leave_type, partial_start_time, partial_end_time, coach_profiles(profiles(full_name))')
    .eq('status', 'approved')
    .gte('ends_on', today);
  if (error) throw error;
  if (!leaves || leaves.length === 0) return [];

  const gaps: ShadowGap[] = [];

  for (const leave of leaves) {
    const coachProfile = Array.isArray(leave.coach_profiles) ? leave.coach_profiles[0] : leave.coach_profiles;
    const profile = coachProfile ? (Array.isArray(coachProfile.profiles) ? coachProfile.profiles[0] : coachProfile.profiles) : null;
    const primaryCoachName = profile?.full_name ?? 'Coach';

    const clientGaps = await computeOccurrenceGapsForLeave(leave);
    for (const g of clientGaps) {
      const occurrences = filterOccurrencesForLeaveWindow(g.occurrences, leave);
      if (occurrences.length === 0) continue;
      gaps.push({
        leaveId: leave.id,
        clientId: g.clientId,
        clientName: g.clientName,
        primaryCoachId: leave.coach_id,
        primaryCoachName,
        startsOn: leave.starts_on,
        endsOn: leave.ends_on,
        affectedSessions: occurrences.length,
      });
    }
  }

  return gaps;
}

export type ActiveCoachOption = { id: string; full_name: string };

export async function getActiveCoachOptions(): Promise<ActiveCoachOption[]> {
  const { data, error } = await supabase.from('coach_profiles').select('id, status, profiles(full_name)').eq('status', 'active');
  if (error) throw error;

  return (data ?? []).map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return { id: row.id as string, full_name: profile?.full_name ?? 'Coach' };
  });
}

export async function assignShadowCoach(input: {
  clientId: string;
  clientName: string;
  primaryCoachId: string;
  primaryCoachName: string;
  shadowCoachId: string;
  shadowCoachName: string;
  startsOn: string;
  endsOn: string;
  reason: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc('assign_shadow_coach', {
    p_client_id: input.clientId,
    p_primary_coach_id: input.primaryCoachId,
    p_shadow_coach_id: input.shadowCoachId,
    p_starts_on: input.startsOn,
    p_ends_on: input.endsOn,
    p_reason: input.reason,
  });
  if (error) throw error;

  const range = formatDateRange(input.startsOn, input.endsOn);
  const [clientProfileId, shadowProfileId] = await Promise.all([
    resolveProfileIdForClient(input.clientId),
    resolveProfileIdForCoach(input.shadowCoachId),
  ]);
  await notifyProfile(
    clientProfileId,
    'booking',
    'Shadow coach assigned',
    `${input.shadowCoachName} will cover your sessions with ${input.primaryCoachName} on ${range}.`,
    'shadow_coach_assigned'
  );
  await notifyProfile(
    shadowProfileId,
    'booking',
    'Shadow coverage assignment',
    `You're covering ${input.clientName}'s sessions with ${input.primaryCoachName} on ${range}.`,
    'shadow_assignment_for_coach'
  );
}

type TimeWindow = { start_time: string; end_time: string };
type LeaveWindow = { leave_type: string; starts_on: string; ends_on: string; partial_start_time: string | null; partial_end_time: string | null };

type CandidateProfile = {
  id: string;
  full_name: string;
  specialization: string | null;
  secondarySpecializations: string[];
  languages: string[];
  rating: number;
  utilizationPct: number;
};

type AvailabilityIndex = {
  leaveByCoach: Map<string, LeaveWindow[]>;
  shiftsByKey: Map<string, TimeWindow[]>;
  availabilityByKey: Map<string, TimeWindow[]>;
  bookingsByCoach: Map<string, { scheduled_start: string; duration_minutes: number }[]>;
};

/** Active, non-excluded coaches + everything needed to test per-occurrence availability, for one window. */
async function buildCandidatePool(
  excludeCoachIds: string[],
  windowStart: string,
  windowEnd: string
): Promise<{ candidates: CandidateProfile[]; index: AvailabilityIndex }> {
  const emptyIndex: AvailabilityIndex = {
    leaveByCoach: new Map(),
    shiftsByKey: new Map(),
    availabilityByKey: new Map(),
    bookingsByCoach: new Map(),
  };

  const { data: coaches, error } = await supabase
    .from('coach_profiles')
    .select('id, specialization, secondary_specializations, languages, rating, status, profiles(full_name)')
    .eq('status', 'active');
  if (error) throw error;

  const pool = (coaches ?? []).filter((c) => !excludeCoachIds.includes(c.id));
  const candidateIds = pool.map((c) => c.id);
  if (candidateIds.length === 0) return { candidates: [], index: emptyIndex };

  const windowStartIso = `${windowStart}T00:00:00+05:30`;
  const windowEndIso = `${dayAfter(windowEnd)}T00:00:00+05:30`;

  const [utilRes, leaveRes, shiftsRes, availabilityRes, bookingsRes] = await Promise.all([
    supabase.from('coach_utilization_view').select('coach_id, utilization_pct').in('coach_id', candidateIds),
    supabase
      .from('coach_leave')
      .select('coach_id, leave_type, starts_on, ends_on, partial_start_time, partial_end_time')
      .in('coach_id', candidateIds)
      .eq('status', 'approved')
      .lte('starts_on', windowEnd)
      .gte('ends_on', windowStart),
    supabase.from('coach_shifts').select('coach_id, shift_date, start_time, end_time').in('coach_id', candidateIds).gte('shift_date', windowStart).lte('shift_date', windowEnd),
    supabase.from('coach_availability').select('coach_id, day_of_week, start_time, end_time').in('coach_id', candidateIds).eq('is_active', true),
    supabase
      .from('bookings')
      .select('coach_id, scheduled_start, duration_minutes')
      .in('coach_id', candidateIds)
      .eq('status', 'upcoming')
      .gte('scheduled_start', windowStartIso)
      .lt('scheduled_start', windowEndIso),
  ]);
  for (const res of [utilRes, leaveRes, shiftsRes, availabilityRes, bookingsRes]) {
    if (res.error) throw res.error;
  }

  const utilByCoach = new Map<string, number>();
  for (const row of utilRes.data ?? []) utilByCoach.set(row.coach_id, row.utilization_pct ?? 0);

  const index: AvailabilityIndex = { ...emptyIndex, leaveByCoach: new Map(), shiftsByKey: new Map(), availabilityByKey: new Map(), bookingsByCoach: new Map() };
  for (const row of leaveRes.data ?? []) {
    const list = index.leaveByCoach.get(row.coach_id) ?? [];
    list.push(row);
    index.leaveByCoach.set(row.coach_id, list);
  }
  for (const row of shiftsRes.data ?? []) {
    const key = `${row.coach_id}|${row.shift_date}`;
    const list = index.shiftsByKey.get(key) ?? [];
    list.push({ start_time: row.start_time, end_time: row.end_time });
    index.shiftsByKey.set(key, list);
  }
  for (const row of availabilityRes.data ?? []) {
    const key = `${row.coach_id}|${row.day_of_week}`;
    const list = index.availabilityByKey.get(key) ?? [];
    list.push({ start_time: row.start_time, end_time: row.end_time });
    index.availabilityByKey.set(key, list);
  }
  for (const row of bookingsRes.data ?? []) {
    const list = index.bookingsByCoach.get(row.coach_id) ?? [];
    list.push({ scheduled_start: row.scheduled_start, duration_minutes: row.duration_minutes });
    index.bookingsByCoach.set(row.coach_id, list);
  }

  const candidates: CandidateProfile[] = pool.map((c) => {
    const profile = Array.isArray(c.profiles) ? c.profiles[0] : c.profiles;
    return {
      id: c.id,
      full_name: profile?.full_name ?? 'Coach',
      specialization: c.specialization,
      secondarySpecializations: c.secondary_specializations ?? [],
      languages: c.languages ?? [],
      rating: Number(c.rating ?? 0),
      utilizationPct: utilByCoach.get(c.id) ?? 0,
    };
  });

  return { candidates, index };
}

/** Mirrors `is_slot_within_working_hours()` + `has_scheduling_conflict()` — see booking-wizard.ts's equivalent for clients. */
function isCoachFreeAt(coachId: string, startIso: string, durationMinutes: number, index: AvailabilityIndex): boolean {
  const dateKey = istDateKeyFromIso(startIso);
  const dow = istDayOfWeekFromIso(startIso);
  const slotStartTime = istTimeOfDay(startIso);
  const slotEndTime = istTimeOfDay(startIso, durationMinutes);

  const leaves = index.leaveByCoach.get(coachId) ?? [];
  if (leaves.some((l) => l.leave_type === 'full_day' && l.starts_on <= dateKey && l.ends_on >= dateKey)) return false;
  const blockedByPartialLeave = leaves.some(
    (l) =>
      l.leave_type !== 'full_day' &&
      l.starts_on <= dateKey &&
      l.ends_on >= dateKey &&
      l.partial_start_time &&
      l.partial_end_time &&
      slotStartTime < l.partial_end_time &&
      slotEndTime > l.partial_start_time
  );
  if (blockedByPartialLeave) return false;

  const shifts = index.shiftsByKey.get(`${coachId}|${dateKey}`) ?? [];
  const windows = shifts.length > 0 ? shifts : index.availabilityByKey.get(`${coachId}|${dow}`) ?? [];
  if (windows.length === 0) return false;
  if (!windows.some((w) => w.start_time <= slotStartTime && w.end_time >= slotEndTime)) return false;

  const slotStartMs = new Date(startIso).getTime();
  const slotEndMs = slotStartMs + durationMinutes * 60_000;
  const bookings = index.bookingsByCoach.get(coachId) ?? [];
  const conflict = bookings.some((b) => {
    const bStart = new Date(b.scheduled_start).getTime();
    const bEnd = bStart + b.duration_minutes * 60_000;
    return bStart < slotEndMs && bEnd > slotStartMs;
  });
  return !conflict;
}

type PrimaryCoachInfo = { specialization: string | null; languages: string[] };

/** Verbatim port of scheduling.service.ts::scoreShadowCandidate. Max 120 (40 + 30 + 30 + 20), no normalization. */
function scoreShadowCandidate(candidate: CandidateProfile, primary: PrimaryCoachInfo): number {
  let score = 0;

  if (primary.specialization && candidate.specialization === primary.specialization) score += 40;
  else if (primary.specialization && candidate.secondarySpecializations.includes(primary.specialization)) score += 20;

  const sharedLanguages = candidate.languages.filter((l) => primary.languages.includes(l)).length;
  score += Math.min(sharedLanguages, 3) * 10;

  score += candidate.rating * 6;
  score += (100 - candidate.utilizationPct) * 0.2;

  return Math.round(score * 10) / 10;
}

/** Top-scored eligible ("active + free for this exact occurrence") candidate, or null. No deliberate tie-break — see file header. */
function pickTopForOccurrence(
  candidates: CandidateProfile[],
  index: AvailabilityIndex,
  primary: PrimaryCoachInfo,
  startIso: string,
  durationMinutes: number
): { id: string; full_name: string } | null {
  let best: { id: string; full_name: string; score: number } | null = null;
  for (const c of candidates) {
    if (!isCoachFreeAt(c.id, startIso, durationMinutes, index)) continue;
    const score = scoreShadowCandidate(c, primary);
    if (!best || score > best.score) best = { id: c.id, full_name: c.full_name, score };
  }
  return best ? { id: best.id, full_name: best.full_name } : null;
}

type AssignmentGroup = { shadowCoachId: string; shadowCoachName: string; startsOn: string; endsOn: string };

/** planShadowAssignments: contiguous occurrences with the SAME top coach become one date-range group; any uncovered occurrence breaks the run. */
function groupOccurrenceAssignments(
  occurrences: Occurrence[],
  pick: (occ: Occurrence) => { id: string; full_name: string } | null
): { groups: AssignmentGroup[]; uncoveredDates: string[] } {
  const groups: AssignmentGroup[] = [];
  const uncoveredDates: string[] = [];
  let current: AssignmentGroup | null = null;

  for (const occ of occurrences) {
    const dateKey = istDateKeyFromIso(occ.scheduledStart);
    const candidate = pick(occ);
    if (!candidate) {
      if (current) {
        groups.push(current);
        current = null;
      }
      uncoveredDates.push(dateKey);
      continue;
    }
    if (current && current.shadowCoachId === candidate.id) {
      current.endsOn = dateKey;
    } else {
      if (current) groups.push(current);
      current = { shadowCoachId: candidate.id, shadowCoachName: candidate.full_name, startsOn: dateKey, endsOn: dateKey };
    }
  }
  if (current) groups.push(current);
  return { groups, uncoveredDates };
}

export type LeaveCascadeOutcome = {
  autoAssigned: { clientName: string; shadowCoachName: string }[];
  needsManual: { clientName: string }[];
};

/** New PRD.md §3.15 "Leave Approval → Automatic Shadow-Coverage Cascade". Called on leave approval — runs for BOTH leave types. */
export async function runLeaveApprovalCascade(leave: {
  coachId: string;
  coachName: string;
  startsOn: string;
  endsOn: string;
  leaveType: string;
  partialStartTime: string | null;
  partialEndTime: string | null;
  primarySpecialization: string | null;
  primaryLanguages: string[];
}): Promise<LeaveCascadeOutcome> {
  const outcome: LeaveCascadeOutcome = { autoAssigned: [], needsManual: [] };
  const alerts: string[] = [];
  const primary: PrimaryCoachInfo = { specialization: leave.primarySpecialization, languages: leave.primaryLanguages };
  const range = formatDateRange(leave.startsOn, leave.endsOn);

  // Unconditional notifications on approval (New PRD.md §3.15): the coach, then EVERY
  // one of their currently active clients — regardless of whether that specific client
  // has a session literally inside the leave window.
  const coachProfileId = await resolveProfileIdForCoach(leave.coachId);
  await notifyProfile(coachProfileId, 'booking', 'Leave approved', `Your leave request for ${range} has been approved.`, 'leave_approved');

  const { data: activeSlots, error: slotsError } = await supabase.from('recurring_slots').select('client_id').eq('coach_id', leave.coachId).eq('status', 'active');
  if (slotsError) throw slotsError;
  const activeClientIds = [...new Set((activeSlots ?? []).map((s) => s.client_id as string))];
  const clientProfileIds = await resolveProfileIdsForClients(activeClientIds);
  await Promise.all(
    activeClientIds.map((cid) =>
      notifyProfile(
        clientProfileIds.get(cid) ?? null,
        'booking',
        'Your coach is on leave',
        `${leave.coachName} will be on leave ${range}. We'll make sure your sessions are covered.`,
        'coach_on_leave_client'
      )
    )
  );

  const allGaps = await computeOccurrenceGapsForLeave({ coach_id: leave.coachId, starts_on: leave.startsOn, ends_on: leave.endsOn });
  const clientGaps = allGaps
    .map((gap) => ({
      ...gap,
      occurrences: filterOccurrencesForLeaveWindow(gap.occurrences, {
        leave_type: leave.leaveType,
        partial_start_time: leave.partialStartTime,
        partial_end_time: leave.partialEndTime,
      }),
    }))
    .filter((gap) => gap.occurrences.length > 0);

  for (const gap of clientGaps) {
    const { candidates, index } = await buildCandidatePool([leave.coachId], leave.startsOn, leave.endsOn);
    const { groups, uncoveredDates } = groupOccurrenceAssignments(gap.occurrences, (occ) =>
      pickTopForOccurrence(candidates, index, primary, occ.scheduledStart, occ.durationMinutes)
    );

    for (const group of groups) {
      await assignShadowCoach({
        clientId: gap.clientId,
        clientName: gap.clientName,
        primaryCoachId: leave.coachId,
        primaryCoachName: leave.coachName,
        shadowCoachId: group.shadowCoachId,
        shadowCoachName: group.shadowCoachName,
        startsOn: group.startsOn,
        endsOn: group.endsOn,
        reason: 'Auto-assigned: coach on approved leave',
      });
      outcome.autoAssigned.push({ clientName: gap.clientName, shadowCoachName: group.shadowCoachName });
    }
    if (uncoveredDates.length > 0) {
      outcome.needsManual.push({ clientName: gap.clientName });
      alerts.push(`No available shadow coach for ${gap.clientName} on: ${uncoveredDates.join(', ')}. Assign manually from Shadow Coverage.`);
    }
  }

  // Cascade: if the leaving coach was itself covering another client as a shadow, that
  // coverage needs a new shadow coach too (New PRD.md §3.15, "ALSO cascades...").
  const { data: covering, error: coveringError } = await supabase
    .from('shadow_coach_assignments')
    .select('client_id, primary_coach_id, starts_on, ends_on, client_profiles(profiles(full_name))')
    .eq('shadow_coach_id', leave.coachId)
    .eq('status', 'active')
    .gte('ends_on', leave.startsOn);
  if (coveringError) throw coveringError;

  for (const cov of covering ?? []) {
    const clientProfile = Array.isArray(cov.client_profiles) ? cov.client_profiles[0] : cov.client_profiles;
    const profile = clientProfile ? (Array.isArray(clientProfile.profiles) ? clientProfile.profiles[0] : clientProfile.profiles) : null;
    const clientName = profile?.full_name ?? 'Client';

    const overlapStart = cov.starts_on > leave.startsOn ? cov.starts_on : leave.startsOn;
    const overlapEnd = cov.ends_on < leave.endsOn ? cov.ends_on : leave.endsOn;
    if (overlapStart > overlapEnd) continue;

    const { data: coveredBookings, error: coveredError } = await supabase
      .from('bookings')
      .select('id, scheduled_start, duration_minutes')
      .eq('client_id', cov.client_id)
      .eq('coach_id', leave.coachId)
      .eq('status', 'upcoming')
      .gte('scheduled_start', `${overlapStart}T00:00:00+05:30`)
      .lt('scheduled_start', `${dayAfter(overlapEnd)}T00:00:00+05:30`)
      .order('scheduled_start', { ascending: true });
    if (coveredError) throw coveredError;
    if (!coveredBookings || coveredBookings.length === 0) continue;

    const { data: primaryRow, error: primaryError } = await supabase
      .from('coach_profiles')
      .select('specialization, languages, profiles(full_name)')
      .eq('id', cov.primary_coach_id)
      .maybeSingle();
    if (primaryError) throw primaryError;
    const covPrimary: PrimaryCoachInfo = { specialization: primaryRow?.specialization ?? null, languages: primaryRow?.languages ?? [] };
    const primaryRowProfile = primaryRow ? (Array.isArray(primaryRow.profiles) ? primaryRow.profiles[0] : primaryRow.profiles) : null;
    const covPrimaryName = primaryRowProfile?.full_name ?? 'Coach';

    const { candidates, index } = await buildCandidatePool([leave.coachId, cov.primary_coach_id], overlapStart, overlapEnd);
    const occurrences: Occurrence[] = coveredBookings.map((b) => ({ id: b.id, scheduledStart: b.scheduled_start, durationMinutes: b.duration_minutes }));
    const { groups, uncoveredDates } = groupOccurrenceAssignments(occurrences, (occ) =>
      pickTopForOccurrence(candidates, index, covPrimary, occ.scheduledStart, occ.durationMinutes)
    );

    for (const group of groups) {
      await assignShadowCoach({
        clientId: cov.client_id,
        clientName,
        primaryCoachId: cov.primary_coach_id,
        primaryCoachName: covPrimaryName,
        shadowCoachId: group.shadowCoachId,
        shadowCoachName: group.shadowCoachName,
        startsOn: group.startsOn,
        endsOn: group.endsOn,
        reason: 'Re-assigned: previous shadow coach also went on leave',
      });
      outcome.autoAssigned.push({ clientName, shadowCoachName: group.shadowCoachName });
    }
    if (uncoveredDates.length > 0) {
      outcome.needsManual.push({ clientName });
      alerts.push(`No available replacement shadow coach for ${clientName} on: ${uncoveredDates.join(', ')} — their shadow coach is also going on leave.`);
    }
  }

  if (alerts.length > 0) {
    await notifyAdmins('Shadow coverage needed', alerts.join('\n'), 'shadow_coverage_gap');
  }

  return outcome;
}
