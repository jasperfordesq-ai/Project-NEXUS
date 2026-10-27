// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Employer hiring tools parity with React (JobKanbanPage, JobPipelineRules,
 * CreateJobPage hiring team), 27 Oct 2026. HTML-first: no drag and drop, no
 * modal — every tool is a page with a form.
 *
 * 1. Interviews: the vacancy owner schedules one (type, date and time, duration,
 *    location) through POST /v2/jobs/applications/{id}/interview, then moves the
 *    candidate to "interview" as React does. The time is sent with no offset,
 *    exactly like React's datetime-local value.
 * 2. Offers: the owner sends one (salary, currency, period, start date, message)
 *    through POST /v2/jobs/applications/{id}/offer, then moves the candidate to
 *    "offer".
 * 3. Scorecards: five criteria scored 1 to 10 plus notes, PUT .../scorecard.
 * 4. Bulk status: tick several candidates, choose a stage, one submit.
 * 5. Activity log: GET /v2/jobs/{id}/audit-trail, 50 a page.
 * 6. Hiring team: the owner lists, adds and removes co-reviewers.
 * 7. Automation rules: list, add and delete (with a confirmation page).
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
    searchUsers: jest.fn(),
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

const OWNER_ID = 7;
const JOB = { id: 31, title: 'Garden helper', type: 'timebank', status: 'open', user_id: OWNER_ID };
const APPLICATIONS = [
  { id: 501, status: 'screening', stage: 'screening', created_at: '2026-10-01', applicant: { id: 40, name: 'Ada Lovelace' } },
  { id: 502, status: 'interview', stage: 'interview', created_at: '2026-10-02', applicant: { id: 41, name: 'Candidate #2' } },
  { id: 503, status: 'applied', stage: 'applied', created_at: '2026-10-03', applicant: { id: 42, name: 'Grace Hopper' } },
];

// Route each mocked API call by method + path so a page that makes several
// calls gets the right answer for each.
let routes;
function routeApi(method, pathPrefix, handler) {
  routes.push({ method, pathPrefix, handler });
}

beforeEach(() => {
  jest.clearAllMocks();
  routes = [];
  api.getJob.mockResolvedValue({ data: JOB });
  api.getProfile.mockResolvedValue({ data: { id: OWNER_ID } });
  api.searchUsers.mockResolvedValue({ data: { items: [] } });
  api.callJobApi.mockImplementation(async (token, method, apiPath) => {
    const match = routes.find((r) => r.method === method && apiPath.startsWith(r.pathPrefix));
    if (match) return match.handler(apiPath);
    if (method === 'GET' && apiPath === '/31/applications') return { data: APPLICATIONS };
    return { data: {} };
  });
});

function callsTo(method, apiPath) {
  return api.callJobApi.mock.calls.filter((c) => c[1] === method && c[2] === apiPath);
}

describe('pipeline page links every tool', () => {
  it('offers the owner interview (screening), offer (interview) and scorecard actions', async () => {
    const res = await request(app).get('/jobs/31/pipeline');
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="/jobs/31/applications/501/interview"');
    expect(res.text).not.toContain('href="/jobs/31/applications/503/interview"');
    expect(res.text).toContain('href="/jobs/31/applications/502/offer"');
    expect(res.text).not.toContain('href="/jobs/31/applications/501/offer"');
    expect(res.text).toContain('href="/jobs/31/applications/501/scorecard"');
    expect(res.text).toContain('href="/jobs/31/activity"');
    expect(res.text).toContain('href="/jobs/31/rules"');
    expect(res.text).toContain('href="/jobs/31/team"');
  });

  it('does not offer interview, offer or team management to a hiring-team member', async () => {
    api.getProfile.mockResolvedValue({ data: { id: 99 } });
    const res = await request(app).get('/jobs/31/pipeline');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('/interview"');
    expect(res.text).not.toContain('/offer"');
    expect(res.text).not.toContain('href="/jobs/31/team"');
    expect(res.text).toContain('href="/jobs/31/applications/501/scorecard"');
  });

  it('renders one bulk form with a checkbox per candidate tied to it', async () => {
    const res = await request(app).get('/jobs/31/pipeline');
    expect(res.text).toContain('id="bulk-status-form"');
    expect(res.text).toContain('action="/jobs/31/applications/bulk-status"');
    expect(res.text).toMatch(/name="application_ids" value="501"[^>]*form="bulk-status-form"/);
    expect(res.text).toMatch(/name="application_ids" value="503"[^>]*form="bulk-status-form"/);
    // React's bulk choices.
    ['screening', 'reviewed', 'interview', 'rejected'].forEach((stage) => {
      expect(res.text).toContain(`<option value="${stage}">`);
    });
  });

  it('shows blind-hiring labels exactly as the API returns them', async () => {
    const res = await request(app).get('/jobs/31/pipeline');
    expect(res.text).toContain('Candidate #2');
  });
});

