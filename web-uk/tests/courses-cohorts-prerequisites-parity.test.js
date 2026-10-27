// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Course authoring parity with React CreateCoursePage, 27 Oct 2026 (deep audit
 * B, items C4 and C4b).
 *
 * 6. A cohort-paced course lists its cohorts (GET /v2/courses/{id}/cohorts) and
 *    the author can add one (POST /v2/courses/{id}/cohorts { name }).
 * 7. The course form sets prerequisite courses. React sends `prerequisites` as
 *    an array of course ids on create and update; here the author ticks them.
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
    callCourseApi: jest.fn(),
    getMyCourses: jest.fn(),
    getProfile: jest.fn(),
  }, {
    get: (target, prop) => (prop in target ? target[prop] : jest.fn().mockResolvedValue({ data: [] })),
  });
});

const api = require('../src/lib/api');
const coursesRoutes = require('../src/routes/courses');

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
    req.session = {};
    res.locals.urlFor = (v) => String(v || '/');
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS', tenantName: 'Test', isAuthenticated: true, csrfToken: 'csrf',
      t, tc: createChoiceTranslator('en'), htmlLang: 'en', htmlDirection: 'ltr',
    });
    next();
  });
  app.use('/courses', coursesRoutes);
  return app;
}

const app = mount();

const COURSE = {
  id: 42, title: 'Intro to gardening', author_user_id: 7, status: 'draft', moderation_status: 'pending',
  enrollment_type: 'self_paced', prerequisites: [5], sections: []
};

function routeApi(handlers) {
  api.callCourseApi.mockImplementation(async (token, method, apiPath, data) => {
    for (const [pattern, handler] of handlers) {
      if (pattern.test(`${method} ${apiPath}`)) return handler(data);
    }
    return { data: [] };
  });
}

function editHandlers(course = COURSE, extra = []) {
  return [
    ...extra,
    [/^GET \/42$/, () => ({ data: course })],
    [/^GET \/42\/prerequisites$/, () => ({ data: [{ id: 5, title: 'Soil basics', completed: false }] })],
    [/^GET \/mine$/, () => ({ data: [{ id: 42, title: 'Intro to gardening' }, { id: 6, title: 'Composting' }] })],
    [/^GET \?/, () => ({ data: [{ id: 5, title: 'Soil basics' }, { id: 8, title: 'Pruning' }] })],
  ];
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getProfile.mockResolvedValue({ data: { id: 7 } });
});

describe('7. prerequisites on the course form', () => {
  it('offers other courses as prerequisites, ticking the current ones and leaving out this course', async () => {
    routeApi(editHandlers());
    const res = await request(app).get('/courses/instructor/42/edit');
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_courses.authoring.prerequisites_legend'));
    expect(res.text).toMatch(/name="prerequisites" type="checkbox" value="5" checked/);
    expect(res.text).toMatch(/name="prerequisites" type="checkbox" value="6"(?! checked)/);
    expect(res.text).toMatch(/name="prerequisites" type="checkbox" value="8"(?! checked)/);
    expect(res.text).not.toMatch(/name="prerequisites" type="checkbox" value="42"/);
    expect(res.text).toContain('Composting');
    expect(res.text).toContain('Pruning');
  });

  it('saves the ticked prerequisites as course ids', async () => {
    routeApi(editHandlers());
    await request(app).post('/courses/instructor/42/update').type('form')
      .send('title=Intro&prerequisites_field=1&prerequisites=6&prerequisites=8&prerequisites=42&prerequisites=bad');
    const put = api.callCourseApi.mock.calls.find(([, m]) => m === 'PUT');
    expect(put[2]).toBe('/42');
    expect(put[3].prerequisites).toEqual([6, 8]);
  });

  it('clears prerequisites when none are ticked', async () => {
    routeApi(editHandlers());
    await request(app).post('/courses/instructor/42/update').type('form').send('title=Intro&prerequisites_field=1');
    const put = api.callCourseApi.mock.calls.find(([, m]) => m === 'PUT');
    expect(put[3].prerequisites).toEqual([]);
  });

  it('leaves prerequisites untouched when the form did not carry the field', async () => {
    routeApi(editHandlers());
    await request(app).post('/courses/instructor/42/update').type('form').send('title=Intro');
    const put = api.callCourseApi.mock.calls.find(([, m]) => m === 'PUT');
    expect(put[3]).not.toHaveProperty('prerequisites');
  });

  it('sends prerequisites on create too', async () => {
    routeApi([[/^POST $/, () => ({ data: { id: 50 } })]]);
    await request(app).post('/courses/instructor/new').type('form').send('title=New&prerequisites_field=1&prerequisites=5');
    const post = api.callCourseApi.mock.calls.find(([, m]) => m === 'POST');
    expect(post[3].prerequisites).toEqual([5]);
  });
});

