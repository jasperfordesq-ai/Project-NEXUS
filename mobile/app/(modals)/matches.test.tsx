// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockUseApi = jest.fn();
const mockPush = jest.fn();
const mockDismissMatch = jest.fn();
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
  useLocalSearchParams: () => mockParams,
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn() }),
  useFocusEffect: jest.fn(),
}));
jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    text: '#111827',
    textSecondary: '#4b5563',
    textMuted: '#6b7280',
    success: '#22c55e',
    warning: '#f59e0b',
    error: '#ef4444',
    onPrimary: '#ffffff',
  }),
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/AppTopBar', () => {
  const { Text } = require('react-native');
  return function MockAppTopBar({ title }: { title: string }) {
    return <Text>{title}</Text>;
  };
});
jest.mock('@/components/ui/LoadingSpinner', () => () => null);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        'matches.title': 'Matches',
        'matches.subtitle': 'Recommended opportunities across your timebank.',
        'matches.total': 'Total matches',
        'matches.average': 'Average score',
        'matches.hot': 'Hot matches',
        'matches.sources': 'Sources',
        'matches.filter.all': 'All',
        'matches.filter.listing': 'Listings',
        'matches.filter.job': 'Jobs',
        'matches.filter.volunteering': 'Volunteering',
        'matches.filter.group': 'Groups',
        'matches.source.listing': 'Listing',
        'matches.source.job': 'Job',
        'matches.source.volunteering': 'Volunteering',
        'matches.source.group': 'Group',
        'matches.score': opts ? `${String(opts.score)}% match` : '0% match',
        'matches.open': 'Open match',
        'matches.dismiss': 'Dismiss',
        'matches.emptyTitle': 'No matches yet',
        'matches.emptySubtitle': 'New recommendations will appear here when they are available.',
        'matches.errorTitle': 'Could not load matches',
        'matches.empty.locationTitle': 'Add your area to see matches',
        'matches.empty.locationBody': 'We match on what is near you.',
        'matches.empty.locationAction': 'Add my area',
        'matches.empty.pausedTitle': 'Matching is paused',
        'matches.empty.pausedBody': 'Your settings have matching turned off.',
        'matches.empty.pausedAction': 'Adjust match preferences',
        'matches.empty.listingsTitle': 'Post something to start matching',
        'matches.empty.listingsBody': 'Matches are built around what you offer.',
        'matches.empty.listingsAction': 'Post an offer or request',
        'matchPreferences.heading': 'Match preferences',
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('@/lib/api/matches', () => ({
  getMatches: jest.fn(),
  dismissMatch: (...args: unknown[]) => mockDismissMatch(...args),
}));

import MatchesScreen from './matches';

const listingMatch = {
  id: 1,
  source_type: 'listing',
  source_id: 10,
  match_score: 87,
  title: 'Garden help',
  description: 'Someone nearby needs help.',
  reasons: ['Shared skill', 'Nearby'],
  matched_at: '2026-05-29T10:00:00Z',
};

const jobMatch = {
  id: 2,
  source_type: 'job',
  source_id: 20,
  match_score: 62,
  title: 'Community organiser',
  description: null,
  reasons: ['Experience'],
  matched_at: '2026-05-29T11:00:00Z',
};

