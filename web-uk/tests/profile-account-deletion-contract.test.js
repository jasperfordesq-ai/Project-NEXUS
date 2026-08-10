// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const fs = require('fs');
const path = require('path');
const request = require('supertest');

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  },
  callProfileApi: jest.fn(),
  callUserSettingsApi: jest.fn(),
  callWebAuthnApi: jest.fn(),
  getProfile: jest.fn(),
  invalidateUserCache: jest.fn(),
  requestAccountDeletion: jest.fn()
}));

const api = require('../src/lib/api');
const { createTranslator } = require('../src/lib/localization');
const profileRouter = require('../src/routes/profile');

function createApp({ locale = 'en', prefix = '' } = {}) {
  const app = express();
  const destroySession = jest.fn((callback) => callback());

  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.secret = 'account-deletion-contract-secret';
    req.signedCookies = {
      token: 'test-token',
      refresh_token: 'test-refresh-token',
      tenant_slug: 'acme'
    };
    req.token = 'test-token';
    req.session = { destroy: destroySession };
    req.t = createTranslator(locale);
    res.locals.serviceName = 'Project NEXUS';
    res.locals.tenantName = 'Acme Community';
    res.locals.urlFor = (pathname) => `${prefix}${pathname}`;
    res.render = (view, locals = {}) => res.json({ view, locals });
    next();
  });
  app.use('/profile', profileRouter);
  app.use((error, req, res, next) => { // eslint-disable-line no-unused-vars
    res.status(error.status || 500).json({ error: error.message });
  });

  return { app, destroySession };
}

describe('Laravel pending account-erasure contract', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.requestAccountDeletion.mockResolvedValue({
      data: { request_id: 123, logout_required: true }
    });
  });

  it.each([
    [{ confirm: 'on' }, '/profile/delete-account?status=delete-password-required'],
    [{ password: 'current-password' }, '/profile/delete-account?status=delete-confirm-required']
  ])('rejects incomplete confirmation locally without calling Laravel', async (body, location) => {
    const { app, destroySession } = createApp();

    const response = await request(app)
      .post('/profile/delete-account')
      .type('form')
      .send(body);

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(location);
    expect(api.requestAccountDeletion).not.toHaveBeenCalled();
    expect(api.invalidateUserCache).not.toHaveBeenCalled();
    expect(destroySession).not.toHaveBeenCalled();
  });

  it.each([
    [400, 'delete-password-required'],
    [403, 'delete-password-incorrect'],
    [429, 'delete-failed'],
    [500, 'delete-failed']
  ])('maps Laravel error %s without clearing the signed-in session', async (status, expectedStatus) => {
    api.requestAccountDeletion.mockRejectedValueOnce(new api.ApiError('Request failed', status));
    const { app, destroySession } = createApp();

    const response = await request(app)
      .post('/profile/delete-account')
      .type('form')
      .send({ password: 'current-password', confirm: 'on', reason: 'Leaving' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe(`/profile/delete-account?status=${expectedStatus}`);
    expect(api.invalidateUserCache).not.toHaveBeenCalled();
    expect(destroySession).not.toHaveBeenCalled();
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('routes an expired API session through the active tenant mount', async () => {
    api.requestAccountDeletion.mockRejectedValueOnce(new api.ApiError('Unauthenticated', 401));
    const { app, destroySession } = createApp({ prefix: '/acme/accessible' });

    const response = await request(app)
      .post('/profile/delete-account')
      .type('form')
      .send({ password: 'current-password', confirm: 'on' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/acme/accessible/login?status=auth-required');
    expect(api.invalidateUserCache).not.toHaveBeenCalled();
    expect(destroySession).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { data: { request_id: 123 } },
    { data: { request_id: 123, logout_required: false } }
  ])('fails closed when Laravel omits mandatory session-revocation evidence', async (result) => {
    api.requestAccountDeletion.mockResolvedValueOnce(result);
    const { app, destroySession } = createApp();

    const response = await request(app)
      .post('/profile/delete-account')
      .type('form')
      .send({ password: 'current-password', confirm: 'on' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/profile/delete-account?status=delete-failed');
    expect(api.invalidateUserCache).not.toHaveBeenCalled();
    expect(destroySession).not.toHaveBeenCalled();
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('submits a pending erasure request then clears cache, session, and auth cookies', async () => {
    const { app, destroySession } = createApp({ prefix: '/acme/accessible' });
    const reason = ` ${'x'.repeat(1005)} `;

    const response = await request(app)
      .post('/profile/delete-account')
      .type('form')
      .send({ password: 'current-password', confirm: 'on', reason });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/acme/accessible/login?status=account-deletion-requested');
    expect(api.requestAccountDeletion).toHaveBeenCalledWith('test-token', {
      password: 'current-password',
      reason: 'x'.repeat(1005)
    });
    expect(api.requestAccountDeletion.mock.calls[0][1]).not.toHaveProperty('confirm');
    expect(api.invalidateUserCache).toHaveBeenCalledWith('test-token');
    expect(destroySession).toHaveBeenCalledTimes(1);

    const clearedCookies = (response.headers['set-cookie'] || []).join(';');
    for (const cookieName of ['token=', 'refresh_token=', 'tenant_slug=']) {
      expect(clearedCookies).toContain(cookieName);
    }
    expect(clearedCookies).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  });

  it('uses the exact Laravel title and warning keys without hard-coded destructive copy', async () => {
    const { app } = createApp({ locale: 'ga' });
    const response = await request(app).get('/profile/delete-account');
    const source = fs.readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'profile', 'delete.njk'),
      'utf8'
    );

    expect(response.status).toBe(200);
    expect(response.body.locals.titleKey).toBe('delete_account.title');
    expect(source).toContain('t("delete_account.title")');
    expect(source).toContain('t("delete_account.warning_prefix")');
    expect(source).toContain('t("delete_account.warning", { community: communityName })');
    expect(source).not.toContain('This will permanently remove your account');
  });
});
