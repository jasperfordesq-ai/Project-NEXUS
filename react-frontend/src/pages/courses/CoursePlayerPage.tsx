// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * CoursePlayerPage — lesson viewer with progress tracking and completion.
 */

import { getFormattingLocale } from '@/lib/helpers';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Alert, Button, Card, CardBody, Checkbox, Radio, RadioGroup, Spinner, Progress, Textarea } from '@/components/ui';
import CheckCircle from 'lucide-react/icons/circle-check';
import PlayCircle from 'lucide-react/icons/play-circle';
import Lock from 'lucide-react/icons/lock';
import { usePageTitle } from '@/hooks';
import { useTenant, useToast } from '@/contexts';
import { coursesApi, type Course, type CourseLesson, type LessonProgress, type LessonAvailability, type Quiz } from '@/lib/api/courses';
import { LessonDiscussion } from '@/components/courses/LessonDiscussion';
import { normalizeCourseMediaUrl } from '@/lib/courseContentSecurity';

export default function CoursePlayerPage() {
  const { t } = useTranslation('courses');
  const { id } = useParams<{ id: string }>();
  const courseId = Number(id);
  const navigate = useNavigate();
  const { tenantPath } = useTenant();
  const toast = useToast();

  const [course, setCourse] = useState<Course | null>(null);
  const [progress, setProgress] = useState<Record<number, LessonProgress>>({});
  const [availability, setAvailability] = useState<Record<number, LessonAvailability>>({});
  const [percent, setPercent] = useState(0);
  const [activeLessonId, setActiveLessonId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  usePageTitle(course?.title ?? t('title'));

  const lessons: CourseLesson[] = useMemo(
    () => (course?.sections ?? []).flatMap((s) => s.lessons ?? []),
    [course],
  );

  useEffect(() => {
    if (!courseId) return;
    // Guard against a stale response overwriting a newer one when courseId
    // changes (navigating player -> player) or the component unmounts.
    let cancelled = false;
    setLoading(true);
    Promise.all([coursesApi.show(courseId), coursesApi.progress(courseId)])
      .then(([courseRes, progRes]) => {
        if (cancelled) return;
        if (courseRes.success && courseRes.data) setCourse(courseRes.data);
        if (progRes.success && progRes.data) {
          const map: Record<number, LessonProgress> = {};
          progRes.data.lessons.forEach((lp) => { map[lp.lesson_id] = lp; });
          setProgress(map);
          const availMap: Record<number, LessonAvailability> = {};
          (progRes.data.availability ?? []).forEach((a) => { availMap[a.lesson_id] = a; });
          setAvailability(availMap);
          setPercent(Number(progRes.data.enrollment.progress_percent) || 0);
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [courseId]);

  useEffect(() => {
    const first = lessons[0];
    if (activeLessonId === null && first) {
      setActiveLessonId(first.id);
    }
  }, [lessons, activeLessonId]);

  const activeLesson = lessons.find((l) => l.id === activeLessonId) ?? null;

  const markComplete = async (lesson: CourseLesson) => {
    const res = await coursesApi.completeLesson(courseId, lesson.id);
    if (res.success && res.data) {
      setProgress((prev) => ({
        ...prev,
        [lesson.id]: { lesson_id: lesson.id, status: 'completed', watch_percent: 100 },
      }));
      setPercent(Number(res.data.progress_percent) || 0);
      if (res.data.course_completed) {
        toast.success(t('player.course_completed_body'));
      } else {
        toast.success(t('player.lesson_completed'));
      }
    } else {
      toast.error(t('player.action_failed'));
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-20" role="status" aria-busy="true">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!course) {
    return <div className="max-w-3xl mx-auto px-4 py-16 text-center text-muted">{t('browse.empty')}</div>;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 flex flex-col lg:flex-row gap-6">
      {/* Lesson list */}
      <aside className="lg:w-72 flex-shrink-0">
        <div className="mb-3">
          <div className="text-xs text-muted mb-1">{t('player.course_progress')}</div>
          <Progress value={percent} aria-label={t('player.course_progress')} />
          <div className="text-xs text-muted mt-1">{Math.round(percent)}%</div>
        </div>
        <nav className="flex flex-col gap-1">
          {lessons.map((lesson) => {
            const done = progress[lesson.id]?.status === 'completed';
            const locked = availability[lesson.id]?.available === false;
            const active = lesson.id === activeLessonId;
            return (
              <Button
                key={lesson.id}
                variant="light"
                fullWidth
                onPress={() => setActiveLessonId(lesson.id)}
                className={`h-auto justify-start gap-2 rounded-md px-3 py-2 text-left text-sm font-normal transition-colors ${
                  active ? 'bg-accent-soft text-accent' : 'text-theme-primary hover:bg-[var(--color-surface-2)]'
                }`}
              >
                {done
                  ? <CheckCircle size={16} className="shrink-0 text-success" aria-hidden="true" />
                  : locked
                    ? <Lock size={16} className="shrink-0 text-muted" aria-hidden="true" />
                    : <PlayCircle size={16} className="shrink-0" aria-hidden="true" />}
                <span className="min-w-0 flex-1 truncate">{lesson.title}</span>
              </Button>
            );
          })}
        </nav>
        <Button variant="tertiary" size="sm" className="mt-4" onPress={() => navigate(tenantPath(`/courses/${course.slug}`))}>
          {t('player.back_to_course')}
        </Button>
      </aside>

      {/* Active lesson */}
      <div className="flex-1">
        {activeLesson ? (
          <Card>
            <CardBody className="p-5">
              <h1 className="text-xl font-bold mb-4">{activeLesson.title}</h1>
              {availability[activeLesson.id]?.available === false ? (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted gap-2">
                  <Lock size={32} aria-hidden="true" />
                  <p className="text-sm">
                    {availability[activeLesson.id]?.unlock_at
                      ? t('player.locked_until', { date: new Date(availability[activeLesson.id]!.unlock_at as string).toLocaleDateString(getFormattingLocale()) })
                      : t('player.locked')}
                  </p>
                </div>
              ) : (
                <>
                  <LessonContent lesson={activeLesson} />
                  <div className="mt-6 flex items-center gap-3">
                    {progress[activeLesson.id]?.status === 'completed' ? (
                      <span className="inline-flex items-center gap-1 text-success text-sm">
                        <CheckCircle size={16} aria-hidden="true" /> {t('player.completed')}
                      </span>
                    ) : (
                      <Button color="primary" onPress={() => markComplete(activeLesson)}>
                        {t('player.mark_complete')}
                      </Button>
                    )}
                  </div>
                  <LessonDiscussion courseId={course.id} lessonId={activeLesson.id} />
                </>
              )}
            </CardBody>
          </Card>
        ) : (
          <p className="text-muted">{t('detail.no_lessons')}</p>
        )}
      </div>
    </div>
  );
}

/**
 * A video or embedded lesson needs a text alternative (WCAG 1.2). There is no
 * captions file in the schema, so the instructor's transcript is it — shown in a
 * disclosure so it does not bury the player.
 */
function LessonTranscript({ lesson }: { lesson: CourseLesson }) {
  const { t } = useTranslation('courses');
  const transcript = lesson.transcript?.trim();
  if (!transcript) return null;

  return (
    <details className="mt-4 rounded-md border border-default-200 p-3">
      <summary className="cursor-pointer text-sm font-medium">{t('player.transcript')}</summary>
      <div className="mt-2 text-sm whitespace-pre-wrap">{transcript}</div>
    </details>
  );
}

function LessonContent({ lesson }: { lesson: CourseLesson }) {
  const videoUrl = normalizeCourseMediaUrl(lesson.video_url);
  const embedUrl = normalizeCourseMediaUrl(lesson.embed_url);
  const attachmentUrl = normalizeCourseMediaUrl(lesson.attachment_url);

  switch (lesson.content_type) {
    case 'video':
      return videoUrl ? (
        <>
          {/* No <track>: an empty captions track declares a caption file that
              does not exist, which is worse than declaring none. The transcript
              below is the text alternative until the schema can carry captions. */}
          <video controls className="w-full rounded-md" src={videoUrl} />
          <LessonTranscript lesson={lesson} />
        </>
      ) : null;
    case 'embed':
      return embedUrl ? (
        <>
          <div className="aspect-video">
            <iframe
              title={lesson.title}
              src={embedUrl}
              className="w-full h-full rounded-md"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              referrerPolicy="strict-origin-when-cross-origin"
              allowFullScreen
            />
          </div>
          <LessonTranscript lesson={lesson} />
        </>
      ) : null;
    case 'pdf':
      return attachmentUrl ? (
        <iframe
          title={lesson.title}
          src={attachmentUrl}
          className="w-full h-[70vh] rounded-md"
          sandbox="allow-same-origin allow-downloads"
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : null;
    case 'quiz':
      return <QuizLesson lesson={lesson} />;
    case 'text':
    default:
      return <div className="prose prose-sm max-w-none whitespace-pre-wrap">{lesson.body}</div>;
  }
}

function QuizLesson({ lesson }: { lesson: CourseLesson }) {
  const { t } = useTranslation('courses');
  const [quiz, setQuiz] = useState<Quiz | null>(lesson.quiz ?? null);
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [result, setResult] = useState<{ score_percent: number; passed: boolean; needs_review: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!lesson.quiz?.id) return;
    coursesApi.getQuiz(lesson.quiz.id).then((res) => {
      if (res.success && res.data) setQuiz(res.data);
    });
  }, [lesson.quiz?.id]);

  if (!quiz) {
    return <p className="text-sm text-muted">{t('quiz.unavailable')}</p>;
  }

  const submit = async () => {
    setSubmitting(true);
    const res = await coursesApi.submitQuiz(quiz.id, answers);
    setSubmitting(false);
    if (res.success && res.data) {
      setResult(res.data);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">{quiz.title}</h2>
        {quiz.description ? <p className="text-sm text-muted mt-1">{quiz.description}</p> : null}
      </div>
      {quiz.questions.map((question) => (
        <div key={question.id} className="rounded-md border border-[var(--color-border)] p-3">
          <p className="text-sm font-medium mb-2">{question.prompt}</p>
          {(question.options ?? []).length > 0 ? (
            question.type === 'multi' ? (
              <div className="flex flex-col gap-2">
                {(question.options ?? []).map((option) => {
                  const current = Array.isArray(answers[String(question.id)]) ? answers[String(question.id)] as string[] : [];
                  return (
                    <Checkbox
                      key={option.id}
                      isSelected={current.includes(option.id)}
                      onValueChange={(checked) => {
                        setAnswers({
                          ...answers,
                          [question.id]: checked
                            ? [...current, option.id]
                            : current.filter((id) => id !== option.id),
                        });
                      }}
                    >
                      {option.label}
                    </Checkbox>
                  );
                })}
              </div>
            ) : (
              <RadioGroup
                value={String(answers[String(question.id)] ?? '')}
                onValueChange={(value) => setAnswers({ ...answers, [question.id]: value })}
              >
                {(question.options ?? []).map((option) => (
                  <Radio key={option.id} value={option.id}>
                    {option.label}
                  </Radio>
                ))}
              </RadioGroup>
            )
          ) : (
            <Textarea
              className="w-full"
              rows={question.type === 'essay' ? 5 : 2}
              value={String(answers[String(question.id)] ?? '')}
              onValueChange={(value) => setAnswers({ ...answers, [question.id]: value })}
            />
          )}
        </div>
      ))}
      {result ? (
        <Alert
          color={result.needs_review ? 'warning' : result.passed ? 'success' : 'danger'}
          title={result.needs_review ? t('quiz.pending_review') : result.passed ? t('quiz.passed') : t('quiz.failed')}
          description={!result.needs_review ? t('quiz.score', { score: Math.round(result.score_percent) }) : undefined}
        />
      ) : null}
      <div>
        <Button color="primary" isLoading={submitting} onPress={submit}>
          {submitting ? t('quiz.submitting') : t('quiz.submit')}
        </Button>
      </div>
    </div>
  );
}
