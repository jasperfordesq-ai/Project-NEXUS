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
 * Every mutation is optimistic and rolls back on failure, exactly as the web builder does:
 * the member sees the new order immediately, and if the API refuses, the previous state is
 * restored and a toast explains it rather than leaving the screen lying about what is saved.
 */

import { useState } from 'react';
import { View } from 'react-native';
import { Button as HeroButton, Card as HeroCard, TagGroup, Text } from 'heroui-native';
import { useTranslation } from 'react-i18next';

import { Ionicons } from '@/components/ui/Icon';
import Checkbox from '@/components/ui/Checkbox';
import Input from '@/components/ui/Input';
import NativePressable from '@/components/ui/NativePressable';
import TextArea from '@/components/ui/TextArea';
import { useAppToast } from '@/components/ui/AppToast';
import { useConfirm } from '@/components/ui/useConfirm';
import {
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
import { contrastText } from '@/lib/utils/color';

const CONTENT_TYPES: LessonContentType[] = ['text', 'video', 'pdf', 'embed', 'quiz'];
const DRIP_TYPES: LessonDripType[] = ['none', 'days_after_enroll', 'fixed_date'];

interface CourseBuilderProps {
  courseId: number;
  initialSections: CourseSection[];
}

export function CourseBuilder({ courseId, initialSections }: CourseBuilderProps) {
  const { t } = useTranslation(['courses', 'common']);
  const theme = useTheme();
  const primary = usePrimaryColor();
  const { show: showToast } = useAppToast();
  const { confirm, confirmDialog } = useConfirm();
  const [sections, setSections] = useState<CourseSection[]>(
    () => (initialSections ?? []).map((section) => ({ ...section, lessons: section.lessons ?? [] })),
  );

  function reportFailure() {
    showToast({ title: t('builder.save_error'), variant: 'danger' });
  }

  async function addSection() {
    try {
      const created = await createCourseSection(courseId, {
        title: t('builder.new_section'),
        position: sections.length,
      });
      setSections((prev) => [...prev, { ...created, lessons: [] }]);
    } catch {
      reportFailure();
    }
  }

  async function renameSection(sectionId: number, title: string) {
    const previous = sections;
    setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, title } : s)));
    try {
      await updateCourseSection(courseId, sectionId, { title });
    } catch {
      setSections(previous);
      reportFailure();
    }
  }

  async function removeSection(sectionId: number) {
    try {
      await deleteCourseSection(courseId, sectionId);
      setSections((prev) => prev.filter((s) => s.id !== sectionId));
    } catch {
      reportFailure();
    }
  }

  function confirmRemoveSection(section: CourseSection) {
    confirm({
      title: t('builder.delete_section'),
      message: section.title,
      confirmLabel: t('common:buttons.delete'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      onConfirm: () => removeSection(section.id),
    });
  }

  async function moveSection(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= sections.length) return;
    const previous = sections;
    const next = [...sections];
    const moved = next[index]!;
    next[index] = next[target]!;
    next[target] = moved;
    setSections(next);
    try {
      await Promise.all([
        updateCourseSection(courseId, next[index]!.id, { position: index }),
        updateCourseSection(courseId, next[target]!.id, { position: target }),
      ]);
    } catch {
      setSections(previous);
      reportFailure();
    }
  }

  async function addLesson(sectionId: number) {
    const section = sections.find((s) => s.id === sectionId);
    try {
      const created = await createCourseLesson(courseId, {
        section_id: sectionId,
        title: t('builder.new_lesson'),
        content_type: 'text',
        position: section?.lessons?.length ?? 0,
      });
      setSections((prev) => prev.map((s) => (
        s.id === sectionId ? { ...s, lessons: [...(s.lessons ?? []), created] } : s
      )));
    } catch {
      reportFailure();
    }
  }

  function updateLessonLocal(sectionId: number, lesson: CourseLesson) {
    setSections((prev) => prev.map((s) => (
      s.id === sectionId
        ? { ...s, lessons: (s.lessons ?? []).map((l) => (l.id === lesson.id ? lesson : l)) }
        : s
    )));
  }

  async function removeLesson(sectionId: number, lessonId: number) {
    try {
      await deleteCourseLesson(courseId, lessonId);
      setSections((prev) => prev.map((s) => (
        s.id === sectionId ? { ...s, lessons: (s.lessons ?? []).filter((l) => l.id !== lessonId) } : s
      )));
    } catch {
      reportFailure();
    }
  }

  function confirmRemoveLesson(sectionId: number, lesson: CourseLesson) {
    confirm({
      title: t('builder.delete_lesson'),
      message: lesson.title || t('builder.untitled_lesson'),
      confirmLabel: t('common:buttons.delete'),
      cancelLabel: t('common:buttons.cancel'),
      variant: 'danger',
      onConfirm: () => removeLesson(sectionId, lesson.id),
    });
  }

  async function moveLesson(sectionId: number, index: number, direction: -1 | 1) {
    const section = sections.find((s) => s.id === sectionId);
    if (!section) return;
    const lessons = [...(section.lessons ?? [])];
    const target = index + direction;
    if (target < 0 || target >= lessons.length) return;
    const previous = sections;
    const moved = lessons[index]!;
    lessons[index] = lessons[target]!;
    lessons[target] = moved;
    setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, lessons } : s)));
    try {
      await Promise.all([
        updateCourseLesson(courseId, lessons[index]!.id, { position: index }),
        updateCourseLesson(courseId, lessons[target]!.id, { position: target }),
      ]);
    } catch {
      setSections(previous);
      reportFailure();
    }
  }

  return (
    <View className="gap-3">
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <Text className="text-lg font-bold" style={{ color: theme.text }}>{t('instructor.builder')}</Text>
        <HeroButton size="sm" onPress={() => void addSection()}>
          <HeroButton.Label>{t('builder.add_section')}</HeroButton.Label>
        </HeroButton>
      </View>

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
                    isFirst={lessonIndex === 0}
                    isLast={lessonIndex === (section.lessons?.length ?? 0) - 1}
                    primary={primary}
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
      {confirmDialog}
    </View>
  );
}

