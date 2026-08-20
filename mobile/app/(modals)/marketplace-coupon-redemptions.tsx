// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';

export default function MarketplaceCouponRedemptionsRoute() {
  return (
    <ModalErrorBoundary>
      <MarketplaceCouponRedemptionsRedirect />
    </ModalErrorBoundary>
  );
}

function MarketplaceCouponRedemptionsRedirect() {
  const { t } = useTranslation(['marketplace', 'common']);
  const { id } = useLocalSearchParams<{ id?: string }>();
  const couponId = Number(id);
  const safeCouponId = Number.isFinite(couponId) && couponId > 0 ? String(couponId) : null;

  useEffect(() => {
    router.replace({
      pathname: '/(modals)/marketplace-tools',
      params: safeCouponId
        ? { tab: 'coupons', couponId: safeCouponId, couponMode: 'redemptions' }
        : { tab: 'coupons' },
    } as unknown as Href);
  }, [safeCouponId]);

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('tools.coupons.redemptionsTitle')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace-tools' as Href} />
      <View className="flex-1 items-center justify-center">
        <LoadingSpinner />
      </View>
    </SafeAreaView>
  );
}
