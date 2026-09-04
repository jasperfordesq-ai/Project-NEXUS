// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { FlatList, Image, Linking, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Chip, CloseButton, Surface, TagGroup, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import Avatar from '@/components/ui/Avatar';
import BottomSheet from '@/components/ui/BottomSheet';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import {
  cancelMarketplaceOrder,
  acceptMarketplaceDeliveryOffer,
  confirmMarketplacePayment,
  confirmMarketplaceOrderDelivery,
  confirmMarketplaceDeliveryOffer,
  createMarketplacePaymentIntent,
  disputeMarketplaceOrder,
  getMarketplaceDeliveryOffers,
  getMarketplaceOrder,
  getMarketplaceOrders,
  marketplaceHasMore,
  marketplaceNextCursor,
  rateMarketplaceOrder,
  shipMarketplaceOrder,
  type MarketplaceDeliveryOffer,
  type MarketplaceOrder,
} from '@/lib/api/marketplace';
import { useAuth } from '@/lib/hooks/useAuth';
import { useApi } from '@/lib/hooks/useApi';
import { usePaginatedApi } from '@/lib/hooks/usePaginatedApi';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { presentMarketplacePayment } from '@/lib/payments/marketplacePayment';
import { contrastText, withAlpha } from '@/lib/utils/color';
import { resolveImageUrl } from '@/lib/utils/resolveImageUrl';
import { dateLocale } from '@/lib/utils/dateLocale';
import { formatMarketplaceCurrency } from '@/lib/utils/marketplaceCurrency';
import AccentIcon from '@/components/ui/AccentIcon';

type OrderMode = 'purchases' | 'sales';
type OrderStatusTab = 'all' | 'active' | 'completed' | 'cancelled';
type DisputeReason = 'not_received' | 'not_as_described' | 'damaged' | 'wrong_item' | 'other';
type OrderStatusTone = 'default' | 'success' | 'warning' | 'danger' | 'accent';
const SHIPPING_METHODS = ['standard', 'express', 'tracked', 'hand_delivery', 'other'];
const DISPUTE_REASONS: DisputeReason[] = ['not_received', 'not_as_described', 'damaged', 'wrong_item', 'other'];
const ORDER_STATUSES = new Set(['pending', 'pending_payment', 'paid', 'processing', 'shipped', 'delivered', 'completed', 'cancelled', 'disputed', 'refunded']);
const DELIVERY_STATUSES = new Set(['pending', 'accepted', 'declined', 'completed', 'cancelled']);
const ORDER_STATUS_FILTERS: Record<OrderStatusTab, string | null> = {
  all: null,
  active: 'pending_payment,paid,processing,shipped',
  completed: 'delivered,completed',
  cancelled: 'cancelled,refunded',
};

function formatOrderTotal(value: number, currency: string): string {
  return formatMarketplaceCurrency(value, currency);
}

function translatedOrderStatus(status: string, t: (key: string) => string): string {
  return ORDER_STATUSES.has(status) ? t(`orders.status.${status}`) : t('orders.status.unknown');
}

function translatedDeliveryStatus(status: string, t: (key: string) => string): string {
  return DELIVERY_STATUSES.has(status) ? t(`orders.deliveryStatus.${status}`) : t('orders.deliveryStatus.unknown');
}

function orderStatusTone(status: string): OrderStatusTone {
  switch (status) {
    case 'pending_payment':
    case 'pending':
      return 'warning';
    case 'paid':
    case 'processing':
    case 'shipped':
      return 'accent';
    case 'delivered':
    case 'completed':
      return 'success';
    case 'disputed':
      return 'danger';
    default:
      return 'default';
  }
}

function orderStatusIcon(status: string): ComponentProps<typeof Ionicons>['name'] {
  switch (status) {
    case 'pending_payment':
      return 'card-outline';
    case 'paid':
    case 'processing':
      return 'cube-outline';
    case 'shipped':
      return 'car-outline';
    case 'delivered':
    case 'completed':
      return 'checkmark-circle-outline';
    case 'disputed':
      return 'alert-circle-outline';
    case 'cancelled':
    case 'refunded':
      return 'close-circle-outline';
    default:
      return 'information-circle-outline';
  }
}

function orderHasRating(item: MarketplaceOrder, role: 'buyer' | 'seller'): boolean {
  return item.ratings?.some((rating) => rating.rater_role === role) ?? false;
}

export default function MarketplaceOrdersRoute() {
  return (
    <ModalErrorBoundary>
      <MarketplaceOrdersScreen />
    </ModalErrorBoundary>
  );
}

