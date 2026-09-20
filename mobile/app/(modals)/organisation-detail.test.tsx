// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { Linking, RefreshControl } from 'react-native';
import * as ReactNative from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiResponseError } from '@/lib/api/client';

// --- Mocks ---
let mockRouteId: string | string[] | undefined = '3';

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => ({ id: mockRouteId }),
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
        'detail.websiteFailedTitle': 'This website could not be opened',
        'detail.websiteFailedMessage': 'The organisation gave the address. Your phone could not open it.',
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
        'volunteers': opts ? `${String(opts.count ?? 0)} volunteers` : '0 volunteers',
        'hoursLogged': opts ? `${String(opts.hours ?? 0)}h logged` : '0h logged',
        'common:errors.alertTitle': 'Error',
        'common:errors.loadFailedTitle': "Couldn't load this",
        'common:buttons.retry': 'Retry',
        'common:errors.refreshFailedTitle': 'Couldn’t refresh',
        'common:errors.refreshFailedSubtitle': 'You’re still seeing what loaded earlier.',
        'common:back': 'Back',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ hasFeature: () => true, tenant: { id: 2, slug: 'hour-timebank' } }),
}));
jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 7 } }),
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
let mockRealRead = false;
jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockRealRead ? jest.requireActual('@/lib/hooks/useApi').useApi(...args) : mockUseApi(...args),
}));

