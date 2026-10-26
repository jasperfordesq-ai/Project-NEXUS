// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Blocking a partner-community member on the accessible frontend (F-284, 26 Oct 2026).
 *
 * Since 29 Sep 2026 a member may block a member of another community on the same
 * installation, and the block stops that person's federated messages, connection
 * requests and credit transfers. React gained the control then; this frontend had
 * none, so a member here could not stop unwanted contact from a partner community.
 *
 * Pinned here:
 * - an internal partner's profile offers Block, using the member block endpoint;
 * - once blocked, the profile says so, offers Unblock and offers no contact at all;
 * - block and unblock post to the API and return to the profile with an outcome;
 * - an EXTERNAL partner's member (tenant `ext-N`) is never offered Block and a forged
 *   form is refused before the API — that id belongs to another installation.
 */

const path = require('path');
const express = require('express');
const session = require('express-session');
const nunjucks = require('nunjucks');
const request = require('supertest');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }
  return {
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    callFederationApi: jest.fn(),
    getBalance: jest.fn(),
    getUserBlockStatus: jest.fn(),
    blockMember: jest.fn(),
    unblockMember: jest.fn()
  };
});

const api = require('../src/lib/api');
const federationRoutes = require('../src/routes/federation');
const federationActionRoutes = require('../src/routes/federation-actions');

const PREFIX = '/acme/accessible';
const MOUNT = `${PREFIX}/federation`;
const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const t = createTranslator('en');

function createApp() {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  env.addFilter('formatDate', (value) => String(value || ''));
  env.addFilter('nl2br', (value) => String(value || ''));

  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'partner-block-test-secret', resave: false, saveUninitialized: false }));

  app.use(MOUNT, (req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.accessibleRouting = {
      mode: 'shared',
      tenantSlug: 'acme',
      tenant: { id: 2, slug: 'acme', name: 'Acme Timebank', settings: {} },
      prefix: PREFIX
    };
    res.locals.urlFor = (value) => {
      const target = String(value || '/');
      return target.startsWith(PREFIX) ? target : `${PREFIX}${target.startsWith('/') ? target : `/${target}`}`;
    };
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS',
      tenantName: 'Acme Timebank',
      isAuthenticated: true,
      csrfToken: 'test-csrf-token',
      alphaNavItems: [],
      feedbackUrl: `${PREFIX}/feedback`,
      currentPath: MOUNT,
      alphaLocaleOptions: [],
      alphaLanguageQueryParams: [],
      htmlLang: 'en',
      htmlDirection: 'ltr',
      t,
      tc: createChoiceTranslator('en'),
      formatLocaleNumber: (value) => String(value ?? ''),
      formatLocaleDate: (value) => String(value ?? '')
    });
    next();
  }, federationRoutes, federationActionRoutes);

  return app;
}

function member(overrides = {}) {
  return {
    id: 20,
    name: 'Robin Partner',
    tenant_id: 9,
    timebank: { id: 9, name: 'Partner Timebank' },
    messaging_enabled: true,
    transactions_enabled: true,
    connection_status: 'none',
    ...overrides
  };
}

function mockProfile(memberData) {
  api.callFederationApi.mockImplementation((token, method, endpoint) => {
    if (endpoint === '/settings') {
      return Promise.resolve({
        data: {
          enabled: true,
          settings: { federation_optin: true, messaging_enabled_federated: true, transactions_enabled_federated: true }
        }
      });
    }
    return Promise.resolve({ data: memberData });
  });
}

const blockAction = `action="${PREFIX}/federation/members/20/block"`;
const unblockAction = `action="${PREFIX}/federation/members/20/unblock"`;

