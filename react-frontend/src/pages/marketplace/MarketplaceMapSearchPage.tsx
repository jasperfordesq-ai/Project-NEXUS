// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MarketplaceMapSearchPage — Map-based marketplace search.
 *
 * Route: /marketplace/map
 *
 * Features:
 * - Split view: filter sidebar (left) + map (right) on desktop
 * - Mobile: toggle between list view and map view
 * - Search input at top
 * - Map shows listing pins for current search results (nearby endpoint)
 * - Click pin -> popup card -> click card -> listing detail
 * - "Search this area" button when map center changes
 * - Browser geolocation for initial center
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';import Search from 'lucide-react/icons/search';
import MapIcon from 'lucide-react/icons/map';
import List from 'lucide-react/icons/list';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { useTranslation } from 'react-i18next';
import { Autocomplete } from '@/components/ui/Autocomplete';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { ListBoxItem as AutocompleteItem } from '@/components/ui/ListBox';
import { SearchField } from '@/components/ui/SearchField';
import { Select, SelectItem } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { ToggleButton, ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
import { EmptyState } from '@/components/feedback';
import { MapSearchView } from '@/components/marketplace/MapSearchView';
import { MarketplaceListingGrid } from '@/components/marketplace';
import type { MarketplaceListingItem } from '@/types/marketplace';
import { useAuth, useToast, useTenant } from '@/contexts';
import { usePageTitle } from '@/hooks';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { formatMarketplaceCurrency, normalizeMarketplaceListing } from '@/lib/marketplaceNumbers';
import { resolveThumbnailUrl } from '@/lib/helpers';
import { PageMeta } from '@/components/seo/PageMeta';
import { MAPS_ENABLED } from '@/lib/map-config';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface NearbyListing extends MarketplaceListingItem {
  latitude?: number;
  longitude?: number;
  distance_km?: number;
}

interface ApiCategory {
  id: number;
  name: string;
  slug: string;
  listing_count: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_RADIUS_KM = 25;
const SEARCH_DEBOUNCE_MS = 400;

const RADIUS_OPTIONS = [
  { value: '5' },
  { value: '10' },
  { value: '25' },
  { value: '50' },
  { value: '100' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function MarketplaceMapSearchPage() {
  const { t } = useTranslation('marketplace');
  usePageTitle(t('map.page_title'));
  const { isAuthenticated, user } = useAuth();
  const { tenant, tenantPath, hasFeature } = useTenant();
  const toast = useToast();

  // Maps kill switch: this is a map-first page, so when maps are off for the
  // tenant there is nothing to show — bounce to the regular marketplace grid
  // rather than loading the page chrome and firing the nearby-listings API.
  const canUseMaps = MAPS_ENABLED && hasFeature('maps');
  const [searchParams, setSearchParams] = useSearchParams();

  // View mode (mobile)
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map');

  // Search & filter state
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);
  const [categoryId, setCategoryId] = useState(searchParams.get('category_id') || '');
  const [radiusKm, setRadiusKm] = useState(searchParams.get('radius') || String(DEFAULT_RADIUS_KM));

  // Data
  const [listings, setListings] = useState<(MarketplaceListingItem & { latitude?: number; longitude?: number; distance_km?: number })[]>([]);
  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const urlLatitude = Number(searchParams.get('lat'));
  const urlLongitude = Number(searchParams.get('lng'));
  const hasUrlCenter = searchParams.has('lat')
    && searchParams.has('lng')
    && Number.isFinite(urlLatitude)
    && Number.isFinite(urlLongitude);

  // Map center — prefer URL params, fall back to user profile location
  const [mapCenter, setMapCenter] = useState<{ lat: number; lng: number } | undefined>(() => {
    if (hasUrlCenter) {
      return { lat: urlLatitude, lng: urlLongitude };
    }
    if (user?.latitude != null && user?.longitude != null) {
      return { lat: user.latitude, lng: user.longitude };
    }
    return undefined;
  });

  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listingRequestRef = useRef(0);
  const persistCoordinatesRef = useRef(hasUrlCenter);

  // Debounce search input
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
    let cancelled = false;
    const load = async () => {
      try {
        const response = await api.get<ApiCategory[]>('/v2/marketplace/categories');
        if (!cancelled && response.success && response.data) {
          setCategories(response.data);
        }
      } catch (err) {
        logError('Failed to load categories', err);
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // Load nearby listings
  const loadListings = useCallback(async () => {
    if (!mapCenter || !canUseMaps) {
      setIsLoading(false);
      return;
    }

    const requestId = ++listingRequestRef.current;
    setIsLoading(true);
    setLoadError(null);
    try {
      const params = new URLSearchParams();
      params.set('latitude', String(mapCenter.lat));
      params.set('longitude', String(mapCenter.lng));
      params.set('radius', radiusKm);
      if (debouncedQuery) params.set('q', debouncedQuery);
      if (categoryId) params.set('category_id', categoryId);
      params.set('limit', '100');

      const response = await api.get<NearbyListing[]>(
        `/v2/marketplace/listings/nearby?${params}`
      );
      if (requestId !== listingRequestRef.current) return;
      if (response.success && response.data) {
        setLoadError(null);
        const mapped = response.data.map((item) => normalizeMarketplaceListing({
          ...(item as unknown as MarketplaceListingItem),
          latitude: item.latitude,
          longitude: item.longitude,
          distance_km: item.distance_km,
        }));
        setListings(mapped);
      } else {
        const message = t('map.search_failed');
        setLoadError(message);
        toast.error(message);
      }
    } catch (err) {
      if (requestId !== listingRequestRef.current) return;
      logError('Failed to load nearby listings', err);
      const message = t('map.search_failed');
      setLoadError(message);
      toast.error(message);
    } finally {
      if (requestId === listingRequestRef.current) setIsLoading(false);
    }
  }, [mapCenter, radiusKm, debouncedQuery, categoryId, canUseMaps, toast, t]);

  // Refetch when params change
  useEffect(() => {
    loadListings();
  }, [loadListings]);

  // Sync URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedQuery) params.set('q', debouncedQuery);
    if (categoryId) params.set('category_id', categoryId);
    if (radiusKm !== String(DEFAULT_RADIUS_KM)) params.set('radius', radiusKm);
    if (mapCenter && persistCoordinatesRef.current) {
      params.set('lat', String(mapCenter.lat));
      params.set('lng', String(mapCenter.lng));
    }
    setSearchParams(params, { replace: true });
  }, [debouncedQuery, categoryId, radiusKm, mapCenter, setSearchParams]);

  // "Use my location" handler — centres map on the user's profile location
  const handleUseMyLocation = useCallback(() => {
    if (user?.latitude != null && user?.longitude != null) {
      persistCoordinatesRef.current = false;
      setMapCenter({ lat: user.latitude, lng: user.longitude });
    } else {
      toast.error(t('map.location_required'));
    }
  }, [user?.latitude, user?.longitude, toast, t]);

  // Save / Unsave handlers
  const handleSave = useCallback(async (id: number) => {
    if (!isAuthenticated) {
      toast.error(t('common.sign_in_to_save'));
      return;
    }
    try {
      const response = await api.post(`/v2/marketplace/listings/${id}/save`);
      if (response.success) {
        setListings((prev) =>
          prev.map((l) => (l.id === id ? { ...l, is_saved: true } : l))
        );
        toast.success(t('common.saved_for_later'));
      } else {
        toast.error(response.error || t('common.save_failed'));
      }
    } catch (err) {
      logError('Failed to save listing', err);
      toast.error(t('common.save_failed'));
    }
  }, [isAuthenticated, toast, t]);

  const handleUnsave = useCallback(async (id: number) => {
    if (!isAuthenticated) return;
    try {
      const response = await api.delete(`/v2/marketplace/listings/${id}/save`);
      if (response.success) {
        setListings((prev) =>
          prev.map((l) => (l.id === id ? { ...l, is_saved: false } : l))
        );
        toast.success(t('common.removed_from_saved'));
      } else {
        toast.error(response.error || t('common.save_failed'));
      }
    } catch (err) {
      logError('Failed to unsave listing', err);
      toast.error(t('common.save_failed'));
    }
  }, [isAuthenticated, toast, t]);

  // Active filter count
  const activeFilterCount = [categoryId, radiusKm !== String(DEFAULT_RADIUS_KM) ? 'yes' : ''].filter(Boolean).length;

  // Maps disabled for this tenant → redirect to the standard marketplace.
  if (!canUseMaps) {
    return <Navigate to={tenantPath('/marketplace')} replace />;
  }

  return (
    <>
      <PageMeta
        title={t('map.page_title')}
        description={t('map.meta_description')}
      />
      {/* Visually-hidden h1 for WCAG 2.4.6 — screen readers need a page heading */}
      <h1 className="sr-only">{t('map.page_title')}</h1>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        {/* Header / Breadcrumb */}
        <div className="flex items-center gap-3">
          <Button
            as={Link}
            to={tenantPath('/marketplace')}
            variant="tertiary"
            size="sm"
          >
            {t('page_title')}
          </Button>
          <span className="text-muted">/</span>
          <span className="text-foreground font-medium">{t('map.breadcrumb')}</span>
        </div>

        {/* Search bar + controls */}
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem] lg:grid-cols-[minmax(0,1fr)_8rem_12rem_auto]">
          <SearchField
            placeholder={t('map.search_placeholder')}
            aria-label={t('map.search_placeholder')}
            value={searchQuery}
            onValueChange={setSearchQuery}
            size="lg"
            variant="secondary"
            classNames={{ inputWrapper: 'bg-background' }}
            isClearable
            onClear={() => setSearchQuery('')}
            className="min-w-0"
          />

          <Select
            selectedKeys={[radiusKm]}
            onSelectionChange={(keys) => {
              const selected = Array.from(keys)[0];
              if (selected) setRadiusKm(String(selected));
            }}
            size="lg"
            className="min-w-0"
            aria-label={t('map.radius_label')}
          >
            {RADIUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} id={opt.value}>{t('map.radius_option', { km: opt.value })}</SelectItem>
            ))}
          </Select>

          <Autocomplete
            aria-label={t('search.category_label')}
            placeholder={t('search.all_categories')}
            searchPlaceholder={t('search.category_search')}
            value={categoryId || null}
            onChange={(key) => {
              setCategoryId(key && !Array.isArray(key) ? String(key) : '');
            }}
            className="hidden min-w-0 lg:block"
          >
            {categories.map((cat) => (
              <AutocompleteItem key={String(cat.id)} id={String(cat.id)} textValue={cat.name}>
                {cat.name} ({cat.listing_count})
              </AutocompleteItem>
            ))}
          </Autocomplete>

          {/* Mobile view toggle — single-select ToggleButtonGroup */}
          <ToggleButtonGroup
            aria-label={t('map.view_toggle')}
            selectionMode="single"
            disallowEmptySelection
            size="lg"
            selectedKeys={new Set([viewMode])}
            onSelectionChange={(keys) => { const [k] = Array.from(keys); if (k) setViewMode(k as 'map' | 'list'); }}
            className="flex gap-1 lg:hidden"
          >
            <ToggleButton
              id="map"
              isIconOnly
              variant="default"
              aria-label={t('map.map_view')}
              className="data-[selected=true]:bg-primary data-[selected=true]:text-white"
            >
              <MapIcon className="w-4 h-4" />
            </ToggleButton>
            <ToggleButton
              id="list"
              isIconOnly
              variant="default"
              aria-label={t('map.list_view')}
              className="data-[selected=true]:bg-primary data-[selected=true]:text-white"
            >
              <List className="w-4 h-4" />
            </ToggleButton>
          </ToggleButtonGroup>
        </div>

        {/* Active filter chips */}
        {activeFilterCount > 0 && (
          <div className="flex gap-2 flex-wrap">
            {categoryId && (
              <Chip
                onClose={() => setCategoryId('')}
                variant="soft"
                size="sm"
              >
                {categories.find((c) => String(c.id) === categoryId)?.name || t('search.category_label')}
              </Chip>
            )}
            {radiusKm !== String(DEFAULT_RADIUS_KM) && (
              <Chip
                onClose={() => setRadiusKm(String(DEFAULT_RADIUS_KM))}
                variant="soft"
                size="sm"
              >
                {t('map.radius_chip', { km: radiusKm })}
              </Chip>
            )}
          </div>
        )}

        {/* Results info */}
        {!isLoading && !loadError && listings.length > 0 && (
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted">
              {t('map.results_count', { count: listings.length })}
            </p>
            <Button
              variant="tertiary"
              size="sm"
              startContent={<RefreshCw className="w-3.5 h-3.5" />}
              onPress={loadListings}
            >
              {t('map.refresh')}
            </Button>
          </div>
        )}

        {/* Main layout */}
        <div className="flex gap-6">
          {/* Desktop: filter sidebar (compact) */}
          <aside className="hidden lg:block w-80 shrink-0" aria-label={t('aria.filter_panel')}>
            <div className="space-y-4 sticky top-24">
              {/* List view of results */}
              {isLoading ? (
                <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex justify-center py-12">
                  <Spinner size="lg" color="accent" />
                </div>
              ) : loadError ? (
                <EmptyState
                  icon={<Search className="w-6 h-6" />}
                  title={loadError}
                  action={{ label: t('common.try_again'), onClick: loadListings }}
                />
              ) : listings.length === 0 ? (
                <EmptyState
                  icon={<Search className="w-6 h-6" />}
                  title={t('map.no_results_title')}
                  description={t('map.no_results_description')}
                />
              ) : (
                <div className="space-y-3 max-h-[calc(100vh-250px)] overflow-y-auto pr-1 scrollbar-hide">
                  {listings.map((listing) => (
                    <Link
                      key={listing.id}
                      to={tenantPath(`/marketplace/${listing.id}`)}
                      className="block group"
                    >
                      <GlassCard hoverable className="p-3">
                        <div className="flex gap-3">
                          {/* Thumbnail */}
                          <div className="w-16 h-16 shrink-0 rounded-lg overflow-hidden bg-surface-secondary">
                            {listing.image ? (
                              <img
                                src={resolveThumbnailUrl(listing.image.thumbnail_url || listing.image.url, { width: 160, height: 160 })}
                                alt={listing.title}
                                className="w-full h-full object-cover"
                                loading="lazy"
                                decoding="async"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center bg-surface-secondary">
                                <Search className="w-5 h-5 text-muted" />
                              </div>
                            )}
                          </div>
                          {/* Details */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold line-clamp-1 text-foreground group-hover:text-accent transition-colors">
                              {listing.title}
                            </p>
                            <p className="text-sm font-bold text-accent mt-0.5">
                              {listing.price_type === 'lend'
                                ? t('price.lend')
                                : listing.price_type === 'free' || listing.price === null || listing.price === 0
                                ? t('price.free')
                                : formatMarketplaceCurrency(
                                  listing.price,
                                  listing.price_currency || tenant?.currency || '',
                                )}
                            </p>
                            {listing.distance_km != null && (
                              <p className="text-xs text-muted mt-0.5">
                                {listing.distance_km < 1
                                  ? t('map.distance_meters', { m: Math.round(listing.distance_km * 1000) })
                                  : t('map.distance_km', { km: listing.distance_km.toFixed(1) })}
                              </p>
                            )}
                          </div>
                        </div>
                      </GlassCard>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </aside>

          {/* Map area */}
          <div className="flex-1 min-w-0">
            {/* Desktop: always show map. Mobile: depends on viewMode */}
            <div className={viewMode === 'list' ? 'hidden lg:block' : ''}>
              {loadError && (
                <div className="lg:hidden">
                  <EmptyState
                    icon={<Search className="w-6 h-6" />}
                    title={loadError}
                    action={{ label: t('common.try_again'), onClick: loadListings }}
                  />
                </div>
              )}
              <div className={loadError ? 'hidden lg:block' : ''}>
                <MapSearchView
                  listings={listings}
                  center={mapCenter}
                  zoom={12}
                  height="calc(100vh - 280px)"
                  isLoading={isLoading && !listings.length}
                  onRequestLocation={handleUseMyLocation}
                  locationLoading={false}
                />
              </div>
            </div>

            {/* Mobile list view */}
            <div className={viewMode === 'map' ? 'hidden' : 'lg:hidden'}>
              {isLoading ? (
                <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex justify-center py-12">
                  <Spinner size="lg" color="accent" />
                </div>
              ) : loadError ? (
                <EmptyState
                  icon={<Search className="w-6 h-6" />}
                  title={loadError}
                  action={{ label: t('common.try_again'), onClick: loadListings }}
                />
              ) : listings.length === 0 ? (
                <EmptyState
                  icon={<Search className="w-6 h-6" />}
                  title={t('map.no_results_title')}
                  description={t('map.no_results_description')}
                />
              ) : (
                <MarketplaceListingGrid
                  listings={listings}
                  onSave={handleSave}
                  onUnsave={handleUnsave}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default MarketplaceMapSearchPage;
