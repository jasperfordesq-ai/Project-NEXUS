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
        'matches.filter.volunteering': 'Volunteering',
        'matches.filter.group': 'Groups',
        'matches.filter.event': 'Events',
        'matches.source.listing': 'Listing',
        'matches.mutualOnly': 'Showing two-way matches only',
        'matches.showAll': 'Show all matches',
        offer: 'Offer',
        request: 'Request',
        'matches.source.volunteering': 'Volunteering',
        'matches.source.group': 'Group',
        'matches.source.event': 'Event',
        'matches.score': opts ? `${String(opts.score)}% match` : '0% match',
        'matches.suggested': 'Suggested for you',
        'matches.going': opts ? `Going: ${String(opts.total)}` : 'Going',
        'matches.open': 'Open match',
        'matches.openNamed': opts ? `Open ${String(opts.title)}` : 'Open',
        'matches.dismiss': 'Dismiss',
        'matches.dismissNamed': opts ? `Dismiss ${String(opts.title)}` : 'Dismiss',
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
        'matches.empty.safeguardingTitle': 'Some matches cannot be shown yet',
        'matches.empty.safeguardingBody': 'Safeguarding setup is not finished.',
        'matches.empty.disabledTitle': 'Matching is switched off here',
        'matches.empty.disabledBody': 'Your community is not using matching.',
        'matches.notice.pausedTitle': 'Matching is paused (notice)',
        'matches.notice.pausedBody': 'Some suggestions are missing.',
        'matches.notice.pausedAction': 'Open match preferences',
        'matches.notice.locationTitle': 'Add your area to see more',
        'matches.notice.locationBody': 'We cannot suggest things near you yet.',
        'matches.notice.locationAction': 'Add my area (notice)',
        'matches.notice.safeguardingTitle': 'Some matches are hidden',
        'matches.notice.safeguardingBody': 'Matches involving protected members are hidden.',
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
  key: 'listing-10',
  source_type: 'listing',
  source_id: 10,
  match_score: 87,
  title: 'Garden help',
  description: 'Someone nearby needs help.',
  reasons: ['Shared skill', 'Nearby'],
  matched_at: '2026-05-29T10:00:00Z',
};

const eventMatch = {
  key: 'event-20',
  source_type: 'event',
  source_id: 20,
  match_score: 62,
  title: 'Repair morning',
  description: null,
  reasons: ['Your interests'],
  matched_at: '2026-05-29T11:00:00Z',
  metadata: { event_date: '2026-12-05 14:00:00', location: 'Town Hall', attendee_count: 7 },
};

const volunteeringMatch = {
  key: 'volunteering-31',
  source_type: 'volunteering',
  source_id: 31,
  match_score: 40,
  title: 'Weekend planting',
  description: null,
  reasons: [],
  matched_at: '2026-05-29T12:00:00Z',
  metadata: { organization_name: 'Riverside Community Garden', location: 'Cork' },
};

const quietMeta = { needsLocation: false, degraded: false, degradedReason: null, hasActiveListings: true, paused: false, disabled: false };