describe('blocking a partner-community member', () => {
  beforeEach(() => jest.clearAllMocks());

  it('offers Block on an internal partner member and still offers contact', async () => {
    mockProfile(member());
    api.getUserBlockStatus.mockResolvedValue({ data: { is_blocked: false, is_blocked_by: false } });

    const res = await request(createApp()).get(`${MOUNT}/members/20?tenant_id=9`);

    expect(res.status).toBe(200);
    expect(api.getUserBlockStatus).toHaveBeenCalledWith('test-token', 20);
    expect(res.text).toContain(blockAction);
    expect(res.text).toContain('name="member_tenant_id" value="9"');
    expect(res.text).toContain(t('profile.block.toggle'));
    expect(res.text).not.toContain(unblockAction);
    expect(res.text).toContain(`action="${PREFIX}/federation/messages"`);
  });

  it('shows an existing block, offers Unblock and offers no contact', async () => {
    mockProfile(member());
    api.getUserBlockStatus.mockResolvedValue({ data: { is_blocked: true, is_blocked_by: false } });

    const res = await request(createApp()).get(`${MOUNT}/members/20?tenant_id=9`);

    expect(res.status).toBe(200);
    expect(res.text).toContain(t('profile.block.is_blocked', { name: 'Robin Partner' }));
    expect(res.text).toContain(unblockAction);
    expect(res.text).not.toContain(blockAction);
    expect(res.text).not.toContain(`action="${PREFIX}/federation/messages"`);
    expect(res.text).not.toContain(`action="${PREFIX}/federation/connections"`);
    expect(res.text).not.toContain('/transfer?tenant_id=');
  });

  it('never offers Block on an external partner member, and does not look the id up', async () => {
    mockProfile(member({ tenant_id: 'ext-3', timebank: { id: 'ext-3', name: 'Elsewhere' } }));

    const res = await request(createApp()).get(`${MOUNT}/members/20?tenant_id=ext-3`);

    expect(res.status).toBe(200);
    expect(api.getUserBlockStatus).not.toHaveBeenCalled();
    expect(res.text).not.toContain(blockAction);
  });

  it('still renders the profile, offering Block, when the block status cannot be read', async () => {
    mockProfile(member());
    api.getUserBlockStatus.mockRejectedValue(new api.ApiError('down', 500));

    const res = await request(createApp()).get(`${MOUNT}/members/20?tenant_id=9`);

    expect(res.status).toBe(200);
    expect(res.text).toContain(blockAction);
  });

  it('blocks the member and returns to the profile with a success message', async () => {
    api.blockMember.mockResolvedValue({ success: true });

    const res = await request(createApp())
      .post(`${MOUNT}/members/20/block`)
      .type('form')
      .send({ member_tenant_id: '9' });

    expect(api.blockMember).toHaveBeenCalledWith('test-token', 20);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${PREFIX}/federation/members/20?tenant_id=9&status=member-blocked`);

    mockProfile(member());
    api.getUserBlockStatus.mockResolvedValue({ data: { is_blocked: true } });
    const page = await request(createApp()).get(`${MOUNT}/members/20?tenant_id=9&status=member-blocked`);
    expect(page.text).toContain(t('profile.block.status_member_blocked'));
  });

  it('says so when the block fails', async () => {
    api.blockMember.mockRejectedValue(new api.ApiError('nope', 404));

    const res = await request(createApp())
      .post(`${MOUNT}/members/20/block`)
      .type('form')
      .send({ member_tenant_id: '9' });

    expect(res.headers.location).toBe(`${PREFIX}/federation/members/20?tenant_id=9&status=block-failed`);
  });

  it('refuses a forged block of an external partner member before calling the API', async () => {
    const res = await request(createApp())
      .post(`${MOUNT}/members/20/block`)
      .type('form')
      .send({ member_tenant_id: 'ext-3' });

    expect(api.blockMember).not.toHaveBeenCalled();
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${PREFIX}/federation/members?status=block-failed`);
  });

  it('unblocks the member, treating "was not blocked" as done', async () => {
    api.unblockMember.mockRejectedValue(new api.ApiError('not blocked', 404));

    const res = await request(createApp())
      .post(`${MOUNT}/members/20/unblock`)
      .type('form')
      .send({ member_tenant_id: '9' });

    expect(api.unblockMember).toHaveBeenCalledWith('test-token', 20);
    expect(res.headers.location).toBe(`${PREFIX}/federation/members/20?tenant_id=9&status=member-unblocked`);
  });

  it('sends a signed-out visitor to sign in without calling the API', async () => {
    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use(MOUNT, (req, res, next) => {
      req.signedCookies = {};
      res.locals.urlFor = (value) => `${PREFIX}${value}`;
      next();
    }, federationActionRoutes);

    const res = await request(app).post(`${MOUNT}/members/20/block`).type('form').send({ member_tenant_id: '9' });

    expect(api.blockMember).not.toHaveBeenCalled();
    expect(res.headers.location).toBe(`${PREFIX}/login?status=auth-required`);
  });
});
