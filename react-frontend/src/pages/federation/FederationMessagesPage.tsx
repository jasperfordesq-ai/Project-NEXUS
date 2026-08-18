// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Federation Messages Page - Cross-community messaging
 *
 * Two-panel layout (desktop) with conversation thread list + active thread view.
 * Supports compose via URL params (?compose=true&to_user=X&to_tenant=Y).
 *
 * API Endpoints:
 *   GET  /api/v2/federation/messages           - List message threads
 *   POST /api/v2/federation/messages           - Send a new message
 *   POST /api/v2/federation/messages/:id/mark-read - Mark thread as read
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { motion, AnimatePresence } from '@/lib/motion';

import MessageSquare from 'lucide-react/icons/message-square';
import Send from 'lucide-react/icons/send';
import Mail from 'lucide-react/icons/mail';
import MailOpen from 'lucide-react/icons/mail-open';
import Globe from 'lucide-react/icons/globe';
import ChevronRight from 'lucide-react/icons/chevron-right';
import Plus from 'lucide-react/icons/plus';
import Search from 'lucide-react/icons/search';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import Languages from 'lucide-react/icons/languages';

import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { SearchField } from '@/components/ui/SearchField';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { Tooltip } from '@/components/ui/Tooltip';
import { Breadcrumbs } from '@/components/navigation';
import { PageMeta } from '@/components/seo';
import { usePageTitle } from '@/hooks';
import { useAuth, useTenant, useToast } from '@/contexts';
import { usePusherOptional } from '@/contexts/PusherContext';
import { api } from '@/lib/api';
import { fetchUserFederationOptIn } from '@/lib/federationStatus';
import { resolveAvatarUrl, formatRelativeTime, getFormattingLocale } from '@/lib/helpers';
import { logError } from '@/lib/logger';
import { safeLocalStorageGetJSON, safeLocalStorageSetJSON } from '@/lib/safeStorage';
import type { FederatedMessage } from '@/types/api';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** A conversation thread grouped by the other participant */
interface FederatedThread {
  /** The other participant */
  partner: {
    id: number;
    name: string;
    avatar?: string | null;
    tenant_id: number | string;
    tenant_name: string;
  };
  /** All messages in the thread, chronological */
  messages: FederatedMessage[];
  /** Newest message in the thread (for sorting / preview) */
  lastMessage: FederatedMessage;
  /** Count of unread messages from the partner */
  unreadCount: number;
}

/** Recipient search result from federation member search */
interface FederatedMemberResult {
  id: number | string;
  name: string;
  avatar?: string | null;
  tenant_id: number | string;
  tenant_name: string;
  is_external?: boolean;
  partner_name?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Group flat messages into conversation threads keyed by partner.
 * The partner is whichever side is NOT the current user.
 */
function buildThreads(messages: FederatedMessage[], _currentUserId: number): FederatedThread[] {
  const threadMap = new Map<string, FederatedThread>();

  for (const msg of messages) {
    const isOutbound = msg.direction === 'outbound';
    const partner = isOutbound ? msg.receiver : msg.sender;
    const key = `${partner.id}-${partner.tenant_id}`;

    if (!threadMap.has(key)) {
      threadMap.set(key, {
        partner,
        messages: [],
        lastMessage: msg,
        unreadCount: 0,
      });
    }

    const thread = threadMap.get(key)!;
    thread.messages.push(msg);

    // Track the newest message
    if (new Date(msg.created_at) > new Date(thread.lastMessage.created_at)) {
      thread.lastMessage = msg;
    }

    // Count unread inbound messages
    if (!isOutbound && (msg.status === 'unread' || msg.status === 'delivered')) {
      thread.unreadCount += 1;
    }
  }

  // Sort threads by newest message first
  const threads = Array.from(threadMap.values());
  threads.sort(
    (a, b) => new Date(b.lastMessage.created_at).getTime() - new Date(a.lastMessage.created_at).getTime()
  );

  // Sort messages within each thread chronologically
  for (const thread of threads) {
    thread.messages.sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
    );
  }

  return threads;
}

// ─────────────────────────────────────────────────────────────────────────────
// Animation variants
// ─────────────────────────────────────────────────────────────────────────────

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.04 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, x: -16 },
  visible: { opacity: 1, x: 0 },
};

const bubbleVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0 },
};

