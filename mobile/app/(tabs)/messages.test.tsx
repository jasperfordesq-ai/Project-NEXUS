// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';

// --- Mocks ---

const mockShowToast = jest.fn();

const mockRouterPush = jest.fn();
const mockRouterReplace = jest.fn();
const mockSearchParams = jest.fn(() => ({}));

jest.mock('expo-router', () => ({
  __esModule: true,
  useRouter: () => ({ push: mockRouterPush, replace: mockRouterReplace, back: jest.fn() }),
  useSegments: () => ['(tabs)'],
  router: { push: mockRouterPush, replace: mockRouterReplace, back: jest.fn() },
  useLocalSearchParams: () => mockSearchParams(),
  useNavigation: () => ({ setOptions: jest.fn() }),
  useFocusEffect: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (key === 'archiveConfirm') {
        return `Archive conversation with ${String(options?.name ?? 'this member')}? You can restore it from Archived.`;
      }
      if (key === 'archiveConversationWithName') {
        return `Archive conversation with ${String(options?.name ?? 'this member')}`;
      }
      if (key === 'restoreConversationWithName') {
        return `Restore conversation with ${String(options?.name ?? 'this member')}`;
      }
      const map: Record<string, string> = {
        'title': 'Messages',
        'newMessage': 'New message',
        'newGroup': 'New group',
        'archive': 'Archive',
        'archiveConversation': 'Archive conversation',
        'searchPlaceholder': 'Search conversations...',
        'clearSearch': 'Clear search',
        'tabs.inbox': 'Inbox',
        'tabs.archived': 'Archived',
        'restore': 'Restore',
        'restoreConversation': 'Restore conversation',
        'errors.threadUnavailableTitle': 'Conversation unavailable',
        'errors.threadUnavailable': 'This conversation no longer has a valid recipient. Refresh messages and try again.',
        'empty.title': 'No conversations yet',
        'empty.archivedTitle': 'No archived conversations',
        'empty.archivedSubtitle': 'Archived conversations will appear here.',
        'thread.you': 'You',
        'thread.receipt.sent': 'Sent',
        'thread.receipt.read': 'Read',
        'thread.noMessages': 'No messages yet. Say hello!',
        'unknownMember': 'Community member',
        'common:buttons.retry': 'Retry',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#006FEE',
  useTenant: () => ({ hasFeature: () => true }),
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
    errorBg: '#fff5f5',
  }),
}));

const mockUsePaginatedApi = jest.fn();
jest.mock('@/lib/hooks/usePaginatedApi', () => ({
  usePaginatedApi: (...args: unknown[]) => mockUsePaginatedApi(...args),
}));

jest.mock('@/lib/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Me' }, isAuthenticated: true }),
}));

type MockInboxHandlers = {
  message?: (otherUserId: number, message: Record<string, unknown>) => void;
  read?: (event: Record<string, unknown>) => void;
};
let mockInboxHandlers: MockInboxHandlers | null = null;
let mockServerUnread = 0;
jest.mock('@/lib/context/RealtimeContext', () => ({
  useRealtimeContext: () => ({
    unreadMessages: mockServerUnread,
    unreadNotifications: 0,
    recoveryVersion: 0,
    refreshCounts: jest.fn(),
    subscribeToMessages: jest.fn(() => jest.fn()),
    subscribeToConversation: jest.fn(() => jest.fn()),
    subscribeToInbox: jest.fn((handlers: MockInboxHandlers) => {
      mockInboxHandlers = handlers;
      return jest.fn();
    }),
  }),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
}));

// Make Swipeable transparent so FlatList items render their children in tests
jest.mock('react-native-gesture-handler', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Swipeable: ({ children, renderRightActions }: { children: React.ReactNode; renderRightActions?: () => React.ReactNode }) => (
      React.createElement(View, null, children, renderRightActions?.())
    ),
    GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children),
    PanGestureHandler: ({ children }: { children: React.ReactNode }) => React.createElement(View, null, children),
    State: {},
  };
});

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('@/lib/api/messages', () => ({
  getConversations: jest.fn(),
  archiveConversation: jest.fn().mockResolvedValue(undefined),
  restoreConversation: jest.fn().mockResolvedValue({ data: { success: true } }),
  displayName: (user: any, fallback = 'Unknown') => user?.name ?? fallback,
}));

