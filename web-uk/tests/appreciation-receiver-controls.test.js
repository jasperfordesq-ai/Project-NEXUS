// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Thank-you notes: the RECEIVER decides who sees them (owner, 12 Nov 2026).
 *
 * - Every new note is private. The sender is not asked, and `is_public` is never sent.
 * - On their own page a member sees every note they have received (private ones
 *   included, read from GET /v2/me/appreciations), each with a tag saying who can see
 *   it, and can show it on their profile, hide it again, or remove it.
 * - Anyone else sees only the notes the receiver has shown, and no controls.
 * - A community can switch thank-you notes off: the tenant bootstrap
 *   (`features.appreciations`, missing = on) and Laravel's 403 FEATURE_DISABLED both
 *   end in the "not available in this community" page, never a crash.
 */

const path = require('path');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const nunjucks = require('nunjucks');
const request = require('supertest');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }
  return {
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    getProfile: jest.fn(),
    getUserV2: jest.fn(),
    getBookmarks: jest.fn(),
    getUserPublicCollections: jest.fn(),
    getUserAppreciations: jest.fn(),
    getMyAppreciations: jest.fn(),
    toggleBookmark: jest.fn(),
    sendAppreciation: jest.fn(),
    setAppreciationVisibility: jest.fn(),
    deleteAppreciation: jest.fn(),
    reactToAppreciation: jest.fn()
  };
});

const api = require('../src/lib/api');
const savedSocialRoutes = require('../src/routes/saved-social');
const { tenantFeatureGate } = require('../src/middleware/tenant-feature-gates');

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const t = createTranslator('en');

const ME = 77;
const SOMEONE_ELSE = 101;

const PRIVATE_NOTE = {
  id: 55,
  sender_id: 101,
  receiver_id: ME,
  message: 'Thank you for the lift to the clinic.',
  is_public: false,
  reactions_count: 0,
  created_at: '2026-11-10T10:30:00Z',
  sender: { id: 101, name: 'Avery', avatar_url: null },
  receiver: { id: ME, name: 'Morgan', avatar_url: null },
  my_reaction: null
};
const SHOWN_NOTE = {
  ...PRIVATE_NOTE,
  id: 56,
  sender_id: 102,
  message: 'Thanks for running the tool library.',
  is_public: true,
  reactions_count: 2,
  sender: { id: 102, name: 'Bo', avatar_url: null }
};

function featureDisabled() {
  return new api.ApiError('Thank-you notes are switched off', 403, {
    errors: [{ code: 'FEATURE_DISABLED', message: 'Thank-you notes are switched off' }]
  });
}

// `tenant` is the routed community's bootstrap. No `features` key at all is the
// normal case and must mean "on".
function createApp({ tenant = { id: 2, slug: 'acme', name: 'Acme Timebank' } } = {}) {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  env.addFilter('formatDate', (value) => String(value || ''));
  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  // A 401 clears the signed auth cookies, which needs a cookie secret.
  app.use(cookieParser('appreciation-controls-test-secret'));
  app.use(session({
    secret: 'appreciation-controls-test-secret',
    resave: false,
    saveUninitialized: false,
    name: 'appreciation-controls-test.sid'
  }));
  app.use((req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    req.accessibleRouting = { mode: 'domain', tenantSlug: 'acme', tenant, prefix: '' };
    Object.assign(res.locals, {
      urlFor: (value) => value,
      serviceName: 'Project NEXUS',
      tenantName: 'Acme Timebank',
      isAuthenticated: true,
      csrfToken: 'test-csrf-token',
      alphaNavItems: [],
      feedbackUrl: '/feedback',
      currentPath: req.path,
      alphaLocaleOptions: [],
      alphaLanguageQueryParams: [],
      htmlLang: 'en',
      htmlDirection: 'ltr',
      t,
      tc: createChoiceTranslator('en'),
      formatLocaleNumber: (value) => String(value ?? ''),
      formatLocaleDate: (value) => String(value ?? '')
    });
    next();
  });
  app.use(tenantFeatureGate);
  app.use('/', savedSocialRoutes);
  return app;
}

