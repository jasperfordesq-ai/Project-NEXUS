// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

jest.mock('expo-router', () => ({
  useNavigation: () => ({ addListener: jest.fn(() => jest.fn()), dispatch: jest.fn(), setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn(() => false) },
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'common:back': 'Back',
        'common:buttons.retry': 'Retry',
        'connections.title': 'Connections',
        'connections.eyebrow': 'Member workflows',
        'connections.subtitle': 'Manage members you are connected with.',
        'connections.tabs.accepted': 'Connected',
        'connections.tabs.pending_received': 'Received',
        'connections.tabs.pending_sent': 'Sent',
        'connections.empty.accepted.title': 'No connections yet',
        'connections.empty.accepted.description': 'Find members and send connection requests.',
        'connections.browseMembers': 'Browse members',
        'connections.viewProfile': opts ? `View profile for ${String(opts.name ?? '')}` : 'View profile',
        'connections.status.accepted': 'Connected',
        'connections.message': 'Message',
        'connections.remove': 'Remove',
        'connections.connectedSince': opts ? `Connected ${String(opts.date ?? '')}` : 'Connected',
        'connections.requestedOn': opts ? `Requested ${String(opts.date ?? '')}` : 'Requested',
        'connections.status.pending_received': 'Received',
        'connections.status.pending_sent': 'Sent',
        'connections.accept': 'Accept',
        'connections.decline': 'Decline',
        'connections.cancel': 'Cancel request',
        'connections.unknownMember': 'Community member',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  useTenant: () => ({ tenant: { slug: 'hour-timebank' }, hasFeature: () => true, hasModule: () => true }),
  usePrimaryColor: () => '#6366f1',
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

const mockUseApi = jest.fn();
jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

const mockConfirm = jest.fn();
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    confirm: (...args: unknown[]) => mockConfirm(...args),
    confirmDialog: null,
  }),
}));

jest.mock('@/lib/api/connections', () => ({
  acceptConnection: jest.fn(),
  getConnections: jest.fn(),
  removeConnection: jest.fn(),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'View' }));
jest.mock('@/components/ui/Avatar', () => 'View');

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

import ConnectionsRoute from './connections';

beforeEach(() => {
  jest.clearAllMocks();
  mockUseApi.mockReturnValue({ data: { data: [] }, isLoading: false, error: null, refresh: jest.fn() });
});

const connection = {
  connection_id: 12,
  id: 12,
  status: 'accepted' as const,
  created_at: '2026-05-01T12:00:00Z',
  user: {
    id: 272,
    name: 'Katherine',
    avatar_url: null,
    location: 'Cork',
    bio: 'Gardening and repair swaps',
  },
};

describe('ConnectionsRoute', () => {
  it('renders the accepted empty state with browse members action', () => {
    const { getByText } = render(<ConnectionsRoute />);
    expect(getByText('No connections yet')).toBeTruthy();
    expect(getByText('Browse members')).toBeTruthy();
  });

  it('renders connection cards and routes to profile and thread', () => {
    mockUseApi.mockReturnValueOnce({ data: { data: [connection] }, isLoading: false, error: null, refresh: jest.fn() });
    const { router } = require('expo-router');
    const { getByText, getByLabelText } = render(<ConnectionsRoute />);
    expect(getByText('Katherine')).toBeTruthy();
    expect(getByText('Cork')).toBeTruthy();

    fireEvent.press(getByLabelText('View profile for Katherine'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(modals)/member-profile',
      params: { id: '272' },
    });

    router.push.mockClear();
    fireEvent.press(getByText('Message'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/(modals)/thread',
      params: { recipientId: '272', name: 'Katherine' },
    });
  });

  /**
   * 🔴 A received request showed the literal text "connections.status.pending".
   *
   * The API returns `status: 'pending'` for a request in either direction, and the
   * translations are keyed `accepted` / `pending_received` / `pending_sent`. The lookup
   * `connections.status.${connection.status}` therefore missed, and i18next prints the key
   * when it cannot resolve one. Seen on a device on 2026-08-22 by a member looking at a
   * request they had just received.
   *
   * The tab carries the direction that the status cannot, so the label comes from there.
   */
  it('asks before disconnecting from a member, and only disconnects when the member agrees', () => {
    /*
      🔴 Remove / Decline / Cancel acted on ONE tap here, while the same disconnect on a
      member's profile has always confirmed first — the safe and the unsafe route to the
      identical outcome sat side by side (audit 2026-09-06, S3-23).
    */
    const { removeConnection } = require('@/lib/api/connections');
    removeConnection.mockClear();
    mockConfirm.mockClear();
    mockUseApi.mockReturnValueOnce({ data: { data: [connection] }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<ConnectionsRoute />);
    fireEvent.press(getByText('Remove'));

    // Nothing has happened yet: the member has only been asked.
    expect(removeConnection).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockConfirm.mock.calls[0][0]).toMatchObject({ variant: 'danger' });

    // Saying yes is what disconnects.
    mockConfirm.mock.calls[0][0].onConfirm();
    expect(removeConnection).toHaveBeenCalledWith(12);
  });

  it('labels a pending request from the tab, never from the raw status', () => {
    const pending = { ...connection, status: 'pending' as const };
    mockUseApi.mockReturnValue({
      data: { data: [pending] },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText, queryByText, getAllByText } = render(<ConnectionsRoute />);

    // Move to the Received tab, where a pending request actually lives.
    fireEvent.press(getByText('Received'));

    expect(queryByText('connections.status.pending')).toBeNull();
    // Two "Received": the tab and the status chip. Both are correct; the point is that
    // neither is a raw key.
    expect(getAllByText('Received').length).toBeGreaterThanOrEqual(2);
  });

  /**
   * 🔴 And the date label has to follow the tab too: `created_at` is when the request was
   * MADE. On the pending tabs the card said "Connected 22 Aug 2026" about two members who
   * were not connected — which is the entire distinction the tab exists to draw.
   */
  it('says a pending request was requested, not that it is connected', () => {
    const pending = { ...connection, status: 'pending' as const };
    mockUseApi.mockReturnValue({
      data: { data: [pending] },
      isLoading: false,
      error: null,
      refresh: jest.fn(),
    });

    const { getByText, queryByText } = render(<ConnectionsRoute />);
    fireEvent.press(getByText('Received'));

    expect(getByText(/^Requested /)).toBeTruthy();
    expect(queryByText(/^Connected \d/)).toBeNull();
  });
});
