// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: (...args: unknown[]) => mockPush(...args), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => ({
      title: 'Courses', subtitle: 'Learn new skills with your community',
      'browse.search_placeholder': 'Search courses…', 'browse.all_categories': 'All categories',
      'browse.all_levels': 'All levels', 'browse.empty': 'No courses found.',
      'browse.empty_hint': 'Check back soon', 'my_learning.title': 'My learning',
      'my_learning.empty': "You haven't enrolled in any courses yet.",
      'my_learning.browse_cta': 'Browse courses', 'common:buttons.retry': 'Retry',
      'common:errors.alertTitle': 'Error', 'common:back': 'Back',
      'level.beginner': 'Beginner', 'detail.free': 'Free',
      'instructor.my_courses': 'My courses', 'instructor.create_course': 'Create course',
      'card.by_author': `by ${String(values?.name ?? '')}`,
    } as Record<string, string>)[key] ?? key,
  }),
}));
jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
  useTenant: () => ({ hasFeature: () => true }),
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ bg: '#fff', text: '#111', textSecondary: '#555', textMuted: '#777', border: '#ddd', info: '#06f' }),
}));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/AppToast', () => ({ useAppToast: () => ({ show: jest.fn() }) }));
jest.mock('@/lib/api/courses', () => ({
  getCourses: jest.fn(),
  getMyCourses: jest.fn(),
}));

import CoursesScreen from './courses';
import { getCourses, getMyCourses } from '@/lib/api/courses';

describe('CoursesScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
    jest.mocked(getCourses).mockResolvedValue({
      items: [{
        id: 7, title: 'Timebanking basics', slug: 'basics', summary: 'Start exchanging time.',
        level: 'beginner', credit_cost: 0, enrollment_count: 12,
        author: { id: 2, name: 'Sam Tutor' },
      }], page: 1, total: 1, hasMore: false,
    } as never);
    jest.mocked(getMyCourses).mockResolvedValue([]);
  });

  it('loads the catalogue and opens a course detail', async () => {
    const { getByText } = render(<CoursesScreen />);
    await waitFor(() => expect(getByText('Timebanking basics')).toBeTruthy());
    fireEvent.press(getByText('Timebanking basics'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(modals)/course-detail', params: { id: 'basics' } });
  });

  it('opens directly on My Learning from a deep link', async () => {
    mockParams = { tab: 'learning' };
    const { getByText } = render(<CoursesScreen />);
    await waitFor(() => expect(getByText("You haven't enrolled in any courses yet.")).toBeTruthy());
    expect(getMyCourses).toHaveBeenCalled();
  });

  /*
    🔴 The teaching side must have a door here. Reachable only from the "+" menu,
    the builder can create a course but never lead back to one already written —
    which is how a member concludes the feature is not there.
  */
  it('offers the teaching entry points and opens them natively', async () => {
    const { getByText } = render(<CoursesScreen />);
    await waitFor(() => expect(getByText('Timebanking basics')).toBeTruthy());

    fireEvent.press(getByText('My courses'));
    expect(mockPush).toHaveBeenCalledWith('/(modals)/course-instructor');

    fireEvent.press(getByText('Create course'));
    expect(mockPush).toHaveBeenCalledWith('/(modals)/new-course');
  });
});
