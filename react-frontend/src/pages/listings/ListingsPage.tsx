// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Listings Page - Browse all listings
 */

import { lazy, Suspense, useState, useEffect, useCallback, memo, useRef, useMemo, type ComponentType, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlgorithmLabel } from '@/components/ui/AlgorithmLabel';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { ImagePlaceholder } from '@/components/ui/ImagePlaceholder';
import { Progress } from '@/components/ui/Progress';
import { SearchField } from '@/components/ui/SearchField';
import { Select, SelectItem } from '@/components/ui/Select';
import { ListingSkeleton, MediaRowsSkeleton } from '@/components/ui/Skeletons';
import { MobileFilterBar } from '@/components/ui/MobileFilterBar';
import { ToggleButton, ToggleButtonGroup } from '@/components/ui/ToggleButtonGroup';
import { MobileSearchOverlay } from '@/components/search/MobileSearchOverlay';
import { useFilterDraft } from '@/hooks/useFilterDraft';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { motion } from '@/lib/motion';

const listingContainerVariants = {
  hidden: { opacity: 0 }, visible: { opacity: 1, transition: { staggerChildren: 0.05 } }, };
const listingItemVariants = {
  hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0, transition: { duration: 0.25 } }, };

import Search from 'lucide-react/icons/search';
import Plus from 'lucide-react/icons/plus';
import Filter from 'lucide-react/icons/filter';
import Grid from 'lucide-react/icons/grid-3x3';
import List from 'lucide-react/icons/list';
import ListTodo from 'lucide-react/icons/list-todo';
import MapIcon from 'lucide-react/icons/map';
import MapPin from 'lucide-react/icons/map-pin';
import Tag from 'lucide-react/icons/tag';
import Clock from 'lucide-react/icons/clock';
import Calendar from 'lucide-react/icons/calendar';
import Heart from 'lucide-react/icons/heart';
import AlertTriangle from 'lucide-react/icons/triangle-alert';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import Monitor from 'lucide-react/icons/monitor';
import ArrowRightLeft from 'lucide-react/icons/arrow-right-left';
import ArrowRight from 'lucide-react/icons/arrow-right';
import Star from 'lucide-react/icons/star';
import SlidersHorizontal from 'lucide-react/icons/sliders-horizontal';
import X from 'lucide-react/icons/x';
import Zap from 'lucide-react/icons/zap';
import ArrowUpDown from 'lucide-react/icons/arrow-up-down';
import { FeaturedBadge } from '@/components/listings/FeaturedBadge';
import { ListingFilterSheet, type ListingFilterDraft } from '@/components/listings/ListingFilterSheet';
import { PageMeta } from '@/components/seo';
import { PublicEmptyState } from '@/components/public/PublicEmptyState';
import { PublicPageHero } from '@/components/public/PublicPageHero';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useTenant } from '@/contexts/TenantContext';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSetAppBarTitle } from '@/hooks/useAppBarTitle';
import { useHeaderScroll } from '@/hooks/useHeaderScroll';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { MAPS_ENABLED } from '@/lib/map-config';
import { resolveAvatarUrl, resolveThumbnailUrl, responsiveThumbnailProps, getFormattingLocale } from '@/lib/helpers';
import type { EntityMapViewProps } from '@/components/location/EntityMapView';
import type { ProximityFilterParams } from '@/components/proximity/ProximityFilter';
import type { Listing, Category } from '@/types/api';

const LazyEntityMapView = lazy(() =>
  import('@/components/location/EntityMapView').then((module) => ({
    default: module.EntityMapView,
  })),
) as ComponentType<EntityMapViewProps<Listing>>;

const LazyProximityFilter = lazy(() =>
  import('@/components/proximity/ProximityFilter').then((module) => ({
    default: module.ProximityFilter,
  })),
);

type ListingType = 'all' | 'offer' | 'request';
type ViewMode = 'grid' | 'list' | 'map';
type SortMode = 'recommended' | 'newest';

const validTypes: ListingType[] = ['all', 'offer', 'request'];
const validHours = ['any', 'quick', 'short', 'half_day', 'full_day'];
const validService = ['any', 'remote', 'in_person'];
const validPosted = ['any', '1', '7', '30'];

const HOURS_RANGE_MAP: Record<string, { min?: string; max?: string }> = {
  quick: { max: '1' },
  short: { min: '1', max: '3' },
  half_day: { min: '3', max: '6' },
  full_day: { min: '6' },
};

// Short chip labels for the phone active-filter row (full labels live in the selects).
const DURATION_CHIP_KEYS: Record<string, string> = {
  quick: 'duration_under_1h',
  short: 'duration_1_3h',
  half_day: 'duration_3_6h',
  full_day: 'duration_6h_plus',
};

/**
 * What "Clear all" resets inside the phone filter sheet. `sort` is deliberately
 * absent: clearing filters must keep the chosen sort order (shipped behaviour).
 * `useFilterDraft` merges this over the open draft.
 */
const EMPTY_LISTING_FILTER_DRAFT: Partial<ListingFilterDraft> = {
  type: 'all',
  category: '',
  hours: 'any',
  service: 'any',
  posted: 'any',
  proximity: null,
};

interface ListingFilterValues {
  q: string;
  type: ListingType;
  category: string;
  hours: string;
  service: string;
  posted: string;
  sort: SortMode;
  proximity: ProximityFilterParams | null;
}

/** Single source of truth for filter → API params (used by the grid fetch and the sheet's live count). */
function buildListingQueryParams(f: ListingFilterValues): URLSearchParams {
  const params = new URLSearchParams();
  if (f.q) params.set('q', f.q);
  if (f.type !== 'all') params.set('type', f.type);
  if (f.category) params.set('category', f.category);
  const range = HOURS_RANGE_MAP[f.hours];
  if (range?.min) params.set('min_hours', range.min);
  if (range?.max) params.set('max_hours', range.max);
  if (f.service !== 'any') {
    params.set('service_type', f.service === 'remote' ? 'remote_only,hybrid' : 'physical_only');
  }
  if (f.posted !== 'any') {
    params.set('posted_within', f.posted);
  }
  if (f.sort === 'newest') {
    params.set('sort', 'newest');
  }
  // AG35 — explicit personalised flag mirrors the sort toggle.
  params.set('personalised', f.sort === 'recommended' ? 'true' : 'false');
  if (f.proximity) {
    params.set('near_lat', String(f.proximity.near_lat));
    params.set('near_lng', String(f.proximity.near_lng));
    params.set('radius_km', String(f.proximity.radius_km));
  }
  return params;
}

