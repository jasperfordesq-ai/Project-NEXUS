// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Profile settings parity with React (27 Oct 2026).
 *
 * 1. Date of birth. React's settings let a member whose identity is NOT verified set,
 *    change or clear their date of birth (SettingsPage.tsx: `payload.date_of_birth =
 *    profileData.date_of_birth || null` only when `!isIdVerified`). The accessible
 *    profile form had no date of birth at all. The API's own rules apply: a verified
 *    member's date of birth is locked (UserService::updateProfile drops it), an empty
 *    value is stored as NULL, and a date that makes the member under 18 is refused with
 *    DATE_OF_BIRTH_UNDER_MINIMUM_AGE. This platform is adults only.
 *
 * 2. Adding a skill. React sends category_id and proficiency_level with the skill
 *    (SkillSelector.tsx); the accessible form sent only the name and offering/requesting.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');
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
  invalidateUserCache: jest.fn(),
  requestAccountDeletion: jest.fn(),
  switchToCoordinatorIntroductions: jest.fn(),
  uploadProfileAvatar: jest.fn()
}));

jest.mock('../src/middleware/auth', () => ({
  clearAuthCookies: jest.fn(),
  requireAuth: (req, res, next) => next()
}));

const api = require('../src/lib/api');
const { createTranslator, createChoiceTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');
const profileRouter = require('../src/routes/profile');

const t = createTranslator('en');
const viewsDir = path.join(__dirname, '..', 'src', 'views');
const env = nunjucks.configure(
  [viewsDir, path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
  { autoescape: true, noCache: true }
);
registerTemplateFilters(env);

function createApp(session = {}) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.accessibleRouting = { tenant: { id: 7, slug: 'test-community' }, tenantSlug: 'test-community' };
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    req.session = session;
    req.flash = () => [];
    req.t = t;
    res.locals.t = t;
    res.locals.tc = createChoiceTranslator('en');
    res.locals.urlFor = (pathname) => pathname;
    res.render = (view, locals = {}) => res.json({ view, locals });
    next();
  });
  app.use('/profile', profileRouter);
  return app;
}

/** Renders the settings page's main block (with the file's own imports) for markup checks. */
function renderSettings(locals) {
  const source = fs.readFileSync(path.join(viewsDir, 'profile/settings.njk'), 'utf8');
  const imports = source.split('\n').filter((line) => line.startsWith('{% from')).join('\n');
  const start = source.indexOf('{% block mainContent %}') + '{% block mainContent %}'.length;
  const end = source.indexOf('{% endblock %}', start);
  return env.renderString(`${imports}\n${source.slice(start, end)}`, {
    t,
    tc: createChoiceTranslator('en'),
    urlFor: (value) => value,
    csrfToken: 'test-csrf',
    ...locals
  });
}

function stubSettingsLoad({ identity = { has_id_verified_badge: false }, identityFails = false, categories = [] } = {}) {
  api.callProfileApi.mockImplementation(async (token, method, pathValue) => {
    if (method === 'GET' && pathValue === '/identity/status') {
      if (identityFails) throw new api.ApiError('Feature disabled', 403);
      return { data: identity };
    }
    if (method === 'GET' && pathValue.startsWith('/skills/categories')) return { data: categories };
    return { data: {} };
  });
  api.callUserSettingsApi.mockResolvedValue({ data: {} });
  api.callWebAuthnApi.mockResolvedValue({ data: [] });
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getProfile.mockResolvedValue({ data: { id: 5, first_name: 'Ada', last_name: 'Lovelace', date_of_birth: '1980-03-07' } });
});

