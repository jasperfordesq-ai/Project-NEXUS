// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { MobileFilterBar } from '@/components/ui/MobileFilterBar';
import { ExchangeCardSkeleton } from '@/components/ui/Skeletons';
import { Tabs, Tab } from '@/components/ui/Tabs';
import {
  ExchangeFilterSheet,
  EXCHANGE_STATUS_FILTERS,
} from '@/components/exchanges/ExchangeFilterSheet';
/**
 * Exchanges Page - View and manage exchange requests
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import Clock from 'lucide-react/icons/clock';
import Calendar from 'lucide-react/icons/calendar';
import User from 'lucide-react/icons/user';
import Plus from 'lucide-react/icons/plus';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { useAuth, useToast, useTenant } from '@/contexts';
import { PageMeta } from '@/components/seo';
import { usePageTitle } from '@/hooks';
// Direct hook paths, not the '@/hooks' barrel: page tests replace that barrel with
// a partial stub, so a barrel import would resolve to undefined and crash them.
import { useSetAppBarTitle } from '@/hooks/useAppBarTitle';
import { useHeaderScroll } from '@/hooks/useHeaderScroll';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl, getFormattingLocale } from '@/lib/helpers';
import { EXCHANGE_STATUS_CONFIG } from '@/lib/exchange-status';
import type { Exchange, ExchangeConfig } from '@/types/api';

const ITEMS_PER_PAGE = 20;

/**
 * Single source of truth for the list query string, so the fetch and any future
 * count probe cannot drift apart. `all` means "no status filter" — the param is
 * omitted rather than sent as `status=all`.
 *
 * NOTE (pre-existing, deliberately untouched here): `limit`/`offset` are ignored
 * by `ExchangesController::index`, which reads `per_page`/`cursor`. See the
 * "Load More" note in the JSX.
 */
function buildExchangesQuery(status: string, offset: number): string {
  return status !== 'all'
    ? `?status=${status}&limit=${ITEMS_PER_PAGE}&offset=${offset}`
    : `?limit=${ITEMS_PER_PAGE}&offset=${offset}`;
}

