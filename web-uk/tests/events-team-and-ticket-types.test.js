// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Two organiser tools React has (EventStaffWorkspace, EventTicketsPanel) that
 * this frontend lacked (CAPABILITY_PARITY_FINDINGS Tier 2).
 *
 * Event team: list, search, assign a delegated role (with an optional end date
 * converted from the event's own time zone), and remove it after a confirmation
 * page. Only for someone the API says may manage staff.
 *
 * Ticket types (free or time credits only — no card money): create, change,
 * make available, pause and archive, each write carrying an idempotency key and
 * the version it was based on. Dates are sent as UTC instants of the wall-clock
 * time typed in the event's zone, because the API refuses a mismatched offset.
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
  return {
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    callEventApi: jest.fn(),
    getEvent: jest.fn(),
    getEventPermissions: jest.fn(),
    getUsers: jest.fn()
  };
});

const api = require('../src/lib/api');
const routes = require('../src/routes/event-organiser-tools');

const t = createTranslator('en');

const app = (() => {
  const server = express();
  const environment = nunjucks.configure(
    [path.join(__dirname, '..', 'src', 'views'), path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
    { autoescape: true, noCache: true, express: server }
  );
  require('../src/lib/template-filters').registerTemplateFilters(environment);
  server.set('view engine', 'njk');
  server.use(express.urlencoded({ extended: true }));
  server.use(session({ secret: 'event-team-tickets-test-secret-at-least-32', resave: false, saveUninitialized: false }));
  server.use('/', (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.csrfToken = () => 'csrf';
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'test', prefix: '', tenant: { id: 2, slug: 'test', features: { events: true } } };
    res.locals.urlFor = (v) => String(v || '/');
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS', tenantName: 'Test', isAuthenticated: true, csrfToken: 'csrf',
      t, tc: createChoiceTranslator('en'), htmlLang: 'en', htmlDirection: 'ltr'
    });
    next();
  }, routes);
  return server;
})();

const EVENT = { data: { id: 42, title: 'Repair cafe', timezone: 'Europe/Dublin' } };

beforeEach(() => {
  jest.clearAllMocks();
  api.getEvent.mockResolvedValue(EVENT);
  api.getEventPermissions.mockResolvedValue({ permissions: { manage_staff: true } });
});

describe('event team', () => {
  const assignment = (overrides = {}) => ({
    id: 7, member: { id: 9, name: 'Sam' }, role: 'check_in_staff', status: 'active', expires_at: null, ...overrides
  });

  it('refuses someone the API says may not manage staff', async () => {
    api.getEventPermissions.mockResolvedValue({ permissions: { manage_staff: false } });
    const page = await request(app).get('/42/staff');
    expect(page.status).toBe(403);
    expect(api.callEventApi).not.toHaveBeenCalled();
  });

  it('lists current and past roles and searches members to add', async () => {
    api.callEventApi.mockResolvedValue({ data: [assignment(), assignment({ id: 8, member: { id: 10, name: 'Ali' }, status: 'revoked' })] });
    api.getUsers.mockResolvedValue({ data: [{ id: 11, name: 'Jo Bloggs' }] });
    const page = await request(app).get('/42/staff?q=jo');
    expect(page.status).toBe(200);
    expect(api.callEventApi).toHaveBeenCalledWith('token:test', 'GET', '/42/staff?include_inactive=true');
    expect(api.getUsers).toHaveBeenCalledWith('token:test', { q: 'jo', limit: 10 });
    expect(page.text).toContain(t('govuk_alpha_events.staff.roles.check_in_staff'));
    expect(page.text).toContain('href="/events/42/staff/7/revoke"');
    expect(page.text).toContain(t('govuk_alpha_events.staff.state_revoked'));
    expect(page.text).toContain('value="11"');
    expect(page.text).toContain('name="role"');
  });

  it('assigns a role with an end date converted from the event time zone', async () => {
    api.callEventApi.mockResolvedValue({ data: { assignment: {} } });
    const response = await request(app).post('/42/staff').type('form').send({
      user_id: '11', role: 'check_in_staff', idempotency_key: 'key-12345678',
      'expires_at-day': '1', 'expires_at-month': '7', 'expires_at-year': '2099', 'expires_at-time': '10:00'
    });
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/events/42/staff?status=assigned');
    // 10:00 Irish Summer Time is 09:00 UTC.
    expect(api.callEventApi).toHaveBeenCalledWith('token:test', 'POST', '/42/staff',
      { user_id: 11, role: 'check_in_staff', expires_at: '2099-07-01T09:00:00Z' },
      { headers: { 'Idempotency-Key': 'key-12345678' } });
  });

  it('refuses an unknown role without calling the API', async () => {
    const response = await request(app).post('/42/staff').type('form').send({ user_id: '11', role: 'owner', idempotency_key: 'key-12345678' });
    expect(response.headers.location).toBe('/events/42/staff?status=invalid');
    expect(api.callEventApi).not.toHaveBeenCalled();
  });

  it('confirms before removing a role, then removes it', async () => {
    api.callEventApi.mockResolvedValueOnce({ data: [assignment()] });
    const page = await request(app).get('/42/staff/7/revoke');
    expect(page.status).toBe(200);
    expect(page.text).toContain(t('govuk_alpha_events.staff.revoke_title'));
    expect(page.text).toContain('Sam');

    api.callEventApi.mockResolvedValueOnce({ data: {} });
    const response = await request(app).post('/42/staff/7/revoke').type('form').send({ idempotency_key: 'key-abcdefgh' });
    expect(response.headers.location).toBe('/events/42/staff?status=revoked');
    expect(api.callEventApi).toHaveBeenLastCalledWith('token:test', 'DELETE', '/42/staff/7',
      { idempotency_key: 'key-abcdefgh' }, { headers: { 'Idempotency-Key': 'key-abcdefgh' } });
  });
});

