// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Job posting parity with React CreateJobPage, 27 Oct 2026 (deep audit B, J7).
 *
 * 1. The posting form carries contact phone, blind hiring and the employer
 *    branding fields (tagline, video link, company size, benefits) on create and
 *    edit; the API refusal replays them, and the job page shows the branding.
 * 2. Job templates: load one into the form (GET /v2/jobs/templates/{id}), save
 *    the form as one (POST /v2/jobs/templates), delete one of your own
 *    (DELETE /v2/jobs/templates/{id}).
 * 3. Before posting, POST /v2/jobs/check-duplicate. A similar advert gives a
 *    no-JavaScript page: "post anyway" or "go back", with the form preserved.
 *
 * React's AI-written description is deliberately NOT built (owner decision).
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

const JOB = {
  id: 31,
  title: 'Garden helper',
  description: 'Help with the garden.',
  type: 'paid',
  status: 'open',
  user_id: 7,
  contact_phone: '+1 555 123 4567',
  blind_hiring: true,
  tagline: 'We grow together',
  video_url: 'https://www.youtube.com/watch?v=abc123',
  company_size: '11-50',
  benefits: ['Flexible hours', 'Free lunch']
};

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

function callsTo(method, apiPath) {
  return api.callJobApi.mock.calls.filter(([, m, p]) => m === method && p === apiPath);
}

const BASE_FORM = {
  title: 'Garden helper',
  description: 'Help with the garden.',
  type: 'paid',
  commitment: 'part_time',
  status: 'open',
  posting_extras: '1'
};

beforeEach(() => {
  jest.clearAllMocks();
  flashStore = {};
  api.getJob.mockResolvedValue({ data: JOB });
  api.getProfile.mockResolvedValue({ data: { id: 7 } });
  jobApi({});
});

