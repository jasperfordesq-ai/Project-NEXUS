// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Chip, Spinner, Surface } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import {
  getChatStarters,
  sendChatMessage,
  submitChatFeedback,
  type ChatFeedbackVote,
  type ChatMessage,
  type ChatSource,
  type ToolInvocation,
} from '@/lib/api/chat';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import AppTopBar from '@/components/ui/AppTopBar';
import Avatar from '@/components/ui/Avatar';
import BottomSheet from '@/components/ui/BottomSheet';
import Input from '@/components/ui/Input';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import AccentIcon from '@/components/ui/AccentIcon';

type DisplayMessage = ChatMessage | { id: string; role: 'thinking'; content: string; created_at: string };
type FeedbackState = Record<string, ChatFeedbackVote>;
type PendingFeedbackNote = {
  messageId: string;
  traceId: number | null;
  numericMessageId: number | null;
};

const THINKING_ID = '__thinking__';
const FALLBACK_STARTER_KEYS = ['starter_q1', 'starter_q2', 'starter_q3', 'starter_q4', 'starter_q5'] as const;

function nowIso() {
  return new Date().toISOString();
}

function messageTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function avatarForUser(user: unknown) {
  if (!user || typeof user !== 'object') return null;
  const candidate = user as { avatar_url?: string | null; avatar?: string | null };
  return candidate.avatar_url ?? candidate.avatar ?? null;
}

function TypingIndicator({ t }: { t: (key: string) => string }) {
  return (
    <View className="min-h-6 flex-row items-center gap-2">
      <Spinner size="sm" />
      <Text className="text-sm text-muted-foreground">{t('typing_aria')}</Text>
    </View>
  );
}

function SourceChips({
  sources,
  theme,
}: {
  sources: ChatSource[];
  theme: ReturnType<typeof useTheme>;
}) {
  if (sources.length === 0) return null;

  return (
    <View className="mt-2 flex-row flex-wrap gap-2">
      {sources.slice(0, 4).map((source) => (
        <Chip key={`${source.type}-${source.id}`} size="sm" variant="secondary">
          <Ionicons name="book-outline" size={12} color={theme.textSecondary} />
          <Chip.Label numberOfLines={1}>{source.title}</Chip.Label>
        </Chip>
      ))}
    </View>
  );
}

function getResultTitle(item: Record<string, unknown>) {
  return String(item.title ?? item.name ?? item.summary ?? item.label ?? '');
}

function getResultSubtitle(item: Record<string, unknown>) {
  const parts = [
    item.tagline,
    item.location,
    item.excerpt,
    item.salary,
    item.price,
    item.condition,
  ]
    .filter((value) => typeof value === 'string' && value.trim().length > 0)
    .map(String);
  return parts[0] ?? '';
}

function getResultIcon(cardType: string): ComponentProps<typeof Ionicons>['name'] {
  switch (cardType) {
    case 'listing':
      return 'pricetag-outline';
    case 'member':
      return 'person-outline';
    case 'event':
      return 'calendar-outline';
    case 'job':
      return 'briefcase-outline';
    case 'marketplace':
      return 'bag-handle-outline';
    case 'kb':
      return 'book-outline';
    case 'wallet':
      return 'wallet-outline';
    default:
      return 'sparkles-outline';
  }
}

