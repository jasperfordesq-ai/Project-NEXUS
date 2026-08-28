// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MyListingsPage — Seller dashboard showing all of the current user's listings.
 *
 * Features:
 * - Tabs: Active, Draft, Sold, Expired
 * - Stats summary from seller dashboard endpoint
 * - Per-listing actions: Edit, Renew (expired), Remove
 * - "Sell Something" CTA
 * - Cursor-based pagination
 * - Requires authentication
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';

import Plus from 'lucide-react/icons/plus';
import ShoppingBag from 'lucide-react/icons/shopping-bag';
import Package from 'lucide-react/icons/package';
import Edit3 from 'lucide-react/icons/pen-line';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Trash2 from 'lucide-react/icons/trash-2';
import Eye from 'lucide-react/icons/eye';
import DollarSign from 'lucide-react/icons/dollar-sign';
import BarChart3 from 'lucide-react/icons/chart-column';
import Clock from 'lucide-react/icons/clock';
import Truck from 'lucide-react/icons/truck';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { Modal, ModalContent, ModalHeader, ModalBody, ModalFooter } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { Tab, Tabs } from '@/components/ui/Tabs';
import { useDisclosure } from '@/components/ui/useDisclosure';
import { EmptyState } from '@/components/feedback';
import type { MarketplaceListingItem } from '@/types/marketplace';
import { useAuth, useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { getFormattingLocale, resolveThumbnailUrl } from '@/lib/helpers';
import { safeLocalStorageGet, safeLocalStorageSet } from '@/lib/safeStorage';
import { usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo/PageMeta';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

type ListingTab = 'active' | 'draft' | 'sold' | 'expired';

interface SellerDashboardStats {
  active_listings: number;
  draft_listings: number;
  sold_listings: number;
  expired_listings: number;
  total_views: number;
  total_revenue: number | null;
  revenue_currency: string | null;
  revenue_by_currency?: Array<{ currency: string; total: number }>;
  [key: string]: number | string | null | Array<{ currency: string; total: number }> | undefined;
}

interface OnboardingStatus {
  onboarding_completed?: boolean;
  current_step?: number | string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 24;

const TABS: { key: ListingTab; tKey: string; icon: typeof Package }[] = [
  { key: 'active', tKey: 'my_listings.tab_active', icon: Package },
  { key: 'draft', tKey: 'my_listings.tab_draft', icon: Edit3 },
  { key: 'sold', tKey: 'my_listings.tab_sold', icon: DollarSign },
  { key: 'expired', tKey: 'my_listings.tab_expired', icon: Clock },
];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(getFormattingLocale(), {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function MyListingsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation('marketplace');
  usePageTitle(t('my_listings.page_title'));
  const { isAuthenticated, user } = useAuth();
  const { tenantPath } = useTenant();
  const toast = useToast();

  // State
  const [activeTab, setActiveTab] = useState<ListingTab>('active');
  const [listings, setListings] = useState<MarketplaceListingItem[]>([]);
  const [stats, setStats] = useState<SellerDashboardStats | null>(null);
  const [onboardingDone, setOnboardingDone] = useState<boolean>(true);
  const [onboardingDismissed, setOnboardingDismissed] = useState<boolean>(
    () => safeLocalStorageGet('nx_merchant_onboarding_dismissed') === '1'
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const cursorRef = useRef<string | null>(null);

  // Remove modal
  const { isOpen: isRemoveOpen, onOpen: onRemoveOpen, onClose: onRemoveClose } = useDisclosure();
  const [removeTargetId, setRemoveTargetId] = useState<number | null>(null);
  const [isRemoving, setIsRemoving] = useState(false);

  // Redirect if not authenticated
  useEffect(() => {
    if (!isAuthenticated) {
      navigate(tenantPath('/login'), { replace: true });
    }
  }, [isAuthenticated, navigate, tenantPath]);

  // Load seller dashboard stats
  useEffect(() => {
    if (!isAuthenticated) return;
    let cancelled = false;

    const load = async () => {
      setIsLoadingStats(true);
      try {
        const response = await api.get<SellerDashboardStats>('/v2/marketplace/seller/dashboard');
        if (!cancelled && response.success && response.data) {
          setStats(response.data);
        }
      } catch (err) {
        logError('Failed to load seller dashboard stats', err);
      } finally {
        if (!cancelled) setIsLoadingStats(false);
      }
    };

    load();

    // AG48 — onboarding wizard prompt
    (async () => {
      try {
        const res = await api.get<OnboardingStatus>('/v2/merchant-onboarding/status');
        if (!cancelled && res.success && res.data) {
          setOnboardingDone(Boolean(res.data.onboarding_completed));
        }
      } catch {
        /* non-fatal */
      }
    })();

    return () => { cancelled = true; };
  }, [isAuthenticated]);

  // Load listings for the active tab
  const loadListings = useCallback(async (append = false) => {
    if (!user?.id) return;

    try {
      if (!append) {
        setIsLoading(true);
      } else {
        setIsLoadingMore(true);
      }

      const params = new URLSearchParams();
      params.set('user_id', String(user.id));
      params.set('status', activeTab);
      params.set('limit', String(ITEMS_PER_PAGE));
      if (append && cursorRef.current) {
        params.set('cursor', cursorRef.current);
      }

      const response = await api.get<MarketplaceListingItem[]>(
        `/v2/marketplace/listings?${params}`
      );

      if (response.success && response.data) {
        const mapped = (response.data as MarketplaceListingItem[]).map((item) => ({
          ...item,
          is_own: true,
        }));
        if (append) {
          setListings((prev) => [...prev, ...mapped]);
        } else {
          setListings(mapped);
        }
        cursorRef.current = response.meta?.cursor ?? response.meta?.next_cursor ?? null;
        setHasMore(response.meta?.has_more ?? response.data.length >= ITEMS_PER_PAGE);
      } else if (!append) {
        setListings([]);
      }
    } catch (err) {
      logError('Failed to load my listings', err);
      if (!append) {
        toast.error(t('my_listings.load_error'));
      }
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [user?.id, activeTab, toast, t])

  // Reload on tab change
  useEffect(() => {
    if (!isAuthenticated) return;
    cursorRef.current = null;
    setHasMore(true);
    loadListings();
  }, [activeTab, isAuthenticated]); // eslint-disable-line react-hooks/exhaustive-deps

  // Renew listing
  const handleRenew = useCallback(async (listingId: number) => {
    try {
      const response = await api.post(`/v2/marketplace/listings/${listingId}/renew`);
      if (response.success) {
        toast.success(t('my_listings.renewed_success'));
        // Refresh listings
        cursorRef.current = null;
        loadListings();
      } else {
        toast.error(response.error || t('my_listings.renewed_error'));
      }
    } catch (err) {
      logError('Failed to renew listing', err);
      toast.error(t('my_listings.renewed_error'));
    }
  }, [toast, loadListings, t])

  // Remove listing
  const confirmRemove = useCallback((listingId: number) => {
    setRemoveTargetId(listingId);
    onRemoveOpen();
  }, [onRemoveOpen]);

  const handleRemove = useCallback(async () => {
    if (removeTargetId == null) return;
    setIsRemoving(true);
    try {
      const response = await api.delete(`/v2/marketplace/listings/${removeTargetId}`);
      if (response.success) {
        toast.success(t('my_listings.removed_success'));
        setListings((prev) => prev.filter((l) => l.id !== removeTargetId));
        // Update stats
        if (stats) {
          setStats((prev) => prev ? { ...prev, [`${activeTab}_listings`]: Math.max(0, prev[`${activeTab}_listings`] - 1) } : prev);
        }
        onRemoveClose();
      } else {
        toast.error(response.error || t('my_listings.removed_error'));
      }
    } catch (err) {
      logError('Failed to remove listing', err);
      toast.error(t('my_listings.removed_error'));
    } finally {
      setIsRemoving(false);
    }
  }, [removeTargetId, activeTab, stats, toast, onRemoveClose, t])

  if (!isAuthenticated) return null;

  return (
    <>
      <PageMeta title={t('my_listings.page_title')} noIndex={true} />

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <ShoppingBag className="w-7 h-7 text-accent" />
              {t('my_listings.title')}
            </h1>
            <p className="text-muted text-sm mt-1">
              {t('my_listings.subtitle')}
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button
              as={Link}
              to={tenantPath('/marketplace/seller/shipping-options')}
              variant="secondary"
              startContent={<Truck className="w-4 h-4" />}
            >
              {t('shipping.manage_cta')}
            </Button>
            <Button
              as={Link}
              to={tenantPath('/marketplace/sell')}
              startContent={<Plus className="w-4 h-4" />}
            >
              {t('hub.sell_something')}
            </Button>
          </div>
        </div>

        {/* AG48 — Onboarding nudge */}
        {!onboardingDone && !onboardingDismissed && (
          <GlassCard className="flex flex-col gap-4 border-l-4 border-accent p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="font-semibold text-foreground">
                {t('onboarding.nudge_title')}
              </p>
              <p className="text-sm text-muted">
                {t('onboarding.nudge_description')}
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button
                size="sm"

                as={Link}
                to={tenantPath('/marketplace/seller/onboarding')}
              >
                {t('onboarding.start_cta')}
              </Button>
              <Button
                size="sm"
                variant="tertiary"
                onPress={() => {
                  setOnboardingDismissed(true);
                  safeLocalStorageSet('nx_merchant_onboarding_dismissed', '1');
                }}
              >
                {t('common.dismiss')}
              </Button>
            </div>
          </GlassCard>
        )}

        {/* Stats summary */}
        {!isLoadingStats && stats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <GlassCard className="p-4 text-center">
              <Package className="w-5 h-5 text-accent mx-auto mb-1" />
              <p className="text-2xl font-bold text-foreground">{stats.active_listings}</p>
              <p className="text-xs text-muted">{t('my_listings.stat_active')}</p>
            </GlassCard>
            <GlassCard className="p-4 text-center">
              <DollarSign className="w-5 h-5 text-success mx-auto mb-1" />
              <p className="text-2xl font-bold text-foreground">{stats.sold_listings}</p>
              <p className="text-xs text-muted">{t('my_listings.stat_sold')}</p>
            </GlassCard>
            <GlassCard className="p-4 text-center">
              <Eye className="w-5 h-5 text-accent mx-auto mb-1" />
              <p className="text-2xl font-bold text-foreground">{stats.total_views}</p>
              <p className="text-xs text-muted">{t('my_listings.stat_views')}</p>
            </GlassCard>
            <GlassCard className="p-4 text-center">
              <BarChart3 className="w-5 h-5 text-warning mx-auto mb-1" />
              <p className="text-2xl font-bold text-foreground">
                {(stats.revenue_by_currency?.length
                  ? stats.revenue_by_currency
                  : stats.total_revenue != null && stats.revenue_currency
                    ? [{ total: stats.total_revenue, currency: stats.revenue_currency }]
                    : [])
                  .map((entry) => formatCurrency(entry.total, entry.currency))
                  .join(' · ') || '0'}
              </p>
              <p className="text-xs text-muted">{t('my_listings.stat_revenue')}</p>
            </GlassCard>
          </div>
        )}

        {/* Tabs */}
        <Tabs
          aria-label={t('my_listings_tabs_aria')}
          selectedKey={activeTab}
          onSelectionChange={(key) => setActiveTab(key as ListingTab)}

          variant="secondary"
          classNames={{ base: 'w-full overflow-x-auto', tabList: 'gap-2 sm:gap-4' }}
        >
          {TABS.map((tab) => (
            <Tab
              key={tab.key}
              title={
                <div className="flex items-center gap-1.5">
                  <tab.icon className="w-4 h-4" />
                  <span>{t(tab.tKey)}</span>
                  {stats && (
                    <span className="text-xs text-muted">
                      ({Number(stats[`${tab.key}_listings`] ?? 0)})
                    </span>
                  )}
                </div>
              }
            />
          ))}
        </Tabs>

        {/* Listings */}
        {isLoading ? (
          <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex justify-center py-16">
            <Spinner size="lg" color="accent" />
          </div>
        ) : listings.length === 0 ? (
          <EmptyState
            icon={<Package className="w-8 h-8" />}
            title={t(`my_listings.empty_${activeTab}_title`)}
            description={t(`my_listings.empty_${activeTab}_description`)}
            action={
              activeTab === 'active' || activeTab === 'draft'
                ? {
                    label: t('hub.sell_something'),
                    onClick: () => navigate(tenantPath('/marketplace/sell')),
                  }
                : undefined
            }
          />
        ) : (
          <>
            {/* Listing cards with action overlays */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {listings.map((listing) => (
                <GlassCard key={listing.id} className="overflow-hidden">
                  {/* Image */}
                  <Link to={tenantPath(`/marketplace/${listing.id}`)}>
                    <div className="aspect-square bg-surface-secondary relative overflow-hidden">
                      {listing.image?.url ? (
                        <img
                          src={resolveThumbnailUrl(listing.image.thumbnail_url || listing.image.url, { width: 360, height: 360 })}
                          alt={listing.title}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          decoding="async"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <Package className="w-10 h-10 text-muted" />
                        </div>
                      )}
                    </div>
                  </Link>

                  {/* Info */}
                  <div className="p-3">
                    <Link to={tenantPath(`/marketplace/${listing.id}`)}>
                      <p className="text-sm font-semibold text-foreground truncate hover:text-accent transition-colors">
                        {listing.title}
                      </p>
                    </Link>

                    {listing.price != null && listing.price > 0 ? (
                      <p className="text-sm font-bold text-accent mt-1">
                        {formatCurrency(listing.price, listing.price_currency)}
                      </p>
                    ) : (
                      <p className="text-sm font-bold text-success mt-1">
                        {t('common.free')}
                      </p>
                    )}

                    <div
                      className="flex items-center gap-1 text-xs text-muted mt-1"
                      aria-label={t('my_listings.views_count_aria', { count: listing.views_count })}
                    >
                      <Eye className="w-3 h-3" />
                      <span>{listing.views_count}</span>
                    </div>

                    {/* AG46 — Inventory chip */}
                    {(() => {
                      const inv = listing.inventory_count;
                      const threshold = listing.low_stock_threshold;
                      if (inv == null) return null;
                      if (inv === 0) {
                        return (
                          <span className="inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-danger-100 text-danger-700">
                            {t('inventory.sold_out')}
                          </span>
                        );
                      }
                      if (threshold != null && inv <= threshold) {
                        return (
                          <span className="inline-block mt-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-warning-100 text-warning-700">
                            {t('inventory.low_chip', { count: inv })}
                          </span>
                        );
                      }
                      return (
                        <span className="inline-block mt-1 text-[10px] font-medium px-2 py-0.5 rounded bg-surface-secondary text-muted">
                          {t('inventory.count_chip', { count: inv })}
                        </span>
                      );
                    })()}

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2 mt-3">
                      <Button
                        as={Link}
                        to={tenantPath(`/marketplace/${listing.id}/edit`)}
                        size="sm"
                        variant="tertiary"

                        startContent={<Edit3 className="w-3.5 h-3.5" />}
                        className="flex-1"
                      >
                        {t('my_listings.action_edit')}
                      </Button>

                      {activeTab === 'expired' && (
                        <Button
                          size="sm"
                          variant="secondary"

                          startContent={<RefreshCw className="w-3.5 h-3.5" />}
                          onPress={() => handleRenew(listing.id)}
                        >
                          {t('my_listings.action_renew')}
                        </Button>
                      )}

                      <Button
                        size="sm"
                        variant="danger-soft"

                        isIconOnly
                        onPress={() => confirmRemove(listing.id)}
                        aria-label={t('my_listings.action_remove')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                </GlassCard>
              ))}
            </div>

            {/* Load more */}
            {hasMore && (
              <div className="flex justify-center mt-8">
                <Button
                  variant="tertiary"

                  onPress={() => loadListings(true)}
                  isLoading={isLoadingMore}
                >
                  {t('common.load_more')}
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Remove confirmation modal */}
      <Modal isOpen={isRemoveOpen} onClose={onRemoveClose} size="sm">
        <ModalContent>
          <ModalHeader>{t('my_listings.remove_confirm_title')}</ModalHeader>
          <ModalBody>
            <p className="text-muted">
              {t('my_listings.remove_confirm_description')}
            </p>
          </ModalBody>
          <ModalFooter>
            <Button variant="tertiary" onPress={onRemoveClose}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger"

              onPress={handleRemove}
              isLoading={isRemoving}
            >
              {t('my_listings.action_remove')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  );
}

export default MyListingsPage;
