// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * E-105 (13 Oct 2026): the events check-in pages, walked in a browser as the
 * organiser and as an attendee on the local stack. What was found, and what this
 * file pins so it cannot come back:
 *
 * 1. THE ORGANISER'S PAGE OPENED WITH THE CODE FORM and buried the by-name list —
 *    the way almost every arrival is actually recorded — below it. It also said
 *    attendance "never changes balances or awards time credits", which is false
 *    when an event carries an attendance reward. The page now opens with a plain
 *    "How check-in works" panel, the counts, the by-name list, and the code form
 *    last.
 *
 * 2. "NO ATTENDANCE ACTION IS CURRENTLY AVAILABLE" WITH NO REASON. Before the
 *    window opens, every person on the list offered nothing and the page did not
 *    say why. It now says when check-in opens (or closed), computed from the
 *    event's own times with the API's platform defaults (30 minutes before, 24
 *    hours after).
 *
 * 3. UNDO WITHOUT A REASON got the generic "check the action, reason and
 *    confirmation" message (by name, by code, and when cancelling an attendee's
 *    code). Each now says exactly that a reason is missing.
 *
 * 4. "CHECK IN" FOR SOMEONE ALREADY CHECKED OUT (easy from the code form, which
 *    always offers all four actions) came back as "this record changed elsewhere,
 *    the roster has been refreshed" — the 409 EVENT_REGISTRATION_TRANSITION_INVALID
 *    was collapsed into the concurrency message. It is now its own answer.
 *
 * 5. AN UNREADABLE CODE showed the same generic message as a missing
 *    confirmation. It now says the code could not be read and what to do.
 *
 * 6. THE ATTENDEE'S CODE WAS TEXT ONLY. The phone app and the main website scan a
 *    QR; the accessible page offered nothing to scan. It now renders the same
 *    code as an inline QR SVG (src/lib/qr-svg.js) beside the text. A cancelled
 *    code also stopped showing an expiry date, which read as if it might still
 *    work until then.
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

const t = createTranslator('en');

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
  app.use(session({ secret: 'e105-check-in-guidance-test-secret-at-least-32', resave: false, saveUninitialized: false }));
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
      t,
      tc: createChoiceTranslator('en'),
      htmlLang: 'en',
      htmlDirection: 'ltr',
      formatLocaleDate: (value) => `DATE(${new Date(value).toISOString()})`,
    });
    next();
  }, eventsRoutes);
  return app;
}

const app = mount();

// Visible words only: ids such as signed-code-heading and the shell's "Signed in"
// are not what a volunteer reads.
function visibleText(html) {
  const main = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
  return main.replace(/<[^>]+>/g, ' ').replace(/s+/g, ' ');
}

function hoursFromNow(hours) {
  return new Date(Date.now() + hours * 3600000).toISOString();
}

function rosterWith(start, end, people = []) {
  api.callEventApi
    .mockResolvedValueOnce({ data: { id: 501, title: 'Repair cafe', start_time: start, end_time: end, timezone: 'UTC' } })
    .mockResolvedValueOnce({ data: people, meta: { total: people.length, total_pages: 1, metrics: {} } });
}

const confirmedPerson = (actions) => ({
  member: { id: 900015, display_name: 'Alex Morgan' },
  registration: { state: 'confirmed', version: 1 },
  attendance: { state: 'not_checked_in', version: 0 },
  management_actions: actions,
});

