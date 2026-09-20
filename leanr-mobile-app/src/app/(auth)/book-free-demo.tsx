/**
 * Book a Free Demo — now requires sign-in first (product decision: no more
 * anonymous lead capture). Reached only from CTAs that already check
 * `session` and send an unauthenticated visitor to /login instead — this
 * guard is the backstop for any other path (direct URL, deep link) into
 * this route. See `anonymous-demo-booking.ts` for why the actual booking
 * still needs its own privileged Edge Function rather than a direct
 * Supabase call.
 *
 * No hold->confirm two-step here (unlike the authenticated flow) —
 * `assessment_sessions` has no temporary-hold mechanism; the Edge
 * Function re-validates the slot is still free at confirm time instead
 * (see its own header comment for why best-effort is the right bar for
 * a pure lead-capture record).
 */
import { Redirect, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { PrimaryButton } from '@/components/ui/button';
import { CalendarGrid } from '@/components/ui/calendar-grid';
import { GlassCard } from '@/components/ui/glass-card';
import { Chip } from '@/components/ui/chip';
import { ChipGrid } from '@/components/ui/chip-grid';
import { ScreenScaffold } from '@/components/screen-scaffold';
import { SectionHeader } from '@/components/ui/section-header';
import { StatCard } from '@/components/ui/stat-card';
import { TextLink } from '@/components/tappable';
import { TextField } from '@/components/ui/text-field';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { Brand } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { setPendingBookDemoIntent } from '@/lib/auth/post-login-intent';
import { addIstDays, formatIstDateLabel, formatIstTimeLabel, todayIst, type IstDate } from '@/lib/data/booking-wizard';
import { confirmAnonymousDemoBooking, findAnonymousDemoSlots, type AnonymousDemoMatch } from '@/lib/data/anonymous-demo-booking';
import { getErrorMessage } from '@/lib/data/errors';

type Phase = 'pick' | 'details' | 'confirming' | 'success';

export default function BookFreeDemoScreen() {
  const { session } = useAuth();
  const [selectedDate, setSelectedDate] = useState<IstDate>(() => addIstDays(todayIst(), 1));
  const [match, setMatch] = useState<AnonymousDemoMatch | null>(null);
  const [matchLoading, setMatchLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('pick');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [result, setResult] = useState<{ coachName: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      setMatch(null);
      setSelectedSlot(null);
      setMatchLoading(true);
    });
    findAnonymousDemoSlots(selectedDate)
      .then((res) => {
        if (!cancelled) setMatch(res);
      })
      .catch((err) => {
        if (!cancelled) setActionError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setMatchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedDate]);

  // Backstop for a direct link straight into this route (bypassing the CTAs
  // that already set this before navigating here) — fire-and-forget is fine,
  // this always completes well before the visitor finishes logging in.
  useEffect(() => {
    if (!session) setPendingBookDemoIntent();
  }, [session]);

  if (!session) return <Redirect href="/login" />;

  const onPickSlot = (slotIso: string) => {
    setSelectedSlot(slotIso);
    setActionError(null);
    setPhase('details');
  };

  const onSubmit = async () => {
    if (!match?.coachId || !selectedSlot) return;
    setActionError(null);
    if (!name.trim()) {
      setActionError('Your name is required.');
      return;
    }
    if (!email.trim() && !phone.trim()) {
      setActionError('An email or phone number is required so we can reach you.');
      return;
    }
    setPhase('confirming');
    try {
      const res = await confirmAnonymousDemoBooking({
        prospectName: name.trim(),
        prospectEmail: email.trim() || undefined,
        prospectPhone: phone.trim() || undefined,
        coachId: match.coachId,
        slotStart: selectedSlot,
      });
      setResult({ coachName: res.coachName });
      setPhase('success');
    } catch (err) {
      setActionError(getErrorMessage(err));
      setPhase('details');
    }
  };

  if (phase === 'success') {
    return (
      <ScreenScaffold title="Demo booked!">
        <StatCard emphasize value={formatIstDateLabel(selectedDate)} label="ASSESSMENT CONFIRMED" />
        <GlassCard>
          {selectedSlot && <Text style={styles.cardLabel}>{formatIstTimeLabel(selectedSlot)}</Text>}
          {result && <Text style={styles.withCoach}>with {result.coachName}</Text>}
          <Text style={styles.successNote}>We&apos;ve noted your details — your coach will be in touch to confirm.</Text>
        </GlassCard>
        <PrimaryButton size="lg" onPress={() => router.replace('/login')}>
          Back to login
        </PrimaryButton>
      </ScreenScaffold>
    );
  }

  if (phase === 'details' || phase === 'confirming') {
    return (
      <ScreenScaffold title="Almost done" subtitle="Tell us how to reach you and we'll lock in your slot.">
        <GlassCard variant="yellow">
          <Text style={styles.cardLabel}>{formatIstDateLabel(selectedDate)}</Text>
          <Text style={styles.bigStat}>{selectedSlot ? formatIstTimeLabel(selectedSlot) : ''}</Text>
          {match?.coachName && <Text style={styles.withCoach}>with {match.coachName}</Text>}
        </GlassCard>

        <TextField icon="person-outline" placeholder="Your name" value={name} onChangeText={setName} />
        <TextField icon="mail-outline" placeholder="Email" autoCapitalize="none" keyboardType="email-address" value={email} onChangeText={setEmail} />
        <TextField icon="call-outline" placeholder="Phone (optional if email given)" keyboardType="phone-pad" value={phone} onChangeText={setPhone} />

        {actionError && (
          <Text style={styles.errorText} accessibilityRole="alert">
            {actionError}
          </Text>
        )}

        <PrimaryButton size="lg" onPress={onSubmit} loading={phase === 'confirming'}>
          Confirm free demo
        </PrimaryButton>
        <TextLink onPress={() => setPhase('pick')}>Pick a different slot</TextLink>
      </ScreenScaffold>
    );
  }

  return (
    <ScreenScaffold title="Book a Free Demo" subtitle="No account needed — we'll match you with an available coach.">
      <GlassCard>
        <SectionHeader eyebrow="Step 1" title="Pick a date" />
        <Text style={styles.selectedDateText}>{formatIstDateLabel(selectedDate)}</Text>
        <CalendarGrid selected={selectedDate} onSelect={setSelectedDate} minDate={addIstDays(todayIst(), 1)} initialMonth={selectedDate} />
      </GlassCard>

      <GlassCard>
        <SectionHeader eyebrow="Step 2" title="Available times" />
        {matchLoading && <LoadingState rows={1} />}
        {!matchLoading && !match?.coachId && <EmptyState message="No coaches have an opening this day — try another date." />}
        {!matchLoading && match?.coachId && (
          <>
            <Text style={styles.withCoach}>Matched with {match.coachName}</Text>
            <ChipGrid>
              {match.slots.map((s) => (
                <Chip key={s} label={formatIstTimeLabel(s)} selected={s === selectedSlot} onPress={() => onPickSlot(s)} />
              ))}
            </ChipGrid>
          </>
        )}
      </GlassCard>

      {actionError && (
        <Text style={styles.errorText} accessibilityRole="alert">
          {actionError}
        </Text>
      )}

      <TextLink onPress={() => router.replace('/login')} style={styles.link}>
        Already have an account? Log in instead
      </TextLink>
    </ScreenScaffold>
  );
}

const styles = StyleSheet.create({
  selectedDateText: { fontFamily: 'Manrope_700Bold', fontSize: 14, color: Brand.yellow, marginBottom: 4 },
  cardLabel: { fontFamily: 'Manrope_700Bold', fontSize: 12, letterSpacing: 0.8, color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase' },
  bigStat: { fontFamily: 'Manrope_800ExtraBold', fontSize: 30, color: '#FFFFFF' },
  withCoach: { fontFamily: 'Manrope_600SemiBold', fontSize: 13, color: 'rgba(255,255,255,0.6)' },
  errorText: { fontFamily: 'Manrope_500Medium', fontSize: 14, color: Brand.alertRed },
  link: { alignSelf: 'center', marginTop: 4 },
  successNote: { fontFamily: 'Manrope_500Medium', fontSize: 13, color: 'rgba(255,255,255,0.6)', marginTop: 4 },
});
