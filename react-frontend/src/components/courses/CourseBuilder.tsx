// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * CourseBuilder — curriculum editor for a course: sections with inline-editable
 * titles containing lessons, each lesson with an inline editor (title, content
 * type, and the matching content field). Supports add / edit / delete / reorder
 * for both sections and lessons, persisting every change via the courses API.
 *
 * Patterns follow mainstream LMS builders (Thinkific / Teachable / Circle /
 * LearnDash): a single curriculum view where everything is editable in place.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardBody, Checkbox, Input, Textarea, Select, SelectItem } from '@/components/ui';
import Plus from 'lucide-react/icons/plus';
import Trash2 from 'lucide-react/icons/trash-2';
import ChevronUp from 'lucide-react/icons/chevron-up';
import ChevronDown from 'lucide-react/icons/chevron-down';
import GripVertical from 'lucide-react/icons/grip-vertical';
import { useToast } from '@/contexts';
import { coursesApi, type CourseSection, type CourseLesson, type LessonContentType, type QuizQuestion } from '@/lib/api/courses';

const CONTENT_TYPES: LessonContentType[] = ['text', 'video', 'pdf', 'embed', 'quiz'];
const DRIP_TYPES = ['none', 'days_after_enroll', 'fixed_date'] as const;

interface CourseBuilderProps {
  courseId: number;
  initialSections: CourseSection[];
}