function post(app, url, body = {}) {
  return request(app).post(url).type('form').send({ _csrf: 'test-csrf-token', ...body });
}

// One note's <li>, so an assertion about note 55 cannot be satisfied by note 56.
function noteHtml(html, id) {
  const start = html.indexOf(`id="appreciation-${id}"`);
  if (start === -1) return null;
  const end = html.indexOf('</li>', start);
  return html.slice(start, end);
}

beforeEach(() => {
  jest.resetAllMocks();
  api.getProfile.mockResolvedValue({ data: { id: ME, name: 'Morgan' } });
  api.getUserV2.mockResolvedValue({ data: { id: ME, name: 'Morgan' } });
  api.getMyAppreciations.mockResolvedValue({
    data: [PRIVATE_NOTE, SHOWN_NOTE],
    meta: { current_page: 1, last_page: 1, per_page: 20, total: 2 }
  });
  api.getUserAppreciations.mockResolvedValue({
    data: [SHOWN_NOTE],
    meta: { current_page: 1, last_page: 1, per_page: 20, total: 1 }
  });
  api.sendAppreciation.mockResolvedValue({ data: { id: 60 } });
  api.setAppreciationVisibility.mockResolvedValue({ data: { ...PRIVATE_NOTE, is_public: true } });
  api.deleteAppreciation.mockResolvedValue('');
  api.reactToAppreciation.mockResolvedValue({ data: { reaction_type: 'heart' } });
});

