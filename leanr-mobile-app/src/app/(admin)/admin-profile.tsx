/**
 * Profile (admin) — New PRD.md §4.C "Screen: Admin Profile" — profile
 * info, edit (name/phone/photo — same `profiles`-table scope every role
 * shares), notifications, logout. Reuses `profile.ts` verbatim (role-
 * agnostic, `auth.uid()`-scoped, same as the coach profile screen).
 *
 * NOTE (Gap Verification Report, Area 7): the web app has NO admin-profile
 * route or edit UI at all — only a read-only sidebar identity block (name +
 * avatar + a hardcoded "Operations Team" subtitle) + logout. This screen's
 * edit/password-change capability is therefore new functionality beyond
 * web parity, not a ported feature — flagged per the report's explicit
 * instruction, not rolled back, since nothing on the web side requires
 * removing it.
 */
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { AvatarEditor } from '@/components/avatar-editor';
import { LightDestructiveButton, LightPrimaryButton } from '@/components/light/light-button';
import { LightCard } from '@/components/light/light-card';
import { LightMenuRow } from '@/components/light/light-menu-row';
import { LightScreenScaffold } from '@/components/light/light-screen-scaffold';
import { LightSectionHeader } from '@/components/light/light-section-header';
import { LightTextField } from '@/components/light/light-text-field';
import { LightErrorState, LightLoadingState } from '@/components/light/light-states';
import { LightBrand } from '@/constants/light-theme';
import { useAuth } from '@/lib/auth/auth-context';
import { changeMyPassword, getMyProfile, updateMyProfile } from '@/lib/data/profile';
import { getErrorMessage } from '@/lib/data/errors';
import { useAsync } from '@/lib/data/use-async';

export default function AdminProfileScreen() {
  const { session, signOut } = useAuth();
  const { data: profile, loading, error, reload } = useAsync(getMyProfile, []);

  const [fullName, setFullName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordChanged, setPasswordChanged] = useState(false);

  const displayPhotoUrl = photoUrl ?? profile?.photo_url ?? null;
  const displayName = fullName ?? profile?.full_name ?? '';
  const displayPhone = phone ?? profile?.phone ?? '';

  const onAvatarUploaded = async (url: string) => {
    setPhotoUrl(url);
    setAvatarError(null);
    try {
      await updateMyProfile({ photo_url: url });
    } catch (err) {
      setAvatarError(getErrorMessage(err));
    }
  };

  const onSaveProfile = async () => {
    setSavingProfile(true);
    setProfileError(null);
    setProfileSaved(false);
    try {
      await updateMyProfile({ full_name: displayName, phone: displayPhone || null });
      setProfileSaved(true);
    } catch (err) {
      setProfileError(getErrorMessage(err));
    } finally {
      setSavingProfile(false);
    }
  };

  const onChangePassword = async () => {
    setPasswordError(null);
    setPasswordChanged(false);
    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.');
      return;
    }
    setChangingPassword(true);
    try {
      await changeMyPassword(newPassword);
      setNewPassword('');
      setConfirmPassword('');
      setPasswordChanged(true);
    } catch (err) {
      setPasswordError(getErrorMessage(err));
    } finally {
      setChangingPassword(false);
    }
  };

  if (loading) {
    return (
      <LightScreenScaffold title="Profile">
        <LightLoadingState />
      </LightScreenScaffold>
    );
  }
  if (error) {
    return (
      <LightScreenScaffold title="Profile">
        <LightErrorState message={error} onRetry={reload} />
      </LightScreenScaffold>
    );
  }

  return (
    <LightScreenScaffold title="Profile" subtitle={session?.user.email ?? undefined}>
      <AvatarEditor photoUrl={displayPhotoUrl} onUploaded={onAvatarUploaded} />
      {avatarError && <Text style={styles.errorText}>{avatarError}</Text>}

      <LightCard style={styles.card}>
        <LightSectionHeader title="Your details" />
        <LightTextField placeholder="Full name" value={displayName} onChangeText={setFullName} maxLength={100} accessibilityLabel="Full name" />
        <LightTextField placeholder="Phone number" value={displayPhone} onChangeText={setPhone} keyboardType="phone-pad" accessibilityLabel="Phone number" />
        {profileError && <Text style={styles.errorText}>{profileError}</Text>}
        {profileSaved && <Text style={styles.savedText}>Saved.</Text>}
        <LightPrimaryButton onPress={onSaveProfile} loading={savingProfile} style={styles.saveButton}>
          Save
        </LightPrimaryButton>
      </LightCard>

      <LightCard style={styles.card}>
        <LightSectionHeader title="Change password" />
        <LightTextField placeholder="New password" isPassword value={newPassword} onChangeText={setNewPassword} accessibilityLabel="New password" />
        <LightTextField placeholder="Confirm new password" isPassword value={confirmPassword} onChangeText={setConfirmPassword} accessibilityLabel="Confirm new password" />
        {passwordError && <Text style={styles.errorText}>{passwordError}</Text>}
        {passwordChanged && <Text style={styles.savedText}>Password changed.</Text>}
        <LightPrimaryButton onPress={onChangePassword} loading={changingPassword} style={styles.saveButton}>
          Change password
        </LightPrimaryButton>
      </LightCard>

      <LightCard style={styles.menuCard}>
        <LightMenuRow label="Notifications" icon="notifications-outline" onPress={() => router.push('/admin-notifications')} last />
      </LightCard>

      <LightDestructiveButton size="lg" onPress={signOut}>
        Sign out
      </LightDestructiveButton>
    </LightScreenScaffold>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  menuCard: { paddingVertical: 4 },
  errorText: { fontFamily: 'Manrope_500Medium', fontSize: 14, color: LightBrand.alertRed, marginTop: 4 },
  savedText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13, color: LightBrand.successEmerald, marginTop: 4 },
  saveButton: { marginTop: 4 },
});
