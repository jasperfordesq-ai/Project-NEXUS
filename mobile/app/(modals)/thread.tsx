// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import * as ImagePicker from 'expo-image-picker';
import * as Haptics from '@/lib/haptics';
import { Button as HeroButton, Card as HeroCard, Chip, Spinner, Surface } from 'heroui-native';

import { useTranslation } from 'react-i18next';
import { deleteMessage, displayName, getMessagingRestrictionStatus, getOrCreateThread, getThread, markConversationRead, sendMessage, sendMessageWithAttachments, sendVoiceMessage as sendVoiceMessageApi, toggleMessageReaction, updateMessage, type Message, type MessageAttachmentUpload, type MessagingRestrictionStatus, type SendMessageOptions } from '@/lib/api/messages';
import { useApi } from '@/lib/hooks/useApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { useRealtimeContext } from '@/lib/context/RealtimeContext';
import { withAlpha } from '@/lib/utils/color';
import AppTopBar from '@/components/ui/AppTopBar';
import ActionSheet from '@/components/ui/ActionSheet';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import Avatar from '@/components/ui/Avatar';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import OfflineBanner from '@/components/OfflineBanner';
import TypingIndicator from '@/components/TypingIndicator';
import VoiceMessageBubble from '@/components/VoiceMessageBubble';
import { resolveMediaUrl } from '@/lib/utils/resolveImageUrl';
import { authenticatedMediaRequest } from '@/lib/api/client';
import { openAuthenticatedMessageMedia } from '@/lib/messageMedia';
import AccentIcon from '@/components/ui/AccentIcon';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];
const REACTION_EMOJIS = ['\u{1F44D}', '\u2764\uFE0F', '\u{1F602}', '\u{1F62E}', '\u{1F622}', '\u{1F64F}'];

const MAX_ATTACHMENTS = 5;

const THREAD_CONTEXT_CONFIG = {
  listing: { icon: 'list-outline', labelKey: 'context.type.listing', pathname: '/(modals)/exchange-detail', color: '#06b6d4' },
  event: { icon: 'calendar-outline', labelKey: 'context.type.event', pathname: '/(modals)/event-detail', color: '#6366f1' },
  job: { icon: 'briefcase-outline', labelKey: 'context.type.job', pathname: '/(modals)/job-detail', color: '#f59e0b' },
  volunteering: { icon: 'heart-outline', labelKey: 'context.type.volunteering', pathname: '/(modals)/volunteering-detail', color: '#ef4444' },
} as const satisfies Record<string, { icon: IoniconName; labelKey: string; pathname: string; color: string }>;

type ThreadContextType = keyof typeof THREAD_CONTEXT_CONFIG;
type ThreadContext = { type: ThreadContextType; id: number };
type PendingAttachment = MessageAttachmentUpload & { id: string; width?: number | null; height?: number | null; size?: number | null };

export default function ThreadScreen() {
  return (
    <ModalErrorBoundary>
      <ThreadScreenInner />
    </ModalErrorBoundary>
  );
}

