// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Server-side number checks that replace the browser's (28 Oct 2026).
 *
 * Number boxes became text boxes with `inputmode` (GOV.UK "ask users for numbers") and
 * every form gained `novalidate`, so the browser no longer refuses "abc" or 150. These
 * routes used to turn such input into a default (0, 1, 25, "no limit") or clamp it
 * (150 to 100) without telling the member. Each must now refuse it, show its existing
 * error status, and send nothing to the API. Valid input must still go through.
 */

const express = require('express');
const request = require('supertest');
const { createVolunteeringApp } = require('./support/volunteering-route-app');

const mockCalls = [];

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }
  const target = { ApiError, ApiOfflineError: class ApiOfflineError extends Error {} };
  return new Proxy(target, {
    get: (object, prop) => {
      if (prop in object) return object[prop];
      if (typeof prop !== 'string') return undefined;
      return (...args) => {
        mockCalls.push({ name: prop, args });
        return Promise.resolve({ data: {} });
      };
    }
  });
});

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() })
}));

function appFor(modulePath, mount, { token = false } = {}) {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const router = require(modulePath);
  const app = createVolunteeringApp(router, { mount: `/acme/accessible${mount}` });
  if (!token) return app;
  // Routes behind requireAuth read req.token; wrap so it is present.
  const wrapper = express();
  wrapper.use((req, res, next) => { req.token = 'test-token'; next(); });
  wrapper.use(app);
  return wrapper;
}

const location = (res) => String(res.headers.location || '');
const post = (app, path, body) => request(app).post(`/acme/accessible${path}`).type('form').send(body);

beforeEach(() => { mockCalls.length = 0; });

describe('course grading score', () => {
  const app = () => appFor('../src/routes/courses', '/courses');
  it.each(['abc', '150', '-5', '10x'])('refuses a score of %p and does not grade', async (score) => {
    const res = await post(app(), '/courses/instructor/4/grading/9', { score_percent: score, passed: '1' });
    expect(res.status).toBe(302);
    expect(location(res)).toContain('status=grade-failed');
    expect(mockCalls.length).toBe(0);
  });
  it('still grades a valid score', async () => {
    const res = await post(app(), '/courses/instructor/4/grading/9', { score_percent: '85', passed: '1' });
    expect(location(res)).not.toContain('grade-failed');
    expect(mockCalls.length).toBeGreaterThan(0);
  });
});

describe('goal check-in percentage', () => {
  const app = () => appFor('../src/routes/goals', '/goals');
  it.each(['abc', '101', '-1'])('refuses %p and records nothing', async (value) => {
    const res = await post(app(), '/goals/7/checkin', { progress_percent: value });
    expect(res.status).toBe(302);
    expect(location(res)).toContain('checkin-failed');
    expect(mockCalls.length).toBe(0);
  });
});

describe('group invite link expiry', () => {
  const app = () => appFor('../src/routes/groups', '/groups', { token: true });
  it.each(['abc', '91', '0', '-3'])('refuses %p instead of making a link that never expires', async (value) => {
    const res = await post(app(), '/groups/5/invite/link', { expiry_days: value });
    expect(res.status).toBe(302);
    expect(location(res)).toContain('invite-link-failed');
    expect(mockCalls.length).toBe(0);
  });
});

describe('group exchange: adding a person', () => {
  const app = () => appFor('../src/routes/group-exchange-actions', '/group-exchanges');
  it.each([
    ['hours', 'abc'],
    ['hours', '-2'],
    ['weight', 'abc'],
    ['weight', '0']
  ])('refuses %s of %p and sends nothing', async (field, value) => {
    const res = await post(app(), '/group-exchanges/3/participants', { participant_id: '12', role: 'provider', [field]: value });
    expect(res.status).toBe(302);
    expect(location(res)).toContain('status=add-failed');
    expect(mockCalls.length).toBe(0);
  });
  it('calls it a failed check when the person was only being checked', async () => {
    const res = await post(app(), '/group-exchanges/3/participants', { action: 'preview', participant_id: '12', hours: 'abc' });
    expect(location(res)).toContain('status=check-failed');
    expect(mockCalls.length).toBe(0);
  });
});

