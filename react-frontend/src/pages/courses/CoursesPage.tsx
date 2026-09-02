// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * CoursesPage — public/member browse + search for the Courses module (beta).
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { SearchField, Select, SelectItem, Spinner, ModuleStageBadge, Button } from '@/components/ui';
import Search from 'lucide-react/icons/search';
import Plus from 'lucide-react/icons/plus';
import { usePageTitle } from '@/hooks';
import { useAuth, useTenant } from '@/contexts';
import { coursesApi, type Course, type CourseCategory } from '@/lib/api/courses';
import { CourseCard } from '@/components/courses/CourseCard';

export default function CoursesPage() {
  const { t } = useTranslation('courses');
  usePageTitle(t('title'));
  const { tenant, isLoading: tenantLoading, tenantPath } = useTenant();
  const { isAuthenticated } = useAuth();

  const [courses, setCourses] = useState<Course[]>([]);
  const [categories, setCategories] = useState<CourseCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [level, setLevel] = useState<string>('');
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    if (tenantLoading || !tenant?.id) return;

    coursesApi.categories().then((res) => {
      if (res.success && res.data) setCategories(res.data);
    });
  }, [tenant?.id, tenantLoading]);

  useEffect(() => {
    if (tenantLoading) {
      setLoading(true);
      return;
    }

    if (!tenant?.id) {
      setCourses([]);
      setHasMore(false);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    coursesApi
      .browse({
        q: search || undefined,
        category_id: categoryId || undefined,
        level: level || undefined,
        page,
      })
      .then((res) => {
        if (cancelled) return;
        if (res.success && res.data) {
          setCourses((prev) => (page === 1 ? res.data!.items : [...prev, ...res.data!.items]));
          setHasMore(res.data.has_more);
        } else {
          setCourses([]);
          setHasMore(false);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tenant?.id, tenantLoading, search, categoryId, level, page]);

  useEffect(() => {
    setPage(1);
  }, [tenant?.id, search, categoryId, level]);

  const levelOptions = useMemo(
    () => [
      { value: '', label: t('browse.all_levels') },
      { value: 'beginner', label: t('level.beginner') },
      { value: 'intermediate', label: t('level.intermediate') },
      { value: 'advanced', label: t('level.advanced') },
    ],
    [t],
  );

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div className="flex flex-col gap-3 mb-1 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold leading-tight">{t('title')}</h1>
          <ModuleStageBadge stage="beta" />
        </div>
        {isAuthenticated && (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <Button as={Link} to={tenantPath('/courses/my-learning')} variant="tertiary" size="sm">
              {t('my_learning.title')}
            </Button>
            <Button as={Link} to={tenantPath('/courses/instructor')} variant="tertiary" size="sm">
              {t('instructor.my_courses')}
            </Button>
            <Button as={Link} to={tenantPath('/courses/instructor/new')} color="primary" size="sm" startContent={<Plus size={16} />}>
              {t('instructor.create_course')}
            </Button>
          </div>
        )}
      </div>
      <p className="text-sm text-muted mb-6">{t('subtitle')}</p>

      <div className="grid grid-cols-1 gap-3 mb-6 sm:grid-cols-[minmax(16rem,1fr)_minmax(11rem,14rem)_minmax(11rem,14rem)]">
        <SearchField
          size="sm"
          placeholder={t('browse.search_placeholder')}
          aria-label={t('browse.search_placeholder')}
          startContent={<Search size={16} className="text-muted" />}
          value={search}
          onValueChange={setSearch}
          isClearable
          onClear={() => setSearch('')}
        />
        <Select
          size="sm"
          aria-label={t('browse.all_categories')}
          selectedKeys={[categoryId]}
          onSelectionChange={(keys) => setCategoryId((Array.from(keys)[0] as string) ?? '')}
        >
          <SelectItem id="">{t('browse.all_categories')}</SelectItem>
          {categories.map((c) => (
            <SelectItem key={c.id} id={String(c.id)}>{c.name}</SelectItem>
          ))}
        </Select>
        <Select
          size="sm"
          aria-label={t('browse.all_levels')}
          selectedKeys={[level]}
          onSelectionChange={(keys) => setLevel((Array.from(keys)[0] as string) ?? '')}
        >
          {levelOptions.map((o) => (
            <SelectItem key={o.value} id={o.value}>{o.label}</SelectItem>
          ))}
        </Select>
      </div>

      {loading ? (
        <div className="flex justify-center py-16" role="status" aria-busy="true">
          <Spinner size="lg" />
        </div>
      ) : courses.length === 0 ? (
        <div className="text-center py-16 text-muted">
          <p className="text-lg">{t('browse.empty')}</p>
          <p className="text-sm mt-1">{t('browse.empty_hint')}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {courses.map((course) => (
              <CourseCard key={course.id} course={course} />
            ))}
          </div>
          {hasMore ? (
            <div className="flex justify-center mt-6">
              <Button variant="secondary" isLoading={loading} onPress={() => setPage((p) => p + 1)}>
                {t('browse.load_more')}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
