// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The score doc records the event moderation queue's membership and order as an
 * "upstream Laravel contract boundary" — and that is accurate: web-uk asks for
 * `publication_state=pending_review` and Laravel decides which events come back and
 * in what sequence. With Blade deleted there is nothing left to compare Laravel's
 * answer against, so that half cannot be closed here by anyone.
 *
 * 🔴 What CAN be closed here is web-uk's own half, which was never tested: that this
 * page is a faithful window onto whatever Laravel returns. A page that quietly
 * re-sorted, de-duplicated or dropped rows would make the upstream contract
 * unobservable — a moderator would be looking at web-uk's opinion of the queue, not
 * the queue. These tests pin that it does not.
 */
const express = require('express');
const session = require('express-session');
const request = require('supertest');
const nunjucks = require('nunjucks');
const path = require('node:path');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }
  return new Proxy({
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    callAdminEventApi: jest.fn(),
  }, {
    // Every other helper the events router imports resolves empty rather than
    // undefined, so requiring the router does not explode over unrelated pages.
    get: (target, prop) => (prop in target ? target[prop] : jest.fn().mockResolvedValue({ data: [] })),
  });
});

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() }),
}));

const api = require('../src/lib/api');
const eventsRoutes = require('../src/routes/events');

function pendingEvent(id, title) {
  return {
    id,
    title,
    publication_state: 'pending_review',
    start_at: '2026-09-01T10:00:00+00:00',
    end_at: '2026-09-01T11:00:00+00:00',
    timezone: 'Europe/Dublin',
  };
}

function mount() {
  const app = express();
  // The real server's template environment. Without it every render 500s, which
  // reads exactly like a route defect — it is not one.
  const environment = nunjucks.configure(
    [path.join(__dirname, '..', 'src', 'views'),
      path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
    { autoescape: true, noCache: true, express: app }
  );
  require('../src/lib/template-filters').registerTemplateFilters(environment);
  environment.addFilter('nl2br', (value) => value);
  app.set('view engine', 'njk');
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'moderation-test-secret-at-least-32-chars', resave: false, saveUninitialized: false }));
  app.use('/', (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'test', prefix: '/test/accessible', tenant: { id: 2, slug: 'test' } };
    res.locals.urlFor = (v) => String(v || '/');
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS',
      tenantName: 'Test',
      isAuthenticated: true,
      csrfToken: 'x',
      t: createTranslator('en'),
      tc: createChoiceTranslator('en'),
      htmlLang: 'en',
      htmlDirection: 'ltr',
      formatLocaleDate: () => '1 September 2026',
    });
    next();
  }, eventsRoutes);
  return app;
}

describe('the event moderation queue is a faithful window onto Laravel', () => {
  const app = mount();
  beforeEach(() => jest.clearAllMocks());

  it('asks Laravel for the pending-review queue, and does not filter it itself', async () => {
    api.callAdminEventApi.mockResolvedValue({ data: [pendingEvent(1, 'Alpha')], meta: { total: 1, last_page: 1 } });
    const res = await request(app).get('/moderation');
    expect(res.status).toBe(200);
    const [, , query] = api.callAdminEventApi.mock.calls[0];
    expect(query).toContain('publication_state=pending_review');
    // 🔴 Membership is Laravel's decision. If web-uk ever adds its own predicate, a
    // moderator stops seeing the real queue — and nothing else would report it.
    expect(query).not.toMatch(/status=|state=(?!pending_review)/);
  });

  it('sends the moderator\'s bearer token', async () => {
    // The /organisations defect in miniature: a token-less admin call 401s, and the
    // page would render an empty queue that looks exactly like "nothing to moderate".
    api.callAdminEventApi.mockResolvedValue({ data: [], meta: { total: 0, last_page: 1 } });
    await request(app).get('/moderation');
    expect(api.callAdminEventApi.mock.calls[0][0]).toBe('token:test');
  });

  it('preserves Laravel\'s order exactly, including an order no client would choose', async () => {
    // Deliberately NOT alphabetical and NOT by date: if web-uk re-sorted, this is the
    // case that catches it.
    api.callAdminEventApi.mockResolvedValue({
      data: [pendingEvent(7, 'Zulu'), pendingEvent(2, 'Alpha'), pendingEvent(5, 'Mike')],
      meta: { total: 3, last_page: 1 },
    });
    const res = await request(app).get('/moderation');
    const order = ['Zulu', 'Alpha', 'Mike'].map((title) => res.text.indexOf(title));
    expect(order.every((i) => i > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('drops nothing — every row Laravel returns reaches the page', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => pendingEvent(i + 1, `Event number ${i + 1}`));
    api.callAdminEventApi.mockResolvedValue({ data: rows, meta: { total: 20, last_page: 1 } });
    const res = await request(app).get('/moderation');
    for (const row of rows) expect(res.text).toContain(row.title);
  });

  it('keeps two events that share a title — de-duplication would hide real work', async () => {
    api.callAdminEventApi.mockResolvedValue({
      data: [pendingEvent(11, 'Repeat Coffee Morning'), pendingEvent(12, 'Repeat Coffee Morning')],
      meta: { total: 2, last_page: 1 },
    });
    const res = await request(app).get('/moderation');
    expect(res.text.split('Repeat Coffee Morning').length - 1).toBeGreaterThanOrEqual(2);
  });
});
