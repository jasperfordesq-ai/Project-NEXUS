// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Two defects found by WALKING the events journey in a browser on 2026-08-24,
 * neither of which any static sweep across seven audits could see.
 *
 * 1. THE ORGANISER'S CONTROLS WERE INVISIBLE. `events/detail.njk` gates the
 *    publish control, the check-in link, attendee management, broadcasts and
 *    lifecycle history on `event.permissions`. The v1 event detail body carries
 *    no permission set at all, and web-uk never negotiated the canonical (v2)
 *    contract — so an organiser looking at their own event saw three links and no
 *    way to publish it. Creating an event was a dead end: it is created as a
 *    draft, the page said "Success — your event has been created", and nothing
 *    on the accessible frontend could ever make it visible to members.
 *
 *    Fixed by reading the permission set from the canonical contract in a
 *    SEPARATE call. Opting the detail read itself into v2 was measured and
 *    rejected: on the same event it loses 43 keys, 21 of which this app reads,
 *    including all ten venue accessibility fields — losing step-free access and
 *    hearing-loop information on the ACCESSIBLE frontend to gain a publish
 *    button is not a trade worth making.
 *
 * 2. FOUR DIFFERENT REFUSALS WORE THE SAME MESSAGE. The attendance endpoints
 *    answer 409 for a concurrent edit, for "check-in has not opened yet", for
 *    "the event has ended", for "this person has no confirmed place", and for
 *    "this event is still a draft". web-uk showed all of them as "This
 *    attendance record changed elsewhere. The roster has been refreshed; review
 *    it before trying again." Door staff were told to re-read a roster that was
 *    fine, with no hint of the real reason. Confirmed live: checking in before
 *    the window opened produced exactly that message.
 */
const express = require('express');
const session = require('express-session');
const request = require('supertest');
const nunjucks = require('nunjucks');
const path = require('node:path');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }
  return new Proxy({
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    getEvent: jest.fn(),
    getEventPermissions: jest.fn(),
    getEventRsvps: jest.fn(),
    // The router's own callApi() delegates here, so this is the seam that decides
    // what the attendance endpoints answer.
    callEventApi: jest.fn(),
  }, {
    get: (target, prop) => (prop in target ? target[prop] : jest.fn().mockResolvedValue({ data: [] })),
  });
});

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() }),
}));

const api = require('../src/lib/api');
const eventsRoutes = require('../src/routes/events');

// The v1 detail body, as Laravel actually returns it: no `permissions`, and the
// accessibility fields that a v2 switch would have taken away.
function v1Event(overrides = {}) {
  return {
    data: {
      id: 501,
      title: 'Repair cafe',
      description: 'Bring something broken.',
      status: 'draft',
      start_time: '2026-09-20T14:00:00+00:00',
      end_time: '2026-09-20T16:00:00+00:00',
      location: 'Bantry Community Hall',
      accessibility_step_free: true,
      accessibility_hearing_loop: true,
      user_id: 900014,
      ...overrides,
    },
  };
}

function mount() {
  const app = express();
  const environment = nunjucks.configure(
    [path.join(__dirname, '..', 'src', 'views'),
      path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
    { autoescape: true, noCache: true, express: app }
  );
  require('../src/lib/template-filters').registerTemplateFilters(environment);
  environment.addFilter('nl2br', (value) => value);
  app.set('view engine', 'njk');
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'organiser-controls-test-secret-at-least-32', resave: false, saveUninitialized: false }));
  app.use('/', (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.csrfToken = () => 'csrf';
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'test', prefix: '/test/accessible', tenant: { id: 2, slug: 'test' } };
    res.locals.urlFor = (v) => String(v || '/');
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS',
      tenantName: 'Test',
      isAuthenticated: true,
      csrfToken: 'csrf',
      t: createTranslator('en'),
      tc: createChoiceTranslator('en'),
      htmlLang: 'en',
      htmlDirection: 'ltr',
      formatLocaleDate: () => '20 September 2026',
    });
    next();
  }, eventsRoutes);
  return app;
}

const app = mount();

