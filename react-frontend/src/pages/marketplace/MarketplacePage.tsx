// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MarketplacePage — Hub page for the commercial marketplace module.
 *
 * Features:
 * - Search bar with debounced query
 * - Horizontal category pills row (shared CategoryChips)
 * - Responsive listing card grid (shared MarketplaceListingGrid)
 * - Cursor-based "Load more" pagination
 * - Desktop sidebar: categories with counts, "Sell Something" CTA
 * - Featured listings section
 *
 * Phones get the shared directory-page treatment instead of the desktop chrome:
 * the hero, the inline search field and the CategoryChips row are not rendered,
 * the page title moves into the app bar, and one slim auto-hiding
 * `MobileFilterBar` carries the search pill, the Filters button (opening
 * `MarketplaceFilterSheet`) and the "Sell something" action. The desktop sidebar
 * is `hidden lg:block`, so its quick links are re-homed into a phone-only block
 * below the grid.
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';import Search from 'lucide-react/icons/search';
import Plus from 'lucide-react/icons/plus';
import ShoppingBag from 'lucide-react/icons/shopping-bag';
import Star from 'lucide-react/icons/star';
import Grid3X3 from 'lucide-react/icons/grid-3x3';
import Heart from 'lucide-react/icons/heart';
import Package from 'lucide-react/icons/package';
import HandCoins from 'lucide-react/icons/hand-coins';
import Truck from 'lucide-react/icons/truck';
import FileWarning from 'lucide-react/icons/file-warning';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { GlassCard } from '@/components/ui/GlassCard';
import { SearchField } from '@/components/ui/SearchField';
import { EmptyState } from '@/components/feedback/EmptyState';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { MobileFilterBar } from '@/components/ui/MobileFilterBar';
import { MobileSearchOverlay } from '@/components/search/MobileSearchOverlay';
import { CategoryChips } from '@/components/marketplace/CategoryChips';
import { MarketplaceFilterSheet } from '@/components/marketplace/MarketplaceFilterSheet';
import { MarketplaceListingGrid } from '@/components/marketplace/MarketplaceListingGrid';
import { MarketplaceListingGridSkeleton } from '@/components/marketplace/MarketplaceListingGridSkeleton';
import type { MarketplaceListingItem, MarketplaceCategory } from '@/types/marketplace';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useTenant } from '@/contexts/TenantContext';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { normalizeMarketplaceListing } from '@/lib/marketplaceNumbers';
import { usePageTitle } from '@/hooks/usePageTitle';
// Direct hook paths on purpose: the page test replaces the whole '@/hooks'
// barrel with a partial stub, so a barrel import would resolve to undefined.
import { useSetAppBarTitle } from '@/hooks/useAppBarTitle';
import { useHeaderScroll } from '@/hooks/useHeaderScroll';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { PageMeta } from '@/components/seo/PageMeta';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Category shape as returned by the API (field names differ from shared type) */
interface ApiCategory {
  id: number;
  name: string;
  slug: string;
  icon: string | null;
  listing_count: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 24;
const SEARCH_DEBOUNCE_MS = 300;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Map API category shape to the shared MarketplaceCategory type */
function toSharedCategory(cat: ApiCategory): MarketplaceCategory {
  return {
    id: cat.id,
    name: cat.name,
    slug: cat.slug,
    icon: cat.icon ?? undefined,
    listing_count: cat.listing_count,
  };
}

/** Every filter this hub sends to `GET /v2/marketplace/listings`. */
interface MarketplaceQueryFilters {
  q: string;
  categoryId?: number;
  limit: number;
  cursor?: string | null;
}

/**
 * Single source of truth for the listings query string. Extracted from
 * `loadListings` so any future second caller (a count probe, a prefetch) cannot
 * drift from the query the visible grid actually ran.
 */
function buildMarketplaceQueryParams(
  { q, categoryId, limit, cursor }: MarketplaceQueryFilters,
): URLSearchParams {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (categoryId != null) params.set('category_id', String(categoryId));
  params.set('limit', String(limit));
  if (cursor) params.set('cursor', cursor);
  return params;
}

/** One entry in the phone-only quick-links block (the `lg` sidebar's stand-in). */
interface PhoneQuickLink {
  key: string;
  to: string;
  label: string;
  icon: ReactNode;
}

const QUICK_LINK_ICON_CLASS = 'h-4 w-4 shrink-0 text-theme-subtle';

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function MarketplacePage() {
  const { t } = useTranslation('marketplace');
  const { t: tc } = useTranslation('marketplace_cases');
  usePageTitle(t('page_title'));
  // Phones hide the hero, so the app bar carries the page title instead.
  useSetAppBarTitle(t('page_title'));
  const isPhone = useMediaQuery('(max-width: 639px)');
  const { isUtilityBarVisible: showMobileControls } = useHeaderScroll(64);
  const { isAuthenticated } = useAuth();
  const { tenantPath, hasFeature } = useTenant();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // State
  const [listings, setListings] = useState<MarketplaceListingItem[]>([]);
  const [categories, setCategories] = useState<MarketplaceCategory[]>([]);
  const [featuredListings, setFeaturedListings] = useState<MarketplaceListingItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const cursorRef = useRef<string | null>(null);
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);
  const [selectedCategoryId, setSelectedCategoryId] = useState<number | undefined>(
    searchParams.get('category') ? Number(searchParams.get('category')) : undefined,
  );
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listingRequestRef = useRef(0);
  const featureEnabled = hasFeature('marketplace');

