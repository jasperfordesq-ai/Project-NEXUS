// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Group journeys found missing on 27 Oct 2026:
 *
 * 1. GROUP FILES listed the first 50 and stopped, and members could not browse by
 *    folder although uploads can go into one. Laravel pages files with a cursor and
 *    filters by `folder`; React lists the folders from GET /files/folders.
 * 2. NOTHING LINKED TO THE ANNOUNCEMENTS PAGE, so members saw only pinned
 *    announcements and admins could not reach "Post a new announcement".
 * 3. A MEMBER WITH A PENDING JOIN REQUEST COULD NOT CANCEL IT. React offers
 *    "Cancel join request" (DELETE /v2/groups/{id}/membership, which Laravel
 *    answers with action "request_cancelled").
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
    leaveGroup: jest.fn(),
    callGroupApi: jest.fn(),
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

function mount(routes) {
  const app = express();
  const environment = nunjucks.configure(
    [path.join(__dirname, '..', 'src', 'views'),
      path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
    { autoescape: true, noCache: true, express: app }
  );
  require('../src/lib/template-filters').registerTemplateFilters(environment);
  environment.addFilter('nl2br', (value) => value);
  app.set('view engine', 'njk');
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'groups-journeys-test-secret-at-least-32-ch', resave: false, saveUninitialized: false }));
  app.use('/', (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.csrfToken = () => 'csrf';
    req.flash = () => [];
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'test', prefix: '/test/accessible', tenant: { id: 2, slug: 'test' } };
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
  }, routes);
  return app;
}

const app = mount(groupsRoutes);
const t = createTranslator('en');

const group = (membership) => ({
  data: { id: 974, name: 'Repair crew', visibility: 'private', my_membership: membership },
});

function routeGroupApi(handlers) {
  api.callGroupApi.mockImplementation((token, method, apiPath) => {
    for (const [m, re, handler] of handlers) {
      if (m === method && re.test(apiPath)) return Promise.resolve(typeof handler === 'function' ? handler(apiPath) : handler);
    }
    return Promise.resolve({ data: { items: [] } });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getProfile.mockResolvedValue({ data: { id: 900015 } });
});

describe('group files: paging and folders', () => {
  const FILE = { id: 31, file_name: 'minutes-october.pdf', file_size: 2048, uploaded_by: 5, uploader_name: 'Ann' };

  it('asks for one page, lists the folders, and offers the next page', async () => {
    api.getGroup.mockResolvedValue(group({ status: 'active', role: 'member' }));
    routeGroupApi([
      ['GET', /^\/974\/files\/folders$/, { data: [{ folder: 'Minutes', file_count: 12 }, { folder: 'Rotas', file_count: 2 }] }],
      ['GET', /^\/974\/files\?/, { data: { items: [FILE], cursor: 'NTA=', has_more: true } }],
    ]);
    const res = await request(app).get('/974/files');
    expect(res.status).toBe(200);
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'GET', '/974/files?per_page=50');
    expect(res.text).toContain('minutes-october.pdf');
    expect(res.text).toContain(t('govuk_alpha_groups.files.folder_filter_label'));
    expect(res.text).toContain(t('govuk_alpha_groups.files.folder_filter_all'));
    expect(res.text).toMatch(/<option value="Minutes"[^>]*>Minutes \(12\)<\/option>/);
    expect(res.text).toContain('href="/groups/974/files?cursor=NTA%3D"');
    expect(res.text).toContain('method="get"');
  });

  it('filters by folder and keeps the folder in the paging links', async () => {
    api.getGroup.mockResolvedValue(group({ status: 'active', role: 'member' }));
    routeGroupApi([
      ['GET', /^\/974\/files\/folders$/, { data: [{ folder: 'Minutes', file_count: 12 }] }],
      ['GET', /^\/974\/files\?/, { data: { items: [FILE], cursor: null, has_more: false } }],
    ]);
    const res = await request(app).get('/974/files?folder=Minutes&cursor=NTA%3D');
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'GET', '/974/files?per_page=50&cursor=NTA%3D&folder=Minutes');
    expect(res.text).toMatch(/<option value="Minutes" selected/);
    expect(res.text).toContain('href="/groups/974/files?folder=Minutes"');
    expect(res.text).toContain(t('govuk_alpha_commerce.pagination.first'));
  });

  it('still lists the files when the folder list cannot be read', async () => {
    api.getGroup.mockResolvedValue(group({ status: 'active', role: 'member' }));
    routeGroupApi([
      ['GET', /^\/974\/files\/folders$/, () => Promise.reject(new api.ApiError('nope', 500))],
      ['GET', /^\/974\/files\?/, { data: { items: [FILE], has_more: false } }],
    ]);
    const res = await request(app).get('/974/files');
    expect(res.status).toBe(200);
    expect(res.text).toContain('minutes-october.pdf');
    expect(res.text).not.toContain(t('govuk_alpha_groups.files.folder_filter_label'));
  });
});