function MarketplaceOrdersScreen() {
  const { t } = useTranslation(['marketplace', 'common', 'auth']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { tenant } = useTenant();
  const params = useLocalSearchParams<{ mode?: string | string[]; order_id?: string | string[] }>();
  const requestedMode = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const rawOrderId = Array.isArray(params.order_id) ? params.order_id[0] : params.order_id;
  const requestedOrderId = /^\d+$/.test(rawOrderId ?? '') ? Number(rawOrderId) : null;
  const initialMode: OrderMode = requestedMode === 'sales' ? 'sales' : 'purchases';
  const [mode, setMode] = useState<OrderMode>(initialMode);
  const [statusTab, setStatusTab] = useState<OrderStatusTab>('all');
  const [shipOrder, setShipOrder] = useState<MarketplaceOrder | null>(null);
  const [cancelOrder, setCancelOrder] = useState<MarketplaceOrder | null>(null);
  const [rateOrder, setRateOrder] = useState<MarketplaceOrder | null>(null);
  const [disputeOrder, setDisputeOrder] = useState<MarketplaceOrder | null>(null);
  const [deliveryOrder, setDeliveryOrder] = useState<MarketplaceOrder | null>(null);
  const [deliveryOffers, setDeliveryOffers] = useState<MarketplaceDeliveryOffer[]>([]);
  const [isLoadingDeliveryOffers, setIsLoadingDeliveryOffers] = useState(false);
  const [trackingNumber, setTrackingNumber] = useState('');
  const [trackingUrl, setTrackingUrl] = useState('');
  const [shippingMethod, setShippingMethod] = useState('standard');
  const [cancelReason, setCancelReason] = useState('');
  const [rating, setRating] = useState(5);
  const [ratingComment, setRatingComment] = useState('');
  const [isAnonymousRating, setIsAnonymousRating] = useState(false);
  const [disputeReason, setDisputeReason] = useState<DisputeReason>('not_received');
  const [disputeDescription, setDisputeDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const canLoadOrders = !isAuthLoading && isAuthenticated;
  const orders = usePaginatedApi<MarketplaceOrder, Awaited<ReturnType<typeof getMarketplaceOrders>>>(
    (cursor) => getMarketplaceOrders(mode, cursor, ORDER_STATUS_FILTERS[statusTab]),
    (response) => ({
      items: response.data,
      cursor: marketplaceNextCursor(response),
      hasMore: marketplaceHasMore(response),
    }),
    [mode, statusTab],
    { enabled: canLoadOrders },
  );
  const targetOrderState = useApi(
    () => getMarketplaceOrder(requestedOrderId ?? 0),
    [requestedOrderId],
    { enabled: canLoadOrders && requestedOrderId !== null },
  );

  useEffect(() => {
    setMode(requestedMode === 'sales' ? 'sales' : 'purchases');
  }, [requestedMode]);

  const visibleOrders = useMemo(() => {
    if (requestedOrderId === null) return orders.items;
    const target = targetOrderState.data?.data;
    const complete = target && !orders.items.some((item) => item.id === target.id)
      ? [target, ...orders.items]
      : orders.items;
    return [...complete].sort((left, right) =>
      Number(right.id === requestedOrderId) - Number(left.id === requestedOrderId));
  }, [orders.items, requestedOrderId, targetOrderState.data]);

  function openShipModal(order: MarketplaceOrder) {
    setShipOrder(order);
    setTrackingNumber(order.tracking_number ?? '');
    setTrackingUrl(order.tracking_url ?? '');
    setShippingMethod(order.shipping_method ?? 'standard');
  }

  function openCancelModal(order: MarketplaceOrder) {
    setCancelOrder(order);
    setCancelReason('');
  }

  function openRateModal(order: MarketplaceOrder) {
    setRateOrder(order);
    setRating(5);
    setRatingComment('');
    setIsAnonymousRating(false);
  }

  function openDisputeModal(order: MarketplaceOrder) {
    setDisputeOrder(order);
    setDisputeReason('not_received');
    setDisputeDescription('');
  }

  async function openDeliveryModal(order: MarketplaceOrder) {
    setDeliveryOrder(order);
    setDeliveryOffers([]);
    setIsLoadingDeliveryOffers(true);
    try {
      const response = await getMarketplaceDeliveryOffers(order.id);
      setDeliveryOffers(response.data);
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: err instanceof Error ? err.message : t('orders.deliveryOffersLoadFailed'), variant: 'danger' });
    } finally {
      setIsLoadingDeliveryOffers(false);
    }
  }

  async function submitShipment() {
    if (!shipOrder) return;
    setIsSubmitting(true);
    try {
      await shipMarketplaceOrder(shipOrder.id, {
        tracking_number: trackingNumber.trim() || null,
        tracking_url: trackingUrl.trim() || null,
        shipping_method: shippingMethod,
      });
      setShipOrder(null);
      orders.refresh();
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: err instanceof Error ? err.message : t('orders.actionFailed'), variant: 'danger' });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function confirmDelivery(order: MarketplaceOrder) {
    setIsSubmitting(true);
    try {
      await confirmMarketplaceOrderDelivery(order.id);
      orders.refresh();
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: err instanceof Error ? err.message : t('orders.actionFailed'), variant: 'danger' });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function continuePayment(order: MarketplaceOrder) {
    setIsSubmitting(true);
    try {
      const payment = await createMarketplacePaymentIntent(order.id);
      if (payment.data.checkout_url) {
        await Linking.openURL(payment.data.checkout_url);
      } else if (payment.data.client_secret) {
        const paymentResult = await presentMarketplacePayment({
          clientSecret: payment.data.client_secret,
          merchantDisplayName: t('orders.paymentMerchantDisplayName'),
          tenantSlug: tenant?.slug,
        });
        if (paymentResult.status === 'completed' && payment.data.payment_intent_id) {
          await confirmMarketplacePayment(payment.data.payment_intent_id);
          showToast({ title: t('orders.paymentCompleteTitle'), description: t('orders.paymentCompleteHint'), variant: 'success' });
          orders.refresh();
          return;
        }
        if (paymentResult.status === 'failed') {
          showToast({ title: t('common:errors.alertTitle'), description: paymentResult.message || t('orders.paymentSheetFailed'), variant: 'danger' });
          return;
        }
        showToast({ title: t('orders.paymentStartedTitle'), description: t('orders.paymentClientSecretHint'), variant: 'default' });
      } else {
        showToast({ title: t('orders.paymentStartedTitle'), description: t('orders.paymentStartedHint'), variant: 'default' });
      }
      orders.refresh();
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: err instanceof Error ? err.message : t('orders.paymentFailed'), variant: 'danger' });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitCancel() {
    if (!cancelOrder || !cancelReason.trim()) {
      showToast({ title: t('common:errors.alertTitle'), description: t('orders.cancelReasonRequired'), variant: 'warning' });
      return;
    }
    setIsSubmitting(true);
    try {
      await cancelMarketplaceOrder(cancelOrder.id, cancelReason.trim());
      setCancelOrder(null);
      setCancelReason('');
      orders.refresh();
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: err instanceof Error ? err.message : t('orders.actionFailed'), variant: 'danger' });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitRating() {
    if (!rateOrder || rating < 1) {
      showToast({ title: t('common:errors.alertTitle'), description: t('orders.ratingRequired'), variant: 'warning' });
      return;
    }
    setIsSubmitting(true);
    try {
      await rateMarketplaceOrder(rateOrder.id, {
        rating,
        comment: ratingComment.trim() || null,
        is_anonymous: isAnonymousRating,
      });
      setRateOrder(null);
      setRatingComment('');
      orders.refresh();
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: err instanceof Error ? err.message : t('orders.actionFailed'), variant: 'danger' });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function submitDispute() {
    if (!disputeOrder || !disputeDescription.trim()) {
      showToast({ title: t('common:errors.alertTitle'), description: t('orders.disputeDescriptionRequired'), variant: 'warning' });
      return;
    }
    setIsSubmitting(true);
    try {
      await disputeMarketplaceOrder(disputeOrder.id, {
        reason: disputeReason,
        description: disputeDescription.trim(),
      });
      setDisputeOrder(null);
      setDisputeDescription('');
      orders.refresh();
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: err instanceof Error ? err.message : t('orders.actionFailed'), variant: 'danger' });
    } finally {
      setIsSubmitting(false);
    }
  }

  async function updateDeliveryOffer(offer: MarketplaceDeliveryOffer, action: 'accept' | 'confirm') {
    if (!deliveryOrder) return;
    setIsSubmitting(true);
    try {
      if (action === 'accept') {
        await acceptMarketplaceDeliveryOffer(deliveryOrder.id, offer.deliverer_id);
      } else {
        await confirmMarketplaceDeliveryOffer(deliveryOrder.id, offer.deliverer_id);
      }
      const response = await getMarketplaceDeliveryOffers(deliveryOrder.id);
      setDeliveryOffers(response.data);
      orders.refresh();
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: err instanceof Error ? err.message : t('orders.actionFailed'), variant: 'danger' });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isAuthLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('orders.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
        <View className="py-16">
          <LoadingSpinner />
        </View>
      </SafeAreaView>
    );
  }

  if (!isAuthenticated) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('orders.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
        <EmptyState
          icon="receipt-outline"
          title={t('orders.signInTitle')}
          subtitle={t('orders.signInHint')}
          actionLabel={t('auth:login.submit')}
          onAction={() => router.push('/(auth)/login' as Href)}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('orders.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
      <FlatList
        data={visibleOrders}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ gap: 12, paddingHorizontal: 16, paddingBottom: 132 }}
        ListHeaderComponent={
          <HeroCard className="overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: theme.border }}>
            <View className="h-1.5" style={{ backgroundColor: primary }} />
            <HeroCard.Body className="gap-3 p-4">
              <View className="flex-row items-start gap-3">
                <View
                  className="h-12 w-12 items-center justify-center rounded-3xl"
                  style={{ backgroundColor: withAlpha(primary, 0.14), borderWidth: 1, borderColor: withAlpha(primary, 0.2) }}
                >
                  <Ionicons name="receipt-outline" size={23} color={primary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>{t('orders.eyebrow')}</Text>
                  <Text className="text-xl font-bold leading-7" style={{ color: theme.text }} numberOfLines={1}>{t('orders.title')}</Text>
                  <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>{t('orders.subtitle')}</Text>
                </View>
              </View>
              <View className="flex-row gap-2">
                <HeroButton className="min-w-0 flex-1" variant={mode === 'purchases' ? 'primary' : 'secondary'} onPress={() => setMode('purchases')}>
                  <HeroButton.Label>{t('orders.purchases')}</HeroButton.Label>
                </HeroButton>
                <HeroButton className="min-w-0 flex-1" variant={mode === 'sales' ? 'primary' : 'secondary'} onPress={() => setMode('sales')}>
                  <HeroButton.Label>{t('orders.sales')}</HeroButton.Label>
                </HeroButton>
              </View>
              <TagGroup
                size="sm"
                selectionMode="single"
                selectedKeys={[statusTab]}
                onSelectionChange={(keys) => {
                  const next = Array.from(keys)[0];
                  if (next !== undefined) setStatusTab(next as OrderStatusTab);
                }}
              >
                <TagGroup.List>
                  {(['all', 'active', 'completed', 'cancelled'] as OrderStatusTab[]).map((tab) => {
                    const isSelected = statusTab === tab;
                    return (
                      <TagGroup.Item
                        key={tab}
                        id={tab}
                      >
                        <TagGroup.ItemLabel style={isSelected ? { color: contrastText(primary) } : undefined}>
                          {t(`orders.tabs.${tab}`)}
                        </TagGroup.ItemLabel>
                      </TagGroup.Item>
                    );
                  })}
                </TagGroup.List>
              </TagGroup>
            </HeroCard.Body>
          </HeroCard>
        }
        renderItem={({ item }) => (
          <OrderCard
            item={item}
            mode={mode}
            highlighted={item.id === requestedOrderId}
            isSubmitting={isSubmitting}
            onShip={() => openShipModal(item)}
            onConfirmDelivery={() => void confirmDelivery(item)}
            onContinuePayment={() => void continuePayment(item)}
            onCancel={() => openCancelModal(item)}
            onRate={() => openRateModal(item)}
            onDispute={() => openDisputeModal(item)}
            onDeliveryOffers={() => void openDeliveryModal(item)}
          />
        )}
        ListEmptyComponent={
          orders.isLoading ? (
            <View className="py-16"><LoadingSpinner /></View>
          ) : (
            <EmptyState icon="receipt-outline" title={orders.error ?? t('orders.empty')} subtitle={t('orders.emptyHint')} />
          )
        }
        ListFooterComponent={
          orders.isLoadingMore ? (
            <LoadingSpinner />
          ) : orders.hasMore ? (
            <HeroButton variant="secondary" onPress={orders.loadMore}>
              <HeroButton.Label>{t('loadMore')}</HeroButton.Label>
            </HeroButton>
          ) : null
        }
        onEndReached={orders.loadMore}
        onEndReachedThreshold={0.35}
      />

      <BottomSheet visible={Boolean(shipOrder)} onClose={() => setShipOrder(null)} snapPoints={['58%', '86%']}>
        <Surface variant="default" className="rounded-panel p-4">
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="min-w-0 flex-1 pr-3 text-lg font-bold" style={{ color: theme.text }} numberOfLines={1}>{t('orders.shipTitle')}</Text>
              <CloseButton onPress={() => setShipOrder(null)} iconProps={{ size: 20, color: primary }} />
            </View>
            <View className="gap-3">
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('orders.shipHint')}</Text>
              <OrderInput label={t('orders.trackingNumber')} value={trackingNumber} onChangeText={setTrackingNumber} placeholder={t('orders.trackingNumberPlaceholder')} />
              <OrderInput label={t('orders.trackingUrl')} value={trackingUrl} onChangeText={setTrackingUrl} placeholder={t('orders.trackingUrlPlaceholder')} />
              <View className="gap-2">
                <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>{t('orders.shippingMethod')}</Text>
                <View className="flex-row flex-wrap gap-2">
                  {SHIPPING_METHODS.map((method) => (
                    <HeroButton key={method} className="min-w-[46%] flex-1" size="sm" variant={shippingMethod === method ? 'primary' : 'secondary'} onPress={() => setShippingMethod(method)}>
                      <HeroButton.Label>{t(`orders.shippingMethods.${method}`)}</HeroButton.Label>
                    </HeroButton>
                  ))}
                </View>
              </View>
              <HeroButton variant="primary" isDisabled={isSubmitting} onPress={() => void submitShipment()}>
                <AccentIcon name="car-outline" size={17} />
                <HeroButton.Label>{t('orders.confirmShipped')}</HeroButton.Label>
              </HeroButton>
            </View>
        </Surface>
      </BottomSheet>

      <BottomSheet visible={Boolean(cancelOrder)} onClose={() => setCancelOrder(null)} snapPoints={['40%', '66%']}>
        <Surface variant="default" className="rounded-panel p-4">
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="min-w-0 flex-1 pr-3 text-lg font-bold" style={{ color: theme.text }} numberOfLines={1}>{t('orders.cancelTitle')}</Text>
              <CloseButton onPress={() => setCancelOrder(null)} iconProps={{ size: 20, color: primary }} />
            </View>
            <View className="gap-3">
              <OrderInput label={t('orders.cancelReason')} value={cancelReason} onChangeText={setCancelReason} placeholder={t('orders.cancelReasonPlaceholder')} multiline />
              <HeroButton variant="danger" isDisabled={isSubmitting} onPress={() => void submitCancel()}>
                <Ionicons name="close-circle-outline" size={17} color="#fff" />
                <HeroButton.Label>{t('orders.confirmCancel')}</HeroButton.Label>
              </HeroButton>
            </View>
        </Surface>
      </BottomSheet>

      <BottomSheet visible={Boolean(rateOrder)} onClose={() => setRateOrder(null)} snapPoints={['58%', '86%']}>
        <Surface variant="default" className="rounded-panel p-4">
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="min-w-0 flex-1 pr-3 text-lg font-bold" style={{ color: theme.text }} numberOfLines={1}>{t('orders.rateTitle')}</Text>
              <CloseButton onPress={() => setRateOrder(null)} iconProps={{ size: 20, color: primary }} />
            </View>
            <View className="gap-3">
              <View className="gap-2">
                <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>{t('orders.rating')}</Text>
                <View className="flex-row gap-2">
                  {[1, 2, 3, 4, 5].map((value) => (
                    <HeroButton
                      key={value}
                      isIconOnly
                      size="sm"
                      variant={rating >= value ? 'primary' : 'secondary'}
                      onPress={() => setRating(value)}
                      accessibilityLabel={`${t('orders.rating')}: ${value}/5`}
                      style={rating >= value ? { backgroundColor: theme.warning } : undefined}
                    >
                      <Ionicons name={rating >= value ? 'star' : 'star-outline'} size={17} color={rating >= value ? '#111827' : primary} />
                    </HeroButton>
                  ))}
                </View>
              </View>
              <OrderInput label={t('orders.ratingComment')} value={ratingComment} onChangeText={setRatingComment} placeholder={t('orders.ratingCommentPlaceholder')} multiline />
              <HeroButton variant={isAnonymousRating ? 'primary' : 'secondary'} onPress={() => setIsAnonymousRating((value) => !value)}>
                <Ionicons name={isAnonymousRating ? 'eye-off-outline' : 'eye-outline'} size={17} color={isAnonymousRating ? '#fff' : primary} />
                <HeroButton.Label>{t('orders.anonymousRating')}</HeroButton.Label>
              </HeroButton>
              <HeroButton variant="primary" isDisabled={isSubmitting} onPress={() => void submitRating()}>
                <AccentIcon name="star-outline" size={17} />
                <HeroButton.Label>{t('orders.submitRating')}</HeroButton.Label>
              </HeroButton>
            </View>
        </Surface>
      </BottomSheet>

      <BottomSheet visible={Boolean(disputeOrder)} onClose={() => setDisputeOrder(null)} snapPoints={['70%', '92%']}>
        <Surface variant="default" className="max-h-[86%] rounded-panel p-4">
            <View className="mb-4 flex-row items-center justify-between">
              <Text className="min-w-0 flex-1 pr-3 text-lg font-bold" style={{ color: theme.text }} numberOfLines={1}>{t('orders.disputeTitle')}</Text>
              <CloseButton onPress={() => setDisputeOrder(null)} iconProps={{ size: 20, color: primary }} />
            </View>
            <ScrollView contentContainerStyle={{ gap: 12 }} showsVerticalScrollIndicator={false}>
              <View className="gap-2">
                <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>{t('orders.disputeReason')}</Text>
                <View className="flex-row flex-wrap gap-2">
                  {DISPUTE_REASONS.map((reason) => (
                    <HeroButton
                      key={reason}
                      className="min-w-[46%] flex-1"
                      size="sm"
                      variant={disputeReason === reason ? 'primary' : 'secondary'}
                      onPress={() => setDisputeReason(reason)}
                    >
                      <HeroButton.Label>{t(`orders.disputeReasons.${reason}`)}</HeroButton.Label>
                    </HeroButton>
                  ))}
                </View>
              </View>
              <OrderInput label={t('orders.disputeDescription')} value={disputeDescription} onChangeText={setDisputeDescription} placeholder={t('orders.disputeDescriptionPlaceholder')} multiline />
              <HeroButton variant="danger" isDisabled={isSubmitting} onPress={() => void submitDispute()}>
                <Ionicons name="alert-circle-outline" size={17} color="#fff" />
                <HeroButton.Label>{t('orders.submitDispute')}</HeroButton.Label>
              </HeroButton>
            </ScrollView>
        </Surface>
      </BottomSheet>

      <BottomSheet visible={Boolean(deliveryOrder)} onClose={() => setDeliveryOrder(null)} snapPoints={['70%', '92%']}>
        <Surface variant="default" className="max-h-[86%] rounded-panel p-4">
            <View className="mb-4 flex-row items-center justify-between">
              <View className="min-w-0 flex-1">
                <Text className="text-lg font-bold" style={{ color: theme.text }} numberOfLines={1}>{t('orders.deliveryOffersTitle')}</Text>
                <Text className="text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>{deliveryOrder ? t('orders.number', { number: deliveryOrder.order_number }) : ''}</Text>
              </View>
              <CloseButton onPress={() => setDeliveryOrder(null)} iconProps={{ size: 20, color: primary }} />
            </View>
            {isLoadingDeliveryOffers ? (
              <View className="py-10"><LoadingSpinner /></View>
            ) : deliveryOffers.length === 0 ? (
              <EmptyState icon="car-outline" title={t('orders.deliveryOffersEmpty')} subtitle={t('orders.deliveryOffersEmptyHint')} />
            ) : (
              <ScrollView contentContainerStyle={{ gap: 12 }} showsVerticalScrollIndicator={false}>
                {deliveryOffers.map((offer) => (
                  <DeliveryOfferCard
                    key={offer.id}
                    offer={offer}
                    isSubmitting={isSubmitting}
                    onAccept={() => void updateDeliveryOffer(offer, 'accept')}
                    onConfirm={() => void updateDeliveryOffer(offer, 'confirm')}
                  />
                ))}
              </ScrollView>
            )}
        </Surface>
      </BottomSheet>
    </SafeAreaView>
  );
}

