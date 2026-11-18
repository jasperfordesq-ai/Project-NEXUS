// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AI Assistant page (/chat).
 *
 * Uses POST /api/ai/chat (no streaming: the server's stream endpoint answers
 * 501). Sends the conversation id with each request; past conversations can
 * be listed, reopened and deleted from the history dialog (AiChatHistory).
 * Feature-gated by 'ai_chat'.
 *
 * Rebuilt 18 Nov 2026 after the owner reported that sending a message
 * scrolled to the chat box and not to the answer:
 *   - only the conversation list scrolls, never the page (chatScroll.ts);
 *     a new answer is shown from its first line;
 *   - the chat fills the screen exactly, so the typing box is always on it
 *     (useChatFillHeight.ts and `[data-ai-chat]` in index.css);
 *   - answers keep their formatting (AiChatMarkdown.tsx);
 *   - the typing box stays usable while waiting and keeps the cursor;
 *   - a failed question can be tried again; an answer can be copied;
 *   - the open conversation survives leaving the page and coming back.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import Bot from 'lucide-react/icons/bot';
import Send from 'lucide-react/icons/send';
import Sparkles from 'lucide-react/icons/sparkles';
import Zap from 'lucide-react/icons/zap';
import History from 'lucide-react/icons/history';
import SquarePen from 'lucide-react/icons/square-pen';
import ArrowDown from 'lucide-react/icons/arrow-down';
import { Button, Chip, Spinner, Textarea } from '@/components/ui';
import { useAuth, useTenant, useToast } from '@/contexts';
import api from '@/lib/api';
import { usePageTitle } from '@/hooks';
import { useVisualViewport } from '@/hooks/useVisualViewport';
import { PageMeta } from '@/components/seo';
import type { ToolInvocation } from './ToolResultCards';
import { AiChatHistory, parseServerDate, type AiConversationDetail } from './AiChatHistory';
import {
  AssistantMessage,
  ThinkingIndicator,
  UserMessage,
  type ChatMessage,
  type ChatSource,
} from './AiChatMessage';
import { distanceFromBottom, NEAR_BOTTOM_PX, scrollListToBottom, scrollToAnswer } from './chatScroll';
import { useChatFillHeight } from './useChatFillHeight';

// The /ai/chat endpoint returns a non-standard envelope where `message` and
// `conversation_id` live at the top level of the response body. `api.post<T>`
// unwraps a nested `data` field if present, so when the backend returns a
// plain object (no `data` key), `res.data` === the raw body typed as T below.
interface AiChatResponse {
  conversation_id: number;
  message: {
    id: number;
    role: 'assistant';
    content: string;
  };
  tokens_used?: number;
  model?: string;
  provider?: string;
  sources?: ChatSource[];
  source_count?: number;
  tool_invocations?: ToolInvocation[];
  trace_id?: number | null;
  limits?: {
    daily_remaining: number;
    monthly_remaining: number;
  };
  error?: unknown;
}

const STARTER_QUESTION_KEYS = [
  'starter_q1',
  'starter_q2',
  'starter_q3',
  'starter_q4',
  'starter_q5',
] as const;

/**
 * The open conversation is remembered for this browser tab only, per member,
 * so following a link in an answer and coming back does not lose it. Only the
 * id is kept here; the conversation itself is read back from the member's own
 * history (Laravel scopes it to the member and community).
 */
export function conversationStorageKey(userId: number | string): string {
  return `nexus_ai_chat_conversation:${userId}`;
}

