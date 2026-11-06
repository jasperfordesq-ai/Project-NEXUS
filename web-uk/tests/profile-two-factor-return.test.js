// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The onboarding "Protect your account" step sends a member to
 * /profile/two-factor?return=/onboarding/security. The return address must be
 * carried through the password and code forms and offered as "Continue" once
 * the recovery codes are shown — but ONLY when it is exactly one of the
 * allow-listed wizard paths. Anything else is ignored (no open redirect), and
 * without the parameter the page behaves exactly as before.
 */

const path = require('path');
const express = require('express');
const nunjucks = require('nunjucks');
const request = require('supertest');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');

jest.mock('../src/lib/api', () => ({
  ApiOfflineError: class ApiOfflineError extends Error {},
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

jest.mock('../src/middleware/auth', () => ({
  clearAuthCookies: jest.fn(),
  requireAuth: (req, res, next) => next()
}));

const api = require('../src/lib/api');
const profileRouter = require('../src/routes/profile');

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const t = createTranslator('en');

function createApp() {
  const app = express();
  const session = {};
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.session = session;
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    res.locals.urlFor = (pathname) => pathname;
    res.render = (view, locals = {}) => res.json({ view, locals });
    next();
  });
  app.use('/profile', profileRouter);
  app.use((error, req, res, next) => { // eslint-disable-line no-unused-vars
    res.status(error.status || 500).json({ error: error.message });
  });
  return app;
}

function renderPage(locals) {
  const env = new nunjucks.Environment(new nunjucks.FileSystemLoader([VIEWS, GOVUK]), { autoescape: true });
  registerTemplateFilters(env);
  return env.render('profile/two-factor.njk', {
    t,
    tc: createChoiceTranslator('en'),
    urlFor: (value) => String(value || '/'),
    serviceName: 'Project NEXUS',
    tenantName: 'Acme Timebank',
    isAuthenticated: true,
    csrfToken: 'test-csrf-token',
    alphaNavItems: [],
    alphaLocaleOptions: [],
    alphaLanguageQueryParams: [],
    htmlLang: 'en',
    htmlDirection: 'ltr',
    formatLocaleNumber: (value) => String(value ?? ''),
    formatLocaleDate: (value) => String(value ?? ''),
    title: 'Authenticator app',
    status: '',
    statusConfig: null,
    backupCodes: [],
    ...locals
  });
}

const STATUS_OFF = { data: { enabled: false, setup_required: false, backup_codes_remaining: 0 } };

describe('returning to the onboarding wizard after two-factor set-up', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.callProfileApi.mockReset();
    api.callWebAuthnApi.mockReset();
  });

  it.each(['/onboarding/security', '/onboarding/confirm'])('keeps the allow-listed return path %s on the page', async (returnPath) => {
    api.callProfileApi.mockResolvedValueOnce(STATUS_OFF);
    const response = await request(createApp()).get(`/profile/two-factor?return=${encodeURIComponent(returnPath)}`);
    expect(response.status).toBe(200);
    expect(response.body.locals.returnPath).toBe(returnPath);
  });

  it.each([
    'https://evil.example/onboarding/security',
    '//evil.example',
    '/onboarding/security?x=1',
    '/onboarding/security/',
    '/profile/settings',
    '/onboarding/../admin',
    ''
  ])('ignores the return value %p', async (value) => {
    api.callProfileApi.mockResolvedValueOnce(STATUS_OFF);
    const response = await request(createApp()).get(`/profile/two-factor?return=${encodeURIComponent(value)}`);
    expect(response.status).toBe(200);
    expect(response.body.locals.returnPath).toBe('');
  });

  it('ignores a repeated (array) return parameter', async () => {
    api.callProfileApi.mockResolvedValueOnce(STATUS_OFF);
    const response = await request(createApp()).get('/profile/two-factor?return=%2Fonboarding%2Fsecurity&return=%2Fonboarding%2Fconfirm');
    expect(response.body.locals.returnPath).toBe('');
  });

  it('carries the return path through a refused password and into the pending set-up', async () => {
    const app = createApp();
    const missing = await request(app).post('/profile/two-factor/setup').type('form')
      .send({ return: '/onboarding/security' });
    expect(missing.headers.location).toBe('/profile/two-factor?status=2fa-setup-password-required&return=%2Fonboarding%2Fsecurity');

    api.callWebAuthnApi.mockResolvedValueOnce({ data: { security_confirmation_token: 'conf-tok' } });
    api.callProfileApi.mockResolvedValueOnce({ data: { qr_code_url: 'data:image/svg+xml;base64,PHN2Zy8+', secret: 'PENDING' } });
    const started = await request(app).post('/profile/two-factor/setup').type('form')
      .send({ current_password: 'CurrentPassword!123', return: '/onboarding/security' });
    expect(started.headers.location).toBe('/profile/two-factor?return=%2Fonboarding%2Fsecurity');
    // The F-170 fresh confirmation is still required and still used.
    expect(api.callProfileApi).toHaveBeenCalledWith('test-token', 'POST', '/auth/2fa/setup', { security_confirmation_token: 'conf-tok' });
  });

  it('drops a foreign return value on the setup redirect', async () => {
    const response = await request(createApp()).post('/profile/two-factor/setup').type('form')
      .send({ return: 'https://evil.example' });
    expect(response.headers.location).toBe('/profile/two-factor?status=2fa-setup-password-required');
  });

  it('offers the wizard back once the recovery codes are shown', async () => {
    const app = createApp();
    api.callWebAuthnApi.mockResolvedValueOnce({ data: { security_confirmation_token: 'conf-tok' } });
    api.callProfileApi
      .mockResolvedValueOnce({ data: { qr_code_url: 'data:image/svg+xml;base64,PHN2Zy8+', secret: 'PENDING' } })
      .mockResolvedValueOnce({ data: { backup_codes: ['otter-amber'] } });
    await request(app).post('/profile/two-factor/setup').type('form')
      .send({ current_password: 'CurrentPassword!123', return: '/onboarding/security' });

    const badCode = await request(app).post('/profile/two-factor/verify').type('form')
      .send({ code: '12', return: '/onboarding/security' });
    expect(badCode.headers.location).toBe('/profile/two-factor?status=2fa-code-invalid&return=%2Fonboarding%2Fsecurity');

    const verified = await request(app).post('/profile/two-factor/verify').type('form')
      .send({ code: '123456', return: '/onboarding/security' });
    expect(verified.status).toBe(200);
    expect(verified.body.locals.backupCodes).toEqual(['otter-amber']);
    expect(verified.body.locals.returnPath).toBe('/onboarding/security');
  });

  it('keeps the normal settings ending when verify is posted without a return path', async () => {
    api.callProfileApi.mockResolvedValueOnce({ data: { backup_codes: ['otter-amber'] } });
    const verified = await request(createApp()).post('/profile/two-factor/verify').type('form')
      .send({ code: '123456', return: '//evil.example' });
    expect(verified.status).toBe(200);
    expect(verified.body.locals.returnPath).toBe('');
  });
});

