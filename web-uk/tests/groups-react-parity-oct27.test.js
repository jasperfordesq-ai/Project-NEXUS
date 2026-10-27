// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Group gaps found by the deep React parity audit of 27 Oct 2026
 * (frontend-drift/2026-10-27-deep-evidence, G6, G7, G10):
 *
 * 13. The member list stopped at 100 and could not be searched. React searches
 *     with `q` and pages with a cursor (GroupMembersTab).
 * 14. Only the next five upcoming events were shown. React lists every event,
 *     past and upcoming (`when: 'all'`), with paging.
 * 15. The directory had no "Recommended for you" (GET /v2/matches/all?modules=groups)
 *     and no "Featured groups" section (`is_featured`).
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
    getGroup: jest.fn(),
    getGroups: jest.fn(),
    getGroupMembers: jest.fn(),
    getEvents: jest.fn(),
    callGroupApi: jest.fn(),
    callMatchesApi: jest.fn(),
    getProfile: jest.fn(),
  }, {
    get: (target, prop) => (prop in target ? target[prop] : jest.fn().mockResolvedValue({ data: [] })),
  });
});

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() }),
}));

const api = require('../src/lib/api');
const groupsRoutes = require('../src/routes/groups');

function mount() {
  const app = express();
  const environment = nunjucks.configure(
    [path.join(__dirname, '..', 'src', 'views'),
      path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
    { autoescape: true, noCache: true, express: app }
  );
  require('../src/lib/template-filters').registerTemplateFilters(environment);
  environment.addFilter('nl2br', (value) => value);
  environment.addFilter('formatBladeDateTime', (value) => String(value || ''));
  app.set('view engine', 'njk');
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'groups-parity-oct27-test-secret-32chars', resave: false, saveUninitialized: false }));
  app.use('/groups', (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.csrfToken = () => 'csrf';
    req.flash = () => [];
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'test', prefix: '', tenant: { id: 2, slug: 'test' } };
    res.locals.urlFor = (v) => String(v || '/');
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS',
      tenantName: 'Test',
      isAuthenticated: true,
      csrfToken: 'csrf',
      t: createTranslator('en'),
      tc: createChoiceTranslator('en'),
      htmlLang: 'en',
      htmlDirection: 'ltr',
      formatLocaleDate: () => '27 October 2026',
    });
    next();
  }, groupsRoutes);
  return app;
}

const app = mount();
const t = createTranslator('en');

const GROUP = { data: { id: 974, name: 'Repair crew', visibility: 'public', my_membership: { status: 'active', role: 'member' } } };

beforeEach(() => {
  jest.clearAllMocks();
  api.getProfile.mockResolvedValue({ data: { id: 5 } });
  api.getGroup.mockResolvedValue(GROUP);
  api.getGroupMembers.mockResolvedValue({ data: [] });
  api.getEvents.mockResolvedValue({ data: [] });
  api.callGroupApi.mockResolvedValue({ data: [] });
  api.getGroups.mockResolvedValue({ data: [], meta: {} });
  api.callMatchesApi.mockResolvedValue({ data: { matches: [] } });
});

describe('13. searching the group member list', () => {
  it('links from the group page to the searchable member list', async () => {
    const res = await request(app).get('/groups/974');
    expect(res.text).toContain('href="/groups/974/member-list"');
  });

  it('searches with q and offers the next page', async () => {
    api.callGroupApi.mockResolvedValue({
      data: [{ id: 11, name: 'Ann Lee', role: 'admin' }],
      meta: { cursor: 'abc=', has_more: true }
    });
    const res = await request(app).get('/groups/974/member-list?q=ann');
    expect(res.status).toBe(200);
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'GET', '/974/members?per_page=50&q=ann');
    expect(res.text).toContain('Ann Lee');
    expect(res.text).toContain('href="/members/11"');
    expect(res.text).toContain('method="get"');
    expect(res.text).toContain('value="ann"');
    expect(res.text).toContain('href="/groups/974/member-list?q=ann&amp;cursor=abc%3D"');
  });

  it('keeps paging and offers a way back to the first page', async () => {
    api.callGroupApi.mockResolvedValue({ data: [], meta: { has_more: false } });
    const res = await request(app).get('/groups/974/member-list?q=zed&cursor=abc%3D');
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'GET', '/974/members?per_page=50&q=zed&cursor=abc%3D');
    expect(res.text).toContain(t('govuk_alpha_groups.members_page.empty_search', { query: 'zed' }));
    expect(res.text).toContain('href="/groups/974/member-list?q=zed"');
  });

  it('refuses a private group the member cannot see', async () => {
    const { ApiError } = api;
    api.callGroupApi.mockRejectedValue(new ApiError('Forbidden', 403, {}));
    const res = await request(app).get('/groups/974/member-list');
    expect(res.status).toBe(403);
  });
});

