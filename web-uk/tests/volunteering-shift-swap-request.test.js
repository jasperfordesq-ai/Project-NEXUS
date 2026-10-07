// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Asking to swap a shift on the accessible site (gap B3, 7 Oct 2026). The old form asked
 * for a "shift number" and a "member number", neither shown anywhere on this site, so
 * nobody could use it.
 *
 * Pinned here:
 * - the page offers only the member's own upcoming shifts, and for one of them only the
 *   same opportunity's other upcoming shifts that have someone on them;
 * - the member picks a shift, never a person: the request carries no to_user_id;
 * - a missing choice, or a shift that is not on offer, is refused before the API;
 * - a shift that is not the member's own upcoming shift is "not found";
 * - a refusal from the API keeps the choice and the message;
 * - the sent card says who it went to only once they agree, and labels the member's
 *   own shift as theirs whichever way the request went.
 */

const path = require('path');
const express = require('express');
const session = require('express-session');
const nunjucks = require('nunjucks');
const request = require('supertest');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');
const { characterCountMessages } = require('../src/lib/character-count-messages');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }
  return {
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    callVolunteeringApi: jest.fn(),
    getVolunteeringCategories: jest.fn(),
    searchUsers: jest.fn(),
    getProfile: jest.fn(),
    invalidateUserCache: jest.fn()
  };
});

const api = require('../src/lib/api');
const volunteeringActionRoutes = require('../src/routes/volunteering-actions');

const PREFIX = '/acme/accessible';
const MOUNT = `${PREFIX}/volunteering`;
const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const t = createTranslator('en');
const D = 'govuk_alpha.vol_depth.';
// Nunjucks autoescape turns apostrophes into &#39;.
const html = (text) => String(text).replace(/'/g, '&#39;');

function createApp() {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  env.addFilter('formatDate', (value) => String(value || ''));
  env.addFilter('formatEventDate', (value) => String(value || ''));
  env.addFilter('date', (value) => String(value || ''));
  env.addFilter('nl2br', (value) => String(value || ''));

  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'swap-request-test-secret', resave: false, saveUninitialized: false }));

  app.use(MOUNT, (req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    res.locals.urlFor = (value) => {
      const target = String(value || '/');
      return target.startsWith(PREFIX) ? target : `${PREFIX}${target.startsWith('/') ? target : `/${target}`}`;
    };
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS',
      tenantName: 'Acme Timebank',
      isAuthenticated: true,
      csrfToken: 'test-csrf-token',
      alphaNavItems: [],
      feedbackUrl: `${PREFIX}/feedback`,
      currentPath: MOUNT,
      alphaLocaleOptions: [],
      alphaLanguageQueryParams: [],
      htmlLang: 'en',
      htmlDirection: 'ltr',
      t,
      tc: createChoiceTranslator('en'),
      characterCountMessages: characterCountMessages(t, 'en'),
      formatLocaleNumber: (value) => String(value ?? ''),
      formatLocaleDate: (value) => String(value ?? '')
    });
    next();
  }, volunteeringActionRoutes);

  return app;
}

// The member holds shift 71 (future) on opportunity 131, and shift 60 (past).
const MY_SHIFTS = {
  items: [
    { id: 71, opportunity_id: 131, opportunity_title: 'Food bank sorting', start_time: '2099-03-27 09:00:00', end_time: '2099-03-27 12:00:00' },
    { id: 60, opportunity_id: 131, opportunity_title: 'Food bank sorting', start_time: '2020-01-06 10:00:00', end_time: '2020-01-06 11:00:00' }
  ],
  cursor: null,
  has_more: false
};

