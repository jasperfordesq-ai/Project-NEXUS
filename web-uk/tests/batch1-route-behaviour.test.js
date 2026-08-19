// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Behavioural cover for two Batch-1 route fixes (2026-08-14):
 *
 *   1. notifications POST /group/read and /delete-all must NOT redirect to their
 *      success `?status=` when the API call throws. They used to fall through to it,
 *      announcing "marked as read" / "deleted" while nothing had happened.
 *
 *   2. wallet POST /transfer must refuse an empty/short idempotency key BEFORE
 *      calling the transfer API — an empty key risks a double credit transfer.
 */
const express = require('express');
const session = require('express-session');
const request = require('supertest');
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
  return {
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    getNotifications: jest.fn(),
    getGroupedNotifications: jest.fn(),
    getNotificationUnreadCount: jest.fn().mockResolvedValue({ data: { count: 0 } }),
    markNotificationRead: jest.fn(),
    markAllNotificationsRead: jest.fn(),
    markNotificationGroupRead: jest.fn(),
    deleteAllNotifications: jest.fn(),
    deleteNotification: jest.fn(),
    // wallet
    getBalance: jest.fn().mockResolvedValue({ data: { balance: 100 } }),
    getTransactions: jest.fn().mockResolvedValue({ data: [] }),
    transferWalletCredits: jest.fn(),
    donateCredits: jest.fn(),
    callWalletApi: jest.fn(),
    callWalletDownload: jest.fn(),
  };
});

// The audit logger writes to a store we don't want in a unit test; make its
// middleware a pass-through.
jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() }),
}));

const api = require('../src/lib/api');
const notificationsRoutes = require('../src/routes/notifications');
const walletRoutes = require('../src/routes/wallet');

function mount(routes, base) {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: 'batch1-test-secret-at-least-32-chars',
    resave: false,
    saveUninitialized: false,
  }));
  app.use(base, (req, res, next) => {
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
    });
    next();
  }, routes);
  return app;
}

describe('Batch 1 — notifications must not report false success', () => {
  const app = mount(notificationsRoutes, '/');

  beforeEach(() => jest.clearAllMocks());

  it('POST /group/read does NOT redirect to success when the API throws', async () => {
    api.markNotificationGroupRead.mockRejectedValue(new api.ApiError('boom', 500));
    const res = await request(app).post('/group/read').type('form').send({ group_key: 'messages' });
    expect(res.status).toBe(302);
    expect(res.headers.location).not.toContain('group-marked-read');
  });

  it('POST /group/read DOES redirect to success when the API succeeds', async () => {
    api.markNotificationGroupRead.mockResolvedValue({ data: {} });
    const res = await request(app).post('/group/read').type('form').send({ group_key: 'messages' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('group-marked-read');
  });

  it('POST /delete-all does NOT redirect to success when the API throws', async () => {
    api.deleteAllNotifications.mockRejectedValue(new api.ApiError('boom', 500));
    const res = await request(app).post('/delete-all').type('form').send({});
    expect(res.status).toBe(302);
    expect(res.headers.location).not.toContain('all-notifications-deleted');
  });

  it('POST /delete-all DOES redirect to success when the API succeeds', async () => {
    api.deleteAllNotifications.mockResolvedValue({ data: {} });
    const res = await request(app).post('/delete-all').type('form').send({});
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('all-notifications-deleted');
  });
});

describe('Batch 1 — wallet transfer refuses an empty idempotency key', () => {
  const app = mount(walletRoutes, '/');

  beforeEach(() => jest.clearAllMocks());

  // `confirm: '1'` mirrors the template's required confirmation checkbox — the
  // route now enforces it server-side, so a POST without it is refused before
  // the idempotency-key check is even reached.
  it('does NOT call the transfer API when idempotency_key is empty', async () => {
    await request(app).post('/transfer').type('form').send({
      recipient_id: '5', amount: '3', note: 'hi', confirm: '1', idempotency_key: '',
    });
    expect(api.transferWalletCredits).not.toHaveBeenCalled();
  });

  it('DOES call the transfer API with a real idempotency key', async () => {
    api.transferWalletCredits.mockResolvedValue({ data: { ok: true } });
    await request(app).post('/transfer').type('form').send({
      recipient_id: '5', amount: '3', note: 'hi', confirm: '1', idempotency_key: 'abc-1234-def-5678',
    });
    expect(api.transferWalletCredits).toHaveBeenCalled();
  });

  it('does NOT call the transfer API when the confirmation box is not ticked', async () => {
    await request(app).post('/transfer').type('form').send({
      recipient_id: '5', amount: '3', note: 'hi', idempotency_key: 'abc-1234-def-5678',
    });
    expect(api.transferWalletCredits).not.toHaveBeenCalled();
  });
});