describe("the organiser's check-in page explains itself and puts the by-name list first", () => {
  beforeEach(() => jest.clearAllMocks());

  it('opens with "How check-in works", then the list, then the code form', async () => {
    rosterWith(hoursFromNow(-0.5), hoursFromNow(2), [confirmedPerson({ check_in: true, no_show: true })]);
    const res = await request(app).get('/501/check-in');
    expect(res.status).toBe(200);
    const text = res.text;
    const how = text.indexOf('id="check-in-how"');
    const byName = text.indexOf('id="check-in-by-name"');
    const byCode = text.indexOf('id="check-in-by-code"');
    expect(how).toBeGreaterThan(-1);
    expect(byName).toBeGreaterThan(how);
    expect(byCode).toBeGreaterThan(byName);
    // The panel is a GOV.UK details component with numbered steps, no JavaScript needed.
    expect(text).toContain('<details class="govuk-details"');
    expect(text).toContain(t('govuk_alpha.events.check_in_how_title'));
    expect(text).toContain('govuk-list--number');
    for (const key of ['check_in_how_who', 'check_in_how_when', 'check_in_how_name', 'check_in_how_code', 'check_in_how_undo', 'check_in_how_credits']) {
      const value = t(`govuk_alpha.events.${key}`);
      expect(value).not.toContain('govuk_alpha'); // a missing key renders as its own name
      expect(text).toContain(value.replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
    }
  });

  it('tells the truth about time credits and drops the jargon', async () => {
    rosterWith(hoursFromNow(-0.5), hoursFromNow(2), []);
    const res = await request(app).get('/501/check-in');
    expect(res.text).toContain('time-credit reward');
    expect(res.text).not.toContain('never change balances');
    const text = visibleText(res.text).toLowerCase();
    for (const jargon of ['signed', 'idempotency', 'auditable', 'roster', 'fallback', 'audit log', 'manual check-in', 'revoke']) {
      expect(text).not.toContain(jargon);
    }
  });

  it('says what the page is called from the event page and the people page', () => {
    expect(t('govuk_alpha.events.check_in_title')).toBe('Check in attendees');
    expect(t('event_offline_checkin.attendee.manage_link')).toContain('optional');
  });

});

describe('the page says when check-in opens or closed, from the event times', () => {
  beforeEach(() => jest.clearAllMocks());

  it('before the window: says when it opens and why nothing can be recorded', async () => {
    const start = hoursFromNow(48);
    rosterWith(start, hoursFromNow(50), [confirmedPerson({})]);
    const res = await request(app).get('/501/check-in');
    const opens = new Date(new Date(start).getTime() - 30 * 60000).toISOString();
    expect(res.text).toContain('id="check-in-window"');
    expect(res.text).toContain('30 minutes before it starts');
    // The label is built through res.locals.formatLocaleDate, in the event's zone.
    expect(res.text).toContain(`DATE(${opens})`);
    expect(res.text).toContain(t('govuk_alpha.events.attendance_no_action'));
  });

  it('after the window: says it closed and that check-out and undo still work', async () => {
    const end = hoursFromNow(-30);
    rosterWith(hoursFromNow(-32), end, []);
    const res = await request(app).get('/501/check-in');
    const closes = new Date(new Date(end).getTime() + 24 * 3600000).toISOString();
    expect(res.text).toContain('24 hours after it ended');
    expect(res.text).toContain(`DATE(${closes})`);
    expect(res.text).toContain('undo the latest change');
  });

  it('during the window: says it is open and when it closes', async () => {
    rosterWith(hoursFromNow(-0.5), hoursFromNow(2), []);
    const res = await request(app).get('/501/check-in');
    expect(res.text).toContain('Check-in is open now');
  });

  it('says nothing when the event carries no start time', async () => {
    api.callEventApi
      .mockResolvedValueOnce({ data: { id: 501, title: 'Repair cafe' } })
      .mockResolvedValueOnce({ data: [], meta: { total: 0, total_pages: 0, metrics: {} } });
    const res = await request(app).get('/501/check-in');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('id="check-in-window"');
  });
});

describe('each refusal says what to do next', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.callEventApi.mockResolvedValue({ data: {} });
  });

  const post = (pathname, payload) => request(app).post(pathname).type('form').send(payload);

  it('undo by name without a reason: "enter a reason", not the generic refusal', async () => {
    const res = await post('/501/check-in/900015', { action: 'undo', expected_version: '3', confirmation: '1', idempotency_key: 'k' });
    expect(res.headers.location).toContain('status=attendance-reason-required');
    expect(api.callEventApi).not.toHaveBeenCalled();
  });

  it('undo by code without a reason: the same', async () => {
    const res = await post('/501/check-in/code', { action: 'undo', credential: 'nqx2_abc', confirmation: '1', idempotency_key: 'k' });
    expect(res.headers.location).toContain('status=attendance-reason-required');
    expect(api.callEventApi).not.toHaveBeenCalled();
  });

  it('but a missing confirmation is still the generic refusal, so a crawler cannot be told anything useful', async () => {
    const res = await post('/501/check-in/code', { action: 'undo', credential: 'nqx2_abc', idempotency_key: 'k' });
    expect(res.headers.location).toContain('status=attendance-code-invalid');
  });

  it('a change the person\'s current state does not allow is "not possible", not "changed elsewhere"', async () => {
    api.callEventApi.mockRejectedValue(new api.ApiError('conflict', 409, {
      errors: [{ code: 'EVENT_REGISTRATION_TRANSITION_INVALID', message: 'x' }],
    }));
    const byCode = await post('/501/check-in/code', { action: 'check_in', credential: 'nqx2_abc', confirmation: '1', idempotency_key: 'k' });
    expect(byCode.headers.location).toContain('status=attendance-not-possible');
    const byName = await post('/501/check-in/900015', { action: 'check_in', expected_version: '3', confirmation: '1', idempotency_key: 'k' });
    expect(byName.headers.location).toContain('status=attendance-not-possible');
  });

  it('cancelling an attendee code without a reason: "enter a reason"', async () => {
    const res = await post('/501/check-in/credential/revoke', { credential_id: '7', expected_version: '2', confirmation: '1' });
    expect(res.headers.location).toContain('status=reason-required');
    expect(api.callEventApi).not.toHaveBeenCalled();
  });

  it.each([
    ['attendance-reason-required', t('govuk_alpha.events.attendance_reason_required')],
    ['attendance-not-possible', t('govuk_alpha.events.attendance_not_possible')],
    ['attendance-code-invalid', t('event_offline_checkin.code.invalid')],
    ['attendance-too-early', t('govuk_alpha.events.attendance_too_early')],
    ['attendance-window-closed', t('govuk_alpha.events.attendance_window_closed')],
  ])('%s renders its own wording', async (status, message) => {
    rosterWith(hoursFromNow(-0.5), hoursFromNow(2), []);
    const res = await request(app).get(`/501/check-in?status=${status}`);
    expect(message).not.toContain('govuk_alpha');
    expect(res.text).toContain(message.replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
    expect(res.text).not.toContain(t('govuk_alpha.events.attendance_failed'));
  });

  it('the too-early and closed messages name the real numbers', () => {
    expect(t('govuk_alpha.events.attendance_too_early')).toContain('30 minutes');
    expect(t('govuk_alpha.events.attendance_window_closed')).toContain('24 hours');
  });
});

