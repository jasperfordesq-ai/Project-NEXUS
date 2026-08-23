// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState } from 'react';
import { FlatList, Image, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Chip, Surface, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import {
  acceptMarketplaceOffer,
  acceptMarketplaceCounterOffer,
  counterMarketplaceOffer,
  declineMarketplaceOffer,
  getMarketplaceOffers,
  marketplaceHasMore,
  marketplaceNextCursor,
  withdrawMarketplaceOffer,
  type MarketplaceOffer,
} from '@/lib/api/marketplace';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePaginatedApi } from '@/lib/hooks/usePaginatedApi';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { resolveImageUrl } from '@/lib/utils/resolveImageUrl';
import { dateLocale } from '@/lib/utils/dateLocale';
import { formatMarketplaceCurrency } from '@/lib/utils/marketplaceCurrency';

type OfferMode = 'sent' | 'received';

export default function MarketplaceOffersRoute() {
  return (
    <ModalErrorBoundary>
      <MarketplaceOffersScreen />
    </ModalErrorBoundary>
  );
}

function MarketplaceOffersScreen() {
  const { t } = useTranslation(['marketplace', 'common', 'auth']);
  const params = useLocalSearchParams<{ mode?: string | string[] }>();
  const { hasFeature } = useTenant();
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const [mode, setMode] = useState<OfferMode>(normalizeOfferMode(firstParam(params.mode)));
  const canLoadOffers = !isAuthLoading && isAuthenticated;
  const offers = usePaginatedApi<MarketplaceOffer, Awaited<ReturnType<typeof getMarketplaceOffers>>>(
    (cursor) => getMarketplaceOffers(mode, cursor),
    (response) => ({
      items: response.data,
      cursor: marketplaceNextCursor(response),
      hasMore: marketplaceHasMore(response),
    }),
    [mode],
    { enabled: canLoadOffers },
  );

  if (!hasFeature('marketplace')) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('offers.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
        <EmptyState icon="hand-left-outline" title={t('featureGate.title')} subtitle={t('featureGate.description')} />
      </SafeAreaView>
    );
  }

  if (isAuthLoading) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('offers.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
        <View className="py-16">
          <LoadingSpinner />
        </View>
      </SafeAreaView>
    );
  }

  if (!isAuthenticated) {
    return (
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('offers.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
        <EmptyState
          icon="hand-left-outline"
          title={t('offers.signInTitle')}
          subtitle={t('offers.signInHint')}
          actionLabel={t('auth:login.submit')}
          onAction={() => router.push('/(auth)/login' as Href)}
        />
      </SafeAreaView>
    );
  }

  async function action(kind: 'accept' | 'decline' | 'withdraw' | 'acceptCounter', offer: MarketplaceOffer) {
    try {
      if (kind === 'accept') await acceptMarketplaceOffer(offer.id);
      if (kind === 'decline') await declineMarketplaceOffer(offer.id);
      if (kind === 'withdraw') await withdrawMarketplaceOffer(offer.id);
      if (kind === 'acceptCounter') await acceptMarketplaceCounterOffer(offer.id);
      offers.refresh();
    } catch (err) {
      showToast({
        title: t('common:errors.alertTitle'),
        description: err instanceof Error ? err.message : t('offers.actionFailed'),
        variant: 'danger',
      });
    }
  }

  async function counter(offer: MarketplaceOffer, amount: number, message?: string | null) {
    try {
      await counterMarketplaceOffer(offer.id, { amount, message });
      offers.refresh();
    } catch (err) {
      showToast({
        title: t('common:errors.alertTitle'),
        description: err instanceof Error ? err.message : t('offers.counterFailed'),
        variant: 'danger',
      });
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('offers.title')} backLabel={t('common:back')} fallbackHref={'/(modals)/marketplace' as Href} />
      <FlatList
        data={offers.items}
        keyExtractor={(item) => String(item.id)}
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 132 }}
        ListHeaderComponent={
          <HeroCard className="mb-3 overflow-hidden rounded-panel p-0">
            <View className="h-1.5" style={{ backgroundColor: primary }} />
            <HeroCard.Body className="gap-4 p-4">
              <View className="flex-row items-start gap-3">
                <View className="size-13 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                  <Ionicons name="hand-left-outline" size={25} color={primary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('offers.eyebrow')}</Text>
                  <Text className="text-2xl font-bold" style={{ color: theme.text }}>{t('offers.title')}</Text>
                  <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('offers.subtitle')}</Text>
                </View>
              </View>
              <View className="flex-row gap-2">
                <HeroButton className="flex-1" variant={mode === 'received' ? 'primary' : 'secondary'} onPress={() => setMode('received')}>
                  <HeroButton.Label>{t('offers.received')}</HeroButton.Label>
                </HeroButton>
                <HeroButton className="flex-1" variant={mode === 'sent' ? 'primary' : 'secondary'} onPress={() => setMode('sent')}>
                  <HeroButton.Label>{t('offers.sentTab')}</HeroButton.Label>
                </HeroButton>
              </View>
            </HeroCard.Body>
          </HeroCard>
        }
        renderItem={({ item }) => (
          <OfferCard offer={item} mode={mode} onAction={action} onCounter={counter} />
        )}
        ListEmptyComponent={
          offers.isLoading ? (
            <View className="py-16">
              <LoadingSpinner />
            </View>
          ) : (
            <EmptyState
              icon={mode === 'sent' ? 'send-outline' : 'archive-outline'}
              title={offers.error ?? (mode === 'sent' ? t('offers.emptySent') : t('offers.emptyReceived'))}
              subtitle={mode === 'sent' ? t('offers.emptySentHint') : t('offers.emptyReceivedHint')}
            />
          )
        }
        ListFooterComponent={
          offers.isLoadingMore ? (
            <LoadingSpinner />
          ) : offers.hasMore ? (
            <HeroButton variant="secondary" onPress={offers.loadMore}>
              <HeroButton.Label>{t('loadMore')}</HeroButton.Label>
            </HeroButton>
          ) : null
        }
        onEndReached={offers.loadMore}
        onEndReachedThreshold={0.35}
      />
    </SafeAreaView>
  );
}

