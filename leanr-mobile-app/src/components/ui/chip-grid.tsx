/** ChipGrid — the wrap-row layout every Chip picker (date/time/day) reuses. */
import { PropsWithChildren } from 'react';
import { StyleSheet, View } from 'react-native';

import { Spacing } from '@/constants/theme';

export function ChipGrid({ children }: PropsWithChildren) {
  return <View style={styles.row}>{children}</View>;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.md, marginTop: Spacing.one },
});
