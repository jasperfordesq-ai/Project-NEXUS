// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@/test/test-utils';
import { cleanup } from '@testing-library/react';
import { createMockContexts } from '@/test/mock-contexts';
import React from 'react';
import userEvent from '@testing-library/user-event';

// ─── API mock ────────────────────────────────────────────────────────────────
const { mockApi } = vi.hoisted(() => ({
  mockApi: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    download: vi.fn(),
    upload: vi.fn(),
  },
}));
vi.mock('@/lib/api', () => ({ api: mockApi, default: mockApi }));
vi.mock('@/lib/logger', () => ({ logError: vi.fn() }));
vi.mock('@/lib/safeStorage', () => ({
  safeLocalStorageGet: vi.fn(() => null),
  safeLocalStorageSetJSON: vi.fn(),
}));

// ─── Auth / Tenant ───────────────────────────────────────────────────────────
const mockHasFeature = vi.fn(() => true);
const mockHasModule = vi.fn(() => true);

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: { id: 1, name: 'Admin User', role: 'admin' },
      isAuthenticated: true,
      login: vi.fn(),
      logout: vi.fn(),
      register: vi.fn(),
      updateUser: vi.fn(),
      refreshUser: vi.fn(),
      status: 'idle' as const,
      error: null,
    }),
    useTenant: () => ({
      tenant: { id: 2, name: 'Test Tenant', slug: 'test' },
      tenantPath: (p: string) => `/test${p}`,
      hasFeature: mockHasFeature,
      hasModule: mockHasModule,
    }),
  })
);

// ─── react-router-dom ───────────────────────────────────────────────────────
vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useLocation: () => ({ pathname: '/test/admin', search: '', hash: '' }),
    Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode; [key: string]: unknown }) => (
      <a href={to} {...(rest as object)}>{children}</a>
    ),
  };
});

// NOTE: there is deliberately no vi.mock('@/components/ui') here. AdminSidebar
// imports ScrollShadow / Accordion / AccordionItem / Button / Input / Tooltip by
// direct path (@/components/ui/Accordion, …), so a keyed barrel mock never
// applies — the real HeroUI components render. That means a collapsed
// Accordion.Panel is present in the DOM but aria-hidden, so its links are
// invisible to role queries until the section's trigger is pressed.

