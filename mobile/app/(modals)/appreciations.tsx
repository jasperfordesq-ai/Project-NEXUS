// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useMemo, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Button as HeroButton, Card as HeroCard, Chip, Spinner, Surface } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import {
  getUserAppreciations,
  reactToAppreciation,
  type Appreciation,
  type AppreciationReactionType,
} from '@/lib/api/appreciations';
import { useApi } from '@/lib/hooks/useApi';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withAlpha } from '@/lib/utils/color';
import AppTopBar from '@/components/ui/AppTopBar';
import { useAppToast } from '@/components/ui/AppToast';
import Avatar from '@/components/ui/Avatar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { dateLocale } from '@/lib/utils/dateLocale';

const REACTIONS: { key: AppreciationReactionType; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'heart', icon: 'heart-outline' },
  { key: 'clap', icon: 'sparkles-outline' },
  { key: 'star', icon: 'star-outline' },
];

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function AppreciationsScreen() {
  return (
    <ModalErrorBoundary>
      <AppreciationsScreenInner />
    </ModalErrorBoundary>
  );
}

function AppreciationsScreenInner() {
  const { t } = useTranslation(['members', 'common']);
  const params = useLocalSearchParams<{ userId?: string; id?: string; name?: string }>();
  const userId = params.userId ?? params.id ?? '';
  const titleName = params.name;
  const { isAuthenticated } = useAuth();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<Appreciation[]>([]);
  const [isReacting, setIsReacting] = useState<number | null>(null);

  const { data, isLoading, error, refresh } = useApi(
    () => getUserAppreciations(userId, page, 20),
    [userId, page],
    { enabled: userId.trim().length > 0 },
  );

  useEffect(() => {
    if (!data?.data) return;
    setItems((current) => (page === 1 ? data.data : [...current, ...data.data]));
  }, [data, page]);

  const totalPages = useMemo(() => data?.meta?.last_page ?? data?.meta?.total_pages ?? 1, [data?.meta?.last_page, data?.meta?.total_pages]);
  const canLoadMore = page < totalPages;

  function handleRefresh() {
    setPage(1);
    refresh();
  }

  async function handleReaction(appreciation: Appreciation, reactionType: AppreciationReactionType) {
    if (!isAuthenticated) {
      showToast({ title: t('appreciations.signInTitle'), description: t('appreciations.signInMessage'), variant: 'warning' });
      return;
    }
    const priorReaction = appreciation.my_reaction ?? null;
    setIsReacting(appreciation.id);
    setItems((current) =>
      current.map((item) => item.id === appreciation.id
        ? {
            ...item,
            my_reaction: priorReaction === reactionType ? null : reactionType,
            reactions_count: priorReaction === reactionType
              ? Math.max(0, item.reactions_count - 1)
              : priorReaction
                ? item.reactions_count
                : item.reactions_count + 1,
          }
        : item),
    );

    try {
      const response = await reactToAppreciation(appreciation.id, reactionType);
      const nextReaction = response.data?.reaction_type ?? null;
      setItems((current) =>
        current.map((item) => item.id === appreciation.id ? { ...item, my_reaction: nextReaction } : item),
      );
    } catch {
      setItems((current) => current.map((item) => item.id === appreciation.id ? appreciation : item));
      showToast({ title: t('common:errors.alertTitle'), description: t('appreciations.reactionFailed'), variant: 'danger' });
    } finally {
      setIsReacting(null);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
      <AppTopBar
        title={titleName ? t('appreciations.wallTitleFor', { name: titleName }) : t('appreciations.wallTitle')}
        backLabel={t('common:back')}
        fallbackHref={userId ? { pathname: '/(modals)/member-profile', params: { id: userId } } : '/(tabs)/profile'}
      />
      <FlatList<Appreciation>
        data={items}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={isLoading && page === 1} onRefresh={handleRefresh} tintColor={primary} colors={[primary]} />}
        contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
        ListHeaderComponent={
          <HeroCard variant="default" className="mb-4 overflow-hidden rounded-panel p-0">
            <View className="h-1" style={{ backgroundColor: primary }} />
            <HeroCard.Body className="gap-3 p-4">
              <View className="flex-row items-start gap-3">
                <View className="size-12 items-center justify-center rounded-3xl" style={{ backgroundColor: withAlpha(primary, 0.14) }}>
                  <Ionicons name="chatbubble-ellipses-outline" size={24} color={primary} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-2xl font-bold leading-8" style={{ color: theme.text }}>
                    {t('appreciations.wallTitle')}
                  </Text>
                  <Text className="mt-1 text-sm leading-5" style={{ color: theme.textSecondary }}>
                    {t('appreciations.wallSubtitle')}
                  </Text>
                </View>
              </View>
            </HeroCard.Body>
          </HeroCard>
        }
        renderItem={({ item }) => (
          <AppreciationCard
            item={item}
            primary={primary}
            isReacting={isReacting === item.id}
            onReact={(reaction) => void handleReaction(item, reaction)}
          />
        )}
        ListEmptyComponent={
          isLoading && page === 1 ? (
            <View className="items-center justify-center py-16">
              <LoadingSpinner />
            </View>
          ) : (
            <Surface variant="secondary" className="rounded-panel p-4">
              <EmptyState
                icon={error ? 'warning-outline' : 'chatbubble-ellipses-outline'}
                title={error ? t('appreciations.errorTitle') : t('appreciations.emptyTitle')}
                subtitle={error ?? t('appreciations.emptySubtitle')}
                actionLabel={error ? t('common:buttons.retry') : undefined}
                onAction={error ? handleRefresh : undefined}
              />
            </Surface>
          )
        }
        ListFooterComponent={
          canLoadMore ? (
            <HeroButton className="mt-4" variant="secondary" onPress={() => setPage((current) => current + 1)} isDisabled={isLoading}>
              {isLoading && page > 1 ? <Spinner size="sm" /> : <Ionicons name="chevron-down-outline" size={16} color={primary} />}
              <HeroButton.Label>{t('appreciations.loadMore')}</HeroButton.Label>
            </HeroButton>
          ) : null
        }
      />
    </SafeAreaView>
  );
}

