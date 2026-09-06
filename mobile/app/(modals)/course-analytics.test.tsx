// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetCourseAnalytics = jest.fn();
let mockParams: { id?: string } = { id: '42' };

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));

// Resolve against the SHIPPED English copy, so a renamed or missing key fails the test
// rather than being papered over by a hand-written stub map.
jest.mock('react-i18next', () => {
  const courses = require('../../locales/en/courses.json');
  const common = require('../../locales/en/common.json');
  const dig = (source: Record<string, unknown>, key: string): unknown =>
    key.split('.').reduce<unknown>(
      (value, part) => (value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined),
      source,
    );
  return {
    useTranslation: () => ({
      t: (key: string) => {
        const isCommon = key.startsWith('common:');
        const resolved = dig(isCommon ? common : courses, isCommon ? key.slice('common:'.length) : key);
        return typeof resolved === 'string' ? resolved : key;
      },
      i18n: { language: 'en' },
    }),
  };
});

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff', surface: '#f8fafc', text: '#000000', textSecondary: '#666666',
    textMuted: '#999999', border: '#dddddd', borderSubtle: '#eeeeee', error: '#dc2626',
  }),
}));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/lib/api/courses', () => ({
  getCourseAnalytics: (...args: unknown[]) => mockGetCourseAnalytics(...args),
}));

import CourseAnalyticsRoute from './course-analytics';
import { ApiResponseError } from '@/lib/api/client';

const analytics = {
  course: { id: 42, title: 'Repair skills' },
  enrollments: { total: 20, active: 12, completed: 5, dropped: 3 },
  completion_rate: 25,
  avg_progress: 61.5,
  avg_quiz_score: 78.2,
  quiz_attempts: 31,
  per_lesson: [
    { lesson_id: 90, title: 'Taking things apart', completed: 18 },
    { lesson_id: 91, title: 'Soldering safely', completed: 4 },
  ],
};

describe('CourseAnalyticsRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { id: '42' };
    mockGetCourseAnalytics.mockResolvedValue(analytics);
  });

  it('reads analytics for the course in the URL', async () => {
    render(<CourseAnalyticsRoute />);

    await waitFor(() => expect(mockGetCourseAnalytics).toHaveBeenCalledWith(42));
  });

  it('shows the course title and every headline figure the web page shows', async () => {
    const { getByText } = render(<CourseAnalyticsRoute />);

    await waitFor(() => expect(getByText('Repair skills')).toBeTruthy());
    expect(getByText('20')).toBeTruthy();
    expect(getByText('12')).toBeTruthy();
    expect(getByText('5')).toBeTruthy();
    expect(getByText('25%')).toBeTruthy();
    expect(getByText('61.5%')).toBeTruthy();
    expect(getByText('78.2%')).toBeTruthy();
    expect(getByText('Enrollments')).toBeTruthy();
    expect(getByText('Active')).toBeTruthy();
    expect(getByText('Completed')).toBeTruthy();
    expect(getByText('Completion rate')).toBeTruthy();
    expect(getByText('Avg progress')).toBeTruthy();
    expect(getByText('Avg quiz score')).toBeTruthy();
  });

  it('lists every lesson with its completion count', async () => {
    const { getByText } = render(<CourseAnalyticsRoute />);

    await waitFor(() => expect(getByText('Lesson completion')).toBeTruthy());
    expect(getByText('Taking things apart')).toBeTruthy();
    expect(getByText('18')).toBeTruthy();
    expect(getByText('Soldering safely')).toBeTruthy();
    expect(getByText('4')).toBeTruthy();
  });

  it('says so when a course has no lessons to chart', async () => {
    mockGetCourseAnalytics.mockResolvedValue({ ...analytics, per_lesson: [] });

    const { getByText } = render(<CourseAnalyticsRoute />);

    await waitFor(() => expect(getByText('No lessons to chart yet.')).toBeTruthy());
  });

  it('shows the unavailable notice rather than a page of zeroes when nothing comes back', async () => {
    mockGetCourseAnalytics.mockResolvedValue(null);

    const { getByText, queryByText } = render(<CourseAnalyticsRoute />);

    await waitFor(() => expect(getByText('Analytics are not available for this course.')).toBeTruthy());
    expect(queryByText('Completion rate')).toBeNull();
  });

  it('shows the unavailable notice, and asks the server for nothing, without a course id', async () => {
    mockParams = {};

    const { getByText } = render(<CourseAnalyticsRoute />);

    await waitFor(() => expect(getByText('Analytics are not available for this course.')).toBeTruthy());
    expect(mockGetCourseAnalytics).not.toHaveBeenCalled();
  });

  it('offers a retry when analytics fail to load', async () => {
    // A 403 is deliberately NOT one of `useApi`'s retryable statuses, so the failure
    // surfaces immediately instead of after its 2s single-retry timer.
    mockGetCourseAnalytics.mockRejectedValue(new ApiResponseError(403, 'Only the author can see this.'));

    const { getByText } = render(<CourseAnalyticsRoute />);

    await waitFor(() => expect(getByText('Only the author can see this.')).toBeTruthy());
    mockGetCourseAnalytics.mockResolvedValue(analytics);
    fireEvent.press(getByText('Retry'));

    await waitFor(() => expect(getByText('Repair skills')).toBeTruthy());
  });
});