describe('group announcements are reachable from the group page', () => {
  it('links a member to all announcements', async () => {
    api.getGroup.mockResolvedValue(group({ status: 'active', role: 'member' }));
    routeGroupApi([]);
    const res = await request(app).get('/974');
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/groups/974/announcements"');
    expect(res.text).not.toContain(t('govuk_alpha_groups.announcements.manage_link'));
  });

  it('gives an admin the manage-announcements link with the admin actions', async () => {
    api.getGroup.mockResolvedValue(group({ status: 'active', role: 'admin' }));
    routeGroupApi([]);
    const res = await request(app).get('/974');
    expect(res.text).toContain(t('govuk_alpha_groups.announcements.manage_link'));
  });

  it('links from the pinned announcements to the full list', async () => {
    api.getGroup.mockResolvedValue(group({ status: 'active', role: 'member' }));
    routeGroupApi([
      ['GET', /^\/974\/announcements$/, { data: { items: [{ id: 3, title: 'AGM on Friday', content: 'Hall', is_pinned: true }] } }],
    ]);
    const res = await request(app).get('/974');
    const pinnedAt = res.text.indexOf('AGM on Friday');
    expect(pinnedAt).toBeGreaterThan(-1);
    expect(res.text.indexOf('href="/groups/974/announcements"', pinnedAt)).toBeGreaterThan(-1);
  });

  it('does not offer the link to somebody who is not a member', async () => {
    api.getGroup.mockResolvedValue(group(null));
    routeGroupApi([]);
    const res = await request(app).get('/974');
    expect(res.text).not.toContain('href="/groups/974/announcements"');
  });
});

describe('a pending join request can be cancelled', () => {
  it('offers a cancel form to somebody whose request is pending', async () => {
    api.getGroup.mockResolvedValue(group({ status: 'pending', role: 'member' }));
    routeGroupApi([]);
    const res = await request(app).get('/974');
    expect(res.text).toContain(t('groups.pending_member'));
    expect(res.text).toContain('action="/groups/974/cancel-request"');
    expect(res.text).toContain(t('govuk_alpha_groups.membership.cancel_request'));
  });

  it('does not offer it to a member or to somebody who never asked', async () => {
    api.getGroup.mockResolvedValue(group({ status: 'active', role: 'member' }));
    routeGroupApi([]);
    let res = await request(app).get('/974');
    expect(res.text).not.toContain('/cancel-request');
    api.getGroup.mockResolvedValue(group(null));
    res = await request(app).get('/974');
    expect(res.text).not.toContain('/cancel-request');
  });

  it('withdraws the request through the membership endpoint React uses and says so', async () => {
    api.leaveGroup.mockResolvedValue({ data: { status: 'none', action: 'request_cancelled' } });
    const res = await request(app).post('/974/cancel-request').type('form').send({});
    expect(api.leaveGroup).toHaveBeenCalledWith('token:test', '974');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/groups/974?status=group-request-cancelled');
  });

  it('shows the cancelled message on the group page', async () => {
    api.getGroup.mockResolvedValue(group(null));
    routeGroupApi([]);
    const res = await request(app).get('/974?status=group-request-cancelled');
    expect(res.text).toContain(t('govuk_alpha_groups.states.group-request-cancelled'));
  });

  it('reports a failure without claiming success', async () => {
    api.leaveGroup.mockRejectedValue(new api.ApiError('Not a member', 409));
    const res = await request(app).post('/974/cancel-request').type('form').send({});
    expect(res.headers.location).toContain('status=group-failed');
  });
});
