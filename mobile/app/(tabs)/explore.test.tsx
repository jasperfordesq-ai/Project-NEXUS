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
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
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

  /**
   * 🔴 Every Explore section builds its card title, its subtitle and its destination from the
   * same three switch statements, keyed by section. A section added without a case there
   * renders a blank card that goes nowhere — which is silent, so this walks all fourteen.
   */
  describe('every section', () => {
    const fullPayload = {
      data: {
        ...explorePayload.data,
        recommended_listings: [{
          ...explorePayload.data.popular_listings[0],
          id: 900, title: 'Recommended for you', category_name: 'DIY', location: 'Bantry',
        }],
        near_you_listings: [{
          ...explorePayload.data.popular_listings[0],
          id: 901, title: 'Close by', category_name: 'Garden', location: 'Clonakilty',
        }],
        active_groups: [{ id: 902, name: 'Gardening Circle', description: 'We grow things', image_url: null }],
        top_contributors: [{ id: 903, name: 'Top Helper', avatar: null, level: 7 }],
        trending_posts: [{
          id: 904, excerpt: '<p>A trending <strong>post</strong></p>', author_name: 'Bea', author_avatar: null,
        }],
        volunteering_opportunities: [{
          id: 905, title: 'Beach clean', org_name: 'Coast Trust', location: 'Inchydoney', image_url: null,
        }],
        active_organisations: [{ id: 906, name: 'Coast Trust', description: 'Looks after the coast', logo_url: null }],
        trending_blog_posts: [{
          id: 907, title: 'A blog post', slug: 'a-blog-post', excerpt: 'What we did', author_name: 'Cara', image_url: null,
        }],
        latest_jobs: [{ id: 908, title: 'Coordinator', org_name: 'Coast Trust', location: 'Cork', org_logo: null }],
        active_polls: [{ id: 909, question: 'Which night suits?', author_name: 'Dara' }],
        featured_resources: [{ id: 910, title: 'Tool guide', description: 'How to borrow tools', category_name: 'DIY' }],
      },
    };

    beforeEach(() => {
      mockUseApi.mockReturnValue({ data: fullPayload, isLoading: false, error: null, refresh: mockRefresh });
    });

    it.each([
      ['Recommended for you', '/(modals)/exchange-detail', { id: '900' }],
      ['Close by', '/(modals)/exchange-detail', { id: '901' }],
      ['Community Meetup', '/(modals)/event-detail', { id: '4' }],
      ['Gardening Circle', '/(modals)/group-detail', { id: '902' }],
      ['New Member', '/(modals)/member-profile', { id: '257' }],
      ['Top Helper', '/(modals)/member-profile', { id: '903' }],
      ['Beach clean', '/(modals)/volunteering-detail', { id: '905' }],
      ['Coast Trust', '/(modals)/organisation-detail', { id: '906' }],
      ['A blog post', '/(modals)/blog-post', { id: 'a-blog-post' }],
      ['Coordinator', '/(modals)/job-detail', { id: '908' }],
      ['Which night suits?', '/(modals)/feed-item-detail', { id: '909', type: 'poll' }],
      ['Tool guide', '/(modals)/feed-item-detail', { id: '910', type: 'resource' }],
    ])('opens %s at its own detail screen', (label, pathname, params) => {
      const { getAllByText } = render(<ExploreScreen />);

      fireEvent.press(getAllByText(label as string)[0]);

      expect(mockRouterPush).toHaveBeenCalledWith({ pathname, params });
    });

    it('strips the markup out of a trending post rather than printing the tags', () => {
      const { getAllByText, queryByText } = render(<ExploreScreen />);

      expect(getAllByText('A trending post')[0]).toBeTruthy();
      expect(queryByText(/<strong>/)).toBeNull();
    });

    it('gives each card a subtitle drawn from its own kind of item', () => {
      const { getAllByText } = render(<ExploreScreen />);

      expect(getAllByText('DIY • Bantry')[0]).toBeTruthy();          // listing
      expect(getAllByText('We grow things')[0]).toBeTruthy();        // group
      expect(getAllByText('Coast Trust • Inchydoney')[0]).toBeTruthy(); // volunteering
      expect(getAllByText('Coast Trust • Cork')[0]).toBeTruthy();    // job
      expect(getAllByText('Bea')[0]).toBeTruthy();                   // post author
      expect(getAllByText('Dara')[0]).toBeTruthy();                  // poll author
      expect(getAllByText('How to borrow tools')[0]).toBeTruthy();   // resource
      expect(getAllByText('Level 7')[0]).toBeTruthy();               // contributor with no tagline
    });

    it('shows the same person once when they are both a suggestion and a new member', () => {
      mockUseApi.mockReturnValue({
        data: {
          data: {
            ...fullPayload.data,
            suggested_connections: [{ id: 257, name: 'New Member', avatar: null, tagline: 'Happy to help' }],
          },
        },
        isLoading: false,
        error: null,
        refresh: mockRefresh,
      });

      const { getAllByText } = render(<ExploreScreen />);

      expect(getAllByText('New Member')).toHaveLength(1);
    });
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
