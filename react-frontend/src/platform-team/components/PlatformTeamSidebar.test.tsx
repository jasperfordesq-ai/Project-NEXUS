// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

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
const PLATFORM_ZONE = [
  'enterprise/monitoring', 'cron-jobs', 'cron-jobs/logs', 'cron-jobs/setup', 'cron-jobs/settings',
  'seo/prerender', 'failed-jobs', '404-errors', 'tests', 'plans', 'plans/subscriptions', 'integrations/webhooks',
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
  'search-rebuild',
  'legal-documents',
  'clean-up-jobs',
  'push-notifications',
  'connections',
  'translations',
  'agreements',
];
const COMMUNITY_ZONE = [
  'email-settings', 'email-deliverability', 'deliverability', 'settings/registration-policy', 'enterprise/roles',
  'menus', 'seo/audit', 'seo/redirects', 'search-analytics', 'performance', 'analytics/regional',
  'matching-diagnostic', 'match-debug',
];

function hrefsIn(section: HTMLElement): string[] {
  return within(section).getAllByRole('link').map((a) => a.getAttribute('href') ?? '');
}

function currentLinks(): string[] {
  return screen
    .getAllByRole('link')
    .filter((a) => a.getAttribute('aria-current') === 'page')
    .map((a) => a.getAttribute('href') ?? '');
}

describe('PlatformTeamSidebar', () => {
  beforeEach(() => {
    locationState.value = { pathname: '/platform-team', search: '', hash: '' };
  });

  it('lists every page that acts on the whole platform under "The whole platform"', () => {
    render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);
    const zone = screen.getByRole('region', { name: 'sidebar.zone_platform' });

    expect(hrefsIn(zone).sort()).toEqual(PLATFORM_ZONE.map((t) => `/test/platform-team/${t}`).sort());
  });

  it('lists every page that acts on one community under "This community", naming the community', () => {
    render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);
    const zone = screen.getByRole('region', { name: 'sidebar.zone_community|Test Community' });

    expect(hrefsIn(zone).sort()).toEqual(COMMUNITY_ZONE.map((t) => `/test/platform-team/${t}`).sort());
  });

  it('lists each page exactly once', () => {
    render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);
    const panelLinks = screen
      .getAllByRole('link')
      .map((a) => a.getAttribute('href') ?? '')
      .filter((h) => h.startsWith('/test/platform-team/'));

    expect(panelLinks).toHaveLength(PLATFORM_ZONE.length + COMMUNITY_ZONE.length);
    expect(new Set(panelLinks).size).toBe(panelLinks.length);
  });

  it('links back to the admin panel and the super admin panel', () => {
    render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));

    expect(hrefs).toContain('/test/admin');
    expect(hrefs).toContain('/test/super-admin');
  });

  // Inside the app's routes the pathname has NO community slug; on a test
  // router or a slug address it has. The current page must be marked in both.
  it.each([
    ['without the community slug', '/platform-team/cron-jobs/logs'],
    ['with the community slug', '/test/platform-team/cron-jobs/logs'],
  ])('marks exactly the current page, %s', (_form, pathname) => {
    locationState.value = { pathname, search: '', hash: '' };
    render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);

    expect(currentLinks()).toEqual(['/test/platform-team/cron-jobs/logs']);
  });

  it('marks the nearest menu page for a sub-page that has no entry of its own', () => {
    locationState.value = { pathname: '/platform-team/plans/edit/3', search: '', hash: '' };
    render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);

    expect(currentLinks()).toEqual(['/test/platform-team/plans']);
  });

  it('marks Roles and permissions, not the Enterprise dashboard, on a role\'s page', () => {
    locationState.value = { pathname: '/platform-team/enterprise/roles/5/edit', search: '', hash: '' };
    render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);

    expect(currentLinks()).toEqual(['/test/platform-team/enterprise/roles']);
  });

  it('marks Federation audit, not the Federation dashboard, on the audit page', () => {
    locationState.value = { pathname: '/platform-team/federation/audit', search: '', hash: '' };
    render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);

    expect(currentLinks()).toEqual(['/test/platform-team/federation/audit']);
  });

  it('marks Revenue, not Billing control, on the revenue page', () => {
    locationState.value = { pathname: '/platform-team/billing/revenue', search: '', hash: '' };
    render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);

    expect(currentLinks()).toEqual(['/test/platform-team/billing/revenue']);
  });

  // The menu is longer than the screen. A page opened from a bookmark or an
  // old address must not leave its highlighted entry off-screen.
  it('brings the current page\'s entry into view', () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      locationState.value = { pathname: '/platform-team/match-debug', search: '', hash: '' };
      render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);

      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView.mock.contexts[0]).toBe(
        screen.getAllByRole('link').find((a) => a.getAttribute('aria-current') === 'page'),
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

  it('does not scroll the menu on the panel\'s own front page', () => {
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

  it('marks nothing on the panel\'s own front page', () => {
    render(<PlatformTeamSidebar collapsed={false} onToggle={() => {}} />);

    expect(currentLinks()).toEqual([]);
  });

  it('keeps every link when the menu is collapsed to icons', () => {
    render(<PlatformTeamSidebar collapsed onToggle={() => {}} />);
    const panelLinks = screen
      .getAllByRole('link')
      .map((a) => a.getAttribute('href') ?? '')
      .filter((h) => h.startsWith('/test/platform-team/'));

    expect(panelLinks).toHaveLength(PLATFORM_ZONE.length + COMMUNITY_ZONE.length);
  });
});
