// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { contrastText } from '@/lib/utils/color';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Platform, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Swipeable } from 'react-native-gesture-handler';
import * as Haptics from '@/lib/haptics';
import { Button as HeroButton, Card as HeroCard, Separator, Spinner, Surface } from 'heroui-native';
import { Chip } from '@/components/ui/StatusChip';
import { useTranslation } from 'react-i18next';

import { archiveConversation, getConversations, restoreConversation, displayName, type Conversation, type ConversationListResponse } from '@/lib/api/messages';
import { usePaginatedApi } from '@/lib/hooks/usePaginatedApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme, type Theme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import Avatar from '@/components/ui/Avatar';
import Input from '@/components/ui/Input';
import NativePressable from '@/components/ui/NativePressable';
import { ConversationSkeleton } from '@/components/ui/Skeleton';
import { formatRelativeTime } from '@/lib/utils/formatRelativeTime';
import { describeApiError } from '@/lib/api/describeApiError';
import AccentIcon from '@/components/ui/AccentIcon';

function extractConversationsPage(response: ConversationListResponse) {
  return {
    items: response.data,
    cursor: response.meta.cursor ?? null,
    hasMore: response.meta.has_more,
  };
}

type TFunction = (key: string, options?: Record<string, unknown>) => string;
type MessagesTab = 'inbox' | 'archived';

