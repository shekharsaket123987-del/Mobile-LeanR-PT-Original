/**
 * Admin Escalations — LEANR_PT_MOBILE_PRD.md §10 "Screen: Escalation
 * Detail (admin) — GATED WORKFLOW", §13 rule 22 ("no field on an
 * escalation can be edited until `called_client_at` is set"). Confirmed
 * against the real schema/RLS on 2026-08-19: `escalations_admin_all`/
 * `escalation_notes_admin_all` give admin full read/write, no
 * restrictions beyond `is_admin()`.
 *
 * Rule 22's call-gate is enforced client-side here (same UX as the web
 * app's `requireCalledClient()` guard, for a fast, friendly error) AND by
 * a DB trigger (`escalations_call_gate` / `escalation_notes_call_gate`,
 * see supabase/migrations/20260907120000_escalation_call_gate_trigger.sql)
 * that rejects the same mutations at the database layer — the real trust
 * boundary for a client that talks to Supabase directly, since there is
 * no server-action layer in front of it here.
 *
 * `admin_issue_type` is a free-text column (no DB constraint); `fault` is
 * free-text at the column level but DB CHECK-constrained to exactly 6
 * values. Both vocabularies are confirmed canonical (Gap Verification
 * Report, Area 9 — src/lib/constants/concern-categories.ts) — see
 * ISSUE_TYPE_OPTIONS/FAULT_OPTIONS in escalation/[id].tsx.
 */
import { supabase } from '@/lib/supabase/client';
import { notifyProfile, resolveProfileIdForClient } from './notify';
import type { EscalationStatus } from './concerns';

export type AdminEscalation = {
  id: string;
  reason: string;
  description: string | null;
  category: string | null;
  status: EscalationStatus;
  created_at: string;
  called_client_at: string | null;
  admin_issue_type: string | null;
  fault: string | null;
  admin_summary: string | null;
  resolution_notes: string | null;
  clientName: string | null;
  coachName: string | null;
};

export type EscalationNote = { id: string; note: string; created_at: string };

function pickName(rel: unknown): string | null {
  const row = Array.isArray(rel) ? rel[0] : rel;
  if (!row) return null;
  const profile = Array.isArray((row as { profiles?: unknown }).profiles)
    ? ((row as { profiles?: unknown[] }).profiles as { full_name?: string }[])[0]
    : ((row as { profiles?: { full_name?: string } }).profiles ?? null);
  return profile?.full_name ?? null;
}

export async function getAllEscalations(tab: 'active' | 'resolved'): Promise<AdminEscalation[]> {
  let query = supabase
    .from('escalations')
    .select(
      'id, reason, description, category, status, created_at, called_client_at, admin_issue_type, fault, admin_summary, resolution_notes, client_profiles(profiles(full_name)), coach_profiles(profiles(full_name))'
    )
    .order('created_at', { ascending: false });
  query = tab === 'active' ? query.neq('status', 'resolved') : query.eq('status', 'resolved');

  const { data, error } = await query;
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    reason: row.reason,
    description: row.description,
    category: row.category,
    status: row.status,
    created_at: row.created_at,
    called_client_at: row.called_client_at,
    admin_issue_type: row.admin_issue_type,
    fault: row.fault,
    admin_summary: row.admin_summary,
    resolution_notes: row.resolution_notes,
    clientName: pickName(row.client_profiles),
    coachName: pickName(row.coach_profiles),
  }));
}

export async function getEscalationById(id: string): Promise<AdminEscalation | null> {
  const { data, error } = await supabase
    .from('escalations')
    .select(
      'id, reason, description, category, status, created_at, called_client_at, admin_issue_type, fault, admin_summary, resolution_notes, client_profiles(profiles(full_name)), coach_profiles(profiles(full_name))'
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    reason: data.reason,
    description: data.description,
    category: data.category,
    status: data.status,
    created_at: data.created_at,
    called_client_at: data.called_client_at,
    admin_issue_type: data.admin_issue_type,
    fault: data.fault,
    admin_summary: data.admin_summary,
    resolution_notes: data.resolution_notes,
    clientName: pickName(data.client_profiles),
    coachName: pickName(data.coach_profiles),
  };
}

export async function getEscalationNotes(escalationId: string): Promise<EscalationNote[]> {
  const { data, error } = await supabase
    .from('escalation_notes')
    .select('id, note, created_at')
    .eq('escalation_id', escalationId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as EscalationNote[];
}

export async function confirmCalledClient(id: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const { error } = await supabase
    .from('escalations')
    .update({ called_client_at: new Date().toISOString(), called_by: userData.user?.id })
    .eq('id', id);
  if (error) throw error;
}

export async function updateEscalationAssessment(
  id: string,
  updates: { adminIssueType: string | null; fault: string | null; adminSummary: string | null }
): Promise<void> {
  const { error } = await supabase
    .from('escalations')
    .update({ admin_issue_type: updates.adminIssueType, fault: updates.fault, admin_summary: updates.adminSummary })
    .eq('id', id);
  if (error) throw error;
}

export async function addEscalationNote(escalationId: string, note: string): Promise<void> {
  const { error } = await supabase.from('escalation_notes').insert({ escalation_id: escalationId, note });
  if (error) throw error;
}

export async function markEscalationInProgress(id: string): Promise<void> {
  const { error } = await supabase.from('escalations').update({ status: 'in_progress' }).eq('id', id);
  if (error) throw error;
}

export async function resolveEscalation(id: string, resolutionNotes: string): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const { data: row, error: fetchError } = await supabase.from('escalations').select('client_id, reason').eq('id', id).single();
  if (fetchError) throw fetchError;

  const { error } = await supabase
    .from('escalations')
    .update({
      status: 'resolved',
      resolved_at: new Date().toISOString(),
      resolved_by: userData.user?.id,
      resolution_notes: resolutionNotes,
    })
    .eq('id', id);
  if (error) throw error;

  const clientProfileId = await resolveProfileIdForClient(row.client_id);
  await notifyProfile(clientProfileId, 'feedback', 'Your concern was resolved', `We resolved your concern (${row.reason}): ${resolutionNotes}`, 'escalation_resolved_client');
}
