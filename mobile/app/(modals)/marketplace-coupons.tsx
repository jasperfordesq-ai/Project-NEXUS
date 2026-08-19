// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button as HeroButton, Card as HeroCard, Chip, Surface, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { getPublicMerchantCoupons, type PublicMerchantCoupon } from '@/lib/api/marketplace';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { dateLocale } from '@/lib/utils/dateLocale';
import { formatLegacyCouponMinorAmount } from '@/lib/utils/marketplaceCurrency';

export default function MarketplaceCouponsRoute() {
  return (
    <ModalErrorBoundary>
      <MarketplaceCouponsScreen />
    </ModalErrorBoundary>
  );
}

function MarketplaceCouponsScreen() {
  const { t } = useTranslation(['marketplace', 'common']);
  const { hasFeature, tenant } = useTenant();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const coupons = useApi(() => getPublicMerchantCoupons(), [], { enabled: hasFeature('merchant_coupons') });
  const items = coupons.data?.data.items ?? [];

  if (!hasFeature('merchant_coupons')) {
    return (
      <SafeAreaView className="flex-1 bg-background">
        <AppTopBar title={t('publicCoupons.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
        <View className="flex-1 justify-center px-4">
          <EmptyState icon="ticket-outline" title={t('publicCoupons.unavailableTitle')} subtitle={t('publicCoupons.unavailableSubtitle')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <AppTopBar title={t('publicCoupons.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 132 }}
        refreshControl={<RefreshControl refreshing={coupons.isLoading && items.length > 0} onRefresh={coupons.refresh} />}
        ListHeaderComponent={
          <Surface variant="default" className="mb-3 mt-2 overflow-hidden rounded-panel p-0">
            <View className="h-1.5" style={{ backgroundColor: primary }} />
            <View className="gap-3 p-4">
              <View className="flex-row items-start gap-3">
                <View className="size-13 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                  <Ionicons name="ticket-outline" size={25} color={primary} />
                </View>
                <View className="min-w-0 flex-1 gap-1">
                  <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('publicCoupons.eyebrow')}</Text>
                  <Text className="text-2xl font-bold" style={{ color: theme.text }}>{t('publicCoupons.title')}</Text>
                  <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('publicCoupons.subtitle')}</Text>
                </View>
              </View>
            </View>
          </Surface>
        }
        renderItem={({ item }) => <CouponCard item={item} currency={tenant?.currency} />}
        ListEmptyComponent={
          coupons.isLoading ? (
            <View className="py-16">
              <LoadingSpinner />
            </View>
          ) : (
            <EmptyState
              icon="ticket-outline"
              title={t('publicCoupons.empty')}
              subtitle={t('publicCoupons.emptyHint')}
              actionLabel={t('actions.browse')}
              onAction={() => router.push('/(modals)/marketplace' as Href)}
            />
          )
        }
      />
    </SafeAreaView>
  );
}

function CouponCard({ item, currency }: { item: PublicMerchantCoupon; currency?: string }) {
  const { t } = useTranslation('marketplace');
  const primary = usePrimaryColor();
  const theme = useTheme();
  const terms = couponTerms(item, currency, t);
  return (
    <HeroCard className="mb-3 rounded-panel p-0">
      <HeroCard.Body className="gap-3 p-4">
        <View className="flex-row items-start justify-between gap-3">
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-lg font-bold" style={{ color: theme.text }}>{item.title}</Text>
            {item.description ? <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{item.description}</Text> : null}
          </View>
          <Chip size="sm" variant="secondary" style={{ backgroundColor: withAlpha(theme.success, 0.15) }}>
            <Chip.Label style={{ color: theme.success }}>{couponDiscountLabel(item, currency, t)}</Chip.Label>
          </Chip>
        </View>
        <Surface variant="secondary" className="rounded-2xl px-3 py-2">
          <Text className="font-mono text-base font-bold" style={{ color: theme.text }}>{item.code}</Text>
        </Surface>
        {item.valid_until ? (
          <Text className="text-xs" style={{ color: theme.textSecondary }}>
            {t('publicCoupons.validUntil', { date: new Date(item.valid_until).toLocaleDateString(dateLocale()) })}
          </Text>
        ) : null}
        {terms.length > 0 ? (
          <View className="flex-row flex-wrap gap-2">
            {terms.map((term) => (
              <Chip key={term} size="sm" variant="secondary">
                <Chip.Label>{term}</Chip.Label>
              </Chip>
            ))}
          </View>
        ) : null}
        <HeroButton variant="primary" onPress={() => router.push({ pathname: '/(modals)/marketplace-coupon-detail', params: { id: String(item.id) } } as unknown as Href)}>
          <HeroButton.Label>{t('publicCoupons.details')}</HeroButton.Label>
        </HeroButton>
      </HeroCard.Body>
    </HeroCard>
  );
}

function couponDiscountLabel(
  coupon: PublicMerchantCoupon,
  currency: string | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (coupon.discount_type === 'percent') return `${coupon.discount_value ?? 0}${t('publicCoupons.percentSuffix')}`;
  if (coupon.discount_type === 'fixed') {
    return t('publicCoupons.fixedValue', {
      value: formatLegacyCouponMinorAmount(coupon.discount_value ?? 0, currency),
    });
  }
  return t('publicCoupons.bogo');
}

function couponTerms(
  coupon: PublicMerchantCoupon,
  currency: string | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string[] {
  const terms: string[] = [];
  if (coupon.min_order_cents && coupon.min_order_cents > 0) {
    terms.push(t('publicCoupons.minOrder', {
      value: formatLegacyCouponMinorAmount(coupon.min_order_cents, currency),
    }));
  }
  if (coupon.max_uses) {
    terms.push(t('publicCoupons.usage', { used: coupon.usage_count ?? coupon.used_count ?? 0, max: coupon.max_uses }));
  }
  if (coupon.max_uses_per_member) {
    terms.push(t('publicCoupons.perMember', { count: coupon.max_uses_per_member }));
  }
  return terms;
}
