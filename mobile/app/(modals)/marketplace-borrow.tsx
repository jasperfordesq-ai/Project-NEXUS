// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Card as HeroCard, Text } from 'heroui-native';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { useTranslation } from 'react-i18next';

import MarketplaceListingCard from '@/components/marketplace/MarketplaceListingCard';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import {
  getMarketplaceListings,
  marketplaceHasMore,
  marketplaceNextCursor,
  saveMarketplaceListing,
  unsaveMarketplaceListing,
  type MarketplaceListingItem,
} from '@/lib/api/marketplace';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { describeApiError } from '@/lib/api/describeApiError';
import AccentIcon from '@/components/ui/AccentIcon';
import { withRouteGate } from '@/components/withRouteGate';

/**
 * Borrow & lend: the `price_type: 'lend'` slice of the marketplace. A lend listing has no
 * price, cannot be bought or offered on, and is arranged by messaging the owner — so this
 * screen is a browse-and-message surface, the sibling of `marketplace-free`.
 */
function MarketplaceBorrowRoute() {
  return (
    <ModalErrorBoundary>
      <MarketplaceBorrowScreen />
    </ModalErrorBoundary>
  );
}

const LEND_LISTING_HREF = { pathname: '/(modals)/new-marketplace-listing', params: { price_type: 'lend' } } as unknown as Href;

function MarketplaceBorrowScreen() {
  const { t } = useTranslation(['marketplace', 'common']);
  const { hasFeature } = useTenant();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const [listings, setListings] = useState<MarketplaceListingItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchListings = useCallback(async (append = false) => {
    if (!hasFeature('marketplace')) return;
    if (append) setIsLoadingMore(true);
    else setIsLoading(true);
    setError(null);

    try {
      const response = await getMarketplaceListings({
        price_type: 'lend',
        cursor: append ? cursor : null,
        limit: 20,
        sort: 'newest',
      });
      setCursor(marketplaceNextCursor(response));
      setHasMore(marketplaceHasMore(response));
      setListings((current) => append ? [...current, ...response.data] : response.data);
    } catch (err) {
      if (!append) {
        setError(describeApiError(err, t('borrow.unableToLoad')));
      } else {
        showToast({ title: t('common:errors.alertTitle'), description: t('borrow.loadMoreFailed'), variant: 'danger' });
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
      setIsLoadingMore(false);
    }
  }, [cursor, hasFeature, showToast, t]);

  useEffect(() => {
    void fetchListings(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleSave(item: MarketplaceListingItem) {
    const nextSaved = !item.is_saved;
    setListings((current) => current.map((listing) => listing.id === item.id ? { ...listing, is_saved: nextSaved } : listing));
    try {
      if (nextSaved) await saveMarketplaceListing(item.id);
      else await unsaveMarketplaceListing(item.id);
    } catch (err) {
      setListings((current) => current.map((listing) => listing.id === item.id ? item : listing));
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('common.save_failed')), variant: 'danger' });
    }
  }

  if (!hasFeature('marketplace')) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('borrow.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
        <EmptyState icon="bag-handle-outline" title={t('featureGate.title')} subtitle={t('featureGate.description')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar
        title={t('borrow.title')}
        backLabel={t('common:back')}
        fallbackHref={'/(modals)/marketplace' as Href}
        rightAction={{
          accessibilityLabel: t('borrow.lendSomething'),
          icon: 'add-outline',
          onPress: () => router.push(LEND_LISTING_HREF),
        }}
      />

      <FlatList
        data={listings}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 132 }}
        refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => { setIsRefreshing(true); void fetchListings(false); }} />}
        ListHeaderComponent={
          <HeroCard className="mb-3 overflow-hidden rounded-panel p-0">
            <View className="h-1.5" style={{ backgroundColor: primary }} />
            <HeroCard.Body className="gap-3 p-4">
              <View className="flex-row items-start gap-3">
                <View className="size-13 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                  <Ionicons name="hammer-outline" size={25} color={primary} />
                </View>
                <View className="min-w-0 flex-1 gap-1">
                  <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('borrow.eyebrow')}</Text>
                  <Text className="text-2xl font-bold" style={{ color: theme.text }} accessibilityRole="header">{t('borrow.title')}</Text>
                  <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('borrow.subtitle')}</Text>
                </View>
              </View>
              <HeroButton variant="primary" onPress={() => router.push(LEND_LISTING_HREF)}>
                <AccentIcon name="add-outline" size={16} />
                <HeroButton.Label>{t('borrow.lendSomething')}</HeroButton.Label>
              </HeroButton>
            </HeroCard.Body>
          </HeroCard>
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
              icon="hammer-outline"
              title={error ?? t('borrow.emptyTitle')}
              subtitle={error ? undefined : t('borrow.emptySubtitle')}
              actionLabel={error ? t('common:buttons.retry') : t('borrow.lendSomething')}
              onAction={error ? () => void fetchListings(false) : () => router.push(LEND_LISTING_HREF)}
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

export default withRouteGate(MarketplaceBorrowRoute, 'marketplace-borrow');
