// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Course parity with React, 27 Oct 2026 (deep audit B, items C1, C2, C3).
 *
 * 4. Lesson discussions in the lesson player (React LessonDiscussion): read,
 *    post, reply and delete your own comment.
 *    GET/POST /v2/courses/{id}/lessons/{lessonId}/discussions,
 *    DELETE /v2/courses/discussions/{id}.
 * 5. Quiz authoring (React CourseBuilder): a lesson can be a quiz, the quiz is
 *    created with POST /v2/courses/{id}/quizzes, and questions are added
 *    (POST .../quizzes/{quizId}/questions) and deleted (DELETE .../questions/{q}).
 *    Authored questions use the {id, label} options learners already answer.
 * 6. Builder extras: drip release (days after enrolment or a fixed date), the
 *    free-preview flag, and move up / move down for sections and lessons through
 *    PUT .../sections/reorder and PUT .../sections/{id}/lessons/reorder.
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
let session = {};

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
    req.session = session;
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
  id: 42,
  title: 'Intro to gardening',
  author_user_id: 7,
  status: 'draft',
  enrollment_type: 'self_paced',
  is_enrolled: true,
  sections: [
    {
      id: 5,
      title: 'Basics',
      lessons: [
        { id: 10, title: 'Welcome', content_type: 'text', body: '<p>Hello</p>' },
        { id: 11, title: 'Soil', content_type: 'text', body: '<p>Soil</p>', drip_type: 'days_after_enroll', drip_offset_days: 3, is_preview: true },
        { id: 77, title: 'Check your knowledge', content_type: 'quiz', quiz: { id: 51, title: 'Check your knowledge', pass_mark_percent: 70 } }
      ]
    },
    { id: 6, title: 'Advanced', lessons: [{ id: 20, title: 'Compost', content_type: 'text', drip_type: 'fixed_date', drip_date: '2026-12-01T00:00:00.000000Z' }] }
  ]
};

const DISCUSSIONS = { data: [
  {
    id: 301, user_id: 7, body: 'My first question', user: { id: 7, name: 'Ada Author' },
    replies: [{ id: 302, user_id: 9, body: 'A helpful reply', user: { id: 9, name: 'Ben Learner' } }]
  },
  { id: 303, user_id: 9, body: 'Another thought', user: { id: 9, name: 'Ben Learner' }, replies: [] }
] };

function routeApi(handlers) {
  api.callCourseApi.mockImplementation(async (token, method, apiPath, data) => {
    for (const [pattern, handler] of handlers) {
      if (pattern.test(`${method} ${apiPath}`)) {
        const value = typeof handler === 'function' ? handler(data) : handler;
        if (value instanceof Error) throw value;
        return value;
      }
    }
    return { data: [] };
  });
}

function baseHandlers(extra = []) {
  return [
    ...extra,
    [/^GET \/42$/, { data: COURSE }],
    [/^GET \/42\/progress$/, { data: { enrollment: { status: 'active', progress_percent: 10 } } }],
  ];
}

function callsTo(method, apiPath) {
  return api.callCourseApi.mock.calls.filter(([, m, p]) => m === method && p === apiPath);
}

beforeEach(() => {
  jest.clearAllMocks();
  session = {};
  api.getProfile.mockResolvedValue({ data: { id: 7 } });
});

