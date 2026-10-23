// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for TopCategoriesWidget
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@/test/test-utils';

// Stable mock references to prevent infinite render loops
const mockTenantPath = (p: string) => `/test${p}`;

const mockUseTenant = {
  tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
  tenantPath: mockTenantPath,
  hasFeature: vi.fn(() => true),
  hasModule: vi.fn(() => true),
};

const mockUseAuth = {
  isAuthenticated: true,
  user: { id: 1, first_name: 'Alice', last_name: 'Smith', username: 'asmith', avatar: '/alice.png' },
};

const mockUseToast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };

vi.mock('@/lib/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/contexts', () => ({
  useTenant: vi.fn(() => mockUseTenant),
  useAuth: vi.fn(() => mockUseAuth),
  useToast: vi.fn(() => mockUseToast),
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

import { TopCategoriesWidget } from '../TopCategoriesWidget';
import type { Category } from '../TopCategoriesWidget';

const sampleCategories: Category[] = [
  { id: 1, name: 'Gardening', slug: 'gardening', count: 30 },
  { id: 2, name: 'Tech', slug: 'tech', count: 15 },
  { id: 3, name: 'Music', slug: 'music', count: 8 },
];

describe('TopCategoriesWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing with categories', () => {
    const { container } = render(<TopCategoriesWidget categories={sampleCategories} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders nothing when categories array is empty', () => {
    render(<TopCategoriesWidget categories={[]} />);
    expect(screen.queryByText('Top Categories')).not.toBeInTheDocument();
  });

  it('renders the Top Categories heading when categories exist', () => {
    render(<TopCategoriesWidget categories={sampleCategories} />);
    expect(screen.getByText('Top Categories')).toBeInTheDocument();
  });

  it('displays all category names', () => {
    render(<TopCategoriesWidget categories={sampleCategories} />);
    expect(screen.getByText(/Gardening/)).toBeInTheDocument();
    expect(screen.getByText(/Tech/)).toBeInTheDocument();
    expect(screen.getByText(/Music/)).toBeInTheDocument();
  });

  it('displays category counts in parentheses', () => {
    render(<TopCategoriesWidget categories={sampleCategories} />);
    expect(screen.getByText(/\(30\)/)).toBeInTheDocument();
    expect(screen.getByText(/\(15\)/)).toBeInTheDocument();
    expect(screen.getByText(/\(8\)/)).toBeInTheDocument();
  });

  it('renders category links with correct href including category query param', () => {
    render(<TopCategoriesWidget categories={sampleCategories} />);
    const links = screen.getAllByRole('link');
    const hrefs = links.map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/test/listings?category=gardening');
    expect(hrefs).toContain('/test/listings?category=tech');
    expect(hrefs).toContain('/test/listings?category=music');
  });

  it('renders All Listings link pointing to /listings', () => {
    render(<TopCategoriesWidget categories={sampleCategories} />);
    const allListings = screen.getByText('All Listings');
    expect(allListings.closest('a')).toHaveAttribute('href', '/test/listings');
  });

  it('renders correct number of links (categories + All Listings)', () => {
    render(<TopCategoriesWidget categories={sampleCategories} />);
    const links = screen.getAllByRole('link');
    // 3 category links + 1 "All Listings" link = 4 total
    expect(links.length).toBe(4);
  });

  it('handles a single category', () => {
    render(<TopCategoriesWidget categories={[{ id: 99, name: 'Cooking', slug: 'cooking', count: 5 }]} />);
    expect(screen.getByText('Top Categories')).toBeInTheDocument();
    expect(screen.getByText(/Cooking/)).toBeInTheDocument();
    expect(screen.getByText(/\(5\)/)).toBeInTheDocument();
  });
});
