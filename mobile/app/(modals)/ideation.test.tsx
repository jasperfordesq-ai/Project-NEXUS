// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

const mockUseApi = jest.fn();
const mockPush = jest.fn();

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));

const mockUsePaginatedApi = jest.fn();
jest.mock('@/lib/hooks/usePaginatedApi', () => ({
  usePaginatedApi: (...args: unknown[]) => mockUsePaginatedApi(...args),
}));
jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
  useTenant: () => ({ hasFeature: () => true }),
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#ffffff',
    text: '#111827',
    textSecondary: '#4b5563',
    textMuted: '#6b7280',
    info: '#2563eb',
    borderSubtle: '#e5e7eb',
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
        'ideation:title': 'Ideas',
        'ideation:subtitle': 'Browse challenges, submit ideas, and vote on proposals.',
        'ideation:searchLabel': 'Search',
        'ideation:searchPlaceholder': 'Search challenges',
        'ideation:allCategories': 'All',
        'ideation:categoryCount': opts ? `${String(opts.count)} challenges` : 'challenges',
        'ideation:filters.all': 'All',
        'ideation:filters.open': 'Open',
        'ideation:filters.voting': 'Voting',
        'ideation:filters.evaluating': 'Evaluating',
        'ideation:filters.closed': 'Closed',
        'ideation:status.open': 'Open',
        'ideation:ideasCount': opts ? `${String(opts.count)} ideas` : 'ideas',
        'ideation:viewChallenge': 'View challenge',
      };
      return map[key] ?? key;
    },
  }),
}));

import IdeationScreen from './ideation';

describe('IdeationScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUsePaginatedApi.mockReturnValue({
      items: [
        {
          id: 12,
          title: 'Improve the park',
          description: 'Collect ideas for safer paths.',
          status: 'open',
          category: 'Environment',
          ideas_count: 3,
        },
      ],
      isLoading: false,
      isLoadingMore: false,
      error: null,
      errorStatus: null,
      errorCode: null,
      hasMore: false,
      loadMore: jest.fn(),
      refresh: jest.fn(),
    });
    // useApi is left with the category strip only — no more odd/even call counting.
    mockUseApi.mockReturnValue({
      data: [{ id: 5, name: 'Environment', challenges_count: 1 }],
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });
  });

  it('keeps the native ideation list frame full height with an explicit background', () => {
    const { getByTestId } = render(<IdeationScreen />);
    const screen = getByTestId('ideation-screen');
    const scroll = getByTestId('ideation-scroll');

    expect(screen.props.style).toEqual(expect.objectContaining({
      flex: 1,
      backgroundColor: '#ffffff',
    }));
    expect(scroll.props.style).toEqual(expect.objectContaining({
      flex: 1,
      backgroundColor: '#ffffff',
    }));
    expect(scroll.props.contentContainerStyle).toEqual(expect.objectContaining({
      flexGrow: 1,
      backgroundColor: '#ffffff',
      paddingBottom: 40,
    }));
  });

  it('renders challenges and opens detail', () => {
    const { getAllByText, getByLabelText } = render(<IdeationScreen />);

    expect(getAllByText('Ideas').length).toBeGreaterThan(0);
    expect(getAllByText('Environment').length).toBeGreaterThan(0);
    const challenge = getByLabelText(
      'Improve the park, Open, Environment, 3 ideas',
    );
    expect(challenge).toBeTruthy();

    fireEvent.press(challenge);
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/(modals)/ideation-detail', params: { id: '12' } });
  });

  /*
    🔴 The challenge list asked for one page and stopped: a community running more
    challenges than fit a page had the rest invisible, with no button and no hint.
    The endpoint has always returned a cursor and `hasMore`. Audit F-6, fixed 2026-09-09.
  */
  describe('paging', () => {
    it('offers to load more only when the server says there is more', () => {
      const screen = render(<IdeationScreen />);
      expect(screen.queryByTestId('ideation-load-more')).toBeNull();
    });

    it('asks for the next page when the member presses it', () => {
      const loadMore = jest.fn();
      mockUsePaginatedApi.mockReturnValue({
        items: [{ id: 12, title: 'Improve the park', description: 'x', status: 'open', category: 'Environment', ideas_count: 3 }],
        isLoading: false,
        isLoadingMore: false,
        error: null,
        errorStatus: null,
        errorCode: null,
        hasMore: true,
        loadMore,
        refresh: jest.fn(),
      });

      const screen = render(<IdeationScreen />);
      fireEvent.press(screen.getByTestId('ideation-load-more'));

      expect(loadMore).toHaveBeenCalled();
    });

    it('starts the list over when a filter changes', () => {
      // The hook is keyed on status, search and category, so changing one resets to
      // page one. Appending page two of a filtered list under page one of an
      // unfiltered one would be worse than not paging at all.
      render(<IdeationScreen />);

      const deps = mockUsePaginatedApi.mock.calls[0][2] as unknown[];
      expect(deps).toHaveLength(3);
    });
  });
});
