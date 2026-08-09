// Copyright © 2024-2026 Jasper Ford
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
  getProfile: jest.fn()
}));

const api = require('../src/lib/api');
const { SUPPORTED_LOCALES } = require('../src/lib/localization');
const profileRouter = require('../src/routes/profile');

function testApp({ supportedLanguages, includeConfiguration = true } = {}) {
  const state = { session: null };
  const app = express();

  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    const tenant = { id: 7, slug: 'test-community' };
    if (includeConfiguration) tenant.supported_languages = supportedLanguages;

    req.accessibleRouting = { tenant, tenantSlug: tenant.slug };
    req.signedCookies = { token: 'test-token' };
    req.session = { locale: 'en' };
    state.session = req.session;
    res.locals.urlFor = (pathname) => pathname;
    res.render = (view, locals) => res.json({ view, locals });
    next();
  });
  app.use('/profile', profileRouter);

  return { app, state };
}

describe('tenant-scoped profile language settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getProfile.mockResolvedValue({ data: { preferred_language: 'fr' } });
    api.callUserSettingsApi.mockImplementation((token, method, path) => {
      if (method === 'GET' && path === '') {
        return Promise.resolve({
          data: {
            preferred_language: 'fr',
            auto_translate_target_locale: 'ar'
          }
        });
      }
      return Promise.resolve({ data: {} });
    });
    api.callProfileApi.mockResolvedValue({ data: {} });
    api.callWebAuthnApi.mockResolvedValue({ data: {} });
  });

  it('renders only configured tenant locales in authoritative global order', async () => {
    const { app } = testApp({
      supportedLanguages: ['ar', 'unsupported', 'fr', 'en', 'fr']
    });

    const response = await request(app).get('/profile/settings');

    expect(response.status).toBe(200);
    expect(response.body.view).toBe('profile/settings');
    expect(response.body.locals.localeOptions).toEqual([
      { value: 'en', label: 'English', selected: false },
      { value: 'fr', label: 'Français', selected: true },
      { value: 'ar', label: 'العربية', selected: false }
    ]);
    expect(response.body.locals.autoTranslateLocaleOptions).toEqual([
      { value: 'en', label: 'English', selected: false },
      { value: 'fr', label: 'Français', selected: false },
      { value: 'ar', label: 'العربية', selected: true }
    ]);
  });

  it('falls back to every globally supported locale when tenant configuration is absent', async () => {
    const { app } = testApp({ includeConfiguration: false });

    const response = await request(app).get('/profile/settings');

    expect(response.status).toBe(200);
    expect(response.body.locals.localeOptions.map(({ value }) => value)).toEqual(SUPPORTED_LOCALES);
    expect(response.body.locals.autoTranslateLocaleOptions.map(({ value }) => value)).toEqual(SUPPORTED_LOCALES);
  });

  it.each([
    ['empty', []],
    ['invalid-only', ['unsupported']]
  ])('fails closed for an explicitly %s tenant locale list', async (description, supportedLanguages) => {
    const { app } = testApp({ supportedLanguages });

    const settingsResponse = await request(app).get('/profile/settings');
    expect(settingsResponse.status).toBe(200);
    expect(settingsResponse.body.locals.localeOptions).toEqual([]);
    expect(settingsResponse.body.locals.autoTranslateLocaleOptions).toEqual([]);

    jest.clearAllMocks();
    const updateResponse = await request(app)
      .post('/profile/language')
      .type('form')
      .send({ language: 'en' });

    expect(updateResponse.status).toBe(302);
    expect(updateResponse.headers.location).toBe('/profile/settings?status=language-invalid');
    expect(api.callUserSettingsApi).not.toHaveBeenCalled();
  });

  it('rejects a globally valid language that the routed tenant does not support', async () => {
    const { app, state } = testApp({ supportedLanguages: ['en', 'fr'] });

    const response = await request(app)
      .post('/profile/language')
      .type('form')
      .send({ language: 'ga' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/profile/settings?status=language-invalid');
    expect(api.callUserSettingsApi).not.toHaveBeenCalled();
    expect(state.session.locale).toBe('en');
  });

  it('persists a configured tenant language and updates the current session', async () => {
    const { app, state } = testApp({ supportedLanguages: ['fr', 'en'] });

    const response = await request(app)
      .post('/profile/language')
      .type('form')
      .send({ language: 'fr' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/profile/settings?status=language-changed');
    expect(api.callUserSettingsApi).toHaveBeenCalledWith('test-token', 'PUT', '/language', { language: 'fr' });
    expect(state.session.locale).toBe('fr');
  });

  it('does not forward an unsupported tenant locale as an auto-translation target', async () => {
    const { app } = testApp({ supportedLanguages: ['en', 'fr'] });

    const response = await request(app)
      .post('/profile/personalisation')
      .type('form')
      .send({ auto_translate_ugc: 'on', auto_translate_target_locale: 'ga' });

    expect(response.status).toBe(302);
    expect(api.callUserSettingsApi).toHaveBeenCalledWith('test-token', 'PUT', '/preferences', {
      feed: { prefers_chronological: false },
      translation: {
        auto_translate_ugc: true,
        auto_translate_target_locale: null
      }
    });
  });
});