jest.mock('@/lib/utils/formatRelativeTime', () => ({
  formatRelativeTime: () => '2h ago',
}));

jest.mock('@/components/ui/Avatar', () => () => null);
jest.mock('@/components/ui/Skeleton', () => ({
  ConversationSkeleton: () => null,
  ExchangeCardSkeleton: () => null,
  ProfileSkeleton: () => null,
}));

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const hide = jest.fn();
  return { useAppToast: () => ({ show: mockShowToast, hide, isToastVisible: false }) };
});

// Auto-confirm: pressing the archive button runs the action immediately,
// mirroring the old Alert.alert button-press simulation.
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    confirm: (opts: { onConfirm: () => void | Promise<void> }) => {
      void opts.onConfirm();
    },
    confirmDialog: null,
  }),
}));

// --- Tests ---

import MessagesScreen from './messages';
import { archiveConversation, restoreConversation } from '@/lib/api/messages';

const defaultPaginatedState = {
  items: [],
  isLoading: false,
  isLoadingMore: false,
  error: null,
  hasMore: false,
  loadMore: jest.fn(),
  refresh: jest.fn(),
  mutateItems: jest.fn(),
};

beforeEach(() => {
  mockInboxHandlers = null;
  mockServerUnread = 0;
  mockRouterPush.mockReset();
  mockRouterReplace.mockReset();
  mockShowToast.mockReset();
  mockSearchParams.mockReturnValue({});
  mockUsePaginatedApi.mockReturnValue(defaultPaginatedState);
});

const mockConversation = {
  id: 7,
  other_user: { id: 2, name: 'Bob Builder', avatar_url: null },
  last_message: {
    body: 'Can you help with plumbing?',
    created_at: '2026-03-20T14:30:00Z',
    is_own: false,
  },
  unread_count: 0,
};

