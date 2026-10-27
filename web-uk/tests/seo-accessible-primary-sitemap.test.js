// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The accessible site as a community's PRIMARY site for search engines, and the
 * accessible site's own sitemap (23 Oct 2026).
 *
 * Before this, every public accessible page canonicalised to the main site
 * whatever the community chose, /sitemap.xml fell through to the "Page not
 * found" page, and robots.txt never named a sitemap. A council that uses only
 * the accessible site therefore had no indexable site at all. Each block below
 * fails against that code.
 */

const request = require('supertest');

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  },
  ApiOfflineError: class ApiOfflineError extends Error {
    constructor(message = 'Unable to connect') {
      super(message);
      this.name = 'ApiOfflineError';
      this.status = 503;
    }
  },
  login: jest.fn(),
  logout: jest.fn(),
  invalidateUserCache: jest.fn(),
  register: jest.fn(),
  validateToken: jest.fn(),
  getProfile: jest.fn(),
  getUnreadCount: jest.fn().mockResolvedValue({ count: 0 }),
  getNotificationUnreadCount: jest.fn().mockResolvedValue({ unread: 0 }),
  getTenants: jest.fn(),
  getTenantBootstrap: jest.fn(),
  getPlatformStats: jest.fn().mockResolvedValue({ data: {} }),
  getRegistrationInfo: jest.fn().mockResolvedValue({ data: {} }),
  getLegalDocument: jest.fn().mockResolvedValue({ data: null }),
  getLegalVersions: jest.fn(),
  getHelpFaqs: jest.fn().mockResolvedValue({ data: [] }),
  getBlogPosts: jest.fn(),
  getPublicEvents: jest.fn()
}));

process.env.COOKIE_SECRET = 'test-secret-at-least-32-characters';
process.env.SESSION_SECRET = 'test-session-secret-32-chars!!';
process.env.NODE_ENV = 'test';
delete process.env.MAIN_FRONTEND_URL;

const { buildRobotsTxt, buildSeoLocals, canonicalUrlFor, seoPrimarySite } = require('../src/lib/seo-meta');
const { listReleases } = require('../src/lib/changelog');
const { cache } = require('../src/lib/cache');

const t = (key) => key;

function tenant(overrides = {}) {
  const { settings, ...rest } = overrides;
  return {
    id: 2,
    name: 'Acme Timebank',
    slug: 'acme',
    modules: { feed: true, listings: true },
    features: { events: true, public_events: true, blog: true },
    branding: {},
    seo: {},
    settings: { ...(settings || {}) },
    ...rest
  };
}

const accessiblePrimary = (overrides = {}) => tenant({ ...overrides, settings: { seo_primary_site: 'accessible', ...(overrides.settings || {}) } });

function locs(xml) {
  return Array.from(xml.matchAll(/<loc>([^<]+)<\/loc>/g), (match) => match[1].replace(/&amp;/g, '&'));
}

