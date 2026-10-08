// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('@/lib/observability/report', () => ({ reportException: jest.fn() }));

let mockParams: Record<string, string> = {};
let mockVolunteeringConfig: Record<string, unknown> = {};

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
  useNavigation: () => ({ setOptions: jest.fn(), addListener: jest.fn(() => jest.fn()) }),
}));
jest.mock('react-native-qrcode-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ value }: { value: string }) => <View testID="shift-code-qr" accessibilityLabel={value} />;
});
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'volunteeringVolunteer:code.title': 'My check-in code',
        'volunteeringVolunteer:code.intro': 'Show this to your organiser.',
        'volunteeringVolunteer:code.qrLabel': 'Your check-in QR code',
        'volunteeringVolunteer:code.codeHeading': 'Code',
        'volunteeringVolunteer:code.status.pending': 'Not checked in yet',
        'volunteeringVolunteer:code.status.checked_in': 'Checked in',
        'volunteeringVolunteer:code.status.checked_out': 'Checked out',
        'volunteeringVolunteer:code.status.no_show': 'Marked as not attended',
        'volunteeringVolunteer:code.checkedInAt': `Checked in ${String(opts?.time ?? '')}`,
        'volunteeringVolunteer:code.checkedOutAt': `Checked out ${String(opts?.time ?? '')}`,
        'volunteeringVolunteer:code.refresh': 'Refresh status',
        'volunteeringVolunteer:code.loadError': 'Could not load your check-in code.',
        'volunteeringVolunteer:code.notYours': 'This shift is not one you hold.',
        'volunteeringVolunteer:code.switchedOff': 'QR check-in is switched off here.',
        'volunteeringVolunteer:unavailable.title': 'Not available in this community',
        'volunteeringVolunteer:unavailable.body': 'Switched off here.',
        'volunteeringVolunteer:unavailable.back': 'Back to volunteering',
        'common:buttons.retry': 'Retry',
        'common:back': 'Back',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));
jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ hasFeature: () => true, tenant: { id: 2, slug: 'e2e', volunteering_config: mockVolunteeringConfig } }),
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#fff', surface: '#f8f9fa', text: '#000', textSecondary: '#666', textMuted: '#999',
    border: '#ddd', borderSubtle: '#eee', error: '#e53e3e', success: '#16a34a', warning: '#f59e0b',
  }),
}));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ isAuthenticated: true, user: { id: 7 } }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/lib/api/volunteeringVolunteer', () => ({
  ...jest.requireActual('@/lib/api/volunteeringVolunteer'),
  getShiftCheckIn: jest.fn(),
}));

import ShiftCodeScreen from './volunteer-shift-code';
import { getShiftCheckIn } from '@/lib/api/volunteeringVolunteer';
import { ApiResponseError } from '@/lib/api/client';

const checkIn = {
  id: 3,
  qr_token: 'abc123def456',
  qr_url: 'https://app.project-nexus.ie/e2e/volunteering/checkin/abc123def456',
  status: 'pending',
  checked_in_at: null,
  checked_out_at: null,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { id: '44', title: 'Garden tidy' };
  mockVolunteeringConfig = {};
  jest.mocked(getShiftCheckIn).mockResolvedValue({ data: checkIn });
});

describe('ShiftCodeScreen', () => {
  it('shows the QR of the check-in URL, the code text and the pending status', async () => {
    const { getByTestId, getByText } = render(<ShiftCodeScreen />);
    await waitFor(() => expect(getByTestId('shift-code-qr')).toBeTruthy());
    expect(getShiftCheckIn).toHaveBeenCalledWith(44);
    // The website encodes qr_url, not the bare token; the organiser's scanner opens it.
    expect(getByTestId('shift-code-qr').props.accessibilityLabel).toBe(checkIn.qr_url);
    expect(getByText('abc123def456')).toBeTruthy();
    expect(getByText('Not checked in yet')).toBeTruthy();
    expect(getByText('Garden tidy')).toBeTruthy();
  });

  it('shows the checked-in time once the organiser has scanned it, and can refresh', async () => {
    jest.mocked(getShiftCheckIn)
      .mockResolvedValueOnce({ data: checkIn })
      .mockResolvedValueOnce({ data: { ...checkIn, status: 'checked_in', checked_in_at: '2026-11-02T09:05:00Z' } });
    const { getByText, getByTestId } = render(<ShiftCodeScreen />);
    await waitFor(() => expect(getByText('Not checked in yet')).toBeTruthy());
    fireEvent.press(getByTestId('shift-code-refresh'));
    await waitFor(() => expect(getByText('Checked in')).toBeTruthy());
    expect(getShiftCheckIn).toHaveBeenCalledTimes(2);
  });

  it('tells a refusal from a failure: a 404 is "not your shift", with no retry button', async () => {
    jest.mocked(getShiftCheckIn).mockRejectedValueOnce(new ApiResponseError(404, 'Not found'));
    const { getByText, queryByTestId } = render(<ShiftCodeScreen />);
    await waitFor(() => expect(getByText('This shift is not one you hold.')).toBeTruthy());
    expect(queryByTestId('shift-code-retry')).toBeNull();
  });

  it('offers a retry on an ordinary failure', async () => {
    jest.mocked(getShiftCheckIn).mockRejectedValueOnce(new ApiResponseError(422, 'Broken'));
    const { getByTestId } = render(<ShiftCodeScreen />);
    await waitFor(() => expect(getByTestId('shift-code-retry')).toBeTruthy());
    fireEvent.press(getByTestId('shift-code-retry'));
    await waitFor(() => expect(getByTestId('shift-code-qr')).toBeTruthy());
  });

  it('refuses without fetching when the community has QR check-in off', () => {
    mockVolunteeringConfig = { 'volunteering.enable_qr_checkin': false };
    const { getByText } = render(<ShiftCodeScreen />);
    expect(getByText('Not available in this community')).toBeTruthy();
    expect(getShiftCheckIn).not.toHaveBeenCalled();
  });

  it('refuses a missing shift id without fetching', () => {
    mockParams = {};
    const { getByText } = render(<ShiftCodeScreen />);
    expect(getByText('This shift is not one you hold.')).toBeTruthy();
    expect(getShiftCheckIn).not.toHaveBeenCalled();
  });
});
