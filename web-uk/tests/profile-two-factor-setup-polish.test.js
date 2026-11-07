// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Turning on two-factor from the accessible site (the welcome wizard sends new
 * members here). Found by walking it in a browser on 7 November 2026:
 *
 * - A wrong code or password only raised the error summary, which linked to the
 *   whole form. GOV.UK Design System: the summary links to the field, and the
 *   field shows the same message with error styling.
 * - A phone cannot scan its own screen, and a screen reader cannot read a QR
 *   code, so the member types the key. It is now shown in groups of four, with
 *   a link that adds it to an authenticator app on the same device (the
 *   otpauth:// link the server sends as `provisioning_uri`).
 * - When the five-minute confirmation ran out, the member was told their
 *   password could not be confirmed. Now they are told why they must enter it
 *   again.
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

const SECRET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const OTPAUTH = `otpauth://totp/Project%20NEXUS:member%40example.com?secret=${SECRET}&issuer=Project%20NEXUS`;
const STATUS_OFF = { data: { enabled: false, setup_required: false, backup_codes_remaining: 0 } };

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

/** Start set-up with a password, as the form does; the API answers with `setupData`. */
async function startSetup(app, setupData) {
  api.callWebAuthnApi.mockResolvedValueOnce({ data: { security_confirmation_token: 'conf-tok' } });
  api.callProfileApi.mockResolvedValueOnce({ data: setupData });
  return request(app).post('/profile/two-factor/setup').type('form').send({ current_password: 'CurrentPassword!123' });
}

describe('two-factor set-up on the accessible site', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.callProfileApi.mockReset();
    api.callWebAuthnApi.mockReset();
  });

  it('keeps the server\'s otpauth:// link with the pending set-up, so it is still there after a wrong code', async () => {
    const app = createApp();
    await startSetup(app, { qr_code_url: 'data:image/svg+xml;base64,PHN2Zy8+', secret: SECRET, provisioning_uri: OTPAUTH });

    api.callProfileApi.mockResolvedValueOnce(STATUS_OFF);
    const page = await request(app).get('/profile/two-factor?status=2fa-code-invalid');

    expect(page.body.locals.setup.otpauth_uri).toBe(OTPAUTH);
    expect(page.body.locals.setup.secret).toBe(SECRET);
  });

  it('drops a provisioning link that is not an otpauth:// link', async () => {
    const app = createApp();
    await startSetup(app, { qr_code_url: 'data:image/svg+xml;base64,PHN2Zy8+', secret: SECRET, provisioning_uri: 'javascript:alert(1)' });

    api.callProfileApi.mockResolvedValueOnce(STATUS_OFF);
    const page = await request(app).get('/profile/two-factor');

    expect(page.body.locals.setup.otpauth_uri).toBe('');
  });

  it('points a wrong code at the code box', async () => {
    const app = createApp();
    await startSetup(app, { qr_code_url: 'data:image/svg+xml;base64,PHN2Zy8+', secret: SECRET });

    api.callProfileApi.mockResolvedValueOnce(STATUS_OFF);
    const page = await request(app).get('/profile/two-factor?status=2fa-code-invalid');

    expect(page.body.locals.errorAnchor).toBe('code');
    expect(page.body.locals.fieldError).toEqual({ id: 'code', message: expect.stringContaining('That code was not correct') });
  });

  it('points a missing or refused password at the password box', async () => {
    for (const status of ['2fa-setup-password-required', '2fa-setup-confirm-failed']) {
      api.callProfileApi.mockResolvedValueOnce(STATUS_OFF);
      const page = await request(createApp()).get(`/profile/two-factor?status=${status}`);
      expect(page.body.locals.errorAnchor).toBe('setup-password');
      expect(page.body.locals.fieldError.id).toBe('setup-password');
    }
  });

  it('says the five minutes ran out, rather than that the password was wrong', async () => {
    const app = createApp();
    await startSetup(app, { qr_code_url: 'data:image/svg+xml;base64,PHN2Zy8+', secret: SECRET });
    api.callProfileApi.mockRejectedValueOnce(new api.ApiError('Security confirmation required', 403, {
      errors: [{ code: 'SECURITY_CONFIRMATION_REQUIRED' }]
    }));

    const verified = await request(app).post('/profile/two-factor/verify').type('form').send({ code: '123456' });
    expect(verified.status).toBe(302);
    expect(verified.headers.location).toBe('/profile/two-factor?status=2fa-setup-expired');

    api.callProfileApi.mockResolvedValueOnce(STATUS_OFF);
    const page = await request(app).get('/profile/two-factor?status=2fa-setup-expired');
    expect(page.body.locals.canStartSetup).toBe(true);
    expect(page.body.locals.fieldError).toEqual({
      id: 'setup-password',
      message: 'That took longer than five minutes, so enter your password again.'
    });
  });
});

