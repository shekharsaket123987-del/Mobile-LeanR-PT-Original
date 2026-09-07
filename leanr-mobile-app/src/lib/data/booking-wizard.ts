/**
 * Ad-hoc booking wizard — LEANR_PT_MOBILE_PRD.md §15 (Booking System),
 * §13 rules 1-4. Confirmed against the real schema/RPCs via direct
 * introspection of the "LeanR PT" Supabase project on 2026-08-17:
 * `create_temporary_booking(p_client_id, p_coach_id, p_slot_start,
 * p_duration_minutes)` and `confirm_booking(p_temp_booking_id,
 * p_subscription_id, p_recurring_slot_id, p_assessment_session_id,
 * p_session_type)` — the 5-arg overload (there's a 6-arg one that also
 * takes `p_amount_paid`; omitting it resolves to the 5-arg form). Neither
 * function is SECURITY DEFINER, so RLS applies as the calling client:
 * `temporary_bookings`/`bookings` INSERT policies require
 * `client_id = my_client_id()`, which matches passing our own resolved
 * client id as `p_client_id`.
 *
 * Slot availability (`getOpenSlotsForCoachOnDate`) is a client-side,
 * best-effort mirror of the server's `is_slot_within_working_hours()` +
 * `has_scheduling_conflict()` (read directly from `coach_leave` /
 * `coach_shifts` / `coach_availability` / `bookings`, all readable by any
 * authenticated user per RLS) — per §15 this is deliberately advisory
 * only ("a stale client view can never over-book"): `confirm_booking`
 * re-validates server-side and throws if the slot was taken in the
 * meantime, which the UI surfaces as an error rather than a false
 * success. It does NOT check other clients' in-flight holds
 * (`temporary_bookings` is RLS-restricted to `client_id = my_client_id()`
 * for SELECT) — the server's SECURITY DEFINER `has_scheduling_conflict()`
 * sees those regardless, so correctness doesn't depend on this file
 * seeing them too.
 *
 * `confirmHold` is also reused by src/lib/data/demo-booking.ts for
 * assessment sessions (see that file's header for what's different
 * there) and recurring-schedule setup lives in its own file
 * (recurring-schedule.ts) since it doesn't use the hold->confirm
 * mechanism at all — see leanr-mobile-app/README.md for both.
 */
import { assertMeasurementsFresh } from '@/lib/data/measurement-status';
import { getMyClientProfileId } from '@/lib/data/identity';
import { supabase } from '@/lib/supabase/client';

/** Fixed, no-DST offset — IST is always UTC+5:30. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function pad(n: number) {
  return String(n).padStart(2, '0');
}

/** IST calendar date (never derived from device-local time). */
export type IstDate = { year: number; month: number; day: number };

