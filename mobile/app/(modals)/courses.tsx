// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useState } from 'react';
import { FlatList, RefreshControl, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Card as HeroCard } from 'heroui-native';
import { Tabs } from '@/components/ui/NativeTabs';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import EmptyState from '@/components/ui/EmptyState';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import NativePressable from '@/components/ui/NativePressable';
import { Ionicons } from '@/components/ui/Icon';
import SearchInput from '@/components/ui/SearchInput';
import { Chip } from '@/components/ui/StatusChip';
import { getCourses, getMyCourses, type Course, type CourseEnrollment, type CoursePage } from '@/lib/api/courses';
import { useApi } from '@/lib/hooks/useApi';
import { usePaginatedApi } from '@/lib/hooks/usePaginatedApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { withRouteGate } from '@/components/withRouteGate';

type CourseTab = 'browse' | 'learning';

function CoursesScreen() {
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const { t } = useTranslation(['courses', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const [activeTab, setActiveTab] = useState<CourseTab>(tab === 'learning' ? 'learning' : 'browse');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  /*
    🔴 The catalogue asked for one page of twenty and stopped. A community with more
    than twenty courses had the rest simply invisible from the phone — no button, no
    hint, and the search box only filtered the twenty already fetched, so a course on
    page two could not be found by searching for it either. `getCourses` has always
    returned `page`, `total` and `hasMore`; the screen read none of them.
    Audit 2026-09-07, fixed 2026-09-09.

    Page-number paging, not cursors: this endpoint counts pages, so the "cursor" here
    is the next page number as a string. That is the second usage `usePaginatedApi`
    documents.
  */
  const fetchCatalogue = useCallback(
    (cursor: string | null) => getCourses({
      query: query || undefined,
      page: cursor ? Number(cursor) : 1,
    }),
    [query],
  );

  const extractCatalogue = useCallback((page: CoursePage) => ({
    items: page.items,
    cursor: page.hasMore ? String(page.page + 1) : null,
    hasMore: page.hasMore,
  }), []);

  const catalogue = usePaginatedApi<Course, CoursePage>(
    fetchCatalogue,
    extractCatalogue,
    [query],
    { enabled: activeTab === 'browse' },
  );
  const learning = useApi(() => getMyCourses(), [], { enabled: activeTab === 'learning' });

  const openCourse = (course: Partial<Course> & { id: number }) => {
    router.push({ pathname: '/(modals)/course-detail', params: { id: course.slug || String(course.id) } });
  };

  const items: (Course | CourseEnrollment)[] = activeTab === 'browse'
    ? catalogue.items
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
                  {/*
                    🔴 The teaching side needs a door on this screen, exactly as
                    `CoursesPage.tsx` gives it one. Without these two the native
                    builder is reachable only from the "+" menu, which creates a
                    course but never leads back to one already written — the same
                    "the feature must not exist" conclusion the 2026-09-06 report
                    was about, one level down.
                  */}
                  <View className="mt-3 flex-row gap-2">
                    <HeroButton
                      className="flex-1"
                      size="sm"
                      variant="secondary"
                      testID="courses-my-courses"
                      onPress={() => router.push('/(modals)/course-instructor')}
                    >
                      <HeroButton.Label>{t('instructor.my_courses')}</HeroButton.Label>
                    </HeroButton>
                    <HeroButton
                      className="flex-1"
                      size="sm"
                      variant="primary"
                      testID="courses-create-course"
                      onPress={() => router.push('/(modals)/new-course')}
                    >
                      <Ionicons name="add-outline" size={16} color={theme.text} />
                      <HeroButton.Label>{t('instructor.create_course')}</HeroButton.Label>
                    </HeroButton>
                  </View>
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
          onEndReachedThreshold={0.5}
          onEndReached={() => { if (activeTab === 'browse') catalogue.loadMore(); }}
          ListFooterComponent={
            activeTab === 'browse' && catalogue.isLoadingMore
              ? <View className="py-6"><LoadingSpinner /></View>
              : null
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

export default withRouteGate(CoursesScreen, 'courses');
