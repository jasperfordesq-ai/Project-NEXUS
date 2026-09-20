// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { FlatList, Linking, RefreshControl } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => ({}),
}));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) => ({
      title: 'Clubs',
      subtitle: 'Community clubs you can join',
      search_placeholder: 'Search clubs…',
      view: 'Visit website',
      'empty.title': 'No clubs yet.',
      'empty.body': 'Check back soon.',
      member_count: `${String(values?.count ?? 0)} members`,
      meeting_schedule: `Meets ${String(values?.schedule ?? '')}`,
      'common:buttons.retry': 'Retry',
      'common:actions.clear': 'Clear',
      'common:back': 'Back',
    } as Record<string, string>)[key] ?? key,
  }),
}));
jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
  useTenant: () => ({ hasFeature: () => true, tenant: { id: 2 } }),
}));
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 7 } }) }));
jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({ bg: '#fff', text: '#111', textSecondary: '#555', textMuted: '#777', border: '#ddd' }),
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

jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ModalErrorBoundary', () => ({ children }: { children: React.ReactNode }) => children);
jest.mock('@/components/ui/LoadingSpinner', () => () => null);
jest.mock('@/lib/api/clubs', () => ({ getClubs: jest.fn() }));

import ClubsScreen from './clubs';
import { getClubs } from '@/lib/api/clubs';
import { ApiResponseError } from '@/lib/api/client';

const page = (items: unknown[]) => ({ items, page: 1, total: items.length, hasMore: false });

