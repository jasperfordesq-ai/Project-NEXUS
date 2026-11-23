// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';

const locationState = vi.hoisted(() => ({ value: { pathname: '/platform-team', search: '', hash: '' } }));

vi.mock('@/contexts', () => ({
  useTenant: () => ({
    tenant: { id: 2, name: 'Test Community', slug: 'test' },
    tenantPath: (p: string) => `/test${p}`,
  }),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useLocation: () => locationState.value,
    Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode; [key: string]: unknown }) => (
      <a href={to} {...(rest as object)}>{children}</a>
    ),
  };
});

// Labels render as "<namespace-or-key>" so the tests do not depend on wording.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) => (options?.name ? `${key}|${options.name}` : key),
  }),
}));

import { PlatformTeamSidebar } from './PlatformTeamSidebar';

// Every page in the panel, by zone. Same address tails as PlatformTeamRoutes.
// 🔴 A page's ZONE says what it acts on and follows the server code. Regrouping
// inside a zone is free; these two lists must not trade entries.
const PLATFORM_ZONE = [
  'enterprise/monitoring', 'cron-jobs', 'cron-jobs/logs', 'cron-jobs/setup', 'cron-jobs/settings',
  'seo/prerender', 'failed-jobs', '404-errors', 'tests', 'plans', 'integrations/webhooks',
  'security', 'senior-accounts', 'accounts', 'access-review', 'enterprise', 'enterprise/permissions',
  // Moved in from the super admin panel's platform-wide half (phase 2).
  'billing', 'billing/revenue',
  'communities', 'notices', 'provisioning-requests', 'platform/pilot-inquiries', 'platform-capabilities', 'phone-app',
  'federation', 'federation/whitelist', 'federation/partnerships', 'federation/audit',
  'regional-analytics/subscriptions', 'national/kiss',
  'platform/translation',
  // Written for the panel, 16 Nov 2026.
  'community-health',
  'community-setup',
  'usage',
  'unfinished-features',
  'data-requests',
  'deployments',
  'errors',
  'search-rebuild',
  'domains',
  'legal-documents',
  'clean-up-jobs',
  'push-notifications',
  'connections',
  'translations',
  'agreements',
  'assurance',
];
const COMMUNITY_ZONE = [
  'email-settings', 'email-deliverability', 'deliverability', 'settings/registration-policy', 'enterprise/roles',
  'menus', 'seo/audit', 'seo/redirects', 'search-analytics', 'performance', 'analytics/regional',
  'matching-diagnostic', 'match-debug',
];

const HOME = '/test/platform-team';
const page = (tail: string) => `${HOME}/${tail}`;

// A closed group's links are in the page but hidden (a group opens and
// closes), so the lookups below include hidden links unless a test is about
// what a reader is actually offered.
function allLinks(scope: HTMLElement = document.body): HTMLElement[] {
  return within(scope).getAllByRole('link', { hidden: true });
}

function hrefsOf(links: HTMLElement[]): string[] {
  return links.map((a) => a.getAttribute('href') ?? '');
}

function hrefsIn(scope: HTMLElement): string[] {
  return hrefsOf(allLinks(scope));
}

/** The panel pages a reader is offered right now (hidden ones left out), without the front page. */
function offeredPages(): string[] {
  return hrefsOf(screen.getAllByRole('link')).filter((h) => h.startsWith(`${HOME}/`));
}

function groupEl(container: HTMLElement, key: string): HTMLElement {
  return container.querySelector(`[data-nav-group="${key}"]`) as HTMLElement;
}

function currentLinks(): string[] {
  return hrefsOf(allLinks().filter((a) => a.getAttribute('aria-current') === 'page'));
}

