// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Course refusals must be reported as refusals (29 Oct 2026 field audit).
 *
 * Laravel's respondWithError puts the code in errors[0].code. Until this fix the
 * lesson-complete action redirected a refused completion (QUIZ_PASS_REQUIRED,
 * LESSON_LOCKED) to the SUCCESS status "Lesson marked as complete", and the quiz
 * and review actions never recognised MAX_ATTEMPTS_REACHED / NOT_ENROLLED.
 */
const express = require('express');
const request = require('supertest');

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
  }, {
    get: (target, prop) => (prop in target ? target[prop] : jest.fn().mockResolvedValue({ data: [] })),
  });
});

const api = require('../src/lib/api');
const coursesRoutes = require('../src/routes/courses');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  req.signedCookies = { token: 'token:test' };
  req.token = 'token:test';
  req.session = {};
  res.locals.urlFor = (v) => String(v || '/');
  next();
});
app.use('/courses', coursesRoutes);

function refuse(status, code) {
  api.callCourseApi.mockRejectedValue(new api.ApiError('refused', status, { errors: [{ code, message: 'x' }] }));
}

beforeEach(() => api.callCourseApi.mockReset());

test.each([
  [422, 'QUIZ_PASS_REQUIRED', 'lesson-quiz-required'],
  [403, 'LESSON_LOCKED', 'lesson-locked'],
  [500, 'SERVER_ERROR', 'lesson-failed'],
])('refused completion (%s %s) is reported as %s on the same lesson', async (status, code, expected) => {
  refuse(status, code);
  const res = await request(app).post('/courses/42/lessons/9/complete').type('form').send({});
  expect(res.status).toBe(302);
  expect(res.headers.location).toBe(`/courses/42/learn?lesson=9&status=${expected}`);
});

test('quiz with no attempts left says so', async () => {
  refuse(422, 'MAX_ATTEMPTS_REACHED');
  const res = await request(app).post('/courses/42/lessons/9/quiz').type('form').send({ quiz_id: '3' });
  expect(res.headers.location).toBe('/courses/42/learn?lesson=9&status=quiz-no-attempts');
});

test('review by a non-learner says only enrolled learners can review', async () => {
  refuse(403, 'NOT_ENROLLED');
  const res = await request(app).post('/courses/42/reviews').type('form').send({ rating: '4', comment: 'Good' });
  expect(res.headers.location).toContain('status=review-not-enrolled');
});

test('certificate for an unfinished quiz course says it is locked, not a service error', async () => {
  refuse(422, 'QUIZ_PASS_REQUIRED');
  const res = await request(app).get('/courses/42/certificate');
  expect(res.headers.location).toBe('/courses/42?status=certificate-locked');
});

test('the three new messages exist in English', () => {
  const { createTranslator } = require('../src/lib/localization');
  const t = createTranslator('en');
  for (const key of ['lesson_quiz_required', 'lesson_locked', 'lesson_failed']) {
    expect(t(`govuk_alpha_courses.status.${key}`)).not.toMatch(/govuk_alpha_courses/);
  }
});
