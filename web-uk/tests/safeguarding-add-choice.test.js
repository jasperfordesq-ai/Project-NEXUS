// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Adding a safeguarding choice after joining (26 Oct 2026).
 *
 * A member could see and remove their safeguarding choices on the accessible
 * site but never add one: the only way to pick a choice was the onboarding
 * step. These tests pin the HTML-first, no-JavaScript journey:
 *
 *   settings → "Add extra support" → choose one (radios) → check it → add it
 *
 * Only the choices the API offers (open to new members, not already held) are
 * listed; each shows what it does; nothing is saved until the confirm page's
 * button is pressed.
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
  switchToCoordinatorIntroductions: jest.fn()
}));

jest.mock('../src/middleware/auth', () => ({
  clearAuthCookies: jest.fn(),
  requireAuth: (req, res, next) => next()
}));

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() })
}));

const api = require('../src/lib/api');
const { createTranslator } = require('../src/lib/localization');
const profileRouter = require('../src/routes/profile');

const viewsDir = path.join(__dirname, '..', 'src', 'views');
const env = nunjucks.configure(
  [viewsDir, path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
  { autoescape: true, noCache: true }
);

function createProfileApp(locale = 'en') {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.accessibleRouting = { tenant: { id: 7, slug: 'test-community' }, tenantSlug: 'test-community' };
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    req.session = { locale };
    req.flash = () => [];
    req.t = createTranslator(locale);
    res.locals.urlFor = (pathname) => pathname;
    res.render = (view, locals = {}) => res.json({ view, locals });
    next();
  });
  app.use('/profile', profileRouter);
  return app;
}

const OPEN_OPTION = {
  option_id: 42,
  option_key: 'is_vulnerable_adult',
  label: 'I consider myself a vulnerable adult',
  description: 'Choose this if you would like extra care.',
  effects: ['Only coordinators and vetted members can message you.', '  ', 7]
};

function mockAvailable(options) {
  api.callProfileApi.mockImplementation(async (token, method, pathValue) => {
    if (method === 'GET' && pathValue === '/safeguarding/available-options') {
      return { data: { options, count: options.length } };
    }
    if (method === 'GET' && pathValue === '/safeguarding/my-preferences') return { data: { preferences: [] } };
    return { data: {} };
  });
}

/** Renders a page's main content block without the surrounding layout. */
function renderBlock(view, locals) {
  const source = fs.readFileSync(path.join(viewsDir, view), 'utf8');
  const start = source.indexOf('{% block mainContent %}') + '{% block mainContent %}'.length;
  const end = source.indexOf('{% endblock %}', start);
  return env.renderString(source.slice(start, end), {
    t: createTranslator('en'),
    urlFor: (value) => value,
    csrfToken: 'test-csrf',
    ...locals
  });
}

