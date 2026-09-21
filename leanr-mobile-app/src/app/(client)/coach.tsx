/**
 * Chats tab (enrolled) / Coach Profile (pre-purchase) — dual-branch.
 *
 * Pre-purchase (mockup #4, unchanged by this pass): read-only coach
 * profile, no chat composer — matches both the mockup's "Not Available
 * (Until Plan Purchase): Client chat with coach" and New PRD.md §6 ("chat
 * is gated on 'has ever purchased', not on having a coach").
 *
 * Enrolled (mockup frame 12, "Chats"): real-time chat thread only. The
 * coach profile card + Request Coach Change flow that used to live on
 * this screen moved to `my-coach.tsx` (reached from More) — the mockup's
 * Chats frame shows no profile/coach-change UI at all for the enrolled
 * state, matching New PRD.md §21's own placement of "My Coach" as a
 * Profile-menu item rather than part of the chat screen.
 *
 * The mockup's "Coach / Support" segmented control is reproduced, but
 * "Support" is shown disabled: no live chat-with-admin feature exists
 * anywhere in the web app or PRD — only the async, written My Concerns
 * flow does — so wiring it to anything would be inventing functionality.
 */
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ScreenScaffold } from '@/components/screen-scaffold';
import { Avatar } from '@/components/ui/avatar';
import { PrimaryButton } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { MessageBubble, MessageInput } from '@/components/ui/chat-thread';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import { MenuRow } from '@/components/ui/menu-row';
import {
  getMyActiveConversation,
  getMyPastConversations,
  getMessages,
  markMessagesRead,
  sendMessage,
  subscribeToConversation,
  uploadChatImage,
  type PastConversation,
} from '@/lib/data/chat';
import { getMyCoach } from '@/lib/data/coach';
import { getLatestSubscription } from '@/lib/data/subscription';
import type { Message } from '@/lib/data/types';
import { useAsync } from '@/lib/data/use-async';
import { pickChatImage, type PickedImage } from '@/lib/media/pick-chat-image';
import { getErrorMessage } from '@/lib/data/errors';
import { Brand, Spacing } from '@/constants/theme';

/**
 * Pre-purchase Coach Profile — three states per ClientPortal.md §12:
 * no-coach (never demoed / demo lapsed with no plan), demo-coach
 * (simplified card — no bio grid, no change-request, temporary-assignment
 * copy), full profile card is enrolled-only (EnrolledChatsScreen below).
 */
function PrePurchaseCoachScreen() {
  const { data: coach, loading, error, reload } = useAsync(getMyCoach, []);

  return (
    <ScreenScaffold title="Coach Profile">
      {loading && <LoadingState />}
      {error && <ErrorState message={error} onRetry={reload} />}
      {!loading && !error && !coach && (
        <>
          <EmptyState
            message="You'll be matched with a coach automatically once you book a free demo session or choose a plan."
            icon="person-outline"
          />
          <PrimaryButton size="lg" onPress={() => router.push('/demo-booking')}>
            Book Free Demo Session
          </PrimaryButton>
        </>
      )}
      {!loading && !error && coach && coach.source === 'demo' && (
        <GlassCard style={lightStyles.coachCard}>
          <View style={lightStyles.coachRow}>
            <Avatar photoUrl={coach.photo_url} name={coach.full_name} size={64} ring />
            <View style={lightStyles.coachInfo}>
              <Text style={lightStyles.coachName} numberOfLines={1}>
                {coach.full_name}
              </Text>
              <Text style={lightStyles.coachSpecialty}>Assigned for your demo session</Text>
            </View>
          </View>
          <Text style={lightStyles.coachBio}>
            This is a temporary assignment for your demo only — you&apos;ll be matched with your ongoing coach once you
            choose a plan.
          </Text>
        </GlassCard>
      )}
      {!loading && !error && coach && coach.source !== 'demo' && (
        <GlassCard style={lightStyles.coachCard}>
          <View style={lightStyles.coachRow}>
            <Avatar photoUrl={coach.photo_url} name={coach.full_name} size={64} ring />
            <View style={lightStyles.coachInfo}>
              <Text style={lightStyles.coachName} numberOfLines={1}>
                {coach.full_name}
              </Text>
              {coach.specialization && (
                <Text style={lightStyles.coachSpecialty} numberOfLines={1}>
                  {coach.specialization}
                </Text>
              )}
              {coach.rating != null && <Text style={lightStyles.coachRating}>★ {coach.rating.toFixed(1)}</Text>}
            </View>
          </View>
          {coach.bio && <Text style={lightStyles.coachBio}>{coach.bio}</Text>}
        </GlassCard>
      )}
    </ScreenScaffold>
  );
}