describe('4. bulk status change', () => {
  it('sends the ticked ids and the stage in one POST', async () => {
    const res = await request(app)
      .post('/jobs/31/applications/bulk-status')
      .type('form')
      .send('application_ids=501&application_ids=503&bulk_status=rejected');
    expect(callsTo('POST', '/31/applications/bulk-status')[0][3]).toEqual({ application_ids: [501, 503], status: 'rejected' });
    expect(res.headers.location).toBe('/jobs/31/pipeline?status=bulk-updated');
    const page = await request(app).get(res.headers.location);
    expect(page.text).toContain(t('govuk_alpha_jobs.hiring.bulk_updated'));
  });

  it('accepts a single ticked candidate', async () => {
    await request(app).post('/jobs/31/applications/bulk-status').type('form').send('application_ids=501&bulk_status=screening');
    expect(callsTo('POST', '/31/applications/bulk-status')[0][3]).toEqual({ application_ids: [501], status: 'screening' });
  });

  it('asks for a candidate when none is ticked, without calling the API', async () => {
    const res = await request(app).post('/jobs/31/applications/bulk-status').type('form').send('bulk_status=rejected');
    expect(callsTo('POST', '/31/applications/bulk-status')).toHaveLength(0);
    expect(res.headers.location).toBe('/jobs/31/pipeline?status=bulk-none-selected');
    const page = await request(app).get(res.headers.location);
    expect(page.text).toContain(t('govuk_alpha_jobs.hiring.bulk_none_selected'));
  });

  it('asks for a stage React offers', async () => {
    const res = await request(app).post('/jobs/31/applications/bulk-status').type('form').send('application_ids=501&bulk_status=accepted');
    expect(callsTo('POST', '/31/applications/bulk-status')).toHaveLength(0);
    expect(res.headers.location).toBe('/jobs/31/pipeline?status=bulk-stage-required');
  });

  it('reports a refused bulk update', async () => {
    routeApi('POST', '/31/applications/bulk-status', async () => { throw new api.ApiError('no', 422); });
    const res = await request(app).post('/jobs/31/applications/bulk-status').type('form').send('application_ids=501&bulk_status=rejected');
    expect(res.headers.location).toBe('/jobs/31/pipeline?status=bulk-failed');
  });
});

