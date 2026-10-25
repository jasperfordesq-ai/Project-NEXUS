// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Safeguarding choices must say what they really do (25 Oct 2026).
 *
 * "I would prefer to only interact with vetted members" blocked ALL contact
 * from anyone without community-recorded vetting, and nothing on the page said
 * so. The API now sends `effects` — plain-language, already-translated
 * sentences — with every onboarding option and every held preference, plus a
 * one-step offer to move from "vetted members only" to "coordinator
 * introductions". These tests pin that web-uk shows those sentences, ties them
 * to the control they describe, and wires the switch button to the endpoint.
 */

const express = require('express');
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
const { normalizeSafeguardingOption } = require('../src/routes/onboarding-posts');
const profileRouter = require('../src/routes/profile');

const env = nunjucks.configure(
  [path.join(__dirname, '..', 'src', 'views'), path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
  { autoescape: true, noCache: true }
);

function createProfileApp(locale = 'en') {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.accessibleRouting = { tenant: { id: 7, slug: 'test-community' }, tenantSlug: 'test-community' };
    req.signedCookies = { token: 'test-token' };
    req.secret = 'safeguarding-effects-test-cookie-secret';
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

const VETTED_ONLY = {
  option_id: 12,
  label: 'Only vetted members',
  description: 'Limit contact to vetted members.',
  requires_vetted_interaction: true,
  effects: [
    'Members your community has not vetted cannot message you.',
    '  ',
    'You will not be matched with them. <b>bold</b>'
  ]
};

describe('onboarding safeguarding step shows what each option does', () => {
  function renderStep(options) {
    const t = createTranslator('en');
    // Only the safeguarding branch of the page is rendered here: the step's
    // markup is self-contained, and the surrounding layout is covered elsewhere.
    const source = require('fs').readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'onboarding', 'index.njk'),
      'utf8'
    );
    const start = source.indexOf('{% elif step == "safeguarding" %}');
    const end = source.indexOf('{% else %}', start);
    const branch = `{% if false %}${source.slice(start, end)}{% endif %}`;
    return env.renderString(branch, {
      t,
      urlFor: (value) => value,
      csrfToken: 'test-csrf',
      step: 'safeguarding',
      stepRequired: false,
      safeguardingOptions: options.map(normalizeSafeguardingOption)
    });
  }

  it('keeps only non-empty string effects from the API', () => {
    const option = normalizeSafeguardingOption({ id: 4, label: 'x', effects: ['  One  ', '', 7, null, 'Two'] });
    expect(option.effects).toEqual(['One', 'Two']);
    expect(normalizeSafeguardingOption({ id: 4, label: 'x' }).effects).toEqual([]);
  });

  it('lists the effects under the checkbox and announces them with it', () => {
    const html = renderStep([{
      id: 9,
      option_key: 'vetted_only',
      option_type: 'checkbox',
      label: 'Only vetted members',
      description: 'Limit contact to vetted members.',
      effects: ['Members your community has not vetted cannot message you.', 'Script <script>x</script>']
    }]);

    expect(html).toContain('What this does');
    expect(html).toContain('<ul class="govuk-list govuk-list--bullet govuk-body-s govuk-!-margin-bottom-0">');
    expect(html).toContain('<li>Members your community has not vetted cannot message you.</li>');
    // Rendered verbatim but escaped: API text is never trusted as markup.
    expect(html).toContain('Script &lt;script&gt;x&lt;/script&gt;');
    expect(html).not.toContain('<script>x</script>');
    expect(html).toContain('aria-describedby="sg-9-hint sg-9-effects"');
    expect(html).toContain('id="sg-9-effects"');
  });

  it('adds nothing when an option has no effects', () => {
    const html = renderStep([{ id: 9, option_type: 'checkbox', label: 'Plain option' }]);
    expect(html).not.toContain('What this does');
    expect(html).not.toContain('aria-describedby');
  });

  it('shows effects for a select question too', () => {
    const html = renderStep([{
      id: 10,
      option_type: 'select',
      label: 'Preferred contact',
      select_options: { phone: 'Phone' },
      effects: ['A coordinator will phone you first.']
    }]);
    expect(html).toContain('<li>A coordinator will phone you first.</li>');
    expect(html).toContain('aria-describedby="sg-10-effects"');
  });

  it('uses the hand-written Irish label', () => {
    expect(createTranslator('ga')('profile_settings.safeguarding.effects_heading')).toBe('Cad a dhéanann sé seo');
  });
});

