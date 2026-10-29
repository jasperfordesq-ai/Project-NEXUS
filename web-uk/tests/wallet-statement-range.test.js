// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The statement download takes an optional date range. Laravel's
 * GET /v2/wallet/statement reads `start_date` / `end_date` (YYYY-MM-DD), the pair
 * React's statement dialog sends; the accessible site could only download
 * everything. Dates use the GOV.UK three-field pattern.
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

describe('statement download date range', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWallet({ max_transfer: 50 });
    api.callWalletDownload.mockResolvedValue({ status: 200, headers: { 'content-type': 'text/csv' }, body: 'a,b' });
  });

  it('shows the From and To date fields on the wallet page', async () => {
    const res = await request(buildApp()).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('id="statement"');
    expect(res.text).toContain('name="start_date-day"');
    expect(res.text).toContain('name="end_date-year"');
  });

  it('downloads everything when no dates are entered', async () => {
    const res = await request(buildApp()).get('/export.csv');
    expect(res.status).toBe(200);
    expect(api.callWalletDownload).toHaveBeenCalledWith('token:test', '/statement');
  });

  it('sends the range as start_date and end_date', async () => {
    await request(buildApp()).get('/export.csv?start_date-day=1&start_date-month=3&start_date-year=2026&end_date-day=31&end_date-month=3&end_date-year=2026');
    expect(api.callWalletDownload).toHaveBeenCalledWith('token:test', '/statement?start_date=2026-03-01&end_date=2026-03-31');
  });

  it('refuses an end date before the start date without calling the API, and shows why', async () => {
    const res = await request(buildApp()).get('/export.csv?start_date-day=5&start_date-month=3&start_date-year=2026&end_date-day=1&end_date-month=3&end_date-year=2026');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('status=statement-invalid');
    expect(api.callWalletDownload).not.toHaveBeenCalled();
    const page = await request(buildApp()).get(res.headers.location.replace(/#.*/, '').replace(/^\/wallet/, ''));
    expect(page.text).toContain('The end date must be on or after the start date.');
    expect(page.text).toContain('href="#end_date-day"');
    expect(page.text).toMatch(/name="start_date-day"[^>]*value="5"|value="5"[^>]*name="start_date-day"/);
  });

  it('refuses an impossible date', async () => {
    const res = await request(buildApp()).get('/export.csv?start_date-day=31&start_date-month=2&start_date-year=2026');
    expect(res.headers.location).toContain('status=statement-invalid');
    const page = await request(buildApp()).get(res.headers.location.replace(/#.*/, '').replace(/^\/wallet/, ''));
    expect(page.text).toContain('Enter a real date');
  });

  it('sends the member back with an error when Laravel refuses the export', async () => {
    api.callWalletDownload.mockResolvedValue({ status: 429, headers: {}, body: '{}' });
    const res = await request(buildApp()).get('/export.csv');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('status=export-failed');
  });
});
