/**
 * Settings (admin) — New PRD.md §4.C "Screen: Settings" — Package Types
 * card (list + Edit/Delete per row, soft-delete only, "+ Add Package")
 * + Session Rules card (4 range-bound values — number fields here since
 * no native slider dependency exists in this app; same min/max/step
 * bounds as web's sliders, clamped on save).
 *
 * The "+ Add Package" modal now includes Features + Highlight, the last
 * 2 of the PRD's 8 documented fields (Name, Category, Sessions, Price,
 * Original Price, Default Pause-Days, Features, Highlight) — the data
 * layer already modeled both but no UI control previously existed to
 * set them. Delete now confirms first, using the PRD's exact copy
 * ("Clients with an active subscription on this package keep it.").
 */
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { LightBadge } from '@/components/light/light-badge';
import { LightGhostButton, LightPrimaryButton, LightSecondaryButton } from '@/components/light/light-button';
import { LightCard } from '@/components/light/light-card';
import { LightChip, LightChipGrid } from '@/components/light/light-chip';
import { LightScreenScaffold } from '@/components/light/light-screen-scaffold';
import { LightSectionHeader } from '@/components/light/light-section-header';
import { LightTextField } from '@/components/light/light-text-field';
import { LightEmptyState, LightErrorState, LightLoadingState } from '@/components/light/light-states';
import { LightBrand } from '@/constants/light-theme';
import {
  createPackage,
  deletePackage,
  getSessionRules,
  listAllPackages,
  saveSessionRules,
  updatePackage,
  type PackageInput,
  type PackageTier,
  type SessionRuleKey,
} from '@/lib/data/admin-settings';
import { getErrorMessage } from '@/lib/data/errors';
import { useAsync } from '@/lib/data/use-async';