describe('date of birth on the profile settings page', () => {
  it('shows the stored date of birth in the GOV.UK three-field date input when identity is not verified', async () => {
    stubSettingsLoad();
    const response = await request(createApp()).get('/profile/settings');

    expect(response.status).toBe(200);
    expect(api.callProfileApi).toHaveBeenCalledWith('test-token', 'GET', '/identity/status');
    expect(response.body.locals.dob).toEqual(expect.objectContaining({
      locked: false,
      parts: { day: '7', month: '3', year: '1980' }
    }));

    const html = renderSettings(response.body.locals);
    expect(html).toContain('name="date_of_birth-day"');
    expect(html).toContain('value="1980"');
    expect(html).toContain(t('profile_settings.dob_label'));
    expect(html).toContain(t('profile_settings.dob_hint'));
  });

  it('locks the date of birth when the identity is verified, as React does, and offers no input', async () => {
    stubSettingsLoad({ identity: { has_id_verified_badge: true } });
    const response = await request(createApp()).get('/profile/settings');

    expect(response.body.locals.dob.locked).toBe(true);
    const html = renderSettings(response.body.locals);
    expect(html).not.toContain('name="date_of_birth-day"');
    expect(html).toContain(t('profile_settings.dob_locked'));
  });

  it('still offers the field when the identity status cannot be read (the API enforces the lock anyway)', async () => {
    stubSettingsLoad({ identityFails: true });
    const response = await request(createApp()).get('/profile/settings');
    expect(response.status).toBe(200);
    expect(response.body.locals.dob.locked).toBe(false);
  });

  function submit(fields) {
    return request(createApp())
      .post('/profile/settings')
      .type('form')
      .send({ first_name: 'Ada', last_name: 'Lovelace', ...fields });
  }

  function profilePut() {
    return api.callUserSettingsApi.mock.calls.find(([, method, pathValue]) => method === 'PUT' && pathValue === '');
  }

  it('sends the date of birth with the profile save, in the API format', async () => {
    stubSettingsLoad();
    const response = await submit({ 'date_of_birth-day': '7', 'date_of_birth-month': '3', 'date_of_birth-year': '1980' });

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/profile?status=profile-updated');
    expect(profilePut()[3]).toEqual(expect.objectContaining({ date_of_birth: '1980-03-07' }));
  });

  it('clears the date of birth (null) when all three boxes are emptied, as React does', async () => {
    stubSettingsLoad();
    await submit({ 'date_of_birth-day': '', 'date_of_birth-month': '', 'date_of_birth-year': '' });
    expect(profilePut()[3]).toEqual(expect.objectContaining({ date_of_birth: null }));
  });

  it('does not send a date of birth at all when the form did not offer one (verified member)', async () => {
    stubSettingsLoad();
    await submit({});
    expect(profilePut()[3]).not.toHaveProperty('date_of_birth');
  });

  it('refuses a half-entered date before calling the API and keeps what was typed', async () => {
    stubSettingsLoad();
    const session = {};
    const response = await request(createApp(session))
      .post('/profile/settings')
      .type('form')
      .send({ first_name: 'Ada', last_name: 'Lovelace', 'date_of_birth-day': '7', 'date_of_birth-month': '', 'date_of_birth-year': '1980' });

    expect(response.headers.location).toBe('/profile/settings?status=dob-month-required');
    expect(profilePut()).toBeUndefined();
    expect(session.profileSettingsForm.date_of_birth).toEqual({ day: '7', month: '', year: '1980' });
  });

  it('shows the API refusal of an under-18 date of birth on the field', async () => {
    stubSettingsLoad();
    api.callUserSettingsApi.mockImplementation(async (token, method, pathValue) => {
      if (method === 'PUT' && pathValue === '') {
        throw new api.ApiError('Validation failed', 422, {
          errors: [{ code: 'DATE_OF_BIRTH_UNDER_MINIMUM_AGE', message: 'Under 18', field: 'date_of_birth' }]
        });
      }
      return { data: {} };
    });
    const response = await submit({ 'date_of_birth-day': '1', 'date_of_birth-month': '1', 'date_of_birth-year': '2015' });
    expect(response.headers.location).toBe('/profile/settings?status=dob-under-minimum-age');

    stubSettingsLoad();
    const page = await request(createApp({ profileSettingsForm: { first_name: 'Ada', last_name: 'Lovelace', date_of_birth: { day: '1', month: '1', year: '2015' } } }))
      .get('/profile/settings?status=dob-under-minimum-age');
    expect(page.body.locals.dob.error).toBe(t('govuk_alpha_settings.identity.dob_under_minimum_age'));
    expect(page.body.locals.dob.parts).toEqual({ day: '1', month: '1', year: '2015' });
    const html = renderSettings(page.body.locals);
    expect(html).toContain('href="#date_of_birth-day"');
    expect(html).toContain('govuk-input--error');
  });

  it('maps an API "invalid date" refusal (for example a future date) to the date field', async () => {
    stubSettingsLoad();
    api.callUserSettingsApi.mockImplementation(async (token, method, pathValue) => {
      if (method === 'PUT' && pathValue === '') {
        throw new api.ApiError('Validation failed', 422, {
          errors: [{ code: 'VALIDATION_INVALID_FORMAT', message: 'Invalid', field: 'date_of_birth' }]
        });
      }
      return { data: {} };
    });
    const response = await submit({ 'date_of_birth-day': '1', 'date_of_birth-month': '1', 'date_of_birth-year': '2099' });
    expect(response.headers.location).toBe('/profile/settings?status=dob-invalid');
  });
});