function ThreadScreenInner() {
  const { t } = useTranslation(['messages', 'common']);
  const { id, recipientId, name, listing, context_type, context_id } = useLocalSearchParams<{
    id?: string | string[];
    recipientId?: string | string[];
    name?: string | string[];
    listing?: string | string[];
    context_type?: string | string[];
    context_id?: string | string[];
  }>();
  const { user: authUser } = useAuth();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { subscribeToMessages } = useRealtimeContext();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const unknownMemberLabel = t('unknownMember');

  const rawRecipientId = firstParam(recipientId);
  const rawConversationId = firstParam(id);
  const directRecipientId = Number(rawRecipientId);
  const conversationId = Number(rawConversationId);
  const isNewConversation = Number.isFinite(directRecipientId) && directRecipientId > 0;
  const threadLookupId = isNewConversation ? directRecipientId : conversationId;
  const isValidId = Number.isFinite(threadLookupId) && threadLookupId > 0;
  const safeThreadLookupId = isValidId ? threadLookupId : 0;
  const recipientName = firstParam(name);
  const threadTitle = recipientName?.trim() ? recipientName.trim() : t('threadTitle');
  const listingId = parsePositiveInt(firstParam(listing));
  const contextType = firstParam(context_type);
  const contextId = parsePositiveInt(firstParam(context_id));

  const { data, isLoading, error, refresh } = useApi(
    () => (isNewConversation ? getOrCreateThread(safeThreadLookupId) : getThread(safeThreadLookupId)),
    [safeThreadLookupId, isNewConversation],
    { enabled: isValidId },
  );

  const messageThreadContext = useMemo(() => resolveMessageThreadContext(data?.data), [data?.data]);
  const threadContext = useMemo(
    () => resolveThreadContext(listingId, contextType, contextId) ?? messageThreadContext,
    [contextId, contextType, listingId, messageThreadContext],
  );

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [messagingRestriction, setMessagingRestriction] = useState<MessagingRestrictionStatus | null>(null);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [attachmentSheetVisible, setAttachmentSheetVisible] = useState(false);
  const [optionsMessage, setOptionsMessage] = useState<Message | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voiceUri, setVoiceUri] = useState<string | null>(null);
  const flatListRef = useRef<FlatList<Message>>(null);
  const inputTextRef = useRef(inputText);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  inputTextRef.current = inputText;

  const enrichedMessages = useMemo(() => {
    if (!isValidId || !data?.data) return null;
    const currentUserId = authUser?.id;
    return data.data
      .map((message) => ({
        ...message,
        is_own: message.is_own ?? (currentUserId != null && message.sender_id === currentUserId),
        sender: message.sender ?? { id: message.sender_id ?? 0, first_name: null, last_name: null, avatar_url: null },
      }))
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
  }, [authUser?.id, data, isValidId]);

  useEffect(() => {
    if (enrichedMessages) {
      setMessages(enrichedMessages);
    }
  }, [enrichedMessages]);

  useEffect(() => {
    if (messages.length === 0) return;
    const timer = setTimeout(() => {
      flatListRef.current?.scrollToEnd({ animated: true });
    }, 80);
    return () => clearTimeout(timer);
  }, [messages.length]);

  useEffect(() => {
    if (!isValidId || !safeThreadLookupId) return undefined;
    return subscribeToMessages(safeThreadLookupId, (incoming) => {
      setMessages((prev) => {
        if (prev.some((message) => message.id === incoming.id)) return prev;
        const acknowledged = incoming.is_own ? incoming : { ...incoming, is_read: true };
        return [...prev, acknowledged].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
      });
      if (!incoming.is_own) {
        void markConversationRead(safeThreadLookupId).catch(() => null);
      }
    });
  }, [isValidId, safeThreadLookupId, subscribeToMessages]);

  useEffect(() => {
    if (!isValidId) return undefined;
    let cancelled = false;
    getMessagingRestrictionStatus()
      .then((response) => {
        if (!cancelled) {
          setMessagingRestriction(response.data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setMessagingRestriction(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [isValidId]);

  useEffect(() => () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
    }
    void recordingRef.current?.stopAndUnloadAsync().catch(() => null);
  }, []);

  const resolvedRecipientId = useMemo(() => {
    if (!isValidId) return null;
    if (isNewConversation && safeThreadLookupId > 0) return safeThreadLookupId;
    const thread = data as (typeof data & { meta?: { conversation?: { other_user?: { id?: number } } } }) | undefined;
    const metaId = thread?.meta?.conversation?.other_user?.id;
    if (metaId) return metaId;
    const incoming = data?.data?.find((message) => !message.is_own);
    return incoming?.sender?.id ?? incoming?.sender_id ?? null;
  }, [data, isNewConversation, isValidId, safeThreadLookupId]);

  const newConversationOptions = useMemo<SendMessageOptions | undefined>(() => {
    if (!isNewConversation) return undefined;
    const options: SendMessageOptions = {};
    if (listingId) options.listing_id = listingId;
    if (contextType && contextId) {
      options.context_type = contextType;
      options.context_id = contextId;
    }
    return Object.keys(options).length > 0 ? options : undefined;
  }, [contextId, contextType, isNewConversation, listingId]);

  const handleSend = useCallback(async () => {
    const body = inputTextRef.current.trim();
    if ((!body && pendingAttachments.length === 0) || isSending || resolvedRecipientId === null) return;
    if (messagingRestriction?.messaging_disabled) {
      showToast({ title: t('thread.messagingRestrictedTitle'), description: t('thread.messagingRestrictedContact'), variant: 'warning' });
      return;
    }

    if (editingMessage) {
      setIsSending(true);
      try {
        const response = await updateMessage(editingMessage.id, body);
        setMessages((prev) => prev.map((message) => (
          message.id === editingMessage.id
            ? { ...message, ...(response.data ?? {}), body, is_edited: true }
            : message
        )));
        setEditingMessage(null);
        setInputText('');
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        showToast({ title: t('errors.editFailedTitle'), description: t('errors.editFailed'), variant: 'danger' });
      } finally {
        setIsSending(false);
      }
      return;
    }

    const optimisticAttachments = pendingAttachments.map((attachment, index) => ({
      id: `pending-${attachment.id}`,
      name: attachment.name ?? t('thread.attachmentName', { index: index + 1 }),
      url: attachment.uri,
      type: 'image',
      size: attachment.size ?? null,
      mime_type: attachment.mimeType ?? null,
    }));
    const optimistic: Message = {
      id: Date.now(),
      body,
      sender: { id: -1, name: t('common:labels.you'), avatar_url: null },
      created_at: new Date().toISOString(),
      is_own: true,
      is_voice: false,
      audio_url: null,
      reactions: {},
      is_read: false,
      attachments: optimisticAttachments,
    };

    setMessages((prev) => [...prev, optimistic]);
    setInputText('');
    setPendingAttachments([]);
    Keyboard.dismiss();
    setIsSending(true);

    try {
      const res = pendingAttachments.length > 0
        ? await sendMessageWithAttachments(resolvedRecipientId, body, pendingAttachments, newConversationOptions)
        : newConversationOptions
          ? await sendMessage(resolvedRecipientId, body, newConversationOptions)
          : await sendMessage(resolvedRecipientId, body);
      setMessages((prev) => {
        if (prev.some((message) => message.id === res.data.id)) {
          return prev.filter((message) => message.id !== optimistic.id);
        }
        return prev.map((message) => (message.id === optimistic.id ? { ...res.data, is_own: true } : message));
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setMessages((prev) => prev.filter((message) => message.id !== optimistic.id));
      setInputText(body);
      setPendingAttachments(pendingAttachments);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('errors.sendFailed'), description: t('thread.sendFailed'), variant: 'danger' });
    } finally {
      setIsSending(false);
    }
  }, [editingMessage, isSending, messagingRestriction?.messaging_disabled, newConversationOptions, pendingAttachments, resolvedRecipientId, showToast, t]);

  const startEditingMessage = useCallback((message: Message) => {
    if (!message.is_own || message.is_voice || message.is_deleted) return;
    setEditingMessage(message);
    setPendingAttachments([]);
    setInputText(message.body || message.content || '');
  }, []);

  const cancelEditingMessage = useCallback(() => {
    setEditingMessage(null);
    setInputText('');
  }, []);

  const handleDeleteMessage = useCallback((message: Message, scope: 'self' | 'everyone') => {
    confirm({
      title: t('thread.deleteTitle'),
      message: scope === 'everyone' ? t('thread.deleteEveryoneConfirm') : t('thread.deleteSelfConfirm'),
      confirmLabel: t('thread.delete'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        try {
          await deleteMessage(message.id, scope);
          setMessages((prev) => {
            if (scope === 'self') {
              return prev.filter((item) => item.id !== message.id);
            }
            return prev.map((item) => (
              item.id === message.id
                ? { ...item, body: t('thread.deletedMessage'), is_deleted: true }
                : item
            ));
          });
        } catch {
          showToast({ title: t('errors.deleteFailedTitle'), description: t('errors.deleteFailed'), variant: 'danger' });
        }
      },
    });
  }, [confirm, showToast, t]);

  const openMessageOptions = useCallback((message: Message) => {
    if (message.is_deleted || message.is_voice) return;
    setOptionsMessage(message);
  }, []);

  const handlePickImages = useCallback(async () => {
    if (pendingAttachments.length >= MAX_ATTACHMENTS) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      showToast({ title: t('thread.attachments.permissionTitle'), description: t('thread.attachments.permissionMessage'), variant: 'warning' });
      return;
    }

    const remaining = Math.max(1, MAX_ATTACHMENTS - pendingAttachments.length);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 0.85,
    });
    if (result.canceled) return;

    const nextAttachments = result.assets.slice(0, remaining).map((asset, index): PendingAttachment => ({
      id: `${Date.now()}-${index}`,
      uri: asset.uri,
      name: asset.fileName ?? `message-image-${pendingAttachments.length + index + 1}.jpg`,
      mimeType: asset.mimeType ?? null,
      width: asset.width,
      height: asset.height,
      size: asset.fileSize ?? null,
    }));
    setPendingAttachments((current) => [...current, ...nextAttachments].slice(0, MAX_ATTACHMENTS));
  }, [pendingAttachments.length, showToast, t]);

  const removePendingAttachment = useCallback((id: string) => {
    setPendingAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }, []);

  const stopRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  const handleStartRecording = useCallback(async () => {
    if (isRecording || inputTextRef.current.trim() || pendingAttachments.length > 0 || editingMessage) return;
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        showToast({ title: t('thread.voice.permissionTitle'), description: t('thread.voice.permissionMessage'), variant: 'warning' });
        return;
      }
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
        staysActiveInBackground: false,
      });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = recording;
      setVoiceUri(null);
      setRecordingSeconds(0);
      setIsRecording(true);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((seconds) => seconds + 1);
      }, 1000);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      stopRecordingTimer();
      setIsRecording(false);
      recordingRef.current = null;
      showToast({ title: t('thread.voice.failedTitle'), description: t('thread.voice.startFailed'), variant: 'danger' });
    }
  }, [editingMessage, isRecording, pendingAttachments.length, showToast, stopRecordingTimer, t]);

  const handleStopRecording = useCallback(async () => {
    const recording = recordingRef.current;
    if (!recording) return;
    try {
      stopRecordingTimer();
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      recordingRef.current = null;
      setIsRecording(false);
      if (uri) {
        setVoiceUri(uri);
      }
    } catch {
      recordingRef.current = null;
      setIsRecording(false);
      setVoiceUri(null);
      showToast({ title: t('thread.voice.failedTitle'), description: t('thread.voice.stopFailed'), variant: 'danger' });
    }
  }, [showToast, stopRecordingTimer, t]);

  const handleCancelVoice = useCallback(async () => {
    stopRecordingTimer();
    const recording = recordingRef.current;
    recordingRef.current = null;
    setIsRecording(false);
    setVoiceUri(null);
    setRecordingSeconds(0);
    await recording?.stopAndUnloadAsync().catch(() => null);
  }, [stopRecordingTimer]);

  const handleSendVoice = useCallback(async () => {
    if (!voiceUri || isSending || resolvedRecipientId === null) return;
    if (messagingRestriction?.messaging_disabled) {
      showToast({ title: t('thread.messagingRestrictedTitle'), description: t('thread.messagingRestrictedContact'), variant: 'warning' });
      return;
    }

    const optimistic: Message = {
      id: Date.now(),
      body: '',
      sender: { id: -1, name: t('common:labels.you'), avatar_url: null },
      created_at: new Date().toISOString(),
      is_own: true,
      is_voice: true,
      audio_url: voiceUri,
      reactions: {},
      is_read: false,
    };

    setMessages((prev) => [...prev, optimistic]);
    setVoiceUri(null);
    setRecordingSeconds(0);
    setIsSending(true);

    try {
      const response = await sendVoiceMessageApi(resolvedRecipientId, voiceUri, newConversationOptions);
      setMessages((prev) => prev.map((message) => (message.id === optimistic.id ? { ...response.data, is_own: true } : message)));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      setMessages((prev) => prev.filter((message) => message.id !== optimistic.id));
      setVoiceUri(voiceUri);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('errors.sendFailed'), description: t('thread.voice.sendFailed'), variant: 'danger' });
    } finally {
      setIsSending(false);
    }
  }, [isSending, messagingRestriction?.messaging_disabled, newConversationOptions, resolvedRecipientId, showToast, t, voiceUri]);

  const handleReaction = useCallback(async (messageId: number, emoji: string) => {
    try {
      const response = await toggleMessageReaction(messageId, emoji);
      const action = response.data?.action ?? 'added';
      setMessages((prev) => prev.map((message) => {
        if (message.id !== messageId) return message;
        const reactions = { ...(message.reactions ?? {}) };
        const current = reactions[emoji] ?? 0;
        if (action === 'removed') {
          if (current <= 1) {
            delete reactions[emoji];
          } else {
            reactions[emoji] = current - 1;
          }
        } else {
          reactions[emoji] = current + 1;
        }
        return { ...message, reactions };
      }));
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      showToast({ title: t('errors.reactionFailedTitle'), description: t('errors.reactionFailed'), variant: 'danger' });
    }
  }, [showToast, t]);

  if (!isValidId) {
    return (
      <ThreadShell title={t('threadTitle')} backLabel={t('thread.goBack')}>
        <CenteredState icon="alert-circle-outline" text={t('thread.invalidConversation')} primary={primary} />
      </ThreadShell>
    );
  }

  if (isLoading && !data) {
    return (
      <ThreadShell title={threadTitle} backLabel={t('thread.goBack')}>
        <LoadingSpinner />
      </ThreadShell>
    );
  }

  if (error && !data) {
    return (
      <ThreadShell title={threadTitle} backLabel={t('thread.goBack')}>
        <CenteredState icon="warning-outline" text={t('thread.loadError')} primary={primary}>
          <HeroButton variant="primary" onPress={() => void refresh()}>
            <HeroButton.Label>{t('common:buttons.retry')}</HeroButton.Label>
          </HeroButton>
        </CenteredState>
      </ThreadShell>
    );
  }

  return (
    <SafeAreaView testID="thread-screen" className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={threadTitle} backLabel={t('thread.goBack')} fallbackHref="/(tabs)/messages" />
      <OfflineBanner />
      <KeyboardAvoidingView
        className="flex-1"
        style={{ flex: 1, backgroundColor: theme.bg }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
        <Surface variant="secondary" className="mx-4 mb-2 mt-3 flex-row items-center gap-3 rounded-panel-inner p-3">
          <Avatar uri={null} name={threadTitle} size={42} />
          <View className="min-w-0 flex-1">
            <Text className="text-base font-semibold" style={{ color: theme.text }} numberOfLines={1}>
              {threadTitle}
            </Text>
            <Text className="text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>
              {messages.length > 0 ? t('thread.messageCount', { count: messages.length }) : t('thread.noMessages')}
            </Text>
          </View>
          <Ionicons name="lock-closed-outline" size={16} color={theme.textMuted} />
        </Surface>

        {threadContext ? (
          <ThreadContextCard context={threadContext} t={t} theme={theme} primary={primary} />
        ) : null}

        {messagingRestriction?.messaging_disabled ? (
          <RestrictionNotice primary={primary} t={t} theme={theme} />
        ) : null}

        <FlatList<Message>
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <MessageBubble item={item} primary={primary} theme={theme} t={t} unknownMemberLabel={unknownMemberLabel} onReact={handleReaction} onOptions={openMessageOptions} />}
          style={{ flex: 1, backgroundColor: theme.bg }}
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: messages.length ? 'flex-start' : 'center',
            backgroundColor: theme.bg,
            paddingHorizontal: 12,
            paddingVertical: 12,
          }}
          ListEmptyComponent={<EmptyThread primary={primary} text={t('thread.noMessages')} />}
          refreshControl={
            <RefreshControl
              refreshing={isLoading && messages.length > 0}
              onRefresh={refresh}
              tintColor={primary}
              colors={[primary]}
            />
          }
          showsVerticalScrollIndicator={false}
        />

        <TypingIndicator visible={false} />

        {editingMessage ? (
          <Surface variant="secondary" className="mx-3 mb-2 flex-row items-center gap-3 rounded-panel-inner px-3 py-2">
            <Ionicons name="pencil-outline" size={16} color={primary} />
            <View className="min-w-0 flex-1">
              <Text className="text-xs font-semibold" style={{ color: theme.text }}>{t('thread.editing')}</Text>
              <Text className="text-xs" style={{ color: theme.textMuted }} numberOfLines={1}>{editingMessage.body || editingMessage.content}</Text>
            </View>
            <HeroButton isIconOnly size="sm" variant="ghost" accessibilityLabel={t('thread.cancelEdit')} onPress={cancelEditingMessage}>
              <Ionicons name="close-circle-outline" size={18} color={theme.textMuted} />
            </HeroButton>
          </Surface>
        ) : null}

        {isRecording || voiceUri ? (
          <Surface variant="secondary" className="mx-3 mb-2 flex-row items-center gap-3 rounded-panel-inner px-3 py-2">
            <View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: withAlpha(theme.error, isRecording ? 0.18 : 0.1) }}>
              <Ionicons name={isRecording ? 'radio-button-on' : 'mic-outline'} size={20} color={isRecording ? theme.error : primary} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-xs font-semibold" style={{ color: theme.text }}>
                {isRecording ? t('thread.voice.recording') : t('thread.voice.ready')}
              </Text>
              <Text className="text-xs" style={{ color: theme.textMuted }}>
                {formatRecordingTime(recordingSeconds)}
              </Text>
            </View>
            {isRecording ? (
              <HeroButton size="sm" variant="primary" onPress={() => void handleStopRecording()} accessibilityLabel={t('thread.voice.stop')}>
                <HeroButton.Label>{t('thread.voice.stop')}</HeroButton.Label>
              </HeroButton>
            ) : (
              <HeroButton isIconOnly size="sm" variant="primary" onPress={() => void handleSendVoice()} isDisabled={isSending} accessibilityLabel={t('thread.voice.send')}>
                {isSending ? <Spinner size="sm" /> : <AccentIcon name="send" size={16} />}
              </HeroButton>
            )}
            <HeroButton isIconOnly size="sm" variant="ghost" onPress={() => void handleCancelVoice()} accessibilityLabel={t('thread.voice.cancel')}>
              <Ionicons name="close-circle-outline" size={18} color={theme.textMuted} />
            </HeroButton>
          </Surface>
        ) : null}

        <Surface
          variant="default"
          className="border-t border-border/50 px-3 py-2.5"
          style={{ paddingBottom: Math.max(10, insets.bottom) }}
        >
          {pendingAttachments.length > 0 ? (
            <View className="mb-2 flex-row flex-wrap gap-2">
              {pendingAttachments.map((attachment) => (
                <HeroCard key={attachment.id} variant="secondary" className="w-[96px] overflow-hidden rounded-panel-inner p-0">
                  <Image source={{ uri: attachment.uri }} className="h-[64px] w-full" resizeMode="cover" />
                  <HeroCard.Body className="gap-1 px-2 py-1.5">
                    <Text className="text-[11px] font-medium" style={{ color: theme.text }} numberOfLines={1}>
                      {attachment.name}
                    </Text>
                    <HeroButton
                      size="sm"
                      variant="ghost"
                      accessibilityLabel={t('thread.attachments.remove', { name: attachment.name })}
                      className="min-h-0 justify-start px-0 py-0"
                      onPress={() => removePendingAttachment(attachment.id)}
                    >
                      <HeroButton.Label className="text-[11px]">{t('thread.attachments.removeLabel')}</HeroButton.Label>
                    </HeroButton>
                  </HeroCard.Body>
                </HeroCard>
              ))}
            </View>
          ) : null}
          <View className="flex-row items-end gap-2">
            <HeroButton
              isIconOnly
              size="lg"
              variant="secondary"
              onPress={() => setAttachmentSheetVisible(true)}
              isDisabled={Boolean(editingMessage) || Boolean(voiceUri) || isRecording || pendingAttachments.length >= MAX_ATTACHMENTS || messagingRestriction?.messaging_disabled}
              accessibilityLabel={t('thread.attachments.add')}
            >
              <Ionicons name="attach-outline" size={20} color={theme.textSecondary} />
            </HeroButton>
            {!inputText.trim() && pendingAttachments.length === 0 && !voiceUri ? (
              <HeroButton
                isIconOnly
                size="lg"
                variant="secondary"
                onPress={() => void handleStartRecording()}
                isDisabled={Boolean(editingMessage) || isRecording || messagingRestriction?.messaging_disabled}
                accessibilityLabel={t('thread.voice.record')}
              >
                <Ionicons name="mic-outline" size={20} color={theme.textSecondary} />
              </HeroButton>
            ) : null}
            <Input
              containerClassName="mb-0 flex-1"
              inputClassName="min-h-[44px] max-h-[120px] flex-1 rounded-[22px] border border-border px-4 pb-2.5 pt-2.5 text-[15px]"
              style={{ color: theme.text, backgroundColor: theme.bg }}
              value={inputText}
              onChangeText={setInputText}
              placeholder={t('thread.inputPlaceholder')}
              placeholderTextColor={theme.textMuted}
              multiline
              maxLength={1000}
              returnKeyType="default"
              accessibilityLabel={t('thread.inputPlaceholder')}
            />
            <HeroButton
              isIconOnly
              size="lg"
              variant="primary"
              onPress={handleSend}
              isDisabled={isSending || (!inputText.trim() && pendingAttachments.length === 0) || messagingRestriction?.messaging_disabled}
              accessibilityLabel={editingMessage ? t('thread.saveEdit') : t('thread.send')}
            >
              {isSending ? <Spinner size="sm" /> : <AccentIcon name={editingMessage ? 'checkmark' : 'send'} size={18} />}
            </HeroButton>
          </View>
        </Surface>
      </KeyboardAvoidingView>
      <ActionSheet
        visible={attachmentSheetVisible}
        onClose={() => setAttachmentSheetVisible(false)}
        title={t('thread.attachments.title')}
        actions={[
          { label: t('thread.attachments.photoLibrary'), icon: 'image-outline', onPress: () => void handlePickImages() },
        ]}
      />
      <ActionSheet
        visible={Boolean(optionsMessage)}
        onClose={() => setOptionsMessage(null)}
        title={t('thread.messageOptions')}
        actions={buildMessageActions(optionsMessage, t, startEditingMessage, handleDeleteMessage)}
      />
      {confirmDialog}
    </SafeAreaView>
  );
}

