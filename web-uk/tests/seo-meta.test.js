// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Search and sharing metadata on the accessible frontend (SEO audit, 23 Oct 2026).
 *
 * Before this, web-uk pages had no canonical link, no meta description, no Open
 * Graph / Twitter tags, no robots.txt (404), titles ending in the platform name
 * instead of the community's, and stayed indexable after a community switched
 * indexing off. Each block below fails against that code.
 */

const request = require('supertest');
const signature = require('cookie-signature');

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
  getRegistrationInfo: jest.fn().mockResolvedValue({ data: {} })
}));

const COOKIE_SECRET = 'test-secret-at-least-32-characters';
process.env.COOKIE_SECRET = COOKIE_SECRET;
process.env.SESSION_SECRET = 'test-session-secret-32-chars!!';
process.env.NODE_ENV = 'test';
delete process.env.MAIN_FRONTEND_URL;

const {
  buildRobotsTxt,
  buildSeoLocals,
  isPrivatePath,
  mainSiteBaseUrl,
  mainSitePathFor,
  sanitizeRobotsDirective
} = require('../src/lib/seo-meta');

function signedTokenCookie(value = 'token:test') {
  return 'token=' + encodeURIComponent('s:' + signature.sign(value, COOKIE_SECRET));
}

function baseTenant(overrides = {}) {
  return {
    id: 2,
    name: 'Acme Timebank',
    slug: 'acme',
    tagline: 'Neighbours helping neighbours',
    modules: { feed: true, listings: true },
    features: {},
    branding: {
      tagline: 'Neighbours helping neighbours',
      og_image_url: 'https://api.example.test/uploads/acme/share.png'
    },
    seo: { meta_title: 'Acme Timebank' },
    settings: {},
    ...overrides
  };
}

function headOf(html) {
  return String(html).split('</head>')[0];
}

