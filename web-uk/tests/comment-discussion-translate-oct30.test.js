// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * AWID feedback (30 Oct 2026): comments, replies and group discussions could
 * not be translated on the accessible site — only feed posts could. React gained
 * Translate on comments (CommentsSection) and discussions (GroupDiscussionTab);
 * these pages now match. The text translated is always read from the API, never
 * taken from the form, and the result is shown once under the text it belongs to.
 */

const path = require('path');
const express = require('express');
const session = require('express-session');
const nunjucks = require('nunjucks');
const request = require('supertest');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.name = 'ApiError';
      this.status = status;
      this.data = data;
    }
  }
  return {
    ApiError,
    ApiOfflineError: class ApiOfflineError extends Error {},
    getFeedPosts: jest.fn(),
    getFeedPostV2: jest.fn(),
    getFeedItemV2: jest.fn(),
    getFeedHashtags: jest.fn(),
    getFeedHashtagPosts: jest.fn(),
    getFeedPostAnalytics: jest.fn(),
    getReactors: jest.fn(),
    callUgcTranslateApi: jest.fn(),
    getComments: jest.fn(),
    getProfile: jest.fn(),
    getTenantBootstrap: jest.fn(),
    invalidateUserCache: jest.fn(),
    callGroupApi: jest.fn(),
    getGroup: jest.fn()
  };
});

const api = require('../src/lib/api');

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');
const t = createTranslator('en');

function buildApp(mountPath, routers) {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  env.addFilter('formatDate', (value) => String(value || ''));
  env.addFilter('formatBladeDateTime', (value) => String(value || ''));
  env.addFilter('nl2br', (value) => String(value || ''));
  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'translate-oct30-test-secret-32chars', resave: false, saveUninitialized: false }));
  app.use(mountPath, (req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    req.locale = 'en';
    req.csrfToken = () => 'csrf';
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'acme', tenant: { id: 2, slug: 'acme' }, prefix: '' };
    res.locals.urlFor = (value) => String(value || '/');
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS',
      tenantName: 'Acme',
      isAuthenticated: true,
      csrfToken: 'csrf',
      alphaNavItems: [],
      alphaLocaleOptions: [],
      alphaLanguageQueryParams: [],
      htmlLang: 'en',
      htmlDirection: 'ltr',
      locale: 'en',
      t,
      tc: createChoiceTranslator('en'),
      formatLocaleNumber: (value) => String(value ?? ''),
      formatLocaleDate: (value) => String(value ?? '')
    });
    next();
  }, ...routers);
  return app;
}

const feedApp = () => buildApp('/feed', [require('../src/routes/feed-actions'), require('../src/routes/feed')]);
const groupsApp = () => buildApp('/groups', [require('../src/routes/groups')]);

const thread = {
  data: {
    comments: [{
      id: 11,
      content: '¿Alguien sabe cuidar tomates?',
      author: { id: 7, name: 'Estefanía' },
      replies: [{ id: 12, content: 'Gracias, muy útil', author: { id: 8, name: 'Luis' }, replies: [] }]
    }]
  }
};

beforeEach(() => {
  jest.clearAllMocks();
  api.getProfile.mockResolvedValue({ data: { id: 1 } });
  api.getFeedPostV2.mockResolvedValue({ data: { id: 5, type: 'post', content: 'Hola', author: { id: 9, name: 'Ann' } } });
  api.getComments.mockResolvedValue(thread);
});

