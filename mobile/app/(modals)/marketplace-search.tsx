// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button as HeroButton, Card as HeroCard, Chip, Surface, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import MarketplaceListingCard from '@/components/marketplace/MarketplaceListingCard';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import {
  getMarketplaceCategories,
  getMarketplaceListings,
  marketplaceHasMore,
  marketplaceNextCursor,
  saveMarketplaceListing,
  unsaveMarketplaceListing,
  type MarketplaceCategory,
  type MarketplaceCondition,
  type MarketplaceDeliveryMethod,
  type MarketplaceListingItem,
} from '@/lib/api/marketplace';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';

const CONDITIONS: MarketplaceCondition[] = ['new', 'like_new', 'good', 'fair', 'poor'];
const DELIVERY_METHODS: (MarketplaceDeliveryMethod | '')[] = ['', 'pickup', 'shipping', 'both', 'community_delivery'];
const SELLER_TYPES: ('private' | 'business' | '')[] = ['', 'private', 'business'];
const SORTS: ('newest' | 'price_asc' | 'price_desc' | 'popular')[] = ['newest', 'price_asc', 'price_desc', 'popular'];
const POSTED_WITHIN = ['', '1', '3', '7', '30'];

export default function MarketplaceSearchRoute() {
  return (
    <ModalErrorBoundary>
      <MarketplaceSearchScreen />
    </ModalErrorBoundary>
  );
}

