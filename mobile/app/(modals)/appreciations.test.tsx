// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { FlatList } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockUseApi = jest.fn();
const mockReactToAppreciation = jest.fn();
const mockGetAppreciations = jest.fn();
let mockUserId: string | string[] = '7';

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => ({ userId: mockUserId, name: 'Alice' }),
}));

jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ isAuthenticated: true }),
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
jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/LoadingSpinner', () => () => null);

/*
  🔴 A namespace-aware stand-in, deliberately.

  The old mock served every key from one map whatever namespace was asked for, so it
  could not see that `AppreciationCard` asked for `profile` — a namespace with no
  `appreciations` block — and that i18next was therefore returning each key verbatim.
  Every card on the wall showed the literal text "appreciations.react.heart" on its
  buttons. This mock resolves keys only for the namespace that actually holds them.
*/
jest.mock('react-i18next', () => ({
  useTranslation: (ns?: string | string[]) => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const namespaces = Array.isArray(ns) ? ns : [ns ?? 'common'];
      const servedHere = namespaces.includes('members') || key.startsWith('common:');
      if (!servedHere) return key;
      const map: Record<string, string> = {
        'common:back': 'Back',
        'common:buttons.retry': 'Retry',
        'appreciations.wallTitle': 'Appreciations',
        'appreciations.wallTitleFor': opts ? `${String(opts.name)}'s appreciations` : 'Appreciations',
        'appreciations.wallSubtitle': 'Public thank-you notes and reactions from the community.',
        'appreciations.emptyTitle': 'No public appreciations yet',
        'appreciations.emptySubtitle': 'Thank-you notes will appear here when members share them publicly.',
        'appreciations.errorTitle': 'Could not load appreciations',
        'appreciations.loadMore': 'Load more',
        'appreciations.someone': 'Community member',
        'appreciations.signInTitle': 'Sign in to react',
        'appreciations.signInMessage': 'Reactions are available after you sign in.',
        'appreciations.reactionFailed': 'Could not update that reaction.',
        'appreciations.reaction.heart': 'React with heart',
        'appreciations.react.heart': 'Heart',
        'appreciations.reaction.clap': 'React with clap',
        'appreciations.react.clap': 'Clap',
        'appreciations.reaction.star': 'React with star',
        'appreciations.react.star': 'Star',
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('@/lib/api/appreciations', () => ({
  getUserAppreciations: (...args: unknown[]) => mockGetAppreciations(...args),
  reactToAppreciation: (...args: unknown[]) => mockReactToAppreciation(...args),
}));

jest.mock('@/components/ui/AppToast', () => {
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

import AppreciationsScreen from './appreciations';
import { ApiResponseError } from '@/lib/api/client';
import type { AppreciationListResponse } from '@/lib/api/appreciations';

function pendingPage() {
  let resolve!: (value: AppreciationListResponse) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<AppreciationListResponse>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('AppreciationsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserId = '7';
    mockGetAppreciations.mockReset();
    mockReactToAppreciation.mockReset().mockResolvedValue({ data: { reacted: true, reaction_type: 'heart' } });
    mockUseApi.mockReturnValue({
      data: {
        requestedPage: 1,
        data: [
          {
            id: 12,
            sender_id: 3,
            receiver_id: 7,
            message: 'Thank you for helping with the garden.',
            is_public: true,
            reactions_count: 1,
            created_at: '2026-05-29T10:00:00Z',
            sender: { id: 3, name: 'Sam Lee', avatar_url: null },
            my_reaction: null,
          },
        ],
        meta: { current_page: 1, last_page: 1 },
      },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });
  });

  it.each([{ value: ['7'] }, { value: ['7', '8'] }, { value: '' }, { value: '0' }, { value: '-1' }, { value: '1.5' }, { value: '9007199254740992' }])('rejects invalid member route %j without a request', async ({ value }) => {
    mockUserId = value;
    mockUseApi.mockImplementation(jest.requireActual('@/lib/hooks/useApi').useApi);
    const screen = render(<AppreciationsScreen />);
    expect(screen.getByText('common:errors.notAvailableTitle')).toBeTruthy();
    expect(mockGetAppreciations).not.toHaveBeenCalled();
  });

  it('renders public appreciations and posts reactions', async () => {
    const { findByText, getByText } = render(<AppreciationsScreen />);

    expect(await findByText('Thank you for helping with the garden.')).toBeTruthy();
    expect(getByText('Sam Lee')).toBeTruthy();

    fireEvent.press(getByText('Heart'));

    await waitFor(() => {
      expect(mockReactToAppreciation).toHaveBeenCalledWith(12, 'heart');
    });
  });
  it('retries the same failed page through the real hook and preserves rows during refresh', async () => {
    const initial = mockUseApi().data;
    const first = { data: initial.data, meta: { current_page: 1, last_page: 2 } };
    const second = { data: [{ ...initial.data[0], id: 13, message: 'Second page note' }], meta: { current_page: 2, last_page: 2 } };
    const failedPage = pendingPage();
    const retryPage = pendingPage();
    const refreshedPage = pendingPage();
    mockGetAppreciations.mockResolvedValueOnce(first)
      .mockReturnValueOnce(failedPage.promise).mockReturnValueOnce(retryPage.promise)
      .mockReturnValueOnce(refreshedPage.promise);
    mockUseApi.mockImplementation(jest.requireActual('@/lib/hooks/useApi').useApi);
    const screen = render(<AppreciationsScreen />);
    await screen.findByText('Load more');
    fireEvent.press(screen.getByText('Load more'));
    await waitFor(() => expect(mockGetAppreciations).toHaveBeenLastCalledWith('7', 2, 20));
    await act(async () => { failedPage.reject(new ApiResponseError(429, 'Try later')); });
    expect(screen.getByText('Thank you for helping with the garden.')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Retry'));
    await waitFor(() => expect(mockGetAppreciations).toHaveBeenCalledTimes(3));
    expect(mockGetAppreciations).toHaveBeenLastCalledWith('7', 2, 20);
    await act(async () => { retryPage.resolve(second); });
    expect(screen.getByText('Second page note')).toBeTruthy();
    act(() => { screen.UNSAFE_getByType(FlatList).props.refreshControl.props.onRefresh(); });
    await waitFor(() => expect(mockGetAppreciations).toHaveBeenLastCalledWith('7', 1, 20));
    expect(screen.getByText('Thank you for helping with the garden.')).toBeTruthy();
    expect(screen.getByText('Second page note')).toBeTruthy();
    await act(async () => { refreshedPage.resolve(first); });
    expect(screen.queryByText('Second page note')).toBeNull();
  });
  it('ignores a delayed response for the previous member through the real hook', async () => {
    const initial = mockUseApi().data;
    const previous = pendingPage();
    const current = pendingPage();
    mockGetAppreciations.mockReturnValueOnce(previous.promise).mockReturnValueOnce(current.promise);
    mockUseApi.mockImplementation(jest.requireActual('@/lib/hooks/useApi').useApi);
    const screen = render(<AppreciationsScreen />);
    mockUserId = '8';
    screen.rerender(<AppreciationsScreen />);
    await act(async () => { current.resolve({ ...initial, data: [{ ...initial.data[0], id: 20, message: 'Current member note' }] }); });
    await act(async () => { previous.resolve(initial); });
    expect(screen.getByText('Current member note')).toBeTruthy();
    expect(screen.queryByText('Thank you for helping with the garden.')).toBeNull();
    expect(mockGetAppreciations.mock.calls).toEqual([['7', 1, 20], ['8', 1, 20]]);
  });
  it.each([false, true])('keeps reaction counts when an overlapping refresh resolves (writeFirst=%s)', async (writeFirst) => {
    const initial = mockUseApi().data;
    const refreshed = pendingPage();
    let finishReaction!: () => void;
    mockGetAppreciations.mockResolvedValueOnce(initial).mockReturnValueOnce(refreshed.promise);
    mockReactToAppreciation.mockImplementationOnce(() => new Promise((resolve) => {
      finishReaction = () => resolve({ data: { reacted: true, reaction_type: 'heart' } });
    }));
    mockUseApi.mockImplementation(jest.requireActual('@/lib/hooks/useApi').useApi);
    const screen = render(<AppreciationsScreen />);
    await screen.findByText('Heart');
    act(() => { screen.UNSAFE_getByType(FlatList).props.refreshControl.props.onRefresh(); });
    fireEvent.press(screen.getByText('Heart'));
    expect(screen.getByText('2')).toBeTruthy();
    if (writeFirst) await act(async () => { finishReaction(); });
    await act(async () => { refreshed.resolve(initial); });
    if (!writeFirst) await act(async () => { finishReaction(); });
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.queryByText('1')).toBeNull();
    mockGetAppreciations.mockResolvedValueOnce({ ...initial, data: [
      { ...initial.data[0], my_reaction: 'heart', reactions_count: 4 },
    ] });
    act(() => { screen.UNSAFE_getByType(FlatList).props.refreshControl.props.onRefresh(); });
    await screen.findByText('4');
    expect(screen.queryByText('2')).toBeNull();
  });
  it('preserves accumulated rows while refreshing from a later page', async () => {
    const state = mockUseApi();
    state.data.meta.last_page = 2;
    const screen = render(<AppreciationsScreen />);
    fireEvent.press(screen.getByText('Load more'));
    mockUseApi.mockReturnValue({ ...state, data: { requestedPage: 2, data: [
      { ...state.data.data[0], id: 13, message: 'Second page note' },
    ], meta: { current_page: 2, last_page: 2 } } });
    screen.rerender(<AppreciationsScreen />);
    expect(screen.getByText('Second page note')).toBeTruthy();
    act(() => { screen.UNSAFE_getByType(FlatList).props.refreshControl.props.onRefresh(); });
    expect(screen.getByText('Thank you for helping with the garden.')).toBeTruthy();
    expect(screen.getByText('Second page note')).toBeTruthy();
  });
  it('preserves refreshed note content when a pending reaction is refused', async () => {
    const initial = mockUseApi().data;
    const refreshed = pendingPage();
    let refuseReaction!: () => void;
    mockGetAppreciations.mockResolvedValueOnce(initial).mockReturnValueOnce(refreshed.promise);
    mockReactToAppreciation.mockImplementationOnce(() => new Promise((_, reject) => {
      refuseReaction = () => reject(new ApiResponseError(403, 'Reaction refused'));
    }));
    mockUseApi.mockImplementation(jest.requireActual('@/lib/hooks/useApi').useApi);
    const screen = render(<AppreciationsScreen />);
    await screen.findByText('Heart');
    fireEvent.press(screen.getByText('Heart'));
    act(() => { screen.UNSAFE_getByType(FlatList).props.refreshControl.props.onRefresh(); });
    await act(async () => { refreshed.resolve({ ...initial, data: [
      { ...initial.data[0], message: 'Updated note content' },
    ] }); });
    expect(screen.getByText('Updated note content')).toBeTruthy();
    await act(async () => { refuseReaction(); });
    expect(screen.getByText('Updated note content')).toBeTruthy();
    expect(screen.getByText('1')).toBeTruthy();
    expect(screen.queryByText('2')).toBeNull();
  });
  it.each([false, true])('reconciles a lost reaction response before another toggle (readFails=%s)', async (readFails) => {
    const initial = mockUseApi().data;
    const reconciled = pendingPage();
    const retried = pendingPage();
    mockGetAppreciations.mockResolvedValueOnce(initial).mockReturnValueOnce(reconciled.promise).mockReturnValueOnce(retried.promise);
    mockReactToAppreciation.mockRejectedValueOnce(new ApiResponseError(0, 'Connection lost'));
    mockUseApi.mockImplementation(jest.requireActual('@/lib/hooks/useApi').useApi);
    const screen = render(<AppreciationsScreen />);
    await screen.findByText('Heart');
    let button = screen.getByLabelText('React with heart');
    while (!button.props.onPress && button.parent) button = button.parent;
    const press = button.props.onPress;
    await act(async () => { press(); });
    await waitFor(() => expect(mockGetAppreciations).toHaveBeenCalledTimes(2));
    expect(screen.getByText('appreciations.reactionUnconfirmed')).toBeTruthy();
    await act(async () => { press(); });
    expect(mockReactToAppreciation).toHaveBeenCalledTimes(1);
    if (readFails) {
      await act(async () => { reconciled.reject(new ApiResponseError(429, 'Try later')); });
      expect(screen.getByText('appreciations.reactionUnconfirmed')).toBeTruthy();
      await act(async () => { press(); });
      expect(mockReactToAppreciation).toHaveBeenCalledTimes(1);
      fireEvent.press(screen.getAllByText('Retry')[0]);
      await waitFor(() => expect(mockGetAppreciations).toHaveBeenCalledTimes(3));
    }
    await act(async () => { (readFails ? retried : reconciled).resolve({ ...initial, data: [
      { ...initial.data[0], my_reaction: 'heart', reactions_count: 2 },
    ] }); });
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.queryByText('appreciations.reactionUnconfirmed')).toBeNull();
    fireEvent.press(screen.getByText('Heart'));
    await waitFor(() => expect(mockReactToAppreciation).toHaveBeenCalledTimes(2));
  });
  it('removes the previous member rows when the route changes', () => {
    const screen = render(<AppreciationsScreen />);
    mockUserId = '8';
    mockUseApi.mockReturnValue({ data: null, isLoading: true, error: null, refresh: jest.fn() });
    screen.rerender(<AppreciationsScreen />);
    expect(screen.queryByText('Thank you for helping with the garden.')).toBeNull();
  });
  it('offers retry for a failed later page while keeping existing rows', () => {
    const state = mockUseApi();
    state.data.meta.last_page = 3;
    const screen = render(<AppreciationsScreen />);
    fireEvent.press(screen.getByText('Load more'));
    mockUseApi.mockReturnValue({ ...state, data: null, error: 'Unavailable', errorStatus: 500 });
    screen.rerender(<AppreciationsScreen />);
    expect(screen.getByText('Thank you for helping with the garden.')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Retry'));
    expect(state.refresh).toHaveBeenCalledTimes(1);
    expect(mockUseApi.mock.calls.at(-1)[1]).toEqual(['7', 2]);
  });
  it('does not skip a page on rapid load-more callbacks', () => {
    const state = mockUseApi();
    state.data.meta.last_page = 4;
    const screen = render(<AppreciationsScreen />);
    let button = screen.getByText('Load more');
    while (!button.props.onPress && button.parent) button = button.parent;
    const press = button.props.onPress;
    act(() => { press(); press(); });
    expect(mockUseApi.mock.calls.at(-1)[1]).toEqual(['7', 2]);
  });
  it.each([false, true])('guards retained reaction callbacks (departed=%s)', async (departed) => {
    mockReactToAppreciation.mockImplementationOnce(() => new Promise(() => {}));
    const screen = render(<AppreciationsScreen />);
    let button = screen.getByLabelText('React with heart');
    while (!button.props.onPress && button.parent) button = button.parent;
    const press = button.props.onPress;
    expect(press).toEqual(expect.any(Function));
    if (departed) screen.unmount();
    await act(async () => { press(); press(); });
    expect(mockReactToAppreciation).toHaveBeenCalledTimes(departed ? 0 : 1);
  });
  it('keeps another reaction locked when one request settles, then allows retry', async () => {
    const state = mockUseApi();
    mockUseApi.mockReturnValue({ ...state, data: { ...state.data, data: [
      state.data.data[0], { ...state.data.data[0], id: 13 },
    ] } });
    let finishFirst!: () => void;
    let finishSecond!: () => void;
    mockReactToAppreciation
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = () => resolve({ data: { reaction_type: 'heart' } }); }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishSecond = () => resolve({ data: { reaction_type: 'heart' } }); }));
    const screen = render(<AppreciationsScreen />);
    const presses = screen.getAllByLabelText('React with heart').map((button) => {
      while (!button.props.onPress && button.parent) button = button.parent;
      return button.props.onPress;
    });
    await act(async () => { presses[0](); presses[1](); });
    expect(mockReactToAppreciation).toHaveBeenCalledTimes(2);
    await act(async () => { finishSecond(); });
    await act(async () => { presses[0](); });
    expect(mockReactToAppreciation).toHaveBeenCalledTimes(2);
    await act(async () => { finishFirst(); });
    fireEvent.press(screen.getAllByLabelText('React with heart')[0]);
    await waitFor(() => expect(mockReactToAppreciation).toHaveBeenCalledTimes(3));
  });
  it('🔴 labels the reaction buttons instead of printing raw translation keys', async () => {
    const { findByText, queryByText } = render(<AppreciationsScreen />);

    expect(await findByText('Heart')).toBeTruthy();
    expect(queryByText('appreciations.react.heart')).toBeNull();
    expect(queryByText('appreciations.react.clap')).toBeNull();
    expect(queryByText('appreciations.react.star')).toBeNull();
  });
});
