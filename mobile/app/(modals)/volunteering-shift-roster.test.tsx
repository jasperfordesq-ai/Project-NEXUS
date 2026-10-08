// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('@/lib/observability/report', () => ({ reportException: jest.fn() }));

const mockPush = jest.fn();
let mockRouteParams: Record<string, string> = { shiftId: '44', label: 'Sat 15 Mar 2099, 10:00 – 13:00', started: '0' };

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: (...args: unknown[]) => mockPush(...args), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => mockRouteParams,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const o = opts ?? {};
      const map: Record<string, string> = {
        'roster.title': 'Who is on this shift',
        'roster.loadError': 'Could not load who is on this shift.',
        'roster.notYoursTitle': 'You do not manage this shift',
        'roster.notYoursHint': 'Only the people who run the opportunity can see who is coming.',
        'roster.empty': 'Nobody has signed up to this shift yet.',
        'roster.summary.signedUp': 'Signed up',
        'roster.summary.checkedIn': 'Checked in',
        'roster.summary.noShow': "Didn't come",
        'roster.summary.groupPlaces': 'Places held by groups',
        'roster.summary.waiting': 'On the waitlist',
        'roster.volunteersHeading': 'Volunteers',
        'roster.noVolunteers': 'No individual volunteers yet.',
        'roster.checkedInAt': `Checked in at ${String(o.time ?? '')}`,
        'roster.checkedOutAt': `Checked out at ${String(o.time ?? '')}`,
        'roster.status.checked_in': 'Checked in',
        'roster.status.checked_out': 'Checked out',
        'roster.status.no_show': "Didn't come",
        'roster.status.pending': 'Not checked in',
        'roster.status.notYet': 'Coming',
        'roster.status.notCheckedIn': 'Not checked in',
        'roster.groupsHeading': 'Group bookings',
        'roster.groupPlaces': `Places: ${String(o.n ?? 0)}`,
        'roster.groupLeader': `Booked by ${String(o.name ?? '')}`,
        'roster.waitlistHeading': 'Waitlist',
        'roster.waitlistPosition': `Place in queue: ${String(o.position ?? '')}`,
        'roster.checkInsHeading': 'Check-in log',
        'roster.checkInsEmpty': 'No check-ins recorded for this shift.',
        'roster.checkInsError': 'Could not load the check-in log.',
        'roster.openProfile': `Open profile for ${String(o.name ?? '')}`,
        'common:back': 'Back',
        'common:buttons.retry': 'Retry',
        'common:errors.notFound': 'Not found.',
        'common:errors.refreshFailedTitle': 'Couldn’t refresh',
        'common:errors.refreshFailedSubtitle': 'You’re still seeing what loaded earlier.',
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { id: 2, slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ bg: '#fff', surface: '#f8f9fa', text: '#111', textSecondary: '#666', textMuted: '#999', error: '#dc2626', errorBg: '#fee2e2', success: '#16a34a', warning: '#f59e0b', border: '#ddd' }),
}));
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/Avatar', () => 'View');

const mockUseApi = jest.fn();
jest.mock('@/lib/hooks/useApi', () => ({ useApi: (...args: unknown[]) => mockUseApi(...args) }));
jest.mock('@/lib/api/volunteeringOrganiser', () => {
  const actual = jest.requireActual('@/lib/api/volunteeringOrganiser');
  return { ...actual, getShiftRoster: jest.fn(() => 'roster'), getShiftCheckIns: jest.fn(() => 'checkins') };
});

import ShiftRoster from './volunteering-shift-roster';

type ApiState = { data: unknown; isLoading: boolean; error: string | null; errorStatus: number | null; errorCode: string | null; refresh: jest.Mock };
const ok = (data: unknown, refresh = jest.fn()): ApiState => ({ data, isLoading: false, error: null, errorStatus: null, errorCode: null, refresh });

const ROSTER = {
  summary: { signed_up: 2, checked_in: 1, no_show: 0, group_places: 3, waiting: 1 },
  volunteers: [
    { user: { id: 9, name: 'Alex Volunteer', avatar_url: null }, check_in_status: 'checked_in', checked_in_at: '2099-03-15 10:02:00', checked_out_at: null },
    { user: { id: 10, name: 'Bea Helper', avatar_url: null }, check_in_status: null, checked_in_at: null, checked_out_at: null },
  ],
  groups: [{ id: 3, group_name: 'Scouts', reserved_slots: 3, leader: { id: 11, name: 'Cal Leader', avatar_url: null }, members: [{ id: 12, name: 'Dee Member', avatar_url: null }] }],
  waitlist: [{ user: { id: 13, name: 'Eve Waiting', avatar_url: null }, position: 1 }],
};

