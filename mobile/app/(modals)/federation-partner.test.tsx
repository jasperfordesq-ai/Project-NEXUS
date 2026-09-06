// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { Share } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';

// --- Mocks ---

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => ({ id: 'ext-2' }),
  useNavigation: () => ({ setOptions: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'detail.title': 'Partner Details',
        'detail.eyebrow': 'Federated timebank',
        'detail.about': 'About',
        'detail.members': 'members',
        'detail.memberTotal': 'Member count',
        'detail.memberCount': opts ? `${String(opts.count ?? 0)} members` : 'members',
        'detail.partnerSince': opts ? `Partner since ${String(opts.date ?? '')}` : 'Partner since',
        'detail.partnerSinceLabel': 'Partner since',
        'detail.connectedDate': opts ? `Connected ${String(opts.date ?? '')}` : 'Connected',
        'detail.level': 'Federation level',
        'detail.levelIntegrated': 'Integrated',
        'detail.availableFeatures': 'Available features',
        'detail.externalPartner': 'External partner',
        'detail.integratedPartner': 'Integrated partner',
        'detail.website': 'Website',
        'detail.share': 'Share partner',
        'detail.shareMessage': opts ? `${String(opts.name ?? '')} — ${String(opts.url ?? '')}` : 'Share',
        'detail.noDescription': 'No description.',
        'detail.explorePartner': 'Explore this partner',
        'detail.browseMembers': 'Browse members',
        'detail.browseListings': 'Browse listings',
        'detail.browseGroups': 'Browse groups',
        'detail.browseEvents': 'Browse events',
        'detail.openMessages': 'Open messages',
        'detail.federationSettings': 'Federation settings',
        'detail.browseNetwork': 'Back to federation',
        'detail.retry': 'Retry',
        'detail.permissionProfiles': 'Profiles',
        'detail.permissionMessaging': 'Messaging',
        'detail.permissionTransactions': 'Transactions',
        'detail.permissionListings': 'Listings',
        'detail.permissionEvents': 'Events',
        'detail.permissionGroups': 'Groups',
        'detail.notFound': 'Partner not found.',
        'detail.goBack': 'Go Back',
        'visitWebsite': 'Visit Website',
        'common:back': 'Back',
        'connectedSince': opts ? `Connected since ${String(opts.date ?? '')}` : 'Connected since',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ tenant: { slug: 'hour-timebank' } }),
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
  }),
}));

const mockUseApi = jest.fn();
jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/api/federation', () => ({
  getFederationPartner: jest.fn(),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/AppTopBar', () => 'View');

// --- Tests ---

import FederationPartnerScreen from './federation-partner';

const mockPartner = {
  id: 'ext-2',
  name: 'TimeOverflow Local',
  tagline: 'A trusted federation partner for wider timebank discovery.',
  description: 'Serving the Cork community with time-based exchanges.',
  logo: null,
  location: 'Cork, Ireland',
  country: 'Ireland',
  website: 'https://corktimebank.ie',
  member_count: 128,
  connected_since: '2025-06-01T00:00:00Z',
  partnership_since: '2025-06-01T00:00:00Z',
  federation_level: 4,
  federation_level_name: 'Integrated',
  permissions: ['profiles', 'messaging', 'transactions', 'listings', 'events', 'groups'],
  is_external: true,
};

beforeEach(() => {
  mockUseApi.mockReturnValue({ data: null, isLoading: false, error: null, refresh: jest.fn() });
});

describe('FederationPartnerScreen', () => {
  it('renders without crashing when data is loaded', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockPartner },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { toJSON } = render(<FederationPartnerScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders the partner name', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockPartner },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<FederationPartnerScreen />);
    expect(getByText('TimeOverflow Local')).toBeTruthy();
  });

  it('renders the partner description', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockPartner },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<FederationPartnerScreen />);
    expect(getByText('Serving the Cork community with time-based exchanges.')).toBeTruthy();
  });

  it('renders external federation metadata and features', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockPartner },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getAllByText, getByText } = render(<FederationPartnerScreen />);
    expect(getByText('External partner')).toBeTruthy();
    expect(getAllByText('Integrated').length).toBeGreaterThan(0);
    expect(getByText('Available features')).toBeTruthy();
    expect(getByText('Profiles')).toBeTruthy();
    expect(getByText('Messaging')).toBeTruthy();
  });

  it('renders the Visit Website button', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockPartner },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<FederationPartnerScreen />);
    expect(getByText('Visit Website')).toBeTruthy();
  });

  it('renders and routes the partner federation branches', () => {
    mockUseApi.mockReturnValue({
      data: { data: mockPartner },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { router } = require('expo-router');
    const { getByText } = render(<FederationPartnerScreen />);

    expect(getByText('Explore this partner')).toBeTruthy();
    fireEvent.press(getByText('Browse groups'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(modals)/federation-groups',
      params: { partner_id: 'ext-2' },
    });

    fireEvent.press(getByText('Federation settings'));
    expect(router.push).toHaveBeenCalledWith('/(modals)/federation-settings');
  });

  it('shares the React partner detail route for deep links', () => {
    const shareSpy = jest.spyOn(Share, 'share').mockResolvedValue({ action: Share.sharedAction });
    mockUseApi.mockReturnValue({
      data: { data: mockPartner },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText } = render(<FederationPartnerScreen />);

    fireEvent.press(getByText('Share partner'));

    // The link carries the member's own community: a bare platform host lands the
    // recipient on the wrong community for anyone on a custom domain (audit 2026-09-06).
    expect(shareSpy).toHaveBeenCalledWith({
      message: 'TimeOverflow Local — https://app.project-nexus.ie/hour-timebank/federation/partners/ext-2',
    });
    shareSpy.mockRestore();
  });

  it('renders loading state without crashing', () => {
    mockUseApi.mockReturnValue({ data: null, isLoading: true, error: null, refresh: jest.fn() });

    expect(() => render(<FederationPartnerScreen />)).not.toThrow();
  });

  it('renders not found state when data is null after loading', () => {
    mockUseApi.mockReturnValue({ data: null, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<FederationPartnerScreen />);
    expect(getByText('Partner not found.')).toBeTruthy();
    expect(getByText('Back to federation')).toBeTruthy();
  });
});
