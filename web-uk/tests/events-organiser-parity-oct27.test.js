// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Events parity fixes, 27 Oct 2026 (React / API audit of the accessible events pages).
 *
 * 1. Organiser datetimes reach the API with seconds and the event zone's offset.
 * 2. "Repeat this event" follows GET /v2/events/recurrence-capabilities.
 * 3. A community with reminders off gets an explanation, not a Forbidden page.
 * 4. Email / audience / CSV invitations are offered to community admins only (F-161).
 * 5. An explained API refusal is shown instead of a generic failure.
 * 6. A pending (awaiting approval) RSVP is recognised on the detail page.
 * 7. Required registration answers outstanding are shown on people / check-in.
 * 8. The organiser's own draft / pending-review events are tagged in the list.
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
    getEvents: jest.fn(),
    getEventPermissions: jest.fn(),
    getEventRsvps: jest.fn(),
    getEventCategories: jest.fn(),
    getProfile: jest.fn(),
    callEventApi: jest.fn(),
    callEventBroadcastApi: jest.fn(),
  }, {
    get: (target, prop) => (prop in target ? target[prop] : jest.fn().mockResolvedValue({ data: [] })),
  });
});

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() }),
}));

const api = require('../src/lib/api');
const eventsRoutes = require('../src/routes/events');
const organiserTools = require('../src/routes/event-organiser-tools');
const { wallClockToOffsetIso, wallClockToUtc, wallClockInZone } = require('../src/lib/event-wall-clock');

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
  app.use(session({ secret: 'events-parity-oct27-test-secret-at-least-32', resave: false, saveUninitialized: false }));
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
      formatLocaleDate: () => '20 September 2026',
    });
    next();
  }, organiserTools, eventsRoutes);
  return app;
}

const app = mount();

const SUMMER_EVENT = { data: { id: 501, title: 'Repair cafe', timezone: 'Europe/Dublin', start_time: '2027-07-01T18:00:00+00:00', end_time: '2027-07-01T21:00:00+00:00', user_id: 900014 } };

function routeApi(handlers) {
  api.callEventApi.mockImplementation(async (token, method, apiPath, data) => {
    for (const [pattern, handler] of handlers) {
      if (pattern.test(`${method} ${apiPath}`)) return handler(data);
    }
    return { data: {} };
  });
}

function explained(status, message, reason) {
  return new api.ApiError('refused', status, { errors: [{ code: 'EVENT_REGISTRATION_VALIDATION_FAILED', message, reason }] });
}

function lastCall(method, pattern) {
  return api.callEventApi.mock.calls.filter(([, m, p]) => m === method && pattern.test(p)).pop();
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getEvent.mockResolvedValue(SUMMER_EVENT);
  api.getEventRsvps.mockResolvedValue({ data: [], meta: {} });
  api.getEventPermissions.mockResolvedValue({});
  api.getEventCategories.mockResolvedValue({ data: [] });
  api.getProfile.mockResolvedValue({ data: { id: 900014, role: 'member' } });
  api.callEventBroadcastApi.mockResolvedValue({ data: {} });
  routeApi([[/^GET \/501$/, () => SUMMER_EVENT]]);
});

