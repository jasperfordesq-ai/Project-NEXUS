// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useState } from 'react';
import { FlatList, RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Chip, Surface, TagGroup, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import MarketplaceListingCard from '@/components/marketplace/MarketplaceListingCard';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import {
  deleteMarketplaceListing,
  getMarketplaceDashboard,
  getMerchantOnboardingStatus,
  getMyMarketplaceListings,
  marketplaceHasMore,
  marketplaceNextCursor,
  renewMarketplaceListing,
  type MarketplaceDashboard,
  type MarketplaceListingItem,
} from '@/lib/api/marketplace';
import { useApi } from '@/lib/hooks/useApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePaginatedApi } from '@/lib/hooks/usePaginatedApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { storage } from '@/lib/storage';
import { contrastText, withAlpha } from '@/lib/utils/color';
import AccentIcon from '@/components/ui/AccentIcon';

type ListingTab = 'active' | 'draft' | 'sold' | 'expired';

const LISTING_TABS: ListingTab[] = ['active', 'draft', 'sold', 'expired'];
const ONBOARDING_DISMISS_KEY = 'nx_merchant_onboarding_dismissed';

export default function MarketplaceMyListingsRoute() {
  return (
    <ModalErrorBoundary>
      <MarketplaceMyListingsScreen />
    </ModalErrorBoundary>
  );
}

function MarketplaceMyListingsScreen() {
  const { t } = useTranslation(['marketplace', 'common', 'auth']);
  const primary = usePrimaryColor();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<ListingTab>('active');
  const [onboardingDismissed, setOnboardingDismissed] = useState(true);
  const canLoadSellerData = isAuthenticated && Boolean(user?.id);
  const dashboard = useApi(() => getMarketplaceDashboard(), [], { enabled: canLoadSellerData });
  const onboarding = useApi(() => getMerchantOnboardingStatus(), [], { enabled: canLoadSellerData });
  const list = usePaginatedApi<MarketplaceListingItem, Awaited<ReturnType<typeof getMyMarketplaceListings>>>(
    (cursor) => getMyMarketplaceListings(cursor, user?.id, activeTab),
    (response) => ({
      items: response.data,
      cursor: marketplaceNextCursor(response),
      hasMore: marketplaceHasMore(response),
    }),
    [user?.id, activeTab],
    { enabled: canLoadSellerData },
  );

  const stats = dashboard.data?.data ?? {};
  const showOnboardingNudge = !onboardingDismissed && onboarding.data?.data && !onboarding.data.data.onboarding_completed;

  useEffect(() => {
    let mounted = true;
    storage.get(ONBOARDING_DISMISS_KEY).then((value) => {
      if (mounted) setOnboardingDismissed(value === '1');
    });
    return () => {
      mounted = false;
    };
  }, []);

  function dismissOnboardingNudge() {
    setOnboardingDismissed(true);
    void storage.set(ONBOARDING_DISMISS_KEY, '1');
  }

  function removeListing(item: MarketplaceListingItem) {
    confirm({
      title: t('owner.deleteTitle'),
      message: t('owner.deleteMessage'),
      confirmLabel: t('common:buttons.delete'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        try {
          await deleteMarketplaceListing(item.id);
          list.refresh();
        } catch (err) {
          showToast({
            title: t('common:errors.alertTitle'),
            description: err instanceof Error ? err.message : t('owner.deleteFailed'),
            variant: 'danger',
          });
        }
      },
    });
  }

  async function renew(item: MarketplaceListingItem) {
    try {
      await renewMarketplaceListing(item.id);
      list.refresh();
    } catch (err) {
      showToast({
        title: t('common:errors.alertTitle'),
        description: err instanceof Error ? err.message : t('owner.renewFailed'),
        variant: 'danger',
      });
    }
  }

  if (isAuthLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('myListings.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
        <View className="py-16">
          <LoadingSpinner />
        </View>
      </SafeAreaView>
    );
  }

  if (!isAuthenticated) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('myListings.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
        <EmptyState
          icon="storefront-outline"
          title={t('myListings.signInTitle')}
          subtitle={t('myListings.signInHint')}
          actionLabel={t('auth:login.submit')}
          onAction={() => router.push('/(auth)/login' as Href)}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar
        title={t('myListings.title')}
        backLabel={t('common:back')}
        fallbackHref={'/(modals)/marketplace' as Href}
        rightAction={{
          accessibilityLabel: t('actions.sell'),
          icon: 'add-outline',
          onPress: () => router.push('/(modals)/new-marketplace-listing' as Href),
        }}
      />
      <FlatList
        data={list.items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 132 }}
        refreshControl={<RefreshControl refreshing={list.isLoading && list.items.length > 0} onRefresh={list.refresh} />}
        ListHeaderComponent={
          <>
            <DashboardCard stats={stats} primary={primary} activeTab={activeTab} onTabChange={setActiveTab} />
            {showOnboardingNudge ? <OnboardingNudge primary={primary} onDismiss={dismissOnboardingNudge} /> : null}
          </>
        }
        renderItem={({ item }) => (
          <View>
            <MarketplaceListingCard item={item} onPress={() => router.push({ pathname: '/(modals)/marketplace-detail', params: { id: String(item.id) } } as unknown as Href)} />
            <Surface variant="secondary" className="-mt-1 mb-3 rounded-panel-inner px-2.5 py-2">
              <View className="flex-row gap-2">
                <HeroButton className="flex-1" size="sm" variant="secondary" onPress={() => router.push({ pathname: '/(modals)/edit-marketplace-listing', params: { id: String(item.id) } } as unknown as Href)}>
                  <Ionicons name="create-outline" size={14} color={primary} />
                  <HeroButton.Label>{t('owner.edit')}</HeroButton.Label>
                </HeroButton>
                {activeTab === 'expired' ? (
                  <HeroButton className="flex-1" size="sm" variant="secondary" onPress={() => void renew(item)}>
                    <Ionicons name="refresh-outline" size={14} color={primary} />
                    <HeroButton.Label>{t('owner.renew')}</HeroButton.Label>
                  </HeroButton>
                ) : null}
                <HeroButton className="flex-1" size="sm" variant="danger" onPress={() => removeListing(item)}>
                  <Ionicons name="trash-outline" size={14} color="#fff" />
                  <HeroButton.Label>{t('owner.delete')}</HeroButton.Label>
                </HeroButton>
              </View>
            </Surface>
          </View>
        )}
        ListEmptyComponent={
          list.isLoading ? (
            <View className="py-16">
              <LoadingSpinner />
            </View>
          ) : (
            <EmptyState
              icon="albums-outline"
              title={list.error ?? t(`myListings.emptyState.${activeTab}.title`)}
              subtitle={t(`myListings.emptyState.${activeTab}.subtitle`)}
              actionLabel={activeTab === 'active' || activeTab === 'draft' ? t('actions.sell') : undefined}
              onAction={activeTab === 'active' || activeTab === 'draft' ? () => router.push('/(modals)/new-marketplace-listing' as Href) : undefined}
            />
          )
        }
        ListFooterComponent={
          list.isLoadingMore ? (
            <LoadingSpinner />
          ) : list.hasMore ? (
            <HeroButton variant="secondary" onPress={list.loadMore}>
              <HeroButton.Label>{t('loadMore')}</HeroButton.Label>
            </HeroButton>
          ) : null
        }
        onEndReached={list.loadMore}
        onEndReachedThreshold={0.35}
      />
      {confirmDialog}
    </SafeAreaView>
  );
}

