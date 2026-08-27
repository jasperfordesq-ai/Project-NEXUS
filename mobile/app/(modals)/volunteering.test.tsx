// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

// --- Mocks ---

let mockParams: Record<string, string> = {};
/*
  The real sheet renders through heroui's portal, which react-test-renderer does not mount.
  Same stand-in as chat/exchange-detail/group-detail use, so the sheet's CONTENTS are
  assertable and `visible` is still honoured.
*/
jest.mock('@/components/ui/BottomSheet', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ visible, children }: { visible: boolean; children?: React.ReactNode }) =>
    visible ? <View>{children}</View> : null;
});

const mockGetOpportunityShifts = jest.fn();
const mockRequestShiftSwap = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
  useNavigation: () => ({ setOptions: jest.fn() }),
  // BottomSheet (used by the swap sheet) defers its own state on focus.
  useFocusEffect: (callback: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => callback(), [callback]);
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'title': 'Volunteering',
        'subtitle': 'Find opportunities and track your hours.',
        'heroEyebrow': 'Community action',
        'searchPlaceholder': 'Search opportunities…',
        'clearSearch': 'Clear search',
        'empty': 'No opportunities found.',
        'stats.opportunities': 'Opportunities',
        'stats.applications': 'Applications',
        'stats.hours': 'Verified hours',
        'tabs.opportunities': 'Opportunities',
        'tabs.applications': 'My Applications',
        'tabs.shifts': 'My Shifts',
        'tabs.swaps': 'Swaps',
        'tabs.hours': 'My Hours',
        'tabs.certificates': 'Certificates',
        'tabs.expenses': 'Expenses',
        'tabs.donations': 'Donations',
        'tabs.organisations': 'Organisations',
        'org.emptyTitle': 'No managed organisations yet',
        'org.emptyDescription': 'Register or join an approved organisation before using organiser tools.',
        'org.register': 'Browse organisations',
        'org.pendingHeading': 'Pending approval',
        'org.pendingDescription': 'This organisation is waiting for approval.',
        'org.walletBalance': opts ? `${String(opts.count ?? 0)}h available` : '0h available',
        'org.managerTools': 'Manager tools',
        'org.openDashboardLabel': opts ? `Open dashboard for ${String(opts.name ?? '')}` : 'Open dashboard',
        'org.manage': 'Manage',
        'org.status.pending': 'Pending',
        'org.roles.owner': 'Owner',
        'org.roles.admin': 'Admin',
        'org.roles.member': 'Member',
        'myShifts.empty': 'No confirmed shifts yet.',
        'myShifts.date': opts ? String(opts.date ?? '') : 'Date',
        'myShifts.dateUnknown': 'Date unavailable',
        'myShifts.timeRange': opts ? `${String(opts.start ?? '')}-${String(opts.end ?? '')}` : 'Time',
        'myShifts.confirmed': 'Confirmed',
        'myShifts.cancel': 'Cancel shift',
        'myShifts.cancelError': 'Could not cancel this shift.',
        'myShifts.openOpportunityLabel': opts ? `Open opportunity for ${String(opts.title ?? '')}` : 'Open opportunity',
        'myShifts.cancelLabel': opts ? `Cancel shift for ${String(opts.title ?? '')}` : 'Cancel shift',
        'swaps.heading': 'Shift swaps',
        'swaps.description': 'Review swap requests.',
        'swaps.all': opts ? `All (${String(opts.count ?? 0)})` : 'All (0)',
        'swaps.sent': opts ? `Sent (${String(opts.count ?? 0)})` : 'Sent (0)',
        'swaps.received': opts ? `Received (${String(opts.count ?? 0)})` : 'Received (0)',
        'swaps.emptyTitle': 'No shift swaps yet',
        'swaps.sentTo': opts ? `Sent to ${String(opts.name ?? '')}` : 'Sent to',
        'swaps.receivedFrom': opts ? `From ${String(opts.name ?? '')}` : 'From',
        'swaps.requested': opts ? `Requested ${String(opts.date ?? '')}` : 'Requested',
        'swaps.yourShift': 'Your shift',
        'swaps.proposedShift': 'Proposed shift',
        'swaps.theirShift': 'Their shift',
        'swaps.accept': 'Accept',
        'swaps.reject': 'Reject',
        'swaps.cancel': 'Cancel request',
        'swaps.acceptError': 'Could not accept this swap.',
        'swaps.rejectError': 'Could not reject this swap.',
        'swaps.cancelError': 'Could not cancel this swap.',
        'swaps.status.pending': 'Pending',
        'swaps.status.accepted': 'Accepted',
        'certificates.title': 'Volunteer certificates',
        'certificates.description': 'Generate verified certificates.',
        'certificates.generate': 'Generate certificate',
        'certificates.generateError': 'Could not generate.',
        'certificates.emptyTitle': 'No certificates yet',
        'certificates.verifiedHours': opts ? `${String(opts.count ?? 0)} verified hours` : '0 verified hours',
        'certificates.dateRange': opts ? `${String(opts.start ?? '')} - ${String(opts.end ?? '')}` : 'Date range',
        'certificates.dateUnknown': 'Date unavailable',
        'certificates.organizationHours': opts ? `${String(opts.name ?? '')}: ${String(opts.hours ?? 0)}h` : 'Org hours',
        'certificates.open': 'Open certificate',
        'certificates.openLabel': opts ? `Open certificate ${String(opts.code ?? '')}` : 'Open certificate',
        'expenses.submit': 'Submit expense',
        'expenses.submitHint': 'Submit a reimbursement request.',
        'expenses.noOrganisations': 'No organisations.',
        'expenses.validation': 'Enter expense details.',
        'expenses.submitError': 'Could not submit this expense.',
        'expenses.emptyTitle': 'No expenses yet',
        'expenses.amountPlaceholder': 'Amount',
        'expenses.currencyPlaceholder': 'EUR',
        'expenses.descriptionPlaceholder': 'Description',
        'expenses.dateUnknown': 'Date unavailable',
        'expenses.stats.claimed': 'Claimed',
        'expenses.stats.approved': 'Approved',
        'expenses.types.travel': 'Travel',
        'expenses.types.meals': 'Meals',
        'expenses.types.supplies': 'Supplies',
        'expenses.types.equipment': 'Equipment',
        'expenses.types.parking': 'Parking',
        'expenses.types.other': 'Other',
        'expenses.status.pending': 'Pending',
        'expenses.status.approved': 'Approved',
        'expenses.status.rejected': 'Rejected',
        'expenses.status.paid': 'Paid',
        'donations.activeGivingDays': 'Active giving days',
        'donations.makeDonation': 'Make a donation',
        'donations.makeDonationHint': 'Record a pledge or offline donation.',
        'donations.amountPlaceholder': 'Amount',
        'donations.messagePlaceholder': 'Optional message',
        'donations.anonymousOn': 'Anonymous',
        'donations.anonymousOff': 'Show my name',
        'donations.submit': 'Submit donation',
        'donations.validation': 'Enter a valid donation amount.',
        'donations.submitError': 'Could not submit this donation.',
        'swaps.ask': 'Ask to swap',
        'swaps.askTitle': 'Ask to swap this shift',
        'swaps.askBody': 'Pick the shift you would rather do.',
        'swaps.askEmpty': 'There is nobody to swap with yet.',
        'swaps.askLabel': 'Ask to swap',
        'swaps.askOptionLabel': 'Ask to swap',
        'swaps.optionsError': 'Could not load the other shifts.',
        'swaps.requestSentTitle': 'Swap request sent',
        'swaps.requestSentBody': 'We have asked the other volunteer.',
        'swaps.requestError': 'Could not send that swap request.',
        'donations.submitSuccessTitle': 'Pledge recorded',
        'donations.submitSuccess': 'Your donation has been recorded and will count towards the campaign once it is confirmed.',
        'donations.emptyTitle': 'No donations yet',
        'donations.progress': opts ? `${String(opts.percent ?? 0)}%` : '0%',
        'donations.raisedOfGoal': opts ? `${String(opts.raised ?? '')} raised of ${String(opts.goal ?? '')}` : 'Raised',
        'donations.selectCampaign': 'Choose campaign',
        'donations.selected': 'Selected',
        'donations.stats.raised': 'Raised',
        'donations.stats.donors': 'Donors',
        'donations.status.pending': 'Pending',
        'donations.status.completed': 'Completed',
        'donations.status.failed': 'Failed',
        'donations.status.refunded': 'Refunded',
        'browseOrganisations': 'Browse organisations',
        'viewOpportunity': 'View',
        'apply': 'Apply',
        'applyError': 'Could not apply.',
        'signInRequiredTitle': 'Sign in required',
        'signInRequiredMessage': 'Sign in to apply.',
        'noDescription': 'No description.',
        'deadlineShort': opts ? String(opts.date ?? '') : 'Deadline',
        'tryAgain': 'Try again',
        'noApplications': 'No applications yet.',
        'withdraw': 'Withdraw',
        'withdrawError': 'Could not withdraw.',
        'appliedOn': opts ? `Applied ${String(opts.date ?? '')}` : 'Applied',
        'applicationStatus.pending': 'Pending',
        'applicationStatus.approved': 'Approved',
        'applicationStatus.declined': 'Declined',
        'logHours': 'Log hours',
        'logHoursHint': 'Log your hours.',
        'noLoggableOrganisations': 'No organisations.',
        'hoursPlaceholder': 'Hours',
        'hoursDescriptionPlaceholder': 'Description',
        'submitHours': 'Submit hours',
        'hoursRequired': 'Enter hours.',
        'hoursLogError': 'Could not log hours.',
        'byOrganisation': 'By organisation',
        'hoursValue': opts ? `${String(opts.count ?? 0)}h` : '0h',
        'hoursStats.verified': 'Verified',
        'hoursStats.pending': 'Pending',
        'hoursStats.declined': 'Declined',
        'remote': 'Remote',
        'status.open': 'Open',
        'status.filled': 'Filled',
        'status.closed': 'Closed',
        'deadline': opts ? `Deadline: ${String(opts.date ?? '')}` : 'Deadline',
        'hoursPerWeek': opts ? `${String(opts.hours ?? 0)} hrs/week` : '0 hrs/week',
        'common:actions.retry': 'Retry',
        'common:back': 'Back',
        'common:errors.alertTitle': 'Error',
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
    success: '#16a34a',
    warning: '#f59e0b',
  }),
}));

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: true }),
}));