function firstParam(value?: string | string[]): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function normalizeOfferMode(value?: string): OfferMode {
  return value === 'received' ? 'received' : 'sent';
}

function formatOfferAmount(amount: number, currency: string): string {
  return formatMarketplaceCurrency(amount, currency);
}

function formatOfferDate(value?: string | null): string | null {
  if (!value) return null;
  try {
    return new Intl.DateTimeFormat(dateLocale(), { dateStyle: 'medium' }).format(new Date(value));
  } catch {
    return value;
  }
}

function OfferCard({
  offer,
  mode,
  onAction,
  onCounter,
}: {
  offer: MarketplaceOffer;
  mode: OfferMode;
  onAction: (kind: 'accept' | 'decline' | 'withdraw' | 'acceptCounter', offer: MarketplaceOffer) => void;
  onCounter: (offer: MarketplaceOffer, amount: number, message?: string | null) => void;
}) {
  const { t } = useTranslation('marketplace');
  const { tenant } = useTenant();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const [isCountering, setIsCountering] = useState(false);
  const [counterAmount, setCounterAmount] = useState('');
  const [counterMessage, setCounterMessage] = useState('');
  const listingId = offer.listing?.id;
  const currency = offer.currency || tenant?.currency || '';
  const amount = formatOfferAmount(Number(offer.amount), currency);
  const counterAmountLabel = offer.counter_amount ? formatOfferAmount(Number(offer.counter_amount), currency) : null;
  const counterparty = mode === 'sent' ? offer.seller : offer.buyer;
  const counterpartyLabel = mode === 'sent' ? t('offers.sellerLabel') : t('offers.buyerLabel');
  const offerDate = formatOfferDate(offer.created_at);
  const imageUrl = resolveImageUrl(offer.listing?.image?.thumbnail_url || offer.listing?.image?.url);

  function submitCounter() {
    const value = Number(counterAmount);
    if (!Number.isFinite(value) || value <= 0) {
      showToast({ title: t('offers.amountRequired'), description: t('offers.amountRequired'), variant: 'warning' });
      return;
    }
    onCounter(offer, value, counterMessage.trim() || null);
    setIsCountering(false);
    setCounterAmount('');
    setCounterMessage('');
  }

  return (
    <HeroCard className="mb-3 rounded-panel p-0">
      <HeroCard.Body className="gap-3 p-4">
        <View className="flex-row items-start gap-3">
          <View className="h-16 w-16 items-center justify-center overflow-hidden rounded-panel-inner" style={{ backgroundColor: withAlpha(primary, 0.12) }}>
            {imageUrl ? (
              <Image source={{ uri: imageUrl }} className="h-full w-full" resizeMode="cover" />
            ) : (
              <Ionicons name="pricetag-outline" size={24} color={primary} />
            )}
          </View>
          <View className="min-w-0 flex-1 gap-2">
            <View className="flex-row items-start justify-between gap-3">
              <View className="min-w-0 flex-1">
                <Text className="text-base font-bold" style={{ color: theme.text }} numberOfLines={2}>{offer.listing?.title ?? t('offers.listing')}</Text>
                <Text className="text-sm font-semibold" style={{ color: theme.textSecondary }}>{amount}</Text>
              </View>
              <Chip size="sm" variant="secondary">
                <Chip.Label>{t(`offers.status.${offer.status}`)}</Chip.Label>
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
        {offerDate ? (
          <Text className="text-xs" style={{ color: theme.textMuted }}>{t('offers.date', { date: offerDate })}</Text>
        ) : null}
        {offer.message ? <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{offer.message}</Text> : null}
        {offer.status === 'countered' && counterAmountLabel ? (
          <Surface variant="secondary" className="gap-1 rounded-panel-inner p-3">
            <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('offers.countered')}</Text>
            <Text className="text-base font-bold" style={{ color: theme.text }}>{counterAmountLabel}</Text>
            {offer.counter_message ? <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{offer.counter_message}</Text> : null}
          </Surface>
        ) : null}
        {isCountering ? (
          <Surface variant="secondary" className="gap-3 rounded-panel-inner p-3">
            <View className="gap-2">
              <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('offers.counterAmount')}</Text>
              <Input
                className="min-h-12 text-sm"
                style={{ color: theme.text }}
                placeholder={t('offers.amountPlaceholder')}
                placeholderTextColor={theme.textMuted}
                keyboardType="decimal-pad"
                value={counterAmount}
                onChangeText={setCounterAmount}
                accessibilityLabel={t('offers.counterAmount')}
              />
            </View>
            <View className="gap-2">
              <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{t('offers.counterMessage')}</Text>
              <Input
                className="min-h-20 text-sm"
                style={{ color: theme.text, textAlignVertical: 'top' }}
                placeholder={t('offers.counterMessagePlaceholder')}
                placeholderTextColor={theme.textMuted}
                multiline
                value={counterMessage}
                onChangeText={setCounterMessage}
                accessibilityLabel={t('offers.counterMessage')}
              />
            </View>
            <View className="flex-row gap-2">
              <HeroButton className="flex-1" size="sm" variant="secondary" onPress={() => setIsCountering(false)}>
                <HeroButton.Label>{t('offers.cancelCounter')}</HeroButton.Label>
              </HeroButton>
              <HeroButton className="flex-1" size="sm" variant="primary" onPress={submitCounter}>
                <HeroButton.Label>{t('offers.sendCounter')}</HeroButton.Label>
              </HeroButton>
            </View>
          </Surface>
        ) : null}
        <View className="flex-row flex-wrap gap-2">
          {listingId ? (
            <HeroButton
              className="flex-1"
              size="sm"
              variant="secondary"
              onPress={() => router.push({
                pathname: '/(modals)/marketplace-detail',
                params: {
                  id: String(listingId),
                  ...(mode === 'sent' && offer.status === 'accepted'
                    ? { offer_id: String(offer.id), offer_amount: String(offer.amount) }
                    : {}),
                },
              } as unknown as Href)}
              style={{ minWidth: '46%' }}
            >
              <Ionicons name="open-outline" size={14} color={primary} />
              <HeroButton.Label>{t('actions.view')}</HeroButton.Label>
            </HeroButton>
          ) : null}
          {mode === 'received' && offer.status === 'pending' ? (
            <>
              <HeroButton className="flex-1" size="sm" variant="primary" onPress={() => onAction('accept', offer)} style={{ minWidth: '46%', backgroundColor: theme.success }}>
                <HeroButton.Label>{t('offers.accept')}</HeroButton.Label>
              </HeroButton>
              <HeroButton className="flex-1" size="sm" variant="danger" onPress={() => onAction('decline', offer)} style={{ minWidth: '46%' }}>
                <HeroButton.Label>{t('offers.decline')}</HeroButton.Label>
              </HeroButton>
              <HeroButton className="flex-1" size="sm" variant="secondary" onPress={() => setIsCountering(true)} style={{ minWidth: '46%' }}>
                <HeroButton.Label>{t('offers.counter')}</HeroButton.Label>
              </HeroButton>
            </>
          ) : null}
          {mode === 'sent' && offer.status === 'pending' ? (
            <HeroButton className="flex-1" size="sm" variant="danger" onPress={() => onAction('withdraw', offer)} style={{ minWidth: '46%' }}>
              <HeroButton.Label>{t('offers.withdraw')}</HeroButton.Label>
            </HeroButton>
          ) : null}
          {mode === 'sent' && offer.status === 'countered' ? (
            <>
              <HeroButton className="flex-1" size="sm" variant="primary" onPress={() => onAction('acceptCounter', offer)} style={{ minWidth: '46%', backgroundColor: theme.success }}>
                <HeroButton.Label>{t('offers.acceptCounter')}</HeroButton.Label>
              </HeroButton>
              <HeroButton className="flex-1" size="sm" variant="danger" onPress={() => onAction('withdraw', offer)} style={{ minWidth: '46%' }}>
                <HeroButton.Label>{t('offers.withdraw')}</HeroButton.Label>
              </HeroButton>
            </>
          ) : null}
        </View>
      </HeroCard.Body>
    </HeroCard>
  );
}