describe('adding a skill with a category and proficiency level', () => {
  it('offers the skill categories the API lists and the four proficiency levels', async () => {
    stubSettingsLoad({ categories: [{ id: 3, name: 'Gardening', children: [{ id: 9, name: 'Lawns' }] }, { id: 4, name: 'Teaching' }] });
    const response = await request(createApp()).get('/profile/settings');

    expect(api.callProfileApi).toHaveBeenCalledWith('test-token', 'GET', '/skills/categories');
    expect(response.body.locals.skillCategories).toEqual([{ id: 3, name: 'Gardening' }, { id: 4, name: 'Teaching' }]);

    const html = renderSettings(response.body.locals);
    expect(html).toContain('name="category_id"');
    expect(html).toContain('<option value="3">Gardening</option>');
    expect(html).toContain('name="proficiency_level"');
    for (const level of ['beginner', 'intermediate', 'advanced', 'expert']) {
      expect(html).toContain(`value="${level}"`);
      expect(html).toContain(t(`profile_settings.skills.proficiency_${level}`));
    }
  });

  it('hides the category choice when the API lists none', async () => {
    stubSettingsLoad({ categories: [] });
    const response = await request(createApp()).get('/profile/settings');
    const html = renderSettings(response.body.locals);
    expect(html).not.toContain('name="category_id"');
    expect(html).toContain('name="proficiency_level"');
  });

  it('sends the chosen category and proficiency with the new skill', async () => {
    api.callUserSettingsApi.mockResolvedValue({ data: {} });
    const response = await request(createApp())
      .post('/profile/skills/add')
      .type('form')
      .send({ skill_name: 'Pruning', category_id: '3', proficiency_level: 'advanced', is_offering: '1' });

    expect(response.headers.location).toBe('/profile/settings?status=skill-added#skills');
    expect(api.callUserSettingsApi).toHaveBeenCalledWith('test-token', 'POST', '/skills', {
      skill_name: 'Pruning',
      category_id: 3,
      proficiency_level: 'advanced',
      is_offering: true,
      is_requesting: false
    });
  });

  it('leaves the level and category to the API default for missing or forged values', async () => {
    api.callUserSettingsApi.mockResolvedValue({ data: {} });
    await request(createApp())
      .post('/profile/skills/add')
      .type('form')
      .send({ skill_name: 'Pruning', category_id: 'abc', proficiency_level: 'grandmaster' });

    expect(api.callUserSettingsApi).toHaveBeenCalledWith('test-token', 'POST', '/skills', {
      skill_name: 'Pruning',
      is_offering: true,
      is_requesting: false
    });
  });

  it('shows each skill\'s level in the list', async () => {
    stubSettingsLoad();
    api.callUserSettingsApi.mockImplementation(async (token, method, pathValue) => {
      if (method === 'GET' && pathValue === '/skills') {
        return { data: [{ id: 1, skill_name: 'Pruning', proficiency_level: 'expert', is_offering: 1 }] };
      }
      return { data: {} };
    });
    const response = await request(createApp()).get('/profile/settings');
    expect(response.body.locals.mySkills[0].proficiency_level).toBe('expert');
    const html = renderSettings(response.body.locals);
    expect(html).toContain(t('profile_settings.skills.proficiency_expert'));
  });
});
