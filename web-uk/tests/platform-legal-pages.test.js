// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The PLATFORM's own legal documents (27 Oct 2026 parity).
 *
 * React publishes Project NEXUS's Platform Terms of Service, Platform Privacy
 * Policy and Platform Disclaimer at /platform/terms, /platform/privacy and
 * /platform/disclaimer to signed-out visitors, links them from its legal hub and
 * from the licence strip of its footer. The accessible frontend had none of them:
 * each address answered "Page not found", and its licence strip pointed at the
 * community's policies instead.
 *
 * These are distinct from each community's own terms and privacy policy, which
 * stay at /legal/*. The body text is the authoritative English version generated
 * from React's page files; the chrome is translated.
 */

const path = require('node:path');
const fs = require('node:fs');
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
  getLegalVersions: jest.fn().mockResolvedValue({ data: { versions: [] } }),
  getHelpFaqs: jest.fn().mockResolvedValue({ data: [] }),
  getBlogPosts: jest.fn().mockResolvedValue({ data: { items: [] } }),
  getPublicEvents: jest.fn().mockResolvedValue({ data: [], meta: { has_more: false } })
}));

process.env.COOKIE_SECRET = 'test-secret-at-least-32-characters';
process.env.SESSION_SECRET = 'test-session-secret-32-chars!!';
process.env.NODE_ENV = 'test';
delete process.env.MAIN_FRONTEND_URL;

const { createTranslator, SUPPORTED_LOCALES } = require('../src/lib/localization');
const { cache } = require('../src/lib/cache');
const { buildSeoLocals } = require('../src/lib/seo-meta');
const { isExempt } = require('../src/middleware/legal-gate');

const BASE = '/acme/accessible';
const DOCS = {
  terms: { path: '/platform/terms', iso: '2026-03-01', body: 'Community Operators are' },
  privacy: { path: '/platform/privacy', iso: '2026-08-27', body: '21 Fitzwilliam Square South' },
  disclaimer: { path: '/platform/disclaimer', iso: '2026-03-01', body: 'one euro (€1.00)' }
};

function tenant(settings = {}) {
  return {
    id: 2,
    name: 'Acme Timebank',
    slug: 'acme',
    modules: { feed: true, listings: true },
    features: {},
    branding: {},
    seo: {},
    settings
  };
}

