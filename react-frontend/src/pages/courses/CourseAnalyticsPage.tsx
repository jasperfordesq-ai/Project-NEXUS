// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * CourseAnalyticsPage — per-course analytics for instructors/admins:
 * enrollment funnel, completion rate, average quiz score, and a per-lesson
 * completion (drop-off) chart.
 */

import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Card, CardBody, Spinner, Button } from '@/components/ui';
import ArrowLeft from 'lucide-react/icons/arrow-left';
import { Link } from 'react-router-dom';
import { usePageTitle } from '@/hooks';
import { useChartColors } from '@/hooks/useChartColors';
import { useTenant } from '@/contexts';
import { coursesApi, type CourseAnalytics } from '@/lib/api/courses';

export default function CourseAnalyticsPage() {
  const { t } = useTranslation('courses');
  const { id } = useParams<{ id: string }>();
  const courseId = Number(id);
  const { tenantPath } = useTenant();

  const [data, setData] = useState<CourseAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  usePageTitle(t('analytics.title'));
  // The bars follow the community's chart colours.
  const chartColors = useChartColors();

  useEffect(() => {
    if (!courseId) return;
    setLoading(true);
    coursesApi.analytics(courseId)
      .then((res) => setData(res.success && res.data ? res.data : null))
      .finally(() => setLoading(false));
  }, [courseId]);

  if (loading) {
    return <div className="flex justify-center py-20" role="status" aria-busy="true"><Spinner size="lg" /></div>;
  }
  if (!data) {
    return <div className="max-w-3xl mx-auto px-4 py-16 text-center text-muted">{t('analytics.unavailable')}</div>;
  }

  const stats = [
    { label: t('analytics.total_enrollments'), value: data.enrollments.total },
    { label: t('analytics.active'), value: data.enrollments.active },
    { label: t('analytics.completed'), value: data.enrollments.completed },
    { label: t('analytics.completion_rate'), value: `${data.completion_rate}%` },
    { label: t('analytics.avg_progress'), value: `${data.avg_progress}%` },
    { label: t('analytics.avg_quiz_score'), value: `${data.avg_quiz_score}%` },
  ];

  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <Button as={Link} to={tenantPath('/courses/instructor')} variant="tertiary" size="sm" startContent={<ArrowLeft size={16} />} className="mb-4">
        {t('instructor.dashboard')}
      </Button>
      <h1 className="text-2xl font-bold mb-1">{data.course.title}</h1>
      <p className="text-sm text-muted mb-6">{t('analytics.title')}</p>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardBody className="p-4">
              <div className="text-2xl font-bold">{s.value}</div>
              <div className="text-xs text-muted">{s.label}</div>
            </CardBody>
          </Card>
        ))}
      </div>

      <Card>
        <CardBody className="p-4">
          <h2 className="text-lg font-semibold mb-4">{t('analytics.per_lesson')}</h2>
          {data.per_lesson.length === 0 ? (
            <p className="text-sm text-muted">{t('analytics.no_lessons')}</p>
          ) : (
            <div className="w-full h-80">
              <ResponsiveContainer>
                <BarChart data={data.per_lesson} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                  <XAxis dataKey="title" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="completed" fill={chartColors.primary} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