describe('seo-meta library', () => {
  const t = (key, params = {}) => (key === 'home.description'
    ? `Accessible version of ${params.community}`
    : `[${key}]`);

  it('builds the main-site base the way React serves a community', () => {
    expect(mainSiteBaseUrl({ slug: 'acme' })).toBe('https://app.project-nexus.ie/acme');
    expect(mainSiteBaseUrl({ slug: 'acme', domain: 'https://acme.example/' })).toBe('https://acme.example');
    expect(mainSiteBaseUrl({ slug: 'stratford', parent_domain: 'uk.timebank.global' }))
      .toBe('https://uk.timebank.global/stratford');
    expect(mainSiteBaseUrl({ slug: 'acme' }, 'https://main.example.test/')).toBe('https://main.example.test/acme');
    expect(mainSiteBaseUrl({})).toBe('');
  });

  it('maps only paths with a known main-site equivalent', () => {
    expect(mainSitePathFor('/')).toBe('/');
    // Sign-in-only on the main site: never a canonical target.
    expect(mainSitePathFor('/listings/42')).toBeNull();
    expect(mainSitePathFor('/events/')).toBeNull();
    expect(mainSitePathFor('/members')).toBeNull();
    expect(mainSitePathFor('/legal/privacy')).toBe('/privacy');
    expect(mainSitePathFor('/blog/community-news')).toBe('/blog/community-news');
    expect(mainSitePathFor('/listings/42/edit')).toBeNull();
    expect(mainSitePathFor('/cookies')).toBeNull();
    expect(mainSitePathFor('/dashboard')).toBeNull();
  });

  it('treats auth, account and form pages as private', () => {
    for (const path of ['/login', '/register', '/dashboard', '/settings/privacy', '/messages/4', '/events/9/edit', '/groups/new', '/search']) {
      expect(isPrivatePath(path)).toBe(true);
    }
    for (const path of ['/', '/about', '/listings', '/events/9', '/blog/news']) {
      expect(isPrivatePath(path)).toBe(false);
    }
  });

  it('accepts only plausible robots directives', () => {
    expect(sanitizeRobotsDirective('NOINDEX,  nofollow')).toBe('noindex, nofollow');
    expect(sanitizeRobotsDirective('noindex\r\nSet-Cookie: x=1')).toBe('');
    expect(sanitizeRobotsDirective('')).toBe('');
  });

  it('canonicalises a page with a main-site equivalent to the main site, everything else to itself', () => {
    const mapped = buildSeoLocals({
      tenant: baseTenant(), t, serviceName: 'Svc', routePath: '/blog/news',
      visiblePath: '/acme/accessible/blog/news', host: 'accessible.example.test'
    });
    expect(mapped.seoCanonicalUrl).toBe('https://app.project-nexus.ie/acme/blog/news');

    const signInOnly = buildSeoLocals({
      tenant: baseTenant(), t, serviceName: 'Svc', routePath: '/listings/7',
      visiblePath: '/acme/accessible/listings/7', host: 'accessible.example.test'
    });
    expect(signInOnly.seoCanonicalUrl).toBe('https://accessible.example.test/acme/accessible/listings/7');

    const home = buildSeoLocals({
      tenant: baseTenant({ domain: 'acme.example' }), t, serviceName: 'Svc', routePath: '/',
      visiblePath: '/', host: 'accessible.acme.example'
    });
    expect(home.seoCanonicalUrl).toBe('https://acme.example/');

    const own = buildSeoLocals({
      tenant: baseTenant(), t, serviceName: 'Svc', routePath: '/cookies',
      visiblePath: '/acme/accessible/cookies/', host: 'accessible.example.test'
    });
    expect(own.seoCanonicalUrl).toBe('https://accessible.example.test/acme/accessible/cookies');
  });

  it('chooses the description the way React PageMeta does, with a translated fallback', () => {
    const admin = buildSeoLocals({ tenant: baseTenant({ settings: { seo_meta_description: 'Admin text' }, seo: { meta_description: 'Tenant text' } }), t, routePath: '/events' });
    expect(admin.seoDescription).toBe('Admin text');
    const tenantSeo = buildSeoLocals({ tenant: baseTenant({ seo: { meta_description: 'Tenant text' } }), t, routePath: '/events' });
    expect(tenantSeo.seoDescription).toBe('Tenant text');
    const home = buildSeoLocals({ tenant: baseTenant({ settings: { seo_meta_description: 'Admin text' }, seo: { meta_description: 'Tenant text' } }), t, routePath: '/' });
    expect(home.seoDescription).toBe('Tenant text');
    const bare = buildSeoLocals({ tenant: { id: 3, slug: 'bare', name: 'Bare Bank' }, t, routePath: '/' });
    expect(bare.seoDescription).toBe('Accessible version of Bare Bank');
    const platform = buildSeoLocals({ tenant: {}, t, serviceName: 'Svc', routePath: '/' });
    expect(platform.seoDescription).toBe('[seo.description]');
  });

  it('uses the community name (or its /admin/seo title suffix) as the site name', () => {
    expect(buildSeoLocals({ tenant: baseTenant(), t, serviceName: 'Svc', routePath: '/' }).seoSiteName).toBe('Acme Timebank');
    expect(buildSeoLocals({ tenant: baseTenant({ settings: { seo_title_suffix: ' | Acme TB' } }), t, serviceName: 'Svc', routePath: '/' }).seoSiteName).toBe('Acme TB');
    expect(buildSeoLocals({ tenant: {}, t, serviceName: 'Svc', routePath: '/' }).seoSiteName).toBe('Svc');
  });

  it('honours the community-wide robots directive and private pages', () => {
    const off = buildSeoLocals({ tenant: baseTenant({ seo: { robots_directive: 'noindex, nofollow' } }), t, routePath: '/about' });
    expect(off.seoRobots).toBe('noindex, nofollow');
    const on = buildSeoLocals({ tenant: baseTenant(), t, routePath: '/about' });
    expect(on.seoRobots).toBe('');
    const signedIn = buildSeoLocals({ tenant: baseTenant(), t, routePath: '/about', isAuthenticated: true });
    expect(signedIn.seoRobots).toBe('noindex, nofollow');
  });

  it('writes a robots.txt that keeps crawlers out of signed-in areas on both URL shapes', () => {
    const body = buildRobotsTxt();
    expect(body).toMatch(/^User-agent: \*\n/);
    expect(body).not.toContain('Disallow: /login');
    expect(body).not.toMatch(/Sitemap:/);

    // Read it the way Google does: longest matching rule wins, Allow wins a tie.
    const rules = body.split('\n')
      .map((line) => /^(Allow|Disallow): (\S+)$/.exec(line))
      .filter(Boolean)
      .map(([, kind, path]) => {
        const anchored = path.endsWith('$');
        const core = (anchored ? path.slice(0, -1) : path)
          .split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
        return { allow: kind === 'Allow', path, re: new RegExp(`^${core}${anchored ? '$' : ''}`) };
      });
    const allowed = (url) => {
      let best = null;
      for (const rule of rules) {
        if (!rule.re.test(url)) continue;
        if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) best = rule;
      }
      return !best || best.allow;
    };

    for (const url of ['/dashboard', '/dashboard?tab=1', '/me', '/me/profile', '/messages/4', '/acme/accessible/messages/4', '/acme/accessible/me']) {
      expect([url, allowed(url)]).toEqual([url, false]);
    }
    // A bare "/me" prefix used to block these.
    for (const url of ['/', '/members', '/meetings', '/acme/accessible/members', '/searching', '/login', '/about']) {
      expect([url, allowed(url)]).toEqual([url, true]);
    }
  });
});