export function ExchangesPage() {
  const { t } = useTranslation('exchanges');
  usePageTitle(t('page_title'));
  // Phone layout: the page header is hidden and its title moves into the app bar.
  // Called above the feature-gate early returns below — hooks cannot be conditional.
  useSetAppBarTitle(t('title'));
  const isPhone = useMediaQuery('(max-width: 639px)');
  const { isUtilityBarVisible: showMobileControls } = useHeaderScroll(64);
  const { user } = useAuth();
  const { tenantPath, hasFeature } = useTenant();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [config, setConfig] = useState<ExchangeConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [selectedTab, setSelectedTab] = useState(searchParams.get('status') || 'active');
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);

  // Refs for race condition prevention
  const abortControllerRef = useRef<AbortController | null>(null);
  const configLoadedRef = useRef(false);
  const tRef = useRef(t);
  tRef.current = t;
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const loadExchangesRef = useRef<(append?: boolean) => Promise<void>>(null!);

  // Load config once on mount
  const loadConfig = useCallback(async () => {
    if (configLoadedRef.current) return;

    try {
      const response = await api.get<ExchangeConfig>('/v2/exchanges/config');
      if (response.success && response.data) {
        setConfig(response.data);
        configLoadedRef.current = true;
      } else {
        // Without config the load-effect never fires — surface the error UI
        // instead of leaving the skeleton up forever.
        logError('Failed to load exchange config', response.error);
        setError(tRef.current('error.load_failed'));
        setIsLoading(false);
      }
    } catch (err) {
      logError('Failed to load exchange config', err);
      setError(tRef.current('error.load_failed'));
      setIsLoading(false);
    }
  }, []);

  // Load exchanges with abort controller for race condition prevention
  const loadExchanges = useCallback(async (append = false) => {
    // Cancel previous request
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      if (!append) {
        setIsLoading(true);
        setError(null);
      } else {
        setIsLoadingMore(true);
      }

      const offset = append ? exchanges.length : 0;
      const queryString = buildExchangesQuery(selectedTab, offset);

      const response = await api.get<Exchange[]>(`/v2/exchanges${queryString}`);
      if (controller.signal.aborted) return;

      if (response.success && response.data) {
        if (append) {
          setExchanges((prev) => [...prev, ...response.data!]);
        } else {
          setExchanges(response.data);
        }
        setHasMore(response.meta?.has_more ?? (response.data?.length ?? 0) >= ITEMS_PER_PAGE);
      } else {
        if (!append) {
          setError(tRef.current('error.load_failed'));
        } else {
          toastRef.current.error(tRef.current('toast.load_more_failed'));
        }
      }
    } catch (err) {
      if (controller.signal.aborted) return;

      logError('Failed to load exchanges', err);
      if (!append) {
        setError(tRef.current('error.load_failed'));
      } else {
        toastRef.current.error(tRef.current('toast.load_more_failed'));
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [selectedTab, exchanges.length]);
  loadExchangesRef.current = loadExchanges;

  // Load more exchanges
  const loadMoreExchanges = useCallback(() => {
    if (isLoadingMore || !hasMore) return;
    loadExchangesRef.current(true);
  }, [isLoadingMore, hasMore]);

  // Load config on mount
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Load exchanges on tab change — but only after config has loaded and the
  // backend says the workflow is enabled. Otherwise GET /v2/exchanges returns
  // 400 FEATURE_DISABLED (the same gate the empty-state below uses) and we
  // pollute the console + show a generic load-failure on a feature that's
  // simply turned off at the broker-control level.
  useEffect(() => {
    if (!hasFeature('exchange_workflow')) return;
    if (!config) return; // wait for config; the early returns below handle it
    if (!config.exchange_workflow_enabled) return;

    loadExchangesRef.current();
    // Cleanup on unmount
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [selectedTab, config, hasFeature]);

  function handleTabChange(key: string | number) {
    setSelectedTab(key.toString());
    setSearchParams({ status: key.toString() });
    setHasMore(true);
  }

  // Phone bar: the status IS this page's primary navigation, not a refinement, so
  // the sticky Filters button is labelled with the bucket you are looking at
  // rather than a generic "Filters". An unrecognised `?status=` value (nothing to
  // name) falls back to the shared `common:filter_bar.filters` default.
  const activeStatusLabelKey = EXCHANGE_STATUS_FILTERS.find(
    (option) => option.key === selectedTab,
  )?.labelKey;
  const activeStatusLabel = activeStatusLabelKey ? t(activeStatusLabelKey) : undefined;

  const isRequester = (exchange: Exchange) => exchange.requester_id === user?.id;
  const isProvider = (exchange: Exchange) => exchange.provider_id === user?.id;
  const otherParty = (exchange: Exchange) =>
    isRequester(exchange) ? exchange.provider : exchange.requester;

  // Show empty state if the tenant feature gate is off
  if (!hasFeature('exchange_workflow')) {
    return (
      <EmptyState
        icon={<ArrowRightLeft className="w-12 h-12" />}
        title={t('workflow_not_enabled_title')}
        description={t('workflow_not_enabled_description')}
        action={
          <Button as={Link} to={tenantPath("/listings")} className="bg-gradient-to-r from-accent to-accent-gradient-end text-white">
            {t('browse_listings')}
          </Button>
        }
      />
    );
  }

  // Show empty state if exchange workflow is not enabled
  if (configLoadedRef.current && !config?.exchange_workflow_enabled) {
    return (
      <EmptyState
        icon={<ArrowRightLeft className="w-12 h-12" />}
        title={t('workflow_not_enabled_title')}
        description={t('workflow_not_enabled_description')}
        action={
          <Button as={Link} to={tenantPath("/listings")} className="bg-gradient-to-r from-accent to-accent-gradient-end text-white">
            {t('browse_listings')}
          </Button>
        }
      />
    );
  }

  return (
    <div
      className="space-y-6"
    >
      <PageMeta title={t('page_meta.list.title')} noIndex />
      {/* Header — phones hide it entirely; the title lives in the app bar
          (useSetAppBarTitle) and the "Browse Listings" CTA is re-homed into the
          sticky bar below, since the header was its only phone entry point once
          the list is non-empty. */}
      {!isPhone && (
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-theme-primary">
            {t('title')}
          </h1>
          <p className="text-theme-muted mt-1">
            {t('subtitle')}
          </p>
        </div>
        <Button as={Link} to={tenantPath("/listings")}
          className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
          startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
        >
          {t('browse_listings')}
        </Button>
      </div>
      )}

      {/* Phone: slim sticky bar replacing the horizontally-scrolling tab strip.
          No search pill (the page has no search), no view modes, and no removable
          chip row — a single-select status with a non-empty default produces no
          meaningful "✕" chips. */}
      {isPhone && (
        <MobileFilterBar
          isVisible={showMobileControls}
          accent="accent"
          testId="exchanges-filter-bar"
          onFiltersPress={() => setIsFilterSheetOpen(true)}
          labels={{
            // `region` deliberately keeps the shared common:filter_bar.filter_form
            // default: reusing the tab strip's "Exchange status filter" name here
            // would give two different controls the same accessible name.
            filters: activeStatusLabel,
            moreFilters: activeStatusLabel
              ? t('tabs.filter_button_aria', { status: activeStatusLabel })
              : undefined,
          }}
          trailing={
            <Button
              as={Link}
              to={tenantPath("/listings")}
              isIconOnly
              aria-label={t('browse_listings')}
              className="size-11 min-h-11 min-w-11 shrink-0 rounded-full bg-gradient-to-r from-accent to-accent-gradient-end text-white"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
            </Button>
          }
        />
      )}

      {/* Tabs (desktop and tablet — phones use the sticky bar + sheet) */}
      {!isPhone && (
      <GlassCard className="p-2">
        <Tabs
          selectedKey={selectedTab}
          onSelectionChange={handleTabChange}
          variant="light"
          aria-label={t('tabs.aria_label')}
          classNames={{
            tabList: 'gap-2',
            tab: 'px-4 py-2',
          }}
        >
          <Tab key="active" title={t('tabs.active')} aria-label={t('tabs.active_aria')} />
          <Tab key="pending_confirmation" title={t('tabs.needs_confirmation')} aria-label={t('tabs.needs_confirmation_aria')} />
          <Tab key="completed" title={t('tabs.completed')} aria-label={t('tabs.completed_aria')} />
          <Tab key="all" title={t('tabs.all')} aria-label={t('tabs.all_aria')} />
        </Tabs>
      </GlassCard>
      )}

      {/* Error State */}
      {error && !isLoading && (
        <GlassCard className="p-8 text-center" role="alert">
          <AlertTriangle className="w-12 h-12 text-[var(--color-warning)] mx-auto mb-4" aria-hidden="true" />
          <h3 className="text-lg font-semibold text-theme-primary mb-2">{t('error.unable_to_load')}</h3>
          <p className="text-theme-muted mb-4">{error}</p>
          <Button
            className="bg-gradient-to-r from-accent to-accent-gradient-end text-white"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={() => {
              if (!configLoadedRef.current) {
                // Config never loaded — refetch it; the load-effect picks up
                // the exchanges once config arrives.
                setError(null);
                setIsLoading(true);
                loadConfig();
              } else {
                loadExchanges();
              }
            }}
          >
            {t('try_again')}
          </Button>
        </GlassCard>
      )}

      {/* Exchanges List */}
      {!error && (
        <>
          {isLoading ? (
            <div role="status" className="space-y-4" aria-busy="true" aria-label={t('loading')}>
              {[1, 2, 3, 4].map((i) => (
                <ExchangeCardSkeleton key={i} />
              ))}
            </div>
          ) : exchanges.length === 0 ? (
            <EmptyState
              icon={<ArrowRightLeft className="w-12 h-12" />}
              title={t('empty.title')}
              description={
                selectedTab === 'active'
                  ? t('empty.active_description')
                  : t('empty.filter_description')
              }
              action={
                <Button as={Link} to={tenantPath("/listings")} className="bg-gradient-to-r from-accent to-accent-gradient-end text-white">
                  {t('browse_listings')}
                </Button>
              }
            />
          ) : (
            <div className="space-y-4">
              {exchanges.map((exchange) => {
                const statusConfig = EXCHANGE_STATUS_CONFIG[exchange.status];
                const StatusIcon = statusConfig.icon;
                const other = otherParty(exchange);

                return (
                  <Link key={exchange.id} to={tenantPath(`/exchanges/${exchange.id}`)}>
                    <article
                      className="block"
                      aria-label={t('card.aria_label', { title: exchange.listing?.title || t('service_exchange'), status: statusConfig.label })}
                    >
                      <GlassCard className="p-4 sm:p-6 hover:border-accent/30 transition-colors cursor-pointer">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
                          {/* Other party avatar */}
                          <Avatar
                            src={resolveAvatarUrl(other?.avatar)}
                            name={other?.name || t('unknown')}
                            size="lg"
                            className="flex-shrink-0"
                          />

                          {/* Exchange info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <h3 className="font-semibold text-theme-primary truncate">
                                {exchange.listing?.title || t('service_exchange')}
                              </h3>
                              <Chip
                                size="sm"
                                color={statusConfig.color}
                                variant="flat"
                                startContent={<StatusIcon className="w-3 h-3" aria-hidden="true" />}
                              >
                                {statusConfig.label}
                              </Chip>
                            </div>

                            <div className="flex flex-wrap items-center gap-4 text-sm text-theme-muted">
                              <span className="flex items-center gap-1">
                                <User className="w-4 h-4" aria-hidden="true" />
                                {isRequester(exchange) ? t('card.with_party', { name: other?.name || t('unknown') }) : t('card.from_party', { name: other?.name || t('unknown') })}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-4 h-4" aria-hidden="true" />
                                {t('hours_count', { count: exchange.proposed_hours })}
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
                                className={isRequester(exchange)
                                  ? 'bg-amber-500/20 text-amber-700 dark:text-amber-400'
                                  : 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-400'}
                              >
                                {isRequester(exchange) ? t('card.you_requested') : t('card.you_providing')}
                              </Chip>
                            </div>
                          </div>

                          {/* Action needed indicator */}
                          {exchange.status === 'pending_confirmation' && (
                            <div className="flex-shrink-0">
                              {(isRequester(exchange) && !exchange.requester_confirmed_at) ||
                               (isProvider(exchange) && !exchange.provider_confirmed_at) ? (
                                <Chip color="warning" variant="flat">
                                  {t('card.confirm_hours')}
                                </Chip>
                              ) : (
                                <Chip color="default" variant="flat">
                                  {t('card.waiting_for_other')}
                                </Chip>
                              )}
                            </div>
                          )}

                          {exchange.status === 'pending_provider' && isProvider(exchange) && (
                            <Chip color="warning" variant="flat">
                              {t('card.respond')}
                            </Chip>
                          )}
                        </div>
                      </GlassCard>
                    </article>
                  </Link>
                );
              })}

              {/* Load More Button
                  🔴 KNOWN PRE-EXISTING BUG (out of scope for the phone layout):
                  we send limit/offset but ExchangesController::index reads
                  per_page/cursor, so appending refetches page 1 and duplicates
                  rows. Fix with response.meta.cursor, not infinite scroll. */}
              {hasMore && (
                <div className="pt-4 text-center">
                  <Button
                    variant="flat"
                    className="bg-theme-elevated text-theme-muted"
                    onPress={loadMoreExchanges}
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

      {/* Phone: status picker. Simple archetype — each tap applies immediately and
          closes; there is no total in the API meta to drive a draft "Show N" footer. */}
      {isPhone && (
        <ExchangeFilterSheet
          isOpen={isFilterSheetOpen}
          onClose={() => setIsFilterSheetOpen(false)}
          status={selectedTab}
          onStatusChange={handleTabChange}
        />
      )}
    </div>
  );
}

export default ExchangesPage;
