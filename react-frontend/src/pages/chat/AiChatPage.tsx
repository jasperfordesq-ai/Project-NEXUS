import { getFormattingLocale, resolveUserDisplayName } from '@/lib/helpers';
import { Button, Textarea, Card, CardBody, Chip, Avatar } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AI Chat Page
 *
 * Full-height chat interface for the AI assistant feature.
 * Uses POST /api/ai/chat for non-streaming responses.
 * Manages conversation history in local state and sends it with each request.
 * Feature-gated by 'ai_chat'.
 */

import { useState, useEffect, useRef, useCallback, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from '@/lib/motion';
import { ScrollShadow } from '@/components/ui';
import Bot from 'lucide-react/icons/bot';
import BookOpen from 'lucide-react/icons/book-open';
import Send from 'lucide-react/icons/send';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Sparkles from 'lucide-react/icons/sparkles';
import AlertCircle from 'lucide-react/icons/circle-alert';
import Zap from 'lucide-react/icons/zap';
import ThumbsUp from 'lucide-react/icons/thumbs-up';
import ThumbsDown from 'lucide-react/icons/thumbs-down';
import { useAuth, useTenant, useToast } from '@/contexts';
import api from '@/lib/api';
import { usePageTitle } from '@/hooks';
import { useVisualViewport } from '@/hooks/useVisualViewport';
import { PageMeta } from '@/components/seo';
import { Link } from 'react-router-dom';
import { ToolResultCards, isInternalUrl, type ToolInvocation } from './ToolResultCards';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isError?: boolean;
  sources?: ChatSource[];
  toolInvocations?: ToolInvocation[];
  traceId?: number | null;
  messageId?: number | null;
  feedback?: 'up' | 'down' | null;
}

interface ChatSource {
  type: string;
  id: number | string;
  title: string;
  url?: string;
  audience?: string;
}

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
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suggested starter questions
// ─────────────────────────────────────────────────────────────────────────────

const STARTER_QUESTION_KEYS = [
  'starter_q1',
  'starter_q2',
  'starter_q3',
  'starter_q4',
  'starter_q5',
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Typing indicator
// ─────────────────────────────────────────────────────────────────────────────

function TypingIndicator() {
  const { t } = useTranslation('chat');

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      className="flex items-end gap-2 mb-4"
    >
      <Avatar
        icon={<Bot className="w-4 h-4" aria-hidden="true" />}
        size="sm"
        classNames={{
          base: 'bg-gradient-to-br from-accent to-accent-gradient-end flex-shrink-0',
          icon: 'text-white',
        }}
      />
      <div className="bg-[var(--color-surface)] border border-[var(--border-default)] rounded-2xl rounded-bl-sm px-4 py-3">
        <div className="flex items-center gap-1" role="status" aria-label={t('typing_aria')}>
          {[0, 1, 2].map((i) => (
            <motion.span
              key={i}
              className="w-2 h-2 rounded-full bg-accent"
              animate={{ opacity: [0.3, 1, 0.3], y: [0, -4, 0] }}
              transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }}
            />
          ))}
        </div>
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Message bubble
// ─────────────────────────────────────────────────────────────────────────────

interface MessageBubbleProps {
  message: ChatMessage;
  userName?: string;
  userAvatar?: string;
  onFeedback?: (messageClientId: string, vote: 'up' | 'down') => void;
}

