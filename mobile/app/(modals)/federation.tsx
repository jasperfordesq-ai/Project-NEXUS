// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useMemo, type ComponentProps, type ReactNode } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Card as HeroCard, Chip, Spinner, Surface } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import {
  getFederationActivity,
  getFederationPartners,
  getFederationStats,
  getFederationStatus,
  type FederatedTenant,
  type FederationActivityItem,
  type FederationStats,
  type FederationStatus,
} from '@/lib/api/federation';
import { useApi } from '@/lib/hooks/useApi';
import { usePaginatedApi } from '@/lib/hooks/usePaginatedApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import AppTopBar from '@/components/ui/AppTopBar';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import NativePressable from '@/components/ui/NativePressable';
import { dateLocale } from '@/lib/utils/dateLocale';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

const quickLinks: { key: string; icon: IoniconName; tone: string; href: '/(modals)/federation-partners' | '/(modals)/federation-members' | '/(modals)/federation-connections' | '/(modals)/federation-messages' | '/(modals)/federation-listings' | '/(modals)/federation-groups' | '/(modals)/federation-events' | '/(modals)/federation-onboarding' | '/(modals)/federation-settings' }[] = [
  { key: 'partners', icon: 'globe-outline', tone: '#6366f1', href: '/(modals)/federation-partners' },
  { key: 'members', icon: 'people-outline', tone: '#a855f7', href: '/(modals)/federation-members' },
  { key: 'connections', icon: 'person-add-outline', tone: '#14b8a6', href: '/(modals)/federation-connections' },
  { key: 'messages', icon: 'chatbubbles-outline', tone: '#06b6d4', href: '/(modals)/federation-messages' },
  { key: 'listings', icon: 'list-outline', tone: '#f59e0b', href: '/(modals)/federation-listings' },
  { key: 'groups', icon: 'people-circle-outline', tone: '#8b5cf6', href: '/(modals)/federation-groups' },
  { key: 'events', icon: 'calendar-outline', tone: '#f43f5e', href: '/(modals)/federation-events' },
  { key: 'setup', icon: 'rocket-outline', tone: '#22c55e', href: '/(modals)/federation-onboarding' },
  { key: 'settings', icon: 'settings-outline', tone: '#64748b', href: '/(modals)/federation-settings' },
];

function unwrapData<T>(response: { data?: T } | T | null | undefined, fallback: T): T {
  if (!response) return fallback;
  if (typeof response === 'object' && 'data' in response && response.data !== undefined) {
    return response.data as T;
  }
  return response as T;
}

function formatDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(dateLocale(), { month: 'long', year: 'numeric' });
}

function relativeTime(value: string, t: (key: string, opts?: Record<string, unknown>) => string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diffMs = Date.now() - date.getTime();
  const diffDays = Math.max(0, Math.floor(diffMs / 86_400_000));
  if (diffDays === 0) return t('relative.today');
  if (diffDays < 30) return t('relative.daysAgo', { count: diffDays });
  const diffMonths = Math.floor(diffDays / 30);
  return t('relative.monthsAgo', { count: diffMonths });
}

function federationEnabled(status: FederationStatus | null) {
  return status?.enabled === true || status?.tenant_federation_enabled === true || status?.federation_optin === true;
}

function StatTile({
  icon,
  label,
  value,
  tone,
  theme,
}: {
  icon: IoniconName;
  label: string;
  value: string;
  tone: string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <Surface
      variant="secondary"
      className="min-h-[78px] min-w-[46%] flex-1 flex-row items-center gap-3 rounded-panel-inner p-3"
      style={{ borderWidth: 1, borderColor: withAlpha(tone, 0.14) }}
    >
      <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(tone, 0.13) }}>
        <Ionicons name={icon} size={17} color={tone} />
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <Text className="text-xl font-bold leading-6" style={{ color: theme.text }} numberOfLines={1}>
          {value}
        </Text>
        <Text className="text-[11px] font-semibold uppercase leading-4" style={{ color: theme.textSecondary }} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Surface>
  );
}

