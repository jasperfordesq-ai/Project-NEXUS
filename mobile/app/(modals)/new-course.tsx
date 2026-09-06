// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Create / edit a course — the native equivalent of
 * `react-frontend/src/pages/courses/CreateCoursePage.tsx`.
 *
 * Same two-stage shape as the web page: create mode captures the course details, and once
 * the course exists the curriculum builder (and, for a cohort course, the cohort list)
 * unlocks below the form. `?id=` opens straight into edit mode.
 */

import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { Button as HeroButton, Card as HeroCard, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import * as Haptics from '@/lib/haptics';
import AppTopBar from '@/components/ui/AppTopBar';
import Input from '@/components/ui/Input';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import FeatureGate from '@/components/FeatureGate';
import ModalErrorBoundary from '@/components/ModalErrorBoundary';
import TextArea from '@/components/ui/TextArea';
import { Chip } from '@/components/ui/StatusChip';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import { CourseBuilder, ChoiceGroup } from '@/components/courses/CourseBuilder';
import { describeApiError } from '@/lib/api/describeApiError';
import {
  createCourse,
  createCourseCohort,
  getCourse,
  getCourseCategories,
  getCourseCohorts,
  publishCourse,
  unpublishCourse,
  updateCourse,
  type CourseCategory,
  type CourseCohort,
  type CourseEnrollmentType,
  type CourseInput,
  type CourseLevel,
  type CourseModerationStatus,
  type CourseSection,
  type CourseStatus,
  type CourseVisibility,
} from '@/lib/api/courses';
import { useUnsavedChangesGuard } from '@/lib/hooks/useUnsavedChangesGuard';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import { parseDecimalInput } from '@/lib/utils/decimal';

const LEVELS: CourseLevel[] = ['beginner', 'intermediate', 'advanced'];
/** `group` visibility is set by the group that owns a course, never here — as on the web. */
const VISIBILITIES: Exclude<CourseVisibility, 'group'>[] = ['public', 'members'];
const ENROLLMENT_TYPES: CourseEnrollmentType[] = ['self_paced', 'cohort'];
const NO_CATEGORY = 'none';

export default function NewCourseRoute() {
  /*
    Gated like the React route (`<FeatureGate feature="courses">`). Hiding the "+"
    menu entry was never a gate: a deep link, a notification or a shared URL all
    reach this screen directly. See components/FeatureGate.tsx.
  */
  const { t } = useTranslation('courses');
  return (
    <FeatureGate feature="courses" title={t('instructor.new_course')} fallbackHref="/(modals)/course-instructor">
      <ModalErrorBoundary>
        <NewCourseScreen />
      </ModalErrorBoundary>
    </FeatureGate>
  );
}

function NewCourseScreen() {
  const { t } = useTranslation(['courses', 'common']);
  const params = useLocalSearchParams<{ id?: string }>();
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();

  const paramCourseId = Number(params.id);
  const hasParamCourse = Number.isFinite(paramCourseId) && paramCourseId > 0;
  /** Set once a newly created course exists, which is what unlocks the builder. */
  const [createdCourseId, setCreatedCourseId] = useState<number | null>(null);
  const courseId = hasParamCourse ? paramCourseId : createdCourseId ?? 0;
  const isEditing = courseId > 0;

  const [categories, setCategories] = useState<CourseCategory[]>([]);
  const [isLoading, setIsLoading] = useState(hasParamCourse);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [status, setStatus] = useState<CourseStatus>('draft');
  const [moderationStatus, setModerationStatus] = useState<CourseModerationStatus>('pending');
  const [sections, setSections] = useState<CourseSection[]>([]);
  const [cohorts, setCohorts] = useState<CourseCohort[]>([]);
  const [cohortName, setCohortName] = useState('');

  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [level, setLevel] = useState<CourseLevel>('beginner');
  const [visibility, setVisibility] = useState<CourseVisibility>('members');
  const [enrollmentType, setEnrollmentType] = useState<CourseEnrollmentType>('self_paced');
  const [categoryId, setCategoryId] = useState('');
  const [creditCost, setCreditCost] = useState('0');
  const [prerequisites, setPrerequisites] = useState('');

  /*
    🔴 A course description is long-form writing. Losing it to a stray Back is the same
    fault the listing and job forms had before the 5 September audit.
  */
  useUnsavedChangesGuard({
    isDirty: !isEditing && Boolean(title.trim() || summary.trim() || description.trim()),
    isBusy: isSaving || hasSubmitted,
    confirm,
    title: t('instructor.unsaved_title'),
    message: t('instructor.unsaved_message'),
    discardLabel: t('instructor.discard'),
    cancelLabel: t('common:buttons.cancel'),
  });

  useEffect(() => {
    let isMounted = true;
    getCourseCategories()
      .then((list) => { if (isMounted) setCategories(list ?? []); })
      .catch(() => { /* Categories are optional; the form still works without them. */ });
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    if (!hasParamCourse) return;
    let isMounted = true;
    setIsLoading(true);
    getCourse(paramCourseId)
      .then((course) => {
        if (!isMounted) return;
        setTitle(course.title ?? '');
        setSummary(course.summary ?? '');
        setDescription(course.description ?? '');
        setLevel(course.level ?? 'beginner');
        setVisibility(course.visibility === 'group' ? 'members' : (course.visibility ?? 'members'));
        setEnrollmentType(course.enrollment_type ?? 'self_paced');
        setCategoryId(course.category_id ? String(course.category_id) : '');
        setCreditCost(String(course.credit_cost ?? 0));
        setPrerequisites(Array.isArray(course.prerequisites) ? course.prerequisites.join(', ') : '');
        setSections(course.sections ?? []);
        setStatus(course.status ?? 'draft');
        setModerationStatus(course.moderation_status ?? 'pending');
        return getCourseCohorts(paramCourseId)
          .then((list) => { if (isMounted) setCohorts(list ?? []); })
          .catch(() => { /* A course with no cohort list still edits fine. */ });
      })
      .catch((err) => {
        if (!isMounted) return;
        showToast({
          title: t('instructor.create_error'),
          description: describeApiError(err, ''),
          variant: 'danger',
        });
      })
      .finally(() => { if (isMounted) setIsLoading(false); });
    return () => { isMounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasParamCourse, paramCourseId]);

  function buildPayload(): CourseInput {
    return {
      title: title.trim(),
      summary,
      description,
      level,
      visibility,
      enrollment_type: enrollmentType,
      category_id: categoryId ? Number(categoryId) : null,
      credit_cost: parseDecimalInput(creditCost) ?? 0,
      prerequisites: prerequisites
        .split(',')
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0),
    };
  }

  async function saveDetails() {
    if (!title.trim()) {
      showToast({ title: t('form.required'), variant: 'warning' });
      return;
    }
    setIsSaving(true);
    try {
      const payload = buildPayload();
      const saved = isEditing ? await updateCourse(courseId, payload) : await createCourse(payload);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      showToast({ title: t('instructor.saved'), variant: 'success' });
      if (!isEditing && saved?.id) {
        setHasSubmitted(true);
        setCreatedCourseId(saved.id);
        setStatus(saved.status ?? 'draft');
        setModerationStatus(saved.moderation_status ?? 'pending');
        setSections(saved.sections ?? []);
      }
    } catch (err) {
      showToast({
        title: t('instructor.create_error'),
        description: describeApiError(err, ''),
        variant: 'danger',
      });
    } finally {
      setIsSaving(false);
    }
  }

  async function togglePublish() {
    if (!isEditing) return;
    setIsPublishing(true);
    try {
      const updated = status === 'published'
        ? await unpublishCourse(courseId)
        : await publishCourse(courseId);
      setStatus(updated.status ?? 'draft');
      setModerationStatus(updated.moderation_status ?? 'pending');
      showToast({
        title: updated.status === 'published'
          ? updated.moderation_status === 'approved'
            ? t('builder.published_toast')
            : t('instructor.pending_review')
          : t('builder.unpublished_toast'),
        variant: 'success',
      });
    } catch (err) {
      showToast({
        title: t('builder.save_error'),
        description: describeApiError(err, ''),
        variant: 'danger',
      });
    } finally {
      setIsPublishing(false);
    }
  }

  async function addCohort() {
    if (!isEditing || !cohortName.trim()) return;
    try {
      await createCourseCohort(courseId, { name: cohortName.trim() });
      const list = await getCourseCohorts(courseId);
      setCohorts(list ?? []);
      setCohortName('');
      showToast({ title: t('builder.cohort_added'), variant: 'success' });
    } catch (err) {
      showToast({ title: t('builder.save_error'), description: describeApiError(err, ''), variant: 'danger' });
    }
  }

  const statusChipLabel = status === 'published' && moderationStatus === 'approved'
    ? t('instructor.published')
    : moderationStatus === 'pending' && status !== 'draft'
      ? t('instructor.pending_review')
      : t('instructor.draft');

  const screenTitle = isEditing ? t('instructor.edit_course') : t('instructor.new_course');

  return (
    <SafeAreaView className="flex-1 bg-background" style={{ flex: 1, backgroundColor: theme.bg }}>
      <AppTopBar title={screenTitle} backLabel={t('common:back')} fallbackHref="/(modals)/course-instructor" />
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: theme.bg }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {isLoading ? (
          <View className="flex-1 items-center justify-center"><LoadingSpinner /></View>
        ) : (
          <ScrollView
            className="flex-1"
            style={{ flex: 1, backgroundColor: theme.bg }}
            contentContainerStyle={{ flexGrow: 1, padding: 16, paddingBottom: 48 }}
            keyboardShouldPersistTaps="handled"
          >
            <HeroCard className="mb-4 overflow-hidden rounded-panel p-0">
              <View className="h-1.5" style={{ backgroundColor: primary }} />
              <HeroCard.Body className="gap-2 p-4">
                <Text className="text-2xl font-bold" style={{ color: theme.text }}>{screenTitle}</Text>
                {isEditing ? (
                  <View className="flex-row flex-wrap items-center gap-2">
                    <Chip size="sm" variant="secondary"><Chip.Label>{statusChipLabel}</Chip.Label></Chip>
                  </View>
                ) : null}
                {isEditing && status !== 'published' ? (
                  <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                    {t('builder.publish_hint')}
                  </Text>
                ) : null}
                {isEditing ? (
                  <HeroButton isDisabled={isPublishing} onPress={() => void togglePublish()}>
                    <HeroButton.Label>
                      {status === 'published' ? t('instructor.unpublish') : t('instructor.publish')}
                    </HeroButton.Label>
                  </HeroButton>
                ) : null}
              </HeroCard.Body>
            </HeroCard>

            <HeroCard className="mb-4 rounded-panel">
              <HeroCard.Body className="gap-4 p-4">
                <Input
                  label={t('instructor.title_label')}
                  accessibilityLabel={t('instructor.title_label')}
                  value={title}
                  onChangeText={setTitle}
                  style={{ color: theme.text }}
                  containerClassName="mb-0"
                />
                <Input
                  label={t('instructor.summary_label')}
                  accessibilityLabel={t('instructor.summary_label')}
                  value={summary}
                  onChangeText={setSummary}
                  style={{ color: theme.text }}
                  containerClassName="mb-0"
                />
                <TextArea
                  label={t('instructor.description_label')}
                  accessibilityLabel={t('instructor.description_label')}
                  value={description}
                  onChangeText={setDescription}
                  style={{ color: theme.text }}
                  containerClassName="mb-0"
                />

                <ChoiceGroup
                  label={t('instructor.level_label')}
                  values={LEVELS}
                  selected={level}
                  onSelect={setLevel}
                  labelFor={(value) => t(`level.${value}`)}
                  primary={primary}
                />
                <ChoiceGroup
                  label={t('instructor.visibility_label')}
                  values={VISIBILITIES}
                  selected={visibility === 'group' ? 'members' : visibility}
                  onSelect={(value) => setVisibility(value)}
                  labelFor={(value) => t(`instructor.visibility_${value}`)}
                  primary={primary}
                />
                <ChoiceGroup
                  label={t('instructor.category_label')}
                  values={[NO_CATEGORY, ...categories.map((category) => String(category.id))]}
                  selected={categoryId || NO_CATEGORY}
                  onSelect={(value) => setCategoryId(value === NO_CATEGORY ? '' : value)}
                  labelFor={(value) => (
                    value === NO_CATEGORY
                      ? t('instructor.no_category')
                      : categories.find((category) => String(category.id) === value)?.name ?? value
                  )}
                  primary={primary}
                />
                <ChoiceGroup
                  label={t('instructor.enrollment_type_label')}
                  values={ENROLLMENT_TYPES}
                  selected={enrollmentType}
                  onSelect={setEnrollmentType}
                  labelFor={(value) => t(`instructor.enrollment_${value}`)}
                  primary={primary}
                />

                <Input
                  label={t('instructor.credit_cost_label')}
                  accessibilityLabel={t('instructor.credit_cost_label')}
                  value={creditCost}
                  onChangeText={setCreditCost}
                  keyboardType="decimal-pad"
                  style={{ color: theme.text }}
                  containerClassName="mb-0"
                />
                <Input
                  label={t('instructor.prerequisites_label')}
                  accessibilityLabel={t('instructor.prerequisites_label')}
                  value={prerequisites}
                  onChangeText={setPrerequisites}
                  keyboardType="numbers-and-punctuation"
                  style={{ color: theme.text }}
                  containerClassName="mb-0"
                />

                <HeroButton isDisabled={isSaving} onPress={() => void saveDetails()}>
                  <HeroButton.Label>{isSaving ? t('quiz.submitting') : t('instructor.save')}</HeroButton.Label>
                </HeroButton>
              </HeroCard.Body>
            </HeroCard>

            {isEditing ? (
              <View className="gap-4">
                <CourseBuilder courseId={courseId} initialSections={sections} />

                {enrollmentType === 'cohort' ? (
                  <HeroCard className="rounded-panel">
                    <HeroCard.Body className="gap-3 p-4">
                      <Text className="text-lg font-bold" style={{ color: theme.text }}>{t('builder.cohorts')}</Text>
                      {cohorts.length > 0 ? (
                        cohorts.map((cohort) => (
                          <Text key={cohort.id} className="text-sm" style={{ color: theme.textSecondary }}>
                            {`• ${cohort.name}`}
                          </Text>
                        ))
                      ) : (
                        <Text className="text-sm" style={{ color: theme.textSecondary }}>{t('builder.no_cohorts')}</Text>
                      )}
                      <Input
                        label={t('builder.cohort_name')}
                        accessibilityLabel={t('builder.cohort_name')}
                        value={cohortName}
                        onChangeText={setCohortName}
                        style={{ color: theme.text }}
                        containerClassName="mb-0"
                      />
                      <HeroButton size="sm" variant="secondary" onPress={() => void addCohort()}>
                        <HeroButton.Label>{t('builder.add_cohort')}</HeroButton.Label>
                      </HeroButton>
                    </HeroCard.Body>
                  </HeroCard>
                ) : null}

                <View className="flex-row flex-wrap gap-2">
                  <HeroButton
                    size="sm"
                    variant="secondary"
                    onPress={() => router.push({ pathname: '/(modals)/course-detail', params: { id: String(courseId) } })}
                  >
                    <HeroButton.Label>{t('builder.preview_course')}</HeroButton.Label>
                  </HeroButton>
                  <HeroButton size="sm" variant="secondary" onPress={() => router.replace('/(modals)/course-instructor')}>
                    <HeroButton.Label>{t('builder.done')}</HeroButton.Label>
                  </HeroButton>
                </View>
              </View>
            ) : null}
          </ScrollView>
        )}
      </KeyboardAvoidingView>
      {confirmDialog}
    </SafeAreaView>
  );
}
