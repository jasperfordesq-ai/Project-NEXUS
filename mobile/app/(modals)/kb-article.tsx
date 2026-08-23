// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { type Href, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@/components/ui/Icon';
import { Card as HeroCard, Chip } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import { getKbArticle } from '@/lib/api/resources';
import { useApi } from '@/lib/hooks/useApi';
import { useTheme } from '@/lib/hooks/useTheme';
import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';

export default function KbArticleScreen() {
  const { t } = useTranslation(['resources', 'common']);
  const params = useLocalSearchParams<{ id?: string }>();
  const id = Number(params.id ?? 0);
  const theme = useTheme();
  const { data: article, isLoading, error, refresh } = useApi(() => getKbArticle(id), [id], { enabled: id > 0 });

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
        <AppTopBar title={article?.title ?? t('resources:articleTitle')} backLabel={t('common:back')} fallbackHref={'/(modals)/resources' as Href} />
        <ScrollView
          style={{ flex: 1, backgroundColor: theme.bg }}
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 16, paddingBottom: 40 }}
        >
          {isLoading ? (
            <View className="items-center justify-center py-14">
              <LoadingSpinner />
            </View>
          ) : error || !article ? (
            <EmptyState
              icon={error ? 'warning-outline' : 'book-outline'}
              title={error ? t('resources:errorTitle') : t('resources:emptyTitle')}
              subtitle={error ? String(error) : undefined}
              actionLabel={error ? t('common:buttons.retry') : undefined}
              onAction={error ? refresh : undefined}
            />
          ) : (
            <HeroCard variant="default" className="overflow-hidden rounded-panel p-0">
              <HeroCard.Body className="gap-4 p-4">
                <View className="flex-row items-start gap-3">
                  <View className="size-12 items-center justify-center rounded-panel-inner bg-surface-secondary">
                    <Ionicons name="book-outline" size={24} color={theme.info} />
                  </View>
                  <View className="min-w-0 flex-1 gap-2">
                    <Text className="text-2xl font-bold leading-8" style={{ color: theme.text }}>
                      {article.title}
                    </Text>
                    <View className="flex-row flex-wrap gap-2">
                      {article.category_name ? <Chip size="sm" variant="secondary"><Chip.Label>{article.category_name}</Chip.Label></Chip> : null}
                      <Chip size="sm" variant="secondary">
                        <Chip.Label>{t('resources:views', { count: article.views_count ?? article.view_count ?? 0 })}</Chip.Label>
                      </Chip>
                      <Chip size="sm" variant="secondary">
                        <Chip.Label>{t('resources:helpful', { yes: article.helpful_yes ?? 0, no: article.helpful_no ?? 0 })}</Chip.Label>
                      </Chip>
                    </View>
                  </View>
                </View>
                <Text className="text-base leading-7" style={{ color: theme.textSecondary }}>
                  {stripHtml(article.content ?? article.content_preview ?? '')}
                </Text>
              </HeroCard.Body>
            </HeroCard>
          )}
        </ScrollView>
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}
