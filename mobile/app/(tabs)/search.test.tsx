// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockRouterPush = jest.fn();
let mockSearchParams: Record<string, string | undefined> = {};
const mockUseApi = jest.fn();
const mockSaveSearch = jest.fn();
const mockRunSavedSearch = jest.fn();
const mockDeleteSavedSearch = jest.fn();

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) }),
  useSegments: () => ['(tabs)'],
  router: { push: (...args: unknown[]) => mockRouterPush(...args), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => mockSearchParams,
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        title: 'Search',
        heroEyebrow: 'Global search',
        subtitle: 'Find members, listings, events, groups, and community stories.',
        placeholder: 'Search for people, listings...',
        clearSearch: 'Clear search',
        initialTitle: 'Search your community',
        startTyping: 'Start typing to search.',
        empty: 'No results found.',
        emptyHint: opts ? `No matches for ${String(opts.query ?? '')}` : 'No matches',
        searching: 'Searching...',
        resultsCount: opts ? `${String(opts.count ?? 0)} results` : '0 results',
        errorTitle: 'Search failed',
        error: 'Something went wrong.',
        filterAll: 'All',
        'types.user': 'People',
        'types.listing': 'Listings',
        'types.event': 'Events',
        'types.group': 'Groups',
        'types.blog_post': 'Blog',
        'saved.title': 'Saved searches',
        'saved.subtitle': 'Save useful searches and run them again later.',
        'saved.saveThis': 'Save search',
        'saved.namePlaceholder': 'Search name',
        'saved.save': 'Save',
        'saved.saving': 'Saving...',
        'saved.cancel': 'Cancel',
        'saved.run': 'Run',
        'saved.delete': 'Delete',
        'saved.deleteNamed': `Delete ${String(opts?.name ?? '')}`,
        'saved.empty': 'No saved searches yet.',
        'saved.noQuery': 'No query',
        'saved.resultCount': `${String(opts?.count ?? 0)} results`,
        'saved.saveFailedTitle': 'Could not save search',
        'saved.saveFailedMessage': 'Please check the search name and try again.',
        'saved.deleteFailedTitle': 'Could not delete search',
        'saved.deleteFailedMessage': 'Please try again.',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
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
  }),
}));

const mockUsePaginatedApi = jest.fn();
jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));
jest.mock('@/lib/hooks/usePaginatedApi', () => ({
  usePaginatedApi: (...args: unknown[]) => mockUsePaginatedApi(...args),
}));

jest.mock('@/lib/hooks/useDebounce', () => ({
  useDebounce: (value: string) => value,
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/lib/api/search', () => ({
  search: jest.fn(),
  getSavedSearches: jest.fn(),
  saveSearch: (...args: unknown[]) => mockSaveSearch(...args),
  runSavedSearch: (...args: unknown[]) => mockRunSavedSearch(...args),
  deleteSavedSearch: (...args: unknown[]) => mockDeleteSavedSearch(...args),
}));

jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/OfflineBanner', () => () => null);
// Stable references so screens that put `show` in a useCallback/useEffect
// dependency array don't re-run their effects on every render.
// Confirmations resolve immediately so the guarded action runs in the test.
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    confirm: (options: { onConfirm: () => void }) => options.onConfirm(),
    confirmDialog: null,
  }),
}));
jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

import SearchScreen from './search';

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
  mockSearchParams = {};
  mockSaveSearch.mockReset().mockResolvedValue({ data: { id: 2 } });
  mockRunSavedSearch.mockReset().mockResolvedValue({ data: { id: 1 } });
  mockDeleteSavedSearch.mockReset().mockResolvedValue({ data: { deleted: true } });
  mockUseApi.mockReset().mockReturnValue({
    data: { data: [] },
    isLoading: false,
    error: null,
    refresh: jest.fn(),
  });
  mockUsePaginatedApi.mockReturnValue(defaultPaginatedState);
});

const mockSearchResult = {
  id: 42,
  type: 'user' as const,
  title: 'Jane Doe',
  subtitle: 'Timebanker',
  avatar: null,
  url: null,
  created_at: '2026-01-01T00:00:00Z',
};