function OrderCard({
  item,
  mode,
  highlighted,
  isSubmitting,
  onShip,
  onConfirmDelivery,
  onContinuePayment,
  onCancel,
  onRate,
  onDispute,
  onDeliveryOffers,
}: {
  item: MarketplaceOrder;
  mode: OrderMode;
  highlighted: boolean;
  isSubmitting: boolean;
  onShip: () => void;
  onConfirmDelivery: () => void;
  onContinuePayment: () => void;
  onCancel: () => void;
  onRate: () => void;
  onDispute: () => void;
  onDeliveryOffers: () => void;
}) {
  const { t } = useTranslation('marketplace');
  const { tenant } = useTenant();
  const primary = usePrimaryColor();
  const theme = useTheme();
  /**
   * 🔴 An order paid in time credits has a cash total of zero, so printing the cash total
   * showed the buyer "€0.00" for something they had just paid two credits for. Measured on
   * a device on 2026-08-22 (marketplace_orders 34 and 35, `time_credits_used` 2.00). Show
   * what was actually spent.
   */
  const timeCreditsUsed = Number(item.time_credits_used ?? 0);
  const cashTotal = Number(item.total_price ?? 0);
  const total = timeCreditsUsed > 0 && cashTotal <= 0
    ? t('orders.totalTimeCredits', { count: timeCreditsUsed })
    : formatOrderTotal(cashTotal, item.currency || tenant?.currency || '');
  const imageUrl = resolveImageUrl(item.listing?.image?.url);
  const counterparty = mode === 'purchases' ? item.seller : item.buyer;
  const counterpartyLabel = mode === 'purchases' ? t('orders.sellerLabel') : t('orders.buyerLabel');
  const orderDate = item.created_at ? new Date(item.created_at).toLocaleDateString(dateLocale()) : null;
  const statusTone = orderStatusTone(item.status);
  const statusColor = statusTone === 'success'
    ? theme.success
    : statusTone === 'warning'
      ? theme.warning
      : statusTone === 'danger'
        ? theme.error
        : statusTone === 'accent'
          ? primary
          : theme.textSecondary;
  const statusHintKey = ORDER_STATUSES.has(item.status)
    ? `orders.statusHint.${mode}.${item.status}`
    : 'orders.statusHint.unknown';
  const canManageCommunityDelivery = item.listing?.delivery_method === 'community_delivery'
    && ['paid', 'processing', 'shipped', 'delivered'].includes(item.status);
  const hasBuyerRating = orderHasRating(item, 'buyer');
  const hasCurrentUserRating = orderHasRating(item, mode === 'purchases' ? 'buyer' : 'seller');
  return (
    <HeroCard
      className="overflow-hidden rounded-panel p-0"
      style={{ borderWidth: highlighted ? 2 : 1, borderColor: highlighted ? primary : theme.border }}
      testID={`marketplace-order-card-${item.id}`}
    >
      <HeroCard.Body className="gap-3 p-3.5">
        <View className="flex-row gap-3">
          <View
            className="h-20 w-20 items-center justify-center overflow-hidden rounded-panel-inner"
            style={{ backgroundColor: withAlpha(primary, 0.12), borderWidth: 1, borderColor: withAlpha(primary, 0.16) }}
          >
            {imageUrl ? (
              <Image source={{ uri: imageUrl }} className="h-full w-full" resizeMode="cover" />
            ) : (
              <Ionicons name="bag-handle-outline" size={28} color={primary} />
            )}
          </View>
          <View className="min-w-0 flex-1 gap-2">
            <View className="flex-row items-start justify-between gap-3">
              <View className="min-w-0 flex-1">
                <Text className="text-base font-bold leading-5" style={{ color: theme.text }} numberOfLines={2}>{item.listing?.title ?? item.order_number}</Text>
                <Text className="text-sm font-semibold" style={{ color: theme.textSecondary }} numberOfLines={1}>{total}</Text>
              </View>
              <Chip size="sm" variant="secondary" style={{ backgroundColor: withAlpha(statusColor, 0.14) }}>
                <Chip.Label style={{ color: statusColor }}>{translatedOrderStatus(item.status, t)}</Chip.Label>
              </Chip>
            </View>
            {counterparty ? (
              <View className="flex-row items-center gap-2">
                <Avatar uri={counterparty.avatar_url ?? null} name={counterparty.name} size={28} />
                <View className="min-w-0 flex-1">
                  <Text className="text-[11px] font-bold uppercase" style={{ color: theme.textMuted }}>{counterpartyLabel}</Text>
                  <Text className="text-xs font-semibold" style={{ color: theme.text }} numberOfLines={1}>{counterparty.name}</Text>
                </View>
              </View>
            ) : null}
          </View>
        </View>
        <View className="flex-row flex-wrap items-center gap-2">
          <Text className="text-xs" style={{ color: theme.textMuted }}>{t('orders.number', { number: item.order_number })}</Text>
          {orderDate ? <Text className="text-xs" style={{ color: theme.textMuted }}>{t('orders.date', { date: orderDate })}</Text> : null}
        </View>
        {item.quantity > 1 ? (
          <Text className="text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>{t('orders.quantity', { count: item.quantity })}</Text>
        ) : null}
        <Surface variant="secondary" className="flex-row items-start gap-3 rounded-panel-inner p-3" style={{ borderWidth: 1, borderColor: theme.border }}>
          <View className="h-9 w-9 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(statusColor, 0.14) }}>
            <Ionicons name={orderStatusIcon(item.status)} size={17} color={statusColor} />
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-xs font-bold uppercase" style={{ color: statusColor }} numberOfLines={1}>
              {translatedOrderStatus(item.status, t)}
            </Text>
            <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>
              {t(statusHintKey)}
            </Text>
          </View>
        </Surface>
        {item.tracking_number ? (
          <View className="flex-row flex-wrap items-center gap-2">
            <Text className="text-xs" style={{ color: theme.textSecondary }}>
              {t('orders.tracking', { number: item.tracking_number })}
            </Text>
            {item.tracking_url ? (
              <HeroButton size="sm" variant="secondary" onPress={() => void Linking.openURL(item.tracking_url ?? '')}>
                <Ionicons name="open-outline" size={14} color={primary} />
                <HeroButton.Label>{t('orders.track')}</HeroButton.Label>
              </HeroButton>
            ) : null}
          </View>
        ) : null}
        {item.listing?.id ? (
          <HeroButton className="self-start" size="sm" variant="secondary" onPress={() => router.push({ pathname: '/(modals)/marketplace-detail', params: { id: String(item.listing?.id) } } as unknown as Href)}>
            <Ionicons name="open-outline" size={14} color={primary} />
            <HeroButton.Label>{t('actions.view')}</HeroButton.Label>
          </HeroButton>
        ) : null}
        <View className="flex-row flex-wrap gap-2">
          {mode === 'purchases' && item.status === 'paid' ? (
            <Chip className="min-w-[46%] flex-1" size="sm" variant="secondary">
              <Ionicons name="cube-outline" size={14} color={theme.textMuted} />
              <Chip.Label>{t('orders.waitingShipment')}</Chip.Label>

            </Chip>
          ) : null}
          {mode === 'purchases' && item.status === 'pending_payment' ? (
            <HeroButton className="min-w-[46%] flex-1" size="sm" variant="primary" isDisabled={isSubmitting} onPress={onContinuePayment}>
              <AccentIcon name="card-outline" size={14} />
              <HeroButton.Label>{t('orders.continuePayment')}</HeroButton.Label>
            </HeroButton>
          ) : null}
          {mode === 'sales' && item.status === 'paid' ? (
            <HeroButton className="min-w-[46%] flex-1" size="sm" variant="primary" isDisabled={isSubmitting} onPress={onShip}>
              <AccentIcon name="car-outline" size={14} />
              <HeroButton.Label>{t('orders.markShipped')}</HeroButton.Label>
            </HeroButton>
          ) : null}
          {mode === 'sales' && item.status === 'pending_payment' ? (
            <Chip className="min-w-[46%] flex-1" size="sm" variant="secondary">
              <Ionicons name="card-outline" size={14} color={theme.textMuted} />
              <Chip.Label>{t('orders.awaitingPayment')}</Chip.Label>

            </Chip>
          ) : null}
          {mode === 'sales' && item.status === 'shipped' ? (
            <Chip className="min-w-[46%] flex-1" size="sm" variant="secondary">
              <Ionicons name="time-outline" size={14} color={theme.textMuted} />
              <Chip.Label>{t('orders.awaitingConfirmation')}</Chip.Label>

            </Chip>
          ) : null}
          {mode === 'sales' && item.status === 'delivered' ? (
            <Chip className="min-w-[46%] flex-1" size="sm" variant="secondary">
              <Ionicons name="hourglass-outline" size={14} color={theme.textMuted} />
              <Chip.Label>{t('orders.awaitingCompletion')}</Chip.Label>

            </Chip>
          ) : null}
          {mode === 'sales' && item.status === 'completed' ? (
            hasBuyerRating ? (
              <Chip className="min-w-[46%] flex-1" size="sm" variant="secondary">
                <Ionicons name="star" size={14} color={theme.success} />
                <Chip.Label>{t('orders.buyerRated')}</Chip.Label>

              </Chip>
            ) : (
              <Chip className="min-w-[46%] flex-1" size="sm" variant="secondary">
                <Ionicons name="checkmark-circle-outline" size={14} color={theme.success} />
                <Chip.Label>{t('orders.saleCompleted')}</Chip.Label>

              </Chip>
            )
          ) : null}
          {mode === 'sales' && item.status === 'disputed' ? (
            <Chip className="min-w-[46%] flex-1" size="sm" variant="soft" color="danger">
              <Ionicons name="alert-circle-outline" size={14} color={theme.error} />
              <Chip.Label>{t('orders.disputeOpen')}</Chip.Label>

            </Chip>
          ) : null}
          {mode === 'purchases' && item.status === 'shipped' ? (
            <HeroButton className="min-w-[46%] flex-1" size="sm" variant="primary" isDisabled={isSubmitting} onPress={onConfirmDelivery} style={{ backgroundColor: theme.success }}>
              <AccentIcon name="checkmark-circle-outline" size={14} />
              <HeroButton.Label>{t('orders.confirmDelivery')}</HeroButton.Label>
            </HeroButton>
          ) : null}
          {['pending_payment', 'paid'].includes(item.status) ? (
            <HeroButton className="min-w-[46%] flex-1" size="sm" variant="danger" isDisabled={isSubmitting} onPress={onCancel}>
              <Ionicons name="close-circle-outline" size={14} color="#fff" />
              <HeroButton.Label>{t('orders.cancel')}</HeroButton.Label>
            </HeroButton>
          ) : null}
          {mode === 'purchases' && ['delivered', 'completed'].includes(item.status) && !hasCurrentUserRating ? (
            <HeroButton className="min-w-[46%] flex-1" size="sm" variant="secondary" isDisabled={isSubmitting} onPress={onRate}>
              <Ionicons name="star-outline" size={14} color={primary} />
              <HeroButton.Label>{t('orders.rate')}</HeroButton.Label>
            </HeroButton>
          ) : null}
          {mode === 'purchases' && item.status === 'completed' && hasCurrentUserRating ? (
            <Chip className="min-w-[46%] flex-1" size="sm" variant="secondary">
              <Ionicons name="star" size={14} color={theme.success} />
              <Chip.Label>{t('orders.rated')}</Chip.Label>

            </Chip>
          ) : null}
          {mode === 'purchases' && ['paid', 'processing', 'shipped', 'delivered'].includes(item.status) ? (
            <HeroButton className="min-w-[46%] flex-1" size="sm" variant="secondary" isDisabled={isSubmitting} onPress={onDispute}>
              <Ionicons name="alert-circle-outline" size={14} color={theme.error} />
              <HeroButton.Label>{t('orders.dispute')}</HeroButton.Label>
            </HeroButton>
          ) : null}
          {canManageCommunityDelivery ? (
            <HeroButton className="min-w-[46%] flex-1" size="sm" variant="secondary" isDisabled={isSubmitting} onPress={onDeliveryOffers}>
              <Ionicons name="people-outline" size={14} color={primary} />
              <HeroButton.Label>{t('orders.deliveryOffers')}</HeroButton.Label>
            </HeroButton>
          ) : null}
        </View>
      </HeroCard.Body>
    </HeroCard>
  );
}

