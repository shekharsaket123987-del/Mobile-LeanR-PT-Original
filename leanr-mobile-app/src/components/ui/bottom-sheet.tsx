/**
 * BottomSheet — native-feeling modal sheet for reschedule/cancel/filter
 * flows, replacing raw `Alert.alert` confirmations where a richer flow is
 * warranted (transformation plan §"New design-system layer"). Slide-up +
 * fade backdrop on open, drag-down-to-dismiss gesture, glass panel body.
 * Requires `GestureHandlerRootView` at the app root (wired in app/_layout.tsx).
 */
import { PropsWithChildren, useEffect } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MaxContentWidth, Motion, Radius } from '@/constants/theme';
import { GlassPanel } from './glass-card';
import { IconButton } from './button';

type Props = PropsWithChildren<{
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
}>;

export function BottomSheet({ visible, onClose, title, subtitle, children }: Props) {
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(height);
  const backdropOpacity = useSharedValue(0);

  // Reanimated shared values are mutable-by-design UI-thread cells — they're
  // meant to be written from effects, event handlers, and gesture worklets
  // alike (the pattern every Reanimated animation in this codebase uses).
  // The React Compiler hooks-lint "immutability" rule doesn't model that and
  // flags it as if it were plain React state; disabled per-line rather than
  // restructuring away from the standard Reanimated API.
  useEffect(() => {
    if (visible) {
      translateY.value = withTiming(0, { duration: Motion.slow, easing: Easing.out(Easing.cubic) });
      backdropOpacity.value = withTiming(1, { duration: Motion.base });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const close = () => {
    // eslint-disable-next-line react-hooks/immutability -- Reanimated shared value, see comment above
    translateY.value = withTiming(height, { duration: Motion.base, easing: Easing.in(Easing.cubic) });
    // eslint-disable-next-line react-hooks/immutability -- Reanimated shared value, see comment above
    backdropOpacity.value = withTiming(0, { duration: Motion.base }, (done) => {
      if (done) runOnJS(onClose)();
    });
  };

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      // eslint-disable-next-line react-hooks/immutability
      if (e.translationY > 0) translateY.value = e.translationY;
    })
    .onEnd((e) => {
      if (e.translationY > 90 || e.velocityY > 800) {
        runOnJS(close)();
      } else {
        // eslint-disable-next-line react-hooks/immutability
        translateY.value = withTiming(0, { duration: Motion.fast });
      }
    });

  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={close} statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Close" accessibilityRole="button" />
        </Animated.View>

        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.sheetWrap, { paddingBottom: insets.bottom + 16 }, sheetStyle]}>
            <GlassPanel style={[styles.panel, { maxHeight: height * 0.82 }]} contentStyle={styles.panelContent}>
              <View style={styles.grabber} />
              {title && (
                <View style={styles.header}>
                  <View style={styles.titleCol}>
                    <Text style={styles.title}>{title}</Text>
                    {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
                  </View>
                  <IconButton accessibilityLabel="Close" onPress={close} size={32}>
                    <Text style={styles.closeGlyph}>✕</Text>
                  </IconButton>
                </View>
              )}
              <ScrollView style={styles.scrollArea} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                {children}
              </ScrollView>
            </GlassPanel>
          </Animated.View>
        </GestureDetector>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { backgroundColor: 'rgba(0,0,0,0.6)' },
  sheetWrap: { paddingHorizontal: 12, alignItems: 'center' },
  // Caps + centers the sheet on tablet/web-wide viewports instead of
  // stretching edge-to-edge; unchanged on phone-size screens.
  panel: { width: '100%', maxWidth: MaxContentWidth - 24, borderRadius: Radius.lg, paddingTop: 10 },
  // `content`'s default shrink-wrap sizing is overridden here (see
  // GlassCard's `contentStyle` doc comment) so this flex column actually
  // fills `panel`'s maxHeight-bounded height instead of growing past it —
  // required for `scrollArea` below to have a real bounded height to scroll
  // within rather than silently overflowing and getting clipped.
  panelContent: { flex: 1, minHeight: 0 },
  scrollArea: { flex: 1, minHeight: 0 },
  scrollContent: { paddingBottom: 4 },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    marginBottom: 12,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 },
  titleCol: { gap: 2, flexShrink: 1 },
  title: { fontFamily: 'Manrope_700Bold', fontSize: 17, color: '#FFFFFF' },
  subtitle: { fontFamily: 'Manrope_500Medium', fontSize: 13, color: 'rgba(255,255,255,0.55)' },
  closeGlyph: { color: '#FFFFFF', fontSize: 14 },
});
