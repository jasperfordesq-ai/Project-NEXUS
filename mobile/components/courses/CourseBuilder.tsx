// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * CourseBuilder — the native curriculum editor, matching
 * `react-frontend/src/components/courses/CourseBuilder.tsx` capability for capability:
 * sections with editable titles containing lessons, each lesson with an inline editor
 * (title, content type, the matching content field, transcript, drip settings and a free
 * preview toggle), plus quiz-lesson question authoring.
 *
 * 🔴 Reordering is up/down buttons, deliberately — the web builder uses buttons too, and a
 * drag handle inside a vertically scrolling form is the classic way to make a list
 * unusable on a phone. Keep the buttons.
 *
 * Reordering uses one atomic request and reconciles uncertain results before another move.
 */

import { useEffect, useRef, useState } from 'react';
import { describeApiError } from '@/lib/api/describeApiError';
import { useWindowDimensions, View } from 'react-native';
import { Card as HeroCard, Text } from 'heroui-native';
import { Button as HeroButton } from '@/components/ui/NativeButton';
import { useTranslation } from 'react-i18next';

import { Ionicons } from '@/components/ui/Icon';
import Checkbox from '@/components/ui/Checkbox';
import ChoiceChips, { toOptions } from '@/components/ui/ChoiceChips';
import Input from '@/components/ui/Input';
import RefreshFailedNotice from '@/components/ui/RefreshFailedNotice';
import NativePressable from '@/components/ui/NativePressable';
import TextArea from '@/components/ui/TextArea';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import {
  getCourse,
  reorderCourseSections,
  reorderCourseLessons,
  createCourseLesson,
  createCourseQuiz,
  createCourseSection,
  createQuizQuestion,
  deleteCourseLesson,
  deleteCourseSection,
  updateCourseLesson,
  updateCourseSection,
  type CourseLesson,
  type CourseSection,
  type LessonContentType,
  type LessonDripType,
} from '@/lib/api/courses';
import { usePrimaryColor } from '@/lib/hooks/useTenant';
import { useTheme } from '@/lib/hooks/useTheme';
import {
  completeCourseAuthoringCreationOperation,
  reserveCourseAuthoringCreationOperation,
} from '@/lib/courseAuthoringCreationOperation';

const CONTENT_TYPES: LessonContentType[] = ['text', 'video', 'pdf', 'embed', 'quiz'];
const DRIP_TYPES: LessonDripType[] = ['none', 'days_after_enroll', 'fixed_date'];

interface CourseBuilderProps {
  courseId: number;
  initialSections: CourseSection[];
  initialUnassignedLessons?: CourseLesson[];
}

export function CourseBuilder(props: CourseBuilderProps) {
  return <CourseBuilderBody key={props.courseId} {...props} />;
}

