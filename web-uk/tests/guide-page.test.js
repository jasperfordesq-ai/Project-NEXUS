// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The guide's "Where timebanking comes from" and "five values" sections
 * (owner, 14 Nov 2026).
 *
 * The React guide (react-frontend/src/pages/about/TimebankingGuidePage.tsx)
 * tells where timebanking came from — Edgar Cahn, and Teruko Mizushima before
 * him — and lists Cahn's five values. Every community shows the page, so the
 * accessible copy must tell the same history with the same dates, in English
 * and in another language.
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

const BASE = { id: 3, name: 'Acme Timebank', slug: 'acme', modules: {}, features: {}, settings: {}, seo: {} };
const YEARS = ['1973', '1980', '1992', '1995', '2000'];

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// The part of the page from a marker to the end of the list it opens, so an
// assertion about one list cannot be satisfied by the same words elsewhere.
function listAfter(html, marker, closing) {
  const start = html.indexOf(marker);
  if (start === -1) return '';
  const end = html.indexOf(closing, start);
  return html.slice(start, end === -1 ? undefined : end);
}

// Each row of the timeline as [when, text], tags and spacing removed.
function timelineRows(html) {
  const list = listAfter(html, 'data-guide-timeline', '</dl>');
  return [...list.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>\s*<dd[^>]*>([\s\S]*?)<\/dd>/g)]
    .map((row) => [row[1].trim(), row[2].trim()]);
}

describe('Guide — where timebanking comes from, and the five values', () => {
  let app;
  let api;

  beforeAll(() => {
    app = require('../src/server');
    api = require('../src/lib/api');
  });

  beforeEach(() => {
    api.getTenants.mockResolvedValue({ data: [{ id: 3, name: BASE.name, slug: BASE.slug }] });
    api.getTenantBootstrap.mockImplementation(async () => ({ data: { ...BASE } }));
  });

  const guide = (query = '') => request(app).get(`/acme/accessible/guide${query}`);

  it('names Edgar Cahn with the years he lived, and tells his story', async () => {
    const response = await guide();
    expect(response.status).toBe(200);
    expect(response.text).toContain('Where timebanking comes from');
    expect(response.text).toMatch(/<h3[^>]*><bdi>Edgar S\. Cahn<\/bdi>[\s\S]*?<bdi>1935–2022<\/bdi>/);
    expect(response.text).toContain('Jean Camper Cahn');
    expect(response.text).toContain('In 1980, aged 44, he had a serious heart attack.');
  });

  it('credits Teruko Mizushima, who tried the idea before him, without calling hers the first', async () => {
    const response = await guide();
    const note = listAfter(response.text, 'class="govuk-inset-text"', '</div>');
    expect(note).toContain('Teruko Mizushima');
    expect(note).toContain('1973');
    // Sources disagree on whether hers was the world's first timebank.
    expect(response.text).not.toMatch(/world(&#39;|')s first/i);
  });

  it('tells how the idea grew: five dated lines, then today with the community\'s own name', async () => {
    const rows = timelineRows((await guide()).text);
    expect(rows.map((row) => row[0])).toEqual([...YEARS, 'Today']);
    expect(rows[1][1]).toContain('Edgar Cahn');
    expect(rows[5][1]).toBe('Timebanks run in communities all over the world, Acme Timebank among them.');
  });

  it('lists the five values in order', async () => {
    const response = await guide();
    const list = listAfter(response.text, 'data-guide-values', '</ol>');
    const titles = [...list.matchAll(/<span class="govuk-!-font-weight-bold">([\s\S]*?)<\/span>/g)].map((m) => m[1]);
    expect(titles).toEqual([
      'Everyone has something to give',
      'Some work is beyond price',
      'Helping goes both ways',
      'We need each other',
      'Respect for every person'
    ]);
  });

  // The whole section in another language: a missing line would show its key,
  // or fall back to English.
  it.each(['de', 'ja', 'ar'])('tells the same history in %s', async (locale) => {
    const response = await guide(`?locale=${locale}`);
    expect(response.status).toBe(200);

    const title = translate(locale, 'guide.origins_title');
    expect(title).not.toMatch(/^guide\./);
    expect(title).not.toBe(translate('en', 'guide.origins_title'));
    expect(response.text).toContain(escapeHtml(title));

    const rows = timelineRows(response.text);
    expect(rows).toHaveLength(6);
    expect(rows.slice(0, 5).map((row) => row[0])).toEqual(YEARS);
    expect(rows[5][0]).toBe(escapeHtml(translate(locale, 'guide.timeline_today')));
    expect(rows[5][1]).toBe(escapeHtml(translate(locale, 'guide.timeline_today_text', { community: 'Acme Timebank' })));
    expect(rows[5][1]).toContain('Acme Timebank');
    expect(rows[5][1]).not.toContain(':community');

    const list = listAfter(response.text, 'data-guide-values', '</ol>');
    expect([...list.matchAll(/<li>/g)]).toHaveLength(5);
    expect(response.text).not.toContain('guide.values');
    expect(response.text).not.toContain('guide.origins');
    expect(response.text).not.toContain('guide.timeline');
  });
});
