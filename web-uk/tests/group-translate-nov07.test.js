// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AWID accessibility report, Oct 2026, point 3: "posts inside groups aren't
 * translated, even with Spanish set as the default language". The website had
 * Translate on group posts and group chats; the accessible site had it only
 * after "Open post", and never in a group chat.
 *
 *  - a post in a group's own feed now has Translate (the feed's own route);
 *  - a group chat message has Translate, read from Laravel, shown once under it.
 * (Group chat rooms are covered in group-channels.test.js.)
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
    invalidateMessageUnreadCount: jest.fn(),
    callMessageApi: jest.fn(),
    callConversationApi: jest.fn(),
    getProfile: jest.fn()
  }, {
    get: (target, prop) => (prop in target ? target[prop] : jest.fn().mockResolvedValue({ data: [] }))
  });
});

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() })
}));

const api = require('../src/lib/api');
const messagesRoutes = require('../src/routes/messages');

const ME = 900014;
const SPANISH = 'Hola a todos, ¿alguien puede ayudarme mañana con la mudanza? Necesito dos personas por la tarde.';
const ENGLISH = 'Is anyone driving to the market on Saturday morning? I need a lift for two boxes.';

function views() {
  const environment = nunjucks.configure(
    [path.join(__dirname, '..', 'src', 'views'),
      path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
    { autoescape: true, noCache: true }
  );
  require('../src/lib/template-filters').registerTemplateFilters(environment);
  environment.addFilter('nl2br', (value) => value);
  environment.addFilter('formatBladeDateTime', (value) => String(value || ''));
  return environment;
}

function mount(tenantExtra = {}) {
  const app = express();
  const environment = views();
  environment.express(app);
  app.set('view engine', 'njk');
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'group-translate-test-secret-at-least-32', resave: false, saveUninitialized: false }));
  app.use('/', (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.csrfToken = () => 'csrf';
    req.flash = (key, value) => {
      req.session.flash = req.session.flash || {};
      if (value !== undefined) {
        (req.session.flash[key] = req.session.flash[key] || []).push(value);
        return undefined;
      }
      const values = req.session.flash[key] || [];
      delete req.session.flash[key];
      return values;
    };
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'test', prefix: '', tenant: { id: 2, slug: 'test', ...tenantExtra } };
    res.locals.urlFor = (v) => String(v || '/');
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS',
      tenantName: 'Test',
      isAuthenticated: true,
      csrfToken: 'csrf',
      locale: 'en',
      t: createTranslator('en'),
      tc: createChoiceTranslator('en'),
      htmlLang: 'en',
      htmlDirection: 'ltr',
      formatLocaleDate: () => '7 November 2026'
    });
    next();
  }, messagesRoutes);
  return app;
}

describe('Translate on a post in a group\'s own feed', () => {
  const environment = views();
  const t = createTranslator('en');

  function renderPost(post) {
    const template = '{% from "groups/_feed-item.njk" import groupFeedItem %}{{ groupFeedItem(post, group, "", "csrf", urlFor, t, tc) }}';
    return environment.renderString(template, {
      post: { type: 'post', id: 41, authorName: 'Ana Ruiz', media: [], likeCount: 0, commentCount: 0, isOwn: false, ...post },
      group: { id: 974, name: 'Repair crew' },
      urlFor: (value) => value,
      t,
      tc: createChoiceTranslator('en')
    });
  }

  it('offers Translate, through the feed\'s own route, on a post in another language', () => {
    const html = renderPost({ contentParagraphs: [SPANISH] });
    expect(html).toContain('action="/feed/posts/41/translate"');
  });

  it('does not offer it on a post already in the reader\'s language', () => {
    const html = renderPost({ contentParagraphs: [ENGLISH] });
    expect(html).not.toContain('/translate"');
  });
});

describe('Translate in a group chat', () => {
  const app = mount();

  beforeEach(() => {
    jest.clearAllMocks();
    api.getProfile.mockResolvedValue({ data: { id: ME, name: 'E2E UserA' } });
    api.callConversationApi.mockImplementation(async (token, method, apiPath) => {
      if (apiPath.startsWith('/55/messages')) {
        return { data: [{ id: 9, body: SPANISH, sender_id: 900015, sender: { name: 'Ana Ruiz' }, created_at: '2026-11-07 10:00:00' }], meta: { conversation: { id: 55, name: 'Movers' } } };
      }
      if (apiPath === '/55/participants') return { data: [{ id: ME, role: 'member' }, { id: 900015, role: 'member' }] };
      return { data: [] };
    });
  });

  it('offers Translate on a message in another language', async () => {
    api.callMessageApi.mockResolvedValue({ data: { reactions: {} } });
    const res = await request(app).get('/groups/55');
    expect(res.status).toBe(200);
    expect(res.text).toContain('action="/messages/groups/55/m/9/translate"');
  });

  it('asks Laravel to translate the message and shows the translation under it', async () => {
    api.callMessageApi.mockImplementation(async (token, method, apiPath) => (
      method === 'POST' && apiPath === '/9/translate'
        ? { data: { translated_text: ENGLISH } }
        : { data: { reactions: {} } }
    ));
    const agent = request.agent(app);

    const post = await agent.post('/groups/55/m/9/translate').type('form').send({ _csrf: 'csrf', target_language: 'en' });

    expect(api.callMessageApi).toHaveBeenCalledWith('token:test', 'POST', '/9/translate', { target_language: 'en' });
    expect(post.headers.location).toBe('/messages/groups/55?status=translate-done#m-9');
    const page = await agent.get('/groups/55?status=translate-done');
    expect(page.text).toContain(ENGLISH);
    expect(page.text).toContain(createTranslator('en')('govuk_alpha_messages.translate.done'));
  });

  it('says plainly when translation is not set up', async () => {
    api.callMessageApi.mockRejectedValue(new api.ApiError('No', 422, { errors: [{ code: 'TRANSLATION_NOT_SET_UP' }] }));

    const post = await request(app).post('/groups/55/m/9/translate').type('form').send({ _csrf: 'csrf', target_language: 'en' });

    expect(post.headers.location).toBe('/messages/groups/55?status=translate-unavailable#m-9');
  });

  it('is not offered when the community switched message translation off', async () => {
    api.callMessageApi.mockResolvedValue({ data: { reactions: {} } });
    const off = mount({ features: { message_translation: false } });
    const page = await request(off).get('/groups/55');
    expect(page.text).not.toContain('/translate"');
    const post = await request(off).post('/groups/55/m/9/translate').type('form').send({ _csrf: 'csrf' });
    expect(post.headers.location).toBe('/messages/groups/55?status=translate-unavailable#m-9');
    expect(api.callMessageApi).not.toHaveBeenCalledWith('token:test', 'POST', '/9/translate', expect.anything());
  });
});
