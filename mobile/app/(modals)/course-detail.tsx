// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Button as HeroButton, Card as HeroCard } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import AppTopBar from '@/components/ui/AppTopBar';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import { useAppToast } from '@/components/ui/AppToast';
import { Chip } from '@/components/ui/StatusChip';
import { enrollInCourse, getCourse } from '@/lib/api/courses';
import { useApi } from '@/lib/hooks/useApi';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';

export default function CourseDetailScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { t } = useTranslation(['courses', 'common']);
  const primary = usePrimaryColor();
  const theme = useTheme();
  const { show } = useAppToast();
  const [enrolling, setEnrolling] = useState(false);
  const { data: course, isLoading, error, refresh } = useApi(() => getCourse(id || ''), [id], { enabled: Boolean(id) });

  async function enroll() {
    if (!course || enrolling) return;
    setEnrolling(true);
    try {
      await enrollInCourse(course.id);
      show({ title: t('detail.enroll_success'), variant: 'success' });
      router.push({ pathname: '/(modals)/course-player', params: { id: String(course.id) } });
    } catch {
      show({ title: t('detail.enroll_error'), variant: 'danger' });
    } finally {
      setEnrolling(false);
    }
  }

  return (
    <ModalErrorBoundary>
      <SafeAreaView className="flex-1 bg-background" style={{ flex: 1 }}>
        <AppTopBar title={course?.title ?? t('title')} backLabel={t('common:back')} fallbackHref="/(modals)/courses" />
        {isLoading ? <View className="flex-1 items-center justify-center"><LoadingSpinner /></View> : error || !course ? (
          <View className="flex-1 items-center justify-center gap-4 px-6">
            <Text style={{ color: theme.textSecondary }}>{error ?? t('detail.not_available')}</Text>
            <HeroButton onPress={() => refresh()}><HeroButton.Label>{t('common:buttons.retry')}</HeroButton.Label></HeroButton>
          </View>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 44 }}>
            <HeroCard className="mb-4 overflow-hidden rounded-panel p-0">
              <View className="h-1" style={{ backgroundColor: primary }} />
              <HeroCard.Body className="gap-3 p-5">
                <View className="flex-row flex-wrap gap-2">
                  <Chip size="sm" variant="secondary"><Chip.Label>{t(`level.${course.level}`)}</Chip.Label></Chip>
                  <Chip size="sm" variant="secondary"><Chip.Label>{Number(course.credit_cost) === 0 ? t('detail.free') : t('detail.cost', { credits: course.credit_cost })}</Chip.Label></Chip>
                </View>
                <Text className="text-2xl font-bold" style={{ color: theme.text }}>{course.title}</Text>
                {course.summary ? <Text className="text-base leading-6" style={{ color: theme.textSecondary }}>{course.summary}</Text> : null}
                <HeroButton
                  isDisabled={enrolling}
                  onPress={course.is_enrolled ? () => router.push({ pathname: '/(modals)/course-player', params: { id: String(course.id) } }) : () => void enroll()}
                >
                  <HeroButton.Label>{course.is_enrolled ? t('detail.continue') : enrolling ? t('detail.enrolling') : t('detail.enroll')}</HeroButton.Label>
                </HeroButton>
              </HeroCard.Body>
            </HeroCard>
            {course.description ? (
              <View className="mb-5 gap-2">
                <Text className="text-lg font-bold" style={{ color: theme.text }}>{t('detail.about')}</Text>
                <Text className="text-base leading-6" style={{ color: theme.textSecondary }}>{course.description}</Text>
              </View>
            ) : null}
            <Text className="mb-3 text-lg font-bold" style={{ color: theme.text }}>{t('detail.syllabus')}</Text>
            {(course.sections ?? []).length === 0 ? <Text style={{ color: theme.textSecondary }}>{t('detail.no_lessons')}</Text> : course.sections?.map((section) => (
              <HeroCard key={section.id} className="mb-3 rounded-panel">
                <HeroCard.Body className="gap-2 p-4">
                  <Text className="font-bold" style={{ color: theme.text }}>{section.title}</Text>
                  {(section.lessons ?? []).map((lesson) => <Text key={lesson.id} style={{ color: theme.textSecondary }}>• {lesson.title}</Text>)}
                </HeroCard.Body>
              </HeroCard>
            ))}
          </ScrollView>
        )}
      </SafeAreaView>
    </ModalErrorBoundary>
  );
}
