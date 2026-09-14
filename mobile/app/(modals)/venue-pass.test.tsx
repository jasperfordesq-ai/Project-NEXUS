// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
const mockToast = jest.fn();
let mockFeatures: Record<string, boolean> = { partner_venues: true };

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: (...args: unknown[]) => mockPush(...args), back: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock('react-native-qrcode-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  return ({ value }: { value: string }) => <View testID="venue-pass-qr" accessibilityLabel={value} />;
});
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'pass.title': 'My venue pass',
      'pass.intro': 'Show this code at a partner venue.',
      'pass.qr_alt': 'Your venue pass QR code',
      'pass.active': 'Active',
      'pass.show_to_staff': 'Show this to venue staff.',
      'pass.rotate': 'Replace pass',
      'pass.rotate_hint': 'Your current code stops working immediately.',
      'pass.rotated': 'Pass replaced',
      'pass.rotate_failed': 'Could not replace the pass',
      'pass.recent_visits': 'Recent visits',
      'pass.no_visits': 'No visits recorded yet.',
      'pass.browse_venues': 'Browse venues',
      'pass.unavailable': 'Pass unavailable',
      'venues:loading': 'Working…',
      'verify.unavailable': 'Partner venues are not enabled for your community.',
      'common:buttons.retry': 'Retry',
      'common:buttons.cancel': 'Cancel',
      'common:back': 'Back',
    } as Record<string, string>)[key] ?? key,
  }),
}));
jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
  useTenant: () => ({ hasFeature: (name: string) => Boolean(mockFeatures[name]), tenant: { id: 2 } }),
}));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ displayName: 'Ada Member', user: { id: 7 } }) }));
jest.mock('@/components/ui/AppToast', () => ({ useAppToast: () => ({ show: (...args: unknown[]) => mockToast(...args) }) }));
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    confirm: (opts: { onConfirm: () => void | Promise<void> }) => { void opts.onConfirm(); },
    confirmDialog: null,
  }),
}));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/lib/api/venues', () => ({
  getPartnerVenuePass: jest.fn(),
  getPartnerVenueVisits: jest.fn(),
  rotatePartnerVenuePass: jest.fn(),
}));

import VenuePassScreen from './venue-pass';
import { getPartnerVenuePass, getPartnerVenueVisits, rotatePartnerVenuePass } from '@/lib/api/venues';
import { ApiResponseError } from '@/lib/api/client';

describe('VenuePassScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFeatures = { partner_venues: true };
    jest.mocked(getPartnerVenuePass).mockResolvedValue({
      token: 'abc', qr_url: 'https://example.org/pass/abc', status: 'active', last_used_at: null,
    } as never);
    jest.mocked(getPartnerVenueVisits).mockResolvedValue([
      { id: 5, venue_id: 1, venue_name: 'The Corner Café', visited_on: '2026-08-20' },
    ] as never);
    jest.mocked(rotatePartnerVenuePass).mockResolvedValue({} as never);
  });

  it('renders the pass QR code, the member name and recent visits', async () => {
    const { getByText, getByTestId } = render(<VenuePassScreen />);
    await waitFor(() => expect(getByTestId('venue-pass-qr')).toBeTruthy());
    expect(getByTestId('venue-pass-qr').props.accessibilityLabel).toBe('https://example.org/pass/abc');
    expect(getByText('Ada Member')).toBeTruthy();
    expect(getByText('The Corner Café')).toBeTruthy();
    expect(getByText('2026-08-20')).toBeTruthy();
  });

  it('rotates the pass and confirms it to the member', async () => {
    const { getByText } = render(<VenuePassScreen />);
    await waitFor(() => expect(getByText('Replace pass')).toBeTruthy());
    fireEvent.press(getByText('Replace pass'));
    await waitFor(() => expect(rotatePartnerVenuePass).toHaveBeenCalled());
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith({ title: 'Pass replaced', variant: 'success' }));
  });

  it('tells the member when rotating the pass failed', async () => {
    jest.mocked(rotatePartnerVenuePass).mockRejectedValue(new ApiResponseError(500, 'nope'));
    const { getByText } = render(<VenuePassScreen />);
    await waitFor(() => expect(getByText('Replace pass')).toBeTruthy());
    fireEvent.press(getByText('Replace pass'));
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith({ title: 'Could not replace the pass', variant: 'danger' }));
  });

  it('serializes pass replacement and shows the returned pass without waiting for a refresh', async () => {
    let finish: ((value: unknown) => void) | null = null;
    jest.mocked(rotatePartnerVenuePass).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }) as never);
    const { getByText } = render(<VenuePassScreen />);
    await waitFor(() => expect(getByText('Replace pass')).toBeTruthy());

    act(() => {
      fireEvent.press(getByText('Replace pass'));
      fireEvent.press(getByText('Replace pass'));
    });
    expect(rotatePartnerVenuePass).toHaveBeenCalledTimes(1);

    await act(async () => finish?.({ token: 'new', qr_url: 'https://example.org/pass/new', status: 'active', last_used_at: null }));
  });

  it('recovers the current valid pass when replacement committed but its response was lost', async () => {
    jest.mocked(getPartnerVenuePass)
      .mockResolvedValueOnce({ token: 'abc', qr_url: 'https://example.org/pass/abc', status: 'active', last_used_at: null } as never)
      .mockResolvedValueOnce({ token: 'new', qr_url: 'https://example.org/pass/new', status: 'active', last_used_at: null } as never);
    jest.mocked(rotatePartnerVenuePass).mockRejectedValueOnce(new ApiResponseError(0, 'Connection lost'));
    const { getByText, getByTestId } = render(<VenuePassScreen />);
    await waitFor(() => expect(getByText('Replace pass')).toBeTruthy());
    fireEvent.press(getByText('Replace pass'));

    await waitFor(() => expect(getByTestId('venue-pass-qr').props.accessibilityLabel).toBe('https://example.org/pass/new'));
    expect(mockToast).toHaveBeenCalledWith({ title: 'Pass replaced', variant: 'success' });
  });

  it('browses the venue directory', async () => {
    const { getByText } = render(<VenuePassScreen />);
    await waitFor(() => expect(getByText('Browse venues')).toBeTruthy());
    fireEvent.press(getByText('Browse venues'));
    expect(mockPush).toHaveBeenCalledWith('/(modals)/venues');
  });

  it('reports a visit-history failure while retaining the usable pass', async () => {
    jest.mocked(getPartnerVenueVisits).mockRejectedValue(new ApiResponseError(403, 'Could not load recent visits'));
    const { getByTestId } = render(<VenuePassScreen />);

    await waitFor(() => expect(getByTestId('venue-pass-qr')).toBeTruthy());
    await waitFor(() => expect(getByTestId('refresh-failed-notice')).toBeTruthy());
    expect(getByTestId('venue-pass-qr')).toBeTruthy();
  });

  it('says so, and calls nothing, when the community has no partner venues module', async () => {
    mockFeatures = { partner_venues: false };
    const { getByText } = render(<VenuePassScreen />);
    await waitFor(() => expect(getByText('Partner venues are not enabled for your community.')).toBeTruthy());
    expect(getPartnerVenuePass).not.toHaveBeenCalled();
  });
});
