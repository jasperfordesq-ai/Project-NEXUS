// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockShow = jest.fn();
jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(), useLocalSearchParams: () => ({ id: '7' }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => ({ 'player.mark_complete': 'Mark as complete', 'player.completed': 'Completed', 'player.lesson_completed': 'Lesson completed', 'player.action_failed': "Couldn't save your progress. Please try again.", 'player.course_progress': 'Course progress', 'player.transcript': 'Transcript', 'detail.no_lessons': 'No lessons have been added yet.', 'common:buttons.retry': 'Retry', 'common:back': 'Back' } as Record<string, string>)[key] ?? key }) }));
jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }), usePrimaryColor: () => '#06f' }));
jest.mock('@/lib/hooks/useTheme', () => ({ useTheme: () => ({ text: '#111', textSecondary: '#555', border: '#ddd' }) }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/AppToast', () => ({ useAppToast: () => ({ show: mockShow }) }));
jest.mock('@/lib/api/courses', () => ({ getCourse: jest.fn(), getCourseProgress: jest.fn(), completeCourseLesson: jest.fn() }));

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
    await waitFor(() => expect(completeCourseLesson).toHaveBeenCalledWith(7, 12));
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

  it('offers a retry when the course could not be loaded, instead of a dead end', async () => {
    jest.mocked(getCourse).mockRejectedValue(new ApiResponseError(404, 'That course could not be found.'));
    jest.mocked(getCourseProgress).mockRejectedValue(new ApiResponseError(404, 'That course could not be found.'));

    const { getByText } = render(<CoursePlayerScreen />);

    await waitFor(() => expect(getByText('That course could not be found.')).toBeTruthy());
    expect(getByText('Retry')).toBeTruthy();
    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(jest.mocked(getCourse).mock.calls.length).toBeGreaterThan(1));
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
});
