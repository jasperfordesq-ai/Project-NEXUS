// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';

const mockRouterPush = jest.fn();
const mockRefresh = jest.fn();
const mockHasFeature = jest.fn<boolean, [string]>(() => true);
const mockUseApi = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockRouterPush(...args) },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        eyebrow: 'Discover',
        title: 'Explore your community',
        subtitle: 'Find recommendations and useful updates.',
        loading: 'Loading discovery...',
        errorTitle: 'Could not load Explore',
        emptyTitle: 'Nothing to explore yet',
        emptySubtitle: 'Try search.',
        'actions.search': 'Search',
        'actions.forYou': 'For you',
        'actions.seeAll': 'See all',
        'tabs.all': 'All',
        'tabs.forYou': 'For you',
        'tabs.listings': 'Listings',
        'tabs.people': 'People',
        'tabs.events': 'Events',
        'tabs.groups': 'Groups',
        'stats.members': 'Members',
        'stats.exchanges': 'Exchanges',
        'stats.hours': 'Hours',
        'stats.listings': 'Listings',
        'sections.popularListings.title': 'Popular listings',
        'sections.popularListings.subtitle': 'Offers and requests getting attention right now.',
        'sections.events.title': 'Upcoming events',
        'sections.events.subtitle': 'Workshops, meetups, and community gatherings.',
        'sections.people.title': 'People to meet',
        'sections.people.subtitle': 'New members and suggested connections.',
        'itemTypes.default': 'Explore',
        'itemTypes.popularListings': 'Listing',
        'itemTypes.events': 'Event',
        'itemTypes.people': 'Member',
        'itemMeta.level': `Level ${opts?.level}`,
        'common:buttons.retry': 'Retry',
      };
      return map[key] ?? String(opts?.defaultValue ?? key);
    },
  }),
}));

jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
  useTenant: () => ({ hasFeature: (feature: string) => mockHasFeature(feature) }),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    surface: '#f8f9fa',
    text: '#000000',
    textSecondary: '#666666',
    textMuted: '#999999',
    border: '#dddddd',
  }),
}));

jest.mock('@/components/OfflineBanner', () => () => null);
jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/lib/api/explore', () => ({
  getExplore: jest.fn(),
}));

import ExploreScreen from './explore';

const explorePayload = {
  data: {
    community_stats: {
      total_members: 927,
      exchanges_this_month: 5,
      hours_exchanged: 1932,
      active_listings: 81,
    },
    popular_listings: [{
      id: 165,
      title: 'Garden help',
      type: 'request',
      image_url: null,
      location: 'Skibbereen',
      estimated_hours: '2.00',
      created_at: '2026-03-02',
      category_name: 'DIY',
      category_slug: 'diy',
      category_color: 'orange',
      author_name: 'Alice',
      author_avatar: null,
    }],
    upcoming_events: [{
      id: 4,
      title: 'Community Meetup',
      description: 'Monthly gathering',
      image_url: null,
      start_at: '2026-06-01',
      end_at: null,
      location: 'Community Hall',
      is_online: false,
      max_attendees: null,
      rsvp_count: 2,
    }],
    new_members: [{ id: 257, name: 'New Member', avatar: null, tagline: 'Happy to help', created_at: '2026-05-25' }],
    suggested_connections: [],
    recommended_listings: [],
    near_you_listings: [],
    trending_posts: [],
    active_groups: [],
    top_contributors: [],
    trending_blog_posts: [],
    volunteering_opportunities: [],
    active_organisations: [],
    active_polls: [],
    latest_jobs: [],
    featured_resources: [],
    categories: [],
  },
};

describe('ExploreScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockHasFeature.mockReturnValue(true);
    mockUseApi.mockReturnValue({
      data: explorePayload,
      isLoading: false,
      error: null,
      refresh: mockRefresh,
    });
  });

  it('renders the native Explore hub instead of the raw Search screen', () => {
    const { getByText, queryByText } = render(<ExploreScreen />);

    expect(getByText('Explore your community')).toBeTruthy();
    expect(getByText('Popular listings')).toBeTruthy();
    expect(getByText('Garden help')).toBeTruthy();
    expect(getByText('Community Meetup')).toBeTruthy();
    expect(queryByText('Global search')).toBeNull();
  });

  it('opens Search as a secondary action from Explore', () => {
    const { getByText } = render(<ExploreScreen />);

    fireEvent.press(getByText('Search'));

    expect(mockRouterPush).toHaveBeenCalledWith('/(modals)/search');
  });

  it('hides feature-gated sections when the backend feature is disabled', () => {
    mockHasFeature.mockImplementation((feature: string) => feature !== 'events' && feature !== 'connections');

    const { queryByText } = render(<ExploreScreen />);

    expect(queryByText('Upcoming events')).toBeNull();
    expect(queryByText('People to meet')).toBeNull();
    expect(queryByText('Popular listings')).toBeTruthy();
  });

  it('keeps pull-to-refresh active until the Explore request completes', () => {
    jest.useFakeTimers();
    const apiState = {
      data: explorePayload,
      isLoading: false,
      error: null,
      refresh: mockRefresh,
    };
    mockUseApi.mockImplementation(() => apiState);

    const screen = render(<ExploreScreen />);
    fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh');

    apiState.isLoading = true;
    screen.rerender(<ExploreScreen />);
    jest.advanceTimersByTime(2000);
    screen.rerender(<ExploreScreen />);
    expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(true);

    apiState.isLoading = false;
    screen.rerender(<ExploreScreen />);
    expect(screen.UNSAFE_getByType(RefreshControl).props.refreshing).toBe(false);
    jest.useRealTimers();
  });
});