describe('two-factor page markup with and without a return path', () => {
  it('puts the return path in the password form as a hidden field', () => {
    const html = renderPage({ canStartSetup: true, returnPath: '/onboarding/security' });
    expect(html).toContain('<input type="hidden" name="return" value="/onboarding/security">');
    expect(html).toContain('href="/onboarding/security">Back to setting up your profile</a>');
  });

  it('puts the return path in the code form as a hidden field', () => {
    const html = renderPage({ setup: { qr_data_uri: '', secret: 'PENDING' }, returnPath: '/onboarding/security' });
    expect(html).toMatch(/action="\/profile\/two-factor\/verify"[\s\S]*name="return" value="\/onboarding\/security"/);
  });

  it('shows "Continue" back to the wizard after the recovery codes', () => {
    const html = renderPage({ enabled: true, backupCodes: ['otter-amber'], returnPath: '/onboarding/security' });
    expect(html).toContain('href="/onboarding/security" role="button" draggable="false">Continue setting up your profile</a>');
    expect(html).not.toContain('href="/profile/settings" role="button"');
  });

  it('is unchanged without a return path', () => {
    const start = renderPage({ canStartSetup: true, returnPath: '' });
    expect(start).not.toContain('name="return"');
    expect(start).toContain('class="govuk-back-link" href="/profile/settings"');

    const done = renderPage({ enabled: true, backupCodes: ['otter-amber'], returnPath: '' });
    expect(done).toContain('href="/profile/settings" role="button" draggable="false"');
    expect(done).not.toContain('Continue setting up your profile');
  });
});
