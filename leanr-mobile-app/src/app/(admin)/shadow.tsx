/**
 * Shadow Coverage (admin) — New PRD.md §4.C "Shadow Coach Required (gap
 * queue)" + "Assign Shadow Coach" flow. See src/lib/data/admin-shadow.ts
 * header for how "uncovered leave-affected sessions" is computed and for
 * the confirmed `assign_shadow_coach` RPC behavior (reassigns the
 * affected bookings directly, not just a record). Leave approval now
 * auto-assigns shadow coverage (New PRD.md §3.15); this screen remains the
 * manual fallback for whatever the auto-cascade couldn't cover, plus
 * emergency/undocumented absences that never went through Leave Requests.
 */
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { LightCard } from '@/components/light/light-card';
import { LightPrimaryButton } from '@/components/light/light-button';
import { LightChip, LightChipGrid } from '@/components/light/light-chip';
import { LightScreenScaffold } from '@/components/light/light-screen-scaffold';
import { LightSectionHeader } from '@/components/light/light-section-header';
import { LightEmptyState, LightErrorState, LightLoadingState } from '@/components/light/light-states';
import { LightBrand } from '@/constants/light-theme';
import { assignShadowCoach, getActiveCoachOptions, getShadowCoverageGaps, type ShadowGap } from '@/lib/data/admin-shadow';
import { useAsync } from '@/lib/data/use-async';
import { getErrorMessage } from '@/lib/data/errors';

export default function AdminShadowScreen() {
  const { data, loading, error, reload } = useAsync(async () => {
    const [gaps, coaches] = await Promise.all([getShadowCoverageGaps(), getActiveCoachOptions()]);
    return { gaps, coaches };
  }, []);

  const gaps = data?.gaps ?? [];
  const coaches = data?.coaches ?? [];

  return (
    <LightScreenScaffold title="Shadow Coverage" subtitle="Clients with sessions during approved leave, not yet covered">
      {loading && <LightLoadingState />}
      {error && <LightErrorState message={error} onRetry={reload} />}
      {!loading && !error && gaps.length === 0 && <LightEmptyState message="No coverage gaps right now." icon="shield-checkmark-outline" />}
      {!loading &&
        !error &&
        gaps.map((gap) => (
          <GapCard key={`${gap.leaveId}-${gap.clientId}`} gap={gap} coaches={coaches} onAssigned={reload} />
        ))}
    </LightScreenScaffold>
  );
}

function GapCard({
  gap,
  coaches,
  onAssigned,
}: {
  gap: ShadowGap;
  coaches: { id: string; full_name: string }[];
  onAssigned: () => void;
}) {
  const [selectedCoach, setSelectedCoach] = useState<string | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = coaches.filter((c) => c.id !== gap.primaryCoachId);

  const onAssign = async () => {
    if (!selectedCoach) return;
    setAssigning(true);
    setError(null);
    try {
      const shadowCoachName = candidates.find((c) => c.id === selectedCoach)?.full_name ?? 'Coach';
      await assignShadowCoach({
        clientId: gap.clientId,
        clientName: gap.clientName,
        primaryCoachId: gap.primaryCoachId,
        primaryCoachName: gap.primaryCoachName,
        shadowCoachId: selectedCoach,
        shadowCoachName,
        startsOn: gap.startsOn,
        endsOn: gap.endsOn,
        reason: `Coverage for ${gap.primaryCoachName}'s leave`,
      });
      onAssigned();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setAssigning(false);
    }
  };

  return (
    <LightCard style={styles.card}>
      <Text style={styles.name}>{gap.clientName}</Text>
      <Text style={styles.meta}>
        {gap.affectedSessions} session{gap.affectedSessions === 1 ? '' : 's'} with {gap.primaryCoachName}, {gap.startsOn}
        {gap.endsOn !== gap.startsOn ? ` – ${gap.endsOn}` : ''}
      </Text>

      <LightSectionHeader title="Assign shadow coach" />
      <LightChipGrid>
        {candidates.map((c) => (
          <LightChip key={c.id} label={c.full_name} selected={selectedCoach === c.id} onPress={() => setSelectedCoach(c.id)} />
        ))}
      </LightChipGrid>

      {error && (
        <Text style={styles.errorText} accessibilityRole="alert">
          {error}
        </Text>
      )}
      <LightPrimaryButton onPress={onAssign} loading={assigning} disabled={!selectedCoach} style={styles.assignButton}>
        Assign coverage
      </LightPrimaryButton>
    </LightCard>
  );
}

const styles = StyleSheet.create({
  card: { gap: 4 },
  name: { fontFamily: 'Manrope_800ExtraBold', fontSize: 17, color: LightBrand.navy },
  meta: { fontFamily: 'Manrope_500Medium', fontSize: 13.5, color: LightBrand.textSecondary },
  errorText: { fontFamily: 'Manrope_500Medium', fontSize: 13.5, color: LightBrand.alertRed, marginTop: 4 },
  assignButton: { marginTop: 8 },
});
