// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Surface, Text } from 'heroui-native';
import { Chip } from '@/components/ui/StatusChip';
import { useTranslation } from 'react-i18next';
import * as Haptics from '@/lib/haptics';

import MarketplaceListingCard from '@/components/marketplace/MarketplaceListingCard';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import {
  getFeaturedMarketplaceListings,
  getMarketplaceCategories,
  getMarketplaceListings,
  marketplaceHasMore,
  marketplaceNextCursor,
  saveMarketplaceListing,
  unsaveMarketplaceListing,
  type MarketplaceCategory,
  type MarketplaceListingItem,
  type MarketplacePriceType,
} from '@/lib/api/marketplace';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { describeApiError } from '@/lib/api/describeApiError';
import AccentIcon from '@/components/ui/AccentIcon';

const PRICE_FILTERS: (MarketplacePriceType | '')[] = ['', 'free', 'fixed', 'negotiable', 'contact'];

export default function MarketplaceRoute() {
  return (
    <ModalErrorBoundary>
      <MarketplaceScreen />
    </ModalErrorBoundary>
  );
}

function MarketplaceScreen() {
  const { t } = useTranslation(['marketplace', 'common']);
  const { hasFeature } = useTenant();
  const params = useLocalSearchParams<{
    q?: string | string[];
    category?: string | string[];
    category_id?: string | string[];
    price_type?: string | string[];
  }>();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const initialQuery = firstParam(params.q) ?? '';
  const initialCategory = Number(firstParam(params.category_id) ?? firstParam(params.category));
  const initialPriceType = normalizePriceType(firstParam(params.price_type));
  const [query, setQuery] = useState(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(initialQuery);
  const [selectedCategory, setSelectedCategory] = useState<number | undefined>(
    Number.isFinite(initialCategory) && initialCategory > 0 ? initialCategory : undefined,
  );
  const [priceType, setPriceType] = useState<MarketplacePriceType | ''>(initialPriceType);
  const [listings, setListings] = useState<MarketplaceListingItem[]>([]);
  const [featured, setFeatured] = useState<MarketplaceListingItem[]>([]);
  const [categories, setCategories] = useState<MarketplaceCategory[]>([]);
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
    Promise.all([
      getMarketplaceCategories().then((response) => response.data).catch(() => []),
      getFeaturedMarketplaceListings().then((response) => response.data).catch(() => []),
    ]).then(([categoryData, featuredData]) => {
      if (!mounted) return;
      setCategories(categoryData);
      setFeatured(featuredData);
    });
    return () => {
      mounted = false;
    };
  }, [hasFeature]);

  const fetchListings = useCallback(async (append = false) => {
    if (!hasFeature('marketplace')) return;
    if (append) setIsLoadingMore(true);
    else setIsLoading(true);
    setError(null);

    try {
      const response = await getMarketplaceListings({
        q: debouncedQuery,
        category_id: selectedCategory,
        price_type: priceType,
        cursor: append ? cursor : null,
        limit: 20,
        sort: 'newest',
      });
      setCursor(marketplaceNextCursor(response));
      setHasMore(marketplaceHasMore(response));
      setListings((current) => append ? [...current, ...response.data] : response.data);
    } catch (err) {
      if (!append) {
        setError(err instanceof Error ? err.message : t('hub.unable_to_load'));
      } else {
        showToast({ title: t('common:errors.alertTitle'), description: t('hub.load_more_failed'), variant: 'danger' });
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
      setIsLoadingMore(false);
    }
  }, [cursor, debouncedQuery, hasFeature, priceType, selectedCategory, showToast, t]);

  useEffect(() => {
    void fetchListings(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, selectedCategory, priceType]);

  const categoryLabel = useMemo(() => {
    if (!selectedCategory) return t('filters.allCategories');
    return categories.find((category) => category.id === selectedCategory)?.name ?? t('filters.allCategories');
  }, [categories, selectedCategory, t]);
  const shouldShowFeatured = featured.length > 0 && !debouncedQuery && !selectedCategory && !priceType;

  if (!hasFeature('marketplace')) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('title')} backLabel={t('common:back')} fallbackHref="/(tabs)/profile" />
        <EmptyState
          icon="bag-handle-outline"
          title={t('featureGate.title')}
          subtitle={t('featureGate.description')}
        />
      </SafeAreaView>
    );
  }

  async function toggleSave(item: MarketplaceListingItem) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const nextSaved = !item.is_saved;
    const update = (list: MarketplaceListingItem[]) =>
      list.map((listing) => listing.id === item.id ? { ...listing, is_saved: nextSaved } : listing);
    setListings(update);
    setFeatured(update);
    try {
      if (nextSaved) await saveMarketplaceListing(item.id);
      else await unsaveMarketplaceListing(item.id);
    } catch (err) {
      setListings((list) => list.map((listing) => listing.id === item.id ? item : listing));
      setFeatured((list) => list.map((listing) => listing.id === item.id ? item : listing));
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('common.save_failed')), variant: 'danger' });
    }
  }

  function openDetail(item: MarketplaceListingItem) {
    router.push({ pathname: '/(modals)/marketplace-detail', params: { id: String(item.id) } } as unknown as Href);
  }

  function refresh() {
    setIsRefreshing(true);
    void fetchListings(false);
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar
        title={t('title')}
        backLabel={t('common:back')}
        fallbackHref="/(tabs)/profile"
        rightAction={{
          accessibilityLabel: t('actions.sell'),
          icon: 'add-outline',
          onPress: () => router.push('/(modals)/new-marketplace-listing' as Href),
        }}
      />

      <FlatList
        data={listings}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 132 }}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={refresh} />}
        ListHeaderComponent={
          <View>
            <HeroCard className="mb-3 overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: theme.borderSubtle }}>
              <View className="h-1.5" style={{ backgroundColor: primary }} />
              <HeroCard.Body className="gap-3 p-4">
                <View className="flex-row items-start gap-3">
                  <View
                    className="h-12 w-12 items-center justify-center rounded-3xl"
                    style={{ backgroundColor: withAlpha(primary, 0.14), borderWidth: 1, borderColor: withAlpha(primary, 0.2) }}
                  >
                    <Ionicons name="bag-handle-outline" size={23} color={primary} />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>
                      {t('eyebrow')}
                    </Text>
                    <Text className="text-xl font-bold leading-7" style={{ color: theme.text }} numberOfLines={1}>
                      {t('title')}
                    </Text>
                    <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>
                      {t('subtitle')}
                    </Text>
                  </View>
                </View>

                <View className="flex-row gap-2">
                  <HeroButton className="flex-1" variant="primary" onPress={() => router.push('/(modals)/new-marketplace-listing' as Href)}>
                    <AccentIcon name="add-outline" size={16} />
                    <HeroButton.Label>{t('actions.sell')}</HeroButton.Label>
                  </HeroButton>
                  <HeroButton className="flex-1" variant="secondary" onPress={() => router.push('/(modals)/marketplace-my-listings' as Href)}>
                    <Ionicons name="albums-outline" size={16} color={primary} />
                    <HeroButton.Label>{t('actions.myListings')}</HeroButton.Label>
                  </HeroButton>
                </View>

                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 2 }}>
                  <ShortcutButton label={t('actions.orders')} icon="receipt-outline" color={primary} onPress={() => router.push('/(modals)/marketplace-orders' as Href)} />
                  <ShortcutButton label={t('actions.pickups')} icon="qr-code-outline" color={primary} onPress={() => router.push('/(modals)/marketplace-pickups' as Href)} />
                  <ShortcutButton label={t('actions.tools')} icon="construct-outline" color={primary} onPress={() => router.push('/(modals)/marketplace-tools' as Href)} />
                  <ShortcutButton label={t('actions.freeItems')} icon="gift-outline" color={theme.success} onPress={() => router.push('/(modals)/marketplace-free' as Href)} />
                  <ShortcutButton label={t('actions.collections')} icon="folder-open-outline" color={primary} onPress={() => router.push('/(modals)/marketplace-collections' as Href)} />
                  <ShortcutButton label={t('actions.search')} icon="options-outline" color={primary} onPress={() => router.push('/(modals)/marketplace-search' as Href)} />
                  {hasFeature('merchant_coupons') ? (
                    <ShortcutButton label={t('actions.coupons')} icon="ticket-outline" color={primary} onPress={() => router.push('/(modals)/marketplace-coupons' as Href)} />
                  ) : null}
                  <ShortcutButton label={t('actions.nearby')} icon="map-outline" color={primary} onPress={() => router.push('/(modals)/marketplace-map' as Href)} />
                </ScrollView>
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

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
              <HeroButton
                size="sm"
                variant={selectedCategory ? 'secondary' : 'primary'}
                onPress={() => setSelectedCategory(undefined)}
              >
                <HeroButton.Label>{t('filters.allCategories')}</HeroButton.Label>
              </HeroButton>
              {categories.map((category) => (
                <HeroButton
                  key={category.id}
                  size="sm"
                  variant={selectedCategory === category.id ? 'primary' : 'secondary'}
                  onPress={() => setSelectedCategory(category.id)}
                >
                  <HeroButton.Label>{category.name}</HeroButton.Label>
                </HeroButton>
              ))}
            </ScrollView>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 12 }}>
              {PRICE_FILTERS.map((value) => (
                <HeroButton
                  key={value || 'all'}
                  size="sm"
                  variant={priceType === value ? 'primary' : 'secondary'}
                  onPress={() => setPriceType(value)}
                >
                  <HeroButton.Label>{t(`filters.priceType.${value || 'all'}`)}</HeroButton.Label>
                </HeroButton>
              ))}
            </ScrollView>

            {shouldShowFeatured ? (
              <HeroCard className="mb-3 overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: theme.borderSubtle }}>
                <HeroCard.Body className="gap-3 p-3">
                  <View className="flex-row items-center justify-between">
                    <View className="min-w-0 flex-1 flex-row items-center gap-2">
                      <Ionicons name="star-outline" size={17} color={theme.warning} />
                      <Text className="text-base font-bold" style={{ color: theme.text }} numberOfLines={1}>{t('featured.title')}</Text>
                    </View>
                    <Chip size="sm" variant="secondary">
                      <Chip.Label>{t('featured.count', { count: featured.length })}</Chip.Label>
                    </Chip>
                  </View>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10 }}>
                    {featured.slice(0, 8).map((item) => (
                      <HeroButton key={item.id} variant="secondary" className="max-w-48" onPress={() => openDetail(item)}>
                        <HeroButton.Label>{item.title}</HeroButton.Label>
                      </HeroButton>
                    ))}
                  </ScrollView>
                </HeroCard.Body>
              </HeroCard>
            ) : null}

            <View className="mb-2 flex-row items-center justify-between">
              <Text className="min-w-0 flex-1 text-sm font-bold" style={{ color: theme.text }} numberOfLines={1}>
                {categoryLabel}
              </Text>
              <HeroButton size="sm" variant="secondary" onPress={() => router.push('/(modals)/marketplace-offers' as Href)}>
                <Ionicons name="hand-left-outline" size={14} color={primary} />
                <HeroButton.Label>{t('actions.offers')}</HeroButton.Label>
              </HeroButton>
            </View>
          </View>
        }
        renderItem={({ item }) => (
          <MarketplaceListingCard item={item} onPress={() => openDetail(item)} onSavePress={() => void toggleSave(item)} />
        )}
        ListEmptyComponent={
          isLoading ? (
            <View className="py-16">
              <LoadingSpinner />
            </View>
          ) : (
            <EmptyState
              icon="bag-handle-outline"
              title={error ?? t('empty.title')}
              subtitle={t('empty.subtitle')}
              actionLabel={error ? t('common:buttons.retry') : t('actions.sell')}
              onAction={error ? () => void fetchListings(false) : () => router.push('/(modals)/new-marketplace-listing' as Href)}
            />
          )
        }
        onEndReached={() => {
          if (hasMore && !isLoadingMore) void fetchListings(true);
        }}
        onEndReachedThreshold={0.35}
        ListFooterComponent={
          isLoadingMore ? (
            <View className="py-4">
              <LoadingSpinner />
            </View>
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

function firstParam(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizePriceType(value?: string): MarketplacePriceType | '' {
  return value === 'fixed' || value === 'negotiable' || value === 'free' || value === 'auction' || value === 'contact'
    ? value
    : '';
}

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function ShortcutButton({
  label,
  icon,
  color,
  onPress,
}: {
  label: string;
  icon: IoniconName;
  color: string;
  onPress: () => void;
}) {
  return (
    <HeroButton
      size="sm"
      variant="secondary"
      className="min-w-[112px]"
      accessibilityLabel={label}
      onPress={onPress}
    >
      <Ionicons name={icon} size={15} color={color} />
      <HeroButton.Label>{label}</HeroButton.Label>
    </HeroButton>
  );
}
