// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A grouped notification must show what it groups (React db249f98).
 * NotificationService::getGroupedNotifications sends the member rows as
 * `group_items` (capped) with `remaining_count`; the accessible inbox ignored
 * them, so a group of system notifications showed only its newest line.
 */

const express = require('express');
const session = require('express-session');
const path = require('path');
const nunjucks = require('nunjucks');
const request = require('supertest');
const flash = require('express-flash');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');

jest.mock('../src/lib/api', () => {
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
    getNotifications: jest.fn(),
    getGroupedNotifications: jest.fn(),
    getNotification: jest.fn(),
    getNotificationUnreadCount: jest.fn(),
    markNotificationRead: jest.fn(),
    markAllNotificationsRead: jest.fn(),
    markNotificationGroupRead: jest.fn(),
    deleteAllNotifications: jest.fn(),
    deleteNotification: jest.fn()
  };
});

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() })
}));

const api = require('../src/lib/api');
const notificationsRoutes = require('../src/routes/notifications');

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const PREFIX = '/acme/accessible';

function buildApp() {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  env.addFilter('formatDate', (value) => String(value || ''));
  env.addFilter('nl2br', (value) => String(value || ''));
  env.addFilter('string', String);
  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: 'notifications-announce-outcome-test-secret',
    resave: false,
    saveUninitialized: false,
    name: 'notifications-announce.sid'
  }));
  app.use(flash());

  // Mounted at the real path so the redirect target (`/notifications?...`) is a
  // route this app actually serves — mounting at '/' made every follow-up GET a
  // 404 and every banner assertion vacuously empty.
  app.use('/notifications', (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.accessibleRouting = {
      mode: 'shared',
      tenantSlug: 'acme',
      tenant: { id: 2, slug: 'acme', name: 'Acme Timebank' },
      prefix: PREFIX
    };
    res.locals.urlFor = (value) => String(value || '/');
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS',
      tenantName: 'Acme Timebank',
      isAuthenticated: true,
      csrfToken: 'test-csrf-token',
      alphaNavItems: [],
      feedbackUrl: `${PREFIX}/feedback`,
      currentPath: '/',
      alphaLocaleOptions: [],
      alphaLanguageQueryParams: [],
      htmlLang: 'en',
      htmlDirection: 'ltr',
      t: createTranslator('en'),
      tc: createChoiceTranslator('en'),
      formatLocaleNumber: (value) => String(value ?? ''),
      formatLocaleDate: (value) => String(value ?? ''),
      formatLocaleRelativeTime: (value) => String(value ?? '')
    });
    next();
  }, notificationsRoutes);

  return app;
}

const t = createTranslator('en');

function mockGroupedInbox(rows) {
  api.getGroupedNotifications.mockResolvedValue({ data: rows, meta: {} });
  api.getNotificationUnreadCount.mockResolvedValue({ data: { total: 0 } });
}

const group = {
  id: 9,
  type: 'badge_earned',
  message: 'You earned a badge',
  is_grouped: true,
  group_key: 'badge_earned|/achievements',
  group_count: 3,
  all_read: false,
  actors: [],
  remaining_count: 1,
  group_items: [
    { id: 9, title: 'Badge', message: 'You earned the Helper badge', link: '/achievements', is_read: false, created_at: '2026-10-26T10:00:00Z' },
    { id: 8, title: 'Badge', message: 'You earned the Starter badge', link: null, is_read: true, created_at: '2026-10-25T10:00:00Z' }
  ]
};

describe('grouped notifications list their items', () => {
  beforeEach(() => jest.clearAllMocks());

  it('renders each grouped item inside a details element', async () => {
    mockGroupedInbox([group]);
    const res = await request(buildApp()).get('/notifications');

    expect(res.status).toBe(200);
    expect(res.text).toContain('govuk-details');
    expect(res.text).toContain(t('notifications.group_items_summary'));
    expect(res.text).toContain('You earned the Helper badge');
    expect(res.text).toContain('You earned the Starter badge');
    expect(res.text).toContain('href="/achievements"');
    expect(res.text).toContain(t('notifications.group_items_more', { count: 1 }));
  });

  it('offers nothing to expand when the group carries no items', async () => {
    mockGroupedInbox([{ ...group, group_items: [], remaining_count: 0 }]);
    const res = await request(buildApp()).get('/notifications');
    expect(res.text).not.toContain(t('notifications.group_items_summary'));
  });

  it('never renders a details element for an ungrouped notification', async () => {
    mockGroupedInbox([{ id: 3, type: 'message', message: 'Hello', is_grouped: false, is_read: false }]);
    const res = await request(buildApp()).get('/notifications');
    expect(res.text).not.toContain(t('notifications.group_items_summary'));
  });
});
