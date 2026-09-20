// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { FlatList, RefreshControl } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiResponseError } from '@/lib/api/client';

const mockRouterPush = jest.fn();
let mockSearchParams: Record<string, string | undefined> = {};
const mockUseApi = jest.fn();
const mockSaveSearch = jest.fn();
const mockRunSavedSearch = jest.fn();
const mockDeleteSavedSearch = jest.fn();
let mockDebouncedQuery: string | undefined;
let mockUserId = 7;
let mockTenantId = 2;
const mockConfirm = jest.fn();

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
  useTenant: () => ({ tenant: { id: mockTenantId }, hasFeature: () => true }),
}));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mockUserId } }) }));

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
  useDebounce: (value: string) => mockDebouncedQuery ?? value,
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
    confirm: (options: { onConfirm: () => void }) => mockConfirm(options),
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
  mockUserId = 7;
  mockTenantId = 2;
  mockConfirm.mockReset().mockImplementation((options: { onConfirm: () => void }) => options.onConfirm());
  mockDebouncedQuery = undefined;
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
  mockUsePaginatedApi.mockReset().mockReturnValue(defaultPaginatedState);
  jest.requireMock('@/lib/api/search').search.mockReset();
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
  it('serializes deletion of a saved entry and ignores its completion after unmount', async () => {
    const refresh = jest.fn();
    mockUseApi.mockReturnValue({ data: { data: [{ id: 4, name: 'Saved', query_params: { q: 'garden' } }] }, isLoading: false, error: null, refresh });
    let finish!: (value: unknown) => void;
    mockDeleteSavedSearch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const screen = render(<SearchScreen />);
    fireEvent.press(screen.getByText('Delete'));
    fireEvent.press(screen.getByText('Delete'));
    expect(mockDeleteSavedSearch).toHaveBeenCalledTimes(1);
    screen.unmount();
    await act(async () => finish({ data: { deleted: true } }));
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each(['account', 'community'])('resets search state and ignores late save completion after changing %s', async (change) => {
    let finish!: (value: unknown) => void;
    mockSaveSearch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const refresh = jest.fn();
    mockUseApi.mockReturnValue({ data: { data: [] }, isLoading: false, error: null, refresh });
    const screen = render(<SearchScreen />);
    fireEvent.changeText(screen.getByPlaceholderText('Search for people, listings...'), 'private query');
    fireEvent.press(screen.getByText('Save search'));
    fireEvent.changeText(screen.getByPlaceholderText('Search name'), 'Private name');
    fireEvent.press(screen.getByText('Save'));
    if (change === 'account') mockUserId = 8;
    else mockTenantId = 3;
    screen.rerender(<SearchScreen />);
    expect(screen.getByPlaceholderText('Search for people, listings...').props.value).toBe('');
    expect(screen.queryByPlaceholderText('Search name')).toBeNull();
    await act(async () => finish({ data: { id: 1 } }));
    expect(refresh).not.toHaveBeenCalled();
  });

  it('does not execute a delete confirmation after leaving the old search screen', async () => {
    mockConfirm.mockImplementation(() => undefined);
    mockUseApi.mockReturnValue({ data: { data: [{ id: 4, name: 'Saved', query_params: { q: 'garden' } }] }, isLoading: false, error: null, refresh: jest.fn() });
    const screen = render(<SearchScreen />);
    fireEvent.press(screen.getByText('Delete'));
    const confirmation = mockConfirm.mock.calls[0][0];
    screen.unmount();
    await act(async () => confirmation.onConfirm());
    expect(mockDeleteSavedSearch).not.toHaveBeenCalled();
  });

  it('retries a failed search page at the same cursor and preserves prior results', async () => {
    mockSearchParams = { q: 'garden' };
    mockUsePaginatedApi.mockImplementation(jest.requireActual('@/lib/hooks/usePaginatedApi').usePaginatedApi);
    const fetch = jest.requireMock('@/lib/api/search').search;
    fetch.mockResolvedValueOnce({ data: [mockSearchResult], meta: { total: 2, has_more: true, cursor: 'page-two' } })
      .mockRejectedValueOnce(new ApiResponseError(503, 'Connection interrupted'))
      .mockResolvedValueOnce({ data: [{ ...mockSearchResult, id: 43, title: 'Another member' }], meta: { total: 2, has_more: false, cursor: null } });
    const screen = render(<SearchScreen />);
    await screen.findByText('Jane Doe');
    await act(async () => screen.UNSAFE_getByType(FlatList).props.onEndReached());
    await screen.findByText('Connection interrupted');
    await act(async () => screen.UNSAFE_getByType(FlatList).props.onEndReached());
    expect(fetch).toHaveBeenCalledTimes(2);
    fireEvent.press(screen.getByRole('button', { name: 'common:buttons.retry' }));
    await screen.findByText('Another member');
    expect(fetch).toHaveBeenLastCalledWith('garden', 'page-two', undefined);
    expect(screen.getByText('Jane Doe')).toBeTruthy();
  });

  it.each([401, 403, 404])('removes results after refresh returns %s', async (status) => {
    mockSearchParams = { q: 'garden' };
    mockUsePaginatedApi.mockImplementation(jest.requireActual('@/lib/hooks/usePaginatedApi').usePaginatedApi);
    jest.requireMock('@/lib/api/search').search
      .mockResolvedValueOnce({ data: [mockSearchResult], meta: { total: 1, has_more: false, cursor: null } })
      .mockRejectedValueOnce(new ApiResponseError(status, 'Unavailable'));
    const screen = render(<SearchScreen />);
    await screen.findByText('Jane Doe');
    await act(async () => screen.UNSAFE_getByType(RefreshControl).props.onRefresh());
    await screen.findByText('common:errors.notAvailableTitle');
    expect(screen.queryByText('Jane Doe')).toBeNull();
    expect(screen.queryByRole('button', { name: 'common:buttons.retry' })).toBeNull();
  });

  it('clears saved entries after an actual refresh refusal', async () => {
    const realUseApi = jest.requireActual('@/lib/hooks/useApi').useApi;
    let refreshSaved!: () => void;
    mockUseApi.mockImplementation((...args: unknown[]) => {
      const state = realUseApi(...args);
      refreshSaved = state.refresh;
      return state;
    });
    jest.requireMock('@/lib/api/search').getSavedSearches
      .mockResolvedValueOnce({ data: [{ id: 7, name: 'Private saved search', query_params: { q: 'garden' } }] })
      .mockRejectedValueOnce(new ApiResponseError(403, 'Unavailable'));
    const screen = render(<SearchScreen />);
    await screen.findByText('Private saved search');
    await act(async () => refreshSaved());
    await screen.findByText('common:errors.notAvailableTitle');
    expect(screen.queryByText('Private saved search')).toBeNull();
    expect(screen.queryByText('Run')).toBeNull();
  });

  it('shows a retryable saved-search failure instead of claiming the list is empty', () => {
    const refresh = jest.fn();
    mockUseApi.mockReturnValue({ data: null, isLoading: false, error: 'Saved searches unavailable', refresh });
    const screen = render(<SearchScreen />);
    expect(screen.getByText('Saved searches unavailable')).toBeTruthy();
    expect(screen.queryByText('No saved searches yet.')).toBeNull();
    fireEvent.press(screen.getByRole('button', { name: 'common:buttons.retry' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps all saved searches accessible during a refresh, including entries beyond the fourth', () => {
    mockUseApi.mockReturnValue({ data: { data: Array.from({ length: 6 }, (_, index) => ({
      id: index + 1, name: `Saved search ${index + 1}`, query_params: { q: `query ${index}` },
    })) }, isLoading: true, error: null, refresh: jest.fn() });
    const screen = render(<SearchScreen />);
    expect(screen.getByText('Saved search 1')).toBeTruthy();
    expect(screen.getByText('Saved search 6')).toBeTruthy();
  });

  it('shows saved-search refusal without retry or an empty-list claim', () => {
    mockUseApi.mockReturnValue({ data: null, isLoading: false, error: 'Unavailable', errorStatus: 403, refresh: jest.fn() });
    const screen = render(<SearchScreen />);
    expect(screen.getByText('common:errors.notAvailableTitle')).toBeTruthy();
    expect(screen.queryByText('No saved searches yet.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'common:buttons.retry' })).toBeNull();
  });

  it('keeps loaded results and offers recovery when a refresh fails', () => {
    const refresh = jest.fn();
    mockSearchParams = { q: 'garden' };
    mockUsePaginatedApi.mockReturnValue({ ...defaultPaginatedState,
      items: [mockSearchResult], error: 'Connection interrupted', hasMore: true, refresh });
    const { getByText, getByRole } = render(<SearchScreen />);
    expect(getByText('Jane Doe')).toBeTruthy();
    expect(getByText('Connection interrupted')).toBeTruthy();
    fireEvent.press(getByRole('button', { name: 'common:buttons.retry' }));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('keeps people and listings with the same numeric ID in real paginated results', async () => {
    const realUsePaginatedApi = jest.requireActual('@/lib/hooks/usePaginatedApi').usePaginatedApi;
    mockUsePaginatedApi.mockImplementation(realUsePaginatedApi);
    const searchApi = jest.requireMock('@/lib/api/search');
    searchApi.search.mockResolvedValue({
      data: [mockSearchResult, { ...mockSearchResult, type: 'listing', title: 'Garden help' }],
      meta: { total: 2, has_more: false, cursor: null },
    });
    mockSearchParams = { q: 'garden' };
    const { findByText, getByText } = render(<SearchScreen />);
    expect(await findByText('Jane Doe')).toBeTruthy();
    expect(getByText('Garden help')).toBeTruthy();
  });

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

  it('saves the visible query while results are still debouncing and serializes keyboard submissions', async () => {
    mockSearchParams = { q: 'gardening', type: 'event' };
    mockDebouncedQuery = 'gardening';
    let finish!: (value: unknown) => void;
    mockSaveSearch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const screen = render(<SearchScreen />);
    fireEvent.press(screen.getByText('Save search'));
    fireEvent.changeText(screen.getByPlaceholderText('Search name'), 'New search');
    fireEvent.changeText(screen.getByPlaceholderText('Search for people, listings...'), 'cooking');
    fireEvent(screen.getByPlaceholderText('Search name'), 'submitEditing');
    fireEvent(screen.getByPlaceholderText('Search name'), 'submitEditing');
    expect(mockSaveSearch).toHaveBeenCalledTimes(1);
    expect(screen.getByPlaceholderText('Search name').props.editable).toBe(false);
    expect(mockSaveSearch).toHaveBeenCalledWith({ name: 'New search', query_params: { q: 'cooking', type: 'event' } });
    await act(async () => finish({ data: {} }));
    mockDebouncedQuery = undefined;
  });

  it('preserves a failed save draft and unlocks retry', async () => {
    mockSearchParams = { q: 'garden' };
    mockSaveSearch.mockRejectedValueOnce(new Error('Offline'));
    const screen = render(<SearchScreen />);
    fireEvent.press(screen.getByText('Save search'));
    fireEvent.changeText(screen.getByPlaceholderText('Search name'), 'My garden');
    fireEvent.press(screen.getByText('Save'));
    await waitFor(() => expect(screen.getByPlaceholderText('Search name').props.editable).toBe(true));
    expect(screen.getByPlaceholderText('Search name').props.value).toBe('My garden');
    fireEvent.press(screen.getByText('Save'));
    await waitFor(() => expect(mockSaveSearch).toHaveBeenCalledTimes(2));
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
    await waitFor(() => expect(mockRunSavedSearch).toHaveBeenCalledWith(9));
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
