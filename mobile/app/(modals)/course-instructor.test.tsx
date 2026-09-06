// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetAuthoredCourses = jest.fn();
const mockPublishCourse = jest.fn();
const mockUnpublishCourse = jest.fn();
const mockPush = jest.fn();
const mockShowToast = jest.fn();

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: (...args: unknown[]) => mockPush(...args), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
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
    textMuted: '#999999', border: '#dddddd', error: '#dc2626',
  }),
}));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn((...args: unknown[]) => mockShowToast(...args));
  return { useAppToast: () => ({ show, hide: jest.fn(), isToastVisible: false }) };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/lib/api/courses', () => ({
  getAuthoredCourses: (...args: unknown[]) => mockGetAuthoredCourses(...args),
  publishCourse: (...args: unknown[]) => mockPublishCourse(...args),
  unpublishCourse: (...args: unknown[]) => mockUnpublishCourse(...args),
}));

import CourseInstructorRoute from './course-instructor';
import { ApiResponseError } from '@/lib/api/client';

const draft = {
  id: 42, title: 'Repair skills', slug: 'repair-skills', level: 'beginner', credit_cost: 0,
  enrollment_count: 5, completion_count: 2, status: 'draft', moderation_status: 'pending',
};
const published = { ...draft, id: 43, title: 'Timebanking basics', status: 'published', moderation_status: 'approved' };

describe('CourseInstructorRoute', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockShowToast.mockClear();
    mockGetAuthoredCourses.mockResolvedValue([draft]);
  });

  it('lists the courses the member authored, with status and real enrolment counts', async () => {
    mockGetAuthoredCourses.mockResolvedValue([draft, published]);

    const { getAllByText, getByText } = render(<CourseInstructorRoute />);

    await waitFor(() => expect(getByText('Repair skills')).toBeTruthy());
    expect(getByText('Timebanking basics')).toBeTruthy();
    expect(getByText('Draft')).toBeTruthy();
    expect(getByText('Published')).toBeTruthy();
    expect(getAllByText('Enrollments: 5 · Completions: 2')).toHaveLength(2);
  });

  it('shows "pending review" for a course awaiting moderation, not "published"', async () => {
    mockGetAuthoredCourses.mockResolvedValue([{ ...draft, status: 'published', moderation_status: 'pending' }]);

    const { getByText, queryByText } = render(<CourseInstructorRoute />);

    await waitFor(() => expect(getByText('Pending review')).toBeTruthy());
    expect(queryByText('Published')).toBeNull();
  });

  it('publishes a draft and reloads the list', async () => {
    mockPublishCourse.mockResolvedValue({ ...draft, status: 'published', moderation_status: 'approved' });

    const { getByText } = render(<CourseInstructorRoute />);
    await waitFor(() => expect(getByText('Repair skills')).toBeTruthy());

    fireEvent.press(getByText('Publish'));

    await waitFor(() => expect(mockPublishCourse).toHaveBeenCalledWith(42));
    expect(mockUnpublishCourse).not.toHaveBeenCalled();
    await waitFor(() => expect(mockGetAuthoredCourses).toHaveBeenCalledTimes(2));
    expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Course published — it is now visible to members.',
      variant: 'success',
    }));
  });

  it('unpublishes a published course', async () => {
    mockGetAuthoredCourses.mockResolvedValue([published]);
    mockUnpublishCourse.mockResolvedValue({ ...published, status: 'draft', moderation_status: 'pending' });

    const { getByText } = render(<CourseInstructorRoute />);
    await waitFor(() => expect(getByText('Timebanking basics')).toBeTruthy());

    fireEvent.press(getByText('Unpublish'));

    await waitFor(() => expect(mockUnpublishCourse).toHaveBeenCalledWith(43));
    expect(mockPublishCourse).not.toHaveBeenCalled();
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Course unpublished — back to draft.',
      variant: 'success',
    })));
    await waitFor(() => expect(mockGetAuthoredCourses).toHaveBeenCalledTimes(2));
  });

  it('tells the member why a publish was refused instead of silently doing nothing', async () => {
    mockPublishCourse.mockRejectedValue(new ApiResponseError(422, 'Add at least one lesson first.'));

    const { getByText } = render(<CourseInstructorRoute />);
    await waitFor(() => expect(getByText('Repair skills')).toBeTruthy());

    fireEvent.press(getByText('Publish'));

    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Could not save. Please try again.',
      description: 'Add at least one lesson first.',
      variant: 'danger',
    })));
  });

  it('opens the editor for a course, carrying its id', async () => {
    const { getByText } = render(<CourseInstructorRoute />);
    await waitFor(() => expect(getByText('Repair skills')).toBeTruthy());

    fireEvent.press(getByText('Edit course'));

    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(modals)/new-course', params: { id: '42' } });
  });

  it('opens the grading queue for a course, carrying its id', async () => {
    const { getByText } = render(<CourseInstructorRoute />);
    await waitFor(() => expect(getByText('Repair skills')).toBeTruthy());

    fireEvent.press(getByText('Grading'));

    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(modals)/course-grading', params: { id: '42' } });
  });

  it('opens analytics for a course, carrying its id', async () => {
    const { getByText } = render(<CourseInstructorRoute />);
    await waitFor(() => expect(getByText('Repair skills')).toBeTruthy());

    fireEvent.press(getByText('Analytics'));

    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(modals)/course-analytics', params: { id: '42' } });
  });

  it('keeps every per-course action available on each row, for every course', async () => {
    mockGetAuthoredCourses.mockResolvedValue([draft, published]);

    const { getAllByText } = render(<CourseInstructorRoute />);

    await waitFor(() => expect(getAllByText('Edit course')).toHaveLength(2));
    expect(getAllByText('Grading')).toHaveLength(2);
    expect(getAllByText('Analytics')).toHaveLength(2);
  });

  it('offers course creation from the empty state', async () => {
    mockGetAuthoredCourses.mockResolvedValue([]);

    const { getAllByText, getByText } = render(<CourseInstructorRoute />);

    await waitFor(() => expect(getByText("You haven't created any courses yet.")).toBeTruthy());
    fireEvent.press(getAllByText('Create course')[0]!);

    expect(mockPush).toHaveBeenCalledWith('/(modals)/new-course');
  });

  it('offers a retry when the authored list fails to load', async () => {
    // A 403 is deliberately NOT one of `useApi`'s retryable statuses, so the failure
    // surfaces immediately instead of after its 2s single-retry timer.
    mockGetAuthoredCourses.mockRejectedValue(new ApiResponseError(403, 'Network down'));

    const { getByText } = render(<CourseInstructorRoute />);

    await waitFor(() => expect(getByText('Retry')).toBeTruthy());
    expect(getByText('Network down')).toBeTruthy();
    mockGetAuthoredCourses.mockResolvedValue([draft]);
    fireEvent.press(getByText('Retry'));

    await waitFor(() => expect(getByText('Repair skills')).toBeTruthy());
  });
});