describe('a member looking at their own thank-you notes', () => {
  it('reads their own list, so the notes only they can see are there', async () => {
    const res = await request(createApp()).get(`/users/${ME}/appreciations`);

    expect(res.status).toBe(200);
    expect(api.getMyAppreciations).toHaveBeenCalledWith('test-token', { tab: 'received', page: 1, per_page: 20 });
    expect(api.getUserAppreciations).not.toHaveBeenCalled();
    expect(res.text).toContain('Thank you for the lift to the clinic.');
    expect(res.text).toContain('Thanks for running the tool library.');
    expect(res.text).toContain(t('govuk_alpha_saved.wall.own_description'));
    // Nobody sends themselves a thank-you.
    expect(res.text).not.toContain('id="appreciation-message"');
  });

  it('tags a private note and offers to show it or remove it, but not to react to it', async () => {
    const res = await request(createApp()).get(`/users/${ME}/appreciations`);
    const note = noteHtml(res.text, 55);

    expect(note).toContain('govuk-tag');
    expect(note).toContain(t('govuk_alpha_saved.wall.visibility_private'));
    expect(note).not.toContain(t('govuk_alpha_saved.wall.visibility_public'));
    expect(note).toContain('method="post" action="/appreciations/55/visibility"');
    expect(note).toContain('name="is_public" value="1"');
    expect(note).toContain(`name="owner_id" value="${ME}"`);
    expect(note).toContain('name="_csrf" value="test-csrf-token"');
    expect(note).toContain(t('govuk_alpha_saved.manage.show'));
    expect(note).not.toContain(t('govuk_alpha_saved.manage.hide'));
    expect(note).toContain('href="/appreciations/55/remove"');
    expect(note).toContain(t('govuk_alpha_saved.manage.for_note', { name: 'Avery' }));
    // Laravel answers 404 to a reaction on a private note, so none is offered.
    expect(note).not.toContain('/appreciations/55/react');
  });

  it('tags a shown note and offers to hide it again, with reactions', async () => {
    const res = await request(createApp()).get(`/users/${ME}/appreciations`);
    const note = noteHtml(res.text, 56);

    expect(note).toContain(t('govuk_alpha_saved.wall.visibility_public'));
    expect(note).not.toContain(t('govuk_alpha_saved.wall.visibility_private'));
    expect(note).toContain('method="post" action="/appreciations/56/visibility"');
    expect(note).toContain('name="is_public" value="0"');
    expect(note).toContain(t('govuk_alpha_saved.manage.hide'));
    expect(note).toContain('href="/appreciations/56/remove"');
    expect(note).toContain('method="post" action="/appreciations/56/react"');
  });

  it('treats a note with no visibility flag as private', async () => {
    const { is_public: _dropped, ...unflagged } = PRIVATE_NOTE;
    api.getMyAppreciations.mockResolvedValue({ data: [unflagged], meta: { current_page: 1, last_page: 1 } });

    const res = await request(createApp()).get(`/users/${ME}/appreciations`);
    const note = noteHtml(res.text, 55);

    expect(note).toContain(t('govuk_alpha_saved.wall.visibility_private'));
    expect(note).toContain('name="is_public" value="1"');
  });

  it('keeps the page number on the controls of a later page', async () => {
    api.getMyAppreciations.mockResolvedValue({
      data: [PRIVATE_NOTE],
      meta: { current_page: 2, last_page: 2, per_page: 20, total: 21 }
    });

    const res = await request(createApp()).get(`/users/${ME}/appreciations?page=2`);
    const note = noteHtml(res.text, 55);

    expect(api.getMyAppreciations).toHaveBeenCalledWith('test-token', { tab: 'received', page: 2, per_page: 20 });
    expect(note).toContain('name="page" value="2"');
    expect(note).toContain('href="/appreciations/55/remove?page=2"');
  });

  it('goes to the real last page when the requested one is past the end', async () => {
    api.getMyAppreciations.mockResolvedValue({
      data: [],
      meta: { current_page: 3, last_page: 2, per_page: 20, total: 40 }
    });

    const res = await request(createApp()).get(`/users/${ME}/appreciations?status=appreciation-removed&page=3`);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/users/${ME}/appreciations?status=appreciation-removed&page=2`);
  });

  it.each([
    ['appreciation-shown', 'govuk_alpha_saved.status.appreciation_shown', 'govuk-notification-banner--success'],
    ['appreciation-hidden', 'govuk_alpha_saved.status.appreciation_hidden', 'govuk-notification-banner--success'],
    ['appreciation-removed', 'govuk_alpha_saved.status.appreciation_removed', 'govuk-notification-banner--success'],
    ['appreciation-visibility-failed', 'govuk_alpha_saved.status.appreciation_visibility_failed', 'govuk-error-summary'],
    ['appreciation-remove-failed', 'govuk_alpha_saved.status.appreciation_remove_failed', 'govuk-error-summary']
  ])('says what happened for status %s', async (status, key, banner) => {
    const res = await request(createApp()).get(`/users/${ME}/appreciations?status=${status}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain(banner);
    expect(res.text).toContain(t(key));
    // A success banner used to be headed "There is a problem".
    const problem = t('govuk_alpha_saved.errors.summary_title');
    if (banner === 'govuk-error-summary') {
      expect(res.text).toContain(problem);
    } else {
      expect(res.text).not.toContain(problem);
      expect(res.text).toContain(`id="saved-wall-status-title">${t('states.success_title')}<`);
    }
  });
});

