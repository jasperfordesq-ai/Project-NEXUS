// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => ({
      'venues:verify.title': 'Record a visit',
      'venues:verify.intro': 'Confirm this member is visiting your venue.',
      'venues:verify.confirm_button': 'Record visit',
      'venues:verify.invalid': 'This check-in link is not valid.',
      'venues:verify.error': 'The visit could not be recorded.',
      'venues:verify.choose_venue_intro': 'Which venue is this?',
      'venues:verify.recorded': `Visit recorded for ${String(values?.name ?? '')}`,
      'venues:verify.already_recorded': `Already recorded today for ${String(values?.name ?? '')}`,
      'venues:verify.visits_this_month': `${String(values?.count ?? 0)} visits this month`,
      'venues:loading': 'Working…',
      'common:back': 'Back',
    } as Record<string, string>)[key] ?? key,
  }),
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ bg: '#fff', text: '#111', textSecondary: '#555', textMuted: '#777' }),
}));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/lib/api/venues', () => ({ recordPartnerVenueVisit: jest.fn() }));

import VenueCheckInScreen from './venue-checkin';
import { recordPartnerVenueVisit } from '@/lib/api/venues';
import { ApiResponseError } from '@/lib/api/client';

describe('VenueCheckInScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = { token: 'pass-token' };
  });

  it('records the visit and reports it back with the monthly count', async () => {
    jest.mocked(recordPartnerVenueVisit).mockResolvedValue({
      status: 'recorded',
      member: { id: 3, name: 'Ada Member' },
      venue: { id: 1, name: 'The Corner Café' },
      visits_this_month: 2,
    } as never);
    const { getByText } = render(<VenueCheckInScreen />);
    fireEvent.press(getByText('Record visit'));
    await waitFor(() => expect(getByText('Visit recorded for Ada Member')).toBeTruthy());
    expect(recordPartnerVenueVisit).toHaveBeenCalledWith('pass-token', undefined);
    expect(getByText('The Corner Café')).toBeTruthy();
    expect(getByText('2 visits this month')).toBeTruthy();
  });

  it('asks which venue when the pass covers more than one, then records against the chosen one', async () => {
    jest.mocked(recordPartnerVenueVisit)
      .mockResolvedValueOnce({
        status: 'needs_venue',
        venues: [{ id: 1, name: 'The Corner Café' }, { id: 2, name: 'Community Gym' }],
      } as never)
      .mockResolvedValueOnce({
        status: 'recorded',
        member: { id: 3, name: 'Ada Member' },
        venue: { id: 2, name: 'Community Gym' },
      } as never);
    const { getByText } = render(<VenueCheckInScreen />);
    fireEvent.press(getByText('Record visit'));
    await waitFor(() => expect(getByText('Which venue is this?')).toBeTruthy());
    fireEvent.press(getByText('Community Gym'));
    await waitFor(() => expect(getByText('Visit recorded for Ada Member')).toBeTruthy());
    expect(recordPartnerVenueVisit).toHaveBeenLastCalledWith('pass-token', 2);
  });

  it('reports a visit that was already recorded today rather than double-counting it', async () => {
    jest.mocked(recordPartnerVenueVisit).mockResolvedValue({
      status: 'already_recorded_today',
      member: { id: 3, name: 'Ada Member' },
    } as never);
    const { getByText } = render(<VenueCheckInScreen />);
    fireEvent.press(getByText('Record visit'));
    await waitFor(() => expect(getByText('Already recorded today for Ada Member')).toBeTruthy());
  });

  it('surfaces the server refusal', async () => {
    jest.mocked(recordPartnerVenueVisit).mockRejectedValue(new ApiResponseError(422, 'Pass has expired'));
    const { getByText } = render(<VenueCheckInScreen />);
    fireEvent.press(getByText('Record visit'));
    await waitFor(() => expect(getByText('Pass has expired')).toBeTruthy());
  });

  it('refuses a check-in with no token at all', () => {
    mockParams = {};
    const { getByText, queryByText } = render(<VenueCheckInScreen />);
    expect(getByText('This check-in link is not valid.')).toBeTruthy();
    expect(queryByText('Record visit')).toBeNull();
    expect(recordPartnerVenueVisit).not.toHaveBeenCalled();
  });
});
