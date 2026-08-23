// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, RefreshControl, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Chip, Spinner, Surface, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import Avatar from '@/components/ui/Avatar';
import Input from '@/components/ui/Input';
import NativePressable from '@/components/ui/NativePressable';
import { SkeletonBox } from '@/components/ui/Skeleton';
import { getMembers, type Member, type MemberListResponse } from '@/lib/api/members';
import * as Haptics from '@/lib/haptics';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { usePaginatedApi } from '@/lib/hooks/usePaginatedApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme, type Theme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';

type TFunction = (key: string, options?: Record<string, unknown>) => string;

function extractMembersPage(response: MemberListResponse) {
  const nextOffset = response.meta.offset + response.data.length;
  return {
    items: response.data,
    cursor: response.meta.has_more ? String(nextOffset) : null,
    hasMore: response.meta.has_more,
  };
}

function NewMessageRouteInner() {
  const { t } = useTranslation(['messages', 'common']);
  const router = useRouter();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const [search, setSearch] = useState('');
  const [totalMembers, setTotalMembers] = useState<number | null>(null);
  const debouncedSearch = useDebounce(search, 350);

  const fetchMembers = useCallback(
    async (cursor: string | null) => {
      const offset = cursor ? Number(cursor) : 0;
      const response = await getMembers(Number.isFinite(offset) ? offset : 0, debouncedSearch || undefined);
      setTotalMembers(response.meta.total_items ?? null);
      return response;
    },
    [debouncedSearch],
  );

  const { items, isLoading, isLoadingMore, error, hasMore, loadMore, refresh } =
    usePaginatedApi<Member, MemberListResponse>(fetchMembers, extractMembersPage, [debouncedSearch]);

  const hasSearch = search.trim().length > 0;

  const openThread = useCallback((member: Member) => {
    const recipientId = Number(member.id);
    if (!Number.isFinite(recipientId) || recipientId <= 0) return;
    const name = getMemberDisplayName(member, t('composer.memberFallback'));
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setTimeout(() => {
      const destination = {
        pathname: '/(modals)/thread',
        params: { recipientId: String(recipientId), name },
      } as const;
      if (typeof router.push === 'function') router.push(destination);
      else router.replace(destination);
    }, 0);
  }, [router, t]);

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <KeyboardAvoidingView
        className="flex-1"
        style={{ flex: 1, backgroundColor: theme.bg }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <AppTopBar title={t('newMessage')} backLabel={t('common:buttons.back')} fallbackHref="/(tabs)/messages" />
        <FlatList<Member>
          data={items}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <MessageMemberCard
              member={item}
              primary={primary}
              theme={theme}
              t={t}
              onPress={() => openThread(item)}
            />
          )}
          ListHeaderComponent={
            <NewMessageHeader
              t={t}
              primary={primary}
              theme={theme}
              search={search}
              setSearch={setSearch}
              count={totalMembers ?? items.length}
              isLoading={isLoading}
            />
          }
          refreshControl={
            <RefreshControl
              refreshing={isLoading && items.length > 0}
              onRefresh={refresh}
              tintColor={primary}
              colors={[primary]}
            />
          }
          onEndReached={() => { if (hasMore) void loadMore(); }}
          onEndReachedThreshold={0.35}
          ListEmptyComponent={
            isLoading ? (
              <>
                <MessageMemberSkeleton />
                <MessageMemberSkeleton />
                <MessageMemberSkeleton />
                <MessageMemberSkeleton />
              </>
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
                  <Ionicons name={hasSearch ? 'search-outline' : 'people-outline'} size={34} color={primary} />
                  <Text className="text-center text-[17px] font-semibold" style={{ color: theme.text }}>
                    {t('composer.emptyTitle')}
                  </Text>
                  <Text className="text-center text-sm leading-5" style={{ color: theme.textSecondary }}>
                    {t('composer.emptySubtitle')}
                  </Text>
                  {hasSearch ? (
                    <HeroButton variant="secondary" size="sm" onPress={() => setSearch('')}>
                      <Ionicons name="close-circle-outline" size={16} color={theme.textSecondary} />
                      <HeroButton.Label>{t('clearSearch')}</HeroButton.Label>
                    </HeroButton>
                  ) : null}
                </HeroCard.Body>
              </HeroCard>
            )
          }
          ListFooterComponent={
            isLoadingMore ? (
              <View className="items-center py-4"><Spinner size="sm" /></View>
            ) : !hasMore && items.length > 0 && !isLoading ? (
              <View className="items-center py-4">
                <Text className="text-xs" style={{ color: theme.textSecondary }}>{t('common:endOfList')}</Text>
              </View>
            ) : null
          }
          keyboardShouldPersistTaps="handled"
          style={{ flex: 1, backgroundColor: theme.bg }}
          contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function NewMessageHeader({
  t,
  primary,
  theme,
  search,
  setSearch,
  count,
  isLoading,
}: {
  t: TFunction;
  primary: string;
  theme: Theme;
  search: string;
  setSearch: (value: string) => void;
  count: number;
  isLoading: boolean;
}) {
  return (
    <View className="gap-3 pb-3">
      <HeroCard variant="default" className="mx-4 mt-3 overflow-hidden rounded-panel p-0">
        <View className="h-1 w-full" style={{ backgroundColor: primary }} />
        <HeroCard.Body className="gap-4 p-4">
          <View className="flex-row items-center gap-3">
            <View className="h-12 w-12 items-center justify-center rounded-2xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
              <Ionicons name="chatbubble-ellipses-outline" size={24} color={primary} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-xs font-semibold uppercase" style={{ color: theme.textSecondary }} numberOfLines={1}>
                {t('composer.eyebrow')}
              </Text>
              <Text className="mt-1 text-[26px] font-bold leading-8" style={{ color: theme.text }} numberOfLines={1}>
                {t('newMessage')}
              </Text>
              <Text className="mt-1 text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>
                {t('composer.subtitle')}
              </Text>
            </View>
          </View>

          <View className="flex-row flex-wrap gap-2">
            <Chip size="sm" variant="soft" color="accent">
              <Ionicons name="people-outline" size={12} color={primary} />
              <Chip.Label>{isLoading ? t('composer.loading') : t('composer.resultsCount', { count })}</Chip.Label>
            </Chip>
          </View>
        </HeroCard.Body>
      </HeroCard>

      <Surface
        variant="default"
        className="mx-4 gap-3 overflow-hidden rounded-panel p-3.5"
        style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
      >
        <Input
          value={search}
          onChangeText={setSearch}
          placeholder={t('composer.searchPlaceholder')}
          placeholderTextColor={theme.textMuted}
          returnKeyType="search"
          accessibilityLabel={t('composer.searchPlaceholder')}
          style={{ color: theme.text }}
          leftIcon={<Ionicons name="search-outline" size={18} color={theme.textMuted} />}
          rightIcon={search ? (
            <HeroButton isIconOnly size="sm" variant="ghost" accessibilityLabel={t('clearSearch')} onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={18} color={theme.textMuted} />
            </HeroButton>
          ) : null}
        />
      </Surface>
    </View>
  );
}

