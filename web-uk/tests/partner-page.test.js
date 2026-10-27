// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Timebank Ireland's "Partner With Us" page.
 *
 * React serves /partner only for the hour-timebank community
 * (AppRoutes.tsx: <TenantSlugGate slug="hour-timebank"><PartnerPage /></TenantSlugGate>),
 * and links it from the Related Pages strip, the social prescribing call to action
 * ("View All Partnerships"), the timebanking guide and the community-pages footer.
 * These pin the accessible copy: the same sections and images in English and another
 * language, no raw translation keys, the ordinary 404 for any other community, and
 * every link React has back in place.
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
  getPublicEvents: jest.fn().mockResolvedValue({ data: [], meta: { has_more: false } }),
  getLegalVersions: jest.fn().mockResolvedValue({ data: { versions: [] } }),
  getBlogPosts: jest.fn().mockResolvedValue({ data: { items: [] } })
}));

process.env.COOKIE_SECRET = 'test-secret-at-least-32-characters';
process.env.SESSION_SECRET = 'test-session-secret-32-chars!!';
process.env.NODE_ENV = 'test';
delete process.env.MAIN_FRONTEND_URL;

const { translate } = require('../src/lib/localization');

const TBI = { id: 2, name: 'hOUR Timebank', slug: 'hour-timebank', modules: {}, features: {}, settings: {}, seo: {} };
const OTHER = { id: 3, name: 'Acme Timebank', slug: 'acme', modules: {}, features: {}, settings: {}, seo: {} };

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const PAGE_KEYS = [
  'page.page_title',
  'page.hero_subtitle',
  'page.together_banner_heading',
  'page.tbuk_para1',
  'page.tbuk_para2',
  'page.tech_partner_label',
  'page.tech_partner_heading',
  'page.tech_partner_description',
  'page.funding_gap_heading',
  'page.funding_gap_para2',
  'page.why_partner_heading',
  'page.impact_card_0_highlight',
  'page.impact_card_2_description',
  'page.our_partners_heading',
  'page.partnership_opportunities_heading',
  'page.partnership_type_3_title',
  'page.partnership_type_3_description',
  'page.learn_more_heading',
  'page.learn_more_2_description',
  'page.cta_heading',
  'page.cta_contact',
  'page.cta_view_plan'
];