function MarketplaceSearchScreen() {
  const { t } = useTranslation(['marketplace', 'common']);
  const { hasFeature } = useTenant();
  const params = useLocalSearchParams<{
    q?: string | string[];
    category_id?: string | string[];
    price_min?: string | string[];
    price_max?: string | string[];
    condition?: string | string[];
    seller_type?: string | string[];
    delivery_method?: string | string[];
    sort?: string | string[];
    posted_within?: string | string[];
  }>();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const initialQuery = firstParam(params.q) ?? '';
  const initialCategoryId = Number(firstParam(params.category_id));
  const initialSellerType = normalizeSellerType(firstParam(params.seller_type));
  const initialDeliveryMethod = normalizeDeliveryMethod(firstParam(params.delivery_method));
  const initialSort = normalizeSort(firstParam(params.sort));
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [categoryId, setCategoryId] = useState(Number.isFinite(initialCategoryId) && initialCategoryId > 0 ? initialCategoryId : undefined);
  const [priceMin, setPriceMin] = useState(firstParam(params.price_min) ?? '');
  const [priceMax, setPriceMax] = useState(firstParam(params.price_max) ?? '');
  const [conditions, setConditions] = useState<MarketplaceCondition[]>(parseConditions(firstParam(params.condition)));
  const [sellerType, setSellerType] = useState<'private' | 'business' | ''>(initialSellerType);
  const [deliveryMethod, setDeliveryMethod] = useState<MarketplaceDeliveryMethod | ''>(initialDeliveryMethod);
  const [sort, setSort] = useState<'newest' | 'price_asc' | 'price_desc' | 'popular'>(initialSort);
  const [postedWithin, setPostedWithin] = useState(firstParam(params.posted_within) ?? '');
  const [categories, setCategories] = useState<MarketplaceCategory[]>([]);
  const [items, setItems] = useState<MarketplaceListingItem[]>([]);
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

  useEffect(() => {
    if (!hasFeature('marketplace')) return;
    let mounted = true;
    getMarketplaceCategories().then((response) => {
      if (mounted) setCategories(response.data);
    }).catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [hasFeature]);

  const activeFilterCount = useMemo(() => [
    categoryId,
    priceMin,
    priceMax,
    conditions.length ? 'conditions' : '',
    sellerType,
    deliveryMethod,
    postedWithin,
    sort !== 'newest' ? sort : '',
  ].filter(Boolean).length, [categoryId, conditions.length, deliveryMethod, postedWithin, priceMax, priceMin, sellerType, sort]);

  const fetchListings = useCallback(async (append = false) => {
    if (!hasFeature('marketplace')) return;
    if (append) setIsLoadingMore(true);
    else setIsLoading(true);
    setError(null);

    try {
      const response = await getMarketplaceListings({
        q: debouncedQuery,
        category_id: categoryId,
        price_min: priceMin,
        price_max: priceMax,
        condition: conditions.join(','),
        seller_type: sellerType,
        delivery_method: deliveryMethod,
        sort,
        posted_within: postedWithin,
        cursor: append ? cursor : null,
        limit: 24,
      });
      setCursor(marketplaceNextCursor(response));
      setHasMore(marketplaceHasMore(response));
      setItems((current) => append ? [...current, ...response.data] : response.data);
    } catch (err) {
      if (!append) {
        setError(err instanceof Error ? err.message : t('advancedSearch.loadFailed'));
      } else {
        showToast({ title: t('common:errors.alertTitle'), description: t('advancedSearch.loadMoreFailed'), variant: 'danger' });
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
      setIsLoadingMore(false);
    }
  }, [categoryId, conditions, cursor, debouncedQuery, deliveryMethod, hasFeature, postedWithin, priceMax, priceMin, sellerType, showToast, sort, t]);

  useEffect(() => {
    void fetchListings(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, categoryId, priceMin, priceMax, conditions.join(','), sellerType, deliveryMethod, sort, postedWithin]);

  function resetFilters() {
    setCategoryId(undefined);
    setPriceMin('');
    setPriceMax('');
    setConditions([]);
    setSellerType('');
    setDeliveryMethod('');
    setSort('newest');
    setPostedWithin('');
  }

  function toggleCondition(condition: MarketplaceCondition) {
    setConditions((current) => current.includes(condition) ? current.filter((item) => item !== condition) : [...current, condition]);
  }

  async function toggleSave(item: MarketplaceListingItem) {
    const nextSaved = !item.is_saved;
    setItems((current) => current.map((listing) => listing.id === item.id ? { ...listing, is_saved: nextSaved } : listing));
    try {
      if (nextSaved) await saveMarketplaceListing(item.id);
      else await unsaveMarketplaceListing(item.id);
    } catch {
      setItems((current) => current.map((listing) => listing.id === item.id ? item : listing));
      showToast({ title: t('common:errors.alertTitle'), description: t('common.save_failed'), variant: 'danger' });
    }
  }

  if (!hasFeature('marketplace')) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('advancedSearch.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
        <EmptyState icon="search-outline" title={t('featureGate.title')} subtitle={t('featureGate.description')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('advancedSearch.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ gap: 12, paddingHorizontal: 16, paddingBottom: 132 }}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => { setIsRefreshing(true); void fetchListings(false); }} />}
        ListHeaderComponent={
          <View>
            <HeroCard className="overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: theme.border }}>
              <View className="h-1.5" style={{ backgroundColor: primary }} />
              <HeroCard.Body className="gap-3 p-4">
                <View className="flex-row items-start gap-3">
                  <View
                    className="h-12 w-12 items-center justify-center rounded-3xl"
                    style={{ backgroundColor: withAlpha(primary, 0.14), borderWidth: 1, borderColor: withAlpha(primary, 0.2) }}
                  >
                    <Ionicons name="options-outline" size={23} color={primary} />
                  </View>
                  <View className="min-w-0 flex-1 gap-1">
                    <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>{t('advancedSearch.eyebrow')}</Text>
                    <Text className="text-xl font-bold leading-7" style={{ color: theme.text }} numberOfLines={1}>{t('advancedSearch.title')}</Text>
                    <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>{t('advancedSearch.subtitle')}</Text>
                  </View>
                </View>

                <Surface variant="secondary" className="rounded-panel-inner p-3" style={{ borderWidth: 1, borderColor: theme.border }}>
                  <Input
                    containerClassName="mb-0 w-full"
                    inputClassName="min-h-12 w-full text-sm"
                    style={{ color: theme.text }}
                    placeholder={t('advancedSearch.placeholder')}
                    placeholderTextColor={theme.textMuted}
                    value={query}
                    onChangeText={setQuery}
                    returnKeyType="search"
                    accessibilityLabel={t('advancedSearch.placeholder')}
                    leftIcon={<Ionicons name="search-outline" size={18} color={theme.textMuted} />}
                    rightIcon={query.length > 0 ? (
                      <HeroButton isIconOnly size="sm" variant="ghost" accessibilityLabel={t('search.clear')} onPress={() => setQuery('')}>
                        <Ionicons name="close-circle" size={18} color={theme.textMuted} />
                      </HeroButton>
                    ) : null}
                  />
                </Surface>

                <View className="flex-row gap-2">
                  <FilterInput label={t('advancedSearch.priceMin')} value={priceMin} onChangeText={setPriceMin} placeholder={t('advancedSearch.minPlaceholder')} />
                  <FilterInput label={t('advancedSearch.priceMax')} value={priceMax} onChangeText={setPriceMax} placeholder={t('advancedSearch.maxPlaceholder')} />
                </View>

                <FilterStrip label={t('advancedSearch.category')}>
                  <FilterButton active={!categoryId} label={t('filters.allCategories')} onPress={() => setCategoryId(undefined)} />
                  {categories.map((category) => (
                    <FilterButton key={category.id} active={categoryId === category.id} label={category.name} onPress={() => setCategoryId(category.id)} />
                  ))}
                </FilterStrip>

                <FilterStrip label={t('advancedSearch.condition')}>
                  {CONDITIONS.map((condition) => (
                    <FilterButton key={condition} active={conditions.includes(condition)} label={t(`condition.${condition}`)} onPress={() => toggleCondition(condition)} />
                  ))}
                </FilterStrip>

                <FilterStrip label={t('advancedSearch.sellerType')}>
                  {SELLER_TYPES.map((value) => (
                    <FilterButton key={value || 'all'} active={sellerType === value} label={value ? t(`sellerType.${value}`) : t('advancedSearch.allSellers')} onPress={() => setSellerType(value)} />
                  ))}
                </FilterStrip>

                <FilterStrip label={t('advancedSearch.delivery')}>
                  {DELIVERY_METHODS.map((value) => (
                    <FilterButton key={value || 'all'} active={deliveryMethod === value} label={value ? t(`delivery_method.${value}`) : t('advancedSearch.anyDelivery')} onPress={() => setDeliveryMethod(value)} />
                  ))}
                </FilterStrip>

                <FilterStrip label={t('advancedSearch.sort')}>
                  {SORTS.map((value) => (
                    <FilterButton key={value} active={sort === value} label={t(`advancedSearch.sortOptions.${value}`)} onPress={() => setSort(value)} />
                  ))}
                </FilterStrip>

                <FilterStrip label={t('advancedSearch.postedWithin')}>
                  {POSTED_WITHIN.map((value) => (
                    <FilterButton key={value || 'all'} active={postedWithin === value} label={value ? t('advancedSearch.days', { count: Number(value) }) : t('advancedSearch.anyTime')} onPress={() => setPostedWithin(value)} />
                  ))}
                </FilterStrip>

                {activeFilterCount > 0 ? (
                  <HeroButton className="self-start" variant="secondary" onPress={resetFilters}>
                    <Ionicons name="refresh-outline" size={16} color={primary} />
                    <HeroButton.Label>{t('advancedSearch.reset', { count: activeFilterCount })}</HeroButton.Label>
                  </HeroButton>
                ) : null}
              </HeroCard.Body>
            </HeroCard>
            <View className="flex-row items-center justify-between gap-3">
              <Text className="min-w-0 flex-1 text-sm font-bold" style={{ color: theme.text }} numberOfLines={1}>{t('advancedSearch.results', { count: items.length })}</Text>
              {debouncedQuery ? (
                <Chip size="sm" variant="secondary">
                  <Chip.Label numberOfLines={1}>{debouncedQuery}</Chip.Label>
                </Chip>
              ) : null}
            </View>
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
              icon="search-outline"
              title={error ?? t('advancedSearch.emptyTitle')}
              subtitle={t('advancedSearch.emptySubtitle')}
              actionLabel={error ? t('common:buttons.retry') : activeFilterCount ? t('advancedSearch.clearFilters') : t('actions.sell')}
              onAction={error ? () => void fetchListings(false) : activeFilterCount ? resetFilters : () => router.push('/(modals)/new-marketplace-listing' as Href)}
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
        containerClassName="mb-0 w-full"
        inputClassName="min-h-12 w-full text-sm"
        label={label}
        placeholder={placeholder}
        value={value}
        onChangeText={onChangeText}
        keyboardType="decimal-pad"
      />
    </View>
  );
}

function FilterStrip({ label, children }: { label: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View className="gap-2">
      <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>{label}</Text>
      <View className="flex-row flex-wrap gap-2">
        {children}
      </View>
    </View>
  );
}

function FilterButton({ active, label, onPress }: { active: boolean; label: string; onPress: () => void }) {
  const primary = usePrimaryColor();
  return (
    <HeroButton className="max-w-full" size="sm" variant={active ? 'primary' : 'secondary'} onPress={onPress}>
      <HeroButton.Label numberOfLines={1}>{label}</HeroButton.Label>
    </HeroButton>
  );
}

function firstParam(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function parseConditions(value?: string): MarketplaceCondition[] {
  if (!value) return [];
  const allowed = new Set<MarketplaceCondition>(CONDITIONS);
  return value.split(',').filter((item): item is MarketplaceCondition => allowed.has(item as MarketplaceCondition));
}

function normalizeSellerType(value?: string): 'private' | 'business' | '' {
  return value === 'private' || value === 'business' ? value : '';
}

function normalizeDeliveryMethod(value?: string): MarketplaceDeliveryMethod | '' {
  return value === 'pickup' || value === 'shipping' || value === 'both' || value === 'community_delivery' ? value : '';
}

function normalizeSort(value?: string): 'newest' | 'price_asc' | 'price_desc' | 'popular' {
  return value === 'price_asc' || value === 'price_desc' || value === 'popular' ? value : 'newest';
}
