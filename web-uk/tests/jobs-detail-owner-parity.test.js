// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Job detail parity with React (JobMetadataSidebar, JobOwnerBanner,
 * JobDescriptionCard), 27 Oct 2026.
 *
 * a. The detail shows category, hours per week, time credits and the contact
 *    email / phone the vacancy carries (web-uk's own form collects them).
 * b. The owner can close an open vacancy and reopen a closed one, through the
 *    same PUT /v2/jobs/{id} { status } React uses. Under moderation a reopen
 *    comes back as a draft awaiting review, and the owner is told so.
 * c. The owner gets links to analytics and the pipeline; a member viewing a job
 *    with required skills gets a link to "Am I qualified?".
 */
const express = require('express');
const request = require('supertest');
const nunjucks = require('nunjucks');
const path = require('node:path');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }
  return new Proxy({
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    callJobApi: jest.fn(),
    getJob: jest.fn(),
    getProfile: jest.fn(),
  }, {
    get: (target, prop) => (prop in target ? target[prop] : jest.fn().mockResolvedValue({ data: [] })),
  });
});

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, res, next) => next()
}));

const api = require('../src/lib/api');
const jobsRouter = require('../src/routes/jobs');

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
  app.use((req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.t = t;
    res.locals.urlFor = (v) => String(v || '/');
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS', tenantName: 'Test', isAuthenticated: true, csrfToken: 'csrf',
      t, tc: createChoiceTranslator('en'), htmlLang: 'en', htmlDirection: 'ltr',
    });
    next();
  });
  app.use('/jobs', jobsRouter);
  return app;
}

const app = mount();

const JOB = {
  id: 31, title: 'Garden helper', type: 'timebank', status: 'open', user_id: 7,
  category: 'Gardening', hours_per_week: 6, time_credits: 4,
  contact_email: 'garden@example.test', contact_phone: '+1 555 123 4567',
  skills_required: 'digging, pruning',
};

beforeEach(() => {
  jest.clearAllMocks();
  api.getJob.mockResolvedValue({ data: JOB });
  api.getProfile.mockResolvedValue({ data: { id: 99 } });
  api.callJobApi.mockResolvedValue({ data: {} });
});

describe('a. vacancy details', () => {
  it('shows category, hours, time credits and contact details', async () => {
    const res = await request(app).get('/jobs/31');
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_jobs.detail.category_label'));
    expect(res.text).toContain('Gardening');
    expect(res.text).toContain(t('govuk_alpha_jobs.detail.hours_label'));
    expect(res.text).toContain(t('govuk_alpha_jobs.detail.time_credits_label'));
    expect(res.text).toContain('href="mailto:garden@example.test"');
    expect(res.text).toContain('href="tel:+15551234567"');
  });

  it('leaves out rows the vacancy does not carry', async () => {
    api.getJob.mockResolvedValue({ data: { id: 31, title: 'Plain', type: 'volunteer', status: 'open', user_id: 7 } });
    const res = await request(app).get('/jobs/31');
    expect(res.text).not.toContain(t('govuk_alpha_jobs.detail.hours_label'));
    expect(res.text).not.toContain('mailto:');
  });
});

describe('b. close and reopen', () => {
  it('offers the owner "close" on an open vacancy', async () => {
    api.getProfile.mockResolvedValue({ data: { id: 7 } });
    const res = await request(app).get('/jobs/31');
    expect(res.text).toContain('action="/jobs/31/close"');
    expect(res.text).not.toContain('action="/jobs/31/reopen"');
  });

  it('offers the owner "reopen" on a closed vacancy', async () => {
    api.getProfile.mockResolvedValue({ data: { id: 7 } });
    api.getJob.mockResolvedValue({ data: { ...JOB, status: 'closed' } });
    const res = await request(app).get('/jobs/31');
    expect(res.text).toContain('action="/jobs/31/reopen"');
    expect(res.text).not.toContain('action="/jobs/31/close"');
  });

  it('never offers close or reopen to someone else', async () => {
    const res = await request(app).get('/jobs/31');
    expect(res.text).not.toContain('/jobs/31/close');
    expect(res.text).not.toContain('/jobs/31/reopen');
  });

  it('closes through PUT /v2/jobs/{id} { status: closed }', async () => {
    api.callJobApi.mockResolvedValue({ data: { ...JOB, status: 'closed' } });
    const res = await request(app).post('/jobs/31/close');
    expect(api.callJobApi).toHaveBeenCalledWith('token:test', 'PUT', '/31', { status: 'closed' });
    expect(res.headers.location).toBe('/jobs/31?status=closed');
    const page = await request(app).get(res.headers.location);
    expect(page.text).toContain(t('govuk_alpha_jobs.detail.states.closed'));
  });

  it('reopens through PUT /v2/jobs/{id} { status: open }', async () => {
    api.callJobApi.mockResolvedValue({ data: { ...JOB, status: 'open' } });
    const res = await request(app).post('/jobs/31/reopen');
    expect(api.callJobApi).toHaveBeenCalledWith('token:test', 'PUT', '/31', { status: 'open' });
    expect(res.headers.location).toBe('/jobs/31?status=reopened');
  });

  it('says a reopen is awaiting review when moderation holds it as a draft', async () => {
    api.callJobApi.mockResolvedValue({ data: { ...JOB, status: 'draft', moderation_status: 'pending_review' } });
    const res = await request(app).post('/jobs/31/reopen');
    expect(res.headers.location).toBe('/jobs/31?status=reopen-pending-review');
    const page = await request(app).get(res.headers.location);
    expect(page.text).toContain(t('govuk_alpha_jobs.detail.states.reopen_pending_review'));
  });

  it('reports a refused status change', async () => {
    api.callJobApi.mockRejectedValue(new api.ApiError('no', 403, { errors: [{ code: 'RESOURCE_FORBIDDEN' }] }));
    const res = await request(app).post('/jobs/31/close');
    expect(res.headers.location).toBe('/jobs/31?status=status-change-failed');
    api.callJobApi.mockResolvedValue({ data: {} });
    const page = await request(app).get(res.headers.location);
    expect(page.text).toContain(t('govuk_alpha_jobs.detail.states.status_change_failed'));
  });
});

describe('c. owner and qualification links', () => {
  it('links the owner to analytics and the pipeline', async () => {
    api.getProfile.mockResolvedValue({ data: { id: 7 } });
    const res = await request(app).get('/jobs/31');
    expect(res.text).toContain('href="/jobs/31/analytics"');
    expect(res.text).toContain('href="/jobs/31/pipeline"');
  });

  it('links a member to "Am I qualified?" when the job lists skills', async () => {
    const res = await request(app).get('/jobs/31');
    expect(res.text).toContain('href="/jobs/31/qualified"');
    expect(res.text).toContain(t('govuk_alpha_jobs.qualification.title'));
  });

  it('does not show the qualification link to the owner', async () => {
    api.getProfile.mockResolvedValue({ data: { id: 7 } });
    const res = await request(app).get('/jobs/31');
    expect(res.text).not.toContain('href="/jobs/31/qualified"');
  });
});
