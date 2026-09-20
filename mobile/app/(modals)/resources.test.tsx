// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking, RefreshControl } from 'react-native';
import { ApiResponseError } from '@/lib/api/client';

const mockUseApi = jest.fn();
const mockLoadMore = jest.fn();
let mockHasMore = false;
let mockRealPagination = false;
let mockRealSavedRead = false;
const mockGetResources = jest.fn();
const mockGetKbArticles = jest.fn();
const mockSearchKbArticlePage = jest.fn();
jest.mock('@/lib/api/resources', () => ({
  ...jest.requireActual('@/lib/api/resources'),
  getResources: (...args: unknown[]) => mockGetResources(...args),
  getKbArticles: function getKbArticles(cursor: string | null) { return mockGetKbArticles(cursor); },
  searchKbArticlePage: (...args: unknown[]) => mockSearchKbArticlePage(...args),
}));
jest.mock('@/lib/hooks/usePaginatedApi', () => ({
  usePaginatedApi: (...args: unknown[]) => {
    if (mockRealPagination) return jest.requireActual('@/lib/hooks/usePaginatedApi').usePaginatedApi(...args);
    const [loader] = args;
    const state = mockUseApi(loader, args[2], args[3]);
    return { ...state, items: Array.isArray(state.data) ? state.data : state.data?.items ?? [], hasMore: mockHasMore, loadMore: mockLoadMore, isLoadingMore: false };
  },
}));
const mockPush = jest.fn();

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  router: { push: (...args: unknown[]) => mockPush(...args) },
  // The screen re-reads on focus, so the effect runs its callback once here — the same as
  // arriving on the screen. Without this the list is whatever it was when first fetched,
  // which is the defect the focus refresh fixes.
  useFocusEffect: (callback: () => void) => require('react').useEffect(callback, [callback]),
}));

jest.mock('expo-linking', () => ({
  openURL: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockRealSavedRead && String(args[0]).includes('resourceId')
    ? jest.requireActual('@/lib/hooks/useApi').useApi(...args) : mockUseApi(...args),
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
    info: '#2563eb',
    success: '#22c55e',
    error: '#ef4444',
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
        'common:buttons.retry': 'Retry',
        'resources:title': 'Resources',
        'resources:subtitle': 'Browse shared files and knowledge base articles.',
        'resources:tabs.resources': 'Files',
        'resources:tabs.kb': 'Knowledge',
        'resources:searchPlaceholder': 'Search resources',
        'resources:allCategories': 'All',
        'resources:download': 'Open resource',
        'resources:readArticle': 'Read article',
        'resources:downloads': opts ? `${String(opts.count)} downloads` : 'downloads',
        'resources:emptyTitle': 'Nothing found',
        'resources:emptySubtitle': 'Try another search or category.',
        'resources:errorTitle': 'Could not load resources',
        'resources:categoryCount': opts ? `${String(opts.count)} items` : 'items',
      };
      return map[key] ?? key;
    },
  }),
}));

/*
  These screens now open external links through `useOpenExternalUrl`, which reports a
  failure to the member with a toast. `useToast` throws outside a ToastProvider, and these
  tests render the screen on its own. Stable references so a screen holding `show` in a
  dependency array does not re-run its effects on every render.
*/
jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});


import ResourcesScreen from './resources';

