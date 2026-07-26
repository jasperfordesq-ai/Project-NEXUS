// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for NotificationsPage
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@/test/test-utils';

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn().mockResolvedValue({ success: true, data: [] }),
    post: vi.fn().mockResolvedValue({ success: true }),
    delete: vi.fn().mockResolvedValue({ success: true }),
  },
  tokenManager: { getTenantId: vi.fn() },
}));

// Controllable mocks for the notifications context handlers and toast, so tests can
// drive the success/failure of mark-as-read and assert the resulting toast.
const notifMocks = vi.hoisted(() => ({
  markAsRead: vi.fn(),
  markAllAsRead: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: { id: 1, first_name: 'Test' },
    isAuthenticated: true,
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
    hasFeature: vi.fn(() => true),
    hasModule: vi.fn(() => true),
  })),
  useToast: vi.fn(() => notifMocks.toast),

  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: notifMocks.markAsRead, markAllAsRead: notifMocks.markAllAsRead, hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

// NotificationsPage imports usePusherOptional from '@/contexts/PusherContext' directly, so
// the override in the '@/contexts' barrel above never applies — vitest resolves mocks per
// specifier. Without this, the real PusherContext module loads (and with it its own direct
// '@/contexts/AuthContext' import), so nothing here controls the realtime layer.
vi.mock('@/contexts/PusherContext', () => ({
  usePusherOptional: vi.fn(() => null),
  usePusher: vi.fn(() => ({ channel: null, isConnected: false })),
}));

vi.mock('@/hooks', () => ({
  usePageTitle: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
  resolveAvatarUrl: vi.fn((url) => url || '/default-avatar.png'),
  formatRelativeTime: vi.fn(() => '5 minutes ago'),
}));

vi.mock('@/components/ui', async () => (await import('@/test/uiMock')).uiMock);

vi.mock('@/components/feedback', () => ({
  EmptyState: ({ title, description }: { title: string; description?: string }) => (
    <div data-testid="empty-state">
      <div>{title}</div>
      {description && <div>{description}</div>}
    </div>
  ),
}));

