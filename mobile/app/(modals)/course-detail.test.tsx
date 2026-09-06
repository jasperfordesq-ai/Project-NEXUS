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
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => ({ 'detail.enroll': 'Enroll', 'detail.enroll_success': "You're enrolled! Time to start learning.", 'detail.enroll_error': 'Could not enroll. Please try again.', 'detail.about': 'About this course', 'detail.syllabus': 'Syllabus', 'detail.free': 'Free', 'detail.enroll_confirm_title': 'Enrol in this course?', 'detail.enroll_confirm_cta': 'Enrol', 'common:buttons.cancel': 'Cancel', 'common:back': 'Back' } as Record<string, string>)[key] ?? key }) }));
jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }), usePrimaryColor: () => '#06f' }));
jest.mock('@/lib/hooks/useTheme', () => ({ useTheme: () => ({ text: '#111', textSecondary: '#555', border: '#ddd' }) }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/AppToast', () => ({ useAppToast: () => ({ show: mockShow }) }));
jest.mock('@/lib/api/courses', () => ({ getCourse: jest.fn(), enrollInCourse: jest.fn() }));

// Same shape the other screens' suites use: the dialog itself is covered by its own tests,
// so here we assert on WHAT was asked and run the confirmed action.
const mockConfirm = jest.fn<void, [{ title: string; message?: string; onConfirm: () => void }]>();
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({ confirm: (...args: unknown[]) => mockConfirm(...(args as [never])), confirmDialog: null }),
}));

import CourseDetailScreen from './course-detail';
import { enrollInCourse, getCourse } from '@/lib/api/courses';
import { ApiResponseError } from '@/lib/api/client';

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
  /**
   * 🔴 Enrolling on a paid course spent the member's time credits on a single tap, with no
   * confirmation and no price stated at the moment of spending (audit 2026-09-06).
   */
  it('asks before spending time credits on a paid course', async () => {
    jest.mocked(getCourse).mockResolvedValue({ id: 7, slug: 'basics', title: 'Timebanking basics', summary: 'Start here.', description: 'Learn how exchanges work.', level: 'beginner', credit_cost: '2.50', enrollment_count: 12, is_enrolled: false, sections: [] });

    const { getByText } = render(<CourseDetailScreen />);
    await waitFor(() => expect(getByText('Timebanking basics')).toBeTruthy());

    fireEvent.press(getByText('Enroll'));

    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Enrol in this course?',
      confirmLabel: 'Enrol',
    }));
    expect(enrollInCourse).not.toHaveBeenCalled();

    // The member says yes.
    await mockConfirm.mock.calls[0][0].onConfirm();
    expect(enrollInCourse).toHaveBeenCalledWith(7);
  });

  it('enrols straight away when the course is free, with nothing to weigh up', async () => {
    const { getByText, queryByText } = render(<CourseDetailScreen />);
    await waitFor(() => expect(getByText('Timebanking basics')).toBeTruthy());

    fireEvent.press(getByText('Enroll'));

    await waitFor(() => expect(enrollInCourse).toHaveBeenCalledWith(7));
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(queryByText('Enrol in this course?')).toBeNull();
  });

  /**
   * 🔴 The reason was thrown away, so the likeliest failure — not enough credits — reached
   * the member as "please try again", which cannot work.
   */
  it('tells the member why enrolment was refused instead of just saying try again', async () => {
    jest.mocked(enrollInCourse).mockRejectedValue(
      new ApiResponseError(422, 'You need 2 more time credits.'),
    );

    const { getByText } = render(<CourseDetailScreen />);
    await waitFor(() => expect(getByText('Timebanking basics')).toBeTruthy());
    fireEvent.press(getByText('Enroll'));

    await waitFor(() => expect(mockShow).toHaveBeenCalledWith(expect.objectContaining({
      description: 'You need 2 more time credits.',
      variant: 'danger',
    })));
    expect(mockPush).not.toHaveBeenCalled();
  });
});
