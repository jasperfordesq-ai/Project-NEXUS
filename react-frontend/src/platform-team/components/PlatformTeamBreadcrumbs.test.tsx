// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const state = vi.hoisted(() => ({
  pathname: '/platform-team',
  slug: 'test' as string | null,
  // Keys the admin menu's wording has a breadcrumb label for.
  known: new Set(['admin_nav:breadcrumbs.cron_jobs', 'admin_nav:breadcrumbs.logs', 'admin_nav:breadcrumbs.enterprise', 'admin_nav:breadcrumbs.roles']),
}));

vi.mock('@/contexts', () => ({
  useTenant: () => ({ tenantSlug: state.slug }),
}));

vi.mock('react-router-dom', async (importOriginal) => {
  const orig = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...orig,
    useLocation: () => ({ pathname: state.pathname, search: '', hash: '' }),
    Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode; [key: string]: unknown }) => (
      <a href={to} {...(rest as object)}>{children}</a>
    ),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { segment?: string }) => (key === 'breadcrumbs.unknown' ? String(options?.segment) : key),
    i18n: {
      exists: (key: string) => state.known.has(key),
      t: (key: string) => key,
    },
  }),
}));

import { PlatformTeamBreadcrumbs } from './PlatformTeamBreadcrumbs';

function crumbs(): Array<[string, string | null]> {
  return Array.from(document.querySelectorAll('li')).map((li) => {
    const link = li.querySelector('a');
    return [li.textContent ?? '', link ? link.getAttribute('href') : null];
  });
}

describe('PlatformTeamBreadcrumbs', () => {
  beforeEach(() => {
    state.pathname = '/platform-team';
    state.slug = 'test';
  });

  it('shows nothing on the panel\'s own front page', () => {
    const { container } = render(<PlatformTeamBreadcrumbs />);
    expect(container).toBeEmptyDOMElement();
  });

  it('names each step with the admin menu\'s wording and links all but the last', () => {
    state.pathname = '/platform-team/cron-jobs/logs';
    render(<PlatformTeamBreadcrumbs />);

    expect(crumbs()).toEqual([
      ['breadcrumbs.root', '/test/platform-team'],
      ['admin_nav:breadcrumbs.cron_jobs', '/test/platform-team/cron-jobs'],
      ['admin_nav:breadcrumbs.logs', null],
    ]);
    expect(screen.getByRole('navigation', { name: 'breadcrumbs.aria_label' })).toBeInTheDocument();
  });

  it('works the same on an address that carries the community slug', () => {
    state.pathname = '/test/platform-team/cron-jobs/logs';
    render(<PlatformTeamBreadcrumbs />);

    expect(crumbs().map(([, href]) => href)).toEqual(['/test/platform-team', '/test/platform-team/cron-jobs', null]);
  });

  it('has no slug in its links on a community\'s own domain', () => {
    state.slug = null;
    state.pathname = '/platform-team/cron-jobs/logs';
    render(<PlatformTeamBreadcrumbs />);

    expect(crumbs().map(([, href]) => href)).toEqual(['/platform-team', '/platform-team/cron-jobs', null]);
  });

  it('skips record numbers', () => {
    state.pathname = '/platform-team/enterprise/roles/5/edit';
    render(<PlatformTeamBreadcrumbs />);

    expect(crumbs().map(([label]) => label)).toEqual([
      'breadcrumbs.root', 'admin_nav:breadcrumbs.enterprise', 'admin_nav:breadcrumbs.roles', 'breadcrumbs.edit',
    ]);
  });

  // A step that is only part of an address, not a page of its own, must not be
  // a link: it would open the panel's "not in this panel" page.
  it.each([
    ['/platform-team/seo/audit', 1],
    ['/platform-team/settings/registration-policy', 1],
    ['/platform-team/analytics/regional', 1],
    ['/platform-team/platform/translation', 1],
    ['/platform-team/national/kiss', 1],
    ['/platform-team/regional-analytics/subscriptions', 1],
    ['/platform-team/menus/builder/7', 2],
    ['/platform-team/deliverability/edit/12', 2],
  ])('does not link the step of %s that is not a page', (pathname, index) => {
    state.pathname = pathname;
    render(<PlatformTeamBreadcrumbs />);

    expect(crumbs()[index]![1]).toBeNull();
    // The panel itself is still a link.
    expect(crumbs()[0]![1]).toBe('/test/platform-team');
  });

  it('still links a step that IS a page', () => {
    state.pathname = '/platform-team/federation/whitelist';
    render(<PlatformTeamBreadcrumbs />);

    expect(crumbs()[1]![1]).toBe('/test/platform-team/federation');
  });

  // Pages that came from the super admin panel, or whose admin wording would
  // mislead, are named with the wording their own menu entry uses.
  it.each([
    ['/platform-team/platform/translation', 'super_admin:breadcrumbs.translation'],
    ['/platform-team/platform-capabilities', 'admin_nav:platform_capabilities'],
    ['/platform-team/national/kiss', 'super_admin:nav.national_dashboard'],
  ])('names the last step of %s', (pathname, label) => {
    state.pathname = pathname;
    render(<PlatformTeamBreadcrumbs />);

    const all = crumbs();
    expect(all[all.length - 1]![0]).toBe(label);
  });

  it('shows the address step itself when there is no wording for it, never a blank', () => {
    state.pathname = '/platform-team/something-new/logs';
    render(<PlatformTeamBreadcrumbs />);

    expect(crumbs().map(([label]) => label)).toEqual(['breadcrumbs.root', 'something-new', 'admin_nav:breadcrumbs.logs']);
  });
});