function DashboardCard({
  stats,
  primary,
  activeTab,
  onTabChange,
}: {
  stats: MarketplaceDashboard;
  primary: string;
  activeTab: ListingTab;
  onTabChange: (tab: ListingTab) => void;
}) {
  const { t } = useTranslation('marketplace');
  const theme = useTheme();
  return (
    <HeroCard className="mb-3 overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: theme.border }}>
      <View className="h-1.5" style={{ backgroundColor: primary }} />
      <HeroCard.Body className="gap-3 p-4">
        <View className="flex-row items-start gap-3">
          <View
            className="h-12 w-12 items-center justify-center rounded-3xl"
            style={{ backgroundColor: withAlpha(primary, 0.14), borderWidth: 1, borderColor: withAlpha(primary, 0.2) }}
          >
            <Ionicons name="storefront-outline" size={23} color={primary} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>{t('myListings.eyebrow')}</Text>
            <Text className="text-xl font-bold leading-7" style={{ color: theme.text }} numberOfLines={1}>{t('myListings.title')}</Text>
            <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>{t('myListings.subtitle')}</Text>
          </View>
        </View>
        <View className="flex-row flex-wrap gap-2">
          <Chip size="sm" variant="secondary"><Chip.Label>{t('myListings.active', { count: stats.active_listings ?? 0 })}</Chip.Label></Chip>
          <Chip size="sm" variant="secondary"><Chip.Label>{t('myListings.sold', { count: stats.sold_listings ?? 0 })}</Chip.Label></Chip>
          <Chip size="sm" variant="secondary"><Chip.Label>{t('myListings.views', { count: stats.total_views ?? stats.views_30d ?? 0 })}</Chip.Label></Chip>
          <Chip size="sm" variant="secondary"><Chip.Label>{t('myListings.offers', { count: stats.pending_offers ?? 0 })}</Chip.Label></Chip>
        </View>
        <TagGroup
          size="sm"
          selectionMode="single"
          selectedKeys={[activeTab]}
          onSelectionChange={(keys) => {
            const next = Array.from(keys)[0];
            if (next !== undefined) onTabChange(next as ListingTab);
          }}
        >
          <TagGroup.List>
            {LISTING_TABS.map((tab) => {
              const isSelected = activeTab === tab;
              return (
                <TagGroup.Item
                  key={tab}
                  id={tab}
                >
                  <TagGroup.ItemLabel style={isSelected ? { color: contrastText(primary) } : undefined}>
                    {t(`myListings.tabs.${tab}`, { count: listingTabCount(stats, tab) })}
                  </TagGroup.ItemLabel>
                </TagGroup.Item>
              );
            })}
          </TagGroup.List>
        </TagGroup>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingRight: 2 }}>
          <SellerShortcutButton label={t('myListings.onboarding')} icon="storefront-outline" primary={primary} onPress={() => router.push('/(modals)/marketplace-merchant-onboarding' as Href)} />
          <SellerShortcutButton label={t('myListings.payments')} icon="card-outline" primary={primary} onPress={() => router.push('/(modals)/marketplace-stripe-onboarding' as Href)} />
          <SellerShortcutButton label={t('myListings.salesOrders')} icon="receipt-outline" primary={primary} onPress={() => router.push({ pathname: '/(modals)/marketplace-orders', params: { mode: 'sales' } } as unknown as Href)} />
          <SellerShortcutButton label={t('myListings.offersCta')} icon="chatbubbles-outline" primary={primary} onPress={() => router.push('/(modals)/marketplace-offers' as Href)} />
          <SellerShortcutButton label={t('myListings.sellerTools')} icon="construct-outline" primary={primary} onPress={() => router.push('/(modals)/marketplace-tools' as Href)} />
          <SellerShortcutButton label={t('myListings.shipping')} icon="car-outline" primary={primary} onPress={() => router.push('/(modals)/marketplace-shipping-options' as Href)} />
        </ScrollView>
      </HeroCard.Body>
    </HeroCard>
  );
}

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

