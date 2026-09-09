// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockShow = jest.fn();
jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(), useLocalSearchParams: () => ({ id: '7' }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => ({ 'player.mark_complete': 'Mark as complete', 'player.completed': 'Completed', 'player.lesson_completed': 'Lesson completed', 'player.action_failed': "Couldn't save your progress. Please try again.", 'player.course_progress': 'Course progress', 'player.transcript': 'Transcript', 'detail.no_lessons': 'No lessons have been added yet.', 'player.locked': "This lesson isn't available yet.", 'player.locked_until': 'Available from {{date}}', 'player.progress_unavailable': 'We could not load your progress for this course.', 'player.resumed': 'Picked up where you left off', 'player.start_from_beginning': 'Start from the beginning', 'player.next_lesson': 'Next lesson', 'player.prev_lesson': 'Previous lesson', 'player.watched': 'Watched {{percent}}%', 'player.video_unavailable': 'No video has been added to this lesson yet.', 'common:buttons.retry': 'Retry', 'common:back': 'Back' } as Record<string, string>)[key] ?? key }) }));
jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }), usePrimaryColor: () => '#06f' }));
jest.mock('@/lib/hooks/useTheme', () => ({ useTheme: () => ({ text: '#111', textSecondary: '#555', border: '#ddd', error: '#b00', errorBg: '#fee', success: '#070', successBg: '#efe', warning: '#a40' }) }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/AppToast', () => ({ useAppToast: () => ({ show: mockShow }) }));
jest.mock('expo-av', () => ({ ResizeMode: { CONTAIN: 'contain' }, Video: 'Video' }));
jest.mock('@/components/ui/Icon', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/lib/api/courses', () => ({ getCourse: jest.fn(), getCourseProgress: jest.fn(), completeCourseLesson: jest.fn(), getCourseQuiz: jest.fn(), submitCourseQuizAttempt: jest.fn() }));

import CoursePlayerScreen from './course-player';
import { completeCourseLesson, getCourse, getCourseProgress } from '@/lib/api/courses';
import { ApiResponseError } from '@/lib/api/client';

describe('CoursePlayerScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getCourse).mockResolvedValue({ id: 7, slug: 'basics', title: 'Timebanking basics', level: 'beginner', credit_cost: 0, enrollment_count: 1, sections: [{ id: 2, course_id: 7, title: 'Start', position: 1, lessons: [{ id: 12, course_id: 7, section_id: 2, title: 'Your first exchange', content_type: 'text', body: 'Offer one useful skill.', transcript: null, position: 1, is_preview: false }] }] });
    jest.mocked(getCourseProgress).mockResolvedValue({ enrollment: { id: 3, course_id: 7, status: 'active', progress_percent: 0 }, lessons: [], availability: [{ lesson_id: 12, available: true, unlock_at: null }] });
    jest.mocked(completeCourseLesson).mockResolvedValue({ progress_percent: 100, course_completed: true });
  });

  it('shows lesson content and saves completion before changing the UI', async () => {
    const { getByText } = render(<CoursePlayerScreen />);
    await waitFor(() => expect(getByText('Offer one useful skill.')).toBeTruthy());
    fireEvent.press(getByText('Mark as complete'));
    await waitFor(() => expect(completeCourseLesson).toHaveBeenCalledWith(7, 12, 100));
    expect(getByText('Completed')).toBeTruthy();
  });
  it('tells the member why the lesson could not be marked complete', async () => {
    // 🔴 The reason was discarded: every failure read "please try again", including ones
    // where trying again cannot work (audit 2026-09-06).
    jest.mocked(completeCourseLesson).mockRejectedValue(new ApiResponseError(409, 'Finish the previous lesson first.'));

    const { getByText } = render(<CoursePlayerScreen />);
    await waitFor(() => expect(getByText('Offer one useful skill.')).toBeTruthy());
    fireEvent.press(getByText('Mark as complete'));

    await waitFor(() => expect(mockShow).toHaveBeenCalledWith(expect.objectContaining({
      description: 'Finish the previous lesson first.',
      variant: 'danger',
    })));
    // The lesson must not look complete when the server refused.
    expect(getByText('Mark as complete')).toBeTruthy();
  });

  /**
   * 🔴 This case pressed Retry after a 404 and asserted the course was fetched again. It
   * passed, and it was pinning the fault: a course that was taken down, or one this member
   * is not enrolled on, answers 404 every time. The button could never work. It now asserts
   * the refusal is named as one, with the retry case moved to a genuine failure below.
   */
  it('says a course that is gone or not yours is unavailable, with no dead Retry', async () => {
    jest.mocked(getCourse).mockRejectedValue(new ApiResponseError(404, 'That course could not be found.'));
    jest.mocked(getCourseProgress).mockRejectedValue(new ApiResponseError(404, 'That course could not be found.'));

    const { findByText, queryByText } = render(<CoursePlayerScreen />);

    expect(await findByText('common:errors.notAvailableHint')).toBeTruthy();
    expect(queryByText('Retry')).toBeNull();
  });

  it('offers a retry when the course genuinely failed to load, instead of a dead end', async () => {
    jest.mocked(getCourse).mockRejectedValue(new ApiResponseError(500, 'Something went wrong.'));
    jest.mocked(getCourseProgress).mockRejectedValue(new ApiResponseError(500, 'Something went wrong.'));

    const { getByText } = render(<CoursePlayerScreen />);

    // useApi retries a 5xx once after 2s before surfacing it.
    await waitFor(() => expect(getByText('Something went wrong.')).toBeTruthy(), { timeout: 6000 });
    expect(getByText('Retry')).toBeTruthy();
    const before = jest.mocked(getCourse).mock.calls.length;
    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(jest.mocked(getCourse).mock.calls.length).toBeGreaterThan(before));
  });

  /*
    🔴 Four regressions from the 2026-09-06 audit (F03, F04). Each asserts on what the
    LEARNER is given, because the previous behaviour was not a crash or a visible error -
    the screen looked fine and was wrong about what it was telling them.
  */

  const videoLesson = {
    id: 12,
    course_id: 7,
    section_id: 2,
    title: 'Your first exchange',
    content_type: 'video' as const,
    body: null,
    transcript: null,
    video_url: 'https://media.example.org/lesson.mp4',
    position: 1,
    is_preview: false,
  };

  function courseWithLesson(lesson: Record<string, unknown>) {
    return {
      id: 7,
      slug: 'basics',
      title: 'Timebanking basics',
      level: 'beginner' as const,
      credit_cost: 0,
      enrollment_count: 1,
      sections: [{ id: 2, course_id: 7, title: 'Start', position: 1, lessons: [lesson] }],
    };
  }

  it('plays a video lesson instead of showing a bare title and a completion button', async () => {
    // A video lesson used to render `body` and `transcript` only. With neither set - the
    // ordinary case for a video - the learner got the title, a "Mark as complete" button
    // and no content at all. Four of the five declared lesson types behaved this way.
    jest.mocked(getCourse).mockResolvedValue(courseWithLesson(videoLesson) as never);

    const { getByTestId } = render(<CoursePlayerScreen />);

    await waitFor(() => expect(getByTestId('lesson-video')).toBeTruthy());
    expect(getByTestId('lesson-video').props.source).toEqual({
      uri: 'https://media.example.org/lesson.mp4',
    });
  });

  it('reports what was actually watched, not a flat 100%', async () => {
    // The completion call hardcoded `watch_percent: 100` for every lesson, and the server
    // persists whatever it is sent - so an instructor's analytics read "fully watched" for
    // a video nobody had opened.
    jest.mocked(getCourse).mockResolvedValue(courseWithLesson(videoLesson) as never);

    const { getByTestId, getByText } = render(<CoursePlayerScreen />);
    await waitFor(() => expect(getByTestId('lesson-video')).toBeTruthy());

    await act(async () => {
      getByTestId('lesson-video').props.onPlaybackStatusUpdate({
        isLoaded: true,
        positionMillis: 30_000,
        durationMillis: 120_000,
      });
    });

    fireEvent.press(getByText('Mark as complete'));
    await waitFor(() => expect(completeCourseLesson).toHaveBeenCalledWith(7, 12, 25));
  });

  it('shows a locked lesson as locked instead of offering a button the server will refuse', async () => {
    // `availability` has always been in the progress response and the screen threw it away,
    // so a drip-locked lesson offered normal navigation and a completion action that came
    // back LESSON_LOCKED.
    jest.mocked(getCourseProgress).mockResolvedValue({
      enrollment: { id: 3, course_id: 7, status: 'active', progress_percent: 0 },
      lessons: [],
      availability: [{ lesson_id: 12, available: false, unlock_at: '2026-12-01T09:00:00Z' }],
    } as never);

    const { getByTestId, queryByText } = render(<CoursePlayerScreen />);

    await waitFor(() => expect(getByTestId('lesson-locked')).toBeTruthy());
    expect(queryByText('Mark as complete')).toBeNull();
    expect(queryByText('Offer one useful skill.')).toBeNull();
  });

  it('says progress could not be loaded rather than presenting it as zero', async () => {
    // The course loaded and only progress failed, so `lesson` was truthy and the whole
    // error branch was skipped: the screen showed 0% and no ticks as if that were the
    // member's real standing. Unavailable progress is not zero progress.
    // 404 deliberately, not 500: `useApi` retries 5xx, so a 500 would still be retrying
    // when the assertion runs. 404 is also the real shape here - the progress endpoint
    // answers NOT_ENROLLED with 404.
    jest.mocked(getCourseProgress).mockRejectedValue(
      new ApiResponseError(404, 'Progress is unavailable.'),
    );

    const { getByTestId, queryByLabelText } = render(<CoursePlayerScreen />);

    await waitFor(() => expect(getByTestId('course-progress-error')).toBeTruthy());
    expect(queryByLabelText('Course progress')).toBeNull();
  });

  it('shows a real progress bar when the server sends the percentage as a string', async () => {
    // `progress_percent` is typed `string | number`; an unparseable one made the bar NaN% wide.
    jest.mocked(getCourseProgress).mockResolvedValue({
      enrollment: { id: 3, course_id: 7, status: 'active', progress_percent: 'not a number' as unknown as number },
      lessons: [],
      availability: [{ lesson_id: 12, available: true, unlock_at: null }],
    });

    const { getByLabelText } = render(<CoursePlayerScreen />);

    await waitFor(() => expect(getByLabelText('Course progress').props.accessibilityValue.now).toBe(0));
  });
  it('🔴 does not report a video nobody played as watched', async () => {
    /*
      The watch figure reset to 100 for EVERY lesson type, and the player only reports a
      real figure once playback starts. So a learner who opened a video lesson, never
      pressed play, and tapped "Mark as complete" was recorded in the instructor’s
      analytics as having watched all of it. Found by the 2026-09-07 audit (G/F-5).
    */
    jest.mocked(getCourse).mockResolvedValue({
      id: 7,
      slug: 'basics',
      title: 'Timebanking basics',
      level: 'beginner',
      credit_cost: 0,
      enrollment_count: 1,
      sections: [{
        id: 2,
        course_id: 7,
        title: 'Start',
        position: 1,
        lessons: [{
          id: 12,
          course_id: 7,
          section_id: 2,
          title: 'Watch this first',
          content_type: 'video',
          body: null,
          video_url: 'https://example.org/lesson.mp4',
          transcript: null,
          position: 1,
          is_preview: false,
        }],
      }],
    } as never);

    const { getByText } = render(<CoursePlayerScreen />);
    await waitFor(() => expect(getByText('Mark as complete')).toBeTruthy());

    fireEvent.press(getByText('Mark as complete'));

    await waitFor(() => expect(completeCourseLesson).toHaveBeenCalledWith(7, 12, 0));
  });

  /**
   * 🔴 The player always opened at lesson one. A learner eleven lessons in reopened the
   * course and was put back at the beginning every single time, with nothing to say the app
   * knew better — while `GET /v2/courses/{id}/progress` had been returning exactly which
   * lessons were finished all along.
   */
  describe('picking up where the learner left off', () => {
    const threeLessons = {
      id: 7,
      slug: 'basics',
      title: 'Timebanking basics',
      level: 'beginner' as const,
      credit_cost: 0,
      enrollment_count: 1,
      sections: [{
        id: 2,
        course_id: 7,
        title: 'Start',
        position: 1,
        lessons: [
          { id: 11, course_id: 7, section_id: 2, title: 'One', content_type: 'text', body: 'Lesson one body.', transcript: null, position: 1, is_preview: false },
          { id: 12, course_id: 7, section_id: 2, title: 'Two', content_type: 'text', body: 'Lesson two body.', transcript: null, position: 2, is_preview: false },
          { id: 13, course_id: 7, section_id: 2, title: 'Three', content_type: 'text', body: 'Lesson three body.', transcript: null, position: 3, is_preview: false },
        ],
      }],
    };

    function progressWith(completedIds: number[], availability?: { lesson_id: number; available: boolean; unlock_at: null }[]) {
      return {
        enrollment: { id: 3, course_id: 7, status: 'active', progress_percent: 33 },
        lessons: completedIds.map((lesson_id) => ({ lesson_id, status: 'completed' })),
        availability: availability ?? [11, 12, 13].map((lesson_id) => ({ lesson_id, available: true, unlock_at: null })),
      };
    }

    it('opens at the first lesson that is not finished, and says so', async () => {
      jest.mocked(getCourse).mockResolvedValue(threeLessons as never);
      jest.mocked(getCourseProgress).mockResolvedValue(progressWith([11]) as never);

      const { findByText, getByTestId } = render(<CoursePlayerScreen />);

      expect(await findByText('Lesson two body.')).toBeTruthy();
      expect(getByTestId('course-player-resumed')).toBeTruthy();
    });

    it('stays on lesson one for a learner who has finished nothing, and says nothing', async () => {
      jest.mocked(getCourse).mockResolvedValue(threeLessons as never);
      jest.mocked(getCourseProgress).mockResolvedValue(progressWith([]) as never);

      const { findByText, queryByTestId } = render(<CoursePlayerScreen />);

      expect(await findByText('Lesson one body.')).toBeTruthy();
      expect(queryByTestId('course-player-resumed')).toBeNull();
    });

    it('lands on the last lesson when every one of them is finished', async () => {
      jest.mocked(getCourse).mockResolvedValue(threeLessons as never);
      jest.mocked(getCourseProgress).mockResolvedValue(progressWith([11, 12, 13]) as never);

      const { findByText } = render(<CoursePlayerScreen />);

      expect(await findByText('Lesson three body.')).toBeTruthy();
    });

    /** A locked lesson is not somewhere to land: the drip gate would refuse it anyway. */
    it('does not drop the learner on a lesson the drip schedule has not unlocked', async () => {
      jest.mocked(getCourse).mockResolvedValue(threeLessons as never);
      jest.mocked(getCourseProgress).mockResolvedValue(progressWith([11], [
        { lesson_id: 11, available: true, unlock_at: null },
        { lesson_id: 12, available: false, unlock_at: null },
        { lesson_id: 13, available: true, unlock_at: null },
      ]) as never);

      const { findByText } = render(<CoursePlayerScreen />);

      expect(await findByText('Lesson three body.')).toBeTruthy();
    });

    it('lets the learner go back to the beginning without being dragged forward again', async () => {
      jest.mocked(getCourse).mockResolvedValue(threeLessons as never);
      jest.mocked(getCourseProgress).mockResolvedValue(progressWith([11]) as never);

      const { findByText, getByText, queryByTestId } = render(<CoursePlayerScreen />);
      await findByText('Lesson two body.');

      fireEvent.press(getByText('Start from the beginning'));

      expect(await findByText('Lesson one body.')).toBeTruthy();
      expect(queryByTestId('course-player-resumed')).toBeNull();
    });
  });
});
