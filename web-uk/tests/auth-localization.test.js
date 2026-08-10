// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const fs = require('fs');
const nunjucks = require('nunjucks');
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
  ApiOfflineError: class ApiOfflineError extends Error {},
  callProfileApi: jest.fn(),
  callUserSettingsApi: jest.fn(),
  callWebAuthnApi: jest.fn(),
  getProfile: jest.fn(),
  refreshToken: jest.fn(),
  validateToken: jest.fn()
}));

const api = require('../src/lib/api');
const { createTranslator, SUPPORTED_LOCALES } = require('../src/lib/localization');
const profileRouter = require('../src/routes/profile');

const viewsDirectory = path.join(__dirname, '..', 'src', 'views');
const govukViewsDirectory = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const templateEnvironment = nunjucks.configure([viewsDirectory, govukViewsDirectory], {
  autoescape: true,
  noCache: true
});

function templateSource(name) {
  return fs.readFileSync(path.join(viewsDirectory, name), 'utf8');
}

function testApp(initialLocale = 'en', renderViewModel = false) {
  const state = { session: null };
  const app = express();

  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.session = { locale: initialLocale };
    state.session = req.session;
    res.locals.urlFor = (pathname) => pathname;
    if (renderViewModel) {
      res.render = (view, locals) => res.json({ view, locals });
    }
    next();
  });
  app.use('/profile', profileRouter);

  return { app, state };
}

describe('Laravel-first auth localization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['login.njk', [
      'states.error_title',
      'auth.login_title',
      'auth.login_description',
      'auth.email_label',
      'auth.password_label',
      'auth.login_action',
      'auth.forgot_link',
      'auth.need_account',
      'auth.two_factor_title',
      'auth.two_factor_description',
      'auth.two_factor_code_label',
      'auth.two_factor_code_hint',
      'auth.two_factor_submit',
      'auth.back_to_sign_in'
    ]],
    ['register.njk', [
      'states.error_title',
      'auth.register_description',
      'auth.first_name_label',
      'auth.last_name_label',
      'auth.email_label',
      'auth.password_label',
      'auth.password_hint',
      'auth.password_confirmation_label',
      'auth.honeypot_website_label',
      'auth.register_action',
      'auth.have_account'
    ]],
    ['forgot-password.njk', [
      'states.error_title',
      'auth.forgot_title',
      'auth.forgot_description',
      'auth.forgot_email_label',
      'auth.forgot_email_hint',
      'auth.forgot_submit',
      'auth.forgot_sent_title',
      'auth.forgot_sent_detail',
      'auth.forgot_resend',
      'auth.back_to_sign_in'
    ]],
    ['reset-password.njk', [
      'states.error_title',
      'auth.reset_title',
      'auth.reset_description',
      'auth.reset_password_label',
      'auth.reset_password_hint',
      'auth.reset_confirm_label',
      'auth.reset_submit',
      'auth.back_to_sign_in'
    ]]
  ])('%s delegates Laravel core copy to the request translator', (templateName, translationKeys) => {
    const source = templateSource(templateName);

    for (const translationKey of translationKeys) {
      expect(source).toContain(`t("${translationKey}"`);
    }
    expect(source).not.toContain('titleText: "There is a problem"');
    if (templateName === 'register.njk') {
      expect(source).toContain('{% block pageTitle %}{{ title }} - {{ serviceName }}{% endblock %}');
      expect(source).toContain('<h1 class="govuk-heading-xl">{{ title }}</h1>');
    }
  });

  it.each(['login.njk', 'register.njk'])('%s supplies the current community to Laravel interpolation', (templateName) => {
    expect(templateSource(templateName)).toMatch(
      /t\("auth\.(?:login|register)_description", \{ community: tenantName or (?:tenantSlug or )?serviceName \}\)/
    );
  });

  it.each([
    ['login.njk', 'auth.login_title'],
    ['register.njk', 'auth.register_title'],
    ['forgot-password.njk', 'auth.forgot_title'],
    ['reset-password.njk', 'auth.reset_title']
  ])('%s renders localized Laravel auth copy', (templateName, headingKey) => {
    const t = createTranslator('ga');
    const html = templateEnvironment.render(templateName, {
      csrfToken: 'test-csrf',
      errors: [],
      fieldErrors: {},
      resetToken: 'reset-token',
      serviceName: 'Project NEXUS',
      t,
      title: t(headingKey),
      tenantName: 'Pobal Tástála',
      urlFor: (pathname) => pathname,
      values: {}
    });

    expect(html).toContain(t(headingKey));
    expect(html).toContain(`<title>${t(headingKey)} - Project NEXUS</title>`);
    if (templateName === 'login.njk' || templateName === 'register.njk') {
      const descriptionKey = templateName === 'login.njk'
        ? 'auth.login_description'
        : 'auth.register_description';
      expect(html).toContain(t(descriptionKey, { community: 'Pobal Tástála' }));
    }
  });

  it('persists a successfully saved profile language in the current session', async () => {
    api.callUserSettingsApi.mockResolvedValueOnce({ data: { language: 'ga' } });
    const { app, state } = testApp();

    const response = await request(app)
      .post('/profile/language')
      .type('form')
      .send({ language: 'ga' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/profile/settings?status=language-changed');
    expect(api.callUserSettingsApi).toHaveBeenCalledWith('test-token', 'PUT', '/language', { language: 'ga' });
    expect(state.session.locale).toBe('ga');
  });

  it('renders exactly the authoritative Laravel locale choices', async () => {
    const { app } = testApp('en', true);

    const response = await request(app).get('/profile/settings');

    expect(response.status).toBe(200);
    expect(response.body.view).toBe('profile/settings');
    expect(response.body.locals.localeOptions).toEqual([
      { value: 'en', label: 'English', selected: true },
      { value: 'ga', label: 'Gaeilge', selected: false },
      { value: 'de', label: 'Deutsch', selected: false },
      { value: 'fr', label: 'Français', selected: false },
      { value: 'it', label: 'Italiano', selected: false },
      { value: 'pt', label: 'Português', selected: false },
      { value: 'es', label: 'Español', selected: false },
      { value: 'nl', label: 'Nederlands', selected: false },
      { value: 'pl', label: 'Polski', selected: false },
      { value: 'ja', label: '日本語', selected: false },
      { value: 'ar', label: 'العربية', selected: false }
    ]);
    expect(response.body.locals.localeOptions.map(({ value }) => value)).toEqual(SUPPORTED_LOCALES);
    expect(response.body.locals.autoTranslateLocaleOptions.map(({ value }) => value)).toEqual(SUPPORTED_LOCALES);
  });

  it.each(['cy', 'ur'])('rejects removed profile locale %s', async (language) => {
    const { app, state } = testApp('en');

    const response = await request(app)
      .post('/profile/language')
      .type('form')
      .send({ language });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/profile/settings?status=language-invalid');
    expect(api.callUserSettingsApi).not.toHaveBeenCalled();
    expect(state.session.locale).toBe('en');
  });

  it('does not change the session locale when the profile language save fails', async () => {
    api.callUserSettingsApi.mockRejectedValueOnce(new api.ApiError('Save failed', 500));
    const { app, state } = testApp('en');

    const response = await request(app)
      .post('/profile/language')
      .type('form')
      .send({ language: 'ga' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/profile/settings?status=language-failed');
    expect(state.session.locale).toBe('en');
  });
});
