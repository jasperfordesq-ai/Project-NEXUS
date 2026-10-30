// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AWID accessibility report item 6 (30 Oct 2026): "There is no option to add alt
 * text to profile photos." A member with a photo can describe it on the profile
 * settings page; their profile page reads the description out instead of
 * "Photo of <name>". The harness is the one in profile-dob-and-skill-details.test.js.
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

describe('profile photo description', () => {
  function submit(fields) {
    return request(createApp())
      .post('/profile/settings')
      .type('form')
      .send({ first_name: 'Ada', last_name: 'Lovelace', ...fields });
  }

  function profilePut() {
    return api.callUserSettingsApi.mock.calls.find(([, method, pathValue]) => method === 'PUT' && pathValue === '');
  }

  it('offers the description field, filled in, only when the member has a photo', async () => {
    stubSettingsLoad();
    api.getProfile.mockResolvedValue({ data: { id: 5, first_name: 'Ada', last_name: 'Lovelace', avatar_url: '/uploads/a.jpg', avatar_alt: 'Ada in her garden' } });
    const withPhoto = renderSettings((await request(createApp()).get('/profile/settings')).body.locals);
    expect(withPhoto).toContain('name="avatar_alt"');
    expect(withPhoto).toContain('value="Ada in her garden"');
    expect(withPhoto).toContain(t('profile_settings.photo_alt_label'));

    api.getProfile.mockResolvedValue({ data: { id: 5, first_name: 'Ada', last_name: 'Lovelace' } });
    const withoutPhoto = renderSettings((await request(createApp()).get('/profile/settings')).body.locals);
    expect(withoutPhoto).not.toContain('name="avatar_alt"');
  });

  it('saves the description with the profile', async () => {
    stubSettingsLoad();
    await submit({ avatar_alt: '  Ada in her garden  ' });
    expect(profilePut()[3]).toEqual(expect.objectContaining({ avatar_alt: 'Ada in her garden' }));
  });

  it('does not send a description when the photo is being removed', async () => {
    stubSettingsLoad();
    await submit({ avatar_alt: 'Ada in her garden', remove_avatar: '1' });
    expect(profilePut()[3]).toEqual(expect.objectContaining({ avatar_url: null }));
    expect(profilePut()[3]).not.toHaveProperty('avatar_alt');
  });

  it("reads the description out on the member's profile page, falling back to their name", () => {
    const source = fs.readFileSync(path.join(viewsDir, 'profile/index.njk'), 'utf8');
    const start = source.indexOf('{% if avatarUrl %}');
    const end = source.indexOf('{% endif %}', start) + '{% endif %}'.length;
    const render = (avatarAlt) => env.renderString(source.slice(start, end), {
      t, avatarUrl: '/uploads/a.jpg', avatarAlt, displayName: 'Ada Lovelace', initials: 'AL'
    });

    expect(render('Ada in her garden')).toContain('alt="Ada in her garden"');
    expect(render('')).toContain(`alt="${t('members.avatar_alt', { name: 'Ada Lovelace' })}"`);
  });
});