describe('1. interviews', () => {
  it('shows the owner the form for a candidate in the job', async () => {
    const res = await request(app).get('/jobs/31/applications/501/interview');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Ada Lovelace');
    expect(res.text).toContain('name="interview_type"');
    expect(res.text).toContain('name="scheduled_at-day"');
    expect(res.text).toContain('name="scheduled_at-time"');
    expect(res.text).toContain('name="duration_mins"');
    expect(res.text).toContain('name="location_notes"');
  });

  it('refuses a member who does not own the vacancy', async () => {
    api.getProfile.mockResolvedValue({ data: { id: 99 } });
    const res = await request(app).get('/jobs/31/applications/501/interview');
    expect(res.status).toBe(403);
  });

  it('is not found for an application outside the vacancy', async () => {
    const res = await request(app).get('/jobs/31/applications/999/interview');
    expect(res.status).toBe(404);
  });

  it('proposes the interview with no time-zone offset, then moves the candidate', async () => {
    const res = await request(app)
      .post('/jobs/31/applications/501/interview')
      .type('form')
      .send({
        interview_type: 'phone', 'scheduled_at-day': '3', 'scheduled_at-month': '4', 'scheduled_at-year': '2027',
        'scheduled_at-time': '14:30', duration_mins: '45', location_notes: 'Call my mobile'
      });
    expect(callsTo('POST', '/applications/501/interview')[0][3]).toEqual({
      interview_type: 'phone', scheduled_at: '2027-04-03T14:30', duration_mins: 45, location_notes: 'Call my mobile'
    });
    expect(callsTo('PUT', '/applications/501')[0][3]).toEqual({ status: 'interview' });
    expect(res.headers.location).toBe('/jobs/31/pipeline?status=interview-sent');
  });

  it('asks for the date before calling the API', async () => {
    const res = await request(app)
      .post('/jobs/31/applications/501/interview')
      .type('form')
      .send({ interview_type: 'video', 'scheduled_at-time': '14:30', duration_mins: '60' });
    expect(res.status).toBe(400);
    expect(callsTo('POST', '/applications/501/interview')).toHaveLength(0);
    expect(res.text).toContain('govuk-error-summary');
  });

  it('keeps what was typed and explains when the API refuses', async () => {
    routeApi('POST', '/applications/501/interview', async () => { throw new api.ApiError('no', 422); });
    const res = await request(app)
      .post('/jobs/31/applications/501/interview')
      .type('form')
      .send({
        interview_type: 'video', 'scheduled_at-day': '3', 'scheduled_at-month': '4', 'scheduled_at-year': '2027',
        'scheduled_at-time': '9:00', duration_mins: '90', location_notes: 'https://meet.example.test/a'
      });
    expect(res.status).toBe(422);
    expect(res.text).toContain(t('govuk_alpha_jobs.hiring.interview_failed'));
    expect(res.text).toContain('https://meet.example.test/a');
    expect(callsTo('PUT', '/applications/501')).toHaveLength(0);
  });
});

describe('2. offers', () => {
  it('shows the owner the offer form with React\'s fields', async () => {
    const res = await request(app).get('/jobs/31/applications/502/offer');
    expect(res.status).toBe(200);
    ['salary_offered', 'salary_currency', 'salary_type', 'start_date-day', 'message'].forEach((field) => {
      expect(res.text).toContain(`name="${field}"`);
    });
    expect(res.text).toContain('Candidate #2');
  });

  it('sends the offer in React\'s shape, then moves the candidate to "offer"', async () => {
    const res = await request(app)
      .post('/jobs/31/applications/502/offer')
      .type('form')
      .send({
        salary_offered: '45000', salary_currency: 'GBP', salary_type: 'annual',
        'start_date-day': '1', 'start_date-month': '6', 'start_date-year': '2027', message: 'Welcome aboard'
      });
    expect(callsTo('POST', '/applications/502/offer')[0][3]).toEqual({
      salary_offered: '45000', salary_currency: 'GBP', salary_type: 'annual', start_date: '2027-06-01', message: 'Welcome aboard'
    });
    expect(callsTo('PUT', '/applications/502')[0][3]).toEqual({ status: 'offer' });
    expect(res.headers.location).toBe('/jobs/31/pipeline?status=offer-sent');
  });

  it('allows an offer with no pay or start date, as React does', async () => {
    await request(app).post('/jobs/31/applications/502/offer').type('form')
      .send({ salary_offered: '', salary_currency: 'EUR', salary_type: 'hourly', message: '' });
    expect(callsTo('POST', '/applications/502/offer')[0][3]).toEqual({
      salary_offered: '', salary_currency: 'EUR', salary_type: 'hourly', start_date: '', message: ''
    });
  });

  it('rejects a negative salary without calling the API', async () => {
    const res = await request(app).post('/jobs/31/applications/502/offer').type('form')
      .send({ salary_offered: '-5', salary_currency: 'EUR', salary_type: 'annual' });
    expect(res.status).toBe(400);
    expect(callsTo('POST', '/applications/502/offer')).toHaveLength(0);
  });

  it('refuses a non-owner', async () => {
    api.getProfile.mockResolvedValue({ data: { id: 99 } });
    const res = await request(app).post('/jobs/31/applications/502/offer').type('form').send({ salary_currency: 'EUR', salary_type: 'annual' });
    expect(res.status).toBe(403);
    expect(callsTo('POST', '/applications/502/offer')).toHaveLength(0);
  });
});

