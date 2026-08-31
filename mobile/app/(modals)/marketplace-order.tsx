// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { getMarketplaceOrder } from '@/lib/api/marketplace';
import { useApi } from '@/lib/hooks/useApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTheme } from '@/lib/hooks/useTheme';

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default function MarketplaceOrderRoute() {
  return (
    <ModalErrorBoundary>
      <MarketplaceOrderResolver />
    </ModalErrorBoundary>
  );
}

function MarketplaceOrderResolver() {
  const { t } = useTranslation(['marketplace', 'common']);
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const rawId = first(params.id);
  const orderId = /^\d+$/.test(rawId ?? '') ? Number(rawId) : 0;
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const theme = useTheme();
  const redirected = useRef(false);
  const orderState = useApi(
    () => getMarketplaceOrder(orderId),
    [orderId],
    { enabled: orderId > 0 && isAuthenticated && !isAuthLoading },
  );

  useEffect(() => {
    const order = orderState.data?.data;
    if (!order || !user || redirected.current) return;
    redirected.current = true;
    const mode = order.seller?.id === user.id ? 'sales' : 'purchases';
    router.replace({
      pathname: '/(modals)/marketplace-orders',
      params: { mode, order_id: String(order.id) },
    } as unknown as Href);
  }, [orderState.data, user]);

  const isLoading = isAuthLoading || orderState.isLoading;
  const invalid = orderId <= 0;

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar
        title={t('marketplace:orders.title')}
        backLabel={t('common:back')}
        fallbackHref={'/(modals)/marketplace-orders' as Href}
      />
      <View className="flex-1 items-center justify-center px-4">
        {isLoading && !invalid ? (
          <LoadingSpinner />
        ) : invalid || orderState.error || !orderState.data ? (
          <EmptyState
            icon="receipt-outline"
            title={t('marketplace:orders.empty')}
            subtitle={orderState.error ?? t('marketplace:orders.emptyHint')}
            actionLabel={orderState.error ? t('common:buttons.retry') : undefined}
            onAction={orderState.error ? orderState.refresh : undefined}
            testID="marketplace-order-unavailable"
          />
        ) : (
          <LoadingSpinner />
        )}
      </View>
    </SafeAreaView>
  );
}
