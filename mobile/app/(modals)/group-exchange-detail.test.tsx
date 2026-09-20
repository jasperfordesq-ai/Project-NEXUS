// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

const mockUseApi = jest.fn();
const mockRefresh = jest.fn();
const mockConfirmGroupExchange = jest.fn();
const mockCompleteGroupExchange = jest.fn();
const mockCancelGroupExchange = jest.fn();
const mockGetGroupExchange = jest.fn();
const mockDismiss = jest.fn();
let mockParams: { id?: string | string[] } = { id: '42' };
let mockHoldConfirmation = false;
let mockUserId = 7;
let mockTenantId = 2;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'groupExchanges.detail.title': 'Group Exchange',
        'groupExchanges.detail.created': `Created ${String(opts?.date ?? '')}`,
        'groupExchanges.detail.unknownDate': 'recently',
        'groupExchanges.detail.invalidTitle': 'Group exchange not available',
        'groupExchanges.detail.invalidDescription': 'This group exchange link is missing a valid identifier.',
        'groupExchanges.detail.notFoundTitle': 'Group exchange not found',
        'groupExchanges.detail.notFoundDescription': 'You may not have access to this group exchange, or it may have been removed.',
        'groupExchanges.detail.participants': 'Participants',
        'groupExchanges.detail.noParticipants': 'No participants have been added yet.',
        'groupExchanges.detail.splitPreview': 'Split preview',
        'groupExchanges.detail.splitShare': `${String(opts?.name ?? '')} — ${String(opts?.hours ?? '')} hours`,
        'groupExchanges.detail.splitUnknownMember': `Member #${String(opts?.id ?? '')}`,
        'groupExchanges.detail.confirmed': 'Confirmed',
        'groupExchanges.detail.unconfirmed': 'Not confirmed',
        'groupExchanges.detail.roles.provider': 'Provider',
        'groupExchanges.detail.roles.receiver': 'Receiver',
        'groupExchanges.detail.actions.title': 'Available actions',
        'groupExchanges.detail.actions.confirm': 'Confirm hours',
        'groupExchanges.detail.actions.complete': 'Complete exchange',
        'groupExchanges.detail.actions.cancel': 'Cancel exchange',
        'groupExchanges.status.pending_confirmation': 'Needs confirmation',
        'groupExchanges.split.weighted': 'Weighted split',
        'groupExchanges.participants': `${String(opts?.count ?? 0)} participants`,
        'groupExchanges.hours': `${String(opts?.count ?? 0)} hours`,
        'common:buttons.back': 'Back',
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  useLocalSearchParams: () => mockParams,
}));

jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: mockUserId } }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { id: mockTenantId, slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
}));

jest.mock('@/lib/hooks/useTheme', () => ({
  useTheme: () => ({
    bg: '#fff',
    surface: '#f8f9fa',
    text: '#000',
    textSecondary: '#666',
    textMuted: '#999',
    border: '#ddd',
  }),
}));

jest.mock('@/lib/api/groupExchanges', () => ({
  getGroupExchange: (...args: unknown[]) => mockGetGroupExchange(...args),
  cancelGroupExchange: (...args: unknown[]) => mockCancelGroupExchange(...args),
  confirmGroupExchange: (...args: unknown[]) => mockConfirmGroupExchange(...args),
  completeGroupExchange: (...args: unknown[]) => mockCompleteGroupExchange(...args),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/EmptyState', () => {
  const React = require('react');
  const { Text, View, Pressable } = require('react-native');
  return function EmptyState({ title, subtitle, actionLabel, onAction }: { title?: string; subtitle?: string; actionLabel?: string; onAction?: () => void }) {
    return <View>{title ? <Text>{title}</Text> : null}{subtitle ? <Text>{subtitle}</Text> : null}{actionLabel && onAction ? <Pressable testID="empty-state-action" onPress={onAction}><Text>{actionLabel}</Text></Pressable> : null}</View>;
  };
});

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

// Auto-confirm: invoking confirm() runs the action immediately, mirroring the
// old Alert.alert destructive button-press simulation.
const mockConfirmCalls: { title?: string; message?: string; onConfirm: () => void | Promise<void> }[] = [];
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    confirm: (opts: { title?: string; message?: string; onConfirm: () => void | Promise<void> }) => {
      mockConfirmCalls.push(opts);
      if (!mockHoldConfirmation) void opts.onConfirm();
    },
    confirmDialog: null,
    dismiss: mockDismiss,
  }),
}));

