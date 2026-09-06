// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The member's exchanges — the requests they have sent and received.
 *
 * 🔴 NEW on 2026-08-21, and until now there was nowhere in the app to see this at all.
 * `GET /api/v2/exchanges` had never been called from mobile, so an exchange request sent
 * from the phone became invisible the moment the sheet closed, and one received arrived
 * only as a notification whose link led to "Listing not found".
 *
 * Split into "waiting on you" and everything else, because the whole point of the screen
 * is that an exchange stalls until somebody acts. The provider accepting, either side
 * starting, and both sides confirming hours are all steps a member must be told about.
 */

import { useCallback, useMemo } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { Surface } from 'heroui-native';
import { Chip } from '@/components/ui/StatusChip';
import { useTranslation } from 'react-i18next';

import {
  exchangeRequestActions,
  listExchangeRequests,
  type ExchangeRequest,
} from '@/lib/api/exchangeRequests';
import { useApi } from '@/lib/hooks/useApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { useTheme } from '@/lib/hooks/useTheme';
import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import NativePressable from '@/components/ui/NativePressable';
import { dateLocale } from '@/lib/utils/dateLocale';

function formatDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(dateLocale(), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

/**
 * Status colour. Deliberately three buckets rather than nine: a member reads "needs me",
 * "in flight" or "finished", and nine shades of chip would say less, not more.
 */
function statusTone(status: ExchangeRequest['status']): 'warning' | 'success' | 'default' {
  if (status === 'completed') return 'success';
  if (status === 'cancelled' || status === 'expired' || status === 'disputed') return 'default';
  return 'warning';
}

function ExchangeRequestsScreen() {
  const { t } = useTranslation('exchanges');
  const theme = useTheme();
  const { user } = useAuth();
  const viewerId = user?.id ?? null;

  const { data, isLoading, error, refresh } = useApi(() => listExchangeRequests({ perPage: 50 }), []);

  // Re-read on focus, for the same reason as the detail screen: the other member acts on
  // their own phone, and a stale list hides an exchange that now needs this member.
  useFocusEffect(
    useCallback(() => {
      refresh();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []),
  );

  const items = useMemo<ExchangeRequest[]>(() => {
    const rows = data?.data;
    return Array.isArray(rows) ? rows : [];
  }, [data]);

  const { waiting, rest } = useMemo(() => {
    const needsMe: ExchangeRequest[] = [];
    const other: ExchangeRequest[] = [];
    for (const item of items) {
      const actions = exchangeRequestActions(item, viewerId);
      const actionable =
        actions.canAccept || actions.canStart || actions.canComplete || actions.canConfirm;
      (actionable ? needsMe : other).push(item);
    }
    return { waiting: needsMe, rest: other };
  }, [items, viewerId]);

  const openDetail = useCallback((id: number) => {
    router.push({ pathname: '/(modals)/exchange-request-detail', params: { id: String(id) } });
  }, []);

  const renderRow = (item: ExchangeRequest) => {
    // Whose exchange is this from the member's point of view? The counterparty's name is
    // the only thing that makes a list of exchanges readable.
    const isProvider = item.provider_id === viewerId;
    const counterparty = isProvider ? item.requester?.name : item.provider?.name;
    const hours = item.final_hours ?? item.proposed_hours;

    return (
      <NativePressable
        key={item.id}
        onPress={() => openDetail(item.id)}
        accessibilityRole="button"
        accessibilityLabel={t('requests.openLabel', {
          title: item.listing?.title ?? t('requests.untitledListing'),
        })}
        className="w-full"
        testID={`exchange-request-${item.id}`}
      >
        <Surface variant="secondary" className="mb-3 rounded-2xl p-4">
          <View className="mb-2 flex-row flex-wrap items-center gap-2">
            <Chip color={statusTone(item.status)} size="sm" variant="soft">
              <Chip.Label>{t(`requests.status.${item.status}`)}</Chip.Label>
            </Chip>
            <Chip variant="secondary" size="sm">
              <Chip.Label>
                {isProvider ? t('requests.roleProvider') : t('requests.roleRequester')}
              </Chip.Label>
            </Chip>
          </View>

          <Text className="text-base font-semibold text-foreground" numberOfLines={2}>
            {item.listing?.title ?? t('requests.untitledListing')}
          </Text>

          <Text className="mt-1 text-sm text-muted-foreground" numberOfLines={1}>
            {counterparty
              ? t('requests.withMember', { name: counterparty })
              : t('requests.withMemberUnknown')}
          </Text>

          <View className="mt-2 flex-row flex-wrap items-center gap-x-3 gap-y-1">
            <Text className="text-sm text-muted-foreground">
              {t('requests.hoursValue', { count: hours })}
            </Text>
            {formatDate(item.created_at) ? (
              <Text className="text-sm text-muted-foreground">{formatDate(item.created_at)}</Text>
            ) : null}
          </View>
        </Surface>
      </NativePressable>
    );
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={t('requests.title')} backLabel={t('common:back')} />

      {isLoading && items.length === 0 ? (
        <LoadingSpinner />
      ) : error ? (
        <View className="px-4">
          <ErrorState
            title={t('requests.loadFailed')}
            subtitle={error}
            onRetry={refresh}
            testID="exchange-requests-error"
          />
        </View>
      ) : (
        <ScrollView
          className="flex-1 px-4"
          contentContainerStyle={{ paddingBottom: 32 }}
          refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} />}
        >
          {items.length === 0 ? (
            <EmptyState
              icon="swap-horizontal-outline"
              title={t('requests.emptyTitle')}
              subtitle={t('requests.emptySubtitle')}
            />
          ) : (
            <>
              {waiting.length > 0 ? (
                <>
                  <Text className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('requests.sectionWaiting')}
                  </Text>
                  {waiting.map(renderRow)}
                </>
              ) : null}

              {rest.length > 0 ? (
                <>
                  <Text className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('requests.sectionOther')}
                  </Text>
                  {rest.map(renderRow)}
                </>
              ) : null}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

export default function ExchangeRequestsModal() {
  return (
    <ModalErrorBoundary>
      <ExchangeRequestsScreen />
    </ModalErrorBoundary>
  );
}
