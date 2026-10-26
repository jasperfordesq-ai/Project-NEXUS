// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Comments and likes on events and volunteering opportunities, as React's
 * SocialInteractionPanel offers on EventDetailPage (targetType "event") and
 * OpportunityDetailPage (targetType "volunteer").
 *
 * - the event page shows the comments, a comment form and a like button;
 * - the opportunity page links to its own comments page, which does the same;
 * - every form posts to the existing /feed/items/{type}/{id}/… actions with a
 *   `return_to`, and those actions send the member BACK to the page instead of
 *   the feed — but only for the two allowlisted path shapes.
 */
const express = require('express');
const session = require('express-session');
const request = require('supertest');
const nunjucks = require('nunjucks');
const path = require('node:path');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }
  return new Proxy({
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    getComments: jest.fn(),
    createComment: jest.fn(),
    deleteComment: jest.fn(),
    toggleFeedLike: jest.fn(),
    getEvent: jest.fn(),
    getProfile: jest.fn(),
    getVolunteerOpportunity: jest.fn()
  }, {
    get: (target, prop) => (prop in target ? target[prop] : jest.fn().mockResolvedValue({ data: [] }))
  });
});

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() })
}));

const api = require('../src/lib/api');
const eventsRoutes = require('../src/routes/events');
const feedActionRoutes = require('../src/routes/feed-actions');
const opportunityCommentRoutes = require('../src/routes/volunteering-opportunity-comments');

const t = createTranslator('en');

function mount(mountPath, routes) {
  const app = express();
  const environment = nunjucks.configure(
    [path.join(__dirname, '..', 'src', 'views'), path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
    { autoescape: true, noCache: true, express: app }
  );
  require('../src/lib/template-filters').registerTemplateFilters(environment);
  environment.addFilter('nl2br', (value) => value);
  environment.addFilter('formatDate', (value) => String(value || ''));
  app.set('view engine', 'njk');
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'event-opportunity-comments-test-secret-32', resave: false, saveUninitialized: false }));
  app.use(mountPath, (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.csrfToken = () => 'csrf';
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'test', prefix: '', tenant: { id: 2, slug: 'test', features: { events: true, volunteering: true } } };
    res.locals.urlFor = (v) => String(v || '/');
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS', tenantName: 'Test', isAuthenticated: true, csrfToken: 'csrf',
      t, tc: createChoiceTranslator('en'), htmlLang: 'en', htmlDirection: 'ltr',
      formatLocaleDate: (value) => String(value || '')
    });
    next();
  }, routes);
  return app;
}

const eventsApp = mount('/events', eventsRoutes);
const feedApp = mount('/feed', feedActionRoutes);
const volunteeringApp = mount('/volunteering', opportunityCommentRoutes);

const COMMENTS = { data: { comments: [{ id: 501, content: 'See you there', author: { id: 3, name: 'Pat' }, replies: [] }] } };

beforeEach(() => {
  jest.clearAllMocks();
  api.getProfile.mockResolvedValue({ data: { id: 3 } });
  api.getComments.mockResolvedValue(COMMENTS);
});

it('shows comments, a comment form and a like button on the event page', async () => {
  api.getEvent.mockResolvedValue({ data: { id: 42, title: 'Repair cafe', start_time: '2099-01-01T10:00:00Z', timezone: 'UTC' } });
  const page = await request(eventsApp).get('/events/42?social=comment-created');
  expect(page.status).toBe(200);
  expect(api.getComments).toHaveBeenCalledWith('token:test', { target_type: 'event', target_id: 42 });
  expect(page.text).toContain('id="comments"');
  expect(page.text).toContain('See you there');
  expect(page.text).toContain('action="/feed/items/event/42/comments"');
  expect(page.text).toContain('action="/feed/items/event/42/like"');
  expect(page.text).toContain('name="return_to" value="/events/42"');
  expect(page.text).toContain(t('govuk_alpha_events.social.status.comment_created'));
  // The author's own comment carries edit/delete forms that also come back here.
  expect(page.text).toContain('action="/feed/comments/501/delete"');
});

it('gives each opportunity a comments page reached from its detail page', async () => {
  api.getVolunteerOpportunity.mockResolvedValue({ data: { id: 8, title: 'Litter pick' } });
  const page = await request(volunteeringApp).get('/volunteering/opportunities/8/comments');
  expect(page.status).toBe(200);
  expect(api.getComments).toHaveBeenCalledWith('token:test', { target_type: 'volunteer', target_id: 8 });
  expect(page.text).toMatch(/<h1[^>]*id="comments"/);
  expect(page.text).toContain('Litter pick');
  expect(page.text).toContain('action="/feed/items/volunteer/8/comments"');
  expect(page.text).toContain('name="return_to" value="/volunteering/opportunities/8/comments"');
});

describe('feed actions return to the page they came from', () => {
  it('adds a comment and returns to the event', async () => {
    api.createComment.mockResolvedValue({ data: {} });
    const response = await request(feedApp).post('/feed/items/event/42/comments').type('form')
      .send({ content: 'Count me in', return_to: '/events/42' });
    expect(api.createComment).toHaveBeenCalledWith('token:test', { target_type: 'event', target_id: 42, content: 'Count me in', parent_id: null });
    expect(response.headers.location).toBe('/events/42?social=comment-created#comments');
  });

  it('likes an opportunity and returns to its comments page', async () => {
    api.toggleFeedLike.mockResolvedValue({ data: { action: 'liked' } });
    const response = await request(feedApp).post('/feed/items/volunteer/8/like').type('form')
      .send({ return_to: '/volunteering/opportunities/8/comments' });
    expect(response.headers.location).toBe('/volunteering/opportunities/8/comments?social=like-added#comments');
  });

  it('deletes a comment and returns to the event', async () => {
    api.deleteComment.mockResolvedValue({ data: {} });
    const response = await request(feedApp).post('/feed/comments/501/delete').type('form').send({ return_to: '/events/42' });
    expect(response.headers.location).toBe('/events/42?social=comment-deleted#comments');
  });

  it('ignores any other return path and goes to the feed as before', async () => {
    api.createComment.mockResolvedValue({ data: {} });
    const response = await request(feedApp).post('/feed/items/event/42/comments').type('form')
      .send({ content: 'x', return_to: '//evil.example' });
    expect(response.headers.location.startsWith('/feed?status=comment-created')).toBe(true);
  });
});
