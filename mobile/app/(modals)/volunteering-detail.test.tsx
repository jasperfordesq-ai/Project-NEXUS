// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render, fireEvent, waitFor, act } from '@testing-library/react-native';

// --- Mocks ---

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({ id: '10' }),
  useNavigation: () => ({ setOptions: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'detail.title': 'Opportunity Details',
        'detail.organisation': 'Organisation',
        'detail.about': 'About this opportunity',
        'detail.invalidId': 'Invalid opportunity ID.',
        'detail.notFound': 'Opportunity not found.',
        'detail.goBack': 'Go Back',
        'expressInterest': 'Express Interest',
        'interestSent': 'Interest Sent',
        'interestSentTitle': 'Interest sent',
        'interestSentMessage': 'The organisation will be in touch.',
        'interestError': 'Failed to send interest.',
        'share': 'Share',
        'opportunityEyebrow': 'Volunteer opportunity',
        'yourOpportunity': 'Your opportunity',
        'ownerOpportunityTitle': 'Owner view',
        'ownerOpportunityHint': 'Applications are handled from organiser tools.',
        'applyToVolunteer': 'Apply to volunteer',
        'applications.heading': 'Applications',
        'applications.approve': 'Approve',
        'applications.decline': 'Decline',
        'applications.approvedTitle': 'Application approved',
        'applications.approvedMessage': 'The volunteer has been approved.',
        'coverMessageHint': 'Add a note.',
        'coverMessagePlaceholder': 'Tell the organiser…',
        'applicationSubmitted': 'Application submitted',
        'applicationSubmittedHint': 'The organiser can review it.',
        'noDescription': 'No description.',
        'signInRequiredTitle': 'Sign in required',
        'signInRequiredMessage': 'Sign in to apply.',
        'shifts': 'Shifts',
        'shiftDateUnavailable': 'Shift',
        'shiftSpots': opts ? `${String(opts.count ?? 0)} spots available` : '0 spots available',
        'shiftCapacity': opts ? `${String(opts.count ?? 0)} signed up` : '0 signed up',
        'signUpForShift': 'Sign up for shift',
        'shiftSignupTitle': 'Shift joined',
        'shiftSignupMessage': 'You joined the shift.',
        'shiftSignupError': 'Could not sign up.',
        'shiftCancelledTitle': 'Shift cancelled',
        'shiftCancelledMessage': 'You are no longer signed up for this shift.',
        'myShifts.confirmed': 'Confirmed',
        'myShifts.cancel': 'Cancel shift',
        'myShifts.cancelError': 'Could not cancel this shift.',
        'myShifts.dateUnknown': 'Date unavailable',
        'shiftMove.title': 'Move to this shift?',
        'shiftMove.message': opts
          ? `You are signed up for ${String(opts.date ?? '')}. Signing up for this shift takes you off that one.`
          : 'Move?',
        'shiftMove.confirm': 'Move me',
        'common:buttons.cancel': 'Cancel',
        'meta.location': 'Location',
        'meta.commitment': 'Commitment',
        'meta.starts': 'Starts',
        'meta.ends': 'Ends',
        'meta.spots': 'Spots',
        'meta.posted': 'Posted',
        'remote': 'Remote',
        'skills': 'Skills Needed',
        'status.open': 'Open',
        'status.filled': 'Filled',
        'status.closed': 'Closed',
        'deadline': opts ? `Deadline: ${String(opts.date ?? '')}` : 'Deadline',
        'hoursPerWeek': opts ? `${String(opts.hours ?? 0)} hrs/week` : '0 hrs/week',
        'spots': opts ? `${String(opts.count ?? 0)} spots available` : '0 spots available',
        'common:errors.alertTitle': 'Error',
        'common:back': 'Back',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ hasFeature: () => true }),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f9fa',
    text: '#000000',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#dddddd',
    borderSubtle: '#eeeeee',
    error: '#e53e3e',
    success: '#22c55e',
    warning: '#f59e0b',
  }),
}));

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

const mockUseApi = jest.fn();
const mockHandleVolunteerApplication = jest.fn();
jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
}));