describe('PlatformTeamSidebar', () => {
  beforeEach(() => {
    locationState.value = { pathname: '/platform-team', search: '', hash: '' };
  });

  it('lists every page that acts on the whole platform under "The whole platform"', () => {
    render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);
    const zone = screen.getByRole('region', { name: 'sidebar.zone_platform' });

    expect(hrefsIn(zone).sort()).toEqual(PLATFORM_ZONE.map(page).sort());
  });

  it('lists every page that acts on one community under "This community", naming the community', () => {
    render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);
    const zone = screen.getByRole('region', { name: 'sidebar.zone_community|Test Community' });

    expect(hrefsIn(zone).sort()).toEqual(COMMUNITY_ZONE.map(page).sort());
  });

  it('lists each page exactly once', () => {
    render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);
    const panelLinks = hrefsIn(document.body).filter((h) => h.startsWith(`${HOME}/`));

    expect(panelLinks).toHaveLength(PLATFORM_ZONE.length + COMMUNITY_ZONE.length);
    expect(new Set(panelLinks).size).toBe(panelLinks.length);
  });

  // Regrouped 17 Nov 2026 around what the panel is opened to do. Order inside a group is as listed.
  it.each([
    ['health', ['enterprise/monitoring', 'errors', 'failed-jobs', '404-errors', 'deployments', 'domains', 'tests']],
    [
      'communities',
      [
        'communities', 'community-health', 'community-setup', 'usage', 'national/kiss',
        'provisioning-requests', 'platform/pilot-inquiries',
      ],
    ],
    ['features', ['platform-capabilities', 'unfinished-features', 'notices']],
    ['phone', ['phone-app', 'push-notifications']],
    ['access', ['security', 'senior-accounts', 'accounts', 'access-review', 'enterprise', 'enterprise/permissions']],
    ['data', ['data-requests', 'legal-documents', 'clean-up-jobs', 'assurance']],
    [
      'money',
      ['billing', 'billing/revenue', 'plans', 'regional-analytics/subscriptions', 'agreements'],
    ],
    ['jobs', ['cron-jobs', 'cron-jobs/logs', 'cron-jobs/setup', 'cron-jobs/settings', 'search-rebuild', 'seo/prerender']],
    ['connections', ['connections', 'integrations/webhooks', 'platform/translation', 'translations']],
    ['federation', ['federation', 'federation/whitelist', 'federation/partnerships', 'federation/audit']],
    ['joining', ['settings/registration-policy', 'enterprise/roles']],
    ['site', ['menus', 'seo/audit', 'seo/redirects', 'search-analytics']],
    ['matching', ['matching-diagnostic', 'match-debug']],
  ])('puts these pages, in this order, in the "%s" group', (key, tails) => {
    const { container } = render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);

    expect(hrefsIn(groupEl(container, key))).toEqual(tails.map(page));
  });

  // "Deliverability" tracks project deliverables and milestones. It sat in the
  // Email group beside "Email Deliverability" until 17 Nov 2026, which read as
  // if both were about email.
  it('keeps the project deliverables page out of the Email group', () => {
    const { container } = render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);

    expect(hrefsIn(groupEl(container, 'email'))).toEqual(['email-settings', 'email-deliverability'].map(page));
    expect(hrefsIn(groupEl(container, 'reports'))).toEqual(
      ['performance', 'analytics/regional', 'deliverability'].map(page),
    );
  });

  it.each([
    [
      'sidebar.zone_platform',
      ['health', 'communities', 'features', 'phone', 'access', 'data', 'money', 'jobs', 'connections', 'federation'],
    ],
    ['sidebar.zone_community|Test Community', ['joining', 'email', 'site', 'matching', 'reports']],
  ])('keeps the groups of %s in their order', (zoneName, keys) => {
    render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);
    const zone = screen.getByRole('region', { name: zoneName });
    const found = Array.from(zone.querySelectorAll('[data-nav-group]')).map((el) => el.getAttribute('data-nav-group'));

    expect(found).toEqual(keys);
  });

  describe('groups that open and close', () => {
    it('opens the group that holds the current page, and no other', () => {
      locationState.value = { pathname: '/platform-team/billing/revenue', search: '', hash: '' };
      render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);

      expect(screen.getByRole('button', { name: 'sidebar.group_money' })).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('button', { name: 'sidebar.group_health' })).toHaveAttribute('aria-expanded', 'false');
      // Only the open group's pages are offered to a reader.
      expect(offeredPages()).toContain(page('billing'));
      expect(offeredPages()).not.toContain(page('errors'));
    });

    it('opens a group when its name is pressed, and closes the one that was open', () => {
      locationState.value = { pathname: '/platform-team/billing', search: '', hash: '' };
      render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);

      fireEvent.click(screen.getByRole('button', { name: 'sidebar.group_health' }));

      expect(screen.getByRole('button', { name: 'sidebar.group_health' })).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('button', { name: 'sidebar.group_money' })).toHaveAttribute('aria-expanded', 'false');
    });

    it('has every group closed on the front page of the panel', () => {
      render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);
      const open = screen.getAllByRole('button').filter((button) => button.getAttribute('aria-expanded') === 'true');

      expect(open).toEqual([]);
    });
  });

  describe('the "find a page" box', () => {
    const type = (value: string) =>
      fireEvent.change(screen.getByRole('searchbox', { name: 'sidebar.search' }), { target: { value } });

    it('lists the pages whose name matches, each with its group, in place of the groups', () => {
      render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);

      // Typed in capitals: case is ignored.
      type('CRON_');

      expect(offeredPages()).toEqual(
        ['cron-jobs', 'cron-jobs/logs', 'cron-jobs/setup', 'cron-jobs/settings'].map(page),
      );
      expect(screen.getAllByText('sidebar.group_jobs_tools')).toHaveLength(4);
      expect(screen.queryByRole('button', { name: 'sidebar.group_health' })).not.toBeInTheDocument();
    });

    it('finds a page by the name of its group as well', () => {
      render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);

      type('group_phone');

      expect(offeredPages()).toEqual(['phone-app', 'push-notifications'].map(page));
    });

    it('says so when nothing matches, and brings the groups back when it is cleared', () => {
      render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);

      type('zzzz');
      expect(screen.getByText('sidebar.search_none')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'sidebar.search_clear' }));
      expect(screen.queryByText('sidebar.search_none')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'sidebar.group_health' })).toBeInTheDocument();
    });
  });

  // In Arabic the page reads right to left, so the menu must sit on the right.
  // Logical sides (start / end) follow the page's direction; left / right do not.
  it('sits on the start side of the page, whichever way the language reads', () => {
    const { container } = render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);
    const aside = container.querySelector('aside') as HTMLElement;

    expect(aside.className).toMatch(/(^|\s)start-0(\s|$)/);
    expect(aside.className).toMatch(/(^|\s)border-e(\s|$)/);
    expect(aside.className).not.toMatch(/(^|\s)(left-0|border-r)(\s|$)/);
  });

  // Owner, 17 Nov 2026: one way back, at the foot of the menu, to the admin
  // panel. The link to the super admin panel was removed.
  it.each([
    ['open', false],
    ['collapsed to icons', true],
  ])('links back to the admin panel and not to the super admin panel, when %s', (_state, collapsed) => {
    render(<PlatformTeamSidebar collapsed={collapsed} onToggle={() => {}} />);
    const hrefs = hrefsIn(document.body);

    expect(hrefs.filter((h) => h === '/test/admin')).toHaveLength(1);
    expect(hrefs.some((h) => h.includes('/super-admin'))).toBe(false);
  });

  it('puts the way back to the admin panel last, under the pages', () => {
    render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);
    const hrefs = hrefsIn(document.body);

    expect(hrefs[hrefs.length - 1]).toBe('/test/admin');
  });

  it('starts with the front page of the panel, in the open menu and in the strip of icons', () => {
    const { unmount } = render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);
    expect(hrefsIn(screen.getByRole('navigation', { name: 'sidebar.nav_label' }))[0]).toBe(HOME);
    unmount();

    render(<PlatformTeamSidebar collapsed onToggle={() => {}} />);
    const strip = screen.getByRole('navigation', { name: 'sidebar.nav_label' });
    expect(within(strip).getByRole('link', { name: 'home.title' })).toHaveAttribute('href', HOME);
  });

  // Inside the app's routes the pathname has NO community slug; on a test
  // router or a slug address it has. The current page must be marked in both.
  it.each([
    ['without the community slug', '/platform-team/cron-jobs/logs'],
    ['with the community slug', '/test/platform-team/cron-jobs/logs'],
  ])('marks exactly the current page, %s', (_form, pathname) => {
    locationState.value = { pathname, search: '', hash: '' };
    render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);

    expect(currentLinks()).toEqual([page('cron-jobs/logs')]);
  });

  it('marks the nearest menu page for a sub-page that has no entry of its own', () => {
    locationState.value = { pathname: '/platform-team/plans/edit/3', search: '', hash: '' };
    render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);

    expect(currentLinks()).toEqual([page('plans')]);
  });

  it('marks Roles and permissions, not the Enterprise dashboard, on the page of one role', () => {
    locationState.value = { pathname: '/platform-team/enterprise/roles/5/edit', search: '', hash: '' };
    render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);

    expect(currentLinks()).toEqual([page('enterprise/roles')]);
  });

  it('marks Federation audit, not the Federation dashboard, on the audit page', () => {
    locationState.value = { pathname: '/platform-team/federation/audit', search: '', hash: '' };
    render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);

    expect(currentLinks()).toEqual([page('federation/audit')]);
  });

  it('marks Revenue, not Billing control, on the revenue page', () => {
    locationState.value = { pathname: '/platform-team/billing/revenue', search: '', hash: '' };
    render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);

    expect(currentLinks()).toEqual([page('billing/revenue')]);
  });

  it('marks only its own entry on the front page of the panel', () => {
    render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);

    expect(currentLinks()).toEqual([HOME]);
  });

  it('does not mark the front page entry on any other page', () => {
    locationState.value = { pathname: '/platform-team/menus', search: '', hash: '' };
    render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);

    expect(currentLinks()).toEqual([page('menus')]);
  });

  // The menu is longer than the screen. A page opened from a bookmark or an
  // old address must not leave its highlighted entry off-screen.
  it('brings the entry of the current page into view', () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      locationState.value = { pathname: '/platform-team/match-debug', search: '', hash: '' };
      render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);

      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView.mock.contexts[0]).toBe(
        allLinks().find((a) => a.getAttribute('aria-current') === 'page'),
      );
      // Centred the first time, so it is not left under the fade at the edge.
      expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'center' });
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('after the first time, only scrolls as far as it has to (a click must not make the menu jump)', () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      locationState.value = { pathname: '/platform-team/match-debug', search: '', hash: '' };
      const { rerender } = render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);

      locationState.value = { pathname: '/platform-team/menus', search: '', hash: '' };
      rerender(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);

      expect(scrollIntoView).toHaveBeenCalledTimes(2);
      expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' });
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('does not scroll the menu on the front page of the panel', () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  describe('collapsed to a strip of icons', () => {
    it('shows one named button per group, in both zones', () => {
      render(<PlatformTeamSidebar collapsed onToggle={() => {}} />);
      const platform = screen.getByRole('region', { name: 'sidebar.zone_platform' });
      const community = screen.getByRole('region', { name: 'sidebar.zone_community|Test Community' });
      const names = (zone: HTMLElement) => within(zone).getAllByRole('button').map((b) => b.getAttribute('aria-label'));

      expect(names(platform)).toEqual([
        'sidebar.group_health', 'sidebar.group_communities', 'sidebar.group_features', 'sidebar.group_phone',
        'sidebar.group_access_security', 'sidebar.group_data', 'sidebar.group_money', 'sidebar.group_jobs_tools',
        'sidebar.group_connections', 'sidebar.section_federation',
      ]);
      expect(names(community)).toEqual([
        'sidebar.group_joining', 'sidebar.group_email', 'sidebar.group_site', 'sidebar.group_matching',
        'sidebar.group_reports',
      ]);
    });

    it('has no search box', () => {
      render(<PlatformTeamSidebar collapsed onToggle={() => {}} />);

      expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    });

    // A group is several pages: its icon opens the menu at that group rather
    // than pretending to be a link to one of them.
    it('opens the menu at a group when its icon is pressed', () => {
      const onToggle = vi.fn();
      const { rerender } = render(<PlatformTeamSidebar collapsed onToggle={onToggle} />);

      fireEvent.click(screen.getByRole('button', { name: 'sidebar.group_money' }));
      expect(onToggle).toHaveBeenCalledTimes(1);

      rerender(<PlatformTeamSidebar collapsed={false} onToggle={onToggle} />);
      expect(screen.getByRole('button', { name: 'sidebar.group_money' })).toHaveAttribute('aria-expanded', 'true');
    });
  });
});