function AppreciationCard({
  item,
  primary,
  isReacting,
  onReact,
}: {
  item: Appreciation;
  primary: string;
  isReacting: boolean;
  onReact: (reaction: AppreciationReactionType) => void;
}) {
  const { t } = useTranslation('profile');
  const theme = useTheme();
  const senderName = item.sender?.name ?? t('appreciations.someone');

  return (
    <HeroCard variant="default" className="mb-3 rounded-panel p-0">
      <HeroCard.Body className="gap-3 p-4">
        <View className="flex-row items-center gap-3">
          <Avatar uri={item.sender?.avatar_url ?? null} name={senderName} size={38} />
          <View className="min-w-0 flex-1">
            <Text className="text-sm font-bold" style={{ color: theme.text }} numberOfLines={1}>
              {senderName}
            </Text>
            <Text className="text-xs" style={{ color: theme.textSecondary }}>
              {formatDate(item.created_at)}
            </Text>
          </View>
          {item.reactions_count > 0 ? (
            <Chip size="sm" variant="secondary">
              <Ionicons name="heart-outline" size={12} color={primary} />
              <Chip.Label>{item.reactions_count}</Chip.Label>
            </Chip>
          ) : null}
        </View>
        <Text className="text-base leading-6" style={{ color: theme.text }}>
          {item.message}
        </Text>
        <View className="flex-row flex-wrap gap-2">
          {REACTIONS.map((reaction) => {
            const selected = item.my_reaction === reaction.key;
            return (
              <HeroButton
                key={reaction.key}
                size="sm"
                variant={selected ? 'secondary' : 'ghost'}
                isDisabled={isReacting}
                onPress={() => onReact(reaction.key)}
                accessibilityLabel={t(`appreciations.reaction.${reaction.key}`)}
              >
                {isReacting && selected ? <Spinner size="sm" /> : <Ionicons name={reaction.icon} size={16} color={selected ? primary : theme.textMuted} />}
                <HeroButton.Label style={{ color: selected ? primary : theme.textSecondary }}>
                  {t(`appreciations.react.${reaction.key}`)}
                </HeroButton.Label>
              </HeroButton>
            );
          })}
        </View>
      </HeroCard.Body>
    </HeroCard>
  );
}