jest.mock('@/lib/haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/lib/api/volunteering', () => ({
  getOpportunity: jest.fn(),
  getOpportunities: jest.fn(),
  expressInterest: jest.fn().mockResolvedValue(undefined),
  getOpportunityApplications: jest.fn(),
  handleVolunteerApplication: (...args: unknown[]) => mockHandleVolunteerApplication(...args),
  signUpForShift: jest.fn().mockResolvedValue({ data: {} }),
  cancelShiftSignup: jest.fn().mockResolvedValue(undefined),
  getMyShifts: jest.fn(() => {
    factoryCalls.push('myShifts');
    return Promise.resolve({ data: { items: [], cursor: null, has_more: false } });
  }),
}));

/**
 * Which API the screen's `useApi` factory reached for. `useApi` is mocked, so it
 * never runs the factory itself — the tests below run it once to tell the four
 * `useApi` call sites apart, which is what lets one of them return the member's
 * own shifts while the others return the opportunity.
 */
const factoryCalls: string[] = [];

/**
 * Records the confirmation instead of auto-running it. The load-bearing
 * assertion in these tests is that pressing "Sign up for shift" on a SECOND
 * shift does not call the API until the member has agreed to being moved.
 */
const mockConfirm = jest.fn();
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    confirm: (opts: unknown) => mockConfirm(opts),
    confirmDialog: null,
  }),
}));

jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/BottomSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
    visible ? <View testID="volunteer-apply-sheet">{children}</View> : null;
});

const mockShowToast = jest.fn();
jest.mock('@/components/ui/AppToast', () => ({
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  useAppToast: () => ({ show: mockShowToast, hide: jest.fn(), isToastVisible: false }),
}));

// --- Tests ---

import VolunteeringDetailScreen from './volunteering-detail';
import { cancelShiftSignup, expressInterest, signUpForShift } from '@/lib/api/volunteering';

const defaultApiState = { data: null, isLoading: false, error: null, refresh: jest.fn() };

beforeEach(() => {
  mockUseApi.mockReturnValue(defaultApiState);
  mockHandleVolunteerApplication.mockResolvedValue({ data: {} });
  jest.clearAllMocks();
});

const mockOpportunity = {
  id: 10,
  title: 'Community Garden Volunteer',
  description: 'Help tend the community garden every Saturday morning.',
  status: 'open' as const,
  is_active: true,
  is_remote: false,
  location: 'Dublin, Ireland',
  hours_per_week: 3,
  commitment: 'Weekly',
  deadline: '2026-08-01T00:00:00Z',
  spots_available: 5,
  skills_needed: ['Gardening', 'Teamwork'],
  organisation: { id: 4, name: 'Green Spaces Dublin', avatar: null },
  organization: { id: 4, name: 'Green Spaces Dublin', logo_url: null },
  created_at: '2026-05-01T00:00:00Z',
  shifts: [
    {
      id: 1,
      start_time: '2026-08-02T09:00:00Z',
      end_time: '2026-08-02T11:00:00Z',
      capacity: 5,
      signup_count: 0,
      spots_available: 5,
    },
  ],
};

