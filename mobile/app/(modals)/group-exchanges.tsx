// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Spinner, Surface } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { getGroupExchanges, type GroupExchange, type GroupExchangeStatus } from '@/lib/api/groupExchanges';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import NativePressable from '@/components/ui/NativePressable';
import { dateLocale } from '@/lib/utils/dateLocale';

const statusFilters = ['all', 'active', 'pending_confirmation', 'completed', 'cancelled'] as const;
type StatusFilter = (typeof statusFilters)[number];

const statusTones: Record<GroupExchangeStatus, string> = {
  draft: '#64748b',
  pending_participants: '#f59e0b',
  pending_broker: '#8b5cf6',
  active: '#0ea5e9',
  pending_confirmation: '#f59e0b',
  completed: '#22c55e',
  cancelled: '#ef4444',
  disputed: '#ef4444',
};

/**
 * 🔴 This read `response.data.data` with `response.data.has_more`, and the server sends
 * neither. `GET /v2/group-exchanges` answers `{ data: [...], meta: { has_more } }` — the
 * list is `data` itself and the flag lives in `meta`. So `items` was ALWAYS empty and the
 * screen always said "No group exchanges found".
 *
 * Measured on a device on 2026-08-24: a group exchange was created through the app
 * (`POST /v2/group-exchanges` → 201), the app opened its detail screen, and the list it
 * came from still showed the empty state — while the same request answered with that exact
 * exchange when made by hand. Nothing an organiser created was ever visible in the list,
 * and "Group exchanges you organise or join will appear here" made that read as "you have
 * none" rather than "this screen cannot see them".
 *
 * Both shapes are accepted now — the wrapped one costs nothing to keep and stops a future
 * server-side envelope change from emptying the screen again in silence.
 */
function unwrapGroupExchanges(response: unknown): { items: GroupExchange[]; hasMore: boolean } {
  const body = response as {
    data?: GroupExchange[] | { data?: GroupExchange[]; has_more?: boolean };
    meta?: { has_more?: boolean };
  } | null;

  if (Array.isArray(body?.data)) {
    return { items: body.data, hasMore: Boolean(body?.meta?.has_more) };
  }

  const nested = body?.data as { data?: GroupExchange[]; has_more?: boolean } | undefined;
  return {
    items: Array.isArray(nested?.data) ? nested.data : [],
    hasMore: Boolean(nested?.has_more ?? body?.meta?.has_more),
  };
}

function formatDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function GroupExchangesScreen() {
  return (
    <ModalErrorBoundary>
      <GroupExchangesScreenInner />
    </ModalErrorBoundary>
  );
}

