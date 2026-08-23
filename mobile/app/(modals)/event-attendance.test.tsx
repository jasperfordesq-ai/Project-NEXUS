// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockRefresh = jest.fn();
const mockShowToast = jest.fn();
const mockTransitionAttendance = jest.fn();

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: '7' }),
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
    confirm: ({ onConfirm }: { onConfirm: () => void }) => onConfirm(),
    confirmDialog: null,
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({ usePrimaryColor: () => '#006FEE' }));
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

jest.mock('@/lib/hooks/useApi', () => ({
  useApi: () => ({ data: mockRoster, isLoading: false, error: null, refresh: mockRefresh }),
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

beforeEach(() => {
  jest.clearAllMocks();
  mockTransitionAttendance.mockReset();
  mockTransitionAttendance.mockResolvedValue({
    data: {
      member: { id: 44, display_name: 'Taylor Member' },
      mutation: { attendance_version: 1 },
    },
  });
});

describe('EventAttendanceScreen', () => {
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
});
