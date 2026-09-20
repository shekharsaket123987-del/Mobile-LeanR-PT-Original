/**
 * ProfileButton — the premium account control confirmed with the user in
 * place of the generic brief's role-switcher (§17 of the brief): this app
 * has one role per account (Supabase `profiles.role`, enforced by RLS and
 * the (client)/(coach)/(admin) layout gates — LEANR_PT_MOBILE_PRD.md §4),
 * so the control surfaces the signed-in user's real identity/role and
 * quick actions, never a fake switcher.
 *
 * A glass circular avatar button that opens a small anchored dropdown
 * (scale+fade in, ~180ms) with name, role badge, "View profile", "Sign
 * out". Self-contained: reads `useAuth()` directly so any screen can drop
 * it in with zero props.
 */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Motion, Radius } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { Avatar } from './avatar';
import { Badge } from './badge';
import { GlassPanel } from './glass-card';
import { MenuRow } from './menu-row';

const ROLE_LABEL: Record<string, string> = { client: 'Client', coach: 'Coach', admin: 'Admin' };

export function ProfileButton({ photoUrl }: { photoUrl?: string | null }) {
  const { profile, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(open ? 1 : 0, { duration: Motion.base, easing: Easing.out(Easing.cubic) });
  }, [open, progress]);

  const menuStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.9 + progress.value * 0.1 }, { translateY: (1 - progress.value) * -8 }],
  }));

  const close = () => setOpen(false);

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="Account menu"
        hitSlop={8}
        style={styles.trigger}>
        <Avatar photoUrl={photoUrl} name={profile?.full_name} size={36} />
      </Pressable>

      <Modal visible={open} transparent animationType="none" onRequestClose={close} statusBarTranslucent>
        <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close menu" accessibilityRole="button">
          <Animated.View style={[styles.menuWrap, { top: insets.top + 56, right: 16 }, menuStyle]}>
            <Pressable onPress={(e) => e.stopPropagation()}>
              <GlassPanel style={styles.panel}>
                <View style={styles.identityRow}>
                  <Avatar photoUrl={photoUrl} name={profile?.full_name} size={44} ring />
                  <View style={styles.identityText}>
                    <Text style={styles.name} numberOfLines={1}>
                      {profile?.full_name ?? 'Your account'}
                    </Text>
                    {profile?.role && <Badge label={ROLE_LABEL[profile.role] ?? profile.role} tone="yellow" />}
                  </View>
                </View>

                <View style={styles.divider} />

                <MenuRow
                  label="View profile"
                  icon="person-outline"
                  onPress={() => {
                    close();
                    router.push('/profile');
                  }}
                />
                <MenuRow
                  label="Sign out"
                  icon="log-out-outline"
                  destructive
                  last
                  onPress={() => {
                    close();
                    signOut();
                  }}
                />
              </GlassPanel>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  trigger: { borderRadius: 22 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)' },
  menuWrap: { position: 'absolute', width: 240 },
  panel: { borderRadius: Radius.lg, padding: 14, gap: 4 },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingBottom: 10 },
  identityText: { flexShrink: 1, gap: 6 },
  name: { fontFamily: 'Manrope_700Bold', fontSize: 15, color: '#FFFFFF' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.12)', marginBottom: 4 },
});
