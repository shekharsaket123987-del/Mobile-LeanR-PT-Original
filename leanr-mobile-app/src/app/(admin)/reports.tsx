/**
 * Reports (admin) — New PRD.md §4.C "Screen: Reports" — 5 fixed report
 * cards, each independently exportable. No server fetch on page load —
 * each export triggers its own generation on demand, same as web. Uses
 * React Native's built-in Share sheet (CSV text) instead of jsPDF/blob-
 * download, which are browser-only APIs with no mobile equivalent.
 */
import { useState } from 'react';
import { Share, StyleSheet, Text } from 'react-native';

import { LightGhostButton } from '@/components/light/light-button';
import { LightCard } from '@/components/light/light-card';
import { LightScreenScaffold } from '@/components/light/light-screen-scaffold';
import { LightBrand } from '@/constants/light-theme';
import {
  generateCancellationReportCsv,
  generateClientReportCsv,
  generateCoachReportCsv,
  generateMonthlyPtReportCsv,
  generateRevenueReportCsv,
} from '@/lib/data/admin-reports';
import { getErrorMessage } from '@/lib/data/errors';

const REPORTS: { key: string; title: string; description: string; generate: () => Promise<string> }[] = [
  { key: 'client', title: 'Client Report', description: 'All clients — plan, coach, sessions remaining/total', generate: generateClientReportCsv },
  { key: 'coach', title: 'Coach Report', description: 'All coaches — rating, review count, utilization', generate: generateCoachReportCsv },
  { key: 'monthly_pt', title: 'Monthly PT Report', description: 'Sessions, completion rate & assessments by month', generate: generateMonthlyPtReportCsv },
  { key: 'revenue', title: 'Revenue Report', description: 'Revenue & completed sessions by month', generate: generateRevenueReportCsv },
  { key: 'cancellation', title: 'Cancellation / No-Show Report', description: 'Cancelled and missed sessions', generate: generateCancellationReportCsv },
];

export default function AdminReportsScreen() {
  const [exportingKey, setExportingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onExport = async (key: string, title: string, generate: () => Promise<string>) => {
    setError(null);
    setExportingKey(key);
    try {
      const csv = await generate();
      await Share.share({ title, message: csv });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setExportingKey(null);
    }
  };

  return (
    <LightScreenScaffold title="Reports">
      {error && (
        <Text style={styles.errorText} accessibilityRole="alert">
          {error}
        </Text>
      )}
      {REPORTS.map((r) => (
        <LightCard key={r.key} style={styles.card}>
          <Text style={styles.title}>{r.title}</Text>
          <Text style={styles.description}>{r.description}</Text>
          <LightGhostButton size="sm" loading={exportingKey === r.key} onPress={() => onExport(r.key, r.title, r.generate)} style={styles.exportButton}>
            Export CSV
          </LightGhostButton>
        </LightCard>
      ))}
    </LightScreenScaffold>
  );
}

const styles = StyleSheet.create({
  card: { gap: 4 },
  title: { fontFamily: 'Manrope_700Bold', fontSize: 16, color: LightBrand.navy },
  description: { fontFamily: 'Manrope_500Medium', fontSize: 13, color: LightBrand.textSecondary },
  exportButton: { marginTop: 6, alignSelf: 'flex-start' },
  errorText: { fontFamily: 'Manrope_500Medium', fontSize: 13.5, color: LightBrand.alertRed },
});
