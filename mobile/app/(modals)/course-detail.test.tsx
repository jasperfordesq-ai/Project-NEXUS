// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
const mockShow = jest.fn();
jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(), router: { push: (...args: unknown[]) => mockPush(...args) }, useLocalSearchParams: () => ({ id: 'basics' }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => ({ 'detail.enroll': 'Enroll', 'detail.enroll_success': "You're enrolled! Time to start learning.", 'detail.enroll_error': 'Could not enroll. Please try again.', 'detail.about': 'About this course', 'detail.syllabus': 'Syllabus', 'detail.free': 'Free', 'common:back': 'Back' } as Record<string, string>)[key] ?? key }) }));
jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }), usePrimaryColor: () => '#06f' }));
jest.mock('@/lib/hooks/useTheme', () => ({ useTheme: () => ({ text: '#111', textSecondary: '#555', border: '#ddd' }) }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/AppToast', () => ({ useAppToast: () => ({ show: mockShow }) }));
jest.mock('@/lib/api/courses', () => ({ getCourse: jest.fn(), enrollInCourse: jest.fn() }));

import CourseDetailScreen from './course-detail';
import { enrollInCourse, getCourse } from '@/lib/api/courses';

describe('CourseDetailScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getCourse).mockResolvedValue({ id: 7, slug: 'basics', title: 'Timebanking basics', summary: 'Start here.', description: 'Learn how exchanges work.', level: 'beginner', credit_cost: 0, enrollment_count: 12, is_enrolled: false, sections: [] });
    jest.mocked(enrollInCourse).mockResolvedValue({ id: 3, course_id: 7, status: 'active', progress_percent: 0 });
  });

  it('enrols through the API then opens the player', async () => {
    const { getByText } = render(<CourseDetailScreen />);
    await waitFor(() => expect(getByText('Timebanking basics')).toBeTruthy());
    fireEvent.press(getByText('Enroll'));
    await waitFor(() => expect(enrollInCourse).toHaveBeenCalledWith(7));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(modals)/course-player', params: { id: '7' } });
  });
});