export default function MessagesScreen() {
  const { t } = useTranslation(['messages', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const unknownMemberLabel = t('unknownMember');
  const navigation = useRouter();
  const params = useLocalSearchParams<{
    to?: string | string[];
    to_user?: string | string[];
    user?: string | string[];
    name?: string | string[];
    listing?: string | string[];
    context?: string | string[];
    context_type?: string | string[];
    context_id?: string | string[];
  }>();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<MessagesTab>('inbox');
  const handledDeepLinkRef = useRef<string | null>(null);

  const fetchInboxConversations = useCallback((cursor: string | null) => getConversations(cursor), []);
  const fetchArchivedConversations = useCallback((cursor: string | null) => getConversations(cursor, { archived: true }), []);

  const inboxPage = usePaginatedApi<Conversation, ConversationListResponse>(fetchInboxConversations, extractConversationsPage);
  const archivedPage = usePaginatedApi<Conversation, ConversationListResponse>(fetchArchivedConversations, extractConversationsPage);
  const activePage = activeTab === 'archived' ? archivedPage : inboxPage;
  const { items: conversations } = inboxPage;
  const { items: archivedConversations } = archivedPage;

  /*
    Returning from a thread showed the OLD preview and unread count until the member pulled
    to refresh, while the tab-bar badge (refreshed by the tab layout) already showed the new
    total — two numbers for one inbox. Refresh the inbox page on every return; the first
    mount already fetched, so it is skipped.
  */
  const hasFocusedOnceRef = useRef(false);
  const refreshInbox = inboxPage.refresh;
  useFocusEffect(
    useCallback(() => {
      if (!hasFocusedOnceRef.current) {
        hasFocusedOnceRef.current = true;
        return;
      }
      refreshInbox();
    }, [refreshInbox]),
  );
  const {
    items: activeConversations,
    isLoading,
    isLoadingMore,
    error,
    hasMore,
    loadMore,
    refresh,
  } = activePage;

  const totalUnread = useMemo(
    () => conversations.reduce((sum, conversation) => sum + (conversation.unread_count ?? 0), 0),
    [conversations],
  );

  const filteredConversations = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return activeConversations;
    return activeConversations.filter((conversation) => {
      const otherName = displayName(conversation.other_user, unknownMemberLabel).toLowerCase();
      const lastMsg = conversation.last_message;
      const lastMsgBody = (lastMsg?.body ?? lastMsg?.content ?? '').toLowerCase();
      return otherName.includes(query) || lastMsgBody.includes(query);
    });
  }, [activeConversations, searchQuery, unknownMemberLabel]);

  const hasSearchQuery = searchQuery.trim().length > 0;

  useEffect(() => {
    const recipientParam = firstParam(params.to) ?? firstParam(params.to_user) ?? firstParam(params.user);
    if (!recipientParam) return;
    const recipientId = Number(recipientParam);
    if (!Number.isFinite(recipientId) || recipientId <= 0) return;
    const recipientName = firstParam(params.name);
    const listing = firstParam(params.listing);
    const contextType = firstParam(params.context_type) ?? firstParam(params.context);
    const contextId = firstParam(params.context_id);
    const deepLinkKey = [recipientId, recipientName ?? '', listing ?? '', contextType ?? '', contextId ?? ''].join(':');
    if (handledDeepLinkRef.current === deepLinkKey) return;
    handledDeepLinkRef.current = deepLinkKey;
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const threadParams = new URLSearchParams({ recipientId: String(recipientId) });
      if (recipientName) threadParams.set('name', recipientName);
      if (listing) threadParams.set('listing', listing);
      if (contextType) threadParams.set('context_type', contextType);
      if (contextId) threadParams.set('context_id', contextId);
      window.location.assign(`/thread?${threadParams.toString()}`);
      return;
    }
    void navigation.push({
      pathname: '/(modals)/thread',
      params: {
        recipientId: String(recipientId),
        ...(recipientName ? { name: recipientName } : {}),
        ...(listing ? { listing } : {}),
        ...(contextType ? { context_type: contextType } : {}),
        ...(contextId ? { context_id: contextId } : {}),
      },
    } as never);
  }, [navigation, params.context, params.context_id, params.context_type, params.listing, params.name, params.to, params.to_user, params.user]);

  const openNewMessage = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.push('/(modals)/new-message');
  }, [navigation]);

  const openNewGroup = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    navigation.push({ pathname: '/(modals)/new-group' } as never);
  }, [navigation]);

  function handleArchiveConversation(conversation: Conversation) {
    confirm({
      title: t('archiveConversation'),
      message: t('archiveConfirm', { name: displayName(conversation.other_user, unknownMemberLabel) }),
      confirmLabel: t('archive'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'primary',
      onConfirm: async () => {
        try {
          await archiveConversation(conversation.id);
          void inboxPage.refresh();
          void archivedPage.refresh();
        } catch (err) {
          showToast({ title: t('errors.archiveFailedTitle'), description: describeApiError(err, t('errors.archiveFailed')), variant: 'danger' });
        }
      },
    });
  }

  async function handleRestoreConversation(conversation: Conversation) {
    try {
      await restoreConversation(conversation.id);
      void inboxPage.refresh();
      void archivedPage.refresh();
    } catch (err) {
      showToast({ title: t('errors.restoreFailedTitle'), description: describeApiError(err, t('errors.restoreFailed')), variant: 'danger' });
    }
  }

  function renderConversation({ item }: { item: Conversation }) {
    if (activeTab === 'archived') {
      return (
        <ArchivedConversationCard
          conversation={item}
          primary={primary}
          theme={theme}
          t={t}
          unknownMemberLabel={unknownMemberLabel}
          onRestore={handleRestoreConversation}
        />
      );
    }

    return (
      <ConversationCard
        conversation={item}
        primary={primary}
        theme={theme}
        t={t}
        unknownMemberLabel={unknownMemberLabel}
        onArchive={handleArchiveConversation}
        onOpen={(conversation) => {
          const otherName = displayName(conversation.other_user, unknownMemberLabel);
          const recipientId = Number(conversation.other_user?.id);
          if (!Number.isFinite(recipientId) || recipientId <= 0) {
            showToast({ title: t('errors.threadUnavailableTitle'), description: t('errors.threadUnavailable'), variant: 'danger' });
            return;
          }
          void navigation.push({
            pathname: '/(modals)/thread',
            params: { recipientId: String(recipientId), name: otherName },
          } as never);
        }}
      />
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <FlatList<Conversation>
        data={filteredConversations}
        keyExtractor={(item) => String(item.id)}
        renderItem={renderConversation}
        ListHeaderComponent={
          <MessagesHeader
            t={t}
            primary={primary}
            theme={theme}
            totalCount={conversations.length}
            visibleCount={filteredConversations.length}
            totalUnread={totalUnread}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            archivedCount={archivedConversations.length}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            isLoading={isLoading}
            onNewMessage={openNewMessage}
            onNewGroup={openNewGroup}
          />
        }
        refreshControl={
          <RefreshControl
            refreshing={isLoading && activeConversations.length > 0}
            onRefresh={refresh}
            tintColor={primary}
            colors={[primary]}
          />
        }
        onEndReached={() => { if (hasMore) void loadMore(); }}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          isLoading && activeConversations.length === 0 ? (
            <><ConversationSkeleton /><ConversationSkeleton /><ConversationSkeleton /><ConversationSkeleton /></>
          ) : error ? (
            <HeroCard variant="secondary" className="mx-4 my-8">
              <HeroCard.Body className="items-center gap-4">
                <Ionicons name="warning-outline" size={30} color={primary} />
                <Text className="text-center text-sm leading-5" style={{ color: theme.textSecondary }}>{error}</Text>
                <HeroButton variant="primary" onPress={() => void refresh()}>
                  <HeroButton.Label>{t('common:buttons.retry')}</HeroButton.Label>
                </HeroButton>
              </HeroCard.Body>
            </HeroCard>
          ) : (
            <HeroCard variant="secondary" className="mx-4 my-8">
              <HeroCard.Body className="items-center gap-3">
                <Ionicons name={hasSearchQuery ? 'search-outline' : 'chatbubbles-outline'} size={34} color={primary} />
                <Text className="text-center text-[17px] font-semibold" style={{ color: theme.text }}>
                  {activeTab === 'archived'
                    ? hasSearchQuery ? t('empty.searchTitle') : t('empty.archivedTitle')
                    : hasSearchQuery ? t('empty.searchTitle') : t('empty.title')}
                </Text>
                <Text className="text-center text-sm leading-5" style={{ color: theme.textSecondary }}>
                  {activeTab === 'archived'
                    ? hasSearchQuery ? t('empty.searchSubtitle') : t('empty.archivedSubtitle')
                    : hasSearchQuery ? t('empty.searchSubtitle') : t('empty.subtitle')}
                </Text>
                {hasSearchQuery ? (
                  <HeroButton variant="secondary" size="sm" onPress={() => setSearchQuery('')}>
                    <Ionicons name="close-circle-outline" size={16} color={theme.textSecondary} />
                    <HeroButton.Label>{t('clearSearch')}</HeroButton.Label>
                  </HeroButton>
                ) : (
                  activeTab === 'inbox' ? (
                    <HeroButton variant="primary" size="sm" onPress={openNewMessage}>
                    <AccentIcon name="create-outline" size={16} />
                    <HeroButton.Label>{t('newMessage')}</HeroButton.Label>
                    </HeroButton>
                  ) : null
                )}
              </HeroCard.Body>
            </HeroCard>
          )
        }
        ListFooterComponent={
          isLoadingMore ? (
            <View className="py-4 items-center"><Spinner size="sm" /></View>
          ) : !hasMore && filteredConversations.length > 0 && !isLoading ? (
            <View className="py-4 items-center">
              <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('common:endOfList')}</Text>
            </View>
          ) : null
        }
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
      />
      {confirmDialog}
    </SafeAreaView>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

function MessagesHeader({
  t,
  primary,
  theme,
  totalCount,
  visibleCount,
  totalUnread,
  activeTab,
  setActiveTab,
  archivedCount,
  searchQuery,
  setSearchQuery,
  isLoading,
  onNewMessage,
  onNewGroup,
}: {
  t: TFunction;
  primary: string;
  theme: Theme;
  totalCount: number;
  visibleCount: number;
  totalUnread: number;
  activeTab: MessagesTab;
  setActiveTab: (tab: MessagesTab) => void;
  archivedCount: number;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  isLoading: boolean;
  onNewMessage: () => void;
  onNewGroup: () => void;
}) {
  return (
    <View className="gap-3 pb-2">
      <HeroCard variant="default" className="mx-4 mt-4 overflow-hidden">
        <View className="h-1 w-full" style={{ backgroundColor: primary }} />
        <HeroCard.Body className="gap-4 px-4 py-4">
          <View className="flex-row items-start justify-between gap-4">
            <View className="min-w-0 flex-1">
              <View className="mb-2 flex-row items-center gap-2">
                <View className="h-8 w-8 items-center justify-center rounded-full" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                  <Ionicons name="chatbubbles-outline" size={18} color={primary} />
                </View>
                <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }}>
                  {t('heroEyebrow')}
                </Text>
              </View>
              <Text className="text-2xl font-bold leading-8" style={{ color: theme.text }}>
                {t('title')}
              </Text>
              <Text className="mt-1 text-sm leading-5" style={{ color: theme.textSecondary }}>
                {t('subtitle')}
              </Text>
            </View>
            <View className="flex-row gap-2">
              <HeroButton
                isIconOnly
                variant="secondary"
                accessibilityLabel={t('newGroup')}
                onPress={onNewGroup}
              >
                <Ionicons name="people-outline" size={18} color={primary} />
              </HeroButton>
              <HeroButton
                isIconOnly
                variant="primary"
                accessibilityLabel={t('newMessage')}
                onPress={onNewMessage}
              >
                <AccentIcon name="create-outline" size={18} />
              </HeroButton>
            </View>
          </View>

          <View className="flex-row flex-wrap gap-2">
            <Chip size="sm" variant="soft" color="accent">
              <Ionicons name="mail-unread-outline" size={12} color={primary} />
              <Chip.Label>{t('unreadCount', { count: totalUnread })}</Chip.Label>
            </Chip>
            <Chip size="sm" variant="soft" color="default">
              <Ionicons name="people-outline" size={12} color={theme.textMuted} />
              <Chip.Label>{isLoading ? t('resultsLoading') : t('conversationCount', { count: totalCount })}</Chip.Label>
            </Chip>
          </View>
        </HeroCard.Body>
      </HeroCard>

      <Surface variant="default" className="mx-4 gap-3 rounded-panel-inner p-3">
        <View className="flex-row gap-2">
          <HeroButton
            className="flex-1"
            size="sm"
            variant={activeTab === 'inbox' ? 'primary' : 'secondary'}
            accessibilityState={{ selected: activeTab === 'inbox' }}
            onPress={() => setActiveTab('inbox')}
          >
            {activeTab === 'inbox' ? <AccentIcon name="mail-outline" size={15} /> : <Ionicons name="mail-outline" size={15} color={primary} />}
            <HeroButton.Label>{t('tabs.inbox')}</HeroButton.Label>
          </HeroButton>
          <HeroButton
            className="flex-1"
            size="sm"
            variant={activeTab === 'archived' ? 'primary' : 'secondary'}
            accessibilityState={{ selected: activeTab === 'archived' }}
            onPress={() => setActiveTab('archived')}
          >
            {activeTab === 'archived' ? <AccentIcon name="archive-outline" size={15} /> : <Ionicons name="archive-outline" size={15} color={primary} />}
            <HeroButton.Label>{t('tabs.archived')}</HeroButton.Label>
          </HeroButton>
        </View>

        <View className="flex-row items-center justify-between gap-3">
          <View className="min-w-0 flex-1">
            <Text className="text-base font-semibold" style={{ color: theme.text }}>
              {activeTab === 'archived' ? t('tabs.archived') : t('inbox')}
            </Text>
            <Text className="mt-0.5 text-sm" style={{ color: theme.textSecondary }} numberOfLines={2}>
              {t('filtersIntro')}
            </Text>
          </View>
          {/* "N shown" only means something while a search is narrowing the list. */}
          {activeTab === 'archived' || searchQuery.trim() ? (
            <Chip size="sm" variant="soft" color="default">
              <Chip.Label>
                {activeTab === 'archived'
                  ? t('archivedCount', { count: archivedCount })
                  : t('visibleCount', { count: visibleCount })}
              </Chip.Label>
            </Chip>
          ) : null}
        </View>

        <Input
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t('searchPlaceholder')}
          placeholderTextColor={theme.textMuted}
          style={{ color: theme.text }}
          returnKeyType="search"
          accessibilityLabel={t('searchPlaceholder')}
          leftIcon={<Ionicons name="search-outline" size={18} color={theme.textMuted} />}
          rightIcon={searchQuery ? (
            <HeroButton isIconOnly size="sm" variant="ghost" accessibilityLabel={t('clearSearch')} onPress={() => setSearchQuery('')}>
              <Ionicons name="close-circle" size={18} color={theme.textMuted} />
            </HeroButton>
          ) : null}
        />
      </Surface>
    </View>
  );
}