describe('ResourcesScreen', () => {
  it.each([401, 403, 404].flatMap((status) => ['page', 'refresh'].map((operation) => [status, operation] as const)))('withdraws retained resource and KB rows after status %s on %s, including during recovery', async (status, operation) => {
    mockRealPagination = true;
    const page = { items: [{ id: 1, title: 'Previously allowed' }], cursor: 'next', hasMore: true };
    for (const tab of ['Files', 'Knowledge']) {
      const loader = tab === 'Files' ? mockGetResources : mockGetKbArticles;
      loader.mockResolvedValue(page);
      const screen = render(<ResourcesScreen />);
      await act(async () => { fireEvent.press(screen.getByText(tab)); });
      await waitFor(() => expect(screen.getByText('Previously allowed')).toBeTruthy());
      loader.mockRejectedValue(new ApiResponseError(status, 'Refused'));
      await act(async () => {
        if (operation === 'page') fireEvent.press(screen.getByText('common:buttons.loadMore'));
        else screen.UNSAFE_getByType(RefreshControl).props.onRefresh();
      });
      expect(screen.queryByText('Previously allowed')).toBeNull();
      expect(screen.queryByText('common:buttons.loadMore')).toBeNull();
      expect(screen.queryByTestId('refresh-failed-notice')).toBeNull();
      expect(screen.getByText('common:errors.notAvailableTitle')).toBeTruthy();
      let finish!: (value: typeof page) => void;
      loader.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
      await act(async () => { screen.UNSAFE_getByType(RefreshControl).props.onRefresh(); });
      expect(screen.queryByText('Previously allowed')).toBeNull();
      await act(async () => { finish(page); });
      expect(screen.getByText('Previously allowed')).toBeTruthy();
      expect(screen.queryByText('common:errors.notAvailableTitle')).toBeNull();
      screen.unmount();
    }
  });
  beforeEach(() => {
    jest.clearAllMocks();
    mockParams = {};
    mockHasMore = false;
    mockRealPagination = false;
    mockRealSavedRead = false;
    mockGetResources.mockReset();
    mockGetKbArticles.mockReset().mockResolvedValue({ items: [], cursor: null, hasMore: false });
    mockSearchKbArticlePage.mockReset().mockResolvedValue({ items: [], cursor: null, hasMore: false });
    const resourcesState = {
      data: {
        items: [
          {
            id: 1,
            title: 'Member handbook',
            description: 'A useful PDF.',
            file_url: 'https://example.test/handbook.pdf',
            file_path: 'handbook.pdf',
            downloads: 4,
            category: { id: 10, name: 'Guides' },
          },
        ],
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    const categoriesState = {
      data: [{ id: 10, name: 'Guides', resource_count: 1 }],
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    const kbState = {
      data: {
        items: [{ id: 7, title: 'Using time credits', content_preview: 'How credits work.', category_name: 'Basics' }],
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    };
    const kbSearchState = { data: [], isLoading: false, error: null, refresh: jest.fn() };
    mockUseApi.mockImplementation((loader: unknown) => {
      const source = String(loader);
      if (source.includes('getResourceCategories')) return categoriesState;
      if (source.includes('searchKbArticlePage')) return kbSearchState;
      if (source.includes('getKbArticles')) return kbState;
      return resourcesState;
    });
  });

  it('renders resources and opens resource downloads', async () => {
    /*
      Spied on react-native's Linking, which is what `openExternalUrl` uses. This asserted
      on `expo-linking` before the screen moved to the shared helper; both reach the same
      native module, but only one of them is the boundary the screen now crosses.
    */
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    try {
      const { getAllByText, getByText } = render(<ResourcesScreen />);

      expect(getAllByText('Resources').length).toBeGreaterThan(0);
      expect(getByText('Member handbook')).toBeTruthy();
      expect(getAllByText('Guides').length).toBeGreaterThan(0);

      fireEvent.press(getByText('Open resource'));
      await waitFor(() => expect(openURL).toHaveBeenCalledWith('https://example.test/handbook.pdf'));
    } finally {
      openURL.mockRestore();
    }
  });
  it.each(['Files', 'Knowledge'])('offers the next page of %s only when available', (tab) => {
    mockHasMore = true;
    const screen = render(<ResourcesScreen />);
    fireEvent.press(screen.getByText(tab));
    fireEvent.press(screen.getByText('common:buttons.loadMore'));
    expect(mockLoadMore).toHaveBeenCalledTimes(1);
    mockHasMore = false;
    screen.rerender(<ResourcesScreen />);
    expect(screen.queryByText('common:buttons.loadMore')).toBeNull();
  });

  it('appends pages and retries a failed page with its cursor through the real hook', async () => {
    mockRealPagination = true;
    let failed = true;
    mockGetResources.mockImplementation(async ({ cursor }: { cursor?: string }) => {
      if (!cursor) return { items: [{ id: 1, title: 'First file' }], cursor: 'page-two', hasMore: true };
      if (failed) throw new Error('Page failed');
      return { items: [{ id: 2, title: 'Second file' }], cursor: null, hasMore: false };
    });
    const screen = render(<ResourcesScreen />);
    await waitFor(() => expect(screen.getByText('First file')).toBeTruthy());
    await act(async () => { fireEvent.press(screen.getByText('common:buttons.loadMore')); });
    expect(screen.getByTestId('refresh-failed-notice')).toBeTruthy();
    expect(screen.getByText('First file')).toBeTruthy();
    expect(mockGetResources).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'page-two' }));
    failed = false;
    await act(async () => { fireEvent.press(screen.getByLabelText('Retry')); });
    expect(screen.getByText('First file')).toBeTruthy();
    expect(screen.getByText('Second file')).toBeTruthy();
    expect(screen.queryByText('common:buttons.loadMore')).toBeNull();
    expect(screen.queryByTestId('refresh-failed-notice')).toBeNull();
    expect(mockGetResources).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'page-two' }));
    await act(async () => { fireEvent.press(screen.getByText('Guides')); });
    expect(mockGetResources).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: null, categoryId: 10 }));
    expect(screen.queryByText('Second file')).toBeNull();
    expect(screen.getByText('First file')).toBeTruthy();
  });

  it('recovers KB page failures and resets browsing after search with the real hook', async () => {
    mockRealPagination = true;
    mockGetResources.mockResolvedValue({ items: [], cursor: null, hasMore: false });
    let failed = true;
    mockGetKbArticles.mockImplementation(async (cursor: string | null) => {
      if (!cursor) return { items: [{ id: 1, title: 'First article' }], cursor: 'kb-next', hasMore: true };
      if (failed) throw new Error('KB page unavailable');
      return { items: [{ id: 2, title: 'Older article' }], cursor: null, hasMore: false };
    });
    const screen = render(<ResourcesScreen />);
    await act(async () => { fireEvent.press(screen.getByText('Knowledge')); });
    expect(screen.getByText('First article')).toBeTruthy();
    await act(async () => { fireEvent.press(screen.getByText('common:buttons.loadMore')); });
    expect(screen.getByTestId('refresh-failed-notice')).toBeTruthy();
    expect(screen.getByText('First article')).toBeTruthy();
    failed = false;
    await act(async () => { fireEvent.press(screen.getByLabelText('Retry')); });
    expect(mockGetKbArticles).toHaveBeenLastCalledWith('kb-next');
    expect(screen.getByText('Older article')).toBeTruthy();
    expect(screen.queryByText('common:buttons.loadMore')).toBeNull();
    jest.useFakeTimers();
    try {
      fireEvent.changeText(screen.getByPlaceholderText('Search resources'), 'compost');
      await act(async () => { jest.advanceTimersByTime(350); });
      expect(screen.queryByText('Older article')).toBeNull();
      fireEvent.changeText(screen.getByPlaceholderText('Search resources'), '');
      await act(async () => { jest.advanceTimersByTime(350); });
      expect(mockGetKbArticles).toHaveBeenLastCalledWith(null);
      expect(screen.getByText('First article')).toBeTruthy();
      expect(screen.queryByText('Older article')).toBeNull();
    } finally { jest.useRealTimers(); }
  });

  it('loads a saved resource independently of the browse page and offers recovery', () => {
    mockParams = { item: '999' };
    const original = mockUseApi.getMockImplementation()!;
    const retry = jest.fn();
    let state = { data: null as unknown, isLoading: false, error: 'Saved resource offline' as string | null, errorStatus: 500, refresh: retry };
    mockUseApi.mockImplementation((loader: unknown) => String(loader).includes('resourceId') ? state : original(loader));
    const screen = render(<ResourcesScreen />);
    expect(screen.getByText('Member handbook')).toBeTruthy();
    retry.mockClear();
    fireEvent.press(screen.getByText('Retry'));
    expect(retry).toHaveBeenCalledTimes(1);
    state = { ...state, error: null, data: { items: [{ id: 999, title: 'Older saved file' }] } };
    screen.rerender(<ResourcesScreen />);
    expect(screen.getByTestId('resource-card-highlighted-999')).toBeTruthy();
    expect(screen.getByText('Older saved file')).toBeTruthy();
    state = { ...state, data: { items: [] } };
    screen.rerender(<ResourcesScreen />);
    expect(screen.getByText('common:errors.notAvailableTitle')).toBeTruthy();
    expect(screen.queryByText('Older saved file')).toBeNull();
  });

  it('ignores an old saved-resource response after navigating to another saved file', async () => {
    mockRealSavedRead = true;
    mockParams = { item: '999' };
    let finishOld!: (value: unknown) => void;
    mockGetResources.mockImplementation(({ resourceId }: { resourceId: number }) => resourceId === 999
      ? new Promise((resolve) => { finishOld = resolve; })
      : Promise.resolve({ items: [{ id: 1000, title: 'Current saved file' }] }));
    const screen = render(<ResourcesScreen />);
    mockParams = { item: '1000' };
    await act(async () => { screen.rerender(<ResourcesScreen />); });
    expect(screen.getByText('Current saved file')).toBeTruthy();
    await act(async () => { finishOld({ items: [{ id: 999, title: 'Old saved file' }] }); });
    expect(screen.queryByText('Old saved file')).toBeNull();
    expect(screen.getByText('Current saved file')).toBeTruthy();
  });

  it('rechecks the saved file on pull refresh and hides it when removed', async () => {
    mockRealSavedRead = true;
    mockParams = { item: '999' };
    mockGetResources.mockResolvedValue({ items: [{ id: 999, title: 'Saved file' }] });
    const screen = render(<ResourcesScreen />);
    await waitFor(() => expect(screen.getByText('Saved file')).toBeTruthy());
    mockGetResources.mockResolvedValue({ items: [] });
    await act(async () => { fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh'); });
    expect(screen.queryByText('Saved file')).toBeNull();
    expect(screen.getByText('common:errors.notAvailableTitle')).toBeTruthy();
  });

  it('keeps files available while failed categories offer their own retry', () => {
    const original = mockUseApi.getMockImplementation()!;
    const retry = jest.fn();
    let failed = true;
    mockUseApi.mockImplementation((loader: unknown) => {
      const state = original(loader);
      return String(loader).includes('getResourceCategories')
        ? { ...state, data: failed ? null : state.data, error: failed ? 'Category service unavailable' : null, refresh: retry }
        : state;
    });
    const screen = render(<ResourcesScreen />);
    expect(screen.getByText('Member handbook')).toBeTruthy();
    expect(screen.getByText('Category service unavailable')).toBeTruthy();
    retry.mockClear();
    fireEvent.press(screen.getByText('Retry'));
    expect(retry).toHaveBeenCalledTimes(1);
    failed = false;
    screen.rerender(<ResourcesScreen />);
    expect(screen.queryByText('Category service unavailable')).toBeNull();
    expect(screen.getAllByText('Guides').length).toBeGreaterThan(0);
  });

  it('renders knowledge base articles and routes to detail', () => {
    const { getByText } = render(<ResourcesScreen />);

    fireEvent.press(getByText('Knowledge'));
    expect(getByText('Using time credits')).toBeTruthy();

    fireEvent.press(getByText('Read article'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(modals)/kb-article', params: { id: '7' } });
  });

  it('re-reads the list when the member comes back to it', () => {
    /*
      🔴 Measured on a device 2026-08-24: a resource was uploaded, this screen was reopened,
      and it still said "Nothing found" while making NO request at all. It had fetched once
      when the community had none. A member who adds a file is told there is nothing here
      until they restart the app — and the pull-to-refresh control makes that staleness read
      as "there really is nothing" rather than "nobody asked".
    */
    const refreshResources = jest.fn();
    const refreshCategories = jest.fn();
    /*
      The default harness cycles three useApi calls (resources, categories, knowledge) and
      the screen renders their real shapes, so the states are reused and only the refresh
      functions are swapped — a bare `{ data: [] }` here would crash on `categories.map`.
    */
    let call = 0;
    mockUseApi.mockImplementation(() => {
      call += 1;
      const index = ((call - 1) % 3) + 1;
      if (index === 1) {
        return { data: { data: [] }, isLoading: false, error: null, refresh: refreshResources };
      }
      if (index === 2) {
        // Categories arrive as a bare array, not an envelope — the screen maps over it.
        return { data: [], isLoading: false, error: null, refresh: refreshCategories };
      }
      return { data: { items: [] }, isLoading: false, error: null, refresh: jest.fn() };
    });

    render(<ResourcesScreen />);

    expect(refreshResources).toHaveBeenCalled();
    expect(refreshCategories).toHaveBeenCalled();
  });

  /*
    🔴 The knowledge-base search only filtered the articles already on screen: the tab
    fetched one page and matched the typed term against those rows in JavaScript. An
    article that answered the question exactly, but sat outside that page, came back as
    "no results" — the app telling a member their community had no answer when it did.
    `searchKbArticles` hits an endpoint that searches all of them and had no caller
    outside its own unit test. Audit 2026-09-07 F-15, fixed 2026-09-09.
  */
  describe('knowledge-base search', () => {
    it.each([401, 403, 404])('removes search results when a later page is refused with %s', async (status) => {
      mockRealPagination = true;
      mockGetResources.mockResolvedValue({ items: [], cursor: null, hasMore: false });
      mockSearchKbArticlePage.mockImplementation(async (_term: string, cursor: string | null) => {
        if (cursor) throw new ApiResponseError(status, 'Unavailable');
        return { items: [{ id: 1, title: 'Allowed search match' }], cursor: 'next', hasMore: true };
      });
      jest.useFakeTimers();
      try {
        const screen = render(<ResourcesScreen />);
        await act(async () => { fireEvent.press(screen.getByText('Knowledge')); });
        fireEvent.changeText(screen.getByPlaceholderText('Search resources'), 'credits');
        await act(async () => { jest.advanceTimersByTime(350); });
        expect(screen.getByText('Allowed search match')).toBeTruthy();
        await act(async () => { fireEvent.press(screen.getByText('common:buttons.loadMore')); });
        expect(screen.queryByText('Allowed search match')).toBeNull();
        expect(screen.queryByText('common:buttons.loadMore')).toBeNull();
        expect(screen.getByText('common:errors.notAvailableTitle')).toBeTruthy();
      } finally { jest.useRealTimers(); }
    });
    it('pages search results, retries the failed cursor, and discards a late page after changing term', async () => {
      mockRealPagination = true;
      mockGetResources.mockResolvedValue({ items: [], cursor: null, hasMore: false });
      let failNext = true;
      let finishOld!: (value: unknown) => void;
      mockSearchKbArticlePage.mockImplementation(async (term: string, cursor: string | null) => {
        if (term === 'new') return { items: [{ id: 9, title: 'New result' }], cursor: null, hasMore: false };
        if (!cursor) return { items: [{ id: 1, title: 'First match' }], cursor: 'second', hasMore: true };
        if (failNext) throw new ApiResponseError(429, 'Try later');
        if (cursor === 'second') return { items: [{ id: 2, title: 'Second match' }], cursor: 'third', hasMore: true };
        return new Promise((resolve) => { finishOld = resolve; });
      });
      jest.useFakeTimers();
      try {
        const screen = render(<ResourcesScreen />);
        await act(async () => { fireEvent.press(screen.getByText('Knowledge')); });
        fireEvent.changeText(screen.getByPlaceholderText('Search resources'), 'credits');
        await act(async () => { jest.advanceTimersByTime(350); });
        expect(screen.getByText('First match')).toBeTruthy();
        await act(async () => { fireEvent.press(screen.getByText('common:buttons.loadMore')); });
        expect(screen.getByText('First match')).toBeTruthy();
        expect(screen.getByTestId('refresh-failed-notice')).toBeTruthy();
        failNext = false;
        await act(async () => { fireEvent.press(screen.getByLabelText('Retry')); });
        expect(mockSearchKbArticlePage).toHaveBeenLastCalledWith('credits', 'second');
        expect(screen.getByText('First match')).toBeTruthy();
        expect(screen.getByText('Second match')).toBeTruthy();
        await act(async () => { fireEvent.press(screen.getByText('common:buttons.loadMore')); });
        fireEvent.changeText(screen.getByPlaceholderText('Search resources'), 'new');
        await act(async () => { jest.advanceTimersByTime(350); });
        expect(screen.getByText('New result')).toBeTruthy();
        expect(screen.queryByText('First match')).toBeNull();
        expect(screen.queryByText('common:buttons.loadMore')).toBeNull();
        await act(async () => { finishOld({ items: [{ id: 3, title: 'Late old match' }], cursor: null, hasMore: false }); });
        expect(screen.queryByText('Late old match')).toBeNull();
        expect(screen.getByText('New result')).toBeTruthy();
        fireEvent.changeText(screen.getByPlaceholderText('Search resources'), '');
        await act(async () => { jest.advanceTimersByTime(350); });
        expect(screen.queryByText('New result')).toBeNull();
        expect(mockGetKbArticles).toHaveBeenLastCalledWith(null);
      } finally { jest.useRealTimers(); }
    });
    it('refreshes the current search mode after entering and clearing a term', () => {
      jest.useFakeTimers();
      try {
        const original = mockUseApi.getMockImplementation()!;
        const browseRefresh = jest.fn();
        const searchRefresh = jest.fn();
        mockUseApi.mockImplementation((loader: unknown) => {
          const state = original(loader);
          const source = String(loader);
          if (source.includes('searchKbArticlePage')) return { ...state, refresh: searchRefresh };
          if (source.includes('getKbArticles')) return { ...state, refresh: browseRefresh };
          return state;
        });
        const screen = render(<ResourcesScreen />);
        fireEvent.press(screen.getByText('Knowledge'));
        fireEvent.changeText(screen.getByPlaceholderText('Search resources'), 'compost');
        act(() => jest.advanceTimersByTime(350));
        browseRefresh.mockClear();
        searchRefresh.mockClear();
        fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh');
        expect(searchRefresh).toHaveBeenCalledTimes(1);
        expect(browseRefresh).not.toHaveBeenCalled();
        fireEvent.changeText(screen.getByPlaceholderText('Search resources'), '');
        act(() => jest.advanceTimersByTime(350));
        browseRefresh.mockClear();
        searchRefresh.mockClear();
        fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh');
        expect(browseRefresh).toHaveBeenCalledTimes(1);
        expect(searchRefresh).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });
    it('asks the server rather than filtering the page it already has', async () => {
      const screen = render(<ResourcesScreen />);
      fireEvent.press(screen.getByText('Knowledge'));

      fireEvent.changeText(screen.getByPlaceholderText('Search resources'), 'compost');

      // Debounced, so the request is not made per keystroke.
      await waitFor(() => {
        const asked = mockUseApi.mock.calls.some(([loader]) => String(loader).includes('searchKbArticlePage'));
        expect(asked).toBe(true);
      }, { timeout: 3000 });
    });

    it('browses without searching when the box is empty', () => {
      render(<ResourcesScreen />);

      const browsing = mockUseApi.mock.calls.filter(([loader]) => String(loader).includes('getKbArticles'));
      // The search hook is registered but disabled, so no request is made for it.
      const searchCalls = mockUseApi.mock.calls.filter(([loader]) => String(loader).includes('searchKbArticlePage'));
      expect(browsing.length).toBeGreaterThan(0);
      searchCalls.forEach(([, , opts]) => {
        expect((opts as { enabled?: boolean }).enabled).toBe(false);
      });
    });
  });
});
