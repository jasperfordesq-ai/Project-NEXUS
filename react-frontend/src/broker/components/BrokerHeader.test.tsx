// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';
import { createMockContexts } from '@/test/mock-contexts';
import userEvent from '@testing-library/user-event';

const mockNavigate = vi.fn();
const disabledModules = vi.hoisted(() => new Set<string>());
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return { ...actual, useNavigate: () => mockNavigate };
});

const mockLogout = vi.fn();
const mockToggleTheme = vi.hoisted(() => vi.fn());
const mockResolvedTheme = vi.hoisted(() => ({ value: 'light' as 'light' | 'dark' }));
const mockUnread = vi.hoisted(() => ({ value: 0 }));
const mockMarkAllAsRead = vi.hoisted(() => vi.fn(async () => true));
const mockApiGet = vi.hoisted(() => vi.fn());
const mockAdminAccess = vi.hoisted(() => ({ value: false }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, api: { ...actual.api, get: mockApiGet } };
});
vi.mock('@/lib/access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/access')>()),
  hasAdminPanelAccess: vi.fn(() => mockAdminAccess.value),
}));

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: {
        id: 1,
        name: 'Alice Smith',
        avatar_url: null,
        avatar: null,
      },
      isAuthenticated: true,
      login: vi.fn(),
      logout: mockLogout,
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useTenant: () => ({
      tenant: { id: 2, name: 'hOUR Timebank', slug: 'hour-timebank' },
      tenantSlug: 'hour-timebank',
      tenantPath: (p: string) => `/hour-timebank${p}`,
      hasFeature: vi.fn(() => true),
      hasModule: vi.fn((module: string) => !disabledModules.has(module)),
    }),
    useTheme: () => ({
      // The shared helper types this as the literal 'light'; the tests flip it to 'dark' at runtime.
      resolvedTheme: mockResolvedTheme.value as 'light',
      theme: 'system' as const,
      toggleTheme: mockToggleTheme,
      setTheme: vi.fn(),
    }),
    useNotifications: () => ({
      unreadCount: mockUnread.value,
      counts: {},
      notifications: [],
      markAsRead: vi.fn(),
      markAllAsRead: mockMarkAllAsRead,
      hasMore: false,
      loadMore: vi.fn(),
      isLoading: false,
      refresh: vi.fn(),
    }),
  })
);

// resolveAvatarUrl may call URL helpers; stub it while preserving all other exports.
vi.mock('@/lib/helpers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/helpers')>();
  return {
    ...actual,
    resolveAvatarUrl: vi.fn(() => null),
  };
});

import { BrokerHeader } from './BrokerHeader';