function ToolResultCards({
  invocations,
  primary,
  theme,
  t,
}: {
  invocations: ToolInvocation[];
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const renderableInvocations = invocations.filter((invocation) => invocation.ok && Array.isArray(invocation.results) && invocation.results.length > 0);
  if (renderableInvocations.length === 0) return null;

  return (
    <View className="mt-3 gap-2">
      <Text className="px-1 text-[11px] font-semibold uppercase" style={{ color: theme.textSecondary }}>
        {t('tool_results.label')}
      </Text>
      {renderableInvocations.map((invocation, invocationIndex) => (
        <View key={`${invocation.name}-${invocationIndex}`} className="gap-2">
          {invocation.results.slice(0, 6).map((item, resultIndex) => {
            const title = getResultTitle(item) || t('tool_results.fallbackTitle');
            const subtitle = getResultSubtitle(item);
            const url = typeof item.url === 'string' && item.url.trim() ? item.url : null;
            return (
              <HeroButton
                key={`${invocation.card_type}-${String(item.id ?? resultIndex)}`}
                variant="ghost"
                feedbackVariant="scale"
                className="w-full rounded-panel-inner p-0"
                isDisabled={!url}
                accessibilityLabel={t('tool_results.open', { title })}
                onPress={() => {
                  if (url) void Linking.openURL(url);
                }}
              >
                <Surface
                  variant="secondary"
                  className="w-full flex-row items-start gap-3 rounded-panel-inner p-3"
                  style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
                >
                  <View className="size-9 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                    <Ionicons name={getResultIcon(invocation.card_type)} size={17} color={primary} />
                  </View>
                  <View className="min-w-0 flex-1 gap-1">
                    <View className="flex-row items-start gap-2">
                      <Text className="min-w-0 flex-1 text-sm font-semibold" style={{ color: theme.text }} numberOfLines={2}>
                        {title}
                      </Text>
                      {url ? <Ionicons name="open-outline" size={14} color={theme.textSecondary} /> : null}
                    </View>
                    {subtitle ? (
                      <Text className="text-xs leading-4" style={{ color: theme.textSecondary }} numberOfLines={2}>
                        {subtitle}
                      </Text>
                    ) : null}
                    <Chip size="sm" variant="secondary">
                      <Chip.Label>{t(`tool_results.type.${invocation.card_type}`, { defaultValue: invocation.card_type })}</Chip.Label>
                    </Chip>
                  </View>
                </Surface>
              </HeroButton>
            );
          })}
        </View>
      ))}
    </View>
  );
}

function MessageBubble({
  message,
  primary,
  theme,
  userName,
  userAvatar,
  t,
  feedback,
  onFeedback,
}: {
  message: DisplayMessage;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  userName: string;
  userAvatar?: string | null;
  t: (key: string, opts?: Record<string, unknown>) => string;
  feedback?: ChatFeedbackVote;
  onFeedback?: (message: ChatMessage, vote: ChatFeedbackVote) => void;
}) {
  const isUser = message.role === 'user';
  const isThinking = message.role === 'thinking';
  const isError = 'is_error' in message && message.is_error === true;
  const sources = 'sources' in message && message.sources ? message.sources : [];
  const toolInvocations = 'tool_invocations' in message && message.tool_invocations ? message.tool_invocations : [];
  const canRate = !isUser && !isThinking && !isError && ('trace_id' in message || 'message_id' in message);

  return (
    <View className={`mb-4 flex-row items-end gap-2 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}>
      {isUser ? (
        <Avatar uri={userAvatar ?? null} name={userName || t('you')} size={32} />
      ) : (
        <View className="size-9 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.16) }}>
          <Ionicons name="sparkles-outline" size={17} color={primary} />
        </View>
      )}

      <View className={`max-w-[84%] gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}>
        <View
          className={`rounded-3xl px-4 py-3 ${isUser ? 'rounded-br-md' : 'rounded-bl-md'}`}
          style={{
            backgroundColor: isUser
              ? primary
              : isError
                ? withAlpha(theme.error, 0.14)
                : theme.surface,
            borderWidth: isUser ? 0 : 1,
            borderColor: isError ? withAlpha(theme.error, 0.4) : theme.borderSubtle,
          }}
        >
          {isThinking ? (
            <TypingIndicator t={t} />
          ) : (
            <>
              {isError ? (
                <View className="mb-1 flex-row items-center gap-1.5">
                  <Ionicons name="alert-circle-outline" size={14} color={theme.error} />
                  <Text className="text-xs font-semibold" style={{ color: theme.error }}>
                    {t('error_label')}
                  </Text>
                </View>
              ) : null}
              <Text className="text-sm leading-5" style={{ color: isUser ? '#ffffff' : isError ? theme.error : theme.text }}>
                {message.content}
              </Text>
            </>
          )}
        </View>

        {!isThinking ? (
          <Text className="px-1 text-[11px]" style={{ color: theme.textMuted }}>
            {messageTime(message.created_at)}
          </Text>
        ) : null}
        {canRate ? (
          <View className="flex-row items-center gap-1 px-1">
            <Text className="mr-1 text-[11px]" style={{ color: theme.textMuted }}>
              {t('feedback.label')}
            </Text>
            {(['up', 'down'] as const).map((vote) => {
              const selected = feedback === vote;
              return (
                <HeroButton
                  key={vote}
                  isIconOnly
                  size="sm"
                  variant={selected ? 'primary' : 'secondary'}
                  accessibilityLabel={t(`feedback.${vote === 'up' ? 'upLabel' : 'downLabel'}`)}
                  onPress={() => onFeedback?.(message as ChatMessage, vote)}
                  style={selected ? { backgroundColor: vote === 'up' ? primary : theme.error } : undefined}
                >
                  <Ionicons
                    name={vote === 'up' ? 'thumbs-up-outline' : 'thumbs-down-outline'}
                    size={14}
                    color={selected ? '#ffffff' : vote === 'up' ? primary : theme.error}
                  />
                </HeroButton>
              );
            })}
          </View>
        ) : null}
        {!isUser && !isThinking ? <ToolResultCards invocations={toolInvocations} primary={primary} theme={theme} t={t} /> : null}
        {!isUser && !isThinking ? <SourceChips sources={sources} theme={theme} /> : null}
      </View>
    </View>
  );
}

function EmptyChat({
  starters,
  primary,
  theme,
  t,
  onStarterPress,
}: {
  starters: string[];
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string) => string;
  onStarterPress: (prompt: string) => void;
}) {
  return (
    <View className="flex-1 justify-center gap-5 px-4 py-6">
      <HeroCard
        variant="default"
        className="overflow-hidden rounded-panel p-0"
        style={{ borderWidth: 1, borderColor: withAlpha(primary, 0.16) }}
      >
        <View className="h-1" style={{ backgroundColor: primary }} />
        <HeroCard.Body className="items-center gap-4 p-5">
          <View className="size-16 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.16) }}>
            <Ionicons name="sparkles-outline" size={30} color={primary} />
          </View>
        <View className="items-center gap-1">
          <Text className="text-2xl font-bold" style={{ color: theme.text }} numberOfLines={2}>
            {t('empty_title')}
          </Text>
          <Text className="max-w-[320px] text-center text-sm leading-5" style={{ color: theme.textSecondary }}>
            {t('empty_description')}
          </Text>
        </View>
        </HeroCard.Body>
      </HeroCard>

      <Surface variant="secondary" className="gap-3 rounded-panel p-3">
        <Text className="px-1 text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>
          {t('try_asking')}
        </Text>
        {starters.map((question) => (
          <HeroButton
            key={question}
            variant="secondary"
            className="min-h-12 justify-start rounded-panel-inner px-3 py-2"
            onPress={() => onStarterPress(question)}
          >
            <Ionicons name="chatbubble-ellipses-outline" size={16} color={primary} />
            <HeroButton.Label numberOfLines={2}>{question}</HeroButton.Label>
          </HeroButton>
        ))}
      </Surface>
    </View>
  );
}