describe('seo-meta home title and language tag', () => {
  const t = (key) => key;

  it('uses the community meta title as the whole home title, and only on home', () => {
    const tenant = baseTenant({ seo: { meta_title: 'Acme Timebank | Swap skills locally' } });
    expect(buildSeoLocals({ tenant, t, routePath: '/' }).seoHomeTitle).toBe('Acme Timebank | Swap skills locally');
    expect(buildSeoLocals({ tenant, t, routePath: '/about' }).seoHomeTitle).toBe('');
    expect(buildSeoLocals({ tenant: baseTenant({ seo: {} }), t, routePath: '/' }).seoHomeTitle).toBe('');
  });

  it('maps the page language to an Open Graph locale as the main site does', () => {
    expect(buildSeoLocals({ tenant: baseTenant(), t, locale: 'ga' }).seoOgLocale).toBe('ga_IE');
    expect(buildSeoLocals({ tenant: baseTenant(), t, locale: 'ar' }).seoOgLocale).toBe('ar_001');
    expect(buildSeoLocals({ tenant: baseTenant(), t, locale: 'xx' }).seoOgLocale).toBe('en_GB');
  });
});

describe('seo-meta verification, keywords and organisation data', () => {
  const t = (key) => key;

  it('emits only the verification token, as the main site does', () => {
    const tenant = baseTenant({ settings: {
      seo_google_verification: '<meta name="google-site-verification" content="abc123" />',
      seo_bing_verification: 'msvalidate.01=XYZ789',
      seo_meta_keywords: 'timebank, skills'
    } });
    const locals = buildSeoLocals({ tenant, t, routePath: '/about' });
    expect(locals.seoGoogleVerification).toBe('abc123');
    expect(locals.seoBingVerification).toBe('XYZ789');
    expect(locals.seoKeywords).toBe('timebank, skills');
  });

  it('describes the community as the main site does, on the home page only', () => {
    const tenant = baseTenant({
      domain: 'acme.example',
      settings: { seo_organization_type: 'LocalBusiness' },
      branding: { tagline: 'Neighbours </script> helping', logo_url: 'https://api.example.test/logo.png' },
      social: { facebook: 'https://facebook.com/acme', twitter: 'javascript:alert(1)' }
    });
    const home = buildSeoLocals({ tenant, t, routePath: '/' });
    expect(home.seoOrganizationJsonLd).not.toContain('</script>');
    const org = JSON.parse(home.seoOrganizationJsonLd);
    expect(org['@type']).toBe('LocalBusiness');
    expect(org['@id']).toBe('https://acme.example/#org');
    expect(org.sameAs).toEqual(['https://facebook.com/acme']);
    expect(buildSeoLocals({ tenant, t, routePath: '/about' }).seoOrganizationJsonLd).toBe('');
  });
});

