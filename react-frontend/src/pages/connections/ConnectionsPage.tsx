import { Button, SearchField, Card, CardBody, Chip, Avatar, Tabs, Tab, Skeleton } from '@/components/ui';
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Connections Page
 *
 * Manage connections, pending requests, and sent requests.
 * Uses GET /api/v2/connections with status filter and cursor-based pagination.
 * Uses POST /api/v2/connections/{id}/accept and DELETE /api/v2/connections/{id}.
 * Uses POST /api/v2/connections/request to send a request.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion } from '@/lib/motion';

import Users2 from 'lucide-react/icons/users-round';
import UserCheck from 'lucide-react/icons/user-check';
import UserX from 'lucide-react/icons/user-x';
import UserMinus from 'lucide-react/icons/user-minus';
import MessageSquare from 'lucide-react/icons/message-square';
import UserPlus from 'lucide-react/icons/user-plus';
import Clock from 'lucide-react/icons/clock';
import Send from 'lucide-react/icons/send';
import { useTenant, useToast } from '@/contexts';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { resolveAvatarUrl, getFormattingLocale } from '@/lib/helpers';
import { stripHtmlToText } from '@/lib/sanitize';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ConnectionUser {
  id: number;
  name: string;
  avatar_url: string | null;
  location: string | null;
  bio: string | null;
}

