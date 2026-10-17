// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MarketplaceCategoryPage — Browse listings within a specific category.
 *
 * Features:
 * - Category header with name, description, icon
 * - Breadcrumbs: Marketplace > Category Name
 * - Listing grid with filters (same as search, pre-filtered by category)
 * - Dynamic template fields in filter sidebar from category template endpoint
 * - Cursor-based pagination
 * - Uses shared MarketplaceListingGrid for listing display
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Checkbox, CheckboxGroup } from '@/components/ui/Checkbox';
import { Chip } from '@/components/ui/Chip';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/Input';
import { SearchField } from '@/components/ui/SearchField';
import { Select, SelectItem } from '@/components/ui/Select';
import { Separator } from '@/components/ui/Separator';
import { DynamicIcon, ICON_MAP } from '@/components/ui/DynamicIcon';
import { Spinner } from '@/components/ui/Spinner';
import SlidersHorizontal from 'lucide-react/icons/sliders-horizontal';
import ShoppingBag from 'lucide-react/icons/shopping-bag';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import Tag from 'lucide-react/icons/tag';
import RotateCcw from 'lucide-react/icons/rotate-ccw';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/feedback';
import { MarketplaceListingGrid, MarketplaceListingGridSkeleton } from '@/components/marketplace';
import type { MarketplaceListingItem } from '@/types/marketplace';
import { useAuth, useToast, useTenant } from '@/contexts';
import { api } from '@/lib/api';
import { logError } from '@/lib/logger';
import { useMediaQuery, usePageTitle } from '@/hooks';
import { PageMeta } from '@/components/seo/PageMeta';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface CategoryDetail {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  icon: string | null;
  listing_count: number;
  parent_id: number | null;
}