function ChatHeader({
  hasMessages,
  limits,
  primary,
  theme,
  t,
  onNewConversation,
}: {
  hasMessages: boolean;
  limits: { daily_remaining: number; monthly_remaining: number } | null;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
  onNewConversation: () => void;
}) {
  return (
    <View className="px-4 pb-3">
      <HeroCard
        variant="default"
        className="overflow-hidden rounded-panel p-0"
        style={{ borderWidth: 1, borderColor: withAlpha(primary, 0.14) }}
      >
        <View className="h-1" style={{ backgroundColor: primary }} />
        <HeroCard.Body className="gap-3 p-4">
          <View className="flex-row items-center gap-3">
            <View className="size-11 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.16) }}>
              <Ionicons name="sparkles-outline" size={21} color={primary} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-base font-bold" style={{ color: theme.text }} numberOfLines={1}>
                {t('header_title')}
              </Text>
              <Text className="text-xs" style={{ color: theme.textSecondary }} numberOfLines={2}>
                {t('header_subtitle')}
              </Text>
            </View>
            {hasMessages ? (
              <HeroButton isIconOnly variant="secondary" accessibilityLabel={t('new_conversation_aria')} onPress={onNewConversation}>
                <Ionicons name="refresh-outline" size={18} color={primary} />
              </HeroButton>
            ) : null}
          </View>
          {limits ? (
            <View className="items-start">
              <Chip size="sm" variant="secondary">
                <Ionicons name="flash-outline" size={13} color={primary} />
                <Chip.Label>{t('limits_left_today', { count: limits.daily_remaining })}</Chip.Label>
              </Chip>
            </View>
          ) : null}
        </HeroCard.Body>
      </HeroCard>
    </View>
  );
}

