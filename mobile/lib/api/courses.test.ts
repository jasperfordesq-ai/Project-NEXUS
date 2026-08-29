// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { api } from '@/lib/api/client';
import {
  completeCourseLesson,
  enrollInCourse,
  getCourse,
  getCourseProgress,
  getCourses,
  getMyCourses,
} from './courses';

jest.mock('@/lib/api/client', () => ({
  api: {
    get: jest.fn(),
    post: jest.fn(),
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
});
