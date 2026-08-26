// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';

import { getFeedItem, type FeedItem as FeedItemType, type FeedItemType as FeedType } from '@/lib/api/feed';
import ReactorsSheet from '@/components/reactions/ReactorsSheet';
import { usePrimaryColor, useTenant } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import FeedItem, { type FeedReactorsTarget } from '@/components/FeedItem';
import { useTranslation } from 'react-i18next';

const SUPPORTED_TYPES = new Set<FeedType>([
  'post',
  'listing',
  'event',
  'poll',
  'goal',
  'job',
  'challenge',
  'volunteer',
  'review',
  'blog',
  'discussion',
  'resource',
]);

function normalizeType(value: string | string[] | undefined): FeedType {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw && SUPPORTED_TYPES.has(raw as FeedType) ? (raw as FeedType) : 'post';
}

function normalizeId(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function FeedItemDetailScreenInner() {
  const { t } = useTranslation(['home', 'common']);
  const params = useLocalSearchParams<{ id?: string; type?: string }>();
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { hasModule } = useTenant();
  const type = useMemo(() => normalizeType(params.type), [params.type]);
  const id = useMemo(() => normalizeId(params.id), [params.id]);
  const [item, setItem] = useState<FeedItemType | null>(null);
  const [reactorsTarget, setReactorsTarget] = useState<FeedReactorsTarget | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadItem = useCallback(async (refreshing = false) => {
    if (!id || !hasModule('feed')) {
      setIsLoading(false);
      return;
    }

    if (refreshing) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const response = await getFeedItem(type, id);
      setItem(response.data);
    } catch {
      setError(t('common:errors.generic'));
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [hasModule, id, t, type]);

  useEffect(() => {
    void loadItem(false);
  }, [loadItem]);

  const title = item?.title || t('feedTypes.post');

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={title} backLabel={t('common:buttons.back')} fallbackHref="/(tabs)/home" />
        {isLoading ? (
          <View className="flex-1 items-center justify-center" style={{ flex: 1 }}>
            <LoadingSpinner />
          </View>
        ) : !hasModule('feed') ? (
          <EmptyState
            icon="newspaper-outline"
            title={t('common:errors.notFound')}
            subtitle={t('feed.emptySubtitle')}
          />
        ) : error || !item ? (
          <EmptyState
            icon="warning-outline"
            title={t('common:errors.notFound')}
            subtitle={error ?? t('common:errors.generic')}
            actionLabel={t('common:buttons.retry')}
            onAction={() => void loadItem(false)}
          />
        ) : (
          <ScrollView
            className="flex-1"
            style={{ flex: 1, backgroundColor: theme.bg }}
            contentContainerStyle={{ flexGrow: 1, paddingVertical: 12 }}
            refreshControl={
              <RefreshControl refreshing={isRefreshing} onRefresh={() => void loadItem(true)} tintColor={primary} colors={[primary]} />
            }
          >
            <FeedItem item={item} disableDetailNavigation onOpenReactors={setReactorsTarget} />
          </ScrollView>
        )}
      </SafeAreaView>
      <ReactorsSheet
        visible={Boolean(reactorsTarget)}
        targetType={reactorsTarget?.targetType ?? 'post'}
        targetId={reactorsTarget?.targetId ?? 0}
        reactions={reactorsTarget?.reactions ?? null}
        onClose={() => setReactorsTarget(null)}
      />
    </ModalErrorBoundary>
  );
}

export default function FeedItemDetailScreen() {
  return <FeedItemDetailScreenInner />;
}
