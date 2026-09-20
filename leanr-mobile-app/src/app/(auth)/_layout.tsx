/**
 * Auth group — LEANR_PT_NEXTGEN_APP_PRD.md §25 "unified Login screen".
 * If a session already exists, route straight to that role's home via
 * getHomeRouteForRole — same role-branch used by (client)/(coach) layouts,
 * kept in one place (src/lib/auth/role-routing.ts).
 */
import { Redirect, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import type { Href } from 'expo-router';

import { Brand } from '@/constants/theme';
import { useAuth } from '@/lib/auth/auth-context';
import { getHomeRouteForRole } from '@/lib/auth/role-routing';
import { consumePendingBookDemoIntent } from '@/lib/auth/post-login-intent';

export default function AuthLayout() {
  const { session, profile, loading, recoveryInProgress, signupPhoneStepInProgress } = useAuth();
  const [postLoginHref, setPostLoginHref] = useState<Href | null>(null);

  // A visitor who was sent here by a "Book a Free Demo" CTA (see
  // post-login-intent.ts) lands on their demo-booking screen instead of
  // their normal role home, exactly once, right after signing in.
  useEffect(() => {
    if (!session || !profile) return;
    let cancelled = false;
    consumePendingBookDemoIntent().then((wantsDemo) => {
      if (cancelled) return;
      setPostLoginHref(wantsDemo && profile.role === 'client' ? ('/demo-booking' as Href) : getHomeRouteForRole(profile.role));
    });
    return () => {
      cancelled = true;
    };
  }, [session, profile]);

  if (loading) return null;
  // A password-recovery deep link establishes a real session too — don't
  // let that bounce the user home before they've actually set a new
  // password on /reset-password (see auth-context.tsx). Same reasoning for
  // signup's phone-OTP step, which also runs after a session already exists.
  if (recoveryInProgress || signupPhoneStepInProgress) {
    return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: Brand.black } }} />;
  }
  // Session exists but the role lookup (profiles.role) hasn't resolved yet
  // — wait rather than redirecting on a still-null role, which would
  // briefly send everyone (including coaches) to /unsupported-role before
  // correcting itself once profile loads. Same reasoning for the pending-
  // intent check above still being in flight.
  if (session && !profile) return null;
  if (session) {
    if (!postLoginHref) return null;
    return <Redirect href={postLoginHref} />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: Brand.black },
      }}
    />
  );
}