describe('profile settings safeguarding effects and switch offer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getProfile.mockResolvedValue({ data: { first_name: 'Ada', last_name: 'Lovelace', preferred_language: 'en' } });
    api.callUserSettingsApi.mockResolvedValue({ data: {} });
    api.callWebAuthnApi.mockResolvedValue({ data: {} });
  });

  function mockPreferences(data) {
    api.callProfileApi.mockImplementation(async (token, method, pathValue) => {
      if (method === 'GET' && pathValue === '/safeguarding/my-preferences') return { data };
      return { data: {} };
    });
  }

  it('passes each preference\'s effects and the switch copy to the page', async () => {
    mockPreferences({
      preferences: [VETTED_ONLY],
      can_switch_to_coordinator_introductions: true,
      switch_copy: { heading: 'Want fewer limits?', body: 'A coordinator introduces members instead.', button: 'Switch to coordinator introductions' }
    });

    const response = await request(createProfileApp()).get('/profile/settings');

    expect(response.status).toBe(200);
    const { locals } = response.body;
    expect(locals.safeguarding[0].effects).toEqual([
      'Members your community has not vetted cannot message you.',
      'You will not be matched with them. <b>bold</b>'
    ]);
    expect(locals.safeguardingSwitch).toEqual({
      heading: 'Want fewer limits?',
      body: 'A coordinator introduces members instead.',
      button: 'Switch to coordinator introductions'
    });
  });

  it.each([
    [{ preferences: [VETTED_ONLY], can_switch_to_coordinator_introductions: false, switch_copy: { heading: 'h', body: 'b', button: 'x' } }],
    [{ preferences: [VETTED_ONLY], can_switch_to_coordinator_introductions: true, switch_copy: null }],
    [{ preferences: [VETTED_ONLY], can_switch_to_coordinator_introductions: true, switch_copy: { heading: 'h', body: 'b' } }],
    [[VETTED_ONLY]]
  ])('offers no switch unless the API says so with complete copy', async (data) => {
    mockPreferences(data);
    const response = await request(createProfileApp()).get('/profile/settings');
    expect(response.status).toBe(200);
    expect(response.body.locals.safeguardingSwitch).toBeNull();
    expect(response.body.locals.safeguarding).toHaveLength(1);
  });

  it('renders the effects list and an escaped switch form', () => {
    const t = createTranslator('en');
    const source = require('fs').readFileSync(
      path.join(__dirname, '..', 'src', 'views', 'profile', 'settings.njk'),
      'utf8'
    );
    const start = source.indexOf('<section id="safeguarding"');
    const end = source.indexOf('</section>', start) + '</section>'.length;
    const html = env.renderString(source.slice(start, end), {
      t,
      urlFor: (value) => value,
      csrfToken: 'test-csrf',
      vetting: { available: false },
      safeguardingPolicyReviewRequired: false,
      safeguarding: [{ ...VETTED_ONLY, activations: ['requires_vetted_interaction'], effects: ['No contact <i>from</i> unvetted members.'] }],
      safeguardingSwitch: { heading: 'Want fewer limits?', body: 'Body <b>text</b>', button: 'Switch now' }
    });

    expect(html).toContain('What this does');
    expect(html).toContain('<li>No contact &lt;i&gt;from&lt;/i&gt; unvetted members.</li>');
    // effects replace the older generic activation labels, not repeat them
    expect(html).not.toContain('Only vetted members can interact with you');
    expect(html).toContain('Want fewer limits?');
    expect(html).toContain('Body &lt;b&gt;text&lt;/b&gt;');
    expect(html).toContain('method="post" action="/profile/safeguarding/switch-to-coordinator-introductions"');
    expect(html).toContain('<input type="hidden" name="_csrf" value="test-csrf">');
    expect(html).toContain('>Switch now</button>');
  });

  it('switches and redirects with a success flash', async () => {
    api.switchToCoordinatorIntroductions.mockResolvedValue({ data: { switched: true, message: 'Done' } });

    const response = await request(createProfileApp())
      .post('/profile/safeguarding/switch-to-coordinator-introductions')
      .type('form')
      .send({ _csrf: 'test-csrf' });

    expect(api.switchToCoordinatorIntroductions).toHaveBeenCalledWith('test-token');
    expect(response.headers.location).toBe('/profile/settings?status=safeguarding-switched#safeguarding');
  });

  it.each(['NOT_HELD', 'UNAVAILABLE'])('redirects with a failure flash on a 409 %s', async (code) => {
    api.switchToCoordinatorIntroductions.mockRejectedValue(
      new api.ApiError('Conflict', 409, { errors: [{ code, message: 'Cannot switch' }] })
    );

    const response = await request(createProfileApp())
      .post('/profile/safeguarding/switch-to-coordinator-introductions')
      .type('form')
      .send({ _csrf: 'test-csrf' });

    expect(response.headers.location).toBe('/profile/settings?status=safeguarding-switch-failed#safeguarding');
  });

  it.each([
    ['safeguarding-switched', 'success', 'profile_settings.safeguarding.switched'],
    ['safeguarding-switch-failed', 'error', 'profile_settings.safeguarding.switch_failed']
  ])('shows the %s flash in Irish from the catalogue', async (status, type, key) => {
    mockPreferences([]);
    const response = await request(createProfileApp('ga')).get(`/profile/settings?status=${status}`);

    expect(response.status).toBe(200);
    expect(response.body.locals.statusConfig.type).toBe(type);
    expect(response.body.locals.statusConfig.message).toBe(createTranslator('ga')(key));
  });

  it('uses the hand-written Irish flash messages', () => {
    const t = createTranslator('ga');
    expect(t('profile_settings.safeguarding.switched'))
      .toBe('Tá do rogha athraithe. Coinneoidh comhordaitheoir súil ar do mhalartuithe.');
    expect(t('profile_settings.safeguarding.switch_failed'))
      .toBe('Níorbh fhéidir do rogha a athrú. Bain triail eile as, le do thoil.');
  });
});
