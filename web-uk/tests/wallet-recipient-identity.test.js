// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Wallet recipient search: private surname, unambiguous recipient (2026-08-25).
 *
 * Surnames are private platform-wide, so `/v2/wallet/user-search` now returns a
 * first name only to ordinary members. That closes a leak but opens a worse
 * hazard on a transfer form: two members called Marzena produce two identical
 * "Send credits to Marzena" buttons, and picking the wrong one moves credits
 * that cannot be clawed back.
 *
 * These tests pin the compensating behaviour — the username is rendered beside
 * the first name, and each send button's accessible name identifies exactly one
 * member. They assert against the rendered HTML of BOTH wallet pages, because
 * `/wallet` and `/wallet/manage` carry separate copies of the recipient card.
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

// Exactly what a non-admin member now receives: a first name, a username, and
// no `last_name` key at all.
const TWO_MARZENAS = [
  { id: 41, first_name: 'Marzena', name: 'Marzena', username: 'marzena_k' },
  { id: 42, first_name: 'Marzena', name: 'Marzena', username: 'marzena_w' }
];

function mockWalletApi(users) {
  api.getBalance.mockResolvedValue({ data: { balance: 12 } });
  api.getTransactions.mockResolvedValue({ data: [] });
  api.callWalletApi.mockImplementation(async (token, method, apiPath) => {
    if (String(apiPath).startsWith('/user-search')) return { data: { users } };
    if (String(apiPath).startsWith('/community-fund')) {
      return { data: { balance: 5, total_donated: 5, enabled: true } };
    }
    return { data: {} };
  });
}

/** Accessible names of every "send credits" submit button on the page. */
function sendButtonLabels(html) {
  return [...html.matchAll(/<button[^>]*data-prevent-double-click="true"[^>]*>([\s\S]*?)<\/button>/g)]
    .map((match) => match[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter((label) => /credits to/i.test(label));
}

describe.each([
  ['/wallet', '/?recipient_q=Marzena'],
  ['/wallet/manage', '/manage?recipient_q=Marzena']
])('%s recipient search identifies each member', (label, url) => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWalletApi(TWO_MARZENAS);
  });

  it('shows the username beside the first name', async () => {
    const res = await request(buildApp()).get(url);

    expect(res.status).toBe(200);
    expect(res.text).toContain('@marzena_k');
    expect(res.text).toContain('@marzena_w');
  });

  it('gives two members with the same first name distinct send buttons', async () => {
    const res = await request(buildApp()).get(url);

    const labels = sendButtonLabels(res.text);
    expect(labels).toHaveLength(2);
    // The failure this guards against is two buttons reading "Send credits to
    // Marzena" — indistinguishable to a screen reader and to the eye.
    expect(new Set(labels).size).toBe(2);
    expect(labels[0]).toContain('@marzena_k');
    expect(labels[1]).toContain('@marzena_w');
  });

  it('never invents a surname when the API withholds one', async () => {
    const res = await request(buildApp()).get(url);

    expect(res.text).not.toContain('undefined');
    expect(res.text).not.toContain('Marzena null');
  });
});

describe('a recipient without a username still renders', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Usernames are nullable on `users`. A member who never set one must still
    // be selectable rather than rendering a bare "@".
    mockWalletApi([{ id: 51, first_name: 'Tomasz', name: 'Tomasz', username: null }]);
  });

  it('falls back to the name alone, with no empty handle', async () => {
    const res = await request(buildApp()).get('/?recipient_q=Tomasz');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Tomasz');
    expect(res.text).not.toMatch(/@\s*</);
    expect(sendButtonLabels(res.text)).toEqual(['Send credits to Tomasz']);
  });
});

describe('an organisation recipient keeps its registered name', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWalletApi([
      { id: 61, first_name: 'Bantry', name: 'Bantry Repair Cafe', username: 'bantry_repair' }
    ]);
  });

  it('shows the organisation name, not a truncated first name', async () => {
    const res = await request(buildApp()).get('/?recipient_q=Bantry');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Bantry Repair Cafe');
    expect(res.text).toContain('@bantry_repair');
  });
});
