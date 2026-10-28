// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * GroupConversationPage — a group chat thread (`/messages/group/:id`).
 *
 * Backed by GroupConversationController:
 *   GET  /v2/conversations/{id}/messages  — newest first, `cursor` pages older;
 *        meta carries the conversation (active participants) and the
 *        server's safeguarding decision for this member and this group
 *   POST /v2/conversations/{id}/messages  — { body }, max 10,000 characters
 * plus the shared message reaction endpoints. Group messages are not
 * broadcast in real time (Laravel has no live contract for them), so the
 * thread polls for newer messages while the tab is visible.
 *
 * Kept separate from the one-to-one ConversationPage on purpose: that page's
 * id is the OTHER MEMBER's user id, so a group id must never reach it.
 */

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import Send from 'lucide-react/icons/send';
import Users from 'lucide-react/icons/users';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { PageMeta } from '@/components/seo';
import { useAuth, useTenant, useToast } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api, type ApiResponse } from '@/lib/api';
import { logError } from '@/lib/logger';
import type { Message } from '@/types/api';
import { MessageBubble } from './components/MessageBubble';
import { GroupMembersModal, type GroupParticipant } from './components/GroupMembersModal';

const PAGE_SIZE = 50;
const MAX_BODY_LENGTH = 10000;
const POLL_INTERVAL_MS = 20000;
const SAFEGUARDING_CODES = new Set(['VETTING_REQUIRED', 'SAFEGUARDING_CONTACT_RESTRICTED', 'SAFEGUARDING_POLICY_UNAVAILABLE']);

interface GroupMessageSender {
  id: number;
  name?: string;
  first_name?: string;
  avatar_url?: string | null;
}

interface GroupMessage {
  id: number;
  conversation_id?: number;
  sender_id: number;
  body: string;
  is_edited?: boolean;
  is_deleted?: boolean;
  is_voice?: boolean;
  audio_url?: string | null;
  audio_duration?: number | null;
  transcript?: string | null;
  created_at: string;
  sender?: GroupMessageSender | null;
}

interface GroupConversationMeta {
  id: number;
  group_name?: string | null;
  participant_count?: number;
  participants?: Array<{ id: number; name?: string; role?: string }>;
}

interface GroupSafeguarding {
  restricted: boolean;
  code?: string;
  title?: string | null;
  message?: string | null;
  detail?: string | null;
}

interface GroupMessagesMeta {
  conversation?: GroupConversationMeta;
  cursor?: string | null;
  has_more?: boolean;
  safeguarding?: GroupSafeguarding | null;
}

type ViewMessage = Message & { senderName: string; senderAvatar?: string | null };

function toViewMessage(m: GroupMessage, viewerId: number | undefined, fallbackName: string): ViewMessage {
  const senderName = m.sender?.name || m.sender?.first_name || fallbackName;
  return {
    id: m.id,
    body: m.body,
    sender_id: m.sender_id,
    is_own: viewerId !== undefined && m.sender_id === viewerId,
    is_voice: m.is_voice ?? false,
    audio_url: m.audio_url ?? undefined,
    audio_duration: m.audio_duration ?? undefined,
    transcript: m.transcript ?? undefined,
    is_edited: m.is_edited ?? false,
    is_deleted: m.is_deleted ?? false,
    created_at: m.created_at,
    senderName,
    senderAvatar: m.sender?.avatar_url ?? null,
  };
}

/** The reactions batch returns `{ [messageId]: [{ emoji, count }] }`. */
function reactionMap(raw: unknown): Record<number, Record<string, number>> {
  const out: Record<number, Record<string, number>> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, entries] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    const counts: Record<string, number> = {};
    for (const entry of entries as Array<{ emoji?: unknown; count?: unknown }>) {
      if (typeof entry?.emoji === 'string' && typeof entry.count === 'number' && entry.count > 0) {
        counts[entry.emoji] = entry.count;
      }
    }
    out[Number(id)] = counts;
  }
  return out;
}

function safeguardingFromFailure(res: ApiResponse<unknown>): GroupSafeguarding | null {
  const first = res.errors?.[0];
  const code = res.code || first?.code;
  if (!code || !SAFEGUARDING_CODES.has(code)) return null;
  return {
    restricted: true,
    code,
    title: typeof first?.title === 'string' ? first.title : null,
    message: first?.message ?? res.error ?? null,
    detail: typeof first?.detail === 'string' ? first.detail : null,
  };
}