describe('3. scorecards', () => {
  it('shows five criteria from 1 to 10 and notes, prefilled with my own saved card', async () => {
    routeApi('GET', '/applications/501/scorecards', async () => ({
      data: [
        { id: 1, reviewer_id: 99, criteria: [{ label: 'x', score: 1 }], notes: 'not mine' },
        { id: 2, reviewer_id: OWNER_ID, criteria: [{ score: 8 }, { score: 7 }, { score: 6 }, { score: 9 }, { score: 4 }], notes: 'Strong' },
      ]
    }));
    const res = await request(app).get('/jobs/31/applications/501/scorecard');
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_jobs.hiring.criterion_communication'));
    expect(res.text).toContain(t('govuk_alpha_jobs.hiring.criterion_motivation'));
    expect(res.text).toMatch(/name="score_0"[^>]*value="8"/);
    expect(res.text).toMatch(/name="score_4"[^>]*value="4"/);
    expect(res.text).toContain('Strong');
    expect(res.text).not.toContain('not mine');
  });

  it('defaults every score to 5 when I have not scored yet', async () => {
    const res = await request(app).get('/jobs/31/applications/501/scorecard');
    expect(res.text).toMatch(/name="score_2"[^>]*value="5"/);
  });

  it('is open to a hiring-team member (the API decides)', async () => {
    api.getProfile.mockResolvedValue({ data: { id: 99 } });
    const res = await request(app).get('/jobs/31/applications/501/scorecard');
    expect(res.status).toBe(200);
  });

  it('saves the scorecard with translated labels and max 10, like React', async () => {
    const res = await request(app).post('/jobs/31/applications/501/scorecard').type('form')
      .send({ score_0: '8', score_1: '7', score_2: '6', score_3: '9', score_4: '10', notes: 'Good fit' });
    expect(callsTo('PUT', '/applications/501/scorecard')[0][3]).toEqual({
      criteria: [
        { label: t('govuk_alpha_jobs.hiring.criterion_communication'), score: 8, max_score: 10 },
        { label: t('govuk_alpha_jobs.hiring.criterion_technical'), score: 7, max_score: 10 },
        { label: t('govuk_alpha_jobs.hiring.criterion_cultural_fit'), score: 6, max_score: 10 },
        { label: t('govuk_alpha_jobs.hiring.criterion_experience'), score: 9, max_score: 10 },
        { label: t('govuk_alpha_jobs.hiring.criterion_motivation'), score: 10, max_score: 10 },
      ],
      notes: 'Good fit'
    });
    expect(res.headers.location).toBe('/jobs/31/pipeline?status=scorecard-saved');
  });

  it('rejects a score outside 1 to 10', async () => {
    const res = await request(app).post('/jobs/31/applications/501/scorecard').type('form')
      .send({ score_0: '11', score_1: '7', score_2: '6', score_3: '9', score_4: '5' });
    expect(res.status).toBe(400);
    expect(callsTo('PUT', '/applications/501/scorecard')).toHaveLength(0);
  });
});

