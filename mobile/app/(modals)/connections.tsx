// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useMemo, useState, type ComponentProps } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button as HeroButton, Card as HeroCard, Chip, Spinner, Surface, Tabs, Text } from 'heroui-native';
import * as Haptics from '@/lib/haptics';
import { useTranslation } from 'react-i18next';

import {
  acceptConnection,
  getConnections,
  removeConnection,
  type Connection,
  type ConnectionListResponse,
  type ConnectionListStatus,
} from '@/lib/api/connections';
import { displayName } from '@/lib/api/messages';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { dateLocale } from '@/lib/utils/dateLocale';

type ConnectionTab = ConnectionListStatus;

const tabs: ConnectionTab[] = ['accepted', 'pending_received', 'pending_sent'];

function unwrapConnections(response: ConnectionListResponse | Connection[] | null | undefined): Connection[] {
  if (!response) return [];
  if (Array.isArray(response)) return response;
  return Array.isArray(response.data) ? response.data : [];
}

function connectionId(connection: Connection): number {
  return connection.connection_id ?? connection.id ?? 0;
}

function formatDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function ConnectionsRoute() {
  return (
    <ModalErrorBoundary>
      <ConnectionsScreen />
    </ModalErrorBoundary>
  );
}

function ConnectionsScreen() {
  const { t } = useTranslation(['members', 'common']);
  const [tab, setTab] = useState<ConnectionTab>('accepted');
  const [actionId, setActionId] = useState<number | null>(null);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { data, isLoading, error, refresh } = useApi(() => getConnections(tab), [tab]);
  const connections = useMemo(() => unwrapConnections(data), [data]);

  async function runAction(connection: Connection, action: 'accept' | 'remove') {
    const id = connectionId(connection);
    if (!id) return;
    setActionId(id);
    try {
      if (action === 'accept') await acceptConnection(id);
      if (action === 'remove') await removeConnection(id);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      refresh();
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      showToast({ title: t('connections.actionFailedTitle'), description: t('connections.actionFailedDescription'), variant: 'danger' });
    } finally {
      setActionId(null);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('connections.title')} backLabel={t('common:back')} fallbackHref="/(tabs)/profile" />
      <ScrollView
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} tintColor={primary} colors={[primary]} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      >
        <HeroCard className="mb-3 overflow-hidden rounded-panel p-0">
          <View className="h-1" style={{ backgroundColor: primary }} />
          <HeroCard.Body className="gap-4 p-4">
            <View className="flex-row items-center gap-3">
              <View className="h-12 w-12 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                <Ionicons name="people-outline" size={24} color={primary} />
              </View>
              <View className="min-w-0 flex-1 gap-1">
                <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>{t('connections.eyebrow')}</Text>
                <Text className="text-[26px] font-bold leading-8" style={{ color: theme.text }} numberOfLines={1}>{t('connections.title')}</Text>
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>{t('connections.subtitle')}</Text>
              </View>
            </View>
            <Surface
              variant="secondary"
              className="overflow-hidden rounded-2xl p-2"
              style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
            >
              <Tabs value={tab} onValueChange={(value) => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setTab(value as ConnectionTab);
              }} variant="secondary">
                <Tabs.List>
                  <Tabs.ScrollView scrollAlign="start" contentContainerClassName="gap-1 pr-2">
                    <Tabs.Indicator />
                    {tabs.map((item) => (
                      <Tabs.Trigger key={item} value={item}>
                        <Ionicons name={tabIcon(item)} size={15} color={tab === item ? primary : theme.textMuted} />
                        <Tabs.Label>{t(`connections.tabs.${item}`)}</Tabs.Label>
                      </Tabs.Trigger>
                    ))}
                  </Tabs.ScrollView>
                </Tabs.List>
              </Tabs>
            </Surface>
          </HeroCard.Body>
        </HeroCard>

        {isLoading ? (
          <View className="items-center py-8"><Spinner size="lg" /></View>
        ) : error ? (
          <Surface
            variant="secondary"
            className="items-center gap-3 rounded-panel p-5"
            style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
          >
            <Ionicons name="alert-circle-outline" size={28} color={theme.error} />
            <Text className="text-center text-sm" style={{ color: theme.text }}>{error}</Text>
            <ActionPill label={t('common:buttons.retry')} primary={primary} onPress={refresh} />
          </Surface>
        ) : connections.length === 0 ? (
          <Surface
            variant="secondary"
            className="rounded-panel p-5"
            style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
          >
            <EmptyState icon="people-outline" title={t(`connections.empty.${tab}.title`)} subtitle={t(`connections.empty.${tab}.description`)} />
            {tab === 'accepted' ? (
              <View className="mt-4 items-center">
                <ActionPill
                  label={t('connections.browseMembers')}
                  icon="search-outline"
                  primary={primary}
                  onPress={() => router.push('/(modals)/members' as Href)}
                />
              </View>
            ) : null}
          </Surface>
        ) : (
          <View className="gap-3">
            {connections.map((connection) => {
              const id = connectionId(connection);
              return (
                <ConnectionCard
                  key={id || `${connection.user.id}-${connection.status}`}
                  connection={connection}
                  tab={tab}
                  theme={theme}
                  primary={primary}
                  t={t}
                  isActioning={actionId === id}
                  onAction={(action) => void runAction(connection, action)}
                />
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function ConnectionCard({
  connection,
  tab,
  theme,
  primary,
  t,
  isActioning,
  onAction,
}: {
  connection: Connection;
  tab: ConnectionTab;
  theme: ReturnType<typeof useTheme>;
  primary: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
  isActioning: boolean;
  onAction: (action: 'accept' | 'remove') => void;
}) {
  const userName = displayName(connection.user, t('connections.unknownMember'));
  const id = connectionId(connection);
  const connectedDate = formatDate(connection.created_at);
  // 'accepted' | 'pending_received' | 'pending_sent' — the tab carries the direction that
  // `connection.status` ('accepted' | 'pending') cannot express on its own.
  const statusKey = connection.status === 'accepted' ? 'accepted' : tab;

  function openProfile() {
    router.push({ pathname: '/(modals)/member-profile', params: { id: String(connection.user.id) } } as unknown as Href);
  }

  function openMessage() {
    router.push({ pathname: '/(modals)/thread', params: { recipientId: String(connection.user.id), name: userName } } as unknown as Href);
  }

  return (
    <HeroCard
      className="overflow-hidden rounded-panel p-0"
      style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
    >
      <View className="absolute bottom-0 left-0 top-0 w-1.5" style={{ backgroundColor: primary }} />
      <HeroCard.Body className="gap-3 p-4 pl-5">
        <View className="flex-row items-start gap-3">
          <View
            className="rounded-full p-1"
            style={{ backgroundColor: withAlpha(primary, 0.1), borderWidth: 1, borderColor: withAlpha(primary, 0.18) }}
          >
            <Avatar uri={connection.user.avatar_url ?? null} name={userName} size={52} />
          </View>
          <View className="min-w-0 flex-1 gap-2">
            <View className="flex-row items-start justify-between gap-2">
              <View className="min-w-0 flex-1">
                <Text className="text-[17px] font-bold leading-6" style={{ color: theme.text }} numberOfLines={1}>{userName}</Text>
                {connection.user.location ? (
                  <View className="mt-0.5 flex-row items-center gap-1">
                    <Ionicons name="location-outline" size={13} color={theme.textMuted} />
                    <Text className="min-w-0 flex-1 text-sm" style={{ color: theme.textSecondary }} numberOfLines={1}>{connection.user.location}</Text>
                  </View>
                ) : null}
              </View>
              <HeroButton
                isIconOnly
                size="sm"
                variant="secondary"
                className="h-9 w-9 rounded-2xl"
                accessibilityLabel={t('connections.viewProfile', { name: userName })}
                onPress={openProfile}
                style={{
                  backgroundColor: withAlpha(primary, 0.1),
                  borderWidth: 1,
                  borderColor: withAlpha(primary, 0.16),
                }}
              >
                <Ionicons name="chevron-forward-outline" size={18} color={primary} />
              </HeroButton>
            </View>
            {connection.user.bio ? <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>{connection.user.bio}</Text> : null}
          </View>
        </View>
        {/*
          🔴 The status chip is keyed off the TAB, not off `connection.status`.

          The API returns `pending` for a request in either direction, and the translations
          are `accepted` / `pending_received` / `pending_sent` — so `connections.status.pending`
          missed and i18next printed the key itself. A member looking at a request they had
          just received saw the literal text "connections.status.pending". Found on a device
          on 2026-08-22.

          The tab already knows the direction, which is what the key names were built for.
          `statusKey` falls back to the raw status so an unexpected value still resolves to
          something rather than reintroducing a raw key.
        */}
        <View className="flex-row flex-wrap gap-2">
          <Chip size="sm" variant="secondary"><Chip.Label>{t(`connections.status.${statusKey}`)}</Chip.Label></Chip>
          {connectedDate ? (
            <Chip size="sm" variant="soft" color="default">
              <Ionicons name="calendar-outline" size={12} color={theme.textMuted} />
              {/*
                🔴 And the date label depends on the tab too. `created_at` is when the
                REQUEST was made; on the pending tabs "Connected 22 Aug" was simply untrue —
                they are not connected, that is the whole point of the tab.
              */}
              <Chip.Label>
                {tab === 'accepted'
                  ? t('connections.connectedSince', { date: connectedDate })
                  : t('connections.requestedOn', { date: connectedDate })}
              </Chip.Label>
            </Chip>
          ) : null}
        </View>
        <View
          className="flex-row flex-wrap gap-2 rounded-2xl px-3 py-2"
          style={{ backgroundColor: withAlpha(primary, 0.06), borderWidth: 1, borderColor: withAlpha(primary, 0.12) }}
        >
          {tab === 'accepted' ? (
            <>
              <ActionPill label={t('connections.message')} icon="chatbubble-outline" primary={primary} tone="secondary" onPress={openMessage} />
              <ActionPill
                label={t('connections.remove')}
                icon="trash-outline"
                primary={primary}
                tone="danger"
                isLoading={isActioning}
                isDisabled={!id}
                onPress={() => onAction('remove')}
              />
            </>
          ) : null}
          {tab === 'pending_received' ? (
            <>
              <ActionPill
                label={t('connections.accept')}
                icon="checkmark-outline"
                primary={primary}
                isLoading={isActioning}
                isDisabled={!id}
                onPress={() => onAction('accept')}
              />
              <ActionPill
                label={t('connections.decline')}
                icon="close-outline"
                primary={primary}
                tone="danger"
                isDisabled={isActioning || !id}
                onPress={() => onAction('remove')}
              />
            </>
          ) : null}
          {tab === 'pending_sent' ? (
            <ActionPill
              label={t('connections.cancel')}
              icon="close-circle-outline"
              primary={primary}
              tone="danger"
              isLoading={isActioning}
              isDisabled={!id}
              onPress={() => onAction('remove')}
            />
          ) : null}
        </View>
      </HeroCard.Body>
    </HeroCard>
  );
}

function tabIcon(tab: ConnectionTab): ComponentProps<typeof Ionicons>['name'] {
  if (tab === 'accepted') return 'people-outline';
  if (tab === 'pending_received') return 'mail-unread-outline';
  return 'send-outline';
}

function ActionPill({
  label,
  icon,
  primary,
  tone = 'primary',
  isLoading = false,
  isDisabled = false,
  onPress,
}: {
  label: string;
  icon?: ComponentProps<typeof Ionicons>['name'];
  primary: string;
  tone?: 'primary' | 'secondary' | 'danger';
  isLoading?: boolean;
  isDisabled?: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const isPrimary = tone === 'primary';
  const color = tone === 'danger' ? theme.error : primary;
  return (
    <HeroButton
      className="min-h-10 flex-row items-center justify-center gap-2 rounded-full px-4"
      accessibilityLabel={label}
      isDisabled={isDisabled || isLoading}
      onPress={onPress}
      size="sm"
      variant={isPrimary ? 'primary' : 'secondary'}
      style={{
        backgroundColor: isPrimary ? primary : withAlpha(color, 0.1),
        borderColor: isPrimary ? primary : withAlpha(color, 0.18),
        borderWidth: 1,
        opacity: isDisabled ? 0.5 : 1,
      }}
    >
      {isLoading ? (
        <Spinner size="sm" />
      ) : icon ? (
        <Ionicons name={icon} size={15} color={isPrimary ? '#fff' : color} />
      ) : null}
      <HeroButton.Label className="text-sm font-bold" style={{ color: isPrimary ? '#fff' : color }} numberOfLines={1}>
        {label}
      </HeroButton.Label>
    </HeroButton>
  );
}
