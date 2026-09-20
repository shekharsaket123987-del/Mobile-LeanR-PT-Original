/**
 * Home (Client) — dual-branch. Before any purchase: light "Your Demo is
 * Scheduled" hero (mockup's Home frames), reusing the same
 * `getUpcomingBookings`/`getMyCoach` data (a demo booking already surfaces
 * here structurally — `getUpcomingBookings` has no session-type filter).
 * After purchase: the Active Client Portal's own light Home (mockup frame
 * 9) — journey/streak card, Next Session card, Today's Tasks checklist.
 *
 * Today's Tasks (log water/meal plan/track workout) is shown
 * disabled/"coming soon": no diet/workout-plan or daily-task-tracking
 * feature exists anywhere in the schema or PRD, so nothing is wired behind
 * it — see the redesign plan's "unbacked mockup elements" decision. The
 * Journey card shows a real, PRD-backed streak-week count
 * (`computeWeekStreak`, same as the PRD's "sessions/streak/progress-since-
 * Day-1 summary" dashboard requirement) rather than a fabricated "Week N
 * of 24" — there's no program-length-in-weeks field anywhere to back that
 * denominator.
 */
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CelebrationOverlay } from '@/components/celebration-overlay';
import { RateSessionSheet } from '@/components/rate-session-sheet';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { IconButton, PrimaryButton, SecondaryButton } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { SectionHeader } from '@/components/ui/section-header';
import { StatCard } from '@/components/ui/stat-card';
import { TextLink } from '@/components/tappable';
import { Brand, DisplayFont } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { addToDeviceCalendar } from '@/lib/media/add-to-calendar';
import { getSessionsByStatus, getUpcomingBookings, markClientJoined, rateSession, sessionTypeLabel } from '@/lib/data/bookings';
import { getMyCoach } from '@/lib/data/coach';
import { getUnratedCompletedDemo } from '@/lib/data/demo-booking';
import { getClientJourneyStage, getClientJourneyState } from '@/lib/data/journey';
import { getMeasurementStatus } from '@/lib/data/measurement-status';
import { computeWeekStreak, milestoneHitAt } from '@/lib/data/milestones';
import { getPackageById } from '@/lib/data/plans';
import { getBaselineProgressLog, getProgressLogs } from '@/lib/data/progress';
import { getLatestSubscription, getMySubscription, getSessionsUsedCount } from '@/lib/data/subscription';
import type { Booking, Plan, ProgressLog } from '@/lib/data/types';
import { useAsync } from '@/lib/data/use-async';
import { getJoinState, openZoomLink } from '@/lib/data/zoom';
import { getErrorMessage } from '@/lib/data/errors';

/** web spec §2.5-adjacent, client's own request: how far before a session's start the Join affordance starts pulsing to grab attention. */
const JOIN_BLINK_WINDOW_MS = 5 * 60_000;