import GroupExchangeDetailScreen from './group-exchange-detail';
import { ApiResponseError } from '@/lib/api/client';

const baseExchange = {
  id: 42,
  terms_token: 'reviewed-terms',
  tenant_id: 2,
  title: 'Community garden shift',
  description: 'Three members worked together.',
  organizer_id: 7,
  listing_id: null,
  status: 'pending_confirmation',
  split_type: 'weighted',
  total_hours: 6,
  broker_id: null,
  broker_notes: null,
  completed_at: null,
  created_at: '2026-05-01T12:00:00Z',
  updated_at: '2026-05-01T12:00:00Z',
  participants: [
    { id: 1, user_id: 7, name: 'Alice Smith', avatar_url: null, role: 'provider', hours: 2, weight: 1, confirmed: false, confirmed_at: null, notes: null },
    { id: 2, user_id: 8, name: 'Ben Jones', avatar_url: null, role: 'receiver', hours: 4, weight: 2, confirmed: true, confirmed_at: '2026-05-02T12:00:00Z', notes: null },
  ],
  /*
    🔴 This fixture used to be `{ '8': { '7': 2 } }` — a from-member / to-member map
    invented from the client's own (wrong) type, not from the server. `calculateSplit()`
    returns a flat list of per-participant shares for every split type. Because the fixture
    agreed with the wrong type, the suite stayed green while the screen showed members the
    response's own field names on a real group exchange.
  */
  calculated_split: [
    { user_id: 7, role: 'provider', hours: 2 },
    { user_id: 8, role: 'receiver', hours: 2 },
  ],
};

beforeEach(() => {
  mockHoldConfirmation = false;
  mockUserId = 7;
  mockTenantId = 2;
  mockParams = { id: '42' };
  mockUseApi.mockReset().mockReturnValue({
    data: { data: baseExchange },
    isLoading: false,
    error: null,
    refresh: mockRefresh,
  });
  mockRefresh.mockReset();
  mockGetGroupExchange.mockReset();
  mockDismiss.mockClear();
  mockConfirmGroupExchange.mockReset().mockResolvedValue({});
  mockCompleteGroupExchange.mockReset().mockResolvedValue({});
  mockConfirmCalls.length = 0;
  mockCancelGroupExchange.mockReset().mockResolvedValue({});
});