export function ListingsPage() {
  const { t } = useTranslation(['listings', 'common']);
  usePageTitle(t('title'));
  // On phones the page hides its own hero card; the title lives in the app bar.
  useSetAppBarTitle(t('title'));
  const { isUtilityBarVisible: showMobileControls } = useHeaderScroll(64);
  const { isAuthenticated } = useAuth();
  const { tenantPath, hasModule, hasFeature } = useTenant();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const canUseMapView = MAPS_ENABLED && hasFeature('maps');

  const [listings, setListings] = useState<Listing[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(searchParams.get('q') || '');
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  // Native-app search: phones open a full-screen overlay with recents instead
  // of typing into the inline filter field. Desktop keeps the inline field.
  const isPhone = useMediaQuery('(max-width: 639px)');
  const [isSearchOverlayOpen, setIsSearchOverlayOpen] = useState(false);

  const [selectedType, setSelectedType] = useState<ListingType>(() => {
    const v = searchParams.get('type');
    return v && validTypes.includes(v as ListingType) ? (v as ListingType) : 'all';
  });
  const [selectedCategory, setSelectedCategory] = useState(searchParams.get('category') || '');
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const v = searchParams.get('view');
    return v === 'list' || (v === 'map' && canUseMapView) ? v : 'grid';
  });
  const [hasMore, setHasMore] = useState(false);
  const [totalItems, setTotalItems] = useState<number | null>(null);
  const [proximityParams, setProximityParams] = useState<ProximityFilterParams | null>(() => {
    if (searchParams.get('near_me') === '1') {
      const rawLat = searchParams.get('near_lat');
      const rawLng = searchParams.get('near_lng');
      if (rawLat === null || rawLng === null) return null;
      const lat = Number(rawLat);
      const lng = Number(rawLng);
      const km = Number(searchParams.get('radius_km')) || 2;
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { near_lat: lat, near_lng: lng, radius_km: km };
    }
    return null;
  });
  const [hoursRange, setHoursRange] = useState(() => {
    const v = searchParams.get('hours');
    return v && validHours.includes(v) ? v : 'any';
  });
  const [serviceMode, setServiceMode] = useState(() => {
    const v = searchParams.get('service');
    return v && validService.includes(v) ? v : 'any';
  });
  const [postedWithin, setPostedWithin] = useState(() => {
    const v = searchParams.get('posted');
    return v && validPosted.includes(v) ? v : 'any';
  });
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(
    // Auto-expand if any advanced filter is active from URL
    !!(searchParams.get('hours') || searchParams.get('service') || searchParams.get('posted') || searchParams.get('near_me')),
  );
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    const v = searchParams.get('sort');
    return v === 'newest' ? 'newest' : 'recommended';
  });

  // Key used to force-remount ProximityFilter when cleared externally (resets internal radiusKm state)
  const [proximityKey, setProximityKey] = useState(0);

  // ── Phone filter sheet (draft state — nothing applies until "Show N listings") ──
  // The draft machine (snapshot / patch / debounced count probe / apply) lives in
  // useFilterDraft; only the listings-specific pieces stay here.

  /** Live result count for the sheet footer — cheap per_page=1 fetch of the draft filters. */
  const countDraftListings = useCallback(async (candidate: ListingFilterDraft) => {
    const params = buildListingQueryParams({ q: searchQuery, ...candidate });
    params.set('per_page', '1');
    const response = await api.get<Listing[]>(`/v2/listings?${params}`);
    return response.success ? (response.meta?.total_items ?? null) : null;
  }, [searchQuery]);

  const commitDraftFilters = useCallback((next: ListingFilterDraft) => {
    setSelectedType(next.type);
    setSelectedCategory(next.category);
    setSortMode(next.sort);
    setHoursRange(next.hours);
    setServiceMode(next.service);
    setPostedWithin(next.posted);
    setProximityParams(next.proximity);
    setProximityKey((k) => k + 1);
  }, []);

  const filterSheet = useFilterDraft<ListingFilterDraft>({
    onApply: commitDraftFilters,
    emptyDraft: EMPTY_LISTING_FILTER_DRAFT,
    countFor: countDraftListings,
    countKey: searchQuery,
  });
  const { open: openDraft } = filterSheet;

  const openFilterSheet = useCallback(() => {
    openDraft({
      type: selectedType,
      category: selectedCategory,
      sort: sortMode,
      hours: hoursRange,
      service: serviceMode,
      posted: postedWithin,
      proximity: proximityParams,
    }, totalItems);
  }, [openDraft, selectedType, selectedCategory, sortMode, hoursRange, serviceMode, postedWithin, proximityParams, totalItems]);

  const hasActiveFilters = useMemo(
    () => !!(searchQuery || selectedType !== 'all' || selectedCategory || hoursRange !== 'any' || serviceMode !== 'any' || postedWithin !== 'any' || proximityParams),
    [searchQuery, selectedType, selectedCategory, hoursRange, serviceMode, postedWithin, proximityParams],
  );

  // Count of active advanced filters (shown as badge on the toggle button)
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (hoursRange !== 'any') count++;
    if (serviceMode !== 'any') count++;
    if (postedWithin !== 'any') count++;
    if (proximityParams !== null) count++;
    return count;
  }, [hoursRange, serviceMode, postedWithin, proximityParams]);

  // Phone: removable chips for every applied filter (search shows in the search pill instead).
  const phoneFilterChips = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];
    if (selectedType !== 'all') {
      chips.push({
        key: 'type',
        label: t(selectedType === 'offer' ? 'filters.offers' : 'filters.requests'),
        onRemove: () => setSelectedType('all'),
      });
    }
    if (selectedCategory) {
      const cat = categories.find((c) => c.slug === selectedCategory);
      chips.push({ key: 'category', label: cat?.name ?? selectedCategory, onRemove: () => setSelectedCategory('') });
    }
    if (hoursRange !== 'any') {
      chips.push({ key: 'hours', label: t(DURATION_CHIP_KEYS[hoursRange] ?? 'filter_any'), onRemove: () => setHoursRange('any') });
    }
    if (serviceMode !== 'any') {
      chips.push({
        key: 'service',
        label: t(serviceMode === 'remote' ? 'service_remote_short' : 'service_in_person_short'),
        onRemove: () => setServiceMode('any'),
      });
    }
    if (postedWithin !== 'any') {
      chips.push({
        key: 'posted',
        label: t(postedWithin === '1' ? 'filter_today' : postedWithin === '7' ? 'filter_this_week' : 'filter_this_month'),
        onRemove: () => setPostedWithin('any'),
      });
    }
    if (proximityParams) {
      chips.push({
        key: 'near',
        label: t(`radius_${proximityParams.radius_km}`, { defaultValue: `${proximityParams.radius_km} km` }),
        onRemove: () => {
          setProximityParams(null);
          setProximityKey((k) => k + 1);
        },
      });
    }
    return chips;
  }, [selectedType, selectedCategory, hoursRange, serviceMode, postedWithin, proximityParams, categories, t]);

  // Use a ref for cursor to avoid infinite re-render loop (same pattern as FeedPage)
  const cursorRef = useRef<string | null>(null);
  // Track in-flight save requests to prevent double-clicks
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set());
  // Persistent error indicator for "Load More" failures
  const [paginationError, setPaginationError] = useState(false);

  // Stable refs for values used in loadListings but that should NOT trigger re-creation
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const tRef = useRef(t);
  tRef.current = t;

  // AbortController ref to cancel stale requests (prevents StrictMode double-fire race condition)
  const abortRef = useRef<AbortController | null>(null);

  const loadListings = useCallback(async (reset = false) => {
    // Cancel any in-flight request to prevent stale responses overwriting fresh data
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      setIsLoading(true);
      if (reset) {
        setLoadError(null);
        setPaginationError(false);
        cursorRef.current = null;
      }
      const params = buildListingQueryParams({
        q: searchQuery,
        type: selectedType,
        category: selectedCategory,
        hours: hoursRange,
        service: serviceMode,
        posted: postedWithin,
        sort: sortMode,
        proximity: proximityParams,
      });
      if (!reset && cursorRef.current) params.set('cursor', cursorRef.current);
      const isMapView = canUseMapView && viewMode === 'map';
      params.set('per_page', isMapView ? '100' : '20');
      if (isMapView) {
        params.set('with_coordinates', '1');
      }

      const response = await api.get<Listing[]>(`/v2/listings?${params}`);

      // If this request was aborted while awaiting, discard the result
      if (controller.signal.aborted) return;

      if (response.success && response.data) {
        if (reset) {
          setListings(response.data);
        } else {
          setListings((prev) => [...prev, ...response.data!]);
          setPaginationError(false);
        }

        // Handle pagination meta if present
        cursorRef.current = response.meta?.cursor ?? null;
        setHasMore(response.meta?.has_more ?? false);
        if (reset && response.meta?.total_items != null) {
          setTotalItems(response.meta.total_items);
        }
      } else {
        if (reset) {
          setLoadError(tRef.current('load_error'));
        } else {
          setPaginationError(true);
          toastRef.current.error(tRef.current('load_more_error'));
        }
        setHasMore(false);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      logError('Failed to load listings', error);
      if (reset) {
        setLoadError(tRef.current('load_error'));
      } else {
        setPaginationError(true);
        toastRef.current.error(tRef.current('load_more_error'));
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [searchQuery, selectedType, selectedCategory, proximityParams, hoursRange, serviceMode, postedWithin, sortMode, viewMode, canUseMapView]);

  // Keep a ref so effects always call the latest version without depending on it
  const loadListingsRef = useRef(loadListings);
  loadListingsRef.current = loadListings;

  // Stable items array for the category Select — memoized so HeroUI's
  // collection doesn't rebuild on every render (new array ref = rebuild = selected key lost)
  const categoryItems = useMemo(
    () => [{ slug: 'all', name: t('filter_all_categories') }, ...categories],
    [categories, t],
  );

  // Load categories once on mount
  useEffect(() => {
    const controller = new AbortController();
    api.get<Category[]>('/v2/categories?type=listing').then((response) => {
      if (controller.signal.aborted) return;
      if (response.success && response.data) {
        setCategories(response.data);
      }
    }).catch((error) => {
      if (!controller.signal.aborted) logError('Failed to load categories', error);
    }).finally(() => {
      if (!controller.signal.aborted) setCategoriesLoading(false);
    });
    return () => { controller.abort(); };
  }, []);

  // Debounce search input → searchQuery (300ms)
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    if (!canUseMapView && viewMode === 'map') {
      setViewMode('grid');
    }
  }, [canUseMapView, viewMode]);

  // Load listings when filters change — separate from URL sync to avoid reset loops
  useEffect(() => {
    loadListingsRef.current(true);
    return () => { abortRef.current?.abort(); };
  }, [searchQuery, selectedType, selectedCategory, proximityParams, hoursRange, serviceMode, postedWithin, sortMode, viewMode, canUseMapView]);

  // In map view, auto-load remaining pages so all geocoded listings are visible
  // without requiring users to click "Load More". Capped to prevent runaway requests.
  useEffect(() => {
    if (!canUseMapView) return;
    if (viewMode !== 'map') return;
    if (isLoading) return;
    if (!hasMore) return;
    if (listings.length >= 500) return;
    loadListingsRef.current(false);
  }, [canUseMapView, viewMode, isLoading, hasMore, listings.length]);

  // Restore scroll position on back-navigation; save on unmount
  useEffect(() => {
    const key = `listings-scroll${window.location.search}`;
    const saved = sessionStorage.getItem(key);
    if (saved) {
      requestAnimationFrame(() => window.scrollTo(0, parseInt(saved, 10)));
      sessionStorage.removeItem(key);
    }
    return () => {
      sessionStorage.setItem(key, String(Math.round(window.scrollY)));
    };
  }, []);

  // Sync URL params with filter state (harmless if it re-runs)
  useEffect(() => {
    const params = new URLSearchParams();
    if (searchInput) params.set('q', searchInput);
    if (selectedType !== 'all') params.set('type', selectedType);
    if (selectedCategory) params.set('category', selectedCategory);
    if (hoursRange !== 'any') params.set('hours', hoursRange);
    if (serviceMode !== 'any') params.set('service', serviceMode);
    if (postedWithin !== 'any') params.set('posted', postedWithin);
    if (proximityParams) {
      params.set('near_me', '1');
      params.set('near_lat', String(proximityParams.near_lat));
      params.set('near_lng', String(proximityParams.near_lng));
      params.set('radius_km', String(proximityParams.radius_km));
    }
    if (sortMode !== 'recommended') params.set('sort', sortMode);
    if (viewMode !== 'grid') params.set('view', viewMode);
    setSearchParams(params, { replace: true });
  }, [searchInput, selectedType, selectedCategory, hoursRange, serviceMode, postedWithin, proximityParams, sortMode, viewMode, setSearchParams]);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearchQuery(searchInput); // Immediately apply (bypass debounce)
  }

  const resetFilters = useCallback(() => {
    setSearchInput('');
    setSearchQuery('');
    setSelectedType('all');
    setSelectedCategory('');
    setHoursRange('any');
    setServiceMode('any');
    setPostedWithin('any');
    setProximityParams(null);
    setProximityKey((k) => k + 1);
  }, []);

  /**
   * Toggle save/unsave a listing with optimistic UI update.
   * Reverts on failure.
   */
  const handleToggleSave = useCallback(async (listingId: number, currentlySaved: boolean) => {
    if (savingIds.has(listingId)) return; // Prevent double-click

    // Optimistic update
    setSavingIds((prev) => new Set(prev).add(listingId));
    setListings((prev) =>
      prev.map((l) => l.id === listingId ? { ...l, is_favorited: !currentlySaved } : l)
    );

    try {
      if (currentlySaved) {
        await api.delete(`/v2/listings/${listingId}/save`);
        toastRef.current.success(tRef.current('unsaved_success'));
      } else {
        await api.post(`/v2/listings/${listingId}/save`);
        toastRef.current.success(tRef.current('saved_success'));
      }
    } catch (error) {
      logError('Failed to toggle save listing', error);
      // Revert optimistic update
      setListings((prev) =>
        prev.map((l) => l.id === listingId ? { ...l, is_favorited: currentlySaved } : l)
      );
      toastRef.current.error(tRef.current('save_error'));
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(listingId);
        return next;
      });
    }
  }, [savingIds]);

  if (!hasModule('listings')) {
    return null;
  }

  return (
    <>
      <PageMeta
        title={t('title')}
        description={t('page_meta_description')}
        keywords={t('page_meta_keywords')}
      />
      {/* The hero owns this page's only <h1> and is hidden on phones, where the
          title moves into the app bar as plain text — leaving a phone with no
          heading to orient by. Keep one for screen readers. Mirrors BlogPage. */}
      {isPhone && <h1 className="sr-only">{t('title')}</h1>}
      <div className="space-y-5">
      {/* Phones hide the hero entirely — the title lives in the app bar (useSetAppBarTitle). */}
      {!isPhone && (
      <div className="hidden sm:block">
        <PublicPageHero
          eyebrow={t('hero_eyebrow')}
          title={t('title')}
          description={t('page_subtitle')}
          accent="emerald"
          icon={<ListTodo className="h-7 w-7" aria-hidden="true" />}
          stats={totalItems != null ? [{ label: t('hero_results_label'), value: totalItems.toLocaleString(getFormattingLocale()) }] : undefined}
          action={
            <div className="flex flex-wrap items-center gap-3">
              <AlgorithmLabel area="listings" />
              {isAuthenticated && (
                <Button as={Link} to={tenantPath('/listings/create')}
                  variant="primary"
                  className="shrink-0 font-semibold"
                  startContent={<Plus className="w-4 h-4" aria-hidden="true" />}
                >
                  {t('create')}
                </Button>
              )}
            </div>
          }
        />
      </div>
      )}

      {/* Phone: slim sticky control bar (feed-parity) — auto-hides on scroll down. */}
      {isPhone && (
        <MobileFilterBar
          isVisible={showMobileControls}
          accent="emerald"
          onSearchPress={() => setIsSearchOverlayOpen(true)}
          searchValue={searchInput}
          onFiltersPress={openFilterSheet}
          filterCount={phoneFilterChips.length}
          chips={phoneFilterChips}
          onClearAll={resetFilters}
          labels={{
            region: t('filter_form_label'),
            filters: t('filters_label'),
            moreFilters: t('more_filters'),
            search: t('search_label'),
            clearAll: t('clear_all'),
            activeFilters: t('active_filters_label'),
            removeFilter: (filter) => t('remove_filter', { filter }),
          }}
          trailing={
            <ToggleButtonGroup
              aria-label={t('aria.view_mode')}
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={new Set([viewMode])}
              onSelectionChange={(keys) => {
                const [key] = Array.from(keys);
                if (key) setViewMode(key as ViewMode);
              }}
              className="shrink-0 gap-0 overflow-hidden rounded-full border border-theme-default bg-theme-elevated"
            >
              <ToggleButton
                id="grid"
                isIconOnly
                variant="ghost"
                aria-label={t('aria_grid_view')}
                className="h-10 min-w-10 rounded-none text-theme-muted transition-colors data-[selected=true]:bg-emerald-500/15 data-[selected=true]:text-emerald-600 dark:data-[selected=true]:text-emerald-300"
              >
                <Grid className="h-4 w-4" aria-hidden="true" />
              </ToggleButton>
              <ToggleButton
                id="list"
                isIconOnly
                variant="ghost"
                aria-label={t('aria_list_view')}
                className="h-10 min-w-10 rounded-none text-theme-muted transition-colors data-[selected=true]:bg-emerald-500/15 data-[selected=true]:text-emerald-600 dark:data-[selected=true]:text-emerald-300"
              >
                <List className="h-4 w-4" aria-hidden="true" />
              </ToggleButton>
              {canUseMapView && (
                <ToggleButton
                  id="map"
                  isIconOnly
                  variant="ghost"
                  aria-label={t('aria_map_view')}
                  className="h-10 min-w-10 rounded-none text-theme-muted transition-colors data-[selected=true]:bg-emerald-500/15 data-[selected=true]:text-emerald-600 dark:data-[selected=true]:text-emerald-300"
                >
                  <MapIcon className="h-4 w-4" aria-hidden="true" />
                </ToggleButton>
              )}
            </ToggleButtonGroup>
          }
        />
      )}

      {/* Phone: compact results count (the hero stat is hidden on phones). */}
      {isPhone && totalItems != null && (
        <p className="px-1 text-xs font-medium text-theme-muted sm:hidden">
          {t('results_count', { count: totalItems })}
        </p>
      )}

      {/* Filters (desktop and tablet — phones use the sticky bar + sheet) */}
      {!isPhone && (
      <GlassCard className="hidden p-4 sm:block sm:p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-theme-primary">{t('browse')}</h2>
            <p className="mt-1 text-sm text-theme-muted">{t('filters_intro')}</p>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-theme-elevated px-3 py-1 text-xs font-medium text-theme-muted">
            <ListTodo className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
            {totalItems != null ? t('results_count', { count: totalItems }) : t('results_loading')}
          </div>
        </div>

        {/* Row 1: Search + primary filters */}
        <form onSubmit={handleSearch} aria-label={t('filter_form_label')} className="flex flex-col gap-3 xl:flex-row">
          <div className="flex min-w-0 flex-1 gap-2">
            <SearchField
              size="lg"
              placeholder={t('search_placeholder')}
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              aria-label={t('search_label')}
              classNames={{
                input: 'bg-transparent text-theme-primary placeholder:text-theme-subtle',
                inputWrapper: 'bg-theme-elevated border-theme-default hover:bg-theme-hover shadow-sm',
              }}
            />
            <Button
              isIconOnly
              type="submit"
              variant="primary"
              className="min-h-[48px] min-w-[48px] shrink-0"
              aria-label={t('search_action')}
            >
              <Search className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:flex xl:items-center">
            <Select
              aria-label={t('filter_type_label')}
              placeholder={t('filter_type_label')}
              selectedKeys={[selectedType]}
              disallowEmptySelection
              onSelectionChange={(keys) => {
                const val = keys instanceof Set ? ([...keys][0] as string) : 'all';
                setSelectedType((val || 'all') as ListingType);
              }}
              className="w-full xl:w-36"
              classNames={{
                trigger: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
                value: 'text-theme-primary',
              }}
              startContent={<Filter className="w-4 h-4 text-theme-subtle" />}
            >
              <SelectItem key="all" id="all">{t('filter_all_types')}</SelectItem>
              <SelectItem key="offer" id="offer">{t('filters.offers')}</SelectItem>
              <SelectItem key="request" id="request">{t('filters.requests')}</SelectItem>
            </Select>

            <Select
              aria-label={t('filter_category_label')}
              placeholder={t('filter_category_label')}
              selectedKeys={[categories.length > 0 ? (selectedCategory || 'all') : 'all']}
              disallowEmptySelection
              isDisabled={categoriesLoading}
              onSelectionChange={(keys) => {
                const val = keys instanceof Set ? ([...keys][0] as string) : 'all';
                setSelectedCategory(val === 'all' ? '' : (val || ''));
              }}
              className="w-full xl:w-44"
              classNames={{
                trigger: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
                value: 'text-theme-primary',
              }}
              startContent={<Tag className="w-4 h-4 text-theme-subtle" />}
              items={categoryItems}
            >
              {(cat) => <SelectItem key={cat.slug} id={cat.slug}>{cat.name}</SelectItem>}
            </Select>

            {/* Sort order */}
            <Select
              aria-label={t('sort_label')}
              selectedKeys={[sortMode]}
              disallowEmptySelection
              onSelectionChange={(keys) => {
                const val = keys instanceof Set ? ([...keys][0] as string) : 'recommended';
                setSortMode((val === 'newest' ? 'newest' : 'recommended') as SortMode);
              }}
              className="w-full xl:w-44"
              classNames={{
                trigger: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
                value: 'text-theme-primary',
              }}
              startContent={<ArrowUpDown className="w-4 h-4 text-theme-subtle" aria-hidden="true" />}
            >
              <SelectItem key="recommended" id="recommended">{t('sort_recommended')}</SelectItem>
              <SelectItem key="newest" id="newest">{t('sort_newest')}</SelectItem>
            </Select>

            {/* Filters toggle */}
            <Button
              variant={showAdvancedFilters ? 'solid' : 'flat'}
              className={showAdvancedFilters
                ? 'min-h-[40px] bg-emerald-600 text-white shadow-sm hover:bg-emerald-700'
                : 'min-h-[40px] bg-theme-elevated text-theme-primary'}
              startContent={<SlidersHorizontal className="w-4 h-4" aria-hidden="true" />}
              onPress={() => setShowAdvancedFilters((prev) => !prev)}
              aria-expanded={showAdvancedFilters}
              aria-label={t('more_filters')}
            >
              {t('filters_label')}
              {activeFilterCount > 0 && (
                <span className="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full bg-white/20 text-xs font-bold">
                  {activeFilterCount}
                </span>
              )}
            </Button>

            {/* Mutually-exclusive view mode — idiomatic HeroUI v3 single-select toggle group. */}
            <ToggleButtonGroup
              aria-label={t('aria.view_mode')}
              selectionMode="single"
              disallowEmptySelection
              selectedKeys={new Set([viewMode])}
              onSelectionChange={(keys) => {
                const [key] = Array.from(keys);
                if (key) setViewMode(key as ViewMode);
              }}
              className="gap-0 overflow-hidden rounded-xl border border-theme-default bg-theme-elevated"
            >
              <ToggleButton
                id="grid"
                isIconOnly
                variant="ghost"
                aria-label={t('aria_grid_view')}
                className="min-h-[44px] min-w-[44px] rounded-none text-theme-muted transition-colors data-[selected=true]:bg-emerald-500/15 data-[selected=true]:text-emerald-600 dark:data-[selected=true]:text-emerald-300"
              >
                <Grid className="w-4 h-4" aria-hidden="true" />
              </ToggleButton>
              <ToggleButton
                id="list"
                isIconOnly
                variant="ghost"
                aria-label={t('aria_list_view')}
                className="min-h-[44px] min-w-[44px] rounded-none text-theme-muted transition-colors data-[selected=true]:bg-emerald-500/15 data-[selected=true]:text-emerald-600 dark:data-[selected=true]:text-emerald-300"
              >
                <List className="w-4 h-4" aria-hidden="true" />
              </ToggleButton>
              {canUseMapView && (
                <ToggleButton
                  id="map"
                  isIconOnly
                  variant="ghost"
                  aria-label={t('aria_map_view')}
                  className="min-h-[44px] min-w-[44px] rounded-none text-theme-muted transition-colors data-[selected=true]:bg-emerald-500/15 data-[selected=true]:text-emerald-600 dark:data-[selected=true]:text-emerald-300"
                >
                  <MapIcon className="w-4 h-4" aria-hidden="true" />
                </ToggleButton>
              )}
            </ToggleButtonGroup>
          </div>
        </form>

        {/* Row 2: Advanced filters (toggled) */}
        {showAdvancedFilters && (
          <div className="mt-4 grid grid-cols-1 gap-3 border-t border-theme-default pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <Select
              aria-label={t('filter_hours')}
              placeholder={t('filter_hours')}
              selectedKeys={[hoursRange]}
              disallowEmptySelection
              onSelectionChange={(keys) => {
                const val = keys instanceof Set ? ([...keys][0] as string) : 'any';
                setHoursRange(val || 'any');
              }}
              className="w-full"
              classNames={{
                trigger: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
                value: 'text-theme-primary',
              }}
              startContent={<Clock className="w-4 h-4 text-theme-subtle" />}
            >
              <SelectItem key="any" id="any">{t('filter_any_duration')}</SelectItem>
              <SelectItem key="quick" id="quick">{t('filter_quick')}</SelectItem>
              <SelectItem key="short" id="short">{t('filter_short')}</SelectItem>
              <SelectItem key="half_day" id="half_day">{t('filter_half_day')}</SelectItem>
              <SelectItem key="full_day" id="full_day">{t('filter_full_day')}</SelectItem>
            </Select>

            <Select
              aria-label={t('filter_service_mode')}
              placeholder={t('filter_service_mode')}
              selectedKeys={[serviceMode]}
              disallowEmptySelection
              onSelectionChange={(keys) => {
                const val = keys instanceof Set ? ([...keys][0] as string) : 'any';
                setServiceMode(val || 'any');
              }}
              className="w-full"
              classNames={{
                trigger: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
                value: 'text-theme-primary',
              }}
              startContent={<MapIcon className="w-4 h-4 text-theme-subtle" />}
            >
              <SelectItem key="any" id="any">{t('filter_any_mode')}</SelectItem>
              <SelectItem key="remote" id="remote">{t('filter_remote')}</SelectItem>
              <SelectItem key="in_person" id="in_person">{t('filter_in_person')}</SelectItem>
            </Select>

            <Select
              aria-label={t('filter_posted_date')}
              placeholder={t('filter_posted_date')}
              selectedKeys={[postedWithin]}
              disallowEmptySelection
              onSelectionChange={(keys) => {
                const val = keys instanceof Set ? ([...keys][0] as string) : 'any';
                setPostedWithin(val || 'any');
              }}
              className="w-full"
              classNames={{
                trigger: 'bg-theme-elevated border-theme-default hover:bg-theme-hover',
                value: 'text-theme-primary',
              }}
              startContent={<Calendar className="w-4 h-4 text-theme-subtle" />}
            >
              <SelectItem key="any" id="any">{t('filter_any_time')}</SelectItem>
              <SelectItem key="1" id="1">{t('filter_today')}</SelectItem>
              <SelectItem key="7" id="7">{t('filter_this_week')}</SelectItem>
              <SelectItem key="30" id="30">{t('filter_this_month')}</SelectItem>
            </Select>

            <Suspense fallback={null}>
              <LazyProximityFilter key={proximityKey} value={proximityParams} onFilter={setProximityParams} />
            </Suspense>

            {activeFilterCount > 0 && (
              <Button
                variant="tertiary"
                className="min-h-[40px] text-theme-muted hover:text-theme-primary"
                startContent={<X className="w-4 h-4" aria-hidden="true" />}
                onPress={resetFilters}
                aria-label={t('clear_filters')}
              >
                {t('clear_filters')}
              </Button>
            )}
          </div>
        )}
      </GlassCard>
      )}

      {isPhone && (
        <MobileSearchOverlay
          isOpen={isSearchOverlayOpen}
          onClose={() => setIsSearchOverlayOpen(false)}
          value={searchInput}
          onValueChange={setSearchInput}
          onSubmit={(value) => setSearchQuery(value)}
          placeholder={t('search_placeholder')}
          recentKey="listings"
        />
      )}

      {/* Phone filter sheet — every filter as chips, live count, draft-apply */}
      {isPhone && filterSheet.draft && (
        <ListingFilterSheet
          isOpen={filterSheet.isOpen}
          onClose={filterSheet.close}
          categories={categories}
          draft={filterSheet.draft}
          onDraftChange={filterSheet.patch}
          resultCount={filterSheet.count}
          onApply={filterSheet.apply}
          onClearAll={filterSheet.clear}
        />
      )}

      {/* Listings Grid/List */}
      {isLoading && listings.length === 0 ? (
        <div
          role="status"
          className={viewMode === 'grid' ? 'grid sm:grid-cols-2 lg:grid-cols-3 gap-4' : 'space-y-4'}
          aria-label={t('aria.loading_listings')}
          aria-busy="true"
        >
          {[1, 2, 3, 4, 5, 6].map((i) => (
            viewMode === 'grid'
              ? <ListingSkeleton key={i} />
              : <MediaRowsSkeleton key={i} className="p-4" mediaClassName="h-20 w-20" />
          ))}
        </div>
      ) : loadError ? (
        <GlassCard className="p-8 text-center sm:p-10">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-warning/15 text-[var(--color-warning)]">
            <AlertTriangle className="h-7 w-7" aria-hidden="true" />
          </div>
          <h2 className="text-lg font-semibold text-theme-primary mb-2">{t('load_error_title')}</h2>
          <p className="text-theme-muted mb-4">{loadError}</p>
          <Button
            variant="primary"
            startContent={<RefreshCw className="w-4 h-4" aria-hidden="true" />}
            onPress={() => loadListings(true)}
          >
            {t('try_again')}
          </Button>
        </GlassCard>
      ) : listings.length === 0 ? (
        (
            <PublicEmptyState
              icon={<Search className="w-12 h-12" />}
              title={t('empty')}
              description={hasActiveFilters ? t('empty_subtitle') : t('empty_no_listings')}
              accent="emerald"
              tips={hasActiveFilters ? [t('empty_tip_filters'), t('empty_tip_categories')] : [t('empty_tip_offer'), t('empty_tip_request')]}
              action={
                hasActiveFilters ? (
                  <Button
                    variant="primary"
                    startContent={<X className="w-4 h-4" aria-hidden="true" />}
                    onPress={resetFilters}
                  >
                    {t('clear_filters')}
                  </Button>
                ) : isAuthenticated ? (
                  <Button as={Link} to={tenantPath('/listings/create')} variant="primary" startContent={<Plus className="h-4 w-4" aria-hidden="true" />}>
                    {t('create')}
                  </Button>
                ) : undefined
              }
            />
        )
      ) : (
        <>
          {viewMode === 'map' ? (
            <Suspense
              fallback={
                <div
                  role="status"
                  aria-busy="true"
                  aria-label={t('aria.loading_listings')}
                  className="h-[600px] rounded-xl bg-theme-elevated"
                />
              }
            >
            <LazyEntityMapView
              items={listings}
              getCoordinates={(l: Listing) => {
                if (l.latitude === null || l.latitude === undefined || l.longitude === null || l.longitude === undefined) {
                  return null;
                }
                const lat = Number(l.latitude);
                const lng = Number(l.longitude);
                return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
              }}
              getMarkerConfig={(l: Listing) => ({
                id: l.id,
                title: l.title,
                pinColor: l.type === 'offer' ? '#10b981' : '#f59e0b',
              })}
              renderInfoContent={(l: Listing) => (
                <div className="p-2 max-w-[250px]">
                  <div className="flex items-center gap-1 mb-1">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                      l.type === 'offer' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                    }`}>
                      {l.type === 'offer' ? t('offer') : t('request')}
                    </span>
                  </div>
                  <h4 className="font-semibold text-sm text-theme-primary">{l.title}</h4>
                  <p className="text-xs text-theme-secondary line-clamp-2 mt-0.5">{l.description}</p>
                  {l.location && <p className="text-xs text-theme-muted mt-1">{l.location}</p>}
                  <Button as={Link} to={tenantPath(`/listings/${l.id}`)}
                    size="sm"
                    variant="secondary"
                    className="mt-2 inline-flex h-8 min-w-0 bg-theme-elevated px-3 text-xs font-medium text-theme-primary hover:bg-theme-hover"
                    endContent={<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />}
                  >
                    {t('map_view_listing')}
                  </Button>
                </div>
              )}
              isLoading={isLoading}
              emptyMessage={t('map_empty')}
            />
            </Suspense>
          ) : (
            <>
              <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
                {!isLoading && listings.length > 0 ? t('listings_loaded_count', { count: listings.length }) : ''}
              </div>
              <motion.div
                key={`${searchQuery}-${selectedType}-${selectedCategory}-${sortMode}`}
                variants={listingContainerVariants}
                initial="hidden"
                animate="visible"
                // Structural hook for the E2E suite: the RESULTS container.
                //
                // 🔴 Must stay on this element, not on the loading skeleton above,
                // which carries a byte-identical class list
                // (`grid sm:grid-cols-2 lg:grid-cols-3 gap-4`). Anything keyed on
                // those classes cannot tell "results painted" from "still
                // loading" — the skeleton is distinguished only by role="status"
                // and aria-busy. The value carries the current view mode so a
                // test can assert grid vs list without re-deriving it.
                data-listings-grid={viewMode}
                className={viewMode === 'grid' ? 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3' : 'space-y-4'}
              >
                {listings.map((listing) => (
                  <motion.div key={listing.id} variants={listingItemVariants}>
                    <ListingCard
                      listing={listing}
                      viewMode={viewMode}
                      isSaving={savingIds.has(listing.id)}
                      onToggleSave={isAuthenticated ? handleToggleSave : undefined}
                    />
                  </motion.div>
                ))}
              </motion.div>
            </>
          )}

          {/* Load More with progress (hidden in map view — auto-loaded) */}
          {hasMore && viewMode !== 'map' && (
            <div className="space-y-3 pt-4">
              {totalItems != null && totalItems > 0 && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs text-theme-muted px-1">
                    <span>{listings.length.toLocaleString(getFormattingLocale())} / {totalItems.toLocaleString(getFormattingLocale())}</span>
                    <span className="font-medium text-theme-secondary">{Math.round((listings.length / totalItems) * 100)}%</span>
                  </div>
                  <Progress
                    aria-label={t('loading_progress')}
                    size="sm"
                    value={Math.round((listings.length / totalItems) * 100)}
                    classNames={{ track: 'bg-theme-elevated', indicator: 'bg-emerald-500' }}
                  />
                </div>
              )}
              <div className="text-center">
                <Button
                  variant="secondary"
                  className="bg-theme-elevated text-theme-primary hover:bg-theme-hover"
                  onPress={() => loadListings()}
                  isLoading={isLoading}
                >
                  {totalItems != null && totalItems > listings.length
                    ? t('load_more_count', { remaining: totalItems - listings.length })
                    : t('load_more')}
                </Button>
                {paginationError && (
                  <p className="text-center text-sm text-danger mt-2">{t('load_more_error_persistent')}</p>
                )}
              </div>
            </div>
          )}
        </>
      )}
      </div>
    </>
  );
}

// Light-mode text uses the -800 shade (not -600): on the soft -500/20 tint the
// -600 shade fell below WCAG AA 4.5:1 for this 10px text (axe color-contrast,
// "serious", on the listings + dashboard cards). -800 clears 4.5:1 for every
// hue here; dark mode keeps -400, which already passed on the dark tint. The
// category badge's muted text on the hover surface likewise failed, so it now
// uses the primary text token.
const BADGE_TONES = {
  offer: 'bg-emerald-500/20 text-emerald-800 dark:text-emerald-400',
  request: 'bg-amber-500/20 text-amber-800 dark:text-amber-400',
  mutual: 'bg-violet-500/20 text-violet-800 dark:text-violet-400',
  one_way: 'bg-sky-500/20 text-sky-800 dark:text-sky-400',
  remote: 'bg-blue-500/20 text-blue-800 dark:text-blue-400',
  hybrid: 'bg-teal-500/20 text-teal-800 dark:text-teal-400',
  category: 'bg-theme-hover text-theme-primary',
} as const;

type BadgeTone = keyof typeof BADGE_TONES;

/**
 * Status pill for listing cards. Wraps the HeroUI Chip so every badge shares one
 * size/shape; `tone` carries the bespoke colour palette (emerald/violet/sky/…),
 * which isn't part of Chip's semantic colour set.
 */
function ListingBadge({
  tone,
  icon: Icon,
  title,
  children,
}: {
  tone: BadgeTone;
  icon?: React.ElementType;
  title?: string;
  children: ReactNode;
}) {
  return (
    <Chip
      size="sm"
      variant="soft"
      title={title}
      className={`h-auto gap-0.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${BADGE_TONES[tone]}`}
      startContent={Icon ? <Icon className="w-2.5 h-2.5" aria-hidden="true" /> : undefined}
    >
      {children}
    </Chip>
  );
}

interface ListingCardProps {
  listing: Listing;
  viewMode: ViewMode;
  isSaving?: boolean;
  onToggleSave?: (listingId: number, currentlySaved: boolean) => void;
}

const ListingCard = memo(function ListingCard({ listing, viewMode, isSaving, onToggleSave }: ListingCardProps) {
  const { t } = useTranslation('listings');
  const { tenantPath } = useTenant();
  const isGrid = viewMode === 'grid';
  const [imgError, setImgError] = useState(false);
  const hours = listing.estimated_hours || listing.hours_estimate;
  const avatarSource = listing.author_avatar || listing.user?.avatar;
  const avatarSrc = avatarSource
    ? resolveThumbnailUrl(avatarSource, { width: 96, height: 96, fallback: resolveAvatarUrl(null) })
    : resolveAvatarUrl(null);
  const isFavorited = listing.is_favorited === true;
  const fallbackUserName = t('user_fallback');
  const imageAlt = listing.title || t('listing_image_alt');
  // Read both author fields: the list endpoint historically sent only `user.name`,
  // so keying on `author_name` alone showed the generic fallback on every card.
  const authorName = listing.author_name || listing.user?.name || fallbackUserName;
  const formatDistance = (distanceKm: number) =>
    distanceKm < 1
      ? t('distance_meters', { distance: Math.round(distanceKm * 1000) })
      : t('distance_kilometers', { distance: distanceKm.toFixed(1) });

  function handleSaveClick() {
    if (onToggleSave && !isSaving) {
      onToggleSave(listing.id, isFavorited);
    }
  }

  const imageProps = listing.image_url
    ? responsiveThumbnailProps(listing.image_url, {
        width: isGrid ? 640 : 160,
        height: isGrid ? 360 : 160,
        widths: isGrid ? [320, 480, 640] : [96, 160],
        sizes: isGrid ? '(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw' : '160px',
      })
    : null;

  if (!isGrid) {
    // ─── List View ───
    return (
      <GlassCard data-testid="listing-card" className={`relative cursor-pointer p-4 transition-all duration-200 hover:-translate-y-0.5 hover:bg-theme-hover hover:shadow-md border-l-4 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent ${listing.type === 'offer' ? 'border-l-emerald-500/70' : 'border-l-amber-500/70'}`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
            {imageProps && !imgError ? (
              <img
                {...imageProps}
                alt={imageAlt}
                className="h-36 w-full shrink-0 rounded-lg object-cover sm:h-20 sm:w-20"
                width={160}
                height={160}
                loading="lazy"
                decoding="async"
                fetchPriority="low"
                onError={() => setImgError(true)}
              />
            ) : (
              <Avatar
                src={avatarSrc}
                name={authorName}
                size="md"
                className="h-14 w-14 shrink-0 ring-2 ring-theme-muted/20 sm:h-16 sm:w-16"
              />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <ListingBadge tone={listing.type === 'offer' ? 'offer' : 'request'}>
                  {listing.type === 'offer' ? t('offering') : t('requesting')}
                </ListingBadge>
                {listing.is_featured && <FeaturedBadge />}
                {listing.reciprocity_match === 'mutual' && (
                  <ListingBadge tone="mutual" icon={Zap}>{t('reciprocity_mutual')}</ListingBadge>
                )}
                {listing.reciprocity_match === 'one_way' && (
                  <ListingBadge tone="one_way" icon={Zap}>{t('reciprocity_one_way')}</ListingBadge>
                )}
                {listing.service_type === 'remote_only' && (
                  <ListingBadge tone="remote" icon={Monitor}>{t('service_type_remote')}</ListingBadge>
                )}
                {listing.service_type === 'hybrid' && (
                  <ListingBadge tone="hybrid" icon={ArrowRightLeft}>{t('service_type_hybrid_available')}</ListingBadge>
                )}
                {listing.category_name && (
                  <ListingBadge tone="category">{listing.category_name}</ListingBadge>
                )}
              </div>
              <h3 className="truncate text-base font-semibold text-theme-primary sm:text-lg">
                <Link
                  to={tenantPath(`/listings/${listing.id}`)}
                  className="outline-none after:absolute after:inset-0"
                  aria-label={t('open_listing_aria', { title: listing.title })}
                >
                  {listing.title}
                </Link>
              </h3>
              <p className="mt-1 line-clamp-2 text-sm leading-6 text-theme-muted sm:line-clamp-1">{listing.description}</p>
              <div className="mt-2 flex items-center gap-2 text-xs text-theme-subtle">
                <span className="truncate">{authorName}</span>
                {listing.author_rating != null && listing.author_rating > 0 && (
                  <span className="flex items-center gap-0.5 text-[11px] text-[var(--color-warning)] shrink-0">
                    <Star className="w-3 h-3 fill-amber-500" aria-hidden="true" />
                    {listing.author_rating.toFixed(1)}
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-row flex-wrap items-center justify-between gap-3 text-xs text-theme-subtle sm:flex-col sm:items-end sm:justify-start sm:gap-1 sm:shrink-0">
              {hours && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" aria-hidden="true" />
                  {t('listings:hours_short', { hours })}
                </span>
              )}
              {listing.location && (
                <span className="flex min-w-0 items-center gap-1" title={listing.location}>
                  <MapPin className="w-3 h-3 shrink-0" aria-hidden="true" />
                  <span className="truncate max-w-[160px] sm:max-w-[200px]">{listing.location}</span>
                </span>
              )}
              {listing.distance_km !== undefined && (
                <span className="flex items-center gap-1 text-accent font-medium">
                  <MapPin className="w-3 h-3" aria-hidden="true" />
                  {formatDistance(listing.distance_km)}
                </span>
              )}
              {onToggleSave && (
                <Button
                  isIconOnly
                  size="sm"
                  variant="secondary"
                  onPress={handleSaveClick}
                  isDisabled={isSaving}
                  aria-label={isFavorited ? t('unsave_listing') : t('save_listing')}
                  className="relative z-10 p-1 rounded transition-colors hover:bg-theme-hover min-w-[44px] min-h-[44px]"
                >
                  <Heart
                    className={`w-4 h-4 transition-colors ${isFavorited ? 'fill-rose-500 text-rose-500' : 'text-theme-muted hover:text-rose-400'}`}
                    aria-hidden="true"
                  />
                </Button>
              )}
            </div>
          </div>
        </GlassCard>
    );
  }

  // ─── Grid View ───
  return (
      <GlassCard data-testid="listing-card" className="group relative flex h-full cursor-pointer flex-col overflow-hidden transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
        {/* Listing Image with hover overlay and floating save button */}
        <div className="relative aspect-video overflow-hidden bg-theme-elevated">
          {imageProps && !imgError ? (
            <img
              {...imageProps}
              alt={imageAlt}
              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
              width={800}
              height={450}
              loading="lazy"
              decoding="async"
              fetchPriority="low"
              onError={() => setImgError(true)}
            />
          ) : (
            <ImagePlaceholder size="sm" />
          )}
          {/* Dark overlay on hover */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-200 pointer-events-none" aria-hidden="true" />
          {/* Floating save button */}
          {onToggleSave && (
            <div className="absolute top-2 right-2 z-10">
              <Button
                isIconOnly
                size="sm"
                onPress={handleSaveClick}
                isDisabled={isSaving}
                aria-label={isFavorited ? t('unsave_listing') : t('save_listing')}
                className={`min-w-[36px] min-h-[36px] rounded-full backdrop-blur-sm shadow-lg transition-all ${
                  isFavorited
                    ? 'bg-rose-500/90 text-white hover:bg-rose-600'
                    : 'bg-black/40 text-white hover:bg-black/60'
                }`}
              >
                <Heart
                  className={`w-4 h-4 transition-colors ${isFavorited ? 'fill-white' : ''}`}
                  aria-hidden="true"
                />
              </Button>
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col p-4">
        {/* Type + Category Badges */}
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          <ListingBadge tone={listing.type === 'offer' ? 'offer' : 'request'}>
            {listing.type === 'offer' ? t('offering') : t('requesting')}
          </ListingBadge>
          {listing.is_featured && <FeaturedBadge />}
          {listing.reciprocity_match === 'mutual' && (
            <ListingBadge tone="mutual" icon={Zap} title={t('reciprocity_mutual_title')}>{t('reciprocity_mutual')}</ListingBadge>
          )}
          {listing.reciprocity_match === 'one_way' && (
            <ListingBadge tone="one_way" icon={Zap} title={t('reciprocity_one_way_title')}>{t('reciprocity_one_way')}</ListingBadge>
          )}
          {listing.service_type === 'remote_only' && (
            <ListingBadge tone="remote" icon={Monitor}>{t('service_type_remote')}</ListingBadge>
          )}
          {listing.service_type === 'hybrid' && (
            <ListingBadge tone="hybrid" icon={ArrowRightLeft}>{t('service_type_hybrid_available')}</ListingBadge>
          )}
          {listing.category_name && (
            <ListingBadge tone="category">{listing.category_name}</ListingBadge>
          )}
        </div>

        {/* Title & Description */}
        <h3 className="mb-2 line-clamp-2 text-lg font-semibold leading-6 text-theme-primary">
          <Link
            to={tenantPath(`/listings/${listing.id}`)}
            className="outline-none after:absolute after:inset-0"
            aria-label={t('open_listing_aria', { title: listing.title })}
          >
            {listing.title}
          </Link>
        </h3>
        <p className="mb-4 line-clamp-3 flex-1 text-sm leading-6 text-theme-muted">{listing.description}</p>

        {/* Footer: Author row above a single meta row.
            Both rows are fixed height — the meta row never wraps and the address
            truncates — so every card's footer is the same height and the cards in
            a row keep matching bottom padding no matter how long the address is. */}
        <div className="mt-auto flex flex-col gap-2 border-t border-theme-default pt-3">
          <div className="flex items-center gap-2 min-w-0">
            <Avatar
              src={avatarSrc}
              name={authorName}
              size="sm"
              className="shrink-0 w-8 h-8"
            />
            <span className="truncate text-sm font-medium text-theme-secondary">{authorName}</span>
            {listing.author_rating != null && listing.author_rating > 0 && (
              <span className="flex items-center gap-0.5 text-[11px] text-[var(--color-warning)] shrink-0">
                <Star className="w-3 h-3 fill-amber-500" aria-hidden="true" />
                {listing.author_rating.toFixed(1)}
              </span>
            )}
          </div>
          {(hours || listing.location || listing.distance_km !== undefined) && (
            <div className="flex min-w-0 items-center gap-3 text-xs text-theme-subtle">
              {hours && (
                <span className="flex items-center gap-1 shrink-0" aria-label={t('aria_hours_estimated', { hours })}>
                  <Clock className="w-3 h-3" aria-hidden="true" />
                  {t('listings:hours_short', { hours })}
                </span>
              )}
              {listing.location && (
                <span
                  className="flex min-w-0 flex-1 items-center gap-1"
                  title={listing.location}
                  aria-label={t('aria_location', { location: listing.location })}
                >
                  <MapPin className="w-3 h-3 shrink-0" aria-hidden="true" />
                  <span className="truncate">{listing.location}</span>
                </span>
              )}
              {listing.distance_km !== undefined && (
                <span className="flex items-center gap-1 shrink-0 text-accent font-medium">
                  <MapPin className="w-3 h-3" aria-hidden="true" />
                  {formatDistance(listing.distance_km)}
                </span>
              )}
            </div>
          )}
        </div>
        </div>{/* end p-4 wrapper */}
      </GlassCard>
  );
});

export default ListingsPage;
