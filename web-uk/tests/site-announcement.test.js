// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Warmth phase 6, E6: the community notice banner. A community's admins post a
 * one-line notice (Admin → Announcements); the tenant bootstrap carries the one
 * to show now as `announcement` (SiteAnnouncementService::currentForTenant).
 * The React site shows it across the top of every page
 * (components/layout/SiteAnnouncementBanner.tsx + lib/siteAnnouncement.ts);
 * here it is a GOV.UK notification banner, checked by the same rules.
 */

const path = require('path');
const nunjucks = require('nunjucks');
const { currentSiteAnnouncement } = require('../src/lib/site-announcement');
const { buildShellLocals } = require('../src/lib/accessible-shell');
const { createTranslator } = require('../src/lib/localization');

const NOW = Date.parse('2026-11-14T12:00:00Z');
const notice = {
  id: 7,
  message: 'Coffee morning on Saturday',
  style: 'info',
  link_url: '/events/12',
  link_label: 'See the event',
  is_dismissible: true,
  starts_at: '2026-11-01T00:00:00Z',
  ends_at: '2026-11-30T00:00:00Z',
  updated_at: '2026-11-10T09:00:00Z'
};
const urlFor = (pathname) => `/hour-timebank/accessible${pathname}`;

describe('currentSiteAnnouncement', () => {
  it('turns the bootstrap notice into what the banner shows, with an internal link on this site', () => {
    expect(currentSiteAnnouncement(notice, { now: NOW, urlFor })).toEqual({
      id: 7,
      message: 'Coffee morning on Saturday',
      style: 'info',
      link: { href: '/hour-timebank/accessible/events/12', label: 'See the event', internal: true }
    });
  });

  it('shows nothing before the start or from the end (the bootstrap is cached and can outlive the notice)', () => {
    expect(currentSiteAnnouncement({ ...notice, starts_at: '2026-11-15T00:00:00Z' }, { now: NOW, urlFor })).toBeNull();
    expect(currentSiteAnnouncement({ ...notice, ends_at: '2026-11-14T12:00:00Z' }, { now: NOW, urlFor })).toBeNull();
    expect(currentSiteAnnouncement({ ...notice, starts_at: null, ends_at: null }, { now: NOW, urlFor })).not.toBeNull();
  });

  it('shows nothing for a date that was sent but cannot be read, a missing message or a bad id', () => {
    expect(currentSiteAnnouncement({ ...notice, ends_at: 'soon' }, { now: NOW, urlFor })).toBeNull();
    expect(currentSiteAnnouncement({ ...notice, message: '   ' }, { now: NOW, urlFor })).toBeNull();
    expect(currentSiteAnnouncement({ ...notice, id: 0 }, { now: NOW, urlFor })).toBeNull();
    expect(currentSiteAnnouncement(null, { now: NOW, urlFor })).toBeNull();
    expect(currentSiteAnnouncement('notice', { now: NOW, urlFor })).toBeNull();
  });

  it('only knows our three styles; anything else is info', () => {
    expect(currentSiteAnnouncement({ ...notice, style: 'important' }, { now: NOW, urlFor }).style).toBe('important');
    expect(currentSiteAnnouncement({ ...notice, style: 'celebration' }, { now: NOW, urlFor }).style).toBe('celebration');
    expect(currentSiteAnnouncement({ ...notice, style: 'red; color: x' }, { now: NOW, urlFor }).style).toBe('info');
  });

  it('only links a path inside the site or an https address; anything else shows no link', () => {
    const external = currentSiteAnnouncement({ ...notice, link_url: 'https://example.org/fair' }, { now: NOW, urlFor });
    expect(external.link).toEqual({ href: 'https://example.org/fair', label: 'See the event', internal: false });
    for (const bad of ['javascript:alert(1)', '//evil.example', '/\\evil.example', 'http://example.org', 'https://user:pw@example.org', '/a b']) {
      expect(currentSiteAnnouncement({ ...notice, link_url: bad }, { now: NOW, urlFor }).link).toBeNull();
    }
    // A link with no label is not shown either (React does the same).
    expect(currentSiteAnnouncement({ ...notice, link_label: '' }, { now: NOW, urlFor }).link).toBeNull();
  });
});

describe('the shell carries the notice to every page', () => {
  it('builds siteAnnouncement from the routed community bootstrap', () => {
    const req = {
      accessibleRouting: {
        tenant: { id: 2, slug: 'hour-timebank', name: 'Timebank Ireland', announcement: { ...notice, starts_at: null, ends_at: null } },
        tenantSlug: 'hour-timebank',
        prefix: '/hour-timebank/accessible'
      },
      query: {},
      path: '/listings',
      originalUrl: '/hour-timebank/accessible/listings',
      headers: { host: 'localhost' },
      locale: 'en'
    };
    const locals = buildShellLocals(req, false);
    expect(locals.siteAnnouncement).toEqual(expect.objectContaining({
      message: 'Coffee morning on Saturday',
      link: { href: '/hour-timebank/accessible/events/12', label: 'See the event', internal: true }
    }));
  });

  it('has no notice when the community has none', () => {
    const req = {
      accessibleRouting: { tenant: { id: 2, slug: 'hour-timebank', announcement: null }, tenantSlug: 'hour-timebank', prefix: '' },
      query: {}, path: '/', originalUrl: '/', headers: { host: 'localhost' }, locale: 'en'
    };
    expect(buildShellLocals(req, false).siteAnnouncement).toBeNull();
  });
});

describe('the banner in the page', () => {
  const VIEWS = path.join(__dirname, '..', 'src', 'views');
  function render(context) {
    const environment = new nunjucks.Environment(
      new nunjucks.FileSystemLoader([VIEWS, path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')]),
      { autoescape: true }
    );
    const t = createTranslator('en');
    environment.addFilter('date', (value) => String(value));
    environment.addGlobal('t', t);
    environment.addGlobal('tc', t);
    environment.addGlobal('urlFor', (value) => value);
    environment.addGlobal('formatLocaleDate', (value) => String(value));
    return environment.renderString(
      '{% extends "layouts/base.njk" %}{% block content %}<p>page body</p>{% endblock %}',
      { t, feedbackUrl: '/contact', ...context }
    );
  }

  it('is a GOV.UK notification banner region (never an alert), with the words as text and the link', () => {
    const html = render({
      siteAnnouncement: {
        id: 7,
        message: 'Coffee <b>morning</b>',
        style: 'info',
        link: { href: '/events/12', label: 'See the event', internal: true }
      }
    });
    expect(html).toContain('govuk-notification-banner');
    expect(html).toContain('role="region"');
    expect(html).not.toMatch(/govuk-notification-banner[^>]*role="alert"/);
    expect(html).toContain('Community announcement');
    expect(html).toContain('Coffee &lt;b&gt;morning&lt;/b&gt;');
    expect(html).toContain('<a class="govuk-notification-banner__link" href="/events/12">See the event</a>');
    // Above the page's own content, and outside it, so no page can lose it.
    expect(html.indexOf('govuk-notification-banner')).toBeLessThan(html.indexOf('page body'));
    expect(html.indexOf('govuk-notification-banner')).toBeLessThan(html.indexOf('id="main-content"'));
  });

  it('says "important" in the heading for an important notice', () => {
    const html = render({ siteAnnouncement: { id: 7, message: 'Office closed', style: 'important', link: null } });
    expect(html).toContain('Important announcement');
    expect(html).not.toContain('govuk-notification-banner__link');
  });

  it('renders nothing when there is no notice', () => {
    expect(render({ siteAnnouncement: null })).not.toContain('govuk-notification-banner');
  });
});
