/**
 * Client Detail (admin) — New PRD.md §4.C "Screen: Client Detail
 * (richest screen)". Manual Controls card: Adjust Sessions, Grant
 * Pause-Days, Transfer Coach, Assign Shadow Coach, Pause/Resume
 * Subscription, Log Measurement, Log Escalation, Log Refund Request.
 * Forms use the app's established "inline-toggled LightCard section"
 * convention (no light-themed bottom sheet exists anywhere in this app
 * — see build plan) — only one control panel open at a time.
 */
import { useLocalSearchParams, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { LightAvatar } from '@/components/light/light-avatar';
import { LightBadge } from '@/components/light/light-badge';
import { LightPrimaryButton, LightSecondaryButton, LightDestructiveButton } from '@/components/light/light-button';
import { LightCard } from '@/components/light/light-card';
import { LightChip, LightChipGrid } from '@/components/light/light-chip';
import { LightScreenScaffold } from '@/components/light/light-screen-scaffold';
import { LightSectionHeader } from '@/components/light/light-section-header';
import { LightSegmentedControl } from '@/components/light/light-segmented-control';
import { LightTextField } from '@/components/light/light-text-field';
import { LightEmptyState, LightErrorState, LightLoadingState } from '@/components/light/light-states';
import { LightBrand } from '@/constants/light-theme';
import { assignShadowCoach } from '@/lib/data/admin-shadow';
import {
  adjustClientSessions,
  getAdminClientDetail,
  getClientChatsForAdmin,
  getClientTimeline,
  grantPauseDays,
  listAdminCoachOptions,
  listEscalationsForClient,
  logEscalation,
  logMeasurement,
  logRefundRequest,
  pauseClientSubscription,
  resumeClientSubscription,
  transferClientCoach,
  type MeasurementInput,
} from '@/lib/data/admin-clients';
import type { DerivedClientStatus } from '@/lib/data/coach-clients';
import { getErrorMessage } from '@/lib/data/errors';
import { useAsync } from '@/lib/data/use-async';

const STATUS_TONE: Record<DerivedClientStatus, 'teal' | 'green' | 'red' | 'gray'> = {
  active: 'green',
  paused: 'teal',
  created: 'teal',
  expired: 'gray',
  demo: 'gray',
  not_paid: 'gray',
};
const STATUS_LABEL: Record<DerivedClientStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  created: 'Created',
  expired: 'Expired',
  demo: 'Demo',
  not_paid: 'Not Paid',
};

function formatDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

type Panel =
  | null
  | 'adjustSessions'
  | 'grantPauseDays'
  | 'transferCoach'
  | 'assignShadow'
  | 'logMeasurement'
  | 'logEscalation'
  | 'logRefund';
type Tab = 'overview' | 'timeline' | 'escalations' | 'chats' | 'sessions';

