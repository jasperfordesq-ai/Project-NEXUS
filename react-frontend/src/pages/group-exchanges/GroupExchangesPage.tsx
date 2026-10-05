// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Group Exchanges Page - List view showing user's group exchanges
 *
 * Features:
 * - Tabs: All, Active, Completed, Cancelled
 * - Exchange cards with title, status chip, kind of exchange, participant count, total hours
 * - Click to navigate to detail page
 * - Loading skeleton, empty state
 * - "New Exchange" button links to creation wizard
 *
 * Route: /group-exchanges
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion } from '@/lib/motion';

import Plus from 'lucide-react/icons/plus';
import Users from 'lucide-react/icons/users';
import Clock from 'lucide-react/icons/clock';
import ArrowLeftRight from 'lucide-react/icons/arrow-left-right';
import Calendar from 'lucide-react/icons/calendar';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { CardRowsSkeleton } from '@/components/ui/Skeletons';
import { Tabs, Tab } from '@/components/ui/Tabs';
import { EmptyState } from '@/components/feedback';
import { PageMeta } from '@/components/seo';
import { usePageTitle } from '@/hooks';
import { useAuth, useTenant, useToast } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl, getFormattingLocale } from '@/lib/helpers';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface GroupExchange {
  id: number;
  title: string;
  description: string | null;
  organizer_id: number;
  organizer_name: string;
  organizer_avatar: string | null;
  status: GroupExchangeStatus;
  split_type: 'workshop' | 'team' | 'equal' | 'weighted' | 'custom';
  total_hours: number;
  participant_count: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

type GroupExchangeStatus =
  | 'draft'
  | 'pending_participants'
  | 'pending_broker'
  | 'active'
  | 'pending_confirmation'
  | 'completed'
  | 'cancelled'
  | 'disputed';

interface StatusConfig {
  color: 'default' | 'warning' | 'secondary' | 'primary' | 'success' | 'danger';
}

const STATUS_CONFIGS: Record<GroupExchangeStatus, StatusConfig> = {
  draft: { color: 'default' },
  pending_participants: { color: 'warning' },
  pending_broker: { color: 'secondary' },
  active: { color: 'primary' },
  pending_confirmation: { color: 'warning' },
  completed: { color: 'success' },
  cancelled: { color: 'danger' },
  disputed: { color: 'danger' },
};

const ITEMS_PER_PAGE = 20;

// ─────────────────────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────────────────────

export function GroupExchangesPage() {
  const { t } = useTranslation('group_exchanges');
  usePageTitle(t('page_title'));
  const { user } = useAuth();
  const { tenantPath } = useTenant();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [exchanges, setExchanges] = useState<GroupExchange[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [selectedTab, setSelectedTab] = useState(searchParams.get('status') || 'all');

  const abortControllerRef = useRef<AbortController | null>(null);
  const exchangesLengthRef = useRef(0);
  exchangesLengthRef.current = exchanges.length;
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;

  // Load group exchanges
  const loadExchanges = useCallback(async (append = false) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    try {
      if (!append) {
        setIsLoading(true);
        setError(null);
      } else {
        setIsLoadingMore(true);
      }

      const offset = append ? exchangesLengthRef.current : 0;
      const statusFilter = selectedTab !== 'all' ? `&status=${selectedTab}` : '';
      const url = `/v2/group-exchanges?limit=${ITEMS_PER_PAGE}&offset=${offset}${statusFilter}`;

      const response = await api.get<{ data: GroupExchange[]; has_more: boolean }>(url);

      if (abortControllerRef.current?.signal.aborted) return;

      if (response.success && response.data) {
        const items = Array.isArray(response.data) ? response.data : [];
        const more = response.meta?.has_more ?? items.length >= ITEMS_PER_PAGE;

        if (append) {
          setExchanges((prev) => [...prev, ...items]);
        } else {
          setExchanges(items);
        }
        setHasMore(more);
      } else {
        if (!append) {
          setError(tRef.current('error_load_failed'));
        } else {
          toastRef.current.error(tRef.current('toast.load_more_failed'));
        }
      }
    } catch (err) {
      if (abortControllerRef.current?.signal.aborted) return;
      if (err instanceof Error && err.name === 'AbortError') return;
      logError('Failed to load group exchanges', err);
      if (!append) {
        setError(tRef.current('error_load_failed'));
      } else {
        toastRef.current.error(tRef.current('toast.load_more_failed'));
      }
    } finally {
      if (!abortControllerRef.current?.signal.aborted) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [selectedTab]);

  const loadExchangesRef = useRef(loadExchanges);
  loadExchangesRef.current = loadExchanges;

  const loadMore = useCallback(() => {
    if (isLoadingMore || !hasMore) return;
    loadExchanges(true);
  }, [isLoadingMore, hasMore, loadExchanges]);

  // Reload on tab change
  useEffect(() => {
    loadExchangesRef.current();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [selectedTab]);

  function handleTabChange(key: string | number) {
    setSelectedTab(key.toString());
    setSearchParams({ status: key.toString() });
    setHasMore(true);
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <PageMeta title={t('page_meta.list.title')} noIndex />
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-theme-primary">
            {t('title')}
          </h1>
          <p className="text-theme-muted mt-1">
            {t('subtitle')}
          </p>
        </div>
        <Button as={Link} to={tenantPath('/group-exchanges/create')}
          className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
          startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
        >
          {t('new_exchange')}
        </Button>
      </div>

      {/* Tabs */}
      <GlassCard className="p-2">
        <Tabs
          selectedKey={selectedTab}
          onSelectionChange={handleTabChange}
          variant="light"
          aria-label={t('tabs_aria')}
          classNames={{
            tabList: 'gap-2',
            tab: 'px-4 py-2',
          }}
        >
          <Tab key="all" title={t('tab_all')} aria-label={t('tab_all_aria')} />
          <Tab key="active" title={t('tab_active')} aria-label={t('tab_active_aria')} />
          <Tab key="pending_confirmation" title={t('tab_needs_confirmation')} aria-label={t('tab_needs_confirmation_aria')} />
          <Tab key="completed" title={t('tab_completed')} aria-label={t('tab_completed_aria')} />
          <Tab key="cancelled" title={t('tab_cancelled')} aria-label={t('tab_cancelled_aria')} />
        </Tabs>
      </GlassCard>

      {/* Error State */}
      {error && !isLoading && (
        <GlassCard role="alert" className="p-8 text-center">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h3 className="text-lg font-semibold text-theme-primary mb-2">{t('unable_to_load')}</h3>
          <p className="text-theme-muted mb-4">{error}</p>
          <Button
            className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={() => loadExchanges()}
          >
            {t('try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Exchange List */}
      {!error && (
        <>
          {isLoading ? (
            <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="space-y-4">
              {[1, 2, 3, 4].map((i) => (
                <CardRowsSkeleton key={i} className="p-6" />
              ))}
            </div>
          ) : exchanges.length === 0 ? (
            <EmptyState
              icon={<ArrowLeftRight className="w-12 h-12" />}
              title={t('empty_title')}
              description={
                selectedTab === 'all'
                  ? t('empty_description_all')
                  : t('empty_description_filtered')
              }
              action={
                <Button as={Link} to={tenantPath('/group-exchanges/create')} className="bg-gradient-to-r from-accent to-accent-gradient-end text-white">
                  {t('create_exchange')}
                </Button>
              }
            />
          ) : (
            <div className="space-y-4">
              {exchanges.map((exchange) => {
                const statusConfig = STATUS_CONFIGS[exchange.status] || STATUS_CONFIGS.draft;
                const isOrganizer = exchange.organizer_id === user?.id;

                return (
                  <Link key={exchange.id} to={tenantPath(`/group-exchanges/${exchange.id}`)}>
                    <article
                      className="block"
                      aria-label={t('card_aria', { title: exchange.title, status: t('status.' + exchange.status) })}
                    >
                      <GlassCard className="p-4 sm:p-6 hover:border-accent/30 transition-colors cursor-pointer">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                          {/* Organizer Avatar */}
                          <Avatar
                            src={resolveAvatarUrl(exchange.organizer_avatar)}
                            name={exchange.organizer_name || 'Unknown'}
                            size="lg"
                            className="flex-shrink-0"
                          />

                          {/* Exchange Info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <h3 className="font-semibold text-theme-primary truncate">
                                {exchange.title}
                              </h3>
                              <Chip
                                size="sm"
                                color={statusConfig.color}
                                variant="flat"
                              >
                                {t('status.' + exchange.status)}
                              </Chip>
                            </div>

                            <div className="flex flex-wrap items-center gap-4 text-sm text-theme-muted">
                              <span className="flex items-center gap-1">
                                <Users className="w-4 h-4" aria-hidden="true" />
                                {t('participants_count', { count: exchange.participant_count })}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-4 h-4" aria-hidden="true" />
                                {t('hours_count', { count: Number(exchange.total_hours) })}
                              </span>
                              <span className="flex items-center gap-1">
                                <Calendar className="w-4 h-4" aria-hidden="true" />
                                <time dateTime={exchange.created_at}>
                                  {new Date(exchange.created_at).toLocaleDateString(getFormattingLocale())}
                                </time>
                              </span>
                            </div>

                            {/* Role indicator */}
                            <div className="mt-2">
                              <Chip
                                size="sm"
                                variant="flat"
                                className={isOrganizer
                                  ? 'bg-accent/20 text-accent dark:text-accent'
                                  : 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400'}
                              >
                                {isOrganizer ? t('role_organizer') : t('role_participant')}
                              </Chip>
                            </div>
                          </div>

                          {/* Split type badge */}
                          <div className="flex-shrink-0">
                            <Chip size="sm" variant="flat" className="bg-theme-elevated text-theme-muted">
                              {t('kinds.' + exchange.split_type + '.title')}
                            </Chip>
                          </div>
                        </div>
                      </GlassCard>
                    </article>
                  </Link>
                );
              })}

              {/* Load More Button */}
              {hasMore && (
                <div className="pt-4 text-center">
                  <Button
                    variant="flat"
                    className="bg-theme-elevated text-theme-muted"
                    onPress={loadMore}
                    isLoading={isLoadingMore}
                  >
                    {t('load_more')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}

export default GroupExchangesPage;