// ─────────────────────────────────────────────────────────────────────────────
describe('AdminSidebar', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.resetAllMocks();
    mockHasFeature.mockReturnValue(true);
    mockHasModule.mockReturnValue(true);
    // Safeguarding call
    mockApi.get.mockResolvedValue({
      success: true,
      data: { unreviewed_flags: 0 },
    });
    // jsdom does not implement scrollIntoView — stub to prevent unhandled errors
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('renders without crashing', async () => {
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar />);
    expect(screen.getByRole('navigation', { name: /admin navigation/i })).toBeInTheDocument();
  });

  it('shows an Admin heading link when not collapsed', async () => {
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={false} />);
    // Exact name: /admin/i also matches "Super Admin Panel" on super-admin tenants,
    // so it would not prove the sidebar's own Admin heading link rendered.
    const adminLink = screen.getByRole('link', { name: 'Admin' });
    expect(adminLink).toHaveAttribute('href', '/test/admin');
  });

  it('renders collapse/expand toggle button', async () => {
    const onToggle = vi.fn();
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={false} onToggle={onToggle} />);
    const toggleBtn = screen.getByRole('button', { name: /collapse sidebar/i });
    expect(toggleBtn).toBeInTheDocument();
  });

  it('calls onToggle when the sidebar toggle button is clicked', async () => {
    const onToggle = vi.fn();
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={false} onToggle={onToggle} />);
    const toggleBtn = screen.getByRole('button', { name: /collapse sidebar/i });
    await userEvent.click(toggleBtn);
    expect(onToggle).toHaveBeenCalled();
  });

  it('shows search input when not collapsed', async () => {
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={false} />);
    const searchInput = screen.getByRole('searchbox');
    expect(searchInput).toBeInTheDocument();
  });

  it('does not show search input when collapsed', async () => {
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={true} />);
    const searchInput = screen.queryByRole('searchbox');
    expect(searchInput).not.toBeInTheDocument();
  });

  it('renders core navigation sections (users, dashboard)', async () => {
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={false} />);
    // Dashboard is an href-only section, so it is a top-level link …
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/test/admin');
    // … while Users is an accordion section, so it is a collapsed trigger button.
    expect(screen.getByRole('button', { name: 'Users' })).toBeInTheDocument();
  });

  it('renders Users section when not collapsed', async () => {
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={false} />);

    // The Users section is a real HeroUI Accordion: its trigger is a button and
    // its links only enter the accessibility tree once the panel is expanded.
    const usersTrigger = screen.getByRole('button', { name: 'Users' });
    expect(usersTrigger).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(usersTrigger);
    expect(usersTrigger).toHaveAttribute('aria-expanded', 'true');

    // Assert the specific user-management destinations, not merely "some /users link"
    expect(screen.getByRole('link', { name: 'All Users' })).toHaveAttribute('href', '/test/admin/users');
    expect(screen.getByRole('link', { name: 'Pending Approvals' })).toHaveAttribute(
      'href',
      '/test/admin/users?filter=pending',
    );
  });

  it('hides newsletter navigation when the newsletter module is disabled', async () => {
    mockHasFeature.mockImplementation((feature: string) => feature !== 'newsletter');
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={false} />);

    const nav = screen.getByRole('navigation', { name: /admin navigation/i });
    // hidden: true so links inside collapsed Accordion panels are included —
    // without it every nested link is aria-hidden and "no newsletter links"
    // would hold even when the newsletter nav is present.
    const allLinks = within(nav).getAllByRole('link', { hidden: true });

    expect(allLinks.filter((link) => link.getAttribute('href')?.includes('/admin/newsletters'))).toHaveLength(0);
    // Marketing exists only to host the newsletter items, so the section goes too
    expect(screen.queryByRole('button', { name: 'Marketing' })).not.toBeInTheDocument();
    // Control: the same query does reach links inside collapsed panels
    expect(allLinks.some((link) => link.getAttribute('href') === '/test/admin/settings')).toBe(true);
  });

  it('filters navigation results when search query is entered', async () => {
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={false} />);
    const searchInput = screen.getByRole('searchbox');
    await userEvent.type(searchInput, 'gdpr');

    await waitFor(() => {
      // Matching item is promoted into the flat (non-accordion) result list, where
      // each row is labelled "<item> <owning section>"
      expect(screen.getByRole('link', { name: 'GDPR Dashboard Enterprise' })).toHaveAttribute(
        'href',
        '/test/admin/enterprise/gdpr',
      );
    });
    // Non-matching items are filtered out entirely, panels and all
    expect(screen.queryAllByRole('link', { hidden: true }).filter((l) =>
      l.getAttribute('href')?.includes('/admin/cron-jobs'),
    )).toHaveLength(0);
    // The zoned accordion tree is replaced by the result list while searching
    expect(screen.queryByRole('button', { name: 'Platform Operations' })).not.toBeInTheDocument();
  });

  it('shows expand label button when collapsed', async () => {
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={true} />);
    const expandBtn = screen.getByRole('button', { name: /expand sidebar/i });
    expect(expandBtn).toBeInTheDocument();
  });

  it('renders platform zone navigation links (enterprise) when features enabled', async () => {
    // beforeEach sets mockHasFeature.mockReturnValue(true) — all features are on.
    // Federation moved out of the platform zone to /partner-timebanks (2026-07-02).
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={false} />);

    // The platform zone header and both of its sections are rendered ungated.
    expect(screen.getByText('Platform')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Platform Operations' })).toBeInTheDocument();

    // Enterprise is a real Accordion — expand it through its own trigger before
    // its links exist in the accessibility tree.
    const enterpriseTrigger = screen.getByRole('button', { name: 'Enterprise' });
    await userEvent.click(enterpriseTrigger);
    expect(enterpriseTrigger).toHaveAttribute('aria-expanded', 'true');

    // Assert the specific enterprise destinations so a wrong-href regression fails
    expect(screen.getByRole('link', { name: 'Enterprise Dashboard' })).toHaveAttribute(
      'href',
      '/test/admin/enterprise',
    );
    expect(screen.getByRole('link', { name: 'Roles & Permissions' })).toHaveAttribute(
      'href',
      '/test/admin/enterprise/roles',
    );
    expect(screen.getByRole('link', { name: 'GDPR Dashboard' })).toHaveAttribute(
      'href',
      '/test/admin/enterprise/gdpr',
    );
  });

  it('hides super admin section for non-super-admin users', async () => {
    // The file-level @/contexts mock already supplies a plain `admin` user, which
    // is exactly the subject of this test. A second vi.mock('@/contexts', …) used
    // to be declared here: vi.mock is hoisted file-wide and the last registration
    // wins, so it silently replaced the tenant/auth state for EVERY test in this
    // file (forcing hasFeature() to false and stranding mockHasFeature). Removed.
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={false} />);

    // Control: the sidebar really did render its overview zone …
    expect(screen.getByRole('link', { name: 'Dashboard' })).toHaveAttribute('href', '/test/admin');
    // … and no platform-super-admin surface is reachable, collapsed panels included.
    const allLinks = screen.getAllByRole('link', { hidden: true });
    expect(allLinks.filter((l) => l.getAttribute('href')?.includes('/super-admin'))).toHaveLength(0);
    expect(screen.queryByRole('link', { name: 'Super Admin Panel', hidden: true })).not.toBeInTheDocument();
    // Prerender Engine and Cron Settings are platform-super-admin only as well
    expect(allLinks.filter((l) => l.getAttribute('href')?.includes('/admin/seo/prerender'))).toHaveLength(0);
    expect(allLinks.filter((l) => l.getAttribute('href')?.includes('/admin/cron-jobs/settings'))).toHaveLength(0);
  });
});
