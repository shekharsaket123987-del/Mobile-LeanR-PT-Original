/**
 * Marketing Home/Landing — merges the mockup's "Public Landing Page" and
 * "Home (Not Logged In)" frames (near-identical content in both — hero +
 * "Why Choose LEANR" cards + primary CTAs), a deliberate simplification
 * noted in the redesign plan rather than building two near-duplicate
 * screens.
 */
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { ScreenScaffold } from '@/components/screen-scaffold';
import { GlassCard } from '@/components/ui/glass-card';
import { PrimaryButton, SecondaryButton } from '@/components/ui/button';
import { Brand, DisplayFont } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { setPendingBookDemoIntent } from '@/lib/auth/post-login-intent';

const WHY_CHOOSE: { icon: keyof typeof Ionicons.glyphMap; title: string }[] = [
  { icon: 'people-outline', title: 'Expert Coaches' },
  { icon: 'clipboard-outline', title: 'Personalized Plans' },
  { icon: 'trending-up-outline', title: 'Real Results' },
];

export default function MarketingHomeScreen() {
  const { session } = useAuth();
  const onBookFreeDemo = () => {
    if (session) {
      router.push('/book-free-demo');
      return;
    }
    setPendingBookDemoIntent().then(() => router.push('/login'));
  };

  return (
    <ScreenScaffold title="Get Expert Guidance" subtitle="Tailored to your goals — book a free demo with our certified coaches.">
      <LinearGradient colors={['#2A2600', Brand.bgElevated]} style={styles.heroCard} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
        <Ionicons name="fitness-outline" size={40} color={Brand.yellow} />
      </LinearGradient>

      <PrimaryButton size="lg" onPress={onBookFreeDemo}>
        Book a Free Demo
      </PrimaryButton>

      <Text style={styles.sectionTitle}>Why Choose LEANR?</Text>
      <View style={styles.grid}>
        {WHY_CHOOSE.map((item) => (
          <GlassCard key={item.title} style={styles.gridCard}>
            <Ionicons name={item.icon} size={24} color={Brand.yellow} />
            <Text style={styles.gridLabel}>{item.title}</Text>
          </GlassCard>
        ))}
      </View>

      <SecondaryButton size="lg" onPress={() => router.push('/(marketing)/plans')}>
        Explore Plans
      </SecondaryButton>

      <View style={styles.authRow}>
        <PrimaryButton size="md" onPress={() => router.push('/signup')} style={styles.authButton}>
          Sign Up
        </PrimaryButton>
        <SecondaryButton size="md" onPress={() => router.push('/login')} style={styles.authButton}>
          Login
        </SecondaryButton>
      </View>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  heroCard: { height: 140, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: { fontFamily: DisplayFont, fontWeight: '700', fontStyle: 'italic', fontSize: 20, color: '#FFFFFF', marginTop: 4 },
  grid: { flexDirection: 'row', gap: 10 },
  gridCard: { flex: 1, alignItems: 'center', gap: 8, paddingVertical: 18 },
  gridLabel: { fontFamily: 'Manrope_600SemiBold', fontSize: 12.5, color: '#FFFFFF', textAlign: 'center' },
  authRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  authButton: { flex: 1 },
});