describe('GroupExchangeDetailScreen', () => {
  it.each(['route', 'account', 'tenant'] as const)('discards a late accepted-action refresh after %s replacement with the real hook', async identity => {
    let resolveOldRead!: (value: { data: typeof baseExchange }) => void;
    const oldRead = new Promise<{ data: typeof baseExchange }>(resolve => { resolveOldRead = resolve; });
    const replacement = { ...baseExchange, id: identity === 'route' ? 43 : 42, title: 'Replacement exchange' };
    mockGetGroupExchange.mockResolvedValueOnce({ data: baseExchange })
      .mockReturnValueOnce(oldRead).mockResolvedValueOnce({ data: replacement });
    mockUseApi.mockImplementation(jest.requireActual('@/lib/hooks/useApi').useApi);
    const screen = render(<GroupExchangeDetailScreen />);
    await act(async () => {});
    await act(async () => fireEvent.press(screen.getByText('Confirm hours')));
    const oldConfirmation = mockConfirmCalls[0]!.onConfirm;
    expect(mockGetGroupExchange).toHaveBeenCalledTimes(2);
    if (identity === 'route') mockParams = { id: '43' };
    if (identity === 'account') mockUserId = 8;
    if (identity === 'tenant') mockTenantId = 3;
    screen.rerender(<GroupExchangeDetailScreen />);
    await act(async () => {});
    expect(screen.getByText('Replacement exchange')).toBeTruthy();
    await act(async () => resolveOldRead({ data: { ...baseExchange, status: 'completed' } }));
    await act(async () => oldConfirmation());
    expect(screen.getByText('Replacement exchange')).toBeTruthy();
    expect(screen.queryByText('Community garden shift')).toBeNull();
    expect(mockConfirmGroupExchange).toHaveBeenCalledTimes(1);
    expect(mockGetGroupExchange).toHaveBeenCalledTimes(3);
  });

  it.each(['confirm', 'complete', 'cancel'] as const)('keeps accepted %s read-only through actual hook retry and recovery', async action => {
    jest.useFakeTimers();
    const initial = action === 'complete'
      ? { ...baseExchange, participants: baseExchange.participants.map(p => ({ ...p, confirmed: true })) }
      : baseExchange;
    const fresh = action === 'confirm'
      ? { ...initial, participants: initial.participants.map(p => ({ ...p, confirmed: true })) }
      : { ...initial, status: action === 'complete' ? 'completed' : 'cancelled' };
    const mutation = action === 'confirm' ? mockConfirmGroupExchange : action === 'complete' ? mockCompleteGroupExchange : mockCancelGroupExchange;
    const label = action === 'confirm' ? 'Confirm hours' : action === 'complete' ? 'Complete exchange' : 'Cancel exchange';
    let resolveRecovery!: (value: { data: typeof fresh }) => void;
    const recovery = new Promise<{ data: typeof fresh }>(resolve => { resolveRecovery = resolve; });
    mockGetGroupExchange.mockResolvedValueOnce({ data: initial })
      .mockRejectedValueOnce(new ApiResponseError(0, 'Offline'))
      .mockRejectedValueOnce(new ApiResponseError(0, 'Offline'))
      .mockReturnValueOnce(recovery);
    mockUseApi.mockImplementation(jest.requireActual('@/lib/hooks/useApi').useApi);
    const screen = render(<GroupExchangeDetailScreen />);
    try {
      await act(async () => {});
      await act(async () => fireEvent.press(screen.getByText(label)));
      const oldConfirmation = mockConfirmCalls[0]!.onConfirm;
      expect(mockGetGroupExchange).toHaveBeenCalledTimes(2);
      await act(async () => oldConfirmation());
      expect(mutation).toHaveBeenCalledTimes(1);
      await act(async () => jest.advanceTimersByTime(2000));
      expect(mockGetGroupExchange).toHaveBeenCalledTimes(3);
      expect(screen.getByText('Offline')).toBeTruthy();
      await act(async () => fireEvent.press(screen.getByTestId('empty-state-action')));
      expect(mockGetGroupExchange).toHaveBeenCalledTimes(4);
      await act(async () => oldConfirmation());
      expect(mutation).toHaveBeenCalledTimes(1);
      await act(async () => resolveRecovery({ data: fresh }));
      expect(screen.queryByText('Offline')).toBeNull();
      expect(screen.queryByText(label)).toBeNull();
      await act(async () => oldConfirmation());
      expect(mutation).toHaveBeenCalledTimes(1);
      expect(mockGetGroupExchange.mock.calls.every(([id]) => id === 42)).toBe(true);
    } finally {
      screen.unmount();
      jest.useRealTimers();
    }
  });

  it('does not replay an accepted action before fresh details arrive or after refresh fails', async () => {
    const screen = render(<GroupExchangeDetailScreen />);
    await act(async () => fireEvent.press(screen.getByText('Confirm hours')));
    const oldConfirmation = mockConfirmCalls[0]!.onConfirm;
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    await act(async () => oldConfirmation());
    expect(mockConfirmGroupExchange).toHaveBeenCalledTimes(1);
    mockUseApi.mockReturnValue({ data: { data: baseExchange }, isLoading: false, error: 'Offline', errorStatus: 0, refresh: mockRefresh });
    screen.rerender(<GroupExchangeDetailScreen />);
    await act(async () => oldConfirmation());
    expect(mockConfirmGroupExchange).toHaveBeenCalledTimes(1);
    await act(async () => fireEvent.press(screen.getByTestId('empty-state-action')));
    expect(mockRefresh).toHaveBeenCalledTimes(2);
    expect(mockConfirmGroupExchange).toHaveBeenCalledTimes(1);
    mockUseApi.mockReturnValue({ data: { data: { ...baseExchange, participants: baseExchange.participants.map(p => ({ ...p, confirmed: true })) } }, isLoading: false, error: null, refresh: mockRefresh });
    screen.rerender(<GroupExchangeDetailScreen />);
    expect(screen.queryByText('Confirm hours')).toBeNull();
    await act(async () => fireEvent.press(screen.getByText('Complete exchange')));
    expect(mockCompleteGroupExchange).toHaveBeenCalledTimes(1);
  });

  it.each(['1.5', '0x2a', '4.2e1', '9007199254740993', ['42'], ['42', '43']])('does not load malformed group exchange ID %j', id => {
    mockParams = { id };
    const screen = render(<GroupExchangeDetailScreen />);
    expect(screen.getByText('Group exchange not available')).toBeTruthy();
    expect(mockUseApi).toHaveBeenLastCalledWith(expect.any(Function), [0], { enabled: false });
  });

  it.each(['refreshing', 'refused', 'changed'])('does not accept an old confirmation after the displayed read is %s', async state => {
    mockHoldConfirmation = true;
    const screen = render(<GroupExchangeDetailScreen />);
    fireEvent.press(screen.getByText('Confirm hours'));
    const accept = mockConfirmCalls[0]!.onConfirm;
    mockDismiss.mockClear();
    mockUseApi.mockReturnValue({
      data: { data: state === 'changed' ? { ...baseExchange, total_hours: 9 } : baseExchange },
      isLoading: state === 'refreshing', error: state === 'refused' ? 'Unavailable' : null,
      errorStatus: state === 'refused' ? 403 : null, refresh: mockRefresh,
    });
    screen.rerender(<GroupExchangeDetailScreen />);
    expect(mockDismiss).toHaveBeenCalled();
    act(() => { void accept(); });
    expect(mockConfirmGroupExchange).not.toHaveBeenCalled();
    if (state === 'changed') {
      fireEvent.press(screen.getByText('Confirm hours'));
      await act(async () => mockConfirmCalls[1]!.onConfirm());
      expect(mockConfirmGroupExchange).toHaveBeenCalledTimes(1);
      expect(mockRefresh).toHaveBeenCalledTimes(1);
    }
  });

  it('refreshes rejected terms without silently confirming the refreshed version', async () => {
    mockConfirmGroupExchange.mockRejectedValueOnce(new Error('Terms changed'));
    const screen = render(<GroupExchangeDetailScreen />);
    fireEvent.press(screen.getByText('Confirm hours'));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalledTimes(1));
    expect(mockConfirmGroupExchange).toHaveBeenCalledWith(42, 'reviewed-terms');
    mockUseApi.mockReturnValue({ data: { data: { ...baseExchange, total_hours: 8, terms_token: 'fresh-terms' } }, isLoading: false, error: null, refresh: mockRefresh });
    screen.rerender(<GroupExchangeDetailScreen />);
    expect(mockConfirmGroupExchange).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByText('Confirm hours'));
    await waitFor(() => expect(mockConfirmGroupExchange).toHaveBeenLastCalledWith(42, 'fresh-terms'));
  });

  it.each(['route', 'account', 'tenant'])('ignores an earlier confirmation and response after %s replacement', async replacement => {
    let reject!: (error: Error) => void;
    mockConfirmGroupExchange.mockImplementationOnce(() => new Promise((_, decline) => { reject = decline; }));
    const toast = jest.requireMock('@/components/ui/AppToast').useAppToast().show;
    const screen = render(<GroupExchangeDetailScreen />);
    fireEvent.press(screen.getByText('Confirm hours'));
    const oldConfirmation = mockConfirmCalls[0]!.onConfirm;
    if (replacement === 'route') mockParams = { id: '43' };
    if (replacement === 'account') mockUserId = 8;
    if (replacement === 'tenant') mockTenantId = 3;
    screen.rerender(<GroupExchangeDetailScreen />);
    toast.mockClear();
    await act(async () => reject(new Error('Old failure')));
    await act(async () => oldConfirmation());
    expect(mockConfirmGroupExchange).toHaveBeenCalledTimes(1);
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('sends only one mutation when the confirmation callback repeats before rendering', async () => {
    let resolve!: () => void;
    mockConfirmGroupExchange.mockImplementationOnce(() => new Promise<void>(accept => { resolve = accept; }));
    const screen = render(<GroupExchangeDetailScreen />);
    fireEvent.press(screen.getByText('Confirm hours'));
    await act(async () => { void mockConfirmCalls[0]!.onConfirm(); });
    expect(mockConfirmGroupExchange).toHaveBeenCalledTimes(1);
    await act(async () => resolve());
  });

  it.each([false, true])('does not publish an action response after unmount (failure=%s)', async failure => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    mockConfirmGroupExchange.mockImplementationOnce(() => new Promise<void>((accept, decline) => { resolve = accept; reject = decline; }));
    const toast = jest.requireMock('@/components/ui/AppToast').useAppToast().show;
    const screen = render(<GroupExchangeDetailScreen />);
    fireEvent.press(screen.getByText('Confirm hours'));
    screen.unmount();
    toast.mockClear();
    await act(async () => { if (failure) reject(new Error('Late failure')); else resolve(); });
    expect(mockRefresh).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('renders participant and split details from the backend shape', () => {
    const { getByText, queryByText } = render(<GroupExchangeDetailScreen />);

    expect(getByText('Community garden shift')).toBeTruthy();
    expect(getByText('Needs confirmation')).toBeTruthy();
    expect(getByText('Alice Smith')).toBeTruthy();
    expect(getByText('Ben Jones')).toBeTruthy();
    expect(getByText('Split preview')).toBeTruthy();
    // Each share names the member and their role — never a raw field name or a bare id.
    expect(getByText('Alice Smith — 2 hours')).toBeTruthy();
    expect(getByText('Ben Jones — 2 hours')).toBeTruthy();
    expect(queryByText(/#user_id/)).toBeNull();
    expect(queryByText(/#role/)).toBeNull();
    expect(queryByText(/From member/)).toBeNull();
  });

  it('names a share whose member is not in the participants list', () => {
    mockUseApi.mockReturnValue({
      data: {
        data: {
          ...baseExchange,
          participants: [],
          calculated_split: [{ user_id: 99, role: 'provider', hours: 3 }],
        },
      },
      isLoading: false,
      error: null,
      refresh: mockRefresh,
    });

    const { getByText } = render(<GroupExchangeDetailScreen />);

    expect(getByText('Member #99 — 3 hours')).toBeTruthy();
  });

  /*
    A response in the old map shape, or any other unexpected value, must not crash the
    screen and must not print field names — it shows no preview at all.
  */
  it('shows no split preview when the shares are not a list', () => {
    mockUseApi.mockReturnValue({
      data: {
        data: {
          ...baseExchange,
          calculated_split: { '8': { '7': 2 } } as unknown as [],
        },
      },
      isLoading: false,
      error: null,
      refresh: mockRefresh,
    });

    const { queryByText } = render(<GroupExchangeDetailScreen />);

    expect(queryByText('Split preview')).toBeNull();
    expect(queryByText(/#7/)).toBeNull();
  });

  it('confirms the current participant hours and refreshes', async () => {
    const { getByText } = render(<GroupExchangeDetailScreen />);

    fireEvent.press(getByText('Confirm hours'));

    await waitFor(() => expect(mockConfirmGroupExchange).toHaveBeenCalledWith(42, 'reviewed-terms'));
    expect(mockRefresh).toHaveBeenCalled();
  });

  it('shows an invalid link state without calling the endpoint', () => {
    mockParams = { id: 'abc' };
    const { getByText } = render(<GroupExchangeDetailScreen />);

    expect(getByText('Group exchange not available')).toBeTruthy();
    expect(mockUseApi).toHaveBeenCalledWith(expect.any(Function), [0], { enabled: false });
  });

  it('cancels the exchange through the branded confirm flow', async () => {
    const { getByText } = render(<GroupExchangeDetailScreen />);

    fireEvent.press(getByText('Cancel exchange'));

    await waitFor(() => expect(mockCancelGroupExchange).toHaveBeenCalledWith(42));
    expect(mockRefresh).toHaveBeenCalled();
  });

  /**
   * 🔴 "Complete" moved credits for every participant on ONE tap (audit 2026-09-07, C/F-1).
   * The mock above confirms automatically, so the assertion is that a confirmation was ASKED
   * — with the completion wording — before the server was called.
   */
  it('asks before completing, because completing moves credits', async () => {
    mockUseApi.mockReturnValue({
      data: { data: { ...baseExchange, participants: baseExchange.participants.map(participant => ({ ...participant, confirmed: true })) } },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });
    const { getByText } = render(<GroupExchangeDetailScreen />);
    const button = getByText('Complete exchange');
    fireEvent.press(button);
    await waitFor(() => expect(mockCompleteGroupExchange).toHaveBeenCalledWith(42));
    expect(mockConfirmCalls[0]?.title).toBe('groupExchanges.detail.actions.completeTitle');
  });
});