describe('two-factor set-up page markup', () => {
  it('shows the key in groups of four and a link to add it on this device', () => {
    const html = renderPage({ setup: { qr_data_uri: '', secret: SECRET, otpauth_uri: OTPAUTH } });

    expect(html).toContain('ABCD EFGH IJKL MNOP QRST UVWX YZ23 4567');
    expect(html).toContain(`href="${OTPAUTH.replace(/&/g, '&amp;')}"`);
    expect(html).toContain('Add the key to the authenticator app on this device');
  });

  it('offers no device link when there is none', () => {
    const html = renderPage({ setup: { qr_data_uri: '', secret: SECRET, otpauth_uri: '' } });
    expect(html).not.toContain('otpauth://');
    expect(html).not.toContain('Add the key to the authenticator app on this device');
  });

  it('shows a wrong code beside the code box, the GOV.UK way', () => {
    const html = renderPage({
      setup: { qr_data_uri: '', secret: SECRET, otpauth_uri: '' },
      status: '2fa-code-invalid',
      statusConfig: { type: 'error', message: 'That code was not correct or has expired. Try the current code from your app.' },
      errorStatus: true,
      errorAnchor: 'code',
      fieldError: { id: 'code', message: 'That code was not correct or has expired. Try the current code from your app.' }
    });

    expect(html).toContain('<a href="#code">That code was not correct');
    expect(html).toMatch(/govuk-form-group govuk-form-group--error"[^>]*>\s*<label class="govuk-label govuk-label--m" for="code">/);
    expect(html).toMatch(/<p id="code-error" class="govuk-error-message"><span class="govuk-visually-hidden">Error:<\/span> That code was not correct/);
    expect(html).toMatch(/class="govuk-input govuk-input--width-10 govuk-input--error" id="code"/);
    expect(html).toContain('aria-describedby="code-hint code-error"');
  });

  it('shows a refused password beside the password box', () => {
    const html = renderPage({
      canStartSetup: true,
      status: '2fa-setup-confirm-failed',
      statusConfig: { type: 'error', message: 'We could not confirm your password. Check it and try again.' },
      errorStatus: true,
      errorAnchor: 'setup-password',
      fieldError: { id: 'setup-password', message: 'We could not confirm your password. Check it and try again.' }
    });

    expect(html).toContain('<a href="#setup-password">We could not confirm your password');
    expect(html).toMatch(/<p id="setup-password-error" class="govuk-error-message"><span class="govuk-visually-hidden">Error:<\/span> We could not confirm/);
    expect(html).toMatch(/class="govuk-input govuk-input--width-20 govuk-input--error" id="setup-password"/);
    expect(html).toContain('aria-describedby="setup-password-error"');
  });

  it('says once that it is on: the confirmation panel, without a second success banner', () => {
    // Both showed after turning it on: "Success — Two-step verification is now turned
    // on." above the heading and the panel "Two-step verification is on" below it.
    const html = renderPage({
      enabled: true,
      backupCodes: ['otter-amber'],
      status: '2fa-enabled',
      statusConfig: { type: 'success', message: 'Two-step verification is now turned on.' },
      successStatus: true
    });

    expect(html).toContain('govuk-panel--confirmation');
    expect(html).not.toContain('govuk-notification-banner--success');
  });

  it('keeps the success banner where there is no panel (turning it off)', () => {
    const html = renderPage({
      canStartSetup: true,
      status: '2fa-disabled',
      statusConfig: { type: 'success', message: 'Two-step verification has been turned off.' },
      successStatus: true
    });

    expect(html).toContain('govuk-notification-banner--success');
    expect(html).toContain('Two-step verification has been turned off.');
  });

  it('leaves the boxes plain when there is no error', () => {
    const setupHtml = renderPage({ setup: { qr_data_uri: '', secret: SECRET, otpauth_uri: '' } });
    expect(setupHtml).not.toContain('govuk-form-group--error');
    expect(setupHtml).toContain('aria-describedby="code-hint"');

    const startHtml = renderPage({ canStartSetup: true });
    expect(startHtml).not.toContain('govuk-input--error');
  });
});
