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
  getJob: jest.fn(),
  getJobs: jest.fn(),
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

function createApp(locale) {
  const app = express();

  app.use((req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    req.query = req.query || {};
    req.t = createTranslator(locale);
    res.locals.urlFor = (pathname) => pathname;
    res.render = (view, locals = {}) => res.json({ view, locals });
    next();
  });
  app.use('/jobs', jobsRouter);

  return app;
}

describe('Laravel-first Jobs document-title localization', () => {
  beforeEach(() => {
    api.callAdminJobApi.mockReset().mockResolvedValue({ data: {} });
    api.callJobApi.mockReset().mockImplementation((token, method, apiPath) => {
      if (apiPath === '/42/qualified') {
        return Promise.resolve({ data: { job_id: 42 } });
      }

      return Promise.resolve({ data: [] });
    });
    api.getJob.mockReset().mockResolvedValue({
      data: {
        id: 42,
        title: 'Dynamic opportunity title',
        status: 'open',
        user_id: 99
      }
    });
    api.getJobs.mockReset().mockResolvedValue({ data: [], meta: {} });
    api.getProfile.mockReset().mockResolvedValue({ data: { id: 99 } });
    api.getUserV2.mockReset();
  });

  it.each([
    ['ga', '/jobs', 'jobs/index', 'Jobs', 'jobs.title'],
    ['ar', '/jobs/saved', 'jobs/saved', 'Saved opportunities', 'jobs_t2.saved_title'],
    ['ga', '/jobs/applications', 'jobs/applications', 'My applications', 'jobs_t2.applications_title'],
    ['ar', '/jobs/applications/91/history', 'jobs/application-history', 'Application timeline', 'govuk_alpha_jobs.history.title'],
    ['ga', '/jobs/mine', 'jobs/mine', 'My postings', 'jobs_t3.mine_title'],
    ['ar', '/jobs/create', 'jobs/form', 'Post an opportunity', 'jobs_t3.create_title'],
    ['ga', '/jobs/alerts', 'jobs/alerts', 'Job alerts', 'jobs_t4.title'],
    ['ar', '/jobs/responses', 'jobs/responses', 'Interviews and offers', 'govuk_alpha_jobs.responses.title'],
    ['ga', '/jobs/employer-onboarding', 'jobs/onboarding', 'Post your first opportunity', 'govuk_alpha_jobs.onboarding.title'],
    ['ar', '/jobs/bias-audit', 'jobs/bias-audit', 'Hiring bias audit', 'govuk_alpha_jobs.bias_audit.title'],
    ['ga', '/jobs/talent-search', 'jobs/talent-search', 'Find candidates', 'govuk_alpha_jobs.talent.title'],
    ['ar', '/jobs/42/analytics', 'jobs/analytics', 'Opportunity analytics', 'govuk_alpha_jobs.analytics.title'],
    ['ga', '/jobs/42/edit', 'jobs/form', 'Edit opportunity', 'jobs_t3.edit_title'],
    ['ar', '/jobs/42/pipeline', 'jobs/pipeline', 'Application pipeline', 'govuk_alpha_jobs.pipeline.title'],
    ['ga', '/jobs/42/applications', 'jobs/applicants', 'Applications', 'jobs_t3.applicants_title'],
    ['ar', '/jobs/42/qualified', 'jobs/qualification', 'Am I qualified?', 'govuk_alpha_jobs.qualification.title']
  ])('maps %s %s to the exact Laravel title key', async (locale, url, view, fallback, titleKey) => {
    const response = await request(createApp(locale)).get(url);

    expect(response.status).toBe(200);
    expect(response.body.view).toBe(view);
    expect(response.body.locals).toEqual(expect.objectContaining({
      title: fallback,
      titleKey
    }));
    expect(createTranslator(locale)(response.body.locals.titleKey)).not.toBe(titleKey);
    expect(response.body.locals.titleReplacements).toBeUndefined();
  });

  it('supplies the Irish create-page title key while retaining its English fallback', async () => {
    const response = await request(createApp('ga')).get('/jobs/create');
    const t = createTranslator('ga');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      view: 'jobs/form',
      locals: expect.objectContaining({
        title: 'Post an opportunity',
        titleKey: 'jobs_t3.create_title'
      })
    });
    expect(t(response.body.locals.titleKey, response.body.locals.titleReplacements)).toBe('Postáil deis');
    expect(response.body.locals.titleReplacements).toBeUndefined();
  });

  it('supplies the Arabic alerts title key while retaining its English fallback', async () => {
    const response = await request(createApp('ar')).get('/jobs/alerts');
    const t = createTranslator('ar');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      view: 'jobs/alerts',
      locals: expect.objectContaining({
        title: 'Job alerts',
        titleKey: 'jobs_t4.title'
      })
    });
    expect(t(response.body.locals.titleKey, response.body.locals.titleReplacements)).toBe('تنبيهات الوظائف');
    expect(response.body.locals.titleReplacements).toBeUndefined();
  });

  it.each([
    ['/jobs/42', 'jobs/detail', 'Dynamic opportunity title'],
    ['/jobs/employers/7', 'jobs/employer-brand', 'Dynamic employer name'],
    ['/jobs/talent-search/9', 'jobs/talent-profile', 'Dynamic candidate name']
  ])('preserves the user-authored document title for %s', async (url, view, title) => {
    api.getJob.mockResolvedValueOnce({ data: { id: 42, title, status: 'open' } });
    api.getUserV2.mockResolvedValueOnce({
      data: {
        id: 7,
        name: title,
        display_name: title,
        first_name: 'Dynamic',
        last_name: 'candidate name'
      }
    });
    api.callJobApi.mockResolvedValue({
      data: {
        id: 9,
        name: title,
        display_name: title,
        first_name: 'Dynamic',
        last_name: 'candidate name'
      }
    });

    const response = await request(createApp('ar')).get(url);

    expect(response.status).toBe(200);
    expect(response.body.view).toBe(view);
    expect(response.body.locals.title).toBe(title);
    expect(response.body.locals.titleKey).toBeUndefined();
    expect(response.body.locals.titleReplacements).toBeUndefined();
  });
});
