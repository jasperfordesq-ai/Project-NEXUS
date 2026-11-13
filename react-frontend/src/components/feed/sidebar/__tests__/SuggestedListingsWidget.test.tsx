// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for SuggestedListingsWidget
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

import { SuggestedListingsWidget } from '../SuggestedListingsWidget';
import type { SuggestedListing } from '../SuggestedListingsWidget';

const sampleListings: SuggestedListing[] = [
  { id: 10, title: 'Gardening Help', type: 'offer', owner_name: 'Bob' },
  { id: 20, title: 'Piano Lessons', type: 'request', owner_name: 'Carol' },
];

describe('SuggestedListingsWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing with listings', () => {
    const { container } = render(<SuggestedListingsWidget listings={sampleListings} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders nothing when listings array is empty', () => {
    render(<SuggestedListingsWidget listings={[]} />);
    expect(screen.queryByText("Suggested for you")).not.toBeInTheDocument();
  });

  it('renders the Suggested For You heading when listings exist', () => {
    render(<SuggestedListingsWidget listings={sampleListings} />);
    expect(screen.getByText("Suggested for you")).toBeInTheDocument();
  });

  it('displays listing titles', () => {
    render(<SuggestedListingsWidget listings={sampleListings} />);
    expect(screen.getByText('Gardening Help')).toBeInTheDocument();
    expect(screen.getByText('Piano Lessons')).toBeInTheDocument();
  });

  it('displays owner names', () => {
    render(<SuggestedListingsWidget listings={sampleListings} />);
    // The component renders "by {{name}}" — with react-i18next passthrough it shows the key or fallback
    expect(screen.getByText(/Bob/)).toBeInTheDocument();
    expect(screen.getByText(/Carol/)).toBeInTheDocument();
  });

  it('renders offer and request type chips', () => {
    render(<SuggestedListingsWidget listings={sampleListings} />);
    expect(screen.getByText('Offer')).toBeInTheDocument();
    expect(screen.getByText('Request')).toBeInTheDocument();
  });

  it('links to individual listing pages', () => {
    render(<SuggestedListingsWidget listings={sampleListings} />);
    const links = screen.getAllByRole('link');
    const hrefs = links.map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/test/listings/10');
    expect(hrefs).toContain('/test/listings/20');
  });

  it('renders See All link pointing to /listings', () => {
    render(<SuggestedListingsWidget listings={sampleListings} />);
    const seeAll = screen.getByText("See all");
    expect(seeAll.closest('a')).toHaveAttribute('href', '/test/listings');
  });

  it('renders correct number of listing items', () => {
    const threeListings: SuggestedListing[] = [
      { id: 1, title: 'A', type: 'offer', owner_name: 'X' },
      { id: 2, title: 'B', type: 'request', owner_name: 'Y' },
      { id: 3, title: 'C', type: 'offer', owner_name: 'Z' },
    ];
    render(<SuggestedListingsWidget listings={threeListings} />);
    // 3 listing links + 1 "See all" link = 4 total
    const links = screen.getAllByRole('link');
    expect(links.length).toBe(4);
  });
});