function CourseBuilderBody({ courseId, initialSections, initialUnassignedLessons = [] }: CourseBuilderProps) {
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale > 1.3;
  const { t } = useTranslation(['courses', 'common']);
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const [sections, setSections] = useState<CourseSection[]>(
    () => (initialSections ?? []).map((section) => ({ ...section, lessons: section.lessons ?? [] })),
  );
  const [unassignedLessons, setUnassignedLessons] = useState(initialUnassignedLessons);
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  const assignmentInFlight = useRef(false);
  const [assigning, setAssigning] = useState(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const structureVersion = useRef(0);
  const orderInFlight = useRef(false);
  const recoveryScope = useRef<{ sectionId: number | null } | null>(null);
  const [ordering, setOrdering] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const movesDisabled = ordering || assigning || orderError !== null;
  const sectionRenames = useRef(new Map<number, Promise<void>>());
  const addSectionInFlight = useRef(false);
  const addLessonInFlight = useRef(new Set<number>());
  const deletingSections = useRef(new Set<number>());
  const deletingLessons = useRef(new Set<number>());

  function reportFailure() {
    if (!mountedRef.current) return;
    showToast({ title: t('builder.save_error'), variant: 'danger' });
  }

  async function addSection() {
    if (!mountedRef.current || addSectionInFlight.current) return;
    addSectionInFlight.current = true;
    try {
      const payload = {
        title: t('builder.new_section'),
        position: sections.length,
      };
      const operation = await reserveCourseAuthoringCreationOperation('section', courseId, payload);
      if (!mountedRef.current) return;
      const created = await createCourseSection(courseId, payload, operation.key);
      await completeCourseAuthoringCreationOperation(operation);
      if (!mountedRef.current) return;
      structureVersion.current += 1;
      setSections((prev) => [...prev, { ...created, lessons: [] }]);
    } catch {
      reportFailure();
    } finally {
      addSectionInFlight.current = false;
    }
  }

  function renameSection(sectionId: number, title: string) {
    if (!mountedRef.current) return;
    // Preserve the order typed without replacing unrelated curriculum changes on failure.
    const previous = sectionRenames.current.get(sectionId) ?? Promise.resolve();
    const operation = previous.then(async () => {
      if (!mountedRef.current) return;
      try {
        await updateCourseSection(courseId, sectionId, { title });
        if (!mountedRef.current) return;
        setSections(current => current.map(section => section.id === sectionId ? { ...section, title } : section));
      } catch {
        reportFailure();
      }
    });
    sectionRenames.current.set(sectionId, operation);
    void operation.finally(() => {
      if (sectionRenames.current.get(sectionId) === operation) sectionRenames.current.delete(sectionId);
    });
  }

  async function removeSection(sectionId: number) {
    if (!mountedRef.current || deletingSections.current.has(sectionId)
      || !sectionsRef.current.some(section => section.id === sectionId)) return;
    deletingSections.current.add(sectionId);
    try {
      await deleteCourseSection(courseId, sectionId);
      if (!mountedRef.current) return;
      structureVersion.current += 1;
      const retained = sectionsRef.current.find(section => section.id === sectionId)?.lessons ?? [];
      // Publish membership immediately: another response may settle before React renders.
      sectionsRef.current = sectionsRef.current.filter(section => section.id !== sectionId);
      setUnassignedLessons(current => [...current.filter(lesson => !retained.some(item => item.id === lesson.id)),
        ...retained.map(lesson => ({ ...lesson, section_id: null }))]);
      setSections((prev) => prev.filter((s) => s.id !== sectionId));
    } catch {
      reportFailure();
    } finally {
      deletingSections.current.delete(sectionId);
    }
  }

  function confirmRemoveSection(section: CourseSection) {
    if (!mountedRef.current) return;
    confirm({
      title: t('builder.delete_section'),
      message: section.title,
      confirmLabel: t('common:buttons.delete'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      onConfirm: () => removeSection(section.id),
    });
  }

  async function recoverOrder(scope: { sectionId: number | null }) {
    const version = structureVersion.current;
    const fresh = await getCourse(courseId);
    if (!mountedRef.current) return;
    if (version !== structureVersion.current || !Array.isArray(fresh.sections)) throw new Error('Unconfirmed curriculum');
    const freshSections = fresh.sections;
    setUnassignedLessons(fresh.unassigned_lessons ?? []);
    if (scope.sectionId === null) {
      setSections(current => freshSections.map((section, position) => ({
        ...section, ...current.find(item => item.id === section.id), position,
      })));
    } else {
      const freshSection = freshSections.find(section => section.id === scope.sectionId);
      if (freshSection && !Array.isArray(freshSection.lessons)) throw new Error('Unconfirmed lessons');
      setSections(current => current.flatMap(section => {
        if (section.id !== scope.sectionId) return [section];
        if (!freshSection) return [];
        return [{ ...section, lessons: freshSection.lessons!.map((lesson, position) => ({
          ...lesson, ...section.lessons?.find(item => item.id === lesson.id), position,
        })) }];
      }));
    }
    recoveryScope.current = null;
    setOrderError(null);
  }

  async function retryOrderRead() {
    const scope = recoveryScope.current;
    if (!mountedRef.current || orderInFlight.current || !scope) return;
    orderInFlight.current = true;
    setOrdering(true);
    try { await recoverOrder(scope); }
    catch { if (mountedRef.current) setOrderError(t('common:errors.loadFailedSubtitle')); }
    finally {
      orderInFlight.current = false;
      if (mountedRef.current) setOrdering(false);
    }
  }

  async function moveItems(sectionId: number | null, expected: number[], desired: number[]) {
    if (!mountedRef.current || orderInFlight.current || assignmentInFlight.current || recoveryScope.current) return;
    const scope = { sectionId };
    orderInFlight.current = true;
    recoveryScope.current = scope;
    setOrdering(true);
    try {
      const receipt = sectionId === null
        ? await reorderCourseSections(courseId, expected, desired)
        : await reorderCourseLessons(courseId, sectionId, expected, desired);
      if (!mountedRef.current) return;
      if (!Array.isArray(receipt?.ordered_ids) || receipt.ordered_ids.length !== desired.length
        || receipt.ordered_ids.some((id, index) => id !== desired[index])) throw new Error('Unconfirmed order');
      // Apply positions to current objects, retaining edits accepted while the order saved.
      const ordered = <T extends { id: number; position: number }>(items: T[]) => {
        const ranks = new Map(desired.map((id, index) => [id, index]));
        return items.map(item => ({ ...item, position: ranks.get(item.id) ?? item.position }))
          .sort((a, b) => (ranks.get(a.id) ?? desired.length) - (ranks.get(b.id) ?? desired.length));
      };
      setSections(current => sectionId === null ? ordered(current) : current.map(section => section.id === sectionId
        ? { ...section, lessons: ordered(section.lessons ?? []) } : section));
      recoveryScope.current = null;
      setOrderError(null);
    } catch {
      if (!mountedRef.current) return;
      reportFailure();
      try { await recoverOrder(scope); }
      catch { if (mountedRef.current) setOrderError(t('common:errors.loadFailedSubtitle')); }
    } finally {
      orderInFlight.current = false;
      if (mountedRef.current) setOrdering(false);
    }
  }

  function moveSection(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (index < 0 || index >= sections.length || target < 0 || target >= sections.length) return;
    const expected = sections.map(section => section.id);
    const desired = [...expected];
    [desired[index], desired[target]] = [desired[target]!, desired[index]!];
    void moveItems(null, expected, desired);
  }

  async function addLesson(sectionId: number) {
    if (!mountedRef.current || addLessonInFlight.current.has(sectionId) || deletingSections.current.has(sectionId)) return;
    const section = sectionsRef.current.find((s) => s.id === sectionId);
    if (!section) return;
    addLessonInFlight.current.add(sectionId);
    try {
      const payload = {
        section_id: sectionId,
        title: t('builder.new_lesson'),
        content_type: 'text' as const,
        position: section?.lessons?.length ?? 0,
      };
      const operation = await reserveCourseAuthoringCreationOperation('lesson', courseId, payload);
      if (!mountedRef.current || deletingSections.current.has(sectionId)
        || !sectionsRef.current.some(item => item.id === sectionId)) return;
      const created = await createCourseLesson(courseId, payload, operation.key);
      await completeCourseAuthoringCreationOperation(operation);
      if (!mountedRef.current) return;
      structureVersion.current += 1;
      if (!sectionsRef.current.some(item => item.id === sectionId)) {
        setUnassignedLessons(current => [...current.filter(item => item.id !== created.id), { ...created, section_id: null }]);
        return;
      }
      sectionsRef.current = sectionsRef.current.map(section => section.id === sectionId
        ? { ...section, lessons: [...(section.lessons ?? []), created] } : section);
      setSections((prev) => prev.map((s) => (
        s.id === sectionId ? { ...s, lessons: [...(s.lessons ?? []), created] } : s
      )));
    } catch {
      reportFailure();
    } finally {
      addLessonInFlight.current.delete(sectionId);
    }
  }

  function updateLessonLocal(sectionId: number, lesson: CourseLesson) {
    if (!mountedRef.current) return;
    setSections((prev) => prev.map((s) => (
      s.id === sectionId
        ? { ...s, lessons: (s.lessons ?? []).map((l) => (l.id === lesson.id ? lesson : l)) }
        : s
    )));
  }

  async function removeLesson(sectionId: number, lessonId: number) {
    if (!mountedRef.current || deletingLessons.current.has(lessonId) || deletingSections.current.has(sectionId)
      || !sectionsRef.current.some(section => section.id === sectionId && section.lessons?.some(lesson => lesson.id === lessonId))) return;
    deletingLessons.current.add(lessonId);
    try {
      await deleteCourseLesson(courseId, lessonId);
      if (!mountedRef.current) return;
      structureVersion.current += 1;
      setSections((prev) => prev.map((s) => (
        s.id === sectionId ? { ...s, lessons: (s.lessons ?? []).filter((l) => l.id !== lessonId) } : s
      )));
    } catch {
      reportFailure();
    } finally {
      deletingLessons.current.delete(lessonId);
    }
  }

  function confirmRemoveLesson(sectionId: number, lesson: CourseLesson) {
    if (!mountedRef.current) return;
    confirm({
      title: t('builder.delete_lesson'),
      message: lesson.title || t('builder.untitled_lesson'),
      confirmLabel: t('common:buttons.delete'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      onConfirm: () => removeLesson(sectionId, lesson.id),
    });
  }

  async function assignLesson(lesson: CourseLesson, sectionId: number) {
    if (!mountedRef.current || assignmentInFlight.current || orderInFlight.current || recoveryScope.current) return;
    const target = sectionsRef.current.find(section => section.id === sectionId);
    if (!target) return;
    assignmentInFlight.current = true;
    setAssigning(true);
    try {
      const saved = await updateCourseLesson(courseId, lesson.id, { section_id: sectionId, position: target.lessons?.length ?? 0 });
      if (!mountedRef.current) return;
      if (saved.id !== lesson.id || saved.section_id !== sectionId) throw new Error('Unconfirmed assignment');
      structureVersion.current += 1;
      // A destination deleted while this write was pending preserves the lesson as unassigned.
      if (!sectionsRef.current.some(section => section.id === sectionId)) return;
      setSections(current => current.map(section => section.id === sectionId
        ? { ...section, lessons: [...(section.lessons ?? []).filter(item => item.id !== lesson.id), saved] } : section));
      setUnassignedLessons(current => current.filter(item => item.id !== lesson.id));
    } catch { reportFailure(); }
    finally {
      assignmentInFlight.current = false;
      if (mountedRef.current) setAssigning(false);
    }
  }

  function moveLesson(sectionId: number, index: number, direction: -1 | 1) {
    const lessons = sections.find(section => section.id === sectionId)?.lessons ?? [];
    const target = index + direction;
    if (index < 0 || index >= lessons.length || target < 0 || target >= lessons.length) return;
    const expected = lessons.map(lesson => lesson.id);
    const desired = [...expected];
    [desired[index], desired[target]] = [desired[target]!, desired[index]!];
    void moveItems(sectionId, expected, desired);
  }

  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="text-lg font-bold" style={{ color: theme.text }}>{t('instructor.builder')}</Text>
        <HeroButton size="sm" onPress={() => void addSection()}>
          <HeroButton.Label>{t('builder.add_section')}</HeroButton.Label>
        </HeroButton>
      </View>

      <RefreshFailedNotice error={orderError} onRetry={() => void retryOrderRead()} isRetrying={ordering} />
      {ordering ? <Text accessibilityLiveRegion="polite">{t('quiz.submitting')}</Text> : null}
      {sections.length === 0 ? (
        <HeroCard className="rounded-panel">
          <HeroCard.Body className="p-5">
            <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>{t('builder.empty')}</Text>
          </HeroCard.Body>
        </HeroCard>
      ) : (
        sections.map((section, sectionIndex) => (
          <HeroCard key={section.id} className="rounded-panel">
            <HeroCard.Body className="gap-3 p-4">
              <SectionHeader
                section={section}
                movesDisabled={movesDisabled}
                isFirst={sectionIndex === 0}
                isLast={sectionIndex === sections.length - 1}
                onRename={(title) => void renameSection(section.id, title)}
                onMove={(direction) => void moveSection(sectionIndex, direction)}
                onDelete={() => confirmRemoveSection(section)}
              />

              <View className="gap-2">
                {(section.lessons ?? []).map((lesson, lessonIndex) => (
                  <LessonRow
                    key={lesson.id}
                    courseId={courseId}
                    lesson={lesson}
                    movesDisabled={movesDisabled}
                    isFirst={lessonIndex === 0}
                    isLast={lessonIndex === (section.lessons?.length ?? 0) - 1}
                    primary={primary}
                    largeText={largeText}
                    onChange={(next) => updateLessonLocal(section.id, next)}
                    onDelete={() => confirmRemoveLesson(section.id, lesson)}
                    onMove={(direction) => void moveLesson(section.id, lessonIndex, direction)}
                  />
                ))}
                <HeroButton size="sm" variant="secondary" onPress={() => void addLesson(section.id)}>
                  <HeroButton.Label>{t('builder.add_lesson')}</HeroButton.Label>
                </HeroButton>
              </View>
            </HeroCard.Body>
          </HeroCard>
        ))
      )}
      {unassignedLessons.length > 0 ? (
        <HeroCard className="rounded-panel">
          <HeroCard.Body className="gap-3 p-4">
            <Text className="text-lg font-bold" style={{ color: theme.text }}>{t('builder.unassigned')}</Text>
            {unassignedLessons.map(lesson => (
              <View key={lesson.id} className="gap-2">
                <Text style={{ color: theme.text }}>{lesson.title || t('builder.untitled_lesson')}</Text>
                <ChoiceChips label={t('builder.assign_section')} selected={null}
                  options={sections.map(section => ({ value: String(section.id), label: section.title, disabled: assigning || movesDisabled }))}
                  onSelect={value => { if (value) void assignLesson(lesson, Number(value)); }} />
              </View>
            ))}
            {assigning ? <Text accessibilityLiveRegion="polite">{t('quiz.submitting')}</Text> : null}
          </HeroCard.Body>
        </HeroCard>
      ) : null}
      {confirmDialog}
    </View>
  );
}

function SectionHeader({
  section,
  isFirst,
  isLast,
  movesDisabled,
  onRename,
  onMove,
  onDelete,
}: {
  section: CourseSection;
  isFirst: boolean;
  isLast: boolean;
  movesDisabled: boolean;
  onRename: (title: string) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation(['courses', 'common']);
  const theme = useTheme();
  const [title, setTitle] = useState(section.title);

  return (
    <View className="gap-2">
      <Input
        label={t('builder.section_name')}
        accessibilityLabel={t('builder.section_name')}
        value={title}
        onChangeText={setTitle}
        onBlur={() => {
          const trimmed = title.trim();
          if (trimmed && trimmed !== section.title) onRename(trimmed);
        }}
        style={{ color: theme.text }}
        containerClassName="mb-0"
      />
      <View className="flex-row items-center gap-2">
        <IconAction
          icon="chevron-up"
          label={t('builder.move_up')}
          disabled={isFirst || movesDisabled}
          onPress={() => onMove(-1)}
        />
        <IconAction
          icon="chevron-down"
          label={t('builder.move_down')}
          disabled={isLast || movesDisabled}
          onPress={() => onMove(1)}
        />
        <IconAction
          icon="trash-outline"
          label={t('builder.delete_section')}
          tone="danger"
          onPress={onDelete}
        />
      </View>
    </View>
  );
}

function LessonRow({
  courseId,
  lesson,
  isFirst,
  isLast,
  movesDisabled,
  primary,
  largeText,
  onChange,
  onDelete,
  onMove,
}: {
  courseId: number;
  lesson: CourseLesson;
  isFirst: boolean;
  isLast: boolean;
  movesDisabled: boolean;
  primary: string;
  largeText: boolean;
  onChange: (lesson: CourseLesson) => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
}) {
  const { t } = useTranslation(['courses', 'common']);
  const theme = useTheme();
  const { show: showToast } = useAppToast();
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<CourseLesson>(lesson);
  const [isSaving, setIsSaving] = useState(false);
  const [questionPrompt, setQuestionPrompt] = useState('');
  const [questionOptions, setQuestionOptions] = useState('');
  const [questionCorrect, setQuestionCorrect] = useState('');
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  const saveInFlight = useRef(false);
  const questionInFlight = useRef(false);

  function set(patch: Partial<CourseLesson>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  async function save() {
    if (!mountedRef.current || saveInFlight.current) return;
    saveInFlight.current = true;
    setIsSaving(true);
    try {
      const saved = await updateCourseLesson(courseId, lesson.id, {
        title: draft.title,
        content_type: draft.content_type,
        body: draft.body,
        transcript: draft.transcript,
        video_url: draft.video_url,
        embed_url: draft.embed_url,
        attachment_url: draft.attachment_url,
        min_watch_percent: draft.min_watch_percent,
        drip_type: draft.drip_type ?? 'none',
        drip_offset_days: draft.drip_offset_days,
        drip_date: draft.drip_date,
        is_preview: draft.is_preview,
      });
      if (!mountedRef.current) return;
      let next: CourseLesson = { ...draft, ...(saved ?? {}) };
      /*
        A quiz lesson is useless until a quiz row exists to hang questions off, and the
        member has no other way to create one — so saving the lesson creates it, exactly
        as the web builder does.
      */
      if (next.content_type === 'quiz' && !next.quiz?.id) {
        const payload = {
          lesson_id: lesson.id,
          title: next.title || t('quiz.title'),
          pass_mark_percent: 70,
          max_attempts: 0,
        };
        const operation = await reserveCourseAuthoringCreationOperation('quiz', courseId, payload);
        if (!mountedRef.current) return;
        const quiz = await createCourseQuiz(courseId, payload, operation.key);
        await completeCourseAuthoringCreationOperation(operation);
        if (!mountedRef.current) return;
        next = { ...next, quiz: { ...quiz, questions: quiz.questions ?? [] } };
      }
      setDraft(next);
      onChange(next);
      showToast({ title: t('builder.lesson_saved'), variant: 'success' });
    } catch (error) {
      if (!mountedRef.current) return;
      showToast({ title: t('builder.save_error'), description: describeApiError(error, '') || undefined, variant: 'danger' });
    } finally {
      saveInFlight.current = false;
      if (mountedRef.current) setIsSaving(false);
    }
  }

  async function addQuestion() {
    const quiz = draft.quiz;
    if (!mountedRef.current || questionInFlight.current || !quiz?.id || !questionPrompt.trim()) return;
    questionInFlight.current = true;
    const labels = questionOptions.split(',').map((value) => value.trim()).filter(Boolean);
    const options = labels.map((label, index) => ({ id: String.fromCharCode(97 + index), label }));
    const correct = questionCorrect.trim() || options[0]?.id || 'a';
    try {
      const payload = {
        type: 'mcq',
        prompt: questionPrompt.trim(),
        options,
        correct: [correct],
        points: 1,
        position: (quiz.questions ?? []).length + 1,
      } as const;
      const operation = await reserveCourseAuthoringCreationOperation('question', courseId, { quizId: quiz.id, ...payload });
      if (!mountedRef.current) return;
      const question = await createQuizQuestion(courseId, quiz.id, payload, operation.key);
      await completeCourseAuthoringCreationOperation(operation);
      if (!mountedRef.current) return;
      const next: CourseLesson = {
        ...draft,
        quiz: { ...quiz, questions: [...(quiz.questions ?? []), question] },
      };
      setDraft(next);
      onChange(next);
      setQuestionPrompt('');
      setQuestionOptions('');
      setQuestionCorrect('');
      showToast({ title: t('builder.question_added'), variant: 'success' });
    } catch (error) {
      if (!mountedRef.current) return;
      showToast({ title: t('builder.save_error'), description: describeApiError(error, '') || undefined, variant: 'danger' });
    } finally {
      questionInFlight.current = false;
    }
  }

  return (
    <View
      className="gap-2 rounded-2xl border p-3"
      style={{ borderColor: theme.border, backgroundColor: theme.surface }}
    >
      <View testID={`course-lesson-${lesson.id}-header`} className={`${largeText ? '' : 'flex-row items-center'} gap-2`}>
        <View className="min-w-0 flex-1">
          <NativePressable
            accessibilityLabel={draft.title || t('builder.untitled_lesson')}
            accessibilityState={{ expanded: isOpen }}
            feedback="highlight"
            onPress={() => setIsOpen((open) => !open)}
          >
            <View className="gap-0.5 py-1">
              <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={largeText ? undefined : 1}>
                {draft.title || t('builder.untitled_lesson')}
              </Text>
              <Text className="text-xs" style={{ color: theme.textMuted }}>
                {t(`lesson_content.${draft.content_type}`)}
              </Text>
            </View>
          </NativePressable>
        </View>
        <View className="flex-row items-center gap-2">
          <IconAction icon="chevron-up" label={t('builder.move_up')} disabled={isFirst || movesDisabled} onPress={() => onMove(-1)} />
          <IconAction icon="chevron-down" label={t('builder.move_down')} disabled={isLast || movesDisabled} onPress={() => onMove(1)} />
          <IconAction icon="trash-outline" label={t('builder.delete_lesson')} tone="danger" onPress={onDelete} />
        </View>
      </View>

      {isOpen ? (
        <View className="gap-3 border-t pt-3" style={{ borderColor: theme.border }}>
          <Input
            label={t('builder.lesson_name')}
            accessibilityLabel={t('builder.lesson_name')}
            value={draft.title}
            onChangeText={(value) => set({ title: value })}
            style={{ color: theme.text }}
            containerClassName="mb-0"
          />

          <ChoiceGroup
            label={t('builder.content_type')}
            values={CONTENT_TYPES}
            selected={draft.content_type}
            onSelect={(value) => set({ content_type: value })}
            labelFor={(value) => t(`lesson_content.${value}`)}
          />

          {draft.content_type === 'text' ? (
            <TextArea
              label={t('builder.body')}
              accessibilityLabel={t('builder.body')}
              value={draft.body ?? ''}
              onChangeText={(value) => set({ body: value })}
              style={{ color: theme.text }}
              containerClassName="mb-0"
            />
          ) : null}

          {draft.content_type === 'video' ? (
            <Input
              label={t('builder.video_url')}
              accessibilityLabel={t('builder.video_url')}
              placeholder={t('builder.url_placeholder')}
              placeholderTextColor={theme.textMuted}
              value={draft.video_url ?? ''}
              onChangeText={(value) => set({ video_url: value })}
              keyboardType="url"
              autoCapitalize="none"
              style={{ color: theme.text }}
              containerClassName="mb-0"
            />
          ) : null}

          {draft.content_type === 'video' || draft.content_type === 'embed' ? (
            <View className="gap-1">
              <TextArea
                label={t('builder.transcript')}
                accessibilityLabel={t('builder.transcript')}
                value={draft.transcript ?? ''}
                onChangeText={(value) => set({ transcript: value })}
                style={{ color: theme.text }}
                containerClassName="mb-0"
              />
              <Text className="text-xs leading-4" style={{ color: theme.textMuted }}>
                {t('builder.transcript_hint')}
              </Text>
            </View>
          ) : null}

          {draft.content_type === 'embed' ? (
            <Input
              label={t('builder.embed_url')}
              accessibilityLabel={t('builder.embed_url')}
              placeholder={t('builder.url_placeholder')}
              placeholderTextColor={theme.textMuted}
              value={draft.embed_url ?? ''}
              onChangeText={(value) => set({ embed_url: value })}
              keyboardType="url"
              autoCapitalize="none"
              style={{ color: theme.text }}
              containerClassName="mb-0"
            />
          ) : null}

          {draft.content_type === 'pdf' ? (
            <Input
              label={t('builder.attachment_url')}
              accessibilityLabel={t('builder.attachment_url')}
              placeholder={t('builder.url_placeholder')}
              placeholderTextColor={theme.textMuted}
              value={draft.attachment_url ?? ''}
              onChangeText={(value) => set({ attachment_url: value })}
              keyboardType="url"
              autoCapitalize="none"
              style={{ color: theme.text }}
              containerClassName="mb-0"
            />
          ) : null}

          {draft.content_type === 'quiz' ? (
            <View className="gap-2 rounded-2xl border p-3" style={{ borderColor: theme.border }}>
              <Text className="text-sm font-semibold" style={{ color: theme.text }}>
                {draft.quiz?.title ?? t('quiz.title')}
              </Text>
              {(draft.quiz?.questions ?? []).length > 0 ? (
                (draft.quiz?.questions ?? []).map((question) => (
                  <Text key={question.id} className="text-sm" style={{ color: theme.textSecondary }}>
                    {`• ${question.prompt}`}
                  </Text>
                ))
              ) : (
                <Text className="text-sm leading-5" style={{ color: theme.textSecondary }}>
                  {t('builder.no_questions')}
                </Text>
              )}
              <Input
                label={t('builder.question_prompt')}
                accessibilityLabel={t('builder.question_prompt')}
                value={questionPrompt}
                onChangeText={setQuestionPrompt}
                style={{ color: theme.text }}
                containerClassName="mb-0"
              />
              <Input
                label={t('builder.question_options')}
                accessibilityLabel={t('builder.question_options')}
                value={questionOptions}
                onChangeText={setQuestionOptions}
                style={{ color: theme.text }}
                containerClassName="mb-0"
              />
              <Input
                label={t('builder.question_correct')}
                accessibilityLabel={t('builder.question_correct')}
                value={questionCorrect}
                onChangeText={setQuestionCorrect}
                autoCapitalize="none"
                style={{ color: theme.text }}
                containerClassName="mb-0"
              />
              <HeroButton
                size="sm"
                variant="secondary"
                isDisabled={!draft.quiz?.id || !questionPrompt.trim()}
                onPress={() => void addQuestion()}
              >
                <HeroButton.Label>{t('builder.add_question')}</HeroButton.Label>
              </HeroButton>
            </View>
          ) : null}

          <ChoiceGroup
            label={t('builder.drip_type')}
            values={DRIP_TYPES}
            selected={draft.drip_type ?? 'none'}
            onSelect={(value) => set({ drip_type: value })}
            labelFor={(value) => t(`builder.drip_${value}`)}
          />

          {(draft.drip_type ?? 'none') === 'days_after_enroll' ? (
            <Input
              label={t('builder.drip_offset_days')}
              accessibilityLabel={t('builder.drip_offset_days')}
              value={draft.drip_offset_days != null ? String(draft.drip_offset_days) : ''}
              onChangeText={(value) => set({ drip_offset_days: value === '' ? null : Number(value) })}
              keyboardType="number-pad"
              style={{ color: theme.text }}
              containerClassName="mb-0"
            />
          ) : null}

          {(draft.drip_type ?? 'none') === 'fixed_date' ? (
            <Input
              label={t('builder.drip_date')}
              accessibilityLabel={t('builder.drip_date')}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={theme.textMuted}
              value={draft.drip_date ? String(draft.drip_date).slice(0, 10) : ''}
              onChangeText={(value) => set({ drip_date: value || null })}
              autoCapitalize="none"
              style={{ color: theme.text }}
              containerClassName="mb-0"
            />
          ) : null}

          <Checkbox
            checked={Boolean(draft.is_preview)}
            onPress={() => set({ is_preview: !draft.is_preview })}
            label={t('builder.free_preview')}
          />

          <HeroButton size="sm" isDisabled={isSaving} onPress={() => void save()}>
            <HeroButton.Label>{t('builder.save_lesson')}</HeroButton.Label>
          </HeroButton>
        </View>
      ) : null}
    </View>
  );
}

function IconAction({
  icon,
  label,
  onPress,
  disabled = false,
  tone = 'neutral',
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: 'neutral' | 'danger';
}) {
  const theme = useTheme();
  const colour = disabled ? theme.textMuted : tone === 'danger' ? theme.error : theme.textSecondary;

  return (
    <NativePressable
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      feedback="highlight"
      hitSlop={8}
      onPress={onPress}
      style={{ opacity: disabled ? 0.4 : 1, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
    >
      <View className="items-center justify-center">
        <Ionicons name={icon} size={18} color={colour} />
      </View>
    </NativePressable>
  );
}

/**
 * Enum picker. There is no `Select` primitive in this app — a set of choices is a
 * `TagGroup`, the same idiom `app/(modals)/new-job.tsx` uses for job type and commitment.
 */
export function ChoiceGroup<T extends string>({
  label,
  values,
  selected,
  onSelect,
  labelFor,
}: {
  label: string;
  values: readonly T[];
  selected: T | '';
  onSelect: (value: T) => void;
  labelFor: (value: T) => string;
}) {
  return (
    <ChoiceChips
      label={label}
      options={toOptions(values, labelFor)}
      selected={selected}
      onSelect={(value) => { if (value) onSelect(value); }}
    />
  );
}

export default CourseBuilder;
