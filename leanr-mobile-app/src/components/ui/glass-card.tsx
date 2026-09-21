/**
 * GlassCard / GlassPanel — the LEANR mobile glass surface, reproducing the
 * web app's `.glass` / `.glass-strong` / `.glass-yellow` utilities
 * (LEANR_PT_MOBILE_PRD.md §23) with `expo-blur` + `expo-linear-gradient`
 * instead of CSS `backdrop-filter` (cross-platform; `expo-glass-effect` is
 * iOS-26-only and would look inconsistent on Android/older iOS).
 *
 * Used for: cards, hero surfaces, section containers. Not every surface —
 * plain `View`s with a flat `Brand.bgElevated` fill are still correct for
 * dense list rows (coach/admin screens) where glass would just be noise.
 */
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { PropsWithChildren } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

import { Brand, Glass, Radius, Shadow } from '@/constants/theme';

type Variant = 'default' | 'yellow' | 'strong';

type Props = PropsWithChildren<{
  variant?: Variant;
  style?: StyleProp<ViewStyle>;
  /** Disable the outer drop shadow — useful when nesting a GlassCard inside another one. */
  noShadow?: boolean;
  radius?: number;
  /**
   * Override the inner content wrapper's style — the default `content` style
   * (see below) shrink-wraps to its children, which is correct for ordinary
   * cards but breaks height-bounded scroll areas (e.g. a ScrollView inside a
   * maxHeight-capped panel): on web, a flex child with no explicit height
   * renders at its content's natural size instead of the parent's bounded
   * size, so the ScrollView never becomes scrollable — it just overflows and
   * gets clipped by `wrap`'s `overflow: hidden`. Pass `{ flex: 1, minHeight: 0 }`
   * from a bounded-height caller (see BottomSheet) to fix that.
   */
  contentStyle?: StyleProp<ViewStyle>;
}>;

// Flex-layout keys only — NOT box-model keys (margin/padding/width/etc).
// `style` is applied to `wrap` (below) for sizing/radius/shadow/position, but
// `wrap`'s only real (non-absolutely-positioned) child is `content`, so any
// flex-layout property meant to arrange GlassCard's actual children (gap,
// flexDirection for an icon+label row, etc.) was silently a no-op — `content`
// always rendered at its own hardcoded `{padding:16, gap:6}` regardless of
// what a call site passed. Re-applying just these keys to `content` fixes
// every call site's `style={{ flexDirection: 'row', gap: N }}` (etc.) without
// touching each of the ~70 call sites individually, and without risking
// double-application of box-model properties like padding/margin.
const LAYOUT_KEYS = ['flexDirection', 'alignItems', 'justifyContent', 'flexWrap', 'gap', 'rowGap', 'columnGap'] as const;

export function GlassCard({ children, variant = 'default', style, noShadow, radius = Radius.md, contentStyle }: Props) {
  const isYellow = variant === 'yellow';
  const gradientColors = isYellow ? Glass.gradientYellow : Glass.gradient;
  const borderColor = isYellow ? Glass.borderYellow : Glass.border;
  const intensity = variant === 'strong' ? Glass.blurIntensityStrong : Glass.blurIntensity;
  const flatStyle = StyleSheet.flatten(style) ?? {};
  const contentLayoutOverrides: ViewStyle = {};
  for (const key of LAYOUT_KEYS) {
    const value = flatStyle[key];
    if (value !== undefined) contentLayoutOverrides[key] = value as never;
  }

  return (
    <View style={[styles.wrap, { borderRadius: radius }, !noShadow && Shadow.card, style]}>
      <BlurView intensity={intensity} tint="dark" style={StyleSheet.absoluteFill} />
      <LinearGradient
        colors={gradientColors}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={[styles.border, { borderRadius: radius, borderColor }]} />
      <View style={[styles.content, contentLayoutOverrides, contentStyle]}>{children}</View>
    </View>
  );
}

/** Heavier-blur variant for modals/bottom sheets/prominent panels (web's `.glass-strong`). */
export function GlassPanel({
  children,
  style,
  radius = Radius.lg,
  contentStyle,
}: Omit<Props, 'variant' | 'noShadow'>) {
  return (
    <GlassCard variant="strong" style={style} radius={radius} contentStyle={contentStyle} noShadow>
      {children}
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    backgroundColor: Brand.bgElevated,
  },
  border: {
    ...StyleSheet.absoluteFill,
    borderWidth: StyleSheet.hairlineWidth * 1.5,
  },
  content: {
    padding: 16,
    gap: 6,
  },
});