export function todayIst(): IstDate {
  const d = new Date(Date.now() + IST_OFFSET_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function addIstDays(date: IstDate, days: number): IstDate {
  // Date.UTC normalizes out-of-range day-of-month, so this correctly
  // rolls across month/year boundaries without any timezone involvement.
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function istDateKey(date: IstDate): string {
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`;
}

/** Weekday (0=Sun..6=Sat) for an IST calendar date — matches Postgres `extract(dow from ...)`. */
export function istDayOfWeek(date: IstDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

/** The UTC instant corresponding to a given IST wall-clock date+hour. */
function istHourToUtcInstant(date: IstDate, hour: number, minute = 0): Date {
  return new Date(Date.UTC(date.year, date.month - 1, date.day, hour, minute, 0) - IST_OFFSET_MS);
}

/** Human label for an IST calendar date, e.g. "Tue, Aug 18". */
export function formatIstDateLabel(date: IstDate): string {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Human label for a slot's UTC instant, in IST wall-clock time, e.g. "6:00 AM IST". */
export function formatIstTimeLabel(slotStartIso: string): string {
  const clock = new Date(new Date(slotStartIso).getTime() + IST_OFFSET_MS);
  const h = clock.getUTCHours();
  const m = clock.getUTCMinutes();
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${h >= 12 ? 'PM' : 'AM'} IST`;
}

export type BookingSettings = {
  bookingWindowStartHour: number;
  bookingWindowEndHour: number;
  defaultSessionDurationMinutes: number;
  temporaryBookingHoldMinutes: number;
  rescheduleCutoffHours: number;
  assessmentSessionDurationMinutes: number;
};

/**
 * New PRD.md §27: `default_session_duration_minutes`/`assessment_session_duration_minutes`
 * are NOT live on web — the real session/assessment durations are hardcoded (45/60)
 * in `client-portal.actions.ts::getBookingOptionsAction`; the "default duration" setting
 * only moves the admin dashboard's empty-slot KPI (see admin-dashboard.ts), and the
 * assessment one has zero live readers on web at all. Hardcoded here to match exactly —
 * previously these were read live from `system_settings`, which meant moving either
 * admin Settings slider (or that DB row) would silently change the real booked-session
 * length on mobile in a way it never does on web.
 */
const WEB_HARDCODED_SESSION_DURATION_MINUTES = 45;
const WEB_HARDCODED_ASSESSMENT_DURATION_MINUTES = 60;

/** §13 system_settings — read live so an admin change is reflected without a client update. */
export async function getBookingSettings(): Promise<BookingSettings> {
  const { data, error } = await supabase
    .from('system_settings')
    .select('key, value')
    .in('key', ['booking_window_start_hour', 'booking_window_end_hour', 'temporary_booking_hold_minutes', 'reschedule_cutoff_hours']);
  if (error) throw error;

  const byKey = Object.fromEntries((data ?? []).map((row) => [row.key, row.value as number]));
  return {
    bookingWindowStartHour: byKey.booking_window_start_hour ?? 5,
    bookingWindowEndHour: byKey.booking_window_end_hour ?? 22,
    defaultSessionDurationMinutes: WEB_HARDCODED_SESSION_DURATION_MINUTES,
    temporaryBookingHoldMinutes: byKey.temporary_booking_hold_minutes ?? 10,
    rescheduleCutoffHours: byKey.reschedule_cutoff_hours ?? 1,
    assessmentSessionDurationMinutes: WEB_HARDCODED_ASSESSMENT_DURATION_MINUTES,
  };
}

/**
 * §13 rule 6 (reschedule_booking's own cutoff check, confirmed live: it
 * only checks `scheduled_start - now() >= cutoff_hours` — NOT the forward-
 * window/weekly-cap/same-day rules §13 rules 7-9 describe, which turned
 * out not to be enforced in the live RPC. This mirrors exactly what the
 * server actually checks, not the PRD's fuller aspirational rule set —
 * showing a slot here that the server would reject wastes the client's
 * tap, but inventing stricter client-side rules the server doesn't
 * enforce would be its own kind of wrong.
 */
export function isAfterRescheduleCutoff(slotStartIso: string, cutoffHours: number): boolean {
  return new Date(slotStartIso).getTime() - Date.now() >= cutoffHours * 60 * 60 * 1000;
}

export type CoachOption = { id: string; full_name: string; specialization: string | null };

/** Used only when the client has no assigned coach yet (see `getMyCoach` in coach.ts). */
export async function getAvailableCoaches(): Promise<CoachOption[]> {
  const { data, error } = await supabase
    .from('coach_profiles')
    .select('id, specialization, status, profiles(full_name)')
    .eq('status', 'active');
  if (error) throw error;

  return (data ?? []).map((row) => {
    const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    return { id: row.id as string, full_name: profile?.full_name ?? 'Coach', specialization: row.specialization as string | null };
  });
}

type TimeWindow = { start_time: string; end_time: string };

/**
 * Whole-hour open slots for one coach on one IST calendar date — mirrors
 * `is_slot_within_working_hours()` (leave -> shift override -> weekly
 * template) and the `bookings` half of `has_scheduling_conflict()`.
 */
export async function getOpenSlotsForCoachOnDate(
  coachId: string,
  date: IstDate,
  durationMinutes: number,
  window: { startHour: number; endHour: number }
): Promise<string[]> {
  const dateKey = istDateKey(date);
  const dayStart = istHourToUtcInstant(date, 0);
  const dayEnd = istHourToUtcInstant(addIstDays(date, 1), 0);

  const [leaveRes, shiftsRes, availabilityRes, bookingsRes] = await Promise.all([
    supabase
      .from('coach_leave')
      .select('leave_type, partial_start_time, partial_end_time')
      .eq('coach_id', coachId)
      .eq('status', 'approved')
      .lte('starts_on', dateKey)
      .gte('ends_on', dateKey),
    supabase.from('coach_shifts').select('start_time, end_time').eq('coach_id', coachId).eq('shift_date', dateKey),
    supabase
      .from('coach_availability')
      .select('start_time, end_time')
      .eq('coach_id', coachId)
      .eq('day_of_week', istDayOfWeek(date))
      .eq('is_active', true),
    supabase
      .from('bookings')
      .select('scheduled_start, duration_minutes')
      .eq('coach_id', coachId)
      .eq('status', 'upcoming')
      .gte('scheduled_start', dayStart.toISOString())
      .lt('scheduled_start', dayEnd.toISOString()),
  ]);
  for (const res of [leaveRes, shiftsRes, availabilityRes, bookingsRes]) {
    if (res.error) throw res.error;
  }

  const leave = leaveRes.data ?? [];
  if (leave.some((l) => l.leave_type === 'full_day')) return [];

  // Shift override, if present for this date, is authoritative (no
  // fallback to the weekly template) — matches is_slot_within_working_hours.
  const shifts = shiftsRes.data ?? [];
  const windows: TimeWindow[] = shifts.length > 0 ? shifts : availabilityRes.data ?? [];
  if (windows.length === 0) return [];

  const bookings = bookingsRes.data ?? [];
  const slots: string[] = [];

  for (let hour = window.startHour; hour < window.endHour; hour++) {
    const slotStartTime = `${pad(hour)}:00:00`;
    const endTotalMinutes = hour * 60 + durationMinutes;
    const slotEndTime = `${pad(Math.floor(endTotalMinutes / 60))}:${pad(endTotalMinutes % 60)}:00`;

    const withinWindow = windows.some((w) => w.start_time <= slotStartTime && w.end_time >= slotEndTime);
    if (!withinWindow) continue;

    const blockedByPartialLeave = leave.some(
      (l) =>
        l.leave_type !== 'full_day' &&
        l.partial_start_time &&
        l.partial_end_time &&
        slotStartTime < l.partial_end_time &&
        slotEndTime > l.partial_start_time
    );
    if (blockedByPartialLeave) continue;

    const slotStart = istHourToUtcInstant(date, hour);
    const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60_000);

    const conflicts = bookings.some((b) => {
      const bStart = new Date(b.scheduled_start).getTime();
      const bEnd = bStart + b.duration_minutes * 60_000;
      return bStart < slotEnd.getTime() && bEnd > slotStart.getTime();
    });
    if (conflicts) continue;

    slots.push(slotStart.toISOString());
  }

  return slots;
}

/** §15 step 1 of hold->confirm: 10-minute (configurable) hold on a slot. */
export async function holdSlot(coachId: string, slotStartIso: string, durationMinutes: number): Promise<string> {
  const clientId = await getMyClientProfileId();
  if (!clientId) throw new Error('Could not resolve your client profile.');

  const { data, error } = await supabase.rpc('create_temporary_booking', {
    p_client_id: clientId,
    p_coach_id: coachId,
    p_slot_start: slotStartIso,
    p_duration_minutes: durationMinutes,
  });
  if (error) throw error;
  return data as string;
}

/** §15 step 2: re-validates the hold and creates the real `bookings` row. */
/**
 * `subscriptionId` is nullable and `options.amountPaid` is optional
 * because demo-booking.ts reuses this for assessment sessions (no
 * subscription, `amount_paid=0`) — passing `amountPaid` switches to the
 * 6-arg `confirm_booking` overload; omitting it keeps the original 5-arg
 * regular-booking behavior unchanged.
 */
export async function confirmHold(
  tempBookingId: string,
  subscriptionId: string | null,
  options?: { sessionType?: 'regular' | 'assessment'; amountPaid?: number }
): Promise<string> {
  await assertMeasurementsFresh(); // New PRD.md §6 — applies to regular AND demo bookings, both funnel through here

  const params: Record<string, unknown> = {
    p_temp_booking_id: tempBookingId,
    p_subscription_id: subscriptionId,
    p_recurring_slot_id: null,
    p_assessment_session_id: null,
    p_session_type: options?.sessionType ?? 'regular',
  };
  if (options?.amountPaid !== undefined) {
    params.p_amount_paid = options.amountPaid;
  }

  const { data, error } = await supabase.rpc('confirm_booking', params);
  if (error) throw error;
  return data as string;
}
