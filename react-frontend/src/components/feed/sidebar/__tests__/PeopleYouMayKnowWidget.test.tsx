// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for PeopleYouMayKnowWidget
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

import { PeopleYouMayKnowWidget } from '../PeopleYouMayKnowWidget';

const sampleMembers = [
  { id: 7, name: 'Frank Red', avatar_url: '/frank.png', location: 'Galway', is_online: true },
  { id: 8, name: 'Grace White', avatar_url: undefined, is_online: false },
];

describe('PeopleYouMayKnowWidget', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders without crashing with member data', () => {
    const { container } = render(<PeopleYouMayKnowWidget members={sampleMembers} />);
    expect(container.firstChild).toBeTruthy();
  });

  it('renders nothing when members array is empty', () => {
    render(<PeopleYouMayKnowWidget members={[]} />);
    expect(screen.queryByText("People you may know")).not.toBeInTheDocument();
    expect(screen.queryByText("See all")).not.toBeInTheDocument();
  });

  it('renders People You May Know heading when members exist', () => {
    render(<PeopleYouMayKnowWidget members={sampleMembers} />);
    expect(screen.getByText("People you may know")).toBeInTheDocument();
  });

  it('displays all member names', () => {
    render(<PeopleYouMayKnowWidget members={sampleMembers} />);
    expect(screen.getByText('Frank Red')).toBeInTheDocument();
    expect(screen.getByText('Grace White')).toBeInTheDocument();
  });

  it('shows location when provided', () => {
    render(<PeopleYouMayKnowWidget members={sampleMembers} />);
    expect(screen.getByText('Galway')).toBeInTheDocument();
  });

  it('does not show location when not provided', () => {
    const membersNoLocation = [{ id: 8, name: 'Grace White', is_online: false }];
    render(<PeopleYouMayKnowWidget members={membersNoLocation} />);
    expect(screen.queryByText('Galway')).not.toBeInTheDocument();
  });

  it('renders online indicator for online members', () => {
    render(<PeopleYouMayKnowWidget members={sampleMembers} />);
    expect(screen.getByLabelText('Online now')).toBeInTheDocument();
  });

  it('does not show online indicator for offline members', () => {
    const offlineMembers = [{ id: 8, name: 'Grace White', is_online: false }];
    render(<PeopleYouMayKnowWidget members={offlineMembers} />);
    expect(screen.queryByLabelText('Online now')).not.toBeInTheDocument();
  });

  it('renders View buttons for each member', () => {
    render(<PeopleYouMayKnowWidget members={sampleMembers} />);
    const viewButtons = screen.getAllByText('View');
    expect(viewButtons).toHaveLength(sampleMembers.length);
  });

  it('See All link points to /members', () => {
    render(<PeopleYouMayKnowWidget members={sampleMembers} />);
    const seeAll = screen.getByText("See all");
    expect(seeAll.closest('a')).toHaveAttribute('href', '/test/members');
  });

  it('links to member profile pages', () => {
    render(<PeopleYouMayKnowWidget members={sampleMembers} />);
    const links = screen.getAllByRole('link');
    const hrefs = links.map((l) => l.getAttribute('href'));
    expect(hrefs).toContain('/test/profile/7');
    expect(hrefs).toContain('/test/profile/8');
  });

  it('handles single member correctly', () => {
    const singleMember = [{ id: 9, name: 'Solo Person', is_online: true, location: 'London' }];
    render(<PeopleYouMayKnowWidget members={singleMember} />);
    expect(screen.getByText('Solo Person')).toBeInTheDocument();
    expect(screen.getByText('London')).toBeInTheDocument();
    expect(screen.getAllByText('View')).toHaveLength(1);
  });
});
