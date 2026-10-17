// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MarketplaceSearchPage — Advanced search with filters.
 *
 * Features:
 * - Search input with debounce
 * - Filter sidebar (desktop) / bottom sheet concept (mobile via collapsible)
 * - Category, price range, condition, seller type, delivery, sort, posted-within
 * - URL query param sync for shareable search URLs
 * - Results grid with cursor pagination (shared MarketplaceListingGrid)
 */

import { useState, useEffect, useCallback, useRef, type Key } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import Search from 'lucide-react/icons/search';
import SlidersHorizontal from 'lucide-react/icons/sliders-horizontal';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import { useTranslation } from 'react-i18next';
import { Autocomplete } from '@/components/ui/Autocomplete';
import { Button } from '@/components/ui/Button';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Checkbox, CheckboxGroup } from '@/components/ui/Checkbox';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { ListBoxItem as AutocompleteItem } from '@/components/ui/ListBox';
import { SearchField } from '@/components/ui/SearchField';
import { Select, SelectItem } from '@/components/ui/Select';
import { TagGroup, Tag } from '@/components/ui/TagGroup';
import { EmptyState } from '@/components/feedback';
import { MarketplaceListingGrid, MarketplaceListingGridSkeleton } from '@/components/marketplace';
import type { MarketplaceListingItem } from '@/types/marketplace';
import { useAuth, useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { normalizeMarketplaceListing } from '@/lib/marketplaceNumbers';
import { useMediaQuery, usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo/PageMeta';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface ApiCategory {
  id: number;
  name: string;
  slug: string;
  listing_count: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const ITEMS_PER_PAGE = 24;
const SEARCH_DEBOUNCE_MS = 300;

const CONDITION_OPTIONS = [
  { value: 'new' },
  { value: 'like_new' },
  { value: 'good' },
  { value: 'fair' },
  { value: 'poor' },
];

const SORT_OPTIONS = [
  { value: 'newest' },
  { value: 'price_asc' },
  { value: 'price_desc' },
  { value: 'popular' },
];

/** Listing types the browse endpoint accepts as a single `price_type` filter. */
const PRICE_TYPE_OPTIONS = [
  { value: 'fixed' },
  { value: 'negotiable' },
  { value: 'free' },
  { value: 'lend' },
] as const;

const POSTED_WITHIN_OPTIONS = [
  { value: '', tKey: 'filters.posted_any_time' },
  { value: '1', tKey: 'filters.posted_today' },
  { value: '3', tKey: 'filters.posted_last_days', count: 3 },
  { value: '7', tKey: 'filters.posted_last_days', count: 7 },
  { value: '30', tKey: 'filters.posted_last_days', count: 30 },
];

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function MarketplaceSearchPage() {
  const { t } = useTranslation('marketplace');
  usePageTitle(t('search.page_title'));
  const { isAuthenticated } = useAuth();
  const { tenantPath } = useTenant();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // Filter state -- initialized from URL
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);
  const [categoryId, setCategoryId] = useState(searchParams.get('category_id') || '');
  const [priceMin, setPriceMin] = useState(searchParams.get('price_min') || '');
  const [priceMax, setPriceMax] = useState(searchParams.get('price_max') || '');
  const [selectedConditions, setSelectedConditions] = useState<string[]>(
    searchParams.get('condition')?.split(',').filter(Boolean) || []
  );
  const [sellerType, setSellerType] = useState(searchParams.get('seller_type') || '');
  const [deliveryMethod, setDeliveryMethod] = useState(searchParams.get('delivery_method') || '');
  // Listing type (`price_type`): for sale, negotiable, free (Freecycle) or borrow & lend.
  const [priceType, setPriceType] = useState(searchParams.get('price_type') || '');
  const [sortBy, setSortBy] = useState(searchParams.get('sort') || 'newest');
  const [postedWithin, setPostedWithin] = useState(searchParams.get('posted_within') || '');
  const [showFilters, setShowFilters] = useState(false);
  const usesFilterSheet = useMediaQuery('(max-width: 1023px)');

  const getPostedWithinLabel = useCallback((value: string) => {
    const option = POSTED_WITHIN_OPTIONS.find((opt) => opt.value === value);
    if (!option) return value;
    return t(option.tKey, { count: option.count });
  }, [t]);

  // Data state
  const [listings, setListings] = useState<MarketplaceListingItem[]>([]);
  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const cursorRef = useRef<string | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listingRequestRef = useRef(0);

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

  // Load listings
  const loadListings = useCallback(async (append = false) => {
    const requestId = ++listingRequestRef.current;
    try {
      if (!append) {
        setIsLoading(true);
        setLoadError(null);
      } else {
        setIsLoadingMore(true);
      }

      const params = new URLSearchParams();
      if (debouncedQuery) params.set('q', debouncedQuery);
      if (categoryId) params.set('category_id', categoryId);
      if (priceMin) params.set('price_min', priceMin);
      if (priceMax) params.set('price_max', priceMax);
      if (selectedConditions.length > 0) params.set('condition', selectedConditions.join(','));
      if (sellerType) params.set('seller_type', sellerType);
      if (deliveryMethod) params.set('delivery_method', deliveryMethod);
      if (priceType) params.set('price_type', priceType);
      if (sortBy !== 'newest') params.set('sort', sortBy);
      if (postedWithin) params.set('posted_within', postedWithin);
      params.set('limit', String(ITEMS_PER_PAGE));
      if (append && cursorRef.current) {
        params.set('cursor', cursorRef.current);
      }

      const response = await api.get<MarketplaceListingItem[]>(`/v2/marketplace/listings?${params}`);
      if (requestId !== listingRequestRef.current) return;
      if (response.success && response.data) {
        if (!append) setLoadError(null);
        const mapped = response.data.map(normalizeMarketplaceListing);
        if (append) {
          setListings((prev) => [...prev, ...mapped]);
        } else {
          setListings(mapped);
        }
        cursorRef.current = response.meta?.cursor ?? response.meta?.next_cursor ?? null;
        setHasMore(response.meta?.has_more ?? response.data.length >= ITEMS_PER_PAGE);
      } else if (!append) {
        const message = t('search.search_failed');
        setLoadError(message);
        toast.error(message);
      }
    } catch (err) {
      if (requestId !== listingRequestRef.current) return;
      logError('Failed to search marketplace', err);
      if (!append) {
        const message = t('search.search_failed');
        setLoadError(message);
        toast.error(message);
      }
    } finally {
      if (requestId === listingRequestRef.current) {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    }
  }, [debouncedQuery, categoryId, priceMin, priceMax, selectedConditions, sellerType, deliveryMethod, priceType, sortBy, postedWithin, toast, t])

  // Refetch on filter change
  useEffect(() => {
    cursorRef.current = null;
    setHasMore(true);
    loadListings();
  }, [debouncedQuery, categoryId, priceMin, priceMax, selectedConditions, sellerType, deliveryMethod, priceType, sortBy, postedWithin]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedQuery) params.set('q', debouncedQuery);
    if (categoryId) params.set('category_id', categoryId);
    if (priceMin) params.set('price_min', priceMin);
    if (priceMax) params.set('price_max', priceMax);
    if (selectedConditions.length > 0) params.set('condition', selectedConditions.join(','));
    if (sellerType) params.set('seller_type', sellerType);
    if (deliveryMethod) params.set('delivery_method', deliveryMethod);
    if (priceType) params.set('price_type', priceType);
    if (sortBy !== 'newest') params.set('sort', sortBy);
    if (postedWithin) params.set('posted_within', postedWithin);
    setSearchParams(params, { replace: true });
  }, [debouncedQuery, categoryId, priceMin, priceMax, selectedConditions, sellerType, deliveryMethod, priceType, sortBy, postedWithin, setSearchParams]);

  // Count active filters
  const activeFilterCount = [
    categoryId,
    priceMin,
    priceMax,
    selectedConditions.length > 0 ? 'yes' : '',
    sellerType,
    deliveryMethod,
    priceType,
    postedWithin,
  ].filter(Boolean).length;

  const handleRemoveFilterTag = (keys: Set<Key>) => {
    keys.forEach((key) => {
      const tagKey = String(key);
      if (tagKey === 'category') setCategoryId('');
      if (tagKey === 'price') {
        setPriceMin('');
        setPriceMax('');
      }
      if (tagKey.startsWith('condition:')) {
        const condition = tagKey.replace('condition:', '');
        setSelectedConditions((prev) => prev.filter((x) => x !== condition));
      }
      if (tagKey === 'seller') setSellerType('');
      if (tagKey === 'delivery') setDeliveryMethod('');
      if (tagKey === 'price_type') setPriceType('');
      if (tagKey === 'posted') setPostedWithin('');
    });
  };

  // Reset filters
  const resetFilters = () => {
    setCategoryId('');
    setPriceMin('');
    setPriceMax('');
    setSelectedConditions([]);
    setSellerType('');
    setDeliveryMethod('');
    setPriceType('');
    setSortBy('newest');
    setPostedWithin('');
  };

  // Save / Unsave
  const handleSave = async (id: number) => {
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
  };

  const handleUnsave = async (id: number) => {
    if (!isAuthenticated) {
      toast.error(t('common.sign_in_to_save'));
      return;
    }
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
  };

  // Filter sidebar content
  const filterContent = (
    <div className="space-y-5">
      {/* Category */}
      <div>
        <Autocomplete
          label={t('search.category_label')}
          placeholder={t('search.all_categories')}
          searchPlaceholder={t('search.category_search')}
          value={categoryId || null}
          onChange={(key) => {
            setCategoryId(key && !Array.isArray(key) ? String(key) : '');
          }}
          variant="secondary"
        >
          {categories.map((cat) => (
            <AutocompleteItem key={String(cat.id)} id={String(cat.id)} textValue={cat.name}>
              {cat.name} ({cat.listing_count})
            </AutocompleteItem>
          ))}
        </Autocomplete>
      </div>

      {/* Price range */}
      <div>
        <p className="text-sm font-medium text-foreground mb-2">{t('search.price_range')}</p>
        <div className="flex gap-2 items-center">
          <Input
            size="sm"
            type="number"
            placeholder={t('search.price_min')}
            aria-label={t('search.price_min')}
            min={0}
            value={priceMin}
            onValueChange={setPriceMin}
          />
          <span className="text-muted">-</span>
          <Input
            size="sm"
            type="number"
            placeholder={t('search.price_max')}
            aria-label={t('search.price_max')}
            min={0}
            value={priceMax}
            onValueChange={setPriceMax}
          />
        </div>
      </div>

      {/* Condition */}
      <div>
        <CheckboxGroup
          label={t('search.condition_label')}
          value={selectedConditions}
          onValueChange={setSelectedConditions}
          size="sm"
        >
          {CONDITION_OPTIONS.map((opt) => (
            <Checkbox key={opt.value} value={opt.value}>
              {t(`condition.${opt.value}`)}
            </Checkbox>
          ))}
        </CheckboxGroup>
      </div>

      {/* Seller type */}
      <div>
        <Select
          label={t('search.seller_type_label')}
          placeholder={t('search.all_sellers')}
          selectedKeys={sellerType ? [sellerType] : []}
          onSelectionChange={(keys) => {
            const selected = Array.from(keys)[0];
            setSellerType(selected ? String(selected) : '');
          }}
          size="sm"
        >
          <SelectItem key="private" id="private">{t('search.private')}</SelectItem>
          <SelectItem key="business" id="business">{t('search.business')}</SelectItem>
        </Select>
      </div>

      {/* Listing type (price_type) */}
      <div>
        <Select
          label={t('filters.listing_type')}
          placeholder={t('filters.listing_type_any')}
          selectedKeys={priceType ? [priceType] : []}
          onSelectionChange={(keys) => {
            const selected = Array.from(keys)[0];
            setPriceType(selected ? String(selected) : '');
          }}
          size="sm"
        >
          {PRICE_TYPE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} id={opt.value}>{t(`price_type.${opt.value}`)}</SelectItem>
          ))}
        </Select>
      </div>

      {/* Delivery method */}
      <div>
        <Select
          label={t('search.delivery_label')}
          placeholder={t('search.any_delivery')}
          selectedKeys={deliveryMethod ? [deliveryMethod] : []}
          onSelectionChange={(keys) => {
            const selected = Array.from(keys)[0];
            setDeliveryMethod(selected ? String(selected) : '');
          }}
          size="sm"
        >
          <SelectItem key="pickup" id="pickup">{t('search.delivery_pickup')}</SelectItem>
          <SelectItem key="shipping" id="shipping">{t('search.delivery_shipping')}</SelectItem>
          <SelectItem key="both" id="both">{t('search.delivery_both')}</SelectItem>
        </Select>
      </div>

      {/* Posted within */}
      <div>
        <Select
          label={t('search.posted_within')}
          placeholder={t('search.any_time')}
          selectedKeys={postedWithin ? [postedWithin] : []}
          onSelectionChange={(keys) => {
            const selected = Array.from(keys)[0];
            setPostedWithin(selected ? String(selected) : '');
          }}
          size="sm"
        >
          {POSTED_WITHIN_OPTIONS.filter((o) => o.value).map((opt) => (
            <SelectItem key={opt.value} id={opt.value}>{getPostedWithinLabel(opt.value)}</SelectItem>
          ))}
        </Select>
      </div>

      {/* Reset */}
      {activeFilterCount > 0 && (
        <Button
          variant="danger-soft"

          fullWidth
          size="sm"
          startContent={<RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />}
          onPress={resetFilters}
        >
          {t('search.reset_filters', { count: activeFilterCount })}
        </Button>
      )}
    </div>
  );

  return (
    <>
      <PageMeta
        title={t('search.page_title')}
        description={t('search.meta_description')}
      />

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <h1 className="sr-only">{t('search.page_heading')}</h1>
        {/* Header */}
        <div className="space-y-4">
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
            <span className="text-foreground font-medium">{t('search.breadcrumb_search')}</span>
          </div>

          {/* Search bar + sort */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <SearchField
              placeholder={t('search.search_placeholder')}
              aria-label={t('search.search_placeholder')}
              value={searchQuery}
              onValueChange={setSearchQuery}
              size="lg"
              variant="secondary"
              classNames={{ inputWrapper: 'bg-background' }}
              isClearable
              onClear={() => setSearchQuery('')}
              className="w-full sm:flex-1"
            />
            <Select
              selectedKeys={[sortBy]}
              onSelectionChange={(keys) => {
                const selected = Array.from(keys)[0];
                if (selected) setSortBy(String(selected));
              }}
              size="lg"
              className="w-48 shrink-0 hidden sm:block"
              aria-label={t('common.sort_by')}
            >
              {SORT_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} id={opt.value}>{t(`sort.${opt.value}`)}</SelectItem>
              ))}
            </Select>

            {/* Mobile filter toggle */}
            <Button
              variant="secondary"
              size="lg"
              className="w-full shrink-0 sm:w-auto lg:hidden"
              startContent={<SlidersHorizontal className="w-4 h-4" aria-hidden="true" />}
              onPress={() => setShowFilters(!showFilters)}
            >
              {t('search.filters')}
              {activeFilterCount > 0 && (
                <Chip size="sm" color="accent" variant="primary" className="ml-1">
                  {activeFilterCount}
                </Chip>
              )}
            </Button>
          </div>

          {/* Active filter chips */}
          {activeFilterCount > 0 && (
            <TagGroup aria-label={t('search.filters')} size="sm" variant="surface" onRemove={handleRemoveFilterTag}>
              <TagGroup.List className="flex flex-wrap gap-2">
              {categoryId && (
                <Tag id="category" textValue={categories.find((c) => String(c.id) === categoryId)?.name || t('filters.category')}>
                  {categories.find((c) => String(c.id) === categoryId)?.name || t('filters.category')}
                </Tag>
              )}
              {(priceMin || priceMax) && (
                <Tag id="price" textValue={priceMin && priceMax ? `${priceMin} - ${priceMax}` : priceMin ? t('search.price_from', { min: priceMin }) : t('search.price_up_to', { max: priceMax })}>
                  {priceMin && priceMax ? `${priceMin} - ${priceMax}` :
                    priceMin ? t('search.price_from', { min: priceMin }) : t('search.price_up_to', { max: priceMax })}
                </Tag>
              )}
              {selectedConditions.map((c) => (
                <Tag
                  key={c}
                  id={`condition:${c}`}
                  textValue={t(`condition.${c}`)}
                >
                  {t(`condition.${c}`)}
                </Tag>
              ))}
              {sellerType && (
                <Tag id="seller" textValue={sellerType === 'business' ? t('search.business') : t('search.private')}>
                  {sellerType === 'business' ? t('search.business') : t('search.private')}
                </Tag>
              )}
              {deliveryMethod && (
                <Tag id="delivery" textValue={t(`delivery_method.${deliveryMethod}`)}>
                  {t(`delivery_method.${deliveryMethod}`)}
                </Tag>
              )}
              {priceType && (
                <Tag id="price_type" textValue={t(`price_type.${priceType}`)}>
                  {t(`price_type.${priceType}`)}
                </Tag>
              )}
              {postedWithin && (
                <Tag id="posted" textValue={getPostedWithinLabel(postedWithin)}>
                  {getPostedWithinLabel(postedWithin)}
                </Tag>
              )}
              </TagGroup.List>
            </TagGroup>
          )}
        </div>

        <BottomSheet
          isOpen={showFilters && usesFilterSheet}
          onClose={() => setShowFilters(false)}
          title={t('search.filters_title')}
          snapPoints={['full']}
        >
          {filterContent}
        </BottomSheet>

        {/* Main layout */}
        <div className="flex gap-6">
          {/* Desktop filter sidebar */}
          <aside className="hidden lg:block w-64 shrink-0" aria-label={t('aria.filter_panel')}>
            <GlassCard className="p-5 sticky top-24">
              <h3 className="font-semibold text-foreground mb-4 flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-accent" aria-hidden="true" />
                {t('search.filters_title')}
              </h3>
              {filterContent}
            </GlassCard>
          </aside>

          {/* Results */}
          <div className="flex-1 min-w-0">
            {isLoading ? (
              <MarketplaceListingGridSkeleton />
            ) : loadError ? (
              <EmptyState
                icon={<Search className="w-8 h-8" />}
                title={loadError}
                action={{ label: t('common.try_again'), onClick: () => loadListings(false) }}
              />
            ) : listings.length === 0 ? (
              <EmptyState
                icon={<Search className="w-8 h-8" />}
                title={t('search.no_results_title')}
                description={t('search.no_results_description')}
                action={
                  activeFilterCount > 0
                    ? { label: t('search.clear_filters'), onClick: resetFilters }
                    : undefined
                }
              />
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm text-muted">
                    {t('search.results_count', { count: listings.length })}
                    {debouncedQuery && (
                      <> {t('search.results_for')} &quot;<span className="font-medium text-foreground">{debouncedQuery}</span>&quot;</>
                    )}
                  </p>
                  {/* Mobile sort */}
                  <Select
                    selectedKeys={[sortBy]}
                    onSelectionChange={(keys) => {
                      const selected = Array.from(keys)[0];
                      if (selected) setSortBy(String(selected));
                    }}
                    size="sm"
                    className="w-44 sm:hidden"
                    aria-label={t('common.sort_by')}
                  >
                    {SORT_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} id={opt.value}>{t(`sort.${opt.value}`)}</SelectItem>
                    ))}
                  </Select>
                </div>

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
                      {t('search.load_more')}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default MarketplaceSearchPage;
