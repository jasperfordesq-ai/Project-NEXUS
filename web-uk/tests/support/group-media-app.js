// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Test app for the group gallery, challenges, channels and webhooks pages.
 * The calling test mocks `../src/lib/api` itself (jest.mock must be hoisted in
 * the test file); this only wires Express, Nunjucks and the request locals.
 */
const express = require('express');
const session = require('express-session');
const nunjucks = require('nunjucks');
const path = require('node:path');
const { createChoiceTranslator, createTranslator } = require('../../src/lib/localization');
const { parseMultipartForm } = require('../../src/middleware/multipart');

function groupMediaApp(routers, { tenant = {}, multipart = null } = {}) {
  const app = express();
  const environment = nunjucks.configure(
    [path.join(__dirname, '..', '..', 'src', 'views'),
      path.join(__dirname, '..', '..', 'node_modules', 'govuk-frontend', 'dist')],
    { autoescape: true, noCache: true, express: app }
  );
  require('../../src/lib/template-filters').registerTemplateFilters(environment);
  environment.addFilter('nl2br', (value) => value);
  environment.addFilter('formatBladeDateTime', (value) => String(value || ''));
  app.set('view engine', 'njk');
  if (multipart) {
    app.use(multipart.path, parseMultipartForm(multipart.options), ...(multipart.errorHandler ? [multipart.errorHandler] : []));
  }
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'group-media-test-secret-at-least-32-chars', resave: false, saveUninitialized: false }));
  app.use('/groups', (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.csrfToken = () => 'csrf';
    req.flash = () => [];
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'test', prefix: '', tenant: { id: 2, slug: 'test', ...tenant } };
    res.locals.urlFor = (v) => String(v || '/');
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS',
      tenantName: 'Test',
      isAuthenticated: true,
      csrfToken: 'csrf',
      t: createTranslator('en'),
      tc: createChoiceTranslator('en'),
      htmlLang: 'en',
      htmlDirection: 'ltr',
      formatLocaleDate: () => '27 October 2026'
    });
    next();
  }, ...routers);
  return app;
}

const t = createTranslator('en');

module.exports = { groupMediaApp, t };
