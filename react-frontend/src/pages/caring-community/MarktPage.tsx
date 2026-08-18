// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MarktPage — Unified "Marktplatz des Vertrauens"
 *
 * Shows time-credit service listings and commercial marketplace items side by
 * side behind the caring_community feature flag, with a source-type toggle.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import ShoppingBag from 'lucide-react/icons/shopping-bag';
import Clock from 'lucide-react/icons/clock';
import Tag from 'lucide-react/icons/tag';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Store from 'lucide-react/icons/store';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tab, Tabs } from '@/components/ui/Tabs';
import { EmptyState } from '@/components/feedback';
import { PageMeta } from '@/components/seo';
import { useAuth, useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { resolveAvatarUrl, resolveThumbnailUrl } from '@/lib/helpers';
import { ProximityFilter } from '@/components/caring-community/ProximityFilter';
import { SubRegionFilter } from '@/components/caring-community/SubRegionFilter';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type MarktTab = 'all' | 'listings' | 'marketplace';

interface MarktItem {
  source: 'listing' | 'marketplace';
  id: number;
  title: string;
  description: string | null;
  listing_type: string | null; // offer|request for listings
  image_url: string | null;
  hours_estimate: number | null;
  price_cash: number | null;
  price_credits: number | null;
  price_type: string | null;
  price_currency: string | null;
  category: string | null;
  user_name: string;
  user_avatar: string | null;
  created_at: string;
  detail_path: string;
}

interface MarktMeta {
  total: number;
  page: number;
  per_page: number;
  has_more: boolean;
  marketplace_available: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton placeholder
// ─────────────────────────────────────────────────────────────────────────────

function MarktCardSkeleton() {
  return (
    <GlassCard className="overflow-hidden">
      <Skeleton className="aspect-video w-full" />
      <div className="p-4 space-y-2">
        <Skeleton className="h-4 w-1/3 rounded-full" />
        <Skeleton className="h-5 w-3/4 rounded" />
        <Skeleton className="h-4 w-full rounded" />
        <Skeleton className="h-4 w-2/3 rounded" />
        <div className="flex items-center justify-between pt-2">
          <Skeleton className="h-8 w-24 rounded-full" />
          <Skeleton className="h-8 w-16 rounded" />
        </div>
      </div>
    </GlassCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Item card
// ─────────────────────────────────────────────────────────────────────────────

interface MarktCardProps {
  item: MarktItem;
}

function MarktCard({ item }: MarktCardProps) {
  const { t } = useTranslation('common');
  const { tenantPath } = useTenant();
  const [imgError, setImgError] = useState(false);

  const isListing = item.source === 'listing';
  const imageUrl = item.image_url ? resolveThumbnailUrl(item.image_url, { width: 640, height: 360 }) : null;
  const avatarSrc = resolveAvatarUrl(item.user_avatar ?? undefined);
  const detailHref = tenantPath(item.detail_path);

  function renderPrice() {
    if (isListing) {
      if (item.hours_estimate != null) {
        return (
          <span className="text-teal-600 dark:text-teal-400 font-semibold text-sm">
            {t('markt.credits_per_hour', { credits: item.hours_estimate })}
          </span>
        );
      }
      return null;
    }
    // marketplace
    if (item.price_type === 'free' || item.price_cash === 0) {
      return <span className="text-theme-success font-semibold text-sm">{t('markt.free')}</span>;
    }
    if (item.price_cash != null && item.price_cash > 0) {
      const currency = item.price_currency ?? 'EUR';
      return (
        <span className="text-theme-primary font-semibold text-sm">
          {currency} {item.price_cash.toFixed(2)}
        </span>
      );
    }
    if (item.price_credits != null) {
      return (
        <span className="text-teal-600 dark:text-teal-400 font-semibold text-sm">
          {t('markt.credits_per_hour', { credits: item.price_credits })}
        </span>
      );
    }
    return null;
  }

  return (
    <GlassCard className="cursor-pointer hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 h-full flex flex-col overflow-hidden">
      {/* Image */}
      <div className="relative aspect-video overflow-hidden bg-theme-elevated">
        {imageUrl && !imgError ? (
          <img
            src={imageUrl}
            alt={item.title}
            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
            decoding="async"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-theme-subtle">
            {isListing ? (
              <Clock className="w-8 h-8 opacity-40" aria-hidden="true" />
            ) : (
              <ShoppingBag className="w-8 h-8 opacity-40" aria-hidden="true" />
            )}
          </div>
        )}

        {/* Source badge */}
        <div className="absolute top-2 left-2">
          {isListing ? (
            <Chip size="sm" className="bg-teal-500/90 text-white backdrop-blur-sm" startContent={<Clock className="w-3 h-3" aria-hidden="true" />}>
              {t('markt.badges.listing')}
            </Chip>
          ) : (
            <Chip size="sm" className="bg-amber-500/90 text-white backdrop-blur-sm" startContent={<ShoppingBag className="w-3 h-3" aria-hidden="true" />}>
              {t('markt.badges.marketplace')}
            </Chip>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-4 flex flex-col flex-1">
        {/* Category */}
        {item.category && (
          <div className="flex items-center gap-1 mb-2">
            <Tag className="w-3 h-3 text-theme-subtle" aria-hidden="true" />
            <span className="text-[11px] text-theme-muted">{item.category}</span>
          </div>
        )}

        {/* Title */}
        <h3 className="font-semibold text-theme-primary text-base mb-1 line-clamp-2">{item.title}</h3>

        {/* Description */}
        {item.description && (
          <p className="text-theme-muted text-sm line-clamp-2 mb-3 flex-1">{item.description}</p>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-theme-default mt-auto">
          {/* Author */}
          <div className="flex items-center gap-2 min-w-0">
            <Avatar
              src={avatarSrc}
              name={item.user_name || t('common.unknown_user')}
              size="sm"
              className="shrink-0 w-7 h-7"
            />
            <span className="text-xs text-theme-subtle truncate">{item.user_name}</span>
          </div>

          {/* Price + View button */}
          <div className="flex items-center gap-2 shrink-0">
            {renderPrice()}
            <Button
              as={Link}
              to={detailHref}
              size="sm"
              variant="flat"
              className="bg-theme-elevated text-theme-primary hover:bg-theme-hover text-xs"
            >
              {t('markt.view')}
            </Button>
          </div>
        </div>
      </div>
    </GlassCard>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export function MarktPage() {
  const { t } = useTranslation('common');
  usePageTitle(t('markt.meta.title'));
  const { isAuthenticated, user } = useAuth();
  const { hasFeature, tenantPath } = useTenant();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<MarktTab>('all');
  const [radiusKm, setRadiusKm] = useState<number | null>(null);
  const [subRegionId, setSubRegionId] = useState<number | null>(null);
  const [items, setItems] = useState<MarktItem[]>([]);
  const [meta, setMeta] = useState<MarktMeta | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Feature gate — redirect if caring_community not enabled
  useEffect(() => {
    if (!hasFeature('caring_community')) {
      navigate(tenantPath('/caring-community'), { replace: true });
    }
  }, [hasFeature, navigate, tenantPath]);

  const loadItems = useCallback(async (reset = false) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (reset) {
        setIsLoading(true);
        setLoadError(null);
      } else {
        setIsLoadingMore(true);
      }

      const params = new URLSearchParams();
      params.set('type', activeTab);
      params.set('page', String(reset ? 1 : page));
      params.set('per_page', '20');

      if (radiusKm !== null && user?.latitude != null && user?.longitude != null) {
        params.set('radius_km', String(radiusKm));
        params.set('lat', String(user.latitude));
        params.set('lng', String(user.longitude));
      }

      if (subRegionId !== null) {
        params.set('sub_region_id', String(subRegionId));
      }

      const response = await api.get<MarktItem[]>(`/v2/caring-community/markt?${params}`);
      if (controller.signal.aborted) return;

      if (response.success && response.data) {
        if (reset) {
          setItems(response.data);
          setPage(2);
        } else {
          setItems((prev) => [...prev, ...response.data!]);
          setPage((p) => p + 1);
        }
        setMeta(response.meta as unknown as MarktMeta);
      } else {
        if (reset) setLoadError(t('markt.errors.load_failed'));
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      logError('MarktPage: failed to load', err);
      if (reset) setLoadError(t('markt.errors.load_failed'));
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [activeTab, page, radiusKm, user?.latitude, user?.longitude, subRegionId, t]);  

  const loadRef = useRef(loadItems);
  loadRef.current = loadItems;

  // Reload when tab changes
  useEffect(() => {
    setPage(1);
    loadRef.current(true);
    return () => { abortRef.current?.abort(); };
  }, [activeTab]);

  // Reload when proximity or sub-region filter changes
  useEffect(() => {
    setPage(1);
    loadRef.current(true);
  }, [radiusKm, user?.latitude, user?.longitude, subRegionId]);

  if (!isAuthenticated) return null;

  const tabs: { key: MarktTab; label: string }[] = [
    { key: 'all', label: t('markt.tabs.all') },
    { key: 'listings', label: t('markt.tabs.listings') },
    { key: 'marketplace', label: t('markt.tabs.marketplace') },
  ];

  const marketplaceAvailable = meta?.marketplace_available ?? hasFeature('marketplace');
  const showMarketplaceNotice = activeTab === 'marketplace' && !marketplaceAvailable;

  const emptyKey = activeTab === 'listings'
    ? 'markt.empty.listings'
    : activeTab === 'marketplace'
      ? 'markt.empty.marketplace'
      : 'markt.empty.all';

  return (
    <>
      <PageMeta
        title={t('markt.meta.title')}
        description={t('markt.meta.description')}
      />

      <div className="space-y-5">
        {/* Hero header */}
        <div className="relative overflow-hidden rounded-xl border border-theme-default bg-theme-surface p-5 shadow-sm sm:p-6">
          <div className="flex items-start gap-4">
            <div className="rounded-lg bg-amber-500/10 p-2.5 text-amber-600 dark:text-amber-400 shrink-0">
              <Store className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-semibold text-theme-primary mb-1">
                {t('markt.meta.title')}
              </h1>
              <p className="text-sm text-theme-muted">{t('markt.subtitle')}</p>
            </div>
          </div>
        </div>

        {/* Tab bar */}
        <Tabs
          aria-label={t('markt.meta.title')}
          selectedKey={activeTab}
          onSelectionChange={(key) => setActiveTab(key as MarktTab)}
          variant="solid"
          classNames={{
            base: 'w-full sm:w-auto',
            tabList: 'flex-wrap border border-theme-default bg-theme-elevated p-1',
            tab: 'h-9 px-4',
            cursor: 'bg-theme-surface shadow-sm',
            tabContent: 'text-sm font-medium group-data-[selected=true]:text-theme-primary',
          }}
        >
          {tabs.map((tab) => (
            <Tab key={tab.key} title={tab.label} />
          ))}
        </Tabs>

        {/* Locality filters: sub-region + proximity */}
        <div className="flex flex-col gap-3 mb-4">
          <SubRegionFilter selectedId={subRegionId} onChange={setSubRegionId} />
          <ProximityFilter
            radiusKm={radiusKm}
            onRadiusChange={setRadiusKm}
          />
        </div>

        {/* Marketplace unavailable notice */}
        {showMarketplaceNotice && (
          <GlassCard className="p-5 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" aria-hidden="true" />
            <p className="text-sm text-theme-secondary">{t('markt.marketplace_unavailable')}</p>
          </GlassCard>
        )}

        {/* Loading skeleton */}
        {isLoading && items.length === 0 ? (
          <div
            role="status"
            className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
            aria-busy="true"
            aria-label={t('loading')}
          >
            {Array.from({ length: 8 }, (_, i) => (
              <MarktCardSkeleton key={i} />
            ))}
          </div>
        ) : loadError ? (
          <GlassCard role="alert" className="p-8 text-center">
            <AlertTriangle className="w-12 h-12 text-warning mx-auto mb-4" aria-hidden="true" />
            <p className="text-theme-muted mb-4">{loadError}</p>
            <Button
              className="bg-linear-to-r from-accent to-accent-gradient-end text-white"
              startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
              onPress={() => loadRef.current(true)}
            >
              {t('markt.retry')}
            </Button>
          </GlassCard>
        ) : items.length === 0 && !showMarketplaceNotice ? (
          <EmptyState
            icon={<Store className="w-12 h-12" aria-hidden="true" />}
            title={t(emptyKey)}
          />
        ) : (
          <>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {items.map((item) => (
                <MarktCard key={`${item.source}-${item.id}`} item={item} />
              ))}
            </div>

            {/* Load more */}
            {meta?.has_more && (
              <div className="flex justify-center pt-4">
                <Button
                  variant="flat"
                  className="bg-theme-elevated text-theme-primary hover:bg-theme-hover"
                  onPress={() => loadRef.current(false)}
                  isLoading={isLoadingMore}
                >
                  {t('markt.load_more')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}

export default MarktPage;