describe('MatchesScreen', () => {
  function showing(matches: unknown[], meta: Record<string, unknown> = {}) {
    mockUseApi.mockReturnValue({
      data: { data: matches, meta: { ...quietMeta, ...meta } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });
  }

  beforeEach(() => {
    mockParams = {};
    mockPush.mockClear();
    mockDismissMatch.mockReset();
    mockDismissMatch.mockResolvedValue({});
    showing([listingMatch, eventMatch]);
  });

  /**
   * 🔴 An empty matches list has a reason and the server sends it. Measured against the
   * live API on 2026-08-24: the fixture member got zero listing matches with
   * `needs_location: true, degraded_reason: "no_coordinates"` — the engine cannot consider
   * a physical listing for someone with no area — and the screen said "No matches yet",
   * which reads as "nobody suits you".
   */
  function emptyWith(meta: Record<string, unknown>) {
    showing([], meta);
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

  it('explains an unfinished safeguarding setup, with nothing to press', () => {
    // The server sent this reason and the screen read it but never showed it: the member
    // was told "No matches yet". Only the community team can finish the setup, so there
    // is deliberately no button.
    emptyWith({ degraded: true, degradedReason: 'safeguarding_policy_unavailable' });

    const { getByText, getByTestId, queryByText } = render(<MatchesScreen />);

    expect(getByTestId('matches-empty-safeguarding')).toBeTruthy();
    expect(getByText('Some matches cannot be shown yet')).toBeTruthy();
    expect(queryByText('No matches yet')).toBeNull();
    expect(queryByText('Post an offer or request')).toBeNull();
  });

  it('says matching is switched off for the community instead of asking for a listing', () => {
    emptyWith({ disabled: true, hasActiveListings: false, needsLocation: true });

    const { getByText, getByTestId, queryByText } = render(<MatchesScreen />);

    expect(getByTestId('matches-empty-disabled')).toBeTruthy();
    expect(getByText('Matching is switched off here')).toBeTruthy();
    expect(queryByText('Post an offer or request')).toBeNull();
    expect(queryByText('Add my area')).toBeNull();
  });

  it('does not blame the location when the member has matches but the filter has none', () => {
    // A volunteering match exists; the Listings tab is empty. The member is not missing a
    // location — this tab simply has nothing in it.
    showing([volunteeringMatch], { needsLocation: true, degraded: true, degradedReason: 'no_coordinates' });

    const { getByText, queryByTestId } = render(<MatchesScreen />);

    fireEvent.press(getByText('Listings'));

    expect(queryByTestId('matches-empty-location')).toBeNull();
    expect(queryByTestId('matches-empty-none')).toBeTruthy();
  });

  describe('reasons shown above the list when some cards still exist', () => {
    // A paused member, or one with no area, still gets group, volunteering and event
    // cards — and used to be told nothing, because the explanation lived only in the
    // empty state.
    it('says matching is paused and opens the preferences', () => {
      showing([eventMatch], { paused: true });

      const { getByTestId, getByText } = render(<MatchesScreen />);

      expect(getByTestId('matches-notice-paused')).toBeTruthy();
      expect(getByText('Repair morning')).toBeTruthy();
      fireEvent.press(getByText('Open match preferences'));
      expect(mockPush).toHaveBeenCalledWith('/(modals)/match-preferences');
    });

    it('asks for an area and opens the profile', () => {
      showing([volunteeringMatch], { needsLocation: true, degraded: true, degradedReason: 'no_coordinates' });

      const { getByTestId, getByText } = render(<MatchesScreen />);

      expect(getByTestId('matches-notice-location')).toBeTruthy();
      expect(getByText('Weekend planting')).toBeTruthy();
      fireEvent.press(getByText('Add my area (notice)'));
      expect(mockPush).toHaveBeenCalledWith('/(modals)/edit-profile');
    });

    it('says some matches are hidden while safeguarding setup is unfinished', () => {
      showing([listingMatch], { degraded: true, degradedReason: 'safeguarding_policy_unavailable' });

      const { getByTestId, getByText } = render(<MatchesScreen />);

      expect(getByTestId('matches-notice-safeguarding')).toBeTruthy();
      expect(getByText('Some matches are hidden')).toBeTruthy();
      expect(getByText('Garden help')).toBeTruthy();
    });

    it('shows no notice when there is nothing to explain', () => {
      const { queryByTestId } = render(<MatchesScreen />);

      expect(queryByTestId('matches-notice-paused')).toBeNull();
      expect(queryByTestId('matches-notice-location')).toBeNull();
      expect(queryByTestId('matches-notice-safeguarding')).toBeNull();
    });
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
    emptyWith({});

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

  it('shows the score as a whole number', () => {
    showing([{ ...listingMatch, match_score: 72.6 }]);

    const { getByText, queryByText } = render(<MatchesScreen />);

    expect(getByText('73% match')).toBeTruthy();
    expect(queryByText('72.6% match')).toBeNull();
  });

  it('labels a cold-start item as a suggestion and keeps it out of the average', () => {
    // A member with nothing posted yet is shown things to browse. They are not scored
    // matches, so they get no percentage and do not move the average.
    showing([
      { ...listingMatch, match_type: 'cold_start', match_score: 45 },
      { ...eventMatch, match_score: 70 },
    ], { hasActiveListings: false });

    const { getByText, queryByText } = render(<MatchesScreen />);

    expect(getByText('Suggested for you')).toBeTruthy();
    expect(queryByText('45% match')).toBeNull();
    // Average of the one scored match, not of 45 and 70.
    expect(getByText('70%')).toBeTruthy();
  });

  it('offers an Events filter and no Jobs filter', () => {
    const { getByText, queryByText } = render(<MatchesScreen />);

    // The server has never returned a jobs match; it does return events.
    expect(queryByText('Jobs')).toBeNull();

    fireEvent.press(getByText('Events'));

    expect(getByText('Repair morning')).toBeTruthy();
    expect(queryByText('Garden help')).toBeNull();
  });

  it('shows when and where an event is, and who is going', () => {
    const { getByText } = render(<MatchesScreen />);

    expect(getByText('Town Hall')).toBeTruthy();
    expect(getByText('Going: 7')).toBeTruthy();
    // The start time is formatted for the reader; the year is always part of it.
    expect(getByText(/2026/)).toBeTruthy();
  });

  it('opens an event match on the event screen', () => {
    const { getByLabelText } = render(<MatchesScreen />);

    fireEvent.press(getByLabelText('Open Repair morning'));

    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(modals)/event-detail', params: { id: '20' } });
  });

  it('opens a volunteering match by its opportunity id and names the organisation', () => {
    // `source_id` is the opportunity id. The organisation's id used to be passed to the
    // opportunity screen, which opened an unrelated opportunity.
    showing([volunteeringMatch]);

    const { getByLabelText, getByText } = render(<MatchesScreen />);

    expect(getByText('Riverside Community Garden')).toBeTruthy();
    fireEvent.press(getByLabelText('Open Weekend planting'));

    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(modals)/volunteering-detail', params: { id: '31' } });
  });

  it('shows a match the server sent without an id as a card with nothing to open', () => {
    showing([{ ...volunteeringMatch, key: 'volunteering-unlinked-0', source_id: null }]);

    const { getByText, queryByText } = render(<MatchesScreen />);

    expect(getByText('Weekend planting')).toBeTruthy();
    expect(queryByText('Open match')).toBeNull();
  });

  it('gives every group match its own card and its own destination', () => {
    // Regression: every group match had id 0, so they shared one list key and "Open match"
    // opened group 0.
    showing([
      { key: 'group-8', source_type: 'group', source_id: 8, match_score: 55, title: 'Walkers', reasons: [], matched_at: '' },
      { key: 'group-9', source_type: 'group', source_id: 9, match_score: 50, title: 'Gardeners', reasons: [], matched_at: '' },
    ]);

    const { getByLabelText, getByTestId } = render(<MatchesScreen />);

    expect(getByTestId('match-card-group-8')).toBeTruthy();
    expect(getByTestId('match-card-group-9')).toBeTruthy();

    fireEvent.press(getByLabelText('Open Gardeners'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(modals)/group-detail', params: { id: '9' } });
  });

  it('says when only two-way matches are shown, and offers the way back to all of them', () => {
    // Opened from a two-way alert, the list was silently cut down with no
    // sign of it and no way out.
    mockParams = { type: 'mutual' };
    showing([
      { ...eventMatch, match_type: 'event_recommendation' },
      { ...listingMatch, match_type: 'mutual' },
    ]);
    const { getByText, queryByText } = render(<MatchesScreen />);

    expect(getByText('Showing two-way matches only')).toBeTruthy();
    expect(queryByText('Repair morning')).toBeNull();

    fireEvent.press(getByText('Show all matches'));

    expect(getByText('Repair morning')).toBeTruthy();
    expect(queryByText('Showing two-way matches only')).toBeNull();
  });

  it('honours hot and mutual-match notification parameters while the screen opens', () => {
    mockParams = { type: 'mutual', highlight: 'listing-10' };
    showing([
      { ...eventMatch, match_type: 'event_recommendation' },
      { ...listingMatch, match_type: 'mutual' },
    ]);

    const { getByTestId, getByText, queryByText } = render(<MatchesScreen />);

    expect(getByTestId('match-card-listing-10')).toHaveStyle({ borderWidth: 2 });
    expect(getByText('Garden help')).toBeTruthy();
    expect(queryByText('Repair morning')).toBeNull();
  });

  it('opens and dismisses listing matches, naming the match for screen readers', async () => {
    const { getAllByText, getByLabelText, queryByText } = render(<MatchesScreen />);

    // The visible wording is unchanged; the accessible name says which match.
    expect(getAllByText('Open match').length).toBe(2);
    fireEvent.press(getByLabelText('Open Garden help'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(modals)/exchange-detail', params: { id: '10' } });

    fireEvent.press(getByLabelText('Dismiss Garden help'));
    await waitFor(() => expect(mockDismissMatch).toHaveBeenCalledWith(10, 'listing'));
    await waitFor(() => expect(queryByText('Garden help')).toBeNull());
  });

  it('says who posted a listing and whether it is an offer or a request', async () => {
    // The card showed "Listing" and nothing about who or what kind.
    showing([{ ...listingMatch, listing_type: 'request', matched_user: { id: 5, name: 'Orla', avatar_url: null }, metadata: { category: 'Home and garden' } }]);
    const { getByText, queryByText } = render(<MatchesScreen />);

    expect(getByText('Request')).toBeTruthy();
    expect(queryByText('Listing')).toBeNull();
    expect(getByText('Orla')).toBeTruthy();
    expect(getByText('Home and garden')).toBeTruthy();
  });

  it('lets a member dismiss an event match too', async () => {
    showing([{ ...eventMatch, title: 'Repair cafe' }]);
    const { getByLabelText, queryByText } = render(<MatchesScreen />);

    fireEvent.press(getByLabelText('Dismiss Repair cafe'));

    await waitFor(() => expect(mockDismissMatch).toHaveBeenCalledWith(eventMatch.source_id, 'event'));
    await waitFor(() => expect(queryByText('Repair cafe')).toBeNull());
  });
});
