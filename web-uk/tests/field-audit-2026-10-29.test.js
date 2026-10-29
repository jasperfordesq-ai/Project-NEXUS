// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Response/request field fixes from the 29 Oct 2026 field audit (web-uk read
 * against Laravel). Each case pins what the page is GIVEN to display, using a
 * view engine that hands back the render locals instead of HTML.
 *
 * - Nexus Score: Laravel sends `breakdown` as a list; it was read as an object
 *   and every category bar disappeared.
 * - Leaderboard: only Laravel's ranking types are offered; volunteer hours are
 *   requested as `volunteer_hours` (six options used to show XP under the wrong
 *   heading).
 * - Competitive leaderboard: no "show more" past Laravel's 100-row cap.
 * - Federation member: reviews show when Laravel sends reputation fields (it
 *   never sends `show_reviews`).
 * - Federation hub: partner total is counted before the list is cut to six.
 * - Federation members: no "of 0" total on pages after the first.
 * - Goals: "Load more" passes the cursor on.
 */
const express = require('express');
const request = require('supertest');
const { createTranslator, createChoiceTranslator } = require('../src/lib/localization');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }
  return new Proxy({
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    callGamificationApi: jest.fn(),
    callFederationApi: jest.fn(),
    getGoals: jest.fn(),
  }, {
    get: (target, prop) => (prop in target ? target[prop] : jest.fn().mockResolvedValue({ data: [] })),
  });
});

const api = require('../src/lib/api');

function mount(prefix, router) {
  const app = express();
  app.engine('njk', (file, options, callback) => {
    const pick = {};
    for (const key of ['nexusScore', 'leaderboard', 'member', 'partners', 'partnerTotal', 'total', 'goals', 'meta']) {
      if (options[key] !== undefined) pick[key] = options[key];
    }
    callback(null, JSON.stringify({ view: file, ...pick }));
  });
  app.set('view engine', 'njk');
  app.set('views', require('node:path').join(__dirname, '..', 'src', 'views'));
  app.use((req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.session = {};
    Object.assign(res.locals, {
      t: createTranslator('en'),
      tc: createChoiceTranslator('en'),
      urlFor: (v) => String(v || '/'),
      formatLocaleNumber: (v) => String(v),
      formatLocaleDate: (v) => String(v),
    });
    next();
  });
  app.use(prefix, router);
  return app;
}

async function locals(app, url) {
  const res = await request(app).get(url);
  expect(res.status).toBe(200);
  return JSON.parse(res.text);
}

beforeEach(() => {
  api.callGamificationApi.mockReset();
  api.callFederationApi.mockReset();
  api.getGoals.mockReset();
});

describe('Nexus Score', () => {
  const app = mount('/nexus-score', require('../src/routes/nexus-score'));

  test('a list-shaped breakdown fills the category rows', async () => {
    api.callGamificationApi.mockResolvedValue({ data: {
      total_score: 400, max_score: 1000, percentage: 40,
      breakdown: [
        { key: 'engagement', label: 'Engagement', score: 50, max: 250, percentage: 20 },
        { key: 'quality', label: 'Quality', score: 100, max: 200, percentage: 50 },
      ],
    } });
    const page = await locals(app, '/nexus-score');
    expect(page.nexusScore.breakdownRows.map((row) => row.scoreLabel)).toEqual(['50 / 250', '100 / 200']);
  });
});

describe('Leaderboard', () => {
  const app = mount('/leaderboard', require('../src/routes/leaderboard'));

  test('offers only the metrics Laravel ranks by', async () => {
    api.callGamificationApi.mockResolvedValue({ data: [] });
    const page = await locals(app, '/leaderboard');
    expect(page.leaderboard.types.map((type) => type.value)).toEqual(['credits_earned', 'vol_hours', 'xp']);
  });

  test('volunteer hours are requested by the API name', async () => {
    api.callGamificationApi.mockResolvedValue({ data: [] });
    await locals(app, '/leaderboard?type=vol_hours');
    expect(api.callGamificationApi).toHaveBeenCalledWith('token:test', 'GET', expect.stringContaining('/leaderboard?type=volunteer_hours&'));
  });

  test('an unsupported metric falls back instead of being sent', async () => {
    api.callGamificationApi.mockResolvedValue({ data: [] });
    await locals(app, '/leaderboard?type=badges');
    expect(api.callGamificationApi).toHaveBeenCalledWith('token:test', 'GET', expect.stringContaining('type=credits_earned&'));
  });
});

describe('Federation', () => {
  const app = mount('/federation', require('../src/routes/federation'));

  function routeFederation(handlers) {
    api.callFederationApi.mockImplementation(async (token, method, apiPath) => {
      for (const [prefix, value] of handlers) {
        if (apiPath.startsWith(prefix)) return value;
      }
      return { data: [] };
    });
  }

  test('a member who shares reviews has them shown', async () => {
    routeFederation([
      ['/members/5/reviews', { data: [] }],
      ['/members/5', { data: { id: 5, name: 'Sam', tenant_id: 3, reputation_score: 4.6, reputation_count: 2, trust_score: 80 } }],
      ['/settings', { data: { settings: {} } }],
    ]);
    const page = await locals(app, '/federation/members/5?tenant_id=3');
    expect(page.member.showReviews).toBe(true);
    expect(api.callFederationApi).toHaveBeenCalledWith('token:test', 'GET', '/members/5/reviews?tenant_id=3');
  });

  test('a member who does not share reviews has none fetched', async () => {
    routeFederation([
      ['/members/5', { data: { id: 5, name: 'Sam', tenant_id: 3 } }],
      ['/settings', { data: { settings: {} } }],
    ]);
    const page = await locals(app, '/federation/members/5?tenant_id=3');
    expect(page.member.showReviews).toBe(false);
  });

  test('the hub counts every partner before showing six', async () => {
    const partners = Array.from({ length: 9 }, (_, index) => ({ id: index + 1, name: `Partner ${index + 1}` }));
    routeFederation([['/status', { data: { enabled: true } }], ['/partners', { data: partners }], ['/activity', { data: [] }]]);
    const page = await locals(app, '/federation');
    expect(page.partners).toHaveLength(6);
    expect(page.partnerTotal).toBe(9);
  });

  test('pages after the first do not claim a total of 0', async () => {
    routeFederation([['/partners', { data: [] }], ['/members', { data: [], meta: { total_items: 0, cursor: '' } }]]);
    const page = await locals(app, '/federation/members?cursor=abc');
    expect(page.total).toBeNull();
  });
});

describe('Goals', () => {
  const app = mount('/goals', require('../src/routes/goals'));

  test('"Load more" passes the cursor to Laravel', async () => {
    api.getGoals.mockResolvedValue({ data: [], meta: {} });
    await request(app).get('/goals?cursor=next-page');
    expect(api.getGoals).toHaveBeenCalledWith('token:test', expect.objectContaining({ cursor: 'next-page' }));
  });
});
