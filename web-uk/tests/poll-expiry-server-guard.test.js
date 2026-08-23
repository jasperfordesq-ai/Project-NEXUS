// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The poll closing date was the LAST native `type="date"` input in web-uk, and it was
 * deliberately held back: its `min="…"` attribute was the only thing stopping a member
 * choosing a date in the past. Converting it to the GOV.UK three-field pattern removes
 * that attribute, so the guard moved to the server.
 *
 * 🔴 That is a strict improvement, not a like-for-like swap. `min` is advisory — it
 * stops a date picker offering the day, and stops nothing else. Anything posting the
 * form directly could always create a poll that was already closed when it appeared.
 */
const express = require('express');
const session = require('express-session');
const request = require('supertest');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');

jest.mock('../src/lib/api', () => new Proxy({
  ApiError: class ApiError extends Error {},
  ApiOfflineError: class ApiOfflineError extends Error {},
  createPoll: jest.fn().mockResolvedValue({ data: { id: 1 } }),
}, { get: (t, p) => (p in t ? t[p] : jest.fn().mockResolvedValue({ data: [] })) }));

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() }),
}));

const api = require('../src/lib/api');
const pollRoutes = require('../src/routes/poll-actions');

function isoDaysFromNow(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function mount() {
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'poll-expiry-test-secret-at-least-32-chars', resave: false, saveUninitialized: false }));
  app.use('/', (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'test', prefix: '/test/accessible', tenant: { id: 2, slug: 'test' } };
    res.locals.urlFor = (v) => String(v || '/');
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS', tenantName: 'Test', isAuthenticated: true, csrfToken: 'x',
      t: createTranslator('en'), tc: createChoiceTranslator('en'), htmlLang: 'en', htmlDirection: 'ltr',
    });
    next();
  }, pollRoutes);
  return app;
}

function form(extra) {
  return { question: 'Which day suits?', 'options[]': ['Monday', 'Tuesday'], poll_type: 'standard', ...extra };
}

describe('a poll cannot be created already closed', () => {
  const app = mount();
  beforeEach(() => jest.clearAllMocks());

  it('refuses a closing date in the past, and never calls the API', async () => {
    const res = await request(app).post('/parity/create').type('form').send(form({
      'expires_at-day': '01', 'expires_at-month': '01', 'expires_at-year': '2020',
    }));
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('poll-expires-past');
    expect(api.createPoll).not.toHaveBeenCalled();
  });

  it('refuses today as well — a poll closing today is closed on arrival', async () => {
    const [year, month, day] = isoDaysFromNow(0).split('-');
    const res = await request(app).post('/parity/create').type('form').send(form({
      'expires_at-day': day, 'expires_at-month': month, 'expires_at-year': year,
    }));
    expect(res.headers.location).toContain('poll-expires-past');
    expect(api.createPoll).not.toHaveBeenCalled();
  });

  it('accepts a future closing date and sends it in the API shape', async () => {
    const future = isoDaysFromNow(30);
    const [year, month, day] = future.split('-');
    const res = await request(app).post('/parity/create').type('form').send(form({
      'expires_at-day': day, 'expires_at-month': month, 'expires_at-year': year,
    }));
    expect(res.headers.location).toContain('poll-created');
    expect(api.createPoll).toHaveBeenCalledTimes(1);
    // Three boxes in, one YYYY-MM-DD out — the backend contract is unchanged.
    expect(api.createPoll.mock.calls[0][1].expires_at).toBe(future);
  });

  it('still accepts a single YYYY-MM-DD value, so bookmarks and direct posts keep working', async () => {
    const future = isoDaysFromNow(14);
    const res = await request(app).post('/parity/create').type('form').send(form({ expires_at: future }));
    expect(res.headers.location).toContain('poll-created');
    expect(api.createPoll.mock.calls[0][1].expires_at).toBe(future);
  });

  it('leaves an omitted closing date omitted — the field is optional', async () => {
    const res = await request(app).post('/parity/create').type('form').send(form({}));
    expect(res.headers.location).toContain('poll-created');
    expect(api.createPoll.mock.calls[0][1]).not.toHaveProperty('expires_at');
  });

  // 🔴 The rejection redirects to a page whose banner map is a DIFFERENT one for the
  // non-parity form. Without its own entry the member would be bounced back and told
  // nothing at all — worse than the browser hint it replaces.
  it('tells the member why on BOTH create forms, not just the parity one', () => {
    const t = createTranslator('en');
    const message = t('govuk_alpha_gamification.poll_create.expires_past_error');
    expect(message).toBe('The closing date must be in the future');
    const source = require('node:fs').readFileSync(require.resolve('../src/routes/poll-actions'), 'utf8');
    expect(source.match(/'poll-expires-past':/g) || []).toHaveLength(2);
  });

  it('refuses an unreal typed closing date (day 45) instead of silently creating a never-closing poll', async () => {
    for (const path of ['/parity/create', '/']) {
      const res = await request(app).post(path).type('form').send(form({
        'expires_at-day': '45', 'expires_at-month': '1', 'expires_at-year': '2030',
      }));
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('poll-expires-invalid');
    }
    expect(api.createPoll).not.toHaveBeenCalled();
  });

  it('rejects a partly typed closing date rather than discarding the typed part', async () => {
    const res = await request(app).post('/parity/create').type('form').send(form({
      'expires_at-day': '12', 'expires_at-month': '', 'expires_at-year': '',
    }));
    expect(res.headers.location).toContain('poll-expires-invalid');
    expect(api.createPoll).not.toHaveBeenCalled();
  });

  it('maps poll-expires-invalid on BOTH create banners to the shared translated date wording', () => {
    const t = createTranslator('en');
    expect(t('web_uk.date_input.date_invalid')).toBe('Enter a real date');
    const source = require('node:fs').readFileSync(require.resolve('../src/routes/poll-actions'), 'utf8');
    expect(source.match(/'poll-expires-invalid':/g) || []).toHaveLength(2);
  });
});
