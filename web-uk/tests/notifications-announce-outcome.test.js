// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Notifications must say what happened — success AND failure (2026-08-25).
 *
 * Found by walking the page as a member. Two gaps, both silent:
 *
 *   1. Marking ONE notification read announced nothing. Its four siblings
 *      (read-all, delete, delete-all, group/read) all redirect to a `?status=`
 *      the template turns into a success banner. `notification-marked-read` and
 *      its eleven translations already existed, and index.njk already
 *      whitelisted the status — only the redirect never carried it.
 *
 *   2. Every POST in routes/notifications.js flashes an `error` on failure, and
 *      the template had no error banner at all. A failed "mark all as read"
 *      reloaded the inbox unchanged and said nothing — which a screen reader
 *      announces as nothing having happened, not as a failure.
 *
 * These assert the RENDERED banner, not the redirect target, because a status
 * the template does not recognise redirects just as happily and shows nothing.
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

function mockInbox() {
  api.getGroupedNotifications.mockResolvedValue({ data: [], meta: {} });
  api.getNotifications.mockResolvedValue({ data: [], meta: {} });
  api.getNotificationUnreadCount.mockResolvedValue({ data: { total: 0 } });
}

/** Follow one redirect and return the rendered inbox HTML. */
async function submitThenRender(app, path_, body = {}) {
  const agent = request.agent(app);
  const post = await agent.post(`/notifications${path_}`).type('form').send({ _csrf: 'test-csrf-token', ...body });
  expect(post.status).toBe(302);
  const page = await agent.get(post.headers.location);
  expect(page.status).toBe(200);
  return { redirectedTo: post.headers.location, html: page.text };
}

function bannerText(html) {
  return [...html.matchAll(/govuk-notification-banner__(?:title|heading)"[^>]*>([\s\S]*?)</g)]
    .map((m) => m[1].replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' | ');
}

describe('notifications announce a successful action', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInbox();
  });

  it('marking ONE notification read announces it, like every sibling action', async () => {
    api.markNotificationRead.mockResolvedValue({ data: {} });

    const { redirectedTo, html } = await submitThenRender(buildApp(), '/7/read');

    expect(redirectedTo).toContain('status=notification-marked-read');
    expect(bannerText(html)).toContain('Notification marked as read.');
  });

  it('announces the mark-as-read even when the stored link is refused', async () => {
    api.markNotificationRead.mockResolvedValue({ data: {} });
    // An off-site link in the notification record is rejected by
    // validateReturnUrl. The member must still be told that the thing they
    // pressed the button for actually happened.
    api.getNotification.mockResolvedValue({ data: { id: 7, link: 'https://evil.example/x' } });

    const { redirectedTo, html } = await submitThenRender(buildApp(), '/7/read', { follow: '1' });

    expect(redirectedTo).toBe('/notifications?status=notification-marked-read');
    expect(bannerText(html)).toContain('Notification marked as read.');
  });

  it('follows a safe stored link instead of announcing, when there is one', async () => {
    api.markNotificationRead.mockResolvedValue({ data: {} });
    api.getNotification.mockResolvedValue({ data: { id: 7, link: '/messages/12' } });

    const agent = request.agent(buildApp());
    const post = await agent.post('/notifications/7/read').type('form')
      .send({ _csrf: 'test-csrf-token', follow: '1' });

    expect(post.status).toBe(302);
    expect(post.headers.location).toBe('/messages/12');
  });

  it('deleting ONE notification announces it', async () => {
    api.deleteNotification.mockResolvedValue({ data: {} });

    const { html } = await submitThenRender(buildApp(), '/7/delete');

    expect(bannerText(html)).toContain('Notification deleted.');
  });

  it('marking all read announces it', async () => {
    api.markAllNotificationsRead.mockResolvedValue({ data: { marked_read: 3 } });

    const { html } = await submitThenRender(buildApp(), '/read-all');

    expect(bannerText(html)).toContain('notifications marked as read');
  });
});

describe('notifications announce a FAILED action instead of reloading in silence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInbox();
  });

  // Each of these used to flash an error that nothing rendered.
  const failures = [
    ['mark one read', '/7/read', {}, () => api.markNotificationRead],
    ['delete one', '/7/delete', {}, () => api.deleteNotification],
    ['mark all read', '/read-all', {}, () => api.markAllNotificationsRead],
    ['delete all', '/delete-all', {}, () => api.deleteAllNotifications],
    ['mark a group read', '/group/read', { group_key: 'messages' }, () => api.markNotificationGroupRead]
  ];

  it.each(failures)('%s says so when the API fails', async (_label, path_, body, mock) => {
    mock().mockRejectedValue(new api.ApiError('boom', 500));

    const { html } = await submitThenRender(buildApp(), path_, body);

    const banners = bannerText(html);
    expect(banners).toContain('We could not complete that action.');
    // A failure must never be dressed as a success.
    expect(banners).not.toMatch(/marked as read\.|deleted\./);
  });

  it('does not announce a failure in raw English when the member reads another language', async () => {
    api.deleteNotification.mockRejectedValue(new api.ApiError('boom', 500));

    const app = buildApp();
    // Swap the translator the way the locale middleware does.
    const agent = request.agent(app);
    const post = await agent.post('/notifications/7/delete').type('form').send({ _csrf: 'test-csrf-token' });
    const page = await agent.get('/notifications');

    // The English catalogue is what this harness loads; the point of the
    // assertion is that the message comes from the CATALOGUE, not from a
    // hardcoded literal in the route (the old fallbacks read
    // "Unable to delete notification", which exists in no catalogue).
    expect(post.status).toBe(302);
    expect(page.text).not.toContain('Unable to delete notification');
    expect(bannerText(page.text)).toContain('We could not complete that action.');
  });
});
