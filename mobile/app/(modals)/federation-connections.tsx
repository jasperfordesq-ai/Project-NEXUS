// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import AccentIcon from '@/components/ui/AccentIcon';
import { useMemo, useState, type ComponentProps } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, type Href } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Chip, Spinner, Surface, Tabs, Text } from 'heroui-native';
import * as Haptics from '@/lib/haptics';
import { useTranslation } from 'react-i18next';

import {
  acceptFederationConnection,
  getFederationConnections,
  rejectFederationConnection,
  removeFederationConnection,
  type FederationConnection,
} from '@/lib/api/federation';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import Avatar from '@/components/ui/Avatar';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { dateLocale } from '@/lib/utils/dateLocale';
import { describeApiError } from '@/lib/api/describeApiError';

type ConnectionTab = 'accepted' | 'pending_received' | 'pending_sent';

const tabs: ConnectionTab[] = ['accepted', 'pending_received', 'pending_sent'];

function unwrapConnections(response: { data?: FederationConnection[] } | FederationConnection[] | null | undefined): FederationConnection[] {
  if (!response) return [];
  if (Array.isArray(response)) return response;
  return Array.isArray(response.data) ? response.data : [];
}

function formatDate(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function FederationConnectionsRoute() {
  return (
    <ModalErrorBoundary>
      <FederationConnectionsScreen />
    </ModalErrorBoundary>
  );
}

function FederationConnectionsScreen() {
  const { t } = useTranslation(['federation', 'common']);
  const { show: showToast } = useAppToast();
  const [tab, setTab] = useState<ConnectionTab>('accepted');
  const [actionId, setActionId] = useState<number | null>(null);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { data, isLoading, error, refresh } = useApi(() => getFederationConnections(tab), [tab]);
  const connections = useMemo(() => unwrapConnections(data), [data]);

  async function runAction(connection: FederationConnection, action: 'accept' | 'reject' | 'remove') {
    setActionId(connection.id);
    try {
      if (action === 'accept') await acceptFederationConnection(connection.id);
      if (action === 'reject') await rejectFederationConnection(connection.id);
      if (action === 'remove') await removeFederationConnection(connection.id);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      refresh();
    } catch (err) {
      showToast({ title: t('directory.connections.actionFailedTitle'), description: describeApiError(err, t('directory.connections.actionFailedDescription')), variant: 'danger' });
    } finally {
      setActionId(null);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar title={t('directory.connections.title')} backLabel={t('common:back')} fallbackHref="/(modals)/federation" />
      <ScrollView
        refreshControl={<RefreshControl refreshing={isLoading} onRefresh={refresh} tintColor={primary} colors={[primary]} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
      >
        <HeroCard
          className="mb-3 overflow-hidden rounded-panel p-0"
          style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
        >
          <View className="h-1" style={{ backgroundColor: primary }} />
          <HeroCard.Body className="gap-4 p-4">
            <View className="flex-row items-center gap-3">
              <View
                className="h-12 w-12 items-center justify-center rounded-2xl"
                style={{ backgroundColor: withAlpha(primary, 0.14), borderWidth: 1, borderColor: withAlpha(primary, 0.18) }}
              >
                <Ionicons name="person-add-outline" size={24} color={primary} />
              </View>
              <View className="min-w-0 flex-1 gap-1">
                <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>{t('directory.connections.eyebrow')}</Text>
                <Text className="text-[26px] font-bold leading-8" style={{ color: theme.text }} numberOfLines={1}>{t('directory.connections.title')}</Text>
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>{t('directory.connections.subtitle')}</Text>
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
                        <Tabs.Label>{t(`directory.connections.tabs.${item}`)}</Tabs.Label>
                      </Tabs.Trigger>
                    ))}
                  </Tabs.ScrollView>
                </Tabs.List>
              </Tabs>
            </Surface>
          </HeroCard.Body>
        </HeroCard>

        {isLoading ? (
          <Surface
            variant="secondary"
            className="items-center gap-3 rounded-panel p-6"
            style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
          >
            <View
              className="h-14 w-14 items-center justify-center rounded-3xl"
              style={{ backgroundColor: withAlpha(primary, 0.12), borderWidth: 1, borderColor: withAlpha(primary, 0.18) }}
            >
              <Spinner size="sm" />
            </View>
          </Surface>
        ) : error ? (
          <Surface
            variant="secondary"
            className="items-center gap-3 rounded-panel p-5"
            style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
          >
            <Ionicons name="alert-circle-outline" size={28} color={theme.error} />
            <Text className="text-center text-sm" style={{ color: theme.text }}>{error}</Text>
            <ActionPill label={t('directory.tryAgain')} primary={primary} onPress={refresh} />
          </Surface>
        ) : connections.length === 0 ? (
          <Surface
            variant="secondary"
            className="overflow-hidden rounded-panel p-0"
            style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
          >
            <View className="items-center gap-3 px-5 py-7">
              <View
                className="h-14 w-14 items-center justify-center rounded-3xl"
                style={{ backgroundColor: withAlpha(primary, 0.12), borderWidth: 1, borderColor: withAlpha(primary, 0.18) }}
              >
                <Ionicons name="people-outline" size={27} color={primary} />
              </View>
              <View className="gap-1">
                <Text className="text-center text-lg font-bold leading-6" style={{ color: theme.text }}>
                  {t(`directory.connections.empty.${tab}.title`)}
                </Text>
                <Text className="text-center text-sm leading-5" style={{ color: theme.textSecondary }}>
                  {t(`directory.connections.empty.${tab}.description`)}
                </Text>
              </View>
            </View>
            {tab === 'accepted' ? (
              <View
                className="border-t px-5 py-4"
                style={{ borderColor: theme.borderSubtle, backgroundColor: withAlpha(primary, 0.05) }}
              >
                <ActionPill
                  label={t('directory.connections.browseMembers')}
                  icon="globe-outline"
                  primary={primary}
                  onPress={() => router.push('/(modals)/federation-members' as Href)}
                />
              </View>
            ) : null}
          </Surface>
        ) : (
          <View className="gap-3">
            {connections.map((connection) => (
              <ConnectionCard
                key={connection.id}
                connection={connection}
                tab={tab}
                theme={theme}
                primary={primary}
                t={t}
                isActioning={actionId === connection.id}
                onAction={(action) => void runAction(connection, action)}
              />
            ))}
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
  connection: FederationConnection;
  tab: ConnectionTab;
  theme: ReturnType<typeof useTheme>;
  primary: string;
  t: (key: string, opts?: Record<string, unknown>) => string;
  isActioning: boolean;
  onAction: (action: 'accept' | 'reject' | 'remove') => void;
}) {
  function openProfile() {
    router.push({ pathname: '/(modals)/federation-member', params: { id: String(connection.user_id), tenant_id: String(connection.tenant_id) } } as unknown as Href);
  }

  function openMessage() {
    router.push({
      pathname: '/(modals)/federation-messages',
      params: {
        compose: 'true',
        to_user: String(connection.user_id),
        to_tenant: String(connection.tenant_id),
        name: connection.name,
        community: connection.tenant_name,
      },
    } as unknown as Href);
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
            <Avatar uri={connection.avatar_url ?? null} name={connection.name} size={52} />
          </View>
          <View className="min-w-0 flex-1 gap-2">
            <View className="flex-row items-start justify-between gap-2">
              <View className="min-w-0 flex-1">
                <Text className="text-[17px] font-bold leading-6" style={{ color: theme.text }} numberOfLines={1}>{connection.name}</Text>
                <View className="mt-0.5 flex-row items-center gap-1">
                  <Ionicons name="business-outline" size={13} color={theme.textMuted} />
                  <Text className="min-w-0 flex-1 text-sm" style={{ color: theme.textSecondary }} numberOfLines={1}>{connection.tenant_name}</Text>
                </View>
              </View>
              <HeroButton
                isIconOnly
                size="sm"
                variant="secondary"
                className="h-9 w-9 rounded-2xl"
                accessibilityLabel={t('directory.connections.viewProfile', { name: connection.name })}
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
            {connection.message ? <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>{connection.message}</Text> : null}
          </View>
        </View>
        <View className="flex-row flex-wrap gap-2">
          <Chip size="sm" variant="secondary"><Chip.Label>{t(`directory.connections.status.${connection.status}`)}</Chip.Label></Chip>
          {formatDate(connection.created_at) ? (
            <Chip size="sm" variant="soft" color="default">
              <Ionicons name="calendar-outline" size={12} color={theme.textMuted} />
              <Chip.Label>{formatDate(connection.created_at)}</Chip.Label>
            </Chip>
          ) : null}
        </View>
        <View
          className="flex-row flex-wrap gap-2 rounded-2xl px-3 py-2"
          style={{ backgroundColor: withAlpha(primary, 0.06), borderWidth: 1, borderColor: withAlpha(primary, 0.12) }}
        >
          {tab === 'accepted' ? (
            <>
              <ActionPill label={t('directory.connections.message')} icon="chatbubble-outline" primary={primary} tone="secondary" onPress={openMessage} />
              <ActionPill
                label={t('directory.connections.remove')}
                icon="trash-outline"
                primary={primary}
                tone="danger"
                isLoading={isActioning}
                onPress={() => onAction('remove')}
              />
            </>
          ) : null}
          {tab === 'pending_received' ? (
            <>
              <ActionPill
                label={t('directory.connections.accept')}
                icon="checkmark-outline"
                primary={primary}
                isLoading={isActioning}
                onPress={() => onAction('accept')}
              />
              <ActionPill
                label={t('directory.connections.reject')}
                icon="close-outline"
                primary={primary}
                tone="danger"
                isDisabled={isActioning}
                onPress={() => onAction('reject')}
              />
            </>
          ) : null}
          {tab === 'pending_sent' ? (
            <ActionPill
              label={t('directory.connections.cancel')}
              icon="close-circle-outline"
              primary={primary}
              tone="danger"
              isLoading={isActioning}
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
      // Selected pills let HeroUI's primary variant paint the fill AND pick the label colour
      // for it: a hardcoded white label is invisible on a pale community colour, and a raw
      // `primary` fill skips the dark-mode lift every other primary button gets.
      style={isPrimary ? { opacity: isDisabled ? 0.5 : 1 } : {
        backgroundColor: withAlpha(color, 0.1),
        borderColor: withAlpha(color, 0.18),
        borderWidth: 1,
        opacity: isDisabled ? 0.5 : 1,
      }}
    >
      {isLoading ? (
        <Spinner size="sm" />
      ) : icon ? (
        isPrimary ? <AccentIcon name={icon} size={15} /> : <Ionicons name={icon} size={15} color={color} />
      ) : null}
      <HeroButton.Label className="text-sm font-bold" style={isPrimary ? undefined : { color }} numberOfLines={1}>
        {label}
      </HeroButton.Label>
    </HeroButton>
  );
}