describe('1. contact phone, blind hiring and employer branding', () => {
  it('offers every field on the create form', async () => {
    const res = await request(app).get('/jobs/create');
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="posting_extras" value="1"');
    expect(res.text).toContain('name="contact_phone"');
    expect(res.text).toContain('type="tel"');
    expect(res.text).toMatch(/name="blind_hiring" type="checkbox" value="1"/);
    expect(res.text).toContain('name="tagline"');
    expect(res.text).toContain('maxlength="160"');
    expect(res.text).toContain('name="video_url"');
    expect(res.text).toContain('name="company_size"');
    ['1-10', '11-50', '51-200', '201-500', '500+'].forEach((size) => {
      expect(res.text).toContain(`value="${size}"`);
    });
    expect(res.text).toContain('name="benefits"');
    expect(res.text).toContain(t('govuk_alpha_jobs.posting.branding_legend'));
    expect(res.text).toContain(t('govuk_alpha_jobs.posting.blind_hiring_hint'));
  });

  it('sends the new fields when posting, with benefits as a list', async () => {
    jobApi({ 'POST /check-duplicate': { data: { duplicates: [] } }, 'POST ': { data: { id: 55 } } });
    const res = await request(app).post('/jobs').type('form').send({
      ...BASE_FORM,
      contact_phone: ' +1 555 123 4567 ',
      blind_hiring: '1',
      tagline: ' We grow together ',
      video_url: ' https://vimeo.com/123 ',
      company_size: '51-200',
      benefits: 'Flexible hours\r\n\r\n Free lunch \nFlexible hours'
    });
    expect(res.headers.location).toBe('/jobs/55?status=created');
    const [[, , , payload]] = callsTo('POST', '');
    expect(payload).toEqual(expect.objectContaining({
      title: 'Garden helper',
      contact_phone: '+1 555 123 4567',
      blind_hiring: true,
      tagline: 'We grow together',
      video_url: 'https://vimeo.com/123',
      company_size: '51-200',
      benefits: ['Flexible hours', 'Free lunch']
    }));
  });

  it('sends blind hiring off and drops an unknown company size', async () => {
    jobApi({ 'POST /check-duplicate': { data: { duplicates: [] } }, 'POST ': { data: { id: 55 } } });
    await request(app).post('/jobs').type('form').send({
      ...BASE_FORM, blind_hiring: '0', company_size: 'huge', benefits: ''
    });
    const [[, , , payload]] = callsTo('POST', '');
    expect(payload.blind_hiring).toBe(false);
    expect(payload.company_size).toBe('');
    expect(payload.benefits).toEqual([]);
  });

  it('does not send the new fields from a form that never showed them', async () => {
    jobApi({ 'POST /check-duplicate': { data: { duplicates: [] } }, 'POST ': { data: { id: 55 } } });
    const { posting_extras: _omit, ...legacy } = BASE_FORM;
    await request(app).post('/jobs').type('form').send(legacy);
    const [[, , , payload]] = callsTo('POST', '');
    expect(payload).not.toHaveProperty('tagline');
    expect(payload).not.toHaveProperty('blind_hiring');
    expect(payload).not.toHaveProperty('benefits');
  });

  it('replays what was typed when the API refuses the video link', async () => {
    const { ApiError } = api;
    jobApi({
      'POST /check-duplicate': { data: { duplicates: [] } },
      'POST ': new ApiError('bad', 422, { errors: [{ code: 'VALIDATION_INVALID_VALUE', message: 'Enter a valid link.', field: 'video_url' }] })
    });
    const res = await request(app).post('/jobs').type('form').send({
      ...BASE_FORM, video_url: 'https://evil.example/video', tagline: 'Kept tagline', benefits: 'One\nTwo', contact_phone: '+1 555 000'
    });
    expect(res.headers.location).toBe('/jobs/create?status=create-failed');
    const replay = await request(app).get('/jobs/create?status=create-failed');
    expect(replay.text).toContain('<a href="#video_url">Enter a valid link.</a>');
    expect(replay.text).toContain('value="https://evil.example/video"');
    expect(replay.text).toContain('value="Kept tagline"');
    expect(replay.text).toContain('One\nTwo</textarea>');
    expect(replay.text).toContain('value="+1 555 000"');
  });

  it('pre-fills the edit form from the saved opportunity', async () => {
    const res = await request(app).get('/jobs/31/edit');
    expect(res.status).toBe(200);
    expect(res.text).toContain('value="+1 555 123 4567"');
    expect(res.text).toMatch(/name="blind_hiring" type="checkbox" value="1" checked/);
    expect(res.text).toContain('value="We grow together"');
    expect(res.text).toContain('value="https://www.youtube.com/watch?v=abc123"');
    expect(res.text).toMatch(/value="11-50" selected/);
    expect(res.text).toContain('Flexible hours\nFree lunch</textarea>');
  });

  it('sends the new fields on update too', async () => {
    jobApi({ 'PUT /31': { data: { id: 31 } } });
    await request(app).post('/jobs/31/update').type('form').send({ ...BASE_FORM, tagline: 'New line', blind_hiring: '1' });
    const [[, , , payload]] = callsTo('PUT', '/31');
    expect(payload.tagline).toBe('New line');
    expect(payload.blind_hiring).toBe(true);
    expect(callsTo('POST', '/check-duplicate')).toHaveLength(0);
  });

  it('shows the branding on the opportunity page', async () => {
    const res = await request(app).get('/jobs/31');
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_jobs.posting.about_company'));
    expect(res.text).toContain('We grow together');
    expect(res.text).toContain('Flexible hours');
    expect(res.text).toContain('Free lunch');
    expect(res.text).toContain(t('govuk_alpha_jobs.posting.company_size_people', { size: '11-50' }));
    expect(res.text).toContain('href="https://www.youtube.com/watch?v=abc123"');
    expect(res.text).toContain(t('govuk_alpha_jobs.posting.watch_video'));
  });

  it('shows no branding block when there is none', async () => {
    api.getJob.mockResolvedValue({ data: { id: 31, title: 'Plain', status: 'open', user_id: 7 } });
    const res = await request(app).get('/jobs/31');
    expect(res.text).not.toContain(t('govuk_alpha_jobs.posting.about_company'));
  });

  it('never links a video that is not a web address', async () => {
    api.getJob.mockResolvedValue({ data: { ...JOB, video_url: 'javascript:alert(1)' } });
    const res = await request(app).get('/jobs/31');
    expect(res.text).not.toContain('javascript:alert(1)');
  });
});