function readStoredConversationId(key: string | null): number | null {
  if (!key) return null;
  try {
    const raw = window.sessionStorage.getItem(key);
    const id = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

function writeStoredConversationId(key: string | null, id: number | null): void {
  if (!key) return;
  try {
    if (id) window.sessionStorage.setItem(key, String(id));
    else window.sessionStorage.removeItem(key);
  } catch {
    // Storage blocked (private mode): the conversation simply is not remembered.
  }
}

/** A mouse or trackpad, where putting the cursor in the box does not pop up a keyboard. */
function hasFinePointer(): boolean {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia('(pointer: fine)').matches;
  } catch {
    return false;
  }
}

/**
 * A server error message fit to show, or null. Some replies carry an object
 * here rather than text; putting that on screen crashed the whole page.
 */
export function readableError(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

type PendingScroll ={ kind: 'bottom' } | { kind: 'answer'; questionId: string; smooth: boolean };

let messageSequence = 0;
function nextMessageId(prefix: string): string {
  messageSequence += 1;
  return `${prefix}-${Date.now()}-${messageSequence}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature not available
// ─────────────────────────────────────────────────────────────────────────────

function FeatureNotAvailable() {
  const { t } = useTranslation('chat');

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-soft">
        <Bot className="h-8 w-8 text-accent" aria-hidden="true" />
      </div>
      <h1 className="mb-2 text-xl font-semibold text-[var(--color-text)]">{t('feature_unavailable_title')}</h1>
      <p className="max-w-sm text-[var(--color-text-muted)]">{t('feature_unavailable_description')}</p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────────────────────

interface EmptyStateProps {
  firstName?: string;
  starters: string[];
  onQuestionClick: (question: string) => void;
}

function EmptyState({ firstName, starters, onQuestionClick }: EmptyStateProps) {
  const { t } = useTranslation('chat');
  // Fall back to the static questions until the community's own arrive.
  const questions = starters.length > 0 ? starters : STARTER_QUESTION_KEYS.map((k) => t(k));

  return (
    <div className="flex min-h-full flex-col items-center justify-center px-2 py-6 text-center sm:py-10">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-strong to-accent-strong-end shadow-lg sm:h-16 sm:w-16">
        <Sparkles className="h-7 w-7 text-white sm:h-8 sm:w-8" aria-hidden="true" />
      </div>
      <h2 className="mb-2 text-xl font-bold text-[var(--color-text)] sm:text-2xl">
        {firstName ? t('empty_greeting', { name: firstName }) : t('empty_greeting_anonymous')}
      </h2>
      <p className="mb-6 max-w-md text-sm text-[var(--color-text-muted)] sm:mb-8 sm:text-base">{t('empty_description')}</p>

      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)]">{t('try_asking')}</p>
      <ul className="grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
        {questions.map((question, i) => (
          <li key={`${i}-${question}`}>
            <Button
              variant="tertiary"
              onPress={() => onQuestionClick(question)}
              className="h-auto min-h-12 w-full justify-start whitespace-normal rounded-xl border border-[var(--border-default)] bg-[var(--color-surface)] px-4 py-3 text-left text-sm font-normal text-[var(--color-text)] hover:border-accent hover:bg-accent-soft"
            >
              {question}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function AiChatPage() {
  const { t } = useTranslation('chat');
  usePageTitle(t('page_title'));

  const { user } = useAuth();
  const { hasFeature, tenant } = useTenant();
  const { warning, error: toastError } = useToast();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [limits, setLimits] = useState<{ daily_remaining: number; monthly_remaining: number } | null>(null);
  const [starters, setStarters] = useState<string[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [showJumpToLatest, setShowJumpToLatest] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingScrollRef = useRef<PendingScroll | null>(null);
  const isSendingRef = useRef(false);

  const isEnabled = hasFeature('ai_chat');
  const storageKey = user?.id ? conversationStorageKey(user.id) : null;

  // iOS Safari does not shrink the page for the on-screen keyboard; the
  // keyboard's height is taken off the chat's height instead.
  const keyboardOffset = useVisualViewport();
  const fillHeight = useChatFillHeight(rootRef, keyboardOffset);

  // ── Scrolling: only the list, never the page ──────────────────────────────
  useLayoutEffect(() => {
    const pending = pendingScrollRef.current;
    const list = listRef.current;
    if (!pending || !list) return;
    pendingScrollRef.current = null;

    if (pending.kind === 'bottom') {
      scrollListToBottom(list);
      return;
    }
    const question = list.querySelector<HTMLElement>(`[data-chat-question="${pending.questionId}"]`);
    if (question) scrollToAnswer(list, question, pending.smooth);
    else scrollListToBottom(list, pending.smooth);
  }, [messages, isLoading]);

  const handleListScroll = useCallback(() => {
    const list = listRef.current;
    if (!list) return;
    setShowJumpToLatest(distanceFromBottom(list) > Math.max(NEAR_BOTTOM_PX, list.clientHeight / 2));
  }, []);

  // The keyboard opening on a phone shrinks the list; keep the latest in view
  // if the member was already there.
  useEffect(() => {
    const list = listRef.current;
    if (keyboardOffset > 0 && list && distanceFromBottom(list) < NEAR_BOTTOM_PX * 2) {
      scrollListToBottom(list, false);
    }
  }, [keyboardOffset]);

  // ── Starter questions for this community ──────────────────────────────────
  useEffect(() => {
    if (!isEnabled) return;
    void (async () => {
      try {
        const res = await api.get<{ starters: string[] }>('/ai/chat/starters');
        if (res.data?.starters?.length) {
          setStarters(res.data.starters);
        }
      } catch {
        // Non-critical: the built-in questions are shown instead.
      }
    })();
  }, [isEnabled]);

  // Cursor in the box on arrival, where that does not open a phone keyboard.
  useEffect(() => {
    if (isEnabled && hasFinePointer()) {
      textareaRef.current?.focus({ preventScroll: true });
    }
  }, [isEnabled]);

  // ── Reopen / remember the conversation ────────────────────────────────────
  // Written only when the conversation actually changes. (An effect that
  // mirrored the state ran first on arrival, with no conversation yet, and
  // wiped the remembered id before it could be read back.)
  const rememberConversation = useCallback((id: number | null) => {
    setConversationId(id);
    writeStoredConversationId(storageKey, id);
  }, [storageKey]);

  const openConversation = useCallback((conversation: AiConversationDetail, smooth: boolean) => {
    const restored: ChatMessage[] = (conversation.messages ?? [])
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        id: `history-${m.id}`,
        role: m.role as 'user' | 'assistant',
        content: m.content,
        timestamp: parseServerDate(m.created_at) ?? new Date(),
        messageId: m.role === 'assistant' ? m.id : null,
        feedback: null,
      }));
    const lastQuestion = [...restored].reverse().find((m) => m.role === 'user');
    pendingScrollRef.current = lastQuestion
      ? { kind: 'answer', questionId: lastQuestion.id, smooth }
      : { kind: 'bottom' };
    setMessages(restored);
    rememberConversation(conversation.id);
    setLimits(null);
    setInput('');
  }, [rememberConversation]);

  useEffect(() => {
    if (!isEnabled) return;
    const storedId = readStoredConversationId(storageKey);
    if (!storedId) return;
    let cancelled = false;
    setIsRestoring(true);
    void (async () => {
      try {
        const res = await api.get<AiConversationDetail>(`/ai/conversations/${storedId}`);
        if (cancelled) return;
        if (res.success && res.data?.messages?.length) {
          openConversation(res.data, false);
        } else {
          writeStoredConversationId(storageKey, null);
        }
      } catch {
        if (!cancelled) writeStoredConversationId(storageKey, null);
      } finally {
        if (!cancelled) setIsRestoring(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs on arrival (and if the signed-in member changes); openConversation
    // only changes with storageKey.
  }, [isEnabled, storageKey, openConversation]);

  // ── Sending ───────────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text: string, retryOf?: ChatMessage) => {
    const trimmed = text.trim();
    if (!trimmed || isSendingRef.current) return;
    isSendingRef.current = true;

    let questionId: string;
    if (retryOf?.questionId) {
      questionId = retryOf.questionId;
      setMessages((prev) => prev.filter((m) => m.id !== retryOf.id));
    } else {
      questionId = nextMessageId('user');
      const userMsg: ChatMessage = {
        id: questionId,
        role: 'user',
        content: trimmed,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');
    }
    pendingScrollRef.current = { kind: 'bottom' };
    setIsLoading(true);

    const fail = (content: string) => {
      const errorMsg: ChatMessage = {
        id: nextMessageId('error'),
        role: 'assistant',
        content,
        timestamp: new Date(),
        isError: true,
        retryText: trimmed,
        questionId,
      };
      pendingScrollRef.current = { kind: 'answer', questionId, smooth: true };
      setMessages((prev) => [...prev, errorMsg]);
    };

    try {
      const body: Record<string, unknown> = { message: trimmed };
      if (conversationId) body['conversation_id'] = conversationId;

      const res = await api.post<AiChatResponse>('/ai/chat', body);
      const data = res.data;

      if (res.success && data?.message) {
        const assistantMsg: ChatMessage = {
          id: nextMessageId('assistant'),
          role: 'assistant',
          content: data.message.content,
          timestamp: new Date(),
          sources: data.sources ?? [],
          toolInvocations: data.tool_invocations ?? [],
          traceId: data.trace_id ?? null,
          messageId: data.message.id,
          feedback: null,
          questionId,
        };
        pendingScrollRef.current = { kind: 'answer', questionId, smooth: true };
        setMessages((prev) => [...prev, assistantMsg]);
        if (data.conversation_id) rememberConversation(data.conversation_id);
        if (data.limits) setLimits(data.limits);
      } else {
        const isLimit = res.code === 'HTTP_429';
        fail(isLimit ? t('error_rate_limit') : (readableError(data?.error) ?? readableError(res.error) ?? t('error_generic')));
        if (isLimit) warning(t('toast_rate_limit'));
      }
    } catch {
      fail(t('error_connection'));
      toastError(t('toast_connection_error'));
    } finally {
      isSendingRef.current = false;
      setIsLoading(false);
    }
  }, [conversationId, rememberConversation, warning, toastError, t]);

  const handleRetry = useCallback((message: ChatMessage) => {
    if (message.retryText) void sendMessage(message.retryText, message);
  }, [sendMessage]);

  const handleStarter = useCallback((question: string) => {
    void sendMessage(question);
    // The pressed button disappears with the empty state; put the cursor back
    // in the box where that does not open a phone keyboard.
    if (hasFinePointer()) textareaRef.current?.focus({ preventScroll: true });
  }, [sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (!isLoading && !isRestoring) void sendMessage(input);
    }
  };

  const handleFeedback = useCallback(async (messageClientId: string, vote: 'up' | 'down') => {
    const msg = messages.find((m) => m.id === messageClientId);
    if (!msg || (!msg.traceId && !msg.messageId)) return;
    // Optimistically toggle: pressing the same vote a second time clears it.
    const next = msg.feedback === vote ? null : vote;
    setMessages((prev) => prev.map((m) => (m.id === messageClientId ? { ...m, feedback: next } : m)));
    if (next === null) return; // the server cannot clear a vote yet; keep the screen in step
    const revert = () =>
      setMessages((prev) => prev.map((m) => (m.id === messageClientId ? { ...m, feedback: msg.feedback ?? null } : m)));
    try {
      const res = await api.post('/ai/chat/feedback', {
        feedback: vote,
        trace_id: msg.traceId ?? undefined,
        message_id: msg.messageId ?? undefined,
      });
      // api.post resolves { success:false } on a 4xx/5xx without throwing.
      if (!res.success) revert();
    } catch {
      revert();
    }
  }, [messages]);

  const handleCopyFailed = useCallback(() => {
    toastError(t('copy_failed'));
  }, [toastError, t]);

  const handleNewConversation = () => {
    setMessages([]);
    rememberConversation(null);
    setLimits(null);
    setInput('');
    setShowJumpToLatest(false);
    textareaRef.current?.focus({ preventScroll: true });
  };

  const handleOpenConversation = useCallback((conversation: AiConversationDetail) => {
    openConversation(conversation, false);
    setIsHistoryOpen(false);
  }, [openConversation]);

  const handleConversationDeleted = useCallback((deletedId: number) => {
    if (deletedId === conversationId) {
      setMessages([]);
      rememberConversation(null);
      setLimits(null);
    }
  }, [conversationId, rememberConversation]);

  const jumpToLatest = () => {
    if (listRef.current) scrollListToBottom(listRef.current);
  };

  if (!isEnabled) {
    return <FeatureNotAvailable />;
  }

  const hasMessages = messages.length > 0;
  const canSend = input.trim().length > 0 && !isLoading && !isRestoring;
  const communityName = tenant?.name?.trim();

  return (
    <div
      ref={rootRef}
      data-ai-chat=""
      // --chat-fill-height is measured at runtime (where the chat starts on
      // the page, the screen height, the iOS keyboard); see useChatFillHeight.
      // CSS in index.css turns it into the height, less the phone tab bar.
      style={fillHeight ? ({ '--chat-fill-height': `${fillHeight}px` } as CSSProperties) : undefined}
      className="mx-auto flex w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-[var(--border-default)] bg-[var(--color-surface)] shadow-sm"
      role="region"
      aria-label={t('aria_chat')}
    >
      <PageMeta title={t('page_meta.title')} noIndex />

      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border-default)] px-3 py-2.5 sm:px-5 sm:py-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent-strong to-accent-strong-end">
            <Bot className="h-5 w-5 text-white" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate font-semibold leading-tight text-[var(--color-text)]">{t('header_title')}</h1>
            {communityName && (
              <p className="truncate text-xs text-[var(--color-text-muted)]">
                {t('header_subtitle_community', { community: communityName })}
              </p>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1 sm:gap-2">
          {limits && (
            <Chip
              size="sm"
              variant="flat"
              color="default"
              startContent={<Zap className="h-3 w-3" aria-hidden="true" />}
              className="hidden text-xs sm:flex"
            >
              {t('limits_left_today', { count: limits.daily_remaining })}
            </Chip>
          )}
          <Button
            size="sm"
            variant="ghost"
            onPress={() => setIsHistoryOpen(true)}
            aria-label={t('history_button_aria')}
            className="min-w-0 gap-1.5 px-2 text-[var(--color-text-muted)] hover:text-[var(--color-text)] sm:px-3"
          >
            <History className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline" aria-hidden="true">{t('history_button_aria')}</span>
          </Button>
          {hasMessages && (
            <Button
              size="sm"
              variant="secondary"
              onPress={handleNewConversation}
              aria-label={t('new_conversation_aria')}
              className="min-w-0 gap-1.5 px-2 sm:px-3"
            >
              <SquarePen className="h-4 w-4" aria-hidden="true" />
              <span className="hidden sm:inline" aria-hidden="true">{t('new_conversation')}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Conversation */}
      <div className="relative min-h-0 flex-1">
        <div
          ref={listRef}
          onScroll={handleListScroll}
          className="h-full overflow-y-auto overscroll-contain"
          data-chat-scroll=""
        >
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-3 py-5 sm:px-6">
            {isRestoring && !hasMessages ? (
              <div className="flex flex-1 items-center justify-center gap-2 text-sm text-[var(--color-text-muted)]">
                <Spinner size="sm" aria-hidden="true" />
                <span role="status">{t('restoring')}</span>
              </div>
            ) : !hasMessages ? (
              <EmptyState firstName={user?.first_name} starters={starters} onQuestionClick={handleStarter} />
            ) : (
              <div className="flex flex-col gap-5" role="log" aria-live="polite" aria-relevant="additions" aria-label={t('messages_region')}>
                {messages.map((msg) =>
                  msg.role === 'user' ? (
                    <UserMessage key={msg.id} message={msg} />
                  ) : (
                    <AssistantMessage
                      key={msg.id}
                      message={msg}
                      onFeedback={handleFeedback}
                      onRetry={handleRetry}
                      onCopyFailed={handleCopyFailed}
                      isBusy={isLoading}
                    />
                  ),
                )}
                {isLoading && <ThinkingIndicator />}
              </div>
            )}
          </div>
        </div>

        {showJumpToLatest && (
          <Button
            isIconOnly
            size="sm"
            variant="secondary"
            onPress={jumpToLatest}
            aria-label={t('jump_to_latest')}
            className="absolute bottom-3 start-1/2 h-10 w-10 min-w-10 -translate-x-1/2 rounded-full border border-[var(--border-default)] bg-[var(--color-surface-elevated)] text-[var(--color-text)] shadow-lg hover:bg-[var(--color-surface)] rtl:translate-x-1/2"
          >
            <ArrowDown className="h-4 w-4" aria-hidden="true" />
          </Button>
        )}
      </div>

      {/* Typing box */}
      <div className="shrink-0 border-t border-[var(--border-default)] px-3 pb-[calc(0.5rem+var(--safe-area-bottom,0px))] pt-3 sm:px-5 sm:pb-3">
        <div className="mx-auto max-w-3xl">
          {/* The frame shows where the cursor is; the box inside draws no ring of its own. */}
          <div className="flex items-end gap-2 rounded-2xl border border-[var(--border-default)] bg-[var(--color-surface-elevated)] p-1.5 shadow-sm transition-[border-color,box-shadow] focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/25">
            <Textarea
              ref={textareaRef}
              aria-label={t('input_aria')}
              placeholder={t('composer_placeholder')}
              value={input}
              enterKeyHint="send"
              onValueChange={setInput}
              onKeyDown={handleKeyDown}
              minRows={1}
              maxRows={6}
              classNames={{
                base: 'flex-1',
                inputWrapper: 'bg-transparent border-0 shadow-none p-0 hover:bg-transparent focus:bg-transparent focus:border-transparent focus:shadow-none focus:ring-0 focus-visible:ring-0 data-[hover=true]:bg-transparent data-[focused=true]:shadow-none',
                input: 'text-[0.9375rem] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] resize-none px-2.5 py-2',
              }}
            />
            <Button
              isIconOnly
              color="primary"
              className="mb-0.5 h-10 w-10 min-w-10 shrink-0 rounded-xl bg-gradient-to-br from-accent-strong to-accent-strong-end text-white"
              onPress={() => void sendMessage(input)}
              isDisabled={!canSend}
              aria-label={t('send_aria')}
            >
              <Send className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          <p className="mt-2 text-center text-xs text-[var(--color-text-muted)]">
            <span className="hidden lg:inline">{t('composer_hint')} · </span>
            {t('disclaimer')}
          </p>
        </div>
      </div>

      <AiChatHistory
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        onOpenConversation={handleOpenConversation}
        onConversationDeleted={handleConversationDeleted}
      />
    </div>
  );
}