function DeliveryOfferCard({
  offer,
  isSubmitting,
  onAccept,
  onConfirm,
}: {
  offer: MarketplaceDeliveryOffer;
  isSubmitting: boolean;
  onAccept: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation('marketplace');
  const theme = useTheme();
  const delivererName = offer.deliverer?.name?.trim() || t('orders.deliveryUnknown');
  const avatarUri = offer.deliverer?.avatar_url ?? null;
  const isVerified = Boolean(offer.deliverer?.is_verified);
  return (
    <HeroCard className="rounded-panel p-0" style={{ borderWidth: 1, borderColor: theme.border }}>
      <HeroCard.Body className="gap-3 p-3.5">
        <View className="flex-row items-start gap-3">
          <Avatar uri={avatarUri} name={delivererName} size={40} />
          <View className="min-w-0 flex-1">
            <View className="flex-row flex-wrap items-center gap-2">
              <Text className="min-w-0 flex-1 text-base font-bold" style={{ color: theme.text }} numberOfLines={1}>{delivererName}</Text>
              {isVerified ? (
                <Chip size="sm" variant="secondary" style={{ backgroundColor: withAlpha(theme.success, 0.14) }}>
                  <Ionicons name="shield-checkmark-outline" size={12} color={theme.success} />
                  <Chip.Label style={{ color: theme.success }}>{t('orders.deliveryVerified')}</Chip.Label>
                </Chip>
              ) : null}
            </View>
            <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>
              {t('orders.deliveryTimeCredits', { count: offer.time_credits })}
              {offer.estimated_minutes ? ` - ${t('orders.deliveryEstimate', { count: offer.estimated_minutes })}` : ''}
            </Text>
          </View>
          <Chip size="sm" variant="secondary"><Chip.Label>{translatedDeliveryStatus(offer.status, t)}</Chip.Label></Chip>
        </View>
        {offer.notes ? (
          <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={4}>{offer.notes}</Text>
        ) : null}
        <View className="flex-row flex-wrap gap-2">
          {offer.status === 'pending' ? (
            <HeroButton className="min-w-[46%] flex-1" size="sm" variant="primary" isDisabled={isSubmitting} onPress={onAccept}>
              <AccentIcon name="checkmark-circle-outline" size={14} />
              <HeroButton.Label>{t('orders.acceptDeliveryOffer')}</HeroButton.Label>
            </HeroButton>
          ) : null}
          {offer.status === 'accepted' ? (
            <HeroButton className="min-w-[46%] flex-1" size="sm" variant="primary" isDisabled={isSubmitting} onPress={onConfirm} style={{ backgroundColor: theme.success }}>
              <AccentIcon name="flag-outline" size={14} />
              <HeroButton.Label>{t('orders.confirmDeliveryOffer')}</HeroButton.Label>
            </HeroButton>
          ) : null}
        </View>
      </HeroCard.Body>
    </HeroCard>
  );
}

function OrderInput({
  label,
  value,
  onChangeText,
  placeholder,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  multiline?: boolean;
}) {
  const theme = useTheme();
  return (
    <View className="w-full gap-2">
      <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>{label}</Text>
      <Input
        containerClassName="mb-0 w-full"
        inputClassName={`w-full ${multiline ? 'min-h-24' : 'min-h-12'} text-sm`}
        style={{ color: theme.text, textAlignVertical: multiline ? 'top' : 'center' }}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        multiline={multiline}
        accessibilityLabel={label}
      />
    </View>
  );
}