type ChatTab = 'coach' | 'support';

/** Enrolled Chats (mockup frame 12) — pure message thread, light theme. */
function EnrolledChatsScreen() {
  const [tab, setTab] = useState<ChatTab>('coach');
  const { data, loading, error, reload } = useAsync(async () => {
    const [coach, conversation, pastConversations] = await Promise.all([
      getMyCoach(),
      getMyActiveConversation(),
      getMyPastConversations(),
    ]);
    return { coach, conversation, pastConversations };
  }, []);

  const coach = data?.coach ?? null;
  const conversation = data?.conversation ?? null;
  const pastConversations = data?.pastConversations ?? [];

  const [pastOpen, setPastOpen] = useState(false);
  const [viewingPast, setViewingPast] = useState<PastConversation | null>(null);
  const [pastMessages, setPastMessages] = useState<Message[]>([]);

  useEffect(() => {
    if (!viewingPast) return;
    let cancelled = false;
    getMessages(viewingPast.id).then((result) => {
      if (!cancelled) setPastMessages(result);
    });
    return () => {
      cancelled = true;
    };
  }, [viewingPast]);

  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [attaching, setAttaching] = useState(false);
  const [pendingImage, setPendingImage] = useState<PickedImage | null>(null);

  useEffect(() => {
    if (!conversation) return;
    let cancelled = false;

    getMessages(conversation.id)
      .then((result) => {
        if (!cancelled) setMessages(result);
      })
      .catch((err) => {
        if (!cancelled) setMessagesError(getErrorMessage(err));
      });
    markMessagesRead(conversation.id, 'coach').catch(() => {});

    const unsubscribe = subscribeToConversation(conversation.id, (message, event) => {
      setMessages((prev) => {
        if (event === 'INSERT') {
          if (prev.some((m) => m.id === message.id)) return prev;
          return [...prev, message];
        }
        return prev.map((m) => (m.id === message.id ? message : m));
      });
      if (event === 'INSERT' && message.sender_role === 'coach') {
        markMessagesRead(conversation.id, 'coach').catch(() => {});
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [conversation]);

  const onSend = async () => {
    if (!conversation || (!draft.trim() && !pendingImage)) return;
    const body = draft.trim();
    const image = pendingImage;
    setDraft('');
    setPendingImage(null);
    setMessagesError(null);
    setSending(true);
    if (image) setAttaching(true);
    try {
      const attachmentUrl = image ? await uploadChatImage(conversation.id, image.uri, image.mimeType) : null;
      const sent = await sendMessage(conversation.id, { body: body || null, attachmentUrl });
      setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
    } catch (err) {
      setMessagesError(getErrorMessage(err));
      setDraft(body);
      setPendingImage(image);
    } finally {
      setSending(false);
      setAttaching(false);
    }
  };

  const onPickImage = async () => {
    const picked = await pickChatImage();
    if (picked) setPendingImage(picked);
  };

  return (
    <ScreenScaffold title="Chats">
      <SegmentedControl
        options={[
          { key: 'coach', label: coach?.full_name ?? 'Coach' },
          { key: 'support', label: 'Support' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'support' && (
        <GlassCard>
          <EmptyState
            message="Live support chat isn't available yet — coming soon. To raise an issue today, use My Concerns from More."
            icon="construct-outline"
          />
        </GlassCard>
      )}

      {tab === 'coach' && (
        <>
          {loading && <LoadingState />}
          {error && <ErrorState message={error} onRetry={reload} />}
          {!loading && !error && !coach && <EmptyState message="No coach assigned yet." icon="person-outline" />}

          {!loading && !error && coach && (
            <View style={lightStyles.headerRow}>
              <Avatar photoUrl={coach.photo_url} name={coach.full_name} size={36} />
              <View>
                <Text style={lightStyles.coachNameSmall}>{coach.full_name}</Text>
                <View style={lightStyles.onlineRow}>
                  <View style={lightStyles.onlineDot} />
                  <Text style={lightStyles.onlineText}>Online</Text>
                </View>
              </View>
            </View>
          )}

          {!loading && !error && coach && !conversation && (
            <EmptyState message="No conversation with your coach yet." icon="chatbubble-outline" />
          )}

          {!loading && !error && conversation && (
            <>
              <View style={lightStyles.thread}>
                {messages.length === 0 && <EmptyState message="Say hello to your coach." icon="hand-left-outline" />}
                {messages.map((m) => (
                  <MessageBubble key={m.id} message={m} mine={m.sender_role === 'client'} />
                ))}
              </View>

              {messagesError && (
                <Text style={lightStyles.errorText} accessibilityRole="alert">
                  {messagesError}
                </Text>
              )}

              <MessageInput
                value={draft}
                onChangeText={setDraft}
                onSend={onSend}
                sending={sending}
                onAttach={onPickImage}
                attaching={attaching}
                pendingImage={pendingImage}
                onRemovePendingImage={() => setPendingImage(null)}
                placeholder={pendingImage ? 'Add a caption (optional)…' : 'Message your coach…'}
              />
            </>
          )}

          {!loading && !error && pastConversations.length > 0 && (
            <GlassCard>
              <MenuRow
                label={`Past Coaches (${pastConversations.length})`}
                icon={pastOpen ? 'chevron-up-outline' : 'chevron-down-outline'}
                onPress={() => setPastOpen((v) => !v)}
                last={!pastOpen}
              />
              {pastOpen &&
                pastConversations.map((pc, i) => (
                  <MenuRow
                    key={pc.id}
                    label={pc.coachName ?? 'Former coach'}
                    icon="person-outline"
                    onPress={() => setViewingPast(pc)}
                    last={i === pastConversations.length - 1}
                  />
                ))}
            </GlassCard>
          )}

          {viewingPast && (
            <GlassCard>
              <Text style={lightStyles.pastNotice}>
                This coach is no longer assigned to you — you can still see this history.
              </Text>
              <View style={lightStyles.thread}>
                {pastMessages.map((m) => (
                  <MessageBubble key={m.id} message={m} mine={m.sender_role === 'client'} />
                ))}
              </View>
              <MenuRow label="Close" icon="close-outline" onPress={() => setViewingPast(null)} last />
            </GlassCard>
          )}
        </>
      )}
    </ScreenScaffold>
  );
}

export default function CoachScreen() {
  const { data: subscription, loading } = useAsync(getLatestSubscription, []);
  if (loading) return null;
  return subscription ? <EnrolledChatsScreen /> : <PrePurchaseCoachScreen />;
}

const lightStyles = StyleSheet.create({
  coachCard: { gap: 10 },
  coachRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  coachInfo: { flexShrink: 1, gap: Spacing.one },
  coachName: { fontFamily: 'Manrope_800ExtraBold', fontSize: 19, color: '#FFFFFF' },
  coachSpecialty: { fontFamily: 'Manrope_500Medium', fontSize: 13, color: 'rgba(255,255,255,0.6)' },
  coachRating: { fontFamily: 'Manrope_700Bold', fontSize: 13, color: Brand.yellow },
  coachBio: { fontFamily: 'Manrope_500Medium', fontSize: 14, color: 'rgba(255,255,255,0.6)', lineHeight: 20 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  coachNameSmall: { fontFamily: 'Manrope_700Bold', fontSize: 14.5, color: '#FFFFFF' },
  onlineRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Brand.successEmerald },
  onlineText: { fontFamily: 'Manrope_500Medium', fontSize: 11.5, color: 'rgba(255,255,255,0.45)' },
  thread: { gap: 8 },
  errorText: { fontFamily: 'Manrope_500Medium', fontSize: 14, color: Brand.alertRed },
  pastNotice: { fontFamily: 'Manrope_500Medium', fontSize: 12.5, color: 'rgba(255,255,255,0.45)', marginBottom: 8 },
});