export function CourseBuilder({ courseId, initialSections }: CourseBuilderProps) {
  const { t } = useTranslation('courses');
  const toast = useToast();
  const [sections, setSections] = useState<CourseSection[]>(
    () => (initialSections ?? []).map((s) => ({ ...s, lessons: s.lessons ?? [] })),
  );

  const addSection = async () => {
    const res = await coursesApi.createSection(courseId, { title: t('builder.new_section'), position: sections.length });
    if (res.success && res.data) {
      setSections((prev) => [...prev, { ...res.data!, lessons: [] }]);
    } else {
      toast.error(t('builder.save_error'));
    }
  };

  const renameSection = async (sectionId: number, title: string) => {
    const prev = sections;
    setSections((p) => p.map((s) => (s.id === sectionId ? { ...s, title } : s)));
    const res = await coursesApi.updateSection(courseId, sectionId, { title });
    if (!res.success) {
      setSections(prev);
      toast.error(t('builder.save_error'));
    }
  };

  const deleteSection = async (sectionId: number) => {
    const res = await coursesApi.deleteSection(courseId, sectionId);
    if (res.success) {
      setSections((prev) => prev.filter((s) => s.id !== sectionId));
    } else {
      toast.error(t('builder.save_error'));
    }
  };

  const moveSection = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= sections.length) return;
    const prev = sections;
    const next = [...sections];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setSections(next);
    const results = await Promise.all([
      coursesApi.updateSection(courseId, next[index]!.id, { position: index }),
      coursesApi.updateSection(courseId, next[target]!.id, { position: target }),
    ]);
    if (results.some((r) => !r.success)) {
      setSections(prev);
      toast.error(t('builder.save_error'));
    }
  };

  const addLesson = async (sectionId: number) => {
    const section = sections.find((s) => s.id === sectionId);
    const res = await coursesApi.createLesson(courseId, {
      section_id: sectionId,
      title: t('builder.new_lesson'),
      content_type: 'text',
      position: section?.lessons?.length ?? 0,
    });
    if (res.success && res.data) {
      setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, lessons: [...(s.lessons ?? []), res.data!] } : s)));
    } else {
      toast.error(t('builder.save_error'));
    }
  };

  const updateLessonLocal = (sectionId: number, lesson: CourseLesson) => {
    setSections((prev) => prev.map((s) => (
      s.id === sectionId ? { ...s, lessons: (s.lessons ?? []).map((l) => (l.id === lesson.id ? lesson : l)) } : s
    )));
  };

  const deleteLesson = async (sectionId: number, lessonId: number) => {
    const res = await coursesApi.deleteLesson(courseId, lessonId);
    if (res.success) {
      setSections((prev) => prev.map((s) => (
        s.id === sectionId ? { ...s, lessons: (s.lessons ?? []).filter((l) => l.id !== lessonId) } : s
      )));
    } else {
      toast.error(t('builder.save_error'));
    }
  };

  const moveLesson = async (sectionId: number, index: number, dir: -1 | 1) => {
    const section = sections.find((s) => s.id === sectionId);
    if (!section) return;
    const lessons = [...(section.lessons ?? [])];
    const target = index + dir;
    if (target < 0 || target >= lessons.length) return;
    const prev = sections;
    [lessons[index], lessons[target]] = [lessons[target]!, lessons[index]!];
    setSections((p) => p.map((s) => (s.id === sectionId ? { ...s, lessons } : s)));
    const results = await Promise.all([
      coursesApi.updateLesson(courseId, lessons[index]!.id, { position: index }),
      coursesApi.updateLesson(courseId, lessons[target]!.id, { position: target }),
    ]);
    if (results.some((r) => !r.success)) {
      setSections(prev);
      toast.error(t('builder.save_error'));
    }
  };

  return (
    <section>
      <div className="flex flex-col gap-2 mb-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-lg font-semibold leading-tight">{t('instructor.builder')}</h2>
        <Button size="sm" color="primary" startContent={<Plus size={16} />} onPress={addSection}>
          {t('builder.add_section')}
        </Button>
      </div>

      {sections.length === 0 ? (
        <Card><CardBody className="p-6 text-center text-muted text-sm">{t('builder.empty')}</CardBody></Card>
      ) : (
        <div className="flex flex-col gap-4">
          {sections.map((section, si) => (
            <Card key={section.id}>
              <CardBody className="p-4">
                <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-2 mb-3">
                  <GripVertical size={16} className="text-muted shrink-0" aria-hidden="true" />
                  <Input
                    size="sm"
                    aria-label={t('builder.section_name')}
                    defaultValue={section.title}
                    onBlur={(e) => {
                      const v = (e.target as HTMLInputElement).value.trim();
                      if (v && v !== section.title) renameSection(section.id, v);
                    }}
                    className="flex-1"
                  />
                  <Button isIconOnly size="sm" variant="tertiary" aria-label={t('builder.move_up')} isDisabled={si === 0} onPress={() => moveSection(si, -1)}><ChevronUp size={14} /></Button>
                  <Button isIconOnly size="sm" variant="tertiary" aria-label={t('builder.move_down')} isDisabled={si === sections.length - 1} onPress={() => moveSection(si, 1)}><ChevronDown size={14} /></Button>
                  <Button isIconOnly size="sm" variant="tertiary" aria-label={t('builder.delete_section')} onPress={() => deleteSection(section.id)}><Trash2 size={14} /></Button>
                </div>

                <div className="flex flex-col gap-2 sm:pl-6">
                  {(section.lessons ?? []).map((lesson, li) => (
                    <LessonRow
                      key={lesson.id}
                      courseId={courseId}
                      lesson={lesson}
                      isFirst={li === 0}
                      isLast={li === (section.lessons?.length ?? 0) - 1}
                      onChange={(l) => updateLessonLocal(section.id, l)}
                      onDelete={() => deleteLesson(section.id, lesson.id)}
                      onMove={(dir) => moveLesson(section.id, li, dir)}
                    />
                  ))}
                  <div>
                    <Button size="sm" variant="tertiary" startContent={<Plus size={14} />} onPress={() => addLesson(section.id)}>
                      {t('builder.add_lesson')}
                    </Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}

interface LessonRowProps {
  courseId: number;
  lesson: CourseLesson;
  isFirst: boolean;
  isLast: boolean;
  onChange: (lesson: CourseLesson) => void;
  onDelete: () => void;
  onMove: (dir: -1 | 1) => void;
}

function LessonRow({ courseId, lesson, isFirst, isLast, onChange, onDelete, onMove }: LessonRowProps) {
  const { t } = useTranslation('courses');
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CourseLesson>(lesson);
  const [saving, setSaving] = useState(false);
  const [questionPrompt, setQuestionPrompt] = useState('');
  const [questionOptions, setQuestionOptions] = useState('');
  const [questionCorrect, setQuestionCorrect] = useState('');

  const set = (patch: Partial<CourseLesson>) => setDraft((d) => ({ ...d, ...patch }));

  const save = async () => {
    setSaving(true);
    const res = await coursesApi.updateLesson(courseId, lesson.id, {
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
    if (res.success) {
      let next = { ...draft, ...(res.data ?? {}) };
      if (next.content_type === 'quiz' && !next.quiz?.id) {
        const quizRes = await coursesApi.createQuiz(courseId, {
          lesson_id: lesson.id,
          title: next.title || t('quiz.title'),
          pass_mark_percent: 70,
          max_attempts: 0,
        });
        if (quizRes.success && quizRes.data) {
          next = { ...next, quiz: { ...quizRes.data, questions: quizRes.data.questions ?? [] } };
        }
      }
      onChange(next);
      setDraft(next);
      toast.success(t('builder.lesson_saved'));
    } else {
      toast.error(t('builder.save_error'));
    }
    setSaving(false);
  };

  const addQuestion = async () => {
    if (!draft.quiz?.id || !questionPrompt.trim()) return;
    const labels = questionOptions.split(',').map((v) => v.trim()).filter(Boolean);
    const options = labels.map((label, index) => ({ id: String.fromCharCode(97 + index), label }));
    const correct = questionCorrect.trim() || options[0]?.id || 'a';
    const res = await coursesApi.createQuestion(courseId, draft.quiz.id, {
      type: 'mcq',
      prompt: questionPrompt.trim(),
      options,
      correct: [correct],
      points: 1,
      position: (draft.quiz.questions ?? []).length + 1,
    });
    if (res.success && res.data) {
      const nextQuestion = res.data as QuizQuestion;
      const next = {
        ...draft,
        quiz: { ...draft.quiz, questions: [...(draft.quiz.questions ?? []), nextQuestion] },
      };
      setDraft(next);
      onChange(next);
      setQuestionPrompt('');
      setQuestionOptions('');
      setQuestionCorrect('');
      toast.success(t('builder.question_added'));
    } else {
      toast.error(t('builder.save_error'));
    }
  };

  return (
    <div className="rounded-md border border-[var(--color-border)]">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2 px-3 py-2">
        <Button
          type="button"
          variant="tertiary"
          className="h-auto min-w-0 justify-start px-0 py-1 text-left text-sm"
          onPress={() => setOpen((o) => !o)}
        >
          <span className="min-w-0 truncate">
            {draft.title || t('builder.untitled_lesson')}
            <span className="ml-2 text-xs text-muted">· {t(`lesson_content.${draft.content_type}`)}</span>
          </span>
        </Button>
        <Button isIconOnly size="sm" variant="tertiary" aria-label={t('builder.move_up')} isDisabled={isFirst} onPress={() => onMove(-1)}><ChevronUp size={14} /></Button>
        <Button isIconOnly size="sm" variant="tertiary" aria-label={t('builder.move_down')} isDisabled={isLast} onPress={() => onMove(1)}><ChevronDown size={14} /></Button>
        <Button isIconOnly size="sm" variant="tertiary" aria-label={t('builder.delete_lesson')} onPress={onDelete}><Trash2 size={14} /></Button>
      </div>

      {open ? (
        <div className="px-3 pb-3 flex flex-col gap-3 border-t border-[var(--color-border)] pt-3">
          <Input size="sm" label={t('builder.lesson_name')} value={draft.title} onValueChange={(v) => set({ title: v })} />
          <Select
            size="sm"
            label={t('builder.content_type')}
            selectedKeys={[draft.content_type]}
            onSelectionChange={(k) => set({ content_type: (Array.from(k)[0] as LessonContentType) ?? 'text' })}
          >
            {CONTENT_TYPES.map((ct) => <SelectItem key={ct} id={ct}>{t(`lesson_content.${ct}`)}</SelectItem>)}
          </Select>

          {draft.content_type === 'text' ? (
            <Textarea label={t('builder.body')} value={draft.body ?? ''} onValueChange={(v) => set({ body: v })} rows={5} />
          ) : null}
          {draft.content_type === 'video' ? (
            <Input size="sm" label={t('builder.video_url')} placeholder={t('builder.url_placeholder')} value={draft.video_url ?? ''} onValueChange={(v) => set({ video_url: v })} />
          ) : null}
          {draft.content_type === 'video' || draft.content_type === 'embed' ? (
            <Textarea
              label={t('builder.transcript')}
              description={t('builder.transcript_hint')}
              value={draft.transcript ?? ''}
              onValueChange={(v) => set({ transcript: v })}
              rows={6}
            />
          ) : null}
          {draft.content_type === 'embed' ? (
            <Input size="sm" label={t('builder.embed_url')} placeholder={t('builder.url_placeholder')} value={draft.embed_url ?? ''} onValueChange={(v) => set({ embed_url: v })} />
          ) : null}
          {draft.content_type === 'pdf' ? (
            <Input size="sm" label={t('builder.attachment_url')} placeholder={t('builder.url_placeholder')} value={draft.attachment_url ?? ''} onValueChange={(v) => set({ attachment_url: v })} />
          ) : null}

          {draft.content_type === 'quiz' ? (
            <div className="flex flex-col gap-3 rounded-md border border-[var(--color-border)] p-3">
              <p className="text-sm font-medium">{draft.quiz?.title ?? t('quiz.title')}</p>
              {(draft.quiz?.questions ?? []).length > 0 ? (
                <ul className="text-sm text-muted list-disc pl-5">
                  {(draft.quiz?.questions ?? []).map((question) => (
                    <li key={question.id}>{question.prompt}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">{t('builder.no_questions')}</p>
              )}
              <Input size="sm" label={t('builder.question_prompt')} value={questionPrompt} onValueChange={setQuestionPrompt} />
              <Input size="sm" label={t('builder.question_options')} value={questionOptions} onValueChange={setQuestionOptions} />
              <Input size="sm" label={t('builder.question_correct')} value={questionCorrect} onValueChange={setQuestionCorrect} />
              <div>
                <Button size="sm" variant="secondary" onPress={addQuestion} isDisabled={!draft.quiz?.id || !questionPrompt.trim()}>
                  {t('builder.add_question')}
                </Button>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Select
              size="sm"
              label={t('builder.drip_type')}
              selectedKeys={[draft.drip_type ?? 'none']}
              onSelectionChange={(k) => set({ drip_type: (Array.from(k)[0] as CourseLesson['drip_type']) ?? 'none' })}
            >
              {DRIP_TYPES.map((type) => <SelectItem key={type} id={type}>{t(`builder.drip_${type}`)}</SelectItem>)}
            </Select>
            <Input
              size="sm"
              type="number"
              label={t('builder.drip_offset_days')}
              value={draft.drip_offset_days != null ? String(draft.drip_offset_days) : ''}
              onValueChange={(v) => set({ drip_offset_days: v === '' ? null : Number(v) })}
            />
            <Input
              size="sm"
              type="date"
              label={t('builder.drip_date')}
              value={draft.drip_date ? String(draft.drip_date).slice(0, 10) : ''}
              onValueChange={(v) => set({ drip_date: v || null })}
            />
          </div>
          <Checkbox isSelected={Boolean(draft.is_preview)} onValueChange={(checked) => set({ is_preview: checked })}>
            {t('builder.free_preview')}
          </Checkbox>

          <div>
            <Button size="sm" color="primary" isLoading={saving} onPress={save}>{t('builder.save_lesson')}</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default CourseBuilder;
