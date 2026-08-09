// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const request = require('supertest');

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  },
  callAdminJobApi: jest.fn(),
  callJobApi: jest.fn(),
  callJobDownload: jest.fn(),
  getJobs: jest.fn(),
  getJob: jest.fn(),
  getProfile: jest.fn(),
  getUserV2: jest.fn(),
  uploadJobApplication: jest.fn()
}));

jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, res, next) => next()
}));

const api = require('../src/lib/api');
const { createTranslator } = require('../src/lib/localization');
const jobsRouter = require('../src/routes/jobs');

function createApp(locale, installTranslator = true) {
  const app = express();

  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    if (installTranslator) req.t = createTranslator(locale);
    res.locals.urlFor = (pathname) => pathname;
    res.render = (view, locals = {}) => res.json({ view, locals });
    next();
  });
  app.use('/jobs', jobsRouter);

  return app;
}

describe('request-scoped jobs status localization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.getJobs.mockResolvedValue({ data: [], meta: { total: 0 } });
    api.getJob.mockResolvedValue({
      data: { id: 1, title: 'Community gardener', type: 'volunteer', status: 'open' }
    });
    api.callJobApi.mockResolvedValue({ data: [], meta: { total: 0 } });
    api.callAdminJobApi.mockResolvedValue({ data: [] });
    api.getProfile.mockResolvedValue({ data: { id: 99 } });
    api.getUserV2.mockResolvedValue({ data: { id: 99, name: 'Example person' } });
  });

  it.each([
    ['ga', '/jobs?status=applied', 'successMessage', 'jobs.states.applied'],
    ['ar', '/jobs/mine?status=deleted', 'successMessage', 'jobs_t3.states.deleted'],
    ['ga', '/jobs/applications?status=withdraw-failed', 'errorMessage', 'jobs_t2.states.withdraw-failed'],
    ['ar', '/jobs/alerts?status=alert-created', 'successMessage', 'jobs_t4.states.alert-created'],
    [
      'ga',
      '/jobs/responses?status=interview-failed',
      'errorMessage',
      'govuk_alpha_jobs.responses.states_interview_failed'
    ],
    ['ar', '/jobs/1?status=apply-failed', 'errorMessage', 'jobs.states.apply-failed'],
    ['ga', '/jobs/1/pipeline?status=status-failed', 'errorMessage', 'govuk_alpha_jobs.pipeline.status_failed'],
    ['ar', '/jobs/1/applications?status=export-failed', 'errorMessage', 'jobs_t3.states.export-failed']
  ])('renders %s status %s from the Laravel catalog', async (locale, pathname, property, key) => {
    const response = await request(createApp(locale)).get(pathname);

    expect(response.status).toBe(200);
    expect(response.body.locals[property]).toBe(createTranslator(locale)(key));
  });

  it.each(['ga', 'ar'])('localizes title validation after a neutral redirect in %s', async (locale) => {
    const app = createApp(locale);
    const rejected = await request(app)
      .post('/jobs')
      .type('form')
      .send({ title: '   ' });

    expect(rejected.status).toBe(302);
    expect(rejected.headers.location).toBe('/jobs/create?status=title-required');

    const destination = await request(app).get(rejected.headers.location);
    expect(destination.status).toBe(200);
    expect(destination.body.locals.jobFormErrors).toEqual([
      {
        href: '#title',
        text: createTranslator(locale)('jobs_t3.error_title_required')
      }
    ]);
  });

  it('uses the English Laravel catalog when an isolated route does not install req.t', async () => {
    const response = await request(createApp('ga', false)).get('/jobs/mine?status=created');

    expect(response.status).toBe(200);
    expect(response.body.locals.successMessage).toBe(
      createTranslator('en')('jobs_t3.states.created')
    );
  });

  it('does not turn an unknown status token into user-facing text', async () => {
    const response = await request(createApp('ar')).get('/jobs?status=not-a-real-status');

    expect(response.status).toBe(200);
    expect(response.body.locals.successMessage).toBe('');
  });

  it('localizes non-empty application history and resolves its vacancy caption', async () => {
    const locale = 'ga';
    const t = createTranslator(locale);
    api.callJobApi.mockImplementation((token, method, apiPath) => {
      if (apiPath === '/applications/91/history') {
        return Promise.resolve({
          data: [{
            id: 1,
            to_status: 'accepted',
            from_status: 'offer',
            changed_at: '2099-07-10T14:30:00Z',
            changed_by_name: 'Avery Admin',
            notes: 'Offer accepted'
          }]
        });
      }
      if (apiPath === '/my-applications?per_page=100') {
        return Promise.resolve({
          data: [{ id: 91, vacancy: { id: 7, title: 'Community coordinator' } }]
        });
      }
      return Promise.resolve({ data: [] });
    });

    const response = await request(createApp(locale)).get('/jobs/applications/91/history');

    expect(response.status).toBe(200);
    expect(response.body.locals.vacancyTitle).toBe('Community coordinator');
    expect(response.body.locals.history).toEqual([
      expect.objectContaining({
        statusLabel: t('jobs_t2.app_status_accepted'),
        fromLabel: t('govuk_alpha_jobs.history.from', {
          status: t('jobs_t2.app_status_offer')
        }),
        changedByLabel: t('govuk_alpha_jobs.history.by', { name: 'Avery Admin' })
      })
    ]);
  });

  it('localizes qualification levels and preserves the Blade tag treatment', async () => {
    const locale = 'ar';
    api.callJobApi.mockResolvedValueOnce({
      data: {
        job_id: 1,
        job_title: 'Community gardener',
        percentage: 88,
        level: 'excellent',
        total_required: 4,
        total_matched: 3,
        breakdown: [],
        dimensions: []
      }
    });

    const response = await request(createApp(locale)).get('/jobs/1/qualified');

    expect(response.status).toBe(200);
    expect(response.body.locals.qualification).toEqual(expect.objectContaining({
      levelLabel: createTranslator(locale)('govuk_alpha_jobs.qualification.level_excellent'),
      levelTagClass: 'govuk-tag--green'
    }));
  });

  it('uses Laravel talent fallbacks only when candidate-authored identity is absent', async () => {
    const locale = 'ga';
    api.callJobApi.mockResolvedValueOnce({ data: { id: 77, name: '', headline: '' } });

    const response = await request(createApp(locale)).get('/jobs/talent-search/77');

    expect(response.status).toBe(200);
    expect(response.body.locals).toEqual(expect.objectContaining({
      title: 'Candidate profile',
      titleKey: 'govuk_alpha_jobs.talent.profile_title',
      candidate: expect.objectContaining({
        name: createTranslator(locale)('govuk_alpha_jobs.shared.anonymous'),
        headline: createTranslator(locale)('govuk_alpha_jobs.talent.headline_none')
      })
    }));
  });

  it('localizes bias-audit stage/source labels and exposes Laravel job choices', async () => {
    const locale = 'ga';
    const t = createTranslator(locale);
    api.callAdminJobApi.mockImplementation((token, method, apiPath) => {
      if (apiPath.startsWith('/bias-audit')) {
        return Promise.resolve({
          data: {
            period: { from: '2099-07-01', to: '2099-07-31' },
            total_applications: 1,
            hiring_velocity_days: 2,
            funnel: { accepted: 1 },
            rejection_rates: {},
            avg_time_in_stage: {},
            skills_match_correlation: { accepted_count: 1, accepted_avg: 1 },
            source_effectiveness: { direct: { applications: 1, accepted: 1, rate: 100 } }
          }
        });
      }
      if (apiPath === '/?limit=200') {
        return Promise.resolve({ data: [{ id: 7, title: 'Community coordinator' }] });
      }
      return Promise.resolve({ data: [] });
    });

    const response = await request(createApp(locale)).get('/jobs/bias-audit?job_id=7');

    expect(response.status).toBe(200);
    expect(response.body.locals.jobs).toEqual([{ id: 7, title: 'Community coordinator' }]);
    expect(response.body.locals.report.funnelRows[0].label).toBe(t('govuk_alpha_jobs.stage.accepted'));
    expect(response.body.locals.report.sourceRows[0].label).toBe(
      t('govuk_alpha_jobs.bias_audit.source_direct')
    );
  });
});