describe('a member looking at someone else\'s thank-you notes', () => {
  beforeEach(() => {
    api.getProfile.mockResolvedValue({ data: { id: SOMEONE_ELSE, name: 'Avery' } });
  });

  it('sees only the notes that person has shown, and none of their controls', async () => {
    const res = await request(createApp()).get(`/users/${ME}/appreciations`);

    expect(res.status).toBe(200);
    expect(api.getUserAppreciations).toHaveBeenCalledWith('test-token', ME, { page: 1, per_page: 20 });
    expect(api.getMyAppreciations).not.toHaveBeenCalled();
    expect(res.text).toContain('Thanks for running the tool library.');
    expect(res.text).not.toContain('/visibility');
    expect(res.text).not.toContain('/remove');
    expect(res.text).not.toContain(t('govuk_alpha_saved.wall.visibility_public'));
    expect(res.text).not.toContain(t('govuk_alpha_saved.wall.visibility_private'));
    expect(res.text).not.toContain(t('govuk_alpha_saved.manage.show'));
    expect(res.text).not.toContain(t('govuk_alpha_saved.manage.hide'));
    expect(res.text).toContain(t('govuk_alpha_saved.wall.description'));
    // Reactions are still offered on a shown note.
    expect(res.text).toContain('method="post" action="/appreciations/56/react"');
  });

  // The page and its empty state said "public notes" as if the SENDER made a
  // note public. The receiver decides what shows, so the words say that the
  // member has chosen to show these (audit of warmth phase 5, 12 Nov 2026).
  it('is told these are the notes the member has chosen to show, not "public" notes', async () => {
    const shown = await request(createApp()).get(`/users/${ME}/appreciations`);
    expect(shown.text).toContain('Thank-you notes this member has chosen to show on their profile.');
    expect(shown.text).not.toMatch(/public (thank-you )?notes/i);

    api.getUserAppreciations.mockResolvedValueOnce({ data: [], meta: { current_page: 1, last_page: 1 } });
    const empty = await request(createApp()).get(`/users/${ME}/appreciations`);
    expect(empty.text).toContain('This member has not shown any thank-you notes yet.');
    expect(empty.text).not.toMatch(/public (thank-you )?notes/i);
  });

  it('is told the note is private, and is not asked to choose', async () => {
    const res = await request(createApp()).get(`/users/${ME}/appreciations`);

    expect(res.text).toContain(`method="post" action="/users/${ME}/appreciations"`);
    expect(res.text).toContain('id="appreciation-private-hint"');
    expect(res.text).toContain(t('govuk_alpha_saved.send.private_hint'));
    expect(res.text).toMatch(/<textarea[^>]*id="appreciation-message"[^>]*aria-describedby="[^"]*appreciation-private-hint/);
    expect(res.text).not.toContain('type="checkbox"');
    expect(res.text).not.toContain('name="is_public"');
    expect(res.text).not.toContain('appreciation-public');
  });

  it('sends the note without a public/private choice, even if a stale form posts one', async () => {
    const res = await post(createApp(), `/users/${ME}/appreciations`, { message: ' Thank you ', is_public: '1' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/users/${ME}/appreciations?status=appreciation-sent`);
    expect(api.sendAppreciation).toHaveBeenCalledTimes(1);
    const [, payload] = api.sendAppreciation.mock.calls[0];
    expect(payload).toEqual({ receiver_id: ME, message: 'Thank you', context_type: 'general' });
    expect(payload).not.toHaveProperty('is_public');
  });

  it('never rebuilds a full name when the profile has no display name', async () => {
    api.getUserV2.mockResolvedValue({ data: { id: ME, first_name: 'Morgan', last_name: 'Lee' } });

    const res = await request(createApp()).get(`/users/${ME}/appreciations`);

    expect(res.text).toContain(t('govuk_alpha_saved.wall.heading', { name: 'Morgan' }));
    expect(res.text).not.toContain('Lee');
  });
});

describe('showing and hiding a note', () => {
  it('shows a note on the profile', async () => {
    const res = await post(createApp(), '/appreciations/55/visibility', { is_public: '1', owner_id: String(ME) });

    expect(api.setAppreciationVisibility).toHaveBeenCalledWith('test-token', 55, true);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/users/${ME}/appreciations?status=appreciation-shown#appreciation-55`);
  });

  it('hides a note again, and returns to the page it was on', async () => {
    const res = await post(createApp(), '/appreciations/56/visibility', { is_public: '0', owner_id: String(ME), page: '2' });

    expect(api.setAppreciationVisibility).toHaveBeenCalledWith('test-token', 56, false);
    expect(res.headers.location).toBe(`/users/${ME}/appreciations?status=appreciation-hidden&page=2#appreciation-56`);
  });

  it('finds the member\'s own page when the form did not say whose it is', async () => {
    const res = await post(createApp(), '/appreciations/55/visibility', { is_public: '1' });

    expect(api.getProfile).toHaveBeenCalledWith('test-token');
    expect(res.headers.location).toBe(`/users/${ME}/appreciations?status=appreciation-shown#appreciation-55`);
  });

  it('refuses a request that does not say show or hide, without calling the API', async () => {
    const res = await post(createApp(), '/appreciations/55/visibility', { owner_id: String(ME) });

    expect(api.setAppreciationVisibility).not.toHaveBeenCalled();
    expect(res.headers.location).toBe(`/users/${ME}/appreciations?status=appreciation-visibility-failed#appreciation-55`);
  });

  it.each([404, 422, 500])('says it did not work when the API answers %i', async (code) => {
    api.setAppreciationVisibility.mockRejectedValue(new api.ApiError('nope', code, {}));

    const res = await post(createApp(), '/appreciations/55/visibility', { is_public: '1', owner_id: String(ME) });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/users/${ME}/appreciations?status=appreciation-visibility-failed#appreciation-55`);
  });

  it('sends a signed-out member to sign in', async () => {
    api.setAppreciationVisibility.mockRejectedValue(new api.ApiError('Unauthenticated', 401, {}));

    const res = await post(createApp(), '/appreciations/55/visibility', { is_public: '1', owner_id: String(ME) });

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/login');
  });
});