  // Phone-only overlays (never mounted above `sm`).
  const [isSearchOverlayOpen, setIsSearchOverlayOpen] = useState(false);
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);

  // Debounce search
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedQuery(searchQuery);
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [searchQuery]);

  // Load categories
  useEffect(() => {
    if (!featureEnabled) return;
    let cancelled = false;
    const load = async () => {
      try {
        const response = await api.get<ApiCategory[]>('/v2/marketplace/categories');
        if (!cancelled && response.success && response.data) {
          setCategories(response.data.map(toSharedCategory));
        }
      } catch (err) {
        logError('Failed to load marketplace categories', err);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [featureEnabled]);

  // Load featured
  useEffect(() => {
    if (!featureEnabled) return;
    let cancelled = false;
    const load = async () => {
      try {
        const response = await api.get<MarketplaceListingItem[]>('/v2/marketplace/listings/featured');
        if (!cancelled && response.success && response.data) {
          setFeaturedListings(response.data.map(normalizeMarketplaceListing));
        }
      } catch (err) {
        logError('Failed to load featured listings', err);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [featureEnabled]);

  // Load listings
  const loadListings = useCallback(async (append = false) => {
    const requestId = ++listingRequestRef.current;
    try {
      if (!append) {
        setIsLoading(true);
        setError(null);
      } else {
        setIsLoadingMore(true);
      }

      const params = buildMarketplaceQueryParams({
        q: debouncedQuery,
        categoryId: selectedCategoryId,
        limit: ITEMS_PER_PAGE,
        cursor: append ? cursorRef.current : null,
      });

      const response = await api.get<MarketplaceListingItem[]>(`/v2/marketplace/listings?${params}`);
      if (requestId !== listingRequestRef.current) return;
      if (response.success && response.data) {
        const mapped = response.data.map(normalizeMarketplaceListing);
        if (append) {
          setListings((prev) => [...prev, ...mapped]);
        } else {
          setListings(mapped);
        }
        cursorRef.current = response.meta?.cursor ?? response.meta?.next_cursor ?? null;
        setHasMore(response.meta?.has_more ?? response.data.length >= ITEMS_PER_PAGE);
      } else if (!append) {
        setError(t('hub.unable_to_load'));
      }
    } catch (err) {
      if (requestId !== listingRequestRef.current) return;
      logError('Failed to load marketplace listings', err);
      if (!append) {
        setError(t('hub.unable_to_load'));
      } else {
        toast.error(t('hub.load_more_failed'));
      }
    } finally {
      if (requestId === listingRequestRef.current) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [debouncedQuery, selectedCategoryId, toast, t])

  // Refetch on filter change
  useEffect(() => {
    if (!featureEnabled) return;
    cursorRef.current = null;
    setHasMore(true);
    loadListings();
  }, [debouncedQuery, selectedCategoryId, featureEnabled]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync URL params
  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedQuery) params.set('q', debouncedQuery);
    if (selectedCategoryId != null) params.set('category', String(selectedCategoryId));
    setSearchParams(params, { replace: true });
  }, [debouncedQuery, selectedCategoryId, setSearchParams]);

  // Phone: the applied category as a removable chip under the sticky bar. The
  // query is not a chip — it shows inside the search pill instead.
  const phoneFilterChips = useMemo(() => {
    if (selectedCategoryId == null) return [];
    const category = categories.find((c) => c.id === selectedCategoryId);
    return [{
      key: 'category',
      label: category?.name ?? t('filters.category'),
      onRemove: () => setSelectedCategoryId(undefined),
    }];
  }, [selectedCategoryId, categories, t]);

  // Phone: the `hidden lg:block` sidebar's quick links, which phones and tablets
  // never get. Re-homed below the grid so hiding the hero costs no functionality.
  const phoneQuickLinks = useMemo<PhoneQuickLink[]>(() => {
    const links: PhoneQuickLink[] = [{
      key: 'advanced-search',
      to: tenantPath('/marketplace/search'),
      label: t('hub.advanced_search'),
      icon: <Search className={QUICK_LINK_ICON_CLASS} aria-hidden="true" />,
    }];
    if (!isAuthenticated) return links;
    links.push(
      {
        key: 'my-listings',
        to: tenantPath('/marketplace/my-listings'),
        label: t('hub.my_listings'),
        icon: <Package className={QUICK_LINK_ICON_CLASS} aria-hidden="true" />,
      },
      {
        key: 'my-offers',
        to: tenantPath('/marketplace/my-offers'),
        label: t('hub.my_offers'),
        icon: <HandCoins className={QUICK_LINK_ICON_CLASS} aria-hidden="true" />,
      },
      {
        key: 'orders',
        to: tenantPath('/marketplace/orders'),
        label: t('hub.my_orders'),
        icon: <ShoppingBag className={QUICK_LINK_ICON_CLASS} aria-hidden="true" />,
      },
      {
        key: 'reports',
        to: tenantPath('/marketplace/reports'),
        label: tc('report.index_title'),
        icon: <FileWarning className={QUICK_LINK_ICON_CLASS} aria-hidden="true" />,
      },
      {
        key: 'shipping',
        to: tenantPath('/marketplace/seller/shipping-options'),
        label: t('shipping.manage_cta'),
        icon: <Truck className={QUICK_LINK_ICON_CLASS} aria-hidden="true" />,
      },
      {
        key: 'saved',
        to: tenantPath('/marketplace/collections'),
        label: t('hub.saved_items'),
        icon: <Heart className={QUICK_LINK_ICON_CLASS} aria-hidden="true" />,
      },
    );
    return links;
  }, [isAuthenticated, t, tc, tenantPath]);

  // Save / Unsave handlers (separate for MarketplaceListingGrid onSave/onUnsave props)
  const handleSave = async (id: number) => {
    if (!isAuthenticated) {
      toast.error(t('common.sign_in_to_save'));
      return;
    }
    try {
      const response = await api.post(`/v2/marketplace/listings/${id}/save`);
      if (response.success) {
        const updateSaved = (list: MarketplaceListingItem[]) =>
          list.map((l) => (l.id === id ? { ...l, is_saved: true } : l));
        setListings(updateSaved);
        setFeaturedListings(updateSaved);
        toast.success(t('common.saved_for_later'));
      } else {
        toast.error(response.error || t('common.save_failed'));
      }
    } catch (err) {
      logError('Failed to save listing', err);
      toast.error(t('common.save_failed'));
    }
  };

  const handleUnsave = async (id: number) => {
    if (!isAuthenticated) {
      toast.error(t('common.sign_in_to_save'));
      return;
    }
    try {
      const response = await api.delete(`/v2/marketplace/listings/${id}/save`);
      if (response.success) {
        const updateSaved = (list: MarketplaceListingItem[]) =>
          list.map((l) => (l.id === id ? { ...l, is_saved: false } : l));
        setListings(updateSaved);
        setFeaturedListings(updateSaved);
        toast.success(t('common.removed_from_saved'));
      } else {
        toast.error(response.error || t('common.save_failed'));
      }
    } catch (err) {
      logError('Failed to unsave listing', err);
      toast.error(t('common.save_failed'));
    }
  };

  // Feature gate -- rendered after all hooks
  if (!featureEnabled) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-12">
        <EmptyState
          icon={<ShoppingBag className="w-8 h-8" aria-hidden="true" />}
          title={t('hub_feature_gate.title')}
          description={t('hub_feature_gate.description')}
        />
      </div>
    );
  }

  return (
    <>
      <PageMeta
        title={t('page_title')}
        description={t('meta_description')}
      />

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Phones hide the hero entirely — the title lives in the app bar
            (useSetAppBarTitle) and "Sell something" moves into the sticky bar. */}
        {!isPhone && (
        <PublicPageHero
          eyebrow={t('hub.eyebrow')}
          title={t('page_title')}
          description={t('hub.subtitle')}
          icon={<ShoppingBag className="h-6 w-6" aria-hidden="true" />}
          accent="emerald"
          stats={[
            { label: t('hub.categories_stat'), value: categories.length.toLocaleString(getFormattingLocale()) },
            { label: t('hub.listings_stat'), value: listings.length.toLocaleString(getFormattingLocale()) },
            { label: t('hub.featured_stat'), value: featuredListings.length.toLocaleString(getFormattingLocale()) },
          ]}
          action={
            isAuthenticated ? (
              <Button
                as={Link}
                to={tenantPath('/marketplace/sell')}

                className="shrink-0"
                startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
              >
                {t('hub.sell_something')}
              </Button>
            ) : null
          }
        />
        )}

        {/* Search bar (desktop and tablet — phones use the sticky bar's search pill) */}
        {!isPhone && (
        <div className="max-w-3xl">
          <SearchField
            placeholder={t('hub.search_placeholder')}
            aria-label={t('hub.search_placeholder')}
            value={searchQuery}
            onValueChange={setSearchQuery}
            size="lg"
            variant="secondary"
            classNames={{ inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover', input: 'text-theme-primary placeholder:text-theme-subtle' }}
            isClearable
            onClear={() => setSearchQuery('')}
          />
        </div>
        )}

        {/* Category pills -- shared CategoryChips component (phones: the filter sheet) */}
        {!isPhone && categories.length > 0 && (
          <div role="group" aria-label={t('category_filter_label')}>
            <CategoryChips
              categories={categories}
              activeId={selectedCategoryId}
              onSelect={(id) => setSelectedCategoryId(id ?? undefined)}
            />
          </div>
        )}

        {/* Phone: slim sticky control bar — auto-hides on scroll down. */}
        {isPhone && (
          <MobileFilterBar
            isVisible={showMobileControls}
            accent="emerald"
            testId="marketplace-mobile-controls"
            onSearchPress={() => setIsSearchOverlayOpen(true)}
            searchValue={searchQuery}
            onFiltersPress={() => setIsFilterSheetOpen(true)}
            chips={phoneFilterChips}
            labels={{ search: t('hub.search_placeholder') }}
            trailing={
              isAuthenticated ? (
                <Button
                  as={Link}
                  to={tenantPath('/marketplace/sell')}
                  isIconOnly
                  aria-label={t('hub.sell_something')}
                  className="size-11 min-h-11 min-w-11 shrink-0 rounded-full"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </Button>
              ) : undefined
            }
          />
        )}

        {isPhone && (
          <MobileSearchOverlay
            isOpen={isSearchOverlayOpen}
            onClose={() => setIsSearchOverlayOpen(false)}
            value={searchQuery}
            onValueChange={setSearchQuery}
            placeholder={t('hub.search_placeholder')}
            recentKey="marketplace"
          />
        )}

        {/* Phone filter sheet — category chips, applied on tap (no draft, no footer). */}
        {isPhone && (
          <MarketplaceFilterSheet
            isOpen={isFilterSheetOpen}
            onClose={() => setIsFilterSheetOpen(false)}
            categories={categories}
            selectedCategoryId={selectedCategoryId}
            onSelectCategory={setSelectedCategoryId}
          />
        )}

        {/* Main content layout */}
        <div className="flex gap-6">
          {/* Listings grid */}
          <div className="flex-1 min-w-0">
            {/* Featured listings */}
            {featuredListings.length > 0 && !debouncedQuery && selectedCategoryId == null && (
              <div className="mb-8">
                <h2 className="text-lg font-semibold text-theme-primary mb-4 flex items-center gap-2">
                  <Star className="w-5 h-5 text-warning" aria-hidden="true" />
                  {t('hub.featured_listings')}
                </h2>
                <MarketplaceListingGrid
                  listings={featuredListings.slice(0, 4)}
                  onSave={handleSave}
                  onUnsave={handleUnsave}
                />
              </div>
            )}

            {/* All listings */}
            {isLoading ? (
              <div role="status" aria-label={t('common.loading')} aria-busy="true">
                <MarketplaceListingGridSkeleton />
              </div>
            ) : error ? (
              <GlassCard className="p-8 text-center">
                <p role="alert" className="text-danger mb-4">{error}</p>
                <Button variant="tertiary" onPress={() => loadListings()}>
                  {t('common.try_again')}
                </Button>
              </GlassCard>
            ) : listings.length === 0 ? (
              <EmptyState
                icon={<ShoppingBag className="w-8 h-8" aria-hidden="true" />}
                title={t('hub.no_listings_title')}
                description={
                  debouncedQuery || selectedCategoryId != null
                    ? t('hub.no_listings_filtered')
                    : t('hub.no_listings_empty')
                }
                action={
                  isAuthenticated
                    ? { label: t('hub.sell_something'), onClick: () => window.location.href = tenantPath('/marketplace/sell') }
                    : undefined
                }
              />
            ) : (
              <>
                <h2 className="text-lg font-semibold text-theme-primary mb-4 flex items-center gap-2">
                  <Grid3X3 className="w-5 h-5 text-muted" aria-hidden="true" />
                  {debouncedQuery || selectedCategoryId != null ? t('hub.search_results') : t('hub.latest_listings')}
                </h2>
                <MarketplaceListingGrid
                  listings={listings}
                  onSave={handleSave}
                  onUnsave={handleUnsave}
                />

                {/* Load more */}
                {hasMore && (
                  <div className="flex justify-center mt-8">
                    <Button
                      variant="tertiary"

                      onPress={() => loadListings(true)}
                      isLoading={isLoadingMore}
                    >
                      {t('hub.load_more')}
                    </Button>
                  </div>
                )}
              </>
            )}

            {/* Phone: the `hidden lg:block` sidebar's quick links, which are
                otherwise unreachable below `lg`. Placed after the grid so it
                costs no space above the fold. */}
            {isPhone && (
              <nav className="mt-8 sm:hidden" aria-labelledby="marketplace-phone-quick-links">
                <h2
                  id="marketplace-phone-quick-links"
                  className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-theme-subtle"
                >
                  {t('hub.quick_links')}
                </h2>
                <div className="grid grid-cols-2 gap-2">
                  {phoneQuickLinks.map((link) => (
                    <Link
                      key={link.key}
                      to={link.to}
                      className="flex min-h-11 items-center gap-2 rounded-xl border border-theme-default bg-theme-elevated px-3 text-sm text-theme-primary transition-colors hover:border-emerald-500/40 hover:text-emerald-600 dark:hover:text-emerald-400"
                    >
                      {link.icon}
                      <span className="truncate">{link.label}</span>
                    </Link>
                  ))}
                </div>
              </nav>
            )}
          </div>

          {/* Desktop sidebar */}
          <aside className="hidden lg:block w-72 shrink-0 space-y-6" aria-label={t('aria.filter_panel')}>
            {/* Sell CTA */}
            {isAuthenticated && (
              <GlassCard className="p-5 text-center space-y-3">
                <ShoppingBag className="w-10 h-10 text-accent mx-auto" aria-hidden="true" />
                <h3 className="font-semibold text-theme-primary">{t('hub.sidebar_cta_title')}</h3>
                <p className="text-sm text-theme-muted">
                  {t('hub.sidebar_cta_description')}
                </p>
                <Button
                  as={Link}
                  to={tenantPath('/marketplace/sell')}

                  fullWidth
                  startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
                >
                  {t('hub.sell_something')}
                </Button>
              </GlassCard>
            )}

            {/* Quick links */}
            <GlassCard className="p-5">
              <h3 className="font-semibold text-theme-primary mb-3">{t('hub.quick_links')}</h3>
              <div className="space-y-2">
                <Link
                  to={tenantPath('/marketplace/search')}
                  className="flex items-center gap-2 text-sm text-muted hover:text-accent transition-colors"
                >
                  <Search className="w-4 h-4" aria-hidden="true" />
                  {t('hub.advanced_search')}
                </Link>
                {isAuthenticated && (
                  <>
                    <Link
                      to={tenantPath('/marketplace/my-listings')}
                      className="flex items-center gap-2 text-sm text-muted hover:text-accent transition-colors"
                    >
                      <Package className="w-4 h-4" aria-hidden="true" />
                      {t('hub.my_listings')}
                    </Link>
                    <Link
                      to={tenantPath('/marketplace/my-offers')}
                      className="flex items-center gap-2 text-sm text-muted hover:text-accent transition-colors"
                    >
                      <HandCoins className="w-4 h-4" aria-hidden="true" />
                      {t('hub.my_offers')}
                    </Link>
                    <Link
                      to={tenantPath('/marketplace/orders')}
                      className="flex items-center gap-2 text-sm text-muted hover:text-accent transition-colors"
                    >
                      <ShoppingBag className="w-4 h-4" aria-hidden="true" />
                      {t('hub.my_orders')}
                    </Link>
                    <Link
                      to={tenantPath('/marketplace/reports')}
                      className="flex items-center gap-2 text-sm text-muted hover:text-accent transition-colors"
                    >
                      <FileWarning className="w-4 h-4" aria-hidden="true" />
                      {tc('report.index_title')}
                    </Link>
                    <Link
                      to={tenantPath('/marketplace/seller/shipping-options')}
                      className="flex items-center gap-2 text-sm text-muted hover:text-accent transition-colors"
                    >
                      <Truck className="w-4 h-4" aria-hidden="true" />
                      {t('shipping.manage_cta')}
                    </Link>
                    <Link
                      to={tenantPath('/marketplace/collections')}
                      className="flex items-center gap-2 text-sm text-muted hover:text-accent transition-colors"
                    >
                      <Heart className="w-4 h-4" aria-hidden="true" />
                      {t('hub.saved_items')}
                    </Link>
                  </>
                )}
              </div>
            </GlassCard>
          </aside>
        </div>
      </div>
    </>
  );
}

export default MarketplacePage;