function mockApis(states: Partial<Record<'roster' | 'checkins', ApiState>> = {}) {
  const defaults: Record<string, ApiState> = {
    roster: ok({ data: ROSTER }),
    checkins: ok({ data: { checkins: [{ id: 1, user: { id: 9, name: 'Alex Volunteer', avatar_url: null }, status: 'checked_in', checked_in_at: '2099-03-15 10:02:00', checked_out_at: null }] } }),
  };
  mockUseApi.mockImplementation((fetchFn: () => unknown, _deps: unknown[], options?: { enabled?: boolean }) => {
    if (options?.enabled === false) return ok(null);
    const tag = fetchFn() as string;
    return states[tag as 'roster'] ?? defaults[tag];
  });
}

describe('ShiftRoster', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRouteParams = { shiftId: '44', label: 'Sat 15 Mar 2099, 10:00 – 13:00', started: '0' };
    mockApis();
  });

  it('shows who is coming, who checked in, group bookings, the waitlist and the check-in log', () => {
    const screen = render(<ShiftRoster />);

    expect(screen.getByTestId('shift-roster-label')).toBeTruthy();
    expect(screen.getByTestId('shift-roster-summary')).toBeTruthy();
    expect(screen.getByTestId('shift-roster-volunteer-9')).toBeTruthy();
    expect(screen.getAllByText('Checked in').length).toBeGreaterThan(0);
    // Before the shift starts, a volunteer with no check-in is simply "Coming".
    expect(screen.getByText('Coming')).toBeTruthy();
    expect(screen.getByText('Scouts')).toBeTruthy();
    expect(screen.getByText('Places: 3')).toBeTruthy();
    expect(screen.getByText('Booked by Cal Leader')).toBeTruthy();
    expect(screen.getByText('Dee Member')).toBeTruthy();
    expect(screen.getByText('Place in queue: 1')).toBeTruthy();
    expect(screen.getByTestId('shift-roster-checkin-1')).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Open profile for Bea Helper'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(modals)/member-profile', params: { id: '10' } });
  });

  it('calls an absent volunteer "Not checked in" once the shift has started', () => {
    mockRouteParams = { shiftId: '44', label: '', started: '1' };
    const screen = render(<ShiftRoster />);
    expect(screen.getByText('Not checked in')).toBeTruthy();
    expect(screen.queryByText('Coming')).toBeNull();
  });

  it('says nobody has signed up only when every list is empty', () => {
    mockApis({
      roster: ok({ data: { summary: { signed_up: 0, checked_in: 0, no_show: 0, group_places: 0, waiting: 0 }, volunteers: [], groups: [], waitlist: [] } }),
      checkins: ok({ data: { checkins: [] } }),
    });
    const screen = render(<ShiftRoster />);
    expect(screen.getByTestId('shift-roster-empty')).toBeTruthy();
    expect(screen.getByText('No check-ins recorded for this shift.')).toBeTruthy();
  });

  it('says the shift is not theirs rather than offering a retry', () => {
    mockApis({ roster: { data: null, isLoading: false, error: 'Forbidden', errorStatus: 403, errorCode: 'FORBIDDEN', refresh: jest.fn() } });
    const screen = render(<ShiftRoster />);
    expect(screen.getByTestId('shift-roster-refused')).toBeTruthy();
    expect(screen.queryByText('Retry')).toBeNull();
  });

  it('offers a retry on a load failure and never claims the shift is empty', () => {
    const refresh = jest.fn();
    mockApis({ roster: { data: null, isLoading: false, error: 'Network down', errorStatus: 500, errorCode: null, refresh } });
    const screen = render(<ShiftRoster />);
    expect(screen.getByTestId('shift-roster-error')).toBeTruthy();
    expect(screen.queryByTestId('shift-roster-empty')).toBeNull();
    fireEvent.press(screen.getByText('Retry'));
    expect(refresh).toHaveBeenCalled();
  });

  it('keeps the roster when only the check-in log fails, with its own retry', () => {
    const refresh = jest.fn();
    mockApis({ checkins: { data: null, isLoading: false, error: 'Network down', errorStatus: 500, errorCode: null, refresh } });
    const screen = render(<ShiftRoster />);
    expect(screen.getByTestId('shift-roster-volunteer-9')).toBeTruthy();
    expect(screen.getByTestId('shift-roster-checkins-error')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Retry'));
    expect(refresh).toHaveBeenCalled();
  });
});
