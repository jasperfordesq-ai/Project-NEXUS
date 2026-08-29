// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockShow = jest.fn();
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ id: '7' }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => ({ 'player.mark_complete': 'Mark as complete', 'player.completed': 'Completed', 'player.lesson_completed': 'Lesson completed', 'player.action_failed': "Couldn't save your progress. Please try again.", 'player.course_progress': 'Course progress', 'player.transcript': 'Transcript', 'common:back': 'Back' } as Record<string, string>)[key] ?? key }) }));
jest.mock('@/lib/hooks/useTenant', () => ({ usePrimaryColor: () => '#06f' }));
jest.mock('@/lib/hooks/useTheme', () => ({ useTheme: () => ({ text: '#111', textSecondary: '#555', border: '#ddd' }) }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/AppToast', () => ({ useAppToast: () => ({ show: mockShow }) }));
jest.mock('@/lib/api/courses', () => ({ getCourse: jest.fn(), getCourseProgress: jest.fn(), completeCourseLesson: jest.fn() }));

import CoursePlayerScreen from './course-player';
import { completeCourseLesson, getCourse, getCourseProgress } from '@/lib/api/courses';

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
});