function ConversationCard({
  conversation,
  primary,
  theme,
  t,
  unknownMemberLabel,
  onArchive,
  onOpen,
}: {
  conversation: Conversation;
  primary: string;
  theme: Theme;
  t: TFunction;
  unknownMemberLabel: string;
  onArchive: (conversation: Conversation) => void;
  onOpen: (conversation: Conversation) => void;
}) {
  const lastMsg = conversation.last_message;
  const otherName = displayName(conversation.other_user, unknownMemberLabel);
  const lastMsgBody = lastMsg?.body ?? lastMsg?.content ?? '';
  const lastMsgIsOwn = lastMsg?.is_own ?? (lastMsg?.sender_id != null && lastMsg.sender_id === conversation.other_user?.id ? false : true);
  const unreadCount = conversation.unread_count ?? 0;
  const isUnread = unreadCount > 0;
  const ownMessagePrefix = formatOwnMessagePrefix(t('thread.you'));

  return (
    <Swipeable
      renderRightActions={() => (
        <HeroButton
          variant="primary"
          className="my-2 mr-4 w-[92px] items-center justify-center gap-1 rounded-2xl px-2"
          accessibilityLabel={t('archiveConversationWithName', { name: otherName })}
          onPress={() => onArchive(conversation)}
        >
          <AccentIcon name="archive-outline" size={21} />
          <HeroButton.Label className="text-xs font-semibold" numberOfLines={1}>{t('archive')}</HeroButton.Label>
        </HeroButton>
      )}
      overshootRight={false}
      onSwipeableWillOpen={() => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)}
      onSwipeableOpen={() => onArchive(conversation)}
    >
      <NativePressable
        className="mx-4 my-2 rounded-panel"
        accessibilityLabel={`${otherName}${lastMsgBody ? `, ${lastMsgBody}` : ''}`}
        onPress={() => {
          onOpen(conversation);
        }}
        feedback="highlight"
      >
        <HeroCard variant={isUnread ? 'default' : 'secondary'} className="w-full overflow-hidden rounded-panel p-0">
          <View className="h-1 w-full" style={{ backgroundColor: isUnread ? primary : theme.border }} />
          <HeroCard.Body className="gap-3 px-4 py-4">
            <View className="flex-row items-center gap-3">
              <View className="relative">
                <Avatar
                  uri={conversation.other_user?.avatar_url ?? null}
                  name={otherName}
                  size={52}
                  showOnline={conversation.other_user?.is_online ?? false}
                />
                {isUnread ? (
                  <View
                    className="absolute -right-1 -top-1 min-w-[22px] items-center justify-center rounded-full px-1.5 py-0.5"
                    style={{ backgroundColor: primary }}
                  >
                    <Text className="text-[11px] font-bold" style={{ color: contrastText(primary) }}>{unreadCount > 99 ? '99+' : unreadCount}</Text>
                  </View>
                ) : null}
              </View>

              <View className="min-w-0 flex-1 gap-1">
                <View className="flex-row items-center justify-between gap-3">
                  <Text
                    className={`min-w-0 flex-1 text-base ${isUnread ? 'font-bold' : 'font-semibold'}`}
                    style={{ color: isUnread ? theme.text : theme.textSecondary }}
                    numberOfLines={1}
                  >
                    {otherName}
                  </Text>
                  {lastMsg ? (
                    <Text className="max-w-[86px] text-right text-xs" style={{ color: theme.textMuted }} numberOfLines={1}>
                      {formatRelativeTime(lastMsg.created_at, true)}
                    </Text>
                  ) : null}
                </View>

                <View className="flex-row items-center gap-2">
                  {lastMsgIsOwn && lastMsgBody ? (
                    <Ionicons name="checkmark-done-outline" size={14} color={theme.textMuted} />
                  ) : null}
                  <Text
                    className={`min-w-0 flex-1 text-sm leading-5 ${isUnread ? 'font-semibold' : ''}`}
                    style={{ color: isUnread ? theme.textSecondary : theme.textMuted }}
                    numberOfLines={2}
                  >
                    {lastMsgBody
                      ? `${lastMsgIsOwn ? ownMessagePrefix : ''}${lastMsgBody}`
                      : t('thread.noMessages')}
                  </Text>
                </View>
              </View>
            </View>
          </HeroCard.Body>

          <View className="mx-4">
            <Separator />
          </View>
          <HeroCard.Footer className="flex-row items-center justify-between gap-3 px-4 py-3">
            <View className="flex-row items-center gap-2">
              <Ionicons name={isUnread ? 'mail-unread-outline' : 'mail-open-outline'} size={15} color={isUnread ? primary : theme.textMuted} />
              <Text className="text-xs" style={{ color: isUnread ? primary : theme.textSecondary }}>
                {isUnread ? t('unreadCount', { count: unreadCount }) : t('readStatus')}
              </Text>
            </View>
            <View className="flex-row items-center gap-1">
              <Text className="text-xs" style={{ color: theme.textMuted }}>{t('openThread')}</Text>
              <Ionicons name="arrow-forward" size={16} color={primary} />
            </View>
          </HeroCard.Footer>
        </HeroCard>
      </NativePressable>
    </Swipeable>
  );
}