describe("the attendee's code page", () => {
  beforeEach(() => jest.clearAllMocks());

  const token = 'nqx2_' + 'A'.repeat(120);

  function credentialPage(credential, status = '') {
    api.callEventApi
      .mockResolvedValueOnce({ data: { id: 501, title: 'Repair cafe' } })
      .mockResolvedValueOnce({ data: { credential } });
    return request(app).get(`/501/check-in/credential${status ? `?status=${status}` : ''}`);
  }

  it('opens with numbered "how to use your code" steps and says the code is optional', async () => {
    const res = await credentialPage(null);
    expect(res.status).toBe(200);
    expect(res.text).toContain('id="credential-how"');
    expect(res.text).toContain('govuk-list--number');
    expect(res.text).toContain('(optional)');
    expect(res.text).toContain('check you in by name');
    expect(res.text).toContain('24 hours after the event ends');
    expect(res.text).not.toContain('never change balances');
    const text = visibleText(res.text).toLowerCase();
    expect(text).not.toContain('signed');
    expect(text).not.toContain('revoke');
    expect(text).not.toContain('credential');
  });

  it('shows a freshly created code as a QR and as text, once', async () => {
    api.callEventApi.mockResolvedValueOnce({ data: { credential: { id: 7, version: 1, status: 'active', expires_at: '2026-10-15T00:27:00Z', token, token_one_shot: true } } });
    api.callEventApi.mockResolvedValueOnce({ data: { id: 501, title: 'Repair cafe' } });
    const res = await request(app).post('/501/check-in/credential/issue').type('form').send({ confirmation: '1', idempotency_key: 'issue-key-1' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('data-testid="attendee-checkin-qr"');
    expect(res.text).toContain('<svg');
    expect(res.text).toContain(token);
    // The SVG encodes the token into rectangles; it must never appear inside it as text.
    const svg = res.text.slice(res.text.indexOf('<svg'), res.text.indexOf('</svg>'));
    expect(svg).not.toContain('nqx2_');
    expect(res.text).toContain(t('event_offline_checkin.attendee.notice_issued'));
  });

  it('shows no expiry date on a cancelled code', async () => {
    const res = await credentialPage({ id: 7, version: 2, status: 'revoked', expires_at: '2026-10-15T00:27:00Z' }, 'revoked');
    expect(res.text).toContain(t('event_offline_checkin.attendee.status_revoked'));
    expect(res.text).not.toContain('Expires');
    expect(res.text).toContain(t('event_offline_checkin.attendee.notice_revoked'));
  });

  it('shows the expiry on a working code, with replace and cancel explained', async () => {
    const res = await credentialPage({ id: 7, version: 1, status: 'active', expires_at: '2026-10-15T00:27:00Z' });
    expect(res.text).toContain('Expires');
    expect(res.text).toContain(t('event_offline_checkin.attendee.replace_hint'));
    expect(res.text).toContain(t('event_offline_checkin.attendee.revoke_hint'));
  });

  it('says a reason is missing when cancelling without one', async () => {
    const res = await credentialPage({ id: 7, version: 1, status: 'active' }, 'reason-required');
    expect(res.text).toContain(t('event_offline_checkin.attendee.notice_reason_required'));
  });
});
