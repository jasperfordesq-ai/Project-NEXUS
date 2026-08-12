// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tests for AdminSidebar — collapsible sidebar navigation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// ─── Stable mock references ─────────────────────────────────────────────────

const mockTenantPath = (p: string) => `/test${p}`;
const mockOnToggle = vi.fn();
const mockHasFeature = vi.fn((feature: string) => feature === 'caring_community');
const mockUser: Record<string, unknown> = {
  id: 1,
  name: 'Admin User',
  role: 'super_admin',
  is_super_admin: true,
};

vi.mock('@/contexts', () => ({
  useAuth: vi.fn(() => ({
    user: mockUser,
    isAuthenticated: true,
    logout: vi.fn(),
  })),
  useTenant: vi.fn(() => ({
    tenant: { id: 2, name: 'Test Community', slug: 'test', configuration: {} },
    tenantSlug: 'test',
    branding: { name: 'Test Community' },
    hasFeature: mockHasFeature,
    hasModule: vi.fn(() => true),
    tenantPath: mockTenantPath,
  })),
  useToast: vi.fn(() => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    showToast: vi.fn(),
  })),
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

vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));

vi.mock('../../api/adminApi', () => ({
  adminBroker: {
    getUnreviewedCount: vi.fn(() => Promise.resolve({ success: true, data: { count: 0 } })),
  },
}));

import { AdminSidebar } from '../AdminSidebar';

// ─── Wrapper ─────────────────────────────────────────────────────────────────