describe('translate a comment or reply on a post', () => {
  it('offers Translate on every comment and reply, naming whose it is', async () => {
    const page = await request(feedApp()).get('/feed/posts/5');
    expect(page.text).toContain('action="/feed/comments/11/translate"');
    expect(page.text).toContain('action="/feed/comments/12/translate"');
    expect(page.text).toContain(t('govuk_alpha_feed.translate.comment_by', { name: 'Luis' }));
  });

  it('translates the reply read from the thread, not from the form, and shows it once', async () => {
    api.callUgcTranslateApi.mockResolvedValue({ data: { translated_text: 'Thank you, very useful' } });
    const agent = request.agent(feedApp());

    const res = await agent.post('/feed/comments/12/translate').type('form').send({ post_id: '5', content: 'tampered' });

    expect(api.getComments).toHaveBeenCalledWith('test-token', { target_type: 'post', target_id: 5 });
    expect(api.callUgcTranslateApi).toHaveBeenCalledWith('test-token', {
      content_type: 'comment',
      content_id: 12,
      source_text: 'Gracias, muy útil',
      target_locale: 'en'
    });
    expect(res.headers.location).toBe('/feed/posts/5?status=comment-translate-done#comment-12');

    const page = await agent.get('/feed/posts/5?status=comment-translate-done');
    expect(page.text).toContain('Thank you, very useful');
    expect(page.text).toContain(t('govuk_alpha_feed.translate.original_above_hint'));
    // Shown under the reply it belongs to; the reply's own button is replaced by it.
    expect(page.text).not.toContain('action="/feed/comments/12/translate"');
    expect(page.text).toContain('action="/feed/comments/11/translate"');

    const again = await agent.get('/feed/posts/5');
    expect(again.text).not.toContain('Thank you, very useful');
  });

  it('reports a failed translation honestly', async () => {
    api.callUgcTranslateApi.mockRejectedValue(new api.ApiError('refused', 422, { errors: [{ code: 'TRANSLATION_FAILED' }] }));
    const res = await request(feedApp()).post('/feed/comments/11/translate').type('form').send({ post_id: '5' });
    expect(res.headers.location).toBe('/feed/posts/5?status=comment-translate-failed');
    const page = await request(feedApp()).get('/feed/posts/5?status=comment-translate-failed');
    expect(page.text).toContain(t('govuk_alpha_feed.translate.text_failed'));
    expect(page.text).toContain('govuk-error-summary');
  });

  it('refuses a comment that is not in that post\'s thread', async () => {
    const res = await request(feedApp()).post('/feed/comments/999/translate').type('form').send({ post_id: '5' });
    expect(api.callUgcTranslateApi).not.toHaveBeenCalled();
    expect(res.headers.location).toBe('/feed/posts/5?status=comment-translate-empty');
  });
});

describe('translate a group discussion or reply', () => {
  const discussionPayload = {
    data: {
      discussion: { id: 3, title: 'Huerto', content: '<p>¿Quién quiere plantar?</p>', author: { name: 'Ana' } },
      messages: [{ id: 100, content: '<p>Yo puedo ir</p>', author: { name: 'Luis' }, created_at: '2026-10-30T11:00:00Z' }]
    }
  };

  beforeEach(() => {
    api.getGroup.mockResolvedValue({ data: { id: 42, name: 'Garden group' } });
    api.callGroupApi.mockResolvedValue(discussionPayload);
  });

  it('offers Translate on the discussion and on each reply', async () => {
    const page = await request(groupsApp()).get('/groups/42/discussions/3');
    expect(page.status).toBe(200);
    expect(page.text.match(/action="\/groups\/42\/discussions\/3\/translate"/g)).toHaveLength(2);
    expect(page.text).toContain(t('govuk_alpha_feed.translate.discussion_button'));
    expect(page.text).toContain(t('govuk_alpha_feed.translate.reply_by', { name: 'Luis' }));
  });

  it('translates the discussion itself and shows it once under it', async () => {
    api.callUgcTranslateApi.mockResolvedValue({ data: { translated_text: 'Who wants to plant?' } });
    const agent = request.agent(groupsApp());

    const res = await agent.post('/groups/42/discussions/3/translate').type('form').send({});

    expect(api.callUgcTranslateApi).toHaveBeenCalledWith('test-token', {
      content_type: 'group_discussion',
      content_id: 3,
      source_text: '¿Quién quiere plantar?',
      target_locale: 'en'
    });
    expect(res.headers.location).toBe('/groups/42/discussions/3?status=translate-done#discussion-translation');
    const page = await agent.get('/groups/42/discussions/3?status=translate-done');
    expect(page.text).toContain('Who wants to plant?');
    expect(page.text).toContain(t('govuk_alpha_feed.translate.text_done'));
    const again = await agent.get('/groups/42/discussions/3');
    expect(again.text).not.toContain('Who wants to plant?');
  });

  it('translates one reply, keeping the page of the thread the member was on', async () => {
    api.callUgcTranslateApi.mockResolvedValue({ data: { translated_text: 'I can go' } });
    const agent = request.agent(groupsApp());

    const res = await agent.post('/groups/42/discussions/3/translate').type('form').send({ message_id: '100', cursor: 'abc' });

    expect(api.callGroupApi.mock.calls.at(-1)[2]).toContain('cursor=abc');
    expect(api.callUgcTranslateApi).toHaveBeenCalledWith('test-token', expect.objectContaining({
      content_type: 'group_discussion_reply',
      content_id: 100,
      source_text: 'Yo puedo ir'
    }));
    expect(res.headers.location).toBe('/groups/42/discussions/3?cursor=abc&status=translate-done#reply-100');
    const page = await agent.get('/groups/42/discussions/3?cursor=abc&status=translate-done');
    expect(page.text).toContain('I can go');
  });

  it('reports a failed translation honestly', async () => {
    api.callUgcTranslateApi.mockRejectedValue(new api.ApiError('refused', 422, { errors: [{ code: 'TRANSLATION_FAILED' }] }));
    const res = await request(groupsApp()).post('/groups/42/discussions/3/translate').type('form').send({});
    expect(res.headers.location).toBe('/groups/42/discussions/3?status=translate-failed');
    const page = await request(groupsApp()).get('/groups/42/discussions/3?status=translate-failed');
    expect(page.text).toContain(t('govuk_alpha_feed.translate.text_failed'));
  });
});

