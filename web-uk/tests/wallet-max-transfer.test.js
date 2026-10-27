// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The transfer ceiling is a TENANT setting (`wallet.max_transfer`, capped at
 * 1000 by WalletService::maxTransferAmount) and Laravel publishes the effective
 * value at GET /v2/wallet/config. The accessible wallet hard-coded 1000 in its
 * validation, hint and input max, so a community with a lower limit was told it
 * could send 1000 and then refused by the API with a generic failure.
 */


const express = require('express');
const session = require('express-session');
const path = require('path');
const nunjucks = require('nunjucks');
const request = require('supertest');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');

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
    getBalance: jest.fn(),
    getTransactions: jest.fn(),
    transferWalletCredits: jest.fn(),
    donateCredits: jest.fn(),
    callWalletApi: jest.fn(),
    callWalletDownload: jest.fn()
  };
});

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() })
}));

const api = require('../src/lib/api');
const walletRoutes = require('../src/routes/wallet');

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const PREFIX = '/acme/accessible';

function buildApp() {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  env.addFilter('formatDate', (value) => String(value || ''));
  env.addFilter('nl2br', (value) => String(value || ''));
  env.addFilter('string', String);
  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: 'wallet-recipient-identity-test-secret',
    resave: false,
    saveUninitialized: false,
    name: 'wallet-recipient-identity.sid'
  }));

  app.use('/', (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.accessibleRouting = {
      mode: 'shared',
      tenantSlug: 'acme',
      tenant: { id: 2, slug: 'acme', name: 'Acme Timebank' },
      prefix: PREFIX
    };
    res.locals.urlFor = (value) => String(value || '/');
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS',
      tenantName: 'Acme Timebank',
      isAuthenticated: true,
      csrfToken: 'test-csrf-token',
      alphaNavItems: [],
      feedbackUrl: `${PREFIX}/feedback`,
      currentPath: '/',
      alphaLocaleOptions: [],
      alphaLanguageQueryParams: [],
      htmlLang: 'en',
      htmlDirection: 'ltr',
      t: createTranslator('en'),
      tc: createChoiceTranslator('en'),
      formatLocaleNumber: (value) => String(value ?? ''),
      formatLocaleDate: (value) => String(value ?? '')
    });
    next();
  }, walletRoutes);

  return app;
}

function mockWallet(config) {
  api.getBalance.mockResolvedValue({ data: { balance: 12 } });
  api.getTransactions.mockResolvedValue({ data: [] });
  api.transferWalletCredits.mockResolvedValue({ data: {} });
  api.callWalletApi.mockImplementation(async (token, method, apiPath) => {
    if (String(apiPath).startsWith('/config')) {
      if (config instanceof Error) throw config;
      return { data: config };
    }
    if (String(apiPath).startsWith('/user-search')) {
      return { data: { users: [{ id: 41, first_name: 'Marzena', name: 'Marzena', username: 'marzena_k' }] } };
    }
    if (String(apiPath).startsWith('/community-fund')) return { data: { balance: 5, enabled: true } };
    return { data: {} };
  });
}

function transferBody(amount) {
  return { recipient_id: '41', amount: String(amount), confirm: '1', idempotency_key: 'abcdef123456' };
}

describe.each([
  ['/wallet', '/?recipient_q=Marzena'],
  ['/wallet/manage', '/manage?recipient_q=Marzena']
])('%s advertises the community limit', (label, url) => {
  beforeEach(() => jest.clearAllMocks());

  it('uses max_transfer from the API for the input max and hint', async () => {
    mockWallet({ max_transfer: 50 });
    const res = await request(buildApp()).get(url);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/id="amount-41"[^>]*max="50"/);
    expect(res.text).toContain('50 hours');
    expect(res.text).not.toMatch(/id="amount-41"[^>]*max="1000"/);
  });

  it('falls back to 1000 when the config call fails', async () => {
    mockWallet(new Error('down'));
    const res = await request(buildApp()).get(url);
    expect(res.status).toBe(200);
    expect(res.text).toMatch(/id="amount-41"[^>]*max="1000"/);
  });
});

describe('POST /transfer validates against the community limit', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuses an amount above max_transfer without calling the transfer API', async () => {
    mockWallet({ max_transfer: 50 });
    const res = await request(buildApp()).post('/transfer').type('form').send(transferBody(60));
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('error=too-large');
    expect(api.transferWalletCredits).not.toHaveBeenCalled();
  });

  it('accepts an amount within max_transfer', async () => {
    mockWallet({ max_transfer: 50 });
    const res = await request(buildApp()).post('/transfer').type('form').send(transferBody(40));
    expect(res.headers.location).toContain('status=transfer-sent');
    expect(api.transferWalletCredits).toHaveBeenCalled();
  });

  it('keeps 1000 as the ceiling when the API does not say', async () => {
    mockWallet({});
    let res = await request(buildApp()).post('/transfer').type('form').send(transferBody(900));
    expect(res.headers.location).toContain('status=transfer-sent');
    res = await request(buildApp()).post('/transfer').type('form').send(transferBody(1001));
    expect(res.headers.location).toContain('error=too-large');
  });

  it('names the limit in the too-large message', async () => {
    mockWallet({ max_transfer: 50 });
    const res = await request(buildApp()).get('/?status=transfer-failed&error=too-large&recipient_q=Marzena');
    expect(res.text).toContain('The maximum is 50 hours per transfer.');
  });
});