function W({ children, path = '/test/admin' }: { children: React.ReactNode; path?: string }) {
  return (
    <>
      <MemoryRouter initialEntries={[path]}>
        {children}
      </MemoryRouter>
    </>
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('AdminSidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(mockUser, {
      id: 1,
      name: 'Admin User',
      role: 'super_admin',
      is_super_admin: true,
      is_tenant_super_admin: undefined,
      is_god: undefined,
    });
    mockHasFeature.mockImplementation((feature: string) => feature === 'caring_community');
  });

  it('renders without crashing', () => {
    const { container } = render(
      <W><AdminSidebar collapsed={false} onToggle={mockOnToggle} /></W>
    );
    expect(container.querySelector('aside')).toBeTruthy();
  });

  it('renders the Admin link when not collapsed', () => {
    render(
      <W><AdminSidebar collapsed={false} onToggle={mockOnToggle} /></W>
    );
    expect(screen.getByText('Admin')).toBeTruthy();
  });

  it('does not render Admin text when collapsed', () => {
    render(
      <W><AdminSidebar collapsed={true} onToggle={mockOnToggle} /></W>
    );
    expect(screen.queryByText('Admin')).toBeNull();
  });

  it('renders the collapse sidebar button', () => {
    render(
      <W><AdminSidebar collapsed={false} onToggle={mockOnToggle} /></W>
    );
    expect(screen.getByLabelText('Collapse sidebar')).toBeTruthy();
  });

  it('renders expand sidebar button when collapsed', () => {
    render(
      <W><AdminSidebar collapsed={true} onToggle={mockOnToggle} /></W>
    );
    expect(screen.getByLabelText('Expand sidebar')).toBeTruthy();
  });

  it('calls onToggle when toggle button is clicked', () => {
    render(
      <W><AdminSidebar collapsed={false} onToggle={mockOnToggle} /></W>
    );
    fireEvent.click(screen.getByLabelText('Collapse sidebar'));
    expect(mockOnToggle).toHaveBeenCalledTimes(1);
  });

  it('renders nav element for navigation', () => {
    const { container } = render(
      <W><AdminSidebar collapsed={false} onToggle={mockOnToggle} /></W>
    );
    expect(
      container.querySelector('nav') ?? container.querySelector('[role="navigation"]')
    ).toBeTruthy();
  });

  it('renders Dashboard section link', () => {
    render(
      <W><AdminSidebar collapsed={false} onToggle={mockOnToggle} /></W>
    );
    // Dashboard is translated via admin_nav namespace -> "Dashboard"
    expect(screen.getByText('Dashboard')).toBeTruthy();
  });

  it('replaces the federation/integrations sections with a single super-admin Partner Timebanks entry', () => {
    mockHasFeature.mockImplementation((feature: string) =>
      feature === 'federation' || feature === 'partner_api',
    );

    render(
      <W><AdminSidebar collapsed={false} onToggle={mockOnToggle} /></W>
    );

    // The old 15-link sections are gone (retired 2026-07-02) …
    expect(screen.queryByText('Partner APIs & integrations')).toBeNull();
    expect(screen.queryByText('Federation Settings')).toBeNull();
    expect(screen.queryByText('Inbound API Partners')).toBeNull();

    // …replaced by one pinned entry into the dedicated panel.
    expect(screen.getByRole('link', { name: 'Partner Timebanks' })).toHaveAttribute(
      'href',
      '/test/partner-timebanks',
    );
  });

  it('shows the Partner Timebanks entry to normal admins when federation is enabled', () => {
    // Every admin gets the read-mostly panel; the plumbing inside is
    // super-admin-only (owner decision 2026-07-02).
    mockHasFeature.mockImplementation((feature: string) => feature === 'federation');
    Object.assign(mockUser, { role: 'admin', is_super_admin: undefined });

    render(
      <W><AdminSidebar collapsed={false} onToggle={mockOnToggle} /></W>
    );

    expect(screen.getByRole('link', { name: 'Partner Timebanks' })).toHaveAttribute(
      'href',
      '/test/partner-timebanks',
    );
  });

  it('hides the entry from normal admins when only super-admin-only surfaces exist', () => {
    // caring_community / partner_api content inside the panel is all
    // super-admin-only, so without federation the panel would be empty
    // for an ordinary admin.
    mockHasFeature.mockImplementation((feature: string) =>
      feature === 'caring_community' || feature === 'partner_api',
    );
    Object.assign(mockUser, { role: 'admin', is_super_admin: undefined });

    render(
      <W><AdminSidebar collapsed={false} onToggle={mockOnToggle} /></W>
    );

    expect(screen.queryByRole('link', { name: 'Partner Timebanks' })).toBeNull();
  });

  it('hides the Partner Timebanks entry when no partnering feature is enabled', () => {
    mockHasFeature.mockImplementation(() => false);

    render(
      <W><AdminSidebar collapsed={false} onToggle={mockOnToggle} /></W>
    );

    expect(screen.queryByRole('link', { name: 'Partner Timebanks' })).toBeNull();
  });

  it('keeps Broker Panel visible as a pinned admin link', () => {
    render(
      <W><AdminSidebar collapsed={false} onToggle={mockOnToggle} /></W>
    );
    expect(screen.getByText('Broker Panel')).toBeTruthy();
  });

  it('shows one Super Admin Panel link instead of the full super-admin navigation tree', () => {
    render(
      <W><AdminSidebar collapsed={false} onToggle={mockOnToggle} /></W>
    );

    const superAdminLinks = screen.getAllByRole('link', { name: 'Super Admin Panel' });
    expect(superAdminLinks).toHaveLength(1);
    expect(superAdminLinks[0]).toHaveAttribute('href', '/test/super-admin');
    expect(screen.queryByText('Super Dashboard')).not.toBeInTheDocument();
  });

  it('keeps Super Admin Panel under Overview after Broker Panel', () => {
    const { container } = render(
      <W><AdminSidebar collapsed={false} onToggle={mockOnToggle} /></W>
    );

    const overview = Array.from(container.querySelectorAll('li')).find((item) =>
      item.textContent?.includes('Overview') &&
      item.textContent.includes('Dashboard') &&
      item.textContent.includes('Broker Panel') &&
      item.textContent.includes('Super Admin Panel'),
    );
    const overviewText = overview?.textContent ?? '';

    expect(overview).toBeTruthy();
    expect(overviewText.indexOf('Dashboard')).toBeLessThan(overviewText.indexOf('Broker Panel'));
    expect(overviewText.indexOf('Broker Panel')).toBeLessThan(overviewText.indexOf('Super Admin Panel'));
  });

  it('pins exactly the Caring Community and documentation links in the footer', () => {
    const { container } = render(
      <W><AdminSidebar collapsed={false} onToggle={mockOnToggle} /></W>
    );

    const caringLinks = screen.getAllByRole('link', { name: /Caring Community/i });
    expect(caringLinks).toHaveLength(1);

    const footer = container.querySelector('aside > div:last-child');
    const footerLinks = Array.from(footer?.querySelectorAll('a') ?? []);
    // Exactly two, still: this footer is pinned and always visible, so the count
    // is asserted deliberately to stop it accumulating entries.
    expect(footerLinks).toHaveLength(2);

    expect(footerLinks[0]).toHaveTextContent('Caring Community');
    expect(footerLinks[0]).toHaveTextContent('Alpha');
    expect(footerLinks[0]).toHaveAttribute('href', '/test/caring');
    expect(footerLinks[0].className).toContain('border-warning/30');
    expect(footerLinks[0].className).toContain('bg-warning/10');

    // Documentation is external, so a plain anchor opening in a new tab — not a
    // router link, which would route an absolute URL to a dead admin path.
    expect(footerLinks[1]).toHaveTextContent('Documentation');
    expect(footerLinks[1]).toHaveAttribute('href', 'https://docs.project-nexus.ie/');
    expect(footerLinks[1]).toHaveAttribute('target', '_blank');
    expect(footerLinks[1]).toHaveAttribute('rel', 'noopener noreferrer');

    expect(footer?.textContent).not.toContain('Help Centre');
  });

  it('shows the Super Admin Panel overview link for god users', () => {
    Object.assign(mockUser, {
      role: 'admin',
      is_super_admin: false,
      is_tenant_super_admin: false,
      is_god: true,
    });

    render(
      <W><AdminSidebar collapsed={false} onToggle={mockOnToggle} /></W>
    );

    expect(screen.getByRole('link', { name: 'Super Admin Panel' })).toHaveAttribute('href', '/test/super-admin');
  });

  it('hides the platform Super Admin Panel from tenant-scoped super admins', () => {
    Object.assign(mockUser, {
      role: 'admin',
      is_super_admin: false,
      is_tenant_super_admin: true,
      is_god: false,
    });

    render(
      <W><AdminSidebar collapsed={false} onToggle={mockOnToggle} /></W>
    );

    expect(screen.queryByRole('link', { name: 'Super Admin Panel' })).not.toBeInTheDocument();
  });

  it('hides god-only Plans & Billing but shows Donations & Support to non-god super admins', () => {
    // Donations & Support (member_premium) is a tenant-level feature — its route
    // is only feature-gated, so a non-god super admin who has the feature must
    // also see the sidebar links. Plans & Pricing / Billing stay god-only.
    // Regression guard: an isGod gate on this block once hid the link entirely.
    mockHasFeature.mockImplementation((feature: string) =>
      feature === 'caring_community' || feature === 'member_premium',
    );

    render(
      <W><AdminSidebar collapsed={false} onToggle={mockOnToggle} /></W>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Financial' }));

    expect(screen.queryByRole('link', { name: 'Plans & Pricing' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Billing' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Donations & Support' })).toHaveAttribute('href', '/test/admin/member-premium');
    expect(screen.getByRole('link', { name: 'Recurring Supporters' })).toHaveAttribute('href', '/test/admin/member-premium/subscribers');
  });

  it('shows commercial financial links to god users', () => {
    Object.assign(mockUser, {
      role: 'admin',
      is_super_admin: false,
      is_tenant_super_admin: false,
      is_god: true,
    });
    mockHasFeature.mockImplementation((feature: string) =>
      feature === 'caring_community' || feature === 'member_premium',
    );

    render(
      <W><AdminSidebar collapsed={false} onToggle={mockOnToggle} /></W>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Financial' }));

    expect(screen.getByRole('link', { name: 'Plans & Pricing' })).toHaveAttribute('href', '/test/admin/plans');
    expect(screen.getByRole('link', { name: 'Billing' })).toHaveAttribute('href', '/test/admin/billing');
    expect(screen.getByRole('link', { name: 'Donations & Support' })).toHaveAttribute('href', '/test/admin/member-premium');
    expect(screen.getByRole('link', { name: 'Recurring Supporters' })).toHaveAttribute('href', '/test/admin/member-premium/subscribers');
  });

  it('hides diagnostic debug links from non-god super admins', () => {
    render(
      <W><AdminSidebar collapsed={false} onToggle={mockOnToggle} /></W>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Intelligence & Diagnostics' }));

    expect(screen.getByRole('link', { name: 'Algorithm Settings' })).toHaveAttribute('href', '/test/admin/algorithm-settings');
    expect(screen.queryByRole('link', { name: 'Diagnostics' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Match Debug Panel' })).not.toBeInTheDocument();
  });

  it('shows diagnostic debug links to god users', () => {
    Object.assign(mockUser, {
      role: 'admin',
      is_super_admin: false,
      is_tenant_super_admin: false,
      is_god: true,
    });

    render(
      <W><AdminSidebar collapsed={false} onToggle={mockOnToggle} /></W>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Intelligence & Diagnostics' }));

    expect(screen.getByRole('link', { name: 'Diagnostics' })).toHaveAttribute('href', '/test/admin/matching-diagnostic');
    expect(screen.getByRole('link', { name: 'Match Debug Panel' })).toHaveAttribute('href', '/test/admin/match-debug');
  });

  it('hides the menus content link from non-god super admins', () => {
    render(
      <W><AdminSidebar collapsed={false} onToggle={mockOnToggle} /></W>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Content' }));

    expect(screen.getByRole('link', { name: 'Pages' })).toHaveAttribute('href', '/test/admin/pages');
    expect(screen.queryByRole('link', { name: 'Menus' })).not.toBeInTheDocument();
  });

  it('shows the menus content link to god users', () => {
    Object.assign(mockUser, {
      role: 'admin',
      is_super_admin: false,
      is_tenant_super_admin: false,
      is_god: true,
    });

    render(
      <W><AdminSidebar collapsed={false} onToggle={mockOnToggle} /></W>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Content' }));

    expect(screen.getByRole('link', { name: 'Menus' })).toHaveAttribute('href', '/test/admin/menus');
  });

  it('shows the Module Configuration link to super admins', () => {
    render(
      <W><AdminSidebar collapsed={false} onToggle={mockOnToggle} /></W>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Platform Operations' }));

    expect(screen.getByRole('link', { name: 'Module Configuration' })).toHaveAttribute('href', '/test/admin/module-configuration');
  });

  it('hides the Module Configuration link from non-super admins', () => {
    Object.assign(mockUser, {
      role: 'admin',
      is_super_admin: false,
      is_tenant_super_admin: false,
      is_god: false,
    });

    render(
      <W><AdminSidebar collapsed={false} onToggle={mockOnToggle} /></W>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Platform Operations' }));

    expect(screen.getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/test/admin/settings');
    expect(screen.queryByRole('link', { name: 'Module Configuration' })).not.toBeInTheDocument();
  });

  it('applies w-16 class when collapsed', () => {
    const { container } = render(
      <W><AdminSidebar collapsed={true} onToggle={mockOnToggle} /></W>
    );
    const aside = container.querySelector('aside');
    expect(aside?.className).toContain('w-16');
  });

  it('applies w-64 class when not collapsed', () => {
    const { container } = render(
      <W><AdminSidebar collapsed={false} onToggle={mockOnToggle} /></W>
    );
    const aside = container.querySelector('aside');
    expect(aside?.className).toContain('w-64');
  });

  it('renders section labels when not collapsed', () => {
    render(
      <W><AdminSidebar collapsed={false} onToggle={mockOnToggle} /></W>
    );
    // Section labels translated via admin_nav namespace
    expect(screen.getByText('Users')).toBeTruthy();
    expect(screen.getByText('Content')).toBeTruthy();
    expect(screen.getByText('Platform Operations')).toBeTruthy();
  });
});
