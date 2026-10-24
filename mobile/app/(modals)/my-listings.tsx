// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * My listings — the signed-in member's own offers and requests, in every state.
 *
 * Every other listings view in the app (the Listings tab, search, a member's profile)
 * shows only listings that are live and approved. So until this screen existed, a member
 * could not find their own listing again once it had expired, was waiting for an
 * administrator, or was not approved — the case the website's /listings/mine page was
 * built for. Same endpoint (GET /v2/listings/mine), same five groups, same wording.
 *
 * Renew, edit and delete live on the listing's own screen (`exchange-detail`), which
 * already offers them to the owner; a row here opens it.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { Spinner, Surface } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import ExchangeCard from '@/components/ExchangeCard';
import AppTopBar from '@/components/ui/AppTopBar';
import ChoiceChips from '@/components/ui/ChoiceChips';
import EmptyState from '@/components/ui/EmptyState';
import ErrorState from '@/components/ui/ErrorState';
import { ExchangeCardSkeleton } from '@/components/ui/Skeleton';
import { withRouteGate } from '@/components/withRouteGate';
import {
  getMyListings,
  OWNED_LISTING_GROUPS,
  type OwnedListing,
  type OwnedListingGroup,
  type OwnedListingsResponse,
} from '@/lib/api/exchanges';
import { usePaginatedApi } from '@/lib/hooks/usePaginatedApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { dateLocale } from '@/lib/utils/dateLocale';

type GroupCounts = Record<OwnedListingGroup, number>;

const EMPTY_COUNTS: GroupCounts = { live: 0, review: 0, rejected: 0, expired: 0, closed: 0 };
/** Shown even when empty — the two states every member can reach (as on the website). */
const ALWAYS_SHOWN: readonly OwnedListingGroup[] = ['live', 'expired'];

function isGroup(value: unknown): value is OwnedListingGroup {
  return typeof value === 'string' && (OWNED_LISTING_GROUPS as readonly string[]).includes(value);
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

function MyListingsRoute() {
  return (
    <ModalErrorBoundary>
      <MyListingsScreen />
    </ModalErrorBoundary>
  );
}

function MyListingsScreen() {
  const { t } = useTranslation(['exchanges', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  // `?tab=expired` (the website's own parameter) opens straight on that group.
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const [group, setGroup] = useState<OwnedListingGroup>(isGroup(tabParam) ? tabParam : 'live');
  const [counts, setCounts] = useState<GroupCounts>(EMPTY_COUNTS);

  const extractPage = useCallback((response: OwnedListingsResponse) => {
    if (response.meta?.counts) setCounts({ ...EMPTY_COUNTS, ...response.meta.counts });
    return {
      items: Array.isArray(response.data) ? response.data : [],
      cursor: response.meta?.cursor ?? null,
      hasMore: Boolean(response.meta?.has_more),
    };
  }, []);

  const fetcher = useCallback((cursor: string | null) => getMyListings(group, cursor, 20), [group]);

  const { items, isLoading, isLoadingMore, error, hasMore, loadMore, refresh } =
    usePaginatedApi<OwnedListing, OwnedListingsResponse>(fetcher, extractPage, [group]);

  /*
    Renewing, editing or deleting happens on the listing's own screen. Refetch on return
    so the listing has moved to its new group by the time the member is back here.
  */
  const hasFocusedOnceRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedOnceRef.current) {
        hasFocusedOnceRef.current = true;
        return;
      }
      refresh();
    }, [refresh]),
  );

  const groupOptions = useMemo(
    () =>
      OWNED_LISTING_GROUPS
        .filter((value) => ALWAYS_SHOWN.includes(value) || counts[value] > 0 || value === group)
        .map((value) => ({
          value,
          label: `${t(`mine.tab.${value}`)} (${counts[value]})`,
        })),
    [counts, group, t],
  );

  function stateLine(listing: OwnedListing): string | null {
    switch (group) {
      case 'live': {
        const until = formatDate(listing.expires_at);
        return until ? t('mine.visibleUntil', { date: until }) : null;
      }
      case 'review':
        return t('mine.state.review');
      case 'rejected':
        return listing.rejection_reason
          ? `${t('mine.state.rejected')} ${t('mine.rejectedReason', { reason: listing.rejection_reason })}`
          : t('mine.state.rejected');
      case 'expired':
        return t('mine.state.expired');
      case 'closed':
        return t('mine.state.closed');
      default:
        return null;
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar
        title={t('mine.title')}
        backLabel={t('common:back')}
        fallbackHref={'/(tabs)/exchanges' as Href}
        rightAction={{
          accessibilityLabel: t('mine.newListing'),
          icon: 'add-outline',
          onPress: () => router.push('/(modals)/new-exchange'),
        }}
      />
      <FlatList<OwnedListing>
        testID="my-listings-list"
        data={items}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => {
          const line = stateLine(item);
          return (
            <View>
              <ExchangeCard exchange={item} />
              {line ? (
                <Text
                  className="mx-6 -mt-1 mb-2 text-xs leading-4"
                  style={{ color: group === 'rejected' ? theme.error : theme.textSecondary }}
                >
                  {line}
                </Text>
              ) : null}
            </View>
          );
        }}
        refreshControl={
          <RefreshControl
            refreshing={isLoading && items.length > 0}
            onRefresh={refresh}
            tintColor={primary}
            colors={[primary]}
          />
        }
        onEndReached={() => { if (hasMore) loadMore(); }}
        onEndReachedThreshold={0.3}
        ListHeaderComponent={
          <View className="gap-3 px-4 pb-3 pt-2">
            <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
              {t('mine.description')}
            </Text>
            <Surface variant="default" className="rounded-panel p-3">
              <ChoiceChips
                testID="my-listings-group"
                label={t('mine.tabsLabel')}
                options={groupOptions}
                selected={group}
                onSelect={(value) => { if (value) setGroup(value); }}
              />
            </Surface>
          </View>
        }
        ListEmptyComponent={
          isLoading ? (
            <><ExchangeCardSkeleton /><ExchangeCardSkeleton /></>
          ) : error ? (
            <ErrorState title={t('mine.loadError')} subtitle={error} onRetry={refresh} isRetrying={isLoading} />
          ) : (
            <View className="px-4 pt-4">
              <EmptyState
                icon="clipboard-outline"
                title={t(`mine.empty.${group}`)}
                subtitle={group === 'live' ? t('mine.emptyLiveBody') : undefined}
                actionLabel={group === 'live' ? t('mine.newListing') : undefined}
                onAction={group === 'live' ? () => router.push('/(modals)/new-exchange') : undefined}
              />
            </View>
          )
        }
        ListFooterComponent={
          error && items.length > 0 ? (
            <ErrorState subtitle={error} onRetry={loadMore} isRetrying={isLoadingMore} />
          ) : isLoadingMore ? (
            <View className="items-center py-4"><Spinner size="sm" /></View>
          ) : !hasMore && items.length > 0 && !isLoading ? (
            <View className="items-center py-4">
              <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('common:endOfList')}</Text>
            </View>
          ) : null
        }
        contentContainerStyle={{ paddingBottom: 112 }}
      />
    </SafeAreaView>
  );
}

export default withRouteGate(MyListingsRoute, 'my-listings');
