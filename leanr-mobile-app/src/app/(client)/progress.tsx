/**
 * Progress — LEANR_PT_NEXTGEN_APP_PRD.md §9.3 / New PRD.md §4.A
 * `/client/progress`, wired to real `progress_logs` data. Relit for the
 * post-purchase light theme (mockup frame 13): a real weight-trend chart
 * (`LightMeasurementChart`, new — no charting library existed anywhere in
 * this app before this pass) plus metric/range filter chips.
 *
 * The mockup's Measurements/Photos segmented control is reproduced, but
 * "Photos" is shown disabled: `progress-photos` is a real Storage bucket
 * in the schema, but "schema-only, never referenced by any application
 * code" per New PRD.md §15 — no photo-progress feature exists even on
 * web, so wiring an upload here would be inventing functionality that
 * doesn't exist in the web app.
 *
 * Purchase-gated (mockup poster's "NOT Available Until Plan Purchase" list
 * explicitly includes Progress/Measurements): not linked from the demo-only
 * More menu (`more.tsx`'s `PRE_PURCHASE_ROWS`), but this screen previously
 * had no in-screen guard of its own — every other gated screen (Book a
 * Session, Chat, Session History) defends in depth with BOTH nav-hiding AND
 * a `hasEverPurchased` check here, so a demo-only client reaching this
 * route directly (deep link, future internal link) could log measurements
 * with no plan. Mirrors `book-session.tsx`'s exact gate treatment.
 */
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { LightChip, LightChipGrid } from '@/components/light/light-chip';
import { LightCard } from '@/components/light/light-card';
import { LightPrimaryButton } from '@/components/light/light-button';
import { LightMeasurementChart, type ChartPoint } from '@/components/light/light-measurement-chart';
import { LightScreenScaffold } from '@/components/light/light-screen-scaffold';
import { LightSectionHeader } from '@/components/light/light-section-header';
import { LightSegmentedControl } from '@/components/light/light-segmented-control';
import { LightTextField } from '@/components/light/light-text-field';
import { LightEmptyState, LightErrorState, LightLoadingState } from '@/components/light/light-states';
import { LightBrand } from '@/constants/light-theme';
import { DisplayFont } from '@/constants/theme';
import { getProgressLogs, logProgress } from '@/lib/data/progress';
import { getLatestSubscription } from '@/lib/data/subscription';
import type { ProgressLog } from '@/lib/data/types';
import { useAsync } from '@/lib/data/use-async';
import { getErrorMessage } from '@/lib/data/errors';

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatMonth(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short' });
}

