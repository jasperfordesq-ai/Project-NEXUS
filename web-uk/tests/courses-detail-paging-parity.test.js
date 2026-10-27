// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Courses parity fixes (React CoursesPage / CourseDetailPage / CoursePlayerPage
 * against the accessible pages, 27 Oct 2026).
 *
 * a. Browse follows the API's page-based meta (GET /v2/courses is a
 *    respondWithPaginatedCollection) instead of stopping at one page.
 * b. Course detail: an enrolled member gets a "Continue learning" link, the
 *    author gets "Edit course", enrolment is withheld while a listed
 *    prerequisite is incomplete, and the COURSE_NOT_AVAILABLE /
 *    PREREQUISITES_NOT_MET refusals get their own messages.
 * c. A locked lesson says when it unlocks (progress availability.unlock_at).
 * d. A slug link (/courses/intro-to-gardening) resolves through
 *    GET /v2/courses/{idOrSlug} to the numeric page; numeric ids keep working.
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
  id: 42, slug: 'intro-to-gardening', title: 'Intro to gardening', author_user_id: 7,
  status: 'published', moderation_status: 'approved', credit_cost: 0,
  sections: [{ id: 1, title: 'Basics', lessons: [{ id: 11, title: 'Soil', content_type: 'text' }, { id: 12, title: 'Seeds', content_type: 'text' }] }],
};

function routeApi(handlers) {
  api.callCourseApi.mockImplementation(async (token, method, apiPath) => {
    for (const [pattern, handler] of handlers) {
      if (pattern.test(`${method} ${apiPath}`)) return handler();
    }
    return { data: [] };
  });
}

function notEnrolled() {
  return new api.ApiError('not enrolled', 404, { errors: [{ code: 'NOT_ENROLLED' }] });
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getProfile.mockResolvedValue({ data: { id: 99 } });
});

describe('a. browse paging', () => {
  it('asks for the requested page and links to the next one', async () => {
    routeApi([
      [/^GET \?/, () => ({ data: [{ id: 1, title: 'A course' }], meta: { current_page: 1, per_page: 12, total: 30, total_pages: 3, has_more: true } })],
      [/^GET \/categories/, () => ({ data: [] })],
    ]);
    const res = await request(app).get('/courses?q=garden');
    expect(res.status).toBe(200);
    const browseCall = api.callCourseApi.mock.calls.find(([, m, p]) => m === 'GET' && p.startsWith('?'));
    // Page 1 is the API default, so the first request is unchanged.
    expect(browseCall[2]).not.toMatch(/[?&]page=/);
    expect(res.text).toContain('class="govuk-pagination');
    expect(res.text).toMatch(/q=garden&amp;page=2/);
    expect(res.text).not.toContain('rel="prev"');
  });

  it('passes ?page through and offers a previous link', async () => {
    routeApi([
      [/^GET \?/, () => ({ data: [{ id: 1, title: 'A course' }], meta: { current_page: 3, per_page: 12, total: 30, total_pages: 3, has_more: false } })],
    ]);
    const res = await request(app).get('/courses?page=3');
    const browseCall = api.callCourseApi.mock.calls.find(([, m, p]) => m === 'GET' && p.startsWith('?'));
    expect(browseCall[2]).toMatch(/[?&]page=3(&|$)/);
    expect(res.text).toContain('rel="prev"');
    expect(res.text).not.toContain('rel="next"');
  });

  it('shows no pagination for a single page', async () => {
    routeApi([[/^GET \?/, () => ({ data: [{ id: 1, title: 'A course' }], meta: { current_page: 1, total_pages: 1, has_more: false } })]]);
    const res = await request(app).get('/courses');
    expect(res.text).not.toContain('class="govuk-pagination');
  });
});