describe('translate a comment on an event or a volunteering opportunity (31 Oct 2026)', () => {
  it('reads the thread for that target, returns to its page and keeps the result for it', async () => {
    api.callUgcTranslateApi.mockResolvedValue({ data: { translated_text: 'Thank you, very useful' } });
    const session = {};
    const app = express();
    app.use(express.urlencoded({ extended: true }));
    app.use((req, res, next) => { req.session = session; next(); });
    app.use('/feed', (req, res, next) => {
      req.signedCookies = { token: 'test-token' };
      req.token = 'test-token';
      req.locale = 'en';
      res.locals.urlFor = (value) => String(value || '/');
      next();
    }, require('../src/routes/feed-actions'));

    const res = await request(app).post('/feed/comments/12/translate').type('form')
      .send({ item_type: 'event', item_id: '44', return_to: '/events/44' });

    expect(api.getComments).toHaveBeenCalledWith('test-token', { target_type: 'event', target_id: 44 });
    expect(res.headers.location).toBe('/events/44?social=comment-translate-done#comment-12');
    expect(session.targetCommentTranslation).toEqual(expect.objectContaining({ targetType: 'event', targetId: 44, commentId: 12, text: 'Thank you, very useful' }));
  });

  it("refuses a return page that is not the target's own page", async () => {
    const res = await request(feedApp()).post('/feed/comments/12/translate').type('form')
      .send({ item_type: 'event', item_id: '44', return_to: 'https://evil.example/' });
    expect(res.headers.location).toBe('/feed');
    expect(api.callUgcTranslateApi).not.toHaveBeenCalled();
  });

  it('shows the translation once under its comment and offers Translate on the others', async () => {
    const { takeCommentTranslation } = require('../src/lib/target-comments');
    const req = { session: { targetCommentTranslation: { targetType: 'event', targetId: 44, commentId: 12, text: 'Thank you, very useful', locale: 'en' } } };
    const res = { locals: { locale: 'en' } };
    const source = thread.data.comments[0].replies[0];
    req.session.targetCommentTranslation.binding = await require('../src/lib/ugc-translation').translationBinding(req, res, 'test-token', 'comment', source.id, { body: source.content });
    const translation = await takeCommentTranslation(req, 'event', 44, res, 'test-token', thread.data.comments);
    expect(await takeCommentTranslation(req, 'event', 44, res, 'test-token', thread.data.comments)).toBeNull();

    const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, watch: false });
    registerTemplateFilters(env);
    env.addFilter('formatDate', (value) => String(value || ''));
    const html = env.renderString(
      '{% from "partials/target-social.njk" import targetSocial %}{{ targetSocial(params, "csrf", urlFor, t) }}',
      {
        params: { item: { type: 'event', id: 44 }, comments: thread.data.comments, currentUserId: 1, returnTo: '/events/44', socialStatus: 'comment-translate-done', commentTranslation: translation },
        urlFor: (v) => v,
        t
      }
    );

    expect(html).toContain('Thank you, very useful');
    expect(html).toContain(t('govuk_alpha_feed.translate.text_done'));
    expect(html).toContain('action="/feed/comments/11/translate"');
    expect(html).not.toContain('action="/feed/comments/12/translate"');
    expect(html).toContain('name="item_type" value="event"');
    expect(html).toContain('name="return_to" value="/events/44"');
  });
});

