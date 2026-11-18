// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * One turn of the AI Assistant conversation: the member's question, the
 * assistant's answer (with its formatting, cards, sources, copy and
 * thumbs), an error with "Try again", and the "Thinking…" placeholder.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import Bot from 'lucide-react/icons/bot';
import BookOpen from 'lucide-react/icons/book-open';
import AlertCircle from 'lucide-react/icons/circle-alert';
import ThumbsUp from 'lucide-react/icons/thumbs-up';
import ThumbsDown from 'lucide-react/icons/thumbs-down';
import Copy from 'lucide-react/icons/copy';
import Check from 'lucide-react/icons/check';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import { Button, Chip } from '@/components/ui';
import { getFormattingLocale } from '@/lib/helpers';
import { safeHref } from '@/lib/safeHref';
import { useTenant } from '@/contexts';
import { ToolResultCards, isInternalUrl, type ToolInvocation } from './ToolResultCards';
import { AiChatMarkdown, answerPlainText } from './AiChatMarkdown';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ChatSource {
  type: string;
  id: number | string;
  title: string;
  url?: string;
  audience?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isError?: boolean;
  /** For an error: the question that failed, so "Try again" can resend it. */
  retryText?: string;
  /** For an answer or error: the question it belongs to (scrolling, retry). */
  questionId?: string;
  sources?: ChatSource[];
  toolInvocations?: ToolInvocation[];
  traceId?: number | null;
  messageId?: number | null;
  feedback?: 'up' | 'down' | null;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(getFormattingLocale(), { hour: '2-digit', minute: '2-digit' });
}

// ─────────────────────────────────────────────────────────────────────────────
// Assistant avatar
// ─────────────────────────────────────────────────────────────────────────────