describe('5. activity log', () => {
  it('lists the vacancy audit trail, 50 a page', async () => {
    routeApi('GET', '/31/audit-trail', async () => ({
      data: [{ type: 'status_change', timestamp: '2026-10-20T10:00:00Z', actor: 'Jo Owner', description: 'Candidate #2 moved to interview', details: 'Looks good' }],
      meta: { total: 120 }
    }));
    const res = await request(app).get('/jobs/31/activity?page=2');
    expect(res.status).toBe(200);
    expect(callsTo('GET', '/31/audit-trail?page=2&limit=50')).toHaveLength(1);
    expect(res.text).toContain('Candidate #2 moved to interview');
    expect(res.text).toContain('Jo Owner');
    expect(res.text).toContain('Looks good');
    expect(res.text).toContain(t('govuk_alpha_jobs.hiring.event_status_change'));
    expect(res.text).toContain('href="/jobs/31/activity?page=1"');
    expect(res.text).toContain('href="/jobs/31/activity?page=3"');
  });

  it('says when there is no activity', async () => {
    routeApi('GET', '/31/audit-trail', async () => ({ data: [], meta: { total: 0 } }));
    const res = await request(app).get('/jobs/31/activity');
    expect(res.text).toContain(t('govuk_alpha_jobs.hiring.activity_empty'));
  });

  it('shows the forbidden page when the API refuses', async () => {
    routeApi('GET', '/31/audit-trail', async () => { throw new api.ApiError('no', 403); });
    const res = await request(app).get('/jobs/31/activity');
    expect(res.status).toBe(403);
  });
});

describe('6. hiring team', () => {
  beforeEach(() => {
    routeApi('GET', '/31/team', async () => ({
      data: [{ id: 3, vacancy_id: 31, user_id: 55, role: 'manager', user: { id: 55, first_name: 'Sam', last_name: 'Reviewer', email: 'sam@example.test' } }]
    }));
  });

  it('lists the team with roles and never shows email addresses', async () => {
    const res = await request(app).get('/jobs/31/team');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Sam Reviewer');
    expect(res.text).toContain(t('govuk_alpha_jobs.hiring.role_manager'));
    expect(res.text).not.toContain('sam@example.test');
    expect(res.text).toContain('href="/jobs/31/team/55/remove"');
  });

  it('is for the owner only', async () => {
    api.getProfile.mockResolvedValue({ data: { id: 99 } });
    const res = await request(app).get('/jobs/31/team');
    expect(res.status).toBe(403);
  });

  it('searches members and leaves out people already on the team and the owner', async () => {
    api.searchUsers.mockResolvedValue({ data: { items: [
      { id: 55, name: 'Sam Reviewer' }, { id: OWNER_ID, name: 'Me Myself' }, { id: 60, name: 'Lee New' }
    ] } });
    const res = await request(app).get('/jobs/31/team?q=le');
    expect(api.searchUsers).toHaveBeenCalledWith('token:test', 'le', { limit: 5 });
    expect(res.text).toContain('Lee New');
    expect(res.text).not.toContain('Me Myself');
    expect(res.text).toContain('name="user_id" value="60"');
  });

  it('adds a member with a role the API stores', async () => {
    const res = await request(app).post('/jobs/31/team').type('form').send({ user_id: '60', role: 'manager' });
    expect(callsTo('POST', '/31/team')[0][3]).toEqual({ user_id: 60, role: 'manager' });
    expect(res.headers.location).toBe('/jobs/31/team?status=team-added');
  });

  it('falls back to reviewer for an unknown role', async () => {
    await request(app).post('/jobs/31/team').type('form').send({ user_id: '60', role: 'god' });
    expect(callsTo('POST', '/31/team')[0][3]).toEqual({ user_id: 60, role: 'reviewer' });
  });

  it('asks before removing, then removes through DELETE', async () => {
    const confirm = await request(app).get('/jobs/31/team/55/remove');
    expect(confirm.status).toBe(200);
    expect(confirm.text).toContain('Sam Reviewer');
    expect(confirm.text).toContain('action="/jobs/31/team/55/remove"');
    expect(callsTo('DELETE', '/31/team/55')).toHaveLength(0);

    const res = await request(app).post('/jobs/31/team/55/remove');
    expect(callsTo('DELETE', '/31/team/55')).toHaveLength(1);
    expect(res.headers.location).toBe('/jobs/31/team?status=team-removed');
  });

  it('reports a failed add', async () => {
    routeApi('POST', '/31/team', async () => { throw new api.ApiError('no', 422); });
    const res = await request(app).post('/jobs/31/team').type('form').send({ user_id: '60', role: 'reviewer' });
    expect(res.headers.location).toBe('/jobs/31/team?status=team-add-failed');
  });
});

