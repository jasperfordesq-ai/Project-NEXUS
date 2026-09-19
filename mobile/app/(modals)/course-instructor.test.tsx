// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import * as ReactNative from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockGetAuthoredCourses = jest.fn();
const mockPublishCourse = jest.fn();
const mockUnpublishCourse = jest.fn();
const mockPush = jest.fn();
const mockShowToast = jest.fn();
let mockFocus: () => void | (() => void);
let mockBlur: (() => void) | undefined;

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => {
      mockFocus = callback;
      mockBlur = callback() || undefined;
      return () => mockBlur?.();
    }, [callback]);
  },
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

jest.mock('@/components/ui/ConfirmDialog', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    __esModule: true,
    default: ({ visible, title, cancelLabel, confirmLabel, cancelTestID, confirmTestID, onClose, onConfirm }: Record<string, unknown>) =>
      visible ? (
        <View>
          <Text>{title as string}</Text>
          <Pressable testID={cancelTestID as string} onPress={onClose as () => void}><Text>{cancelLabel as string}</Text></Pressable>
          <Pressable testID={confirmTestID as string} onPress={onConfirm as () => void}><Text>{confirmLabel as string}</Text></Pressable>
        </View>
      ) : null,
  };
});

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
    mockPublishCourse.mockReset();
    mockUnpublishCourse.mockReset();
    mockGetAuthoredCourses.mockReset();
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

  it('ignores repeated publish gestures before React renders the busy state', async () => {
    let finish!: (value: typeof draft) => void;
    mockPublishCourse.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const screen = render(<CourseInstructorRoute />);
    await screen.findByText('Repair skills');
    const press = screen.UNSAFE_getAllByType(require('@/components/ui/NativeButton').Button)
      .find(node => node.props.testID === 'course-toggle-publish-42')!.props.onPress;
    act(() => { press(); press(); });
    expect(mockPublishCourse).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ...draft, status: 'published' }));
  });

  it.each([false, true])('ignores a departed publish result (failure: %s)', async (failure) => {
    let finish!: (value: typeof draft) => void;
    let reject!: (error: Error) => void;
    mockPublishCourse.mockImplementationOnce(() => new Promise((resolve, fail) => { finish = resolve; reject = fail; }));
    const screen = render(<CourseInstructorRoute />);
    await screen.findByText('Repair skills');
    fireEvent.press(screen.getByText('Publish'));
    await waitFor(() => expect(mockPublishCourse).toHaveBeenCalledTimes(1));
    screen.unmount();
    await act(async () => { if (failure) reject(new ApiResponseError(422, 'Unavailable')); else finish({ ...draft, status: 'published' }); });
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockGetAuthoredCourses).toHaveBeenCalledTimes(1);
  });

  it('does not unpublish through a confirmation after its course disappears', async () => {
    mockGetAuthoredCourses.mockResolvedValueOnce([published]).mockResolvedValue([]);
    const screen = render(<CourseInstructorRoute />);
    await screen.findByText('Timebanking basics');
    fireEvent.press(screen.getByText('Unpublish'));
    const confirm = screen.UNSAFE_getByType(require('@/components/ui/ConfirmDialog').default).props.onConfirm;
    act(() => screen.UNSAFE_getByType(ReactNative.FlatList).props.refreshControl.props.onRefresh());
    await waitFor(() => expect(screen.UNSAFE_getByType(ReactNative.FlatList).props.data).toEqual([]));
    await act(async () => confirm());
    expect(mockUnpublishCourse).not.toHaveBeenCalled();
  });

  it.each([false, true])('ignores publish completion after blur and return (failure: %s)', async (failure) => {
    let finish!: (value: typeof draft) => void;
    let reject!: (error: Error) => void;
    mockPublishCourse.mockImplementationOnce(() => new Promise((resolve, fail) => { finish = resolve; reject = fail; }));
    const screen = render(<CourseInstructorRoute />);
    await screen.findByText('Repair skills');
    fireEvent.press(screen.getByText('Publish'));
    await waitFor(() => expect(mockPublishCourse).toHaveBeenCalledTimes(1));
    act(() => { mockBlur?.(); });
    act(() => { mockBlur = mockFocus() || undefined; });
    await waitFor(() => expect(mockGetAuthoredCourses).toHaveBeenCalledTimes(2));
    await act(async () => { if (failure) reject(new ApiResponseError(422, 'Unavailable')); else finish({ ...draft, status: 'published' }); });
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockGetAuthoredCourses).toHaveBeenCalledTimes(3);
  });

  it('dismisses unpublish confirmation on blur and rejects its late callback', async () => {
    mockGetAuthoredCourses.mockResolvedValue([published]);
    const screen = render(<CourseInstructorRoute />);
    await screen.findByText('Timebanking basics');
    fireEvent.press(screen.getByText('Unpublish'));
    const confirm = screen.UNSAFE_getByType(require('@/components/ui/ConfirmDialog').default).props.onConfirm;
    act(() => { mockBlur?.(); });
    expect(screen.queryByTestId('course-confirm-unpublish-43')).toBeNull();
    await act(async () => confirm());
    expect(mockUnpublishCourse).not.toHaveBeenCalled();
  });

  it('reads the completed write on return without presenting it on another screen', async () => {
    let finish!: (value: typeof draft) => void;
    mockPublishCourse.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const screen = render(<CourseInstructorRoute />);
    await screen.findByText('Repair skills');
    fireEvent.press(screen.getByText('Publish'));
    act(() => { mockBlur?.(); });
    const updated = { ...draft, status: 'published', moderation_status: 'approved' };
    mockGetAuthoredCourses.mockResolvedValue([updated]);
    await act(async () => finish(updated));
    expect(mockShowToast).not.toHaveBeenCalled();
    expect(mockGetAuthoredCourses).toHaveBeenCalledTimes(1);
    act(() => { mockBlur = mockFocus() || undefined; });
    await screen.findByText('Published');
    expect(mockGetAuthoredCourses).toHaveBeenCalledTimes(2);
  });

  it('unpublishes a published course', async () => {
    mockGetAuthoredCourses.mockResolvedValue([published]);
    mockUnpublishCourse.mockResolvedValue({ ...published, status: 'draft', moderation_status: 'pending' });

    const { getByTestId, getByText } = render(<CourseInstructorRoute />);
    await waitFor(() => expect(getByText('Timebanking basics')).toBeTruthy());

    fireEvent.press(getByText('Unpublish'));
    // 🔴 Unpublishing takes a live course away from everyone enrolled, and it used to
    // happen on one tap (G/F-11).
    expect(mockUnpublishCourse).not.toHaveBeenCalled();
    fireEvent.press(getByTestId('course-confirm-unpublish-43'));

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

  it('gives long titles and every action full-width room at large text', async () => {
    const dimensions = jest.spyOn(ReactNative, 'useWindowDimensions').mockReturnValue({ width: 360, height: 800, scale: 1, fontScale: 2 });
    const screen = render(<CourseInstructorRoute />);

    await waitFor(() => expect(screen.getByText('Repair skills')).toBeTruthy());
    expect(screen.getByTestId('course-instructor-42-title').props.numberOfLines).toBeUndefined();
    expect(screen.getByTestId('course-instructor-42-actions').props.className).not.toContain('flex-row');
    screen.unmount();
    dimensions.mockRestore();
  });

  it('offers course creation from the empty state', async () => {
    mockGetAuthoredCourses.mockResolvedValue([]);

    const { getAllByText, getByText } = render(<CourseInstructorRoute />);

    await waitFor(() => expect(getByText("You haven't created any courses yet.")).toBeTruthy());
    fireEvent.press(getAllByText('Create course')[0]!);

    expect(mockPush).toHaveBeenCalledWith('/(modals)/new-course');
  });

  it('offers a retry when the authored list fails to load', async () => {
    mockGetAuthoredCourses.mockRejectedValue(new ApiResponseError(429, 'Please try later.'));

    const { getByText } = render(<CourseInstructorRoute />);

    await waitFor(() => expect(getByText('Retry')).toBeTruthy());
    expect(getByText('Please try later.')).toBeTruthy();
    mockGetAuthoredCourses.mockResolvedValue([draft]);
    fireEvent.press(getByText('Retry'));

    await waitFor(() => expect(getByText('Repair skills')).toBeTruthy());
  });

  it('retains courses with a visible refresh error and an accurate refresh spinner', async () => {
    const screen = render(<CourseInstructorRoute />);
    await screen.findByText('Repair skills');
    let reject!: (error: Error) => void;
    mockGetAuthoredCourses.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
    act(() => screen.UNSAFE_getByType(ReactNative.FlatList).props.refreshControl.props.onRefresh());
    await waitFor(() => expect(mockGetAuthoredCourses).toHaveBeenCalledTimes(2));
    expect(screen.UNSAFE_getByType(ReactNative.FlatList).props.refreshControl.props.refreshing).toBe(true);
    expect(screen.getByText('Repair skills')).toBeTruthy();
    await act(async () => reject(new ApiResponseError(429, 'Refresh later.')));
    expect(screen.getByText('Refresh later.')).toBeTruthy();
    expect(screen.getByText('Repair skills')).toBeTruthy();
    expect(screen.UNSAFE_getByType(ReactNative.FlatList).props.refreshControl.props.refreshing).toBe(false);
    fireEvent.press(screen.getByText('Retry'));
    await waitFor(() => expect(screen.queryByText('Refresh later.')).toBeNull());
  });

  it.each([401, 403, 404])('clears refused courses and obsolete confirmations (%s)', async (status) => {
    mockGetAuthoredCourses.mockResolvedValue([published]);
    const screen = render(<CourseInstructorRoute />);
    await screen.findByText('Timebanking basics');
    fireEvent.press(screen.getByText('Unpublish'));
    expect(screen.getByTestId('course-confirm-unpublish-43')).toBeTruthy();
    mockGetAuthoredCourses.mockRejectedValueOnce(new ApiResponseError(status, 'No access.'));
    act(() => screen.UNSAFE_getByType(ReactNative.FlatList).props.refreshControl.props.onRefresh());
    await screen.findByText('No access.');
    expect(screen.UNSAFE_getByType(ReactNative.FlatList).props.data).toEqual([]);
    expect(screen.queryByTestId('course-confirm-unpublish-43')).toBeNull();
    expect(screen.queryByText('Retry')).toBeNull();
    expect(screen.queryByText('Create course')).toBeNull();
  });
});