jest.mock('@/lib/api/organisations', () => ({
  getOrganisation: jest.fn(),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ModalErrorBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

// --- Tests ---

import OrganisationDetailScreen from './organisation-detail';
import { getOrganisation } from '@/lib/api/organisations';
import { useAppToast } from '@/components/ui/AppToast';

const mockOrg = {
  id: 3,
  created_at: '2026-09-19T00:00:00Z',
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
  mockRouteId = '3';
  mockRealRead = false;
  jest.mocked(getOrganisation).mockReset();
  mockUseApi.mockReturnValue({ data: null, isLoading: false, error: null, refresh: jest.fn() });
});

describe('OrganisationDetailScreen', () => {
  it('reports sharing failure and allows another attempt', async () => {
    mockUseApi.mockReturnValue({ data: { data: mockOrg }, isLoading: false, error: null, refresh: jest.fn() });
    const share = jest.spyOn(ReactNative.Share, 'share').mockRejectedValueOnce(new Error('Unavailable'))
      .mockResolvedValueOnce({ action: ReactNative.Share.dismissedAction });
    jest.mocked(useAppToast().show).mockClear();
    const screen = render(<OrganisationDetailScreen />);
    fireEvent.press(screen.getAllByLabelText('Share')[0]);
    await waitFor(() => expect(useAppToast().show).toHaveBeenCalledWith({ title: 'common:errors.generic', variant: 'danger' }));
    fireEvent.press(screen.getAllByLabelText('Share')[0]);
    await waitFor(() => expect(share).toHaveBeenCalledTimes(2));
    expect(useAppToast().show).toHaveBeenCalledTimes(1);
    share.mockRestore();
  });

  it('ignores repeated share presses and late errors after leaving the record', async () => {
    mockUseApi.mockReturnValue({ data: { data: mockOrg }, isLoading: false, error: null, refresh: jest.fn() });
    let rejectShare!: (reason: Error) => void;
    const share = jest.spyOn(ReactNative.Share, 'share').mockImplementation(() => new Promise((_resolve, reject) => { rejectShare = reject; }));
    jest.mocked(useAppToast().show).mockClear();
    const screen = render(<OrganisationDetailScreen />);
    fireEvent.press(screen.getAllByLabelText('Share')[0]);
    fireEvent.press(screen.getAllByLabelText('Share')[1]);
    expect(share).toHaveBeenCalledTimes(1);
    screen.unmount();
    await act(async () => rejectShare(new Error('Late failure')));
    expect(useAppToast().show).not.toHaveBeenCalled();
    share.mockRestore();
  });

  it.each(['Infinity', '1.5', '1e2', '0x10', '9007199254740993', '-3', '0', '', undefined, ['3', '4'], ['3']].map(id => [id]))('rejects invalid route id %s without requesting a record', async (id) => {
    mockRouteId = id;
    mockRealRead = true;
    const screen = render(<OrganisationDetailScreen />);
    expect(screen.getByText('Invalid organisation ID.')).toBeTruthy();
    expect(getOrganisation).not.toHaveBeenCalled();
  });

  it('loads a single valid route id', async () => {
    mockRouteId = '3';
    mockRealRead = true;
    jest.mocked(getOrganisation).mockResolvedValue({ data: mockOrg });
    const screen = render(<OrganisationDetailScreen />);
    await screen.findByText(mockOrg.name);
    expect(getOrganisation).toHaveBeenCalledWith(3);
  });

  it('does not restore the previous record when its late response arrives after changing routes', async () => {
    mockRealRead = true;
    let resolveOld!: (value: { data: typeof mockOrg }) => void;
    jest.mocked(getOrganisation)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ data: { ...mockOrg, id: 4, name: 'New organisation' } });
    const screen = render(<OrganisationDetailScreen />);
    mockRouteId = '4';
    screen.rerender(<OrganisationDetailScreen />);
    await screen.findByText('New organisation');
    await act(async () => resolveOld({ data: mockOrg }));
    expect(screen.queryByText(mockOrg.name)).toBeNull();
    expect(screen.getByText('New organisation')).toBeTruthy();
  });

  it.each([401, 403, 404])('removes previously loaded details and actions after refresh returns %s', async (status) => {
    mockRealRead = true;
    jest.mocked(getOrganisation)
      .mockResolvedValueOnce({ data: mockOrg })
      .mockRejectedValueOnce(new ApiResponseError(status, 'Unavailable'));
    const screen = render(<OrganisationDetailScreen />);
    await screen.findByText(mockOrg.name);
    await act(async () => screen.UNSAFE_getByType(RefreshControl).props.onRefresh());
    await screen.findByTestId('organisation-detail-refused');
    expect(screen.queryByText(mockOrg.name)).toBeNull();
    expect(screen.queryByText(mockOrg.description)).toBeNull();
    expect(screen.queryByText('Visit Website')).toBeNull();
    expect(screen.queryAllByLabelText('Share')).toHaveLength(0);
    expect(getOrganisation).toHaveBeenCalledTimes(2);
  });

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

  it('maps the API volunteer and opportunity metrics instead of showing unrelated zero member/listing tiles', () => {
    mockUseApi.mockReturnValue({
      data: { data: { ...mockOrg, members_count: undefined, listings_count: undefined, volunteer_count: 42, opportunity_count: 15 } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText, queryByText } = render(<OrganisationDetailScreen />);
    expect(getByText('42 volunteers')).toBeTruthy();
    expect(getByText('15 opportunities')).toBeTruthy();
    expect(queryByText('0 members')).toBeNull();
    expect(queryByText('0 listings')).toBeNull();
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

  it('stacks the identity, actions and metrics without truncating content at large text', () => {
    const dimensions = jest.spyOn(ReactNative, 'useWindowDimensions').mockReturnValue({ width: 360, height: 800, scale: 1, fontScale: 2 });
    mockUseApi.mockReturnValue({ data: { data: mockOrg }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByTestId, getByText } = render(<OrganisationDetailScreen />);
    expect(getByTestId('organisation-detail-identity').props.className).not.toContain('flex-row');
    expect(getByTestId('organisation-detail-actions').props.className).not.toContain('flex-row');
    expect(getByTestId('organisation-detail-stats').props.className).not.toContain('flex-row');
    expect(getByText('Dublin Community Hub').props.numberOfLines).toBeUndefined();

    dimensions.mockRestore();
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

  it('warns that loaded organisation details are stale when refresh fails and retries in place', () => {
    const refresh = jest.fn();
    mockUseApi.mockReturnValue({ data: { data: mockOrg }, isLoading: false, error: 'Network down', refresh });

    const { getByTestId, getByLabelText } = render(<OrganisationDetailScreen />);
    expect(getByTestId('refresh-failed-notice')).toBeTruthy();
    fireEvent.press(getByLabelText('Retry'));
    expect(refresh).toHaveBeenCalledTimes(1);
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

  describe('opening the organisation website', () => {
    /*
      🔴 Both halves of the old opener were unwrapped promises. `canOpenURL` throws on
      Android when the scheme is not in the manifest's query list, and `openURL` rejects on
      a malformed address or a device with no browser — and an organisation's website is
      typed in by that organisation, so a malformed one is ordinary. The rejection went
      nowhere and the member saw nothing happen at all.

      Spied on the real `Linking` the screen imports, rather than module-mocked: a mock of
      the internal path is not necessarily the object `react-native`'s barrel re-exports
      under jest-expo, and the failure cases would then have passed for the wrong reason.
    */
    let canOpenURL: jest.SpyInstance;
    let openURL: jest.SpyInstance;

    beforeEach(() => {
      canOpenURL = jest.spyOn(Linking, 'canOpenURL');
      openURL = jest.spyOn(Linking, 'openURL');
      (useAppToast().show as jest.Mock).mockClear();
      mockUseApi.mockReturnValue({ data: { data: mockOrg }, isLoading: false, error: null, refresh: jest.fn() });
    });

    afterEach(() => {
      canOpenURL.mockRestore();
      openURL.mockRestore();
    });

    it('opens a website the phone can handle', async () => {
      canOpenURL.mockResolvedValue(true);
      openURL.mockResolvedValue(undefined);

      const { getByText } = render(<OrganisationDetailScreen />);
      fireEvent.press(getByText('Visit Website'));

      await waitFor(() => expect(openURL).toHaveBeenCalledWith('https://dublincommunityhub.ie'));
    });

    it('opens the website even when handler discovery throws', async () => {
      canOpenURL.mockRejectedValue(new Error('no query permission'));
      openURL.mockResolvedValue(undefined);

      const { getByText } = render(<OrganisationDetailScreen />);
      fireEvent.press(getByText('Visit Website'));

      await waitFor(() => expect(openURL).toHaveBeenCalledWith(mockOrg.website));
      expect(useAppToast().show).not.toHaveBeenCalled();
    });

    it.each([
      ['example.org/about', 'https://example.org/about'],
      ['example.org:8443/about', 'https://example.org:8443/about'],
      [' HTTPS://example.org/about ', 'HTTPS://example.org/about'],
      ['http://example.org', 'http://example.org'],
    ])('opens a valid website %s without relying on handler discovery', async (website, expected) => {
      canOpenURL.mockResolvedValue(false);
      openURL.mockResolvedValue(undefined);
      mockUseApi.mockReturnValue({ data: { data: { ...mockOrg, website } }, isLoading: false, error: null, refresh: jest.fn() });
      const screen = render(<OrganisationDetailScreen />);
      fireEvent.press(screen.getByText('Visit Website'));
      await waitFor(() => expect(openURL).toHaveBeenCalledWith(expected));
      expect(useAppToast().show).not.toHaveBeenCalled();
    });

    it.each(['https://', 'javascript:alert(1)', 'mailto:contact@example.org', '   '])('reports an unusable website %s without handing it to the phone', async (website) => {
      canOpenURL.mockResolvedValue(true);
      openURL.mockResolvedValue(undefined);
      mockUseApi.mockReturnValue({ data: { data: { ...mockOrg, website } }, isLoading: false, error: null, refresh: jest.fn() });
      const screen = render(<OrganisationDetailScreen />);
      fireEvent.press(screen.getByText('Visit Website'));
      await waitFor(() => expect(useAppToast().show).toHaveBeenCalledWith(expect.objectContaining({ title: 'This website could not be opened' })));
      expect(openURL).not.toHaveBeenCalled();
    });

    it('says so when opening the address rejects', async () => {
      canOpenURL.mockResolvedValue(true);
      openURL.mockRejectedValue(new Error('no browser installed'));

      const { getByText } = render(<OrganisationDetailScreen />);
      fireEvent.press(getByText('Visit Website'));

      await waitFor(() => expect(useAppToast().show).toHaveBeenCalledWith(expect.objectContaining({
        title: 'This website could not be opened',
        variant: 'danger',
      })));
    });
  });
});