const RULE_BOUNDS: Record<SessionRuleKey, { min: number; max: number; label: string }> = {
  default_session_duration_minutes: { min: 30, max: 90, label: 'Default Session Duration (min)' },
  cancellation_cutoff_hours: { min: 4, max: 48, label: 'Cancellation Cutoff (hours)' },
  reschedule_cutoff_hours: { min: 1, max: 24, label: 'Reschedule Cutoff (hours)' },
  inactivity_threshold_days: { min: 7, max: 90, label: 'Inactivity Threshold (days)' },
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

const emptyPackageForm = (): PackageInput => ({ name: '', category: 'addon', sessions_count: 12, price: 0, original_price: null, features: [], highlighted: false, default_pause_days: 0 });

export default function AdminSettingsScreen() {
  const { data: packages, loading: packagesLoading, error: packagesError, reload: reloadPackages } = useAsync(listAllPackages, []);
  const { data: rules, loading: rulesLoading, error: rulesError, reload: reloadRules } = useAsync(getSessionRules, []);

  const [editingPackage, setEditingPackage] = useState<PackageTier | 'new' | null>(null);
  const [form, setForm] = useState<PackageInput>(emptyPackageForm());
  const [featuresText, setFeaturesText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [ruleValues, setRuleValues] = useState<Record<SessionRuleKey, string> | null>(null);
  const [savingRules, setSavingRules] = useState(false);
  const [rulesSaved, setRulesSaved] = useState(false);

  const openEdit = (pkg: PackageTier | 'new') => {
    setError(null);
    setEditingPackage(pkg);
    setForm(
      pkg === 'new'
        ? emptyPackageForm()
        : { name: pkg.name, category: pkg.category, sessions_count: pkg.sessions_count, price: pkg.price, original_price: pkg.original_price, features: pkg.features, highlighted: pkg.highlighted, default_pause_days: pkg.default_pause_days ?? 0 }
    );
    setFeaturesText(pkg === 'new' ? '' : pkg.features.join(', '));
  };

  const onSavePackage = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload: PackageInput = {
        ...form,
        features: featuresText
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      };
      if (editingPackage === 'new') await createPackage(payload);
      else if (editingPackage) await updatePackage(editingPackage.id, payload);
      setEditingPackage(null);
      reloadPackages();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const onDeletePackage = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await deletePackage(id);
      reloadPackages();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const confirmDeletePackage = (id: string) => {
    Alert.alert('Delete package?', 'Clients with an active subscription on this package keep it.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDeletePackage(id) },
    ]);
  };

  const currentRuleValues: Record<SessionRuleKey, string> =
    ruleValues ?? (rules ? (Object.fromEntries(Object.entries(rules).map(([k, v]) => [k, String(v)])) as Record<SessionRuleKey, string>) : ({} as Record<SessionRuleKey, string>));

  const onSaveRules = async () => {
    setSavingRules(true);
    setRulesSaved(false);
    try {
      const bounded = Object.fromEntries(
        (Object.keys(RULE_BOUNDS) as SessionRuleKey[]).map((key) => {
          const bounds = RULE_BOUNDS[key];
          const raw = Number(currentRuleValues[key]) || bounds.min;
          return [key, clamp(raw, bounds.min, bounds.max)];
        })
      ) as Record<SessionRuleKey, number>;
      await saveSessionRules(bounded);
      setRulesSaved(true);
      reloadRules();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSavingRules(false);
    }
  };

  return (
    <LightScreenScaffold title="Settings">
      <LightSectionHeader title="Package Types" actionLabel={editingPackage === null ? '+ Add Package' : undefined} onAction={editingPackage === null ? () => openEdit('new') : undefined} />

      {packagesLoading && <LightLoadingState />}
      {packagesError && <LightErrorState message={packagesError} onRetry={reloadPackages} />}
      {!packagesLoading && !packagesError && packages?.length === 0 && <LightEmptyState message="No packages yet." icon="pricetags-outline" />}
      {!packagesLoading &&
        !packagesError &&
        editingPackage === null &&
        packages?.map((p) => (
          <LightCard key={p.id} style={styles.packageRow}>
            <View style={styles.packageInfo}>
              <View style={styles.packageHeader}>
                <Text style={styles.packageName}>{p.name}</Text>
                {!p.is_active && <LightBadge label="Inactive" tone="gray" />}
              </View>
              <Text style={styles.packageMeta}>
                {p.sessions_count} sessions · ₹{p.price} · {p.category}
              </Text>
            </View>
            <View style={styles.packageActions}>
              <LightGhostButton size="sm" onPress={() => openEdit(p)}>
                Edit
              </LightGhostButton>
              <LightGhostButton size="sm" onPress={() => confirmDeletePackage(p.id)} disabled={!p.is_active || busy}>
                Delete
              </LightGhostButton>
            </View>
          </LightCard>
        ))}

      {editingPackage !== null && (
        <LightCard style={styles.card}>
          <LightSectionHeader title={editingPackage === 'new' ? 'Add Package' : 'Edit Package'} />
          <LightTextField placeholder="Name" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} accessibilityLabel="Package name" />
          <LightChipGrid>
            <LightChip label="Advance" selected={form.category === 'advance'} onPress={() => setForm((f) => ({ ...f, category: 'advance' }))} />
            <LightChip label="Addon" selected={form.category === 'addon'} onPress={() => setForm((f) => ({ ...f, category: 'addon' }))} />
          </LightChipGrid>
          <LightTextField
            keyboardType="number-pad"
            placeholder="Sessions"
            value={String(form.sessions_count)}
            onChangeText={(v) => setForm((f) => ({ ...f, sessions_count: Number(v) || 0 }))}
            accessibilityLabel="Sessions count"
          />
          <LightTextField
            keyboardType="decimal-pad"
            placeholder="Price"
            value={String(form.price)}
            onChangeText={(v) => setForm((f) => ({ ...f, price: Number(v) || 0 }))}
            accessibilityLabel="Price"
          />
          <LightTextField
            keyboardType="decimal-pad"
            placeholder="Original Price (optional)"
            value={form.original_price != null ? String(form.original_price) : ''}
            onChangeText={(v) => setForm((f) => ({ ...f, original_price: v ? Number(v) : null }))}
            accessibilityLabel="Original price"
          />
          <LightTextField
            keyboardType="number-pad"
            placeholder="Default Pause Days"
            value={String(form.default_pause_days)}
            onChangeText={(v) => setForm((f) => ({ ...f, default_pause_days: Number(v) || 0 }))}
            accessibilityLabel="Default pause days"
          />
          <LightTextField
            placeholder="Features (comma-separated)"
            value={featuresText}
            onChangeText={setFeaturesText}
            multiline
            accessibilityLabel="Features"
          />
          <LightChipGrid>
            <LightChip label="Highlighted" selected={form.highlighted} onPress={() => setForm((f) => ({ ...f, highlighted: !f.highlighted }))} />
          </LightChipGrid>
          {error && <Text style={styles.errorText}>{error}</Text>}
          <View style={styles.editActions}>
            <LightSecondaryButton onPress={() => setEditingPackage(null)}>Cancel</LightSecondaryButton>
            <LightPrimaryButton loading={busy} disabled={!form.name.trim()} onPress={onSavePackage}>
              {editingPackage === 'new' ? 'Create Package' : 'Save Changes'}
            </LightPrimaryButton>
          </View>
        </LightCard>
      )}

      <LightSectionHeader title="Session Rules" />
      <LightCard style={styles.card}>
        {rulesLoading && <LightLoadingState rows={1} />}
        {rulesError && <LightErrorState message={rulesError} onRetry={reloadRules} />}
        {!rulesLoading &&
          !rulesError &&
          (Object.keys(RULE_BOUNDS) as SessionRuleKey[]).map((key) => (
            <LightTextField
              key={key}
              keyboardType="number-pad"
              placeholder={`${RULE_BOUNDS[key].label} (${RULE_BOUNDS[key].min}-${RULE_BOUNDS[key].max})`}
              value={currentRuleValues[key] ?? ''}
              onChangeText={(v) => setRuleValues({ ...currentRuleValues, [key]: v } as Record<SessionRuleKey, string>)}
              accessibilityLabel={RULE_BOUNDS[key].label}
            />
          ))}
        {rulesSaved && <Text style={styles.savedText}>Saved.</Text>}
        <LightPrimaryButton onPress={onSaveRules} loading={savingRules} style={styles.saveRulesButton}>
          Save Settings
        </LightPrimaryButton>
      </LightCard>
    </LightScreenScaffold>
  );
}

const styles = StyleSheet.create({
  card: { gap: 8 },
  packageRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  packageInfo: { flex: 1, gap: 2 },
  packageHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  packageName: { fontFamily: 'Manrope_700Bold', fontSize: 15, color: LightBrand.navy },
  packageMeta: { fontFamily: 'Manrope_600SemiBold', fontSize: 12.5, color: LightBrand.textSecondary },
  packageActions: { flexDirection: 'row', gap: 4 },
  editActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  errorText: { fontFamily: 'Manrope_500Medium', fontSize: 13, color: LightBrand.alertRed },
  savedText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13, color: LightBrand.successEmerald },
  saveRulesButton: { marginTop: 4 },
});
