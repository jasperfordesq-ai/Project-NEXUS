// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * A signed-in Express app around one volunteering router, rendering the real
 * Nunjucks views in English under a tenant prefix. The same harness the other
 * volunteering route tests build inline; the parity-gap tests (21 Oct 2026) share
 * it instead of carrying six more copies. Each test file still mocks
 * `../src/lib/api` itself, because jest.mock is hoisted per file.
 */

const path = require('path');
const express = require('express');
const session = require('express-session');
const nunjucks = require('nunjucks');
const { createChoiceTranslator, createTranslator } = require('../../src/lib/localization');
const { registerTemplateFilters } = require('../../src/lib/template-filters');

const PREFIX = '/acme/accessible';
const MOUNT = `${PREFIX}/volunteering`;
const VIEWS = path.join(__dirname, '..', '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', '..', 'node_modules', 'govuk-frontend', 'dist');
const t = createTranslator('en');

function createVolunteeringApp(router, { mount = MOUNT, signedIn = true } = {}) {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'volunteering-route-test-secret', resave: false, saveUninitialized: false }));
  app.use(mount, (req, res, next) => {
    req.signedCookies = signedIn ? { token: 'test-token' } : {};
    res.locals.urlFor = (value) => {
      const target = String(value || '/');
      return target.startsWith(PREFIX) ? target : `${PREFIX}${target.startsWith('/') ? target : `/${target}`}`;
    };
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS',
      tenantName: 'Acme Timebank',
      isAuthenticated: signedIn,
      csrfToken: 'test-csrf-token',
      alphaNavItems: [],
      feedbackUrl: `${PREFIX}/feedback`,
      currentPath: mount,
      alphaLocaleOptions: [],
      alphaLanguageQueryParams: [],
      htmlLang: 'en',
      htmlDirection: 'ltr',
      t,
      tc: createChoiceTranslator('en'),
      formatLocaleNumber: (value) => String(value ?? ''),
      formatLocaleDate: (value) => String(value ?? '')
    });
    next();
  }, router);
  return app;
}

// Nunjucks escapes an apostrophe as &#39;.
const html = (text) => String(text).replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;');

module.exports = { PREFIX, MOUNT, t, createVolunteeringApp, html };