function AuthenticatedMessageImage({ path }: { path: string }) {
  const [source, setSource] = useState<{ uri: string; headers: Record<string, string> } | null>(null);

  useEffect(() => {
    let active = true;
    void authenticatedMediaRequest(path).then((request) => {
      if (active) setSource(request);
    }).catch(() => {
      if (active) setSource(null);
    });
    return () => { active = false; };
  }, [path]);

  return source ? (
    <Image source={source} className="h-[132px] w-[180px] rounded-panel-inner" resizeMode="cover" />
  ) : (
    <View className="h-[132px] w-[180px] rounded-panel-inner bg-default-100" />
  );
}

function RestrictionNotice({
  primary,
  t,
  theme,
}: {
  primary: string;
  t: (key: string, options?: Record<string, unknown>) => string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <HeroCard variant="secondary" className="mx-4 mb-2 overflow-hidden rounded-panel p-0">
      <View className="h-1 w-full" style={{ backgroundColor: theme.error }} />
      <HeroCard.Body className="flex-row items-start gap-3 px-4 py-3">
        <View className="h-10 w-10 items-center justify-center rounded-panel-inner" style={{ backgroundColor: withAlpha(theme.error, 0.12) }}>
          <Ionicons name="warning-outline" size={21} color={theme.error} />
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-sm font-semibold" style={{ color: theme.text }}>
            {t('thread.messagingRestrictedTitle')}
          </Text>
          <Text className="text-xs leading-5" style={{ color: theme.textSecondary }}>
            {t('thread.messagingRestrictedContact')}
          </Text>
        </View>
        <Ionicons name="lock-closed-outline" size={16} color={primary} />
      </HeroCard.Body>
    </HeroCard>
  );
}