interface Connection {
  connection_id: number;
  user: ConnectionUser;
  status: string;
  created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton card
// ─────────────────────────────────────────────────────────────────────────────

function ConnectionSkeleton() {
  return (
    <Card className="bg-theme-elevated border border-theme-default">
      <CardBody className="p-4">
        <div className="flex items-start gap-3">
          <Skeleton className="w-12 h-12 rounded-full flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <Skeleton className="h-4 w-28 rounded mb-2" />
            <Skeleton className="h-3 w-20 rounded mb-2" />
            <Skeleton className="h-3 w-40 rounded" />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <Skeleton className="h-8 w-24 rounded-lg" />
          <Skeleton className="h-8 w-24 rounded-lg" />
        </div>
      </CardBody>
    </Card>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────────────────────

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
}

function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-14 h-14 rounded-2xl bg-theme-elevated flex items-center justify-center mb-4 text-theme-muted">
        {icon}
      </div>
      <h3 className="font-semibold text-theme-primary mb-1">{title}</h3>
      <p className="text-sm text-theme-muted max-w-xs mb-4">{description}</p>
      {action}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection card — accepted connections
// ─────────────────────────────────────────────────────────────────────────────

interface ConnectionCardProps {
  connection: Connection;
  onDisconnect: (connectionId: number) => void;
  isActing: boolean;
  tenantPathFn: (path: string) => string;
}

function ConnectionCard({ connection, onDisconnect, isActing, tenantPathFn }: ConnectionCardProps) {
  const { t } = useTranslation('connections');
  const { user } = connection;
  const joinedDate = new Date(connection.created_at).toLocaleDateString(getFormattingLocale(), {
    year: 'numeric',
    month: 'short',
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="bg-theme-elevated border border-theme-default hover:border-accent dark:hover:border-accent transition-colors">
        <CardBody className="p-4">
          <div className="flex items-start gap-3">
            <Link to={tenantPathFn(`/profile/${user.id}`)}>
              <Avatar
                name={user.name}
                src={resolveAvatarUrl(user.avatar_url ?? undefined)}
                size="md"
                showFallback
                classNames={{ base: 'flex-shrink-0 cursor-pointer' }}
              />
            </Link>
            <div className="flex-1 min-w-0">
              <Link
                to={tenantPathFn(`/profile/${user.id}`)}
                className="font-semibold text-theme-primary hover:text-accent transition-colors truncate block"
              >
                {user.name}
              </Link>
              {user.location && (
                <p className="text-xs text-theme-muted mt-0.5 truncate">{user.location}</p>
              )}
              {user.bio && (
                <p className="text-sm text-theme-muted mt-1 line-clamp-2">{stripHtmlToText(user.bio)}</p>
              )}
              <p className="text-xs text-theme-muted mt-1.5">
                {t('connected_since', { date: joinedDate })}
              </p>
            </div>
          </div>

          <div className="flex gap-2 mt-4 flex-wrap">
            <Button
              as={Link}
              to={tenantPathFn(`/messages/new/${user.id}`)}
              size="sm"
              variant="flat"
              color="primary"
              startContent={<MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />}
            >
              {t('message')}
            </Button>
            <Button
              size="sm"
              variant="flat"
              color="danger"
              startContent={<UserMinus className="w-3.5 h-3.5" aria-hidden="true" />}
              onPress={() => onDisconnect(connection.connection_id)}
              isLoading={isActing}
              isDisabled={isActing}
            >
              {t('disconnect')}
            </Button>
          </div>
        </CardBody>
      </Card>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pending request card (incoming — someone sent to me)
// ─────────────────────────────────────────────────────────────────────────────

interface PendingCardProps {
  connection: Connection;
  onAccept: (connectionId: number) => void;
  onDecline: (connectionId: number) => void;
  isActing: boolean;
  tenantPathFn: (path: string) => string;
}

function PendingCard({ connection, onAccept, onDecline, isActing, tenantPathFn }: PendingCardProps) {
  const { t } = useTranslation('connections');
  const { user } = connection;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="bg-theme-elevated border border-theme-default">
        <CardBody className="p-4">
          <div className="flex items-start gap-3">
            <Link to={tenantPathFn(`/profile/${user.id}`)}>
              <Avatar
                name={user.name}
                src={resolveAvatarUrl(user.avatar_url ?? undefined)}
                size="md"
                showFallback
                classNames={{ base: 'flex-shrink-0 cursor-pointer' }}
              />
            </Link>
            <div className="flex-1 min-w-0">
              <Link
                to={tenantPathFn(`/profile/${user.id}`)}
                className="font-semibold text-theme-primary hover:text-accent transition-colors truncate block"
              >
                {user.name}
              </Link>
              {user.location && (
                <p className="text-xs text-theme-muted mt-0.5 truncate">{user.location}</p>
              )}
              {user.bio && (
                <p className="text-sm text-theme-muted mt-1 line-clamp-2">{stripHtmlToText(user.bio)}</p>
              )}
              <div className="flex items-center gap-1 mt-1.5">
                <Clock className="w-3 h-3 text-[var(--color-warning)]" aria-hidden="true" />
                <p className="text-xs text-theme-warning font-medium">
                  {t('wants_to_connect')}
                </p>
              </div>
            </div>
          </div>

          <div className="flex gap-2 mt-4 flex-wrap">
            <Button
              size="sm"
              color="primary"
              startContent={<UserCheck className="w-3.5 h-3.5" aria-hidden="true" />}
              onPress={() => onAccept(connection.connection_id)}
              isLoading={isActing}
              isDisabled={isActing}
            >
              {t('accept')}
            </Button>
            <Button
              size="sm"
              variant="flat"
              color="danger"
              startContent={<UserX className="w-3.5 h-3.5" aria-hidden="true" />}
              onPress={() => onDecline(connection.connection_id)}
              isLoading={isActing}
              isDisabled={isActing}
            >
              {t('decline')}
            </Button>
          </div>
        </CardBody>
      </Card>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sent request card (outgoing — I sent to someone)
// ─────────────────────────────────────────────────────────────────────────────

interface SentCardProps {
  connection: Connection;
  onCancel: (connectionId: number) => void;
  isActing: boolean;
  tenantPathFn: (path: string) => string;
}

function SentCard({ connection, onCancel, isActing, tenantPathFn }: SentCardProps) {
  const { t } = useTranslation('connections');
  const { user } = connection;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.2 }}
    >
      <Card className="bg-theme-elevated border border-theme-default">
        <CardBody className="p-4">
          <div className="flex items-start gap-3">
            <Link to={tenantPathFn(`/profile/${user.id}`)}>
              <Avatar
                name={user.name}
                src={resolveAvatarUrl(user.avatar_url ?? undefined)}
                size="md"
                showFallback
                classNames={{ base: 'flex-shrink-0 cursor-pointer' }}
              />
            </Link>
            <div className="flex-1 min-w-0">
              <Link
                to={tenantPathFn(`/profile/${user.id}`)}
                className="font-semibold text-theme-primary hover:text-accent transition-colors truncate block"
              >
                {user.name}
              </Link>
              {user.location && (
                <p className="text-xs text-theme-muted mt-0.5 truncate">{user.location}</p>
              )}
              {user.bio && (
                <p className="text-sm text-theme-muted mt-1 line-clamp-2">{stripHtmlToText(user.bio)}</p>
              )}
              <div className="flex items-center gap-1 mt-1.5">
                <Send className="w-3 h-3 text-accent" aria-hidden="true" />
                <p className="text-xs text-accent dark:text-accent font-medium">
                  {t('request_pending')}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4">
            <Button
              size="sm"
              variant="flat"
              color="danger"
              startContent={<UserX className="w-3.5 h-3.5" aria-hidden="true" />}
              onPress={() => onCancel(connection.connection_id)}
              isLoading={isActing}
              isDisabled={isActing}
            >
              {t('cancel_request')}
            </Button>
          </div>
        </CardBody>
      </Card>
    </motion.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

export default function ConnectionsPage() {
  const { t } = useTranslation('connections');
  usePageTitle(t('title'));

  const { tenantPath } = useTenant();
  const { success: toastSuccess, error: toastError, info: toastInfo } = useToast();

  const abortRefs = useRef<Record<string, AbortController | null>>({
    accepted: null,
    pending_received: null,
    pending_sent: null,
  });
  const toastErrorRef = useRef(toastError);
  toastErrorRef.current = toastError;
  const tRef = useRef(t);
  tRef.current = t;
  type TabKey = 'accepted' | 'pending_received' | 'pending_sent';
  const fetchConnectionsRef = useRef<(status: TabKey, cursor?: string | null) => Promise<void>>(null!);

  const [activeTab, setActiveTab] = useState<TabKey>('accepted');
  const [searchQuery, setSearchQuery] = useState('');

  // Connections data by tab
  const [accepted, setAccepted] = useState<Connection[]>([]);
  const [pendingReceived, setPendingReceived] = useState<Connection[]>([]);
  const [pendingSent, setPendingSent] = useState<Connection[]>([]);

  // Pagination cursors
  const [cursors, setCursors] = useState<Record<TabKey, string | null>>({
    accepted: null,
    pending_received: null,
    pending_sent: null,
  });
  const [hasMore, setHasMore] = useState<Record<TabKey, boolean>>({
    accepted: false,
    pending_received: false,
    pending_sent: false,
  });

  // Loading states
  const [loading, setLoading] = useState<Record<TabKey, boolean>>({
    accepted: true,
    pending_received: true,
    pending_sent: true,
  });
  const [loadingMore, setLoadingMore] = useState(false);

  // Per-connection acting state (accepting, declining, etc.)
  const [actingIds, setActingIds] = useState<Set<number>>(new Set());

  const setterMap: Record<TabKey, React.Dispatch<React.SetStateAction<Connection[]>>> = {
    accepted: setAccepted,
    pending_received: setPendingReceived,
    pending_sent: setPendingSent,
  };

  const fetchConnections = useCallback(async (status: TabKey, cursor?: string | null) => {
    abortRefs.current[status]?.abort();
    const controller = new AbortController();
    abortRefs.current[status] = controller;

    const isInitial = !cursor;
    if (isInitial) {
      setLoading(prev => ({ ...prev, [status]: true }));
    } else {
      setLoadingMore(true);
    }

    try {
      let url = `/v2/connections?status=${status}&per_page=20`;
      if (cursor) url += `&cursor=${cursor}`;

      const response = await api.get<Connection[]>(url);
      if (controller.signal.aborted) return;

      if (response.success && response.data) {
        const items = Array.isArray(response.data) ? response.data : [];
        const nextCursor = response.meta?.cursor ?? null;
        const hasMoreItems = response.meta?.has_more ?? false;

        setterMap[status](prev => isInitial ? items : [...prev, ...items]);
        setCursors(prev => ({ ...prev, [status]: nextCursor }));
        setHasMore(prev => ({ ...prev, [status]: hasMoreItems }));
      } else {
        toastErrorRef.current(response.error || tRef.current('toast_load_failed'));
      }
    } catch {
      if (controller.signal.aborted) return;
      toastErrorRef.current(tRef.current('toast_load_failed'));
    } finally {
      if (!controller.signal.aborted) {
        if (isInitial) {
          setLoading(prev => ({ ...prev, [status]: false }));
        } else {
          setLoadingMore(false);
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- load once on mount
  }, []);
  fetchConnectionsRef.current = fetchConnections;

  // Load all three tabs on mount
  useEffect(() => {
    const abortMap = abortRefs.current;
    void fetchConnectionsRef.current('accepted');
    void fetchConnectionsRef.current('pending_received');
    void fetchConnectionsRef.current('pending_sent');
    return () => {
      abortMap.accepted?.abort();
      abortMap.pending_received?.abort();
      abortMap.pending_sent?.abort();
    };
  }, []);

  const markActing = (id: number, acting: boolean) => {
    setActingIds(prev => {
      const next = new Set(prev);
      if (acting) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleAccept = async (connectionId: number) => {
    markActing(connectionId, true);
    try {
      const response = await api.post(`/v2/connections/${connectionId}/accept`, {});
      if (response.success) {
        // Move from pending_received to accepted
        const accepted_conn = pendingReceived.find(c => c.connection_id === connectionId);
        setPendingReceived(prev => prev.filter(c => c.connection_id !== connectionId));
        if (accepted_conn) {
          setAccepted(prev => [{ ...accepted_conn, status: 'accepted' }, ...prev]);
        }
        toastSuccess(t('toast_accepted'));
      } else {
        toastError(t('toast_accept_failed'));
      }
    } catch {
      toastError(t('toast_accept_failed'));
    } finally {
      markActing(connectionId, false);
    }
  };

  const handleDecline = async (connectionId: number) => {
    markActing(connectionId, true);
    try {
      const response = await api.delete(`/v2/connections/${connectionId}`);
      if (response.success) {
        setPendingReceived(prev => prev.filter(c => c.connection_id !== connectionId));
        toastInfo(t('toast_declined'));
      } else {
        toastError(t('toast_decline_failed'));
      }
    } catch {
      toastError(t('toast_decline_failed'));
    } finally {
      markActing(connectionId, false);
    }
  };

  const handleDisconnect = async (connectionId: number) => {
    markActing(connectionId, true);
    try {
      const response = await api.delete(`/v2/connections/${connectionId}`);
      if (response.success) {
        setAccepted(prev => prev.filter(c => c.connection_id !== connectionId));
        toastInfo(t('toast_disconnected'));
      } else {
        toastError(t('toast_disconnect_failed'));
      }
    } catch {
      toastError(t('toast_disconnect_failed'));
    } finally {
      markActing(connectionId, false);
    }
  };

  const handleCancelSent = async (connectionId: number) => {
    markActing(connectionId, true);
    try {
      const response = await api.delete(`/v2/connections/${connectionId}`);
      if (response.success) {
        setPendingSent(prev => prev.filter(c => c.connection_id !== connectionId));
        toastInfo(t('toast_cancelled'));
      } else {
        toastError(t('toast_cancel_failed'));
      }
    } catch {
      toastError(t('toast_cancel_failed'));
    } finally {
      markActing(connectionId, false);
    }
  };

  // Filter by search query
  const filterBySearch = (items: Connection[]) => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(c =>
      (c.user?.name ?? '').toLowerCase().includes(q) ||
      (c.user?.location ?? '').toLowerCase().includes(q)
    );
  };

  const pendingReceivedCount = pendingReceived.length;
  const pendingSentCount = pendingSent.length;

  return (
    <div className="min-h-screen py-6 px-4">
      <PageMeta title={t('page_meta.title')} noIndex />
      <div className="max-w-3xl mx-auto">
        {/* Hero Banner */}
        <div className="relative overflow-hidden rounded-xl border border-theme-default bg-theme-surface p-5 shadow-sm sm:p-6 mb-6">
          <div className="flex items-center gap-3 mb-2">
            <div className="rounded-lg bg-accent/10 p-2 text-accent dark:text-accent">
              <Users2 className="w-5 h-5" aria-hidden="true" />
            </div>
            <h1 className="text-xl font-bold text-theme-primary">{t('title')}</h1>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-sm text-theme-muted">{t('subtitle')}</p>
            {pendingReceivedCount > 0 && (
              <Chip
                size="sm"
                color="warning"
                variant="soft"
                startContent={<span className="w-1.5 h-1.5 rounded-full bg-warning animate-pulse" aria-hidden="true" />}
              >
                {t('pending_count', { count: pendingReceivedCount })}
              </Chip>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="mb-4">
          <SearchField
            placeholder={t('search_placeholder')}
            value={searchQuery}
            onValueChange={setSearchQuery}
            aria-label={t('search_placeholder')}
            variant="bordered"
            classNames={{
              inputWrapper: 'bg-theme-elevated border-theme-default hover:border-accent',
            }}
            isClearable
            onClear={() => setSearchQuery('')}
          />
        </div>

        {/* Tabs */}
        <Tabs
          selectedKey={activeTab}
          onSelectionChange={(key) => setActiveTab(key as TabKey)}
          variant="underlined"
          classNames={{
            tabList: 'gap-4 border-b border-theme-default',
            cursor: 'bg-accent',
            tab: 'text-sm font-medium',
            tabContent: 'text-theme-muted group-data-[selected=true]:text-accent',
          }}
          aria-label={t('title')}
        >
          <Tab
            key="accepted"
            title={
              <div className="flex items-center gap-2">
                <UserCheck className="w-4 h-4" aria-hidden="true" />
                <span>{t('tab_my_connections')}</span>
                {!loading.accepted && (
                  <Chip size="sm" variant="flat" className="bg-theme-elevated text-xs min-w-[20px]">
                    {accepted.length}
                  </Chip>
                )}
              </div>
            }
          >
            <div className="mt-4">
              {loading.accepted ? (
                <div role="status" aria-label={t('loading')} aria-busy="true">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[1, 2, 3, 4].map(i => <ConnectionSkeleton key={i} />)}
                  </div>
                </div>
              ) : filterBySearch(accepted).length === 0 ? (
                <EmptyState
                  icon={<Users2 className="w-7 h-7" aria-hidden="true" />}
                  title={t('empty_no_connections_title')}
                  description={
                    searchQuery
                      ? t('empty_no_connections_search')
                      : t('empty_no_connections_description')
                  }
                  action={
                    !searchQuery ? (
                      <Button
                        as={Link}
                        to={tenantPath('/members')}
                        color="primary"
                        size="sm"
                        startContent={<UserPlus className="w-4 h-4" aria-hidden="true" />}
                      >
                        {t('find_members')}
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {filterBySearch(accepted).map(connection => (
                      <ConnectionCard
                        key={connection.connection_id}
                        connection={connection}
                        onDisconnect={(id) => void handleDisconnect(id)}
                        isActing={actingIds.has(connection.connection_id)}
                        tenantPathFn={tenantPath}
                      />
                    ))}
                  </div>
                  {hasMore.accepted && !searchQuery && (
                    <div className="mt-4 flex justify-center">
                      <Button
                        variant="flat"
                        onPress={() => void fetchConnections('accepted', cursors.accepted)}
                        isLoading={loadingMore}
                      >
                        {t('load_more')}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </Tab>

          <Tab
            key="pending_received"
            title={
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4" aria-hidden="true" />
                <span>{t('tab_pending')}</span>
                {pendingReceivedCount > 0 && (
                  <Chip size="sm" color="warning" variant="solid" className="text-xs min-w-[20px]">
                    {pendingReceivedCount}
                  </Chip>
                )}
              </div>
            }
          >
            <div className="mt-4">
              {loading.pending_received ? (
                <div role="status" aria-label={t('loading')} aria-busy="true">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[1, 2].map(i => <ConnectionSkeleton key={i} />)}
                  </div>
                </div>
              ) : filterBySearch(pendingReceived).length === 0 ? (
                <EmptyState
                  icon={<UserPlus className="w-7 h-7" aria-hidden="true" />}
                  title={t('empty_no_pending_title')}
                  description={
                    searchQuery
                      ? t('empty_no_pending_search')
                      : t('empty_no_pending_description')
                  }
                />
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {filterBySearch(pendingReceived).map(connection => (
                      <PendingCard
                        key={connection.connection_id}
                        connection={connection}
                        onAccept={(id) => void handleAccept(id)}
                        onDecline={(id) => void handleDecline(id)}
                        isActing={actingIds.has(connection.connection_id)}
                        tenantPathFn={tenantPath}
                      />
                    ))}
                  </div>
                  {hasMore.pending_received && !searchQuery && (
                    <div className="mt-4 flex justify-center">
                      <Button
                        variant="flat"
                        onPress={() => void fetchConnections('pending_received', cursors.pending_received)}
                        isLoading={loadingMore}
                      >
                        {t('load_more')}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </Tab>

          <Tab
            key="pending_sent"
            title={
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4" aria-hidden="true" />
                <span>{t('tab_sent')}</span>
                {pendingSentCount > 0 && (
                  <Chip size="sm" variant="flat" className="bg-theme-elevated text-xs min-w-[20px]">
                    {pendingSentCount}
                  </Chip>
                )}
              </div>
            }
          >
            <div className="mt-4">
              {loading.pending_sent ? (
                <div role="status" aria-label={t('loading')} aria-busy="true">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {[1, 2].map(i => <ConnectionSkeleton key={i} />)}
                  </div>
                </div>
              ) : filterBySearch(pendingSent).length === 0 ? (
                <EmptyState
                  icon={<Send className="w-7 h-7" aria-hidden="true" />}
                  title={t('empty_no_sent_title')}
                  description={
                    searchQuery
                      ? t('empty_no_sent_search')
                      : t('empty_no_sent_description')
                  }
                  action={
                    !searchQuery ? (
                      <Button
                        as={Link}
                        to={tenantPath('/members')}
                        color="primary"
                        size="sm"
                        variant="flat"
                        startContent={<UserPlus className="w-4 h-4" aria-hidden="true" />}
                      >
                        {t('find_members')}
                      </Button>
                    ) : undefined
                  }
                />
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {filterBySearch(pendingSent).map(connection => (
                      <SentCard
                        key={connection.connection_id}
                        connection={connection}
                        onCancel={(id) => void handleCancelSent(id)}
                        isActing={actingIds.has(connection.connection_id)}
                        tenantPathFn={tenantPath}
                      />
                    ))}
                  </div>
                  {hasMore.pending_sent && !searchQuery && (
                    <div className="mt-4 flex justify-center">
                      <Button
                        variant="flat"
                        onPress={() => void fetchConnections('pending_sent', cursors.pending_sent)}
                        isLoading={loadingMore}
                      >
                        {t('load_more')}
                      </Button>
                    </div>
                  )}
                </>
              )}
            </div>
          </Tab>
        </Tabs>
      </div>
    </div>
  );
}
