// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useRef, useState } from 'react';
import { FlatList, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Card, CloseButton, Surface, Text } from 'heroui-native';
import { Ionicons } from '@/components/ui/Icon';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import AccentIcon from '@/components/ui/AccentIcon';
import BottomSheet from '@/components/ui/BottomSheet';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { Button } from '@/components/ui/NativeButton';
import { Chip } from '@/components/ui/StatusChip';
import RemoteImage from '@/components/ui/RemoteImage';
import { useAppToast } from '@/components/ui/AppToast';
import { withRouteGate } from '@/components/withRouteGate';
import { ApiResponseError } from '@/lib/api/client';
import { describeApiError } from '@/lib/api/describeApiError';
import {
  createMarketplaceDeliveryOffer,
  getMarketplaceDeliveryOffers,
  getMarketplaceDeliveryOpportunities,
  marketplaceHasMore,
  marketplaceNextCursor,
  type MarketplaceDeliveryOpportunity,
} from '@/lib/api/marketplace';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePaginatedApi } from '@/lib/hooks/usePaginatedApi';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { resolveImageUrl } from '@/lib/utils/resolveImageUrl';
import { withAlpha } from '@/lib/utils/color';

const DELIVERY_STATUSES = new Set(['pending', 'accepted', 'declined', 'completed', 'cancelled']);

function translatedDeliveryStatus(status: string, t: (key: string) => string): string {
  return DELIVERY_STATUSES.has(status) ? t(`orders.deliveryStatus.${status}`) : t('orders.deliveryStatus.unknown');
}

function MarketplaceDeliveriesScreen() {
  const { t } = useTranslation(['marketplace', 'common', 'auth']);
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { tenant } = useTenant();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const { show: showToast } = useAppToast();
  const [selected, setSelected] = useState<MarketplaceDeliveryOpportunity | null>(null);
  const [credits, setCredits] = useState('1');
  const [minutes, setMinutes] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const mountedRef = useRef(true);
  const enabled = !authLoading && isAuthenticated;
  const opportunities = usePaginatedApi<MarketplaceDeliveryOpportunity, Awaited<ReturnType<typeof getMarketplaceDeliveryOpportunities>>>(
    (cursor) => getMarketplaceDeliveryOpportunities(cursor),
    (response) => ({
      items: response.data,
      cursor: marketplaceNextCursor(response),
      hasMore: marketplaceHasMore(response),
    }),
    [tenant?.id, tenant?.slug, user?.id],
    { enabled },
  );

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  function openOffer(item: MarketplaceDeliveryOpportunity) {
    setSelected(item);
    setCredits('1');
    setMinutes('');
    setNotes('');
  }

  async function submitOffer() {
    if (!selected || submittingRef.current) return;
    const timeCredits = Number(credits);
    const estimatedMinutes = minutes.trim() === '' ? null : Number(minutes);
    if (!Number.isFinite(timeCredits) || timeCredits < 0.25 || timeCredits > 100) {
      showToast({ title: t('common:errors.alertTitle'), description: t('communityDelivery.offerCreditsInvalid'), variant: 'warning' });
      return;
    }
    if (estimatedMinutes !== null && (!Number.isInteger(estimatedMinutes) || estimatedMinutes < 5 || estimatedMinutes > 1440)) {
      showToast({ title: t('common:errors.alertTitle'), description: t('communityDelivery.offerMinutesInvalid'), variant: 'warning' });
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    const payload = {
      time_credits: timeCredits,
      estimated_minutes: estimatedMinutes,
      notes: notes.trim() || null,
    };
    let committed = false;
    try {
      await createMarketplaceDeliveryOffer(selected.order_id, payload);
      committed = true;
    } catch (error) {
      if (error instanceof ApiResponseError && error.status === 0) {
        try {
          const readback = await getMarketplaceDeliveryOffers(selected.order_id);
          committed = readback.data.some((offer) =>
            offer.deliverer_id === user?.id
            && ['pending', 'accepted'].includes(offer.status)
            && Number(offer.time_credits) === timeCredits
            && Number(offer.estimated_minutes ?? 0) === Number(estimatedMinutes ?? 0)
            && (offer.notes ?? '') === (payload.notes ?? ''));
        } catch {
          committed = false;
        }
      }
      if (!committed && mountedRef.current) {
        showToast({
          title: t('common:errors.alertTitle'),
          description: describeApiError(error, t('communityDelivery.offerFailed')),
          variant: 'danger',
        });
      }
    } finally {
      if (committed && mountedRef.current) {
        setSelected(null);
        showToast({ title: t('communityDelivery.offerSent'), variant: 'success' });
        await opportunities.refresh();
      }
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  }

  if (!authLoading && !isAuthenticated) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('communityDelivery.deliveriesTitle')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
        <EmptyState
          icon="car-outline"
          title={t('communityDelivery.signInTitle')}
          subtitle={t('communityDelivery.signInHint')}
          actionLabel={t('auth:login.submit')}
          onAction={() => router.push('/(auth)/login' as Href)}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('communityDelivery.deliveriesTitle')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
      <FlatList
        data={opportunities.items}
        keyExtractor={(item) => String(item.order_id)}
        contentContainerStyle={{ gap: 12, paddingHorizontal: 16, paddingBottom: 132 }}
        refreshControl={<RefreshControl refreshing={opportunities.isLoading && opportunities.items.length > 0} onRefresh={opportunities.refresh} tintColor={primary} colors={[primary]} />}
        ListHeaderComponent={
          <Card className="overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: theme.border }}>
            <View className="h-1.5" style={{ backgroundColor: primary }} />
            <Card.Body className="gap-2 p-4">
              <Text className="text-xl font-bold" style={{ color: theme.text }}>{t('communityDelivery.deliveriesTitle')}</Text>
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('communityDelivery.deliveriesSubtitle')}</Text>
            </Card.Body>
          </Card>
        }
        renderItem={({ item }) => (
          <DeliveryOpportunityCard item={item} onOffer={() => openOffer(item)} />
        )}
        ListEmptyComponent={
          opportunities.isLoading ? (
            <View className="py-16"><LoadingSpinner /></View>
          ) : (
            <EmptyState
              icon="car-outline"
              title={opportunities.error ?? t('communityDelivery.deliveriesEmpty')}
              subtitle={t('communityDelivery.deliveriesEmptyHint')}
              actionLabel={opportunities.error ? t('common:buttons.retry') : undefined}
              onAction={opportunities.error ? opportunities.refresh : undefined}
            />
          )
        }
        ListFooterComponent={opportunities.isLoadingMore ? <LoadingSpinner /> : opportunities.hasMore ? (
          <Button variant="secondary" onPress={opportunities.loadMore}><Button.Label>{t('loadMore')}</Button.Label></Button>
        ) : null}
        onEndReached={opportunities.loadMore}
        onEndReachedThreshold={0.35}
      />

      <BottomSheet visible={Boolean(selected)} onClose={() => { if (!submitting) setSelected(null); }} snapPoints={['62%', '90%']} scrollable>
        <Surface variant="default" className="rounded-panel p-4">
          <View className="mb-4 flex-row items-center justify-between">
            <Text className="min-w-0 flex-1 pr-3 text-lg font-bold" style={{ color: theme.text }}>{t('communityDelivery.offerTitle')}</Text>
            <CloseButton isDisabled={submitting} onPress={() => setSelected(null)} iconProps={{ size: 20, color: primary }} />
          </View>
          <Text className="mb-4 text-sm leading-5" style={{ color: theme.textSecondary }}>{t('communityDelivery.offerHint')}</Text>
          <Input label={t('communityDelivery.creditsLabel')} value={credits} onChangeText={setCredits} editable={!submitting} keyboardType="decimal-pad" />
          <Input label={t('communityDelivery.minutesLabel')} value={minutes} onChangeText={setMinutes} editable={!submitting} keyboardType="number-pad" />
          <Input label={t('communityDelivery.notesLabel')} value={notes} onChangeText={setNotes} editable={!submitting} multiline maxLength={500} />
          <Button variant="primary" isDisabled={submitting} onPress={() => void submitOffer()}>
            <Button.Label>{submitting ? t('communityDelivery.sending') : t('communityDelivery.sendOffer')}</Button.Label>
          </Button>
        </Surface>
      </BottomSheet>
    </SafeAreaView>
  );
}