describe('adding a safeguarding choice on the accessible site', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getProfile.mockResolvedValue({ data: { first_name: 'Ada', preferred_language: 'en' } });
    api.callUserSettingsApi.mockResolvedValue({ data: {} });
    api.callWebAuthnApi.mockResolvedValue({ data: {} });
  });

  it('lists the choices the member can still add, with what each one does', async () => {
    mockAvailable([OPEN_OPTION]);
    const response = await request(createProfileApp()).get('/profile/safeguarding/add');

    expect(response.status).toBe(200);
    expect(response.body.view).toBe('profile/safeguarding-add');
    expect(api.callProfileApi).toHaveBeenCalledWith('test-token', 'GET', '/safeguarding/available-options');
    expect(response.body.locals.options).toEqual([{
      option_id: 42,
      label: 'I consider myself a vulnerable adult',
      description: 'Choose this if you would like extra care.',
      effects: ['Only coordinators and vetted members can message you.']
    }]);
    expect(response.body.locals.chooseError).toBe('');
  });

  it('shows an error when nothing was chosen', async () => {
    mockAvailable([OPEN_OPTION]);
    const response = await request(createProfileApp()).get('/profile/safeguarding/add?status=choose-required');
    expect(response.body.locals.chooseError).toBe('Select the support you would like to add');
  });

  it('sends the member back to choose when they press continue without a choice', async () => {
    const response = await request(createProfileApp())
      .post('/profile/safeguarding/add')
      .type('form')
      .send({ _csrf: 'test-csrf' });
    expect(response.headers.location).toBe('/profile/safeguarding/add?status=choose-required#option_id');
  });

  it('moves to the check page with the chosen option, saving nothing yet', async () => {
    const response = await request(createProfileApp())
      .post('/profile/safeguarding/add')
      .type('form')
      .send({ _csrf: 'test-csrf', option_id: '42' });
    expect(response.headers.location).toBe('/profile/safeguarding/add/confirm?option_id=42');
    expect(api.callProfileApi).not.toHaveBeenCalledWith('test-token', 'POST', expect.anything(), expect.anything());
  });

  it('shows the chosen option and what it does on the check page', async () => {
    mockAvailable([OPEN_OPTION]);
    const response = await request(createProfileApp()).get('/profile/safeguarding/add/confirm?option_id=42');
    expect(response.body.view).toBe('profile/safeguarding-add-confirm');
    expect(response.body.locals.option.label).toBe('I consider myself a vulnerable adult');
  });

  it('refuses to confirm an option the API no longer offers', async () => {
    mockAvailable([OPEN_OPTION]);
    const response = await request(createProfileApp()).get('/profile/safeguarding/add/confirm?option_id=99');
    expect(response.headers.location).toBe('/profile/safeguarding/add');
  });

  it('adds the choice and returns to settings with a success message', async () => {
    mockAvailable([OPEN_OPTION]);
    const response = await request(createProfileApp())
      .post('/profile/safeguarding/add/confirm')
      .type('form')
      .send({ _csrf: 'test-csrf', option_id: '42' });

    expect(api.callProfileApi).toHaveBeenCalledWith('test-token', 'POST', '/safeguarding/add-choice', { option_id: 42 });
    expect(response.headers.location).toBe('/profile/settings?status=safeguarding-added#safeguarding');
  });

  it('says so when the API refuses the choice', async () => {
    api.callProfileApi.mockRejectedValue(new api.ApiError('Invalid', 422, { errors: [{ code: 'VALIDATION_ERROR' }] }));
    const response = await request(createProfileApp())
      .post('/profile/safeguarding/add/confirm')
      .type('form')
      .send({ _csrf: 'test-csrf', option_id: '42' });
    expect(response.headers.location).toBe('/profile/settings?status=safeguarding-add-failed#safeguarding');
  });

  it.each([
    ['safeguarding-added', 'success', 'profile_settings.safeguarding.add.added'],
    ['safeguarding-add-failed', 'error', 'profile_settings.safeguarding.add.failed']
  ])('shows the %s message in Irish from the catalogue', async (status, type, key) => {
    mockAvailable([]);
    const response = await request(createProfileApp('ga')).get(`/profile/settings?status=${status}`);
    expect(response.body.locals.statusConfig.type).toBe(type);
    expect(response.body.locals.statusConfig.message).toBe(createTranslator('ga')(key));
    expect(createTranslator('ga')(key)).not.toBe(createTranslator('en')(key));
  });

  it('renders radios with each option\'s effects, escaped, and a CSRF token', () => {
    const html = renderBlock('profile/safeguarding-add.njk', {
      options: [{ ...OPEN_OPTION, effects: ['No contact <i>from</i> strangers.'] }],
      chooseError: ''
    });
    expect(html).toContain('method="post" action="/profile/safeguarding/add"');
    expect(html).toContain('<input type="hidden" name="_csrf" value="test-csrf">');
    expect(html).toContain('type="radio" name="option_id" value="42"');
    expect(html).toContain('What this does');
    expect(html).toContain('<li>No contact &lt;i&gt;from&lt;/i&gt; strangers.</li>');
    expect(html).not.toContain('govuk-error-summary');
  });

  it('renders the error summary linked to the radios', () => {
    const html = renderBlock('profile/safeguarding-add.njk', {
      options: [OPEN_OPTION],
      chooseError: 'Select the support you would like to add'
    });
    expect(html).toContain('govuk-error-summary');
    expect(html).toContain('href="#option_id"');
    expect(html).toContain('govuk-form-group--error');
  });

  it('says plainly when there is nothing left to add', () => {
    const html = renderBlock('profile/safeguarding-add.njk', { options: [], chooseError: '' });
    expect(html).toContain('There is no other support you can add at the moment.');
    expect(html).not.toContain('type="radio"');
  });

  it('renders the check page with a single add button', () => {
    const html = renderBlock('profile/safeguarding-add-confirm.njk', {
      option: { option_id: 42, label: 'I consider myself a vulnerable adult', description: '', effects: ['Coordinators are told.'] }
    });
    expect(html).toContain('method="post" action="/profile/safeguarding/add/confirm"');
    expect(html).toContain('<input type="hidden" name="option_id" value="42">');
    expect(html).toContain('Yes, add it');
    expect(html).toContain('<li>Coordinators are told.</li>');
  });

  it('links to the add page from the safeguarding settings section', () => {
    const source = fs.readFileSync(path.join(viewsDir, 'profile', 'settings.njk'), 'utf8');
    const start = source.indexOf('<section id="safeguarding"');
    const end = source.indexOf('</section>', start) + '</section>'.length;
    const html = env.renderString(source.slice(start, end), {
      t: createTranslator('en'),
      urlFor: (value) => value,
      csrfToken: 'test-csrf',
      vetting: { available: false },
      safeguardingPolicyReviewRequired: false,
      safeguarding: [],
      safeguardingSwitch: null
    });
    expect(html).toContain('href="/profile/safeguarding/add"');
    expect(html).toContain('Add extra support');
  });
});