describe('4. lesson discussions', () => {
  it('shows the discussion with replies, a post form, reply forms and delete only on your own comment', async () => {
    routeApi(baseHandlers([[/^GET \/42\/lessons\/10\/discussions$/, DISCUSSIONS]]));
    const res = await request(app).get('/courses/42/learn?lesson=10');
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_courses.discussion.heading'));
    expect(res.text).toContain('My first question');
    expect(res.text).toContain('A helpful reply');
    expect(res.text).toContain('Ben Learner');
    expect(res.text).toContain('action="/courses/42/lessons/10/discussions"');
    expect(res.text).toContain('name="parent_id" value="301"');
    expect(res.text).toContain('name="parent_id" value="303"');
    expect(res.text).toContain('action="/courses/42/lessons/10/discussions/301/delete"');
    expect(res.text).not.toContain('/discussions/302/delete');
    expect(res.text).not.toContain('/discussions/303/delete');
  });

  it('says when there are no comments yet', async () => {
    routeApi(baseHandlers([[/^GET \/42\/lessons\/10\/discussions$/, { data: [] }]]));
    const res = await request(app).get('/courses/42/learn?lesson=10');
    expect(res.text).toContain(t('govuk_alpha_courses.discussion.empty'));
  });

  it('keeps the lesson usable when the discussion cannot be loaded', async () => {
    const { ApiError } = api;
    routeApi(baseHandlers([[/^GET \/42\/lessons\/10\/discussions$/, new ApiError('down', 500)]]));
    const res = await request(app).get('/courses/42/learn?lesson=10');
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_courses.discussion.unavailable'));
    expect(res.text).not.toContain('action="/courses/42/lessons/10/discussions"');
  });

  it('posts a comment and a reply', async () => {
    routeApi([[/^POST \/42\/lessons\/10\/discussions$/, { data: { id: 400 } }]]);
    const first = await request(app).post('/courses/42/lessons/10/discussions').type('form').send({ body: '  Hello all  ' });
    expect(first.headers.location).toBe('/courses/42/learn?lesson=10&status=comment-posted#lesson-discussion');
    const reply = await request(app).post('/courses/42/lessons/10/discussions').type('form').send({ body: 'Thanks', parent_id: '301' });
    expect(reply.headers.location).toBe('/courses/42/learn?lesson=10&status=comment-posted#lesson-discussion');
    const posts = callsTo('POST', '/42/lessons/10/discussions');
    expect(posts[0][3]).toEqual({ body: 'Hello all' });
    expect(posts[1][3]).toEqual({ body: 'Thanks', parent_id: 301 });
  });

  it('refuses an empty comment without calling the API', async () => {
    routeApi([]);
    const res = await request(app).post('/courses/42/lessons/10/discussions').type('form').send({ body: '   ' });
    expect(res.headers.location).toBe('/courses/42/learn?lesson=10&status=comment-required#lesson-discussion');
    expect(api.callCourseApi).not.toHaveBeenCalled();
  });

  it('reports a failed post', async () => {
    const { ApiError } = api;
    routeApi([[/^POST /, new ApiError('no', 403)]]);
    const res = await request(app).post('/courses/42/lessons/10/discussions').type('form').send({ body: 'Hi' });
    expect(res.headers.location).toBe('/courses/42/learn?lesson=10&status=comment-failed#lesson-discussion');
  });

  it('deletes your own comment', async () => {
    routeApi([[/^DELETE \/discussions\/301$/, { data: { deleted: true } }]]);
    const res = await request(app).post('/courses/42/lessons/10/discussions/301/delete').type('form').send({ confirmed: '1' });
    expect(res.headers.location).toBe('/courses/42/learn?lesson=10&status=comment-deleted#lesson-discussion');
    expect(callsTo('DELETE', '/discussions/301')).toHaveLength(1);
  });

  it('shows the discussion status message on the lesson page', async () => {
    routeApi(baseHandlers([[/^GET \/42\/lessons\/10\/discussions$/, DISCUSSIONS]]));
    const res = await request(app).get('/courses/42/learn?lesson=10&status=comment-posted');
    expect(res.text).toContain(t('govuk_alpha_courses.discussion.comment_posted'));
  });

  it('rejects a non-numeric comment id', async () => {
    const res = await request(app).post('/courses/42/lessons/10/discussions/abc/delete').type('form').send({ confirmed: '1' });
    expect(res.status).toBe(404);
  });
});

