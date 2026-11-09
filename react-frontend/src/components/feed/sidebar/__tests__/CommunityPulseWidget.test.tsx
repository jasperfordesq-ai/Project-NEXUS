// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for CommunityPulseWidget
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

import { CommunityPulseWidget } from '../CommunityPulseWidget';

const defaultStats = { members: 120, listings: 45, events: 8, groups: 12 };

describe('CommunityPulseWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing', () => {
    const { container } = render(<CommunityPulseWidget stats={defaultStats} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders the Community Pulse heading', () => {
    render(<CommunityPulseWidget stats={defaultStats} />);
    expect(screen.getByText('Community Pulse')).toBeInTheDocument();
  });

  it('displays all four stat counts', () => {
    render(<CommunityPulseWidget stats={defaultStats} />);
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(screen.getByText('45')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('renders stat labels (Members, Listings, Events, Groups)', () => {
    render(<CommunityPulseWidget stats={defaultStats} />);
    expect(screen.getByText('Members')).toBeInTheDocument();
    expect(screen.getByText('Offers and requests')).toBeInTheDocument();
    expect(screen.getByText('Events')).toBeInTheDocument();
    expect(screen.getByText('Groups')).toBeInTheDocument();
  });

  it('renders links to members, listings, events, groups', () => {
    render(<CommunityPulseWidget stats={defaultStats} />);
    const links = screen.getAllByRole('link');
    const hrefs = links.map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/test/members');
    expect(hrefs).toContain('/test/listings');
    expect(hrefs).toContain('/test/events');
    expect(hrefs).toContain('/test/groups');
  });

  it('formats large numbers with locale separators', () => {
    render(<CommunityPulseWidget stats={{ members: 1000, listings: 500, events: 50, groups: 20 }} />);
    expect(screen.getByText('1,000')).toBeInTheDocument();
  });

  it('handles zero values gracefully', () => {
    render(<CommunityPulseWidget stats={{ members: 0, listings: 0, events: 0, groups: 0 }} />);
    const zeros = screen.getAllByText('0');
    expect(zeros.length).toBe(4);
  });

  it('renders exactly 4 links (one per stat item)', () => {
    render(<CommunityPulseWidget stats={defaultStats} />);
    const links = screen.getAllByRole('link');
    expect(links.length).toBe(4);
  });
});
