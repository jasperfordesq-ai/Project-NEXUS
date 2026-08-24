// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockUseApi = jest.fn();
const mockRefresh = jest.fn();
const mockConfirmGroupExchange = jest.fn();
const mockCompleteGroupExchange = jest.fn();
const mockCancelGroupExchange = jest.fn();
let mockParams: { id?: string } = { id: '42' };

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
  useLocalSearchParams: () => mockParams,
}));

jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 7 } }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
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
  getGroupExchange: jest.fn(),
  cancelGroupExchange: (...args: unknown[]) => mockCancelGroupExchange(...args),
  confirmGroupExchange: (...args: unknown[]) => mockConfirmGroupExchange(...args),
  completeGroupExchange: (...args: unknown[]) => mockCompleteGroupExchange(...args),
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/AppTopBar', () => 'View');
jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/EmptyState', () => {
  const React = require('react');
  const { Text, View } = require('react-native');
  return function EmptyState({ title, subtitle }: { title?: string; subtitle?: string }) {
    return <View>{title ? <Text>{title}</Text> : null}{subtitle ? <Text>{subtitle}</Text> : null}</View>;
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
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    confirm: (opts: { onConfirm: () => void | Promise<void> }) => {
      void opts.onConfirm();
    },
    confirmDialog: null,
  }),
}));

import GroupExchangeDetailScreen from './group-exchange-detail';

const baseExchange = {
  id: 42,
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
  mockParams = { id: '42' };
  mockUseApi.mockReset().mockReturnValue({
    data: { data: baseExchange },
    isLoading: false,
    error: null,
    refresh: mockRefresh,
  });
  mockRefresh.mockReset();
  mockConfirmGroupExchange.mockReset().mockResolvedValue({});
  mockCompleteGroupExchange.mockReset().mockResolvedValue({});
  mockCancelGroupExchange.mockReset().mockResolvedValue({});
});

describe('GroupExchangeDetailScreen', () => {
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

    await waitFor(() => expect(mockConfirmGroupExchange).toHaveBeenCalledWith(42));
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
});
