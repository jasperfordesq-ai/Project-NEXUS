// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A goal deadline that is not a real date must be refused, not dropped
 * (2026-08-25).
 *
 * Found by creating a goal due on 31 February. The page said "Your goal has been
 * created", and the goal came back from the API with `deadline: null` — the date
 * the member typed had been thrown away, and nothing told them.
 *
 * The shared helper was never the problem. composeDate() already returns
 * `{ value: null, error: 'date_invalid' }` for 31 February and 31 April, and its
 * own comment says that is exactly what the round-trip check is for. The goals
 * route read `deadlineFrom(body).value` and ignored `.error`, so an unreal date
 * was indistinguishable from no date at all.
 *
 * Every other module that takes a date already surfaces this through the shared
 * `web_uk.date_input.date_invalid` — "Enter a real date" (groups, jobs,
 * marketplace, polls). Goals was the outlier.
 */

const express = require('express');
const session = require('express-session');
const request = require('supertest');
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
    callGoalApi: jest.fn(),
    getGoals: jest.fn(),
    getGoal: jest.fn(),
    getProfile: jest.fn(),
    invalidateUserCache: jest.fn()
  };
});

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() })
}));

const api = require('../src/lib/api');
const goalRoutes = require('../src/routes/goals');

const PREFIX = '/acme/accessible';

function buildApp() {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: 'goal-deadline-test-secret-at-least-32',
    resave: false,
    saveUninitialized: false,
    name: 'goal-deadline.sid'
  }));
  app.use('/goals', (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.accessibleRouting = {
      mode: 'shared', tenantSlug: 'acme', prefix: PREFIX,
      tenant: { id: 2, slug: 'acme', name: 'Acme Timebank' }
    };
    res.locals.urlFor = (value) => String(value || '/');
    Object.assign(res.locals, {
      t: createTranslator('en'),
      tc: createChoiceTranslator('en'),
      serviceName: 'Project NEXUS',
      tenantName: 'Acme Timebank',
      isAuthenticated: true,
      csrfToken: 'test-csrf-token',
      htmlLang: 'en',
      htmlDirection: 'ltr'
    });
    next();
  }, goalRoutes);
  return app;
}

function createGoal(fields) {
  return request(buildApp()).post('/goals').type('form').send({
    _csrf: 'test-csrf-token',
    title: 'Give ten hours of bicycle repair help',
    target_value: '10',
    ...fields
  });
}

describe('an unreal deadline is refused, and named', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.callGoalApi.mockResolvedValue({ data: { id: 7 } });
  });

  it.each([
    ['31 February', { 'deadline-day': '31', 'deadline-month': '2', 'deadline-year': '2027' }],
    ['31 April', { 'deadline-day': '31', 'deadline-month': '4', 'deadline-year': '2027' }],
    ['29 February in a non-leap year', { 'deadline-day': '29', 'deadline-month': '2', 'deadline-year': '2027' }],
    ['month 13', { 'deadline-day': '1', 'deadline-month': '13', 'deadline-year': '2027' }]
  ])('refuses %s instead of creating a goal with no deadline', async (_label, fields) => {
    const res = await createGoal(fields);

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('status=goal-deadline-invalid');
    // 🔴 The goal must not reach the API at all: it used to be created, with the
    // date silently removed, under a "Your goal has been created" banner.
    expect(api.callGoalApi).not.toHaveBeenCalled();
  });

  it('refuses a half-entered deadline rather than ignoring it', async () => {
    const res = await createGoal({ 'deadline-day': '30', 'deadline-month': '', 'deadline-year': '2027' });

    expect(res.headers.location).toContain('status=goal-deadline-invalid');
    expect(api.callGoalApi).not.toHaveBeenCalled();
  });
});

describe('a real deadline still works, and no deadline is still allowed', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.callGoalApi.mockResolvedValue({ data: { id: 7 } });
  });

  it('creates the goal and sends the date on', async () => {
    const res = await createGoal({ 'deadline-day': '30', 'deadline-month': '11', 'deadline-year': '2026' });

    expect(res.headers.location).toContain('status=goal-created');
    const payload = api.callGoalApi.mock.calls[0][3];
    expect(payload.deadline).toContain('2026-11-30');
  });

  it('leaves the deadline out when the member enters none — it is optional', async () => {
    const res = await createGoal({ 'deadline-day': '', 'deadline-month': '', 'deadline-year': '' });

    expect(res.headers.location).toContain('status=goal-created');
    expect(api.callGoalApi).toHaveBeenCalled();
    expect(api.callGoalApi.mock.calls[0][3].deadline).toBeNull();
  });

  it('still refuses a goal with no title, separately from a date problem', async () => {
    const res = await request(buildApp()).post('/goals').type('form').send({
      _csrf: 'test-csrf-token', title: '', target_value: '10'
    });

    // The title problem keeps its own message; it must not be relabelled as a
    // date problem.
    expect(res.headers.location).toContain('status=goal-invalid');
    expect(res.headers.location).not.toContain('deadline');
  });
});

describe('the refusal reads as a date problem', () => {
  it('resolves to the shared "Enter a real date", not a goal-shaped message', () => {
    const t = createTranslator('en');

    expect(t('web_uk.date_input.date_invalid')).toBe('Enter a real date');
    // And it is a real translation in every locale, not an English fallback.
    expect(createTranslator('ga')('web_uk.date_input.date_invalid'))
      .not.toBe(t('web_uk.date_input.date_invalid'));
  });
});