function formatCountdown(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}h : ${String(m).padStart(2, '0')}m : ${String(s).padStart(2, '0')}s`;
}

const LAST_CELEBRATED_KEY = 'leanr.lastCelebratedMilestone';

function formatSessionDay(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

function formatSessionTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatSessionDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Whole-day count from `startIso`'s calendar date through today's, both inclusive — "Day 1" on the day a plan is activated, "Day 2" the next day, etc. */
function dayOfJourney(startIso: string): number {
  const start = new Date(startIso);
  const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const now = new Date();
  const nowDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(1, Math.floor((nowDay - startDay) / 86_400_000) + 1);
}

/** Compact "Join in 2h 15m" countdown for the Next Session card — a coarser-grained sibling of `formatCountdown` above (minutes, not seconds; no colons), matching how far out an upcoming session actually needs to be signaled. */
function formatCompactCountdown(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

type ProgressMetricKey = 'weight' | 'body_fat_pct' | 'muscle_pct' | 'waist' | 'chest' | 'hip' | 'arms' | 'thigh';
const PROGRESS_METRICS: { key: ProgressMetricKey; label: string; unit: string }[] = [
  { key: 'weight', label: 'Weight', unit: 'kg' },
  { key: 'body_fat_pct', label: 'Body Fat %', unit: '%' },
  { key: 'muscle_pct', label: 'Muscle %', unit: '%' },
  { key: 'waist', label: 'Waist', unit: 'in' },
  { key: 'chest', label: 'Chest', unit: 'in' },
  { key: 'hip', label: 'Hip', unit: 'in' },
  { key: 'arms', label: 'Arms', unit: 'in' },
  { key: 'thigh', label: 'Thigh', unit: 'in' },
];

function formatMetricValue(value: number | null) {
  return value != null ? String(value) : '—';
}

/** "No change" when Day-1 baseline and latest are the same reading (typically because only the Day-1 entry exists yet) — a plain "+0.0" would misleadingly read as a fresh, unchanged-but-measured delta. */
function formatMetricDelta(latest: number | null, baseline: number | null, unit: string) {
  if (latest == null || baseline == null) return '—';
  const delta = latest - baseline;
  if (delta === 0) return 'No change';
  return `${delta > 0 ? '+' : ''}${delta.toFixed(1)} ${unit}`;
}

/**
 * Client's explicit request: a live countdown + a Join button that starts
 * pulsing in the last 5 minutes before start — scoped to the pre-purchase
 * demo card only (not the post-purchase EnrolledJoinRow below), so paid
 * clients' existing join experience is untouched by this ask.
 */
function DemoJoinRow({ booking }: { booking: Booking }) {
  const [now, setNow] = useState(() => Date.now());
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const state = getJoinState(booking);
  const msToStart = new Date(booking.scheduled_start).getTime() - now;
  const blinking = state === 'joinable' && msToStart <= JOIN_BLINK_WINDOW_MS;

  const opacity = useSharedValue(1);
  useEffect(() => {
    if (blinking) {
      opacity.value = withRepeat(withSequence(withTiming(0.35, { duration: 600 }), withTiming(1, { duration: 600 })), -1, true);
    } else {
      opacity.value = withTiming(1, { duration: 200 });
    }
  }, [blinking, opacity]);
  const blinkStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  const onJoin = async () => {
    setJoining(true);
    try {
      await markClientJoined(booking.id);
      await openZoomLink(booking);
    } catch (err) {
      Alert.alert('Could not join', getErrorMessage(err));
    } finally {
      setJoining(false);
    }
  };

  return (
    <View style={lightStyles.joinBlock}>
      {state !== 'ended' && (
        <Text style={lightStyles.countdownText}>{msToStart > 0 ? formatCountdown(msToStart) : 'Starting now'}</Text>
      )}
      {state === 'too-early' && <Text style={lightStyles.joinHint}>Join opens 5 min before start</Text>}
      {state === 'joinable' && (
        <Animated.View style={blinkStyle}>
          <PrimaryButton size="md" onPress={onJoin} loading={joining} style={lightStyles.joinButton}>
            {joining ? 'Starting…' : 'Join Now'}
          </PrimaryButton>
        </Animated.View>
      )}
    </View>
  );
}

function PrePurchaseHomeScreen() {
  const { session, profile } = useAuth();
  const { data, loading, error, reload } = useAsync(async () => {
    const [nextBookings, coach, journeyState, unratedDemo] = await Promise.all([
      getUpcomingBookings(1),
      getMyCoach(),
      getClientJourneyState(),
      getUnratedCompletedDemo(),
    ]);
    return { nextBookings, coach, journeyState, unratedDemo };
  }, []);
  const [addingToCalendar, setAddingToCalendar] = useState(false);
  const [feedbackDismissed, setFeedbackDismissed] = useState(false);

  useFocusEffect(
    useCallback(() => {
      reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const greetingName = profile?.full_name?.split(' ')[0] ?? session?.user.email?.split('@')[0] ?? 'there';
  const nextBooking = data?.nextBookings?.[0] ?? null;
  const coach = data?.coach ?? null;
  // web spec §2.6/§9.2-style single source of truth, plus the client's own rule: while a demo
  // is booked or its rating is still pending, neither "Book a Free Demo" nor "Choose Your Plan"
  // should be reachable anywhere — this dashboard is the primary surface for that gate.
  const stage = data?.journeyState?.stage ?? 'marketing';
  const unratedDemo = !feedbackDismissed ? (data?.unratedDemo ?? null) : null;

  const onAddToCalendar = async (booking: Booking) => {
    setAddingToCalendar(true);
    try {
      await addToDeviceCalendar({
        title: 'LEANR Demo Session',
        startDate: new Date(booking.scheduled_start),
        durationMinutes: booking.duration_minutes,
        notes: booking.zoom_join_url ?? undefined,
      });
      Alert.alert('Added', 'This session was added to your calendar.');
    } catch (err) {
      Alert.alert('Could not add to calendar', getErrorMessage(err));
    } finally {
      setAddingToCalendar(false);
    }
  };

  const onSubmitDemoFeedback = async (rating: { qualityRating: number; trainerRating: number; note: string }) => {
    if (!unratedDemo) return;
    await rateSession(unratedDemo.bookingId, rating);
    setFeedbackDismissed(true);
  };

  return (
    <View style={lightStyles.root}>
      <SafeAreaView style={lightStyles.flex} edges={['top']}>
        <View style={lightStyles.topBar}>
          <Text style={lightStyles.greeting}>Good Morning,{'\n'}{greetingName}!</Text>
          <IconButton accessibilityLabel="Notifications" onPress={() => router.push('/notifications')}>
            <Ionicons name="notifications-outline" size={19} color={'#FFFFFF'} />
          </IconButton>
        </View>

        <ScrollView contentContainerStyle={lightStyles.scroll}>
          {loading && <LoadingState />}
          {error && <ErrorState message={error} onRetry={reload} />}

          {!loading && !error && stage === 'demo_booked' && nextBooking && (
            <GlassCard style={lightStyles.heroCard}>
              <View style={lightStyles.notifyRow}>
                <Ionicons name="notifications" size={15} color={Brand.yellow} />
                <Text style={lightStyles.heroEyebrow}>YOUR DEMO IS COMING UP</Text>
              </View>
              <Text style={lightStyles.heroDate}>{formatSessionDateTime(nextBooking.scheduled_start)}</Text>
              <View style={lightStyles.modeRow}>
                <Ionicons name="videocam-outline" size={15} color={Brand.yellow} />
                <Text style={lightStyles.modeText}>Online (Zoom)</Text>
              </View>

              {coach && (
                <View style={lightStyles.coachRow}>
                  <Avatar photoUrl={coach.photo_url} name={nextBooking.coach_name ?? coach.full_name} size={40} />
                  <View>
                    <Text style={lightStyles.coachName}>{nextBooking.coach_name ?? coach.full_name}</Text>
                    {coach.rating != null && <Text style={lightStyles.coachMeta}>★ {coach.rating.toFixed(1)}</Text>}
                  </View>
                </View>
              )}

              <DemoJoinRow booking={nextBooking} />

              <SecondaryButton size="md" onPress={() => onAddToCalendar(nextBooking)} loading={addingToCalendar} style={lightStyles.calendarButton}>
                Add to Calendar
              </SecondaryButton>
              {coach && (
                <PrimaryButton size="md" onPress={() => router.push('/coach')} style={lightStyles.coachProfileButton}>
                  View Coach Profile
                </PrimaryButton>
              )}
            </GlassCard>
          )}

          {!loading && !error && stage === 'demo_completed' && unratedDemo && (
            <GlassCard style={lightStyles.heroCard}>
              <Text style={lightStyles.heroEyebrow}>HOW WAS YOUR DEMO?</Text>
              <Text style={lightStyles.modeText}>Rate your session to unlock choosing a plan — or skip for now.</Text>
            </GlassCard>
          )}

          {!loading && !error && stage === 'demo_completed' && !unratedDemo && (
            <PrimaryButton size="lg" onPress={() => router.push('/(client)/plans')}>
              Choose Your Plan
            </PrimaryButton>
          )}

          {!loading && !error && stage === 'marketing' && (
            <>
              <GlassCard>
                <EmptyState message="No demo booked yet." icon="calendar-outline" actionLabel="Book a Free Demo" onAction={() => router.push('/demo-booking')} />
              </GlassCard>
              <PrimaryButton size="lg" onPress={() => router.push('/(client)/plans')}>
                Choose Your Plan
              </PrimaryButton>
            </>
          )}
        </ScrollView>
      </SafeAreaView>

      <RateSessionSheet
        visible={!!unratedDemo}
        title={unratedDemo?.coachName ? `Rate your session with ${unratedDemo.coachName}` : 'Rate your demo session'}
        requireNote
        onClose={() => setFeedbackDismissed(true)}
        onSubmit={onSubmitDemoFeedback}
      />
    </View>
  );
}

const JOIN_LABEL: Record<ReturnType<typeof getJoinState>, string | null> = {
  'too-early': 'Join opens 5 min before start',
  joinable: 'Join session',
  ended: null,
};

function EnrolledJoinRow({ booking }: { booking: Booking }) {
  const state = getJoinState(booking);
  const label = JOIN_LABEL[state];
  const [joining, setJoining] = useState(false);
  if (!label) return null;

  const onJoin = async () => {
    setJoining(true);
    try {
      await markClientJoined(booking.id);
      await openZoomLink(booking);
    } catch (err) {
      Alert.alert('Could not join', getErrorMessage(err));
    } finally {
      setJoining(false);
    }
  };

  if (state !== 'joinable') {
    return <Text style={lightStyles.joinHint}>{label}</Text>;
  }

  return (
    <PrimaryButton size="md" onPress={onJoin} loading={joining} style={lightStyles.joinButton}>
      {joining ? 'Starting…' : label}
    </PrimaryButton>
  );
}

/** "Join in 2h 15m" line for the Next Session card — only while still too early to join; the Join button/hint below it already covers the joinable/ended states, so this doesn't duplicate them. Minute-grained (not per-second like `DemoJoinRow`'s countdown) since a session this far out doesn't need second-level urgency. */
function NextSessionCountdown({ booking }: { booking: Booking }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  if (getJoinState(booking) !== 'too-early') return null;
  const msToStart = new Date(booking.scheduled_start).getTime() - now;
  if (msToStart <= 0) return null;
  return <Text style={lightStyles.joinCountdownText}>Join in {formatCompactCountdown(msToStart)}</Text>;
}

function RecentSessionRow({ booking }: { booking: Booking }) {
  return (
    <View style={lightStyles.recentRow}>
      <View style={lightStyles.recentTextCol}>
        <Text style={lightStyles.recentDate}>{formatSessionDay(booking.scheduled_start)}</Text>
        <Text style={lightStyles.recentMeta}>
          {sessionTypeLabel(booking.session_type)} · {booking.coach_name ?? 'Coach'}
        </Text>
      </View>
      {booking.quality_rating != null && <Text style={lightStyles.recentRating}>★ {booking.quality_rating}</Text>}
    </View>
  );
}

function TodaysTasksCard() {
  const tasks = ['Log your water intake', 'Complete your meal plan', 'Track your workout'];
  return (
    <GlassCard>
      <View style={lightStyles.tasksHeader}>
        <Text style={lightStyles.tasksTitle}>Today&apos;s Tasks</Text>
        <Text style={lightStyles.comingSoonBadge}>Coming soon</Text>
      </View>
      {tasks.map((t) => (
        <View key={t} style={lightStyles.taskRow}>
          <Ionicons name="ellipse-outline" size={16} color={'rgba(255,255,255,0.45)'} />
          <Text style={lightStyles.taskText}>{t}</Text>
        </View>
      ))}
    </GlassCard>
  );
}

function EnrolledHomeScreen() {
  const { session, profile } = useAuth();
  const [gate, setGate] = useState<'checking' | 'clear'>('checking');

  useEffect(() => {
    let cancelled = false;
    // The journey stage — New PRD.md §4.A calls the web app's Dashboard "the
    // master gate": a client mid-funnel (pending activation, missing
    // onboarding, or a renewal that hasn't checked in / rescheduled yet)
    // must be routed there before this screen's normal widgets render, not
    // just left to fail against a client who hasn't finished the funnel.
    getClientJourneyStage()
      .then((stage) => {
        if (cancelled) return;
        switch (stage) {
          case 'awaiting_activation':
            router.replace('/activate');
            break;
          case 'onboarding':
            router.replace('/onboarding');
            break;
          case 'renewal_checkin':
            router.replace('/renewal-checkin');
            break;
          case 'renewal_scheduling':
            router.replace('/renewal-scheduling');
            break;
          case 'slot_selection':
            router.replace('/my-schedule');
            break;
          // AUTH-010 fix: a client whose subscription lapsed to paused/inactive with nothing
          // newer falls through to these marketing-equivalent stages (web spec §4.1 step 3) —
          // without this case, `HomeScreen`'s any-status `getLatestSubscription()` check still
          // mounts this Enrolled screen, and this switch's old `default: setGate('clear')`
          // left them stuck looking at full "active client" widgets against a dead plan.
          case 'marketing':
          case 'demo_booked':
          case 'demo_completed':
            router.replace('/plans');
            break;
          default:
            setGate('clear');
        }
      })
      .catch(() => {
        if (!cancelled) setGate('clear'); // fail open — never trap a client on a blank screen over a gate-check error
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const { data, loading, error, reload } = useAsync(async () => {
    const [nextBookings, subscription, coach, completedBookings, latestProgressLogs, baselineProgress, measurementStatus] = await Promise.all([
      getUpcomingBookings(1),
      getMySubscription(),
      getMyCoach(),
      getSessionsByStatus('completed'),
      getProgressLogs(1),
      getBaselineProgressLog(),
      getMeasurementStatus(),
    ]);
    const [pkg, sessionsUsed] = await Promise.all([
      subscription ? getPackageById(subscription.package_id) : Promise.resolve(null),
      subscription ? getSessionsUsedCount(subscription.id) : Promise.resolve(0),
    ]);
    return {
      nextBookings,
      subscription,
      coach,
      completedBookings,
      latestProgress: latestProgressLogs[0] ?? null,
      baselineProgress,
      measurementStatus,
      pkg,
      sessionsUsed,
    };
  }, []);
  const [milestone, setMilestone] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  const greetingName = profile?.full_name?.split(' ')[0] ?? session?.user.email?.split('@')[0] ?? 'there';
  const {
    nextBookings,
    subscription,
    coach,
    completedBookings,
    latestProgress,
    baselineProgress,
    measurementStatus,
    pkg,
    sessionsUsed,
  } = data ?? {
    nextBookings: [],
    subscription: null,
    coach: null,
    completedBookings: [] as Booking[],
    latestProgress: null as ProgressLog | null,
    baselineProgress: null as ProgressLog | null,
    measurementStatus: null,
    pkg: null as Plan | null,
    sessionsUsed: 0,
  };
  const nextBooking = nextBookings?.[0] ?? null;
  const streakWeeks = completedBookings ? computeWeekStreak(completedBookings) : 0;
  const sessionsLeft = subscription ? Math.max(subscription.sessions_total - (sessionsUsed ?? 0), 0) : 0;
  const packageProgressPct = subscription && subscription.sessions_total > 0 ? Math.round(((sessionsUsed ?? 0) / subscription.sessions_total) * 100) : 0;
  const journeyStartIso = subscription?.activated_at ?? subscription?.started_at ?? null;

  useEffect(() => {
    if (!completedBookings || completedBookings.length === 0) return;
    const hit = milestoneHitAt(completedBookings.length);
    if (!hit) return;

    AsyncStorage.getItem(LAST_CELEBRATED_KEY).then((lastRaw) => {
      const last = lastRaw ? Number(lastRaw) : 0;
      if (hit > last) {
        setMilestone(hit);
        AsyncStorage.setItem(LAST_CELEBRATED_KEY, String(hit));
      }
    });
  }, [completedBookings]);

  // On native, the launch splash screen covers this briefly. On web there's no
  // equivalent, so a bare `return null` here rendered as a genuinely blank/black
  // page for as long as the async journey-stage check took — looked identical
  // to a frozen app rather than a loading state.
  if (gate === 'checking') {
    return (
      <View style={lightStyles.root}>
        <SafeAreaView style={lightStyles.flex} edges={['top']}>
          <Text style={lightStyles.gateCheckingText}>Setting things up…</Text>
          <LoadingState />
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={lightStyles.root}>
      <SafeAreaView style={lightStyles.flex} edges={['top']}>
        <View style={lightStyles.topBar}>
          <View style={lightStyles.greetingCol}>
            <Text style={lightStyles.greeting}>Welcome back, {greetingName}</Text>
            {journeyStartIso && (
              <Text style={lightStyles.journeySubtitleText}>
                Day {dayOfJourney(journeyStartIso)} of your journey — here&apos;s where things stand today.
              </Text>
            )}
          </View>
          <IconButton accessibilityLabel="Notifications" onPress={() => router.push('/notifications')}>
            <Ionicons name="notifications-outline" size={19} color={'#FFFFFF'} />
          </IconButton>
        </View>

        <ScrollView contentContainerStyle={lightStyles.scroll}>
          {loading && <LoadingState />}
          {error && <ErrorState message={error} onRetry={reload} />}

          {!loading && !error && (
            <>
              {subscription && (
                <StatCard
                  emphasize
                  value={String(sessionsLeft)}
                  label="Sessions left"
                  trailing={
                    <View style={lightStyles.sessionsLeftMeta}>
                      <Text style={lightStyles.sessionsLeftPackage}>{pkg?.name ?? 'Your plan'}</Text>
                      <Text style={lightStyles.sessionsLeftUsage}>
                        {sessionsUsed ?? 0} of {subscription.sessions_total} sessions used
                      </Text>
                    </View>
                  }
                />
              )}

              {nextBooking ? (
                <GlassCard style={lightStyles.heroCard}>
                  <Text style={lightStyles.heroEyebrow}>NEXT UP</Text>
                  <Text style={lightStyles.heroDate}>{formatSessionDay(nextBooking.scheduled_start)}</Text>
                  <Text style={lightStyles.heroTime}>{formatSessionTime(nextBooking.scheduled_start)}</Text>

                  <View style={lightStyles.coachRow}>
                    <Avatar photoUrl={coach?.photo_url} name={nextBooking.coach_name ?? coach?.full_name} size={36} />
                    <View style={lightStyles.coachTextCol}>
                      <Text style={lightStyles.coachName} numberOfLines={1}>
                        {nextBooking.coach_name ?? coach?.full_name ?? 'your coach'}
                      </Text>
                      <Text style={lightStyles.sessionTypeText}>{sessionTypeLabel(nextBooking.session_type)}</Text>
                    </View>
                  </View>

                  <View style={lightStyles.tagRow}>
                    {coach?.specialization && <Badge label={coach.specialization} tone="yellow" />}
                    <View style={lightStyles.modeRow}>
                      <Ionicons name="videocam-outline" size={14} color={Brand.yellow} />
                      <Text style={lightStyles.modeText}>Live Video Session</Text>
                    </View>
                  </View>

                  <NextSessionCountdown booking={nextBooking} />
                  <EnrolledJoinRow booking={nextBooking} />
                </GlassCard>
              ) : (
                <GlassCard>
                  <EmptyState
                    message="No upcoming sessions booked yet."
                    icon="calendar-outline"
                    actionLabel="Manage my schedule"
                    onAction={() => router.push('/my-schedule')}
                  />
                </GlassCard>
              )}

              {subscription && (
                <View style={lightStyles.statGrid}>
                  <View style={lightStyles.statCell}>
                    <StatCard value={String(completedBookings?.length ?? 0)} label="Sessions Completed" />
                  </View>
                  <View style={lightStyles.statCell}>
                    <StatCard value={`${streakWeeks} wks`} label="Current Streak" />
                  </View>
                  <View style={lightStyles.statCell}>
                    <StatCard value={`${packageProgressPct}%`} label="Package Progress" />
                  </View>
                </View>
              )}

              {subscription && latestProgress && (
                <GlassCard>
                  <SectionHeader title="Progress Since Day 1" />
                  {PROGRESS_METRICS.map((m) => (
                    <View key={m.key} style={lightStyles.metricRow}>
                      <Text style={lightStyles.metricLabel}>{m.label}</Text>
                      <View style={lightStyles.metricValues}>
                        <Text style={lightStyles.metricValue}>{formatMetricValue(latestProgress[m.key])}</Text>
                        <Text style={lightStyles.metricDelta}>
                          {formatMetricDelta(latestProgress[m.key], baselineProgress?.[m.key] ?? null, m.unit)}
                        </Text>
                      </View>
                    </View>
                  ))}
                  {measurementStatus?.stale ? (
                    <TextLink onPress={() => router.push('/progress')} style={lightStyles.measurementUpdateLink}>
                      Update your measurements to keep this up to date.
                    </TextLink>
                  ) : (
                    <Text style={lightStyles.measurementFreshText}>
                      You&apos;re all set on this week&apos;s measurement update — nice work staying consistent.
                    </Text>
                  )}
                </GlassCard>
              )}

              {subscription && (
                <GlassCard>
                  <SectionHeader title="Recent Sessions" />
                  {completedBookings && completedBookings.length > 0 ? (
                    completedBookings.slice(0, 5).map((b) => <RecentSessionRow key={b.id} booking={b} />)
                  ) : (
                    <EmptyState message="No completed sessions yet." icon="time-outline" />
                  )}
                </GlassCard>
              )}

              <TodaysTasksCard />

              {/* GAP-10: subscribed clients manage sessions via the recurring schedule, not the
                  ad-hoc wizard — matches web spec §13's post-subscription route guard. */}
              <PrimaryButton size="lg" onPress={() => router.push(nextBooking ? '/sessions' : '/my-schedule')}>
                {nextBooking ? 'View sessions' : 'Manage my schedule'}
              </PrimaryButton>
            </>
          )}
        </ScrollView>
      </SafeAreaView>

      {milestone && (
        <CelebrationOverlay
          title={`${milestone} sessions! 🎉`}
          subtitle="Your consistency is showing — keep it up."
          onDismiss={() => setMilestone(null)}
        />
      )}
    </View>
  );
}

export default function HomeScreen() {
  const { data: subscription, loading } = useAsync(getLatestSubscription, []);
  if (loading) {
    return (
      <View style={lightStyles.root}>
        <SafeAreaView style={lightStyles.flex} edges={['top']}>
          <LoadingState />
        </SafeAreaView>
      </View>
    );
  }
  return subscription ? <EnrolledHomeScreen /> : <PrePurchaseHomeScreen />;
}

const lightStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Brand.bg },
  flex: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 8 },
  greetingCol: { flex: 1, gap: 4, paddingRight: 12 },
  greeting: { fontFamily: DisplayFont, fontWeight: '700', fontStyle: 'italic', fontSize: 28, color: '#FFFFFF', lineHeight: 32, letterSpacing: -0.3 },
  journeySubtitleText: { fontFamily: 'Manrope_500Medium', fontSize: 12.5, color: 'rgba(255,255,255,0.6)' },
  // paddingBottom clears the floating glass tab bar, same as ScreenScaffold's scrollContent.
  scroll: { flexGrow: 1, padding: 20, paddingTop: 16, paddingBottom: 120, gap: 16 },
  heroCard: { gap: 6, paddingVertical: 18 },
  heroEyebrow: { fontFamily: 'Manrope_700Bold', fontSize: 11.5, letterSpacing: 0.8, color: Brand.yellow },
  heroDate: { fontFamily: 'Manrope_800ExtraBold', fontSize: 18, color: '#FFFFFF' },
  heroTime: { fontFamily: DisplayFont, fontWeight: '700', fontStyle: 'italic', fontSize: 34, color: '#FFFFFF', letterSpacing: -0.5 },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  modeText: { fontFamily: 'Manrope_500Medium', fontSize: 13, color: 'rgba(255,255,255,0.6)' },
  coachRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  coachName: { fontFamily: 'Manrope_700Bold', fontSize: 14.5, color: '#FFFFFF', flexShrink: 1 },
  coachMeta: { fontFamily: 'Manrope_500Medium', fontSize: 12.5, color: 'rgba(255,255,255,0.6)' },
  calendarButton: { marginTop: 10 },
  coachProfileButton: { marginTop: 8 },
  joinHint: { fontFamily: 'Manrope_500Medium', fontSize: 13, color: 'rgba(255,255,255,0.45)', marginTop: 10 },
  gateCheckingText: {
    fontFamily: 'Manrope_500Medium',
    fontSize: 12.5,
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  joinButton: { marginTop: 10, alignSelf: 'flex-start' },
  notifyRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  joinBlock: { marginTop: 8 },
  countdownText: { fontFamily: 'Manrope_800ExtraBold', fontSize: 20, color: '#FFFFFF', letterSpacing: -0.3 },
  sessionsLeftMeta: { marginTop: 8, gap: 2 },
  sessionsLeftPackage: { fontFamily: 'Manrope_700Bold', fontSize: 13.5, color: Brand.yellow },
  sessionsLeftUsage: { fontFamily: 'Manrope_500Medium', fontSize: 12.5, color: 'rgba(255,255,255,0.6)' },
  coachTextCol: { flexShrink: 1 },
  sessionTypeText: { fontFamily: 'Manrope_500Medium', fontSize: 12, color: 'rgba(255,255,255,0.45)' },
  tagRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 6 },
  joinCountdownText: { fontFamily: 'Manrope_700Bold', fontSize: 13, color: Brand.yellow, marginTop: 8 },
  // flexBasis: 0 (not a percentage) so the gap is never double-counted against
  // the 100% width budget — the classic cause of an unwanted wrap on narrow phones.
  statGrid: { flexDirection: 'row', gap: 10 },
  statCell: { flex: 1, minWidth: 0 },
  metricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  metricLabel: { fontFamily: 'Manrope_500Medium', fontSize: 13.5, color: 'rgba(255,255,255,0.45)' },
  metricValues: { alignItems: 'flex-end' },
  metricValue: { fontFamily: 'Manrope_700Bold', fontSize: 14, color: '#FFFFFF' },
  metricDelta: { fontFamily: 'Manrope_500Medium', fontSize: 11.5, color: 'rgba(255,255,255,0.6)' },
  measurementFreshText: { fontFamily: 'Manrope_500Medium', fontSize: 12.5, color: Brand.yellow, marginTop: 10 },
  measurementUpdateLink: { marginTop: 10 },
  recentRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.1)',
  },
  recentTextCol: { gap: 2 },
  recentDate: { fontFamily: 'Manrope_700Bold', fontSize: 13.5, color: '#FFFFFF' },
  recentMeta: { fontFamily: 'Manrope_500Medium', fontSize: 12, color: 'rgba(255,255,255,0.45)' },
  recentRating: { fontFamily: 'Manrope_700Bold', fontSize: 13, color: Brand.yellow },
  tasksHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tasksTitle: { fontFamily: 'Manrope_700Bold', fontSize: 14.5, color: '#FFFFFF' },
  comingSoonBadge: { fontFamily: 'Manrope_600SemiBold', fontSize: 10.5, color: 'rgba(255,255,255,0.45)' },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  taskText: { fontFamily: 'Manrope_500Medium', fontSize: 13.5, color: 'rgba(255,255,255,0.45)' },
});