describe('5. quiz authoring', () => {
  it('offers quiz as a lesson type in the builder', async () => {
    routeApi(baseHandlers());
    const res = await request(app).get('/courses/instructor/42/edit');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<option value="quiz">');
  });

  it('creates the quiz when a quiz lesson is added, then opens the lesson to add questions', async () => {
    routeApi([
      [/^POST \/42\/lessons$/, { data: { id: 88, title: 'Final check', content_type: 'quiz' } }],
      [/^POST \/42\/quizzes$/, { data: { id: 61 } }],
    ]);
    const res = await request(app).post('/courses/instructor/42/lessons').type('form').send({
      lesson_title: 'Final check', content_type: 'quiz', section_id: '5', quiz_pass_mark: '80', quiz_max_attempts: '3'
    });
    expect(res.headers.location).toBe('/courses/instructor/42/lessons/88/edit?status=lesson-added');
    const [[, , , quiz]] = callsTo('POST', '/42/quizzes');
    expect(quiz).toEqual({ lesson_id: 88, title: 'Final check', pass_mark_percent: 80, max_attempts: 3 });
  });

  it('uses the usual pass mark and unlimited attempts when none are given', async () => {
    routeApi([
      [/^POST \/42\/lessons$/, { data: { id: 88 } }],
      [/^POST \/42\/quizzes$/, { data: { id: 61 } }],
    ]);
    await request(app).post('/courses/instructor/42/lessons').type('form').send({ lesson_title: 'Q', content_type: 'quiz' });
    const [[, , , quiz]] = callsTo('POST', '/42/quizzes');
    expect(quiz).toEqual({ lesson_id: 88, title: 'Q', pass_mark_percent: 70, max_attempts: 0 });
  });

  it('says so when the lesson saved but the quiz could not be created', async () => {
    const { ApiError } = api;
    routeApi([
      [/^POST \/42\/lessons$/, { data: { id: 88 } }],
      [/^POST \/42\/quizzes$/, new ApiError('no', 500)],
    ]);
    const res = await request(app).post('/courses/instructor/42/lessons').type('form').send({ lesson_title: 'Q', content_type: 'quiz' });
    expect(res.headers.location).toBe('/courses/instructor/42/lessons/88/edit?status=lesson-quiz-failed');
  });

  it('creates a missing quiz when a lesson is changed to a quiz', async () => {
    routeApi(baseHandlers([
      [/^PUT \/42\/lessons\/10$/, { data: { id: 10 } }],
      [/^POST \/42\/quizzes$/, { data: { id: 62 } }],
    ]));
    await request(app).post('/courses/instructor/42/lessons/10/update').type('form').send({ lesson_title: 'Welcome', content_type: 'quiz' });
    const [[, , , quiz]] = callsTo('POST', '/42/quizzes');
    expect(quiz).toEqual(expect.objectContaining({ lesson_id: 10, title: 'Welcome' }));
  });

  it('does not create a second quiz for a lesson that already has one', async () => {
    routeApi(baseHandlers([[/^PUT \/42\/lessons\/77$/, { data: { id: 77 } }]]));
    await request(app).post('/courses/instructor/42/lessons/77/update').type('form').send({ lesson_title: 'Check', content_type: 'quiz' });
    expect(callsTo('POST', '/42/quizzes')).toHaveLength(0);
  });

  it('lists the questions on the lesson page with delete buttons and an add form', async () => {
    routeApi(baseHandlers([[/^GET \/quizzes\/51$/, { data: { id: 51, questions: [
      { id: 9, type: 'mcq', prompt: 'Which soil holds water?', options: [{ id: 'a', label: 'Clay' }, { id: 'b', label: 'Sand' }] }
    ] } }]]));
    const res = await request(app).get('/courses/instructor/42/lessons/77/edit');
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_courses.lesson_editor.quiz_heading'));
    expect(res.text).toContain('Which soil holds water?');
    expect(res.text).toContain('Clay');
    expect(res.text).toContain('action="/courses/instructor/42/lessons/77/questions/9/delete"');
    expect(res.text).toContain('action="/courses/instructor/42/lessons/77/questions"');
    expect(res.text).toContain('name="quiz_id" value="51"');
    ['mcq', 'multi', 'truefalse', 'short'].forEach((type) => {
      expect(res.text).toContain(`name="question_type" type="radio" value="${type}"`);
    });
  });

  it('explains when existing questions cannot be listed, and still offers the add form', async () => {
    const { ApiError } = api;
    routeApi(baseHandlers([[/^GET \/quizzes\/51$/, new ApiError('not enrolled', 403)]]));
    const res = await request(app).get('/courses/instructor/42/lessons/77/edit');
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_courses.lesson_editor.questions_unavailable'));
    expect(res.text).toContain('action="/courses/instructor/42/lessons/77/questions"');
  });

  it('adds a one-answer question in the format learners answer', async () => {
    routeApi([[/^POST \/42\/quizzes\/51\/questions$/, { data: { id: 10 } }]]);
    const res = await request(app).post('/courses/instructor/42/lessons/77/questions').type('form').send({
      quiz_id: '51', question_prompt: ' Which soil holds water? ', question_type: 'mcq',
      question_options: 'Clay\r\n\r\n Sand \nLoam', question_correct: '1', question_position: '2'
    });
    expect(res.headers.location).toBe('/courses/instructor/42/lessons/77/edit?status=question-added#quiz-questions');
    const [[, , , question]] = callsTo('POST', '/42/quizzes/51/questions');
    expect(question).toEqual({
      type: 'mcq',
      prompt: 'Which soil holds water?',
      options: [{ id: 'a', label: 'Clay' }, { id: 'b', label: 'Sand' }, { id: 'c', label: 'Loam' }],
      correct: ['a'],
      points: 1,
      position: 2
    });
  });

  it('adds a several-answer question', async () => {
    routeApi([[/^POST /, { data: { id: 10 } }]]);
    await request(app).post('/courses/instructor/42/lessons/77/questions').type('form').send({
      quiz_id: '51', question_prompt: 'Pick the greens', question_type: 'multi',
      question_options: 'Kale\nCarrot\nSpinach', question_correct: '1, 3'
    });
    const [[, , , question]] = callsTo('POST', '/42/quizzes/51/questions');
    expect(question.type).toBe('multi');
    expect(question.correct).toEqual(['a', 'c']);
  });

  it('adds a true or false question', async () => {
    routeApi([[/^POST /, { data: { id: 10 } }]]);
    await request(app).post('/courses/instructor/42/lessons/77/questions').type('form').send({
      quiz_id: '51', question_prompt: 'Worms help soil', question_type: 'truefalse', question_correct: '1'
    });
    const [[, , , question]] = callsTo('POST', '/42/quizzes/51/questions');
    expect(question.type).toBe('truefalse');
    expect(question.options).toEqual([
      { id: 'true', label: t('govuk_alpha_courses.lesson_editor.true_label') },
      { id: 'false', label: t('govuk_alpha_courses.lesson_editor.false_label') }
    ]);
    expect(question.correct).toEqual(['true']);
  });

  it('adds a written-answer question with no options', async () => {
    routeApi([[/^POST /, { data: { id: 10 } }]]);
    await request(app).post('/courses/instructor/42/lessons/77/questions').type('form').send({
      quiz_id: '51', question_prompt: 'Describe your garden', question_type: 'short', question_options: 'ignored', question_correct: '9'
    });
    const [[, , , question]] = callsTo('POST', '/42/quizzes/51/questions');
    expect(question).toEqual({ type: 'short', prompt: 'Describe your garden', points: 1, position: 0 });
  });

  it.each([
    [{ question_prompt: '  ', question_type: 'mcq', question_options: 'A\nB', question_correct: '1' }, 'question-prompt-missing'],
    [{ question_prompt: 'Q', question_type: 'mcq', question_options: 'Only one', question_correct: '1' }, 'question-options-missing'],
    [{ question_prompt: 'Q', question_type: 'mcq', question_options: 'A\nB', question_correct: '3' }, 'question-correct-invalid'],
    [{ question_prompt: 'Q', question_type: 'mcq', question_options: 'A\nB', question_correct: '1,2' }, 'question-correct-invalid'],
    [{ question_prompt: 'Q', question_type: 'multi', question_options: 'A\nB', question_correct: '' }, 'question-correct-invalid'],
    [{ question_prompt: 'Q', question_type: 'truefalse', question_correct: '3' }, 'question-correct-invalid'],
  ])('refuses an incomplete question %#', async (body, status) => {
    routeApi([]);
    const res = await request(app).post('/courses/instructor/42/lessons/77/questions').type('form').send({ quiz_id: '51', ...body });
    expect(res.headers.location).toBe(`/courses/instructor/42/lessons/77/edit?status=${status}#add-question`);
    expect(api.callCourseApi).not.toHaveBeenCalled();
  });

  it('keeps what was typed after a refused question', async () => {
    routeApi([]);
    await request(app).post('/courses/instructor/42/lessons/77/questions').type('form').send({
      quiz_id: '51', question_prompt: 'Kept prompt', question_type: 'multi', question_options: 'A', question_correct: '1'
    });
    routeApi(baseHandlers([[/^GET \/quizzes\/51$/, { data: { id: 51, questions: [] } }]]));
    const res = await request(app).get('/courses/instructor/42/lessons/77/edit?status=question-options-missing');
    expect(res.text).toContain('Kept prompt</textarea>');
    expect(res.text).toMatch(/name="question_type" type="radio" value="multi" checked/);
    expect(res.text).toContain(t('govuk_alpha_courses.lesson_editor.question_options_missing'));
  });

  it('deletes a question', async () => {
    routeApi([[/^DELETE \/42\/quizzes\/51\/questions\/9$/, { data: { deleted: true } }]]);
    const res = await request(app).post('/courses/instructor/42/lessons/77/questions/9/delete').type('form').send({ quiz_id: '51' });
    expect(res.headers.location).toBe('/courses/instructor/42/lessons/77/edit?status=question-deleted#quiz-questions');
    expect(callsTo('DELETE', '/42/quizzes/51/questions/9')).toHaveLength(1);
  });

  it('renders an authored question for a learner as radio choices', async () => {
    routeApi(baseHandlers([
      [/^GET \/quizzes\/51$/, { data: { id: 51, title: 'Check', pass_mark_percent: 70, questions: [
        { id: 9, type: 'mcq', prompt: 'Which soil holds water?', options: [{ id: 'a', label: 'Clay' }, { id: 'b', label: 'Sand' }] }
      ] } }],
    ]));
    const res = await request(app).get('/courses/42/learn?lesson=77');
    expect(res.text).toContain('name="answers[9]" type="radio" value="a"');
    expect(res.text).toContain('Clay');
  });
});

