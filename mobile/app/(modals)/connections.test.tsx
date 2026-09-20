// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

jest.mock('@/lib/observability/report', () => ({ reportException: jest.fn() }));

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

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
        'connections.cancelConfirmTitle': 'Cancel this request?',
        'connections.cancelConfirmMessage': 'This connection request will be withdrawn. You can send a new request later.',
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
jest.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 7 } }) }));

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

let mockRealRead = false;
const mockUsePaginatedApi = jest.fn();
jest.mock('@/lib/hooks/usePaginatedApi', () => ({
  usePaginatedApi: (...args: unknown[]) => mockRealRead ? jest.requireActual('@/lib/hooks/usePaginatedApi').usePaginatedApi(...args) : mockUsePaginatedApi(...args),
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
  declineConnection: jest.fn(),
  getConnections: jest.fn(),
  getConnectionStatus: jest.fn().mockResolvedValue({ data: { status: 'none', connection_id: null } }),
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
  mockRealRead = false;
  mockUsePaginatedApi.mockReturnValue(paginated({ items: [], isLoading: false, error: null }));
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

/**
 * The paginated state shape the screen reads, with sensible defaults.
 *
 * 🔴 The screen moved from `useApi` to `usePaginatedApi` because it fetched exactly one
 * page of twenty and offered no way to ask for another, so a member with more than twenty
 * connections or pending requests could not reach the rest (audit 2026-09-06, F11).
 */
function paginated(overrides: Partial<{
  items: unknown[];
  isLoading: boolean;
  isLoadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
}> = {}) {
  return {
    items: [],
    isLoading: false,
    isLoadingMore: false,
    error: null,
    hasMore: false,
    loadMore: jest.fn(),
    refresh: jest.fn(),
    ...overrides,
  };
}

describe('ConnectionsRoute', () => {
  it('retries the failed connection page while retaining earlier members', async () => {
    mockRealRead = true;
    const { getConnections } = require('@/lib/api/connections');
    getConnections
      .mockResolvedValueOnce({ data: [connection], meta: { cursor: 'page-two', has_more: true } })
      .mockRejectedValueOnce(new Error('Temporary failure'))
      .mockResolvedValueOnce({ data: [{ ...connection, id: 13, connection_id: 13, user: { ...connection.user, id: 273, name: 'Recovered member' } }], meta: { cursor: null, has_more: false } });
    const screen = render(<ConnectionsRoute />);
    await screen.findByText('Katherine');
    await act(async () => fireEvent.press(screen.getByTestId('connections-load-more')));
    fireEvent.press(screen.getByText('Retry'));
    await screen.findByText('Recovered member');
    expect(getConnections).toHaveBeenLastCalledWith('accepted', 'page-two');
    expect(screen.getByText('Katherine')).toBeTruthy();
  });

  it('completes accepted requests under StrictMode effect replay', async () => {
    const { acceptConnection } = require('@/lib/api/connections');
    acceptConnection.mockResolvedValueOnce({ data: {} });
    mockUsePaginatedApi.mockReturnValue(paginated({ items: [{ ...connection, status: 'pending' }] }));
    const screen = render(<React.StrictMode><ConnectionsRoute /></React.StrictMode>);
    fireEvent.press(screen.getByText('Received'));
    await act(async () => { fireEvent.press(screen.getByText('Accept')); });
    expect(acceptConnection).toHaveBeenCalledWith(12);
    expect(screen.queryByText('Katherine')).toBeNull();
  });
  it('does not resurrect an accepted request when refresh starts or fails', async () => {
    const { acceptConnection } = require('@/lib/api/connections');
    acceptConnection.mockResolvedValueOnce({ data: {} });
    const pending = { ...connection, connection_id: 77, id: 77, status: 'pending' };
    const refresh = jest.fn();
    mockUsePaginatedApi.mockReturnValue(paginated({ items: [pending], refresh }));
    const screen = render(<ConnectionsRoute />);
    fireEvent.press(screen.getByText('Received'));
    await act(async () => { fireEvent.press(screen.getByText('Accept')); });
    expect(screen.queryByText('Katherine')).toBeNull();
    fireEvent(screen.UNSAFE_getByType(require('react-native').RefreshControl), 'refresh');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Katherine')).toBeNull();
    mockUsePaginatedApi.mockReturnValue(paginated({ items: [pending], refresh, error: 'Connections unavailable' }));
    screen.rerender(<ConnectionsRoute />);
    expect(screen.queryByText('Katherine')).toBeNull();
    expect(screen.getByText('Connections unavailable')).toBeTruthy();
  });

  it.each([true, false])('retains loaded connections during refresh and failure (pending=%s)', pending => {
    const retry = jest.fn();
    mockUsePaginatedApi.mockReturnValue(paginated({ items: [connection], isLoading: pending, error: pending ? null : 'Connections unavailable', refresh: retry }));
    const screen = render(<ConnectionsRoute />);
    expect(screen.getByText('Katherine')).toBeTruthy();
    if (!pending) {
      expect(screen.getByText('Connections unavailable')).toBeTruthy();
      fireEvent.press(screen.getByText('Retry'));
      expect(retry).toHaveBeenCalledTimes(1);
    }
  });

  it('renders the accepted empty state with browse members action', () => {
    const { getByText } = render(<ConnectionsRoute />);
    expect(getByText('No connections yet')).toBeTruthy();
    expect(getByText('Browse members')).toBeTruthy();
  });

  /*
    🔴 Audit F11. The API wrapper asks for twenty at a time and the endpoint returns a
    cursor and `has_more`; the screen called it once, with no cursor, and mapped that single
    page inside a ScrollView. There was no next-page action on any of the three tabs, so a
    member with more than twenty connections - or more than twenty pending requests - could
    not reach the older ones at all.
  */
  it('offers a way to reach connections beyond the first page', () => {
    const loadMore = jest.fn();
    mockUsePaginatedApi.mockReturnValue(paginated({ items: [connection], hasMore: true, loadMore }));

    const { getByTestId } = render(<ConnectionsRoute />);
    fireEvent.press(getByTestId('connections-load-more'));

    expect(loadMore).toHaveBeenCalled();
  });

  /*
    🔴 The paging fix (F11) created a second-order risk the audit's F11 note named:
    "verify a second page with disjoint IDs, including action/refresh behavior."

    `usePaginatedApi.refresh()` resets to page one, which is what a refresh means. Calling
    it after an accept/decline cost nothing while the screen fetched one page; now it would
    throw a member who had loaded four pages back to the first. Every one of these actions
    removes the row from the tab it is in, so the row is dropped locally instead - the known
    outcome of a request that already succeeded, not an optimistic guess.
  */
  it.each([false, true])('handles accepted requests when changing tabs before completion: %s', async (switchTab) => {
    const { acceptConnection } = require('@/lib/api/connections');
    acceptConnection.mockClear();
    let finish!: (value: unknown) => void;
    acceptConnection.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const refresh = jest.fn();
    const pending = {
      connection_id: 77,
      status: 'pending',
      user: { id: 9, first_name: 'Nina', last_name: 'Ito' },
      created_at: '2026-09-01T09:00:00Z',
    };
    mockUsePaginatedApi.mockReturnValue(paginated({ items: [pending], refresh }));

    const { getByText, queryByText } = render(<ConnectionsRoute />);
    // Accept only appears on the received-requests tab.
    fireEvent.press(getByText('Received'));
    fireEvent.press(getByText('Accept'));

    await waitFor(() => expect(acceptConnection).toHaveBeenCalledWith(77));
    if (switchTab) fireEvent.press(getByText('Connected'));
    await act(async () => { finish({ data: {} }); });
    // Gone from the list...
    await waitFor(() => {
      if (switchTab) expect(queryByText('Nina Ito')).not.toBeNull();
      else expect(queryByText('Nina Ito')).toBeNull();
    });
    // ...without a reload, which would have dropped every page after the first.
    expect(refresh).not.toHaveBeenCalled();
  });

  it('serializes rapid connection decisions before React renders the busy state', async () => {
    const { acceptConnection } = require('@/lib/api/connections');
    let finish!: (value: unknown) => void;
    acceptConnection.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    mockUsePaginatedApi.mockReturnValue(paginated({ items: [{
      connection_id: 77,
      status: 'pending',
      user: { id: 9, first_name: 'Nina', last_name: 'Ito' },
      created_at: '2026-09-01T09:00:00Z',
    }] }));

    const { getByText } = render(<ConnectionsRoute />);
    fireEvent.press(getByText('Received'));
    act(() => {
      fireEvent.press(getByText('Accept'));
      fireEvent.press(getByText('Accept'));
    });

    expect(acceptConnection).toHaveBeenCalledTimes(1);
    await act(async () => finish({ data: {} }));
  });

  it('uses the decline endpoint for a received request', async () => {
    const { declineConnection, removeConnection } = require('@/lib/api/connections');
    mockUsePaginatedApi.mockReturnValue(paginated({ items: [{
      connection_id: 78,
      status: 'pending',
      user: { id: 10, first_name: 'Omar', last_name: 'Khan' },
    }] }));

    const { getByText } = render(<ConnectionsRoute />);
    fireEvent.press(getByText('Received'));
    fireEvent.press(getByText('Decline'));
    await act(async () => { mockConfirm.mock.calls[0][0].onConfirm(); });

    await waitFor(() => expect(declineConnection).toHaveBeenCalledWith(78));
    expect(removeConnection).not.toHaveBeenCalled();
  });

  it('binds a sent-request cancellation to pending state', async () => {
    const { removeConnection } = require('@/lib/api/connections');
    mockUsePaginatedApi.mockReturnValue(paginated({ items: [{
      connection_id: 80,
      status: 'pending',
      user: { id: 12, first_name: 'Grace', last_name: 'Hopper' },
    }] }));

    const { getByText } = render(<ConnectionsRoute />);
    fireEvent.press(getByText('Sent'));
    fireEvent.press(getByText('Cancel request'));
    expect(mockConfirm.mock.calls[0][0]).toMatchObject({
      title: 'Cancel this request?',
      message: 'This connection request will be withdrawn. You can send a new request later.',
      confirmLabel: 'Cancel request',
    });
    await act(async () => { mockConfirm.mock.calls[0][0].onConfirm(); });

    expect(removeConnection).toHaveBeenCalledWith(80, 'pending');
  });

  it('removes a stale sent row when another device accepted before cancellation', async () => {
    const { removeConnection, getConnectionStatus } = require('@/lib/api/connections');
    removeConnection.mockRejectedValueOnce(new Error('state changed'));
    getConnectionStatus.mockResolvedValueOnce({
      data: { status: 'connected', connection_id: 81, direction: null },
    });
    mockUsePaginatedApi.mockReturnValue(paginated({ items: [{
      connection_id: 81,
      status: 'pending',
      user: { id: 13, first_name: 'Mary', last_name: 'Jackson' },
    }] }));

    const { getByText, queryByText } = render(<ConnectionsRoute />);
    fireEvent.press(getByText('Sent'));
    fireEvent.press(getByText('Cancel request'));
    await act(async () => { mockConfirm.mock.calls[0][0].onConfirm(); });

    await waitFor(() => expect(queryByText('Mary Jackson')).toBeNull());
    expect(getConnectionStatus).toHaveBeenCalledWith(13);
  });

  it('treats a lost accept response as success when readback is connected', async () => {
    const { acceptConnection, getConnectionStatus } = require('@/lib/api/connections');
    let rejectAccept!: (error: Error) => void;
    let resolveReadback!: (value: unknown) => void;
    acceptConnection.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectAccept = reject; }));
    getConnectionStatus.mockImplementationOnce(() => new Promise((resolve) => { resolveReadback = resolve; }));
    mockUsePaginatedApi.mockReturnValue(paginated({ items: [{
      connection_id: 79,
      status: 'pending',
      user: { id: 11, first_name: 'Ada', last_name: 'Lovelace' },
    }] }));

    const { getByText, queryByText } = render(<ConnectionsRoute />);
    fireEvent.press(getByText('Received'));
    fireEvent.press(getByText('Accept'));

    expect(acceptConnection).toHaveBeenCalledWith(79);
    expect(getConnectionStatus).not.toHaveBeenCalled();
    expect(queryByText('Ada Lovelace')).not.toBeNull();
    await act(async () => { rejectAccept(new Error('connection lost')); });
    expect(getConnectionStatus).toHaveBeenCalledWith(11);
    expect(queryByText('Ada Lovelace')).not.toBeNull();
    await act(async () => { resolveReadback({ data: { status: 'connected', connection_id: 79 } }); });
    expect(queryByText('Ada Lovelace')).toBeNull();
    expect(acceptConnection).toHaveBeenCalledTimes(1);
  });

  it('does not offer a next page when the server says there is none', () => {
    mockUsePaginatedApi.mockReturnValue(paginated({ items: [connection], hasMore: false }));

    const { queryByTestId } = render(<ConnectionsRoute />);

    expect(queryByTestId('connections-load-more')).toBeNull();
  });

  it('renders connection cards and routes to profile and thread', () => {
    mockUsePaginatedApi.mockReturnValue(paginated({ items: [connection], isLoading: false, error: null }));
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
  it('asks before disconnecting from a member, and only disconnects when the member agrees', async () => {
    /*
      🔴 Remove / Decline / Cancel acted on ONE tap here, while the same disconnect on a
      member's profile has always confirmed first — the safe and the unsafe route to the
      identical outcome sat side by side (audit 2026-09-06, S3-23).
    */
    const { removeConnection } = require('@/lib/api/connections');
    removeConnection.mockClear();
    mockConfirm.mockClear();
    mockUsePaginatedApi.mockReturnValue(paginated({ items: [connection], isLoading: false, error: null }));

    const { getByText } = render(<ConnectionsRoute />);
    fireEvent.press(getByText('Remove'));

    // Nothing has happened yet: the member has only been asked.
    expect(removeConnection).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockConfirm.mock.calls[0][0]).toMatchObject({ variant: 'danger' });

    // Saying yes is what disconnects.
    await act(async () => { mockConfirm.mock.calls[0][0].onConfirm(); });
    expect(removeConnection).toHaveBeenCalledWith(12, 'accepted');
  });

  it('labels a pending request from the tab, never from the raw status', () => {
    const pending = { ...connection, status: 'pending' as const };
    mockUsePaginatedApi.mockReturnValue(paginated({ items: [pending], isLoading: false, error: null }));

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
    mockUsePaginatedApi.mockReturnValue(paginated({ items: [pending], isLoading: false, error: null }));

    const { getByText, queryByText } = render(<ConnectionsRoute />);
    fireEvent.press(getByText('Received'));

    expect(getByText(/^Requested /)).toBeTruthy();
    expect(queryByText(/^Connected \d/)).toBeNull();
  });
});
