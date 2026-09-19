// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ScrollView } from 'react-native';

const mockRefresh = jest.fn();
const mockShowToast = jest.fn();
const mockTransitionAttendance = jest.fn();
const mockConfirm = jest.fn();
let mockRealApi = false;
let mockParams: { id?: string | string[] } = { id: '7' };

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => mockParams,
  router: { canGoBack: () => true, back: jest.fn(), replace: jest.fn() },
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));

jest.mock('@/components/ui/AppTopBar', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return ({ title }: { title: string }) => <Text>{title}</Text>;
});
jest.mock('@/components/ui/Avatar', () => () => null);
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/events/EventOfflineCheckinCard', () => {
  const React = require('react');
  const { Text } = require('react-native');

  return () => <Text>Offline check-in device workspace</Text>;
});
jest.mock('@/components/ui/AppToast', () => ({
  useAppToast: () => ({ show: mockShowToast }),
}));
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    confirm: (...args: unknown[]) => mockConfirm(...args),
    confirmDialog: null,
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { id: 2, slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }), usePrimaryColor: () => '#006FEE' }));
jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 3, name: 'Current User' } }),
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    text: '#111111',
    textSecondary: '#555555',
    textMuted: '#777777',
    error: '#b91c1c',
  }),
}));

const mockRoster = {
  data: [{
    member: { id: 44, display_name: 'Taylor Member', avatar_url: null },
    registration: { state: 'confirmed' },
    attendance: {
      id: null,
      state: 'not_checked_in',
      version: null,
      changed_at: null,
      checked_in_at: null,
      checked_out_at: null,
    },
    management_actions: {
      check_in: true,
      check_out: false,
      no_show: true,
      undo_attendance: false,
      idempotency_key_required: true,
    },
    privacy: { projection: 'attendance', sensitive_fields_redacted: true },
  }],
  meta: {
    base_url: 'https://test.api',
    current_page: 1,
    per_page: 25,
    total: 1,
    total_pages: 1,
    has_more: false,
    search: null,
    registration_state: null,
    waitlist_state: null,
    attendance_state: null,
    engagement_state: null,
    sort: 'name',
    direction: 'asc',
    sensitive_fields_redacted: true,
    projection: 'attendance',
    capabilities: {
      view_roster: true,
      view_waitlist: false,
      manage_registration: false,
      manage_attendance: true,
      export_people: false,
      view_history: true,
    },
    metrics: { confirmed: 1, checked_in: 0, checked_out: 0, no_show: 0, attended: 0 },
  },
};

// Overridable so the refusal case below can be expressed. It was a fixed literal,
// which is why no test could reach the error branch at all.
let mockApiOverride: Record<string, unknown> | null = null;
jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockRealApi ? jest.requireActual('@/lib/hooks/useApi').useApi(...args) : ({
    data: mockRoster,
    isLoading: false,
    error: null,
    errorStatus: null,
    errorCode: null,
    refresh: mockRefresh,
    ...(mockApiOverride ?? {}),
  }),
}));

jest.mock('@/lib/api/client', () => ({
  ApiResponseError: class ApiResponseError extends Error {
    status: number;
    constructor(mockStatus: number, mockMessage: string) {
      super(mockMessage);
      this.status = mockStatus;
    }
  },
}));

jest.mock('@/lib/api/events', () => ({
  getEventAttendanceRoster: jest.fn(),
  transitionEventAttendance: (...args: unknown[]) => mockTransitionAttendance(...args),
}));

import EventAttendanceScreen from './event-attendance';
import { ApiResponseError } from '@/lib/api/client';
import { getEventAttendanceRoster } from '@/lib/api/events';

beforeEach(() => {
  mockRealApi = false;
  mockParams = { id: '7' };
  jest.clearAllMocks();
  mockConfirm.mockImplementation(({ onConfirm }: { onConfirm: () => void }) => onConfirm());
  mockApiOverride = null;
  mockTransitionAttendance.mockReset();
  mockTransitionAttendance.mockResolvedValue({
    data: {
      member: { id: 44, display_name: 'Taylor Member' },
      mutation: { attendance_version: 1 },
    },
  });
});