describe('VolunteeringDetailScreen', () => {
  it('renders without crashing when data is loaded', () => {
    mockUseApi.mockReturnValueOnce({ data: { data: mockOpportunity }, isLoading: false, error: null, refresh: jest.fn() });

    const { toJSON } = render(<VolunteeringDetailScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders a loading spinner when the API is loading', () => {
    mockUseApi.mockReturnValueOnce({ data: null, isLoading: true, error: null, refresh: jest.fn() });

    const { toJSON } = render(<VolunteeringDetailScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders the opportunity title when loaded', () => {
    mockUseApi.mockReturnValueOnce({ data: { data: mockOpportunity }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<VolunteeringDetailScreen />);
    expect(getByText('Community Garden Volunteer')).toBeTruthy();
  });

  it('renders the Open status badge', () => {
    mockUseApi.mockReturnValueOnce({ data: { data: mockOpportunity }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<VolunteeringDetailScreen />);
    expect(getByText('Open')).toBeTruthy();
  });

  it('renders the organisation name', () => {
    mockUseApi.mockReturnValueOnce({ data: { data: mockOpportunity }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<VolunteeringDetailScreen />);
    expect(getByText('Green Spaces Dublin')).toBeTruthy();
  });

  it('renders the description text', () => {
    mockUseApi.mockReturnValueOnce({ data: { data: mockOpportunity }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<VolunteeringDetailScreen />);
    expect(getByText('Help tend the community garden every Saturday morning.')).toBeTruthy();
  });

  it('renders the Express Interest button', () => {
    mockUseApi.mockReturnValueOnce({ data: { data: mockOpportunity }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<VolunteeringDetailScreen />);
    expect(getByText('Express Interest')).toBeTruthy();
  });

  it('opens the express interest form in a bottom sheet', () => {
    mockUseApi.mockReturnValue({ data: { data: mockOpportunity }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByPlaceholderText, getByTestId, getByText } = render(<VolunteeringDetailScreen />);

    fireEvent.press(getByText('Express Interest'));

    expect(getByTestId('volunteer-apply-sheet')).toBeTruthy();
    expect(getByPlaceholderText(/Tell the organiser/)).toBeTruthy();
  });

  it('does not show the apply action for owner-managed opportunities', () => {
    mockUseApi.mockReturnValueOnce({
      data: { data: { ...mockOpportunity, is_owner: true } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText, queryByText } = render(<VolunteeringDetailScreen />);

    expect(getByText('Your opportunity')).toBeTruthy();
    expect(queryByText('Express Interest')).toBeNull();
  });

  it('allows owners to approve pending applications', async () => {
    const ownerOpportunity = { ...mockOpportunity, is_owner: true };
    const applicationsApiRefresh = jest.fn();
    mockUseApi
      .mockReturnValueOnce({ data: { data: ownerOpportunity }, isLoading: false, error: null, refresh: jest.fn() })
      .mockReturnValueOnce(defaultApiState)
      .mockReturnValueOnce({
        data: {
          data: {
            items: [
              {
                id: 55,
                status: 'pending',
                message: 'I can help every Saturday.',
                user: { id: 12, name: 'Maya Patel', email: 'maya@example.test', avatar_url: null },
                shift: null,
                created_at: '2026-06-01T10:00:00Z',
              },
            ],
            cursor: null,
            has_more: false,
          },
        },
        isLoading: false,
        error: null,
        refresh: applicationsApiRefresh,
      });

    const { getByText } = render(<VolunteeringDetailScreen />);

    expect(getByText('Applications')).toBeTruthy();
    expect(getByText('Maya Patel')).toBeTruthy();
    fireEvent.press(getByText('Approve'));

    await waitFor(() => {
      expect(mockHandleVolunteerApplication).toHaveBeenCalledWith(55, 'approve');
      expect(applicationsApiRefresh).toHaveBeenCalled();
      expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Application approved',
        description: 'The volunteer has been approved.',
        variant: 'success',
      }));
    });
  });

  it('does not show shift sign-up before the application is approved', () => {
    mockUseApi.mockReturnValueOnce({ data: { data: mockOpportunity }, isLoading: false, error: null, refresh: jest.fn() });

    const { queryByText } = render(<VolunteeringDetailScreen />);

    expect(queryByText('Sign up for shift')).toBeNull();
  });

  it('renders the not found state when data is null after loading', () => {
    mockUseApi.mockReturnValueOnce({ data: null, isLoading: false, error: null, refresh: jest.fn() });

    const { getAllByText } = render(<VolunteeringDetailScreen />);
    expect(getAllByText('Opportunity not found.').length).toBeGreaterThan(0);
    expect(getAllByText('Go Back').length).toBeGreaterThan(0);
  });

  it('submits an interest note for an open opportunity', async () => {
    mockUseApi.mockReturnValue({ data: { data: mockOpportunity }, isLoading: false, error: null, refresh: jest.fn() });

    const { getAllByText, getByPlaceholderText, getByText } = render(<VolunteeringDetailScreen />);

    fireEvent.press(getByText('Express Interest'));
    fireEvent.changeText(getByPlaceholderText(/Tell the organiser/), 'Happy to help on Saturday mornings.');
    const expressButtons = getAllByText('Express Interest');
    fireEvent.press(expressButtons[expressButtons.length - 1]);

    await waitFor(() => {
      expect(expressInterest).toHaveBeenCalledWith(10, 'Happy to help on Saturday mornings.');
      expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Interest sent',
        description: 'The organisation will be in touch.',
        variant: 'success',
      }));
    });
  });

  it('signs up for a shift from the detail page', async () => {
    mockUseApi.mockReturnValue({
      data: {
        data: {
          ...mockOpportunity,
          has_applied: true,
          application: { id: 44, status: 'approved' },
        },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<VolunteeringDetailScreen />);

    fireEvent.press(getByText('Sign up for shift'));

    await waitFor(() => {
      expect(signUpForShift).toHaveBeenCalledWith(1);
      expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Shift joined',
        description: 'You joined the shift.',
        variant: 'success',
      }));
    });
  });
  /**
   * 🔴 Walked on a device on 2026-08-23 and it was wrong.
   *
   * A volunteer can hold exactly ONE shift per opportunity — the server stores the
   * sign-up as `vol_applications.shift_id`, a single column — but every shift card
   * looked identical, including the one the member had just joined, and signing up
   * for a second shift silently dropped them from the first while the toast said
   * "Shift joined — You have signed up for this shift". Measured: `shift_id` went
   * 65 → 66 and Monday's card went back to "4 spots available".
   *
   * These three tests pin the three halves of the repair: the held shift is marked
   * and offers a cancel; a second sign-up asks first; and it does nothing until the
   * member agrees.
   */
  function approvedOpportunityWithMyShift(myShiftId: number | null) {
    const opportunity = {
      ...mockOpportunity,
      has_applied: true,
      application: { id: 44, status: 'approved' },
      shifts: [
        { id: 1, start_time: '2026-08-24T09:00:00Z', end_time: '2026-08-24T11:00:00Z', capacity: 4, signup_count: 0, spots_available: 4 },
        { id: 2, start_time: '2026-08-26T09:00:00Z', end_time: '2026-08-26T11:00:00Z', capacity: 4, signup_count: 0, spots_available: 4 },
      ],
    };

    const myShifts = myShiftId === null
      ? { data: { items: [], cursor: null, has_more: false } }
      : {
          data: {
            items: [{
              id: myShiftId,
              opportunity_id: 10,
              opportunity_title: 'Community Garden Volunteer',
              location: null,
              application_id: 44,
              start_time: '2026-08-24T09:00:00Z',
              end_time: '2026-08-24T11:00:00Z',
              capacity: 4,
              signup_count: 1,
              spots_available: 3,
            }],
            cursor: null,
            has_more: false,
          },
        };

    mockUseApi.mockImplementation((factory: unknown) => {
      factoryCalls.length = 0;
      try {
        void (factory as () => unknown)();
      } catch {
        // A mocked API can throw; only which one was reached matters here.
      }
      const isMyShifts = factoryCalls[0] === 'myShifts';
      return {
        data: isMyShifts ? myShifts : { data: opportunity },
        isLoading: false,
        error: null,
        refresh: jest.fn(),
      };
    });
  }

  it('marks the shift the member is on and offers to cancel it, not to join it again', () => {
    approvedOpportunityWithMyShift(1);

    const { getByTestId, getAllByText } = render(<VolunteeringDetailScreen />);

    // Shift 1 is theirs: confirmed chip plus a cancel action.
    expect(getByTestId('shift-mine-1')).toBeTruthy();
    expect(getByTestId('shift-cancel-1')).toBeTruthy();
    // Shift 2 is not, so it keeps the join action — and there is only one of those.
    expect(getAllByText('Sign up for shift')).toHaveLength(1);
  });

  it('cancels the held shift and says so', async () => {
    approvedOpportunityWithMyShift(1);

    const { getByTestId } = render(<VolunteeringDetailScreen />);

    fireEvent.press(getByTestId('shift-cancel-1'));

    await waitFor(() => {
      expect(cancelShiftSignup).toHaveBeenCalledWith(1);
      expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Shift cancelled',
        variant: 'success',
      }));
    });
  });

  it('will not move a member off their shift without asking first', async () => {
    approvedOpportunityWithMyShift(1);

    const { getByText } = render(<VolunteeringDetailScreen />);

    fireEvent.press(getByText('Sign up for shift'));

    // The whole point: nothing has happened yet.
    expect(signUpForShift).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Move to this shift?',
      message: expect.stringContaining('Signing up for this shift takes you off that one'),
    }));

    // …and the message names the shift they would lose, not the one they are joining.
    const options = mockConfirm.mock.calls[0][0] as { message: string; onConfirm: () => Promise<void> };
    // Day-first: this asserted 'Aug 24' back when dateLocale() could return a
    // bare 'en', which Intl renders as US English.
    expect(options.message).toContain('24 Aug');

    await act(async () => {
      await options.onConfirm();
    });

    expect(signUpForShift).toHaveBeenCalledWith(2);
  });
});