const OPPORTUNITY_SHIFTS = [
  { id: 71, start_time: '2099-03-27 09:00:00', end_time: '2099-03-27 12:00:00', signup_count: 1 },
  // Someone on it, upcoming: offered.
  { id: 73, start_time: '2099-03-29 14:00:00', end_time: '2099-03-29 16:00:00', signup_count: 2 },
  // Upcoming but nobody on it: nobody to ask.
  { id: 74, start_time: '2099-03-30 09:00:00', end_time: '2099-03-30 10:00:00', signup_count: 0 },
  // Someone on it, but already happened.
  { id: 61, start_time: '2020-01-08 10:00:00', end_time: '2020-01-08 11:00:00', signup_count: 3 },
  // Someone on it, sooner than 73: offered first.
  { id: 72, start_time: '2099-03-28 09:00:00', end_time: '2099-03-28 10:00:00', signup_count: 1 }
];

function mockApi({ shifts = OPPORTUNITY_SHIFTS, postError = null, swaps = [] } = {}) {
  api.callVolunteeringApi.mockImplementation(async (token, method, apiPath) => {
    if (method === 'GET' && apiPath === '/shifts?per_page=50') return { data: MY_SHIFTS };
    if (method === 'GET' && apiPath === '/opportunities/131/shifts') return { data: shifts };
    if (method === 'GET' && apiPath === '/swaps') return { data: swaps };
    if (method === 'POST' && apiPath === '/swaps') {
      if (postError) throw postError;
      return { data: { id: 900 } };
    }
    throw new api.ApiError('unexpected', 500, {});
  });
}

function posts() {
  return api.callVolunteeringApi.mock.calls.filter(([, method]) => method === 'POST');
}

beforeEach(() => {
  api.callVolunteeringApi.mockReset();
  mockApi();
});

describe('the shift swaps page', () => {
  it('lists only the member\'s own upcoming shifts, each with "Ask to swap"', async () => {
    const res = await request(createApp()).get(`${MOUNT}/swaps`);

    expect(res.status).toBe(200);
    expect(res.text).toContain(`href="${MOUNT}/swaps/new/71"`);
    expect(res.text).not.toContain(`href="${MOUNT}/swaps/new/60"`);
    expect(res.text).toContain(t(`${D}swap_ask_link`));
    expect(res.text).not.toContain('name="to_user_id"');
    expect(res.text).not.toContain('name="to_shift_id"');
  });

  it('names the other volunteer on a sent request only once the API does, and labels shifts by whose they are', async () => {
    mockApi({
      swaps: [
        {
          id: 5,
          direction: 'sent',
          status: 'pending',
          requester: { id: 1, name: 'Me' },
          recipient: { id: null, name: null },
          original_shift: { id: 71, opportunity_title: 'My own shift', start_time: '2099-03-27 09:00:00' },
          proposed_shift: { id: 73, opportunity_title: 'Shift I asked for', start_time: '2099-03-29 14:00:00' }
        },
        {
          id: 6,
          direction: 'received',
          status: 'pending',
          requester: { id: 9, name: 'Riley' },
          recipient: { id: 1, name: 'Me' },
          original_shift: { id: 80, opportunity_title: 'Riley offers this', start_time: '2099-04-01 09:00:00' },
          proposed_shift: { id: 71, opportunity_title: 'Riley wants mine', start_time: '2099-03-27 09:00:00' }
        }
      ]
    });

    const res = await request(createApp()).get(`${MOUNT}/swaps`);

    expect(res.text).toContain(t(`${D}swap_to_unnamed`));
    const sent = res.text.slice(res.text.indexOf('My own shift') - 600, res.text.indexOf('Shift I asked for'));
    expect(sent).toContain(t(`${D}swap_your_shift`));
    const received = res.text.slice(res.text.indexOf('Riley wants mine') - 600, res.text.indexOf('Riley wants mine'));
    expect(received).toContain(t(`${D}swap_your_shift`));
    expect(res.text.indexOf('Riley wants mine')).toBeLessThan(res.text.indexOf('Riley offers this'));
  });
});

