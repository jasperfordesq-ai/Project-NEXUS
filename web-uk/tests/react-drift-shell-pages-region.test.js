// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Three shell-level drifts from the React frontend, closed on 26 Oct 2026.
 *
 * 1. Explore "Exchanges" card. Commit f3450c8b8 (22 Oct) made the
 *    `exchange_workflow` FEATURE the only switch; the hidden broker setting
 *    this card read is refused on save and stripped from responses, so the card
 *    was hidden from every community whose feature was on.
 * 2. A community's own Page Builder pages (`menu_pages` in the tenant
 *    bootstrap) appear in the footer navigation: `about` pages in the Support
 *    column, `header` pages in their own column titled by the community's
 *    `header_column_title` setting.
 * 3. Dates and numbers follow the community's region (`settings.region`, else
 *    `contact.country_code`) while the language still decides the words.
 */

const path = require('path');
const nunjucks = require('nunjucks');
const {
  buildExploreLinks,
  buildShellLocals,
  withCommunityPageColumns
} = require('../src/lib/accessible-shell');
const {
  createTranslator,
  formatLocaleDate,
  formatLocaleNumber,
  localeForIntl,
  regionForTenant
} = require('../src/lib/localization');
const { runWithRequestLocale } = require('../src/lib/request-locale-context');

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const t = createTranslator('en');

function shellRequest(tenant, path_ = '/acme/accessible/feed') {
  return {
    accessibleRouting: { tenant, tenantSlug: 'acme', prefix: '/acme/accessible' },
    query: {},
    originalUrl: path_,
    path: '/feed',
    headers: { host: 'localhost' },
    protocol: 'http',
    locale: 'en',
    t
  };
}

describe('Explore "Exchanges" card follows the exchange_workflow feature (f3450c8b8)', () => {
  const exchangesIn = (tenant) => buildExploreLinks({ tenant, t }).some((item) => item.href === '/exchanges');

  it('shows the card when the feature is on, even with no broker setting at all', () => {
    expect(exchangesIn({ modules: { listings: true }, features: { exchange_workflow: true } })).toBe(true);
  });

  it('shows the card by default (Laravel defaults the feature on)', () => {
    expect(exchangesIn({ modules: { listings: true }, features: {} })).toBe(true);
  });

  it('hides the card when the feature is off, whatever a stale broker setting says', () => {
    expect(exchangesIn({
      modules: { listings: true },
      features: { exchange_workflow: false },
      config: { broker_controls: { exchange_workflow: { enabled: true } } }
    })).toBe(false);
  });

  it('no longer reads the retired hidden broker setting', () => {
    expect(exchangesIn({
      modules: { listings: true },
      features: { exchange_workflow: true },
      config: { broker_controls: { exchange_workflow: { enabled: false } } }
    })).toBe(true);
  });

  it('still needs the listings module', () => {
    expect(exchangesIn({ modules: { listings: false }, features: { exchange_workflow: true } })).toBe(false);
  });
});