describe('seo metadata on rendered accessible pages', () => {
  let app;
  let api;

  beforeAll(() => {
    app = require('../src/server');
    api = require('../src/lib/api');
  });

  beforeEach(() => {
    api.getTenants.mockResolvedValue({ data: [{ id: 2, name: 'Acme Timebank', slug: 'acme' }] });
    api.getTenantBootstrap.mockResolvedValue({ data: baseTenant() });
  });

  it('serves robots.txt instead of a 404', async () => {
    const response = await request(app).get('/robots.txt');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toMatch(/text\/plain/);
    expect(response.text).toContain('User-agent: *');
    expect(response.text).toContain('Disallow: /*/accessible/dashboard');
  });

  it('emits title, description, canonical, Open Graph and Twitter tags for a community page', async () => {
    const response = await request(app).get('/acme/accessible/about');
    expect(response.status).toBe(200);
    const head = headOf(response.text);

    expect(head).toMatch(/<title>[^<]+ - Acme Timebank<\/title>/);
    expect(head).not.toContain('Project NEXUS Accessible</title>');
    // /about describes itself (about.description) rather than repeating the
    // community-wide tagline (second SEO pass, tests/seo-page-meta.test.js).
    expect(head).toMatch(/<meta name="description" content="Acme Timebank is [^"]+">/);
    expect(head).toContain('<link rel="canonical" href="https://app.project-nexus.ie/acme/about">');
    expect(head).toContain('<meta property="og:type" content="website">');
    expect(head).toContain('<meta property="og:site_name" content="Acme Timebank">');
    expect(head).toMatch(/<meta property="og:title" content="[^"]+ - Acme Timebank">/);
    expect(head).toMatch(/<meta property="og:description" content="Acme Timebank is [^"]+">/);
    expect(head).toContain('<meta property="og:url" content="https://app.project-nexus.ie/acme/about">');
    expect(head).toContain('<meta property="og:image" content="https://api.example.test/uploads/acme/share.png">');
    expect(head).toContain('<meta name="twitter:card" content="summary_large_image">');
    expect(head).not.toContain('name="robots"');
    expect(response.headers['x-robots-tag']).toBeUndefined();
    expect(head).not.toContain('govuk-opengraph-image');
  });

  it('respects the community switching Open Graph, Twitter cards and canonical links off', async () => {
    api.getTenantBootstrap.mockResolvedValue({
      data: baseTenant({ settings: { seo_open_graph: false, seo_twitter_cards: '0', seo_canonical_urls: false } })
    });
    const head = headOf((await request(app).get('/acme/accessible/about')).text);
    expect(head).not.toContain('property="og:');
    expect(head).not.toContain('name="twitter:');
    expect(head).not.toContain('rel="canonical"');
    expect(head).toContain('<meta name="description"');
  });

  it('is noindex, by meta tag and header, when the community has switched indexing off', async () => {
    api.getTenantBootstrap.mockResolvedValue({
      data: baseTenant({ seo: { meta_title: 'Acme Timebank', robots_directive: 'noindex, nofollow' } })
    });
    const response = await request(app).get('/acme/accessible/about');
    expect(response.status).toBe(200);
    expect(headOf(response.text)).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('is noindex on the sign-in page, which React also marks noIndex', async () => {
    const response = await request(app).get('/acme/accessible/login');
    expect(response.status).toBe(200);
    const head = headOf(response.text);
    expect(head).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(head).toMatch(/<title>[^<]+ - Acme Timebank<\/title>/);
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('is noindex for any page rendered to a signed-in member', async () => {
    const response = await request(app)
      .get('/acme/accessible/about')
      .set('Cookie', signedTokenCookie());
    expect(response.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('canonicalises to the community\'s own domain on its own accessible domain', async () => {
    api.getTenantBootstrap.mockResolvedValue({
      data: baseTenant({ domain: 'acme.example', accessible_domain: 'accessible.acme.example' })
    });
    const response = await request(app).get('/about').set('Host', 'accessible.acme.example');
    expect(response.status).toBe(200);
    expect(headOf(response.text)).toContain('<link rel="canonical" href="https://acme.example/about">');
  });
});
