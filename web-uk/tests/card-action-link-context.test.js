// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const nunjucks = require('nunjucks');
const path = require('path');

/**
 * WCAG 2.4.4 (Link Purpose). A card list repeats the same few action words on
 * every row — "Message", "View profile", "View", "Edit" — so a screen-reader
 * user pulling up a list of links hears the same label N times with nothing to
 * tell the rows apart. The house fix, already used on profile settings, group
 * files and the feed, is a `govuk-visually-hidden` suffix naming the item.
 *
 * This RENDERS the templates with a fixture rather than asserting on source,
 * because the failure mode worth catching is a suffix that interpolates an
 * out-of-scope variable and silently renders empty.
 */
const env = nunjucks.configure(
  [path.join(__dirname, '..', 'src', 'views'), path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
  { autoescape: true, noCache: true }
);

const shell = {
  t: (key, vars = {}) => `${key}${Object.keys(vars).length ? ' ' + JSON.stringify(vars) : ''}`,
  tc: (key) => key,
  urlFor: (pathname) => pathname,
  formatLocaleNumber: (value) => String(value),
  isAuthenticated: true,
  tenantName: 'Acme Timebank',
  serviceName: 'Project NEXUS Accessible',
  communityName: 'Acme Timebank',
  alphaNavItems: [],
  alphaFooterColumns: [],
  alphaLocaleOptions: [],
  alphaCurrentLocale: 'en',
  csrfToken: 'test-csrf'
};

/** Every visually-hidden suffix must carry real text, never an empty dash. */
function hiddenSuffixes(html) {
  const doc = [...html.matchAll(/<span class="govuk-visually-hidden">([\s\S]*?)<\/span>/g)];
  return doc.map((m) => m[1].replace(/\s+/g, ' ').trim());
}

describe('repeated card-list actions name the item they act on', () => {
  it('connections network rows name the member on every action', () => {
    const connection = {
      id: 7,
      name: 'Alex Helper',
      profileHref: '/members/7',
      messageHref: '/messages/7',
      removeAction: '/connections/7/remove'
    };
    const html = env.render('connections/network.njk', {
      ...shell,
      sections: {
        accepted: { items: [connection], total: 1 },
        pending_received: { items: [], total: 0 },
        pending_sent: { items: [], total: 0 }
      }
    });

    const suffixes = hiddenSuffixes(html);
    expect(suffixes).toContain('— Alex Helper');
    // The member's name appears on BOTH repeated actions, not just one.
    expect(suffixes.filter((s) => s === '— Alex Helper').length).toBeGreaterThanOrEqual(2);
    // No suffix may be an empty dash (an out-of-scope variable).
    expect(suffixes.filter((s) => s === '—')).toEqual([]);
  });

  it('my-listings rows name the listing on View and Edit', () => {
    const html = env.render('marketplace/manage.njk', {
      ...shell,
      listings: [{ id: 42, title: 'Community bike', href: '/marketplace/42', images: [] }],
      tab: 'active',
      counts: { active: 1, draft: 0, sold: 0, expired: 0 }
    });

    const suffixes = hiddenSuffixes(html);
    expect(suffixes.filter((s) => s === '— Community bike').length).toBeGreaterThanOrEqual(2);
    expect(suffixes.filter((s) => s === '—')).toEqual([]);
  });

  it('my-jobs rows name the vacancy on Manage and Edit', () => {
    const html = env.render('jobs/mine.njk', {
      ...shell,
      jobs: [{ id: 501, title: 'Community gardener', viewsCount: 3, applicationsCount: 1 }],
      pagination: {},
      filters: {}
    });

    const suffixes = hiddenSuffixes(html);
    expect(suffixes.filter((s) => s === '— Community gardener').length).toBeGreaterThanOrEqual(2);
    expect(suffixes.filter((s) => s === '—')).toEqual([]);
  });
});