describe('removing a note', () => {
  it('asks first, on the shared confirmation page, and deletes nothing', async () => {
    const res = await request(createApp()).get('/appreciations/55/remove');

    expect(res.status).toBe(200);
    expect(api.deleteAppreciation).not.toHaveBeenCalled();
    expect(res.text).toContain(t('govuk_alpha_saved.manage.remove_heading'));
    expect(res.text).toContain(t('govuk_alpha_saved.manage.remove_warning'));
    expect(res.text).toContain('method="post" action="/appreciations/55/remove"');
    expect(res.text).toContain('name="_csrf" value="test-csrf-token"');
    expect(res.text).toContain(`name="owner_id" value="${ME}"`);
    expect(res.text).toMatch(/<button class="govuk-button govuk-button--warning"[^>]*>Remove note<\/button>/);
    expect(res.text).toContain(`href="/users/${ME}/appreciations#appreciation-55"`);
  });

  it('carries the page number through the confirmation', async () => {
    const res = await request(createApp()).get('/appreciations/55/remove?page=2');

    expect(res.text).toContain('name="page" value="2"');
    expect(res.text).toContain(`href="/users/${ME}/appreciations?page=2#appreciation-55"`);
  });

  it('removes the note once confirmed', async () => {
    const res = await post(createApp(), '/appreciations/55/remove', { owner_id: String(ME), page: '2' });

    expect(api.deleteAppreciation).toHaveBeenCalledWith('test-token', 55);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/users/${ME}/appreciations?status=appreciation-removed&page=2`);
  });

  it.each([404, 500])('says it did not work when the API answers %i', async (code) => {
    api.deleteAppreciation.mockRejectedValue(new api.ApiError('nope', code, {}));

    const res = await post(createApp(), '/appreciations/55/remove', { owner_id: String(ME) });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/users/${ME}/appreciations?status=appreciation-remove-failed#appreciation-55`);
  });
});