const LANG_NAMES: Record<string, string> = {
  en: 'English', fr: 'French', de: 'German', es: 'Spanish',
  it: 'Italian', pt: 'Portuguese', ga: 'Irish', nl: 'Dutch',
  pl: 'Polish', ja: 'Japanese', ar: 'Arabic',
};

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function FederationMessagesPage() {
  const { t, i18n } = useTranslation('federation');
  usePageTitle(t('messages.page_title'));

  const { user } = useAuth();
  const { hasFeature, tenantSlug, tenantPath } = useTenant();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const isFederationEnabled = hasFeature('federation');

  // ── Opt-in status ──
  const [userOptedIn, setUserOptedIn] = useState<boolean | null>(null);

  // ── Data state ──
  const [allMessages, setAllMessages] = useState<FederatedMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // ── Thread selection ──
  const [activeThreadKey, setActiveThreadKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // ── Reply state ──
  const [replyText, setReplyText] = useState('');
  const [isSending, setIsSending] = useState(false);

  // ── Compose modal ──
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeRecipientQuery, setComposeRecipientQuery] = useState('');
  const [composeRecipientResults, setComposeRecipientResults] = useState<FederatedMemberResult[]>([]);
  const [isSearchingRecipients, setIsSearchingRecipients] = useState(false);
  const [selectedRecipient, setSelectedRecipient] = useState<FederatedMemberResult | null>(null);
  const [isComposeSending, setIsComposeSending] = useState(false);

  // ── Mobile state ──
  const [mobileShowThread, setMobileShowThread] = useState(false);

  // ── Translation state ──
  const translationEnabled = hasFeature('message_translation');
  const [autoTranslateOn, setAutoTranslateOn] = useState(false);
  const [autoTranslations, setAutoTranslations] = useState<Map<number, string>>(new Map());
  const [manualTranslations, setManualTranslations] = useState<Map<number, string>>(new Map());
  const [translatingIds, setTranslatingIds] = useState<Set<number>>(new Set());
  const [showOriginalIds, setShowOriginalIds] = useState<Set<number>>(new Set());
  const [translationErrors, setTranslationErrors] = useState<Map<number, string>>(new Map());
  const autoTranslatingRef = useRef(false);
  const translatedIdsRef = useRef<Set<number>>(new Set());

  const userLangBase = (i18n.language || 'en').split('-')[0] ?? 'en';
  const userLangName = LANG_NAMES[userLangBase] ?? userLangBase;

  // ── Refs ──
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // ── Derived data ──
  const threads = useMemo(
    () => buildThreads(allMessages, user?.id ?? 0),
    [allMessages, user?.id]
  );

  const filteredThreads = useMemo(() => {
    if (!searchQuery.trim()) return threads;
    const q = searchQuery.toLowerCase();
    return threads.filter(
      (t) =>
        t.partner.name.toLowerCase().includes(q) ||
        t.partner.tenant_name.toLowerCase().includes(q) ||
        t.lastMessage.subject.toLowerCase().includes(q)
    );
  }, [threads, searchQuery]);

  const activeThread = useMemo(
    () => threads.find((t) => `${t.partner.id}-${t.partner.tenant_id}` === activeThreadKey) ?? null,
    [threads, activeThreadKey]
  );

  const canUseFederationMessaging = isFederationEnabled && userOptedIn === true;

  // ── Load messages ──
  const loadMessages = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      setIsLoading(true);
      setLoadError(false);
      const response = await api.get<FederatedMessage[]>('/v2/federation/messages', { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setAllMessages(response.data);
      } else {
        setLoadError(true);
        toastRef.current.error(tRef.current('messages.toast_error'), tRef.current('messages.load_error'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load federated messages', err);
      setLoadError(true);
      toastRef.current.error(tRef.current('messages.toast_error'), tRef.current('messages.load_error_retry'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  // ── Real-time: subscribe to federation-message events on the user channel ──
  const pusher = usePusherOptional();

  useEffect(() => {
    if (!pusher?.client || !user?.id || !pusher.tenantId) return;

    const channelName = `private-tenant.${pusher.tenantId}.user.${user.id}`;
    const channel = pusher.client.channel(channelName);
    if (!channel) return;

    function handleFederationMessage(data: {
      message_id?: number;
      sender_user_id?: number;
      sender_tenant_id?: number;
      sender_name?: string;
      sender_tenant_name?: string;
      subject?: string;
      body?: string;
      timestamp?: string;
    }) {
      // Append the incoming message as a synthetic FederatedMessage so the
      // thread list and active thread view update without a page reload.
      if (!data.message_id || !data.sender_user_id || !data.body) return;

      const partnerKey = `${data.sender_user_id}-${data.sender_tenant_id}`;

      setAllMessages((prev) => {
        // Avoid duplicates (e.g. if the page also re-fetched)
        if (prev.some((m) => m.id === data.message_id)) return prev;

        const synthetic: FederatedMessage = {
          id: data.message_id!,
          direction: 'inbound',
          status: 'unread',
          subject: data.subject ?? '',
          body: data.body!,
          created_at: data.timestamp ?? new Date().toISOString(),
          read_at: null,
          sender: {
            id: data.sender_user_id!,
            name: data.sender_name ?? '',
            avatar: null,
            tenant_id: data.sender_tenant_id ?? 0,
            tenant_name: data.sender_tenant_name ?? '',
          },
          receiver: {
            id: user?.id ?? 0,
            name: '',
            avatar: null,
            tenant_id: Number(pusher?.tenantId ?? 0),
            tenant_name: '',
          },
        };
        return [...prev, synthetic];
      });

      // If the sender's thread is not currently open, show a toast notification.
      // If it IS open, the user is reading it — mark the new message read
      // immediately so the unread badge doesn't stick until the next re-open.
      setActiveThreadKey((current) => {
        if (current !== partnerKey) {
          toastRef.current.info(
            tRef.current('messages.realtime_new_message', { name: data.sender_name ?? tRef.current('messages.someone') }),
          );
        } else {
          api.post('/v2/federation/messages/mark-read-batch', { ids: [data.message_id] })
            .then((res) => {
              if (res.success) {
                setAllMessages((prev) =>
                  prev.map((m) =>
                    m.id === data.message_id
                      ? { ...m, status: 'read' as const, read_at: new Date().toISOString() }
                      : m
                  )
                );
              }
            })
            .catch(() => {
              // Non-critical — the message stays unread until the thread reopens.
            });
        }
        return current;
      });

      // Scroll to bottom if the relevant thread is open
      setTimeout(() => {
        setActiveThreadKey((current) => {
          if (current === partnerKey) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
          }
          return current;
        });
      }, 100);
    }

    channel.bind('federation-message', handleFederationMessage);

    return () => {
      channel.unbind('federation-message', handleFederationMessage);
    };
  }, [pusher?.client, pusher?.tenantId, user?.id]);

  // ── Handle compose URL params ──
  useEffect(() => {
    const compose = searchParams.get('compose');
    const toUser = searchParams.get('to_user');
    const toTenant = searchParams.get('to_tenant');

    if (compose !== 'true') return;

    if (!canUseFederationMessaging) {
      if (userOptedIn === false) {
        const newParams = new URLSearchParams(searchParams);
        newParams.delete('compose');
        newParams.delete('to_user');
        newParams.delete('to_tenant');
        newParams.delete('name');
        setSearchParams(newParams, { replace: true });
      }
      return;
    }

    if (canUseFederationMessaging) {
      setIsComposeOpen(true);

      if (toUser && toTenant) {
        const isExternalTenant = toTenant.startsWith('ext-');
        const recipientName = searchParams.get('name') || '';

        // Pre-fill recipient — works for both internal and external
        setSelectedRecipient({
          id: isExternalTenant ? toUser : parseInt(toUser, 10),
          name: recipientName,
          tenant_id: isExternalTenant ? toTenant : parseInt(toTenant, 10),
          tenant_name: '',
          is_external: isExternalTenant,
        });

        if (!isExternalTenant) {
          // Fetch internal user info to fill in the name
          api
            .get<FederatedMemberResult & { timebank?: { id: number | string; name: string } }>(`/v2/federation/members/${toUser}?tenant_id=${toTenant}`)
            .then((res) => {
              if (res.success && res.data) {
                const d = res.data;
                setSelectedRecipient({
                  ...d,
                  tenant_id: d.tenant_id ?? d.timebank?.id ?? parseInt(toTenant!, 10),
                  tenant_name: d.tenant_name ?? d.timebank?.name ?? '',
                });
              }
            })
            .catch(() => {
              // Silently fail - user can still search
            });
        }
      }

      // Clear compose params from URL
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('compose');
      newParams.delete('to_user');
      newParams.delete('to_tenant');
      newParams.delete('name');
      setSearchParams(newParams, { replace: true });
    }
  }, [canUseFederationMessaging, searchParams, setSearchParams, userOptedIn]);

  // ── Mark thread as read ──
  const markThreadRead = useCallback(
    async (thread: FederatedThread) => {
      // Find unread inbound message IDs
      const unreadIds = thread.messages
        .filter((m) => m.direction === 'inbound' && (m.status === 'unread' || m.status === 'delivered'))
        .map((m) => m.id);

      if (unreadIds.length === 0) return;

      const previousMessages = thread.messages
        .filter((m) => unreadIds.includes(m.id))
        .map((m) => ({ id: m.id, status: m.status, read_at: m.read_at }));

      // Optimistically mark as read in local state
      setAllMessages((prev) =>
        prev.map((msg) =>
          unreadIds.includes(msg.id) ? { ...msg, status: 'read' as const, read_at: new Date().toISOString() } : msg
        )
      );

      // Batch mark-read in a single request
      try {
        const response = await api.post('/v2/federation/messages/mark-read-batch', { ids: unreadIds });
        if (!response.success) {
          throw new Error('mark-read failed');
        }
      } catch (err) {
        setAllMessages((prev) =>
          prev.map((msg) => {
            const previous = previousMessages.find((item) => item.id === msg.id);
            return previous ? { ...msg, status: previous.status, read_at: previous.read_at } : msg;
          })
        );
        logError('Failed to batch mark federated messages as read', err);
      }
    },
    []
  );

  // ── Select a thread ──
  const selectThread = useCallback(
    (thread: FederatedThread) => {
      const key = `${thread.partner.id}-${thread.partner.tenant_id}`;
      setActiveThreadKey(key);
      setReplyText('');
      setMobileShowThread(true);

      // Clear translation state for new thread
      setAutoTranslations(new Map());
      setManualTranslations(new Map());
      setTranslatingIds(new Set());
      setTranslationErrors(new Map());
      setShowOriginalIds(new Set());
      translatedIdsRef.current.clear();
      autoTranslatingRef.current = false;

      // Restore auto-translate preference for this thread
      const fedTranslateKey = `nexus_fed_auto_translate_${tenantSlug || 'default'}`;
      const prefs = safeLocalStorageGetJSON<Record<string, string>>(fedTranslateKey, {});
      setAutoTranslateOn(!!prefs[key]);

      // Mark as read
      markThreadRead(thread);

      // Scroll to bottom after render
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    },
    [markThreadRead, tenantSlug]
  );

  // ── Translation helpers ──
  const handleAutoTranslateToggle = useCallback(() => {
    if (!activeThreadKey) return;
    const fedTranslateKey = `nexus_fed_auto_translate_${tenantSlug || 'default'}`;
    try {
      const prefs = safeLocalStorageGetJSON<Record<string, string>>(fedTranslateKey, {});
      if (prefs[activeThreadKey]) {
        delete prefs[activeThreadKey];
        safeLocalStorageSetJSON(fedTranslateKey, prefs);
        setAutoTranslateOn(false);
        setAutoTranslations(new Map());
        translatedIdsRef.current.clear();
        toast.info(t('messages.auto_translate_disabled'));
      } else {
        prefs[activeThreadKey] = userLangBase;
        safeLocalStorageSetJSON(fedTranslateKey, prefs);
        setAutoTranslateOn(true);
        toast.success(t('messages.auto_translate_enabled'));
      }
    } catch (err) {
      // localStorage unavailable or parse error — fall back to safe default (off)
      // Consistent with selectThread's catch behavior
      if (import.meta.env.DEV) console.warn('[FederationMessages] Failed to toggle auto-translate prefs', err);
      setAutoTranslateOn(false);
    }
  }, [activeThreadKey, tenantSlug, userLangBase, toast, t]);

  // Auto-translate effect: translate all inbound messages when toggle is on
  useEffect(() => {
    if (!autoTranslateOn || !activeThread?.messages?.length || autoTranslatingRef.current) return;

    const untranslated = activeThread.messages.filter(
      (msg) =>
        msg.direction === 'inbound' &&
        !autoTranslations.has(msg.id) &&
        !translatedIdsRef.current.has(msg.id) &&
        msg.body
    );
    if (untranslated.length === 0) return;

    for (const msg of untranslated) {
      translatedIdsRef.current.add(msg.id);
    }
    autoTranslatingRef.current = true;

    (async () => {
      const newTranslations = new Map(autoTranslations);
      for (const msg of untranslated) {
        try {
          const response = await api.post<{ translated_text: string }>(
            `/v2/federation/messages/${msg.id}/translate`,
            { target_language: userLangBase }
          );
          const translated = response.data?.translated_text;
          if (translated) {
            newTranslations.set(msg.id, translated);
          }
        } catch {
          translatedIdsRef.current.delete(msg.id);
        }
      }
      setAutoTranslations(newTranslations);
      autoTranslatingRef.current = false;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTranslateOn, activeThread?.messages?.length, i18n.language]);

  const handleTranslateMessage = useCallback(
    async (msgId: number) => {
      // Toggle view if already translated
      const existingTranslation = manualTranslations.get(msgId) || autoTranslations.get(msgId);
      if (existingTranslation) {
        setShowOriginalIds((prev) => {
          const next = new Set(prev);
          if (next.has(msgId)) next.delete(msgId);
          else next.add(msgId);
          return next;
        });
        return;
      }

      setTranslatingIds((prev) => new Set(prev).add(msgId));
      setTranslationErrors((prev) => {
        const m = new Map(prev);
        m.delete(msgId);
        return m;
      });

      try {
        const response = await api.post<{ translated_text: string }>(
          `/v2/federation/messages/${msgId}/translate`,
          { target_language: userLangBase }
        );
        const translated = response.data?.translated_text ?? '';
        setManualTranslations((prev) => new Map(prev).set(msgId, translated));
      } catch {
        setTranslationErrors((prev) =>
          new Map(prev).set(msgId, t('messages.translation_failed'))
        );
      } finally {
        setTranslatingIds((prev) => {
          const s = new Set(prev);
          s.delete(msgId);
          return s;
        });
      }
    },
    [manualTranslations, autoTranslations, userLangBase, t]
  );

  // ── Send reply ──
  const sendReply = useCallback(async () => {
    if (!replyText.trim() || !activeThread || isSending || !canUseFederationMessaging) return;

    try {
      setIsSending(true);
      const response = await api.post<FederatedMessage>('/v2/federation/messages', {
        receiver_id: activeThread.partner.id,
        receiver_tenant_id: activeThread.partner.tenant_id,
        subject: activeThread.lastMessage.subject,
        body: replyText.trim(),
        reference_message_id: activeThread.lastMessage.id,
      });

      if (response.success && response.data) {
        setAllMessages((prev) => [...prev, response.data!]);
        setReplyText('');
        toastRef.current.success(tRef.current('messages.toast_sent'), tRef.current('messages.toast_reply_delivered'));

        // Scroll to bottom
        setTimeout(() => {
          messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 100);
      } else {
        toastRef.current.error(tRef.current('messages.toast_error'), tRef.current('messages.send_error'));
      }
    } catch (err) {
      logError('Failed to send federated reply', err);
      toastRef.current.error(tRef.current('messages.toast_error'), tRef.current('messages.send_error_retry'));
    } finally {
      setIsSending(false);
    }
  }, [replyText, activeThread, isSending, canUseFederationMessaging]);

  // ── Recipient search (debounced) ──
  useEffect(() => {
    if (!composeRecipientQuery.trim()) {
      setComposeRecipientResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setIsSearchingRecipients(true);
        const response = await api.get<FederatedMemberResult[]>(
          `/v2/federation/members?q=${encodeURIComponent(composeRecipientQuery)}&limit=10`
        );
        if (response.success && response.data) {
          // Normalize member data: API may return tenant info as timebank.id/timebank.name
          // instead of tenant_id/tenant_name — map both formats for compatibility
          const normalized = (response.data as (FederatedMemberResult & { timebank?: { id: number; name: string } })[]).map((m) => ({
            ...m,
            tenant_id: m.tenant_id ?? m.timebank?.id ?? 0,
            tenant_name: m.tenant_name ?? m.timebank?.name ?? '',
          }));
          // Filter out current user
          setComposeRecipientResults(normalized.filter((m) => m.id !== user?.id));
        }
      } catch (err) {
        logError('Failed to search federated members', err);
      } finally {
        setIsSearchingRecipients(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [composeRecipientQuery, user?.id]);

  // ── Send compose message ──
  const sendComposeMessage = useCallback(async () => {
    if (!selectedRecipient || !selectedRecipient.tenant_id || !composeSubject.trim() || !composeBody.trim() || isComposeSending || !canUseFederationMessaging) return;

    try {
      setIsComposeSending(true);
      const response = await api.post<FederatedMessage>('/v2/federation/messages', {
        receiver_id: selectedRecipient.id,
        receiver_tenant_id: selectedRecipient.tenant_id,
        subject: composeSubject.trim(),
        body: composeBody.trim(),
      });

      if (response.success && response.data) {
        setAllMessages((prev) => [...prev, response.data!]);
        toastRef.current.success(tRef.current('messages.toast_sent'), tRef.current('messages.toast_compose_sent', { name: selectedRecipient.name || tRef.current('messages.the_recipient') }));

        // Close modal and reset
        setIsComposeOpen(false);
        setComposeSubject('');
        setComposeBody('');
        setComposeRecipientQuery('');
        setComposeRecipientResults([]);
        setSelectedRecipient(null);

        // Select the new thread
        const key = `${selectedRecipient.id}-${selectedRecipient.tenant_id}`;
        setActiveThreadKey(key);
        setMobileShowThread(true);
      } else {
        toastRef.current.error(tRef.current('messages.toast_error'), tRef.current('messages.send_error'));
      }
    } catch (err) {
      logError('Failed to send federated message', err);
      toastRef.current.error(tRef.current('messages.toast_error'), tRef.current('messages.send_error_retry'));
    } finally {
      setIsComposeSending(false);
    }
  }, [selectedRecipient, composeSubject, composeBody, isComposeSending, canUseFederationMessaging]);

  // ── Close compose and reset ──
  const closeCompose = useCallback(() => {
    setIsComposeOpen(false);
    setComposeSubject('');
    setComposeBody('');
    setComposeRecipientQuery('');
    setComposeRecipientResults([]);
    setSelectedRecipient(null);
  }, []);

  // ── Breadcrumbs ──
  const breadcrumbItems = [
    { label: t('messages.breadcrumb_federation'), href: tenantPath('/federation') },
    { label: t('messages.breadcrumb_messages') },
  ];

  // Check opt-in status on mount (proactive gate — avoids 403 on Send)
  useEffect(() => {
    let cancelled = false;
    fetchUserFederationOptIn().then((optedIn) => {
      if (!cancelled) setUserOptedIn(optedIn);
    }).catch(() => {
      if (!cancelled) setUserOptedIn(false);
    });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="max-w-6xl mx-auto space-y-4">
      <PageMeta title={t('messages.page_title')} noIndex />
      <Breadcrumbs items={breadcrumbItems} />

      {/* Feature disabled notice */}
      {!isFederationEnabled && (
        <GlassCard className="p-4 border-l-4 border-amber-500 bg-amber-500/10">
          <div className="flex items-start gap-3">
            <Globe className="w-5 h-5 text-[var(--color-warning)] flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1">
              <h3 className="font-semibold text-theme-primary">{t('messages.federation_not_enabled')}</h3>
              <p className="text-sm text-theme-muted mt-1">
                {t('messages.federation_not_enabled_description')}
              </p>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Opt-in required notice — shown when feature is enabled but user hasn't opted in */}
      {isFederationEnabled && userOptedIn === false && (
        <GlassCard className="p-4 border-l-4 border-accent bg-accent/10">
          <div className="flex items-start gap-3">
            <Globe className="w-5 h-5 text-accent flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1">
              <h3 className="font-semibold text-theme-primary">{t('messages.optin_required')}</h3>
              <p className="text-sm text-theme-muted mt-1">
                {t('messages.optin_required_description')}
              </p>
            </div>
            <Button
              as={Link}
              to={tenantPath('/federation/onboarding')}
              size="sm"
              className="bg-accent text-white flex-shrink-0"
            >
              {t('messages.optin_cta')}
            </Button>
          </div>
        </GlassCard>
      )}

      {/* Header row */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-theme-primary flex items-center gap-3">
            <Globe className="w-7 h-7 text-accent dark:text-accent" aria-hidden="true" />
            {t('messages.title')}
          </h1>
          <p className="text-theme-muted mt-1">{t('messages.subtitle')}</p>
        </div>
        <Button
          className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
          startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
          onPress={() => setIsComposeOpen(true)}
          isDisabled={!canUseFederationMessaging}
        >
          {t('messages.compose')}
        </Button>
      </div>

      {/* Main content area */}
      {isLoading ? (
        <GlassCard role="status" aria-busy="true" aria-label={t('messages.loading')} className="p-12 flex flex-col items-center justify-center gap-4">
          <Spinner size="lg" color="primary" />
          <p className="text-theme-muted">{t('messages.loading')}</p>
        </GlassCard>
      ) : loadError ? (
        <GlassCard role="alert" className="p-8 text-center">
          <Globe className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h3 className="text-lg font-semibold text-theme-primary mb-2">{t('messages.unable_to_load')}</h3>
          <p className="text-theme-muted mb-4">{t('messages.unable_to_load_description')}</p>
          <Button
            className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
            onPress={loadMessages}
          >
            {t('messages.try_again')}
          </Button>
        </GlassCard>
      ) : threads.length === 0 && !searchQuery ? (
        <GlassCard className="p-12 text-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center">
              <MessageSquare className="w-8 h-8 text-accent" aria-hidden="true" />
            </div>
            <h3 className="text-lg font-semibold text-theme-primary">{t('messages.no_messages_yet')}</h3>
            <p className="text-theme-muted max-w-md">
              {t('messages.no_messages_description')}
            </p>
            <Button
              className="bg-gradient-to-r from-accent to-accent-gradient-end text-white mt-2"
              startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
              onPress={() => setIsComposeOpen(true)}
              isDisabled={!canUseFederationMessaging}
            >
              {t('messages.compose_message')}
            </Button>
          </div>
        </GlassCard>
      ) : (
        /* Two-panel layout */
        <div className="flex gap-4 h-[calc(100vh-16rem)]">
          {/* ── Left Panel: Thread List ── */}
          <GlassCard
            className={`w-full md:w-[380px] flex-shrink-0 flex flex-col overflow-hidden ${
              mobileShowThread ? 'hidden md:flex' : 'flex'
            }`}
          >
            {/* Search */}
            <div className="p-3 border-b border-theme-default">
              <SearchField
                placeholder={t('messages.search_placeholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label={t('messages.search_placeholder')}
                classNames={{
                  input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
                  inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
                }}
              />
            </div>

            {/* Thread list */}
            <div className="flex-1 overflow-y-auto">
              {filteredThreads.length === 0 ? (
                <div className="p-6 text-center">
                  <Search className="w-8 h-8 text-theme-subtle mx-auto mb-2" aria-hidden="true" />
                  <p className="text-theme-subtle text-sm">{t('messages.no_conversations_match')}</p>
                </div>
              ) : (
                <motion.div
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                >
                  {filteredThreads.map((thread) => {
                    const key = `${thread.partner.id}-${thread.partner.tenant_id}`;
                    const isActive = key === activeThreadKey;

                    return (
                      <motion.div key={key} variants={itemVariants}>
                        <Button
                          variant="light"
                          className={`w-full min-h-9 p-3 rounded-none justify-start text-left border-b border-theme-default transition-colors ${
                            isActive
                              ? 'bg-accent/10 dark:bg-accent/15'
                              : 'hover:bg-theme-hover'
                          }`}
                          onPress={() => selectThread(thread)}
                          aria-label={
                            thread.unreadCount > 0
                              ? t(thread.unreadCount > 1 ? 'messages.thread_aria_unread_plural' : 'messages.thread_aria_unread', { name: thread.partner.name, tenant: thread.partner.tenant_name, count: thread.unreadCount })
                              : t('messages.thread_aria_no_unread', { name: thread.partner.name, tenant: thread.partner.tenant_name })
                          }
                        >
                          <div className="flex items-center gap-3 w-full min-w-0">
                            {/* Avatar + unread dot */}
                            <div className="relative flex-shrink-0">
                              <Avatar
                                src={resolveAvatarUrl(thread.partner.avatar)}
                                name={thread.partner.name}
                                size="md"
                                className="ring-2 ring-theme-default"
                              />
                              {thread.unreadCount > 0 && (
                                <div className="absolute -top-0.5 -right-0.5 w-3 h-3 bg-accent rounded-full border-2 border-theme-default" />
                              )}
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2">
                                <span
                                  className={`font-semibold truncate text-sm ${
                                    thread.unreadCount > 0 ? 'text-theme-primary' : 'text-theme-muted'
                                  }`}
                                >
                                  {thread.partner.name}
                                </span>
                                <span className="text-xs text-theme-subtle whitespace-nowrap flex-shrink-0">
                                  {formatRelativeTime(thread.lastMessage.created_at)}
                                </span>
                              </div>

                              {/* Community chip */}
                              <Chip
                                size="sm"
                                variant="flat"
                                startContent={<Globe className="w-2.5 h-2.5" aria-hidden="true" />}
                                classNames={{
                                  base: 'h-5 mt-0.5 bg-accent/10 dark:bg-accent/20',
                                  content: 'text-accent dark:text-accent text-[10px] px-1',
                                }}
                              >
                                {thread.partner.tenant_name}
                              </Chip>

                              {/* Preview */}
                              <p
                                className={`text-xs truncate mt-1 ${
                                  thread.unreadCount > 0 ? 'text-theme-muted font-medium' : 'text-theme-subtle'
                                }`}
                              >
                                {thread.lastMessage.direction === 'outbound' ? t('messages.you_prefix') : ''}
                                {thread.lastMessage.body}
                              </p>
                            </div>

                            {/* Unread indicator + chevron */}
                            <div className="flex items-center gap-1 flex-shrink-0">
                              {thread.unreadCount > 0 && (
                                <Chip
                                  size="sm"
                                  color="primary"
                                  variant="solid"
                                  classNames={{
                                    base: 'h-5 min-w-5',
                                    content: 'text-xs px-1 font-bold',
                                  }}
                                >
                                  {thread.unreadCount > 9 ? '9+' : thread.unreadCount}
                                </Chip>
                              )}
                              <ChevronRight className="w-4 h-4 text-theme-subtle hidden md:block" aria-hidden="true" />
                            </div>
                          </div>
                        </Button>
                      </motion.div>
                    );
                  })}
                </motion.div>
              )}
            </div>
          </GlassCard>

          {/* ── Right Panel: Thread View ── */}
          <GlassCard
            className={`flex-1 flex flex-col overflow-hidden ${
              !mobileShowThread ? 'hidden md:flex' : 'flex'
            }`}
          >
            {activeThread ? (
              <>
                {/* Thread header */}
                <div className="p-4 border-b border-theme-default flex items-center gap-3">
                  {/* Mobile back button */}
                  <Button
                    isIconOnly
                    variant="light"
                    size="sm"
                    className="md:hidden text-theme-muted"
                    onPress={() => setMobileShowThread(false)}
                    aria-label={t('messages.aria_back_to_list')}
                  >
                    <ArrowLeft className="w-5 h-5" aria-hidden="true" />
                  </Button>

                  <Avatar
                    src={resolveAvatarUrl(activeThread.partner.avatar)}
                    name={activeThread.partner.name}
                    size="md"
                    className="ring-2 ring-theme-default flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <h2 className="font-semibold text-theme-primary truncate">
                      {activeThread.partner.name}
                    </h2>
                    <Chip
                      size="sm"
                      variant="flat"
                      startContent={<Globe className="w-2.5 h-2.5" aria-hidden="true" />}
                      classNames={{
                        base: 'h-5 bg-accent/10 dark:bg-accent/20',
                        content: 'text-accent dark:text-accent text-[10px] px-1',
                      }}
                    >
                      {activeThread.partner.tenant_name}
                    </Chip>
                  </div>

                  {/* Auto-translate toggle */}
                  {translationEnabled && (
                    <Tooltip
                      content={
                        autoTranslateOn
                          ? t('messages.auto_translate_tooltip_on')
                          : t('messages.auto_translate_tooltip_off')
                      }
                    >
                      <Button
                        isIconOnly
                        variant="flat"
                        size="sm"
                        className={
                          autoTranslateOn
                            ? 'bg-accent/20 text-accent ring-1 ring-accent/30 ml-auto'
                            : 'bg-theme-elevated text-theme-muted ml-auto'
                        }
                        aria-label={
                          autoTranslateOn
                            ? t('messages.auto_translate_tooltip_on')
                            : t('messages.auto_translate_tooltip_off')
                        }
                        onPress={handleAutoTranslateToggle}
                      >
                        <Languages className="w-4 h-4" aria-hidden="true" />
                      </Button>
                    </Tooltip>
                  )}
                </div>

                {/* Auto-translate active banner */}
                {translationEnabled && autoTranslateOn && (
                  <div
                    className="flex items-center gap-2 px-3 py-2 mx-4 mt-2 bg-accent/10 rounded-lg"
                    role="status"
                  >
                    <Languages
                      className="w-4 h-4 text-accent flex-shrink-0"
                      aria-hidden="true"
                    />
                    <p className="text-xs text-accent dark:text-accent flex-1">
                      {t('messages.auto_translate_active_banner')}
                    </p>
                    <Button
                      size="sm"
                      variant="light"
                      className="h-6 min-w-0 px-2 text-xs text-accent"
                      onPress={handleAutoTranslateToggle}
                    >
                      {t('messages.auto_translate_turn_off')}
                    </Button>
                  </div>
                )}

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  <AnimatePresence mode="popLayout">
                    {activeThread.messages.map((msg) => {
                      const isOwn = msg.direction === 'outbound';
                      const isRead = msg.status === 'read' || !!msg.read_at;

                      return (
                        <motion.div
                          key={msg.id}
                          variants={bubbleVariants}
                          initial="hidden"
                          animate="visible"
                          exit={{ opacity: 0, y: -8 }}
                          className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
                        >
                          <div className={`flex gap-2 max-w-[75%] ${isOwn ? 'flex-row-reverse' : ''}`}>
                            {!isOwn && (
                              <Avatar
                                src={resolveAvatarUrl(msg.sender.avatar)}
                                name={msg.sender.name}
                                size="sm"
                                className="flex-shrink-0 mt-1"
                              />
                            )}
                            <div>
                              {/* Subject line if first message or subject changed */}
                              {msg.subject && (
                                <p
                                  className={`text-[10px] font-medium mb-1 ${
                                    isOwn
                                      ? 'text-right text-accent dark:text-accent'
                                      : 'text-theme-subtle'
                                  }`}
                                >
                                  {msg.subject}
                                </p>
                              )}

                              {/* Bubble */}
                              <div
                                className={`px-4 py-2.5 rounded-2xl ${
                                  isOwn
                                    ? 'bg-gradient-to-r from-accent to-accent-gradient-end text-white rounded-br-md'
                                    : 'bg-theme-elevated text-theme-primary rounded-bl-md'
                                }`}
                              >
                                {(() => {
                                  const translatedText =
                                    manualTranslations.get(msg.id) ||
                                    autoTranslations.get(msg.id);
                                  const isShowingOriginal = showOriginalIds.has(msg.id);
                                  const isCurrentlyTranslating = translatingIds.has(msg.id);
                                  const error = translationErrors.get(msg.id);

                                  return (
                                    <>
                                      <p className="text-sm whitespace-pre-wrap">
                                        {translatedText && !isShowingOriginal
                                          ? translatedText
                                          : msg.body}
                                      </p>

                                      {translationEnabled && msg.body && (
                                        <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                          <Button
                                            size="sm"
                                            variant="light"
                                            className={`h-6 min-w-0 px-2 text-xs gap-1 ${
                                              isOwn
                                                ? 'text-white/60 hover:text-white/100'
                                                : 'opacity-60 hover:opacity-100'
                                            } ${isCurrentlyTranslating ? 'animate-pulse' : ''}`}
                                            onPress={() => handleTranslateMessage(msg.id)}
                                            isDisabled={isCurrentlyTranslating}
                                            startContent={
                                              <Languages className="w-3 h-3" aria-hidden="true" />
                                            }
                                            aria-label={
                                              translatedText
                                                ? t('messages.view_original')
                                                : t('messages.translate_to', {
                                                    language: userLangName,
                                                  })
                                            }
                                          >
                                            {isCurrentlyTranslating
                                              ? t('messages.translating')
                                              : translatedText
                                                ? isShowingOriginal
                                                  ? t('messages.show_translation')
                                                  : t('messages.view_original')
                                                : t('messages.translate_to', {
                                                    language: userLangName,
                                                  })}
                                          </Button>
                                          {translatedText && !isShowingOriginal && (
                                            <span
                                              className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                                                isOwn
                                                  ? 'bg-white/15 text-white/60'
                                                  : 'bg-theme-muted/10 text-theme-muted'
                                              }`}
                                            >
                                              {t('messages.translated_label')}
                                            </span>
                                          )}
                                          {error && !translatedText && (
                                            <span className="text-xs text-theme-danger" role="alert">{error}</span>
                                          )}
                                        </div>
                                      )}
                                    </>
                                  );
                                })()}
                              </div>

                              {/* Timestamp + read indicator */}
                              <div
                                className={`flex items-center gap-1.5 mt-1 px-1 ${
                                  isOwn ? 'justify-end' : 'justify-start'
                                }`}
                              >
                                <span className="text-[10px] text-theme-subtle">
                                  {new Date(msg.created_at).toLocaleTimeString(getFormattingLocale(), {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                                {isOwn && (
                                  isRead ? (
                                    <MailOpen className="w-3 h-3 text-accent" aria-label={t('messages.aria_read')} />
                                  ) : (
                                    <Mail className="w-3 h-3 text-theme-subtle" aria-label={t('messages.aria_delivered')} />
                                  )
                                )}
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      );
                    })}
                  </AnimatePresence>
                  <div ref={messagesEndRef} />
                </div>

                {/* Reply input */}
                <div className="p-4 border-t border-theme-default">
                  <div className="flex gap-3">
                    <Textarea
                      placeholder={t('messages.reply_placeholder')}
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      maxLength={10000}
                      minRows={1}
                      maxRows={4}
                      classNames={{
                        input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
                        inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          sendReply();
                        }
                      }}
                      aria-label={t('messages.aria_reply')}
                    />
                    <Button
                      isIconOnly
                      className="bg-gradient-to-r from-accent to-accent-gradient-end text-white self-end"
                      onPress={sendReply}
                      isLoading={isSending}
                      isDisabled={!canUseFederationMessaging || !replyText.trim()}
                      aria-label={t('messages.aria_send_reply')}
                    >
                      <Send className="w-4 h-4" aria-hidden="true" />
                    </Button>
                  </div>
                </div>
              </>
            ) : (
              /* No thread selected placeholder (desktop) */
              <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
                <div className="w-20 h-20 rounded-full bg-accent/10 flex items-center justify-center">
                  <MessageSquare className="w-10 h-10 text-accent/50" aria-hidden="true" />
                </div>
                <h3 className="text-lg font-semibold text-theme-muted">{t('messages.select_conversation')}</h3>
                <p className="text-theme-subtle text-sm text-center max-w-xs">
                  {t('messages.select_conversation_description')}
                </p>
              </div>
            )}
          </GlassCard>
        </div>
      )}

      {/* ── Compose Modal ── */}
      <Modal
        isOpen={isComposeOpen}
        onClose={closeCompose}
        size="lg"
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          body: 'py-4',
          footer: 'border-t border-theme-default',
        }}
      >
        <ModalContent>
          <ModalHeader className="text-theme-primary flex items-center gap-2">
            <Globe className="w-5 h-5 text-accent" aria-hidden="true" />
            {t('messages.new_federated_message')}
          </ModalHeader>
          <ModalBody>
            <div className="space-y-4">
              {/* Recipient selector */}
              {selectedRecipient ? (
                <>
                  <div className="flex items-center gap-3 p-3 rounded-lg bg-theme-elevated">
                    <Avatar
                      src={resolveAvatarUrl(selectedRecipient.avatar)}
                      name={selectedRecipient.name || t('messages.recipient_fallback')}
                      size="sm"
                      className="ring-2 ring-theme-default"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-theme-primary truncate">
                        {selectedRecipient.name || (selectedRecipient.is_external ? t('members.external_member') : t('messages.user_number', { id: selectedRecipient.id }))}
                      </p>
                      {selectedRecipient.tenant_name && (
                        <Chip
                          size="sm"
                          variant="flat"
                          startContent={<Globe className="w-2.5 h-2.5" aria-hidden="true" />}
                          classNames={{
                            base: 'h-5 bg-accent/10 dark:bg-accent/20',
                            content: 'text-accent dark:text-accent text-[10px] px-1',
                          }}
                        >
                          {selectedRecipient.tenant_name}
                        </Chip>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="flat"
                      className="bg-theme-elevated text-theme-muted"
                      onPress={() => {
                        setSelectedRecipient(null);
                        setComposeRecipientQuery('');
                      }}
                    >
                      {t('messages.change')}
                    </Button>
                  </div>
                  {selectedRecipient.is_external && (
                    <div className="flex items-center gap-2 p-2.5 rounded-lg bg-accent/10 text-accent dark:text-accent text-sm">
                      <Globe className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                      <span>{t('messages.external_recipient_info')}</span>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <Input
                    label={t('messages.recipient_label')}
                    placeholder={t('messages.recipient_placeholder')}
                    value={composeRecipientQuery}
                    onChange={(e) => setComposeRecipientQuery(e.target.value)}
                    startContent={<Search className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
                    endContent={isSearchingRecipients ? <span role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })}><Spinner size="sm" /></span> : null}
                    classNames={{
                      input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
                      inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
                      label: 'text-theme-muted',
                    }}
                    autoFocus
                  />
                  {/* Search results */}
                  {composeRecipientResults.length > 0 && (
                    <div className="max-h-48 overflow-y-auto space-y-1 rounded-lg border border-theme-default bg-theme-card p-1">
                      {composeRecipientResults.map((member) => (
                        <Button
                          key={`${member.id}-${member.tenant_id}`}
                          variant="light"
                          className="w-full min-h-9 p-2 justify-start"
                          onPress={() => {
                            setSelectedRecipient(member);
                            setComposeRecipientQuery('');
                            setComposeRecipientResults([]);
                          }}
                        >
                          <div className="flex items-center gap-3 w-full">
                            <Avatar
                              src={resolveAvatarUrl(member.avatar)}
                              name={member.name}
                              size="sm"
                              className="ring-2 ring-theme-default"
                            />
                            <div className="flex-1 min-w-0 text-left">
                              <p className="font-medium text-theme-primary text-sm truncate">{member.name}</p>
                              <div className="flex items-center gap-1.5 text-theme-subtle">
                                <Globe className="w-2.5 h-2.5" aria-hidden="true" />
                                <span className="text-[11px]">{member.tenant_name}</span>
                                {member.is_external && (
                                  <Chip
                                    size="sm"
                                    variant="flat"
                                    className="bg-accent/10 text-accent dark:text-accent h-4 text-[10px]"
                                    startContent={<Globe className="w-2.5 h-2.5" aria-hidden="true" />}
                                  >
                                    {t('external')}
                                  </Chip>
                                )}
                              </div>
                            </div>
                          </div>
                        </Button>
                      ))}
                    </div>
                  )}
                  {composeRecipientQuery.trim() && !isSearchingRecipients && composeRecipientResults.length === 0 && (
                    <p className="text-sm text-theme-subtle text-center py-2">
                      {t('messages.no_members_found')}
                    </p>
                  )}
                </>
              )}

              {/* Subject */}
              <Input
                label={t('messages.subject_label')}
                placeholder={t('messages.subject_placeholder')}
                value={composeSubject}
                onChange={(e) => setComposeSubject(e.target.value)}
                maxLength={500}
                classNames={{
                  input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
                  inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
                  label: 'text-theme-muted',
                }}
              />

              {/* Body */}
              <Textarea
                label={t('messages.message_label')}
                placeholder={t('messages.message_placeholder')}
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                maxLength={10000}
                minRows={4}
                maxRows={8}
                classNames={{
                  input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
                  inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
                  label: 'text-theme-muted',
                }}
              />
            </div>
          </ModalBody>
          <ModalFooter>
            <Button
              variant="flat"
              className="bg-theme-elevated text-theme-muted"
              onPress={closeCompose}
            >
              {t('messages.cancel')}
            </Button>
            <Button
              className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
              startContent={<Send className="w-4 h-4" aria-hidden="true" />}
              onPress={sendComposeMessage}
              isLoading={isComposeSending}
              isDisabled={!canUseFederationMessaging || !selectedRecipient || !selectedRecipient.tenant_id || !composeSubject.trim() || !composeBody.trim()}
            >
              {t('messages.send_message')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
}

export default FederationMessagesPage;