function ThreadContextCard({
  context,
  t,
  theme,
  primary,
}: {
  context: ThreadContext;
  t: (key: string, options?: Record<string, unknown>) => string;
  theme: ReturnType<typeof useTheme>;
  primary: string;
}) {
  const config = THREAD_CONTEXT_CONFIG[context.type];
  const typeLabel = t(config.labelKey);

  return (
    <HeroButton
      variant="ghost"
      feedbackVariant="scale"
      accessibilityLabel={t('context.open')}
      className="mx-4 mb-2"
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.push({ pathname: config.pathname, params: { id: String(context.id) } } as never);
      }}
    >
      <HeroCard variant="secondary" className="overflow-hidden rounded-panel p-0">
        <HeroCard.Body className="flex-row items-center gap-3 px-4 py-3">
          <View className="h-11 w-11 items-center justify-center rounded-panel-inner" style={{ backgroundColor: withAlpha(config.color, 0.14) }}>
            <Ionicons name={config.icon} size={22} color={config.color} />
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="text-xs font-semibold uppercase" style={{ color: theme.textMuted }}>
                {t('context.regarding')}
              </Text>
              <Chip size="sm" variant="secondary">
                <Chip.Label>{typeLabel}</Chip.Label>
              </Chip>
            </View>
            <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>
              {t('context.title', { type: typeLabel, id: context.id })}
            </Text>
          </View>
          <Ionicons name="open-outline" size={18} color={primary} />
        </HeroCard.Body>
      </HeroCard>
    </HeroButton>
  );
}