describe('a community that has switched thank-you notes off', () => {
  const notAvailable = t('states.not_available');

  function expectNotAvailable(res) {
    expect(res.status).toBe(403);
    expect(res.text).toContain(notAvailable);
    expect(res.text).toContain(t('home.module_unavailable_hint'));
    // The account-permission wording would send the member to ask about a non-problem.
    expect(res.text).not.toContain(t('error_pages.403_body'));
  }

  describe('as Laravel reports it (403 FEATURE_DISABLED)', () => {
    it('shows "not available" instead of someone else\'s page', async () => {
      api.getProfile.mockResolvedValue({ data: { id: SOMEONE_ELSE, name: 'Avery' } });
      api.getUserAppreciations.mockRejectedValue(featureDisabled());

      expectNotAvailable(await request(createApp()).get(`/users/${ME}/appreciations`));
    });

    it('shows "not available" instead of the member\'s own page', async () => {
      api.getMyAppreciations.mockRejectedValue(featureDisabled());

      expectNotAvailable(await request(createApp()).get(`/users/${ME}/appreciations`));
    });

    it('shows "not available" when a note is sent, and does not keep the message for later', async () => {
      api.getProfile.mockResolvedValue({ data: { id: SOMEONE_ELSE, name: 'Avery' } });
      api.sendAppreciation.mockRejectedValue(featureDisabled());
      const agent = request.agent(createApp());

      const sent = await agent.post(`/users/${ME}/appreciations`).type('form')
        .send({ _csrf: 'test-csrf-token', message: 'Thank you' });
      expectNotAvailable(sent);

      // Switched back on later: the form must not arrive pre-filled.
      const page = await agent.get(`/users/${ME}/appreciations`);
      expect(page.text).toMatch(/<textarea[^>]*id="appreciation-message"[^>]*><\/textarea>/);
    });

    it('shows "not available" for show, hide, remove and react', async () => {
      api.setAppreciationVisibility.mockRejectedValue(featureDisabled());
      api.deleteAppreciation.mockRejectedValue(featureDisabled());
      api.reactToAppreciation.mockRejectedValue(featureDisabled());
      const app = createApp();

      expectNotAvailable(await post(app, '/appreciations/55/visibility', { is_public: '1', owner_id: String(ME) }));
      expectNotAvailable(await post(app, '/appreciations/55/remove', { owner_id: String(ME) }));
      expectNotAvailable(await post(app, '/appreciations/56/react', { reaction_type: 'heart', owner_id: String(ME) }));
    });

    it('still treats any other 403 on sending as an ordinary refusal', async () => {
      api.sendAppreciation.mockRejectedValue(new api.ApiError('Contact restricted', 403, {
        errors: [{ code: 'SAFEGUARDING_CONTACT_RESTRICTED', message: 'Contact restricted' }]
      }));

      const res = await post(createApp(), `/users/${ME}/appreciations`, { message: 'Thank you' });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe(`/users/${ME}/appreciations?status=appreciation-safeguarding-restricted`);
    });
  });

  describe('as the community\'s own settings report it (features.appreciations)', () => {
    const offTenant = { id: 2, slug: 'acme', name: 'Acme Timebank', features: { appreciations: false } };

    it('stops every thank-you page and action before any API call', async () => {
      const app = createApp({ tenant: offTenant });

      expectNotAvailable(await request(app).get(`/users/${ME}/appreciations`));
      expectNotAvailable(await post(app, `/users/${ME}/appreciations`, { message: 'Thank you' }));
      expectNotAvailable(await post(app, '/appreciations/55/visibility', { is_public: '1' }));
      expectNotAvailable(await request(app).get('/appreciations/55/remove'));
      expectNotAvailable(await post(app, '/appreciations/55/remove'));
      expectNotAvailable(await post(app, '/appreciations/55/react', { reaction_type: 'heart' }));

      expect(api.getUserV2).not.toHaveBeenCalled();
      expect(api.getMyAppreciations).not.toHaveBeenCalled();
      expect(api.getUserAppreciations).not.toHaveBeenCalled();
      expect(api.sendAppreciation).not.toHaveBeenCalled();
      expect(api.setAppreciationVisibility).not.toHaveBeenCalled();
      expect(api.deleteAppreciation).not.toHaveBeenCalled();
      expect(api.reactToAppreciation).not.toHaveBeenCalled();
    });

    it('leaves other members\' public collections alone', async () => {
      api.getUserPublicCollections.mockResolvedValue({ data: [] });

      const res = await request(createApp({ tenant: offTenant })).get(`/users/${ME}/collections`);

      expect(res.status).toBe(200);
    });

    it.each([
      ['no features at all', { id: 2, slug: 'acme' }],
      ['features without the key', { id: 2, slug: 'acme', features: { events: true } }],
      ['the key switched on', { id: 2, slug: 'acme', features: { appreciations: true } }]
    ])('treats %s as switched on', async (_label, tenant) => {
      const res = await request(createApp({ tenant })).get(`/users/${ME}/appreciations`);

      expect(res.status).toBe(200);
    });
  });
});
