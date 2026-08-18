// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Modal, ModalContent, ModalHeader, ModalBody } from '@/components/ui/Modal';
import { SearchField } from '@/components/ui/SearchField';
import { Skeleton } from '@/components/ui/Skeleton';
import { Spinner } from '@/components/ui/Spinner';
import { Tabs, Tab } from '@/components/ui/Tabs';
/**
 * Messages Page - Conversation list
 *
 * Features:
 * - Real-time unread count updates via Pusher
 * - New message notifications in conversation list
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { motion } from '@/lib/motion';
import Search from 'lucide-react/icons/search';
import MessageSquare from 'lucide-react/icons/message-square';
import Circle from 'lucide-react/icons/circle';
import Plus from 'lucide-react/icons/plus';
import Archive from 'lucide-react/icons/archive';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import UsersIcon from 'lucide-react/icons/users';
import { CreateGroupModal } from './components/CreateGroupModal';
import { PresenceIndicator } from '@/components/social/PresenceIndicator';
import { EmptyState } from '@/components/feedback';
import { useAuth, useToast, useTenant } from '@/contexts';
import { usePusherOptional, type NewMessageEvent } from '@/contexts/PusherContext';
import { usePresenceOptional } from '@/contexts/PresenceContext';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';
import { api } from '@/lib/api';
import { formatRelativeTime, resolveAvatarUrl } from '@/lib/helpers';
import { logError } from '@/lib/logger';
import type { Conversation, User } from '@/types/api';

// Helper to get the other user from conversation (supports both API formats)
function getOtherUser(conv: Conversation) {
  // Backend returns other_user as the primary field
  if (conv.other_user) {
    return {
      id: conv.other_user.id,
      name: conv.other_user.name || `${conv.other_user.first_name || ''} ${conv.other_user.last_name || ''}`.trim(),
      avatar: conv.other_user.avatar_url || conv.other_user.avatar,
      is_online: conv.other_user.is_online,
    };
  }
  // Fallback to participant (deprecated)
  const p = conv.participant;
  if (!p) return { id: 0, name: '', avatar: null, is_online: false };
  return {
    id: p.id,
    name: p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim(),
    avatar: p.avatar,
    is_online: p.is_online,
  };
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: { opacity: 1, x: 0 },
};

export function MessagesPage() {
  const { t } = useTranslation('messages');
  usePageTitle(t('title'));
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { user: currentUser } = useAuth();
  const toast = useToast();
  const pusher = usePusherOptional();
  const { hasFeature, tenantPath } = useTenant();
  const isDirectMessagingEnabled = hasFeature('direct_messaging');
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [archivedConversations, setArchivedConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingArchived, setIsLoadingArchived] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'inbox' | 'archived'>('inbox');
  const archivedLoadedRef = useRef(false);

  // AbortController ref to cancel stale requests
  const abortRef = useRef<AbortController | null>(null);

  // Stable refs for t/toast — avoids re-creating callbacks when i18n namespace loads
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // Stable ref for location so handleNewMessage doesn't need location in its dep array
  const locationRef = useRef(location);
  locationRef.current = location;

  // Broker messaging restriction state
  const [messagingRestricted, setMessagingRestricted] = useState(false);

  // New message modal state
  const [isNewMessageOpen, setIsNewMessageOpen] = useState(false);
  const [isCreateGroupOpen, setIsCreateGroupOpen] = useState(false);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState<User[]>([]);
  const [isSearchingUsers, setIsSearchingUsers] = useState(false);
  const [userSearchError, setUserSearchError] = useState<string | null>(null);

  // Check for new conversation params
  const toUserId = searchParams.get('to');
  const listingId = searchParams.get('listing');

  // Memoize loadConversations to use in effects and handlers
  const loadConversations = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      setError(null);
      const response = await api.get<Conversation[]>('/v2/messages');
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setConversations(response.data);
      } else {
        setError(tRef.current('load_failed'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load conversations', err);
      setError(tRef.current('load_failed'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Handle incoming new message from Pusher
   * Updates conversation list with new message preview and increments unread count
   */
  const handleNewMessage = useCallback((event: NewMessageEvent) => {
    // Backend sends from_user_id on user channel; normalize to sender_id
    const raw = event as NewMessageEvent & { from_user_id?: number; preview?: string };
    const senderId: number | undefined = event.sender_id || raw.from_user_id;
    if (!senderId) {
      // Can't identify sender — full reload to be safe
      loadConversations();
      return;
    }

    setConversations((prev) => {
      // Find the conversation with this sender
      const existingIndex = prev.findIndex((conv) => {
        const otherUser = getOtherUser(conv);
        return otherUser.id === senderId;
      });

      if (existingIndex >= 0) {
        // Update existing conversation optimistically
        const updated = [...prev];
        const existing = updated[existingIndex];
        if (!existing) return prev;
        const conv = { ...existing };

        // Update last message (body may come as preview from legacy events)
        conv.last_message = {
          id: event.id,
          body: event.body || raw.preview || '',
          sender_id: senderId,
          created_at: event.created_at || new Date().toISOString(),
        };

        // Only increment unread count if this conversation is not currently open.
        // Check the URL path — if the user is viewing /messages/{conv.id} right now,
        // the ConversationPage will mark it as read so we skip the increment.
        const isActive = locationRef.current.pathname.endsWith(`/messages/${conv.id}`);
        if (!isActive) {
          conv.unread_count = (conv.unread_count || 0) + 1;
        }

        // Move to top of list
        updated.splice(existingIndex, 1);
        updated.unshift(conv);

        return updated;
      }

      // New conversation from unknown sender — can't build full Conversation
      // object client-side, so we return prev and let the reload below handle it
      return prev;
    });

    // Always reload to catch new conversations and ensure data consistency.
    // For existing conversations this is a no-op (optimistic update already applied),
    // but for new conversations this is the only way to get the full conversation data.
    loadConversations();
  }, [loadConversations]);

  // Subscribe to Pusher for real-time updates
  useEffect(() => {
    if (!pusher) return;

    // Subscribe to the user's notification channel for new messages
    const unsubMessage = pusher.onNewMessage(handleNewMessage);

    // Also listen for unread count updates (triggers a reload)
    const unsubUnread = pusher.onUnreadCount(() => {
      // When we receive a global unread count update, refresh the conversation list
      loadConversations();
    });

    return () => {
      unsubMessage();
      unsubUnread();
    };
  }, [pusher, handleNewMessage, loadConversations]);

  // Presence context for online indicators
  const presence = usePresenceOptional();

  // Load conversations on mount and when query params change
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Fetch presence for conversation participants
  useEffect(() => {
    if (conversations.length > 0 && presence) {
      const userIds = conversations.map((c) => getOtherUser(c).id).filter((id) => id > 0);
      if (userIds.length > 0) {
        presence.fetchPresence(userIds);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch presence when conversations load; presence excluded (stable ref)
  }, [conversations]);

  // Fetch messaging restriction status (broker monitoring)
  useEffect(() => {
    let cancelled = false;
    api.get<{ messaging_disabled: boolean }>('/v2/messages/restriction-status')
      .then((res) => {
        if (!cancelled && res.success && res.data?.messaging_disabled) {
          setMessagingRestricted(true);
        }
      })
      .catch(() => { /* non-critical */ });
    return () => { cancelled = true; };
  }, []);

  // Memoize startNewConversation
  const startNewConversation = useCallback((userId: number, listing?: number) => {
    // Find existing conversation or create new
    const existing = conversations.find((c) => getOtherUser(c).id === userId);
    if (existing) {
      // Pass listing ID if provided
      const url = listing
        ? tenantPath(`/messages/${existing.id}?listing=${listing}`)
        : tenantPath(`/messages/${existing.id}`);
      navigate(url, { replace: true });
    } else {
      // Navigate with "new" prefix to indicate this is a user ID, not conversation ID
      // Pass listing ID if provided
      const url = listing
        ? tenantPath(`/messages/new/${userId}?listing=${listing}`)
        : tenantPath(`/messages/new/${userId}`);
      navigate(url, { replace: true });
    }
  }, [conversations, navigate, tenantPath]);

  // Handle new conversation params separately.
  // Wait until conversations have finished loading (not until the list is non-empty) —
  // users with zero conversations must still be routed to /messages/new/{userId}.
  // Skip on load error: an empty list then doesn't prove no conversation exists.
  useEffect(() => {
    if (toUserId && !isLoading && !error) {
      startNewConversation(parseInt(toUserId), listingId ? parseInt(listingId) : undefined);
    }
  }, [toUserId, listingId, isLoading, error, startNewConversation]);

  // Debounced user search
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchUsers = useCallback(async (query: string) => {
    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    try {
      setIsSearchingUsers(true);
      setUserSearchError(null);
      const response = await api.get<User[]>(`/v2/users?q=${encodeURIComponent(query)}&limit=10`);
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        // Filter out current user from results
        const filtered = response.data.filter(u => u.id !== currentUser?.id);
        setUserSearchResults(filtered);
      } else {
        setUserSearchError(tRef.current('search_members_failed'));
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      logError('Failed to search users', error);
      setUserSearchError(tRef.current('search_members_failed'));
    } finally {
      setIsSearchingUsers(false);
    }
  }, [currentUser?.id]);

  useEffect(() => {
    if (!userSearchQuery.trim()) {
      setUserSearchResults([]);
      return;
    }

    const timer = setTimeout(() => {
      searchUsers(userSearchQuery);
    }, 300);

    return () => clearTimeout(timer);
  }, [userSearchQuery, searchUsers]);

  const archivedAbortRef = useRef<AbortController | null>(null);
  const loadArchivedConversations = useCallback(async () => {
    archivedAbortRef.current?.abort();
    const controller = new AbortController();
    archivedAbortRef.current = controller;

    try {
      setIsLoadingArchived(true);
      const response = await api.get<Conversation[]>('/v2/messages?archived=true');
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setArchivedConversations(response.data);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('Failed to load archived conversations', err);
    } finally {
      setIsLoadingArchived(false);
      archivedLoadedRef.current = true;
    }
  }, []);

  async function restoreConversation(conversationId: number) {
    try {
      const response = await api.post(`/v2/messages/conversations/${conversationId}/restore`);
      if (response.success) {
        // Remove from archived list
        setArchivedConversations((prev) => prev.filter((c) => c.id !== conversationId));
        // Reload main inbox to show restored conversation
        loadConversations();
        toastRef.current.success(tRef.current('conversation_restored'), tRef.current('conversation_restored_desc'));
      } else {
        toastRef.current.error(tRef.current('error_title'), response.error || tRef.current('restore_failed'));
      }
    } catch (error) {
      logError('Failed to restore conversation', error);
      toastRef.current.error(tRef.current('error_title'), tRef.current('restore_failed'));
    }
  }

  // Load archived conversations when tab changes (only once)
  useEffect(() => {
    if (activeTab === 'archived' && !archivedLoadedRef.current) {
      loadArchivedConversations();
    }
  }, [activeTab, loadArchivedConversations]);

  function handleSelectUser(user: User) {
    // Check if we already have a conversation with this user
    const existing = conversations.find((c) => getOtherUser(c).id === user.id);
    if (existing) {
      // Navigate to existing conversation using conversation ID
      navigate(tenantPath(`/messages/${existing.id}`));
    } else {
      // Navigate to new conversation - use "new" prefix to indicate user ID
      navigate(tenantPath(`/messages/new/${user.id}`));
    }
    setIsNewMessageOpen(false);
    setUserSearchQuery('');
    setUserSearchResults([]);
  }


  const filteredConversations = useMemo(
    () => conversations.filter((conv) => {
      const otherUser = getOtherUser(conv);
      return otherUser.name.toLowerCase().includes(searchQuery.toLowerCase());
    }),
    [conversations, searchQuery]
  );
  const filteredArchivedConversations = useMemo(
    () => archivedConversations.filter((conv) => {
      const otherUser = getOtherUser(conv);
      return otherUser.name.toLowerCase().includes(searchQuery.toLowerCase());
    }),
    [archivedConversations, searchQuery]
  );
  const totalUnread = useMemo(
    () => conversations.reduce((sum, conv) => sum + (conv.unread_count || 0), 0),
    [conversations]
  );
  const hasSearchQuery = searchQuery.trim().length > 0;

  return (
    <div className="mx-auto max-w-4xl space-y-5 sm:space-y-6">
      <PageMeta title={t('page_meta.list.title')} description={t('page_subtitle')} noIndex />
      {/* Messaging Disabled Notice (feature flag) */}
      {!isDirectMessagingEnabled && (
        <GlassCard role="status" className="p-4 border-l-4 border-amber-500 bg-amber-500/10">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-[var(--color-warning)] flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1">
              <h3 className="font-semibold text-theme-primary">{t('disabled_title')}</h3>
              <p className="text-sm text-theme-muted mt-1">
                {t('disabled_subtitle')}
              </p>
              <Button
                size="sm"
                className="mt-3 bg-gradient-to-r from-accent to-accent-gradient-end text-white"
                startContent={<ArrowRightLeft className="w-4 h-4" />}
                onPress={() => navigate(tenantPath('/exchanges'))}
              >
                {t('go_to_exchanges')}
              </Button>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Messaging restricted by broker/admin */}
      {isDirectMessagingEnabled && messagingRestricted && (
        <GlassCard className="p-4 border-l-4 border-red-500 bg-red-500/10">
          <div className="flex items-start gap-3" role="alert">
            <AlertTriangle className="w-5 h-5 text-[var(--color-error)] flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1">
              <h3 className="font-semibold text-theme-danger">{t('messaging_restricted_title')}</h3>
              <p className="text-sm text-red-600/80 dark:text-red-400/80 mt-1">
                {t('messaging_restricted_desc')}
              </p>
            </div>
          </div>
        </GlassCard>
      )}

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="flex items-center gap-3 text-2xl font-bold text-theme-primary sm:text-3xl">
            <span className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-accent/10 text-accent ring-1 ring-accent/20 dark:text-accent">
              <MessageSquare className="h-6 w-6" aria-hidden="true" />
            </span>
            {t('title')}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-theme-muted sm:text-base">{t('page_subtitle')}</p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-shrink-0">
          <Button
            className="min-w-0 bg-gradient-to-r from-accent to-accent-gradient-end font-medium text-white"
            startContent={<Plus className="h-4 w-4 flex-shrink-0" aria-hidden="true" />}
            onPress={() => setIsNewMessageOpen(true)}
            isDisabled={!isDirectMessagingEnabled || messagingRestricted}
          >
            {t('new_message')}
          </Button>
          <Button
            variant="secondary"
            className="min-w-0 bg-theme-elevated text-theme-primary"
            startContent={<UsersIcon className="h-4 w-4 flex-shrink-0" aria-hidden="true" />}
            onPress={() => setIsCreateGroupOpen(true)}
            isDisabled={!isDirectMessagingEnabled || messagingRestricted}
          >
            {t('new_group')}
          </Button>
        </div>
      </div>

      {/* Tabs and Search */}
      <GlassCard className="space-y-4 p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Tabs
            selectedKey={activeTab}
            onSelectionChange={(key) => setActiveTab(key as 'inbox' | 'archived')}
            aria-label={t('title')}
            classNames={{
              base: 'w-full sm:w-auto',
              tabList: 'w-full gap-1 rounded-xl bg-theme-elevated p-1 sm:w-auto',
              cursor: 'bg-theme-hover shadow-sm',
              tab: 'h-10 flex-1 px-3 text-theme-muted data-[selected=true]:text-theme-primary sm:flex-none',
              tabContent: 'group-data-[selected=true]:text-theme-primary',
            }}
          >
            <Tab
              key="inbox"
              title={
                <div className="flex min-w-0 items-center gap-2">
                  <MessageSquare className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                  <span className="truncate">{t('tab_inbox')}</span>
                  {totalUnread > 0 && (
                    <Chip size="sm" color="accent" variant="soft" className="h-5 min-w-5 px-1.5">
                      {totalUnread > 99 ? '99+' : totalUnread}
                    </Chip>
                  )}
                </div>
              } />
            <Tab
              key="archived"
              title={
                <div className="flex min-w-0 items-center gap-2">
                  <Archive className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                  <span className="truncate">{t('tab_archived')}</span>
                </div>
              } />
          </Tabs>
        </div>
        <SearchField
          placeholder={t('search_placeholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label={t('search_placeholder')}
          classNames={{
            input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
            inputWrapper: 'min-h-11 bg-theme-elevated border-theme-default hover:bg-theme-hover',
          }} />
      </GlassCard>

      {/* New Message Modal */}
      <Modal
        isOpen={isNewMessageOpen}
        onClose={() => {
          setIsNewMessageOpen(false);
          setUserSearchQuery('');
          setUserSearchResults([]);
        }}
        classNames={{
          base: 'bg-overlay border border-theme-default',
          header: 'border-b border-theme-default',
          body: 'py-4',
        }}
      >
        <ModalContent>
          <ModalHeader className="text-theme-primary">{t('new_message')}</ModalHeader>
          <ModalBody>
            <SearchField
              placeholder={t('member_search_placeholder')}
              value={userSearchQuery}
              onValueChange={setUserSearchQuery}
              startContent={<Search className="h-4 w-4 text-theme-subtle" aria-hidden="true" />}
              aria-label={t('member_search_placeholder')}
              endContent={isSearchingUsers ? <Spinner size="sm" aria-hidden="true" /> : null}
              classNames={{
                input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
                inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
              }}
              autoFocus />

            {/* Search Results */}
            <div className="mt-4 space-y-2 max-h-64 overflow-y-auto" aria-live="polite" aria-relevant="additions removals">
              {userSearchError ? (
                <div className="text-center py-4">
                  <p role="alert" className="text-[var(--color-error)] text-sm">{userSearchError}</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="mt-2 bg-theme-elevated text-theme-muted"
                    onPress={() => searchUsers(userSearchQuery)}
                  >
                    {t('try_again')}
                  </Button>
                </div>
              ) : userSearchResults.length > 0 ? (
                userSearchResults.map((user) => (
                  <Button
                    key={user.id}
                    variant="secondary"
                    className="flex min-h-14 w-full items-center justify-start gap-3 rounded-xl bg-theme-elevated p-3 text-left"
                    onPress={() => handleSelectUser(user)}
                  >
                    <Avatar
                      src={resolveAvatarUrl(user.avatar_url || user.avatar)}
                      name={user.name}
                      size="sm"
                      className="ring-2 ring-theme-default" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-theme-primary truncate">{user.name}</p>
                      {user.tagline && (
                        <p className="text-sm text-theme-subtle truncate">{user.tagline}</p>
                      )}
                    </div>
                  </Button>
                ))
              ) : userSearchQuery.trim() && !isSearchingUsers ? (
                <p className="text-center text-theme-subtle py-4">{t('member_search_empty')}</p>
              ) : !userSearchQuery.trim() ? (
                <p className="text-center text-theme-subtle py-4">
                  {t('member_search_hint')}
                </p>
              ) : null}
            </div>
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* Create Group Modal */}
      <CreateGroupModal
        isOpen={isCreateGroupOpen}
        onClose={() => setIsCreateGroupOpen(false)}
        onCreated={(groupId) => {
          setIsCreateGroupOpen(false);
          navigate(tenantPath(`/messages/${groupId}`));
        }} />

      {/* Conversations List */}
      {activeTab === 'inbox' ? (
        // Inbox view
        error ? (
          <GlassCard role="alert" className="p-8 text-center">
            <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
            <h3 className="text-lg font-semibold text-theme-primary mb-2">{t('load_error_title')}</h3>
            <p className="text-theme-muted mb-4">{error}</p>
            <Button
              className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
              startContent={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
              onPress={() => loadConversations()}
            >
              {t('try_again')}
            </Button>
          </GlassCard>
        ) : isLoading ? (
          <ConversationListSkeleton label={t('aria_loading_conversations')} count={5} />
        ) : filteredConversations.length === 0 ? (
          <EmptyState
            icon={<MessageSquare className="w-12 h-12" />}
            title={hasSearchQuery ? t('search_empty') : t('empty')}
            description={hasSearchQuery ? t('search_empty_subtitle') : t('empty_subtitle')}
            action={!hasSearchQuery && (
              <Button
                className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
                startContent={<Plus className="h-4 w-4" aria-hidden="true" />}
                onPress={() => setIsNewMessageOpen(true)}
                isDisabled={!isDirectMessagingEnabled || messagingRestricted}
              >
                {t('new_message')}
              </Button>
            )} />
        ) : (
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            // Structural hook for the E2E suite: the INBOX conversation list.
            // Placed on the populated branch only, so its presence means
            // "conversations rendered" — not "the page is loading" (the skeleton
            // branch above carries the same classes) and not "the list is empty"
            // (that branch renders an EmptyState instead).
            data-conversation-list="inbox"
            className="space-y-3"
          >
            {filteredConversations.map((conversation) => (
              <motion.div key={conversation.id} variants={itemVariants}>
                <ConversationCard conversation={conversation} />
              </motion.div>
            ))}
          </motion.div>
        )
      ) : (
        // Archived view
        isLoadingArchived ? (
          <ConversationListSkeleton label={t('aria_loading_archived')} count={3} />
        ) : filteredArchivedConversations.length === 0 ? (
          <EmptyState
            icon={<Archive className="w-12 h-12" />}
            title={hasSearchQuery ? t('archived_search_empty') : t('archived_empty')}
            description={hasSearchQuery ? t('search_empty_subtitle') : t('archived_empty_subtitle')} />
        ) : (
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="space-y-3"
          >
            {filteredArchivedConversations.map((conversation) => (
              <motion.div key={conversation.id} variants={itemVariants}>
                <ArchivedConversationCard
                  conversation={conversation}
                  onRestore={() => restoreConversation(conversation.id)} />
              </motion.div>
            ))}
          </motion.div>
        )
      )}
    </div>
  );
}

interface ConversationCardProps {
  conversation: Conversation;
}

function ConversationCard({ conversation }: ConversationCardProps) {
  const { t } = useTranslation('messages');
  const { tenantPath } = useTenant();
  const other_user = getOtherUser(conversation);
  const { last_message, unread_count } = conversation;
  const displayName = other_user.name || t('unknown_user');
  const lastMessageText = last_message?.body || last_message?.content || '';
  const lastMessageTime = last_message ? formatRelativeTime(last_message.created_at || last_message.sent_at || '') : null;

  return (
    <Link
      to={tenantPath(`/messages/${conversation.id}`)}
      aria-label={unread_count > 0 ? t('aria_conversation_unread', { name: displayName, count: unread_count }) : t('aria_conversation', { name: displayName })}
      className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <GlassCard className={`p-4 transition-colors hover:bg-theme-hover sm:p-5 ${unread_count > 0 ? 'border-l-4 border-l-accent' : ''}`}>
        <div className="flex items-center gap-3 sm:gap-4">
          <Badge
            content={unread_count > 9 ? '9+' : unread_count}
            color="accent"
            size="sm"
            isInvisible={unread_count === 0}
            placement="top-right"
          >
            <div className="relative">
              <Avatar
                src={resolveAvatarUrl(other_user.avatar)}
                name={displayName}
                size="lg"
                className="ring-2 ring-theme-default" />
              <PresenceIndicator userId={other_user.id} size="md" />
            </div>
          </Badge>

          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <h3 className={`min-w-0 truncate font-semibold ${unread_count > 0 ? 'text-theme-primary' : 'text-theme-muted'}`}>
                {displayName}
              </h3>
              {lastMessageTime && (
                <span className="max-w-[6.5rem] flex-shrink-0 truncate text-right text-xs text-theme-subtle sm:max-w-none">
                  {lastMessageTime}
                </span>
              )}
            </div>

            {lastMessageText && (
              <p className={`text-sm line-clamp-1 ${unread_count > 0 ? 'text-theme-muted' : 'text-theme-subtle'}`}>
                {lastMessageText}
              </p>
            )}
          </div>

          {unread_count > 0 && (
            <Circle className="w-3 h-3 fill-accent text-accent flex-shrink-0" aria-hidden="true" />
          )}
        </div>
      </GlassCard>
    </Link>
  );
}

interface ArchivedConversationCardProps {
  conversation: Conversation;
  onRestore: () => void;
}

function ArchivedConversationCard({ conversation, onRestore }: ArchivedConversationCardProps) {
  const { t } = useTranslation('messages');
  const other_user = getOtherUser(conversation);
  const { last_message } = conversation;
  const displayName = other_user.name || t('unknown_user');
  const lastMessageText = last_message?.body || last_message?.content || '';
  const lastMessageTime = last_message ? formatRelativeTime(last_message.created_at || last_message.sent_at || '') : null;

  return (
    <GlassCard className="p-4 sm:p-5">
      <div className="flex items-center gap-3 sm:gap-4">
        <Avatar
          src={resolveAvatarUrl(other_user.avatar)}
          name={displayName}
          size="lg"
          className="ring-2 ring-theme-default opacity-60" />

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h3 className="min-w-0 truncate font-semibold text-theme-muted">
              {displayName}
            </h3>
            {lastMessageTime && (
              <span className="max-w-[6.5rem] flex-shrink-0 truncate text-right text-xs text-theme-subtle sm:max-w-none">
                {lastMessageTime}
              </span>
            )}
          </div>

          {lastMessageText && (
            <p className="text-sm line-clamp-1 text-theme-subtle">
              {lastMessageText}
            </p>
          )}
        </div>

        <Button
          size="sm"
          variant="secondary"
          className="flex-shrink-0 bg-theme-hover text-theme-muted hover:bg-theme-elevated"
          startContent={<RotateCcw className="h-3 w-3" aria-hidden="true" />}
          onPress={onRestore}
          aria-label={t('restore')}
        >
          <span className="hidden sm:inline">{t('restore')}</span>
        </Button>
      </div>
    </GlassCard>
  );
}

function ConversationListSkeleton({ label, count }: { label: string; count: number }) {
  return (
    <div className="space-y-3" aria-label={label} aria-busy="true" role="status">
      {Array.from({ length: count }, (_, index) => (
        <GlassCard key={index} className="p-4 sm:p-5">
          <div className="flex items-center gap-3 sm:gap-4">
            <Skeleton className="h-12 w-12 flex-shrink-0 rounded-full">
              <div className="h-12 w-12 rounded-full bg-surface-tertiary" />
            </Skeleton>
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="w-2/5 rounded-lg">
                <div className="h-4 rounded-lg bg-surface-tertiary" />
              </Skeleton>
              <Skeleton className="w-4/5 rounded-lg">
                <div className="h-3 rounded-lg bg-surface-secondary" />
              </Skeleton>
            </div>
          </div>
        </GlassCard>
      ))}
    </div>
  );
}

export default MessagesPage;