function ArchivedConversationCard({
  conversation,
  primary,
  theme,
  t,
  unknownMemberLabel,
  onRestore,
}: {
  conversation: Conversation;
  primary: string;
  theme: Theme;
  t: TFunction;
  unknownMemberLabel: string;
  onRestore: (conversation: Conversation) => void;
}) {
  const lastMsg = conversation.last_message;
  const otherName = displayName(conversation.other_user, unknownMemberLabel);
  const lastMsgBody = lastMsg?.body ?? lastMsg?.content ?? '';

  return (
    <HeroCard variant="secondary" className="mx-4 my-2 overflow-hidden rounded-panel p-0">
      <HeroCard.Body className="flex-row items-center gap-3 px-4 py-4">
        <Avatar
          uri={conversation.other_user?.avatar_url ?? null}
          name={otherName}
          size={50}
        />
        <View className="min-w-0 flex-1 gap-1">
          <View className="flex-row items-center justify-between gap-3">
            <Text className="min-w-0 flex-1 text-base font-semibold" style={{ color: theme.textSecondary }} numberOfLines={1}>
              {otherName}
            </Text>
            {lastMsg ? (
              <Text className="max-w-[86px] text-right text-xs" style={{ color: theme.textMuted }} numberOfLines={1}>
                {formatRelativeTime(lastMsg.created_at, true)}
              </Text>
            ) : null}
          </View>
          {lastMsgBody ? (
            <Text className="text-sm leading-5" style={{ color: theme.textMuted }} numberOfLines={2}>
              {lastMsgBody}
            </Text>
          ) : (
            <Text className="text-sm leading-5" style={{ color: theme.textMuted }} numberOfLines={2}>
              {t('thread.noMessages')}
            </Text>
          )}
        </View>
        <HeroButton
          isIconOnly
          size="sm"
          variant="secondary"
          accessibilityLabel={t('restoreConversationWithName', { name: otherName })}
          onPress={() => onRestore(conversation)}
        >
          <Ionicons name="refresh-outline" size={17} color={primary} />
        </HeroButton>
      </HeroCard.Body>
    </HeroCard>
  );
}

function formatOwnMessagePrefix(label: string): string {
  const trimmed = label.trim();
  return trimmed.endsWith(':') ? `${trimmed} ` : `${trimmed}: `;
}
