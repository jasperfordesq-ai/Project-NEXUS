// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Shared harness for the React-parity page tests (26 Oct 2026): mounts a router
 * under a tenant prefix with the real Nunjucks views, the real English catalogue
 * and a session, the same shape tests/federation-partner-block.test.js uses.
 */

const path = require('path');
const express = require('express');
const session = require('express-session');
const nunjucks = require('nunjucks');
const { createChoiceTranslator, createTranslator, formatLocaleDate, formatLocaleNumber } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');

const PREFIX = '/acme/accessible';
const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const t = createTranslator('en');

function createApp(mountPath, routers, { signedIn = true, before = [] } = {}) {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  env.addFilter('formatDate', (value) => String(value || ''));
  env.addFilter('nl2br', (value) => String(value || ''));

  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'react-parity-test-secret', resave: false, saveUninitialized: false }));

  const mount = `${PREFIX}${mountPath}`;
  app.use(mount, (req, res, next) => {
    req.signedCookies = signedIn ? { token: 'test-token' } : {};
    if (signedIn) req.token = 'test-token';
    req.csrfToken = () => 'test-csrf-token';
    req.accessibleRouting = {
      mode: 'shared',
      tenantSlug: 'acme',
      tenant: { id: 2, slug: 'acme', name: 'Acme Timebank', settings: {} },
      prefix: PREFIX
    };
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
      locale: 'en',
      t,
      tc: createChoiceTranslator('en'),
      formatLocaleNumber: (value, options) => formatLocaleNumber(value, 'en', options),
      formatLocaleDate: (value, options) => formatLocaleDate(value, 'en', options)
    });
    next();
  }, ...before, ...routers);

  return app;
}

module.exports = { PREFIX, createApp, t };
