// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockRouterReplace = jest.fn();
// Keep native telemetry timers out of the screen test; pagination remains real.
jest.mock('@/lib/observability/report', () => ({ reportException: jest.fn() }));

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  useRouter: () => ({ replace: mockRouterReplace, back: jest.fn() }),
  router: {
    replace: mockRouterReplace,
    back: jest.fn(),
    canGoBack: () => false,
  },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'newMessage': 'New message',
        'composer.eyebrow': 'Start a conversation',
        'composer.subtitle': 'Search for a member, then open a private thread.',
        'composer.searchPlaceholder': 'Search members',
        'composer.loading': 'Loading members',
        'composer.emptyTitle': 'No members found',
        'composer.emptySubtitle': 'Try a different name or check the member directory.',
        'composer.memberFallback': 'Community member',
        'composer.resultsCount': `${String(options?.count ?? 0)} members shown`,
        'composer.openThread': `Message ${String(options?.name ?? 'Community member')}`,
        'common:buttons.retry': 'Retry',
        'common:endOfList': 'You have reached the end',
        'common:buttons.back': 'Back',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#006FEE',
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

jest.mock('@/lib/hooks/useDebounce', () => ({
  useDebounce: (value: string) => value,
}));

const mockUsePaginatedApi = jest.fn();
jest.mock('@/lib/hooks/usePaginatedApi', () => ({
  usePaginatedApi: (...args: unknown[]) => mockUsePaginatedApi(...args),
}));

jest.mock('@/lib/api/members', () => ({
  getMembers: jest.fn(),
}));

jest.mock('@/lib/haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/components/ui/Avatar', () => () => null);
jest.mock('@/components/ui/Skeleton', () => ({
  SkeletonBox: () => null,
}));

import NewMessageRoute from './new-message';
import { getMembers } from '@/lib/api/members';

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
  mockRouterReplace.mockReset();
  mockUsePaginatedApi.mockReset();
  jest.mocked(getMembers).mockReset();
  mockUsePaginatedApi.mockReturnValue(defaultPaginatedState);
});

describe('NewMessageRoute', () => {
  it('keeps the current search total when an older directory response arrives last', async () => {
    let resolveOld!: (value: Awaited<ReturnType<typeof getMembers>>) => void;
    jest.mocked(getMembers)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValueOnce({ data: [{ id: 10, name: 'Alice Green' }], meta: { offset: 0, per_page: 20, has_more: false, total_items: 1 } } as Awaited<ReturnType<typeof getMembers>>);
    mockUsePaginatedApi.mockImplementation(jest.requireActual('@/lib/hooks/usePaginatedApi').usePaginatedApi);
    const screen = render(<NewMessageRoute />);
    await waitFor(() => expect(getMembers).toHaveBeenCalledTimes(1));
    fireEvent.changeText(screen.getByPlaceholderText('Search members'), 'Alice');
    await waitFor(() => expect(screen.getByText('1 members shown')).toBeTruthy());
    await act(async () => resolveOld({ data: [], meta: { offset: 0, per_page: 20, has_more: false, total_items: 90 } } as Awaited<ReturnType<typeof getMembers>>));
    expect(screen.getByText('1 members shown')).toBeTruthy();
    expect(screen.queryByText('90 members shown')).toBeNull();
    expect(screen.getByText('Alice Green')).toBeTruthy();
  });

  it('keeps members available and exposes a retry after a later-page failure', () => {
    const refresh = jest.fn();
    mockUsePaginatedApi.mockReturnValue({ ...defaultPaginatedState,
      items: [{ id: 10, name: 'Alice Green', first_name: 'Alice', last_name: 'Green', avatar_url: null }],
      error: 'Connection interrupted', hasMore: true, refresh });
    const { getByText } = render(<NewMessageRoute />);
    expect(getByText('Alice Green')).toBeTruthy();
    expect(getByText('Connection interrupted')).toBeTruthy();
    fireEvent.press(getByText('Retry'));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('renders the native member picker composer', () => {
    mockUsePaginatedApi.mockReturnValue({
      ...defaultPaginatedState,
      items: [
        { id: 10, name: 'Alice Green', first_name: 'Alice', last_name: 'Green', avatar_url: null, tagline: 'Gardener', location: 'Dublin' },
        { id: 11, name: 'Bob Smith', first_name: 'Bob', last_name: 'Smith', avatar_url: null, tagline: null, location: null },
      ],
    });

    const { getAllByText, getByText, getByPlaceholderText } = render(<NewMessageRoute />);

    expect(getAllByText('New message').length).toBeGreaterThan(0);
    expect(getByPlaceholderText('Search members')).toBeTruthy();
    expect(getByText('Alice Green')).toBeTruthy();
    expect(getByText('Gardener')).toBeTruthy();
    expect(getByText('Bob Smith')).toBeTruthy();
  });

  it('opens the thread composer for the selected member', async () => {
    mockUsePaginatedApi.mockReturnValue({
      ...defaultPaginatedState,
      items: [
        { id: 10, name: 'Alice Green', first_name: 'Alice', last_name: 'Green', avatar_url: null, tagline: 'Gardener', location: 'Dublin' },
      ],
    });

    const { getByLabelText } = render(<NewMessageRoute />);

    fireEvent.press(getByLabelText('Message Alice Green'));

    await waitFor(() => expect(mockRouterReplace).toHaveBeenCalledWith({
      pathname: '/(modals)/thread',
      params: { recipientId: '10', name: 'Alice Green' },
    }));
  });

  it('shows a useful empty state when no members match', () => {
    const { getByText } = render(<NewMessageRoute />);

    expect(getByText('No members found')).toBeTruthy();
    expect(getByText('Try a different name or check the member directory.')).toBeTruthy();
  });
});