describe('BrokerHeader', () => {
  const onSidebarToggle = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    disabledModules.clear();
    mockUnread.value = 0;
    mockResolvedTheme.value = 'light';
    mockAdminAccess.value = false;
    mockApiGet.mockResolvedValue({ success: true, data: [] });
    Object.defineProperty(window.navigator, 'platform', { value: 'MacIntel', configurable: true });
    Object.defineProperty(window.navigator, 'userAgentData', { value: undefined, configurable: true });
  });

  it('renders a <header> element', () => {
    render(<BrokerHeader sidebarCollapsed={false} />);
    expect(screen.getByRole('banner')).toBeInTheDocument();
  });

  it('renders the tenant name', () => {
    render(<BrokerHeader sidebarCollapsed={false} />);
    expect(screen.getByText('hOUR Timebank')).toBeInTheDocument();
  });

  it('renders the user name', () => {
    render(<BrokerHeader sidebarCollapsed={false} />);
    // Name is hidden on mobile, shown on sm+ — getByText finds it regardless of visibility
    expect(screen.getByText('Alice Smith')).toBeInTheDocument();
  });

  it('renders a notifications button', () => {
    render(<BrokerHeader sidebarCollapsed={false} />);
    expect(screen.getByRole('button', { name: /notifications/i })).toBeInTheDocument();
  });

  it('navigates to dashboard when back-to-site button is pressed', async () => {
    const user = userEvent.setup();
    render(<BrokerHeader sidebarCollapsed={false} />);
    // The back-to-site button has an ArrowLeft icon; pick the button containing "back"
    const backBtn = screen.getAllByRole('button').find((b) =>
      /back/i.test(b.getAttribute('aria-label') || b.textContent || '')
    );
    // It may not have an aria-label; it's the one before the tenant name.
    // Navigate by pressing all buttons that are NOT the sidebar toggle and NOT icon-only notifications
    // Simpler: press the back arrow button (startContent=ArrowLeft, no aria-label for the back text)
    // The sidebar toggle is only shown when onSidebarToggle is provided
    const [backButton] = screen.getAllByRole('button');
    await user.click(backButton);
    expect(mockNavigate).toHaveBeenCalledWith('/hour-timebank/dashboard');
  });

  it('renders a sidebar toggle button when onSidebarToggle is provided', () => {
    render(<BrokerHeader sidebarCollapsed={false} onSidebarToggle={onSidebarToggle} />);
    expect(screen.getByRole('button', { name: /toggle.*(sidebar|menu)/i })).toBeInTheDocument();
  });

  it('calls onSidebarToggle when the menu button is pressed', async () => {
    const user = userEvent.setup();
    render(<BrokerHeader sidebarCollapsed={false} onSidebarToggle={onSidebarToggle} />);
    await user.click(screen.getByRole('button', { name: /toggle.*(sidebar|menu)/i }));
    expect(onSidebarToggle).toHaveBeenCalled();
  });

  it('does NOT render a sidebar toggle button when onSidebarToggle is absent', () => {
    render(<BrokerHeader sidebarCollapsed={false} />);
    expect(screen.queryByRole('button', { name: /toggle.*(sidebar|menu)/i })).not.toBeInTheDocument();
  });

  describe('notifications bell', () => {
    const NOTIFICATIONS = [
      { id: 11, type: 'message', title: 'New message from Bob', body: 'Hello there', read_at: null, link: '/messages/4', created_at: new Date(Date.now() - 5 * 60_000).toISOString() },
      { id: 12, type: 'system', title: 'Vetting confirmation due', body: 'Carol needs vetting', read_at: '2026-10-01T10:00:00Z', link: null, created_at: new Date(Date.now() - 3 * 3_600_000).toISOString() },
    ];

    it('shows the unread count on the bell', () => {
      mockUnread.value = 3;
      render(<BrokerHeader sidebarCollapsed={false} />);
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /notifications, 3 unread/i })).toBeInTheDocument();
    });

    it('shows no count when nothing is unread', () => {
      render(<BrokerHeader sidebarCollapsed={false} />);
      expect(screen.queryByText('0')).not.toBeInTheDocument();
    });

    it('opens a drawer inside the panel instead of leaving it, listing the latest notifications', async () => {
      mockApiGet.mockResolvedValue({ success: true, data: NOTIFICATIONS });
      const user = userEvent.setup();
      render(<BrokerHeader sidebarCollapsed={false} />);

      await user.click(screen.getByRole('button', { name: /notifications/i }));

      expect(mockNavigate).not.toHaveBeenCalled();
      expect(await screen.findByText('New message from Bob')).toBeInTheDocument();
      expect(screen.getByText('Vetting confirmation due')).toBeInTheDocument();
      expect(mockApiGet).toHaveBeenCalledWith(expect.stringContaining('/v2/notifications/grouped?per_page=15'));
    });

    it('marks everything read from the drawer and links to the full notifications page', async () => {
      mockUnread.value = 2;
      mockApiGet.mockResolvedValue({ success: true, data: NOTIFICATIONS });
      const user = userEvent.setup();
      render(<BrokerHeader sidebarCollapsed={false} />);

      await user.click(screen.getByRole('button', { name: /notifications/i }));
      await user.click(await screen.findByRole('button', { name: /mark all as read/i }));
      expect(mockMarkAllAsRead).toHaveBeenCalledTimes(1);

      expect(screen.getByRole('link', { name: /open all notifications/i })).toHaveAttribute('href', '/hour-timebank/notifications');
    });

    it('says so when there is nothing to show', async () => {
      const user = userEvent.setup();
      render(<BrokerHeader sidebarCollapsed={false} />);
      await user.click(screen.getByRole('button', { name: /notifications/i }));
      expect(await screen.findByText(/all caught up/i)).toBeInTheDocument();
    });
  });

  describe('theme toggle', () => {
    it('offers dark mode in light mode and calls toggleTheme', async () => {
      const user = userEvent.setup();
      render(<BrokerHeader sidebarCollapsed={false} />);
      await user.click(screen.getByRole('button', { name: /switch to dark theme/i }));
      expect(mockToggleTheme).toHaveBeenCalledTimes(1);
    });

    it('offers light mode in dark mode', () => {
      mockResolvedTheme.value = 'dark';
      render(<BrokerHeader sidebarCollapsed={false} />);
      expect(screen.getByRole('button', { name: /switch to light theme/i })).toBeInTheDocument();
    });
  });

  describe('shortcut hint', () => {
    it('shows ⌘K on Apple platforms', () => {
      render(<BrokerHeader sidebarCollapsed={false} onOpenSearch={vi.fn()} />);
      expect(screen.getByText('⌘K')).toBeInTheDocument();
      expect(screen.queryByText('Ctrl')).not.toBeInTheDocument();
    });

    it('shows Ctrl K everywhere else', () => {
      Object.defineProperty(window.navigator, 'platform', { value: 'Win32', configurable: true });
      render(<BrokerHeader sidebarCollapsed={false} onOpenSearch={vi.fn()} />);
      expect(screen.getByText('Ctrl')).toBeInTheDocument();
      expect(screen.getByText('K')).toBeInTheDocument();
      expect(screen.queryByText('⌘K')).not.toBeInTheDocument();
    });
  });

  describe('user menu', () => {
    it('offers the admin panel only to a user who may open it', async () => {
      mockAdminAccess.value = true;
      const user = userEvent.setup();
      render(<BrokerHeader sidebarCollapsed={false} />);
      await user.click(screen.getByText('Alice Smith').closest('button')!);
      await user.click(await screen.findByText(/^admin panel$/i));
      expect(mockNavigate).toHaveBeenCalledWith('/hour-timebank/admin');
    });

    it('hides the admin panel from a broker', async () => {
      const user = userEvent.setup();
      render(<BrokerHeader sidebarCollapsed={false} />);
      await user.click(screen.getByText('Alice Smith').closest('button')!);
      expect(await screen.findByText(/sign.?out/i)).toBeInTheDocument();
      expect(screen.queryByText(/^admin panel$/i)).not.toBeInTheDocument();
    });

    it('opens the keyboard shortcuts list', async () => {
      const onOpenShortcuts = vi.fn();
      const user = userEvent.setup();
      render(<BrokerHeader sidebarCollapsed={false} onOpenShortcuts={onOpenShortcuts} />);
      await user.click(screen.getByText('Alice Smith').closest('button')!);
      await user.click(await screen.findByText(/keyboard shortcuts/i));
      expect(onOpenShortcuts).toHaveBeenCalledTimes(1);
    });
  });

  it('calls logout when the sign-out dropdown item is activated', async () => {
    const user = userEvent.setup();
    render(<BrokerHeader sidebarCollapsed={false} />);

    // Open the user dropdown — find the button that contains the avatar/user-name area
    // It doesn't have an aria-label, so we target by text content
    const avatarButton = screen.getByText('Alice Smith').closest('button');
    expect(avatarButton).not.toBeNull();
    await user.click(avatarButton!);

    // After opening, the DropdownMenu renders items in a portal
    const signOutItem = await screen.findByText(/sign.?out/i);
    await user.click(signOutItem);
    expect(mockLogout).toHaveBeenCalled();
  });

  it('navigates to profile when My Profile dropdown item is activated', async () => {
    const user = userEvent.setup();
    render(<BrokerHeader sidebarCollapsed={false} />);

    const avatarButton = screen.getByText('Alice Smith').closest('button');
    await user.click(avatarButton!);

    const profileItem = await screen.findByText(/my.?profile/i);
    await user.click(profileItem);
    expect(mockNavigate).toHaveBeenCalledWith('/hour-timebank/profile');
  });

  it('hides notifications and profile controls when their modules are disabled', async () => {
    disabledModules.add('notifications');
    disabledModules.add('profile');
    const user = userEvent.setup();

    render(<BrokerHeader sidebarCollapsed={false} />);

    expect(screen.queryByRole('button', { name: /notifications/i })).not.toBeInTheDocument();
    await user.click(screen.getByText('Alice Smith').closest('button')!);
    expect(screen.queryByText(/my.?profile/i)).not.toBeInTheDocument();
    expect(await screen.findByText(/sign.?out/i)).toBeInTheDocument();
  });
});
