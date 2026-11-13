// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for FriendsWidget
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';

// Stable mock references to prevent infinite render loops
const mockTenantReturn = {
  tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
  tenantPath: (p: string) => `/test${p}`,
  hasFeature: vi.fn(() => true),
  hasModule: vi.fn(() => true),
};

const mockToastReturn = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
};

vi.mock('@/lib/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('@/contexts', () => ({
  useTenant: vi.fn(() => mockTenantReturn),
  useAuth: vi.fn(() => ({
    isAuthenticated: true,
    user: { id: 1, first_name: 'Alice', last_name: 'Smith', username: 'asmith', avatar: '/alice.png' },
  })),
  useToast: vi.fn(() => mockToastReturn),
  useTheme: () => ({ resolvedTheme: 'light', toggleTheme: vi.fn(), theme: 'system', setTheme: vi.fn() }),
  useNotifications: () => ({ unreadCount: 0, counts: {}, notifications: [], markAsRead: vi.fn(), markAllAsRead: vi.fn(), hasMore: false, loadMore: vi.fn(), isLoading: false, refresh: vi.fn() }),
  usePusher: () => ({ channel: null, isConnected: false }),
  usePusherOptional: () => null,
  useCookieConsent: () => ({ consent: null, showBanner: false, openPreferences: vi.fn(), resetConsent: vi.fn(), saveConsent: vi.fn(), hasConsent: vi.fn(() => true), updateConsent: vi.fn() }),
  readStoredConsent: () => null,
  useMenuContext: () => ({ headerMenus: [], mobileMenus: [], hasCustomMenus: false }),
  useFeature: vi.fn(() => true),
  useModule: vi.fn(() => true),
}));

vi.mock(import('@/lib/helpers'), async (importOriginal) => ({
  ...(await importOriginal()),
  resolveAvatarUrl: vi.fn((url: string | undefined) => url || '/default-avatar.png'),
  resolveAssetUrl: vi.fn((url: string | undefined) => url || ''),
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

import { FriendsWidget } from '../FriendsWidget';

const sampleFriends = [
  { id: 5, name: 'Dave Green', avatar_url: '/dave.png', is_online: true },
  { id: 6, name: 'Eve Blue', avatar_url: undefined, is_recent: true, location: 'Cork' },
];

describe('FriendsWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing with friends data', () => {
    const { container } = render(<FriendsWidget friends={sampleFriends} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders nothing when friends array is empty', () => {
    render(<FriendsWidget friends={[]} />);
    expect(screen.queryByText('Friends')).not.toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders the Friends heading when friends exist', () => {
    render(<FriendsWidget friends={sampleFriends} />);
    expect(screen.getByText('Friends')).toBeInTheDocument();
  });

  it('displays all friend names', () => {
    render(<FriendsWidget friends={sampleFriends} />);
    expect(screen.getByText('Dave Green')).toBeInTheDocument();
    expect(screen.getByText('Eve Blue')).toBeInTheDocument();
  });

  it('shows online indicator for online friends', () => {
    render(<FriendsWidget friends={sampleFriends} />);
    expect(screen.getByLabelText('Online now')).toBeInTheDocument();
  });

  it('shows recently active indicator for recent friends', () => {
    render(<FriendsWidget friends={sampleFriends} />);
    expect(screen.getByLabelText('Active today')).toBeInTheDocument();
  });

  it('displays location when provided', () => {
    render(<FriendsWidget friends={sampleFriends} />);
    expect(screen.getByText('Cork')).toBeInTheDocument();
  });

  it('does not display location when not provided', () => {
    const friendsNoLocation = [{ id: 5, name: 'Dave Green', avatar_url: '/dave.png', is_online: false }];
    render(<FriendsWidget friends={friendsNoLocation} />);
    expect(screen.queryByText('Cork')).not.toBeInTheDocument();
  });

  it('links to friend profile pages', () => {
    render(<FriendsWidget friends={sampleFriends} />);
    const links = screen.getAllByRole('link');
    const hrefs = links.map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/test/profile/5');
    expect(hrefs).toContain('/test/profile/6');
  });

  it('renders See All link pointing to /connections', () => {
    render(<FriendsWidget friends={sampleFriends} />);
    const seeAll = screen.getByText("See all");
    expect(seeAll.closest('a')).toHaveAttribute('href', '/test/connections');
  });

  it('does not show status indicator for offline non-recent friends', () => {
    const offlineFriends = [{ id: 10, name: 'Offline User', is_online: false, is_recent: false }];
    render(<FriendsWidget friends={offlineFriends} />);
    expect(screen.queryByLabelText('Online')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Recently active')).not.toBeInTheDocument();
  });

  it('renders one link per friend plus the See All link', () => {
    render(<FriendsWidget friends={sampleFriends} />);
    const links = screen.getAllByRole('link');
    // 2 friend links + 1 See All link
    expect(links.length).toBe(3);
  });
});