describe('2. job templates', () => {
  const TEMPLATES = { data: [
    { id: 5, name: 'Gardener role', user_id: 7, is_public: false },
    { id: 6, name: 'Shared driver role', user_id: 12, is_public: true }
  ] };

  it('lists templates with a use link, and a delete button only for your own', async () => {
    jobApi({ 'GET /templates': TEMPLATES });
    const res = await request(app).get('/jobs/create');
    expect(res.text).toContain(t('govuk_alpha_jobs.posting.templates_heading'));
    expect(res.text).toContain('Gardener role');
    expect(res.text).toContain('Shared driver role');
    expect(res.text).toContain('href="/jobs/create?template=5"');
    expect(res.text).toContain('href="/jobs/create?template=6"');
    expect(res.text).toContain('action="/jobs/templates/5/delete"');
    expect(res.text).not.toContain('action="/jobs/templates/6/delete"');
  });

  it('hides the template list when templates are switched off', async () => {
    const { ApiError } = api;
    jobApi({ 'GET /templates': new ApiError('off', 403) });
    const res = await request(app).get('/jobs/create');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(t('govuk_alpha_jobs.posting.templates_heading'));
    expect(res.text).not.toContain(t('govuk_alpha_jobs.posting.template_save_button'));
  });

  it('fills the form from a chosen template', async () => {
    jobApi({
      'GET /templates': TEMPLATES,
      'GET /templates/5': { data: { template: {
        id: 5, name: 'Gardener role', type: 'volunteer', commitment: 'flexible', description: 'Template description',
        skills_required: 'Pruning', is_remote: true, hours_per_week: 6, tagline: 'Template tagline', benefits: ['Tea', 'Cake'],
        salary_currency: 'EUR'
      } } }
    });
    const res = await request(app).get('/jobs/create?template=5');
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_jobs.posting.template_loaded'));
    expect(res.text).toContain('Template description</textarea>');
    expect(res.text).toContain('value="Pruning"');
    expect(res.text).toContain('value="Template tagline"');
    expect(res.text).toContain('Tea\nCake</textarea>');
    expect(res.text).toMatch(/name="is_remote" type="checkbox" value="1" checked/);
    expect(res.text).toContain('value="6"');
  });

  it('says so when a template cannot be loaded', async () => {
    const { ApiError } = api;
    jobApi({ 'GET /templates': TEMPLATES, 'GET /templates/9': new ApiError('gone', 404) });
    const res = await request(app).get('/jobs/create?template=9');
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_jobs.posting.template_load_failed'));
  });

  it('saves the form as a template without posting it, and keeps the form', async () => {
    jobApi({ 'POST /templates': { data: { template: { id: 8 } } } });
    const res = await request(app).post('/jobs').type('form').send({
      ...BASE_FORM, intent: 'save_template', template_name: ' Gardener ', template_public: '1',
      skills_required: 'Pruning', salary_min: '10', tagline: 'Hello', benefits: 'Tea\nCake', hours_per_week: ''
    });
    expect(res.headers.location).toBe('/jobs/create?status=template-saved');
    expect(callsTo('POST', '')).toHaveLength(0);
    expect(callsTo('POST', '/check-duplicate')).toHaveLength(0);
    const [[, , , payload]] = callsTo('POST', '/templates');
    expect(payload).toEqual(expect.objectContaining({
      name: 'Gardener',
      is_public: true,
      type: 'paid',
      commitment: 'part_time',
      description: 'Help with the garden.',
      skills_required: 'Pruning',
      salary_min: '10',
      tagline: 'Hello',
      benefits: ['Tea', 'Cake']
    }));
    expect(payload).not.toHaveProperty('hours_per_week');
    const replay = await request(app).get('/jobs/create?status=template-saved');
    expect(replay.text).toContain(t('govuk_alpha_jobs.posting.template_saved'));
    expect(replay.text).toContain('value="Garden helper"');
  });

  it('asks for a template name before saving', async () => {
    const res = await request(app).post('/jobs').type('form').send({ ...BASE_FORM, intent: 'save_template', template_name: '  ' });
    expect(res.headers.location).toBe('/jobs/create?status=template-name-required');
    expect(callsTo('POST', '/templates')).toHaveLength(0);
    const replay = await request(app).get('/jobs/create?status=template-name-required');
    expect(replay.text).toContain('href="#template_name"');
    expect(replay.text).toContain('value="Garden helper"');
  });

  it('saves a template from the edit form and returns to it', async () => {
    jobApi({ 'POST /templates': { data: { template: { id: 8 } } } });
    const res = await request(app).post('/jobs/31/update').type('form').send({ ...BASE_FORM, intent: 'save_template', template_name: 'Copy' });
    expect(res.headers.location).toBe('/jobs/31/edit?status=template-saved');
    expect(callsTo('PUT', '/31')).toHaveLength(0);
  });

  it('deletes one of your templates', async () => {
    jobApi({ 'DELETE /templates/5': { data: { success: true } } });
    const res = await request(app).post('/jobs/templates/5/delete').type('form').send({});
    expect(res.headers.location).toBe('/jobs/create?status=template-deleted');
    expect(callsTo('DELETE', '/templates/5')).toHaveLength(1);
  });

  it('reports a failed delete', async () => {
    const { ApiError } = api;
    jobApi({ 'DELETE /templates/6': new ApiError('not yours', 404) });
    const res = await request(app).post('/jobs/templates/6/delete').type('form').send({});
    expect(res.headers.location).toBe('/jobs/create?status=template-delete-failed');
  });
});

