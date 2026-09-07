/**
 * Profile (coach) — New PRD.md §4.B: editable Mobile Number/Emergency
 * Contact/Photo, append-only Skills, password (direct Supabase call);
 * read-only (admin-owned): email/specialization/bio/certifications/
 * languages/employee code/joining date/working hours/capacity/name.
 * Relit only — logic already correct.
 */
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import { AvatarEditor } from '@/components/avatar-editor';
import { LightCard } from '@/components/light/light-card';
import { LightPrimaryButton } from '@/components/light/light-button';
import { LightScreenScaffold } from '@/components/light/light-screen-scaffold';
import { LightSectionHeader } from '@/components/light/light-section-header';
import { LightTextField } from '@/components/light/light-text-field';
import { LightErrorState, LightLoadingState } from '@/components/light/light-states';
import { LightBrand } from '@/constants/light-theme';
import { changeMyPassword, getMyCoachDetails, getMyProfile, updateMyCoachDetails, updateMyProfile } from '@/lib/data/profile';
import { getErrorMessage } from '@/lib/data/errors';
import { useAsync } from '@/lib/data/use-async';

function joinList(values: string[]) {
  return values.join(', ');
}
function splitList(text: string) {
  return text
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

export default function CoachProfileScreen() {
  const { data, loading, error, reload } = useAsync(async () => {
    const [profile, details] = await Promise.all([getMyProfile(), getMyCoachDetails()]);
    return { profile, details };
  }, []);

  const [fullName, setFullName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [emergencyContact, setEmergencyContact] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);

  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const [bio, setBio] = useState<string | null>(null);
  const [specialization, setSpecialization] = useState<string | null>(null);
  const [certifications, setCertifications] = useState<string | null>(null);
  const [languages, setLanguages] = useState<string | null>(null);
  const [skills, setSkills] = useState<string | null>(null);
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [detailsSaved, setDetailsSaved] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordChanged, setPasswordChanged] = useState(false);

  const displayPhotoUrl = photoUrl ?? data?.profile?.photo_url ?? null;
  const displayName = fullName ?? data?.profile?.full_name ?? '';
  const displayPhone = phone ?? data?.profile?.phone ?? '';
  const displayEmergency = emergencyContact ?? data?.profile?.emergency_contact ?? '';
  const displayBio = bio ?? data?.details?.bio ?? '';
  const displaySpecialization = specialization ?? data?.details?.specialization ?? '';
  const displayCertifications = certifications ?? (data?.details ? joinList(data.details.certifications) : '');
  const displayLanguages = languages ?? (data?.details ? joinList(data.details.languages) : '');
  const displaySkills = skills ?? (data?.details ? joinList(data.details.skills) : '');

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
      await updateMyProfile({ full_name: displayName, phone: displayPhone || null, emergency_contact: displayEmergency || null });
      setProfileSaved(true);
    } catch (err) {
      setProfileError(getErrorMessage(err));
    } finally {
      setSavingProfile(false);
    }
  };

  const onSaveDetails = async () => {
    setSavingDetails(true);
    setDetailsError(null);
    setDetailsSaved(false);
    try {
      await updateMyCoachDetails({
        bio: displayBio || null,
        specialization: displaySpecialization || null,
        certifications: splitList(displayCertifications),
        languages: splitList(displayLanguages),
        skills: splitList(displaySkills),
      });
      setDetailsSaved(true);
    } catch (err) {
      setDetailsError(getErrorMessage(err));
    } finally {
      setSavingDetails(false);
    }
  };

  const onChangePassword = async () => {
    setPasswordError(null);
    setPasswordChanged(false);
    if (newPassword.length < 6) {
      setPasswordError('Password must be at least 6 characters.');
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
    <LightScreenScaffold title="Profile">
      <AvatarEditor photoUrl={displayPhotoUrl} onUploaded={onAvatarUploaded} />
      {avatarError && (
        <Text style={styles.errorText} accessibilityRole="alert">
          {avatarError}
        </Text>
      )}

      <LightCard style={styles.card}>
        <LightSectionHeader title="Your details" />
        <LightTextField placeholder="Full name" value={displayName} onChangeText={setFullName} maxLength={100} accessibilityLabel="Full name" />
        <LightTextField placeholder="Phone number" value={displayPhone} onChangeText={setPhone} keyboardType="phone-pad" accessibilityLabel="Phone number" />
        <LightTextField
          placeholder="Emergency contact"
          value={displayEmergency}
          onChangeText={setEmergencyContact}
          accessibilityLabel="Emergency contact"
        />
        {profileError && (
          <Text style={styles.errorText} accessibilityRole="alert">
            {profileError}
          </Text>
        )}
        {profileSaved && <Text style={styles.savedText}>Saved.</Text>}
        <LightPrimaryButton onPress={onSaveProfile} loading={savingProfile} style={styles.saveButton}>
          Save
        </LightPrimaryButton>
      </LightCard>

      <LightCard style={styles.card}>
        <LightSectionHeader title="Coaching profile" />
        <LightTextField placeholder="Specialization" value={displaySpecialization} onChangeText={setSpecialization} accessibilityLabel="Specialization" />
        <LightTextField placeholder="Bio" value={displayBio} onChangeText={setBio} multiline style={styles.multilineInput} accessibilityLabel="Bio" />
        <LightTextField
          placeholder="Certifications (comma-separated)"
          value={displayCertifications}
          onChangeText={setCertifications}
          accessibilityLabel="Certifications"
        />
        <LightTextField placeholder="Languages (comma-separated)" value={displayLanguages} onChangeText={setLanguages} accessibilityLabel="Languages" />
        <LightTextField placeholder="Skills (comma-separated)" value={displaySkills} onChangeText={setSkills} accessibilityLabel="Skills" />
        {detailsError && (
          <Text style={styles.errorText} accessibilityRole="alert">
            {detailsError}
          </Text>
        )}
        {detailsSaved && <Text style={styles.savedText}>Saved.</Text>}
        <LightPrimaryButton onPress={onSaveDetails} loading={savingDetails} style={styles.saveButton}>
          Save
        </LightPrimaryButton>
      </LightCard>

      <LightCard style={styles.card}>
        <LightSectionHeader title="Change password" />
        <LightTextField placeholder="New password" isPassword value={newPassword} onChangeText={setNewPassword} accessibilityLabel="New password" />
        <LightTextField
          placeholder="Confirm new password"
          isPassword
          value={confirmPassword}
          onChangeText={setConfirmPassword}
          accessibilityLabel="Confirm new password"
        />
        {passwordError && (
          <Text style={styles.errorText} accessibilityRole="alert">
            {passwordError}
          </Text>
        )}
        {passwordChanged && <Text style={styles.savedText}>Password changed.</Text>}
        <LightPrimaryButton onPress={onChangePassword} loading={changingPassword} style={styles.saveButton}>
          Change password
        </LightPrimaryButton>
      </LightCard>
    </LightScreenScaffold>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12 },
  multilineInput: { minHeight: 80, textAlignVertical: 'top', paddingTop: 14 },
  errorText: { fontFamily: 'Manrope_500Medium', fontSize: 14, color: LightBrand.alertRed, marginTop: 4 },
  savedText: { fontFamily: 'Manrope_600SemiBold', fontSize: 13, color: LightBrand.successEmerald, marginTop: 4 },
  saveButton: { marginTop: 4 },
});