function toNumber(v: string): number | undefined {
  if (!v.trim()) return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

type Metric = 'weight' | 'body_fat_pct' | 'muscle_pct' | 'waist';
const METRICS: { key: Metric; label: string; unit: string }[] = [
  { key: 'weight', label: 'Weight', unit: 'kg' },
  { key: 'body_fat_pct', label: 'Body Fat', unit: '%' },
  { key: 'muscle_pct', label: 'Muscle', unit: '%' },
  { key: 'waist', label: 'Waist', unit: 'cm' },
];

type RangeKey = '3m' | '6m' | 'all';
const RANGES: { key: RangeKey; label: string; months: number | null }[] = [
  { key: '3m', label: 'Last 3 Months', months: 3 },
  { key: '6m', label: 'Last 6 Months', months: 6 },
  { key: 'all', label: 'All', months: null },
];

export default function ProgressScreen() {
  const { data: subscription, loading: subscriptionLoading } = useAsync(getLatestSubscription, []);
  const { data: logs, loading, error, reload } = useAsync(getProgressLogs, []);
  const [tab, setTab] = useState<'measurements' | 'photos'>('measurements');
  const [metric, setMetric] = useState<Metric>('weight');
  const [range, setRange] = useState<RangeKey>('3m');

  const [weight, setWeight] = useState('');
  const [bodyFat, setBodyFat] = useState('');
  const [muscle, setMuscle] = useState('');
  const [waist, setWaist] = useState('');
  const [chest, setChest] = useState('');
  const [hip, setHip] = useState('');
  const [arms, setArms] = useState('');
  const [thigh, setThigh] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const latest = logs?.[0] ?? null;
  const previous = logs?.[1] ?? null;
  const delta =
    latest && previous && latest[metric] != null && previous[metric] != null ? (latest[metric] as number) - (previous[metric] as number) : null;

  const chartPoints: ChartPoint[] = useMemo(() => {
    if (!logs || logs.length === 0) return [];
    const rangeMonths = RANGES.find((r) => r.key === range)?.months ?? null;
    // Anchored to the latest log's own timestamp rather than Date.now() —
    // keeps this computation a pure function of `logs`/`range` alone.
    const anchor = new Date(logs[0].logged_at).getTime();
    const cutoff = rangeMonths ? anchor - rangeMonths * 30 * 24 * 60 * 60 * 1000 : null;
    const chronological = [...logs].reverse().filter((l: ProgressLog) => (cutoff ? new Date(l.logged_at).getTime() >= cutoff : true));
    return chronological
      .filter((l) => l[metric] != null)
      .map((l) => ({ label: formatMonth(l.logged_at), value: l[metric] as number }));
  }, [logs, metric, range]);

  const onSubmit = async () => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      await logProgress({
        weight: toNumber(weight),
        bodyFatPct: toNumber(bodyFat),
        musclePct: toNumber(muscle),
        waist: toNumber(waist),
        chest: toNumber(chest),
        hip: toNumber(hip),
        arms: toNumber(arms),
        thigh: toNumber(thigh),
      });
      setWeight('');
      setBodyFat('');
      setMuscle('');
      setWaist('');
      setChest('');
      setHip('');
      setArms('');
      setThigh('');
      reload();
    } catch (err) {
      setSubmitError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const unit = METRICS.find((m) => m.key === metric)?.unit ?? '';

  if (!subscriptionLoading && !subscription) {
    return (
      <LightScreenScaffold title="Progress">
        <LightEmptyState message="You need an active plan before you can log progress." icon="lock-closed-outline" />
        <LightPrimaryButton size="lg" onPress={() => router.push('/plans')}>
          View plans
        </LightPrimaryButton>
      </LightScreenScaffold>
    );
  }

  return (
    <LightScreenScaffold title="Progress">
      <LightSegmentedControl
        options={[
          { key: 'measurements', label: 'Measurements' },
          { key: 'photos', label: 'Photos (soon)' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {loading && <LightLoadingState />}
      {error && <LightErrorState message={error} onRetry={reload} />}

      {!loading && !error && tab === 'photos' && (
        <LightCard>
          <LightEmptyState message="Progress photos aren't available yet — coming soon." icon="camera-outline" />
        </LightCard>
      )}

      {!loading && !error && tab === 'measurements' && (
        <>
          <LightChipGrid>
            {METRICS.map((m) => (
              <LightChip key={m.key} label={m.label} selected={metric === m.key} onPress={() => setMetric(m.key)} />
            ))}
          </LightChipGrid>
          <LightChipGrid>
            {RANGES.map((r) => (
              <LightChip key={r.key} label={r.label} selected={range === r.key} onPress={() => setRange(r.key)} />
            ))}
          </LightChipGrid>

          {latest ? (
            <LightCard>
              {delta != null && (
                <Text style={[styles.deltaValue, delta < 0 ? styles.deltaDown : styles.deltaUp]}>
                  {delta > 0 ? '+' : ''}
                  {delta.toFixed(1)} {unit}
                </Text>
              )}
              {chartPoints.length >= 2 ? (
                <LightMeasurementChart points={chartPoints} />
              ) : (
                <LightEmptyState message="Log a couple more weeks to see your trend." icon="trending-up-outline" />
              )}
              <View style={styles.latestRow}>
                <Text style={styles.latestLabel}>Latest Measurement</Text>
                <Text style={styles.latestValue}>
                  {formatDate(latest.logged_at)} · {latest[metric] ?? '—'} {unit}
                </Text>
              </View>
            </LightCard>
          ) : (
            <LightEmptyState message="No progress logged yet." icon="trending-up-outline" />
          )}

          <LightCard>
            <LightSectionHeader eyebrow="Weekly check-in" title="Log this week" />
            <LightTextField placeholder="Weight (kg)" keyboardType="numeric" value={weight} onChangeText={setWeight} />
            <LightTextField placeholder="Body fat %" keyboardType="numeric" value={bodyFat} onChangeText={setBodyFat} />
            <LightTextField placeholder="Muscle %" keyboardType="numeric" value={muscle} onChangeText={setMuscle} />
            <LightTextField placeholder="Waist (cm)" keyboardType="numeric" value={waist} onChangeText={setWaist} />
            <LightTextField placeholder="Chest (cm)" keyboardType="numeric" value={chest} onChangeText={setChest} />
            <LightTextField placeholder="Hip (cm)" keyboardType="numeric" value={hip} onChangeText={setHip} />
            <LightTextField placeholder="Arms (cm)" keyboardType="numeric" value={arms} onChangeText={setArms} />
            <LightTextField placeholder="Thigh (cm)" keyboardType="numeric" value={thigh} onChangeText={setThigh} />
          </LightCard>

          {submitError && (
            <Text style={styles.errorText} accessibilityRole="alert">
              {submitError}
            </Text>
          )}

          <LightPrimaryButton size="lg" onPress={onSubmit} loading={submitting}>
            Log New Measurement
          </LightPrimaryButton>
        </>
      )}
    </LightScreenScaffold>
  );
}

const styles = StyleSheet.create({
  deltaValue: { fontFamily: DisplayFont, fontWeight: '700', fontStyle: 'italic', fontSize: 30, letterSpacing: -0.5 },
  deltaDown: { color: LightBrand.teal },
  deltaUp: { color: LightBrand.amber },
  latestRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  latestLabel: { fontFamily: 'Manrope_500Medium', fontSize: 12.5, color: LightBrand.textMuted },
  latestValue: { fontFamily: 'Manrope_700Bold', fontSize: 13, color: LightBrand.navy },
  errorText: { fontFamily: 'Manrope_500Medium', fontSize: 14, color: LightBrand.alertRed },
});
