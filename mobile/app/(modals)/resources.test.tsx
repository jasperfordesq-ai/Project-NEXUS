// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';

const mockUseApi = jest.fn();
const mockPush = jest.fn();

let mockParams: Record<string, string> = {};
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  router: { push: (...args: unknown[]) => mockPush(...args) },
  // The screen re-reads on focus, so the effect runs its callback once here — the same as
  // arriving on the screen. Without this the list is whatever it was when first fetched,
  // which is the defect the focus refresh fixes.
  useFocusEffect: (callback: () => void) => callback(),
}));

jest.mock('expo-linking', () => ({
  openURL: jest.fn().mockResolvedValue(undefined),
}));

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
  beforeEach(() => {
    jest.clearAllMocks();
    let call = 0;
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
      if (source.includes('searchKbArticles')) return kbSearchState;
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
    it('asks the server rather than filtering the page it already has', async () => {
      const screen = render(<ResourcesScreen />);
      fireEvent.press(screen.getByText('Knowledge'));

      fireEvent.changeText(screen.getByPlaceholderText('Search resources'), 'compost');

      // Debounced, so the request is not made per keystroke.
      await waitFor(() => {
        const asked = mockUseApi.mock.calls.some(([loader]) => String(loader).includes('searchKbArticles'));
        expect(asked).toBe(true);
      }, { timeout: 3000 });
    });

    it('browses without searching when the box is empty', () => {
      render(<ResourcesScreen />);

      const browsing = mockUseApi.mock.calls.filter(([loader]) => String(loader).includes('getKbArticles'));
      // The search hook is registered but disabled, so no request is made for it.
      const searchCalls = mockUseApi.mock.calls.filter(([loader]) => String(loader).includes('searchKbArticles'));
      expect(browsing.length).toBeGreaterThan(0);
      searchCalls.forEach(([, , opts]) => {
        expect((opts as { enabled?: boolean }).enabled).toBe(false);
      });
    });
  });
});
