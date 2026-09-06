// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

// --- Mocks ---

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => ({ id: '3' }),
  useNavigation: () => ({ setOptions: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'detail.title': 'Organisation',
        'detailTitle': 'Organisation Details',
        'detail.about': 'About',
        'detail.contact': 'Contact',
        'detail.share': 'Share',
        'detail.invalidId': 'Invalid organisation ID.',
        'detail.notFound': 'Organisation not found.',
        'detail.notFoundHint': 'This organisation may have been removed.',
        'detail.browseOrganisations': 'Browse organisations',
        'detail.goBack': 'Go Back',
        'verified': 'Verified',
        'status.approved': 'Approved',
        'status.active': 'Active',
        'status.pending': 'Pending review',
        'status.declined': 'Declined',
        'website': 'Visit Website',
        'members': opts ? `${String(opts.count ?? 0)} members` : '0 members',
        'listings': opts ? `${String(opts.count ?? 0)} listings` : '0 listings',
        'opportunities': opts ? `${String(opts.count ?? 0)} opportunities` : '0 opportunities',
        'hoursLogged': opts ? `${String(opts.hours ?? 0)}h logged` : '0h logged',
        'common:errors.alertTitle': 'Error',
        'common:errors.loadFailedTitle': "Couldn't load this",
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
  useTenant: () => ({ hasFeature: () => true, tenant: { slug: 'hour-timebank' } }),
}));
jest.mock('@/components/ui/AccentIcon', () => {
  const React = require('react');
  const { View } = require('react-native');
  return () => <View testID="accent-icon" />;
});

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
  }),
}));

const mockUseApi = jest.fn();
jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/api/organisations', () => ({
  getOrganisation: jest.fn(),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/LoadingSpinner', () => () => null);

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

// --- Tests ---

import OrganisationDetailScreen from './organisation-detail';

const mockOrg = {
  id: 3,
  name: 'Dublin Community Hub',
  description: 'A vibrant hub for community services in Dublin.',
  logo: null,
  location: 'Dublin, Ireland',
  website: 'https://dublincommunityhub.ie',
  verified: true,
  members_count: 42,
  listings_count: 15,
};

beforeEach(() => {
  mockUseApi.mockReturnValue({ data: null, isLoading: false, error: null, refresh: jest.fn() });
});

describe('OrganisationDetailScreen', () => {
  it('renders without crashing when data is loaded', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockOrg },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { toJSON } = render(<OrganisationDetailScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders the organisation name', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockOrg },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<OrganisationDetailScreen />);
    expect(getByText('Dublin Community Hub')).toBeTruthy();
  });

  it('renders the Verified badge for verified organisations', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockOrg },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<OrganisationDetailScreen />);
    expect(getByText('Verified')).toBeTruthy();
  });

  it('renders the description text', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockOrg },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getAllByText } = render(<OrganisationDetailScreen />);
    expect(getAllByText('A vibrant hub for community services in Dublin.').length).toBeGreaterThan(0);
  });

  it('renders translated backend organisation statuses', () => {
    mockUseApi.mockReturnValue({
      data: { data: { ...mockOrg, verified: false, status: 'pending' } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText, queryByText } = render(<OrganisationDetailScreen />);
    expect(getByText('Pending review')).toBeTruthy();
    expect(queryByText('pending')).toBeNull();
  });

  it('renders loading state without crashing', () => {
    mockUseApi.mockReturnValue({ data: null, isLoading: true, error: null, refresh: jest.fn() });

    expect(() => render(<OrganisationDetailScreen />)).not.toThrow();
  });

  /** 🔴 S4-06. A network failure used to read as "not found" with no retry. */
  it('shows a load error with a retry instead of "not found" when the request fails', () => {
    const refresh = jest.fn();
    mockUseApi.mockReturnValue({ data: null, isLoading: false, error: 'Network down', refresh });

    const { getByTestId, getByText, queryByText } = render(<OrganisationDetailScreen />);
    expect(getByTestId('organisation-detail-error')).toBeTruthy();
    expect(getByText('Network down')).toBeTruthy();
    expect(queryByText('Organisation not found.')).toBeNull();
    fireEvent.press(getByText('Retry'));
    expect(refresh).toHaveBeenCalled();
  });

  /** S4-07. A refresh with data already on screen must not replace it with a spinner. */
  it('keeps the loaded organisation on screen while refreshing', () => {
    mockUseApi.mockReturnValue({ data: { data: mockOrg }, isLoading: true, error: null, refresh: jest.fn() });

    const { getAllByText } = render(<OrganisationDetailScreen />);
    expect(getAllByText('Dublin Community Hub').length).toBeGreaterThan(0);
  });

  /** S4-10 / S4-22. Share links carry the community slug, and the primary pill's icon takes the accent foreground. */
  it('shares a slug-prefixed web link from the accent-painted share pill', async () => {
    const { Share } = require('react-native');
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: 'sharedAction' });
    mockUseApi.mockReturnValue({ data: { data: mockOrg }, isLoading: false, error: null, refresh: jest.fn() });

    const { getAllByLabelText, queryAllByTestId } = render(<OrganisationDetailScreen />);
    // Website (secondary) and Share (secondary) pills: no accent icon; the header share is not an ActionPill.
    expect(queryAllByTestId('accent-icon')).toHaveLength(0);
    fireEvent.press(getAllByLabelText('Share')[0]);

    await waitFor(() => expect(shareSpy).toHaveBeenCalledWith({
      message: expect.stringContaining('/hour-timebank/organisations/3'),
    }));
    shareSpy.mockRestore();
  });

  it('renders not found state when data is null after loading', () => {
    mockUseApi.mockReturnValue({ data: null, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<OrganisationDetailScreen />);
    expect(getByText('Organisation not found.')).toBeTruthy();
    expect(getByText('Browse organisations')).toBeTruthy();
  });
});
