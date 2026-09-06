// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import { API_V2 } from '@/lib/constants';

export type CourseLevel = 'beginner' | 'intermediate' | 'advanced';
export type LessonContentType = 'video' | 'text' | 'pdf' | 'embed' | 'quiz';
export type CourseVisibility = 'public' | 'members' | 'group';
export type CourseStatus = 'draft' | 'published' | 'archived';
export type CourseModerationStatus = 'pending' | 'approved' | 'rejected' | 'flagged';
export type CourseEnrollmentType = 'self_paced' | 'cohort';
export type LessonDripType = 'none' | 'days_after_enroll' | 'fixed_date';
export type QuizQuestionType = 'mcq' | 'multi' | 'truefalse' | 'short' | 'essay';

export interface CourseCategory {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
  icon?: string | null;
  position?: number;
}

export interface QuizQuestion {
  id: number;
  quiz_id?: number;
  type: QuizQuestionType;
  prompt: string;
  options?: { id: string; label: string }[] | null;
  points?: number;
  position?: number;
}

export interface CourseQuiz {
  id: number;
  course_id: number;
  lesson_id: number | null;
  title: string;
  description?: string | null;
  pass_mark_percent?: number;
  max_attempts?: number;
  time_limit_minutes?: number | null;
  questions?: QuizQuestion[];
}

export interface CourseCohort {
  id: number;
  course_id: number;
  name: string;
  start_date?: string | null;
  end_date?: string | null;
  capacity?: number | null;
}

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
  /** Percentage of a video a learner must watch before the lesson counts as done. */
  min_watch_percent?: number;
  drip_type?: LessonDripType;
  drip_offset_days?: number | null;
  drip_date?: string | null;
  /** Present on a `quiz` lesson once its quiz has been created. */
  quiz?: CourseQuiz | null;
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
  /**
   * Authoring fields. Optional because an enrolment embeds only a partial course,
   * while `/v2/courses/mine` and `/v2/courses/{id}` return the whole model.
   */
  author_user_id?: number;
  category_id?: number | null;
  category?: CourseCategory | null;
  visibility?: CourseVisibility;
  enrollment_type?: CourseEnrollmentType;
  status?: CourseStatus;
  moderation_status?: CourseModerationStatus;
  learner_credit_reward?: string | number;
  instructor_credit_reward?: string | number;
  prerequisites?: number[] | null;
  completion_count?: number;
  rating_avg?: string | number;
  rating_count?: number;
  published_at?: string | null;
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

/** Fields `CourseService::create` / `::update` accept. Everything else is server-set. */
export interface CourseInput {
  title: string;
  summary?: string | null;
  description?: string | null;
  level?: CourseLevel;
  visibility?: CourseVisibility;
  enrollment_type?: CourseEnrollmentType;
  category_id?: number | null;
  credit_cost?: number;
  prerequisites?: number[];
}

export interface CourseSectionInput {
  title?: string;
  position?: number;
}

/** Fields `CourseLessonService` accepts; anything omitted is left untouched. */
export interface CourseLessonInput {
  section_id?: number | null;
  title?: string;
  content_type?: LessonContentType;
  body?: string | null;
  transcript?: string | null;
  video_url?: string | null;
  attachment_url?: string | null;
  embed_url?: string | null;
  position?: number;
  min_watch_percent?: number;
  drip_type?: LessonDripType;
  drip_offset_days?: number | null;
  drip_date?: string | null;
  is_preview?: boolean;
}

export interface CourseQuizInput {
  lesson_id?: number | null;
  title: string;
  description?: string | null;
  pass_mark_percent?: number;
  max_attempts?: number;
  time_limit_minutes?: number | null;
}

export interface QuizQuestionInput {
  type?: QuizQuestionType;
  prompt: string;
  options?: { id: string; label: string }[] | null;
  /** The accepted answer id(s). The API never returns this back to a learner. */
  correct?: unknown;
  explanation?: string | null;
  points?: number;
  position?: number;
}

