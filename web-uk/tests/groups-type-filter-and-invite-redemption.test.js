// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Two groups gaps against React (26 Oct 2026).
 *
 * 1. Group types (React c7344ef45): the directory offers a "Group type" filter
 *    from GET /api/v2/groups/types, sends it as `type_id`, keeps it across "next
 *    page", and each card shows its type.
 * 2. Invitation links (React route groups/invite/:token): organisers could mint
 *    and email links but nothing redeemed them here. A signed-out visitor is sent
 *    to sign in and brought back (allowlisted return path); a signed-in member
 *    sees the group and accepts; API refusals are explained.
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
    getGroups: jest.fn(),
    callGroupApi: jest.fn()
  }, {
    get: (target, prop) => (prop in target ? target[prop] : jest.fn().mockResolvedValue({ data: [] }))
  });
});

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() })
}));

const api = require('../src/lib/api');
const groupsRoutes = require('../src/routes/groups');
const { safeLoginReturnPath } = require('../src/lib/login-return');

const t = createTranslator('en');
const TOKEN = 'a'.repeat(20) + 'B'.repeat(20);

function mount({ signedIn }) {
  const app = express();
  const environment = nunjucks.configure(
    [path.join(__dirname, '..', 'src', 'views'), path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
    { autoescape: true, noCache: true, express: app }
  );
  require('../src/lib/template-filters').registerTemplateFilters(environment);
  app.set('view engine', 'njk');
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'groups-parity-test-secret-at-least-32-chars', resave: false, saveUninitialized: false }));
  app.use('/', (req, res, next) => {
    req.signedCookies = signedIn ? { token: 'token:test' } : {};
    if (signedIn) req.token = 'token:test';
    req.csrfToken = () => 'csrf';
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'test', prefix: '', tenant: { id: 2, slug: 'test', features: { groups: true } } };
    res.locals.urlFor = (v) => String(v || '/');
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS', tenantName: 'Test', isAuthenticated: signedIn, csrfToken: 'csrf',
      t, tc: createChoiceTranslator('en'), htmlLang: 'en', htmlDirection: 'ltr'
    });
    next();
  }, groupsRoutes);
  return app;
}

const signedInApp = mount({ signedIn: true });
const signedOutApp = mount({ signedIn: false });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('group type filter', () => {
  beforeEach(() => {
    api.getGroups.mockResolvedValue({
      data: [
        { id: 1, name: 'Allotment crew', visibility: 'public', type: { id: 3, name: 'Interest group', color: '#00ff00' } },
        { id: 2, name: 'No type here', visibility: 'public', type: null }
      ],
      meta: { has_more: true, cursor: 'next-1' }
    });
    api.callGroupApi.mockImplementation(async (token, method, p) => (
      p === '/types' ? { data: [{ id: 3, name: 'Interest group' }, { id: 4, name: 'Neighbourhood' }] } : { data: [] }
    ));
  });

  it('offers the community types, sends type_id, keeps it on the next page and labels cards', async () => {
    const page = await request(signedInApp).get('/?type=3');
    expect(page.status).toBe(200);
    expect(api.getGroups).toHaveBeenCalledWith('token:test', expect.objectContaining({ type_id: 3 }));
    expect(page.text).toContain(t('govuk_alpha_groups.directory.type_label'));
    expect(page.text).toContain(t('govuk_alpha_groups.directory.type_all'));
    expect(page.text).toMatch(/<option value="3" selected>Interest group<\/option>/);
    expect(page.text).toContain('Neighbourhood');
    expect(page.text).toContain('type=3');
    // Card label for the typed group only.
    expect(page.text.match(/govuk-tag--blue/g) || []).toHaveLength(1);
  });

  it('hides the filter when the community has no active types, and ignores a junk type', async () => {
    api.callGroupApi.mockResolvedValue({ data: [] });
    const page = await request(signedInApp).get('/?type=abc');
    expect(page.status).toBe(200);
    expect(page.text).not.toContain('name="type"');
    expect(api.getGroups.mock.calls[0][1].type_id).toBeUndefined();
  });
});