export function AssistantAvatar() {
  return (
    <div
      className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-strong to-accent-strong-end text-white shadow-sm"
      aria-hidden="true"
    >
      <Bot className="h-4 w-4" />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The member's question
// ─────────────────────────────────────────────────────────────────────────────

export function UserMessage({ message }: { message: ChatMessage }) {
  const { t } = useTranslation('chat');

  return (
    <div className="flex justify-end" data-chat-question={message.id}>
      <div className="flex max-w-[88%] flex-col items-end gap-1 sm:max-w-[75%]">
        <div className="whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-gradient-to-br from-accent-strong to-accent-strong-end px-4 py-2.5 text-[0.9375rem] leading-relaxed text-white shadow-sm">
          <span className="sr-only">{t('sr_you')}: </span>
          {message.content}
        </div>
        <span className="px-1 text-xs text-[var(--color-text-muted)]">{formatTime(message.timestamp)}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sources ("From the help guides")
// ─────────────────────────────────────────────────────────────────────────────

function SourceChips({ sources }: { sources: ChatSource[] }) {
  const { t } = useTranslation('chat');
  const { tenantPath } = useTenant();
  if (sources.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t('sources_label')}>
      <span className="me-0.5 text-xs font-medium text-[var(--color-text-muted)]">{t('sources_label')}:</span>
      {sources.map((source) => {
        const key = `${source.type}-${source.id}`;
        const chip = (
          <Chip
            size="sm"
            variant="flat"
            color="default"
            startContent={<BookOpen className="h-3 w-3 shrink-0" aria-hidden="true" />}
            // The cap must clip inside the chip: with it on the outer box only,
            // long titles spilled over the next chip (18 Nov 2026).
            className="max-w-[13rem] overflow-hidden text-xs"
            classNames={{ content: 'block min-w-0 truncate' }}
            title={source.title}
          >
            {source.title}
          </Chip>
        );

        if (!source.url) return <span key={key}>{chip}</span>;

        return isInternalUrl(source.url) ? (
          <Link key={key} to={tenantPath(source.url)} className="inline-flex max-w-full" title={source.title}>
            {chip}
          </Link>
        ) : (
          <a
            key={key}
            href={safeHref(source.url)}
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
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// The assistant's answer
// ─────────────────────────────────────────────────────────────────────────────

interface AssistantMessageProps {
  message: ChatMessage;
  onFeedback?: (messageClientId: string, vote: 'up' | 'down') => void;
  onRetry?: (message: ChatMessage) => void;
  onCopyFailed?: () => void;
  isBusy?: boolean;
}

export function AssistantMessage({ message, onFeedback, onRetry, onCopyFailed, isBusy = false }: AssistantMessageProps) {
  const { t } = useTranslation('chat');
  const answerRef = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const sources = message.sources?.length ? message.sources.slice(0, 4) : [];
  const toolInvocations = message.toolInvocations?.length ? message.toolInvocations : [];
  const canVote = Boolean(onFeedback && (message.traceId || message.messageId));

  const copyAnswer = async () => {
    const text = answerPlainText(answerRef.current, message.content);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      onCopyFailed?.();
    }
  };

  if (message.isError) {
    return (
      <div className="flex items-start gap-3">
        <AssistantAvatar />
        <div className="min-w-0 flex-1">
          <div
            className="rounded-2xl rounded-tl-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200"
            role="alert"
          >
            {/* The general message already says "That didn't work"; a heading
                saying it again only for that case read as a stutter. */}
            {message.content === t('error_generic') ? (
              <p className="flex items-start gap-1.5 font-medium">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{message.content}</span>
              </p>
            ) : (
              <>
                <div className="mb-1 flex items-center gap-1.5 font-semibold">
                  <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{t('error_label')}</span>
                </div>
                <p>{message.content}</p>
              </>
            )}
            {message.retryText && onRetry && (
              <Button
                size="sm"
                variant="secondary"
                className="mt-3"
                startContent={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
                onPress={() => onRetry(message)}
                isDisabled={isBusy}
              >
                {t('retry')}
              </Button>
            )}
          </div>
          <span className="mt-1 block px-1 text-xs text-[var(--color-text-muted)]">{formatTime(message.timestamp)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-3">
      <AssistantAvatar />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="rounded-2xl rounded-tl-md border border-[var(--border-default)] bg-[var(--color-surface)] px-4 py-3 shadow-sm">
          <span className="sr-only">{t('sr_assistant')}: </span>
          <div ref={answerRef}>
            <AiChatMarkdown content={message.content} />
          </div>
        </div>

        {toolInvocations.length > 0 && <ToolResultCards invocations={toolInvocations} />}
        {sources.length > 0 && <SourceChips sources={sources} />}

        <div className="flex flex-wrap items-center gap-1 text-xs text-[var(--color-text-muted)]">
          <span className="px-1">{formatTime(message.timestamp)}</span>
          <Button
            size="sm"
            variant="ghost"
            onPress={() => void copyAnswer()}
            aria-label={copied ? t('copied') : t('copy_answer')}
            className="h-7 min-w-0 gap-1 px-2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" aria-hidden="true" />
            ) : (
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span aria-hidden="true">{copied ? t('copied') : t('copy_answer')}</span>
          </Button>
          {canVote && (
            <>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                aria-label={t('thumbs_up_aria')}
                aria-pressed={message.feedback === 'up'}
                onPress={() => onFeedback?.(message.id, 'up')}
                className={`h-7 w-7 min-w-7 ${
                  message.feedback === 'up'
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-[var(--color-text-muted)] hover:text-green-600 dark:hover:text-green-400'
                }`}
              >
                <ThumbsUp className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
              <Button
                isIconOnly
                size="sm"
                variant="ghost"
                aria-label={t('thumbs_down_aria')}
                aria-pressed={message.feedback === 'down'}
                onPress={() => onFeedback?.(message.id, 'down')}
                className={`h-7 w-7 min-w-7 ${
                  message.feedback === 'down'
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-[var(--color-text-muted)] hover:text-red-600 dark:hover:text-red-400'
                }`}
              >
                <ThumbsDown className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// "Thinking…" while an answer is on its way
// ─────────────────────────────────────────────────────────────────────────────

/** After this long the placeholder says it is still working. */
export const THINKING_SLOW_MS = 8000;

export function ThinkingIndicator() {
  const { t } = useTranslation('chat');
  const [isSlow, setIsSlow] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setIsSlow(true), THINKING_SLOW_MS);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="flex items-start gap-3" role="status">
      <AssistantAvatar />
      <div className="flex items-center gap-3 rounded-2xl rounded-tl-md border border-[var(--border-default)] bg-[var(--color-surface)] px-4 py-3 shadow-sm">
        <span className="flex items-center gap-1" aria-hidden="true">
          <span className="h-2 w-2 animate-bounce rounded-full bg-accent motion-reduce:animate-none [animation-delay:-0.3s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-accent motion-reduce:animate-none [animation-delay:-0.15s]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-accent motion-reduce:animate-none" />
        </span>
        <span className="text-sm text-[var(--color-text-muted)]">{isSlow ? t('thinking_long') : t('thinking')}</span>
      </div>
    </div>
  );
}
