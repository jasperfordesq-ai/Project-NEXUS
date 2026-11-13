// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for PopularGroupsWidget
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
  resolveThumbnailUrl: vi.fn((url: string | undefined) => url || ''),
}));

vi.mock('@/lib/logger', () => ({
  logError: vi.fn(),
}));

import { PopularGroupsWidget } from '../PopularGroupsWidget';

const sampleGroups = [
  { id: 1, name: 'Gardeners', image_url: undefined, member_count: 42 },
  { id: 2, name: 'Tech Skills', image_url: '/tech.jpg', member_count: 18 },
];

describe('PopularGroupsWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing with group data', () => {
    const { container } = render(<PopularGroupsWidget groups={sampleGroups} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders nothing when groups array is empty', () => {
    render(<PopularGroupsWidget groups={[]} />);
    expect(screen.queryByText("Popular groups")).not.toBeInTheDocument();
    expect(screen.queryByText("See all")).not.toBeInTheDocument();
  });

  it('renders the Popular Groups heading when groups exist', () => {
    render(<PopularGroupsWidget groups={sampleGroups} />);
    expect(screen.getByText("Popular groups")).toBeInTheDocument();
  });

  it('displays all group names', () => {
    render(<PopularGroupsWidget groups={sampleGroups} />);
    expect(screen.getByText('Gardeners')).toBeInTheDocument();
    expect(screen.getByText('Tech Skills')).toBeInTheDocument();
  });

  it('shows member counts', () => {
    render(<PopularGroupsWidget groups={sampleGroups} />);
    expect(screen.getByText(/42 members/i)).toBeInTheDocument();
    expect(screen.getByText(/18 members/i)).toBeInTheDocument();
  });

  it('renders group image when image_url is provided', () => {
    render(<PopularGroupsWidget groups={sampleGroups} />);
    const img = screen.getByRole('img', { name: 'Tech Skills' });
    expect(img).toBeInTheDocument();
  });

  it('does not render img element when image_url is not provided', () => {
    const groupsNoImage = [{ id: 1, name: 'Gardeners', image_url: undefined, member_count: 42 }];
    render(<PopularGroupsWidget groups={groupsNoImage} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('links to individual group pages', () => {
    render(<PopularGroupsWidget groups={sampleGroups} />);
    const links = screen.getAllByRole('link');
    const hrefs = links.map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/test/groups/1');
    expect(hrefs).toContain('/test/groups/2');
  });

  it('renders See All link pointing to /groups', () => {
    render(<PopularGroupsWidget groups={sampleGroups} />);
    const seeAll = screen.getByText("See all");
    expect(seeAll.closest('a')).toHaveAttribute('href', '/test/groups');
  });

  it('renders one link per group plus the See All link', () => {
    render(<PopularGroupsWidget groups={sampleGroups} />);
    const links = screen.getAllByRole('link');
    // 2 group links + 1 See All link
    expect(links.length).toBe(3);
  });

  it('handles single group correctly', () => {
    const singleGroup = [{ id: 3, name: 'Music Lovers', image_url: '/music.jpg', member_count: 7 }];
    render(<PopularGroupsWidget groups={singleGroup} />);
    expect(screen.getByText('Music Lovers')).toBeInTheDocument();
    expect(screen.getByText(/7 members/i)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Music Lovers' })).toBeInTheDocument();
  });
});
