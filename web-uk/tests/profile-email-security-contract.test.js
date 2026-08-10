// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
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
  invalidateUserCache: jest.fn(),
  requestAccountDeletion: jest.fn()
}));

const api = require('../src/lib/api');
const profileRouter = require('../src/routes/profile');

function createApp({ prefix = '', token = 'test-token' } = {}) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.signedCookies = token ? { token } : {};
    req.token = token;
    res.locals.urlFor = (pathname) => `${prefix}${pathname}`;
    next();
  });
  app.use('/profile', profileRouter);
  return app;
}

describe('profile email-change re-authentication boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('fails closed instead of sending an unverified email change to the generic profile API', async () => {
    const response = await request(createApp())
      .post('/profile/email')
      .type('form')
      .send({ email: 'new@example.org', current_password: 'current-password' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/profile/settings?status=email-reauthentication-unavailable');
    expect(api.callUserSettingsApi).not.toHaveBeenCalled();
  });

  it('keeps local validation and tenant-mounted auth redirects ahead of the blocked write', async () => {
    const invalid = await request(createApp({ prefix: '/acme/accessible' }))
      .post('/profile/email')
      .type('form')
      .send({ email: 'not-an-email', current_password: 'current-password' });
    const unsigned = await request(createApp({ prefix: '/acme/accessible', token: '' }))
      .post('/profile/email')
      .type('form')
      .send({ email: 'new@example.org', current_password: 'current-password' });

    expect(invalid.status).toBe(302);
    expect(invalid.headers.location).toBe('/acme/accessible/profile/settings?status=email-invalid');
    expect(unsigned.status).toBe(302);
    expect(unsigned.headers.location).toBe('/acme/accessible/login?status=auth-required');
    expect(api.callUserSettingsApi).not.toHaveBeenCalled();
  });
});