function SellerShortcutButton({
  label,
  icon,
  primary,
  onPress,
}: {
  label: string;
  icon: IoniconName;
  primary: string;
  onPress: () => void;
}) {
  return (
    <HeroButton
      size="sm"
      variant="secondary"
      className="min-w-[118px]"
      accessibilityLabel={label}
      onPress={onPress}
    >
      <Ionicons name={icon} size={15} color={primary} />
      <HeroButton.Label>{label}</HeroButton.Label>
    </HeroButton>
  );
}

function OnboardingNudge({ primary, onDismiss }: { primary: string; onDismiss: () => void }) {
  const { t } = useTranslation('marketplace');
  const theme = useTheme();
  return (
    <HeroCard className="mb-3 overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: theme.border }}>
      <View className="h-1.5" style={{ backgroundColor: primary }} />
      <HeroCard.Body className="gap-3 p-4">
        <View className="flex-row items-start gap-3">
          <View
            className="h-11 w-11 items-center justify-center rounded-3xl"
            style={{ backgroundColor: withAlpha(primary, 0.14), borderWidth: 1, borderColor: withAlpha(primary, 0.2) }}
          >
            <Ionicons name="ribbon-outline" size={21} color={primary} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-base font-bold leading-5" style={{ color: theme.text }} numberOfLines={2}>{t('myListings.onboardingNudge.title')}</Text>
            <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>{t('myListings.onboardingNudge.subtitle')}</Text>
          </View>
        </View>
        <View className="flex-row gap-2">
          <HeroButton className="flex-1" variant="primary" onPress={() => router.push('/(modals)/marketplace-merchant-onboarding' as Href)}>
            <AccentIcon name="storefront-outline" size={16} />
            <HeroButton.Label>{t('myListings.onboardingNudge.start')}</HeroButton.Label>
          </HeroButton>
          <HeroButton className="flex-1" variant="secondary" onPress={onDismiss}>
            <HeroButton.Label>{t('myListings.onboardingNudge.dismiss')}</HeroButton.Label>
          </HeroButton>
        </View>
      </HeroCard.Body>
    </HeroCard>
  );
}

function listingTabCount(stats: MarketplaceDashboard, tab: ListingTab): number {
  if (tab === 'active') return stats.active_listings ?? 0;
  if (tab === 'draft') return stats.draft_listings ?? 0;
  if (tab === 'sold') return stats.sold_listings ?? 0;
  return stats.expired_listings ?? 0;
}
