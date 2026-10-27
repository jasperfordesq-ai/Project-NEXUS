// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Jobs parity with React, 27 Oct 2026 (deep audit B, items J2, J3, J11, J12, J13).
 *
 * 1. Saved application profile: the apply form is pre-filled from
 *    GET /v2/jobs/saved-profile, a "quick apply" sends the saved message, and a
 *    sent message is remembered through PUT /v2/jobs/saved-profile.
 * 2. Skills read from an uploaded CV (GET /v2/jobs/applications/{id}/parse-cv)
 *    are shown after applying.
 * 3. An interview can be added to a calendar: .ics download through
 *    GET /v2/jobs/interviews/{id}/calendar, plus Google and Outlook links.
 * 4. A member can download their job-application data (GET /v2/jobs/gdpr-export).
 * 5. A member can write an employer review (POST /v2/jobs/employer-reviews).
 */
const express = require('express');
const request = require('supertest');
const nunjucks = require('nunjucks');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
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
    callJobDownload: jest.fn(),
    uploadJobApplication: jest.fn(),
    getJob: jest.fn(),
    getJobs: jest.fn(),
    getUserV2: jest.fn(),
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
let flashStore = {};

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
    req.flash = (key, value) => {
      if (value !== undefined) {
        flashStore[key] = [...(flashStore[key] || []), value];
        return undefined;
      }
      const values = flashStore[key] || [];
      delete flashStore[key];
      return values;
    };
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

const JOB = { id: 31, title: 'Garden helper', type: 'timebank', status: 'open', user_id: 7 };