function decode(html) {
  return html
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

describe('generated platform legal text', () => {
  // eslint-disable-next-line global-require
  const { build, serialise } = require('../scripts/build-platform-legal-text');

  it('🔴 is current with React\'s three page files', () => {
    // One source for a legal document both frontends publish. If this fails,
    // run `npm --prefix web-uk run build:platform-legal-text`.
    const committed = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'lib', 'generated', 'platform-legal-text.json'),
      'utf8'
    );
    expect(committed).toBe(serialise(build()));
  });

  it('carries every section, with a translated heading for each in all eleven languages', () => {
    const { platformLegalDocument } = require('../src/lib/platform-legal-text');
    const expected = { terms: 12, privacy: 10, disclaimer: 8 };
    for (const [key, count] of Object.entries(expected)) {
      const doc = platformLegalDocument(key);
      expect(doc.sections).toHaveLength(count);
      for (const locale of SUPPORTED_LOCALES) {
        const t = createTranslator(locale);
        for (const section of doc.sections) {
          const heading = t(`govuk_alpha_platform_legal.documents.${key}.sections.${section.id}`);
          expect(heading).not.toContain('govuk_alpha_platform_legal.');
          expect(heading.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it('uses React\'s own translations, not English copies, for the chrome', () => {
    const reactDe = require('../../react-frontend/public/locales/de/legal.json');
    const de = createTranslator('de');
    expect(de('govuk_alpha_platform_legal.documents.terms.title')).toBe(reactDe.platform_terms.title);
    expect(de('govuk_alpha_platform_legal.authoritative_notice_body')).toBe(reactDe.platform.authoritative_notice_body);
    expect(de('govuk_alpha_platform_legal.documents.terms.title')).not.toBe(
      createTranslator('en')('govuk_alpha_platform_legal.documents.terms.title')
    );
  });
});

describe('platform legal pages over HTTP', () => {
  let app;
  let api;

  beforeAll(() => {
    app = require('../src/server');
    api = require('../src/lib/api');
  });

  beforeEach(() => {
    cache.clear();
    jest.clearAllMocks();
    api.getTenants.mockResolvedValue({ data: [{ id: 2, name: 'Acme Timebank', slug: 'acme' }] });
    api.getTenantBootstrap.mockResolvedValue({ data: tenant() });
  });

  describe.each(['en', 'de'])('in %s', (locale) => {
    const t = createTranslator(locale);
    const get = (pathname) => request(app).get(`${BASE}${pathname}?locale=${locale}`);

    it.each(Object.keys(DOCS))('serves %s to a signed-out visitor with its headings and body', async (key) => {
      const doc = DOCS[key];
      const response = await get(doc.path);
      expect(response.status).toBe(200);
      expect(response.headers.location).toBeUndefined();
      const html = decode(response.text);

      // No raw keys anywhere, including the footer and the hub link.
      expect(response.text).not.toContain('govuk_alpha_platform_legal.');

      expect(html).toContain(`<h1 class="govuk-heading-xl">${t(`govuk_alpha_platform_legal.documents.${key}.title`)}</h1>`);
      expect(html).toContain(t(`govuk_alpha_platform_legal.documents.${key}.subtitle`));
      expect(html).toContain(t('govuk_alpha_platform_legal.provider_notice_title'));
      expect(html).toContain(t('govuk_alpha_platform_legal.authoritative_notice_body'));
      expect(html).toContain(t('govuk_alpha_platform_legal.provider_notice_body', { tenant: 'Acme Timebank' }));
      expect(response.text).toContain(`<time datetime="${doc.iso}">`);

      // Every section: a numbered heading with an anchor, and a contents link to it.
      const { platformLegalDocument } = require('../src/lib/platform-legal-text');
      platformLegalDocument(key).sections.forEach((section, index) => {
        const heading = t(`govuk_alpha_platform_legal.documents.${key}.sections.${section.id}`);
        expect(html).toContain(`id="${section.id}">${index + 1}. ${heading}</h2>`);
        expect(html).toContain(`href="#${section.id}">${heading}</a>`);
      });

      // The authoritative English body is present.
      expect(html).toContain(doc.body);

      // Links to the other two platform documents, the community's legal hub and contact page.
      for (const [other, otherDoc] of Object.entries(DOCS)) {
        if (other === key) continue;
        expect(response.text).toContain(`href="${BASE}${otherDoc.path}"`);
      }
      expect(response.text).toContain(`href="${BASE}/legal"`);
      expect(response.text).toContain(`href="${BASE}/contact"`);
      expect(response.text).toContain('href="https://project-nexus.ie"');
    });

    it('marks the English body as English only when the page is in another language', async () => {
      const response = await get('/platform/terms');
      if (locale === 'en') {
        expect(response.text).not.toContain('<div lang="en"');
      } else {
        expect(response.text).toContain(`<html lang="${locale}"`);
        expect(response.text).toContain('<div lang="en" dir="ltr">');
      }
    });
  });

  it('keeps the body left-to-right inside a right-to-left Arabic page', async () => {
    const response = await request(app).get(`${BASE}/platform/privacy?locale=ar`);
    expect(response.status).toBe(200);
    expect(response.text).toContain('dir="rtl"');
    expect(response.text).toContain('<div lang="en" dir="ltr">');
    expect(response.text).not.toContain('govuk_alpha_platform_legal.');
  });

  it('renders inline emphasis and links from the React markup, escaped', async () => {
    const terms = await request(app).get(`${BASE}/platform/terms`);
    expect(terms.text).toContain('<strong>Website:</strong> <a class="govuk-link" href="https://project-nexus.ie" rel="noopener noreferrer">project-nexus.ie</a>');
    const disclaimer = await request(app).get(`${BASE}/platform/disclaimer`);
    expect(disclaimer.text).toContain('Operators <em>may</em> choose');
    const privacy = await request(app).get(`${BASE}/platform/privacy`);
    expect(privacy.text).toContain('<strong>Data Protection Commission (Ireland)</strong><br>21 Fitzwilliam Square South');
  });

  it('lists the platform documents on the legal hub, apart from the community\'s', async () => {
    const response = await request(app).get(`${BASE}/legal`);
    expect(response.status).toBe(200);
    const t = createTranslator('en');
    expect(response.text).toContain(t('govuk_alpha_platform_legal.hub.section_title'));
    for (const doc of Object.values(DOCS)) {
      expect(response.text).toContain(`href="${BASE}${doc.path}"`);
    }
    // The community's own documents are still there.
    expect(response.text).toContain(`href="${BASE}/legal/terms"`);
  });

  it('🔴 links the platform terms and privacy policy from the footer licence strip, as React does', async () => {
    const response = await request(app).get(`${BASE}/about`);
    expect(response.status).toBe(200);
    const t = createTranslator('en');
    expect(response.text).toContain(`href="${BASE}/platform/terms">${t('govuk_alpha_platform_legal.hub.terms')}</a>`);
    expect(response.text).toContain(`href="${BASE}/platform/privacy">${t('govuk_alpha_platform_legal.hub.privacy')}</a>`);
    // AGPL attribution is untouched.
    expect(decode(response.text)).toContain(t('footer.agpl_notice'));
  });

  it('lists all three in the accessible sitemap when the accessible site is primary', async () => {
    api.getTenantBootstrap.mockResolvedValue({ data: tenant({ seo_primary_site: 'accessible' }) });
    const response = await request(app).get(`${BASE}/sitemap.xml`);
    expect(response.status).toBe(200);
    for (const doc of Object.values(DOCS)) {
      expect(response.text).toContain(`${BASE}${doc.path}</loc>`);
    }
  });
});

describe('platform legal pages: canonical and the legal-acceptance gate', () => {
  it('canonicalises to the same React path in standard mode', () => {
    for (const doc of Object.values(DOCS)) {
      const locals = buildSeoLocals({
        tenant: tenant(),
        t: (key) => key,
        routePath: doc.path,
        visiblePath: `${BASE}${doc.path}`,
        host: 'accessible.project-nexus.ie'
      });
      expect(locals.seoCanonicalUrl).toBe(`https://app.project-nexus.ie/acme${doc.path}`);
      expect(locals.seoRobots).toBe('');
    }
  });

  it('never holds them behind the legal-acceptance gate', () => {
    for (const doc of Object.values(DOCS)) expect(isExempt(doc.path)).toBe(true);
  });
});