function SectionHeader({
  section,
  isFirst,
  isLast,
  onRename,
  onMove,
  onDelete,
}: {
  section: CourseSection;
  isFirst: boolean;
  isLast: boolean;
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
          disabled={isFirst}
          onPress={() => onMove(-1)}
        />
        <IconAction
          icon="chevron-down"
          label={t('builder.move_down')}
          disabled={isLast}
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
  primary,
  onChange,
  onDelete,
  onMove,
}: {
  courseId: number;
  lesson: CourseLesson;
  isFirst: boolean;
  isLast: boolean;
  primary: string;
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

  function set(patch: Partial<CourseLesson>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  async function save() {
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
      let next: CourseLesson = { ...draft, ...(saved ?? {}) };
      /*
        A quiz lesson is useless until a quiz row exists to hang questions off, and the
        member has no other way to create one — so saving the lesson creates it, exactly
        as the web builder does.
      */
      if (next.content_type === 'quiz' && !next.quiz?.id) {
        const quiz = await createCourseQuiz(courseId, {
          lesson_id: lesson.id,
          title: next.title || t('quiz.title'),
          pass_mark_percent: 70,
          max_attempts: 0,
        });
        next = { ...next, quiz: { ...quiz, questions: quiz.questions ?? [] } };
      }
      setDraft(next);
      onChange(next);
      showToast({ title: t('builder.lesson_saved'), variant: 'success' });
    } catch {
      showToast({ title: t('builder.save_error'), variant: 'danger' });
    } finally {
      setIsSaving(false);
    }
  }

  async function addQuestion() {
    const quiz = draft.quiz;
    if (!quiz?.id || !questionPrompt.trim()) return;
    const labels = questionOptions.split(',').map((value) => value.trim()).filter(Boolean);
    const options = labels.map((label, index) => ({ id: String.fromCharCode(97 + index), label }));
    const correct = questionCorrect.trim() || options[0]?.id || 'a';
    try {
      const question = await createQuizQuestion(courseId, quiz.id, {
        type: 'mcq',
        prompt: questionPrompt.trim(),
        options,
        correct: [correct],
        points: 1,
        position: (quiz.questions ?? []).length + 1,
      });
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
    } catch {
      showToast({ title: t('builder.save_error'), variant: 'danger' });
    }
  }

  return (
    <View
      className="gap-2 rounded-2xl border p-3"
      style={{ borderColor: theme.border, backgroundColor: theme.surface }}
    >
      <View className="flex-row items-center gap-2">
        <View className="min-w-0 flex-1">
          <NativePressable
            accessibilityLabel={draft.title || t('builder.untitled_lesson')}
            accessibilityState={{ expanded: isOpen }}
            feedback="highlight"
            onPress={() => setIsOpen((open) => !open)}
          >
            <View className="gap-0.5 py-1">
              <Text className="text-sm font-semibold" style={{ color: theme.text }} numberOfLines={1}>
                {draft.title || t('builder.untitled_lesson')}
              </Text>
              <Text className="text-xs" style={{ color: theme.textMuted }}>
                {t(`lesson_content.${draft.content_type}`)}
              </Text>
            </View>
          </NativePressable>
        </View>
        <IconAction icon="chevron-up" label={t('builder.move_up')} disabled={isFirst} onPress={() => onMove(-1)} />
        <IconAction icon="chevron-down" label={t('builder.move_down')} disabled={isLast} onPress={() => onMove(1)} />
        <IconAction icon="trash-outline" label={t('builder.delete_lesson')} tone="danger" onPress={onDelete} />
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
            primary={primary}
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
            primary={primary}
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
  primary,
}: {
  label: string;
  values: readonly T[];
  selected: T | '';
  onSelect: (value: T) => void;
  labelFor: (value: T) => string;
  primary: string;
}) {
  const theme = useTheme();

  return (
    <View className="gap-2">
      <Text className="text-xs font-bold uppercase" style={{ color: theme.textSecondary }}>{label}</Text>
      <TagGroup
        size="sm"
        selectionMode="single"
        selectedKeys={selected ? [selected] : []}
        onSelectionChange={(keys) => {
          const next = Array.from(keys)[0];
          if (next !== undefined) onSelect(next as T);
        }}
      >
        <TagGroup.List>
          {values.map((value) => (
            <TagGroup.Item key={value} id={value}>
              <TagGroup.ItemLabel style={selected === value ? { color: contrastText(primary) } : undefined}>
                {labelFor(value)}
              </TagGroup.ItemLabel>
            </TagGroup.Item>
          ))}
        </TagGroup.List>
      </TagGroup>
    </View>
  );
}

export default CourseBuilder;
