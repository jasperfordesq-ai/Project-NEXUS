// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The Partner API developer documentation (27 Oct 2026, owner-approved parity).
 *
 * React serves four public pages — /developers, /developers/auth,
 * /developers/endpoints, /developers/webhooks (DevelopersHomePage,
 * DevelopersAuthPage, DevelopersEndpointsPage, DevelopersWebhooksPage) — to
 * signed-out visitors. The accessible frontend had none of them: each address
 * answered "Page not found". These tests pin the same content, the code samples
 * as literal text, and the links between the four pages.
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
  getLegalVersions: jest.fn().mockResolvedValue({ data: { versions: [] } }),
  getHelpFaqs: jest.fn().mockResolvedValue({ data: [] }),
  getBlogPosts: jest.fn().mockResolvedValue({ data: { items: [] } }),
  getPublicEvents: jest.fn().mockResolvedValue({ data: [], meta: { has_more: false } })
}));

process.env.COOKIE_SECRET = 'test-secret-at-least-32-characters';
process.env.SESSION_SECRET = 'test-session-secret-32-chars!!';
process.env.NODE_ENV = 'test';
delete process.env.MAIN_FRONTEND_URL;

const { createTranslator } = require('../src/lib/localization');
const { cache } = require('../src/lib/cache');

const BASE = '/acme/accessible';
const PAGES = ['/developers', '/developers/auth', '/developers/endpoints', '/developers/webhooks'];

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
    .replace(/&#92;/g, '\\')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function codeBlocks(html) {
  return Array.from(html.matchAll(/<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/g), (m) => decode(m[1]));
}