describe('primary-site canonical rule', () => {
  it("reads 'accessible' only when the community chose it", () => {
    expect(seoPrimarySite(tenant())).toBe('standard');
    expect(seoPrimarySite(tenant({ settings: { seo_primary_site: 'standard' } }))).toBe('standard');
    expect(seoPrimarySite(tenant({ settings: { seo_primary_site: 'nonsense' } }))).toBe('standard');
    expect(seoPrimarySite(tenant({ settings: { seo_primary_site: ' Accessible ' } }))).toBe('accessible');
  });

  it('standard mode still points shared pages at the main site', () => {
    const locals = buildSeoLocals({
      tenant: tenant(),
      t,
      routePath: '/about',
      visiblePath: '/acme/accessible/about',
      host: 'accessible.project-nexus.ie'
    });
    expect(locals.seoCanonicalUrl).toBe('https://app.project-nexus.ie/acme/about');
  });

  it('accessible mode makes every public page self-canonical, query removed', () => {
    for (const [routePath, visiblePath] of [
      ['/', '/acme/accessible'],
      ['/about', '/acme/accessible/about'],
      ['/guide', '/acme/accessible/guide'],
      ['/legal/terms', '/acme/accessible/legal/terms'],
      ['/blog/hello', '/acme/accessible/blog/hello?utm=1'],
      ['/whats-on/5', '/acme/accessible/whats-on/5']
    ]) {
      const locals = buildSeoLocals({
        tenant: accessiblePrimary(),
        t,
        routePath,
        visiblePath,
        host: 'accessible.project-nexus.ie'
      });
      expect(locals.seoCanonicalUrl).toBe(`https://accessible.project-nexus.ie${visiblePath.split('?')[0]}`);
    }
  });

  it('accessible mode leaves robots alone: private pages stay noindex', () => {
    const privatePage = buildSeoLocals({ tenant: accessiblePrimary(), t, routePath: '/dashboard', visiblePath: '/dashboard', host: 'a.example' });
    expect(privatePage.seoRobots).toBe('noindex, nofollow');
    const publicPage = buildSeoLocals({ tenant: accessiblePrimary(), t, routePath: '/about', visiblePath: '/about', host: 'a.example' });
    expect(publicPage.seoRobots).toBe('');
  });

  it('breadcrumb and structured-data addresses follow the same rule', () => {
    expect(canonicalUrlFor({ tenant: accessiblePrimary({ domain: 'acme.example' }), routePath: '/faq', visiblePath: '/faq', host: 'accessible.acme.example' }))
      .toBe('https://accessible.acme.example/faq');
  });
});

describe('robots.txt Sitemap line (unit)', () => {
  it('names the sitemap only when given one', () => {
    expect(buildRobotsTxt()).not.toMatch(/Sitemap:/);
    expect(buildRobotsTxt({ sitemapUrl: 'https://accessible.acme.example/sitemap.xml' }))
      .toMatch(/\nSitemap: https:\/\/accessible\.acme\.example\/sitemap\.xml\n$/);
    expect(buildRobotsTxt({ sitemapUrl: 'javascript:alert(1)' })).not.toMatch(/Sitemap:/);
  });
});