describe('ClubsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    jest.mocked(getClubs).mockResolvedValue(page([
      {
        id: 3,
        name: 'Repair Café',
        description: 'Fix things together.',
        meeting_schedule: 'first Saturday',
        member_count: 24,
        website: 'https://example.org/repair',
      },
      { id: 4, name: 'Walking Group', member_count: 8 },
    ]) as never);
  });


  it('loads the next page, preserves earlier clubs on failure, and retries the same page', async () => {
    jest.mocked(getClubs).mockResolvedValueOnce({ items: [{ id: 1, name: 'First club', member_count: 1 }], page: 1, total: 21, hasMore: true });
    const screen = render(<ClubsScreen />);
    await waitFor(() => expect(screen.getByText('First club')).toBeTruthy());
    jest.mocked(getClubs).mockRejectedValue(new ApiResponseError(422, 'Later page failed'));
    fireEvent(screen.UNSAFE_getByType(FlatList), 'endReached');
    await waitFor(() => expect(screen.getByText('Later page failed')).toBeTruthy());
    expect(screen.getByText('First club')).toBeTruthy();
    expect(getClubs).toHaveBeenLastCalledWith({ search: undefined, page: 2 });
    const calls = jest.mocked(getClubs).mock.calls.length;
    fireEvent(screen.UNSAFE_getByType(FlatList), 'endReached');
    expect(getClubs).toHaveBeenCalledTimes(calls);
    jest.mocked(getClubs).mockResolvedValue({ items: [{ id: 21, name: 'Last club', member_count: 2 }], page: 2, total: 21, hasMore: false });
    fireEvent.press(screen.getByText('Retry'));
    await waitFor(() => expect(screen.getByText('Last club')).toBeTruthy());
    expect(screen.getByText('First club')).toBeTruthy();
    expect(getClubs).toHaveBeenLastCalledWith({ search: undefined, page: 2 });
  });


  it('replaces paged results on search and ignores an older pending page', async () => {
    jest.mocked(getClubs).mockResolvedValueOnce({ items: [{ id: 1, name: 'Old club', member_count: 1 }], page: 1, total: 21, hasMore: true });
    const screen = render(<ClubsScreen />);
    await waitFor(() => expect(screen.getByText('Old club')).toBeTruthy());
    let completePage!: (value: Awaited<ReturnType<typeof getClubs>>) => void;
    jest.mocked(getClubs).mockImplementationOnce(() => new Promise(resolve => { completePage = resolve; }));
    fireEvent(screen.UNSAFE_getByType(FlatList), 'endReached');
    await waitFor(() => expect(getClubs).toHaveBeenLastCalledWith({ search: undefined, page: 2 }));
    jest.mocked(getClubs).mockResolvedValueOnce({ items: [{ id: 3, name: 'Matching club', member_count: 1 }], page: 1, total: 1, hasMore: false });
    fireEvent.changeText(screen.getByPlaceholderText('Search clubs…'), 'matching');
    fireEvent(screen.getByPlaceholderText('Search clubs…'), 'submitEditing');
    await waitFor(() => expect(screen.getByText('Matching club')).toBeTruthy());
    await act(async () => completePage({ items: [{ id: 2, name: 'Stale club', member_count: 1 }], page: 2, total: 21, hasMore: false }));
    expect(screen.queryByText('Stale club')).toBeNull();
    expect(screen.queryByText('Old club')).toBeNull();
    expect(screen.getByText('Matching club')).toBeTruthy();
  });


  it.each([401, 403, 404])('clears loaded clubs and removes retry after refresh refusal %s', async (status) => {
    const screen = render(<ClubsScreen />);
    await waitFor(() => expect(screen.getByText('Repair Café')).toBeTruthy());
    jest.mocked(getClubs).mockRejectedValue(new ApiResponseError(status, 'Directory unavailable'));
    act(() => screen.UNSAFE_getByType(RefreshControl).props.onRefresh());
    await waitFor(() => expect(screen.getByText('common:errors.notAvailableTitle')).toBeTruthy());
    expect(screen.queryByText('Repair Café')).toBeNull();
    expect(screen.queryByLabelText('Visit website: Repair Café')).toBeNull();
    expect(screen.queryByText('Retry')).toBeNull();
  });

  it.each([401, 403, 404])('shows unavailable without retry after initial refusal %s', async (status) => {
    jest.mocked(getClubs).mockRejectedValue(new ApiResponseError(status, 'Directory unavailable'));
    const screen = render(<ClubsScreen />);
    await waitFor(() => expect(screen.getByText('common:errors.notAvailableTitle')).toBeTruthy());
    expect(screen.queryByText('Retry')).toBeNull();
    expect(screen.queryByText('No clubs yet.')).toBeNull();
  });


  it('preserves the full description when a club has no detail route or website', async () => {
    const description = 'A long club description. '.repeat(40);
    jest.mocked(getClubs).mockResolvedValue({ items: [{ id: 9, name: 'Community Club', member_count: 1, description }], page: 1, total: 1, hasMore: false });
    const screen = render(<ClubsScreen />);
    const text = await screen.findByText(description);
    expect(text.props.numberOfLines).toBeUndefined();
  });

  it('lists the clubs with their membership and meeting detail', async () => {
    const { getByText } = render(<ClubsScreen />);
    await waitFor(() => expect(getByText('Repair Café')).toBeTruthy());
    expect(getByText('24 members')).toBeTruthy();
    expect(getByText('Meets first Saturday')).toBeTruthy();
    expect(getByText('Walking Group')).toBeTruthy();
  });

  it('opens the club website when the card is pressed', async () => {
    const { getByLabelText } = render(<ClubsScreen />);
    await waitFor(() => expect(getByLabelText('Visit website: Repair Café')).toBeTruthy());
    fireEvent.press(getByLabelText('Visit website: Repair Café'));
    expect(Linking.openURL).toHaveBeenCalledWith('https://example.org/repair');
  });

  it('searches on submit and clears the query when the field is emptied', async () => {
    const { getByPlaceholderText } = render(<ClubsScreen />);
    await waitFor(() => expect(getClubs).toHaveBeenCalledTimes(1));
    const field = getByPlaceholderText('Search clubs…');
    fireEvent.changeText(field, 'repair');
    fireEvent(field, 'submitEditing');
    await waitFor(() => expect(getClubs).toHaveBeenCalledWith({ search: 'repair', page: 1 }));
    fireEvent.changeText(field, '');
    await waitFor(() => expect(getClubs).toHaveBeenLastCalledWith({ search: undefined, page: 1 }));
  });

  it('offers a retry when the list cannot be loaded', async () => {
    jest.mocked(getClubs).mockRejectedValue(new ApiResponseError(500, 'Clubs unavailable'));
    const { getByText } = render(<ClubsScreen />);
    await waitFor(() => expect(getByText('Clubs unavailable')).toBeTruthy(), { timeout: 5000 });
    fireEvent.press(getByText('Retry'));
    await waitFor(() => expect(jest.mocked(getClubs).mock.calls.length).toBeGreaterThan(1));
  });

  it('recovers a failed refresh from page one and replaces the stale list', async () => {
    const screen = render(<ClubsScreen />);
    await screen.findByText('Repair Café');
    jest.mocked(getClubs).mockRejectedValueOnce(new ApiResponseError(422, 'Refresh unavailable'));
    await act(async () => screen.UNSAFE_getByType(RefreshControl).props.onRefresh());
    expect(screen.getByTestId('refresh-failed-notice')).toBeTruthy();
    expect(screen.getByText('Repair Café')).toBeTruthy();
    jest.mocked(getClubs).mockResolvedValueOnce({ items: [{ id: 5, name: 'Updated club', member_count: 3 }], page: 1, total: 1, hasMore: false });
    fireEvent.press(screen.getByText('Retry'));
    await screen.findByText('Updated club');
    expect(getClubs).toHaveBeenLastCalledWith({ search: undefined, page: 1 });
    expect(screen.queryByText('Repair Café')).toBeNull();
    expect(screen.queryByTestId('refresh-failed-notice')).toBeNull();
  });

  it('keeps loaded clubs visible and reports a failed refresh', async () => {
    const rendered = render(<ClubsScreen />);
    await waitFor(() => expect(rendered.getByText('Repair Café')).toBeTruthy());
    jest.mocked(getClubs).mockRejectedValue(new ApiResponseError(422, 'Could not refresh clubs'));
    act(() => rendered.UNSAFE_getByType(RefreshControl).props.onRefresh());

    await waitFor(() => expect(rendered.getByTestId('refresh-failed-notice')).toBeTruthy());
    expect(rendered.getByText('Repair Café')).toBeTruthy();
  });
});