function MessageBubble({ message, userName, userAvatar, onFeedback }: MessageBubbleProps) {
  const { t } = useTranslation('chat');
  const isUser = message.role === 'user';
  const time = message.timestamp.toLocaleTimeString(getFormattingLocale(), { hour: '2-digit', minute: '2-digit' });
  const sources = !isUser && message.sources?.length ? message.sources.slice(0, 4) : [];
  const toolInvocations = !isUser && message.toolInvocations?.length ? message.toolInvocations : [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className={`flex items-end gap-2 mb-4 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
    >
      {/* Avatar */}
      {isUser ? (
        <Avatar
          name={userName}
          src={userAvatar}
          size="sm"
          showFallback
          classNames={{ base: 'flex-shrink-0' }}
        />
      ) : (
        <Avatar
          icon={<Bot className="w-4 h-4" aria-hidden="true" />}
          size="sm"
          classNames={{
            base: 'bg-gradient-to-br from-accent to-accent-gradient-end flex-shrink-0',
            icon: 'text-white',
          }}
        />
      )}

      {/* Bubble */}
      <div className={`max-w-[80%] sm:max-w-[70%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
        <div
          className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
            isUser
              ? 'bg-gradient-to-br from-accent to-accent-gradient-end text-white rounded-br-sm'
              : message.isError
              ? 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 rounded-bl-sm'
              : 'bg-[var(--color-surface)] border border-[var(--border-default)] text-[var(--color-text)] rounded-bl-sm'
          }`}
        >
          {message.isError && (
            <div className="flex items-center gap-1.5 mb-1 font-medium">
              <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="text-xs">{t('error_label')}</span>
            </div>
          )}
          {message.content}
        </div>
        <div className="flex items-center gap-2 px-1">
          <span className="text-xs text-[var(--color-text-muted)]">{time}</span>
          {!isUser && !message.isError && onFeedback && (message.traceId || message.messageId) && (
            <div className="flex items-center gap-1">
              <Button
                isIconOnly
                size="sm"
                variant="light"
                aria-label={t('thumbs_up_aria')}
                onPress={() => onFeedback(message.id, 'up')}
                className={`h-6 min-w-6 ${
                  message.feedback === 'up'
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-[var(--color-text-muted)] hover:text-green-600 dark:hover:text-green-400'
                }`}
              >
                <ThumbsUp className="w-3.5 h-3.5" aria-hidden="true" />
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant="light"
                aria-label={t('thumbs_down_aria')}
                onPress={() => onFeedback(message.id, 'down')}
                className={`h-6 min-w-6 ${
                  message.feedback === 'down'
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-[var(--color-text-muted)] hover:text-red-600 dark:hover:text-red-400'
                }`}
              >
                <ThumbsDown className="w-3.5 h-3.5" aria-hidden="true" />
              </Button>
            </div>
          )}
        </div>
        {toolInvocations.length > 0 && <ToolResultCards invocations={toolInvocations} />}
        {sources.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 px-1" role="group" aria-label={t('sources_label')}>
            {sources.map((source) => {
              const chip = (
                <Chip
                  key={`${source.type}-${source.id}`}
                  size="sm"
                  variant="flat"
                  color="default"
                  startContent={<BookOpen className="h-3 w-3 shrink-0" aria-hidden="true" />}
                  className="max-w-[13rem] text-xs"
                >
                  <span className="truncate">{source.title}</span>
                </Chip>
              );

              if (!source.url) return chip;

              return isInternalUrl(source.url) ? (
                <Link
                  key={`${source.type}-${source.id}`}
                  to={source.url}
                  className="inline-flex max-w-full"
                  title={source.title}
                >
                  {chip}
                </Link>
              ) : (
                <a
                  key={`${source.type}-${source.id}`}
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-full"
                  title={source.title}
                >
                  {chip}
                </a>
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature not available state
// ─────────────────────────────────────────────────────────────────────────────

function FeatureNotAvailable() {
  const { t } = useTranslation('chat');

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-16 text-center">
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent to-accent-gradient-end dark:from-accent/30 dark:to-accent-gradient-end/30 flex items-center justify-center mb-4">
        <Bot className="w-8 h-8 text-accent" aria-hidden="true" />
      </div>
      <h2 className="text-xl font-semibold text-[var(--color-text)] mb-2">{t('feature_unavailable_title')}</h2>
      <p className="text-[var(--color-text-muted)] max-w-sm">
        {t('feature_unavailable_description')}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────────────────────

interface EmptyStateProps {
  onQuestionClick: (q: string) => void;
  starters: string[];
}

function EmptyState({ onQuestionClick, starters }: EmptyStateProps) {
  const { t } = useTranslation('chat');
  // Fall back to the static i18n questions if the server hasn't returned
  // dynamic starters yet (initial render before the /starters call resolves).
  const questions = starters.length > 0 ? starters : STARTER_QUESTION_KEYS.map((k) => t(k));

  return (
    <div className="flex flex-col items-center justify-center h-full px-4 py-8">
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4 }}
        className="w-20 h-20 rounded-2xl bg-gradient-to-br from-accent to-accent-gradient-end flex items-center justify-center mb-5 shadow-lg"
      >
        <Sparkles className="w-10 h-10 text-white" aria-hidden="true" />
      </motion.div>

      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.3 }}
        className="text-center mb-8"
      >
        <h2 className="text-2xl font-bold text-[var(--color-text)] mb-2">{t('empty_title')}</h2>
        <p className="text-[var(--color-text-muted)] max-w-sm">
          {t('empty_description')}
        </p>
      </motion.div>

      <motion.div
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.2, duration: 0.3 }}
        className="w-full max-w-md"
      >
        <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider mb-3 text-center">
          {t('try_asking')}
        </p>
        <div className="flex flex-col gap-2">
          {questions.map((question, i) => (
            <motion.div
              key={`${i}-${question}`}
              initial={{ x: -10, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: 0.25 + i * 0.06, duration: 0.25 }}
            >
              <Button
                variant="flat"
                onPress={() => onQuestionClick(question)}
                className="w-full text-left px-4 py-3 rounded-xl bg-[var(--color-surface)] border border-[var(--border-default)] text-sm text-[var(--color-text)] hover:border-accent hover:bg-accent-soft dark:hover:bg-accent/20 transition-all justify-start min-h-9"
              >
                {question}
              </Button>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export default function AiChatPage() {
  const { t } = useTranslation('chat');

  usePageTitle(t('page_title'));

  const { user } = useAuth();
  const { hasFeature } = useTenant();
  const { warning, error: toastError } = useToast();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [limits, setLimits] = useState<{ daily_remaining: number; monthly_remaining: number } | null>(null);
  const [starters, setStarters] = useState<string[]>([]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Feature check
  const isEnabled = hasFeature('ai_chat');

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Fetch tenant-tailored starter prompts once on mount
  useEffect(() => {
    if (!isEnabled) return;
    void (async () => {
      try {
        const res = await api.get<{ starters: string[] }>('/ai/chat/starters');
        if (res.data?.starters?.length) {
          setStarters(res.data.starters);
        }
      } catch {
        // Non-critical — fall back to i18n defaults
      }
    })();
  }, [isEnabled]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isLoading) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const body: Record<string, unknown> = { message: trimmed };
      if (conversationId) body['conversation_id'] = conversationId;

      const res = await api.post<AiChatResponse>('/ai/chat', body);

      // api.post unwraps `response.data.data` if present, otherwise returns the full body.
      // See AiChatResponse type comment above for shape details.
      const data = res.data;

      if (res.success && data?.message) {
        const assistantMsg: ChatMessage = {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: data.message.content,
          timestamp: new Date(),
          sources: data.sources ?? [],
          toolInvocations: data.tool_invocations ?? [],
          traceId: data.trace_id ?? null,
          messageId: data.message.id,
          feedback: null,
        };
        setMessages(prev => [...prev, assistantMsg]);

        if (data.conversation_id) {
          setConversationId(data.conversation_id);
        }
        if (data.limits) {
          setLimits(data.limits);
        }
      } else {
        const errorText = data?.error ?? res.error ?? t('error_generic');
        const isLimit = res.code === 'HTTP_429';

        const errorMsg: ChatMessage = {
          id: `error-${Date.now()}`,
          role: 'assistant',
          content: isLimit
            ? t('error_rate_limit')
            : errorText,
          timestamp: new Date(),
          isError: true,
        };
        setMessages(prev => [...prev, errorMsg]);

        if (isLimit) {
          warning(t('toast_rate_limit'));
        }
      }
    } catch {
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: 'assistant',
        content: t('error_connection'),
        timestamp: new Date(),
        isError: true,
      };
      setMessages(prev => [...prev, errorMsg]);
      toastError(t('toast_connection_error'));
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, conversationId, warning, toastError, t]);

  const handleFeedback = useCallback(async (messageClientId: string, vote: 'up' | 'down') => {
    const msg = messages.find((m) => m.id === messageClientId);
    if (!msg || (!msg.traceId && !msg.messageId)) return;
    // Optimistically toggle: clicking the same vote a second time clears it.
    const next = msg.feedback === vote ? null : vote;
    setMessages((prev) => prev.map((m) => (m.id === messageClientId ? { ...m, feedback: next } : m)));
    if (next === null) return; // we don't support clearing on the server yet — just keep the UI in sync
    const revert = () =>
      setMessages((prev) => prev.map((m) => (m.id === messageClientId ? { ...m, feedback: msg.feedback ?? null } : m)));
    try {
      const res = await api.post('/ai/chat/feedback', {
        feedback: vote,
        trace_id: msg.traceId ?? undefined,
        message_id: msg.messageId ?? undefined,
      });
      // api.post resolves { success:false } on a 4xx/5xx WITHOUT throwing, so the
      // catch alone never fired for a failed vote — the optimistic highlight stayed
      // as if it persisted. Revert it when the server didn't accept the feedback.
      if (!res.success) revert();
    } catch {
      revert();
    }
  }, [messages]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  };

  // iOS Safari does not shrink 100dvh for the soft keyboard (Android does,
  // via interactive-widget=resizes-content), so subtract the visual-viewport
  // inset and keep the latest message in view while the keyboard is up.
  const keyboardOffset = useVisualViewport();
  useEffect(() => {
    if (keyboardOffset > 0) {
      messagesEndRef.current?.scrollIntoView({ block: 'end' });
    }
  }, [keyboardOffset]);

  const handleNewConversation = () => {
    setMessages([]);
    setConversationId(null);
    setLimits(null);
    setInput('');
    textareaRef.current?.focus();
  };

  // Resolve avatar
  const userAvatarUrl = user?.avatar_url ?? user?.avatar ?? undefined;

  if (!isEnabled) {
    return (
      <div className="min-h-[calc(100vh-4rem)] flex flex-col">
        <FeatureNotAvailable />
      </div>
    );
  }

  const hasMessages = messages.length > 0;

  return (
    <div
      // --keyboard-offset is genuinely dynamic (visualViewport-driven); see
      // the identical exception for ConversationPage in check-design-tokens.
      style={{ '--keyboard-offset': `${keyboardOffset}px` } as CSSProperties}
      className="flex flex-col h-[calc(100dvh-4rem-var(--keyboard-offset,0px))]"
      role="region"
      aria-label={t('aria_chat')}
    >
      <PageMeta title={t('page_meta.title')} noIndex />
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-default)] bg-[var(--color-surface)] flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-accent to-accent-gradient-end flex items-center justify-center">
            <Bot className="w-5 h-5 text-white" aria-hidden="true" />
          </div>
          <div>
            <h1 className="font-semibold text-[var(--color-text)]">{t('header_title')}</h1>
            <p className="text-xs text-[var(--color-text-muted)]">{t('header_subtitle')}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {limits && (
            <Chip
              size="sm"
              variant="flat"
              color="default"
              startContent={<Zap className="w-3 h-3" aria-hidden="true" />}
              className="text-xs hidden sm:flex"
            >
              {t('limits_left_today', { count: limits.daily_remaining })}
            </Chip>
          )}
          {hasMessages && (
            <Button
              size="sm"
              variant="light"
              isIconOnly
              onPress={handleNewConversation}
              aria-label={t('new_conversation_aria')}
              className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
            >
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-hidden relative">
        <ScrollShadow
          ref={scrollRef}
          className="h-full overflow-y-auto px-4 py-4"
          hideScrollBar={false}
        >
          {!hasMessages ? (
            <EmptyState onQuestionClick={(q) => void sendMessage(q)} starters={starters} />
          ) : (
            <div className="max-w-2xl mx-auto" role="log" aria-live="polite" aria-label={t('messages_region')}>
              <AnimatePresence initial={false}>
                {messages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    userName={user ? resolveUserDisplayName(user) : undefined}
                    userAvatar={userAvatarUrl}
                    onFeedback={handleFeedback}
                  />
                ))}
              </AnimatePresence>

              {isLoading && (
                <AnimatePresence>
                  <TypingIndicator />
                </AnimatePresence>
              )}

              <div ref={messagesEndRef} aria-hidden="true" />
            </div>
          )}
        </ScrollShadow>
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 border-t border-[var(--border-default)] bg-[var(--color-surface)] px-4 py-3">
        <div className="max-w-2xl mx-auto">
          <Card
            className="bg-[var(--color-surface-elevated)] border border-[var(--border-default)] shadow-sm"
            radius="lg"
          >
            <CardBody className="p-0">
              <div className="flex items-end gap-2 p-2">
                <Textarea
                  ref={textareaRef}
                  aria-label={t('input_aria')}
                  placeholder={t('input_placeholder')}
                  value={input}
                  enterKeyHint="send"
                  onValueChange={setInput}
                  onKeyDown={handleKeyDown}
                  minRows={1}
                  maxRows={5}
                  classNames={{
                    base: 'flex-1',
                    inputWrapper: 'bg-transparent border-0 shadow-none p-0 hover:bg-transparent focus-within:bg-transparent data-[hover=true]:bg-transparent',
                    input: 'text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] resize-none px-2 py-1.5',
                  }}
                  disabled={isLoading}
                />
                <Button
                  isIconOnly
                  color="primary"
                  className="bg-gradient-to-br from-accent to-accent-gradient-end text-white flex-shrink-0 mb-0.5"
                  size="sm"
                  onPress={() => void sendMessage(input)}
                  isDisabled={!input.trim() || isLoading}
                  aria-label={t('send_aria')}
                >
                  <Send className="w-4 h-4" aria-hidden="true" />
                </Button>
              </div>
            </CardBody>
          </Card>
          <p className="text-center text-xs text-[var(--color-text-muted)] mt-2">
            {t('disclaimer')}
          </p>
        </div>
      </div>
    </div>
  );
}
