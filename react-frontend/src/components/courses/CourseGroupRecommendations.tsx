// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * CourseGroupRecommendations — "Recommended courses" surface for a group.
 * Renders nothing when the courses feature is off or no courses are linked, so
 * it is always safe to drop into a group detail page.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts';
import { coursesApi, type Course } from '@/lib/api/courses';
import { CourseCard } from '@/components/courses/CourseCard';
import { useCategoryListColours } from '@/hooks/useCategoryListColours';

interface CourseGroupRecommendationsProps {
  groupId: number;
}

export function CourseGroupRecommendations({ groupId }: CourseGroupRecommendationsProps) {
  const { t } = useTranslation('courses');
  const { hasFeature } = useTenant();
  const [courses, setCourses] = useState<Course[]>([]);

  const enabled = hasFeature('courses');
  // The colours the courses page gives them (warmth plan W3).
  const courseCategoryColour = useCategoryListColours(enabled ? '/v2/courses/categories' : null);

  useEffect(() => {
    if (!enabled || !groupId) return;
    let cancelled = false;
    coursesApi.forGroup(groupId).then((res) => {
      if (!cancelled && res.success && res.data) setCourses(res.data);
    });
    return () => { cancelled = true; };
  }, [enabled, groupId]);

  if (!enabled || courses.length === 0) {
    return null;
  }

  return (
    <section className="mt-6">
      <h2 className="text-lg font-semibold mb-3">{t('group.recommended_courses')}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {courses.map((course) => (
          <CourseCard key={course.id} course={course} coverColour={courseCategoryColour(course.category_id)} />
        ))}
      </div>
    </section>
  );
}

export default CourseGroupRecommendations;