describe('6. cohorts', () => {
  it('lists cohorts and offers to add one on a cohort-paced course', async () => {
    routeApi(editHandlers({ ...COURSE, enrollment_type: 'cohort' }, [
      [/^GET \/42\/cohorts$/, () => ({ data: [{ id: 1, name: 'Spring group', start_date: '2027-03-01' }] })],
    ]));
    const res = await request(app).get('/courses/instructor/42/edit');
    expect(res.text).toContain(t('govuk_alpha_courses.authoring.cohorts_heading'));
    expect(res.text).toContain('Spring group');
    expect(res.text).toContain('action="/courses/instructor/42/cohorts"');
  });

  it('says when there are no cohorts yet', async () => {
    routeApi(editHandlers({ ...COURSE, enrollment_type: 'cohort' }, [[/^GET \/42\/cohorts$/, () => ({ data: [] })]]));
    const res = await request(app).get('/courses/instructor/42/edit');
    expect(res.text).toContain(t('govuk_alpha_courses.authoring.no_cohorts'));
  });

  it('does not show cohorts on a self-paced course', async () => {
    routeApi(editHandlers());
    const res = await request(app).get('/courses/instructor/42/edit');
    expect(res.text).not.toContain('/courses/instructor/42/cohorts');
    expect(api.callCourseApi).not.toHaveBeenCalledWith('token:test', 'GET', '/42/cohorts');
  });

  it('adds a cohort', async () => {
    routeApi([[/^POST \/42\/cohorts$/, () => ({ data: { id: 2, name: 'Autumn group' } })]]);
    const res = await request(app).post('/courses/instructor/42/cohorts').type('form').send({ cohort_name: ' Autumn group ' });
    expect(api.callCourseApi).toHaveBeenCalledWith('token:test', 'POST', '/42/cohorts', { name: 'Autumn group' });
    expect(res.headers.location).toBe('/courses/instructor/42/edit?status=cohort-added');
  });

  it('refuses an empty cohort name before calling the API', async () => {
    routeApi([]);
    const res = await request(app).post('/courses/instructor/42/cohorts').type('form').send({ cohort_name: '  ' });
    expect(api.callCourseApi).not.toHaveBeenCalled();
    expect(res.headers.location).toBe('/courses/instructor/42/edit?status=cohort-name-missing');
  });

  it('reports a failed add', async () => {
    routeApi([[/^POST \/42\/cohorts$/, () => { throw new api.ApiError('no', 403); }]]);
    const res = await request(app).post('/courses/instructor/42/cohorts').type('form').send({ cohort_name: 'X' });
    expect(res.headers.location).toBe('/courses/instructor/42/edit?status=cohort-failed');
  });

  it('shows the cohort status messages', async () => {
    routeApi(editHandlers({ ...COURSE, enrollment_type: 'cohort' }, [[/^GET \/42\/cohorts$/, () => ({ data: [] })]]));
    const added = await request(app).get('/courses/instructor/42/edit?status=cohort-added');
    expect(added.text).toContain(t('govuk_alpha_courses.status.cohort_added'));
    const missing = await request(app).get('/courses/instructor/42/edit?status=cohort-name-missing');
    expect(missing.text).toContain(t('govuk_alpha_courses.status.cohort_name_missing'));
  });
});