describe('b. course detail actions', () => {
  it('gives an enrolled member a Continue learning link to the lesson player', async () => {
    routeApi([
      [/^GET \/42$/, () => ({ data: { ...COURSE, is_enrolled: true } })],
      [/^GET \/42\/progress$/, () => ({ data: { enrollment: { status: 'active', progress_percent: 50 }, lessons: [], availability: [] } })],
    ]);
    const res = await request(app).get('/courses/42');
    expect(res.text).toContain('href="/courses/42/learn"');
    expect(res.text).toContain(t('govuk_alpha_courses.continue_learning'));
  });

  it('gives the course author an Edit course link and no enrol button', async () => {
    api.getProfile.mockResolvedValue({ data: { id: 7 } });
    routeApi([
      [/^GET \/42$/, () => ({ data: COURSE })],
      [/^GET \/42\/progress$/, () => { throw notEnrolled(); }],
    ]);
    const res = await request(app).get('/courses/42');
    expect(res.text).toContain('href="/courses/instructor/42/edit"');
    expect(res.text).toContain(t('govuk_alpha_courses.edit_course'));
    expect(res.text).not.toContain('/courses/42/enrol');
  });

  it('withholds enrolment and says why while a prerequisite is incomplete', async () => {
    routeApi([
      [/^GET \/42$/, () => ({ data: COURSE })],
      [/^GET \/42\/prerequisites$/, () => ({ data: [{ id: 5, title: 'Composting', completed: false }] })],
      [/^GET \/42\/progress$/, () => { throw notEnrolled(); }],
    ]);
    const res = await request(app).get('/courses/42');
    expect(res.text).not.toContain('action="/courses/42/enrol"');
    expect(res.text).toContain(t('govuk_alpha_courses.prerequisites_required'));
  });

  it('offers enrolment when every listed prerequisite is complete', async () => {
    routeApi([
      [/^GET \/42$/, () => ({ data: COURSE })],
      [/^GET \/42\/prerequisites$/, () => ({ data: [{ id: 5, title: 'Composting', completed: true }] })],
      [/^GET \/42\/progress$/, () => { throw notEnrolled(); }],
    ]);
    const res = await request(app).get('/courses/42');
    expect(res.text).toContain('action="/courses/42/enrol"');
  });

  it.each([
    ['COURSE_NOT_AVAILABLE', 'not-available', 'govuk_alpha_courses.status.not_available'],
    ['PREREQUISITES_NOT_MET', 'prerequisites-not-met', 'govuk_alpha_courses.status.prerequisites_not_met'],
  ])('explains the %s refusal', async (code, status, key) => {
    api.callCourseApi.mockRejectedValueOnce(new api.ApiError('refused', 422, { errors: [{ code }] }));
    const post = await request(app).post('/courses/42/enrol');
    expect(post.status).toBe(302);
    expect(post.headers.location).toBe(`/courses/42?status=${status}`);

    routeApi([
      [/^GET \/42$/, () => ({ data: COURSE })],
      [/^GET \/42\/progress$/, () => { throw notEnrolled(); }],
    ]);
    const res = await request(app).get(post.headers.location);
    expect(res.text).toContain(t(key));
  });
});

describe('c. locked lesson unlock date', () => {
  it('says when a locked lesson becomes available', async () => {
    routeApi([
      [/^GET \/42$/, () => ({ data: { ...COURSE, is_enrolled: true } })],
      [/^GET \/42\/progress$/, () => ({ data: {
        enrollment: { status: 'active', progress_percent: 0 },
        lessons: [],
        availability: [
          { lesson_id: 11, available: true, unlock_at: null },
          { lesson_id: 12, available: false, unlock_at: '2027-03-05T09:00:00+00:00' },
        ],
      } })],
    ]);
    const res = await request(app).get('/courses/42/learn');
    expect(res.status).toBe(200);
    expect(res.text).toContain('5 March 2027');
    expect(res.text).toContain(t('govuk_alpha_courses.locked_until', { date: '5 March 2027' }));
  });
});

describe('d. slug links', () => {
  it('resolves a slug to the numeric course page', async () => {
    routeApi([[/^GET \/intro-to-gardening$/, () => ({ data: COURSE })]]);
    const res = await request(app).get('/courses/intro-to-gardening');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/courses/42');
  });

  it('answers 404 for an unknown slug', async () => {
    routeApi([[/^GET \/no-such-course$/, () => { throw new api.ApiError('missing', 404, {}); }]]);
    const res = await request(app).get('/courses/no-such-course');
    expect(res.status).toBe(404);
  });

  it('never forwards an encoded path in a slug', async () => {
    const res = await request(app).get('/courses/a%2f..%2fadmin');
    expect(res.status).toBe(404);
    expect(api.callCourseApi).not.toHaveBeenCalled();
  });

  it('keeps the literal sub-pages and numeric ids working', async () => {
    api.getMyCourses.mockResolvedValue({ data: [] });
    const mine = await request(app).get('/courses/mine');
    expect(mine.status).toBe(200);
    routeApi([[/^GET \/42$/, () => ({ data: COURSE })], [/^GET \/42\/progress$/, () => { throw notEnrolled(); }]]);
    const numeric = await request(app).get('/courses/42');
    expect(numeric.status).toBe(200);
  });
});
