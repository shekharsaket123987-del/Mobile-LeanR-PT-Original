/**
 * Admin Sessions — New PRD.md §4.C "Screen: Sessions (master list)" and
 * "Screen: Session Detail". Coach + Status filters (client-side), fixed
 * sort (date desc). Admin is the only role that bypasses cutoffs
 * (`p_enforce_cutoff: false`, New PRD.md §6) — confirmed RPC signatures:
 * `cancel_booking(p_booking_id, p_cancelled_by, p_reason, p_enforce_cutoff)`,
 * `reschedule_booking(p_booking_id, p_new_start, p_new_duration_minutes, p_enforce_cutoff)`.
 * Cancel has **no confirmation dialog** on web either (New PRD.md §4.C) —
 * reproduced as-is, not a mobile oversight.
 */
import { supabase } from '@/lib/supabase/client';
import { notifyProfile } from './notify';
import type { Booking, BookingStatus } from './types';

function formatSessionTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

type NotifyContext = { clientProfileId: string | null; coachProfileId: string | null; clientName: string; coachName: string };

async function getSessionNotifyContext(bookingId: string): Promise<NotifyContext | null> {
  const { data, error } = await supabase
    .from('bookings')
    .select('client_profiles(profile_id, profiles(full_name)), coach_profiles(profile_id, profiles(full_name))')
    .eq('id', bookingId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const clientProfile = Array.isArray(data.client_profiles) ? data.client_profiles[0] : data.client_profiles;
  const clientProfileRow = clientProfile ? (Array.isArray(clientProfile.profiles) ? clientProfile.profiles[0] : clientProfile.profiles) : null;
  const coachProfile = Array.isArray(data.coach_profiles) ? data.coach_profiles[0] : data.coach_profiles;
  const coachProfileRow = coachProfile ? (Array.isArray(coachProfile.profiles) ? coachProfile.profiles[0] : coachProfile.profiles) : null;

  return {
    clientProfileId: clientProfile?.profile_id ?? null,
    coachProfileId: coachProfile?.profile_id ?? null,
    clientName: clientProfileRow?.full_name ?? 'Client',
    coachName: coachProfileRow?.full_name ?? 'Coach',
  };
}

export type AdminSessionRow = Booking & { coach_name: string | null; client_name: string | null };

function withNames(row: Record<string, unknown>): AdminSessionRow {
  const coachProfile = row.coach_profiles as { profiles?: { full_name?: string } | { full_name?: string }[] } | null;
  const coachP = coachProfile ? (Array.isArray(coachProfile.profiles) ? coachProfile.profiles[0] : coachProfile.profiles) : null;
  const clientProfile = row.client_profiles as { profiles?: { full_name?: string } | { full_name?: string }[] } | null;
  const clientP = clientProfile ? (Array.isArray(clientProfile.profiles) ? clientProfile.profiles[0] : clientProfile.profiles) : null;
  const { coach_profiles: _c, client_profiles: _cl, ...rest } = row;
  return { ...rest, coach_name: coachP?.full_name ?? null, client_name: clientP?.full_name ?? null } as AdminSessionRow;
}

export async function listAdminSessions(): Promise<AdminSessionRow[]> {
  const { data, error } = await supabase
    .from('bookings')
    .select('*, coach_profiles(profiles(full_name)), client_profiles(profiles(full_name))')
    .order('scheduled_start', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []).map(withNames);
}

export async function getAdminSessionDetail(bookingId: string): Promise<AdminSessionRow | null> {
  const { data, error } = await supabase
    .from('bookings')
    .select('*, coach_profiles(profiles(full_name)), client_profiles(profiles(full_name))')
    .eq('id', bookingId)
    .maybeSingle();
  if (error) throw error;
  return data ? withNames(data) : null;
}

export async function getAdminSessionAttendance(bookingId: string) {
  const { data, error } = await supabase.from('attendance').select('*').eq('booking_id', bookingId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getAdminSessionNotes(bookingId: string) {
  const { data, error } = await supabase.from('workout_notes').select('*').eq('booking_id', bookingId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function cancelSessionAsAdmin(bookingId: string, reason: string | null): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: booking, error: bookingError } = await supabase.from('bookings').select('scheduled_start').eq('id', bookingId).maybeSingle();
  if (bookingError) throw bookingError;
  const context = await getSessionNotifyContext(bookingId);

  const { error } = await supabase.rpc('cancel_booking', { p_booking_id: bookingId, p_cancelled_by: user?.id, p_reason: reason, p_enforce_cutoff: false });
  if (error) throw error;

  if (context && booking) {
    const reasonLine = reason ? ` (${reason})` : '';
    await notifyProfile(
      context.clientProfileId,
      'booking',
      'Session cancelled',
      `Your session with ${context.coachName} on ${formatSessionTime(booking.scheduled_start)} was cancelled${reasonLine}.`,
      'session_cancelled_client'
    );
  }
}

export async function rescheduleSessionAsAdmin(bookingId: string, newStart: string, newDurationMinutes: number): Promise<void> {
  const { data: booking, error: bookingError } = await supabase.from('bookings').select('scheduled_start').eq('id', bookingId).maybeSingle();
  if (bookingError) throw bookingError;
  const context = await getSessionNotifyContext(bookingId);

  const { error } = await supabase.rpc('reschedule_booking', {
    p_booking_id: bookingId,
    p_new_start: newStart,
    p_new_duration_minutes: newDurationMinutes,
    p_enforce_cutoff: false,
  });
  if (error) throw error;

  if (context && booking) {
    const oldTime = formatSessionTime(booking.scheduled_start);
    const newTime = formatSessionTime(newStart);
    await notifyProfile(
      context.clientProfileId,
      'booking',
      'Session rescheduled',
      `Your session with ${context.coachName} moved from ${oldTime} to ${newTime}.`,
      'session_rescheduled_client'
    );
    await notifyProfile(context.coachProfileId, 'booking', 'Schedule changed by admin', `${context.clientName}'s session was moved to ${newTime}.`, 'admin_changed_schedule');
  }
}

export type { BookingStatus };
