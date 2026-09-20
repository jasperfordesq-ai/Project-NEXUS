// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import * as ReactNative from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
const mockShow = jest.fn();
const mockDismiss = jest.fn();
jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(), router: { push: (...args: unknown[]) => mockPush(...args) }, useLocalSearchParams: () => ({ id: 'basics' }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => ({ 'detail.enroll': 'Enroll', 'detail.enroll_success': "You're enrolled! Time to start learning.", 'detail.enroll_error': 'Could not enroll. Please try again.', 'detail.about': 'About this course', 'detail.syllabus': 'Syllabus', 'detail.free': 'Free', 'detail.enroll_confirm_title': 'Enrol in this course?', 'detail.enroll_confirm_cta': 'Enrol', 'common:buttons.cancel': 'Cancel', 'common:back': 'Back' } as Record<string, string>)[key] ?? key }) }));
jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { id: 2, slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }), usePrimaryColor: () => '#06f' }));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 10 } }) }));
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
  useConfirm: () => ({ confirm: (...args: unknown[]) => mockConfirm(...(args as [never])), confirmDialog: null, dismiss: mockDismiss }),
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


  it.each([401, 403, 404])('removes loaded course content and actions after refresh refusal %s', async status => {
    const screen = render(<CourseDetailScreen />);
    await waitFor(() => expect(screen.getByText('Timebanking basics')).toBeTruthy());
    jest.mocked(getCourse).mockRejectedValue(new ApiResponseError(status, 'Unavailable'));
    act(() => screen.UNSAFE_getByType(ReactNative.RefreshControl).props.onRefresh());
    await waitFor(() => expect(screen.getByTestId('course-detail-refused')).toBeTruthy());
    expect(screen.queryByText('Timebanking basics')).toBeNull();
    expect(screen.queryByText('Learn how exchanges work.')).toBeNull();
    expect(screen.queryByText('Enroll')).toBeNull();
  });

  it('does not submit a paid enrolment from a confirmation after leaving the screen', async () => {
    const course = await getCourse('basics');
    jest.mocked(getCourse).mockResolvedValue({ ...course, credit_cost: 2 });
    const screen = render(<CourseDetailScreen />);
    await waitFor(() => expect(screen.getByText('Enroll')).toBeTruthy());
    fireEvent.press(screen.getByText('Enroll'));
    const confirm = mockConfirm.mock.calls[0][0].onConfirm;
    screen.unmount();
    await act(async () => confirm());
    expect(enrollInCourse).not.toHaveBeenCalled();
  });


  it('ignores a failed enrolment readback after leaving the screen', async () => {
    const screen = render(<CourseDetailScreen />);
    await waitFor(() => expect(screen.getByText('Enroll')).toBeTruthy());
    let rejectReadback!: (error: Error) => void;
    jest.mocked(getCourse).mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectReadback = reject; }));
    jest.mocked(enrollInCourse).mockRejectedValueOnce(new ApiResponseError(0, 'Network request failed'));
    fireEvent.press(screen.getByText('Enroll'));
    await waitFor(() => expect(getCourse).toHaveBeenCalledWith(7));
    screen.unmount();
    await act(async () => rejectReadback(new ApiResponseError(422, 'Unavailable')));
    expect(mockShow).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });


  it('does not submit an old paid confirmation after the course becomes unavailable', async () => {
    const course = await getCourse('basics');
    jest.mocked(getCourse).mockResolvedValue({ ...course, credit_cost: 2 });
    const screen = render(<CourseDetailScreen />);
    await waitFor(() => expect(screen.getByText('Enroll')).toBeTruthy());
    fireEvent.press(screen.getByText('Enroll'));
    const confirm = mockConfirm.mock.calls[0][0].onConfirm;
    jest.mocked(getCourse).mockRejectedValue(new ApiResponseError(403, 'Unavailable'));
    act(() => screen.UNSAFE_getByType(ReactNative.RefreshControl).props.onRefresh());
    await waitFor(() => expect(screen.getByTestId('course-detail-refused')).toBeTruthy());
    await act(async () => confirm());
    expect(enrollInCourse).not.toHaveBeenCalled();
  });


  it('discards the old price confirmation and requires a new confirmation after refresh', async () => {
    const course = await getCourse('basics');
    jest.mocked(getCourse).mockResolvedValue({ ...course, credit_cost: 2 });
    const screen = render(<CourseDetailScreen />);
    await waitFor(() => expect(screen.getByText('Enroll')).toBeTruthy());
    fireEvent.press(screen.getByText('Enroll'));
    const oldConfirm = mockConfirm.mock.calls[0][0].onConfirm;
    mockDismiss.mockClear();
    jest.mocked(getCourse).mockResolvedValue({ ...course, credit_cost: 5 });
    act(() => screen.UNSAFE_getByType(ReactNative.RefreshControl).props.onRefresh());
    await waitFor(() => expect(mockDismiss).toHaveBeenCalled());
    await act(async () => oldConfirm());
    expect(enrollInCourse).not.toHaveBeenCalled();
    fireEvent.press(screen.getByText('Enroll'));
    await act(async () => mockConfirm.mock.calls[1][0].onConfirm());
    expect(enrollInCourse).toHaveBeenCalledTimes(1);
  });

  it('uses readable status chips at large text', async () => {
    const dimensions = jest.spyOn(ReactNative, 'useWindowDimensions').mockReturnValue({ width: 360, height: 800, scale: 1, fontScale: 2 });
    const screen = render(<CourseDetailScreen />);

    await waitFor(() => expect(screen.getByText('Timebanking basics')).toBeTruthy());
    expect(screen.getByTestId('course-detail-status').props.className).not.toContain('flex-row');
    screen.unmount();
    dimensions.mockRestore();
  });

  it('enrols through the API then opens the player', async () => {
    const { getByText } = render(<CourseDetailScreen />);
    await waitFor(() => expect(getByText('Timebanking basics')).toBeTruthy());
    fireEvent.press(getByText('Enroll'));
    await waitFor(() => expect(enrollInCourse).toHaveBeenCalledWith(7, 0));
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
    await act(async () => mockConfirm.mock.calls[0][0].onConfirm());
    expect(enrollInCourse).toHaveBeenCalledWith(7, 2.5);
  });

  it('serializes repeated paid-enrolment confirmations before React re-renders', async () => {
    jest.mocked(getCourse).mockResolvedValue({ id: 7, slug: 'basics', title: 'Timebanking basics', summary: 'Start here.', description: 'Learn how exchanges work.', level: 'beginner', credit_cost: '2.50', enrollment_count: 12, is_enrolled: false, sections: [] });
    let finishEnrollment!: () => void;
    jest.mocked(enrollInCourse).mockImplementation(() => new Promise((resolve) => {
      finishEnrollment = () => resolve({ id: 3, course_id: 7, status: 'active', progress_percent: 0 });
    }));

    const { getByText } = render(<CourseDetailScreen />);
    await waitFor(() => expect(getByText('Timebanking basics')).toBeTruthy());
    fireEvent.press(getByText('Enroll'));

    const confirmed = mockConfirm.mock.calls[0][0].onConfirm;
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = Promise.resolve(confirmed());
      second = Promise.resolve(confirmed());
    });

    expect(enrollInCourse).toHaveBeenCalledTimes(1);
    await act(async () => {
      finishEnrollment();
      await Promise.all([first, second]);
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it('enrols straight away when the course is free, with nothing to weigh up', async () => {
    const { getByText, queryByText } = render(<CourseDetailScreen />);
    await waitFor(() => expect(getByText('Timebanking basics')).toBeTruthy());

    fireEvent.press(getByText('Enroll'));

    await waitFor(() => expect(enrollInCourse).toHaveBeenCalledWith(7, 0));
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(queryByText('Enrol in this course?')).toBeNull();
  });

  /**
   * 🔴 The reason was thrown away, so the likeliest failure — not enough credits — reached
   * the member as "please try again", which cannot work.
   */
  it.each([[422, 'You need 2 more time credits.'], [409, 'The course price changed. Refresh the course.']] as const)('explains enrolment refusal %s without opening the player', async (status, message) => {
    jest.mocked(enrollInCourse).mockRejectedValue(
      new ApiResponseError(status, message),
    );

    const { getByText } = render(<CourseDetailScreen />);
    await waitFor(() => expect(getByText('Timebanking basics')).toBeTruthy());
    fireEvent.press(getByText('Enroll'));

    await waitFor(() => expect(mockShow).toHaveBeenCalledWith(expect.objectContaining({
      description: message,
      variant: 'danger',
    })));
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('opens the enrolled course when the POST response is lost but canonical readback confirms it', async () => {
    jest.mocked(enrollInCourse).mockRejectedValue(new ApiResponseError(0, 'Network request failed'));
    jest.mocked(getCourse)
      .mockResolvedValueOnce({ id: 7, slug: 'basics', title: 'Timebanking basics', summary: 'Start here.', description: 'Learn how exchanges work.', level: 'beginner', credit_cost: 2, enrollment_count: 12, is_enrolled: false, sections: [] })
      .mockResolvedValueOnce({ id: 7, slug: 'basics', title: 'Timebanking basics', summary: 'Start here.', description: 'Learn how exchanges work.', level: 'beginner', credit_cost: 2, enrollment_count: 13, is_enrolled: true, sections: [] });

    const { getByText } = render(<CourseDetailScreen />);
    await waitFor(() => expect(getByText('Timebanking basics')).toBeTruthy());
    fireEvent.press(getByText('Enroll'));
    await act(async () => mockConfirm.mock.calls[0][0].onConfirm());

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith({ pathname: '/(modals)/course-player', params: { id: '7' } }));
    expect(mockShow).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }));
  });
});
