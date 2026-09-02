// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Courses — moderation queue, instructor grants, and tenant analytics
 * for the Courses module (beta). Platform/tenant admin only.
 */

import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Card, CardBody, Button, Chip, Spinner, Input, ModuleStageBadge,
  Table, TableHeader, TableBody, TableRow, TableColumn, TableCell,
} from '@/components/ui';
import RefreshCw from 'lucide-react/icons/refresh-cw';
import { usePageTitle } from '@/hooks';
import { useToast } from '@/contexts';
import { api } from '@/lib/api';
import { PageHeader } from '../../components/PageHeader';

interface AdminCourse {
  id: number;
  title: string;
  status: string;
  moderation_status: string;
  author?: { id: number; name: string } | null;
}

interface Analytics {
  total_courses: number;
  published_courses: number;
  pending_moderation: number;
  total_enrollments: number;
  completed_enrollments: number;
  instructors: number;
}

interface Instructor {
  id: number;
  user_id: number;
  user?: { id: number; name: string } | null;
}

export default function CoursesAdmin() {
  const { t } = useTranslation('courses');
  usePageTitle(t('admin.title'));
  const toast = useToast();

  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [courses, setCourses] = useState<AdminCourse[]>([]);
  const [instructors, setInstructors] = useState<Instructor[]>([]);
  const [loading, setLoading] = useState(true);
  const [newInstructorId, setNewInstructorId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const [a, c, i] = await Promise.all([
      api.get<Analytics>('/v2/admin/courses/analytics'),
      api.get<AdminCourse[]>('/v2/admin/courses'),
      api.get<Instructor[]>('/v2/admin/courses/instructors'),
    ]);
    if (a.success && a.data) setAnalytics(a.data);
    if (c.success && c.data) setCourses(c.data);
    if (i.success && i.data) setInstructors(i.data);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const moderate = async (id: number, action: 'approve' | 'reject') => {
    const res = await api.post(`/v2/admin/courses/${id}/moderate`, { action });
    if (res.success) {
      toast.success(t('admin.moderated'));
      load();
    } else {
      toast.error(t('admin.error'));
    }
  };

  const grantInstructor = async () => {
    const userId = Number(newInstructorId);
    if (!userId) return;
    const res = await api.post('/v2/admin/courses/instructors', { user_id: userId });
    if (res.success) {
      toast.success(t('admin.instructor_granted'));
      setNewInstructorId('');
      load();
    } else {
      toast.error(t('admin.error'));
    }
  };

  const revokeInstructor = async (userId: number) => {
    const res = await api.delete(`/v2/admin/courses/instructors/${userId}`);
    if (res.success) {
      toast.success(t('admin.instructor_revoked'));
      load();
    } else {
      toast.error(t('admin.error'));
    }
  };

  const statusChip = (c: AdminCourse) => {
    if (c.moderation_status === 'approved' && c.status === 'published') {
      return <Chip size="sm" color="success" variant="soft">{t('instructor.published')}</Chip>;
    }
    if (c.moderation_status === 'pending') {
      return <Chip size="sm" color="warning" variant="soft">{t('instructor.pending_review')}</Chip>;
    }
    if (c.moderation_status === 'rejected') {
      return <Chip size="sm" color="danger" variant="soft">{t('admin.reject')}</Chip>;
    }
    return (
      <Chip size="sm" variant="soft">
        {t(`instructor.${c.status}`, { defaultValue: t('admin.status_unknown') })}
      </Chip>
    );
  };

  const stats: Array<{ label: string; value: number }> = analytics ? [
    { label: t('admin.stat_total'), value: analytics.total_courses },
    { label: t('admin.stat_published'), value: analytics.published_courses },
    { label: t('admin.stat_pending'), value: analytics.pending_moderation },
    { label: t('admin.stat_enrollments'), value: analytics.total_enrollments },
    { label: t('admin.stat_completions'), value: analytics.completed_enrollments },
    { label: t('admin.stat_instructors'), value: analytics.instructors },
  ] : [];

  return (
    <div className="max-w-7xl mx-auto px-4 pb-8">
      <PageHeader
        title={t('admin.title')}
        description={t('admin.subtitle')}
        actions={
          <div className="flex items-center gap-2">
            <ModuleStageBadge stage="beta" />
            <Button variant="tertiary" size="sm" startContent={<RefreshCw size={16} />} onPress={load}>
              {t('admin.refresh')}
            </Button>
          </div>
        }
      />

      {loading ? (
        <div className="flex justify-center py-16" role="status" aria-busy="true"><Spinner size="lg" /></div>
      ) : (
        <>
          {/* Stat grid */}
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

          {/* Moderation table */}
          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-3">{t('admin.tab_courses')}</h2>
            {courses.length === 0 ? (
              <p className="text-sm text-muted">{t('admin.no_courses')}</p>
            ) : (
              <Table aria-label={t('admin.tab_courses')}>
                <TableHeader>
                  <TableColumn>{t('admin.course')}</TableColumn>
                  <TableColumn>{t('admin.author')}</TableColumn>
                  <TableColumn>{t('admin.status')}</TableColumn>
                  <TableColumn>{t('admin.actions')}</TableColumn>
                </TableHeader>
                <TableBody>
                  {courses.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>{c.title}</TableCell>
                      <TableCell>{c.author?.name ?? '—'}</TableCell>
                      <TableCell>{statusChip(c)}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button size="sm" variant="secondary" onPress={() => moderate(c.id, 'approve')}>{t('admin.approve')}</Button>
                          <Button size="sm" variant="tertiary" onPress={() => moderate(c.id, 'reject')}>{t('admin.reject')}</Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>

          {/* Instructors */}
          <section>
            <h2 className="text-lg font-semibold mb-3">{t('admin.tab_instructors')}</h2>
            <div className="flex items-end gap-2 mb-4 max-w-sm">
              <Input
                size="sm"
                type="number"
                label={t('admin.user_id_placeholder')}
                value={newInstructorId}
                onValueChange={setNewInstructorId}
              />
              <Button size="sm" color="primary" onPress={grantInstructor}>{t('admin.grant_instructor')}</Button>
            </div>
            {instructors.length === 0 ? (
              <p className="text-sm text-muted">{t('admin.no_instructors')}</p>
            ) : (
              <div className="flex flex-col gap-2">
                {instructors.map((i) => (
                  <Card key={i.id}>
                    <CardBody className="p-3 flex items-center justify-between">
                      <span className="text-sm">{i.user?.name ?? `#${i.user_id}`}</span>
                      <Button size="sm" variant="tertiary" onPress={() => revokeInstructor(i.user_id)}>{t('admin.revoke')}</Button>
                    </CardBody>
                  </Card>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
