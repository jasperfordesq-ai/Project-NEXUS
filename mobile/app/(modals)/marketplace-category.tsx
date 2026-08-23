// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Surface, TagGroup, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import MarketplaceListingCard from '@/components/marketplace/MarketplaceListingCard';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import {
  getMarketplaceCategories,
  getMarketplaceListings,
  marketplaceHasMore,
  marketplaceNextCursor,
  saveMarketplaceListing,
  unsaveMarketplaceListing,
  type MarketplaceCondition,
  type MarketplaceListingItem,
} from '@/lib/api/marketplace';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { contrastText, withAlpha } from '@/lib/utils/color';

const CONDITION_FILTERS: (MarketplaceCondition | '')[] = ['', 'new', 'like_new', 'good', 'fair', 'poor'];
const SORTS: ('newest' | 'price_asc' | 'price_desc' | 'popular')[] = ['newest', 'price_asc', 'price_desc', 'popular'];

export default function MarketplaceCategoryRoute() {
  return (
    <ModalErrorBoundary>
      <MarketplaceCategoryScreen />
    </ModalErrorBoundary>
  );
}

function MarketplaceCategoryScreen() {
  const { t } = useTranslation(['marketplace', 'common']);
  const { hasFeature } = useTenant();
  const params = useLocalSearchParams<{
    id?: string | string[];
    slug?: string | string[];
    name?: string | string[];
    q?: string | string[];
    price_min?: string | string[];
    price_max?: string | string[];
    condition?: string | string[];
    sort?: string | string[];
  }>();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const categoryId = Number(firstParam(params.id));
  const paramCategoryId = Number.isFinite(categoryId) && categoryId > 0 ? categoryId : 0;

  /**
   * 🔴 A deep link identifies a category by SLUG, not by number.
   *
   * The web route is `/marketplace/category/:slug`, and `+native-intent.ts` passes that
   * slug straight through — while this screen only ever read a numeric `id`. So every
   * deep link to a category rendered "Category not found. This category could not be
   * opened." Verified on a device on 2026-08-20 with `nexus://marketplace/category/
   * backwaren`, a category that exists.
   *
   * Resolving here rather than renaming the parameter, because the slug is the identifier
   * the outside world has: it is what appears in a shared web link, an email, a QR code.
   * The listings API needs a number, so the slug is looked up once against the category
   * list and then the screen behaves exactly as it does for an in-app tap.
   */
  const slugParam = (firstParam(params.slug) ?? '').trim();
  const [resolvedSlugId, setResolvedSlugId] = useState(0);
  // The deep link carries no display name, so take it from the category we resolved —
  // otherwise the header reads the generic "Category" for a link that knows exactly which.
  const [resolvedSlugName, setResolvedSlugName] = useState('');
  const [slugResolving, setSlugResolving] = useState(false);

  useEffect(() => {
    if (paramCategoryId || !slugParam) return;
    let cancelled = false;
    setSlugResolving(true);
    void (async () => {
      try {
        const response = await getMarketplaceCategories();
        const categories = Array.isArray(response?.data) ? response.data : [];
        const match = categories.find((category) => category.slug === slugParam);
        if (!cancelled) {
          setResolvedSlugId(match?.id ?? 0);
          setResolvedSlugName(match?.name ?? '');
        }
      } catch {
        if (!cancelled) setResolvedSlugId(0);
      } finally {
        if (!cancelled) setSlugResolving(false);
      }
    })();
    return () => { cancelled = true; };
  }, [paramCategoryId, slugParam]);

  const safeCategoryId = paramCategoryId || resolvedSlugId;
  const paramName = firstParam(params.name);
  const categoryName = paramName && paramName.trim()
    ? paramName
    : resolvedSlugName || t('category.title');
  const initialQuery = firstParam(params.q) ?? '';
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [priceMin, setPriceMin] = useState(firstParam(params.price_min) ?? '');
  const [priceMax, setPriceMax] = useState(firstParam(params.price_max) ?? '');
  const [conditions, setConditions] = useState<MarketplaceCondition[]>(parseConditions(firstParam(params.condition)));
  const [sort, setSort] = useState<'newest' | 'price_asc' | 'price_desc' | 'popular'>(normalizeSort(firstParam(params.sort)));
  const [listings, setListings] = useState<MarketplaceListingItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const fetchListings = useCallback(async (append = false) => {
    if (!hasFeature('marketplace') || !safeCategoryId) return;
    if (append) setIsLoadingMore(true);
    else setIsLoading(true);
    setError(null);

    try {
      const response = await getMarketplaceListings({
        q: debouncedQuery,
        category_id: safeCategoryId,
        price_min: priceMin,
        price_max: priceMax,
        condition: conditions.join(','),
        cursor: append ? cursor : null,
        limit: 20,
        sort,
      });
      setCursor(marketplaceNextCursor(response));
      setHasMore(marketplaceHasMore(response));
      setListings((current) => append ? [...current, ...response.data] : response.data);
    } catch (err) {
      if (!append) {
        setError(err instanceof Error ? err.message : t('category.unableToLoad'));
      } else {
        showToast({ title: t('common:errors.alertTitle'), description: t('category.loadMoreFailed'), variant: 'danger' });
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
      setIsLoadingMore(false);
    }
  }, [conditions, cursor, debouncedQuery, hasFeature, priceMax, priceMin, safeCategoryId, showToast, sort, t]);

  useEffect(() => {
    void fetchListings(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, conditions.join(','), priceMin, priceMax, safeCategoryId, sort]);

  const activeFilterCount = [
    priceMin,
    priceMax,
    conditions.length ? 'conditions' : '',
    sort !== 'newest' ? sort : '',
  ].filter(Boolean).length;

  function resetFilters() {
    setPriceMin('');
    setPriceMax('');
    setConditions([]);
    setSort('newest');
  }

  async function toggleSave(item: MarketplaceListingItem) {
    const nextSaved = !item.is_saved;
    setListings((current) => current.map((listing) => listing.id === item.id ? { ...listing, is_saved: nextSaved } : listing));
    try {
      if (nextSaved) await saveMarketplaceListing(item.id);
      else await unsaveMarketplaceListing(item.id);
    } catch {
      setListings((current) => current.map((listing) => listing.id === item.id ? item : listing));
      showToast({ title: t('common:errors.alertTitle'), description: t('common.save_failed'), variant: 'danger' });
    }
  }

  // Don't call it missing while the slug lookup is still running.
  if (hasFeature('marketplace') && !safeCategoryId && slugResolving) {
    return <LoadingSpinner />;
  }

  if (!hasFeature('marketplace') || !safeCategoryId) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('category.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
        <EmptyState icon="grid-outline" title={t('category.notFound')} subtitle={t('category.notFoundHint')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={categoryName} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />

      <FlatList
        data={listings}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 132 }}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => { setIsRefreshing(true); void fetchListings(false); }} />}
        ListHeaderComponent={
          <View>
            <HeroCard className="mb-3 overflow-hidden rounded-panel p-0">
              <View className="h-1.5" style={{ backgroundColor: primary }} />
              <HeroCard.Body className="gap-3 p-4">
                <View className="flex-row items-start gap-3">
                  <View className="size-13 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                    <Ionicons name="grid-outline" size={25} color={primary} />
                  </View>
                  <View className="min-w-0 flex-1 gap-1">
                    <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('category.eyebrow')}</Text>
                    <Text className="text-2xl font-bold" style={{ color: theme.text }}>{categoryName}</Text>
                    <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('category.subtitle')}</Text>
                  </View>
                </View>
              </HeroCard.Body>
            </HeroCard>

            <Surface variant="secondary" className="mb-3 rounded-panel px-3 py-3">
              <Input
                style={{ color: theme.text }}
                placeholder={t('search.placeholder')}
                placeholderTextColor={theme.textMuted}
                value={query}
                onChangeText={setQuery}
                returnKeyType="search"
                accessibilityLabel={t('search.placeholder')}
                leftIcon={<Ionicons name="search-outline" size={18} color={theme.textMuted} />}
                rightIcon={query.length > 0 ? (
                  <HeroButton isIconOnly size="sm" variant="ghost" accessibilityLabel={t('search.clear')} onPress={() => setQuery('')}>
                    <Ionicons name="close-circle" size={18} color={theme.textMuted} />
                  </HeroButton>
                ) : null}
              />
            </Surface>

            <View className="mb-3 flex-row gap-2">
              <FilterInput label={t('category.priceMin')} value={priceMin} onChangeText={setPriceMin} placeholder={t('category.minPlaceholder')} />
              <FilterInput label={t('category.priceMax')} value={priceMax} onChangeText={setPriceMax} placeholder={t('category.maxPlaceholder')} />
            </View>

            <TagGroup
              size="sm"
              selectionMode="multiple"
              selectedKeys={conditions.length === 0 ? ['all'] : conditions}
              onSelectionChange={(keys) => {
                const next = Array.from(keys);
                // The 'all' sentinel chip clears the multi-select; picking any
                // real condition drops 'all'.
                if (next.includes('all') && conditions.length > 0) {
                  setConditions([]);
                } else {
                  setConditions(next.filter((key) => key !== 'all') as MarketplaceCondition[]);
                }
              }}
              className="mb-3"
            >
              <TagGroup.List>
                {CONDITION_FILTERS.map((value) => {
                  const id = value || 'all';
                  const isSelected = value ? conditions.includes(value) : conditions.length === 0;
                  return (
                    <TagGroup.Item
                      key={id}
                      id={id}
                    >
                      <TagGroup.ItemLabel style={isSelected ? { color: contrastText(primary) } : undefined}>
                        {value ? t(`condition.${value}`) : t('category.allConditions')}
                      </TagGroup.ItemLabel>
                    </TagGroup.Item>
                  );
                })}
              </TagGroup.List>
            </TagGroup>

            <TagGroup
              size="sm"
              selectionMode="single"
              selectedKeys={[sort]}
              onSelectionChange={(keys) => {
                const next = Array.from(keys)[0];
                if (next !== undefined) setSort(next as typeof sort);
              }}
              className="mb-3"
            >
              <TagGroup.List>
                {SORTS.map((value) => {
                  const isSelected = sort === value;
                  return (
                    <TagGroup.Item
                      key={value}
                      id={value}
                    >
                      <TagGroup.ItemLabel style={isSelected ? { color: contrastText(primary) } : undefined}>
                        {t(`advancedSearch.sortOptions.${value}`)}
                      </TagGroup.ItemLabel>
                    </TagGroup.Item>
                  );
                })}
              </TagGroup.List>
            </TagGroup>

            {activeFilterCount > 0 ? (
              <HeroButton className="mb-3" variant="secondary" onPress={resetFilters}>
                <Ionicons name="refresh-outline" size={16} color={primary} />
                <HeroButton.Label>{t('category.reset', { count: activeFilterCount })}</HeroButton.Label>
              </HeroButton>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <MarketplaceListingCard
            item={item}
            onPress={() => router.push({ pathname: '/(modals)/marketplace-detail', params: { id: String(item.id) } } as unknown as Href)}
            onSavePress={() => void toggleSave(item)}
          />
        )}
        ListEmptyComponent={
          isLoading ? (
            <View className="py-16"><LoadingSpinner /></View>
          ) : (
            <EmptyState
              icon="grid-outline"
              title={error ?? t('category.emptyTitle')}
              subtitle={t('category.emptySubtitle')}
              actionLabel={error ? t('common:buttons.retry') : t('actions.browse')}
              onAction={error ? () => void fetchListings(false) : () => router.replace('/(modals)/marketplace' as Href)}
            />
          )
        }
        onEndReached={() => {
          if (hasMore && !isLoadingMore) void fetchListings(true);
        }}
        onEndReachedThreshold={0.35}
        ListFooterComponent={
          isLoadingMore ? (
            <View className="py-4"><LoadingSpinner /></View>
          ) : hasMore ? (
            <HeroButton variant="secondary" onPress={() => void fetchListings(true)}>
              <HeroButton.Label>{t('loadMore')}</HeroButton.Label>
            </HeroButton>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

function FilterInput({
  label,
  value,
  onChangeText,
  placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
}) {
  return (
    <View className="min-w-0 flex-1">
      <Input
        label={label}
        placeholder={placeholder}
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
      />
    </View>
  );
}

function firstParam(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseConditions(value?: string): MarketplaceCondition[] {
  if (!value) return [];
  const allowed = new Set<MarketplaceCondition>(CONDITION_FILTERS.filter(Boolean) as MarketplaceCondition[]);
  return value.split(',').filter((item): item is MarketplaceCondition => allowed.has(item as MarketplaceCondition));
}

function normalizeSort(value?: string): 'newest' | 'price_asc' | 'price_desc' | 'popular' {
  return value === 'price_asc' || value === 'price_desc' || value === 'popular' ? value : 'newest';
}
