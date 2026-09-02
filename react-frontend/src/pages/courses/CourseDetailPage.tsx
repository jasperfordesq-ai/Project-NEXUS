// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * CourseDetailPage — course overview, syllabus, and enrollment.
 */

import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardBody, Chip, Spinner, ModuleStageBadge } from '@/components/ui';
import BookOpen from 'lucide-react/icons/book-open';
import PlayCircle from 'lucide-react/icons/play-circle';
import { usePageTitle } from '@/hooks';
import { useAuth, useTenant, useToast } from '@/contexts';
import { coursesApi, type Course, type CoursePrerequisite } from '@/lib/api/courses';
import { CourseReviews } from '@/components/courses/CourseReviews';
import CircleCheck from 'lucide-react/icons/circle-check';
import Lock from 'lucide-react/icons/lock';

export default function CourseDetailPage() {
  const { t } = useTranslation('courses');
  const { idOrSlug } = useParams<{ idOrSlug: string }>();
  const navigate = useNavigate();
  const { tenantPath } = useTenant();
  const { isAuthenticated, user } = useAuth();
  const toast = useToast();

  const [course, setCourse] = useState<Course | null>(null);
  const [prereqs, setPrereqs] = useState<CoursePrerequisite[]>([]);
  const [loading, setLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);

  usePageTitle(course?.title ?? t('title'));

  useEffect(() => {
    if (!idOrSlug) return;
    // Guard against a stale response overwriting a newer one when idOrSlug
    // changes (navigating detail -> detail) or the component unmounts.
    let cancelled = false;
    setLoading(true);
    coursesApi.show(idOrSlug)
      .then((res) => {
        if (cancelled) return;
        const c = res.success && res.data ? res.data : null;
        setCourse(c);
        if (c) {
          coursesApi.prerequisites(c.id).then((pr) => {
            if (cancelled) return;
            if (pr.success && pr.data) setPrereqs(pr.data);
          });
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [idOrSlug]);

  const hasUnmetPrereqs = prereqs.some((p) => !p.completed);

  const handleEnroll = async () => {
    if (!course) return;
    if (!isAuthenticated) {
      navigate(tenantPath('/login'));
      return;
    }
    setEnrolling(true);
    const res = await coursesApi.enroll(course.id);
    setEnrolling(false);
    if (res.success) {
      toast.success(t('detail.enroll_success'));
      navigate(tenantPath(`/courses/${course.id}/learn`));
    } else if (res.code === 'COURSE_NOT_AVAILABLE') {
      toast.error(t('detail.not_available'));
    } else if (res.code === 'PREREQUISITES_NOT_MET') {
      toast.error(t('detail.prerequisites_required'));
    } else if (res.code === 'INSUFFICIENT_CREDITS') {
      toast.error(t('detail.insufficient_credits'));
    } else {
      toast.error(t('detail.enroll_error'));
    }
  };

  const isOwner = !!(user && course && Number(user.id) === Number(course.author_user_id));

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

  const lessonCount = (course.sections ?? []).reduce((n, s) => n + (s.lessons?.length ?? 0), 0);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="flex flex-col md:flex-row gap-6">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Chip size="sm" variant="soft">{t(`level.${course.level}`)}</Chip>
            {course.category?.name ? <Chip size="sm" variant="soft" color="secondary">{course.category.name}</Chip> : null}
            <ModuleStageBadge stage="beta" />
          </div>
          <h1 className="text-2xl font-bold leading-tight mb-2">{course.title}</h1>
          {course.summary ? <p className="text-muted mb-4">{course.summary}</p> : null}

          <Card className="mb-6">
            <CardBody className="p-4">
              <h2 className="text-lg font-semibold mb-2">{t('detail.about')}</h2>
              <div className="prose prose-sm max-w-none whitespace-pre-wrap">{course.description}</div>
            </CardBody>
          </Card>

          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <BookOpen size={18} aria-hidden="true" /> {t('detail.syllabus')}
          </h2>
          {(course.sections ?? []).length === 0 ? (
            <p className="text-sm text-muted">{t('detail.no_lessons')}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {(course.sections ?? []).map((section) => (
                <Card key={section.id}>
                  <CardBody className="p-4">
                    <h3 className="font-semibold text-sm mb-2">{section.title}</h3>
                    <ul className="flex flex-col gap-1">
                      {(section.lessons ?? []).map((lesson) => (
                        <li key={lesson.id} className="flex min-w-0 items-center gap-2 text-sm text-muted">
                          <PlayCircle size={14} className="shrink-0" aria-hidden="true" />
                          <span className="min-w-0 truncate">{lesson.title}</span>
                        </li>
                      ))}
                    </ul>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}

          {prereqs.length > 0 ? (
            <section className="mt-6">
              <h2 className="text-lg font-semibold mb-3">{t('detail.prerequisites')}</h2>
              <ul className="flex flex-col gap-1">
                {prereqs.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 text-sm">
                    {p.completed
                      ? <CircleCheck size={16} className="text-success" aria-hidden="true" />
                      : <Lock size={16} className="text-muted" aria-hidden="true" />}
                    {p.title}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <CourseReviews
            courseId={course.id}
            ratingAvg={Number(course.rating_avg) || 0}
            ratingCount={course.rating_count || 0}
            canReview={Boolean(course.is_enrolled)}
          />
        </div>

        <aside className="md:w-72 flex-shrink-0">
          <Card>
            <CardBody className="p-4 flex flex-col gap-3">
              <div className="text-2xl font-bold">
                {Number(course.credit_cost) > 0 ? t('detail.cost', { credits: Number(course.credit_cost) }) : t('detail.free')}
              </div>
              <div className="text-sm text-muted">
                {t('card.lessons', { count: lessonCount })}
              </div>
              {isOwner ? (
                <>
                  <Button color="primary" onPress={() => navigate(tenantPath(`/courses/instructor/${course.id}/edit`))}>
                    {t('instructor.edit_course')}
                  </Button>
                  <p className="text-xs text-muted">{t('detail.your_course')}</p>
                </>
              ) : course.is_enrolled ? (
                <Button color="primary" onPress={() => navigate(tenantPath(`/courses/${course.id}/learn`))}>
                  {t('detail.continue')}
                </Button>
              ) : (
                <>
                  <Button color="primary" isLoading={enrolling} isDisabled={hasUnmetPrereqs} onPress={handleEnroll}>
                    {enrolling ? t('detail.enrolling') : t('detail.enroll')}
                  </Button>
                  {hasUnmetPrereqs ? (
                    <p className="text-xs text-muted">{t('detail.prerequisites_required')}</p>
                  ) : null}
                </>
              )}
              {course.author?.name ? (
                <div className="text-xs text-muted">{t('card.by_author', { name: course.author.name })}</div>
              ) : null}
            </CardBody>
          </Card>
        </aside>
      </div>
    </div>
  );
}