function buildMessageActions(
  message: Message | null,
  t: (key: string, options?: Record<string, unknown>) => string,
  startEditingMessage: (message: Message) => void,
  handleDeleteMessage: (message: Message, scope: 'self' | 'everyone') => void,
) {
  if (!message) return [];
  return [
    ...(message.is_own ? [{
      label: t('thread.edit'),
      icon: 'pencil-outline',
      onPress: () => startEditingMessage(message),
    }] : []),
    {
      label: t('thread.deleteForMe'),
      icon: 'trash-outline',
      destructive: true,
      onPress: () => handleDeleteMessage(message, 'self'),
    },
    {
      label: t('thread.deleteForEveryone'),
      icon: 'trash-bin-outline',
      destructive: true,
      onPress: () => handleDeleteMessage(message, 'everyone'),
    },
  ];
}

function MessageBubble({
  item,
  primary,
  theme,
  t,
  unknownMemberLabel,
  onReact,
  onOptions,
}: {
  item: Message;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, options?: Record<string, unknown>) => string;
  unknownMemberLabel: string;
  onReact: (messageId: number, emoji: string) => void;
  onOptions: (message: Message) => void;
}) {
  const isOwn = item.is_own;
  const senderName = displayName(item.sender, unknownMemberLabel);
  const reactions = item.reactions ?? {};
  const hasReactions = Object.keys(reactions).length > 0;
  const body = item.body || item.content || '';

  return (
    <View className={`my-1.5 flex-row items-end gap-2 ${isOwn ? 'justify-end pl-12' : 'justify-start pr-12'}`}>
      {!isOwn ? <Avatar uri={item.sender?.avatar_url ?? null} name={senderName} size={32} /> : null}
      <View className={`max-w-[82%] gap-1.5 ${isOwn ? 'items-end' : 'items-start'}`}>
        <View
          className="rounded-[20px] px-4 pb-2.5 pt-3 shadow-sm"
          style={isOwn
            ? { backgroundColor: primary, borderBottomRightRadius: 4 }
            : { backgroundColor: theme.surface, borderBottomLeftRadius: 4, borderColor: theme.borderSubtle, borderWidth: 1 }}
        >
          {item.is_deleted ? (
            <Text className={`text-[14px] italic ${isOwn ? 'text-white/80' : 'text-foreground'}`}>
              {t('thread.deletedMessage')}
            </Text>
          ) : item.is_voice && item.audio_url ? (
            <VoiceMessageBubble
              audioUrl={resolveMediaUrl(item.audio_url) ?? item.audio_url}
              isOwn={isOwn}
              primaryColor={primary}
              textColor={theme.text}
              textColorSecondary={theme.textSecondary}
            />
          ) : item.is_voice ? (
            <View className="flex-row items-center gap-1.5">
              <Ionicons name="mic" size={16} color={isOwn ? 'rgba(255,255,255,0.9)' : theme.textSecondary} />
              <Text className={`text-[14px] italic ${isOwn ? 'text-white' : 'text-foreground'}`}>
                {t('thread.voiceMessage')}
              </Text>
            </View>
          ) : (
            <Text className={`text-[15px] leading-6 ${isOwn ? 'text-white' : 'text-foreground'}`}>
              {body}
            </Text>
          )}
          {!item.is_deleted && item.attachments?.length ? (
            <View className={`${body ? 'mt-2' : ''} gap-2`}>
              {item.attachments.map((attachment) => {
                const isImage = attachment.type === 'image' || attachment.mime_type?.startsWith('image/');
                const attachmentLabel = attachment.name || t('thread.attachments.file');
                return (
                  <HeroButton
                    key={String(attachment.id)}
                    variant="ghost"
                    accessibilityLabel={t('thread.attachments.open', { name: attachmentLabel })}
                    className="self-start rounded-panel-inner p-0"
                    onPress={() => {
                      if (attachment.url) {
                        void openAuthenticatedMessageMedia(attachment.url, attachmentLabel);
                      }
                    }}
                  >
                    {isImage ? (
                      <AuthenticatedMessageImage path={attachment.url} />
                    ) : (
                      <View className="max-w-[220px] flex-row items-center gap-2 rounded-panel-inner px-3 py-2" style={{ backgroundColor: isOwn ? 'rgba(255,255,255,0.14)' : theme.bg }}>
                        <Ionicons name="document-text-outline" size={18} color={isOwn ? '#fff' : theme.textSecondary} />
                        <View className="min-w-0 flex-1">
                          <Text className={`text-xs font-medium ${isOwn ? 'text-white' : 'text-foreground'}`} numberOfLines={1}>
                            {attachmentLabel}
                          </Text>
                          {attachment.size ? (
                            <Text className="text-[10px]" style={{ color: isOwn ? 'rgba(255,255,255,0.7)' : theme.textMuted }}>
                              {formatFileSize(attachment.size)}
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    )}
                  </HeroButton>
                );
              })}
            </View>
          ) : null}
          {item.is_edited && !item.is_deleted ? (
            <Text className="mt-0.5 text-[10px]" style={{ color: isOwn ? 'rgba(255,255,255,0.6)' : theme.textMuted }}>
              {t('thread.edited')}
            </Text>
          ) : null}
          <Text
            className="mt-1 text-[10px]"
            style={isOwn
              ? { color: 'rgba(255,255,255,0.75)', textAlign: 'right' }
              : { color: theme.textMuted, textAlign: 'right' }}
          >
            {formatTime(item.created_at)}
          </Text>
        </View>
        {hasReactions ? (
          <View className="flex-row flex-wrap gap-1.5">
            {Object.entries(reactions).map(([emoji, count]) => (
              <HeroButton
                key={emoji}
                size="sm"
                variant="outline"
                accessibilityRole="button"
                accessibilityLabel={t('thread.toggleReaction', { emoji })}
                className="rounded-full px-2 py-1"
                onPress={() => onReact(item.id, emoji)}
              >
                <Text className="text-xs">{emoji}</Text>
                <Text className="text-[11px] font-semibold" style={{ color: theme.textSecondary }}>{count}</Text>
              </HeroButton>
            ))}
          </View>
        ) : null}
        {!item.is_deleted ? (
          <View className="flex-row flex-wrap gap-1">
            {REACTION_EMOJIS.slice(0, 3).map((emoji) => (
              <HeroButton
                key={emoji}
                isIconOnly
                size="sm"
                variant="secondary"
                accessibilityRole="button"
                accessibilityLabel={t('thread.reactWith', { emoji })}
                className="h-8 w-8 rounded-full"
                onPress={() => onReact(item.id, emoji)}
              >
                <Text className="text-sm">{emoji}</Text>
              </HeroButton>
            ))}
            {!item.is_voice ? (
              <HeroButton
                isIconOnly
                size="sm"
                variant="secondary"
                accessibilityRole="button"
                accessibilityLabel={t('thread.messageOptions')}
                className="h-8 w-8 rounded-full"
                onPress={() => onOptions(item)}
              >
                <Ionicons name="ellipsis-horizontal" size={16} color={theme.textSecondary} />
              </HeroButton>
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

function EmptyThread({ primary, text }: { primary: string; text: string }) {
  return (
    <HeroCard variant="secondary" className="mx-4 my-8">
      <HeroCard.Body className="items-center gap-3 px-5 py-6">
        <Ionicons name="chatbubble-ellipses-outline" size={34} color={primary} />
        <Text className="text-center text-sm leading-5 text-muted-foreground">{text}</Text>
      </HeroCard.Body>
    </HeroCard>
  );
}

function ThreadShell({ title, backLabel, children }: { title: string; backLabel: string; children: React.ReactNode }) {
  const theme = useTheme();

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={title} backLabel={backLabel} fallbackHref="/(tabs)/messages" />
      <View className="flex-1 items-center justify-center px-6" style={{ flex: 1, backgroundColor: theme.bg }}>{children}</View>
    </SafeAreaView>
  );
}

function CenteredState({
  icon,
  text,
  primary,
  children,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  text: string;
  primary: string;
  children?: React.ReactNode;
}) {
  return (
    <HeroCard variant="secondary" className="w-full">
      <HeroCard.Body className="items-center gap-4 px-5 py-6">
        <Ionicons name={icon} size={34} color={primary} />
        <Text className="text-center text-sm leading-5 text-muted-foreground">{text}</Text>
        {children}
      </HeroCard.Body>
    </HeroCard>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function resolveThreadContext(listingId: number | undefined, contextType: string | undefined, contextId: number | undefined): ThreadContext | null {
  if (listingId) return { type: 'listing', id: listingId };
  if (!contextType || !contextId || !isThreadContextType(contextType)) return null;
  return { type: contextType, id: contextId };
}

function resolveMessageThreadContext(messages: Message[] | undefined): ThreadContext | null {
  if (!messages?.length) return null;
  for (const message of messages) {
    const listingId = parsePositiveIntValue(message.listing_id);
    const contextId = parsePositiveIntValue(message.context_id);
    const context = resolveThreadContext(listingId, message.context_type ?? undefined, contextId);
    if (context) return context;
  }
  return null;
}

function isThreadContextType(value: string): value is ThreadContextType {
  return Object.prototype.hasOwnProperty.call(THREAD_CONTEXT_CONFIG, value);
}

function parsePositiveInt(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parsePositiveIntValue(value: number | string | null | undefined): number | undefined {
  if (value == null) return undefined;
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRecordingTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}
