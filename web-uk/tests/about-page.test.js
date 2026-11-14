// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The About page as the community's own page (owner, 14 Nov 2026).
 *
 * The React About page (react-frontend/src/pages/public/AboutPage.tsx) opens with
 * the community's own words, shows its real numbers with zero figures left out,
 * tells one example exchange in three steps, lists the community's contact
 * details, and keeps every software credit at the foot. These pin the accessible
 * copy to the same behaviour, in English and one other language.
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
  getPlatformStats: jest.fn(),
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
const contributors = require('../contributors.json');

const BASE = { id: 3, name: 'Acme Timebank', slug: 'acme', modules: {}, features: {}, settings: {}, seo: {} };

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// The part of the page between two markers, so an assertion about the numbers
// cannot be satisfied by the same word somewhere else on the page.
function section(html, marker) {
  const start = html.indexOf(marker);
  if (start === -1) return '';
  const end = html.indexOf('</dl>', start);
  return html.slice(start, end === -1 ? undefined : end);
}

describe('About page — the community\'s own page', () => {
  let app;
  let api;
  let tenant;

  beforeAll(() => {
    app = require('../src/server');
    api = require('../src/lib/api');
  });

  beforeEach(() => {
    tenant = { ...BASE };
    api.getTenants.mockResolvedValue({ data: [{ id: 3, name: BASE.name, slug: BASE.slug }] });
    api.getTenantBootstrap.mockImplementation(async () => ({ data: tenant }));
    api.getPlatformStats.mockResolvedValue({
      data: { members: 31, hours_exchanged: 443, listings: 20, communities: 1 }
    });
  });

  const about = (query = '') => request(app).get(`/acme/accessible/about${query}`);

  // ── The opening ──────────────────────────────────────────────────────────

  it('opens with the community\'s own words when it has written some', async () => {
    tenant.description = '  Neighbours in Riverside sharing time & skills.  ';
    const response = await about();
    expect(response.status).toBe(200);
    expect(response.text).toContain('data-about-own-words>Neighbours in Riverside sharing time &amp; skills.</p>');
    expect(response.text).not.toContain(escapeHtml(translate('en', 'about.description', { name: 'Acme Timebank' })));
  });

  it.each(['en', 'de'])('opens with the standard sentence in %s when the community has written nothing', async (locale) => {
    tenant.description = '   ';
    const response = await about(`?locale=${locale}`);
    const sentence = translate(locale, 'about.description', { name: 'Acme Timebank' });
    expect(sentence).not.toMatch(/^about\./);
    expect(response.text).toContain(escapeHtml(sentence));
    expect(response.text).not.toContain('data-about-own-words');
  });

  it('never renders the community\'s words as markup', async () => {
    tenant.description = '<script>alert(1)</script> Hello';
    const response = await about();
    expect(response.text).not.toContain('<script>alert(1)</script>');
    expect(response.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt; Hello');
  });

  it('invites a signed-out visitor to join', async () => {
    const response = await about();
    expect(response.text).toContain('href="/acme/accessible/register"');
    expect(response.text).toContain(escapeHtml(translate('en', 'about.cta.join')));
  });

  // ── The numbers ──────────────────────────────────────────────────────────

  it('shows the community\'s real numbers, without "communities" for a single community', async () => {
    const response = await about();
    const figures = section(response.text, 'data-about-figures');
    expect(figures).toContain(translate('en', 'about.stats.members'));
    expect(figures).toContain('<dd>31</dd>');
    expect(figures).toContain(translate('en', 'about.stats.hours_exchanged'));
    expect(figures).toContain('<dd>443</dd>');
    expect(figures).toContain(translate('en', 'about.stats.active_listings'));
    expect(figures).toContain('<dd>20</dd>');
    expect(figures).not.toContain(translate('en', 'about.stats.communities'));
  });

  // A young community is not shown an empty scoreboard.
  it('leaves out a figure that is zero', async () => {
    api.getPlatformStats.mockResolvedValue({ data: { members: 4, hours_exchanged: 0, listings: 0, communities: 1 } });
    const response = await about();
    const figures = section(response.text, 'data-about-figures');
    expect(figures).toContain('<dd>4</dd>');
    expect(figures).not.toContain(translate('en', 'about.stats.hours_exchanged'));
    expect(figures).not.toContain(translate('en', 'about.stats.active_listings'));
    expect(figures).not.toContain('<dd>0</dd>');
  });

  it('shows the count of communities for a hub', async () => {
    api.getPlatformStats.mockResolvedValue({ data: { members: 900, hours_exchanged: 12, listings: 3, communities: 12 } });
    const response = await about();
    const figures = section(response.text, 'data-about-figures');
    expect(figures).toContain(translate('en', 'about.stats.communities'));
    expect(figures).toContain('<dd>12</dd>');
  });

  it('shows no numbers section when every figure is zero or the numbers cannot be loaded', async () => {
    api.getPlatformStats.mockResolvedValue({ data: { members: 0, hours_exchanged: 0, listings: 0, communities: 0 } });
    let response = await about();
    expect(response.status).toBe(200);
    expect(response.text).not.toContain('data-about-figures');
    expect(response.text).not.toContain(escapeHtml(translate('en', 'about.stats.title')));

    api.getPlatformStats.mockRejectedValue(new Error('offline'));
    response = await about();
    expect(response.status).toBe(200);
    expect(response.text).not.toContain('data-about-figures');
  });

  // ── The story and what matters ───────────────────────────────────────────

  it.each(['en', 'ar'])('tells one exchange in three steps and four things that matter, in %s', async (locale) => {
    const response = await about(`?locale=${locale}`);
    for (let step = 0; step < 3; step += 1) {
      expect(response.text).toContain(escapeHtml(translate(locale, `about.how_it_works.steps.${step}.title`)));
      expect(response.text).toContain(escapeHtml(translate(locale, `about.how_it_works.steps.${step}.description`)));
    }
    for (let item = 0; item < 4; item += 1) {
      expect(response.text).toContain(escapeHtml(translate(locale, `about.values.items.${item}.title`)));
    }
    // The fourth step was retired with the old four-step "how to sign up" list.
    expect(translate(locale, 'about.how_it_works.steps.3.title')).toBe('about.how_it_works.steps.3.title');
    expect(response.text).not.toMatch(/about\.[a-z_]+\.[a-z_]/);
  });

  // ── Get in touch ─────────────────────────────────────────────────────────

  it('shows the community\'s own contact details when it has filled them in', async () => {
    tenant.contact = { email: 'hello@example.org', phone: '+1 555 123 4567', address: '1 Main Street' };
    const response = await about();
    expect(response.text).toContain('<a class="govuk-link" href="mailto:hello@example.org">hello@example.org</a>');
    expect(response.text).toContain('href="tel:+15551234567"');
    expect(response.text).toContain('+1 555 123 4567');
    expect(response.text).toContain('1 Main Street');
  });

  it('shows no empty contact list when nothing is filled in, and still links to the contact page', async () => {
    const response = await about();
    expect(response.text).not.toContain('data-about-contact-details');
    expect(response.text).toContain('href="/acme/accessible/contact"');
  });

  // ── Credits for the software (attribution) ───────────────────────────────

  // The credits were made smaller on 14 Nov 2026. They are attribution: every
  // name in contributors.json, the licence and the source link must stay.
  it('still credits every contributor by name, with the licence and the source code link', async () => {
    const response = await about();
    const software = response.text.slice(response.text.indexOf('data-about-software'));
    expect(software.length).toBeGreaterThan(100);
    for (const person of contributors) {
      expect(software).toContain(escapeHtml(person.name));
    }
    expect(software).toContain(escapeHtml(translate('en', 'about.credits.license_text')));
    expect(software).toContain('href="https://github.com/jasperfordesq-ai/Project-NEXUS"');
  });
});