function jobApi(routes) {
  api.callJobApi.mockImplementation(async (token, method, apiPath, data) => {
    const key = `${method} ${apiPath}`;
    if (Object.prototype.hasOwnProperty.call(routes, key)) {
      const value = routes[key];
      if (value instanceof Error) throw value;
      return typeof value === 'function' ? value(data) : value;
    }
    return { data: {} };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  flashStore = {};
  api.getJob.mockResolvedValue({ data: JOB });
  api.getProfile.mockResolvedValue({ data: { id: 99 } });
  jobApi({});
});

describe('1. saved application profile and quick apply', () => {
  it('pre-fills the cover message from the saved profile and offers quick apply', async () => {
    jobApi({ 'GET /saved-profile': { data: { profile: { cover_text: 'I love gardens.' } } } });
    const res = await request(app).get('/jobs/31');
    expect(res.status).toBe(200);
    expect(api.callJobApi).toHaveBeenCalledWith('token:test', 'GET', '/saved-profile');
    expect(res.text).toContain('I love gardens.</textarea>');
    expect(res.text).toContain(t('govuk_alpha_jobs.apply_extras.saved_found'));
    expect(res.text).toContain('action="/jobs/31/quick-apply"');
  });

  it('shows no quick apply when nothing is saved', async () => {
    jobApi({ 'GET /saved-profile': { data: { profile: null } } });
    const res = await request(app).get('/jobs/31');
    expect(res.text).not.toContain('/jobs/31/quick-apply');
    expect(res.text).not.toContain(t('govuk_alpha_jobs.apply_extras.saved_found'));
  });

  it('keeps the apply form working when saved profiles are switched off', async () => {
    const { ApiError } = api;
    jobApi({ 'GET /saved-profile': new ApiError('disabled', 403) });
    const res = await request(app).get('/jobs/31');
    expect(res.status).toBe(200);
    expect(res.text).toContain('action="/jobs/31/apply"');
  });

  it('quick apply sends the saved message, read again on the server', async () => {
    jobApi({
      'GET /saved-profile': { data: { profile: { cover_text: 'Saved words' } } },
      'POST /31/apply': { data: { id: 501 } },
    });
    const res = await request(app).post('/jobs/31/quick-apply');
    expect(api.callJobApi).toHaveBeenCalledWith('token:test', 'POST', '/31/apply', { message: 'Saved words' });
    expect(res.headers.location).toBe('/jobs/31?status=applied');
  });

  it('quick apply without a saved message fails safely', async () => {
    jobApi({ 'GET /saved-profile': { data: { profile: null } } });
    const res = await request(app).post('/jobs/31/quick-apply');
    expect(api.callJobApi).not.toHaveBeenCalledWith('token:test', 'POST', '/31/apply', expect.anything());
    expect(res.headers.location).toBe('/jobs/31?status=apply-failed');
  });

  it('remembers the sent message when the member asks', async () => {
    jobApi({ 'POST /31/apply': { data: { id: 502 } } });
    await request(app).post('/jobs/31/apply').type('form').send({ cover_letter: 'New words', remember_message: '1' });
    expect(api.callJobApi).toHaveBeenCalledWith('token:test', 'PUT', '/saved-profile', { headline: '', cover_text: 'New words' });
  });

  it('does not remember the message when the box is unticked', async () => {
    jobApi({ 'POST /31/apply': { data: { id: 503 } } });
    await request(app).post('/jobs/31/apply').type('form').send({ cover_letter: 'Private words' });
    expect(api.callJobApi).not.toHaveBeenCalledWith('token:test', 'PUT', '/saved-profile', expect.anything());
  });
});

describe('2. skills read from an uploaded CV', () => {
  it('shows the skills parse-cv returns after a CV application', async () => {
    api.uploadJobApplication.mockResolvedValue({ data: { id: 777 } });
    jobApi({ 'GET /applications/777/parse-cv': { data: { skills: ['Pruning', 'First aid'] } } });
    // No multipart parser in this harness: hand the route a temporary file the
    // way the upload middleware would (the route deletes it afterwards).
    const tempFile = path.join(os.tmpdir(), `webuk-cv-${process.pid}-${Date.now()}.pdf`);
    fs.writeFileSync(tempFile, 'cv');
    const withFile = express();
    withFile.use((req, res, next) => {
      req.files = { cv: { filepath: tempFile, originalFilename: 'cv.pdf', mimetype: 'application/pdf', size: 2 } };
      next();
    });
    withFile.use(app);
    const res = await request(withFile).post('/jobs/31/apply').type('form').send({ cover_letter: 'Hello' });
    expect(res.headers.location).toBe('/jobs/31?status=applied');
    expect(api.callJobApi).toHaveBeenCalledWith('token:test', 'GET', '/applications/777/parse-cv');

    const detail = await request(app).get('/jobs/31');
    expect(detail.text).toContain(t('govuk_alpha_jobs.apply_extras.cv_skills_heading'));
    expect(detail.text).toContain('Pruning');
    expect(detail.text).toContain('First aid');
  });
});

describe('3. add an interview to a calendar', () => {
  const INTERVIEW = {
    id: 12, status: 'accepted', interview_type: 'video', scheduled_at: '2026-11-03T10:00:00Z',
    duration_mins: 45, job_title: 'Garden helper', location_notes: 'Video link to follow'
  };

  it('offers Google, Outlook and a calendar file', async () => {
    jobApi({ 'GET /my-interviews': { data: [INTERVIEW] }, 'GET /my-offers': { data: [] } });
    const res = await request(app).get('/jobs/responses');
    expect(res.text).toContain('https://calendar.google.com/calendar/render?');
    expect(res.text).toContain('https://outlook.live.com/calendar/0/deeplink/compose?');
    expect(res.text).toContain('startdt=2026-11-03T10%3A00%3A00.000Z');
    expect(res.text).toContain('enddt=2026-11-03T10%3A45%3A00.000Z');
    expect(res.text).toContain('href="/jobs/interviews/12/calendar.ics"');
    expect(res.text).toContain(t('govuk_alpha_jobs.responses.add_to_outlook'));
    expect(res.text).toContain(t('govuk_alpha_jobs.responses.download_ics'));
  });

  it('streams the API calendar file', async () => {
    api.callJobDownload.mockResolvedValue({
      status: 200,
      body: Buffer.from('BEGIN:VCALENDAR'),
      headers: { 'content-type': 'text/calendar; charset=utf-8', 'content-disposition': 'attachment; filename="interview.ics"' }
    });
    const res = await request(app).get('/jobs/interviews/12/calendar.ics');
    expect(api.callJobDownload).toHaveBeenCalledWith('token:test', '/interviews/12/calendar');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/calendar');
    expect(res.text).toBe('BEGIN:VCALENDAR');
  });

  it('sends the member back with a message when the file cannot be made', async () => {
    const { ApiError } = api;
    api.callJobDownload.mockRejectedValue(new ApiError('nope', 403));
    const res = await request(app).get('/jobs/interviews/12/calendar.ics');
    expect(res.headers.location).toBe('/jobs/responses?status=calendar-failed');
    jobApi({ 'GET /my-interviews': { data: [] }, 'GET /my-offers': { data: [] } });
    const page = await request(app).get('/jobs/responses?status=calendar-failed');
    expect(page.text).toContain(t('govuk_alpha_jobs.responses.states_calendar_failed'));
  });
});

describe('4. export my job applications', () => {
  it('links the download from my applications', async () => {
    jobApi({});
    const res = await request(app).get('/jobs/applications');
    expect(res.text).toContain('href="/jobs/applications/export.json"');
    expect(res.text).toContain(t('govuk_alpha_jobs.apply_extras.export_button'));
  });

  it('downloads GET /v2/jobs/gdpr-export as a JSON file', async () => {
    jobApi({ 'GET /gdpr-export': { data: { applications: [{ id: 1 }] } } });
    const res = await request(app).get('/jobs/applications/export.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['content-disposition']).toContain('attachment; filename="my-job-data.json"');
    expect(JSON.parse(res.text)).toEqual({ applications: [{ id: 1 }] });
  });

  it('says so when the export fails', async () => {
    const { ApiError } = api;
    jobApi({ 'GET /gdpr-export': new ApiError('boom', 500) });
    const res = await request(app).get('/jobs/applications/export.json');
    expect(res.headers.location).toBe('/jobs/applications?status=export-failed');
    jobApi({});
    const page = await request(app).get('/jobs/applications?status=export-failed');
    expect(page.text).toContain(t('govuk_alpha_jobs.apply_extras.export_failed'));
  });
});

describe('5. write an employer review', () => {
  beforeEach(() => {
    api.getUserV2.mockResolvedValue({ data: { id: 7, name: 'Green Fingers' } });
    api.getJobs.mockResolvedValue({ data: [] });
  });

  it('offers the review form to another member', async () => {
    jobApi({ 'GET /employer-reviews/7': { data: { reviews: [] } } });
    const res = await request(app).get('/jobs/employers/7');
    expect(res.text).toContain('action="/jobs/employers/7/reviews"');
    expect(res.text).toContain(t('govuk_alpha_jobs.employer.write_review_heading'));
  });

  it('never offers the employer a review of themselves', async () => {
    api.getProfile.mockResolvedValue({ data: { id: 7 } });
    jobApi({ 'GET /employer-reviews/7': { data: { reviews: [] } } });
    const res = await request(app).get('/jobs/employers/7');
    expect(res.text).not.toContain('/jobs/employers/7/reviews');
  });

  it('posts the review with its dimensions', async () => {
    jobApi({ 'POST /employer-reviews': { data: { id: 1 } } });
    const res = await request(app).post('/jobs/employers/7/reviews').type('form').send({
      rating: '4', comment: 'Kind and clear', respect: '5', communication: '', flexibility: '3', impact: '9'
    });
    expect(api.callJobApi).toHaveBeenCalledWith('token:test', 'POST', '/employer-reviews', {
      employer_id: 7, rating: 4, comment: 'Kind and clear', respect: 5, flexibility: 3
    });
    expect(res.headers.location).toBe('/jobs/employers/7?status=review-saved');
  });

  it('refuses a review without an overall rating, before calling the API', async () => {
    const res = await request(app).post('/jobs/employers/7/reviews').type('form').send({ rating: '' });
    expect(api.callJobApi).not.toHaveBeenCalledWith('token:test', 'POST', '/employer-reviews', expect.anything());
    expect(res.headers.location).toBe('/jobs/employers/7?status=review-rating-required');
  });

  it("shows the API's own reason when it refuses", async () => {
    const { ApiError } = api;
    jobApi({
      'POST /employer-reviews': new ApiError('You can only review an employer after completing a job with them.', 403, {
        errors: [{ code: 'NOT_ELIGIBLE', message: 'You can only review an employer after completing a job with them.' }]
      }),
      'GET /employer-reviews/7': { data: { reviews: [] } },
    });
    const post = await request(app).post('/jobs/employers/7/reviews').type('form').send({ rating: '5' });
    expect(post.headers.location).toBe('/jobs/employers/7?status=review-failed');
    const page = await request(app).get('/jobs/employers/7?status=review-failed');
    expect(page.text).toContain('You can only review an employer after completing a job with them.');
  });

  it('confirms a saved review', async () => {
    jobApi({ 'GET /employer-reviews/7': { data: { reviews: [] } } });
    const page = await request(app).get('/jobs/employers/7?status=review-saved');
    expect(page.text).toContain(t('govuk_alpha_jobs.employer.review_saved'));
  });
});