describe('EventAttendanceScreen', () => {
  it.each([undefined, '', '0', '-1', '1.5', 'Infinity', 'NaN', '9007199254740992', '1e2', '0x10', ['7'], ['7', '8']])('rejects malformed route ID %j without loading attendance or offline tools', (id) => {
    mockRealApi = true;
    mockParams = { id };
    const screen = render(<EventAttendanceScreen />);
    expect(getEventAttendanceRoster).not.toHaveBeenCalled();
    expect(screen.queryByText('Offline check-in device workspace')).toBeNull();
    expect(screen.queryByLabelText('Search confirmed attendees')).toBeNull();
  });
  it('keeps confirmed check-in visible until a current roster supplies the next actions', async () => {
    mockRealApi = true;
    jest.mocked(getEventAttendanceRoster).mockResolvedValue(mockRoster as never);
    let finishRefresh!: (value: unknown) => void;
    const screen = render(<EventAttendanceScreen />);
    await screen.findByText('Taylor Member');
    jest.mocked(getEventAttendanceRoster).mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve as (value: unknown) => void; }));
    mockTransitionAttendance.mockResolvedValueOnce({ data: {
      member: { id: 44, display_name: 'Taylor Member' },
      mutation: { attendance_id: 8, event_id: 7, user_id: 44, action: 'check_in', from_state: 'not_checked_in', to_state: 'checked_in', changed: true, idempotent_replay: false, attendance_version: 1, changed_at: null, checked_in_at: null, checked_out_at: null, history_entry_id: 1 },
    } });
    fireEvent.press(screen.getByText('Check in'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' })));
    expect(screen.queryByText('Check in')).toBeNull();
    expect(screen.queryAllByText('Not checked in')).toHaveLength(1); // Filter label remains; the stale row state does not.
    expect(screen.queryByLabelText('Attendance summary')).toBeNull();
    await act(async () => finishRefresh(mockRoster));
    expect(screen.queryByText('Check in')).toBeNull();
    expect(screen.queryAllByText('Not checked in')).toHaveLength(1); // Filter label remains; the stale row state does not.
    const current = { ...mockRoster, data: [{ ...mockRoster.data[0], attendance: { ...mockRoster.data[0].attendance, id: 8, state: 'checked_in', version: 1 }, management_actions: { ...mockRoster.data[0].management_actions, check_in: false, no_show: false, check_out: true } }] };
    jest.mocked(getEventAttendanceRoster).mockResolvedValueOnce(current as never);
    act(() => screen.UNSAFE_getAllByType(ScrollView).find(view => view.props.refreshControl)?.props.refreshControl.props.onRefresh());
    expect(await screen.findByText('Check out')).toBeTruthy();
    expect(screen.getByLabelText('Attendance summary')).toBeTruthy();
    expect(mockTransitionAttendance).toHaveBeenCalledTimes(1);
  });
  it('does not submit a delayed no-show confirmation after leaving attendance', async () => {
    mockConfirm.mockImplementation(() => undefined);
    const screen = render(<EventAttendanceScreen />);
    fireEvent.press(screen.getByText('Mark no-show'));
    const confirmation = mockConfirm.mock.calls[0][0];
    screen.unmount();

    await act(async () => confirmation.onConfirm());

    expect(mockTransitionAttendance).not.toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it('renders only the bounded attendance workspace and server-granted actions', () => {
    const screen = render(<EventAttendanceScreen />);

    expect(screen.getByText('Taylor Member')).toBeTruthy();
    expect(screen.getByText('Offline check-in device workspace')).toBeTruthy();
    expect(screen.getByText('Check in')).toBeTruthy();
    expect(screen.getByText('Mark no-show')).toBeTruthy();
    expect(screen.queryByText('Export CSV')).toBeNull();
    expect(screen.queryByText('History')).toBeNull();
    expect(screen.queryByText('Scan QR code')).toBeNull();
  });

  it('uses one stable idempotency key in the canonical attendance mutation', async () => {
    const screen = render(<EventAttendanceScreen />);
    fireEvent.press(screen.getByText('Check in'));

    await waitFor(() => {
      expect(mockTransitionAttendance).toHaveBeenCalledWith(7, 44, {
        action: 'check_in',
        expectedVersion: 0,
        idempotencyKey: expect.stringMatching(/^mobile-attendance-7-44-check_in-v0-/),
      });
      expect(mockRefresh).toHaveBeenCalled();
      expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'success' }));
    });
  });

  it('serializes rapid attendance actions before the busy state renders', async () => {
    let resolveTransition!: (value: unknown) => void;
    mockTransitionAttendance.mockImplementationOnce(() => new Promise((resolve) => {
      resolveTransition = resolve;
    }));
    const screen = render(<EventAttendanceScreen />);

    act(() => {
      fireEvent.press(screen.getByText('Check in'));
      fireEvent.press(screen.getByText('Mark no-show'));
    });

    expect(mockTransitionAttendance).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveTransition({ data: { mutation: { attendance_version: 1 } } });
    });
  });

  it('reuses the same idempotency key when a failed action is retried', async () => {
    mockTransitionAttendance
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ data: { mutation: { attendance_version: 1 } } });
    const screen = render(<EventAttendanceScreen />);

    fireEvent.press(screen.getByText('Check in'));
    await waitFor(() => {
      expect(mockTransitionAttendance).toHaveBeenCalledTimes(1);
      expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' }));
    });
    fireEvent.press(screen.getByText('Check in'));
    await waitFor(() => expect(mockTransitionAttendance).toHaveBeenCalledTimes(2));

    expect(mockTransitionAttendance.mock.calls[1][2].idempotencyKey)
      .toBe(mockTransitionAttendance.mock.calls[0][2].idempotencyKey);
  });

  it('refreshes the roster and warns when an attendance version conflicts', async () => {
    mockTransitionAttendance.mockRejectedValueOnce(new ApiResponseError(409, 'conflict'));
    const screen = render(<EventAttendanceScreen />);

    fireEvent.press(screen.getByText('Check in'));

    await waitFor(() => {
      expect(mockRefresh).toHaveBeenCalled();
      expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'warning' }));
    });
  });

  /**
   * 🔴 A contract-drift throw happens AFTER the server has committed the transition, so
   * an unexpected failure could leave the roster showing the state before the attempt.
   * Measured on a device 2026-08-23: the attendance row landed and the organiser was
   * looking at "Not checked in" under "Attendance not updated" — their only reasonable
   * next move being to tap again, which then really did fail. Whatever went wrong, the
   * roster must end up showing the server's state.
   */
  it('refreshes the roster even when the action fails for an unexpected reason', async () => {
    mockTransitionAttendance.mockRejectedValueOnce(new ApiResponseError(422, 'EVENTS_CONTRACT_DRIFT'));
    const screen = render(<EventAttendanceScreen />);

    fireEvent.press(screen.getByText('Check in'));

    await waitFor(() => {
      expect(mockShowToast).toHaveBeenCalledWith(expect.objectContaining({ variant: 'danger' }));
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  it('requires confirmation before recording a no-show', async () => {
    const screen = render(<EventAttendanceScreen />);
    fireEvent.press(screen.getByText('Mark no-show'));

    await waitFor(() => {
      expect(mockTransitionAttendance).toHaveBeenCalledWith(7, 44, expect.objectContaining({ action: 'no_show' }));
    });
  });

  /*
    🔴 A refusal is not a failure. A member who is not the organiser — or was removed
    as one — used to be told "we could not load the attendance list" beside a Try
    again button that could never work. Audit 2026-09-07, fixed 2026-09-08.
  */
  it('says the roster is not theirs on a 403, with no dead Try again', () => {
    mockApiOverride = { data: null, error: 'Forbidden', errorStatus: 403 };

    const screen = render(<EventAttendanceScreen />);

    expect(screen.getByTestId('event-attendance-refused')).toBeTruthy();
    expect(screen.queryByText('Retry')).toBeNull();
  });

  it('clears roster and metrics after refusal and keeps them hidden while retrying', async () => {
    mockRealApi = true;
    jest.mocked(getEventAttendanceRoster).mockResolvedValueOnce(mockRoster as never);
    const screen = render(<EventAttendanceScreen />);
    await screen.findByText('Taylor Member');
    expect(screen.getByLabelText('Attendance summary')).toBeTruthy();
    const refresh = () => screen.UNSAFE_getAllByType(ScrollView).find(view => view.props.refreshControl)?.props.refreshControl.props.onRefresh();
    jest.mocked(getEventAttendanceRoster).mockRejectedValueOnce(new ApiResponseError(403, 'Forbidden'));
    act(refresh);
    await screen.findByTestId('event-attendance-refused');
    expect(screen.queryByLabelText('Attendance summary')).toBeNull();
    expect(screen.queryByText('Taylor Member')).toBeNull();
    let finish!: (value: unknown) => void;
    jest.mocked(getEventAttendanceRoster).mockImplementationOnce(() => new Promise(resolve => { finish = resolve as (value: unknown) => void; }));
    act(refresh);
    expect(screen.queryByText('Taylor Member')).toBeNull();
    expect(screen.queryByText('Check in')).toBeNull();
    await act(async () => finish(mockRoster));
    expect(await screen.findByText('Taylor Member')).toBeTruthy();
  });

  it('still offers Retry for a server failure, which retrying can fix', () => {
    mockApiOverride = { data: null, error: 'Server error', errorStatus: 500 };

    const screen = render(<EventAttendanceScreen />);

    expect(screen.queryByTestId('event-attendance-refused')).toBeNull();
    expect(screen.getByText('Retry')).toBeTruthy();
  });
});
