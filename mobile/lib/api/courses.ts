// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

export type CourseLevel = 'beginner' | 'intermediate' | 'advanced';
export type LessonContentType = 'video' | 'text' | 'pdf' | 'embed' | 'quiz';

export interface CourseLesson {
  id: number;
  course_id: number;
  section_id: number | null;
  title: string;
  content_type: LessonContentType;
  body?: string | null;
  transcript?: string | null;
  video_url?: string | null;
  attachment_url?: string | null;
  embed_url?: string | null;
  position: number;
  is_preview: boolean;
}

export interface CourseSection {
  id: number;
  course_id: number;
  title: string;
  position: number;
  lessons?: CourseLesson[];
}

export interface Course {
  id: number;
  title: string;
  slug: string;
  summary?: string | null;
  description?: string | null;
  cover_image?: string | null;
  level: CourseLevel;
  credit_cost: string | number;
  enrollment_count: number;
  author?: { id: number; name: string; avatar_url?: string | null };
  sections?: CourseSection[];
  is_enrolled?: boolean;
}

export interface CourseEnrollment {
  id: number;
  course_id: number;
  status: 'active' | 'completed' | 'dropped';
  progress_percent: string | number;
  course?: Partial<Course>;
}

export interface LessonProgress {
  lesson_id: number;
  status: 'not_started' | 'in_progress' | 'completed';
  watch_percent: number;
  completed_at?: string | null;
}

export interface LessonAvailability {
  lesson_id: number;
  available: boolean;
  unlock_at: string | null;
}

export interface CourseProgress {
  enrollment: CourseEnrollment;
  lessons: LessonProgress[];
  availability: LessonAvailability[];
}

export interface CoursePage {
  items: Course[];
  page: number;
  total: number;
  hasMore: boolean;
}

type DataEnvelope<T> = T | { data: T };
type CourseCollectionEnvelope = {
  data?: Course[];
  meta?: { current_page?: number; total?: number; has_more?: boolean };
};

function unwrap<T>(response: DataEnvelope<T>): T {
  if (response && typeof response === 'object' && 'data' in response) {
    return (response as { data: T }).data;
  }
  return response as T;
}

export async function getCourses(filters: {
  query?: string;
  categoryId?: number;
  level?: CourseLevel;
  page?: number;
} = {}): Promise<CoursePage> {
  const params: Record<string, string> = { per_page: '20' };
  if (filters.query) params.q = filters.query;
  if (filters.categoryId !== undefined) params.category_id = String(filters.categoryId);
  if (filters.level) params.level = filters.level;
  if (filters.page !== undefined) params.page = String(filters.page);

  const response = await api.get<Course[] | CourseCollectionEnvelope>(`${API_V2}/courses`, params);
  const envelope = response as CourseCollectionEnvelope;
  const items = Array.isArray(response) ? response : (envelope.data ?? []);
  return {
    items,
    page: Number(envelope.meta?.current_page ?? filters.page ?? 1),
    total: Number(envelope.meta?.total ?? items.length),
    hasMore: Boolean(envelope.meta?.has_more),
  };
}

export async function getCourse(idOrSlug: string | number): Promise<Course> {
  return unwrap(await api.get<DataEnvelope<Course>>(`${API_V2}/courses/${idOrSlug}`));
}

export async function getMyCourses(): Promise<CourseEnrollment[]> {
  return unwrap(await api.get<DataEnvelope<CourseEnrollment[]>>(`${API_V2}/me/courses`));
}

export async function getCourseProgress(courseId: number): Promise<CourseProgress> {
  return unwrap(await api.get<DataEnvelope<CourseProgress>>(`${API_V2}/courses/${courseId}/progress`));
}

export async function enrollInCourse(courseId: number): Promise<CourseEnrollment> {
  return unwrap(await api.post<DataEnvelope<CourseEnrollment>>(`${API_V2}/courses/${courseId}/enroll`, {}));
}

export async function completeCourseLesson(courseId: number, lessonId: number) {
  return unwrap(await api.post<DataEnvelope<{ progress_percent: number; course_completed: boolean }>>(
    `${API_V2}/courses/${courseId}/lessons/${lessonId}/complete`,
    { watch_percent: 100 },
  ));
}
