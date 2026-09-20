/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

import '@/global.css';

import { Platform } from 'react-native';

// LEANR by Fitelo brand tokens — source of truth: LEANR_PT_MOBILE_PRD.md §23
// (verified directly against the live web app's tailwind.config.ts /
// globals.css — the product is dark-only, no light-mode variant).
// Keep this object as the single place brand hex values live; never inline
// a brand hex in a component.
export const Brand = {
  black: '#000000',
  charcoal: '#111111',
  charcoal2: '#1A1A1A',
  bg: '#060606',
  bgElevated: '#0c0c0c',
  bgSoft: '#141414',
  yellow: '#F5D90A',
  yellow2: '#FFE94D',
  yellowDim: '#B8A400',
  pageBackground: '#060606',
  card: '#0c0c0c',
  streakEmberStart: '#FF7A18',
  streakEmberEnd: '#F5D90A',
  successEmerald: '#10B981',
  alertRed: '#EF4444',
  glowYellow: 'rgba(245, 217, 10, 0.35)',
} as const;

// Dark-only product — `light` intentionally mirrors `dark` so any code still
// branching on color scheme renders identically instead of falling back to
// a stale light theme. Do not reintroduce a real light palette without a
// separate product decision (see LEANR_PT_MOBILE_PRD.md §23).
const darkTheme = {
  text: '#ffffff',
  background: Brand.bg,
  backgroundElement: Brand.charcoal2,
  backgroundSelected: '#2E3135',
  textSecondary: 'rgba(255,255,255,0.6)',
  tint: Brand.yellow,
  tintText: Brand.black,
} as const;

export const Colors = {
  light: darkTheme,
  dark: darkTheme,
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

// Brand display font — Anton (single 400 weight; bold/italic are always
// applied together via fontStyle:'italic' + fontWeight:'700', synthesized
// on top of the one loaded weight, same as the web app's CSS-synthesized
// bold+italic. Loaded in app/_layout.tsx as `Anton_400Regular`.
export const DisplayFont = 'Anton_400Regular';

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
  // Named steps for the gaps that fall between the values above — already
  // the de-facto in-practice sizes across the app (icon/text gaps, row
  // padding, section spacing); named here so new code reuses them instead
  // of reinventing another raw number.
  xs: 6,
  sm: 10,
  md: 12,
  lg: 20,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

// Additive design-system tokens for the premium UI pass (LEANR_PT_MOBILE_PRD.md
// §23 "Shape & elevation" / "Glassmorphism system"). Nothing above this line
// is renamed or removed, so every existing import keeps working unchanged.

export const Radius = {
  sm: 12,
  md: 16, // cards, inputs — matches web `rounded-xl`
  lg: 20, // modals, glass panels — matches web `rounded-2xl`
  pill: 999, // buttons, badges, avatars, chips — matches web `rounded-full`
} as const;

/**
 * Cross-platform shadow presets matching the web app's `shadow-soft` /
 * `shadow-card` / `shadow-glow` tokens (tailwind.config.ts), expressed as
 * RN shadow* + Android `elevation`. Spread directly into a StyleSheet entry.
 */
export const Shadow = {
  soft: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 6,
  },
  card: {
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 4,
  },
  glow: {
    shadowColor: Brand.yellow,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 40,
    elevation: 10,
  },
} as const;

/** Purposeful, short motion only (LEANR_PT_NEXTGEN_APP_PRD.md §4.3) — never idle/looping decoration. */
export const Motion = {
  fast: 150,
  base: 220,
  slow: 320,
  ringFill: 700,
} as const;

/**
 * Glass surface recipe — reproduces the web app's `.glass` utility
 * (`linear-gradient(155deg, rgba(255,255,255,.07), rgba(255,255,255,.02))`
 * + `backdrop-filter: blur(20px)` + hairline border) using `expo-blur`
 * (cross-platform BlurView) rather than `expo-glass-effect`, which is
 * iOS-26-only "Liquid Glass" and would make the app look inconsistent
 * across devices — see components/ui/glass-card.tsx.
 */
export const Glass = {
  gradient: ['rgba(255,255,255,0.08)', 'rgba(255,255,255,0.015)'] as const,
  gradientYellow: ['rgba(245,217,10,0.16)', 'rgba(245,217,10,0.03)'] as const,
  border: 'rgba(255,255,255,0.09)',
  borderYellow: 'rgba(245,217,10,0.28)',
  blurIntensity: 40,
  blurIntensityStrong: 65,
} as const;
