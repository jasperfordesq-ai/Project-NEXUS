// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * CourseCard — compact course summary card for browse grids.
 */

import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card, CardBody, Chip } from '@/components/ui';
import { ThemedCover } from '@/components/ui/ThemedCover';
import { useTenant } from '@/contexts';
import { useSitePalette } from '@/contexts/SiteAccentContext';
import { colourForSeed } from '@/lib/categoryColours';
import { coverSeed } from '@/lib/coverSeeds';
import GraduationCap from 'lucide-react/icons/graduation-cap';
import Users from 'lucide-react/icons/users';
import { normalizeCourseMediaUrl } from '@/lib/courseContentSecurity';
import { resolveThumbnailUrl } from '@/lib/helpers';
import type { Course } from '@/lib/api/courses';

interface CourseCardProps {
  course: Course;
  /**
   * The colour of the course's category, from the community's course
   * categories (`categoryListColours`, warmth plan W3) — the page that lists
   * the courses knows it. Without it the category's seed colour is used.
   */
  coverColour?: string;
}

export function CourseCard({ course, coverColour: givenColour }: CourseCardProps) {
  const { t } = useTranslation('courses');
  const { tenantPath } = useTenant();
  const coverImage = normalizeCourseMediaUrl(course.cover_image);
  const coverThumbnail = coverImage
    ? resolveThumbnailUrl(coverImage, { width: 640, height: 360 })
    : '';
  const palette = useSitePalette();
  // Courses in one category share a colour; the course page uses the same one.
  const coverColour = givenColour ?? colourForSeed(coverSeed.course(course), palette);

  return (
    <Card className="h-full overflow-hidden transition-shadow hover:shadow-md">
      <Link to={tenantPath(`/courses/${course.slug}`)} className="block">
        <div className="group aspect-video w-full overflow-hidden">
          {coverImage ? (
            <img src={coverThumbnail} alt={course.title} className="w-full h-full object-cover" loading="lazy" decoding="async" />
          ) : (
            // No picture: a cover in a colour from the community palette, as
            // offers, events and blog posts have (was a grey box).
            <ThemedCover data-testid="course-card-cover" colour={coverColour} icon={GraduationCap} />
          )}
        </div>
        <CardBody className="p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Chip size="sm" variant="soft" color="accent">{t(`level.${course.level}`)}</Chip>
            {course.category?.name ? (
              <Chip size="sm" variant="soft" color="secondary">{course.category.name}</Chip>
            ) : null}
          </div>
          <h3 className="text-sm font-semibold line-clamp-2">{course.title}</h3>
          {course.summary ? (
            <p className="text-xs text-muted line-clamp-2">{course.summary}</p>
          ) : null}
          <div className="flex items-center justify-between mt-1 text-xs text-muted">
            {course.author?.name ? <span>{t('card.by_author', { name: course.author.name })}</span> : <span />}
            <span className="inline-flex items-center gap-1">
              <Users size={12} aria-hidden="true" />
              {t('card.enrolled', { count: course.enrollment_count })}
            </span>
          </div>
        </CardBody>
      </Link>
    </Card>
  );
}

export default CourseCard;