function FederationHero({
  status,
  stats,
  primary,
  theme,
  t,
}: {
  status: FederationStatus | null;
  stats: FederationStats | null;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const enabled = federationEnabled(status);
  const partnerCount = stats?.partner_count ?? status?.partnerships_count ?? 0;
  const messages = stats?.messages_count ?? status?.messages_count ?? 0;
  const transactions = stats?.transactions_count ?? status?.transactions_count ?? stats?.cross_community_exchanges ?? 0;

  return (
    <HeroCard
      variant="default"
      className="mb-4 overflow-hidden rounded-panel p-0"
      style={{ borderWidth: 1, borderColor: withAlpha(primary, 0.16) }}
    >
      <View className="h-1.5" style={{ backgroundColor: primary }} />
      <HeroCard.Body className="gap-4 p-4">
        <View className="flex-row items-start gap-3">
          <View className="size-12 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
            <Ionicons name="git-network-outline" size={24} color={primary} />
          </View>
          <View className="min-w-0 flex-1 gap-2">
            <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>
              {t('hub.eyebrow')}
            </Text>
            <Text className="text-[23px] font-bold leading-7" style={{ color: theme.text }} numberOfLines={2}>
              {t('hub.heroTitle')}
            </Text>
            <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={4}>
              {t('hub.heroDescription')}
            </Text>
            <View className="items-start">
              <Chip size="sm" variant="secondary" color={enabled ? 'success' : 'warning'}>
                <Ionicons name={enabled ? 'checkmark-circle-outline' : 'pause-circle-outline'} size={13} color={enabled ? '#22c55e' : '#f59e0b'} />
                <Chip.Label>{enabled ? t('hub.statusActive') : t('hub.statusInactive')}</Chip.Label>
              </Chip>
            </View>
          </View>
        </View>

        <View className="flex-row flex-wrap gap-2">
          <StatTile icon="globe-outline" label={t('hub.statPartners')} value={String(partnerCount)} tone={primary} theme={theme} />
          <StatTile icon="chatbubbles-outline" label={t('hub.statMessages')} value={String(messages)} tone="#a855f7" theme={theme} />
          <StatTile icon="swap-horizontal-outline" label={t('hub.statExchanges')} value={String(transactions)} tone="#06b6d4" theme={theme} />
          <StatTile icon="pulse-outline" label={t('hub.statStatus')} value={enabled ? t('hub.shortActive') : t('hub.shortInactive')} tone="#22c55e" theme={theme} />
        </View>
      </HeroCard.Body>
    </HeroCard>
  );
}

function QuickLinksSection({
  theme,
  t,
}: {
  theme: ReturnType<typeof useTheme>;
  t: (key: string) => string;
}) {
  return (
    <View className="mb-4 gap-3">
      <SectionHeading title={t('hub.exploreNetwork')} theme={theme} />
      <View className="flex-row flex-wrap gap-2">
        {quickLinks.map((link) => (
          <NativePressable
            key={link.key}
            accessibilityLabel={t(`hub.quick.${link.key}.title`)}
            className="min-w-[31%] flex-1 rounded-panel-inner"
            onPress={() => {
              router.push(link.href as Href);
            }}
            feedback="highlight"
          >
            <Surface
              variant="secondary"
              className="min-h-[88px] w-full items-center justify-center gap-2 rounded-panel-inner p-3"
              style={{ borderWidth: 1, borderColor: withAlpha(link.tone, 0.14) }}
            >
              <View className="size-10 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(link.tone, 0.13) }}>
                <Ionicons name={link.icon} size={20} color={link.tone} />
              </View>
              <Text className="text-center text-xs font-bold leading-4" style={{ color: theme.text }} numberOfLines={1} adjustsFontSizeToFit>
                {t(`hub.quick.${link.key}.title`)}
              </Text>
            </Surface>
          </NativePressable>
        ))}
      </View>
    </View>
  );
}

function PartnerCard({
  item,
  primary,
  theme,
  t,
}: {
  item: FederatedTenant;
  primary: string;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const connectedDate = formatDate(item.connected_since ?? item.partnership_since);

  return (
    <NativePressable
      accessibilityLabel={item.name}
      className="mb-3 w-full rounded-panel"
      onPress={() => {
        router.push({ pathname: '/(modals)/federation-partner', params: { id: String(item.id) } });
      }}
      feedback="highlight"
    >
      <HeroCard
        variant="default"
        className="w-full overflow-hidden rounded-panel p-0"
        style={{ borderWidth: 1, borderColor: withAlpha(primary, 0.12) }}
      >
        <HeroCard.Body className="gap-3 p-4">
          <View className="absolute bottom-0 left-0 top-0 w-1" style={{ backgroundColor: primary }} />
          <View className="flex-row items-start gap-3 pl-1">
            <Avatar uri={item.logo} name={item.name} size={48} />
            <View className="min-w-0 flex-1 gap-1">
              <Text className="text-base font-bold" style={{ color: theme.text }} numberOfLines={2}>
                {item.name}
              </Text>
              {item.location ? (
                <View className="flex-row items-center gap-1">
                  <Ionicons name="location-outline" size={13} color={theme.textSecondary} />
                  <Text className="min-w-0 flex-1 text-xs" style={{ color: theme.textSecondary }} numberOfLines={1}>
                    {item.location}
                  </Text>
                </View>
              ) : null}
              {item.tagline || item.description ? (
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>
                  {item.tagline || item.description}
                </Text>
              ) : null}
            </View>
            <View className="size-8 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.1) }}>
              <Ionicons name="chevron-forward-outline" size={17} color={primary} />
            </View>
          </View>

          <View className="flex-row flex-wrap items-center gap-2 pl-1">
            {item.federation_level_name ? (
              <Chip size="sm" variant="secondary">
                <Chip.Label numberOfLines={1}>{item.federation_level_name}</Chip.Label>
              </Chip>
            ) : null}
            <Chip size="sm" variant="secondary">
              <Ionicons name="people-outline" size={12} color={primary} />
              <Chip.Label>{t('hub.memberCount', { count: item.member_count ?? 0 })}</Chip.Label>
            </Chip>
            {connectedDate ? (
              <Chip size="sm" variant="secondary">
                <Ionicons name="time-outline" size={12} color={theme.textSecondary} />
                <Chip.Label>{t('connectedSince', { date: connectedDate })}</Chip.Label>
              </Chip>
            ) : null}
          </View>

          <Text className="pl-1 text-sm font-semibold" style={{ color: primary }} numberOfLines={1}>
            {t('hub.viewCommunity')}
          </Text>
        </HeroCard.Body>
      </HeroCard>
    </NativePressable>
  );
}

function ActivityCard({
  item,
  theme,
  t,
}: {
  item: FederationActivityItem;
  theme: ReturnType<typeof useTheme>;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const iconByType: Record<FederationActivityItem['type'], IoniconName> = {
    message_received: 'chatbubble-ellipses-outline',
    message_sent: 'send-outline',
    transaction_received: 'swap-horizontal-outline',
    transaction_sent: 'swap-horizontal-outline',
    partnership_approved: 'hand-left-outline',
    member_joined: 'person-add-outline',
  };

  return (
    <Surface
      variant="secondary"
      className="gap-2 rounded-panel-inner p-3"
      style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
    >
      <View className="flex-row items-start gap-3">
        <View className="size-9 items-center justify-center rounded-2xl" style={{ backgroundColor: theme.surface }}>
          <Ionicons name={iconByType[item.type] ?? 'pulse-outline'} size={18} color={theme.textSecondary} />
        </View>
        <View className="min-w-0 flex-1 gap-1">
          <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={2}>
            {item.title}
          </Text>
          <Text className="text-xs leading-4" style={{ color: theme.textSecondary }} numberOfLines={2}>
            {item.description}
          </Text>
          <Text className="text-[11px]" style={{ color: theme.textMuted }}>
            {relativeTime(item.created_at, t)}
          </Text>
        </View>
      </View>
    </Surface>
  );
}

function SectionHeading({
  title,
  theme,
}: {
  title: string;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="min-w-0 flex-1 text-lg font-bold" style={{ color: theme.text }} numberOfLines={2}>
        {title}
      </Text>
    </View>
  );
}

function SectionCard({
  title,
  children,
  theme,
}: {
  title: string;
  children: ReactNode;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View className="mb-4 gap-3">
      <SectionHeading title={title} theme={theme} />
      {children}
    </View>
  );
}

export default function FederationScreen() {
  const { t } = useTranslation(['federation', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();

  const { data: statsResponse, refresh: refreshStats } = useApi(() => getFederationStats(), []);
  const { data: statusResponse, refresh: refreshStatus } = useApi(() => getFederationStatus(), []);
  const { data: activityResponse, refresh: refreshActivity } = useApi(() => getFederationActivity(), []);

  const stats = unwrapData<FederationStats | null>(statsResponse, null);
  const status = unwrapData<FederationStatus | null>(statusResponse, null);
  const activity = unwrapData<FederationActivityItem[]>(activityResponse, []);

  const fetchPartners = useCallback((cursor: string | null) => getFederationPartners(cursor), []);
  const extractPartners = useCallback((response: Awaited<ReturnType<typeof getFederationPartners>>) => ({
    items: response.data,
    cursor: response.meta.cursor,
    hasMore: response.meta.has_more,
  }), []);

  const {
    items: partners,
    isLoading: partnersLoading,
    isLoadingMore,
    hasMore,
    loadMore,
    refresh,
  } = usePaginatedApi(fetchPartners, extractPartners);

  const initialLoading = partnersLoading && partners.length === 0;
  const partnerPreview = useMemo(() => partners.slice(0, 4), [partners]);

  const refreshAll = useCallback(() => {
    refreshStats();
    refreshStatus();
    refreshActivity();
    refresh();
  }, [refresh, refreshActivity, refreshStats, refreshStatus]);

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('title')} backLabel={t('common:back')} fallbackHref="/(tabs)/home" />

        <FlatList<FederatedTenant>
          data={partners}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => <PartnerCard item={item} primary={primary} theme={theme} t={t} />}
          refreshControl={
            <RefreshControl
              refreshing={partnersLoading && partners.length > 0}
              onRefresh={refreshAll}
              tintColor={primary}
              colors={[primary]}
            />
          }
          ListHeaderComponent={
            <View className="pb-2">
              <FederationHero status={status} stats={stats} primary={primary} theme={theme} t={t} />

              <QuickLinksSection theme={theme} t={t} />

              <SectionCard title={t('hub.partnerCommunities')} theme={theme}>
                {initialLoading ? (
                  <Surface variant="secondary" className="items-center rounded-panel p-5">
                    <Spinner size="sm" />
                  </Surface>
                ) : partnerPreview.length === 0 ? (
                  <Surface variant="secondary" className="rounded-panel p-5">
                    <EmptyState icon="globe-outline" title={t('hub.noPartnersYet')} subtitle={t('hub.noPartnersDescription')} />
                  </Surface>
                ) : null}
              </SectionCard>
            </View>
          }
          ListFooterComponent={
            <View className="pb-8 pt-2">
              {isLoadingMore ? (
                <View className="items-center py-4">
                  <Spinner size="sm" />
                </View>
              ) : null}

              <SectionCard title={t('hub.recentActivity')} theme={theme}>
                {activity.length === 0 ? (
                  <Surface variant="secondary" className="items-center gap-2 rounded-panel p-5">
                    <Ionicons name="pulse-outline" size={30} color={theme.textMuted} />
                    <Text className="text-center text-sm font-semibold" style={{ color: theme.text }}>
                      {t('hub.noActivityYet')}
                    </Text>
                    <Text className="text-center text-xs leading-4" style={{ color: theme.textSecondary }}>
                      {t('hub.noActivityDescription')}
                    </Text>
                  </Surface>
                ) : (
                  <View className="gap-2">
                    {activity.slice(0, 5).map((item) => (
                      <ActivityCard key={item.id} item={item} theme={theme} t={t} />
                    ))}
                  </View>
                )}
              </SectionCard>
            </View>
          }
          onEndReached={() => { if (hasMore) loadMore(); }}
          onEndReachedThreshold={0.3}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 8 }}
        />
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}
