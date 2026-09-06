// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Button as HeroButton, Card as HeroCard, Chip, Spinner } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import { getTrendingHashtags, searchHashtags, type HashtagItem } from '@/lib/api/feed';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';

function normalizeHashtags(response: { data?: HashtagItem[] } | HashtagItem[]): HashtagItem[] {
  return Array.isArray(response) ? response : response.data ?? [];
}

export default function FeedHashtagsScreen() {
  const { t } = useTranslation(['home', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { hasModule } = useTenant();
  const [hashtags, setHashtags] = useState<HashtagItem[]>([]);
  const [searchResults, setSearchResults] = useState<HashtagItem[]>([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSearching, setIsSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadTrending = useCallback(async () => {
    if (!hasModule('feed')) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await getTrendingHashtags(50);
      setHashtags(normalizeHashtags(response));
    } catch {
      setError(t('hashtags.loadFailed'));
    } finally {
      setIsLoading(false);
    }
  }, [hasModule, t]);

  useEffect(() => {
    void loadTrending();
  }, [loadTrending]);

  useEffect(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    setSearchFailed(false);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const response = await searchHashtags(trimmed);
        setSearchResults(normalizeHashtags(response));
      } catch {
        /*
          🔴 An empty result list is rendered below as "No hashtags match …", so a dropped
          request told the member the tag does not exist (audit 2026-09-06). Same fault as
          the federated recipient search.
        */
        setSearchResults([]);
        setSearchFailed(true);
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, [query, searchAttempt]);

  const displayHashtags = useMemo(() => (query.trim().length >= 2 ? searchResults : hashtags), [hashtags, query, searchResults]);

  const renderHashtag = useCallback(
    ({ item }: { item: HashtagItem }) => (
      <HeroCard variant="default" className="mx-4 mb-3">
        <HeroCard.Body className="flex-row items-center gap-3 p-4">
          <View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: primary }}>
            <Ionicons name={item.trend_direction === 'up' ? 'trending-up-outline' : 'pricetag-outline'} size={20} color="#fff" />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-base font-semibold" style={{ color: theme.text }} numberOfLines={1}>
              #{item.tag}
            </Text>
            <Text className="text-xs" style={{ color: theme.textSecondary }}>
              {t('hashtags.postCount', { count: item.post_count })}
            </Text>
          </View>
          <HeroButton
            size="sm"
            variant="secondary"
            accessibilityLabel={t('hashtags.openTag', { tag: item.tag })}
            onPress={() => router.push({ pathname: '/(modals)/feed-hashtag' as never, params: { tag: item.tag } })}
          >
            <HeroButton.Label>{t('hashtags.open')}</HeroButton.Label>
          </HeroButton>
        </HeroCard.Body>
      </HeroCard>
    ),
    [primary, t, theme.text, theme.textSecondary],
  );

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('hashtags.title')} backLabel={t('common:buttons.back')} fallbackHref="/(tabs)/home" />
        {!hasModule('feed') ? (
          <EmptyState icon="pricetag-outline" title={t('common:errors.notFound')} subtitle={t('feed.emptySubtitle')} />
        ) : isLoading ? (
          <LoadingSpinner />
        ) : error ? (
          <EmptyState
            icon="warning-outline"
            title={t('hashtags.unableToLoad')}
            subtitle={error}
            actionLabel={t('common:buttons.retry')}
            onAction={() => void loadTrending()}
          />
        ) : (
          <FlatList
            data={displayHashtags}
            keyExtractor={(item) => item.tag}
            renderItem={renderHashtag}
            keyboardShouldPersistTaps="handled"
            ListHeaderComponent={
              <View className="mx-4 mb-4 gap-3">
                <HeroCard variant="secondary">
                  <HeroCard.Body className="gap-2 p-4">
                    <View className="flex-row items-center gap-2">
                      <Chip size="sm" variant="soft" color="accent">
                        <Ionicons name="pricetag-outline" size={13} color={primary} />
                        <Chip.Label>{t('hashtags.eyebrow')}</Chip.Label>
                      </Chip>
                      {isSearching ? <Spinner size="sm" /> : null}
                    </View>
                    <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                      {t('hashtags.subtitle')}
                    </Text>
                  </HeroCard.Body>
                </HeroCard>
                <Input
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t('hashtags.searchPlaceholder')}
                  accessibilityLabel={t('hashtags.searchPlaceholder')}
                  leftIcon={<Ionicons name="search-outline" size={18} color={theme.textMuted} />}
                  rightIcon={
                    query ? (
                      <HeroButton
                        isIconOnly
                        size="sm"
                        variant="ghost"
                        accessibilityLabel={t('common:actions.clear')}
                        onPress={() => setQuery('')}
                      >
                        <Ionicons name="close-circle-outline" size={18} color={theme.textMuted} />
                      </HeroButton>
                    ) : null
                  }
                />
              </View>
            }
            ListEmptyComponent={
              searchFailed ? (
                <EmptyState
                  icon="cloud-offline-outline"
                  title={t('hashtags.searchFailedTitle')}
                  subtitle={t('hashtags.searchFailedSubtitle')}
                  actionLabel={t('common:buttons.retry')}
                  onAction={() => setSearchAttempt((n) => n + 1)}
                />
              ) : (
                <EmptyState
                  icon="pricetag-outline"
                  title={t('hashtags.emptyTitle')}
                  subtitle={query.trim().length >= 2 ? t('hashtags.noMatch', { query }) : t('hashtags.emptySubtitle')}
                />
              )
            }
            contentContainerStyle={{ paddingBottom: 28 }}
          />
        )}
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}