describe('MatchesScreen', () => {
  beforeEach(() => {
    mockParams = {};
    mockPush.mockClear();
    mockDismissMatch.mockResolvedValue({});
    mockUseApi.mockReturnValue({
      data: {
        data: [listingMatch, jobMatch],
        meta: { needsLocation: false, degraded: false, degradedReason: null, hasActiveListings: true, paused: false },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });
  });

  /**
   * 🔴 An empty matches list has a reason and the server sends it. Measured against the
   * live API on 2026-08-24: the fixture member got zero listing matches with
   * `needs_location: true, degraded_reason: "no_coordinates"` — the engine cannot consider
   * a physical listing for someone with no area — and the screen said "No matches yet",
   * which reads as "nobody suits you".
   */
  function emptyWith(meta: Record<string, unknown>) {
    mockUseApi.mockReturnValue({
      data: {
        data: [],
        meta: { needsLocation: false, degraded: false, degradedReason: null, hasActiveListings: true, paused: false, ...meta },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });
  }

  it('keeps preferences reachable even when matching is active and results exist', () => {
    const { getByLabelText } = render(<MatchesScreen />);

    fireEvent.press(getByLabelText('Match preferences'));
    expect(mockPush).toHaveBeenCalledWith('/(modals)/match-preferences');
  });

  it('says a missing area is why there are no matches, and offers to fix it', () => {
    emptyWith({ needsLocation: true, degraded: true, degradedReason: 'no_coordinates' });

    const { getByText, getByTestId } = render(<MatchesScreen />);

    expect(getByTestId('matches-empty-location')).toBeTruthy();
    expect(getByText('Add your area to see matches')).toBeTruthy();
    fireEvent.press(getByText('Add my area'));
    expect(mockPush).toHaveBeenCalledWith('/(modals)/edit-profile');
  });

  it('says matching is paused and opens the native preferences screen', () => {
    emptyWith({ paused: true });

    const { getByText, getByTestId } = render(<MatchesScreen />);

    expect(getByTestId('matches-empty-paused')).toBeTruthy();
    expect(getByText('Matching is paused')).toBeTruthy();
    fireEvent.press(getByText('Adjust match preferences'));
    expect(mockPush).toHaveBeenCalledWith('/(modals)/match-preferences');
  });

  it('asks for a first listing when the member has none', () => {
    emptyWith({ hasActiveListings: false });

    const { getByText, getByTestId } = render(<MatchesScreen />);

    expect(getByTestId('matches-empty-listings')).toBeTruthy();
    fireEvent.press(getByText('Post an offer or request'));
    expect(mockPush).toHaveBeenCalledWith('/(modals)/new-exchange');
  });

  it('does not blame the location when the member has matches but the filter has none', () => {
    // A volunteering match exists; the Listings tab is empty. The member is not missing a
    // location — this tab simply has nothing in it.
    mockUseApi.mockReturnValue({
      data: {
        data: [{ ...jobMatch, source_type: 'volunteering' }],
        meta: { needsLocation: true, degraded: true, degradedReason: 'no_coordinates', hasActiveListings: true, paused: false },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText, queryByTestId } = render(<MatchesScreen />);

    fireEvent.press(getByText('Listings'));

    expect(queryByTestId('matches-empty-location')).toBeNull();
    expect(queryByTestId('matches-empty-none')).toBeTruthy();
  });

  it('keeps the plain wording when the server gives no reason', () => {
    emptyWith({});

    const { getByText, getByTestId } = render(<MatchesScreen />);

    expect(getByTestId('matches-empty-none')).toBeTruthy();
    expect(getByText('No matches yet')).toBeTruthy();
  });

  it('does not invent a "no listings" reason when the server did not say', () => {
    // `has_active_listings` absent means "not told". Reading that as false would put a
    // wrong explanation in front of the member.
    mockUseApi.mockReturnValue({
      data: { data: [], meta: { needsLocation: false, degraded: false, degradedReason: null, hasActiveListings: true, paused: false } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByTestId } = render(<MatchesScreen />);

    expect(getByTestId('matches-empty-none')).toBeTruthy();
  });

  it('renders match stats and cards', () => {
    const { getAllByText, getByText } = render(<MatchesScreen />);

    expect(getAllByText('Matches').length).toBeGreaterThan(0);
    expect(getByText('Total matches')).toBeTruthy();
    expect(getByText('Garden help')).toBeTruthy();
    expect(getByText('87% match')).toBeTruthy();
    expect(getByText('Shared skill')).toBeTruthy();
  });

  it('filters matches by source type', () => {
    const { getByText, queryByText } = render(<MatchesScreen />);

    fireEvent.press(getByText('Jobs'));

    expect(getByText('Community organiser')).toBeTruthy();
    expect(queryByText('Garden help')).toBeNull();
  });

  it('honours hot and mutual-match notification parameters while the screen opens', () => {
    mockParams = { type: 'mutual', highlight: 'listing-10' };
    mockUseApi.mockReturnValue({
      data: {
        data: [
          { ...jobMatch, match_type: 'potential' },
          { ...listingMatch, match_type: 'mutual' },
        ],
        meta: { needsLocation: false, degraded: false, degradedReason: null, hasActiveListings: true, paused: false },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByTestId, getByText, queryByText } = render(<MatchesScreen />);

    expect(getByTestId('match-card-listing-10')).toHaveStyle({ borderWidth: 2 });
    expect(getByText('Garden help')).toBeTruthy();
    expect(queryByText('Community organiser')).toBeNull();
  });

  it('opens and dismisses listing matches', async () => {
    const { getAllByText, getByText } = render(<MatchesScreen />);

    fireEvent.press(getAllByText('Open match')[0]);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(modals)/exchange-detail', params: { id: '10' } });

    fireEvent.press(getByText('Dismiss'));
    await waitFor(() => expect(mockDismissMatch).toHaveBeenCalledWith(10));
  });
});