describe('7. automation rules', () => {
  beforeEach(() => {
    routeApi('GET', '/31/pipeline-rules', async () => ({
      data: [{ id: 12, name: 'Applied to Screening after 7d', trigger_stage: 'applied', condition_days: 7, action: 'move_stage', action_target: 'screening', is_active: true }]
    }));
  });

  it('lists rules and offers the add form', async () => {
    const res = await request(app).get('/jobs/31/rules');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Applied to Screening after 7d');
    expect(res.text).toContain('href="/jobs/31/rules/12/delete"');
    expect(res.text).toContain('name="trigger_stage"');
    expect(res.text).toContain('name="condition_days"');
    expect(res.text).toContain('name="action"');
    expect(res.text).toContain('name="action_target"');
  });

  it('creates a move rule with a generated name, as React does', async () => {
    const res = await request(app).post('/jobs/31/rules').type('form')
      .send({ trigger_stage: 'screening', condition_days: '10', action: 'move_stage', action_target: 'rejected' });
    expect(callsTo('POST', '/31/pipeline-rules')[0][3]).toEqual({
      name: t('govuk_alpha_jobs.hiring.rule_generated_name', {
        stage: t('govuk_alpha_jobs.stage.screening'), target: t('govuk_alpha_jobs.stage.rejected'), count: 10
      }),
      trigger_stage: 'screening', condition_days: 10, action: 'move_stage', action_target: 'rejected'
    });
    expect(res.headers.location).toBe('/jobs/31/rules?status=rule-added');
  });

  it('sends no target for a reject rule', async () => {
    await request(app).post('/jobs/31/rules').type('form')
      .send({ trigger_stage: 'applied', condition_days: '3', action: 'reject', action_target: 'screening' });
    expect(callsTo('POST', '/31/pipeline-rules')[0][3]).toMatchObject({ action: 'reject', action_target: null });
  });

  it('rejects zero days without calling the API', async () => {
    const res = await request(app).post('/jobs/31/rules').type('form')
      .send({ trigger_stage: 'applied', condition_days: '0', action: 'notify_reviewer' });
    expect(res.status).toBe(400);
    expect(callsTo('POST', '/31/pipeline-rules')).toHaveLength(0);
    expect(res.text).toContain(t('govuk_alpha_jobs.hiring.rule_days_invalid'));
  });

  it('asks before deleting, then deletes through DELETE /v2/jobs/pipeline-rules/{id}', async () => {
    const confirm = await request(app).get('/jobs/31/rules/12/delete');
    expect(confirm.status).toBe(200);
    expect(confirm.text).toContain('Applied to Screening after 7d');
    expect(callsTo('DELETE', '/pipeline-rules/12')).toHaveLength(0);
    const res = await request(app).post('/jobs/31/rules/12/delete');
    expect(callsTo('DELETE', '/pipeline-rules/12')).toHaveLength(1);
    expect(res.headers.location).toBe('/jobs/31/rules?status=rule-deleted');
  });

  it('is linked from the owner\'s opportunity page', async () => {
    const res = await request(app).get('/jobs/31');
    expect(res.text).toContain('href="/jobs/31/rules"');
  });
});
