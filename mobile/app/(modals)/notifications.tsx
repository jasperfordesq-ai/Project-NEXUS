// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Swipeable } from 'react-native-gesture-handler';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Chip, Surface } from 'heroui-native';
import * as Haptics from '@/lib/haptics';
import { useTranslation } from 'react-i18next';

import {
  deleteNotification,
  getNotificationCounts,
  getNotifications,
  markAllRead,
  markGroupRead,
  markRead,
  type Notification,
} from '@/lib/api/notifications';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme, type Theme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import NativePressable from '@/components/ui/NativePressable';
import { navigateToLink } from '@/lib/utils/navigateToLink';
import { formatRelativeTime } from '@/lib/utils/formatRelativeTime';
import { describeApiError } from '@/lib/api/describeApiError';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import AccentIcon from '@/components/ui/AccentIcon';

export default function NotificationsScreen() {
  const { t } = useTranslation(['notifications', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const [markingAll, setMarkingAll] = useState(false);
  const [actingId, setActingId] = useState<number | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const { data, isLoading, error, refresh } = useApi(() => getNotifications());
  const notifications = data?.data ?? [];

  /**
   * 🔴 Count unread from the SERVER, not from the page that happens to be loaded.
   *
   * This counted `notifications.filter(n => !n.is_read)` — the first page only. Measured on
   * a device on 2026-08-22 with 26 genuinely unread notifications: the header read "10
   * unread", because the list is paginated at 20 and then grouped. `/v2/notifications/counts`
   * has always returned the true total (26, matching the database); `getNotificationCounts`
   * existed in the client and nothing called it. Journey 7.15.
   *
   * The loaded page is still the fallback, so the number degrades to the old behaviour
   * rather than to zero if that request fails.
   */
  const countsApi = useApi(() => getNotificationCounts());
  const loadedUnread = notifications.filter((n) => !n.is_read).length;
  const serverUnread = countsApi.data?.data?.total;
  const unreadCount = typeof serverUnread === 'number' ? serverUnread : loadedUnread;

  /**
   * Marking or deleting changes BOTH the list and the count, so both are refetched. Before
   * this, refreshing the list alone would have left a stale total in the header.
   */
  const refreshAll = useCallback(() => {
    refresh();
    countsApi.refresh();
  }, [refresh, countsApi]);

  function handleMarkAll() {
    confirm({
      title: t('common:buttons.confirm'),
      message: t('confirmMarkAllRead'),
      confirmLabel: t('common:yes'),
      cancelLabel: t('common:no'),
      variant: 'primary',
      onConfirm: async () => {
        setMarkingAll(true);
        try {
          await markAllRead();
          void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
          refreshAll();
        } catch (err) {
          showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('markError')), variant: 'danger' });
        } finally {
          setMarkingAll(false);
        }
      },
    });
  }

  function handleNotificationPress(item: Notification) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void markRead(item.id).then(() => refreshAll()).catch(console.warn);
    navigateToLink(item.link ?? null);
  }

  async function handleMarkRead(item: Notification) {
    setActingId(item.id);
    try {
      if (isGroupedNotification(item) && item.group_key) {
        await markGroupRead(item.group_key);
      } else {
        await markRead(item.id);
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      refreshAll();
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('markError')), variant: 'danger' });
    } finally {
      setActingId(null);
    }
  }

  async function handleDelete(item: Notification) {
    setActingId(item.id);
    try {
      await deleteNotification(item.id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      refreshAll();
    } catch (err) {
      showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('deleteError')), variant: 'danger' });
    } finally {
      setActingId(null);
    }
  }

  function renderHeader() {
    return (
      <View className="px-4 pb-3">
        <HeroCard className="overflow-hidden rounded-panel p-0">
          <View className="h-1.5" style={{ backgroundColor: primary }} />
          <HeroCard.Body className="gap-4 p-4">
            <View className="flex-row items-start gap-3">
              <View className="size-12 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                <Ionicons name="notifications-outline" size={24} color={primary} />
              </View>
              <View className="min-w-0 flex-1 gap-1">
                <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>
                  {t('eyebrow')}
                </Text>
                <Text className="text-2xl font-bold" style={{ color: theme.text }}>
                  {t('title')}
                </Text>
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                  {unreadCount > 0 ? t('unreadSummary', { count: unreadCount }) : t('allCaughtUpSub')}
                </Text>
              </View>
              {unreadCount > 0 ? (
                <Chip size="sm" variant="secondary">
                  <Chip.Label>{t('unreadCount', { count: unreadCount })}</Chip.Label>
                </Chip>
              ) : null}
            </View>

            {unreadCount > 0 ? (
              <HeroButton
                variant="primary"
                onPress={() => void handleMarkAll()}
                isDisabled={markingAll}
                accessibilityLabel={t('markAllRead')}
              >
                <AccentIcon name="checkmark-done-outline" size={17} />
                <HeroButton.Label>{markingAll ? t('marking') : t('markAllRead')}</HeroButton.Label>
              </HeroButton>
            ) : null}
          </HeroCard.Body>
        </HeroCard>
      </View>
    );
  }

  function renderSwipeActions(item: Notification) {
    const isGrouped = isGroupedNotification(item);

    if (item.is_read && isGrouped) {
      return null;
    }

    return (
      <View className="mr-4 mb-3 flex-row items-stretch overflow-hidden rounded-panel">
        {!item.is_read ? (
          <SwipeActionButton
            label={isGrouped ? t('markGroupRead') : t('markRead')}
            accessibilityLabel={isGrouped ? t('swipeMarkGroupRead') : t('swipeMarkRead')}
            icon="checkmark-outline"
            backgroundColor={withAlpha(primary, 0.16)}
            foregroundColor={primary}
            disabled={actingId === item.id}
            onPress={() => void handleMarkRead(item)}
          />
        ) : null}
        {!isGrouped ? (
          <SwipeActionButton
            label={t('delete')}
            accessibilityLabel={t('swipeDelete')}
            icon="trash-outline"
            backgroundColor={theme.error}
            foregroundColor="#fff"
            disabled={actingId === item.id}
            onPress={() => void handleDelete(item)}
          />
        ) : null}
      </View>
    );
  }

  function renderItem({ item }: { item: Notification }) {
    const label = item.title ? `${item.title}. ${item.message}` : item.message;
    const categoryTint = categoryColor(item.category, theme.textMuted, theme);
    const isGrouped = isGroupedNotification(item);
    const groupKey = item.group_key ?? String(item.id);
    const isExpanded = Boolean(expandedGroups[groupKey]);

    const card = (
      <View className="mx-4 mb-3">
        <HeroCard className={`overflow-hidden rounded-panel p-0 ${!item.is_read ? 'border border-primary/30' : ''}`}>
          {!item.is_read ? <View className="h-1.5" style={{ backgroundColor: primary }} /> : null}
          <HeroCard.Body className="gap-3 p-4">
            {/*
              🔴 This was a HeroButton wrapping the whole card body, and a button caps its
              own height: the notification text was cut through the middle of its third
              line, so "You have a new order #MKT-… for "Folding wooden drying rack"" ended
              mid-word with no ellipsis. Measured on a device 2026-08-22. A card-sized tap
              target belongs in NativePressable, which lets its content decide the height.
            */}
            <NativePressable
              feedback="scale"
              className="w-full"
              onPress={() => handleNotificationPress(item)}
              accessibilityRole="button"
              accessibilityLabel={item.is_read ? label : t('unreadItem', { label })}
            >
              <View className="flex-row items-start gap-3">
                {isGrouped && item.actors?.length ? (
                  <View className="w-[58px] flex-row items-center">
                    {item.actors.slice(0, 3).map((actor, index) => (
                      <View key={actor.id} className={index > 0 ? '-ml-4' : ''} style={{ zIndex: 3 - index }}>
                        <Avatar uri={actor.avatar_url ?? null} name={actor.name ?? '?'} size={34} />
                      </View>
                    ))}
                  </View>
                ) : (
                  <View className="relative">
                    <Avatar uri={item.actor?.avatar_url ?? null} name={item.actor?.name ?? '?'} size={44} />
                    <View
                      className="absolute bottom-0 right-0 size-3 rounded-full border-[1.5px]"
                      style={{ backgroundColor: categoryTint, borderColor: theme.surface }}
                    />
                  </View>
                )}

                <View className="min-w-0 flex-1 gap-2">
                  <View className="flex-row items-start gap-2">
                    <View className="min-w-0 flex-1">
                      {/*
                        🔴 The line height has to be in `style`, not in `leading-5`.
                        With the class alone the text was cut through the middle of the
                        third line instead of ending in an ellipsis — a member reading
                        "You have a new order #MKT-… for "Folding wooden drying rack""
                        saw the last line sliced in half. Measured on a device 2026-08-22;
                        the same remedy as `components/ui/ActionSheet.tsx`.
                      */}
                      {item.title ? (
                        <Text
                          className="text-base font-bold"
                          style={{ color: theme.text, fontSize: 16, lineHeight: 22 }}
                          numberOfLines={2}
                        >
                          {item.title}
                        </Text>
                      ) : null}
                      <Text
                        className="text-sm leading-5"
                        style={{ color: theme.textSecondary, fontSize: 14, lineHeight: 20 }}
                        numberOfLines={3}
                      >
                        {item.message}
                      </Text>
                    </View>
                    {!item.is_read ? (
                      <View className="mt-1 size-2.5 rounded-full" style={{ backgroundColor: primary }} />
                    ) : null}
                  </View>

                  <View className="flex-row flex-wrap items-center gap-2">
                    <Chip size="sm" variant="secondary">
                      <Ionicons name={categoryIcon(item.category)} size={12} color={categoryTint} />
                      <Chip.Label>{categoryLabel(item.category, t)}</Chip.Label>
                    </Chip>
                    <Chip size="sm" variant="secondary">
                      <Ionicons name="time-outline" size={12} color={theme.textSecondary} />
                      <Chip.Label>
                        {(Date.now() - new Date(item.latest_at ?? item.created_at).getTime()) < 60_000
                          ? t('justNow')
                          : formatRelativeTime(item.latest_at ?? item.created_at)}
                      </Chip.Label>
                    </Chip>
                    {isGrouped ? (
                      <Chip size="sm" variant="secondary">
                        <Ionicons name="albums-outline" size={12} color={categoryTint} />
                        <Chip.Label>{t('groupCount', { count: item.group_count ?? 0 })}</Chip.Label>
                      </Chip>
                    ) : null}
                  </View>
                </View>
              </View>
            </NativePressable>

            <View className="flex-row flex-wrap gap-2 border-t border-border pt-2">
              {isGrouped ? (
                <HeroButton
                  size="sm"
                  variant="secondary"
                  onPress={() => setExpandedGroups((current) => ({ ...current, [groupKey]: !current[groupKey] }))}
                  accessibilityLabel={isExpanded ? t('collapseGroup') : t('expandGroup')}
                >
                  <Ionicons name={isExpanded ? 'chevron-up-outline' : 'chevron-down-outline'} size={15} color={primary} />
                  <HeroButton.Label>{isExpanded ? t('collapseGroup') : t('expandGroup')}</HeroButton.Label>
                </HeroButton>
              ) : null}
              {!item.is_read ? (
                <HeroButton
                  size="sm"
                  variant="secondary"
                  isDisabled={actingId === item.id}
                  onPress={() => void handleMarkRead(item)}
                  accessibilityLabel={isGrouped ? t('markGroupRead') : t('markRead')}
                >
                  <Ionicons name="checkmark-outline" size={15} color={primary} />
                  <HeroButton.Label>{isGrouped ? t('markGroupRead') : t('markRead')}</HeroButton.Label>
                </HeroButton>
              ) : null}
              {!isGrouped ? (
                <HeroButton
                  size="sm"
                  variant="danger"
                  isDisabled={actingId === item.id}
                  onPress={() => void handleDelete(item)}
                  accessibilityLabel={t('delete')}
                >
                  <Ionicons name="trash-outline" size={15} color="#fff" />
                  <HeroButton.Label>{t('delete')}</HeroButton.Label>
                </HeroButton>
              ) : null}
            </View>
            {isGrouped && isExpanded && item.actors?.length ? (
              <View className="gap-2 border-t border-border pt-3">
                {item.actors.map((actor) => (
                  <View key={actor.id} className="flex-row items-center gap-2">
                    <Avatar uri={actor.avatar_url ?? null} name={actor.name ?? '?'} size={28} />
                    <Text className="text-sm" style={{ color: theme.textSecondary }} numberOfLines={1}>
                      {actor.name ?? t('unknownActor')}
                    </Text>
                  </View>
                ))}
                {(item.remaining_count ?? 0) > 0 ? (
                  <Text className="text-xs" style={{ color: theme.textMuted }}>
                    {t('andOthers', { count: item.remaining_count ?? 0 })}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </HeroCard.Body>
        </HeroCard>
      </View>
    );

    return (
      <Swipeable
        overshootRight={false}
        renderRightActions={() => renderSwipeActions(item)}
      >
        {card}
      </Swipeable>
    );
  }

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('title')} backLabel={t('common:back')} fallbackHref="/(tabs)/profile" />

        <FlatList<Notification>
          data={notifications}
          keyExtractor={(item) => String(item.id)}
          renderItem={renderItem}
          ListHeaderComponent={renderHeader}
          refreshControl={
            <RefreshControl refreshing={isLoading && notifications.length > 0} onRefresh={refresh} />
          }
          ListEmptyComponent={
            isLoading ? (
              <LoadingSpinner />
            ) : error ? (
              <Surface variant="secondary" className="mx-4 rounded-panel p-6">
                <View className="items-center gap-3">
                  <Ionicons name="warning-outline" size={34} color={theme.error} />
                  <Text className="text-center text-sm" style={{ color: theme.text }}>{error}</Text>
                  <HeroButton variant="secondary" onPress={() => void refreshAll()}>
                    <HeroButton.Label>{t('common:buttons.retry')}</HeroButton.Label>
                  </HeroButton>
                </View>
              </Surface>
            ) : (
              <EmptyState
                icon="notifications-off-outline"
                title={t('allCaughtUp')}
                subtitle={t('allCaughtUpSub')}
              />
            )
          }
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
        />
        {confirmDialog}
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}

function SwipeActionButton({
  label,
  accessibilityLabel,
  icon,
  backgroundColor,
  foregroundColor,
  disabled,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  backgroundColor: string;
  foregroundColor: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <HeroButton
      accessibilityLabel={accessibilityLabel}
      isDisabled={disabled}
      onPress={onPress}
      className="min-w-[86px] items-center justify-center gap-1 px-3"
      variant="primary"
      style={{ backgroundColor, opacity: disabled ? 0.55 : 1 }}
    >
      <Ionicons name={icon} size={18} color={foregroundColor} />
      <HeroButton.Label className="text-center text-xs font-bold" style={{ color: foregroundColor }} numberOfLines={2}>
        {label}
      </HeroButton.Label>
    </HeroButton>
  );
}

function isGroupedNotification(item: Notification): boolean {
  return Boolean(item.is_grouped && (item.group_count ?? 0) > 1 && item.group_key);
}

function categoryLabel(category: string | undefined | null, t: (key: string) => string): string {
  const labels: Record<string, string> = {
    message: t('category.message'),
    transaction: t('category.transaction'),
    social: t('category.social'),
    system: t('category.system'),
    event: t('category.event'),
    group: t('category.group'),
    listing: t('category.listing'),
    connection: t('category.connection'),
    mention: t('category.mention'),
    other: t('category.other'),
  };
  return category ? labels[category] ?? category : labels.other;
}

function categoryIcon(category: string | undefined | null): React.ComponentProps<typeof Ionicons>['name'] {
  switch (category) {
    case 'message': return 'chatbubble-outline';
    case 'transaction': return 'swap-horizontal-outline';
    case 'social': return 'heart-outline';
    case 'system': return 'settings-outline';
    case 'event': return 'calendar-outline';
    case 'group': return 'people-outline';
    case 'listing': return 'pricetag-outline';
    case 'connection': return 'person-add-outline';
    case 'mention': return 'at-outline';
    default: return 'notifications-outline';
  }
}

function categoryColor(category: string | undefined | null, fallback: string, theme: Theme): string {
  const info = theme.info;
  const success = theme.success;
  const warning = theme.warning;
  switch (category) {
    case 'message': return info;
    case 'transaction': return success;
    case 'social': return '#8B5CF6';
    case 'system': return warning;
    case 'event': return '#F59E0B';
    case 'group': return '#06B6D4';
    case 'listing': return '#10B981';
    case 'connection': return '#EC4899';
    case 'mention': return '#6366F1';
    default: return fallback;
  }
}
