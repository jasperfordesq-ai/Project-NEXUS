// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';

jest.mock('expo-router', () => ({
  // AppTopBar registers its Android back handler only while the screen is focused
  // (audit 2026-09-06, F10), so every screen mock needs this hook to exist.
  useFocusEffect: jest.fn(),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => false) },
  useLocalSearchParams: () => ({}),
  useNavigation: () => ({ setOptions: jest.fn() }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'title': 'Notifications',
        'eyebrow': 'Activity inbox',
        'allCaughtUp': 'You are all caught up!',
        'allCaughtUpSub': 'You have no new notifications.',
        'unreadCount': opts ? `${String(opts.count ?? 0)} unread` : '0 unread',
        'unreadSummary': opts ? `You have ${String(opts.count ?? 0)} unread notifications.` : 'You have unread notifications.',
        'markAllRead': 'Mark all read',
        'markRead': 'Mark read',
        'markGroupRead': 'Mark group read',
        'delete': 'Delete',
        'swipeMarkRead': 'Swipe action: mark read',
        'swipeMarkGroupRead': 'Swipe action: mark group read',
        'swipeDelete': 'Swipe action: delete notification',
        'marking': 'Marking...',
        'markError': 'Failed to mark as read.',
        'deleteError': 'Could not delete notification.',
        'justNow': 'Just now',
        'itemHint': 'Tap to view',
        'unreadItem': opts ? `Unread: ${String(opts.label ?? '')}` : 'Unread',
        'groupCount': opts ? `${String(opts.count ?? 0)} notifications` : '0 notifications',
        'expandGroup': 'Expand group',
        'collapseGroup': 'Collapse group',
        'unknownActor': 'Community member',
        'andOthers': opts ? `And ${String(opts.count ?? 0)} others` : 'And others',
        'category.message': 'Message',
        'category.transaction': 'Transaction',
        'category.social': 'Social',
        'category.system': 'System',
        'category.event': 'Event',
        'category.group': 'Group',
        'category.listing': 'Listing',
        'category.connection': 'Connection',
        'category.mention': 'Mention',
        'category.other': 'Notification',
        'common:errors.alertTitle': 'Error',
        'common:buttons.retry': 'Retry',
        'common:back': 'Back',
      };
      return map[key] ?? key;
    },
    i18n: { language: 'en' },
  }),
}));

jest.mock('@/lib/hooks/useTenant', () => ({
  usePrimaryColor: () => '#6366f1',
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
    success: '#22c55e',
    warning: '#f59e0b',
    info: '#3b82f6',
  }),
}));

const mockUsePaginatedApi = jest.fn();
jest.mock('@/lib/hooks/usePaginatedApi', () => ({
  usePaginatedApi: (...args: unknown[]) => mockUsePaginatedApi(...args),
}));

const mockUseApi = jest.fn();
jest.mock('@/lib/hooks/useApi', () => ({
  useApi: (...args: unknown[]) => mockUseApi(...args),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success' },
}));

jest.mock('@expo/vector-icons', () => ({
  Ionicons: 'View',
}));

jest.mock('react-native-gesture-handler', () => {
  const React = require('react');
  const { View } = require('react-native');

  return {
    Swipeable: ({
      children,
      renderRightActions,
    }: {
      children: React.ReactNode;
      renderRightActions?: () => React.ReactNode;
    }) => (
      <View>
        {children}
        {renderRightActions ? renderRightActions() : null}
      </View>
    ),
  };
});

