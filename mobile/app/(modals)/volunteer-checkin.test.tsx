// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => ({
      'volunteering:check_in.verify_title': 'Volunteer check-in',
      'volunteering:check_in.verify_intro': 'Confirm this volunteer has arrived.',
      'volunteering:check_in.confirm_button': 'Check in',
      'volunteering:check_in.checkout_button': 'Check out',
      'volunteering:check_in.success': `Checked in ${String(values?.name ?? '')}`,
      'volunteering:check_in.checkout_success': `Checked out ${String(values?.name ?? '')}`,
      'volunteering:check_in.invalid': 'This check-in link is not valid.',
      'volunteering:check_in.error': 'The check-in could not be completed.',
      'volunteering:loading': 'Working…',
      'common:back': 'Back',
    } as Record<string, string>)[key] ?? key,
  }),
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ bg: '#fff', text: '#111', textSecondary: '#555', textMuted: '#777' }),
}));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/lib/api/volunteering', () => ({
  verifyVolunteerCheckIn: jest.fn(),
  checkOutVolunteer: jest.fn(),
}));

import VolunteerCheckInScreen from './volunteer-checkin';
import { checkOutVolunteer, verifyVolunteerCheckIn } from '@/lib/api/volunteering';
import { ApiResponseError } from '@/lib/api/client';

describe('VolunteerCheckInScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { token: 'shift-token' };
    jest.mocked(verifyVolunteerCheckIn).mockResolvedValue({ user: { id: 4, name: 'Ada Member' } } as never);
    jest.mocked(checkOutVolunteer).mockResolvedValue(undefined as never);
  });

  it('checks the volunteer in and then out again on the same token', async () => {
    const { getByText } = render(<VolunteerCheckInScreen />);
    fireEvent.press(getByText('Check in'));
    await waitFor(() => expect(getByText('Checked in Ada Member')).toBeTruthy());
    expect(verifyVolunteerCheckIn).toHaveBeenCalledWith('shift-token');

    fireEvent.press(getByText('Check out'));
    await waitFor(() => expect(getByText('Checked out Ada Member')).toBeTruthy());
    expect(checkOutVolunteer).toHaveBeenCalledWith('shift-token');
  });

  it('surfaces a refused check-in', async () => {
    jest.mocked(verifyVolunteerCheckIn).mockRejectedValue(new ApiResponseError(422, 'Shift has not started'));
    const { getByText } = render(<VolunteerCheckInScreen />);
    fireEvent.press(getByText('Check in'));
    await waitFor(() => expect(getByText('Shift has not started')).toBeTruthy());
  });

  it('surfaces a refused check-out', async () => {
    jest.mocked(checkOutVolunteer).mockRejectedValue(new ApiResponseError(422, 'Already checked out'));
    const { getByText } = render(<VolunteerCheckInScreen />);
    fireEvent.press(getByText('Check in'));
    await waitFor(() => expect(getByText('Check out')).toBeTruthy());
    fireEvent.press(getByText('Check out'));
    await waitFor(() => expect(getByText('Already checked out')).toBeTruthy());
  });

  it('refuses a check-in with no token at all', () => {
    mockParams = {};
    const { getByText, queryByText } = render(<VolunteerCheckInScreen />);
    expect(getByText('This check-in link is not valid.')).toBeTruthy();
    expect(queryByText('Check in')).toBeNull();
    expect(verifyVolunteerCheckIn).not.toHaveBeenCalled();
  });
});
