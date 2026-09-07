/**
 * Admin Leave Requests — LEANR_PT_MOBILE_PRD.md §10 "Screen: Leave
 * Requests (admin)". Confirmed live on 2026-08-19: `coach_leave_admin_all`
 * gives admin full read/write via `is_admin()`, no extra gate.
 *
 * Approving a leave (either `full_day` or `partial`) runs
 * `runLeaveApprovalCascade` (admin-shadow.ts) — New PRD.md §3.15's
 * automatic shadow-coverage cascade, confirmed to run for both leave types
 * (only the set of occurrences considered differs: `partial` time-filters
 * to the leave's own window). Rejecting a leave never cascades, per the PRD.
 */
import { supabase } from '@/lib/supabase/client';
import { runLeaveApprovalCascade, type LeaveCascadeOutcome } from './admin-shadow';
import { notifyProfile, resolveProfileIdForCoach, formatDateRange } from './notify';
import type { LeaveStatus, LeaveType } from './coach-availability';

export type AdminLeaveRequest = {
  id: string;
  coachName: string;
  starts_on: string;
  ends_on: string;
  leave_type: LeaveType;
  partial_start_time: string | null;
  partial_end_time: string | null;
  reason: string | null;
  status: LeaveStatus;
  created_at: string;
};

export async function getPendingLeaveRequests(): Promise<AdminLeaveRequest[]> {
  const { data, error } = await supabase
    .from('coach_leave')
    .select('id, starts_on, ends_on, leave_type, partial_start_time, partial_end_time, reason, status, created_at, coach_profiles(profiles(full_name))')
    .eq('status', 'pending')
    .order('starts_on', { ascending: true });
  if (error) throw error;

  return (data ?? []).map((row) => {
    const coachProfile = Array.isArray(row.coach_profiles) ? row.coach_profiles[0] : row.coach_profiles;
    const profile = coachProfile ? (Array.isArray(coachProfile.profiles) ? coachProfile.profiles[0] : coachProfile.profiles) : null;
    return {
      id: row.id,
      coachName: profile?.full_name ?? 'Coach',
      starts_on: row.starts_on,
      ends_on: row.ends_on,
      leave_type: row.leave_type,
      partial_start_time: row.partial_start_time,
      partial_end_time: row.partial_end_time,
      reason: row.reason,
      status: row.status,
      created_at: row.created_at,
    };
  });
}

export async function resolveLeaveRequest(id: string, status: 'approved' | 'rejected'): Promise<LeaveCascadeOutcome | null> {
  const { data: leaveRow, error: fetchError } = await supabase
    .from('coach_leave')
    .select('id, coach_id, starts_on, ends_on, leave_type, partial_start_time, partial_end_time, coach_profiles(specialization, languages, profiles(full_name))')
    .eq('id', id)
    .single();
  if (fetchError) throw fetchError;

  const { error } = await supabase.from('coach_leave').update({ status }).eq('id', id);
  if (error) throw error;

  const coachProfile = Array.isArray(leaveRow.coach_profiles) ? leaveRow.coach_profiles[0] : leaveRow.coach_profiles;
  const coachProfileRow = coachProfile ? (Array.isArray(coachProfile.profiles) ? coachProfile.profiles[0] : coachProfile.profiles) : null;
  const coachName = coachProfileRow?.full_name ?? 'Coach';

  if (status !== 'approved') {
    const coachProfileId = await resolveProfileIdForCoach(leaveRow.coach_id);
    const range = formatDateRange(leaveRow.starts_on, leaveRow.ends_on);
    await notifyProfile(coachProfileId, 'booking', 'Leave request declined', `Your leave request for ${range} was not approved.`, 'leave_rejected');
    return null;
  }

  return runLeaveApprovalCascade({
    coachId: leaveRow.coach_id,
    coachName,
    startsOn: leaveRow.starts_on,
    endsOn: leaveRow.ends_on,
    leaveType: leaveRow.leave_type,
    partialStartTime: leaveRow.partial_start_time,
    partialEndTime: leaveRow.partial_end_time,
    primarySpecialization: coachProfile?.specialization ?? null,
    primaryLanguages: coachProfile?.languages ?? [],
  });
}
