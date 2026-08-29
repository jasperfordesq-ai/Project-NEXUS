// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
let mockFeatures: Record<string, boolean> = { partner_venues: true };

jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args), back: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => ({
      'directory.title': 'Partner venues',
      'directory.intro': 'Show your pass to claim member offers.',
      'directory.my_pass': 'My pass',
      'directory.empty': 'No partner venues yet.',
      'directory.visit_website': 'Visit website',
      'verify.unavailable': 'Partner venues are not enabled for your community.',
      'categories.cafe': 'Café',
      'common:buttons.retry': 'Retry',
      'common:back': 'Back',
    } as Record<string, string>)[key] ?? key,
  }),
}));
jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
  useTenant: () => ({ hasFeature: (name: string) => Boolean(mockFeatures[name]) }),
}));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ bg: '#fff', text: '#111', textSecondary: '#555', textMuted: '#777', border: '#ddd' }),
}));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/lib/api/venues', () => ({ getPartnerVenues: jest.fn() }));

import VenuesScreen from './venues';
import { getPartnerVenues } from '@/lib/api/venues';
import { ApiResponseError } from '@/lib/api/client';

describe('VenuesScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFeatures = { partner_venues: true };
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    jest.mocked(getPartnerVenues).mockResolvedValue([
      {
        id: 1,
        name: 'The Corner Café',
        category: 'cafe',
        offer_summary: '10% off for members',
        description: 'Independent coffee shop.',
        address_line: '2 High Street',
        city: 'Cork',
        postcode: 'T12 ABC',
        website: 'https://example.org/cafe',
      },
      { id: 2, name: 'Community Gym' },
    ] as never);
  });

  it('lists venues with their offer, category and address', async () => {
    const { getByText } = render(<VenuesScreen />);
    await waitFor(() => expect(getByText('The Corner Café')).toBeTruthy());
    expect(getByText('Café')).toBeTruthy();
    expect(getByText('10% off for members')).toBeTruthy();
    expect(getByText('2 High Street, Cork, T12 ABC')).toBeTruthy();
    expect(getByText('Community Gym')).toBeTruthy();
  });

  it('opens the member pass from the header', async () => {
    const { getByText } = render(<VenuesScreen />);
    await waitFor(() => expect(getByText('My pass')).toBeTruthy());
    fireEvent.press(getByText('My pass'));
    expect(mockPush).toHaveBeenCalledWith('/(modals)/venue-pass');
  });

  it('opens the venue website when a card with one is pressed', async () => {
    const { getByLabelText } = render(<VenuesScreen />);
    await waitFor(() => expect(getByLabelText('Visit website: The Corner Café')).toBeTruthy());
    fireEvent.press(getByLabelText('Visit website: The Corner Café'));
    expect(Linking.openURL).toHaveBeenCalledWith('https://example.org/cafe');
  });

  it('says so, and calls nothing, when the community has no partner venues module', async () => {
    mockFeatures = { partner_venues: false };
    const { getByText } = render(<VenuesScreen />);
    await waitFor(() => expect(getByText('Partner venues are not enabled for your community.')).toBeTruthy());
    expect(getPartnerVenues).not.toHaveBeenCalled();
  });

  it('offers a retry when the directory cannot be loaded', async () => {
    jest.mocked(getPartnerVenues).mockRejectedValue(new ApiResponseError(403, 'Venues unavailable'));
    const { getByText } = render(<VenuesScreen />);
    await waitFor(() => expect(getByText('Venues unavailable')).toBeTruthy());
    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(getPartnerVenues).toHaveBeenCalledTimes(2));
  });
});