describe('community Page Builder pages in the footer (menu_pages)', () => {
  const baseColumns = [
    { key: 'platform', heading: 'Platform', links: [] },
    { key: 'support', heading: 'Support', links: [{ key: 'about', label: 'About', href: '/about' }] },
    { key: 'legal', heading: 'Legal', links: [] }
  ];

  it('adds about pages to Support and header pages to their own column with the default title', () => {
    const columns = withCommunityPageColumns(baseColumns, {
      menu_pages: {
        about: [{ title: 'Our story', slug: 'our-story', description: null }],
        header: [{ title: 'Volunteer handbook', slug: 'handbook', description: 'How we work' }]
      }
    }, t);

    const support = columns.find((column) => column.key === 'support');
    expect(support.links.map((link) => link.href)).toEqual(['/about', '/page/our-story']);
    const community = columns.find((column) => column.key === 'community_pages');
    expect(community.heading).toBe(t('footer.columns.community_pages.heading'));
    expect(community.heading).toBe('Our Pages');
    expect(community.links).toEqual([expect.objectContaining({ label: 'Volunteer handbook', href: '/page/handbook' })]);
  });

  it("uses the community's own column title when it has one, and ignores a boolean", () => {
    const pages = { header: [{ title: 'Handbook', slug: 'handbook' }] };
    expect(withCommunityPageColumns(baseColumns, { menu_pages: pages, settings: { header_column_title: '  Resources  ' } }, t)
      .find((column) => column.key === 'community_pages').heading).toBe('Resources');
    expect(withCommunityPageColumns(baseColumns, { menu_pages: pages, settings: { header_column_title: true } }, t)
      .find((column) => column.key === 'community_pages').heading).toBe('Our Pages');
  });

  it('adds nothing when the community has no menu pages, and drops malformed rows', () => {
    expect(withCommunityPageColumns(baseColumns, {}, t)).toEqual(baseColumns);
    const columns = withCommunityPageColumns(baseColumns, {
      menu_pages: { header: [{ title: 'Bad', slug: '../admin' }, { title: '', slug: 'empty' }] }
    }, t);
    expect(columns.find((column) => column.key === 'community_pages')).toBeUndefined();
  });

  it('renders prefixed links in the footer, four columns in quarters', () => {
    const locals = buildShellLocals(shellRequest({
      id: 2,
      slug: 'acme',
      name: 'Acme Timebank',
      settings: { header_column_title: 'Resources' },
      menu_pages: {
        about: [{ title: 'Our story', slug: 'our-story' }],
        header: [{ title: 'Volunteer handbook', slug: 'handbook' }]
      }
    }), false);

    const env = new nunjucks.Environment(new nunjucks.FileSystemLoader([VIEWS, GOVUK]), { autoescape: true });
    const html = env.render('partials/footer.njk', { ...locals, copyrightYear: () => '2026' });
    expect(html).toContain('<h2 class="govuk-footer__heading govuk-heading-m">Resources</h2>');
    expect(html).toContain('href="/acme/accessible/page/handbook">Volunteer handbook</a>');
    expect(html).toContain('href="/acme/accessible/page/our-story">Our story</a>');
    expect(html).toContain('govuk-grid-column-one-quarter');
    expect(html).not.toContain('govuk-footer__section govuk-grid-column-one-third');
  });

  it('keeps three one-third columns for a community without header pages', () => {
    const locals = buildShellLocals(shellRequest({ id: 2, slug: 'acme', name: 'Acme Timebank' }), false);
    const env = new nunjucks.Environment(new nunjucks.FileSystemLoader([VIEWS, GOVUK]), { autoescape: true });
    const html = env.render('partials/footer.njk', { ...locals, copyrightYear: () => '2026' });
    expect(html).toContain('govuk-footer__section govuk-grid-column-one-third');
    expect(html).not.toContain('govuk-grid-column-one-quarter');
  });
});

describe("dates and numbers follow the community's region (React b25683ea0)", () => {
  const date = '2026-08-17T12:00:00Z';

  it('reads settings.region first, then contact.country_code, and rejects junk', () => {
    expect(regionForTenant({ settings: { region: 'us' }, contact: { country_code: 'IE' } })).toBe('US');
    expect(regionForTenant({ settings: {}, contact: { country_code: 'de' } })).toBe('DE');
    expect(regionForTenant({ settings: { region: 'USA' } })).toBeNull();
    expect(regionForTenant({})).toBeNull();
  });

  it('keeps the language-only default when no region is configured', () => {
    expect(localeForIntl('en')).toBe('en-GB');
    expect(localeForIntl('de')).toBe('de-DE');
  });

  it('combines the member language with the community region inside a request', () => {
    runWithRequestLocale('en', () => {
      expect(localeForIntl('en')).toBe('en-US');
      expect(formatLocaleDate(date, 'en', { day: 'numeric', month: 'numeric', year: 'numeric' })).toBe('8/17/2026');
    }, 'US');
    runWithRequestLocale('en', () => {
      expect(formatLocaleDate(date, 'en', { day: 'numeric', month: 'numeric', year: 'numeric' })).toBe('17/08/2026');
    }, null);
  });

  it('lets the language keep the words while the region sets the conventions', () => {
    runWithRequestLocale('de', () => {
      expect(localeForIntl('de')).toBe('de-CH');
      // Swiss grouping uses the apostrophe-like separator; German words stay German.
      expect(formatLocaleNumber(1234567, 'de')).not.toBe(new Intl.NumberFormat('de-DE').format(1234567));
      expect(formatLocaleDate(date, 'de', { month: 'long' })).toContain('August');
    }, 'CH');
  });
});