describe('asking to swap one shift', () => {
  it('offers only the same opportunity\'s upcoming shifts that have someone on them, soonest first', async () => {
    const res = await request(createApp()).get(`${MOUNT}/swaps/new/71`);

    expect(res.status).toBe(200);
    expect(res.text).toContain(t(`${D}swap_new_title`));
    expect(res.text).toContain(html(t(`${D}swap_new_body`)));
    expect(res.text).toContain('value="72"');
    expect(res.text).toContain('value="73"');
    expect(res.text).not.toContain('value="74"');
    expect(res.text).not.toContain('value="61"');
    expect(res.text).not.toMatch(/name="to_shift_id" type="radio" value="71"/);
    expect(res.text.indexOf('value="72"')).toBeLessThan(res.text.indexOf('value="73"'));
    expect(res.text).toMatch(/name="idempotency_key" value="[A-Za-z0-9-]{8,}"/);
    expect(res.text).toContain(`action="${MOUNT}/swaps/new/71"`);
  });

  it('says so when there is nobody to swap with', async () => {
    mockApi({ shifts: [OPPORTUNITY_SHIFTS[0], OPPORTUNITY_SHIFTS[2]] });

    const res = await request(createApp()).get(`${MOUNT}/swaps/new/71`);
    expect(res.text).toContain('data-testid="swap-no-options"');
    expect(res.text).not.toContain('name="to_shift_id"');
  });

  it('is "not found" for a shift that is not the member\'s own upcoming shift', async () => {
    expect((await request(createApp()).get(`${MOUNT}/swaps/new/60`)).status).toBe(404);
    expect((await request(createApp()).get(`${MOUNT}/swaps/new/73`)).status).toBe(404);
    expect((await request(createApp()).post(`${MOUNT}/swaps/new/73`).type('form').send({ to_shift_id: '72' })).status).toBe(404);
    expect(posts()).toHaveLength(0);
  });

  it('asks for a shift, never a person', async () => {
    const res = await request(createApp()).post(`${MOUNT}/swaps/new/71`).type('form')
      .send({ to_shift_id: '73', message: '  Could you take mine? ', idempotency_key: 'swap-key-12345678' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${MOUNT}/swaps?status=swap-requested`);
    expect(posts()).toEqual([['test-token', 'POST', '/swaps', {
      from_shift_id: 71,
      to_shift_id: 73,
      message: 'Could you take mine?',
      idempotency_key: 'swap-key-12345678'
    }]]);
  });

  it('refuses no choice, or a shift that is not on offer, before the API', async () => {
    const none = await request(createApp()).post(`${MOUNT}/swaps/new/71`).type('form').send({ message: 'Kept' });
    expect(none.status).toBe(400);
    expect(none.text).toContain('govuk-error-summary');
    expect(none.text).toContain(t(`${D}swap_choose_required`));
    expect(none.text).toContain('Kept');

    const empty = await request(createApp()).post(`${MOUNT}/swaps/new/71`).type('form').send({ to_shift_id: '74' });
    expect(empty.status).toBe(400);
    expect(posts()).toHaveLength(0);
  });

  it('keeps the choice and the message when the API refuses', async () => {
    mockApi({ postError: new api.ApiError('no', 422, { errors: [{ code: 'VALIDATION_ERROR' }] }) });

    const res = await request(createApp()).post(`${MOUNT}/swaps/new/71`).type('form')
      .send({ to_shift_id: '73', message: 'Please', idempotency_key: 'swap-key-12345678' });

    expect(res.status).toBe(400);
    expect(res.text).toContain(t(`${D}swap_request_failed`));
    expect(res.text).toMatch(/value="73" checked/);
    expect(res.text).toContain('Please');
    expect(res.text).toContain('value="swap-key-12345678"');
  });

  it('sends a safeguarding refusal back to the swaps page with its own message', async () => {
    mockApi({ postError: new api.ApiError('restricted', 403, { errors: [{ code: 'SAFEGUARDING_CONTACT_RESTRICTED' }] }) });

    const res = await request(createApp()).post(`${MOUNT}/swaps/new/71`).type('form').send({ to_shift_id: '73' });
    expect(res.headers.location).toBe(`${MOUNT}/swaps?status=swap-safeguarding-restricted`);
  });
});