describe('an organiser can see and use their own event controls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getEvent.mockResolvedValue(v1Event());
    api.getEventRsvps.mockResolvedValue({ data: [], meta: {} });
    api.callEventApi.mockResolvedValue({ data: {} });
  });

  it('reads the permission set from the canonical contract, not from the v1 body', async () => {
    api.getEventPermissions.mockResolvedValue({ permissions: { publish: true }, canEdit: true });
    await request(app).get('/501');
    // Without this call there is no permission set anywhere on the page, because
    // the v1 detail body has never carried one.
    expect(api.getEventPermissions).toHaveBeenCalledWith('token:test', '501');
  });

  it('offers a publish control on a draft the viewer may publish', async () => {
    api.getEventPermissions.mockResolvedValue({ permissions: { publish: true } });
    const res = await request(app).get('/501');
    expect(res.status).toBe(200);
    expect(res.text).toContain('/events/501/publish');
  });

  it('offers submit-for-review instead when that is the permission granted', async () => {
    api.getEventPermissions.mockResolvedValue({ permissions: { submit_for_review: true } });
    const res = await request(app).get('/501');
    expect(res.text).toContain('/events/501/submit');
    expect(res.text).not.toContain('/events/501/publish');
  });

  it('offers the check-in, attendee and broadcast pages when permitted', async () => {
    api.getEventPermissions.mockResolvedValue({
      permissions: { check_in: true, manage_people: true, broadcast: true, edit: true },
    });
    const res = await request(app).get('/501');
    expect(res.text).toContain('/events/501/check-in');
    expect(res.text).toContain('/events/501/people');
    expect(res.text).toContain('/events/501/communications');
    expect(res.text).toContain('/events/501/lifecycle-history');
  });

  it('offers none of it to a member with no permissions', async () => {
    api.getEventPermissions.mockResolvedValue({});
    const res = await request(app).get('/501');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('/events/501/publish');
    expect(res.text).not.toContain('/events/501/check-in');
    expect(res.text).not.toContain('/events/501/people');
    expect(res.text).not.toContain('/events/501/communications');
  });

  it('still renders the page when the permission read fails', async () => {
    // Fails soft on purpose: the pre-fix page, not an error page.
    api.getEventPermissions.mockRejectedValue(new api.ApiError('nope', 500));
    const res = await request(app).get('/501');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Repair cafe');
  });

  it('keeps the venue accessibility information the v2 body would have dropped', async () => {
    // The reason permissions are a separate read. If someone "simplifies" this by
    // switching getEvent to the v2 contract, these fields disappear from the
    // accessible frontend and this test is the alarm.
    api.getEventPermissions.mockResolvedValue({ permissions: { publish: true } });
    await request(app).get('/501');
    // Exactly two arguments: no contract header smuggled onto the detail read.
    expect(api.getEvent).toHaveBeenCalledWith('token:test', '501');
    expect(api.getEvent.mock.calls[0]).toHaveLength(2);
  });
});

describe('each attendance refusal says what actually happened', () => {
  // Every one of these arrives as HTTP 409, indistinguishable by status alone.
  const cases = [
    ['EVENT_ATTENDANCE_TOO_EARLY', 'attendance-too-early'],
    ['EVENT_ATTENDANCE_WINDOW_CLOSED', 'attendance-window-closed'],
    ['EVENT_ATTENDANCE_REGISTRATION_REQUIRED', 'attendance-not-registered'],
    ['EVENT_REGISTRATION_UNAVAILABLE', 'attendance-event-unavailable'],
  ];

  beforeEach(() => jest.clearAllMocks());

  function refuse(code) {
    return new api.ApiError('conflict', 409, { errors: [{ code, message: 'x' }] });
  }

  describe.each(cases)('%s', (code, status) => {
    it(`sends the signed-code path to ${status}`, async () => {
      api.callEventApi.mockRejectedValue(refuse(code));
      const res = await request(app)
        .post('/501/check-in/code')
        .type('form')
        .send({ action: 'check_in', credential: 'nqx2_abc', confirmation: '1', idempotency_key: 'k-1' });
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain(`status=${status}`);
    });

    it(`sends the roster-pick path to ${status}`, async () => {
      api.callEventApi.mockRejectedValue(refuse(code));
      const res = await request(app)
        .post('/501/check-in/900015')
        .type('form')
        .send({ action: 'check_in', expected_version: '0', confirmation: '1', idempotency_key: 'k-2' });
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain(`status=${status}`);
    });
  });

  it('keeps the "changed elsewhere" message for a genuine concurrent edit', async () => {
    api.callEventApi.mockRejectedValue(refuse('EVENT_REGISTRATION_IDEMPOTENCY_CONFLICT'));
    const res = await request(app)
      .post('/501/check-in/900015')
      .type('form')
      .send({ action: 'check_in', expected_version: '0', confirmation: '1', idempotency_key: 'k-3' });
    expect(res.headers.location).toContain('status=attendance-conflict');
  });

  it('keeps the "changed elsewhere" message when the 409 carries no code at all', async () => {
    api.callEventApi.mockRejectedValue(new api.ApiError('conflict', 409, {}));
    const res = await request(app)
      .post('/501/check-in/code')
      .type('form')
      .send({ action: 'check_in', credential: 'nqx2_abc', confirmation: '1', idempotency_key: 'k-4' });
    expect(res.headers.location).toContain('status=attendance-code-conflict');
  });
});

describe('the check-in page renders a distinct message for each refusal', () => {
  const t = createTranslator('en');
  const expected = {
    'attendance-too-early': t('govuk_alpha.events.attendance_too_early'),
    'attendance-window-closed': t('govuk_alpha.events.attendance_window_closed'),
    'attendance-not-registered': t('govuk_alpha.events.attendance_not_registered'),
    'attendance-event-unavailable': t('govuk_alpha.events.attendance_event_unavailable'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    api.callEventApi.mockResolvedValue({ data: {} });
  });

  it.each(Object.entries(expected))('%s shows its own wording', async (status, message) => {
    const res = await request(app).get(`/501/check-in?status=${status}`);
    expect(res.status).toBe(200);
    expect(message).toBeTruthy();
    expect(message).not.toContain('govuk_alpha'); // a missing key renders as its own name
    expect(res.text).toContain(message);
    // The old collapsed wording must NOT appear for these four.
    expect(res.text).not.toContain(t('govuk_alpha.events.attendance_conflict'));
  });

  it('gives all four different wording', () => {
    const values = Object.values(expected);
    expect(new Set(values).size).toBe(values.length);
  });
});