describe('ticket types', () => {
  const catalogue = (types, manage = true) => ({
    data: { catalogue: { ticket_types: types, permissions: { manage }, payment_gateway: { time_credit_supported: false } } }
  });
  const draft = {
    id: 3, version: 2, name: 'General', kind: 'free', unit_price_credits: '0.00', allocation_limit: 50, per_member_limit: 2,
    sales_opens_at: '2099-06-01T08:00:00Z', sales_closes_at: '2099-06-30T08:00:00Z', status: 'draft',
    availability: { allocation_remaining: 50 }, eligibility_policy: { approved_member_required: true, minimum_account_age_days: 0, required_group_ids: [] }
  };
  const form = {
    name: 'Volunteer ticket', kind: 'time_credit', price: '1.5', allocation_limit: '20', per_member_limit: '1',
    'sales_opens_at-day': '1', 'sales_opens_at-month': '6', 'sales_opens_at-year': '2099', 'sales_opens_at-time': '09:00',
    'sales_closes_at-day': '30', 'sales_closes_at-month': '6', 'sales_closes_at-year': '2099', 'sales_closes_at-time': '18:00',
    approved_member_required: '1', minimum_account_age_days: '0', required_group_ids: '', idempotency_key: 'key-tickets-1'
  };

  it('is only for organisers the ticket API lets manage', async () => {
    api.callEventApi.mockResolvedValue(catalogue([draft], false));
    const page = await request(app).get('/42/tickets/manage');
    expect(page.status).toBe(403);
  });

  it('lists ticket types with the actions their state allows', async () => {
    api.callEventApi.mockResolvedValue(catalogue([draft, { ...draft, id: 4, name: 'VIP', status: 'active' }]));
    const page = await request(app).get('/42/tickets/manage');
    expect(page.status).toBe(200);
    expect(page.text).toContain('href="/events/42/tickets/types/3/edit"');
    expect(page.text).toContain('href="/events/42/tickets/types/3/activate"');
    expect(page.text).toContain('href="/events/42/tickets/types/4/pause"');
    expect(page.text).not.toContain('href="/events/42/tickets/types/4/edit"');
    expect(page.text).toContain(t('govuk_alpha_events.ticket_types.time_credit_unavailable'));
  });

  it('creates a time-credit ticket type with UTC sales times', async () => {
    api.callEventApi.mockResolvedValueOnce(catalogue([])).mockResolvedValueOnce({ data: { ticket_type: {} } });
    const response = await request(app).post('/42/tickets/types/new').type('form').send(form);
    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/events/42/tickets/manage?status=created');
    expect(api.callEventApi).toHaveBeenLastCalledWith('token:test', 'POST', '/42/ticket-types', {
      name: 'Volunteer ticket', description: null, kind: 'time_credit', unit_price_credits: '1.50',
      allocation_limit: 20, per_member_limit: 1,
      sales_opens_at_utc: '2099-06-01T08:00:00Z', sales_closes_at_utc: '2099-06-30T17:00:00Z',
      refund_cutoff_at_utc: null, organizer_cancel_refundable: false,
      eligibility_policy: { approved_member_required: true, minimum_account_age_days: 0, required_group_ids: [] }
    }, { headers: { 'Idempotency-Key': 'key-tickets-1' } });
  });

  it('shows GOV.UK errors and keeps what was typed when the form is wrong', async () => {
    api.callEventApi.mockResolvedValueOnce(catalogue([]));
    const response = await request(app).post('/42/tickets/types/new').type('form')
      .send({ ...form, name: '', price: '0', 'sales_closes_at-day': '31', 'sales_closes_at-month': '2' });
    expect(response.status).toBe(422);
    expect(response.text).toContain(t('govuk_alpha_events.ticket_types.errors.name_required'));
    expect(response.text).toContain(t('govuk_alpha_events.ticket_types.errors.price_invalid'));
    expect(response.text).toContain(t('govuk_alpha_events.ticket_types.errors.sales_close_invalid'));
    expect(response.text).toContain('value="20"');
    expect(api.callEventApi).toHaveBeenCalledTimes(1);
  });

  it('prefills the edit form in the event time zone and sends the expected version', async () => {
    api.callEventApi.mockResolvedValue(catalogue([draft]));
    const page = await request(app).get('/42/tickets/types/3/edit');
    expect(page.status).toBe(200);
    expect(page.text).toContain('value="General"');
    expect(page.text).toContain('value="09:00"'); // 08:00 UTC is 09:00 in Dublin in June

    api.callEventApi.mockResolvedValueOnce(catalogue([draft])).mockResolvedValueOnce({ data: {} });
    const response = await request(app).post('/42/tickets/types/3/edit').type('form')
      .send({ ...form, kind: 'free', price: '', expected_version: '2' });
    expect(response.headers.location).toBe('/events/42/tickets/manage?status=updated');
    const [, method, apiPath, payload] = api.callEventApi.mock.calls[api.callEventApi.mock.calls.length - 1];
    expect(method).toBe('PUT');
    expect(apiPath).toBe('/42/ticket-types/3');
    expect(payload).toEqual(expect.objectContaining({ expected_version: 2, kind: 'free', unit_price_credits: '0.00' }));
  });

  it('archives only with a reason, after a confirmation page', async () => {
    api.callEventApi.mockResolvedValue(catalogue([draft]));
    const page = await request(app).get('/42/tickets/types/3/archive');
    expect(page.status).toBe(200);
    expect(page.text).toContain('name="reason"');
    expect(page.text).toContain('name="expected_version" value="2"');

    const noReason = await request(app).post('/42/tickets/types/3/archive').type('form')
      .send({ idempotency_key: 'key-archive-1', expected_version: '2', reason: '' });
    expect(noReason.headers.location).toBe('/events/42/tickets/types/3/archive?status=reason-required');

    api.callEventApi.mockClear();
    api.callEventApi.mockResolvedValueOnce({ data: {} });
    const done = await request(app).post('/42/tickets/types/3/archive').type('form')
      .send({ idempotency_key: 'key-archive-1', expected_version: '2', reason: 'Duplicate' });
    expect(done.headers.location).toBe('/events/42/tickets/manage?status=archived');
    expect(api.callEventApi).toHaveBeenCalledWith('token:test', 'POST', '/42/ticket-types/3/archive',
      { expected_version: 2, reason: 'Duplicate' }, { headers: { 'Idempotency-Key': 'key-archive-1' } });
  });

  it('does not offer to make a time-credit ticket available while the community cannot take time credits', async () => {
    api.callEventApi.mockResolvedValue(catalogue([{ ...draft, kind: 'time_credit', unit_price_credits: '2.00' }]));
    const page = await request(app).get('/42/tickets/types/3/activate');
    expect(page.status).toBe(200);
    expect(page.text).toContain(t('govuk_alpha_events.ticket_types.time_credit_unavailable'));
    expect(page.text).not.toContain('action="/events/42/tickets/types/3/activate"');
  });
});

describe('wall-clock conversion', () => {
  const { wallClockToUtc } = routes._test;
  it('handles summer, winter and a clock-change gap', () => {
    expect(wallClockToUtc('2099-07-01T10:00', 'Europe/Dublin')).toBe('2099-07-01T09:00:00Z');
    expect(wallClockToUtc('2099-01-01T10:00', 'Europe/Dublin')).toBe('2099-01-01T10:00:00Z');
    expect(wallClockToUtc('2099-01-01T10:00', 'America/New_York')).toBe('2099-01-01T15:00:00Z');
    expect(wallClockToUtc('2026-03-29T01:30', 'Europe/London')).toBeNull();
  });
});