describe('accessible sitemap and robots.txt over HTTP', () => {
  let app;
  let api;
  const release = listReleases().find((entry) => !entry.isUnreleased);

  beforeAll(() => {
    app = require('../src/server');
    api = require('../src/lib/api');
  });

  function useTenant(data) {
    api.getTenantBootstrap.mockResolvedValue({ data });
  }

  beforeEach(() => {
    cache.clear();
    jest.clearAllMocks();
    api.getTenants.mockResolvedValue({ data: [{ id: 2, name: 'Acme Timebank', slug: 'acme' }] });
    api.getLegalVersions.mockImplementation(async (type) => (type === 'terms'
      ? { data: { title: 'Terms', versions: [{ id: 41, effective_date: '2026-01-02', is_current: true }, { id: 40, effective_date: '2025-06-01' }] } }
      : { data: { versions: [] } }));
    api.getBlogPosts.mockResolvedValue({ data: { items: [{ slug: 'spring-fair', updated_at: '2026-10-01 10:00:00' }, { slug: 'bad slug!' }] } });
    api.getPublicEvents.mockResolvedValue({ data: [{ id: 7 }, { id: 'x' }], meta: { has_more: false } });
  });

  it('standard mode lists only self-canonical public pages', async () => {
    useTenant(tenant());
    const response = await request(app).get('/acme/accessible/sitemap.xml');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/^application\/xml/);
    expect(response.headers['x-robots-tag']).toBe('noindex');
    expect(response.headers['cache-control']).toBe('public, max-age=600');
    expect(response.text).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>\n<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);

    const urls = locs(response.text);
    const base = "http://127.0.0.1/acme/accessible" /* requestHost drops the port, as every canonical does */;
    expect(urls).toContain(`${base}/changelog/${release.slug}`);
    expect(urls).toContain(`${base}/legal/terms/versions/41`);
    expect(urls).toContain(`${base}/legal/terms/versions/40`);
    expect(response.text).toContain('<lastmod>2026-01-02</lastmod>');
    // Pages that canonicalise to the main site are not this sitemap's to list.
    for (const path of ['', '/about', '/legal/terms', '/legal/terms/versions', '/blog', '/whats-on']) {
      expect(urls).not.toContain(`${base}${path}`);
    }
    expect(urls.some((url) => url.includes('/changelog/unreleased'))).toBe(false);
    // Blog and events are not even read: every such page maps to the main site.
    expect(api.getBlogPosts).not.toHaveBeenCalled();
    expect(api.getPublicEvents).not.toHaveBeenCalled();
  });

  it('accessible mode lists every public signed-out page, and nothing private', async () => {
    useTenant(accessiblePrimary());
    const response = await request(app).get('/acme/accessible/sitemap.xml');
    expect(response.status).toBe(200);
    const urls = locs(response.text);
    const base = "http://127.0.0.1/acme/accessible" /* requestHost drops the port, as every canonical does */;

    for (const path of ['', '/about', '/guide', '/faq', '/features', '/changelog', '/contact', '/help',
      '/trust-and-safety', '/accessibility', '/legal', '/legal/terms', '/legal/privacy', '/legal/cookies',
      '/legal/community-guidelines', '/legal/acceptable-use', '/legal/terms/versions', '/legal/terms/versions/41',
      '/account-deletion', '/child-safety', '/blog', '/blog/spring-fair', '/whats-on', '/whats-on/7',
      `/changelog/${release.slug}`]) {
      expect(urls).toContain(`${base}${path}`);
    }
    expect(response.text).toContain('<lastmod>2026-10-01</lastmod>');
    // An empty version list is not listed; malformed slugs and ids never are.
    expect(urls).not.toContain(`${base}/legal/privacy/versions`);
    // Help Centre guide slugs (recognition_badges, security_signin, …) are
    // covered by accessible-sitemap-help-guides.test.js; the word checks below
    // are about every other page.
    const pageUrls = urls.filter((url) => !url.includes('/accessible/help/'));
    expect(pageUrls.some((url) => /bad|whats-on\/x/.test(url))).toBe(false);
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of pageUrls) {
      expect(url).not.toMatch(/\/(dashboard|login|register|messages|wallet|settings|search)(\/|$)/);
      // /cookies is the consent form; /terms and /privacy are redirects.
      expect(url).not.toMatch(/\/accessible\/(cookies|terms|privacy)$/);
      expect(url).not.toContain('?');
    }
  });

  it('accessible mode respects the blog and public-events gates', async () => {
    useTenant(accessiblePrimary({ features: { events: true, public_events: false, blog: false } }));
    const response = await request(app).get('/acme/accessible/sitemap.xml');
    expect(response.status).toBe(200);
    const urls = locs(response.text);
    expect(urls).toContain('http://127.0.0.1/acme/accessible/about');
    const pageUrls = urls.filter((url) => !url.includes('/accessible/help/'));
    expect(pageUrls.some((url) => url.includes('/blog'))).toBe(false);
    expect(pageUrls.some((url) => url.includes('/whats-on'))).toBe(false);
    expect(api.getBlogPosts).not.toHaveBeenCalled();
    expect(api.getPublicEvents).not.toHaveBeenCalled();
  });

  it('answers 404 with an empty urlset when the community is noindex', async () => {
    useTenant(accessiblePrimary({ seo: { robots_directive: 'noindex, nofollow' } }));
    const response = await request(app).get('/acme/accessible/sitemap.xml');
    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/^application\/xml/);
    expect(locs(response.text)).toEqual([]);
    expect(response.text).toContain('<urlset');
  });

  it('answers 404 when the automatic sitemap is switched off', async () => {
    for (const off of [false, '0', 'false']) {
      cache.clear();
      useTenant(tenant({ settings: { seo_auto_sitemap: off } }));
      const response = await request(app).get('/acme/accessible/sitemap.xml');
      expect(response.status).toBe(404);
      expect(response.headers['content-type']).toMatch(/^application\/xml/);
      expect(locs(response.text)).toEqual([]);
    }
  });

  it('answers 404 on the shared host root, where no community is named', async () => {
    useTenant(tenant());
    const response = await request(app).get('/sitemap.xml');
    expect(response.status).toBe(404);
    expect(response.text).toContain('<urlset');
  });

  it('answers 503 and caches nothing when an upstream read fails', async () => {
    useTenant(accessiblePrimary());
    api.getBlogPosts.mockRejectedValueOnce(new api.ApiOfflineError());
    const failed = await request(app).get('/acme/accessible/sitemap.xml');
    expect(failed.status).toBe(503);
    const retried = await request(app).get('/acme/accessible/sitemap.xml');
    expect(retried.status).toBe(200);
    expect(locs(retried.text).length).toBeGreaterThan(10);
  });

  it("serves a community's own accessible domain at its root", async () => {
    useTenant(accessiblePrimary({ accessible_domain: 'accessible.acme.example', domain: 'acme.example' }));
    const response = await request(app).get('/sitemap.xml').set('Host', 'accessible.acme.example');
    expect(response.status).toBe(200);
    const urls = locs(response.text);
    expect(urls).toContain('http://accessible.acme.example/');
    expect(urls).toContain('http://accessible.acme.example/about');
    expect(urls.every((url) => url.startsWith('http://accessible.acme.example/'))).toBe(true);
  });

  it('robots.txt names the sitemap on a community accessible domain, in both modes', async () => {
    for (const data of [
      tenant({ accessible_domain: 'accessible.acme.example' }),
      accessiblePrimary({ accessible_domain: 'accessible.acme.example' })
    ]) {
      useTenant(data);
      const response = await request(app).get('/robots.txt').set('Host', 'accessible.acme.example');
      expect(response.status).toBe(200);
      expect(response.text).toContain('Sitemap: http://accessible.acme.example/sitemap.xml');
    }
  });

  it('robots.txt names no sitemap when it is not published, or on the shared host', async () => {
    useTenant(tenant({ accessible_domain: 'accessible.acme.example', seo: { robots_directive: 'noindex' } }));
    const noindex = await request(app).get('/robots.txt').set('Host', 'accessible.acme.example');
    expect(noindex.status).toBe(200);
    expect(noindex.text).not.toContain('Sitemap:');

    useTenant(tenant());
    const shared = await request(app).get('/robots.txt').set('Host', 'accessible.project-nexus.ie');
    expect(shared.status).toBe(200);
    expect(shared.text).not.toContain('Sitemap:');
    expect(api.getTenantBootstrap).not.toHaveBeenCalledWith({ host: 'accessible.project-nexus.ie' });
  });

  it('robots.txt still answers when the community lookup fails', async () => {
    api.getTenantBootstrap.mockRejectedValue(new Error('boom'));
    const response = await request(app).get('/robots.txt').set('Host', 'accessible.acme.example');
    expect(response.status).toBe(200);
    expect(response.text).toContain('User-agent: *');
    expect(response.text).not.toContain('Sitemap:');
  });

  it('a rendered page on an accessible-primary community is self-canonical', async () => {
    useTenant(accessiblePrimary());
    const response = await request(app).get('/acme/accessible/about');
    expect(response.status).toBe(200);
    expect(response.text).toMatch(/<link rel="canonical" href="http:\/\/[^"]+\/acme\/accessible\/about">/);
    expect(response.text).not.toContain('app.project-nexus.ie/acme/about');
  });
});
