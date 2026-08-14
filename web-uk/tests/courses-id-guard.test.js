// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The courses router interpolates id params straight into an API path via
 * callCourseApi. It was the only route file that did so with neither a numeric
 * constraint nor encodeURIComponent, so a crafted id like `1%2f..%2f..%2fadmin`
 * (Express decodes %2f to `/`) could redirect the member's own authenticated call to
 * a different API endpoint. A router.param guard now rejects any non-numeric id with
 * a 404 BEFORE the handler — so the API is never called with a poisoned path.
 */
const express = require('express');
const path = require('node:path');
const nunjucks = require('nunjucks');
const request = require('supertest');
const { createTranslator, createChoiceTranslator } = require('../src/lib/localization');

jest.mock('../src/lib/api', () => ({
  ApiError: class ApiError extends Error {},
  ApiOfflineError: class ApiOfflineError extends Error {},
  callCourseApi: jest.fn().mockResolvedValue({ data: {} }),
  getMyCourses: jest.fn().mockResolvedValue({ data: [] }),
}));

const api = require('../src/lib/api');
const coursesRoutes = require('../src/routes/courses');

function createApp() {
  const app = express();
  const views = path.join(__dirname, '..', 'src', 'views');
  const govuk = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
  nunjucks.configure([views, govuk], { autoescape: true, express: app, watch: false });
  app.set('view engine', 'njk');
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    req.token = 'token:test';
    res.locals.urlFor = (v) => String(v || '/');
    Object.assign(res.locals, {
      serviceName: 'NEXUS', tenantName: 'Test', isAuthenticated: true, csrfToken: 'x',
      t: createTranslator('en'), tc: createChoiceTranslator('en'),
      htmlLang: 'en', htmlDirection: 'ltr', alphaNavItems: [], alphaLocaleOptions: [],
      alphaLanguageQueryParams: [], footerColumns: [], exploreLinks: [],
    });
    next();
  }, coursesRoutes);
  return app;
}

describe('courses id guard (SSRF fix)', () => {
  const app = createApp();
  beforeEach(() => jest.clearAllMocks());

  it('rejects a path-traversal id with 404 and never calls the API', async () => {
    const res = await request(app).get('/1%2f..%2f..%2fadmin%2fpurge/learn');
    expect(res.status).toBe(404);
    expect(api.callCourseApi).not.toHaveBeenCalled();
  });

  it('rejects a non-numeric id with 404 and never calls the API', async () => {
    const res = await request(app).get('/abc/learn');
    expect(res.status).toBe(404);
    expect(api.callCourseApi).not.toHaveBeenCalled();
  });

  it('lets a clean numeric id through to the handler (API is called)', async () => {
    await request(app).get('/42/learn');
    expect(api.callCourseApi).toHaveBeenCalled();
  });
});