describe('3. duplicate-advert warning', () => {
  const DUPLICATES = { data: { duplicates: [{ id: 12, title: 'Garden helper wanted', status: 'open', similarity: 0.8 }] } };

  it('stops before posting and shows the similar advert, keeping every field', async () => {
    jobApi({ 'POST /check-duplicate': DUPLICATES });
    const res = await request(app).post('/jobs').type('form').send({
      ...BASE_FORM, tagline: 'Keep "me" safe', benefits: 'Tea\nCake', 'deadline-day': '1', 'deadline-month': '12', 'deadline-year': '2026'
    });
    expect(res.status).toBe(200);
    expect(callsTo('POST', '')).toHaveLength(0);
    const [[, , , check]] = callsTo('POST', '/check-duplicate');
    expect(check).toEqual({ title: 'Garden helper' });
    expect(res.text).toContain(t('govuk_alpha_jobs.posting.duplicate_title'));
    expect(res.text).toContain('href="/jobs/12"');
    expect(res.text).toContain('Garden helper wanted');
    expect(res.text).toContain('name="confirm_duplicate" value="1"');
    expect(res.text).toContain('name="title" value="Garden helper"');
    expect(res.text).toContain('name="tagline" value="Keep &quot;me&quot; safe"');
    expect(res.text).toContain('name="benefits" value="Tea\nCake"');
    expect(res.text).toContain('name="deadline-month" value="12"');
    expect(res.text).toContain('name="posting_extras" value="1"');
    expect(res.text).toContain(t('govuk_alpha_jobs.posting.duplicate_post_anyway'));
    expect(res.text).toContain(t('govuk_alpha_jobs.posting.duplicate_go_back'));
  });

  it('posts once the member confirms', async () => {
    jobApi({ 'POST /check-duplicate': DUPLICATES, 'POST ': { data: { id: 60 } } });
    const res = await request(app).post('/jobs').type('form').send({ ...BASE_FORM, confirm_duplicate: '1' });
    expect(res.headers.location).toBe('/jobs/60?status=created');
    expect(callsTo('POST', '/check-duplicate')).toHaveLength(0);
  });

  it('goes back to the form with everything kept', async () => {
    const res = await request(app).post('/jobs').type('form').send({ ...BASE_FORM, intent: 'edit', confirm_duplicate: '1', tagline: 'Kept' });
    expect(res.headers.location).toBe('/jobs/create');
    expect(api.callJobApi).not.toHaveBeenCalled();
    const replay = await request(app).get('/jobs/create');
    expect(replay.text).toContain('value="Garden helper"');
    expect(replay.text).toContain('value="Kept"');
  });

  it('posts normally when the duplicate check is unavailable', async () => {
    const { ApiError } = api;
    jobApi({ 'POST /check-duplicate': new ApiError('down', 500), 'POST ': { data: { id: 61 } } });
    const res = await request(app).post('/jobs').type('form').send(BASE_FORM);
    expect(res.headers.location).toBe('/jobs/61?status=created');
  });
});

describe('5. suggested pay range (React CreateJobPage salary benchmark, W3, 29 Oct 2026)', () => {
  it('shows the market rate for the advert title on the edit form', async () => {
    jobApi({ 'GET /salary-benchmark?title=Garden%20helper': { data: { benchmark: {
      role_keyword: 'gardener', salary_min: 12, salary_max: 18, salary_median: 15, salary_type: 'hourly', currency: 'EUR'
    } } } });
    const res = await request(app).get('/jobs/31/edit');
    expect(res.status).toBe(200);
    expect(res.text).toContain('id="salary-benchmark"');
    expect(res.text).toMatch(/Typical pay for similar roles \(gardener\): €12(\.00)? to €18(\.00)?, Per hour\. Middle of the range: €15/);
  });

  it('shows nothing when Laravel has no benchmark or the lookup fails', async () => {
    jobApi({ 'GET /salary-benchmark?title=Garden%20helper': { data: { benchmark: null } } });
    expect((await request(app).get('/jobs/31/edit')).text).not.toContain('id="salary-benchmark"');
    jobApi({ 'GET /salary-benchmark?title=Garden%20helper': new api.ApiError('down', 500) });
    const res = await request(app).get('/jobs/31/edit');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('id="salary-benchmark"');
  });
});
