// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * "List as a public event" (owner decision 2026-10-15).
 *
 * When a community has the `public_events` feature on, an event appears on the
 * signed-out public events pages ONLY if its organiser ticked "List as a public
 * event". Default is off. The API ignores `is_public_listing` unless the feature
 * is on, but the accessible frontend must not offer a choice that does nothing,
 * so the checkbox is rendered — and the key sent — only when the tenant has both
 * `events` and `public_events` on (the What's On gate).
 *
 * Pinned here, for the create, edit and recurring-edit forms:
 *   - feature off: no checkbox, and no `is_public_listing` key reaches the API,
 *     even if a crafted POST carries one;
 *   - feature on: checkbox present and unticked by default; ticked sends true;
 *     unticked sends false (the hidden "0" keeps un-ticking from being dropped);
 *   - edit is prefilled from the event's `is_public_listing`;
 *   - a validation error keeps what the organiser ticked;
 *   - the series-wide revision patch carries the change only when the feature is on.
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
    createEvent: jest.fn(),
    updateEvent: jest.fn(),
    callEventApi: jest.fn(),
    getEventCategories: jest.fn().mockResolvedValue({ data: [] }),
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
const LABEL = t('govuk_alpha.events.polish_events.public_listing_label');

function mount(features) {
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
  app.use(session({ secret: 'public-listing-choice-test-secret-at-least-32', resave: false, saveUninitialized: false }));
  app.use('/', (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.csrfToken = () => 'csrf';
    req.accessibleRouting = {
      mode: 'shared',
      tenantSlug: 'test',
      prefix: '/test/accessible',
      tenant: { id: 2, slug: 'test', features }
    };
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

const featureOn = mount({ events: true, public_events: true });
const featureOff = mount({ events: true, public_events: false });
const eventsOff = mount({ events: false, public_events: true });

const baseForm = {
  title: 'Repair cafe',
  description: 'Bring something broken',
  start_time: '2026-11-01T10:00',
};

function checkboxTag(html) {
  const match = html.match(/<input[^>]*id="is_public_listing"[^>]*>/);
  return match ? match[0] : null;
}

const existingEvent = (overrides = {}) => ({
  id: 42,
  title: 'Repair cafe',
  description: 'Bring something broken',
  start_time: '2026-11-01T10:00:00',
  timezone: 'UTC',
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  api.getEventCategories.mockResolvedValue({ data: [] });
});

describe('create form', () => {
  it('has no public-listing checkbox and sends no key when public_events is off', async () => {
    const page = await request(featureOff).get('/new');
    expect(page.status).toBe(200);
    expect(page.text).not.toContain('name="is_public_listing"');
    expect(page.text).not.toContain(LABEL);

    api.createEvent.mockResolvedValueOnce({ data: { id: 77 } });
    // A crafted POST carrying the field must still not forward it.
    const res = await request(featureOff).post('/new').type('form').send({ ...baseForm, is_public_listing: '1' });
    expect(res.status).toBe(302);
    expect(api.createEvent).toHaveBeenCalledTimes(1);
    expect(api.createEvent.mock.calls[0][1]).not.toHaveProperty('is_public_listing');
  });

  it('has no checkbox when the events feature itself is off, even with public_events on', async () => {
    const page = await request(eventsOff).get('/new');
    expect(page.text).not.toContain('name="is_public_listing"');
  });

  it('shows the checkbox unticked by default when public_events is on', async () => {
    const page = await request(featureOn).get('/new');
    expect(page.status).toBe(200);
    expect(page.text).toContain(LABEL);
    // The hint contains apostrophes, which autoescape renders as entities.
    expect(page.text).toContain('Leave this unticked to keep it for members only.');
    const tag = checkboxTag(page.text);
    expect(tag).not.toBeNull();
    expect(tag).not.toMatch(/\schecked/);
  });

  it('sends is_public_listing true when ticked and false when left unticked', async () => {
    api.createEvent.mockResolvedValue({ data: { id: 77 } });

    await request(featureOn).post('/new').type('form').send({ ...baseForm, is_public_listing: ['0', '1'] });
    expect(api.createEvent.mock.calls[0][1]).toEqual(expect.objectContaining({ is_public_listing: true }));

    await request(featureOn).post('/new').type('form').send({ ...baseForm, is_public_listing: '0' });
    expect(api.createEvent.mock.calls[1][1]).toEqual(expect.objectContaining({ is_public_listing: false }));
  });

  it('keeps the tick when the form comes back with a validation error', async () => {
    const res = await request(featureOn).post('/new').type('form').send({ ...baseForm, title: '', is_public_listing: ['0', '1'] });
    expect(res.status).toBe(200);
    expect(api.createEvent).not.toHaveBeenCalled();
    expect(checkboxTag(res.text)).toMatch(/\schecked/);
  });

  it('sends the choice on a recurring create too', async () => {
    api.callEventApi.mockResolvedValueOnce({ data: { id: 78 } });
    await request(featureOn).post('/new').type('form').send({
      ...baseForm,
      is_public_listing: ['0', '1'],
      is_recurring: '1',
      recurrence_frequency: 'weekly',
      recurrence_interval: '1',
      recurrence_ends_type: 'after_count',
      recurrence_ends_after_count: '4',
    });
    const call = api.callEventApi.mock.calls.find(([, method, url]) => method === 'POST' && url === '/recurring');
    expect(call).toBeDefined();
    expect(call[3]).toEqual(expect.objectContaining({ is_public_listing: true }));
  });
});

describe('edit form', () => {
  it('has no checkbox and sends no key when public_events is off', async () => {
    api.getEvent.mockResolvedValueOnce({ data: existingEvent({ is_public_listing: true }) });
    const page = await request(featureOff).get('/42/edit');
    expect(page.status).toBe(200);
    expect(page.text).not.toContain('name="is_public_listing"');

    api.updateEvent.mockResolvedValueOnce({ data: {} });
    await request(featureOff).post('/42/edit').type('form').send({ ...baseForm, is_public_listing: '1' });
    expect(api.updateEvent).toHaveBeenCalledTimes(1);
    expect(api.updateEvent.mock.calls[0][2]).not.toHaveProperty('is_public_listing');
  });

  it("is prefilled from the event's is_public_listing", async () => {
    api.getEvent.mockResolvedValueOnce({ data: existingEvent({ is_public_listing: true }) });
    const listed = await request(featureOn).get('/42/edit');
    expect(checkboxTag(listed.text)).toMatch(/\schecked/);

    api.getEvent.mockResolvedValueOnce({ data: existingEvent({ is_public_listing: false }) });
    const notListed = await request(featureOn).get('/42/edit');
    const tag = checkboxTag(notListed.text);
    expect(tag).not.toBeNull();
    expect(tag).not.toMatch(/\schecked/);
  });

  it('sends false when the organiser un-ticks it, and keeps the tick across an error', async () => {
    api.updateEvent.mockResolvedValueOnce({ data: {} });
    await request(featureOn).post('/42/edit').type('form').send({ ...baseForm, is_public_listing: '0' });
    expect(api.updateEvent.mock.calls[0][2]).toEqual(expect.objectContaining({ is_public_listing: false }));

    const res = await request(featureOn).post('/42/edit').type('form').send({ ...baseForm, description: '', is_public_listing: ['0', '1'] });
    expect(res.status).toBe(200);
    expect(checkboxTag(res.text)).toMatch(/\schecked/);
  });
});

describe('recurring edit form', () => {
  const seriesEvent = (overrides = {}) => existingEvent({
    can_edit: true,
    is_series: true,
    parent_event_id: 1,
    start_time: '2026-11-01T10:00:00Z',
    end_time: null,
    all_day: false,
    is_online: false,
    allow_remote_attendance: false,
    ...overrides,
  });

  it('renders the checkbox only when public_events is on, prefilled from the event', async () => {
    api.callEventApi
      .mockResolvedValueOnce({ data: seriesEvent({ is_public_listing: true }) })
      .mockResolvedValueOnce({ data: { supports_effective_revisions: true } });
    const on = await request(featureOn).get('/42/recurring-edit');
    expect(on.status).toBe(200);
    expect(checkboxTag(on.text)).toMatch(/\schecked/);

    api.callEventApi
      .mockResolvedValueOnce({ data: seriesEvent({ is_public_listing: true }) })
      .mockResolvedValueOnce({ data: { supports_effective_revisions: true } });
    const off = await request(featureOff).get('/42/recurring-edit');
    expect(off.status).toBe(200);
    expect(off.text).not.toContain('name="is_public_listing"');
  });

  it('puts is_public_listing in the series revision patch only when the feature is on', async () => {
    const form = { ...baseForm, scope: 'all', timezone: 'UTC', all_day: '0', is_public_listing: ['0', '1'] };

    api.callEventApi
      .mockResolvedValueOnce({ data: seriesEvent({ is_public_listing: false }) })
      .mockResolvedValueOnce({ data: { supports_effective_revisions: true } })
      .mockResolvedValueOnce({ data: { preview_token: 'p', can_commit: true, impact: { affected_count: 3 } } });
    const on = await request(featureOn).post('/42/recurring-edit').type('form').send(form);
    expect(on.status).toBe(200);
    expect(api.callEventApi).toHaveBeenLastCalledWith('token:test', 'POST', '/42/recurrence-revisions/preview', {
      patch: { is_public_listing: true }
    });

    api.callEventApi.mockClear();
    api.callEventApi
      .mockResolvedValueOnce({ data: seriesEvent({ is_public_listing: false }) })
      .mockResolvedValueOnce({ data: { supports_effective_revisions: true } });
    const off = await request(featureOff).post('/42/recurring-edit').type('form').send(form);
    // Nothing else changed, so with the feature off there is nothing to patch.
    expect(off.status).toBe(302);
    expect(off.headers.location).toContain('status=no-changes');
    expect(api.callEventApi.mock.calls.some(([, , url]) => String(url).includes('recurrence-revisions'))).toBe(false);
  });

  it('accepts is_public_listing in a committed revision patch', async () => {
    api.callEventApi.mockResolvedValueOnce({ data: { revision_version: 2 } });
    const res = await request(featureOn).post('/42/recurring-edit/commit').type('form').send({
      preview_token: 'p',
      patch_json: JSON.stringify({ is_public_listing: true }),
      idempotency_key: 'public-listing-commit-1',
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('status=event-updated');
  });

  it('sends the choice on a single-occurrence recurring save only when the feature is on', async () => {
    api.callEventApi.mockResolvedValueOnce({ data: {} });
    await request(featureOn).post('/42/recurring-edit').type('form').send({ ...baseForm, scope: 'single', is_public_listing: '0' });
    const onCall = api.callEventApi.mock.calls.find(([, method, url]) => method === 'PUT' && url === '/42/recurring');
    expect(onCall[3]).toEqual(expect.objectContaining({ is_public_listing: false, scope: 'single' }));

    api.callEventApi.mockClear();
    api.callEventApi.mockResolvedValueOnce({ data: {} });
    await request(featureOff).post('/42/recurring-edit').type('form').send({ ...baseForm, scope: 'single', is_public_listing: '1' });
    const offCall = api.callEventApi.mock.calls.find(([, method, url]) => method === 'PUT' && url === '/42/recurring');
    expect(offCall[3]).not.toHaveProperty('is_public_listing');
  });
});

// 29 Oct deep audit H1: Laravel sends UTC instants and reads an offset-less save in
// the event's own zone, so the edit form must show the event-zone wall clock.
describe('single-event edit shows times in the event zone', () => {
  it('shows a summer Dublin event at its local time, not UTC', async () => {
    api.getEvent.mockResolvedValueOnce({ data: existingEvent({
      start_time: '2027-07-01T13:00:00.000000Z', end_time: '2027-07-01T15:00:00.000000Z', timezone: 'Europe/Dublin'
    }) });
    const page = await request(featureOn).get('/42/edit');
    expect(page.status).toBe(200);
    expect(page.text).toMatch(/name="start_time-time"[^>]*value="14:00"|value="14:00"[^>]*name="start_time-time"/);
    expect(page.text).toMatch(/name="end_time-time"[^>]*value="16:00"|value="16:00"[^>]*name="end_time-time"/);
  });
});
