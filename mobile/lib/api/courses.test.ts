// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import {
  completeCourseLesson,
  createCourse,
  createCourseCohort,
  createCourseLesson,
  createCourseQuiz,
  createCourseSection,
  createQuizQuestion,
  deleteCourseLesson,
  deleteCourseSection,
  enrollInCourse,
  getAuthoredCourses,
  getCourse,
  getCourseCategories,
  getCourseAnalytics,
  getCourseCohorts,
  getCourseGradingQueue,
  getCourseProgress,
  getCourses,
  getMyCourses,
  gradeCourseAttempt,
  publishCourse,
  unpublishCourse,
  updateCourse,
  updateCourseLesson,
  updateCourseSection,
} from './courses';

jest.mock('@/lib/api/client', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
  },
}));

describe('courses API', () => {
  beforeEach(() => jest.clearAllMocks());

  it('normalises the paginated Laravel catalogue and sends supported filters', async () => {
    (api.get as jest.Mock).mockResolvedValue({
      data: [{ id: 7, title: 'Timebanking basics', slug: 'basics' }],
      meta: { current_page: 2, total: 13, per_page: 12, has_more: false },
    });

    const result = await getCourses({ query: 'basics', categoryId: 3, level: 'beginner', page: 2 });

    expect(api.get).toHaveBeenCalledWith('/api/v2/courses', {
      q: 'basics', category_id: '3', level: 'beginner', page: '2', per_page: '20',
    });
    expect(result).toEqual({
      items: [{ id: 7, title: 'Timebanking basics', slug: 'basics' }],
      page: 2,
      total: 13,
      hasMore: false,
    });
  });

  it('unwraps detail, learning and progress envelopes without inventing fields', async () => {
    (api.get as jest.Mock)
      .mockResolvedValueOnce({ data: { id: 7, title: 'Timebanking basics' } })
      .mockResolvedValueOnce({ data: [{ id: 4, course_id: 7, progress_percent: 25 }] })
      .mockResolvedValueOnce({ data: { enrollment: { id: 4 }, lessons: [], availability: [] } });

    await expect(getCourse('basics')).resolves.toMatchObject({ id: 7 });
    await expect(getMyCourses()).resolves.toHaveLength(1);
    await expect(getCourseProgress(7)).resolves.toMatchObject({ enrollment: { id: 4 } });
  });

  it('uses the authenticated enrolment and completion contracts', async () => {
    (api.post as jest.Mock)
      .mockResolvedValueOnce({ data: { id: 4, course_id: 7, status: 'active' } })
      .mockResolvedValueOnce({ data: { progress_percent: 50, course_completed: false } });

    await expect(enrollInCourse(7)).resolves.toMatchObject({ id: 4 });
    await expect(completeCourseLesson(7, 12)).resolves.toEqual({ progress_percent: 50, course_completed: false });
    expect(api.post).toHaveBeenNthCalledWith(1, '/api/v2/courses/7/enroll', {});
    expect(api.post).toHaveBeenNthCalledWith(2, '/api/v2/courses/7/lessons/12/complete', { watch_percent: 100 });
  });

  describe('authoring', () => {
    it('reads the category list and the caller\'s own courses from their own endpoints', async () => {
      (api.get as jest.Mock)
        .mockResolvedValueOnce({ data: [{ id: 3, name: 'Wellbeing', slug: 'wellbeing' }] })
        .mockResolvedValueOnce({ data: [{ id: 7, title: 'Timebanking basics', status: 'draft' }] });

      await expect(getCourseCategories()).resolves.toEqual([{ id: 3, name: 'Wellbeing', slug: 'wellbeing' }]);
      await expect(getAuthoredCourses()).resolves.toEqual([{ id: 7, title: 'Timebanking basics', status: 'draft' }]);

      // `/mine` is NOT the browse endpoint with a filter — it is a separate route that
      // returns drafts and unapproved courses the catalogue deliberately hides.
      expect(api.get).toHaveBeenNthCalledWith(1, '/api/v2/courses/categories');
      expect(api.get).toHaveBeenNthCalledWith(2, '/api/v2/courses/mine');
    });

    it('creates and updates a course on the endpoints CourseService accepts', async () => {
      (api.post as jest.Mock).mockResolvedValueOnce({ data: { id: 42, title: 'Repair skills', status: 'draft' } });
      (api.put as jest.Mock).mockResolvedValueOnce({ data: { id: 42, title: 'Repair skills II' } });

      const payload = {
        title: 'Repair skills',
        summary: 'Fix things together',
        description: 'A longer description.',
        level: 'beginner' as const,
        visibility: 'members' as const,
        enrollment_type: 'self_paced' as const,
        category_id: 3,
        credit_cost: 2,
        prerequisites: [7],
      };

      await expect(createCourse(payload)).resolves.toMatchObject({ id: 42 });
      await expect(updateCourse(42, { ...payload, title: 'Repair skills II' })).resolves.toMatchObject({ id: 42 });

      expect(api.post).toHaveBeenCalledWith('/api/v2/courses', payload);
      expect(api.put).toHaveBeenCalledWith('/api/v2/courses/42', { ...payload, title: 'Repair skills II' });
    });

    it('publishes and unpublishes with an empty body', async () => {
      (api.post as jest.Mock)
        .mockResolvedValueOnce({ data: { id: 42, status: 'published', moderation_status: 'approved' } })
        .mockResolvedValueOnce({ data: { id: 42, status: 'draft', moderation_status: 'pending' } });

      await expect(publishCourse(42)).resolves.toMatchObject({ status: 'published' });
      await expect(unpublishCourse(42)).resolves.toMatchObject({ status: 'draft' });

      expect(api.post).toHaveBeenNthCalledWith(1, '/api/v2/courses/42/publish', {});
      expect(api.post).toHaveBeenNthCalledWith(2, '/api/v2/courses/42/unpublish', {});
    });

    it('addresses sections and lessons under their own course, never a bare id', async () => {
      (api.post as jest.Mock)
        .mockResolvedValueOnce({ data: { id: 5, course_id: 42, title: 'Week one', position: 0 } })
        .mockResolvedValueOnce({ data: { id: 90, course_id: 42, section_id: 5, title: 'New lesson' } });
      (api.put as jest.Mock)
        .mockResolvedValueOnce({ data: { id: 5, title: 'Week two' } })
        .mockResolvedValueOnce({ data: { id: 90, position: 1 } });
      (api.delete as jest.Mock)
        .mockResolvedValueOnce({ data: { deleted: true } })
        .mockResolvedValueOnce({ data: { deleted: true } });

      await createCourseSection(42, { title: 'Week one', position: 0 });
      await createCourseLesson(42, { section_id: 5, title: 'New lesson', content_type: 'text', position: 0 });
      await updateCourseSection(42, 5, { title: 'Week two' });
      await updateCourseLesson(42, 90, { position: 1 });
      await expect(deleteCourseSection(42, 5)).resolves.toEqual({ deleted: true });
      await expect(deleteCourseLesson(42, 90)).resolves.toEqual({ deleted: true });

      expect(api.post).toHaveBeenNthCalledWith(1, '/api/v2/courses/42/sections', { title: 'Week one', position: 0 });
      expect(api.post).toHaveBeenNthCalledWith(2, '/api/v2/courses/42/lessons', {
        section_id: 5, title: 'New lesson', content_type: 'text', position: 0,
      });
      expect(api.put).toHaveBeenNthCalledWith(1, '/api/v2/courses/42/sections/5', { title: 'Week two' });
      expect(api.put).toHaveBeenNthCalledWith(2, '/api/v2/courses/42/lessons/90', { position: 1 });
      expect(api.delete).toHaveBeenNthCalledWith(1, '/api/v2/courses/42/sections/5');
      expect(api.delete).toHaveBeenNthCalledWith(2, '/api/v2/courses/42/lessons/90');
    });

    it('creates a quiz for a lesson and hangs a question off that quiz', async () => {
      (api.post as jest.Mock)
        .mockResolvedValueOnce({ data: { id: 11, course_id: 42, lesson_id: 90, title: 'Quiz' } })
        .mockResolvedValueOnce({ data: { id: 501, type: 'mcq', prompt: 'How many hours?' } });

      await createCourseQuiz(42, { lesson_id: 90, title: 'Quiz', pass_mark_percent: 70, max_attempts: 0 });
      await createQuizQuestion(42, 11, {
        type: 'mcq',
        prompt: 'How many hours?',
        options: [{ id: 'a', label: 'One' }, { id: 'b', label: 'Two' }],
        correct: ['a'],
        points: 1,
        position: 1,
      });

      expect(api.post).toHaveBeenNthCalledWith(1, '/api/v2/courses/42/quizzes', {
        lesson_id: 90, title: 'Quiz', pass_mark_percent: 70, max_attempts: 0,
      });
      expect(api.post).toHaveBeenNthCalledWith(2, '/api/v2/courses/42/quizzes/11/questions', {
        type: 'mcq',
        prompt: 'How many hours?',
        options: [{ id: 'a', label: 'One' }, { id: 'b', label: 'Two' }],
        correct: ['a'],
        points: 1,
        position: 1,
      });
    });

    it('lists and creates cohorts for a course', async () => {
      (api.get as jest.Mock).mockResolvedValueOnce({ data: [{ id: 8, course_id: 42, name: 'Autumn' }] });
      (api.post as jest.Mock).mockResolvedValueOnce({ data: { id: 9, course_id: 42, name: 'Winter' } });

      await expect(getCourseCohorts(42)).resolves.toEqual([{ id: 8, course_id: 42, name: 'Autumn' }]);
      await expect(createCourseCohort(42, { name: 'Winter' })).resolves.toMatchObject({ id: 9 });

      expect(api.get).toHaveBeenCalledWith('/api/v2/courses/42/cohorts');
      expect(api.post).toHaveBeenCalledWith('/api/v2/courses/42/cohorts', { name: 'Winter' });
    });

    it('reads the grading queue from the course it belongs to', async () => {
      (api.get as jest.Mock).mockResolvedValueOnce({
        data: [{
          id: 900,
          quiz_id: 11,
          user_id: 77,
          grading_status: 'pending_review',
          answers: { '501': 'An essay answer.' },
          quiz: { id: 11, title: 'End of course quiz', questions: [{ id: 501, type: 'essay', prompt: 'Why?' }] },
          user: { id: 77, name: 'Maura Byrne' },
        }],
      });

      await expect(getCourseGradingQueue(42)).resolves.toMatchObject([{ id: 900, grading_status: 'pending_review' }]);
      expect(api.get).toHaveBeenCalledWith('/api/v2/courses/42/grading');
    });

    it('grades by ATTEMPT id, with the exact body CourseQuizController reads', async () => {
      (api.post as jest.Mock).mockResolvedValueOnce({ data: { id: 900, grading_status: 'graded', score_percent: 85 } });

      await expect(gradeCourseAttempt(900, { score_percent: 85, passed: true, feedback: 'Well argued.' }))
        .resolves.toMatchObject({ grading_status: 'graded' });

      // The route is /courses/attempts/{attemptId}/grade — the course is NOT in the path;
      // the server resolves the owning course from the attempt and authorises against it.
      expect(api.post).toHaveBeenCalledWith('/api/v2/courses/attempts/900/grade', {
        score_percent: 85, passed: true, feedback: 'Well argued.',
      });
    });

    it('reads per-course analytics without reshaping the server figures', async () => {
      (api.get as jest.Mock).mockResolvedValueOnce({
        data: {
          course: { id: 42, title: 'Repair skills' },
          enrollments: { total: 20, active: 12, completed: 5, dropped: 3 },
          completion_rate: 25,
          avg_progress: 61.5,
          avg_quiz_score: 78.2,
          quiz_attempts: 31,
          per_lesson: [{ lesson_id: 90, title: 'Taking things apart', completed: 18 }],
        },
      });

      await expect(getCourseAnalytics(42)).resolves.toEqual({
        course: { id: 42, title: 'Repair skills' },
        enrollments: { total: 20, active: 12, completed: 5, dropped: 3 },
        completion_rate: 25,
        avg_progress: 61.5,
        avg_quiz_score: 78.2,
        quiz_attempts: 31,
        per_lesson: [{ lesson_id: 90, title: 'Taking things apart', completed: 18 }],
      });
      expect(api.get).toHaveBeenCalledWith('/api/v2/courses/42/analytics');
    });

    it('returns a bare payload unchanged when the API does not wrap it', async () => {
      (api.get as jest.Mock).mockResolvedValueOnce([{ id: 3, name: 'Wellbeing', slug: 'wellbeing' }]);

      await expect(getCourseCategories()).resolves.toEqual([{ id: 3, name: 'Wellbeing', slug: 'wellbeing' }]);
    });
  });
});