describe('invitation link redemption', () => {
  const preview = (membership = 'none') => ({
    data: {
      invite: { id: 9, type: 'link', status: 'pending' },
      group: { id: 12, name: 'Repair Cafe', visibility: 'public', member_count: 7 },
      membership: { status: membership }
    }
  });

  it('asks a signed-out visitor to sign in and brings them back afterwards', async () => {
    const page = await request(signedOutApp).get(`/invite/${TOKEN}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain(t('govuk_alpha_groups.invite_accept.sign_in_needed'));
    expect(page.text).toContain(`return_to=${encodeURIComponent(`/groups/invite/${TOKEN}`)}`);
    expect(api.callGroupApi).not.toHaveBeenCalled();
  });

  it('shows a signed-in member the group and an accept button', async () => {
    api.callGroupApi.mockResolvedValue(preview());
    const page = await request(signedInApp).get(`/invite/${TOKEN}`);
    expect(page.status).toBe(200);
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'GET', `/invite/${TOKEN}`);
    expect(page.text).toContain('Repair Cafe');
    expect(page.text).toContain(`action="/groups/invite/${TOKEN}/accept"`);
    expect(page.text).toContain(t('govuk_alpha_groups.invite_accept.accept'));
  });

  it('accepts through the API and confirms', async () => {
    api.callGroupApi.mockResolvedValueOnce({ data: { action: 'joined', group: { id: 12 } } });
    const post = await request(signedInApp).post(`/invite/${TOKEN}/accept`).type('form').send({ _csrf: 'csrf' });
    expect(post.status).toBe(302);
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'POST', `/invite/${TOKEN}/accept`, {});
    expect(post.headers.location).toBe(`/groups/invite/${TOKEN}?status=accepted`);

    api.callGroupApi.mockResolvedValueOnce(preview('active'));
    const page = await request(signedInApp).get(`/invite/${TOKEN}?status=accepted`);
    expect(page.text).toContain(t('govuk_alpha_groups.invite_accept.success'));
    expect(page.text).toContain('href="/groups/12"');
    expect(page.text).not.toContain('/accept"');
  });

  it('explains an expired invitation from the preview', async () => {
    api.callGroupApi.mockRejectedValue(new api.ApiError('gone', 410, { errors: [{ code: 'EXPIRED' }] }));
    const page = await request(signedInApp).get(`/invite/${TOKEN}`);
    expect(page.text).toContain(t('govuk_alpha_groups.invite_accept.error_expired'));
    expect(page.text).not.toContain('/accept"');
  });

  it('explains a refusal on accept (group full)', async () => {
    api.callGroupApi.mockRejectedValueOnce(new api.ApiError('full', 409, { errors: [{ code: 'CAPACITY_FULL' }] }));
    const post = await request(signedInApp).post(`/invite/${TOKEN}/accept`).type('form').send({});
    expect(post.headers.location).toBe(`/groups/invite/${TOKEN}?error=CAPACITY_FULL`);
    api.callGroupApi.mockResolvedValueOnce(preview());
    const page = await request(signedInApp).get(post.headers.location.slice('/groups'.length));
    expect(page.text).toContain(t('govuk_alpha_groups.invite_accept.error_capacity'));
  });

  it('does not route a malformed token', async () => {
    const page = await request(signedInApp).get('/invite/short-token');
    expect(page.status).toBe(404);
  });
});

describe('sign-in return path allowlist', () => {
  it('accepts only a group invitation path', () => {
    expect(safeLoginReturnPath(`/groups/invite/${TOKEN}`)).toBe(`/groups/invite/${TOKEN}`);
    expect(safeLoginReturnPath('//evil.example')).toBe('');
    expect(safeLoginReturnPath('/dashboard')).toBe('');
    expect(safeLoginReturnPath(`/groups/invite/${TOKEN}/../../x`)).toBe('');
    expect(safeLoginReturnPath('https://evil.example/groups/invite/' + TOKEN)).toBe('');
  });
});