describe('Partner With Us page', () => {
  let app;
  let api;

  beforeAll(() => {
    app = require('../src/server');
    api = require('../src/lib/api');
  });

  beforeEach(() => {
    api.getTenants.mockResolvedValue({ data: [{ id: 2, name: TBI.name, slug: TBI.slug }, { id: 3, name: OTHER.name, slug: OTHER.slug }] });
    api.getTenantBootstrap.mockImplementation(async ({ slug } = {}) => ({ data: slug === 'acme' ? OTHER : TBI }));
  });

  describe.each(['en', 'fr'])('in %s', (locale) => {
    const t = (key) => translate(locale, `govuk_alpha_partner.${key}`);

    it('renders every section for hour-timebank, with no raw keys', async () => {
      const response = await request(app).get(`/hour-timebank/accessible/partner?locale=${locale}`);
      expect(response.status).toBe(200);
      for (const key of PAGE_KEYS) {
        const text = t(key);
        expect(text).not.toMatch(/^govuk_alpha_partner\./);
        expect(response.text).toContain(escapeHtml(text));
      }
      // The organisation's name stays as it is in every language.
      expect(response.text).toContain('Timebanking UK');
      expect(response.text).not.toMatch(/govuk_alpha_partner\.[a-z_]/);
      expect(response.text).not.toMatch(/\bpage\.[a-z_]+_(?:title|heading|para\d|description)\b/);
    });
  });

  it('is genuinely translated, not English copies', () => {
    expect(translate('fr', 'govuk_alpha_partner.page.page_title')).not.toBe(translate('en', 'govuk_alpha_partner.page.page_title'));
    expect(translate('ga', 'govuk_alpha_partner.page.cta_heading')).not.toBe(translate('en', 'govuk_alpha_partner.page.cta_heading'));
  });

  it('shows React\'s three images with their descriptions, served by this frontend', async () => {
    const response = await request(app).get('/hour-timebank/accessible/partner');
    expect(response.text).toContain('src="/images/Timebanking-UK-and-Timebank-Ireland-Partners.webp"');
    expect(response.text).toContain('src="/images/project-nexus-logo.webp"');
    expect(response.text).toContain('src="/images/timebank_ireland_west_cork_partnership.webp"');
    expect(response.text).toContain(`alt="${escapeHtml(translate('en', 'govuk_alpha_partner.page.together_banner_alt'))}"`);
    expect(response.text).toContain(`alt="${escapeHtml(translate('en', 'govuk_alpha_partner.page.partners_banner_alt'))}"`);
  });

  it('links Learn More, the call to action and the related pages where React does', async () => {
    const response = await request(app).get('/hour-timebank/accessible/partner');
    expect(response.text).toContain('href="/hour-timebank/accessible/impact-summary"');
    expect(response.text).toContain('href="/hour-timebank/accessible/strategic-plan"');
    expect(response.text).toContain('href="/hour-timebank/accessible/guide"');
    expect(response.text).toContain('href="/hour-timebank/accessible/contact"');
    expect(response.text).toContain('href="/hour-timebank/accessible/about"');
    // Related pages: the other community pages, never this one.
    expect(response.text).toContain('href="/hour-timebank/accessible/social-prescribing"');
    expect(response.text).toContain('href="/hour-timebank/accessible/impact-report"');
    expect(response.text).not.toContain(escapeHtml(translate('en', 'govuk_alpha_partner.related.link_partner_description')));
  });

  it('is the ordinary 404 for any other community', async () => {
    const response = await request(app).get('/acme/accessible/partner');
    expect(response.status).toBe(404);
    expect(response.text).not.toContain(escapeHtml(translate('en', 'govuk_alpha_partner.page.funding_gap_heading')));
  });

  it('puts "View All Partnerships" back on the social prescribing page', async () => {
    const response = await request(app).get('/hour-timebank/accessible/social-prescribing');
    expect(response.text).toContain(escapeHtml(translate('en', 'govuk_alpha_partner.links.view_all_partnerships')));
    expect(response.text).toMatch(/<a class="govuk-button govuk-button--secondary" href="\/hour-timebank\/accessible\/partner"/);
  });

  it.each(['/impact-summary', '/impact-report', '/strategic-plan', '/social-prescribing'])('lists Partner With Us in the related pages of %s', async (path) => {
    const response = await request(app).get(`/hour-timebank/accessible${path}`);
    expect(response.text).toContain('href="/hour-timebank/accessible/partner"');
    expect(response.text).toContain(escapeHtml(translate('en', 'govuk_alpha_partner.related.link_partner_description')));
  });

  it('links the page from the timebanking guide for hour-timebank only', async () => {
    const tbi = await request(app).get('/hour-timebank/accessible/guide');
    expect(tbi.text).toContain('href="/hour-timebank/accessible/partner"');
    expect(tbi.text).toContain(escapeHtml(translate('en', 'govuk_alpha_partner.links.partner_with_us')));
    const other = await request(app).get('/acme/accessible/guide');
    expect(other.status).toBe(200);
    expect(other.text).not.toContain('/acme/accessible/partner');
  });

  it('lists the page in the footer for hour-timebank only', async () => {
    const tbi = await request(app).get('/hour-timebank/accessible/about');
    expect(tbi.text).toContain('href="/hour-timebank/accessible/partner"');
    expect(tbi.text).toContain(escapeHtml(translate('en', 'govuk_alpha_partner.nav.partner_with_us')));
    const other = await request(app).get('/acme/accessible/about');
    expect(other.text).not.toContain('/acme/accessible/partner');
  });

  it('describes the page with its own text and points the canonical at the main site', async () => {
    const response = await request(app).get('/hour-timebank/accessible/partner');
    const head = response.text.split('</head>')[0];
    expect(head).toContain('<link rel="canonical" href="https://app.project-nexus.ie/hour-timebank/partner">');
    expect(head).toContain(escapeHtml(translate('en', 'govuk_alpha_partner.page.meta_description')).slice(0, 60));
  });
});

describe('Partner With Us in the sitemap', () => {
  const { buildSitemapXml } = require('../src/lib/accessible-sitemap');

  it('is listed for hour-timebank on an accessible-primary community, and not for another', async () => {
    const settings = { seo_primary_site: 'accessible' };
    const tbi = await buildSitemapXml({ tenant: { ...TBI, settings }, protocol: 'https', host: 'accessible.example.test', prefix: '' });
    expect(tbi).toContain('<loc>https://accessible.example.test/partner</loc>');
    const other = await buildSitemapXml({ tenant: { ...OTHER, settings }, protocol: 'https', host: 'accessible.example.test', prefix: '' });
    expect(other).not.toContain('/partner</loc>');
  });
});
