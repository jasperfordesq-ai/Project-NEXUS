// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Test app for the group collaboration tool routes (Q&A, wiki, tasks,
 * analytics, data export). The API module must be mocked by the test file
 * before this helper is required.
 */
const express = require('express');
const nunjucks = require('nunjucks');
const path = require('node:path');
const { createChoiceTranslator, createTranslator } = require('../../src/lib/localization');

function mountGroupTools(router, { groupTabs = {} } = {}) {
  const app = express();
  const environment = nunjucks.configure(
    [path.join(__dirname, '..', '..', 'src', 'views'),
      path.join(__dirname, '..', '..', 'node_modules', 'govuk-frontend', 'dist')],
    { autoescape: true, noCache: true, express: app }
  );
  require('../../src/lib/template-filters').registerTemplateFilters(environment);
  app.set('view engine', 'njk');
  app.use(express.urlencoded({ extended: true }));
  app.use('/groups', (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.csrfToken = () => 'csrf';
    req.flash = () => [];
    req.accessibleRouting = {
      mode: 'shared',
      tenantSlug: 'test',
      prefix: '',
      tenant: { id: 2, slug: 'test', group_tabs: app.locals.groupTabs }
    };
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
  }, router);
  app.locals.groupTabs = groupTabs;
  return app;
}

function apiMockFactory(extra = {}) {
  class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }
  return {
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    getGroup: jest.fn(),
    getProfile: jest.fn(),
    callGroupApi: jest.fn(),
    callIdeationApi: jest.fn(),
    downloadGroupFile: jest.fn(),
    ...extra
  };
}

const MEMBER_GROUP = { data: { id: 974, name: 'Repair crew', viewer_membership: { status: 'active', role: 'member', is_admin: false } } };
const ADMIN_GROUP = { data: { id: 974, name: 'Repair crew', viewer_membership: { status: 'active', role: 'admin', is_admin: true } } };
const OUTSIDER_GROUP = { data: { id: 974, name: 'Repair crew', viewer_membership: { status: 'none', role: null, is_admin: false } } };

module.exports = { mountGroupTools, apiMockFactory, MEMBER_GROUP, ADMIN_GROUP, OUTSIDER_GROUP };