export function GroupConversationPage() {
  const { t } = useTranslation('messages');
  const { id } = useParams<{ id: string }>();
  const conversationId = Number(id);
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const { tenantPath, hasFeature } = useTenant();
  const isDirectMessagingEnabled = hasFeature('direct_messaging');
  const viewerId = user?.id;

  const [messages, setMessages] = useState<ViewMessage[]>([]);
  const [conversation, setConversation] = useState<GroupConversationMeta | null>(null);
  const [safeguarding, setSafeguarding] = useState<GroupSafeguarding | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const [loadError, setLoadError] = useState<'not_found' | 'failed' | null>(null);
  const [messagingRestricted, setMessagingRestricted] = useState(false);
  const [body, setBody] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isMembersOpen, setIsMembersOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const newestIdRef = useRef<number | null>(null);

  const groupName = conversation?.group_name?.trim() || t('group_chat_title');
  usePageTitle(groupName);

  const fallbackName = t('unknown_user');

  const loadReactions = useCallback(async (ids: number[]) => {
    if (ids.length === 0) return;
    try {
      const res = await api.get<{ reactions?: unknown }>(`/v2/messages/reactions/batch?ids=${ids.slice(0, 100).join(',')}`);
      if (!res.success) return;
      const map = reactionMap(res.data?.reactions);
      setMessages((prev) => prev.map((m) => (map[m.id] ? { ...m, reactions: map[m.id] } : m)));
    } catch {
      // Reaction counts are decoration; the thread still works without them.
    }
  }, []);

  const applyMeta = useCallback((meta: GroupMessagesMeta | undefined) => {
    if (!meta) return;
    if (meta.conversation) setConversation(meta.conversation);
    if ('safeguarding' in meta) setSafeguarding(meta.safeguarding?.restricted ? meta.safeguarding : null);
  }, []);

  const load = useCallback(async () => {
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      setLoadError('not_found');
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = await api.get<GroupMessage[]>(`/v2/conversations/${conversationId}/messages?per_page=${PAGE_SIZE}`);
      if (!res.success || !Array.isArray(res.data)) {
        setLoadError(res.code === 'FORBIDDEN' || res.code === 'NOT_FOUND' ? 'not_found' : 'failed');
        return;
      }
      const meta = res.meta as GroupMessagesMeta | undefined;
      const items = [...res.data].reverse().map((m) => toViewMessage(m, viewerId, fallbackName));
      setMessages(items);
      newestIdRef.current = items.length ? items[items.length - 1]!.id : null;
      setCursor(meta?.cursor ?? null);
      setHasMore(Boolean(meta?.has_more));
      applyMeta(meta);
      void loadReactions(items.map((m) => m.id));
    } catch (err) {
      logError('Failed to load group conversation', err);
      setLoadError('failed');
    } finally {
      setIsLoading(false);
    }
  }, [applyMeta, conversationId, fallbackName, loadReactions, viewerId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    api.get<{ messaging_disabled: boolean }>('/v2/messages/restriction-status')
      .then((res) => {
        if (!cancelled && res.success && res.data?.messaging_disabled) setMessagingRestricted(true);
      })
      .catch(() => { /* non-critical */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [messages.length]);

  const loadOlder = async () => {
    if (!cursor) return;
    setIsLoadingOlder(true);
    try {
      const res = await api.get<GroupMessage[]>(
        `/v2/conversations/${conversationId}/messages?per_page=${PAGE_SIZE}&cursor=${encodeURIComponent(cursor)}`,
      );
      if (res.success && Array.isArray(res.data)) {
        const meta = res.meta as GroupMessagesMeta | undefined;
        const older = [...res.data].reverse().map((m) => toViewMessage(m, viewerId, fallbackName));
        setMessages((prev) => {
          const known = new Set(prev.map((m) => m.id));
          return [...older.filter((m) => !known.has(m.id)), ...prev];
        });
        setCursor(meta?.cursor ?? null);
        setHasMore(Boolean(meta?.has_more));
        void loadReactions(older.map((m) => m.id));
      } else {
        toast.error(t('group_load_failed'));
      }
    } catch (err) {
      logError('Failed to load older group messages', err);
      toast.error(t('group_load_failed'));
    } finally {
      setIsLoadingOlder(false);
    }
  };

  // Group messages have no live broadcast, so ask for anything newer while the
  // tab is visible. Edits/deletes are not part of the group contract.
  useEffect(() => {
    if (loadError || isLoading) return undefined;
    const timer = setInterval(async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      const newest = newestIdRef.current;
      if (newest === null) return;
      try {
        const res = await api.get<GroupMessage[]>(
          `/v2/conversations/${conversationId}/messages?per_page=${PAGE_SIZE}&direction=newer&cursor=${encodeURIComponent(btoa(String(newest)))}`,
        );
        if (!res.success || !Array.isArray(res.data)) return;
        applyMeta(res.meta as GroupMessagesMeta | undefined);
        if (res.data.length === 0) return;
        const incoming = res.data.map((m) => toViewMessage(m, viewerId, fallbackName));
        setMessages((prev) => {
          const known = new Set(prev.map((m) => m.id));
          return [...prev, ...incoming.filter((m) => !known.has(m.id))];
        });
        newestIdRef.current = Math.max(newest, ...incoming.map((m) => m.id));
      } catch {
        // Silent: the next tick retries.
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [applyMeta, conversationId, fallbackName, isLoading, loadError, viewerId]);

  const isActiveMember = viewerId !== undefined
    && (conversation?.participants ?? []).some((p) => p.id === viewerId);
  const canSend = isDirectMessagingEnabled && !messagingRestricted && isActiveMember && !safeguarding?.restricted;

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const text = body.trim();
    if (!text || isSending) return;
    if (text.length > MAX_BODY_LENGTH) {
      toast.error(t('group_message_too_long'));
      return;
    }
    setIsSending(true);
    try {
      const res = await api.post<GroupMessage>(`/v2/conversations/${conversationId}/messages`, { body: text });
      if (res.success && res.data) {
        const sent = toViewMessage(res.data, viewerId, fallbackName);
        setMessages((prev) => (prev.some((m) => m.id === sent.id) ? prev : [...prev, sent]));
        newestIdRef.current = Math.max(newestIdRef.current ?? 0, sent.id);
        setBody('');
        return;
      }
      const restriction = safeguardingFromFailure(res);
      if (restriction) {
        setSafeguarding(restriction);
      } else {
        toast.error(t('send_error'));
      }
    } catch (err) {
      logError('Failed to send group message', err);
      toast.error(t('send_error'));
    } finally {
      setIsSending(false);
    }
  };

  const react = useCallback(async (messageId: number, emoji: string) => {
    try {
      const res = await api.post<{ action: 'added' | 'removed' }>(`/v2/messages/${messageId}/reactions`, { emoji });
      if (!res.success || !res.data) {
        toast.error(res.error || t('group_action_failed'));
        return;
      }
      const delta = res.data.action === 'added' ? 1 : -1;
      setMessages((prev) => prev.map((m) => {
        if (m.id !== messageId) return m;
        const reactions = { ...(m.reactions ?? {}) };
        const next = (reactions[emoji] ?? 0) + delta;
        if (next > 0) reactions[emoji] = next; else delete reactions[emoji];
        return { ...m, reactions };
      }));
    } catch (err) {
      logError('Failed to toggle group message reaction', err);
      toast.error(t('group_action_failed'));
    }
  }, [t, toast]);

  const handleMembersChanged = (participants: GroupParticipant[]) => {
    setConversation((prev) => (prev ? {
      ...prev,
      participants: participants.map((p) => ({ id: p.id, name: p.name, role: p.role })),
      participant_count: participants.length,
    } : prev));
  };

  const backPath = tenantPath('/messages?tab=groups');

  if (isLoading) {
    return (
      <div className="flex justify-center py-16" role="status" aria-label={t('loading')}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <GlassCard role="alert" className="p-8 text-center">
          <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-[var(--color-warning)]" aria-hidden="true" />
          <p className="mb-4 text-theme-primary">
            {loadError === 'not_found' ? t('group_not_found') : t('group_load_failed')}
          </p>
          <div className="flex justify-center gap-2">
            {loadError === 'failed' && (
              <Button variant="secondary" onPress={() => void load()}>{t('try_again')}</Button>
            )}
            <Link to={backPath} className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline">
              {t('back_to_messages')}
            </Link>
          </div>
        </GlassCard>
      </div>
    );
  }

  const participantCount = conversation?.participant_count ?? conversation?.participants?.length ?? 0;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-4">
      <PageMeta title={groupName} noIndex />

      <div className="flex items-center gap-3">
        <Link
          to={backPath}
          aria-label={t('back_to_messages')}
          className="inline-flex h-10 w-10 items-center justify-center rounded-full text-theme-muted hover:bg-theme-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-bold text-theme-primary">{groupName}</h1>
          <p className="text-sm text-theme-muted">{t('group_members', { count: participantCount })}</p>
        </div>
        {isActiveMember && (
          <Button
            variant="secondary"
            startContent={<Users className="h-4 w-4" aria-hidden="true" />}
            onPress={() => setIsMembersOpen(true)}
          >
            {t('group_members_button')}
          </Button>
        )}
      </div>

      {(!isDirectMessagingEnabled || messagingRestricted) && isActiveMember && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4" role="status">
          <p className="text-sm font-semibold text-theme-danger">{t('messaging_restricted_title')}</p>
          <p className="mt-1 text-sm text-theme-muted">{t('messaging_restricted_desc')}</p>
        </div>
      )}

      {safeguarding?.restricted && isActiveMember && (
        <div
          className="flex flex-col gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-4 sm:flex-row sm:items-start"
          role="alert"
        >
          <AlertTriangle className="h-5 w-5 shrink-0 text-[var(--color-error)]" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-theme-danger">{safeguarding.title || t('group_restricted_title')}</p>
            <p className="mt-1 text-sm text-theme-muted">
              {safeguarding.detail || safeguarding.message || t('group_restricted_body')}
            </p>
          </div>
        </div>
      )}

      {!isActiveMember && (
        <p className="rounded-lg bg-theme-elevated p-3 text-sm text-theme-muted" role="status">{t('group_left_notice')}</p>
      )}

      <section aria-label={groupName} className="flex flex-col gap-1">
        {hasMore && cursor && (
          <div className="flex justify-center pb-2">
            <Button size="sm" variant="tertiary" onPress={() => void loadOlder()} isLoading={isLoadingOlder}>
              {t('group_show_older')}
            </Button>
          </div>
        )}

        {messages.length === 0 ? (
          <p className="py-8 text-center text-theme-subtle">{t('group_empty')}</p>
        ) : (
          <ol className="flex flex-col gap-1" role="log" aria-live="polite">
            {messages.map((m, index) => {
              const previous = messages[index - 1];
              const startsRun = !previous || previous.sender_id !== m.sender_id;
              const isOwn = Boolean(m.is_own);
              return (
                <li key={m.id}>
                  {startsRun && !isOwn && (
                    <p className="ms-12 mt-2 text-xs font-medium text-theme-muted">{m.senderName}</p>
                  )}
                  <MessageBubble
                    message={m}
                    isOwn={isOwn}
                    showAvatar={startsRun}
                    otherUser={{ id: m.sender_id, name: m.senderName, avatar_url: m.senderAvatar ?? null }}
                    onReact={isActiveMember ? (messageId, emoji) => void react(messageId, emoji) : undefined}
                  />
                </li>
              );
            })}
          </ol>
        )}
        <div ref={endRef} aria-hidden="true" />
      </section>

      {canSend && (
        <form onSubmit={(e) => void send(e)} className="flex items-end gap-2" noValidate>
          <Textarea
            aria-label={t('group_composer_label')}
            placeholder={t('type_placeholder')}
            value={body}
            onValueChange={setBody}
            minRows={1}
            maxRows={6}
            maxLength={MAX_BODY_LENGTH}
            className="flex-1"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
          />
          <Button
            type="submit"
            isIconOnly
            aria-label={t('aria_send_message')}
            isDisabled={!body.trim() || isSending}
            isLoading={isSending}
            className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
          </Button>
        </form>
      )}

      {isActiveMember && (
        <GroupMembersModal
          isOpen={isMembersOpen}
          onClose={() => setIsMembersOpen(false)}
          conversationId={conversationId}
          onLeft={() => navigate(backPath)}
          onMembersChanged={handleMembersChanged}
        />
      )}
    </div>
  );
}

export default GroupConversationPage;
