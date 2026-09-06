// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { usePaginatedApi } from '@/lib/hooks/usePaginatedApi';
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
import { Button as HeroButton, Card as HeroCard, Surface, Spinner } from 'heroui-native';
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
  type NotificationListResponse,
} from '@/lib/api/notifications';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme, type Theme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import ActionSheet from '@/components/ui/ActionSheet';
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

/** Matches `ActionSheet`'s own `Action`, which that component does not export. */
interface NotificationAction {
  label: string;
  icon?: string;
  onPress: () => void;
  destructive?: boolean;
}

/** One row inside an expanded group — a notification, or an actor when that is all there is. */
interface ExpandableEntry {
  key: string;
  label: string;
  meta?: string;
  avatarName?: string;
  avatarUrl?: string | null;
  onPress?: () => void;
}

/** Stable references so the paginated hook does not refetch on every render. */
function fetchNotificationsPage(cursor: string | null): Promise<NotificationListResponse> {
  return getNotifications(cursor);
}

function extractNotificationsPage(response: NotificationListResponse) {
  return {
    items: response.data ?? [],
    cursor: response.meta?.cursor ?? null,
    hasMore: Boolean(response.meta?.has_more),
  };
}

export default function NotificationsScreen() {
  const { t } = useTranslation(['notifications', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const [markingAll, setMarkingAll] = useState(false);
  const [actingId, setActingId] = useState<number | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [actionSheet, setActionSheet] = useState<{ title: string; options: NotificationAction[] } | null>(null);

  /*
    🔴 S3-03: this fetched exactly one page of 25 with no load-more and no footer. A member
    with 47 unread — the emulator fixture on 2026-09-05 — could read the header saying 47 and
    reach 25 of them; the rest were unreachable from inside the app. The API has always
    accepted a cursor and returned `meta.cursor`.
  */
  const {
    items: notifications,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    loadMore,
    refresh,
  } = usePaginatedApi<Notification, NotificationListResponse>(
    fetchNotificationsPage,
    extractNotificationsPage,
  );

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
    // 🔴 S3-38: this went to console.warn — the member tapped, the dot stayed, nothing said why.
    void markRead(item.id)
      .then(() => refreshAll())
      .catch((err) => showToast({ title: t('common:errors.alertTitle'), description: describeApiError(err, t('markError')), variant: 'danger' }));
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

  /**
   * Every action the swipe offers, reachable without a gesture.
   *
   * 🔴 The swipe actions are the right primary affordance and they stay — but a swipe
   * is invisible to a screen reader and undiscoverable to plenty of sighted members too.
   * Deleting the inline button row (see the card) without this would have removed the only
   * non-gesture route to Delete, which would be an accessibility regression dressed up as
   * a tidy-up.
   */
  function openActions(item: Notification) {
    const grouped = isGroupedNotification(item);
    const options: NotificationAction[] = [];

    if (!item.is_read) {
      options.push({
        label: grouped ? t('markGroupRead') : t('markRead'),
        icon: 'checkmark-outline',
        onPress: () => void handleMarkRead(item),
      });
    }
    if (item.link) {
      options.push({
        label: t('openNotification'),
        icon: 'open-outline',
        onPress: () => handleNotificationPress(item),
      });
    }
    if (!grouped) {
      options.push({
        label: t('delete'),
        icon: 'trash-outline',
        destructive: true,
        onPress: () => void handleDelete(item),
      });
    }

    setActionSheet({ title: item.title ?? item.message, options });
  }

  function renderHeader() {
    return (
      /*
        🔴 One line, not a hero card.

        This was a full-width panel carrying an accent bar, a 48px icon, an "ACTIVITY INBOX"
        eyebrow, a 24pt "Notifications" heading, a sentence saying how many were unread, a
        chip ALSO saying how many were unread, and a full-width button. The screen's own top
        bar already says "Notifications", so the word appeared three times above the fold and
        the panel pushed the actual notifications — the reason for the screen — down past a
        third of the display.
      */
      <View className="flex-row items-center justify-between gap-3 px-4 pb-2 pt-1">
        <Text className="min-w-0 flex-1 text-sm" style={{ color: theme.textSecondary }} numberOfLines={1}>
          {unreadCount > 0
            ? t('unreadSummary', { count: unreadCount })
            : isLoading || countsApi.isLoading
              ? t('loadingSummary')
              : t('allCaughtUpSub')}
        </Text>
        {unreadCount > 0 ? (
          <HeroButton
            size="sm"
            variant="secondary"
            className="h-12 rounded-2xl"
            onPress={() => void handleMarkAll()}
            isDisabled={markingAll}
            accessibilityLabel={t('markAllRead')}
          >
            <AccentIcon name="checkmark-done-outline" size={15} />
            <HeroButton.Label>{markingAll ? t('marking') : t('markAllRead')}</HeroButton.Label>
          </HeroButton>
        ) : null}
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
    /*
      What "expand" actually reveals. The group's own notifications when the server sent
      them, otherwise the actors — and an EMPTY list when there is neither, which is what
      stops the control being offered at all.
    */
    const expandable: ExpandableEntry[] = isGrouped
      ? (item.group_items?.length
          ? item.group_items.map((entry) => ({
              key: `n-${entry.id}`,
              /*
                The child's own title is dropped when it just repeats the group's — every
                row in an achievements group is titled "Achievement", so prefixing each one
                added a column of identical words and pushed the part that differs to the
                right. Kept when it actually says something new.
              */
              label: entry.title && entry.title !== item.title
                ? `${entry.title} — ${entry.message}`
                : entry.message,
              meta: entry.created_at ? formatRelativeTime(entry.created_at) : undefined,
              onPress: entry.link ? () => navigateToLink(entry.link ?? null) : undefined,
            }))
          : (item.actors ?? []).map((actor) => ({
              key: `a-${actor.id}`,
              label: actor.name ?? t('unknownActor'),
              avatarName: actor.name ?? '?',
              avatarUrl: actor.avatar_url ?? null,
            })))
      : [];

    const card = (
      <View className="mx-4 mb-2">
        <HeroCard className="overflow-hidden rounded-panel p-0">
          <HeroCard.Body className="gap-2 p-3">
            {/*
              🔴 One compact row, not a card with its own button bar.

              Every notification used to carry a full-width action row — "Mark read" and a
              RED "Delete" — duplicating the swipe actions this same component already
              renders. Three notifications filled a phone screen, so a member with 47 of
              them (the emulator fixture, 2026-09-06) faced sixteen screens of scrolling,
              and a destructive red button repeated down the whole list. The swipe actions
              are unchanged, and the overflow button below keeps every one of them reachable
              without a gesture — which matters, because a swipe is invisible to a screen
              reader.
            */}
            <View className="flex-row items-start gap-3">
              <NativePressable
                feedback="scale"
                className="min-w-0 flex-1"
                /*
                  🔴 `contentClassName`, not just `className`. With `feedback="scale"` this
                  component wraps its children in an inner `PressableFeedback.Scale` view,
                  so a `flex-row` on the outer element never reaches them and the icon
                  stacks ABOVE the text instead of sitting beside it. Caught on the
                  emulator on 2026-09-06 — it type-checked and passed every unit test,
                  because neither can see a layout.
                */
                contentClassName="flex-row items-start gap-3"
                onPress={() => handleNotificationPress(item)}
                accessibilityRole="button"
                accessibilityLabel={item.is_read ? label : t('unreadItem', { label })}
              >
                {isGrouped && item.actors?.length ? (
                  <View className="w-[52px] flex-row items-center pt-0.5">
                    {item.actors.slice(0, 3).map((actor, index) => (
                      <View key={actor.id} className={index > 0 ? '-ml-4' : ''} style={{ zIndex: 3 - index }}>
                        <Avatar uri={actor.avatar_url ?? null} name={actor.name ?? '?'} size={30} />
                      </View>
                    ))}
                  </View>
                ) : item.actor ? (
                  <Avatar uri={item.actor.avatar_url ?? null} name={item.actor.name ?? ''} size={38} />
                ) : (
                  /*
                    The category icon, in the category's own colour. This has always been
                    written; it never ran, because the API did not send `category` until
                    2026-09-06 — so every row in the list showed the same grey bell.
                  */
                  <View
                    className="size-[38px] items-center justify-center rounded-2xl"
                    style={{ backgroundColor: withAlpha(categoryTint, 0.14) }}
                  >
                    <Ionicons name={categoryIcon(item.category)} size={19} color={categoryTint} />
                  </View>
                )}

                <View className="min-w-0 flex-1 gap-0.5">
                  {item.title ? (
                    <Text
                      className="text-[15px] font-semibold"
                      style={{ color: theme.text }}
                      numberOfLines={1}
                    >
                      {item.title}
                    </Text>
                  ) : null}
                  <Text
                    className="text-sm leading-5"
                    style={{ color: item.title ? theme.textSecondary : theme.text }}
                    numberOfLines={2}
                  >
                    {item.message}
                  </Text>
                  {/*
                    One quiet meta line replaces two chips. A raw "30/8/2026" told a member
                    nothing they wanted to know about a notification; the rest of the app
                    says "3d ago" and so does this now.
                  */}
                  <View className="mt-0.5 flex-row items-center gap-1.5">
                    <Text className="text-xs" style={{ color: theme.textMuted }}>
                      {formatRelativeTime(item.created_at)}
                    </Text>
                    <Text className="text-xs" style={{ color: theme.textMuted }}>·</Text>
                    <Text className="text-xs" style={{ color: categoryTint }} numberOfLines={1}>
                      {categoryLabel(item.category, t)}
                    </Text>
                    {isGrouped ? (
                      <>
                        <Text className="text-xs" style={{ color: theme.textMuted }}>·</Text>
                        <Text className="text-xs font-semibold" style={{ color: theme.textMuted }}>
                          {t('groupCount', { count: item.group_count ?? 0 })}
                        </Text>
                      </>
                    ) : null}
                  </View>
                </View>
              </NativePressable>

              <View className="items-center gap-1">
                {!item.is_read ? (
                  <View
                    className="size-2.5 rounded-full"
                    style={{ backgroundColor: primary }}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  />
                ) : null}
                {/*
                  The accessible route to every action the swipe offers. 44dp square: the
                  measured minimum, not a guess — see scripts/audit-touch-targets.mjs.
                */}
                <HeroButton
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  testID={`notification-actions-${item.id}`}
                  className="h-12 w-12 rounded-2xl"
                  isDisabled={actingId === item.id}
                  onPress={() => openActions(item)}
                  accessibilityLabel={t('actionsFor', { label: item.title ?? item.message })}
                >
                  <Ionicons name="ellipsis-horizontal" size={18} color={theme.textSecondary} />
                </HeroButton>
              </View>
            </View>

            {/*
              🔴 Offered ONLY when there is something behind it.

              This control used to appear for every grouped notification and reveal only
              actor avatars — so a group with no actors (an achievement, a wallet movement,
              a listing expiry) flipped the label from "Expand group" to "Collapse group"
              and changed nothing else on screen. Reported by the owner; reproduced on the
              emulator on 2026-09-06.
            */}
            {expandable.length > 0 ? (
              <HeroButton
                size="sm"
                variant="tertiary"
                testID={`notification-expand-${item.id}`}
                className="h-12 self-start rounded-2xl"
                onPress={() => setExpandedGroups((current) => ({ ...current, [groupKey]: !current[groupKey] }))}
                accessibilityLabel={isExpanded ? t('collapseGroup') : t('expandGroup')}
              >
                <Ionicons name={isExpanded ? 'chevron-up-outline' : 'chevron-down-outline'} size={15} color={primary} />
                <HeroButton.Label>{isExpanded ? t('collapseGroup') : t('expandGroup')}</HeroButton.Label>
              </HeroButton>
            ) : null}

            {isExpanded && expandable.length > 0 ? (
              <View testID={`notification-group-${item.id}`} className="gap-2 border-t border-border pt-2">
                {expandable.map((entry) => (
                  <NativePressable
                    key={entry.key}
                    className="flex-row items-start gap-2 py-1"
                    onPress={entry.onPress}
                    accessibilityRole={entry.onPress ? 'button' : undefined}
                    accessibilityLabel={entry.label}
                  >
                    {entry.avatarName !== undefined ? (
                      <Avatar uri={entry.avatarUrl ?? null} name={entry.avatarName} size={26} />
                    ) : (
                      <View className="mt-1.5 size-1.5 rounded-full" style={{ backgroundColor: theme.textMuted }} />
                    )}
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>
                        {entry.label}
                      </Text>
                      {entry.meta ? (
                        <Text className="text-xs" style={{ color: theme.textMuted }}>{entry.meta}</Text>
                      ) : null}
                    </View>
                  </NativePressable>
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
          onEndReached={() => { if (hasMore && !isLoadingMore) loadMore(); }}
          onEndReachedThreshold={0.3}
          ListFooterComponent={
            isLoadingMore ? (
              <View className="items-center py-4"><Spinner size="sm" /></View>
            ) : !hasMore && notifications.length > 0 ? (
              <View className="items-center py-4">
                <Text className="text-xs" style={{ color: theme.textMuted }}>{t('common:endOfList')}</Text>
              </View>
            ) : null
          }
          refreshControl={
            <RefreshControl refreshing={isLoading && notifications.length > 0} onRefresh={refreshAll} />
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
        <ActionSheet
          visible={actionSheet !== null}
          title={actionSheet?.title ?? ''}
          actions={actionSheet?.options ?? []}
          onClose={() => setActionSheet(null)}
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
  const known = [
    'messages', 'connections', 'reviews', 'transactions', 'social', 'groups',
    'listings', 'jobs', 'safeguarding', 'system', 'ideation', 'security', 'events',
    'exchanges', 'volunteering', 'marketplace',
  ];
  return category && known.includes(category) ? t(`category.${category}`) : t('category.other');
}


/*
  🔴 These names are the SERVER's, and they are plural.

  Both maps below were keyed on singular guesses — `message`, `listing`, `connection` —
  that `NotificationService` has never produced; its categories have always been
  `messages`, `listings`, `connections`. It did not matter until now only because the field
  was absent from the payload entirely, so every row fell to the default and the whole list
  rendered as identical grey bells. With the category now sent (2026-09-06), the keys have
  to be the real ones or the same thing happens with extra steps.
*/
function categoryIcon(category: string | undefined | null): React.ComponentProps<typeof Ionicons>['name'] {
  switch (category) {
    case 'messages': return 'chatbubble-outline';
    case 'connections': return 'person-add-outline';
    case 'reviews': return 'star-outline';
    case 'transactions': return 'swap-horizontal-outline';
    case 'social': return 'heart-outline';
    case 'groups': return 'people-outline';
    case 'listings': return 'pricetag-outline';
    case 'jobs': return 'briefcase-outline';
    case 'safeguarding': return 'shield-checkmark-outline';
    case 'system': return 'settings-outline';
    case 'ideation': return 'bulb-outline';
    case 'security': return 'lock-closed-outline';
    case 'events': return 'calendar-outline';
    case 'exchanges': return 'swap-horizontal-outline';
    case 'volunteering': return 'hand-left-outline';
    case 'marketplace': return 'cart-outline';
    default: return 'notifications-outline';
  }
}

function categoryColor(category: string | undefined | null, fallback: string, theme: Theme): string {
  switch (category) {
    case 'messages': return theme.info;
    case 'connections': return '#EC4899';
    case 'reviews': return '#F59E0B';
    case 'transactions': return theme.success;
    case 'social': return '#8B5CF6';
    case 'groups': return '#06B6D4';
    case 'listings': return '#10B981';
    case 'jobs': return '#0EA5E9';
    // Safeguarding and security read as "pay attention to this", so they take the
    // warning/danger end of the palette rather than a decorative hue.
    case 'safeguarding': return theme.error;
    case 'security': return theme.warning;
    case 'system': return theme.warning;
    case 'ideation': return '#6366F1';
    case 'events': return '#F97316';
    case 'exchanges': return theme.info;
    case 'volunteering': return '#14B8A6';
    case 'marketplace': return '#A855F7';
    default: return fallback;
  }
}