describe('MessagesScreen', () => {
  it('offers recovery without losing loaded rows after a later request fails', () => {
    const refresh = jest.fn();
    mockUsePaginatedApi.mockReturnValue({ ...defaultPaginatedState,
      items: [mockConversation], error: 'Connection interrupted', hasMore: true, refresh });
    const screen = render(<MessagesScreen />);
    expect(screen.getByText('Bob Builder')).toBeTruthy();
    expect(screen.getByText('Connection interrupted')).toBeTruthy();
    fireEvent.press(screen.getByText('Retry'));
    expect(refresh).toHaveBeenCalledTimes(1);
    mockUsePaginatedApi.mockReturnValue({ ...defaultPaginatedState, items: [mockConversation], refresh });
    screen.rerender(<MessagesScreen />);
    expect(screen.getByText('Bob Builder')).toBeTruthy();
    expect(screen.queryByText('Connection interrupted')).toBeNull();
  });

  it('renders the screen title', () => {
    const { getByText } = render(<MessagesScreen />);
    expect(getByText('Messages')).toBeTruthy();
  });

  it('renders empty state when there are no conversations and not loading', () => {
    const { getByText } = render(<MessagesScreen />);
    expect(getByText('No conversations yet')).toBeTruthy();
  });

  it('does not show empty text while loading', () => {
    mockUsePaginatedApi.mockReturnValue({
      ...defaultPaginatedState,
      isLoading: true,
    });

    const { queryByText } = render(<MessagesScreen />);
    expect(queryByText('No conversations yet')).toBeNull();
  });

  it('renders conversation rows when conversations are loaded', () => {
    mockUsePaginatedApi.mockReturnValue({
      ...defaultPaginatedState,
      items: [mockConversation],
    });

    const { getByText } = render(<MessagesScreen />);
    expect(getByText('Bob Builder')).toBeTruthy();
    expect(getByText('Can you help with plumbing?')).toBeTruthy();
  });

  it('filters conversations through the shared input-backed search field', () => {
    mockUsePaginatedApi.mockReturnValue({
      ...defaultPaginatedState,
      items: [
        mockConversation,
        {
          ...mockConversation,
          id: 8,
          other_user: { id: 3, name: 'Alice Artist', avatar_url: null },
          last_message: { body: 'Mural planning', created_at: '2026-03-21T09:00:00Z', is_own: false },
        },
      ],
    });

    const { getByPlaceholderText, getByLabelText, queryByText } = render(<MessagesScreen />);
    fireEvent.changeText(getByPlaceholderText('Search conversations...'), 'alice');

    expect(queryByText('Bob Builder')).toBeNull();
    expect(queryByText('Alice Artist')).toBeTruthy();
    expect(getByLabelText('Clear search')).toBeTruthy();
  });

  it('uses the translated member fallback when conversation user names are missing', () => {
    mockUsePaginatedApi.mockReturnValue({
      ...defaultPaginatedState,
      items: [{
        ...mockConversation,
        other_user: { id: 2, name: null, first_name: null, last_name: null, organization_name: null, avatar_url: null },
      }],
    });

    const { getByText, getByLabelText } = render(<MessagesScreen />);

    expect(getByText('Community member')).toBeTruthy();
    fireEvent.press(getByLabelText('Community member, Can you help with plumbing?'));

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/(modals)/thread',
      params: { recipientId: '2', name: 'Community member' },
    });
  });

  it('shows unread badge on conversation with unread messages', () => {
    mockUsePaginatedApi.mockReturnValue({
      ...defaultPaginatedState,
      items: [{ ...mockConversation, unread_count: 4 }],
    });

    const { getByText } = render(<MessagesScreen />);
    expect(getByText('4')).toBeTruthy();
  });

  it('shows error message with Retry when conversations fail to load', () => {
    mockUsePaginatedApi.mockReturnValue({
      ...defaultPaginatedState,
      error: 'Could not load messages.',
    });

    const { getByText } = render(<MessagesScreen />);
    expect(getByText('Could not load messages.')).toBeTruthy();
    expect(getByText('Retry')).toBeTruthy();
  });

  it('prefixes own last message with "You: "', () => {
    mockUsePaginatedApi.mockReturnValue({
      ...defaultPaginatedState,
      items: [{
        ...mockConversation,
        last_message: { body: 'Sure, on my way!', created_at: '2026-03-20T15:00:00Z', is_own: true },
      }],
    });

    const { getByText } = render(<MessagesScreen />);
    expect(getByText('You: Sure, on my way!')).toBeTruthy();
  });

  it('shows a single tick on an own last message until it is read, then a double tick', () => {
    mockUsePaginatedApi.mockReturnValue({
      ...defaultPaginatedState,
      items: [{
        ...mockConversation,
        last_message: { body: 'Sure, on my way!', created_at: '2026-03-20T15:00:00Z', is_own: true, is_read: false },
      }],
    });
    const screen = render(<MessagesScreen />);
    expect(screen.getByTestId('inbox-receipt-sent')).toBeTruthy();
    expect(screen.queryByTestId('inbox-receipt-read')).toBeNull();

    mockUsePaginatedApi.mockReturnValue({
      ...defaultPaginatedState,
      items: [{
        ...mockConversation,
        last_message: { body: 'Sure, on my way!', created_at: '2026-03-20T15:00:00Z', is_own: true, is_read: true },
      }],
    });
    screen.rerender(<MessagesScreen />);
    expect(screen.getByTestId('inbox-receipt-read')).toBeTruthy();
    expect(screen.queryByTestId('inbox-receipt-sent')).toBeNull();
  });

  it('shows no tick on a last message from the other member', () => {
    mockUsePaginatedApi.mockReturnValue({ ...defaultPaginatedState, items: [mockConversation] });
    const screen = render(<MessagesScreen />);
    expect(screen.queryByTestId('inbox-receipt-sent')).toBeNull();
    expect(screen.queryByTestId('inbox-receipt-read')).toBeNull();
  });

  /*
    Live inbox: a message or read receipt arriving on the member's channel updates the row in
    place — preview, tick, count and position — without waiting for a refetch.
  */
  describe('live inbox updates', () => {
    const convA = { ...mockConversation, id: 7, other_user: { id: 2, name: 'Bob Builder', avatar_url: null } };
    const convB = {
      ...mockConversation,
      id: 8,
      other_user: { id: 3, name: 'Alice Artist', avatar_url: null },
      last_message: { id: 40, body: 'Mural planning', created_at: '2026-03-21T09:00:00Z', sender_id: 3, is_read: true },
      unread_count: 0,
    };

    function renderInbox(items: unknown[]) {
      const mutateItems = jest.fn();
      const refresh = jest.fn();
      mockUsePaginatedApi.mockReturnValue({ ...defaultPaginatedState, items, mutateItems, refresh });
      render(<MessagesScreen />);
      expect(mockInboxHandlers).toBeTruthy();
      const applyLastMutation = (): any[] => {
        const updater = mutateItems.mock.calls[mutateItems.mock.calls.length - 1][0];
        return updater(items);
      };
      return { mutateItems, refresh, applyLastMutation };
    }

    it('a realtime message moves its conversation to the top and bumps unread', () => {
      const { mutateItems, applyLastMutation } = renderInbox([convA, convB]);

      mockInboxHandlers?.message?.(3, {
        id: 50, body: 'New one', sender_id: 3, receiver_id: 1, created_at: '2026-03-22T10:00:00Z', is_own: false, is_read: false,
      });

      expect(mutateItems).toHaveBeenCalledTimes(1);
      const next = applyLastMutation();
      expect(next.map((c) => c.id)).toEqual([8, 7]);
      expect(next[0].last_message).toEqual({ id: 50, body: 'New one', content: 'New one', sender_id: 3, created_at: '2026-03-22T10:00:00Z', is_read: false });
      expect(next[0].unread_count).toBe(1);
    });

    it('an own echo updates the preview without bumping unread', () => {
      const { applyLastMutation } = renderInbox([convA, convB]);

      mockInboxHandlers?.message?.(2, {
        id: 51, body: 'Mine', sender_id: 1, receiver_id: 2, created_at: '2026-03-22T10:01:00Z', is_own: true, is_read: false,
      });

      const next = applyLastMutation();
      expect(next[0].id).toBe(7);
      expect(next[0].last_message).toEqual({ id: 51, body: 'Mine', content: 'Mine', sender_id: 1, created_at: '2026-03-22T10:01:00Z', is_read: false });
      expect(next[0].unread_count).toBe(0);
    });

    it('message.read flips the preview tick when the other member reads our last message', () => {
      const ownLast = { ...convA, last_message: { id: 60, body: 'Sent by me', sender_id: 1, created_at: '2026-03-22T10:02:00Z', is_read: false } };
      const { applyLastMutation } = renderInbox([ownLast, convB]);

      mockInboxHandlers?.read?.({ reader_id: 2, sender_id: 1, up_to_message_id: 60 });

      const next = applyLastMutation();
      expect(next[0].last_message.is_read).toBe(true);
      expect(next[1].last_message.is_read).toBe(true);
    });

    it('message.read by this member elsewhere clears that conversation\'s unread count', () => {
      const unreadA = { ...convA, unread_count: 4 };
      const { applyLastMutation } = renderInbox([unreadA, convB]);

      mockInboxHandlers?.read?.({ reader_id: 1, sender_id: 2 });

      const next = applyLastMutation();
      expect(next[0].unread_count).toBe(0);
      expect(next[1].unread_count).toBe(0);
    });

    it('unknown conversation triggers a refresh', () => {
      const { mutateItems, refresh } = renderInbox([convA]);

      mockInboxHandlers?.message?.(99, {
        id: 52, body: 'Stranger', sender_id: 99, receiver_id: 1, created_at: '2026-03-22T10:03:00Z', is_own: false, is_read: false,
      });

      expect(refresh).toHaveBeenCalledTimes(1);
      expect(mutateItems).not.toHaveBeenCalled();
    });
  });

  it('shows relative timestamp next to the last message', () => {
    mockUsePaginatedApi.mockReturnValue({
      ...defaultPaginatedState,
      items: [mockConversation],
    });

    const { getByText } = render(<MessagesScreen />);
    expect(getByText('2h ago')).toBeTruthy();
  });

  it('opens conversation cards by other user id instead of conversation id', () => {
    mockUsePaginatedApi.mockReturnValue({
      ...defaultPaginatedState,
      items: [mockConversation],
    });

    const { getByLabelText } = render(<MessagesScreen />);
    fireEvent.press(getByLabelText('Bob Builder, Can you help with plumbing?'));

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/(modals)/thread',
      params: { recipientId: '2', name: 'Bob Builder' },
    });
  });

  it('does not open stale conversation cards without a valid recipient', () => {
    mockUsePaginatedApi.mockReturnValue({
      ...defaultPaginatedState,
      items: [{ ...mockConversation, other_user: { ...mockConversation.other_user, id: 0 } }],
    });

    const { getByLabelText } = render(<MessagesScreen />);
    fireEvent.press(getByLabelText('Bob Builder, Can you help with plumbing?'));

    expect(mockRouterPush).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith({
      title: 'Conversation unavailable',
      description: 'This conversation no longer has a valid recipient. Refresh messages and try again.',
      variant: 'danger',
    });
  });

  it('routes deep-linked recipients to the native thread composer', () => {
    mockSearchParams.mockReturnValue({ to: '260', name: 'Jasper Ford', listing: '90624' });

    render(<MessagesScreen />);

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/(modals)/thread',
      params: {
        recipientId: '260',
        name: 'Jasper Ford',
        listing: '90624',
      },
    });
  });

  it('routes contextual user query links to the native thread composer', () => {
    mockSearchParams.mockReturnValue({ user: '260', name: 'Jasper Ford', context: 'job', context_id: '44' });

    render(<MessagesScreen />);

    expect(mockRouterPush).toHaveBeenCalledWith({
      pathname: '/(modals)/thread',
      params: {
        recipientId: '260',
        name: 'Jasper Ford',
        context_type: 'job',
        context_id: '44',
      },
    });
  });

  it('opens the new group route from the header action', () => {
    const { getByLabelText } = render(<MessagesScreen />);

    fireEvent.press(getByLabelText('New group'));

    expect(mockRouterPush).toHaveBeenCalledWith({ pathname: '/(modals)/new-group' });
  });

  it('opens the native new-message route from the header action', () => {
    const { getByLabelText } = render(<MessagesScreen />);

    fireEvent.press(getByLabelText('New message'));

    expect(mockRouterPush).toHaveBeenCalledWith('/(modals)/new-message');
  });

  it('archives conversations through the branded confirm dialog', async () => {
    mockUsePaginatedApi.mockReturnValue({
      ...defaultPaginatedState,
      items: [mockConversation],
    });

    const { getByLabelText } = render(<MessagesScreen />);

    fireEvent.press(getByLabelText('Archive conversation with Bob Builder'));

    await waitFor(() => {
      expect(archiveConversation).toHaveBeenCalledWith(7);
    });
  });

  it('shows archived conversations and restores them from the Archived tab', async () => {
    const inboxRefresh = jest.fn();
    const archivedRefresh = jest.fn();
    mockUsePaginatedApi.mockImplementation(() => (
      mockUsePaginatedApi.mock.calls.length % 2 === 1
        ? { ...defaultPaginatedState, refresh: inboxRefresh }
        : { ...defaultPaginatedState, items: [mockConversation], refresh: archivedRefresh }
    ));

    const { getByText, getByLabelText } = render(<MessagesScreen />);

    fireEvent.press(getByText('Archived'));

    expect(getByText('Bob Builder')).toBeTruthy();
    expect(getByText('Can you help with plumbing?')).toBeTruthy();

    fireEvent.press(getByLabelText('Restore conversation with Bob Builder'));

    await waitFor(() => {
      expect(restoreConversation).toHaveBeenCalledWith(7);
    });
    expect(inboxRefresh).toHaveBeenCalled();
    expect(archivedRefresh).toHaveBeenCalled();
  });
});