jest.mock('@/lib/api/notifications', () => ({
  getNotifications: jest.fn(),
  getNotificationCounts: jest.fn(),
  markAllRead: jest.fn().mockResolvedValue(undefined),
  markGroupRead: jest.fn().mockResolvedValue(undefined),
  markRead: jest.fn().mockResolvedValue(undefined),
  deleteNotification: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/components/ui/Avatar', () => 'View');
jest.mock('@/components/ui/LoadingSpinner', () => () => null);

jest.mock('@/components/ui/AppToast', () => {
  // Stable references so screens that put `show` in a useCallback/useEffect
  // dependency array don't re-run their effects on every render.
  const show = jest.fn();
  const hide = jest.fn();
  return { useAppToast: () => ({ show, hide, isToastVisible: false }) };
});

// Auto-confirm: triggering the confirm runs the action immediately,
// mirroring the old Alert.alert button-press simulation.
jest.mock('@/components/ui/useConfirm', () => ({
  useConfirm: () => ({
    confirm: (opts: { onConfirm: () => void | Promise<void> }) => {
      void opts.onConfirm();
    },
    confirmDialog: null,
  }),
}));

jest.mock('@/lib/utils/navigateToLink', () => ({
  navigateToLink: jest.fn(),
}));

jest.mock('@/lib/utils/formatRelativeTime', () => ({
  formatRelativeTime: jest.fn(() => '5 min ago'),
}));

import NotificationsScreen from './notifications';
import { deleteNotification, markGroupRead, markRead } from '@/lib/api/notifications';
import { navigateToLink } from '@/lib/utils/navigateToLink';

const defaultApiState = { data: null, isLoading: false, error: null, refresh: jest.fn() };

/** The list is paginated since the 2026-09-06 audit; older notifications used to be unreachable. */
function pageState(items: unknown[] = [], overrides: Record<string, unknown> = {}) {
  return {
    items,
    isLoading: false,
    isLoadingMore: false,
    error: null,
    hasMore: false,
    loadMore: jest.fn(),
    refresh: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseApi.mockReturnValue(defaultApiState);
  mockUsePaginatedApi.mockReturnValue(pageState());
});

const mockNotification = {
  id: 1,
  title: 'New message from Alice',
  message: 'Alice sent you a message about your listing.',
  is_read: false,
  category: 'message',
  link: '/messages/1',
  created_at: new Date(Date.now() - 300_000).toISOString(),
  actor: { id: 2, name: 'Alice', avatar_url: null },
};

describe('NotificationsScreen', () => {
  it('renders without crashing', () => {
    const { toJSON } = render(<NotificationsScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders the Notifications heading', () => {
    const { getAllByText } = render(<NotificationsScreen />);
    expect(getAllByText('Notifications').length).toBeGreaterThan(0);
  });

  it('renders the empty state when there are no notifications', () => {
    const { getByText } = render(<NotificationsScreen />);
    expect(getByText('You are all caught up!')).toBeTruthy();
  });

  it('renders a loading spinner when data is loading', () => {
    mockUsePaginatedApi.mockReturnValueOnce(pageState([], { isLoading: true }));

    const { toJSON } = render(<NotificationsScreen />);
    expect(toJSON()).toBeTruthy();
  });

  it('renders notification items when data is available', () => {
    mockUsePaginatedApi.mockReturnValueOnce(pageState([mockNotification]));

    const { getByText } = render(<NotificationsScreen />);
    expect(getByText('New message from Alice')).toBeTruthy();
    expect(getByText('Alice sent you a message about your listing.')).toBeTruthy();
  });

  /**
   * 🔴 The header counted only the page that happened to be loaded. On a device with 26
   * unread notifications it read "10 unread", because the list is paginated at 20 and then
   * grouped. `/v2/notifications/counts` has the real total. Journey 7.15.
   */
  it('shows the unread total from the server, not the count on the loaded page', () => {
    mockUsePaginatedApi.mockReturnValue(pageState([mockNotification]));
    mockUseApi.mockReturnValue({ data: { data: { total: 26 } }, isLoading: false, error: null, refresh: jest.fn() });

    const { getByText } = render(<NotificationsScreen />);

    expect(getByText('26 unread')).toBeTruthy();
    expect(getByText('You have 26 unread notifications.')).toBeTruthy();
  });

  it('falls back to the loaded page when the count request gives nothing', () => {
    mockUsePaginatedApi.mockReturnValue(pageState([mockNotification]));
    mockUseApi.mockReturnValue({ data: null, isLoading: false, error: 'offline', refresh: jest.fn() });

    const { getByText } = render(<NotificationsScreen />);

    expect(getByText('1 unread')).toBeTruthy();
  });

  it('refreshes both the notification list and the server unread total on pull', () => {
    const listRefresh = jest.fn();
    const countRefresh = jest.fn();
    // The list is paginated and the count is a separate request; a pull must touch both.
    mockUsePaginatedApi.mockReturnValue(pageState([mockNotification], { refresh: listRefresh }));
    mockUseApi.mockReturnValue({ data: { data: { total: 26 } }, isLoading: false, error: null, refresh: countRefresh });

    const { UNSAFE_getByType } = render(<NotificationsScreen />);
    fireEvent(UNSAFE_getByType(RefreshControl), 'refresh');

    expect(listRefresh).toHaveBeenCalledTimes(1);
    expect(countRefresh).toHaveBeenCalledTimes(1);
  });

  it('reaches past the first page, so older notifications are not stranded', () => {
    /*
      🔴 S3-03: the screen fetched exactly ONE page of 25 and offered no load-more. On the
      emulator fixture (47 unread) the header said 47 and the list held 25; the other 22
      could not be reached from inside the app at all.
    */
    const loadMore = jest.fn();
    mockUsePaginatedApi.mockReturnValue(pageState([mockNotification], { hasMore: true, loadMore }));

    const { UNSAFE_getByType } = render(<NotificationsScreen />);
    const list = UNSAFE_getByType(require('react-native').FlatList);

    expect(typeof list.props.onEndReached).toBe('function');
    list.props.onEndReached();
    expect(loadMore).toHaveBeenCalled();
  });

  it('marks a single notification as read from the card action', async () => {
    const refresh = jest.fn();
    mockUsePaginatedApi.mockReturnValueOnce(pageState([mockNotification], { refresh: refresh }));

    const { getAllByText } = render(<NotificationsScreen />);
    fireEvent.press(getAllByText('Mark read')[0]);

    await waitFor(() => expect(markRead).toHaveBeenCalledWith(1));
    expect(refresh).toHaveBeenCalled();
  });

  it('deletes a notification from the card action', async () => {
    const refresh = jest.fn();
    mockUsePaginatedApi.mockReturnValueOnce(pageState([mockNotification], { refresh: refresh }));

    const { getAllByText } = render(<NotificationsScreen />);
    fireEvent.press(getAllByText('Delete')[0]);

    await waitFor(() => expect(deleteNotification).toHaveBeenCalledWith(1));
    expect(refresh).toHaveBeenCalled();
  });

  it('exposes a swipe action for marking an ungrouped notification read', async () => {
    const refresh = jest.fn();
    mockUsePaginatedApi.mockReturnValue(pageState([mockNotification], { refresh: refresh }));

    const { getByLabelText } = render(<NotificationsScreen />);

    fireEvent.press(getByLabelText('Swipe action: mark read'));
    await waitFor(() => expect(markRead).toHaveBeenCalledWith(1));
    expect(refresh).toHaveBeenCalled();
  });

  it('exposes a swipe action for deleting an ungrouped notification', async () => {
    const refresh = jest.fn();
    mockUsePaginatedApi.mockReturnValue(pageState([mockNotification], { refresh: refresh }));

    const { getByLabelText } = render(<NotificationsScreen />);
    fireEvent.press(getByLabelText('Swipe action: delete notification'));
    await waitFor(() => expect(deleteNotification).toHaveBeenCalledWith(1));
    expect(refresh).toHaveBeenCalled();
  });

  it('opens a notification link and marks it read when the card body is pressed', async () => {
    const refresh = jest.fn();
    mockUsePaginatedApi.mockReturnValueOnce(pageState([mockNotification], { refresh: refresh }));

    const { getByLabelText } = render(<NotificationsScreen />);
    fireEvent.press(getByLabelText('Unread: New message from Alice. Alice sent you a message about your listing.'));

    await waitFor(() => expect(markRead).toHaveBeenCalledWith(1));
    expect(navigateToLink).toHaveBeenCalledWith('/messages/1');
  });

  it('renders grouped notifications and marks the group as read', async () => {
    const grouped = {
      ...mockNotification,
      id: 9,
      title: 'Federation messages',
      message: 'Two partners sent federation messages.',
      is_grouped: true,
      group_count: 2,
      group_key: 'federation_message:/federation/messages',
      actors: [
        { id: 3, name: 'Mina', avatar_url: null },
        { id: 4, name: 'Jo', avatar_url: null },
      ],
      remaining_count: 1,
      latest_at: new Date(Date.now() - 120_000).toISOString(),
    };
    const refresh = jest.fn();
    mockUsePaginatedApi.mockReturnValue(pageState([grouped], { refresh: refresh }));

    const { getAllByText, getByLabelText, getByText, queryByText } = render(<NotificationsScreen />);

    expect(getByText('2 notifications')).toBeTruthy();
    expect(queryByText('Delete')).toBeNull();

    fireEvent.press(getByLabelText('Expand group'));
    expect(getByText('Mina')).toBeTruthy();
    expect(getByText('Jo')).toBeTruthy();
    expect(getByText('And 1 others')).toBeTruthy();

    fireEvent.press(getAllByText('Mark group read')[0]);

    await waitFor(() => expect(markGroupRead).toHaveBeenCalledWith('federation_message:/federation/messages'));
    expect(refresh).toHaveBeenCalled();
  });

  it('renders the "Mark all read" button when unread notifications exist', () => {
    mockUsePaginatedApi.mockReturnValueOnce(pageState([mockNotification]));

    const { getByText } = render(<NotificationsScreen />);
    expect(getByText('Mark all read')).toBeTruthy();
  });

  it('does not render "Mark all read" when all notifications are read', () => {
    mockUsePaginatedApi.mockReturnValueOnce(pageState([{ ...mockNotification, is_read: true }]));

    const { queryByText } = render(<NotificationsScreen />);
    expect(queryByText('Mark all read')).toBeNull();
  });

  it('renders error state with retry button when there is an error', () => {
    mockUsePaginatedApi.mockReturnValueOnce(pageState([], { error: 'Failed to load notifications.' }));

    const { getByText } = render(<NotificationsScreen />);
    expect(getByText('Failed to load notifications.')).toBeTruthy();
    expect(getByText('Retry')).toBeTruthy();
  });
});
