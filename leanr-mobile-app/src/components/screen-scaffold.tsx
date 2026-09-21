/**
 * Shared shell for screens that haven't yet received a fully bespoke
 * layout (LEANR_PT_NEXTGEN_APP_PRD.md §4.2 for the title treatment) —
 * brand background with a soft top glow, safe area, scroll container.
 * `Card`/`LoadingState`/`ErrorState`/`EmptyState` now delegate to the
 * premium components/ui/* primitives so every screen still importing
 * this file gets the upgraded look with zero call-site changes; `styles`
 * keeps every key screens already reference (`shared.cardLabel`,
 * `shared.bigStat`, `shared.ctaButton`, ...) so nothing breaks mid-migration.
 */
import { PropsWithChildren } from 'react';
import { ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Brand, Colors, DisplayFont, MaxContentWidth, Radius, Shadow } from '@/constants/theme';
import { GlassCard } from '@/components/ui/glass-card';
import { EmptyState as UiEmptyState, ErrorState as UiErrorState, LoadingState as UiLoadingState } from '@/components/ui/states';

type Props = PropsWithChildren<{ title: string; subtitle?: string }>;

export function ScreenScaffold({ title, subtitle, children }: Props) {
  const scheme = useColorScheme();
  const colors = Colors[scheme === 'light' ? 'light' : 'dark'];

  return (
    <View style={[styles.root, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={['rgba(245,217,10,0.06)', 'rgba(245,217,10,0)']}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
        style={styles.topGlow}
        pointerEvents="none"
      />
      <SafeAreaView style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.scrollOuter}>
          {/* Capped + centered on wide viewports (tablet/web) so content never
              stretches edge-to-edge; identical to the old unbounded layout on
              phone-width screens since maxWidth only bites above MaxContentWidth. */}
          <View style={styles.scrollContent}>
            <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
            {subtitle && <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text>}
            {children}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

export function Card({ children }: PropsWithChildren) {
  return <GlassCard>{children}</GlassCard>;
}

/** Delegates to components/ui/states.tsx — kept here so ~30 existing screens keep working unchanged. */
export const LoadingState = UiLoadingState;
export const ErrorState = UiErrorState;
export const EmptyState = UiEmptyState;

export const styles = StyleSheet.create({
  root: { flex: 1 },
  topGlow: { position: 'absolute', top: 0, left: 0, right: 0, height: 260 },
  safeArea: { flex: 1 },
  scrollOuter: { alignItems: 'center' },
  // paddingBottom clears the floating glass tab bar (components/ui/floating-tab-bar.tsx: ~60px bar + 10px float margin + safe-area inset).
  scrollContent: { width: '100%', maxWidth: MaxContentWidth, padding: 20, gap: 16, paddingBottom: 120 },
  title: {
    fontFamily: DisplayFont,
    fontWeight: '700',
    fontStyle: 'italic',
    fontSize: 28,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 15,
    marginTop: -8,
  },
  card: {
    borderRadius: 20,
    padding: 16,
    gap: 6,
  },
  cardLabel: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 12,
    letterSpacing: 0.8,
    opacity: 0.55,
    textTransform: 'uppercase',
  },
  bigStat: {
    fontFamily: DisplayFont,
    fontWeight: '700',
    fontStyle: 'italic',
    fontSize: 40,
    color: Brand.yellow,
    letterSpacing: -0.5,
  },
  ctaButton: {
    backgroundColor: Brand.yellow,
    borderRadius: Radius.pill,
    paddingVertical: 16,
    alignItems: 'center',
    ...Shadow.glow,
  },
  ctaButtonText: {
    fontFamily: 'Manrope_700Bold',
    fontSize: 15,
    color: Brand.black,
  },
  centeredState: { paddingVertical: 32, alignItems: 'center' },
  errorText: { fontFamily: 'Manrope_500Medium', fontSize: 14, color: Brand.alertRed },
  retryLinkWrap: { alignSelf: 'flex-start', marginTop: 4 },
  retryLink: { fontFamily: 'Manrope_700Bold', fontSize: 14, color: Brand.yellow },
  emptyText: { fontFamily: 'Manrope_500Medium', fontSize: 14, opacity: 0.6 },
});