describe('6. drip release, free preview and reordering', () => {
  it('shows release timing and free preview on the lesson page, filled from the lesson', async () => {
    routeApi(baseHandlers());
    const res = await request(app).get('/courses/instructor/42/lessons/11/edit');
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="release_fields" value="1"');
    expect(res.text).toMatch(/name="drip_type" type="radio" value="days_after_enroll" checked/);
    expect(res.text).toMatch(/name="drip_offset_days" type="text"[^>]*value="3"/);
    expect(res.text).toMatch(/name="is_preview" type="checkbox" value="1" checked/);
    expect(res.text).toContain('name="drip_date-day"');
  });

  it('fills a fixed unlock date from the lesson', async () => {
    routeApi(baseHandlers());
    const res = await request(app).get('/courses/instructor/42/lessons/20/edit');
    expect(res.text).toMatch(/name="drip_type" type="radio" value="fixed_date" checked/);
    expect(res.text).toMatch(/name="drip_date-year"[^>]*value="2026"/);
  });

  it('404s for a lesson that is not in the course', async () => {
    routeApi(baseHandlers());
    const res = await request(app).get('/courses/instructor/42/lessons/999/edit');
    expect(res.status).toBe(404);
  });

  it('saves days after enrolment and the preview flag', async () => {
    routeApi([[/^PUT /, { data: { id: 11 } }]]);
    const res = await request(app).post('/courses/instructor/42/lessons/11/update').type('form').send({
      lesson_title: 'Soil', content_type: 'text', body: 'b', release_fields: '1',
      drip_type: 'days_after_enroll', drip_offset_days: '5', is_preview: ['0', '1']
    });
    expect(res.headers.location).toBe('/courses/instructor/42/edit?status=lesson-saved');
    const [[, , , payload]] = callsTo('PUT', '/42/lessons/11');
    expect(payload).toEqual(expect.objectContaining({
      drip_type: 'days_after_enroll', drip_offset_days: 5, drip_date: null, is_preview: true
    }));
  });

  it('saves a fixed unlock date', async () => {
    routeApi([[/^PUT /, { data: { id: 11 } }]]);
    await request(app).post('/courses/instructor/42/lessons/11/update').type('form').send({
      lesson_title: 'Soil', content_type: 'text', release_fields: '1', drip_type: 'fixed_date',
      'drip_date-day': '1', 'drip_date-month': '12', 'drip_date-year': '2026', is_preview: '0'
    });
    const [[, , , payload]] = callsTo('PUT', '/42/lessons/11');
    expect(payload).toEqual(expect.objectContaining({
      drip_type: 'fixed_date', drip_offset_days: null, drip_date: '2026-12-01', is_preview: false
    }));
  });

  it('saves "available immediately"', async () => {
    routeApi([[/^PUT /, { data: { id: 11 } }]]);
    await request(app).post('/courses/instructor/42/lessons/11/update').type('form').send({
      lesson_title: 'Soil', content_type: 'text', release_fields: '1', drip_type: 'none', drip_offset_days: '4'
    });
    const [[, , , payload]] = callsTo('PUT', '/42/lessons/11');
    expect(payload).toEqual(expect.objectContaining({ drip_type: 'none', drip_offset_days: null, drip_date: null, is_preview: false }));
  });

  it.each([
    [{ drip_type: 'days_after_enroll', drip_offset_days: '-2' }, 'drip-days-invalid'],
    [{ drip_type: 'days_after_enroll', drip_offset_days: '1.5' }, 'drip-days-invalid'],
    [{ drip_type: 'days_after_enroll', drip_offset_days: '' }, 'drip-days-invalid'],
    [{ drip_type: 'fixed_date', 'drip_date-day': '31', 'drip_date-month': '2', 'drip_date-year': '2026' }, 'drip-date-invalid'],
    [{ drip_type: 'fixed_date' }, 'drip-date-invalid'],
  ])('refuses an unusable release setting %#', async (body, status) => {
    routeApi([]);
    const res = await request(app).post('/courses/instructor/42/lessons/11/update').type('form').send({
      lesson_title: 'Soil', content_type: 'text', release_fields: '1', ...body
    });
    expect(res.headers.location).toBe(`/courses/instructor/42/lessons/11/edit?status=${status}`);
    expect(api.callCourseApi).not.toHaveBeenCalled();
  });

  it('shows move buttons, edit links and release tags in the builder', async () => {
    routeApi(baseHandlers());
    const res = await request(app).get('/courses/instructor/42/edit');
    expect(res.text).toContain('action="/courses/instructor/42/sections/5/move"');
    expect(res.text).toContain('action="/courses/instructor/42/sections/6/move"');
    expect(res.text).toContain('action="/courses/instructor/42/lessons/11/move"');
    expect(res.text).toContain('name="order" value="5,6"');
    expect(res.text).toContain('name="order" value="10,11,77"');
    expect(res.text).toContain('href="/courses/instructor/42/lessons/11/edit"');
    expect(res.text).toContain(t('govuk_alpha_courses.lesson_editor.preview_tag'));
    expect(res.text).toContain('Opens 3 days after enrolment');
    expect(res.text).toContain('Opens on 1 December 2026');
    expect(res.text).toContain(t('govuk_alpha_courses.lesson_editor.move_up'));
    expect(res.text).toContain(t('govuk_alpha_courses.lesson_editor.move_down'));
  });

  it('moves a section down', async () => {
    routeApi([[/^PUT \/42\/sections\/reorder$/, { data: { ordered_ids: [6, 5] } }]]);
    const res = await request(app).post('/courses/instructor/42/sections/5/move').type('form').send({ direction: 'down', order: '5,6' });
    expect(res.headers.location).toBe('/courses/instructor/42/edit?status=order-saved#curriculum');
    const [[, , , payload]] = callsTo('PUT', '/42/sections/reorder');
    expect(payload).toEqual({ expected_ids: [5, 6], ordered_ids: [6, 5] });
  });

  it('moves a lesson up within its section', async () => {
    routeApi([[/^PUT /, { data: {} }]]);
    await request(app).post('/courses/instructor/42/lessons/11/move').type('form').send({ direction: 'up', order: '10,11,77', section_id: '5' });
    const [[, , , payload]] = callsTo('PUT', '/42/sections/5/lessons/reorder');
    expect(payload).toEqual({ expected_ids: [10, 11, 77], ordered_ids: [11, 10, 77] });
  });

  it('does nothing when the item is already at the edge', async () => {
    routeApi([]);
    const res = await request(app).post('/courses/instructor/42/lessons/10/move').type('form').send({ direction: 'up', order: '10,11', section_id: '5' });
    expect(res.headers.location).toBe('/courses/instructor/42/edit#curriculum');
    expect(api.callCourseApi).not.toHaveBeenCalled();
  });

  it('says the order changed when someone else reordered first', async () => {
    const { ApiError } = api;
    routeApi([[/^PUT /, new ApiError('changed', 409)]]);
    const res = await request(app).post('/courses/instructor/42/sections/5/move').type('form').send({ direction: 'down', order: '5,6' });
    expect(res.headers.location).toBe('/courses/instructor/42/edit?status=order-changed#curriculum');
  });

  it('reports a failed move', async () => {
    const { ApiError } = api;
    routeApi([[/^PUT /, new ApiError('boom', 500)]]);
    const res = await request(app).post('/courses/instructor/42/lessons/11/move').type('form').send({ direction: 'down', order: '10,11,77', section_id: '5' });
    expect(res.headers.location).toBe('/courses/instructor/42/edit?status=order-failed#curriculum');
  });
});
