// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import QRCode from 'react-native-qrcode-svg';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Card as HeroCard, Surface, Text } from 'heroui-native';
import { Chip } from '@/components/ui/StatusChip';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { getMyMarketplacePickups, type MarketplacePickupReservation } from '@/lib/api/marketplace';
import { useApi } from '@/lib/hooks/useApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { dateLocale } from '@/lib/utils/dateLocale';
import { withRouteGate } from '@/components/withRouteGate';

function MarketplacePickupsRoute() {
  return (
    <ModalErrorBoundary>
      <MarketplacePickupsScreen />
    </ModalErrorBoundary>
  );
}

function MarketplacePickupsScreen() {
  const { t } = useTranslation(['marketplace', 'common', 'auth']);
  const { hasFeature } = useTenant();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const marketplaceEnabled = hasFeature('marketplace');
  const reservations = useApi(() => getMyMarketplacePickups(), [], { enabled: marketplaceEnabled && !isAuthLoading && isAuthenticated });
  const items = reservations.data?.data ?? [];

  if (!marketplaceEnabled) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('pickup.myTitle')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
        <View className="flex-1 justify-center px-4">
          <EmptyState icon="bag-handle-outline" title={t('featureGate.title')} subtitle={t('featureGate.description')} />
        </View>
      </SafeAreaView>
    );
  }

  if (isAuthLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('pickup.myTitle')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
        <View className="py-16">
          <LoadingSpinner />
        </View>
      </SafeAreaView>
    );
  }

  if (!isAuthenticated) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('pickup.myTitle')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
        <View className="flex-1 justify-center px-4">
          <EmptyState
            icon="bag-check-outline"
            title={t('pickup.signInTitle')}
            subtitle={t('pickup.signInHint')}
            actionLabel={t('auth:login.submit')}
            onAction={() => router.push('/(auth)/login' as Href)}
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('pickup.myTitle')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 132, gap: 12 }}
        refreshControl={<RefreshControl refreshing={reservations.isLoading} onRefresh={reservations.refresh} />}
      >
        <Surface
          variant="default"
          className="mt-2 overflow-hidden rounded-panel p-0"
        >
          <View className="h-1.5" style={{ backgroundColor: primary }} />
          <View className="gap-4 p-4">
            <View className="flex-row items-start gap-3">
              <View className="size-13 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                <Ionicons name="qr-code-outline" size={25} color={primary} />
              </View>
              <View className="min-w-0 flex-1 gap-1">
                <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('pickup.myEyebrow')}</Text>
                <Text className="text-2xl font-bold" style={{ color: theme.text }}>{t('pickup.myTitle')}</Text>
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('pickup.mySubtitle')}</Text>
              </View>
            </View>
            <HeroButton variant="secondary" onPress={() => router.push('/(modals)/marketplace-orders' as Href)}>
              <Ionicons name="receipt-outline" size={16} color={primary} />
              <HeroButton.Label>{t('pickup.openOrders')}</HeroButton.Label>
            </HeroButton>
          </View>
        </Surface>

        {reservations.isLoading ? (
          <View className="py-16">
            <LoadingSpinner />
          </View>
        ) : items.length === 0 ? (
          <EmptyState
            icon="bag-check-outline"
            title={t('pickup.noPickups')}
            subtitle={t('pickup.noPickupsHint')}
            actionLabel={t('actions.browse')}
            onAction={() => router.push('/(modals)/marketplace' as Href)}
          />
        ) : (
          <View className="gap-3">
            {items.map((item) => (
              <PickupReservationCard key={item.id} item={item} />
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function PickupReservationCard({ item }: { item: MarketplacePickupReservation }) {
  const { t } = useTranslation('marketplace');
  const primary = usePrimaryColor();
  const theme = useTheme();
  const title = item.listing_title || t('pickup.order', { order: item.order_id });
  const windowStart = formatDateTime(item.slot?.slot_start ?? item.reserved_at);
  const windowEnd = formatDateTime(item.slot?.slot_end ?? null);
  const statusTone = pickupStatusTone(item.status, theme, primary);

  return (
    <HeroCard className="rounded-panel p-0">
      <HeroCard.Body className="gap-4 p-4">
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-lg font-bold" style={{ color: theme.text }}>{title}</Text>
            <Text className="text-sm" style={{ color: theme.textSecondary }}>
              {windowEnd ? t('pickup.windowRange', { start: windowStart, end: windowEnd }) : t('pickup.window', { time: windowStart })}
            </Text>
          </View>
          <Chip size="sm" variant="secondary" style={{ backgroundColor: withAlpha(statusTone, 0.14) }}>
            <Chip.Label style={{ color: statusTone }}>{t(`pickup.status.${item.status}`, { defaultValue: item.status })}</Chip.Label>
          </Chip>
        </View>

        {item.status === 'reserved' && item.qr_code ? (
          /*
            🔴 "Show this code" printed the token as text while the seller's own tools tab
            offers a camera scanner, so the seller had to type it in (audit 2026-09-07,
            D/F-16). The code is now scannable; the text stays underneath for the case where
            a scanner will not focus.
          */
          <Surface variant="secondary" className="items-center gap-2 rounded-2xl p-3">
            <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('pickup.showCode')}</Text>
            <View className="rounded-2xl bg-white p-3" testID={`pickup-qr-${item.id}`}>
              <QRCode value={item.qr_code} size={168} backgroundColor="#ffffff" color="#000000" />
            </View>
            <Text className="font-mono text-sm font-bold" style={{ color: theme.text }} selectable>{item.qr_code}</Text>
          </Surface>
        ) : null}
      </HeroCard.Body>
    </HeroCard>
  );
}

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(dateLocale());
}

function pickupStatusTone(status: string, theme: ReturnType<typeof useTheme>, primary: string): string {
  if (status === 'picked_up') return theme.success;
  if (status === 'cancelled') return theme.error;
  if (status === 'no_show') return theme.warning;
  return primary;
}

export default withRouteGate(MarketplacePickupsRoute, 'marketplace-pickups');
