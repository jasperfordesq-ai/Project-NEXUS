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
import type { User } from '@/types/api';

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
// Declared WITH the feature/module parameter: tests that narrow a single flag
// use mockImplementation((feature) => feature !== 'x'), and a bare `() => true`
// signature makes every one of those a TS2345 argument-type error.
const mockHasFeature = vi.fn((_feature: string) => true);
const mockHasModule = vi.fn((_module: string) => true);
// Swappable per test (e.g. to a god user); reset to a plain admin in beforeEach.
const ADMIN_USER = { id: 1, name: 'Admin User', role: 'admin' } as User;
const authState = vi.hoisted(() => ({ user: null as User | null }));

vi.mock('@/contexts', () =>
  createMockContexts({
    useAuth: () => ({
      user: authState.user,
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
    authState.user = { ...ADMIN_USER };
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

  it('pins a documentation link that opens in a new tab, expanded and collapsed', async () => {
    const { AdminSidebar } = await import('./AdminSidebar');
    const { PROJECT_NEXUS_DOCS_URL } = await import('@/config/externalLinks');

    const { rerender } = render(<AdminSidebar collapsed={false} />);
    const link = screen.getByRole('link', { name: /platform documentation/i });
    // Plain anchor, not a router Link: every other sidebar entry is an internal
    // route, and routing to an absolute URL would produce a dead admin path.
    expect(link).toHaveAttribute('href', PROJECT_NEXUS_DOCS_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');

    // Collapsed, the label is hidden but the link must still be reachable.
    rerender(<AdminSidebar collapsed />);
    expect(screen.getByRole('link', { name: /platform documentation/i })).toHaveAttribute('href', PROJECT_NEXUS_DOCS_URL);
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

  // Event Settings owns the "Who can create Events" policy. It used to be
  // reachable only via Module Configuration → Events → Configure, so a community
  // that had restricted event creation gave its admins no findable way back.
  it('links Event Settings when the events feature is on', async () => {
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={false} />);

    const nav = screen.getByRole('navigation', { name: /admin navigation/i });
    // hidden: true so links inside collapsed Accordion panels are included.
    expect(
      within(nav).getAllByRole('link', { hidden: true })
        .some((link) => link.getAttribute('href') === '/test/admin/events/settings'),
    ).toBe(true);
  });

  // The feature flag must be set BEFORE the first render: the section tree is
  // memoized on a stable hasFeature reference, so re-rendering with a changed
  // mock does not recompute it (an earlier version of this test passed
  // vacuously against the stale first-render DOM).
  it('hides Event Settings when the events feature is off', async () => {
    mockHasFeature.mockImplementation((feature: string) => feature !== 'events');
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={false} />);

    const nav = screen.getByRole('navigation', { name: /admin navigation/i });
    const allLinks = within(nav).getAllByRole('link', { hidden: true });

    expect(allLinks.filter((link) => link.getAttribute('href')?.includes('/admin/events'))).toHaveLength(0);
    // Control: the same query does reach links inside collapsed panels.
    expect(allLinks.some((link) => link.getAttribute('href') === '/test/admin/settings')).toBe(true);
  });

  it('surfaces Event Settings when searching for the creation policy', async () => {
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={false} />);
    // "who can create events" is a search keyword on the item, so an admin who
    // remembers the restriction but not the page name still finds it.
    await userEvent.type(screen.getByRole('searchbox'), 'who can create');

    await waitFor(() => {
      expect(
        screen.getAllByRole('link', { hidden: true })
          .some((link) => link.getAttribute('href') === '/test/admin/events/settings'),
      ).toBe(true);
    });
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
    expect(screen.getByRole('link', { name: 'GDPR Dashboard' })).toHaveAttribute(
      'href',
      '/test/admin/enterprise/gdpr',
    );
    // Roles & Permissions is god-only — a plain admin must not see it.
    expect(screen.queryByRole('link', { name: 'Roles & Permissions' })).not.toBeInTheDocument();
  });

  it('shows Roles & Permissions under Enterprise to god users only', async () => {
    authState.user = { id: 1, name: 'God User', role: 'admin', is_god: true } as User;
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={false} />);

    await userEvent.click(screen.getByRole('button', { name: 'Enterprise' }));
    expect(screen.getByRole('link', { name: 'Roles & Permissions' })).toHaveAttribute(
      'href',
      '/test/admin/enterprise/roles',
    );
  });

  it('hides Roles & Permissions from a platform super admin who is not god', async () => {
    authState.user = { id: 1, name: 'Super Admin', role: 'admin', is_super_admin: true } as User;
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={false} />);

    await userEvent.click(screen.getByRole('button', { name: 'Enterprise' }));
    expect(screen.getByRole('link', { name: 'GDPR Dashboard' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Roles & Permissions' })).not.toBeInTheDocument();
  });

  it('links Native App from Platform Operations', async () => {
    // Regression: the page existed at /admin/native-app from the legacy-admin
    // retirement onwards but was linked from nowhere, so the only way to reach
    // it was to type the URL. An admin reasonably concluded it did not exist.
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={false} />);

    const operationsTrigger = screen.getByRole('button', { name: 'Platform Operations' });
    await userEvent.click(operationsTrigger);
    expect(operationsTrigger).toHaveAttribute('aria-expanded', 'true');

    expect(screen.getByRole('link', { name: 'Native App' })).toHaveAttribute(
      'href',
      '/test/admin/native-app',
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

  // Cron jobs are god-only (owner decision 2026-10-02): all four links, for
  // everyone else — platform super admins included.
  const CRON_HREFS = [
    '/test/admin/cron-jobs',
    '/test/admin/cron-jobs/logs',
    '/test/admin/cron-jobs/setup',
    '/test/admin/cron-jobs/settings',
  ];

  it.each([
    ['a plain admin', { id: 1, name: 'Admin User', role: 'admin' }],
    ['a platform super admin who is not god', { id: 1, name: 'Super Admin', role: 'admin', is_super_admin: true }],
  ])('hides every cron job link from %s', async (_who, user) => {
    authState.user = user as User;
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={false} />);

    await userEvent.click(screen.getByRole('button', { name: 'Platform Operations' }));
    // Control: the section really opened.
    expect(screen.getByRole('link', { name: 'Native App' })).toBeInTheDocument();
    const hrefs = screen.getAllByRole('link', { hidden: true }).map((l) => l.getAttribute('href'));
    expect(hrefs.filter((h) => h?.includes('/admin/cron-jobs'))).toEqual([]);
  });

  // ─── Volunteering ──────────────────────────────────────────────────────────
  // Regression: Volunteering was a single link to its overview page. Its eleven
  // working pages — organisations, applications, hours, expenses and the rest —
  // had no sidebar entry and no search keywords, so an admin could reach them
  // only through shortcut cards at the bottom of the overview (2026-10-02).
  const VOLUNTEERING_LINKS: Array<[string, string]> = [
    ['Overview', '/test/admin/volunteering'],
    ['Applications', '/test/admin/volunteering/approvals'],
    ['Hours to verify', '/test/admin/volunteering/hours'],
    ['Shift swaps', '/test/admin/volunteering/swaps'],
    ['Expenses', '/test/admin/volunteering/expenses'],
    ['Community projects', '/test/admin/volunteering/projects'],
    ['Organisations', '/test/admin/volunteering/organizations'],
    ['Training', '/test/admin/volunteering/training'],
    ['Safeguarding & incidents', '/test/admin/volunteering/safeguarding'],
    ['Giving days', '/test/admin/volunteering/giving-days'],
    ['Donation Refunds', '/test/admin/volunteering/donations'],
    ['Settings', '/test/admin/volunteering/config'],
  ];

  it('gives Volunteering its own section linking every volunteering page', async () => {
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={false} />);

    const trigger = screen.getByRole('button', { name: 'Volunteering' });
    await userEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const panel = document.getElementById(trigger.getAttribute('aria-controls') ?? '');
    expect(panel).not.toBeNull();
    for (const [name, href] of VOLUNTEERING_LINKS) {
      expect(within(panel as HTMLElement).getByRole('link', { name })).toHaveAttribute('href', href);
    }
  });

  it('lists each volunteering page exactly once across the whole sidebar', async () => {
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={false} />);

    const hrefs = screen.getAllByRole('link', { hidden: true }).map((l) => l.getAttribute('href'));
    for (const [, href] of VOLUNTEERING_LINKS) {
      expect(hrefs.filter((h) => h === href)).toHaveLength(1);
    }
  });

  it.each([
    ['charity', '/test/admin/volunteering/organizations'],
    ['receipts', '/test/admin/volunteering/expenses'],
    ['timesheets', '/test/admin/volunteering/hours'],
    ['rota', '/test/admin/volunteering/swaps'],
  ])('finds a volunteering page when searching "%s"', async (query, href) => {
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={false} />);
    await userEvent.type(screen.getByRole('searchbox'), query);

    await waitFor(() => {
      expect(screen.getAllByRole('link').map((l) => l.getAttribute('href'))).toContain(href);
    });
  });

  it('hides every volunteering page when the volunteering feature is off', async () => {
    mockHasFeature.mockImplementation((feature: string) => feature !== 'volunteering');
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={false} />);

    const hrefs = screen.getAllByRole('link', { hidden: true }).map((l) => l.getAttribute('href'));
    expect(hrefs.filter((h) => h?.includes('/admin/volunteering'))).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Volunteering' })).not.toBeInTheDocument();
    // Control: the same query does reach links inside collapsed panels.
    expect(hrefs).toContain('/test/admin/settings');
  });

  it('shows how many organisations are waiting for approval', async () => {
    mockApi.get.mockImplementation((url: string) => Promise.resolve(
      url === '/v2/admin/badge-counts'
        ? { success: true, data: { pending_orgs: 3 } }
        : { success: true, data: {} },
    ));
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={false} />);

    // Surfaced in the "Needs attention" strip without opening the section.
    await waitFor(() => {
      const link = screen.getAllByRole('link').find(
        (l) => l.getAttribute('href') === '/test/admin/volunteering/organizations',
      );
      expect(link).toBeDefined();
      expect(link).toHaveTextContent('3');
    });
    expect(screen.getByText('Needs Attention')).toBeInTheDocument();
  });

  // ─── Pages that existed but were linked from nowhere ──────────────────────
  // Regression (2026-10-02): each of these is a working admin page that no
  // sidebar entry and no other admin page linked to, so it could only be
  // reached by typing its address.
  const PREVIOUSLY_UNLINKED = [
    '/test/admin/groups/approvals',
    '/test/admin/groups/moderation',
    '/test/admin/courses',
    '/test/admin/newsletters/segments',
    '/test/admin/marketplace/cases',
    '/test/admin/marketplace/coupons',
    '/test/admin/gamification/badge-config',
    '/test/admin/settings/registration-policy',
    '/test/admin/enterprise/fadp',
    '/test/admin/help',
  ];

  it('links every previously unreachable admin page', async () => {
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={false} />);

    const hrefs = screen.getAllByRole('link', { hidden: true }).map((l) => l.getAttribute('href'));
    for (const href of PREVIOUSLY_UNLINKED) {
      expect(hrefs).toContain(href);
    }
  });

  it.each([
    ['groups', ['/test/admin/groups/approvals', '/test/admin/groups/moderation']],
    ['courses', ['/test/admin/courses']],
    ['newsletter', ['/test/admin/newsletters/segments']],
    ['marketplace', ['/test/admin/marketplace/cases', '/test/admin/marketplace/coupons']],
    ['merchant_coupons', ['/test/admin/marketplace/coupons']],
    ['gamification', ['/test/admin/gamification/badge-config']],
    ['fadp_compliance', ['/test/admin/enterprise/fadp']],
  ])('hides the new links that depend on "%s" when it is off', async (off, gone) => {
    mockHasFeature.mockImplementation((feature: string) => feature !== off);
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={false} />);

    const hrefs = screen.getAllByRole('link', { hidden: true }).map((l) => l.getAttribute('href'));
    for (const href of gone) {
      expect(hrefs).not.toContain(href);
    }
    // Control: the same query does reach links inside collapsed panels.
    expect(hrefs).toContain('/test/admin/settings');
  });

  it('shows the permissions list and subscriptions to god accounts only', async () => {
    const GOD_ONLY = ['/test/admin/enterprise/permissions', '/test/admin/plans/subscriptions'];
    const { AdminSidebar } = await import('./AdminSidebar');

    const { unmount } = render(<AdminSidebar collapsed={false} />);
    let hrefs = screen.getAllByRole('link', { hidden: true }).map((l) => l.getAttribute('href'));
    for (const href of GOD_ONLY) expect(hrefs).not.toContain(href);
    unmount();

    authState.user = { id: 1, name: 'God User', role: 'admin', is_god: true } as User;
    render(<AdminSidebar collapsed={false} />);
    hrefs = screen.getAllByRole('link', { hidden: true }).map((l) => l.getAttribute('href'));
    for (const href of GOD_ONLY) expect(hrefs).toContain(href);
  });

  // The whole Growth & Discovery section is god-only (owner decision
  // 2026-10-02), platform super admins included.
  const GROWTH_DISCOVERY_HREFS = [
    '/test/admin/seo',
    '/test/admin/seo/audit',
    '/test/admin/seo/redirects',
    '/test/admin/search-analytics',
    '/test/admin/seo/prerender',
    '/test/admin/404-errors',
  ];

  it.each([
    ['a plain admin', { id: 1, name: 'Admin User', role: 'admin' }],
    ['a platform super admin who is not god', { id: 1, name: 'Super Admin', role: 'admin', is_super_admin: true }],
  ])('hides the whole Growth & Discovery section from %s', async (_who, user) => {
    authState.user = user as User;
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={false} />);

    expect(screen.queryByRole('button', { name: 'Growth & Discovery' })).not.toBeInTheDocument();
    const hrefs = screen.getAllByRole('link', { hidden: true }).map((l) => l.getAttribute('href'));
    for (const href of GROWTH_DISCOVERY_HREFS) expect(hrefs).not.toContain(href);
    // Control: the same query does reach links inside collapsed panels.
    expect(hrefs).toContain('/test/admin/settings');
  });

  it('keeps Growth & Discovery pages out of sidebar search for non-god admins', async () => {
    const { AdminSidebar } = await import('./AdminSidebar');

    // Control: a god account searching the same word does find the page.
    authState.user = { id: 1, name: 'God User', role: 'admin', is_god: true } as User;
    const { unmount } = render(<AdminSidebar collapsed={false} />);
    await userEvent.type(screen.getByRole('searchbox'), 'redirects');
    await waitFor(() => {
      expect(screen.getAllByRole('link').map((l) => l.getAttribute('href'))).toContain('/test/admin/seo/redirects');
    });
    unmount();

    authState.user = { id: 1, name: 'Super Admin', role: 'admin', is_super_admin: true } as User;
    render(<AdminSidebar collapsed={false} />);
    await userEvent.type(screen.getByRole('searchbox'), 'redirects');
    await waitFor(() => {
      expect(screen.getByRole('searchbox')).toHaveValue('redirects');
    });
    expect(screen.queryAllByRole('link').map((l) => l.getAttribute('href'))).not.toContain('/test/admin/seo/redirects');
  });

  it('shows every Growth & Discovery link to a god account', async () => {
    authState.user = { id: 1, name: 'God User', role: 'admin', is_god: true } as User;
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={false} />);

    await userEvent.click(screen.getByRole('button', { name: 'Growth & Discovery' }));
    const hrefs = screen.getAllByRole('link').map((l) => l.getAttribute('href'));
    for (const href of GROWTH_DISCOVERY_HREFS) expect(hrefs).toContain(href);
  });

  it('shows all four cron job links to a god account', async () => {
    authState.user = { id: 1, name: 'God User', role: 'admin', is_god: true } as User;
    const { AdminSidebar } = await import('./AdminSidebar');
    render(<AdminSidebar collapsed={false} />);

    await userEvent.click(screen.getByRole('button', { name: 'Platform Operations' }));
    const hrefs = screen.getAllByRole('link').map((l) => l.getAttribute('href'));
    for (const href of CRON_HREFS) {
      expect(hrefs).toContain(href);
    }
  });
});