describe('14. every group event, past and upcoming', () => {
  it('links from the group page to all events', async () => {
    const res = await request(app).get('/groups/974');
    expect(res.text).toContain('href="/groups/974/events"');
  });

  it('lists all events by default, with paging', async () => {
    api.getEvents.mockResolvedValue({
      data: [{ id: 3, title: 'Spring fair', start_time: '2026-03-01T10:00:00Z' }],
      meta: { cursor: 'n2', has_more: true }
    });
    const res = await request(app).get('/groups/974/events');
    expect(res.status).toBe(200);
    expect(api.getEvents).toHaveBeenCalledWith('token:test', { group_id: '974', when: 'all', per_page: 20 });
    expect(res.text).toContain('Spring fair');
    expect(res.text).toContain('href="/events/3"');
    expect(res.text).toContain('href="/groups/974/events?when=all&amp;cursor=n2"');
  });

  it('filters to past events', async () => {
    api.getEvents.mockResolvedValue({ data: [], meta: {} });
    const res = await request(app).get('/groups/974/events?when=past&cursor=n2');
    expect(api.getEvents).toHaveBeenCalledWith('token:test', { group_id: '974', when: 'past', per_page: 20, cursor: 'n2' });
    expect(res.text).toContain(t('govuk_alpha_groups.events_page.empty'));
    expect(res.text).toContain('href="/groups/974/events?when=past"');
  });

  it('falls back to all events for an unknown filter', async () => {
    await request(app).get('/groups/974/events?when=bogus');
    expect(api.getEvents).toHaveBeenCalledWith('token:test', expect.objectContaining({ when: 'all' }));
  });
});

describe('15. recommended and featured groups in the directory', () => {
  it('shows the recommended groups the API returns', async () => {
    api.callMatchesApi.mockResolvedValue({
      data: { matches: [{ module: 'groups', group_id: 41, title: 'Garden club', match_score: 82, match_reasons: ['Shares your interest in gardening'] }] }
    });
    const res = await request(app).get('/groups');
    expect(api.callMatchesApi).toHaveBeenCalledWith('token:test', 'GET', '/all?modules=groups&limit=3&min_score=50');
    expect(res.text).toContain(t('govuk_alpha_groups.recommended.title'));
    expect(res.text).toContain('href="/groups/41"');
    expect(res.text).toContain('Garden club');
    expect(res.text).toContain(t('govuk_alpha_groups.recommended.score', { score: 82 }));
    expect(res.text).toContain('Shares your interest in gardening');
  });

  it('hides the section when there are no recommendations or the read fails', async () => {
    api.callMatchesApi.mockRejectedValue(new Error('down'));
    const res = await request(app).get('/groups');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(t('govuk_alpha_groups.recommended.title'));
  });

  it('lists featured groups in their own section first', async () => {
    api.getGroups.mockResolvedValue({
      data: [
        { id: 1, name: 'Plain group', visibility: 'public' },
        { id: 2, name: 'Star group', visibility: 'public', is_featured: true }
      ],
      meta: {}
    });
    const res = await request(app).get('/groups');
    const featuredAt = res.text.indexOf(t('govuk_alpha_groups.featured.title'));
    expect(featuredAt).toBeGreaterThan(-1);
    expect(res.text.indexOf('Star group')).toBeGreaterThan(featuredAt);
    expect(res.text.indexOf('Star group')).toBeLessThan(res.text.indexOf('Plain group'));
  });
});