describe('job pay, hours and credits', () => {
  const app = () => appFor('../src/routes/jobs', '/jobs');
  it.each([
    ['salary_min', 'abc'],
    ['salary_max', '-1'],
    ['hours_per_week', 'lots'],
    ['time_credits', '1,5x']
  ])('refuses %s of %p so the API cannot cast it to 0', async (field, value) => {
    const res = await post(app(), '/jobs', { title: 'Garden help', description: 'Help', [field]: value });
    expect(res.status).toBe(302);
    expect(location(res)).toContain('status=create-failed');
    expect(mockCalls.length).toBe(0);
  });
  it('refuses the same on edit and says the update failed', async () => {
    const res = await post(app(), '/jobs/6/update', { title: 'Garden help', description: 'Help', salary_min: 'abc' });
    expect(location(res)).toContain('status=update-failed');
    expect(mockCalls.length).toBe(0);
  });
});

describe('federation travel radius', () => {
  const app = () => appFor('../src/routes/federation-actions', '/federation');
  it.each(['abc', '501', '-1', '2.5'])('refuses %p when saving settings', async (value) => {
    const res = await post(app(), '/federation/settings', { travel_radius_km: value });
    expect(location(res)).toContain('status=settings-failed');
    expect(mockCalls.length).toBe(0);
  });
  it.each(['abc', '501'])('refuses %p when opting in with preferences', async (value) => {
    const res = await post(app(), '/federation/opt-in', { preferences_submitted: '1', travel_radius_km: value });
    expect(location(res)).toContain('status=optin-failed');
    expect(mockCalls.length).toBe(0);
  });
  it('refuses a bad radius on the onboarding communication step', async () => {
    const res = await post(app(), '/federation/onboarding', { step: 'communication', travel_radius_km: 'abc' });
    expect(location(res)).toContain('step=communication');
    expect(location(res)).toContain('status=optin-failed');
  });
  it('keeps a blank radius as the default', async () => {
    const res = await post(app(), '/federation/settings', { travel_radius_km: '' });
    expect(location(res)).toContain('status=settings-saved');
  });
});

describe('event reminders custom offset', () => {
  const app = () => appFor('../src/routes/events', '/events', { token: true });
  it('refuses a custom offset that is not a whole number of minutes', async () => {
    const res = await post(app(), '/events/8/reminders', { reminders_enabled: '1', offsets: ['60'], custom_offset: 'abc' });
    expect(res.status).toBe(302);
    expect(location(res)).toContain('reminders?status=invalid');
    expect(mockCalls.length).toBe(0);
  });
});

describe('event registration form numbers', () => {
  const app = () => appFor('../src/routes/events', '/events', { token: true });
  const base = {
    idempotency_key: 'registration-form-key-1',
    expected_settings_revision: '3',
    name: 'Volunteer form'
  };
  it.each([
    ['retention_days', 'soon'],
    ['min_length', 'abc'],
    ['max_length', '-2']
  ])('refuses %s of %p instead of dropping the question or the limit', async (field, value) => {
    const question = {
      enabled: '1', question_type: 'short_text', prompt: 'Why?', purpose: 'Planning', retention_days: '30', [field]: value
    };
    const res = await post(app(), '/events/8/registration/forms/new', { ...base, questions: { 0: question } });
    expect(res.status).toBe(302);
    expect(location(res)).toContain('registration/forms/new?status=invalid');
    expect(mockCalls.length).toBe(0);
  });
});

describe('marketplace pickup slot capacity', () => {
  const app = () => appFor('../src/routes/marketplace-actions', '/marketplace');
  const slot = { slot_start: '2026-11-02T10:00', slot_end: '2026-11-02T11:00' };
  const sent = () => mockCalls.map((call) => call.args).flat().find((arg) => arg && typeof arg === 'object' && 'capacity' in arg);
  it.each(['abc', '5000', '0'])('hands %p to the API as typed so it is refused, not clamped to 1 or 1000', async (value) => {
    await post(app(), '/marketplace/slots', { ...slot, capacity: value });
    expect(sent().capacity).toBe(value);
  });
  it('treats a blank capacity as 1 and keeps a valid one', async () => {
    await post(app(), '/marketplace/slots', { ...slot, capacity: '' });
    expect(sent().capacity).toBe(1);
    mockCalls.length = 0;
    await post(app(), '/marketplace/slots', { ...slot, capacity: '40' });
    expect(sent().capacity).toBe(40);
  });
});