const mockUseApi = jest.fn();
jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

const mockUsePaginatedApi = jest.fn();
jest.mock('@/lib/hooks/usePaginatedApi', () => ({
  usePaginatedApi: (...args: unknown[]) => mockUsePaginatedApi(...args),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/lib/api/volunteering', () => ({
  getOpportunities: jest.fn(),
  getMyApplications: jest.fn(),
  getMyShifts: jest.fn(),
  getHoursSummary: jest.fn(),
  getMyOrganisations: jest.fn(),
  getVolunteerCertificates: jest.fn(),
  generateVolunteerCertificate: jest.fn().mockResolvedValue({ data: {} }),
  getVolunteerExpenses: jest.fn(),
  submitVolunteerExpense: jest.fn().mockResolvedValue({ data: {} }),
  getVolunteerGivingDays: jest.fn(),
  getVolunteerDonations: jest.fn(),
  submitVolunteerDonation: jest.fn().mockResolvedValue({ data: {} }),
  getOpportunityShifts: (...args: unknown[]) => mockGetOpportunityShifts(...args),
  requestShiftSwap: (...args: unknown[]) => mockRequestShiftSwap(...args),
  getShiftSwaps: jest.fn(),
  getOrganisation: jest.fn(),
  getOrganisationApplications: jest.fn(),
  getOrganisationPendingHours: jest.fn(),
  getOrganisationStats: jest.fn(),
  getOrganisationVolunteers: jest.fn(),
  getOrganisationWalletTransactions: jest.fn(),
  depositOrganisationWallet: jest.fn().mockResolvedValue({ data: {} }),
  setOrganisationAutoPay: jest.fn().mockResolvedValue({ data: {} }),
  updateOrganisation: jest.fn().mockResolvedValue({ data: {} }),
  verifyVolunteerHours: jest.fn().mockResolvedValue({ data: {} }),
  respondToShiftSwap: jest.fn().mockResolvedValue({ data: {} }),
  cancelShiftSwap: jest.fn().mockResolvedValue(undefined),
  expressInterest: jest.fn().mockResolvedValue({}),
  cancelShiftSignup: jest.fn().mockResolvedValue(undefined),
  withdrawApplication: jest.fn().mockResolvedValue({}),
  logVolunteerHours: jest.fn().mockResolvedValue({ data: {} }),
}));

jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/Avatar', () => 'View');

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

// --- Tests ---

import VolunteeringScreen from './volunteering';
import { useAppToast } from '@/components/ui/AppToast';

const defaultPaginatedState = {
  items: [],
  isLoading: false,
  isLoadingMore: false,
  error: null,
  hasMore: false,
  loadMore: jest.fn(),
  refresh: jest.fn(),
};

beforeEach(() => {
  mockUsePaginatedApi.mockReturnValue(defaultPaginatedState);
  mockUseApi.mockReturnValue({
    data: null,
    isLoading: false,
    error: null,
    refresh: jest.fn(),
  });
});

const mockOpportunity = {
  id: 10,
  title: 'Garden Helper',
  description: 'Help maintain the community garden.',
  status: 'open' as const,
  is_remote: false,
  location: 'Dublin',
  hours_per_week: 3,
  deadline: null,
  skills_needed: ['Gardening'],
  organisation: { id: 5, name: 'Green Spaces' },
};

describe('VolunteeringScreen', () => {
  afterEach(() => {
    mockParams = {};
  });

  /*
    A link that names a tab has to land on it. This asserts the SCREEN's half of that: given
    the parameter, the donations panel is what renders. The intent mapper's half is covered
    by `nativeIntent.test.ts`, and journey 7.2 records what was measured on a device.
  */
  /*
    🔴 A recorded donation is a PLEDGE: the server stores it as `pending`, so the campaign
    totals on the same screen cannot move and the only other evidence is a row below the
    form. Measured on a device on 2026-08-24 — 201 from the server, form cleared, "raised"
    still €0.00, and nothing said so. Silence after a successful write reads as a failure.
  */
  it('tells the member when a donation pledge has been recorded', async () => {
    mockParams = { tab: 'donations' };
    const { show } = useAppToast() as unknown as { show: jest.Mock };
    const { getByText, getByPlaceholderText } = render(<VolunteeringScreen />);

    fireEvent.changeText(getByPlaceholderText('Amount'), '25');
    fireEvent.press(getByText('Submit donation'));

    await waitFor(() =>
      expect(show).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Pledge recorded', variant: 'success' }),
      ),
    );
  });

  /**
   * 🔴 Asking for a swap existed NOWHERE on the platform before 2026-08-24 — not here, not
   * on the website — because the endpoint demanded the id of the volunteer you wanted to
   * swap with, and nothing tells a member who is on which shift. The server resolves that
   * now, so these cases pin the member's half: pick a shift, never a person.
   */
  describe('asking to swap a shift', () => {
    const shiftRow = {
      id: 66,
      application_id: 240,
      opportunity_id: 128,
      opportunity_title: 'Saturday garden session',
      start_time: '2026-08-26T10:00:00Z',
      end_time: '2026-08-26T12:00:00Z',
      capacity: 1,
      signup_count: 1,
      spots_available: 0,
      location: 'Riverside',
    };

    beforeEach(() => {
      mockParams = { tab: 'shifts' };
      mockGetOpportunityShifts.mockReset();
      mockRequestShiftSwap.mockReset().mockResolvedValue({ data: { id: 9 } });
      (useAppToast() as unknown as { show: jest.Mock }).show.mockClear();
      mockUseApi.mockImplementation(() => ({
        data: { data: { items: [shiftRow] } },
        isLoading: false,
        error: null,
        refresh: jest.fn(),
      }));
    });

    it('offers only future shifts that somebody is actually on', async () => {
      mockGetOpportunityShifts.mockResolvedValue({
        data: [
          { id: 66, start_time: '2026-08-26T10:00:00Z', end_time: '2026-08-26T12:00:00Z', capacity: 1, signup_count: 1, spots_available: 0 },
          { id: 67, start_time: '2099-08-29T10:00:00Z', end_time: '2099-08-29T12:00:00Z', capacity: 1, signup_count: 1, spots_available: 0 },
          { id: 68, start_time: '2099-08-31T10:00:00Z', end_time: '2099-08-31T12:00:00Z', capacity: 1, signup_count: 0, spots_available: 1 },
          { id: 69, start_time: '2000-01-01T10:00:00Z', end_time: '2000-01-01T12:00:00Z', capacity: 1, signup_count: 1, spots_available: 0 },
        ],
      });

      const { getByTestId, queryByTestId } = render(<VolunteeringScreen />);
      fireEvent.press(getByTestId('shift-swap-ask-66'));

      await waitFor(() => expect(getByTestId('shift-swap-option-67')).toBeTruthy());
      // Not the member's own shift, not an empty shift (nobody to swap with), not the past.
      expect(queryByTestId('shift-swap-option-66')).toBeNull();
      expect(queryByTestId('shift-swap-option-68')).toBeNull();
      expect(queryByTestId('shift-swap-option-69')).toBeNull();
    });

    it('asks by shift and never sends a member id', async () => {
      mockGetOpportunityShifts.mockResolvedValue({
        data: [{ id: 67, start_time: '2099-08-29T10:00:00Z', end_time: '2099-08-29T12:00:00Z', capacity: 1, signup_count: 1, spots_available: 0 }],
      });
      const { show } = useAppToast() as unknown as { show: jest.Mock };

      const { getByTestId } = render(<VolunteeringScreen />);
      fireEvent.press(getByTestId('shift-swap-ask-66'));
      await waitFor(() => expect(getByTestId('shift-swap-option-67')).toBeTruthy());
      fireEvent.press(getByTestId('shift-swap-option-67'));

      await waitFor(() => expect(mockRequestShiftSwap).toHaveBeenCalledWith({ from_shift_id: 66, to_shift_id: 67 }));
      // 🔴 The load-bearing assertion: no counterpart id is sent, so the app never has to
      // know — and never has to show — who is on the other shift.
      expect(mockRequestShiftSwap.mock.calls[0][0]).not.toHaveProperty('to_user_id');
      // A sent request is invisible until the other person answers, so it must be said.
      expect(show).toHaveBeenCalledWith(expect.objectContaining({ title: 'Swap request sent', variant: 'success' }));
    });

    it('says so plainly when there is nobody to swap with', async () => {
      mockGetOpportunityShifts.mockResolvedValue({
        data: [{ id: 68, start_time: '2099-08-31T10:00:00Z', end_time: '2099-08-31T12:00:00Z', capacity: 2, signup_count: 0, spots_available: 2 }],
      });

      const { getByTestId } = render(<VolunteeringScreen />);
      fireEvent.press(getByTestId('shift-swap-ask-66'));

      await waitFor(() => expect(getByTestId('shift-swap-no-options')).toBeTruthy());
    });

    it('passes the server\'s own refusal on to the member', async () => {
      mockGetOpportunityShifts.mockResolvedValue({
        data: [{ id: 67, start_time: '2099-08-29T10:00:00Z', end_time: '2099-08-29T12:00:00Z', capacity: 1, signup_count: 1, spots_available: 0 }],
      });
      // A real refusal, not a plain object: describeApiError deliberately trusts only
      // ApiResponseError, so a hand-rolled shape would silently take the fallback path and
      // this test would prove nothing.
      const { ApiResponseError } = jest.requireActual('@/lib/api/client');
      mockRequestShiftSwap.mockRejectedValue(
        new ApiResponseError(409, 'A swap request already exists for these shifts', undefined, 'ALREADY_EXISTS'),
      );
      const { show } = useAppToast() as unknown as { show: jest.Mock };

      const { getByTestId } = render(<VolunteeringScreen />);
      fireEvent.press(getByTestId('shift-swap-ask-66'));
      await waitFor(() => expect(getByTestId('shift-swap-option-67')).toBeTruthy());
      fireEvent.press(getByTestId('shift-swap-option-67'));

      await waitFor(() => expect(show).toHaveBeenCalledWith(expect.objectContaining({
        description: 'A swap request already exists for these shifts',
        variant: 'danger',
      })));
    });
  });

  it('opens the tab a link asked for', () => {
    mockParams = { tab: 'donations' };
    const { getByText } = render(<VolunteeringScreen />);
    expect(getByText('Make a donation')).toBeTruthy();
  });

  it('falls back to opportunities when the link names a tab that does not exist', () => {
    mockParams = { tab: 'not-a-tab' };
    const { getByPlaceholderText } = render(<VolunteeringScreen />);
    expect(getByPlaceholderText('Search opportunities…')).toBeTruthy();
  });

  it('renders the screen title via navigation options (no crash)', () => {
    const { toJSON } = render(<VolunteeringScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders the search input', () => {
    const { getByPlaceholderText } = render(<VolunteeringScreen />);
    expect(getByPlaceholderText('Search opportunities…')).toBeTruthy();
  });

  it('renders empty state when no items and not loading', () => {
    const { getByText } = render(<VolunteeringScreen />);
    expect(getByText('No opportunities found.')).toBeTruthy();
  });

  it('renders opportunity cards when items are provided', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      items: [mockOpportunity],
      isLoading: false,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { getByText } = render(<VolunteeringScreen />);
    expect(getByText('Garden Helper')).toBeTruthy();
    expect(getByText('Green Spaces')).toBeTruthy();
  });

  it('does not render empty state when loading', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      items: [],
      isLoading: true,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { queryByText } = render(<VolunteeringScreen />);
    expect(queryByText('No opportunities found.')).toBeNull();
  });

  it('renders status badge on opportunity card', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      items: [mockOpportunity],
      isLoading: false,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { getByText } = render(<VolunteeringScreen />);
    expect(getByText('Open')).toBeTruthy();
  });

  it('renders managed volunteering organisations and dashboard entry points', () => {
    let apiCall = 0;
    mockUseApi.mockImplementation(() => {
      const responses = [
        { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: { total_verified: 0, total_pending: 0, total_declined: 0, by_organization: [], by_month: [] } }, isLoading: false, error: null, refresh: jest.fn() },
        {
          data: {
            data: [{
              id: 5,
              name: 'Green Spaces',
              description: 'Community gardens and food growing.',
              status: 'approved',
              member_role: 'owner',
              balance: 14,
              logo_url: null,
            }],
          },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
        { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: { items: [], expenses: [], stats: {}, cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: { items: [], next_cursor: null } }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: { swaps: [] } }, isLoading: false, error: null, refresh: jest.fn() },
      ];
      const response = responses[apiCall % responses.length];
      apiCall += 1;
      return response;
    });

    const { getByText } = render(<VolunteeringScreen />);

    fireEvent.press(getByText('Organisations'));

    expect(getByText('Green Spaces')).toBeTruthy();
    expect(getByText('Community gardens and food growing.')).toBeTruthy();
    expect(getByText('14h available')).toBeTruthy();
    expect(getByText('Manage')).toBeTruthy();
  });

  it('lets approved volunteers log hours for application organisations', () => {
    let apiCall = 0;
    mockUseApi.mockImplementation(() => {
      const responses = [
        {
          data: {
            data: [{
              id: 21,
              status: 'approved',
              message: null,
              opportunity: { id: 10, title: 'Garden Helper' },
              organization: { id: 5, name: 'Green Spaces', logo_url: null },
              created_at: '2026-05-01T00:00:00Z',
            }],
          },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
        {
          data: { data: { items: [], cursor: null, has_more: false } },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
        {
          data: { data: { total_verified: 0, total_pending: 0, total_declined: 0, by_organization: [], by_month: [] } },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
        {
          data: { data: [] },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
        {
          data: { data: { items: [], cursor: null, has_more: false } },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
        {
          data: { data: { items: [], expenses: [], stats: {}, cursor: null, has_more: false } },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
        {
          data: { data: [] },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
        {
          data: { data: { items: [], next_cursor: null } },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
        {
          data: { data: { swaps: [] } },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
      ];
      const response = responses[apiCall % responses.length];
      apiCall += 1;
      return response;
    });

    const { getByText } = render(<VolunteeringScreen />);

    fireEvent.press(getByText('My Hours'));

    expect(getByText('Green Spaces')).toBeTruthy();
    expect(getByText('Log your hours.')).toBeTruthy();
  });

  it('renders confirmed volunteer shifts and cancel actions', () => {
    let apiCall = 0;
    mockUseApi.mockImplementation(() => {
      const responses = [
        {
          data: { data: [] },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
        {
          data: {
            data: {
              items: [{
                id: 42,
                opportunity_id: 10,
                opportunity_title: 'Garden Helper',
                location: 'Dublin',
                application_id: 21,
                start_time: '2026-06-01T10:00:00Z',
                end_time: '2026-06-01T12:00:00Z',
                capacity: 8,
                signup_count: 3,
                spots_available: 5,
              }],
              cursor: null,
              has_more: false,
            },
          },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
        {
          data: { data: { total_verified: 0, total_pending: 0, total_declined: 0, by_organization: [], by_month: [] } },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
        {
          data: { data: [] },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
        {
          data: { data: { items: [], cursor: null, has_more: false } },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
        {
          data: { data: { items: [], expenses: [], stats: {}, cursor: null, has_more: false } },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
        {
          data: { data: [] },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
        {
          data: { data: { items: [], next_cursor: null } },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
        {
          data: { data: { swaps: [] } },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
      ];
      const response = responses[apiCall % responses.length];
      apiCall += 1;
      return response;
    });

    const { getByText } = render(<VolunteeringScreen />);

    fireEvent.press(getByText('My Shifts'));

    expect(getByText('Garden Helper')).toBeTruthy();
    expect(getByText('Confirmed')).toBeTruthy();
    expect(getByText('Cancel shift')).toBeTruthy();
  });

  it('renders native volunteer shift swaps and received actions', () => {
    let apiCall = 0;
    mockUseApi.mockImplementation(() => {
      const responses = [
        { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: { total_verified: 0, total_pending: 0, total_declined: 0, by_organization: [], by_month: [] } }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: { items: [], expenses: [], stats: {}, cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: { items: [], next_cursor: null } }, isLoading: false, error: null, refresh: jest.fn() },
        {
          data: {
            data: {
              swaps: [{
                id: 77,
                status: 'pending',
                direction: 'received',
                requester: { id: 12, name: 'Alex Volunteer', avatar_url: null },
                recipient: { id: 1, name: 'Current User', avatar_url: null },
                original_shift: {
                  id: 42,
                  start_time: '2026-06-01T10:00:00Z',
                  end_time: '2026-06-01T12:00:00Z',
                  opportunity_title: 'Garden Helper',
                  organization_name: 'Green Spaces',
                },
                proposed_shift: {
                  id: 43,
                  start_time: '2026-06-02T10:00:00Z',
                  end_time: '2026-06-02T12:00:00Z',
                  opportunity_title: 'Food Pantry',
                  organization_name: 'Care Hub',
                },
                message: 'Can we trade shifts?',
                created_at: '2026-05-29T10:00:00Z',
              }],
            },
          },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
      ];
      const response = responses[apiCall % responses.length];
      apiCall += 1;
      return response;
    });

    const { getByText } = render(<VolunteeringScreen />);

    fireEvent.press(getByText('Swaps'));

    expect(getByText('Shift swaps')).toBeTruthy();
    expect(getByText('From Alex Volunteer')).toBeTruthy();
    expect(getByText('Garden Helper')).toBeTruthy();
    expect(getByText('Food Pantry')).toBeTruthy();
    expect(getByText('Accept')).toBeTruthy();
    expect(getByText('Reject')).toBeTruthy();
  });

  it('renders volunteer certificates in the native certificates tab', () => {
    let apiCall = 0;
    mockUseApi.mockImplementation(() => {
      const responses = [
        {
          data: { data: [] },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
        {
          data: { data: { items: [], cursor: null, has_more: false } },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
        {
          data: { data: { total_verified: 0, total_pending: 0, total_declined: 0, by_organization: [], by_month: [] } },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
        {
          data: { data: [] },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
        {
          data: {
            data: {
              items: [{
                id: 9,
                verification_code: 'ABC123',
                verification_url: 'https://api.test/verify/ABC123',
                total_hours: 12,
                date_range: { start: '2026-05-01', end: '2026-05-31' },
                organizations: [{ name: 'Green Spaces', hours: 12 }],
                generated_at: '2026-06-01T00:00:00Z',
                downloaded_at: null,
              }],
              cursor: null,
              has_more: false,
            },
          },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
        {
          data: { data: { items: [], expenses: [], stats: {}, cursor: null, has_more: false } },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
        {
          data: { data: [] },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
        {
          data: { data: { items: [], next_cursor: null } },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
        {
          data: { data: { swaps: [] } },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
      ];
      const response = responses[apiCall % responses.length];
      apiCall += 1;
      return response;
    });

    const { getByText } = render(<VolunteeringScreen />);

    fireEvent.press(getByText('Certificates'));

    expect(getByText('Volunteer certificates')).toBeTruthy();
    expect(getByText('12 verified hours')).toBeTruthy();
    expect(getByText('ABC123')).toBeTruthy();
  });

  it('renders volunteer expenses in the native expenses tab', () => {
    let apiCall = 0;
    mockUseApi.mockImplementation(() => {
      const responses = [
        { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: { total_verified: 0, total_pending: 0, total_declined: 0, by_organization: [], by_month: [] } }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: [{ id: 5, name: 'Green Spaces', status: 'approved', member_role: 'volunteer' }] }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() },
        {
          data: {
            data: {
              items: [{
                id: 7,
                expense_type: 'travel',
                amount: '12.50',
                currency: 'EUR',
                description: 'Bus ticket',
                status: 'pending',
                submitted_at: '2026-06-01T00:00:00Z',
              }],
              expenses: [],
              stats: {},
              cursor: null,
              has_more: false,
            },
          },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
        { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: { items: [], next_cursor: null } }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: { swaps: [] } }, isLoading: false, error: null, refresh: jest.fn() },
      ];
      const response = responses[apiCall % responses.length];
      apiCall += 1;
      return response;
    });

    const { getAllByText, getByText } = render(<VolunteeringScreen />);

    fireEvent.press(getByText('Expenses'));

    expect(getAllByText('Submit expense').length).toBeGreaterThan(0);
    expect(getByText('Bus ticket')).toBeTruthy();
    expect(getByText('Pending')).toBeTruthy();
  });

  it('renders volunteer giving days and donation history in the native donations tab', () => {
    let apiCall = 0;
    mockUseApi.mockImplementation(() => {
      const responses = [
        { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: { total_verified: 0, total_pending: 0, total_declined: 0, by_organization: [], by_month: [] } }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: { items: [], expenses: [], stats: {}, cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() },
        {
          data: {
            data: [{
              id: 8,
              title: 'Spring Giving Day',
              description: 'Support volunteer projects.',
              goal_amount: '500.00',
              raised_amount: '125.00',
              donor_count: 4,
              start_date: '2026-06-01',
              end_date: '2026-06-30',
              is_active: true,
            }],
          },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
        {
          data: {
            data: {
              items: [{
                id: 11,
                amount: '25.00',
                currency: 'EUR',
                payment_method: 'bank_transfer',
                message: 'For the campaign',
                is_anonymous: false,
                status: 'completed',
                giving_day_id: 8,
                created_at: '2026-06-02T00:00:00Z',
              }],
              next_cursor: null,
            },
          },
          isLoading: false,
          error: null,
          refresh: jest.fn(),
        },
        { data: { data: { swaps: [] } }, isLoading: false, error: null, refresh: jest.fn() },
      ];
      const response = responses[apiCall % responses.length];
      apiCall += 1;
      return response;
    });

    const { getAllByText, getByText } = render(<VolunteeringScreen />);

    fireEvent.press(getByText('Donations'));

    expect(getByText('Spring Giving Day')).toBeTruthy();
    expect(getByText('For the campaign')).toBeTruthy();
    expect(getByText('Completed')).toBeTruthy();
    expect(getAllByText('Submit donation').length).toBeGreaterThan(0);
  });
  /**
   * 🔴 The swap payload is REQUESTER-relative and the card labelled it viewer-relative,
   * so on every request you can actually act on, the two shifts were the wrong way round.
   *
   * `original_shift` is always the requester's own shift; `proposed_shift` is always the
   * one they are asking for. Walked on two devices 2026-08-23: UserB (on Aug 26) asked
   * UserA (on Aug 29) to swap, and UserA's card read "YOUR SHIFT — Aug 26 / PROPOSED
   * SHIFT — Aug 29". Both wrong, on the one card carrying Accept and Reject.
   *
   * The two fixtures below deliberately give the shifts different opportunity titles so
   * a swapped pairing cannot pass by coincidence.
   */
  function swapPanelApi(direction: 'sent' | 'received') {
    let apiCall = 0;
    const swap = {
      id: 77,
      status: 'pending',
      direction,
      requester: { id: 12, name: 'Alex Volunteer', avatar_url: null },
      recipient: { id: 1, name: 'Current User', avatar_url: null },
      original_shift: {
        id: 42,
        start_time: '2026-06-01T10:00:00Z',
        end_time: '2026-06-01T12:00:00Z',
        opportunity_title: 'Requester Shift',
        organization_name: 'Green Spaces',
      },
      proposed_shift: {
        id: 43,
        start_time: '2026-06-02T10:00:00Z',
        end_time: '2026-06-02T12:00:00Z',
        opportunity_title: 'Recipient Shift',
        organization_name: 'Care Hub',
      },
      message: 'Can we trade shifts?',
      created_at: '2026-05-29T10:00:00Z',
    };

    mockUseApi.mockImplementation(() => {
      const responses = [
        { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: { total_verified: 0, total_pending: 0, total_declined: 0, by_organization: [], by_month: [] } }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: { items: [], cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: { items: [], expenses: [], stats: {}, cursor: null, has_more: false } }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: { items: [], next_cursor: null } }, isLoading: false, error: null, refresh: jest.fn() },
        { data: { data: { swaps: [swap] } }, isLoading: false, error: null, refresh: jest.fn() },
      ];
      const response = responses[apiCall % responses.length];
      apiCall += 1;
      return response;
    });
  }

  it('shows the recipient THEIR OWN shift under "your shift" on a received swap', () => {
    swapPanelApi('received');

    const { getByText, getByTestId } = render(<VolunteeringScreen />);
    fireEvent.press(getByText('Swaps'));

    // The viewer is the recipient, so their shift is `proposed_shift`.
    expect(getByTestId('swap-own-detail-77').props.children.join('')).toContain('Care Hub');
    expect(getByTestId('swap-other-label-77').props.children).toBe('Their shift');
    expect(getByTestId('swap-other-detail-77').props.children.join('')).toContain('Green Spaces');
  });

  it('shows the requester their own shift under "your shift" on a sent swap', () => {
    swapPanelApi('sent');

    const { getByText, getByTestId } = render(<VolunteeringScreen />);
    fireEvent.press(getByText('Swaps'));

    // The viewer is the requester, so their shift is `original_shift`.
    expect(getByTestId('swap-own-detail-77').props.children.join('')).toContain('Green Spaces');
    expect(getByTestId('swap-other-label-77').props.children).toBe('Proposed shift');
    expect(getByTestId('swap-other-detail-77').props.children.join('')).toContain('Care Hub');
  });
});