interface TemplateField {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select';
  options?: string[];
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

/** Listing types the browse endpoint accepts as a single `price_type` filter. */
const PRICE_TYPE_OPTIONS = [
  { value: 'fixed' },
  { value: 'negotiable' },
  { value: 'free' },
  { value: 'lend' },
] as const;

const SORT_OPTIONS = [
  { value: 'newest' },
  { value: 'price_asc' },
  { value: 'price_desc' },
  { value: 'popular' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function MarketplaceCategoryPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('marketplace');
  usePageTitle(t('page_title'));
  const { isAuthenticated } = useAuth();
  const { tenantPath } = useTenant();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  // Category state
  const [category, setCategory] = useState<CategoryDetail | null>(null);
  const [templateFields, setTemplateFields] = useState<TemplateField[]>([]);
  const [isCategoryLoading, setIsCategoryLoading] = useState(true);
  const [categoryError, setCategoryError] = useState<string | null>(null);

  // Filter state
  const [searchQuery, setSearchQuery] = useState(searchParams.get('q') || '');
  const [debouncedQuery, setDebouncedQuery] = useState(searchQuery);
  const [priceMin, setPriceMin] = useState(searchParams.get('price_min') || '');
  const [priceMax, setPriceMax] = useState(searchParams.get('price_max') || '');
  const [selectedConditions, setSelectedConditions] = useState<string[]>(
    searchParams.get('condition')?.split(',').filter(Boolean) || []
  );
  const [sortBy, setSortBy] = useState(searchParams.get('sort') || 'newest');
  // Listing type (`price_type`): for sale, negotiable, free (Freecycle) or borrow & lend.
  const [priceType, setPriceType] = useState(searchParams.get('price_type') || '');
  const [templateFilterValues, setTemplateFilterValues] = useState<Record<string, string>>({});
  const [showFilters, setShowFilters] = useState(false);
  const usesFilterSheet = useMediaQuery('(max-width: 1023px)');

  // Listings state
  const [listings, setListings] = useState<MarketplaceListingItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const cursorRef = useRef<string | null>(null);
  const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load category detail + template
  useEffect(() => {
    if (!slug) return;
    let cancelled = false;

    const load = async () => {
      setIsCategoryLoading(true);
      setCategoryError(null);

      try {
        // Load all categories and find by slug
        const response = await api.get<CategoryDetail[]>('/v2/marketplace/categories');
        if (cancelled) return;

        if (response.success && response.data) {
          const found = response.data.find((c) => c.slug === slug);
          if (found) {
            setCategory(found);

            // Load template fields for this category
            try {
              const templateResponse = await api.get<{ fields: TemplateField[] }>(
                `/v2/marketplace/categories/${found.id}/template`
              );
              if (!cancelled && templateResponse.success && templateResponse.data?.fields) {
                setTemplateFields(templateResponse.data.fields);
              }
            } catch {
              // No template fields -- that is fine
            }
          } else {
            setCategoryError(t('category.not_found_title'));
          }
        } else {
          setCategoryError(t('category.not_found_description'));
        }
      } catch (err) {
        if (!cancelled) {
          logError('Failed to load category', err);
          setCategoryError(t('category.not_found_description'));
        }
      } finally {
        if (!cancelled) setIsCategoryLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [slug, t])

  // Update page title
  useEffect(() => {
    if (category?.name) {
      document.title = `${category.name} - ${t('page_title')}`;
    }
  }, [category?.name, t])

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

  // Load listings
  const loadListings = useCallback(async (append = false) => {
    if (!category) return;

    try {
      if (!append) {
        setIsLoading(true);
      } else {
        setIsLoadingMore(true);
      }

      const params = new URLSearchParams();
      params.set('category_id', String(category.id));
      if (debouncedQuery) params.set('q', debouncedQuery);
      if (priceMin) params.set('price_min', priceMin);
      if (priceMax) params.set('price_max', priceMax);
      if (selectedConditions.length > 0) params.set('condition', selectedConditions.join(','));
      if (priceType) params.set('price_type', priceType);
      if (sortBy !== 'newest') params.set('sort', sortBy);
      params.set('limit', String(ITEMS_PER_PAGE));
      if (append && cursorRef.current) {
        params.set('cursor', cursorRef.current);
      }

      // Add template filter values
      Object.entries(templateFilterValues).forEach(([key, value]) => {
        if (value) params.set(`tf_${key}`, value);
      });

      const response = await api.get<MarketplaceListingItem[]>(`/v2/marketplace/listings?${params}`);
      if (response.success && response.data) {
        const mapped = response.data as MarketplaceListingItem[];
        if (append) {
          setListings((prev) => [...prev, ...mapped]);
        } else {
          setListings(mapped);
        }
        cursorRef.current = response.meta?.cursor ?? response.meta?.next_cursor ?? null;
        setHasMore(response.meta?.has_more ?? response.data.length >= ITEMS_PER_PAGE);
      } else if (!append) {
        setListings([]);
        setHasMore(false);
      }
    } catch (err) {
      logError('Failed to load category listings', err);
      if (!append) toast.error(t('hub.unable_to_load'));
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [category, debouncedQuery, priceMin, priceMax, selectedConditions, priceType, sortBy, templateFilterValues, toast, t])

  // Refetch on filter/category change
  useEffect(() => {
    if (!category) return;
    cursorRef.current = null;
    setHasMore(true);
    loadListings();
  }, [category, debouncedQuery, priceMin, priceMax, selectedConditions, priceType, sortBy, templateFilterValues]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (debouncedQuery) params.set('q', debouncedQuery);
    if (priceMin) params.set('price_min', priceMin);
    if (priceMax) params.set('price_max', priceMax);
    if (selectedConditions.length > 0) params.set('condition', selectedConditions.join(','));
    if (priceType) params.set('price_type', priceType);
    if (sortBy !== 'newest') params.set('sort', sortBy);
    setSearchParams(params, { replace: true });
  }, [debouncedQuery, priceMin, priceMax, selectedConditions, priceType, sortBy, setSearchParams]);

  // Active filter count
  const activeFilterCount = [
    priceMin,
    priceMax,
    selectedConditions.length > 0 ? 'yes' : '',
    priceType,
    ...Object.values(templateFilterValues).filter(Boolean),
  ].filter(Boolean).length;

  // Reset filters
  const resetFilters = () => {
    setPriceMin('');
    setPriceMax('');
    setSelectedConditions([]);
    setPriceType('');
    setSortBy('newest');
    setTemplateFilterValues({});
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

  // Category loading/error
  if (isCategoryLoading) {
    return (
      <div role="status" aria-busy="true" aria-label={t('loading', { ns: 'common' })} className="flex justify-center py-24">
        <Spinner size="lg" color="accent" />
      </div>
    );
  }

  if (categoryError || !category) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <EmptyState
          icon={<Tag className="w-8 h-8" />}
          title={t('category.not_found_title')}
          description={categoryError || t('category.not_found_description')}
          action={{ label: t('category.back_to_marketplace'), onClick: () => navigate(tenantPath('/marketplace')) }}
        />
      </div>
    );
  }

  // Filter sidebar content
  const filterContent = (
    <div className="space-y-5">
      {/* Price range */}
      <div>
        <label className="text-sm font-medium text-foreground mb-2 block">{t('category.price_range')}</label>
        <div className="flex gap-2 items-center">
          <Input
            size="sm"
            type="number"
            placeholder={t('category.price_min')}
            aria-label={t('category.price_min')}
            min={0}
            value={priceMin}
            onValueChange={setPriceMin}
          />
          <span className="text-muted">-</span>
          <Input
            size="sm"
            type="number"
            placeholder={t('category.price_max')}
            aria-label={t('category.price_max')}
            min={0}
            value={priceMax}
            onValueChange={setPriceMax}
          />
        </div>
      </div>

      {/* Condition */}
      <div>
        <label className="text-sm font-medium text-foreground mb-2 block">{t('category.condition_label')}</label>
        <CheckboxGroup
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

      {/* Listing type (price_type) */}
      <div>
        <Select
          label={t('filters.listing_type')}
          placeholder={t('filters.listing_type_any')}
          size="sm"
          selectedKeys={priceType ? [priceType] : []}
          onSelectionChange={(keys) => {
            const selected = Array.from(keys)[0];
            setPriceType(selected ? String(selected) : '');
          }}
        >
          {PRICE_TYPE_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} id={opt.value}>{t(`price_type.${opt.value}`)}</SelectItem>
          ))}
        </Select>
      </div>

      {/* Dynamic template fields */}
      {templateFields.length > 0 && (
        <div className="space-y-3">
          <Separator />
          <p className="text-sm font-medium text-muted">{t('category.category_details', { name: category.name })}</p>
          {templateFields.map((field) => {
            if (field.type === 'select' && field.options) {
              return (
                <Select
                  key={field.key}
                  label={field.label}
                  placeholder={t('category.any_field', { field: field.label })}
                  size="sm"
                  selectedKeys={templateFilterValues[field.key] ? [templateFilterValues[field.key]].filter(Boolean) as string[] : []}
                  onSelectionChange={(keys) => {
                    const selected = Array.from(keys)[0];
                    setTemplateFilterValues((prev) => ({
                      ...prev,
                      [field.key]: selected ? String(selected) : '',
                    }));
                  }}
                >
                  {field.options.map((opt) => (
                    <SelectItem key={opt} id={opt}>{opt}</SelectItem>
                  ))}
                </Select>
              );
            }
            return (
              <Input
                key={field.key}
                label={field.label}
                placeholder={t('category.filter_by_field', { field: field.label.toLowerCase() })}
                size="sm"
                type={field.type === 'number' ? 'number' : 'text'}
                value={templateFilterValues[field.key] || ''}
                onValueChange={(val) =>
                  setTemplateFilterValues((prev) => ({ ...prev, [field.key]: val }))
                }
              />
            );
          })}
        </div>
      )}

      {/* Reset */}
      {activeFilterCount > 0 && (
        <Button
          variant="danger-soft"

          fullWidth
          size="sm"
          startContent={<RotateCcw className="w-3.5 h-3.5" />}
          onPress={resetFilters}
        >
          {t('category.reset_filters', { count: activeFilterCount })}
        </Button>
      )}
    </div>
  );

  return (
    <>
      <PageMeta
        title={`${category.name} - ${t('page_title')}`}
        description={category.description || t('category.browse_description', { name: category.name })}
      />

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Breadcrumbs */}
        <Breadcrumbs
          showHome={false}
          items={[
            { label: t('category.marketplace'), href: '/marketplace' },
            { label: category.name },
          ]}
        />

        {/* Category header */}
        <GlassCard className="p-6">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
              {/* `icon` is a Lucide icon NAME (see MarketplaceCategorySeeder), never text to print. */}
              {category.icon && ICON_MAP[category.icon] ? (
                <DynamicIcon name={category.icon} className="w-7 h-7 text-accent" />
              ) : (
                <Tag className="w-7 h-7 text-accent" aria-hidden="true" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-2xl font-bold text-foreground">{category.name}</h1>
              {category.description && (
                <p className="text-sm text-muted mt-1">{category.description}</p>
              )}
              <p className="text-xs text-muted mt-1">
                {t('category.listings_count', { count: category.listing_count })}
              </p>
            </div>
          </div>
        </GlassCard>

        {/* Search + Sort */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <SearchField
            placeholder={t('category.search_placeholder', { name: category.name })}
            aria-label={t('category.search_placeholder', { name: category.name })}
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
          <Button
            variant="secondary"
            size="lg"
            className="w-full shrink-0 sm:w-auto lg:hidden"
            startContent={<SlidersHorizontal className="w-4 h-4" />}
            onPress={() => setShowFilters(!showFilters)}
          >
            {t('category.filters')}
            {activeFilterCount > 0 && (
              <Chip size="sm" color="accent" variant="primary" className="ml-1">
                {activeFilterCount}
              </Chip>
            )}
          </Button>
        </div>

        <BottomSheet
          isOpen={showFilters && usesFilterSheet}
          onClose={() => setShowFilters(false)}
          title={t('category.filters_title')}
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
                <SlidersHorizontal className="w-4 h-4 text-accent" />
                {t('category.filters_title')}
              </h3>
              {filterContent}
            </GlassCard>
          </aside>

          {/* Listings */}
          <div className="flex-1 min-w-0">
            {isLoading ? (
              <MarketplaceListingGridSkeleton />
            ) : listings.length === 0 ? (
              <EmptyState
                icon={<ShoppingBag className="w-8 h-8" />}
                title={t('category.no_listings_title')}
                description={
                  debouncedQuery || activeFilterCount > 0
                    ? t('category.no_listings_filtered')
                    : t('category.no_listings_empty', { name: category.name })
                }
                action={
                  activeFilterCount > 0
                    ? { label: t('category.clear_filters'), onClick: resetFilters }
                    : isAuthenticated
                      ? { label: t('category.sell_something'), onClick: () => navigate(tenantPath('/marketplace/sell')) }
                      : undefined
                }
              />
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm text-muted">
                    {t('category.results_count', { count: listings.length })}
                  </p>
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
                      {t('category.load_more')}
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

export default MarketplaceCategoryPage;
