// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';

// --- Mocks ---

const mockRouterPush = jest.fn();
const mockGetCanonicalEvents = jest.fn();

jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useSegments: () => ['(tabs)'],
  router: { push: (...args: unknown[]) => mockRouterPush(...args), replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ setOptions: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'upcoming': 'Upcoming',
        'past': 'Past',
        'loadError': 'Could not load events.',
        'noEvents': opts ? `No ${String(opts.when ?? '')} events.` : 'No events.',
        'going': 'Going',
        'postponed': 'Postponed',
        'completed': 'Completed',
        'cancelled': 'Cancelled',
        'online': 'Online',
        'allDay': 'All day',
        'accessibilityFilter.label': 'Step-free venue access',
        'accessibilityFilter.hint': 'Filter by the organiser\'s confirmed venue information.',
        'accessibilityFilter.options.any': 'Any venue',
        'accessibilityFilter.options.yes': 'Step-free access confirmed',
        'accessibilityFilter.options.no': 'Not step-free',
        'accessibilityFilter.options.unknown': 'Not known',
        'goingCount': opts ? `${String(opts.count ?? 0)} going` : '0 going',
        'common:buttons.retry': 'Retry',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
  useTenant: () => ({ hasFeature: () => true }),
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
    errorBg: '#fff5f5',
  }),
}));

const mockUsePaginatedApi = jest.fn();
jest.mock('@/lib/hooks/usePaginatedApi', () => ({
  usePaginatedApi: (...args: unknown[]) => mockUsePaginatedApi(...args),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/lib/api/events', () => ({
  getEvents: jest.fn(),
  getCanonicalEvents: (...args: unknown[]) => mockGetCanonicalEvents(...args),
}));

jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/components/ui/Skeleton', () => ({
  EventCardSkeleton: () => null,
  ExchangeCardSkeleton: () => null,
  ProfileSkeleton: () => null,
}));

// --- Tests ---

import EventsScreen from './events';

const defaultPaginatedState = {
  items: [],
  isLoading: false,
  isLoadingMore: false,
  error: null,
  hasMore: false,
  loadMore: jest.fn(),
  refresh: jest.fn(),
};

beforeEach(() => {
  mockRouterPush.mockReset();
  mockGetCanonicalEvents.mockReset();
  mockUsePaginatedApi.mockReturnValue(defaultPaginatedState);
});

const sharedEvent = require('../../../contracts/events/v2/event-list-response.json').data[0];
const mockEvent = {
  ...sharedEvent,
  id: 10,
  title: 'Community Bake Sale',
  schedule: {
    ...sharedEvent.schedule,
    start_at: '2026-06-15T14:00:00Z',
    end_at: '2026-06-15T17:00:00Z',
  },
  location: { ...sharedEvent.location, label: 'Town Hall' },
  metrics: { confirmed_count: 8, interested_count: 3, waitlist_count: 0 },
};

describe('EventsScreen', () => {
  it('renders Upcoming and Past tab buttons', () => {
    const { getByText } = render(<EventsScreen />);
    expect(getByText('Upcoming')).toBeTruthy();
    expect(getByText('Past')).toBeTruthy();
  });

  it('offers a structured step-free filter and binds it to discovery requests', async () => {
    const { getByText, getByTestId } = render(<EventsScreen />);

    expect(getByText('Step-free venue access')).toBeTruthy();
    expect(getByText('Any venue')).toBeTruthy();

    const initialFetcher = mockUsePaginatedApi.mock.calls.at(-1)?.[0] as (cursor: string | null) => Promise<unknown>;
    await initialFetcher('cursor-1');
    expect(mockGetCanonicalEvents).toHaveBeenLastCalledWith('upcoming', 'cursor-1', 20, { stepFree: null });

    fireEvent(getByTestId('events-step-free-select'), 'valueChange', {
      value: 'yes',
      label: 'Step-free access confirmed',
    });

    const filteredFetcher = mockUsePaginatedApi.mock.calls.at(-1)?.[0] as (cursor: string | null) => Promise<unknown>;
    await filteredFetcher(null);
    expect(mockGetCanonicalEvents).toHaveBeenLastCalledWith('upcoming', null, 20, { stepFree: 'yes' });
  });

  it('renders empty state when there are no events and not loading', () => {
    const { getByText } = render(<EventsScreen />);
    expect(getByText(/No .* events\./)).toBeTruthy();
  });

  it('does not show empty state while loading', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      items: [],
      isLoading: true,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { queryByText } = render(<EventsScreen />);
    expect(queryByText(/No .* events\./)).toBeNull();
  });

  it('renders event cards when events are loaded', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      items: [mockEvent],
      isLoading: false,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { getByText } = render(<EventsScreen />);
    expect(getByText('Community Bake Sale')).toBeTruthy();
  });

  it('renders all-day dates in the event IANA timezone instead of the device timezone', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      items: [{
        ...mockEvent,
        schedule: {
          ...mockEvent.schedule,
          start_at: '2026-08-09T12:00:00Z',
          end_at: '2026-08-11T12:00:00Z',
          timezone: 'Pacific/Auckland',
          all_day: true,
        },
      }],
      isLoading: false,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { getByText, queryByText } = render(<EventsScreen />);
    expect(getByText('Aug')).toBeTruthy();
    expect(getByText('10')).toBeTruthy();
    expect(getByText('All day')).toBeTruthy();
    expect(queryByText('9')).toBeNull();
  });

  it('shows the canonical postponed state on an event card', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      items: [{
        ...mockEvent,
        schedule: {
          ...mockEvent.schedule,
          state: 'postponed',
          operational_state: 'postponed',
          lifecycle_version: 2,
        },
      }],
      isLoading: false,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { getByText } = render(<EventsScreen />);
    expect(getByText('Postponed')).toBeTruthy();
  });

  it('opens event details from HeroUI Native-backed event cards', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      items: [mockEvent],
      isLoading: false,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { getByText } = render(<EventsScreen />);
    fireEvent.press(getByText('Community Bake Sale'));

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/(modals)/event-detail',
      params: { id: '10' },
    });
  });

  it('shows RSVP going badge on an event the user has RSVPed to', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      items: [{
        ...mockEvent,
        relationship: {
          ...mockEvent.relationship,
          registration: { ...mockEvent.relationship.registration, state: 'confirmed' },
        },
      }],
      isLoading: false,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { getByText } = render(<EventsScreen />);
    expect(getByText('Going')).toBeTruthy();
  });

  it('shows error message with Retry button when events fail to load', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      items: [],
      isLoading: false,
      isLoadingMore: false,
      error: 'Could not load events.',
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { getByText } = render(<EventsScreen />);
    expect(getByText('Could not load events.')).toBeTruthy();
    expect(getByText('Retry')).toBeTruthy();
  });

  it('switches to Past tab when tapped', () => {
    const { getByText } = render(<EventsScreen />);
    const pastTab = getByText('Past');
    fireEvent.press(pastTab);
    // Tab is still rendered and accessible after switching
    expect(getByText('Past')).toBeTruthy();
  });

  it('renders online label for online events', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      items: [{
        ...mockEvent,
        location: { ...mockEvent.location, label: null, mode: 'online' },
        online_access: { ...mockEvent.online_access, mode: 'online' },
      }],
      isLoading: false,
      isLoadingMore: false,
      error: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });

    const { getByText } = render(<EventsScreen />);
    expect(getByText('Online')).toBeTruthy();
  });
});