export interface CourseCohortInput {
  name: string;
  start_date?: string | null;
  end_date?: string | null;
  capacity?: number | null;
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

// ---------------------------------------------------------------------------
//  Authoring — instructor / admin only. Every call below is refused by the API
//  for a member who is neither the course's author nor an admin.
// ---------------------------------------------------------------------------

export async function getCourseCategories(): Promise<CourseCategory[]> {
  return unwrap(await api.get<DataEnvelope<CourseCategory[]>>(`${API_V2}/courses/categories`));
}

/** GET /v2/courses/mine — courses the signed-in member authored. */
export async function getAuthoredCourses(): Promise<Course[]> {
  return unwrap(await api.get<DataEnvelope<Course[]>>(`${API_V2}/courses/mine`));
}

export async function createCourse(payload: CourseInput): Promise<Course> {
  return unwrap(await api.post<DataEnvelope<Course>>(`${API_V2}/courses`, payload));
}

export async function updateCourse(courseId: number, payload: CourseInput): Promise<Course> {
  return unwrap(await api.put<DataEnvelope<Course>>(`${API_V2}/courses/${courseId}`, payload));
}

export async function publishCourse(courseId: number): Promise<Course> {
  return unwrap(await api.post<DataEnvelope<Course>>(`${API_V2}/courses/${courseId}/publish`, {}));
}

export async function unpublishCourse(courseId: number): Promise<Course> {
  return unwrap(await api.post<DataEnvelope<Course>>(`${API_V2}/courses/${courseId}/unpublish`, {}));
}

export async function createCourseSection(courseId: number, payload: CourseSectionInput): Promise<CourseSection> {
  return unwrap(await api.post<DataEnvelope<CourseSection>>(`${API_V2}/courses/${courseId}/sections`, payload));
}

export async function updateCourseSection(
  courseId: number,
  sectionId: number,
  payload: CourseSectionInput,
): Promise<CourseSection> {
  return unwrap(await api.put<DataEnvelope<CourseSection>>(
    `${API_V2}/courses/${courseId}/sections/${sectionId}`,
    payload,
  ));
}

export async function deleteCourseSection(courseId: number, sectionId: number): Promise<{ deleted: boolean }> {
  return unwrap(await api.delete<DataEnvelope<{ deleted: boolean }>>(
    `${API_V2}/courses/${courseId}/sections/${sectionId}`,
  ));
}

export async function createCourseLesson(courseId: number, payload: CourseLessonInput): Promise<CourseLesson> {
  return unwrap(await api.post<DataEnvelope<CourseLesson>>(`${API_V2}/courses/${courseId}/lessons`, payload));
}

export async function updateCourseLesson(
  courseId: number,
  lessonId: number,
  payload: CourseLessonInput,
): Promise<CourseLesson> {
  return unwrap(await api.put<DataEnvelope<CourseLesson>>(
    `${API_V2}/courses/${courseId}/lessons/${lessonId}`,
    payload,
  ));
}

export async function deleteCourseLesson(courseId: number, lessonId: number): Promise<{ deleted: boolean }> {
  return unwrap(await api.delete<DataEnvelope<{ deleted: boolean }>>(
    `${API_V2}/courses/${courseId}/lessons/${lessonId}`,
  ));
}

export async function createCourseQuiz(courseId: number, payload: CourseQuizInput): Promise<CourseQuiz> {
  return unwrap(await api.post<DataEnvelope<CourseQuiz>>(`${API_V2}/courses/${courseId}/quizzes`, payload));
}

export async function createQuizQuestion(
  courseId: number,
  quizId: number,
  payload: QuizQuestionInput,
): Promise<QuizQuestion> {
  return unwrap(await api.post<DataEnvelope<QuizQuestion>>(
    `${API_V2}/courses/${courseId}/quizzes/${quizId}/questions`,
    payload,
  ));
}

export async function getCourseCohorts(courseId: number): Promise<CourseCohort[]> {
  return unwrap(await api.get<DataEnvelope<CourseCohort[]>>(`${API_V2}/courses/${courseId}/cohorts`));
}

export async function createCourseCohort(courseId: number, payload: CourseCohortInput): Promise<CourseCohort> {
  return unwrap(await api.post<DataEnvelope<CourseCohort>>(`${API_V2}/courses/${courseId}/cohorts`, payload));
}

// ---------------------------------------------------------------------------
//  Grading and analytics — instructor / admin only.
//
//  `CourseQuizController::gradingQueue` returns the attempts whose
//  `grading_status` is `pending_review`, each eager-loading its quiz (with the
//  question prompts and options, never the answer key) and the learner. The
//  grade endpoint is addressed by ATTEMPT id, not by course — the server
//  resolves the owning course itself and authorises against it.
// ---------------------------------------------------------------------------

/** One quiz attempt waiting on a human decision. */
export interface PendingAttempt {
  id: number;
  quiz_id: number;
  user_id: number;
  /** Keyed by question id, as submitted. A value may be a scalar or a list of option ids. */
  answers: Record<string, unknown> | null;
  score_percent: string | number;
  grading_status: string;
  submitted_at?: string | null;
  quiz?: { id: number; title: string; questions?: QuizQuestion[] };
  user?: { id: number; name: string; avatar_url?: string | null };
}

/** Exactly the body `CourseQuizController::gradeAttempt` reads. */
export interface GradeAttemptPayload {
  /** 0–100. The server clamps it, but send a sane number. */
  score_percent: number;
  passed: boolean;
  feedback: string;
}

export interface CourseAnalytics {
  course: { id: number; title: string };
  enrollments: { total: number; active: number; completed: number; dropped: number };
  completion_rate: number;
  avg_progress: number;
  avg_quiz_score: number;
  quiz_attempts: number;
  per_lesson: { lesson_id: number; title: string; completed: number }[];
}

/** GET /v2/courses/{courseId}/grading */
export async function getCourseGradingQueue(courseId: number): Promise<PendingAttempt[]> {
  return unwrap(await api.get<DataEnvelope<PendingAttempt[]>>(`${API_V2}/courses/${courseId}/grading`));
}

/** POST /v2/courses/attempts/{attemptId}/grade */
export async function gradeCourseAttempt(
  attemptId: number,
  payload: GradeAttemptPayload,
): Promise<PendingAttempt> {
  return unwrap(await api.post<DataEnvelope<PendingAttempt>>(
    `${API_V2}/courses/attempts/${attemptId}/grade`,
    payload,
  ));
}

/** GET /v2/courses/{courseId}/analytics */
export async function getCourseAnalytics(courseId: number): Promise<CourseAnalytics> {
  return unwrap(await api.get<DataEnvelope<CourseAnalytics>>(`${API_V2}/courses/${courseId}/analytics`));
}