describe('SearchScreen', () => {
  it('renders the screen title', () => {
    const { getAllByText } = render(<SearchScreen />);
    expect(getAllByText('Search').length).toBeGreaterThan(0);
  });

  it('renders the search input', () => {
    const { getByPlaceholderText, getByTestId } = render(<SearchScreen />);
    expect(getByPlaceholderText('Search for people, listings...')).toBeTruthy();
    expect(getByTestId('search-input')).toBeTruthy();
  });

  it('shows clear action after typing in the shared input-backed search field', () => {
    const { getByPlaceholderText, getByLabelText } = render(<SearchScreen />);
    fireEvent.changeText(getByPlaceholderText('Search for people, listings...'), 'gardening');
    expect(getByLabelText('Clear search')).toBeTruthy();
  });

  it('renders the initial search prompt when query is empty', () => {
    const { getByText } = render(<SearchScreen />);
    expect(getByText('Search your community')).toBeTruthy();
    expect(getByText('Start typing to search.')).toBeTruthy();
  });

  it('renders type filter tabs', () => {
    const { getByText } = render(<SearchScreen />);
    expect(getByText('All')).toBeTruthy();
    expect(getByText('People')).toBeTruthy();
    expect(getByText('Listings')).toBeTruthy();
    expect(getByText('Events')).toBeTruthy();
    expect(getByText('Groups')).toBeTruthy();
    expect(getByText('Blog')).toBeTruthy();
  });

  it('initializes query and type filter from route params', () => {
    mockSearchParams = { q: 'gardening', type: 'event' };

    const { getByPlaceholderText } = render(<SearchScreen />);

    expect(getByPlaceholderText('Search for people, listings...').props.value).toBe('gardening');
    const latestCall = mockUsePaginatedApi.mock.calls[mockUsePaginatedApi.mock.calls.length - 1];
    expect(latestCall[2]).toEqual(['gardening', 'event']);
  });

  it('saves the current native search with the active type filter', async () => {
    mockSearchParams = { q: 'gardening', type: 'event' };
    const { getByPlaceholderText, getByText } = render(<SearchScreen />);

    fireEvent.press(getByText('Save search'));
    fireEvent.changeText(getByPlaceholderText('Search name'), 'Garden events');
    fireEvent.press(getByText('Save'));

    await waitFor(() => {
      expect(mockSaveSearch).toHaveBeenCalledWith({
        name: 'Garden events',
        query_params: { q: 'gardening', type: 'event' },
      });
    });
  });

  it('runs and deletes saved searches from the native search surface', async () => {
    const refresh = jest.fn();
    mockUseApi.mockReturnValue({
      data: {
        data: [{
          id: 9,
          name: 'Garden events',
          query_params: { q: 'garden', type: 'event' },
          notify_on_new: false,
          last_run_at: null,
          last_result_count: 4,
          created_at: '2026-01-01T00:00:00Z',
        }],
      },
      isLoading: false,
      error: null,
      refresh,
    });
    const { getByPlaceholderText, getByText } = render(<SearchScreen />);

    fireEvent.press(getByText('Run'));
    await waitFor(() => expect(mockRunSavedSearch).toHaveBeenCalledWith(9, 0));
    expect(getByPlaceholderText('Search for people, listings...').props.value).toBe('garden');

    fireEvent.press(getByText('Delete'));
    await waitFor(() => expect(mockDeleteSavedSearch).toHaveBeenCalledWith(9));
    expect(refresh).toHaveBeenCalled();
  });

  it('renders results when data is provided', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      ...defaultPaginatedState,
      items: [mockSearchResult],
    });

    const { getByText } = render(<SearchScreen />);
    expect(getByText('Jane Doe')).toBeTruthy();
    expect(getByText('Timebanker')).toBeTruthy();
  });

  it('opens result detail routes from HeroUI Native-backed result rows', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      ...defaultPaginatedState,
      items: [mockSearchResult],
    });

    const { getByText } = render(<SearchScreen />);
    fireEvent.press(getByText('Jane Doe'));

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/(modals)/member-profile',
      params: { id: '42' },
    });
  });

  it('renders the initial empty state when no query has been entered', () => {
    mockUsePaginatedApi.mockReturnValueOnce({
      ...defaultPaginatedState,
      items: [],
    });

    const { getByText } = render(<SearchScreen />);
    expect(getByText('Search your community')).toBeTruthy();
  });
});