vi.mock('@/lib/motion', () => ({
  motion: {
    div: ({ children, ...props }: Record<string, unknown>) => {
      const motionKeys = new Set(["variants", "initial", "animate", "transition", "whileInView", "viewport", "layout", "exit", "whileHover", "whileTap"]);
      const rest: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) { if (!motionKeys.has(k)) rest[k] = v; }
      return <div {...rest}>{children}</div>;
    },
  },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { NotificationsPage } from './NotificationsPage';
import { api } from '@/lib/api';

describe('NotificationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default both context handlers to "server confirmed" so the happy path works;
    // individual tests override with mockResolvedValue(false) to exercise failure.
    notifMocks.markAsRead.mockResolvedValue(true);
    notifMocks.markAllAsRead.mockResolvedValue(true);
  });

  it('renders the page heading and description', () => {
    render(<NotificationsPage />);
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('Stay updated with your activity')).toBeInTheDocument();
  });

  it('shows filter buttons for All and Unread', () => {
    render(<NotificationsPage />);
    expect(screen.getByText('All')).toBeInTheDocument();
    // Unread count starts at 0
    expect(screen.getByText('Unread (0)')).toBeInTheDocument();
  });

  it('shows empty state when no notifications exist', async () => {
    vi.mocked(api.get).mockResolvedValue({ success: true, data: [] });
    render(<NotificationsPage />);
    await waitFor(() => {
      expect(screen.getByText('No notifications')).toBeInTheDocument();
    });
  });

  it('renders notification cards with message and timestamp', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          type: 'message',
          title: 'New Message',
          body: 'You received a new message from Alice',
          message: 'You received a new message from Alice',
          read_at: null,
          created_at: '2026-02-19T10:00:00Z',
        },
        {
          id: 2,
          type: 'listing',
          title: 'Listing Update',
          body: 'Your listing got a response',
          message: 'Your listing got a response',
          read_at: '2026-02-19T09:00:00Z',
          created_at: '2026-02-19T08:00:00Z',
        },
      ],
    });
    render(<NotificationsPage />);
    await waitFor(() => {
      expect(screen.getByText('You received a new message from Alice')).toBeInTheDocument();
    });
    expect(screen.getByText('Your listing got a response')).toBeInTheDocument();
    // Check timestamps rendered
    expect(screen.getAllByText('5 minutes ago').length).toBeGreaterThanOrEqual(2);
  });

  it('shows unread count badge when there are unread notifications', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          type: 'message',
          title: 'New',
          body: 'Unread notification',
          read_at: null,
          created_at: '2026-02-19T10:00:00Z',
        },
        {
          id: 2,
          type: 'listing',
          title: 'Old',
          body: 'Read notification',
          read_at: '2026-02-19T09:00:00Z',
          created_at: '2026-02-19T08:00:00Z',
        },
      ],
    });
    render(<NotificationsPage />);
    await waitFor(() => {
      expect(screen.getByText('1 new')).toBeInTheDocument();
    });
    expect(screen.getByText('Unread (1)')).toBeInTheDocument();
  });

  it('shows Mark all read button when there are unread notifications', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          type: 'message',
          title: 'New',
          body: 'Unread notification',
          read_at: null,
          created_at: '2026-02-19T10:00:00Z',
        },
      ],
    });
    render(<NotificationsPage />);
    await waitFor(() => {
      expect(screen.getByText('Mark all read')).toBeInTheDocument();
    });
  });

  it('shows mark-as-read and delete buttons on notification cards', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [
        {
          id: 1,
          type: 'message',
          title: 'New',
          body: 'Unread notification',
          read_at: null,
          created_at: '2026-02-19T10:00:00Z',
        },
      ],
    });
    render(<NotificationsPage />);
    await waitFor(() => {
      expect(screen.getByLabelText('Mark as read')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Delete notification')).toBeInTheDocument();
  });

  it('marks grouped notifications as read via the body-based endpoint', async () => {
    vi.mocked(api.get).mockResolvedValue({
      success: true,
      data: [
        {
          id: 99,
          type: 'federation_message',
          title: 'Federation messages',
          body: '2 people messaged you',
          message: '2 people messaged you',
          read_at: null,
          created_at: '2026-02-19T10:00:00Z',
          is_grouped: true,
          group_count: 2,
          group_key: 'federation_message:/federation/messages',
        },
      ],
    });

    render(<NotificationsPage />);

    await waitFor(() => {
      expect(screen.getByLabelText('Mark group as read')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Mark group as read'));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/v2/notifications/group/read', {
        group_key: 'federation_message:/federation/messages',
      });
    });
  });

  it('shows notification settings button', () => {
    render(<NotificationsPage />);
    expect(screen.getByLabelText('Notification settings')).toBeInTheDocument();
  });

  // Regression: the context mark-as-read handlers swallow errors and never throw, so
  // the page's `await` always resolved — it then optimistically cleared the list AND
  // (for mark-all) showed a success toast even when the server rejected the change.
  // The handlers now return a confirmed boolean and the page gates UI on it.
  const oneUnread = {
    success: true,
    data: [
      { id: 1, type: 'message', title: 'New', body: 'Unread', read_at: null, created_at: '2026-02-19T10:00:00Z' },
    ],
  };

  it('on a failed Mark all read shows an error toast, not a false success', async () => {
    notifMocks.markAllAsRead.mockResolvedValue(false);
    vi.mocked(api.get).mockResolvedValue(oneUnread);
    render(<NotificationsPage />);
    await waitFor(() => expect(screen.getByText('Mark all read')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Mark all read'));

    await waitFor(() => expect(notifMocks.toast.error).toHaveBeenCalled());
    expect(notifMocks.toast.success).not.toHaveBeenCalled();
  });

  it('on a successful Mark all read shows the success toast', async () => {
    notifMocks.markAllAsRead.mockResolvedValue(true);
    vi.mocked(api.get).mockResolvedValue(oneUnread);
    render(<NotificationsPage />);
    await waitFor(() => expect(screen.getByText('Mark all read')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Mark all read'));

    await waitFor(() => expect(notifMocks.toast.success).toHaveBeenCalled());
  });

  it('on a failed per-item Mark as read leaves the row unread and shows an error', async () => {
    notifMocks.markAsRead.mockResolvedValue(false);
    vi.mocked(api.get).mockResolvedValue(oneUnread);
    render(<NotificationsPage />);
    await waitFor(() => expect(screen.getByLabelText('Mark as read')).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText('Mark as read'));

    await waitFor(() => expect(notifMocks.toast.error).toHaveBeenCalled());
    // Still unread → the per-item "Mark as read" affordance remains.
    expect(screen.getByLabelText('Mark as read')).toBeInTheDocument();
  });
});
