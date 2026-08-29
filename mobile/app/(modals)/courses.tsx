// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Card as HeroCard, Tabs } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import NativePressable from '@/components/ui/NativePressable';
import SearchInput from '@/components/ui/SearchInput';
import { Chip } from '@/components/ui/StatusChip';
import { getCourses, getMyCourses, type Course, type CourseEnrollment } from '@/lib/api/courses';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';

type CourseTab = 'browse' | 'learning';

export default function CoursesScreen() {
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const { t } = useTranslation(['courses', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const [activeTab, setActiveTab] = useState<CourseTab>(tab === 'learning' ? 'learning' : 'browse');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const catalogue = useApi(() => getCourses({ query: query || undefined }), [query], { enabled: activeTab === 'browse' });
  const learning = useApi(() => getMyCourses(), [], { enabled: activeTab === 'learning' });

  const openCourse = (course: Partial<Course> & { id: number }) => {
    router.push({ pathname: '/(modals)/course-detail', params: { id: course.slug || String(course.id) } });
  };

  const items: (Course | CourseEnrollment)[] = activeTab === 'browse'
    ? (catalogue.data?.items ?? [])
    : (learning.data ?? []);
  const loading = activeTab === 'browse' ? catalogue.isLoading : learning.isLoading;
  const error = activeTab === 'browse' ? catalogue.error : learning.error;
  const refresh = activeTab === 'browse' ? catalogue.refresh : learning.refresh;

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={t('title')} backLabel={t('common:back')} fallbackHref="/(tabs)/profile" />
        <FlatList
          data={items}
          keyExtractor={(item) => `${activeTab}-${item.id}`}
          contentContainerStyle={{ padding: 16, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={() => refresh()} tintColor={primary} colors={[primary]} />}
          ListHeaderComponent={
            <View className="mb-4 gap-4">
              <HeroCard className="overflow-hidden rounded-panel p-0">
                <View className="h-1" style={{ backgroundColor: primary }} />
                <HeroCard.Body className="gap-1 p-4">
                  <Text className="text-2xl font-bold" style={{ color: theme.text }}>{t('title')}</Text>
                  <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('subtitle')}</Text>
                </HeroCard.Body>
              </HeroCard>
              <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as CourseTab)} variant="secondary">
                <Tabs.List>
                  <Tabs.Indicator />
                  <Tabs.Trigger value="browse"><Tabs.Label>{t('title')}</Tabs.Label></Tabs.Trigger>
                  <Tabs.Trigger value="learning"><Tabs.Label>{t('my_learning.title')}</Tabs.Label></Tabs.Trigger>
                </Tabs.List>
              </Tabs>
              {activeTab === 'browse' ? (
                <SearchInput
                  value={search}
                  onChangeText={(value) => { setSearch(value); if (!value) setQuery(''); }}
                  onSubmitEditing={() => setQuery(search.trim())}
                  placeholder={t('browse.search_placeholder')}
                  accessibilityLabel={t('browse.search_placeholder')}
                  clearLabel={t('common:actions.clear')}
                  returnKeyType="search"
                />
              ) : null}
            </View>
          }
          renderItem={({ item }) => {
            const course = activeTab === 'browse' ? item as Course : (item as CourseEnrollment).course;
            if (!course?.id || !course.title) return null;
            const enrollment = activeTab === 'learning' ? item as CourseEnrollment : null;
            return (
              <NativePressable accessibilityLabel={course.title} onPress={() => openCourse(course as Course)} feedback="highlight">
                <HeroCard className="mb-3 rounded-panel">
                  <HeroCard.Body className="gap-2 p-4">
                    <View className="flex-row items-center gap-2">
                      {course.level ? <Chip size="sm" variant="secondary"><Chip.Label>{t(`level.${course.level}`)}</Chip.Label></Chip> : null}
                      {enrollment ? <Chip size="sm" variant="secondary"><Chip.Label>{Math.round(Number(enrollment.progress_percent))}%</Chip.Label></Chip> : null}
                    </View>
                    <Text className="text-lg font-bold" style={{ color: theme.text }}>{course.title}</Text>
                    {course.summary ? <Text className="text-sm leading-5" style={{ color: theme.textSecondary }} numberOfLines={3}>{course.summary}</Text> : null}
                    {course.author?.name ? <Text className="text-xs" style={{ color: theme.textMuted }}>{t('card.by_author', { name: course.author.name })}</Text> : null}
                  </HeroCard.Body>
                </HeroCard>
              </NativePressable>
            );
          }}
          ListEmptyComponent={loading ? (
            <View className="py-12"><LoadingSpinner /></View>
          ) : (
            <EmptyState
              icon={error ? 'warning-outline' : 'school-outline'}
              title={error ?? (activeTab === 'learning' ? t('my_learning.empty') : t('browse.empty'))}
              subtitle={error ? undefined : activeTab === 'browse' ? t('browse.empty_hint') : undefined}
              actionLabel={error ? t('common:buttons.retry') : undefined}
              onAction={error ? () => refresh() : undefined}
            />
          )}
        />
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}
