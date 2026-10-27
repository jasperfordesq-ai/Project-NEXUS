// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Timebank Ireland's four content pages (owner approval, 27 Oct 2026).
 *
 * React serves /social-prescribing, /impact-summary, /impact-report and
 * /strategic-plan only for the hour-timebank community (TenantSlugGate). These
 * pin the accessible copies: rendered for that community in English and another
 * language with the same headings and figures, no raw translation keys, a 404 for
 * any other community, and the footer and sitemap listing them for it alone.
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

const PAGES = [
  {
    path: '/social-prescribing',
    headings: ['social_prescribing.hero_title', 'social_prescribing.validated_outcomes_heading', 'social_prescribing.referral_pathway_heading', 'social_prescribing.cta_heading'],
    figures: ['16:1', 'social_prescribing.testimonial_quote']
  },
  {
    path: '/impact-summary',
    headings: ['impact_summary.page_title', 'impact_summary.wellbeing_heading', 'impact_summary.public_health_heading', 'impact_summary.strategic_docs_heading'],
    figures: ['€16', '€803K', 'impact_summary.hero_headline']
  },
  {
    path: '/impact-report',
    headings: ['impact_report.hero_title', 'impact_report.toc_sroi', 'impact_report.sroi_breakdown_heading', 'impact_report.toc_recommendations'],
    figures: ['impact_report.sroi_net_social_value_amount', 'impact_report.sroi_ratio_value', 'impact_report.activity_value_3', 'impact_report.case_study_elaine_quote']
  },
  {
    path: '/strategic-plan',
    headings: ['strategic_plan.page_title', 'strategic_plan.toc_swot', 'strategic_plan.pillar_1_title', 'strategic_plan.toc_roadmap', 'strategic_plan.toc_risks'],
    figures: ['strategic_plan.risk_0_mitigation', 'strategic_plan.badge_secure', 'strategic_plan.roadmap_q4']
  }
];

describe('Timebank Ireland content pages', () => {
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

  describe.each(['en', 'de'])('in %s', (locale) => {
    const t = (key, replacements) => (/^[a-z_]+\./.test(key)
      ? translate(locale, `govuk_alpha_tbi_pages.${key}`, replacements)
      : key);

    it.each(PAGES)('$path renders its headings and figures for hour-timebank', async ({ path, headings, figures }) => {
      const response = await request(app).get(`/hour-timebank/accessible${path}?locale=${locale}`);
      expect(response.status).toBe(200);
      for (const key of [...headings, ...figures]) {
        const text = t(key);
        expect(text).not.toMatch(/^govuk_alpha_tbi_pages\./);
        expect(response.text).toContain(escapeHtml(text));
      }
      // No translation key leaked into the page.
      expect(response.text).not.toMatch(/govuk_alpha_tbi_pages\.[a-z_]/);
      expect(response.text).not.toMatch(/(?:social_prescribing|impact_summary|impact_report|strategic_plan)\.[a-z_]+/);
    });
  });

  it('formats the percentages for the reader\'s language', async () => {
    const en = await request(app).get('/hour-timebank/accessible/impact-report');
    const de = await request(app).get('/hour-timebank/accessible/impact-report?locale=de');
    // Age band shares from React: 12% / 18% / 42% / 28%.
    for (const share of ['12%', '18%', '42%', '28%']) expect(en.text).toContain(share);
    expect(de.text).toMatch(/42\s%/u);
    expect(de.text).toContain(escapeHtml(translate('de', 'govuk_alpha_tbi_pages.age_band', { band: '45–64' })));
  });

  it('links the downloads React links, on the API host', async () => {
    const report = await request(app).get('/hour-timebank/accessible/impact-report');
    expect(report.text).toContain('/uploads/tenants/hour-timebank/TBI-Social-Impact-Study-Final-Full-Report-May-23.pdf');
    expect(report.text).toContain('/uploads/tenants/hour-timebank/TBI-Social-Impact-Study-Executive-Summary-Design-Version-Final.pdf');
    const plan = await request(app).get('/hour-timebank/accessible/strategic-plan');
    expect(plan.text).toContain('/uploads/tenants/hour-timebank/Timebank-Ireland-Strategic-Plan-2026-2030.pdf');
  });

  it('shows the related pages, without the current one', async () => {
    const response = await request(app).get('/hour-timebank/accessible/impact-summary');
    expect(response.text).toContain('href="/hour-timebank/accessible/guide"');
    expect(response.text).toContain('href="/hour-timebank/accessible/social-prescribing"');
    expect(response.text).toContain('href="/hour-timebank/accessible/strategic-plan"');
    expect(response.text).not.toContain(escapeHtml(translate('en', 'govuk_alpha_tbi_pages.related.link_impact-summary_description')));
  });

  it.each(PAGES.map((page) => page.path))('%s is the ordinary 404 for any other community', async (path) => {
    const response = await request(app).get(`/acme/accessible${path}`);
    expect(response.status).toBe(404);
    expect(response.text).not.toContain(escapeHtml(translate('en', 'govuk_alpha_tbi_pages.related.heading')));
  });

  it('lists the pages in the footer for hour-timebank only', async () => {
    const tbi = await request(app).get('/hour-timebank/accessible/about');
    expect(tbi.text).toContain('href="/hour-timebank/accessible/impact-report"');
    expect(tbi.text).toContain(translate('en', 'govuk_alpha_tbi_pages.nav.our_impact'));
    const other = await request(app).get('/acme/accessible/about');
    expect(other.status).toBe(200);
    expect(other.text).not.toContain('/acme/accessible/impact-report');
    expect(other.text).not.toContain('/acme/accessible/social-prescribing');
  });

  it('describes each page with its own text and points the canonical at the main site', async () => {
    const response = await request(app).get('/hour-timebank/accessible/strategic-plan');
    const head = response.text.split('</head>')[0];
    expect(head).toContain('<link rel="canonical" href="https://app.project-nexus.ie/hour-timebank/strategic-plan">');
    expect(head).toContain(escapeHtml(translate('en', 'govuk_alpha_tbi_pages.strategic_plan.meta_description')).slice(0, 60));
  });
});

describe('Timebank Ireland content pages in the sitemap', () => {
  const { buildSitemapXml } = require('../src/lib/accessible-sitemap');

  it('lists them for hour-timebank on an accessible-primary community, and not for another', async () => {
    const settings = { seo_primary_site: 'accessible' };
    const tbi = await buildSitemapXml({ tenant: { ...TBI, settings }, protocol: 'https', host: 'accessible.example.test', prefix: '' });
    for (const path of ['/social-prescribing', '/impact-summary', '/impact-report', '/strategic-plan']) {
      expect(tbi).toContain(`<loc>https://accessible.example.test${path}</loc>`);
    }
    const other = await buildSitemapXml({ tenant: { ...OTHER, settings }, protocol: 'https', host: 'accessible.example.test', prefix: '' });
    expect(other).not.toContain('/impact-report');
  });
});
