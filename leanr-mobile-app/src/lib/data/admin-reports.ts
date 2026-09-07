/**
 * Admin Reports — New PRD.md §4.C "Screen: Reports" — 5 fixed report
 * cards (Client, Coach, Monthly PT, Revenue, Cancellation/No-Show).
 * `jspdf`/CSV-blob-download (web-only, browser APIs) has no mobile
 * equivalent — this generates the same underlying data as CSV text and
 * hands it to React Native's built-in `Share` sheet (no new native
 * dependency required) rather than a fabricated download.
 *
 * Column sets for Client/Coach/Monthly PT/Revenue match the verified
 * web report definitions exactly (Gap Verification Report Area 8):
 * Client Report = Name/Phone/Status/Package/Coach/Sessions Remaining/
 * Sessions Total (reuses `listAdminClients` for consistency with the
 * Clients screen's own derived-status logic); Coach Report =
 * Name/Specialization/Status/Rating/Review Count/Active Clients/
 * Utilization — rating/review-count computed live from
 * `bookings.trainer_rating`, not the cached `coach_profiles.rating`/
 * `review_count` columns, matching this codebase's own §13 rule 21
 * discipline (see coach-performance.ts); Monthly PT Report =
 * Month/Total Sessions/Completed/Completion Rate/Assessment Sessions
 * (grouped by `scheduled_start`'s month, `session_type='assessment'`
 * identifies assessment bookings); Revenue Report = Month/Revenue/
 * Completed Sessions from `revenue_trend_view` (this is what an earlier
 * pass had mislabeled "Monthly PT Report" — the two were effectively
 * swapped relative to web). The former per-transaction `sales_view`
 * ledger under "Revenue Report" had no counterpart among web's 5 fixed
 * reports and was removed, not kept as a 6th option.
 */
import { supabase } from '@/lib/supabase/client';
import { listAdminClients } from './admin-clients';

function toCsv(headers: string[], rows: (string | number)[][]): string {
  const escape = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))].join('\n');
}

export async function generateClientReportCsv(): Promise<string> {
  const [clients, phoneRes] = await Promise.all([listAdminClients(), supabase.from('client_profiles').select('id, profiles(phone)')]);
  if (phoneRes.error) throw phoneRes.error;

  const phoneById = new Map(
    (phoneRes.data ?? []).map((row) => {
      const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
      return [row.id as string, p?.phone ?? ''];
    })
  );

  const rows = clients.map((c) => [
    c.full_name,
    phoneById.get(c.id) ?? '',
    c.derivedStatus,
    c.planName ?? '',
    c.coachName ?? '',
    c.sessionsTotal != null ? Math.max(c.sessionsTotal - (c.sessionsUsed ?? 0), 0) : '',
    c.sessionsTotal ?? '',
  ]);
  return toCsv(['Name', 'Phone', 'Status', 'Package', 'Coach', 'Sessions Remaining', 'Sessions Total'], rows);
}

export async function generateCoachReportCsv(): Promise<string> {
  const [coachesRes, utilRes, ratingsRes] = await Promise.all([
    supabase.from('coach_profiles').select('id, specialization, status, profiles(full_name)'),
    supabase.from('coach_utilization_view').select('coach_id, active_clients, utilization_pct'),
    supabase.from('bookings').select('coach_id, trainer_rating').not('trainer_rating', 'is', null),
  ]);
  if (coachesRes.error) throw coachesRes.error;
  if (utilRes.error) throw utilRes.error;
  if (ratingsRes.error) throw ratingsRes.error;

  const utilByCoach = new Map((utilRes.data ?? []).map((u) => [u.coach_id, u]));
  const ratingsByCoach = new Map<string, number[]>();
  for (const row of ratingsRes.data ?? []) {
    const list = ratingsByCoach.get(row.coach_id) ?? [];
    list.push(row.trainer_rating as number);
    ratingsByCoach.set(row.coach_id, list);
  }

  const rows = (coachesRes.data ?? []).map((row) => {
    const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    const util = utilByCoach.get(row.id as string);
    const ratings = ratingsByCoach.get(row.id as string) ?? [];
    const avgRating = ratings.length > 0 ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null;
    return [
      p?.full_name ?? '',
      row.specialization ?? '',
      row.status,
      avgRating != null ? avgRating.toFixed(1) : '',
      ratings.length,
      util?.active_clients ?? 0,
      util ? Number(util.utilization_pct).toFixed(0) + '%' : '',
    ];
  });
  return toCsv(['Name', 'Specialization', 'Status', 'Rating', 'Review Count', 'Active Clients', 'Utilization'], rows);
}

export async function generateMonthlyPtReportCsv(): Promise<string> {
  const { data, error } = await supabase.from('bookings').select('scheduled_start, status, session_type');
  if (error) throw error;

  const byMonth = new Map<string, { total: number; completed: number; assessment: number }>();
  for (const row of data ?? []) {
    const monthKey = new Date(row.scheduled_start).toISOString().slice(0, 7);
    const entry = byMonth.get(monthKey) ?? { total: 0, completed: 0, assessment: 0 };
    entry.total += 1;
    if (row.status === 'completed') entry.completed += 1;
    if (row.session_type === 'assessment') entry.assessment += 1;
    byMonth.set(monthKey, entry);
  }

  const rows = Array.from(byMonth.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, stats]) => {
      const label = new Date(`${monthKey}-01T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' });
      const completionRate = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;
      return [label, stats.total, stats.completed, `${completionRate}%`, stats.assessment];
    });
  return toCsv(['Month', 'Total Sessions', 'Completed', 'Completion Rate', 'Assessment Sessions'], rows);
}

export async function generateRevenueReportCsv(): Promise<string> {
  const { data, error } = await supabase.from('revenue_trend_view').select('month, revenue, sessions').order('month', { ascending: true });
  if (error) throw error;
  const rows = (data ?? []).map((row) => [
    new Date(row.month).toLocaleDateString(undefined, { month: 'short', year: 'numeric', timeZone: 'UTC' }),
    Number(row.revenue).toFixed(2),
    row.sessions,
  ]);
  return toCsv(['Month', 'Revenue (Rs.)', 'Completed Sessions'], rows);
}

export async function generateCancellationReportCsv(): Promise<string> {
  const { data, error } = await supabase
    .from('bookings')
    .select('scheduled_start, status, cancel_reason, no_show_party, client_profiles(profiles(full_name)), coach_profiles(profiles(full_name))')
    .in('status', ['cancelled', 'missed'])
    .order('scheduled_start', { ascending: false })
    .limit(500);
  if (error) throw error;
  const rows = (data ?? []).map((row) => {
    const cp = Array.isArray(row.client_profiles) ? row.client_profiles[0] : row.client_profiles;
    const clientP = cp ? (Array.isArray(cp.profiles) ? cp.profiles[0] : cp.profiles) : null;
    const cop = Array.isArray(row.coach_profiles) ? row.coach_profiles[0] : row.coach_profiles;
    const coachP = cop ? (Array.isArray(cop.profiles) ? cop.profiles[0] : cop.profiles) : null;
    return [new Date(row.scheduled_start).toISOString(), row.status, clientP?.full_name ?? '', coachP?.full_name ?? '', row.cancel_reason ?? '', row.no_show_party ?? ''];
  });
  return toCsv(['Scheduled Start', 'Status', 'Client', 'Coach', 'Cancel Reason', 'No-Show Party'], rows);
}