function DeliveryOpportunityCard({ item, onOffer }: { item: MarketplaceDeliveryOpportunity; onOffer: () => void }) {
  const { t } = useTranslation('marketplace');
  const primary = usePrimaryColor();
  const theme = useTheme();
  const imageUrl = resolveImageUrl(item.listing?.image?.url);
  return (
    <Card className="overflow-hidden rounded-panel p-0" style={{ borderWidth: 1, borderColor: theme.border }}>
      <Card.Body className="gap-3 p-3.5">
        <View className="flex-row gap-3">
          <View className="h-20 w-20 items-center justify-center overflow-hidden rounded-panel-inner" style={{ backgroundColor: withAlpha(primary, 0.12) }}>
            {imageUrl ? <RemoteImage uri={imageUrl} className="h-full w-full" fallbackIcon="car-outline" /> : <Ionicons name="car-outline" size={28} color={primary} />}
          </View>
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-base font-bold" style={{ color: theme.text }} numberOfLines={2}>{item.listing?.title ?? t('communityDelivery.unknownListing')}</Text>
            {item.listing?.location ? <Text className="text-sm" style={{ color: theme.textSecondary }} numberOfLines={2}>{item.listing.location}</Text> : null}
            <Text className="text-xs" style={{ color: theme.textMuted }}>{t('orders.quantity', { count: item.quantity })}</Text>
          </View>
        </View>
        {item.my_offer ? (
          <View className="flex-row flex-wrap items-center gap-2">
            <Chip size="md" variant="secondary"><Chip.Label>{translatedDeliveryStatus(item.my_offer.status, t)}</Chip.Label></Chip>
            <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('orders.deliveryTimeCredits', { count: item.my_offer.time_credits })}</Text>
          </View>
        ) : null}
        {item.can_offer ? (
          <Button variant="primary" onPress={onOffer}>
            <AccentIcon name="car-outline" size={18} />
            <Button.Label numberOfLines={2}>{t('communityDelivery.offerAction')}</Button.Label>
          </Button>
        ) : (
          <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('communityDelivery.offerAlreadySent')}</Text>
        )}
      </Card.Body>
    </Card>
  );
}

function MarketplaceDeliveriesRoute() {
  const { tenant } = useTenant();
  const { user } = useAuth();
  return <MarketplaceDeliveriesScreen key={`${tenant?.id ?? tenant?.slug ?? 'no-tenant'}:${user?.id ?? 'no-user'}`} />;
}

function MarketplaceDeliveriesModal() {
  return <ModalErrorBoundary><MarketplaceDeliveriesRoute /></ModalErrorBoundary>;
}

export default withRouteGate(MarketplaceDeliveriesModal, 'marketplace-deliveries');