export default function AdminClientDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: client, loading, error, reload } = useAsync(() => getAdminClientDetail(id), [id]);
  const [tab, setTab] = useState<Tab>('overview');
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: coachOptions } = useAsync(listAdminCoachOptions, []);
  const { data: timeline } = useAsync(() => getClientTimeline(id), [id, tab]);
  const { data: escalations } = useAsync(() => listEscalationsForClient(id), [id, tab]);
  const { data: chatMessages } = useAsync(() => getClientChatsForAdmin(id), [id, tab]);

  const togglePanel = (p: Panel) => {
    setActionError(null);
    setPanel((cur) => (cur === p ? null : p));
  };

  const run = async (fn: () => Promise<void>) => {
    setActionError(null);
    setBusy(true);
    try {
      await fn();
      setPanel(null);
      reload();
    } catch (err) {
      setActionError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <LightScreenScaffold title="Client Details">
        <LightLoadingState />
      </LightScreenScaffold>
    );
  }
  if (error || !client) {
    return (
      <LightScreenScaffold title="Client Details">
        <LightErrorState message={error ?? 'Client not found.'} onRetry={reload} />
      </LightScreenScaffold>
    );
  }

  return (
    <LightScreenScaffold title="Client Details">
      <LightCard style={styles.headerCard}>
        <View style={styles.headerRow}>
          <LightAvatar photoUrl={client.photo_url} name={client.full_name} size={56} ring />
          <View style={styles.headerInfo}>
            <Text style={styles.name}>{client.full_name}</Text>
            <Text style={styles.code}>#{client.client_code}</Text>
          </View>
          <LightBadge label={STATUS_LABEL[client.derivedStatus]} tone={STATUS_TONE[client.derivedStatus]} />
        </View>
      </LightCard>

      <LightSegmentedControl
        options={[
          { key: 'overview', label: 'Overview' },
          { key: 'timeline', label: 'Timeline' },
          { key: 'escalations', label: 'Concerns' },
          { key: 'chats', label: 'Chats' },
          { key: 'sessions', label: 'Sessions' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'overview' && (
        <>
          <LightCard style={styles.card}>
            <LightSectionHeader title="Overview" />
            <Row label="Phone" value={client.phone ?? '—'} />
            <Row label="Plan" value={client.planName ?? '—'} />
            <Row label="Coach" value={client.coachName ?? '—'} />
            <Row label="Start Date" value={formatDate(client.startDate)} />
            <Row label="Slot" value={client.slotSummary ?? '—'} />
            {client.sessionsTotal != null && <Row label="Sessions Used" value={`${client.sessionsUsed ?? 0} / ${client.sessionsTotal}`} />}
            {client.pauseDaysAllowed != null && <Row label="Pause Days Allowed" value={String(client.pauseDaysAllowed)} />}
          </LightCard>

          <LightSectionHeader title="Manual Controls" />
          <LightCard style={styles.card}>
            <LightSecondaryButton onPress={() => togglePanel('adjustSessions')} disabled={!client.subscriptionId} style={styles.controlButton}>
              Adjust Package / Sessions
            </LightSecondaryButton>
            {panel === 'adjustSessions' && client.subscriptionId && (
              <AdjustSessionsPanel currentTotal={client.sessionsTotal ?? 0} busy={busy} error={actionError} onSubmit={(newTotal) => run(() => adjustClientSessions(client.subscriptionId!, newTotal))} />
            )}

            <LightSecondaryButton onPress={() => togglePanel('grantPauseDays')} disabled={!client.subscriptionId} style={styles.controlButton}>
              Grant Pause-Days
            </LightSecondaryButton>
            {panel === 'grantPauseDays' && client.subscriptionId && (
              <GrantPauseDaysPanel current={client.pauseDaysAllowed ?? 0} busy={busy} error={actionError} onSubmit={(next) => run(() => grantPauseDays(client.subscriptionId!, next))} />
            )}

            <LightSecondaryButton onPress={() => togglePanel('transferCoach')} disabled={!client.coachId} style={styles.controlButton}>
              Transfer to Another Coach
            </LightSecondaryButton>
            {panel === 'transferCoach' && (
              <TransferCoachPanel
                coachOptions={(coachOptions ?? []).filter((c) => c.id !== client.coachId)}
                busy={busy}
                error={actionError}
                onSubmit={(coachId, force) => run(() => transferClientCoach(id, coachId, force))}
              />
            )}

            <LightSecondaryButton onPress={() => togglePanel('assignShadow')} disabled={!client.coachId} style={styles.controlButton}>
              Assign Shadow Coach
            </LightSecondaryButton>
            {panel === 'assignShadow' && client.coachId && (
              <AssignShadowPanel
                coachOptions={(coachOptions ?? []).filter((c) => c.id !== client.coachId)}
                busy={busy}
                error={actionError}
                onSubmit={(shadowCoachId, startsOn, endsOn, reason) =>
                  run(() =>
                    assignShadowCoach({
                      clientId: id,
                      clientName: client.full_name,
                      primaryCoachId: client.coachId!,
                      primaryCoachName: client.coachName ?? 'Coach',
                      shadowCoachId,
                      shadowCoachName: (coachOptions ?? []).find((c) => c.id === shadowCoachId)?.full_name ?? 'Coach',
                      startsOn,
                      endsOn,
                      reason: reason || null,
                    })
                  )
                }
              />
            )}

            {client.subscriptionStatus === 'paused' ? (
              <LightSecondaryButton onPress={() => run(() => resumeClientSubscription(client.subscriptionId!))} disabled={!client.subscriptionId || busy} style={styles.controlButton}>
                Resume Subscription
              </LightSecondaryButton>
            ) : (
              <LightSecondaryButton onPress={() => run(() => pauseClientSubscription(client.subscriptionId!))} disabled={!client.subscriptionId || busy} style={styles.controlButton}>
                Pause Subscription
              </LightSecondaryButton>
            )}

            <LightSecondaryButton onPress={() => togglePanel('logMeasurement')} style={styles.controlButton}>
              Log Measurement
            </LightSecondaryButton>
            {panel === 'logMeasurement' && <LogMeasurementPanel busy={busy} error={actionError} onSubmit={(m) => run(() => logMeasurement(id, m))} />}

            <LightSecondaryButton onPress={() => togglePanel('logEscalation')} style={styles.controlButton}>
              Log Escalation
            </LightSecondaryButton>
            {panel === 'logEscalation' && (
              <LogEscalationPanel busy={busy} error={actionError} onSubmit={(reason, details) => run(() => logEscalation(id, client.coachId, reason, details))} />
            )}

            <LightDestructiveButton onPress={() => togglePanel('logRefund')} style={styles.controlButton}>
              Log Refund Request
            </LightDestructiveButton>
            {panel === 'logRefund' && <LogRefundPanel busy={busy} error={actionError} onSubmit={(amount, reason) => run(() => logRefundRequest(id, amount, reason))} />}
          </LightCard>
        </>
      )}

      {tab === 'timeline' && (
        <>
          {(timeline?.length ?? 0) === 0 && <LightEmptyState message="No activity logged yet." icon="time-outline" />}
          {timeline?.map((t) => (
            <LightCard key={t.id} style={styles.timelineCard}>
              <Text style={styles.timelineTitle}>{t.title}</Text>
              {t.description && <Text style={styles.timelineDesc}>{t.description}</Text>}
              <Text style={styles.timelineDate}>{formatDateTime(t.created_at)}</Text>
            </LightCard>
          ))}
        </>
      )}

      {tab === 'escalations' && (
        <>
          {(escalations?.length ?? 0) === 0 && <LightEmptyState message="No concerns raised." icon="checkmark-circle-outline" />}
          {escalations?.map((e) => (
            <Pressable
              key={e.id}
              onPress={() => router.push({ pathname: '/escalation/[id]', params: { id: e.id } })}
              accessibilityRole="button"
              accessibilityLabel={`Open escalation: ${e.reason}`}>
              <LightCard style={styles.timelineCard}>
                <View style={styles.escalationRow}>
                  <Text style={styles.timelineTitle}>{e.reason}</Text>
                  <LightBadge label={e.status.replace('_', ' ')} tone={e.status === 'resolved' ? 'green' : 'red'} />
                </View>
                <Text style={styles.timelineDate}>{formatDate(e.created_at)}</Text>
              </LightCard>
            </Pressable>
          ))}
        </>
      )}

      {tab === 'chats' && (
        <>
          <LightCard variant="teal" style={styles.timelineCard}>
            <Text style={styles.timelineDesc}>View-only — admin can see this conversation but never send messages.</Text>
          </LightCard>
          {(chatMessages?.length ?? 0) === 0 && <LightEmptyState message="No chat messages yet." icon="chatbubble-outline" />}
          {chatMessages?.map((m) => (
            <View key={m.id} style={[styles.chatBubble, m.sender_role === 'coach' ? styles.chatBubbleCoach : styles.chatBubbleClient]}>
              <Text style={styles.chatSender}>{m.sender_role === 'coach' ? 'Coach' : 'Client'}</Text>
              {m.body && <Text style={styles.chatBody}>{m.body}</Text>}
              <Text style={styles.timelineDate}>{formatDateTime(m.created_at)}</Text>
            </View>
          ))}
        </>
      )}

      {tab === 'sessions' && (
        <>
          {client.sessionHistory.length === 0 && <LightEmptyState message="No sessions yet." icon="calendar-outline" />}
          {client.sessionHistory.map((b) => (
            <LightCard key={b.id} style={styles.sessionRow}>
              <Text style={styles.timelineTitle}>{formatDateTime(b.scheduled_start)}</Text>
              <LightBadge label={b.status} tone={b.status === 'completed' ? 'green' : b.status === 'cancelled' ? 'red' : 'teal'} />
            </LightCard>
          ))}
        </>
      )}
    </LightScreenScaffold>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

function PanelError({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <Text style={styles.errorText} accessibilityRole="alert">
      {error}
    </Text>
  );
}

function AdjustSessionsPanel({ currentTotal, busy, error, onSubmit }: { currentTotal: number; busy: boolean; error: string | null; onSubmit: (n: number) => void }) {
  const [value, setValue] = useState(String(currentTotal));
  return (
    <View style={styles.panel}>
      <LightTextField keyboardType="number-pad" value={value} onChangeText={setValue} placeholder="New sessions total" accessibilityLabel="New sessions total" />
      <PanelError error={error} />
      <LightPrimaryButton loading={busy} onPress={() => onSubmit(Number(value) || 0)}>
        Save
      </LightPrimaryButton>
    </View>
  );
}

function GrantPauseDaysPanel({ current, busy, error, onSubmit }: { current: number; busy: boolean; error: string | null; onSubmit: (n: number) => void }) {
  const [value, setValue] = useState(String(current));
  return (
    <View style={styles.panel}>
      <LightTextField keyboardType="number-pad" value={value} onChangeText={setValue} placeholder="New pause-days allowed" accessibilityLabel="New pause-days allowed" />
      <PanelError error={error} />
      <LightPrimaryButton loading={busy} onPress={() => onSubmit(Number(value) || 0)}>
        Save
      </LightPrimaryButton>
    </View>
  );
}

function TransferCoachPanel({
  coachOptions,
  busy,
  error,
  onSubmit,
}: {
  coachOptions: { id: string; full_name: string }[];
  busy: boolean;
  error: string | null;
  onSubmit: (coachId: string, force: boolean) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const offerForce = Boolean(error);
  return (
    <View style={styles.panel}>
      <LightChipGrid>
        {coachOptions.map((c) => (
          <LightChip key={c.id} label={c.full_name} selected={selected === c.id} onPress={() => setSelected(c.id)} />
        ))}
      </LightChipGrid>
      <PanelError error={error} />
      <LightPrimaryButton loading={busy} disabled={!selected} onPress={() => selected && onSubmit(selected, false)}>
        Transfer
      </LightPrimaryButton>
      {offerForce && selected && (
        <LightSecondaryButton loading={busy} onPress={() => onSubmit(selected, true)}>
          Transfer Anyway
        </LightSecondaryButton>
      )}
    </View>
  );
}

function AssignShadowPanel({
  coachOptions,
  busy,
  error,
  onSubmit,
}: {
  coachOptions: { id: string; full_name: string }[];
  busy: boolean;
  error: string | null;
  onSubmit: (shadowCoachId: string, startsOn: string, endsOn: string, reason: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [selected, setSelected] = useState<string | null>(null);
  const [startsOn, setStartsOn] = useState(today);
  const [endsOn, setEndsOn] = useState(today);
  const [reason, setReason] = useState('');
  return (
    <View style={styles.panel}>
      <LightChipGrid>
        {coachOptions.map((c) => (
          <LightChip key={c.id} label={c.full_name} selected={selected === c.id} onPress={() => setSelected(c.id)} />
        ))}
      </LightChipGrid>
      <LightTextField placeholder="From (YYYY-MM-DD)" value={startsOn} onChangeText={setStartsOn} accessibilityLabel="From date" />
      <LightTextField placeholder="To (YYYY-MM-DD)" value={endsOn} onChangeText={setEndsOn} accessibilityLabel="To date" />
      <LightTextField placeholder="Reason (optional)" value={reason} onChangeText={setReason} accessibilityLabel="Reason" />
      <PanelError error={error} />
      <LightPrimaryButton loading={busy} disabled={!selected} onPress={() => selected && onSubmit(selected, startsOn, endsOn, reason)}>
        Assign Coverage
      </LightPrimaryButton>
    </View>
  );
}

const MEASUREMENT_FIELDS: { key: keyof MeasurementInput; label: string }[] = [
  { key: 'weight', label: 'Weight (kg)' },
  { key: 'body_fat_pct', label: 'Body Fat %' },
  { key: 'muscle_pct', label: 'Muscle %' },
  { key: 'waist', label: 'Waist' },
  { key: 'chest', label: 'Chest' },
  { key: 'hip', label: 'Hip' },
  { key: 'arms', label: 'Arms' },
  { key: 'thigh', label: 'Thigh' },
];

function LogMeasurementPanel({ busy, error, onSubmit }: { busy: boolean; error: string | null; onSubmit: (m: MeasurementInput) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  return (
    <View style={styles.panel}>
      {MEASUREMENT_FIELDS.map((f) => (
        <LightTextField
          key={f.key}
          keyboardType="decimal-pad"
          placeholder={f.label}
          value={values[f.key] ?? ''}
          onChangeText={(t) => setValues((v) => ({ ...v, [f.key]: t }))}
          accessibilityLabel={f.label}
        />
      ))}
      <PanelError error={error} />
      <LightPrimaryButton
        loading={busy}
        onPress={() => {
          const input: MeasurementInput = {};
          for (const f of MEASUREMENT_FIELDS) {
            const raw = values[f.key];
            if (raw) (input as Record<string, number>)[f.key] = Number(raw);
          }
          onSubmit(input);
        }}>
        Save Measurement
      </LightPrimaryButton>
    </View>
  );
}

function LogEscalationPanel({ busy, error, onSubmit }: { busy: boolean; error: string | null; onSubmit: (reason: string, details: string | null) => void }) {
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  return (
    <View style={styles.panel}>
      <LightTextField placeholder="Reason" value={reason} onChangeText={setReason} accessibilityLabel="Reason" />
      <LightTextField placeholder="Details (optional)" value={details} onChangeText={setDetails} multiline style={styles.multiline} accessibilityLabel="Details" />
      <PanelError error={error} />
      <LightPrimaryButton loading={busy} disabled={!reason.trim()} onPress={() => onSubmit(reason.trim(), details.trim() || null)}>
        Log Escalation
      </LightPrimaryButton>
    </View>
  );
}

function LogRefundPanel({ busy, error, onSubmit }: { busy: boolean; error: string | null; onSubmit: (amount: number, reason: string) => void }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  return (
    <View style={styles.panel}>
      <LightCard variant="teal" style={styles.timelineCard}>
        <Text style={styles.timelineDesc}>
          This platform has no payment gateway yet — this logs a refund request to the audit trail for finance to action manually; it does not move money.
        </Text>
      </LightCard>
      <LightTextField keyboardType="decimal-pad" placeholder="Amount (₹)" value={amount} onChangeText={setAmount} accessibilityLabel="Refund amount" />
      <LightTextField placeholder="Reason" value={reason} onChangeText={setReason} accessibilityLabel="Refund reason" />
      <PanelError error={error} />
      <LightDestructiveButton loading={busy} disabled={!amount || !reason.trim()} onPress={() => onSubmit(Number(amount) || 0, reason.trim())}>
        Log Refund Request
      </LightDestructiveButton>
    </View>
  );
}

const styles = StyleSheet.create({
  headerCard: { gap: 4 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  headerInfo: { flex: 1, gap: 2 },
  name: { fontFamily: 'Manrope_800ExtraBold', fontSize: 18, color: LightBrand.navy },
  code: { fontFamily: 'Manrope_500Medium', fontSize: 12.5, color: LightBrand.textMuted },
  card: { gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  rowLabel: { fontFamily: 'Manrope_500Medium', fontSize: 13.5, color: LightBrand.textMuted },
  rowValue: { fontFamily: 'Manrope_700Bold', fontSize: 13.5, color: LightBrand.navy, maxWidth: '60%' },
  controlButton: { marginTop: 8 },
  panel: { gap: 8, marginTop: 8, marginBottom: 4 },
  multiline: { minHeight: 60, textAlignVertical: 'top' },
  errorText: { fontFamily: 'Manrope_500Medium', fontSize: 13, color: LightBrand.alertRed },
  timelineCard: { gap: 2 },
  timelineTitle: { fontFamily: 'Manrope_700Bold', fontSize: 14.5, color: LightBrand.navy },
  timelineDesc: { fontFamily: 'Manrope_500Medium', fontSize: 13, color: LightBrand.textSecondary },
  timelineDate: { fontFamily: 'Manrope_500Medium', fontSize: 11.5, color: LightBrand.textMuted, marginTop: 2 },
  escalationRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chatBubble: { padding: 12, borderRadius: 14, maxWidth: '85%', gap: 2 },
  chatBubbleClient: { backgroundColor: LightBrand.card, borderWidth: 1, borderColor: LightBrand.border, alignSelf: 'flex-start' },
  chatBubbleCoach: { backgroundColor: LightBrand.tealSoft, alignSelf: 'flex-end' },
  chatSender: { fontFamily: 'Manrope_700Bold', fontSize: 11, color: LightBrand.textMuted },
  chatBody: { fontFamily: 'Manrope_500Medium', fontSize: 14, color: LightBrand.textPrimary },
  sessionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
});
