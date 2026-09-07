/**
 * Admin-action notifications — Gap Verification Report Area 6: on web,
 * every admin action listed there (leave, shadow assignment, coach change,
 * coach transfer, reschedule/cancel, pause/resume) fires an explicit
 * `notifyUser`/`notifyClient`/`notifyCoach` call in the mutating service
 * function itself — there is no DB trigger backing any of it (confirmed:
 * zero INSERT triggers on `notifications` in any migration). This file is
 * the mobile equivalent of that call site.
 *
 * `notifyProfile` mirrors web's `notifyUser()`, which "swallows ALL
 * errors" (per the report) so a failed notification insert can never
 * block or roll back the real mutation it's attached to — deliberately
 * NOT replicating the report's noted asymmetry where `notifyAdmins` does
 * NOT swallow errors and can halt a cascade partway through; that's
 * flagged in the report as an inconsistency in the web app, not a
 * behavior worth porting.
 *
 * `notifications.user_id` is `profiles.id` (the auth uid) — NEVER
 * `client_profiles.id`/`coach_profiles.id` (their own separate PKs, see
 * identity.ts's header). `resolveProfileIdForClient`/`ForCoach` do that
 * translation; callers must never pass a client/coach profile id directly.
 */
import { supabase } from '@/lib/supabase/client';
import type { NotificationType } from './notifications';

export async function resolveProfileIdForClient(clientProfileId: string): Promise<string | null> {
  const { data } = await supabase.from('client_profiles').select('profile_id').eq('id', clientProfileId).maybeSingle();
  return (data?.profile_id as string | undefined) ?? null;
}

export async function resolveProfileIdForCoach(coachProfileId: string): Promise<string | null> {
  const { data } = await supabase.from('coach_profiles').select('profile_id').eq('id', coachProfileId).maybeSingle();
  return (data?.profile_id as string | undefined) ?? null;
}

/** Batch form for fan-out notifications (e.g. every active client of a coach going on leave). */
export async function resolveProfileIdsForClients(clientProfileIds: string[]): Promise<Map<string, string>> {
  if (clientProfileIds.length === 0) return new Map();
  const { data, error } = await supabase.from('client_profiles').select('id, profile_id').in('id', clientProfileIds);
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.id as string, r.profile_id as string]));
}

/** Fire-and-forget insert — mirrors web's notifyUser(). No-ops if profileId is null (e.g. an unassigned coach slot). */
export async function notifyProfile(profileId: string | null, type: NotificationType, title: string, message: string, templateKey: string): Promise<void> {
  if (!profileId) return;
  try {
    const { error } = await supabase.from('notifications').insert({ user_id: profileId, type, title, message, template_key: templateKey });
    if (error) throw error;
  } catch {
    // swallow — matches web's notifyUser; a notification failure must never block the real action.
  }
}

/** Fans out to every admin profile (role='admin'). Fail-soft here (see file header) even though web's notifyAdmins isn't. */
export async function notifyAdmins(title: string, message: string, templateKey: string): Promise<void> {
  try {
    const { data: admins, error } = await supabase.from('profiles').select('id').eq('role', 'admin');
    if (error) throw error;
    if (!admins || admins.length === 0) return;

    const { error: insertError } = await supabase.from('notifications').insert(
      admins.map((a) => ({
        user_id: a.id,
        type: 'system' as const,
        title,
        message,
        template_key: templateKey,
      }))
    );
    if (insertError) throw insertError;
  } catch {
    // fail-soft — never mask a successful admin action behind a notification failure.
  }
}

function formatDateRange(startsOn: string, endsOn: string): string {
  return startsOn === endsOn ? startsOn : `${startsOn}–${endsOn}`;
}

export { formatDateRange };
