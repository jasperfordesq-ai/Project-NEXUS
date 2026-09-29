// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * MyLearningPage — the learner's enrolled courses, split by progress.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Card, CardBody, Chip, Spinner, Progress } from '@/components/ui';
import { usePageTitle } from '@/hooks';
import { useTenant } from '@/contexts';
import { coursesApi, type CourseEnrollment } from '@/lib/api/courses';
import { writePrintableDocument } from '@/lib/printableDocument';

export default function MyLearningPage() {
  const { t } = useTranslation('courses');
  usePageTitle(t('my_learning.title'));
  const { tenantPath } = useTenant();

  const [enrollments, setEnrollments] = useState<CourseEnrollment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    coursesApi.myCourses()
      .then((res) => { if (!cancelled) setEnrollments(res.success && res.data ? res.data : []); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-20" role="status" aria-busy="true">
        <Spinner size="lg" />
      </div>
    );
  }

  const inProgress = enrollments.filter((e) => e.status !== 'completed');
  const completed = enrollments.filter((e) => e.status === 'completed');

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-bold mb-6">{t('my_learning.title')}</h1>

      {enrollments.length === 0 ? (
        <div className="text-center py-16 text-muted">
          <p className="text-lg mb-3">{t('my_learning.empty')}</p>
          <Button as={Link} to={tenantPath('/courses')} color="primary">{t('my_learning.browse_cta')}</Button>
        </div>
      ) : (
        <>
          {inProgress.length > 0 && (
            <section className="mb-8">
              <h2 className="text-lg font-semibold mb-3">{t('my_learning.in_progress')}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {inProgress.map((e) => (
                  <EnrollmentCard key={e.id} enrollment={e} tenantPath={tenantPath} />
                ))}
              </div>
            </section>
          )}
          {completed.length > 0 && (
            <section>
              <h2 className="text-lg font-semibold mb-3">{t('my_learning.completed')}</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {completed.map((e) => (
                  <EnrollmentCard key={e.id} enrollment={e} tenantPath={tenantPath} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function EnrollmentCard({ enrollment, tenantPath }: { enrollment: CourseEnrollment; tenantPath: (p: string) => string }) {
  const { t } = useTranslation('courses');
  const pct = Number(enrollment.progress_percent) || 0;
  const course = enrollment.course;
  const isCompleted = enrollment.status === 'completed';

  const downloadCertificate = async () => {
    const res = await coursesApi.certificate(enrollment.course_id);
    if (res.success && res.data?.html) {
      const win = window.open('', '_blank');
      if (win) {
        // F-299: sanitised, because this window shares the app's origin.
        writePrintableDocument(win, res.data.html);
        win.focus();
        win.print();
      }
    }
  };

  return (
    <Card>
      <CardBody className="p-4 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-sm line-clamp-1">{course?.title ?? `#${enrollment.course_id}`}</h3>
          {isCompleted ? <Chip size="sm" color="success" variant="soft">{t('my_learning.completed')}</Chip> : null}
        </div>
        <Progress value={pct} aria-label={t('player.course_progress')} />
        <div className="flex items-center justify-between mt-1">
          <span className="text-xs text-muted">{Math.round(pct)}%</span>
          <div className="flex items-center gap-2">
            {isCompleted ? (
              <Button size="sm" variant="secondary" onPress={downloadCertificate}>
                {t('certificate.download')}
              </Button>
            ) : null}
            <Button
              as={Link}
              to={tenantPath(`/courses/${enrollment.course_id}/learn`)}
              size="sm"
              variant="tertiary"
            >
              {t('detail.continue')}
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