describe('1. organiser datetimes carry seconds and the event zone offset', () => {
  it('converts a wall clock in the event zone, with summer and winter offsets', () => {
    expect(wallClockToOffsetIso('2027-07-01T19:00', 'Europe/Dublin')).toBe('2027-07-01T19:00:00+01:00');
    expect(wallClockToOffsetIso('2027-01-15T19:00', 'Europe/Dublin')).toBe('2027-01-15T19:00:00+00:00');
    expect(wallClockToOffsetIso('2027-01-15T19:00', 'America/New_York')).toBe('2027-01-15T19:00:00-05:00');
    expect(wallClockToUtc('2027-07-01T19:00', 'Europe/Dublin')).toBe('2027-07-01T18:00:00Z');
    // Inside the spring-forward gap: the time does not exist.
    expect(wallClockToOffsetIso('2027-03-28T01:30', 'Europe/Dublin')).toBeNull();
    expect(wallClockInZone('2027-07-01T18:00:00Z', 'Europe/Dublin')).toBe('2027-07-01T19:00');
  });

  it('sends registration windows as explicit UTC instants', async () => {
    const res = await request(app).post('/501/registration/settings').type('form').send({
      idempotency_key: 'key-12345678', expected_revision: '0', approval_mode: 'auto', per_member_limit: '1', guest_retention_days: '30',
      'opens_at-day': '1', 'opens_at-month': '6', 'opens_at-year': '2027', 'opens_at-time': '09:00',
      'closes_at-day': '30', 'closes_at-month': '6', 'closes_at-year': '2027', 'closes_at-time': '17:30',
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('status=settings-saved');
    const [, , , payload] = lastCall('PUT', /registration-product\/settings$/);
    expect(payload.opens_at_utc).toBe('2027-06-01T08:00:00Z');
    expect(payload.closes_at_utc).toBe('2027-06-30T16:30:00Z');
    expect(payload.cancellation_cutoff_at_utc).toBeNull();
    expect(payload).not.toHaveProperty('opens_at');
  });

  it('sends invitation expiry and send time with the event zone offset', async () => {
    await request(app).post('/501/registration/campaigns/7/issue').type('form').send({
      idempotency_key: 'key-12345678', expected_revision: '2',
      'expires_at-day': '20', 'expires_at-month': '6', 'expires_at-year': '2027', 'expires_at-time': '18:00',
    });
    expect(lastCall('POST', /campaigns\/7\/issue$/)[3].expires_at).toBe('2027-06-20T18:00:00+01:00');
    await request(app).post('/501/registration/campaigns/7/schedule').type('form').send({
      idempotency_key: 'key-12345678', expected_revision: '2', scheduled_for: '2027-06-10T10:15',
    });
    expect(lastCall('POST', /campaigns\/7\/schedule$/)[3].scheduled_for).toBe('2027-06-10T10:15:00+01:00');
  });

  it('sends a broadcast send-later time with the event zone offset', async () => {
    await request(app).post('/501/communications/9/schedule').type('form').send({
      idempotency_key: 'key-12345678', expected_version: '3',
      'scheduled_at-day': '25', 'scheduled_at-month': '6', 'scheduled_at-year': '2027', 'scheduled_at-time': '8am',
    });
    const [, , apiPath, payload] = api.callEventBroadcastApi.mock.calls.pop();
    expect(apiPath).toBe('/9/schedule');
    expect(payload.scheduled_at).toBe('2027-06-25T08:00:00+01:00');
  });

  it('sends agenda session times with the event zone offset', async () => {
    await request(app).post('/501/agenda').type('form').send({
      action: 'create', idempotency_key: 'key-12345678', title: 'Welcome', timezone: 'Europe/Dublin',
      start_at: '2027-07-01T19:00', end_at: '2027-07-01T19:30', capacity: '',
    });
    const [, , , payload] = lastCall('POST', /agenda\/sessions$/);
    expect(payload.start_at).toBe('2027-07-01T19:00:00+01:00');
    expect(payload.end_at).toBe('2027-07-01T19:30:00+01:00');
  });

  it('refuses a time that does not exist instead of sending it', async () => {
    const res = await request(app).post('/501/communications/9/schedule').type('form').send({
      idempotency_key: 'key-12345678', expected_version: '3', scheduled_at: '2027-03-28T01:30',
    });
    expect(res.headers.location).toContain('status=invalid');
    expect(api.callEventBroadcastApi).not.toHaveBeenCalled();
  });
});

describe('2. "Repeat this event" follows the recurrence capabilities', () => {
  it('hides the section when the community offers no frequency', async () => {
    routeApi([[/^GET \/recurrence-capabilities$/, () => ({ data: { supported_frequencies: [], supported_end_types: [] } })]]);
    const res = await request(app).get('/new');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('name="is_recurring"');
  });

  it('offers only the frequencies and end types the community allows', async () => {
    routeApi([[/^GET \/recurrence-capabilities$/, () => ({ data: { supported_frequencies: ['weekly'], supported_end_types: ['after_count'] } })]]);
    const res = await request(app).get('/new');
    expect(res.text).toContain('name="is_recurring"');
    expect(res.text).toContain('id="freq-weekly"');
    expect(res.text).toContain('id="freq-biweekly"');
    expect(res.text).not.toContain('id="freq-daily"');
    expect(res.text).not.toContain('id="freq-monthly"');
    expect(res.text).toContain('id="rec-end-count"');
    expect(res.text).not.toContain('id="rec-end-date"');
  });

  it('explains a refused series instead of showing a Forbidden page', async () => {
    routeApi([
      [/^GET \/recurrence-capabilities$/, () => ({ data: { supported_frequencies: [], supported_end_types: [] } })],
      [/^POST \/recurring$/, () => { throw new api.ApiError('Forbidden', 403, { errors: [{ code: 'FORBIDDEN', message: 'Forbidden' }] }); }],
    ]);
    const res = await request(app).post('/new').type('form').send({
      title: 'Weekly walk', description: 'A walk', start_time: '2027-07-01T10:00', is_recurring: '1', recurrence_frequency: 'weekly', recurrence_interval: '1', recurrence_ends_type: 'after_count', recurrence_ends_after_count: '4',
    });
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_events.create.recurrence_unavailable'));
  });
});

describe('2b. weekdays, yearly and every-two-weeks without JavaScript (29 Oct parity)', () => {
  const capabilities = [/^GET \/recurrence-capabilities$/, () => ({ data: { supported_frequencies: ['daily', 'weekly', 'monthly', 'yearly'], supported_end_types: ['after_count', 'on_date'] } })];

  it('offers weekday choices and yearly when the community allows them', async () => {
    routeApi([capabilities]);
    const res = await request(app).get('/new');
    expect(res.text).toContain('id="freq-yearly"');
    expect(res.text).toContain('name="recurrence_days" type="checkbox" value="MO"');
    expect(res.text).toContain('id="freq-biweekly" name="recurrence_frequency" type="radio" value="biweekly"');
  });

  it('sends chosen weekdays, and every two weeks as weekly with interval 2, with no hidden-field help', async () => {
    let sent = null;
    routeApi([capabilities, [/^POST \/recurring$/, (body) => { sent = body; return { data: { id: 900 } }; }]]);
    await request(app).post('/new').type('form').send({
      title: 'Walk', description: 'A walk', start_time: '2027-07-01T10:00', is_recurring: '1',
      recurrence_frequency: 'biweekly', recurrence_interval: '1', recurrence_days: ['WE', 'MO', 'xx'],
      recurrence_ends_type: 'after_count', recurrence_ends_after_count: '400',
    });
    expect(sent).toEqual(expect.objectContaining({
      recurrence_frequency: 'weekly', recurrence_interval: 2, recurrence_days: 'MO,WE', recurrence_ends_after_count: 366,
    }));
  });
});

describe('3. reminders switched off in the community', () => {
  it('explains instead of rendering a Forbidden page', async () => {
    routeApi([
      [/^GET \/501$/, () => SUMMER_EVENT],
      [/^GET \/501\/reminders$/, () => { throw new api.ApiError('Forbidden', 403, { errors: [{ code: 'FORBIDDEN', message: 'Forbidden' }] }); }],
    ]);
    const res = await request(app).get('/501/reminders');
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_events.reminders.switched_off'));
  });

  // React's EventReminderPanel asks for the member's reminder preferences and
  // hides itself on that 403 (E-104); the accessible event page does the same,
  // so a going member is not offered a link that leads nowhere.
  const going = [/^GET \/501\/relationship$/, () => ({ data: { registration: { state: 'confirmed' } } })];
  const reminderHref = '/501/reminders"';

  it('hides "Manage reminders" for a going member when the community has them off', async () => {
    routeApi([
      [/^GET \/501$/, () => SUMMER_EVENT],
      going,
      [/^GET \/501\/reminders$/, () => { throw new api.ApiError('Forbidden', 403, { errors: [{ code: 'FORBIDDEN', message: 'Forbidden' }] }); }],
    ]);
    const res = await request(app).get('/501');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(t('govuk_alpha_events.reminders.manage_link'));
    expect(res.text).not.toContain(reminderHref);
  });

  it('keeps "Manage reminders" when reminders are on', async () => {
    routeApi([
      [/^GET \/501$/, () => SUMMER_EVENT],
      going,
      [/^GET \/501\/reminders$/, () => ({ data: { rules: [], overrides: {}, resolved: { reminders_enabled: true } } })],
    ]);
    const res = await request(app).get('/501');
    expect(res.text).toContain(t('govuk_alpha_events.reminders.manage_link'));
  });

  it('keeps the link when the check fails for another reason, so an outage hides nothing', async () => {
    routeApi([
      [/^GET \/501$/, () => SUMMER_EVENT],
      going,
      [/^GET \/501\/reminders$/, () => { throw new api.ApiError('down', 503, {}); }],
    ]);
    const res = await request(app).get('/501');
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_events.reminders.manage_link'));
  });

  it('does not ask about reminders for a member who is not going', async () => {
    routeApi([[/^GET \/501$/, () => SUMMER_EVENT]]);
    await request(app).get('/501');
    expect(lastCall('GET', /\/reminders$/)).toBeUndefined();
  });

  it('still explains the refusal on the reminders page itself', async () => {
    routeApi([
      [/^GET \/501\/reminders$/, () => { throw new api.ApiError('Forbidden', 403, { errors: [{ code: 'FORBIDDEN', message: 'Forbidden' }] }); }],
    ]);
    const res = await request(app).get('/501/reminders');
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_events.reminders.switched_off'));
    expect(res.text).not.toContain('id="event-reminders-form"');
  });
});

describe('4. bulk invitation sources are for community admins (F-161)', () => {
  function registrationRoutes() {
    routeApi([
      [/^GET \/501$/, () => SUMMER_EVENT],
      [/^GET \/501\/registration-product$/, () => ({ data: { registrations: [] } })],
      [/^GET \/501\/registration-product\/manage/, () => ({ data: { settings: { revision: 1, approval_mode: 'auto' }, permissions: {} } })],
    ]);
  }

  it('offers an ordinary organiser only members and groups', async () => {
    registrationRoutes();
    const res = await request(app).get('/501/registration');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<option value="member">');
    expect(res.text).toContain('<option value="group">');
    expect(res.text).not.toContain('<option value="email">');
    expect(res.text).not.toContain('<option value="audience">');
    expect(res.text).not.toContain('<option value="csv">');
  });

  it('keeps every source for a community admin', async () => {
    registrationRoutes();
    api.getProfile.mockResolvedValue({ data: { id: 1, role: 'admin', is_admin: true } });
    const res = await request(app).get('/501/registration');
    expect(res.text).toContain('<option value="email">');
    expect(res.text).toContain('<option value="audience">');
    expect(res.text).toContain('<option value="csv">');
  });

  it('does not treat a broker as a community admin', async () => {
    registrationRoutes();
    api.getProfile.mockResolvedValue({ data: { id: 3, role: 'broker', is_admin: true } });
    const res = await request(app).get('/501/registration');
    expect(res.text).not.toContain('<option value="email">');
  });
});

describe('5. the API\'s explained refusal is shown', () => {
  it('shows the registration settings refusal on the page it returns to', async () => {
    const agent = request.agent(app);
    routeApi([
      [/^GET \/501$/, () => SUMMER_EVENT],
      [/^PUT \/501\/registration-product\/settings$/, () => { throw explained(422, 'Registration must close before the event starts.', 'event_registration_closes_after_start'); }],
      [/^GET \/501\/registration-product$/, () => ({ data: { registrations: [] } })],
      [/^GET \/501\/registration-product\/manage/, () => ({ data: { settings: { revision: 1 }, permissions: {} } })],
    ]);
    const post = await agent.post('/501/registration/settings').type('form').send({
      idempotency_key: 'key-12345678', expected_revision: '1', approval_mode: 'auto', per_member_limit: '1', guest_retention_days: '30',
    });
    expect(post.headers.location).toContain('status=failed');
    const page = await agent.get('/501/registration?status=failed');
    expect(page.text).toContain('Registration must close before the event starts.');
    expect(page.text).not.toContain(t('event_registration.server_error'));
  });

  it('keeps the generic message when the API gave no reason', async () => {
    const agent = request.agent(app);
    routeApi([
      [/^GET \/501$/, () => SUMMER_EVENT],
      [/^PUT \/501\/registration-product\/settings$/, () => { throw new api.ApiError('conflict', 409, { errors: [{ code: 'EVENT_REGISTRATION_CONFLICT', message: 'Invalid input' }] }); }],
      [/^GET \/501\/registration-product$/, () => ({ data: { registrations: [] } })],
      [/^GET \/501\/registration-product\/manage/, () => ({ data: { settings: { revision: 1 }, permissions: {} } })],
    ]);
    await agent.post('/501/registration/settings').type('form').send({
      idempotency_key: 'key-12345678', expected_revision: '1', approval_mode: 'auto', per_member_limit: '1', guest_retention_days: '30',
    });
    const page = await agent.get('/501/registration?status=failed');
    expect(page.text).toContain(t('event_registration.server_error'));
  });

  it('shows an RSVP refusal message from the API, but never 5xx text', async () => {
    const agent = request.agent(app);
    routeApi([
      [/^GET \/501$/, () => SUMMER_EVENT],
      [/^POST \/501\/registration\/confirm$/, () => { throw new api.ApiError('ended', 422, { errors: [{ code: 'EVENT_ENDED', message: 'This event has already started.' }] }); }],
    ]);
    const post = await agent.post('/501/rsvp').type('form').send({ status: 'going' });
    expect(post.headers.location).toContain('status=rsvp-failed');
    const page = await agent.get('/501?status=rsvp-failed');
    expect(page.text).toContain('This event has already started.');

    routeApi([
      [/^GET \/501$/, () => SUMMER_EVENT],
      [/^POST \/501\/registration\/confirm$/, () => { throw new api.ApiError('boom', 503, { message: 'SQLSTATE[HY000] secret' }); }],
    ]);
    await agent.post('/501/rsvp').type('form').send({ status: 'going' }).catch(() => {});
    const again = await agent.get('/501?status=rsvp-failed');
    expect(again.text).not.toContain('SQLSTATE');
  });

  it('shows the communications refusal', async () => {
    const agent = request.agent(app);
    api.callEventBroadcastApi.mockRejectedValue(new api.ApiError('refused', 422, { errors: [{ code: 'EVENT_BROADCAST_VALIDATION_FAILED', message: 'Choose a time in the future.', reason: 'event_broadcast_schedule_in_past' }] }));
    routeApi([[/^GET \/501$/, () => SUMMER_EVENT], [/^GET \/501\/broadcasts/, () => ({ data: [] })]]);
    await agent.post('/501/communications/9/schedule').type('form').send({ idempotency_key: 'key-12345678', expected_version: '3', scheduled_at: '2027-06-25T08:00' });
    const page = await agent.get('/501/communications?status=failed');
    expect(page.text).toContain('Choose a time in the future.');
  });

  it('shows the signed-code check-in refusal', async () => {
    const agent = request.agent(app);
    routeApi([
      [/^GET \/501$/, () => SUMMER_EVENT],
      [/^GET \/501\/people/, () => ({ data: [], meta: {} })],
      [/^POST \/501\/attendance\/code$/, () => { throw new api.ApiError('refused', 422, { errors: [{ code: 'EVENT_CHECKIN_CODE_EXPIRED', message: 'This code has expired.', reason: 'event_checkin_code_expired' }] }); }],
    ]);
    const post = await agent.post('/501/check-in/code').type('form').send({ action: 'check_in', confirmation: '1', credential: 'nqx2_abc', idempotency_key: 'key-12345678' });
    expect(post.headers.location).toContain('status=attendance-code-failed');
    const page = await agent.get('/501/check-in?status=attendance-code-failed');
    expect(page.text).toContain('This code has expired.');
  });

  it('shows the ticket-type refusal on the re-rendered form', async () => {
    api.getEventPermissions.mockResolvedValue({ permissions: {} });
    routeApi([
      [/^GET \/501\/tickets$/, () => ({ data: { catalogue: { permissions: { manage: true }, ticket_types: [], payment_gateway: { time_credit_supported: true } } } })],
      [/^POST \/501\/ticket-types$/, () => { throw new api.ApiError('refused', 422, { errors: [{ code: 'EVENT_TICKET_VALIDATION_FAILED', message: 'Sales must close before the event starts.', reason: 'event_ticket_sales_window_invalid' }] }); }],
    ]);
    const res = await request(app).post('/501/tickets/types/new').type('form').send({
      idempotency_key: 'key-12345678', name: 'Standard', kind: 'free', allocation_limit: '10', per_member_limit: '1', sales_opens_at: '2027-06-01T09:00', sales_closes_at: '2027-06-30T17:00',
    });
    expect(lastCall('POST', /ticket-types$/)).toBeDefined();
    expect(res.status).toBe(422);
    expect(res.text).toContain('Sales must close before the event starts.');
  });
});

describe('ticket reconciliation for organisers (React "Run reconciliation", 29 Oct 2026)', () => {
  const catalogue = (reconcile) => ({ data: { catalogue: { permissions: { manage: true, reconcile }, ticket_types: [], payment_gateway: {} } } });
  const row = (extra) => ({ ticket_type_id: 1, allocation_overrun: false, inventory_mismatch: false, registration_mismatches: 0, price_snapshot_violations: 0, ...extra });

  it('reports clear records, and counts ticket types that need attention', async () => {
    routeApi([
      [/^GET \/501$/, () => SUMMER_EVENT],
      [/^GET \/501\/tickets$/, () => catalogue(true)],
      [/^GET \/501\/tickets\/reconciliation$/, () => ({ data: { ticket_types: [row({}), row({ inventory_mismatch: true }), row({ registration_mismatches: 2 })] } })],
    ]);
    const page = await request(app).get('/501/tickets?check=1');
    expect(page.status).toBe(200);
    expect(page.text).toContain('2 reconciliation warnings');

    routeApi([
      [/^GET \/501$/, () => SUMMER_EVENT],
      [/^GET \/501\/tickets$/, () => catalogue(true)],
      [/^GET \/501\/tickets\/reconciliation$/, () => ({ data: { ticket_types: [row({})] } })],
    ]);
    const clear = await request(app).get('/501/tickets?check=1');
    expect(clear.text).toContain(t('event_tickets.reconciliation_clear'));
  });

  it('offers and runs the check only for organisers allowed to reconcile', async () => {
    routeApi([
      [/^GET \/501$/, () => SUMMER_EVENT],
      [/^GET \/501\/tickets$/, () => catalogue(false)],
    ]);
    const page = await request(app).get('/501/tickets?check=1');
    expect(page.text).not.toContain(t('event_tickets.reconcile'));
    expect(lastCall('GET', /reconciliation$/)).toBeUndefined();
  });
});

describe('6. a pending RSVP is recognised', () => {
  it('says the request is waiting for the organiser', async () => {
    routeApi([
      [/^GET \/501$/, () => SUMMER_EVENT],
      [/^GET \/501\/relationship$/, () => ({ data: { registration: { state: 'pending' }, actions: { withdraw: true } } })],
    ]);
    const res = await request(app).get('/501');
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_events.rsvp.pending'));
  });
});

describe('7. required registration answers before check-in', () => {
  const person = {
    member: { id: 77, display_name: 'Aoife' },
    registration: { state: 'confirmed', version: 1, required_answers_outstanding: true },
    attendance: { state: 'not_checked_in', version: 0 },
    management_actions: {},
  };

  it('asks the roster for the flag and shows it on check-in and people', async () => {
    routeApi([[/^GET \/501$/, () => SUMMER_EVENT], [/^GET \/501\/people/, () => ({ data: [person], meta: { total: 1, total_pages: 1, capabilities: {} } })]]);
    const checkIn = await request(app).get('/501/check-in');
    expect(lastCall('GET', /\/people\?/)[2]).toContain('include=required_answers');
    expect(checkIn.text).toContain(t('govuk_alpha_events.check_in.answers_outstanding_tag'));
    expect(checkIn.text).toContain(t('govuk_alpha_events.check_in.answers_outstanding'));
    const people = await request(app).get('/501/people');
    expect(lastCall('GET', /\/people\?/)[2]).toContain('include=required_answers');
    expect(people.text).toContain(t('govuk_alpha_events.check_in.answers_outstanding_tag'));
  });

  it('maps the signed-code refusal to its own status', async () => {
    routeApi([[/^POST \/501\/attendance\/code$/, () => { throw new api.ApiError('refused', 409, { errors: [{ code: 'EVENT_ATTENDANCE_REQUIRED_ANSWERS_OUTSTANDING', message: 'Answers outstanding' }] }); }]]);
    const res = await request(app).post('/501/check-in/code').type('form').send({ action: 'check_in', confirmation: '1', credential: 'nqx2_abc', idempotency_key: 'key-12345678' });
    expect(res.headers.location).toContain('status=attendance-answers-outstanding');
    routeApi([[/^GET \/501$/, () => SUMMER_EVENT], [/^GET \/501\/people/, () => ({ data: [], meta: {} })]]);
    const page = await request(app).get('/501/check-in?status=attendance-answers-outstanding');
    expect(page.text).toContain(t('govuk_alpha_events.check_in.answers_outstanding'));
  });
});

describe('8. the organiser\'s own unpublished events are tagged', () => {
  it('tags draft and pending-review events in the list', async () => {
    api.getEvents.mockResolvedValue({ data: [
      { id: 1, title: 'Draft one', publication_state: 'draft', start_time: '2027-07-01T10:00:00Z' },
      { id: 2, title: 'Review one', schedule: { publication_state: 'pending_review' }, start_time: '2027-07-01T10:00:00Z' },
      { id: 3, title: 'Live one', publication_state: 'published', start_time: '2027-07-01T10:00:00Z' },
    ], meta: {} });
    const res = await request(app).get('/?scope=mine');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Draft one');
    expect(res.text).toContain(t('govuk_alpha_events.listing.draft_tag'));
    expect(res.text).toContain(t('govuk_alpha_events.listing.pending_review_tag'));
    // One tag each: the published event carries none.
    expect(res.text.split(t('govuk_alpha_events.listing.draft_tag')).length - 1).toBe(1);
    expect(res.text.split(t('govuk_alpha_events.listing.pending_review_tag')).length - 1).toBe(1);
  });
});

describe('9. registration answers can be changed after they are sent (React amend flow)', () => {
  // The server refuses a new draft once answers are submitted
  // (EventRegistrationSubmissionService::saveDraft -> revision_conflict) and also
  // refuses to save over a draft without its revision. React amends first
  // (POST …/submissions/{id}/amend), then saves into the new draft and submits.
  const form = { id: 3, name: 'Your details', questions: [{ stable_key: 'diet', question_type: 'short_text', prompt: 'Dietary needs', is_required: false }] };
  const registration = { id: 7, registration_state: 'confirmed' };
  function attendeeWith(submissions) {
    return [/^GET \/501\/registration-product$/, () => ({ data: { registrations: [registration], form, submissions } })];
  }
  const post = (body = {}) => request(app).post('/501/registration/registrations/7/forms/3/submit').type('form')
    .send({ idempotency_key: 'answers-key-123456', 'answers[diet]': 'Vegetarian', ...body });

  it('amends sent answers, saves into the new draft, and submits it', async () => {
    routeApi([
      attendeeWith([{ id: 40, registration_id: 7, form_version_id: 3, effective_slot: 1, status: 'submitted', revision: 2 }]),
      [/^POST \/501\/registration-product\/submissions\/40\/amend$/, () => ({ data: { submission: { id: 41, status: 'draft', revision: 1 } } })],
      [/^POST \/501\/registration-product\/submissions$/, () => ({ data: { submission: { id: 41, status: 'draft', revision: 2 } } })],
      [/^POST \/501\/registration-product\/submissions\/41\/submit$/, () => ({ data: { submission: { id: 41, status: 'submitted', revision: 3 } } })],
    ]);
    const res = await post();
    expect(res.headers.location).toContain('status=answers-submitted');
    expect(lastCall('POST', /\/40\/amend$/)[3]).toEqual(expect.objectContaining({ expected_revision: 2 }));
    expect(lastCall('POST', /\/submissions$/)[3]).toEqual(expect.objectContaining({ expected_revision: 1 }));
    expect(lastCall('POST', /\/41\/submit$/)[3]).toEqual(expect.objectContaining({ expected_revision: 2 }));
  });

  it('saves over an unsent draft with that draft\'s revision, without amending', async () => {
    routeApi([
      attendeeWith([{ id: 40, registration_id: 7, form_version_id: 3, effective_slot: 1, status: 'draft', revision: 3 }]),
      [/^POST \/501\/registration-product\/submissions$/, () => ({ data: { submission: { id: 40, status: 'draft', revision: 4 } } })],
    ]);
    const res = await post();
    expect(res.headers.location).toContain('status=answers-submitted');
    expect(lastCall('POST', /\/amend$/)).toBeUndefined();
    expect(lastCall('POST', /\/submissions$/)[3]).toEqual(expect.objectContaining({ expected_revision: 3 }));
  });

  it('starts fresh when there are no answers yet', async () => {
    routeApi([
      attendeeWith([]),
      [/^POST \/501\/registration-product\/submissions$/, () => ({ data: { submission: { id: 40, status: 'draft', revision: 1 } } })],
    ]);
    await post();
    expect(lastCall('POST', /\/submissions$/)[3]).toEqual(expect.objectContaining({ expected_revision: null }));
  });

  it('tells the member their answers are already sent and that sending again replaces them', async () => {
    routeApi([
      [/^GET \/501$/, () => SUMMER_EVENT],
      attendeeWith([{ id: 40, registration_id: 7, form_version_id: 3, effective_slot: 1, status: 'submitted', revision: 2 }]),
    ]);
    const res = await request(app).get('/501/registration');
    expect(res.status).toBe(200);
    const escaped = t('govuk_alpha_events.registration.answers_already_sent').replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    expect(escaped).not.toContain('govuk_alpha_events.registration');
    expect(res.text).toContain(escaped);
  });
});

describe('events by month (29 Oct parity)', () => {
  it('asks for the month by from/to and lists events under their day', async () => {
    let asked = '';
    routeApi([[/^GET \/calendar\?/, () => ({ data: [
      { id: 71, title: 'Repair cafe', starts_at: '2027-03-06T11:00:00+00:00', timezone: 'Europe/Dublin', all_day: false, operational_status: 'scheduled' },
      { id: 72, title: 'Seed swap', starts_at: '2027-03-20', timezone: 'Europe/Dublin', all_day: true, operational_status: 'cancelled' }
    ] })]]);
    api.callEventApi.mockImplementationOnce(async (token, method, apiPath) => {
      asked = apiPath;
      return { data: [
        { id: 71, title: 'Repair cafe', starts_at: '2027-03-06T11:00:00+00:00', timezone: 'Europe/Dublin', all_day: false, operational_status: 'scheduled' },
        { id: 72, title: 'Seed swap', starts_at: '2027-03-20', timezone: 'Europe/Dublin', all_day: true, operational_status: 'cancelled' }
      ] };
    });
    const res = await request(app).get('/month?month=2027-03');
    expect(res.status).toBe(200);
    expect(asked).toBe('/calendar?from=2027-03-01&to=2027-04-01');
    expect(res.text).toContain('href="/events/71"');
    // Two days, one heading each (the harness stubs the date formatter).
    expect((res.text.match(/<h2 class="govuk-heading-m govuk-!-margin-top-6">/g) || []).length).toBe(2);
    expect(res.text).toContain('href="/events/72"');
    expect(res.text).toContain('href="/events/month?month=2027-02"');
    expect(res.text).toContain('href="/events/month?month=2027-04"');
    expect(res.text).toContain(t('govuk_alpha.events.month_cancelled'));
  });
});
