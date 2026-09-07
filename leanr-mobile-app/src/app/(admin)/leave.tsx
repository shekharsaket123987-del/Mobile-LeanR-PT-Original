/**
 * Leave Requests (admin) — New PRD.md §4.C "Screen: Leave Requests".
 * Approve/Reject a coach's pending leave request. Approving a full-day
 * leave now runs the automatic shadow-coverage cascade (New PRD.md §3.15)
 * via `resolveLeaveRequest` — see admin-leave.ts / admin-shadow.ts. Any
 * occurrence the cascade can't cover is surfaced here and remains
 * reachable via the Shadow Coverage screen's manual "Assign shadow coach"
 * tool, the same fallback the web app itself provides for cases its own
 * cascade misses.
 */
import { useState } from 'react';
import { Alert, StyleSheet, Text } from 'react-native';

import { LightCard } from '@/components/light/light-card';
import { LightDestructiveButton, LightPrimaryButton } from '@/components/light/light-button';
import { LightScreenScaffold } from '@/components/light/light-screen-scaffold';
import { LightEmptyState, LightErrorState, LightLoadingState } from '@/components/light/light-states';
import { LightBrand } from '@/constants/light-theme';
import { getPendingLeaveRequests, resolveLeaveRequest, type AdminLeaveRequest } from '@/lib/data/admin-leave';
import { useAsync } from '@/lib/data/use-async';
import { getErrorMessage } from '@/lib/data/errors';

export default function AdminLeaveScreen() {
  const { data: requests, loading, error, reload } = useAsync(getPendingLeaveRequests, []);

  return (
    <LightScreenScaffold title="Leave Requests">
      {loading && <LightLoadingState />}
      {error && <LightErrorState message={error} onRetry={reload} />}
      {!loading && !error && (requests?.length ?? 0) === 0 && <LightEmptyState message="No pending leave requests." icon="checkmark-circle-outline" />}
      {!loading && !error && requests?.map((r) => <LeaveRow key={r.id} request={r} onResolved={reload} />)}
    </LightScreenScaffold>
  );
}

function LeaveRow({ request, onResolved }: { request: AdminLeaveRequest; onResolved: () => void }) {
  const [busy, setBusy] = useState<'approve' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onResolve = async (status: 'approved' | 'rejected') => {
    setBusy(status === 'approved' ? 'approve' : 'reject');
    setError(null);
    try {
      const outcome = await resolveLeaveRequest(request.id, status);
      if (outcome && (outcome.autoAssigned.length > 0 || outcome.needsManual.length > 0)) {
        const lines: string[] = [];
        if (outcome.autoAssigned.length > 0) {
          lines.push(
            'Auto-assigned:',
            ...outcome.autoAssigned.map((a) => `• ${a.clientName} → ${a.shadowCoachName}`)
          );
        }
        if (outcome.needsManual.length > 0) {
          if (lines.length > 0) lines.push('');
          lines.push(
            'Needs manual assignment (see Shadow Coverage):',
            ...outcome.needsManual.map((n) => `• ${n.clientName}`)
          );
        }
        Alert.alert('Shadow coverage', lines.join('\n'));
      }
      onResolved();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <LightCard style={styles.card}>
      <Text style={styles.name}>{request.coachName}</Text>
      <Text style={styles.dates}>
        {request.starts_on}
        {request.ends_on !== request.starts_on ? ` – ${request.ends_on}` : ''}
        {request.leave_type === 'partial' ? ` (${request.partial_start_time?.slice(0, 5)}–${request.partial_end_time?.slice(0, 5)})` : ' (full day)'}
      </Text>
      {request.reason && <Text style={styles.bodyText}>{request.reason}</Text>}
      {error && (
        <Text style={styles.errorText} accessibilityRole="alert">
          {error}
        </Text>
      )}
      <LightPrimaryButton onPress={() => onResolve('approved')} loading={busy === 'approve'} disabled={busy !== null} style={styles.approveButton}>
        Approve
      </LightPrimaryButton>
      <LightDestructiveButton onPress={() => onResolve('rejected')} loading={busy === 'reject'} disabled={busy !== null} style={styles.rejectButton}>
        Reject
      </LightDestructiveButton>
    </LightCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: 2 },
  name: { fontFamily: 'Manrope_800ExtraBold', fontSize: 17, color: LightBrand.navy },
  dates: { fontFamily: 'Manrope_600SemiBold', fontSize: 13, color: LightBrand.textSecondary, marginTop: 2 },
  bodyText: { fontFamily: 'Manrope_500Medium', fontSize: 14, color: LightBrand.textPrimary, marginTop: 4 },
  errorText: { fontFamily: 'Manrope_500Medium', fontSize: 13.5, color: LightBrand.alertRed, marginTop: 4 },
  approveButton: { marginTop: 10 },
  rejectButton: { marginTop: 8 },
});