describe('developer documentation pages', () => {
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
    const get = (path) => request(app).get(`${BASE}${path}?locale=${locale}`);

    it('serves all four pages to a signed-out visitor, with no raw translation keys', async () => {
      for (const path of PAGES) {
        const response = await get(path);
        expect(response.status).toBe(200);
        expect(response.text).not.toContain('govuk_alpha_developers.');
        expect(response.headers.location).toBeUndefined();
      }
    });

    it('home: hero, the four features, request access and links to the three reference pages', async () => {
      const response = await get('/developers');
      const html = decode(response.text);

      expect(html).toContain(`<h1 class="govuk-heading-xl">${t('govuk_alpha_developers.hero_title')}</h1>`);
      expect(html).toContain(t('govuk_alpha_developers.hero_subtitle'));
      for (const feature of ['oauth', 'curated', 'webhooks', 'rate_limit']) {
        expect(html).toContain(t(`govuk_alpha_developers.feature_${feature}_title`));
        expect(html).toContain(t(`govuk_alpha_developers.feature_${feature}_body`));
      }
      expect(html).toContain(t('govuk_alpha_developers.request_access_body'));
      expect(response.text).toMatch(new RegExp(`href="${BASE}/contact"[^>]*class="govuk-button`));
      expect(html).toContain(`<h2 class="govuk-heading-m">${t('govuk_alpha_developers.nav.overview')}</h2>`);
      expect(response.text).toContain(`href="${BASE}/developers/auth"`);
      expect(response.text).toContain(`href="${BASE}/developers/endpoints"`);
      expect(response.text).toContain(`href="${BASE}/developers/webhooks"`);
    });

    it('authentication: three steps and the curl and JavaScript samples, word for word', async () => {
      const response = await get('/developers/auth');
      const html = decode(response.text);

      expect(html).toContain(`<h1 class="govuk-heading-xl">${t('govuk_alpha_developers.nav.auth')}</h1>`);
      expect(html).toContain(t('govuk_alpha_developers.auth_intro'));
      for (const step of [1, 2, 3]) {
        expect(html).toContain(t(`govuk_alpha_developers.auth_step${step}_title`));
        expect(html).toContain(t(`govuk_alpha_developers.auth_step${step}_body`));
      }
      expect(html).toContain(t('govuk_alpha_developers.curl_example'));
      expect(html).toContain(t('govuk_alpha_developers.js_example'));

      const blocks = codeBlocks(response.text);
      expect(blocks).toHaveLength(2);
      expect(blocks[0]).toContain('curl -X POST https://api.project-nexus.ie/api/partner/v1/oauth/token \\');
      expect(blocks[0]).toContain('"grant_type": "client_credentials",');
      expect(blocks[1]).toContain('async function getToken() {');
      expect(blocks[1]).toContain('headers: { Authorization: `Bearer ${accessToken}` },');
      expect(response.text).toContain(`href="${BASE}/developers"`);
    });

    it('endpoints: a GOV.UK table of the ten partner endpoints', async () => {
      const response = await get('/developers/endpoints');
      const html = decode(response.text);

      expect(html).toContain(`<h1 class="govuk-heading-xl">${t('govuk_alpha_developers.nav.endpoints')}</h1>`);
      expect(html).toContain(t('govuk_alpha_developers.endpoints_intro'));
      expect(response.text).toContain('<table class="govuk-table">');
      for (const label of ['method_label', 'path_label', 'scope_label', 'description_label']) {
        expect(html).toContain(`<th scope="col" class="govuk-table__header">${t(`govuk_alpha_developers.${label}`)}</th>`);
      }
      const rows = response.text.match(/<tr class="govuk-table__row">/g) || [];
      expect(rows).toHaveLength(11); // header + 10 endpoints
      expect(html).toContain('/api/partner/v1/wallet/balance/{userId}');
      expect(html).toContain('wallet.write');
      expect(html).toContain(t('govuk_alpha_developers.endpoint_descriptions.wallet_credit'));
      expect(html).toContain(t('govuk_alpha_developers.endpoint_descriptions.oauth_revoke'));
      expect(response.text).toContain(`href="${BASE}/developers"`);
    });

    it('webhooks: events, subscription, signing and the Node.js and PHP samples', async () => {
      const response = await get('/developers/webhooks');
      const html = decode(response.text);

      expect(html).toContain(`<h1 class="govuk-heading-xl">${t('govuk_alpha_developers.nav.webhooks')}</h1>`);
      for (const key of ['webhooks_intro', 'webhook_events_title', 'webhook_event_wallet_credited',
        'webhook_create_title', 'webhook_create_body', 'webhook_signing_title', 'webhook_signing_body']) {
        expect(html).toContain(t(`govuk_alpha_developers.${key}`));
      }
      const blocks = codeBlocks(response.text);
      expect(blocks).toHaveLength(2);
      expect(blocks[0]).toContain("const sig = req.header('X-Partner-Signature') || '';");
      expect(blocks[1]).toContain("$signature = $_SERVER['HTTP_X_PARTNER_SIGNATURE'] ?? '';");
      expect(blocks[1].startsWith('<?php')).toBe(true);
      expect(response.text).toContain(`href="${BASE}/developers"`);
    });
  });

  it('the German pages really are German, and the code samples are not translated', async () => {
    const en = await request(app).get(`${BASE}/developers/auth?locale=en`);
    const de = await request(app).get(`${BASE}/developers/auth?locale=de`);
    expect(de.text).toContain('Authentifizierung');
    expect(de.text).not.toContain('>Authentication</h1>');
    expect(codeBlocks(de.text)).toEqual(codeBlocks(en.text));
  });

  it('each page describes itself and canonicalises to the same React page', async () => {
    const t = createTranslator('en');
    const expected = {
      '/developers': 'meta_description',
      '/developers/auth': 'auth_intro',
      '/developers/endpoints': 'endpoints_intro',
      '/developers/webhooks': 'webhooks_intro'
    };
    for (const [path, key] of Object.entries(expected)) {
      const response = await request(app).get(`${BASE}${path}`);
      expect(response.text).toContain(`<link rel="canonical" href="https://app.project-nexus.ie/acme${path}">`);
      const description = decode(response.text.match(/<meta name="description" content="([^"]*)"/)[1]);
      expect(t(`govuk_alpha_developers.${key}`).startsWith(description.replace(/…$/, ''))).toBe(true);
    }
  });

  it('lists the four pages in the sitemap when the accessible site is the primary one', async () => {
    api.getTenantBootstrap.mockResolvedValue({ data: tenant({ seo_primary_site: 'accessible' }) });
    const response = await request(app).get(`${BASE}/sitemap.xml`);
    expect(response.status).toBe(200);
    for (const path of PAGES) {
      expect(response.text).toContain(`<loc>http://127.0.0.1${BASE}${path}</loc>`);
    }
  });
});
