// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Share, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button as HeroButton, Card as HeroCard, Chip, CloseButton, Surface, Text } from 'heroui-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import QRCode from 'react-native-qrcode-svg';

import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import BottomSheet from '@/components/ui/BottomSheet';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import {
  generatePublicMerchantCouponQr,
  getPublicMerchantCoupon,
  type MerchantCouponQrPayload,
  type PublicMerchantCoupon,
} from '@/lib/api/marketplace';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { dateLocale } from '@/lib/utils/dateLocale';
import { formatLegacyCouponMinorAmount } from '@/lib/utils/marketplaceCurrency';

export default function MarketplaceCouponDetailRoute() {
  return (
    <ModalErrorBoundary>
      <MarketplaceCouponDetailScreen />
    </ModalErrorBoundary>
  );
}

function MarketplaceCouponDetailScreen() {
  const { t } = useTranslation(['marketplace', 'common']);
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { hasFeature, tenant } = useTenant();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const couponId = Number(id);
  const safeCouponId = Number.isFinite(couponId) && couponId > 0 ? couponId : null;
  const coupon = useApi(() => safeCouponId ? getPublicMerchantCoupon(safeCouponId) : Promise.reject(new Error(t('publicCoupons.notFound'))), [safeCouponId], { enabled: hasFeature('merchant_coupons') && Boolean(safeCouponId) });
  const [qr, setQr] = useState<MerchantCouponQrPayload | null>(null);
  const [isQrOpen, setIsQrOpen] = useState(false);
  const [isQrLoading, setIsQrLoading] = useState(false);
  const item = coupon.data?.data ?? null;

  async function shareCode() {
    if (!item) return;
    await Share.share({ message: item.code });
  }

  async function openQr() {
    if (!safeCouponId) return;
    setIsQrLoading(true);
    try {
      const response = await generatePublicMerchantCouponQr(safeCouponId);
      setQr(response.data);
      setIsQrOpen(true);
    } catch {
      showToast({ title: t('common:errors.alertTitle'), description: t('publicCoupons.qrFailed'), variant: 'danger' });
    } finally {
      setIsQrLoading(false);
    }
  }

  if (!hasFeature('merchant_coupons')) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={t('publicCoupons.details')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace-coupons' as Href} />
        <View className="flex-1 justify-center px-4" style={{ flex: 1 }}>
          <EmptyState icon="ticket-outline" title={t('publicCoupons.unavailableTitle')} subtitle={t('publicCoupons.unavailableSubtitle')} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={t('publicCoupons.details')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace-coupons' as Href} />
      {coupon.isLoading ? (
        <View className="flex-1 justify-center py-16" style={{ flex: 1 }}>
          <LoadingSpinner />
        </View>
      ) : !item ? (
        <View className="flex-1 justify-center px-4" style={{ flex: 1 }}>
          <EmptyState
            icon="ticket-outline"
            title={coupon.error ?? t('publicCoupons.notFound')}
            actionLabel={t('publicCoupons.backToCoupons')}
            onAction={() => router.replace('/(modals)/marketplace-coupons' as Href)}
          />
        </View>
      ) : (
        <View className="flex-1 gap-3 px-4 pt-2" style={{ flex: 1 }}>
          <CouponDetailCard
            item={item}
            currency={tenant?.currency}
            onShare={shareCode}
            onQr={openQr}
            isQrLoading={isQrLoading}
          />
        </View>
      )}

      <BottomSheet visible={isQrOpen} onClose={() => setIsQrOpen(false)} snapPoints={['58%', '84%']}>
        <Surface variant="default" className="rounded-panel p-4">
            <View className="mb-4 flex-row items-center justify-between">
              <View className="min-w-0 flex-1">
                <Text className="text-lg font-bold" style={{ color: theme.text }}>{t('publicCoupons.showQr')}</Text>
                <Text className="text-xs" style={{ color: theme.textSecondary }}>{qr?.coupon_code ?? item?.code ?? ''}</Text>
              </View>
              <CloseButton onPress={() => setIsQrOpen(false)} iconProps={{ size: 20, color: primary }} />
            </View>
            {qr ? (
              <View className="items-center gap-3">
                <View
                  className="rounded-2xl bg-white p-2"
                  accessible
                  accessibilityRole="image"
                  accessibilityLabel={t('publicCoupons.qrAlt')}
                >
                  <QRCode value={qr.token} size={208} backgroundColor="#ffffff" color="#000000" />
                </View>
                <Text className="text-center text-sm" style={{ color: theme.textSecondary }}>{t('publicCoupons.scanAtCheckout')}</Text>
                <Text className="text-xs" style={{ color: theme.textSecondary }}>
                  {t('publicCoupons.qrExpires', { time: new Date(qr.expires_at).toLocaleTimeString(dateLocale()) })}
                </Text>
                <Surface variant="secondary" className="rounded-2xl px-3 py-2">
                  <Text className="font-mono text-xs" style={{ color: theme.text }}>{qr.token}</Text>
                </Surface>
              </View>
            ) : null}
        </Surface>
      </BottomSheet>
    </SafeAreaView>
  );
}

function CouponDetailCard({
  item,
  currency,
  onShare,
  onQr,
  isQrLoading,
}: {
  item: PublicMerchantCoupon;
  currency?: string;
  onShare: () => void;
  onQr: () => void;
  isQrLoading: boolean;
}) {
  const { t } = useTranslation('marketplace');
  const primary = usePrimaryColor();
  const theme = useTheme();
  const terms = couponTerms(item, currency, t);
  return (
    <HeroCard className="overflow-hidden rounded-panel p-0">
      <View className="h-1.5" style={{ backgroundColor: primary }} />
      <HeroCard.Body className="gap-4 p-4">
        <View className="flex-row items-start justify-between gap-3">
          <View className="size-13 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
            <Ionicons name="ticket-outline" size={25} color={primary} />
          </View>
          <Chip size="sm" variant="secondary" style={{ backgroundColor: withAlpha(theme.success, 0.15) }}>
            <Chip.Label style={{ color: theme.success }}>{couponDiscountLabel(item, currency, t)}</Chip.Label>
          </Chip>
        </View>
        <View className="gap-2">
          <Text className="text-2xl font-bold" style={{ color: theme.text }}>{item.title}</Text>
          {item.description ? <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{item.description}</Text> : null}
        </View>
        <Surface variant="secondary" className="rounded-2xl p-4">
          <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('publicCoupons.code')}</Text>
          <Text className="font-mono text-2xl font-bold" style={{ color: theme.text }}>{item.code}</Text>
        </Surface>
        {item.valid_until ? (
          <Text className="text-sm" style={{ color: theme.textSecondary }}>
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
        <View className="flex-row gap-2">
          <HeroButton className="flex-1" variant="primary" onPress={onShare}>
            <Ionicons name="copy-outline" size={16} color="#fff" />
            <HeroButton.Label>{t('publicCoupons.useOnline')}</HeroButton.Label>
          </HeroButton>
          <HeroButton className="flex-1" variant="secondary" onPress={onQr} isDisabled={isQrLoading}>
            <Ionicons name="qr-code-outline" size={16} color={primary} />
            <HeroButton.Label>{isQrLoading ? t('publicCoupons.generatingQr') : t('publicCoupons.redeemInStore')}</HeroButton.Label>
          </HeroButton>
        </View>
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
  const terms: string[] = [t(`publicCoupons.status.${coupon.status}`)];
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
  if (coupon.applies_to) {
    terms.push(t(`publicCoupons.appliesTo.${coupon.applies_to}`));
  }
  return terms;
}
