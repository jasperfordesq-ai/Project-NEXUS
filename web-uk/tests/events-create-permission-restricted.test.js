// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "Create event" where the community restricts who may create (React 7565bee36).
 *
 * GET /api/v2/users/me reports `can_create_events`. Pinned here:
 * - an explicit `false` hides "Create event" on the events list and the group's
 *   "create an event for this group" link, and GET /events/new explains the rule
 *   instead of offering a form the API would refuse;
 * - an ABSENT field means allowed (React's deliberate open default), so the
 *   button and the form stay.
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
    getProfile: jest.fn(),
    getEvents: jest.fn(),
    getGroup: jest.fn(),
    getEventCategories: jest.fn().mockResolvedValue({ data: [] })
  }, {
    get: (target, prop) => (prop in target ? target[prop] : jest.fn().mockResolvedValue({ data: [] }))
  });
});

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() })
}));

const api = require('../src/lib/api');
const eventsRoutes = require('../src/routes/events');
const groupsRoutes = require('../src/routes/groups');
const { canCreateEventsFromProfile } = require('../src/lib/event-create-permission');

const t = createTranslator('en');

function mount(routes) {
  const app = express();
  const environment = nunjucks.configure(
    [path.join(__dirname, '..', 'src', 'views'), path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
    { autoescape: true, noCache: true, express: app }
  );
  require('../src/lib/template-filters').registerTemplateFilters(environment);
  environment.addFilter('nl2br', (value) => value);
  app.set('view engine', 'njk');
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'create-permission-test-secret-at-least-32', resave: false, saveUninitialized: false }));
  app.use('/', (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.csrfToken = () => 'csrf';
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'test', prefix: '', tenant: { id: 2, slug: 'test', features: { events: true, groups: true } } };
    res.locals.urlFor = (v) => String(v || '/');
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS', tenantName: 'Test', isAuthenticated: true, csrfToken: 'csrf',
      t, tc: createChoiceTranslator('en'), htmlLang: 'en', htmlDirection: 'ltr',
      formatLocaleDate: (value) => String(value || '')
    });
    next();
  }, routes);
  return app;
}

const eventsApp = mount(eventsRoutes);
const groupsApp = mount(groupsRoutes);
const CREATE = t('govuk_alpha.actions.create_event');
const GROUP_CREATE = t('govuk_alpha.groups_t1.create_event_link');

beforeEach(() => {
  jest.clearAllMocks();
  api.getEvents.mockResolvedValue({ data: [], meta: {} });
  api.getEventCategories.mockResolvedValue({ data: [] });
  api.getGroup.mockResolvedValue({ data: { id: 5, name: 'Gardeners', visibility: 'public', my_membership: { status: 'active', role: 'member' } } });
});

describe('the profile flag', () => {
  it('treats only an explicit false as "not allowed"', () => {
    expect(canCreateEventsFromProfile({ data: { can_create_events: false } })).toBe(false);
    expect(canCreateEventsFromProfile({ data: { can_create_events: true } })).toBe(true);
    expect(canCreateEventsFromProfile({ data: { id: 1 } })).toBe(true);
    expect(canCreateEventsFromProfile(null)).toBe(true);
  });
});

describe('restricted community', () => {
  beforeEach(() => api.getProfile.mockResolvedValue({ data: { id: 1, can_create_events: false } }));

  it('hides "Create event" on the events list', async () => {
    const page = await request(eventsApp).get('/');
    expect(page.status).toBe(200);
    expect(page.text).not.toContain(CREATE);
    expect(page.text).not.toContain('href="/events/new"');
  });

  it('explains the rule on GET /events/new instead of showing the form', async () => {
    const page = await request(eventsApp).get('/new');
    expect(page.status).toBe(403);
    expect(page.text).toContain(t('govuk_alpha_events.create_restricted.title'));
    expect(page.text).toContain(t('govuk_alpha_events.create_restricted.body'));
    expect(page.text).not.toContain('name="title"');
  });

  it('hides the group page link to create an event for the group', async () => {
    const page = await request(groupsApp).get('/5');
    expect(page.status).toBe(200);
    expect(page.text).not.toContain(GROUP_CREATE);
  });
});

describe('open community (flag absent)', () => {
  beforeEach(() => api.getProfile.mockResolvedValue({ data: { id: 1 } }));

  it('keeps "Create event", the form and the group link', async () => {
    const list = await request(eventsApp).get('/');
    expect(list.text).toContain(CREATE);
    const form = await request(eventsApp).get('/new');
    expect(form.status).toBe(200);
    expect(form.text).toContain('name="title"');
    const group = await request(groupsApp).get('/5');
    expect(group.text).toContain(GROUP_CREATE);
  });
});