export default function ChatScreen() {
  return (
    <ModalErrorBoundary>
      <ChatScreenInner />
    </ModalErrorBoundary>
  );
}

function ChatScreenInner() {
  const { t } = useTranslation(['chat', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { user, displayName } = useAuth();

  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [starters, setStarters] = useState<string[]>([]);
  const [limits, setLimits] = useState<{ daily_remaining: number; monthly_remaining: number } | null>(null);
  const [feedbackState, setFeedbackState] = useState<FeedbackState>({});
  const [pendingFeedbackNote, setPendingFeedbackNote] = useState<PendingFeedbackNote | null>(null);
  const [feedbackNote, setFeedbackNote] = useState('');
  const [submittingFeedbackNote, setSubmittingFeedbackNote] = useState(false);
  const conversationIdRef = useRef<string | null>(null);
  const listRef = useRef<FlatList<DisplayMessage>>(null);
  const thinkingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fallbackStarters = useMemo(() => FALLBACK_STARTER_KEYS.map((key) => t(key)), [t]);
  const starterPrompts = starters.length > 0 ? starters : fallbackStarters;
  const userAvatar = avatarForUser(user);

  useEffect(() => {
    let cancelled = false;
    void getChatStarters()
      .then((response) => {
        if (!cancelled && Array.isArray(response.starters) && response.starters.length > 0) {
          setStarters(response.starters);
        }
      })
      .catch(() => {
        // Non-critical: the localized fallback prompts are shown instead.
      });
    return () => {
      cancelled = true;
      if (thinkingTimeoutRef.current) clearTimeout(thinkingTimeoutRef.current);
    };
  }, []);

  const scrollToBottom = useCallback(() => {
    if (listRef.current && messages.length > 0) {
      listRef.current.scrollToOffset({ offset: 0, animated: true });
    }
  }, [messages.length]);

  const startNewConversation = useCallback(() => {
    if (thinkingTimeoutRef.current) clearTimeout(thinkingTimeoutRef.current);
    thinkingTimeoutRef.current = null;
    conversationIdRef.current = null;
    setMessages([]);
    setFeedbackState({});
    setPendingFeedbackNote(null);
    setFeedbackNote('');
    setInputText('');
    setSending(false);
    setLimits(null);
  }, []);

  const handleSend = useCallback(async (rawText?: string) => {
    const text = (rawText ?? inputText).trim();
    if (!text || sending) return;

    setInputText('');
    setSending(true);

    const userMsg: ChatMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: text,
      created_at: nowIso(),
    };

    const thinkingMsg: DisplayMessage = {
      id: THINKING_ID,
      role: 'thinking',
      content: '',
      created_at: nowIso(),
    };

    setMessages((prev) => [thinkingMsg, userMsg, ...prev]);

    thinkingTimeoutRef.current = setTimeout(() => {
      setMessages((prev) => {
        if (!prev.some((m) => m.id === THINKING_ID)) return prev;
        const withoutThinking = prev.filter((m) => m.id !== THINKING_ID);
        return [{
          id: `timeout-${Date.now()}`,
          role: 'assistant',
          content: t('timeout'),
          created_at: nowIso(),
          is_error: true,
        }, ...withoutThinking];
      });
      setSending(false);
    }, 30_000);

    try {
      const result = await sendChatMessage(text, conversationIdRef.current);
      if (thinkingTimeoutRef.current) {
        clearTimeout(thinkingTimeoutRef.current);
        thinkingTimeoutRef.current = null;
      }

      conversationIdRef.current = result.data.conversation_id || conversationIdRef.current;
      setLimits(result.data.limits ?? null);
      const assistantMsg = result.data.message;

      setMessages((prev) => [assistantMsg, ...prev.filter((m) => m.id !== THINKING_ID)]);
    } catch {
      if (thinkingTimeoutRef.current) {
        clearTimeout(thinkingTimeoutRef.current);
        thinkingTimeoutRef.current = null;
      }
      setMessages((prev) => [{
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: t('error_connection'),
        created_at: nowIso(),
        is_error: true,
      }, ...prev.filter((m) => m.id !== THINKING_ID)]);
    } finally {
      setSending(false);
    }
  }, [inputText, sending, t]);

  const handleFeedback = useCallback(async (message: ChatMessage, vote: ChatFeedbackVote) => {
    const traceId = typeof message.trace_id === 'number' ? message.trace_id : null;
    const numericMessageId = typeof message.message_id === 'number' ? message.message_id : Number(message.id);
    const messageId = Number.isFinite(numericMessageId) ? numericMessageId : null;
    if (!traceId && !messageId) return;

    setFeedbackState((prev) => ({ ...prev, [message.id]: vote }));
    try {
      await submitChatFeedback({
        trace_id: traceId,
        message_id: messageId,
        feedback: vote,
      });
      if (vote === 'down') {
        setPendingFeedbackNote({ messageId: message.id, traceId, numericMessageId: messageId });
        setFeedbackNote('');
      } else {
        setPendingFeedbackNote(null);
        setFeedbackNote('');
      }
    } catch {
      setFeedbackState((prev) => {
        const next = { ...prev };
        delete next[message.id];
        return next;
      });
    }
  }, []);

  const closeFeedbackNote = useCallback(() => {
    setPendingFeedbackNote(null);
    setFeedbackNote('');
    setSubmittingFeedbackNote(false);
  }, []);

  const submitFeedbackNote = useCallback(async () => {
    const note = feedbackNote.trim();
    if (!pendingFeedbackNote || !note) {
      closeFeedbackNote();
      return;
    }

    setSubmittingFeedbackNote(true);
    try {
      await submitChatFeedback({
        trace_id: pendingFeedbackNote.traceId,
        message_id: pendingFeedbackNote.numericMessageId,
        feedback: 'down',
        note,
      });
      closeFeedbackNote();
    } catch {
      setSubmittingFeedbackNote(false);
    }
  }, [closeFeedbackNote, feedbackNote, pendingFeedbackNote]);

  const renderItem = useCallback(
    ({ item }: { item: DisplayMessage }) => (
      <MessageBubble
        message={item}
        primary={primary}
        theme={theme}
        userName={displayName}
        userAvatar={userAvatar}
        t={t}
        feedback={'id' in item ? feedbackState[item.id] : undefined}
        onFeedback={handleFeedback}
      />
    ),
    [displayName, feedbackState, handleFeedback, primary, t, theme, userAvatar],
  );

  const hasMessages = messages.length > 0;

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('page_title')} backLabel={t('common:back')} fallbackHref="/(tabs)/home" />
      <ChatHeader
        hasMessages={hasMessages}
        limits={limits}
        primary={primary}
        theme={theme}
        t={t}
        onNewConversation={startNewConversation}
      />

      <KeyboardAvoidingView
        className="flex-1"
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        {!hasMessages ? (
          <EmptyChat
            starters={starterPrompts}
            primary={primary}
            theme={theme}
            t={t}
            onStarterPress={(prompt) => void handleSend(prompt)}
          />
        ) : (
          <FlatList<DisplayMessage>
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderItem}
            inverted
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 18, paddingTop: 8 }}
            onContentSizeChange={scrollToBottom}
            accessibilityLabel={t('messages_region')}
          />
        )}

        <View className="bg-background px-4 pt-2" style={{ borderTopWidth: 1, borderTopColor: theme.borderSubtle }}>
          <HeroCard
            variant="default"
            className="overflow-hidden rounded-panel p-0"
            style={{ borderWidth: 1, borderColor: withAlpha(primary, 0.14) }}
          >
            <HeroCard.Body className="p-2.5">
              <View className="flex-row items-end gap-2.5">
                <Input
                  containerClassName="mb-0 flex-1"
                  inputClassName="min-h-12 flex-1 rounded-panel-inner px-3 py-2 text-sm"
                  style={{ maxHeight: 126, color: theme.text }}
                  placeholder={t('input_placeholder')}
                  placeholderTextColor={theme.textMuted}
                  value={inputText}
                  onChangeText={setInputText}
                  multiline
                  maxLength={2000}
                  editable={!sending}
                  accessibilityLabel={t('input_aria')}
                />
                <HeroButton
                  isIconOnly
                  variant="primary"
                  className="size-12"
                  accessibilityLabel={t('send_aria')}
                  isDisabled={!inputText.trim() || sending}
                  onPress={() => void handleSend()}
                >
                  {sending ? <Spinner size="sm" /> : <AccentIcon name="send" size={18} />}
                </HeroButton>
              </View>
            </HeroCard.Body>
          </HeroCard>
          <Text
            className="px-2 pt-2 text-center text-[11px]"
            style={{ color: theme.textMuted, paddingBottom: Math.max(8, insets.bottom) }}
          >
            {t('disclaimer')}
          </Text>
        </View>
      </KeyboardAvoidingView>
      <BottomSheet
        visible={Boolean(pendingFeedbackNote)}
        onClose={closeFeedbackNote}
        title={t('feedback.noteTitle')}
        snapPoints={['44%', '70%']}
      >
        <View className="gap-4 px-1 pb-2">
          <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
            {t('feedback.noteDescription')}
          </Text>
          <Input
            value={feedbackNote}
            onChangeText={setFeedbackNote}
            placeholder={t('feedback.notePlaceholder')}
            placeholderTextColor={theme.textMuted}
            multiline
            maxLength={500}
            accessibilityLabel={t('feedback.notePlaceholder')}
            inputClassName="min-h-[96px] px-3 py-2 text-sm"
            style={{ color: theme.text }}
          />
          <View className="flex-row gap-2">
            <HeroButton className="flex-1" variant="secondary" onPress={closeFeedbackNote} accessibilityLabel={t('feedback.skipNote')}>
              <HeroButton.Label>{t('feedback.skipNote')}</HeroButton.Label>
            </HeroButton>
            <HeroButton
              className="flex-1"
              variant="primary"
              isDisabled={!feedbackNote.trim() || submittingFeedbackNote}
              onPress={() => void submitFeedbackNote()}
              accessibilityLabel={t('feedback.submitNote')}
            >
              {submittingFeedbackNote ? <Spinner size="sm" /> : <HeroButton.Label>{t('feedback.submitNote')}</HeroButton.Label>}
            </HeroButton>
          </View>
        </View>
      </BottomSheet>
    </SafeAreaView>
  );
}