function MessageMemberCard({
  member,
  primary,
  theme,
  t,
  onPress,
}: {
  member: Member;
  primary: string;
  theme: Theme;
  t: TFunction;
  onPress: () => void;
}) {
  const name = getMemberDisplayName(member, t('composer.memberFallback'));
  const subtitle = member.tagline || member.location || t('composer.memberFallback');

  return (
    <NativePressable
      className="mx-4 my-1.5 rounded-panel"
      accessibilityLabel={t('composer.openThread', { name })}
      onPress={onPress}
      feedback="highlight"
    >
      <HeroCard variant="secondary" className="overflow-hidden rounded-panel p-0">
        <HeroCard.Body className="flex-row items-center gap-3 px-4 py-4">
          <Avatar
            uri={member.avatar_url ?? member.avatar ?? null}
            name={name}
            size={52}
          />
          <View className="min-w-0 flex-1 gap-1">
            <Text className="text-base font-semibold" style={{ color: theme.text }} numberOfLines={1}>
              {name}
            </Text>
            <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={2}>
              {subtitle}
            </Text>
          </View>
          <View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: withAlpha(primary, 0.12) }}>
            <Ionicons name="chatbubble-outline" size={18} color={primary} />
          </View>
        </HeroCard.Body>
      </HeroCard>
    </NativePressable>
  );
}

function MessageMemberSkeleton() {
  const theme = useTheme();
  return (
    <Surface
      variant="default"
      className="mx-4 my-1.5 overflow-hidden rounded-panel p-4"
      style={{ borderWidth: 1, borderColor: theme.borderSubtle }}
    >
      <View className="flex-row items-center gap-3">
        <SkeletonBox width={52} height={52} borderRadius={26} />
        <View className="flex-1 gap-2">
          <SkeletonBox width="62%" height={16} />
          <SkeletonBox width="82%" height={12} />
        </View>
      </View>
    </Surface>
  );
}

function getMemberDisplayName(member: Member, fallback: string): string {
  const fullName = `${member.first_name ?? ''} ${member.last_name ?? ''}`.trim();
  return member.name?.trim() || fullName || fallback;
}

export default function NewMessageRoute() {
  return (
    <ModalErrorBoundary>
      <NewMessageRouteInner />
    </ModalErrorBoundary>
  );
}