function GroupExchangesScreenInner() {
  const { t } = useTranslation(['exchanges', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const [status, setStatus] = useState<StatusFilter>('all');
  const { data, isLoading, error, refresh } = useApi(() => getGroupExchanges({ status, limit: 20, offset: 0 }), [status]);
  const { items, hasMore } = useMemo(() => unwrapGroupExchanges(data), [data]);

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('groupExchanges.title')} backLabel={t('common:buttons.back')} fallbackHref="/(tabs)/profile" />
      <ScrollView
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} tintColor={primary} colors={[primary]} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 112 }}
      >
        <HeroCard className="mb-4 overflow-hidden rounded-panel p-0">
          <View className="h-1.5" style={{ backgroundColor: primary }} />
          <HeroCard.Body className="gap-3 p-4">
            <View className="flex-row items-center gap-3">
              <View className="h-11 w-11 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                <Ionicons name="swap-horizontal-outline" size={22} color={primary} />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>{t('groupExchanges.eyebrow')}</Text>
                <Text className="text-2xl font-bold leading-8" style={{ color: theme.text }}>{t('groupExchanges.title')}</Text>
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('groupExchanges.subtitle')}</Text>
              </View>
            </View>
            <HeroButton
              variant="primary"
              onPress={() => router.push('/(modals)/new-group-exchange' as Href)}
              accessibilityLabel={t('groupExchanges.create.open')}
            >
              <HeroButton.Label>{t('groupExchanges.create.open')}</HeroButton.Label>
              <Ionicons name="add-outline" size={16} color={theme.onPrimary} />
            </HeroButton>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {statusFilters.map((value) => (
                <HeroButton
                  key={value}
                  size="sm"
                  variant={status === value ? 'primary' : 'secondary'}
                  onPress={() => setStatus(value)}
                  accessibilityState={{ selected: status === value }}
                >
                  <HeroButton.Label>{t(`groupExchanges.filters.${value}`)}</HeroButton.Label>
                </HeroButton>
              ))}
            </ScrollView>
          </HeroCard.Body>
        </HeroCard>

        {isLoading ? (
          <View className="items-center py-8"><Spinner size="lg" /></View>
        ) : error ? (
          <EmptyState icon="warning-outline" title={t('groupExchanges.errorTitle')} subtitle={t('groupExchanges.errorDescription')} />
        ) : items.length === 0 ? (
          <EmptyState icon="git-compare-outline" title={t('groupExchanges.emptyTitle')} subtitle={t(status === 'all' ? 'groupExchanges.emptyAll' : 'groupExchanges.emptyFiltered')} />
        ) : (
          <View className="gap-3">
            {items.map((exchange) => <GroupExchangeCard key={exchange.id} exchange={exchange} />)}
            {hasMore ? (
              <Surface variant="secondary" className="rounded-panel p-3">
                <Text className="text-center text-sm" style={{ color: theme.textSecondary }}>{t('groupExchanges.moreAvailable')}</Text>
              </Surface>
            ) : null}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );

  function GroupExchangeCard({ exchange }: { exchange: GroupExchange }) {
    const tone = statusTones[exchange.status] ?? primary;
    const createdDate = formatDate(exchange.created_at);

    return (
      <NativePressable
        className="w-full p-0"
        accessibilityLabel={[
          exchange.title,
          t(`groupExchanges.status.${exchange.status}`),
          typeof exchange.participant_count === 'number' ? t('groupExchanges.participants', { count: exchange.participant_count }) : '',
          t('groupExchanges.hours', { count: Number(exchange.total_hours) }),
          t(`groupExchanges.split.${exchange.split_type}`),
          createdDate,
        ].filter(Boolean).join(', ')}
        onPress={() => router.push({ pathname: '/(modals)/group-exchange-detail', params: { id: String(exchange.id) } } as unknown as Href)}
        feedback="highlight"
      >
        <HeroCard className="w-full rounded-panel p-0">
          <HeroCard.Body className="gap-3 p-4">
            <View className="flex-row items-start gap-3">
              <Avatar uri={exchange.organizer_avatar ?? null} name={exchange.organizer_name ?? t('groupExchanges.unknownOrganizer')} size={48} />
              <View className="min-w-0 flex-1 gap-1">
                <Text className="text-base font-bold leading-6" style={{ color: theme.text }} numberOfLines={2}>{exchange.title}</Text>
                {exchange.organizer_name ? (
                  <Text className="text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>{exchange.organizer_name}</Text>
                ) : null}
              </View>
            </View>

            {exchange.description ? (
              <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>{exchange.description}</Text>
            ) : null}

            <View className="flex-row flex-wrap gap-2">
              <Surface variant="secondary" className="rounded-full px-3 py-1.5">
                <Text className="text-xs font-medium" style={{ color: theme.textSecondary }}>{t(`groupExchanges.status.${exchange.status}`)}</Text>
              </Surface>
              {typeof exchange.participant_count === 'number' ? (
                <Surface variant="secondary" className="flex-row items-center gap-1 rounded-full px-3 py-1.5">
                  <Ionicons name="people-outline" size={12} color={tone} />
                  <Text className="text-xs font-medium" style={{ color: theme.textSecondary }}>{t('groupExchanges.participants', { count: exchange.participant_count })}</Text>
                </Surface>
              ) : null}
              <Surface variant="secondary" className="flex-row items-center gap-1 rounded-full px-3 py-1.5">
                <Ionicons name="time-outline" size={12} color={tone} />
                <Text className="text-xs font-medium" style={{ color: theme.textSecondary }}>{t('groupExchanges.hours', { count: Number(exchange.total_hours) })}</Text>
              </Surface>
              <Surface variant="secondary" className="flex-row items-center gap-1 rounded-full px-3 py-1.5">
                <Ionicons name="git-compare-outline" size={12} color={tone} />
                <Text className="text-xs font-medium" style={{ color: theme.textSecondary }}>{t(`groupExchanges.split.${exchange.split_type}`)}</Text>
              </Surface>
              {createdDate ? (
                <Surface variant="secondary" className="flex-row items-center gap-1 rounded-full px-3 py-1.5">
                  <Ionicons name="calendar-outline" size={12} color={tone} />
                  <Text className="text-xs font-medium" style={{ color: theme.textSecondary }}>{createdDate}</Text>
                </Surface>
              ) : null}
            </View>
          </HeroCard.Body>
        </HeroCard>
      </NativePressable>
    );
  }
}
