// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Owner, 31 Oct 2026: "this needs to work for everyone, whatever language they
 * speak". The accessible site could translate feed posts and their comments,
 * but not a listing (the AWID report's "ads") or the comments on it. A listing's
 * title and description, and each comment, can now be translated; the text is
 * read from the API, never taken from the form, and shown once on the page.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const nunjucks = require('nunjucks');
const request = require('supertest');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data = {}) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }
  return new Proxy({ ApiError, ApiOfflineError: class ApiOfflineError extends Error {} }, {
    get(target, prop) {
      if (!(prop in target)) target[prop] = jest.fn();
      return target[prop];
    }
  });
});
jest.mock('../src/middleware/auth', () => ({
  requireAuth: (req, res, next) => next(),
  withTokenRefresh: (handler) => handler
}));
jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() })
}));

const api = require('../src/lib/api');
const { createTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');
const listingsRouter = require('../src/routes/listings');

const t = createTranslator('en');
const viewsDir = path.join(__dirname, '..', 'src', 'views');
const env = nunjucks.configure([viewsDir, path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')], { autoescape: true, noCache: true });
registerTemplateFilters(env);

function createApp(session) {
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use((req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    req.session = session;
    req.locale = 'en';
    req.flash = jest.fn(() => []);
    req.t = t;
    res.locals.t = t;
    res.locals.urlFor = (value) => value;
    res.render = (view, locals = {}) => res.json({ view, locals });
    next();
  });
  app.use('/listings', listingsRouter);
  return app;
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getListing.mockResolvedValue({ data: { id: 9, title: 'Ayuda con jardinería', description: 'Necesito saber cómo tener mis plantas sanas.', user_id: 3 } });
  api.callUgcTranslateApi.mockImplementation(async (token, body) => ({
    data: { translated_text: body.content_type === 'listing_title' ? 'Help with gardening' : 'I need to know how to keep my plants healthy.' }
  }));
});

describe('translate a listing', () => {
  it('translates the title and description read from the API and shows them once', async () => {
    const session = {};
    const res = await request(createApp(session)).post('/listings/9/translate').type('form').send({ description: 'tampered' });

    expect(api.callUgcTranslateApi).toHaveBeenCalledWith('test-token', expect.objectContaining({ content_type: 'listing', content_id: 9, source_text: 'Necesito saber cómo tener mis plantas sanas.' }));
    expect(api.callUgcTranslateApi).toHaveBeenCalledWith('test-token', expect.objectContaining({ content_type: 'listing_title', source_text: 'Ayuda con jardinería' }));
    expect(res.headers.location).toBe('/listings/9?status=translate-done#listing-translation');

    const page = await request(createApp(session)).get('/listings/9');
    expect(page.body.locals.listingTranslation).toEqual(expect.objectContaining({ title: 'Help with gardening', description: 'I need to know how to keep my plants healthy.' }));
    const again = await request(createApp(session)).get('/listings/9');
    expect(again.body.locals.listingTranslation).toBeNull();
  });

  it('reports a failed translation honestly', async () => {
    api.callUgcTranslateApi.mockRejectedValue(new api.ApiError('refused', 422, { errors: [{ code: 'TRANSLATION_FAILED' }] }));
    const res = await request(createApp({})).post('/listings/9/translate').type('form').send({});
    expect(res.headers.location).toBe('/listings/9?status=translate-failed');
  });

  // Found on the 31 Oct walkthrough: a community with no translation key got
  // "try again later", which never helps. The API says TRANSLATION_NOT_SET_UP.
  it('says translation is not available when the community has not set it up', async () => {
    api.callUgcTranslateApi.mockRejectedValue(new api.ApiError('not set up', 422, { errors: [{ code: 'TRANSLATION_NOT_SET_UP' }] }));
    const res = await request(createApp({})).post('/listings/9/translate').type('form').send({});
    expect(res.headers.location).toBe('/listings/9?status=translate-unavailable');
  });

  it('shows the translation under the description, or the button when there is none', () => {
    const source = fs.readFileSync(path.join(viewsDir, 'listings/detail.njk'), 'utf8');
    const start = source.indexOf('{# Translate the title and description');
    const end = source.indexOf('{% endif %}', source.indexOf('listing_button', start)) + '{% endif %}'.length;
    const block = source.slice(start, end);
    const listing = { id: 9, title: 'Ayuda', description: 'Hola' };

    const withButton = env.renderString(block, { t, listing, isAuthenticated: true, csrfToken: 'c', urlFor: (v) => v });
    expect(withButton).toContain('action="/listings/9/translate"');
    expect(withButton).toContain(t('govuk_alpha_feed.translate.listing_button'));

    const translated = env.renderString(block, { t, listing, urlFor: v => v, isAuthenticated: true, listingTranslation: { title: 'Help', description: 'Hello', locale: 'en' } });
    expect(translated).toContain('Help');
    expect(translated).toContain('id="listing-translation"');
    expect(translated).not.toContain('/translate"');
  });
});

describe('translate a comment on a listing', () => {
  it('offers Translate on each comment and shows a translation once under its comment', async () => {
    api.callListing.mockResolvedValue({ data: { id: 9, title: 'Ayuda' } });
    api.getComments.mockResolvedValue({ data: { comments: [{ id: 21, content: '¿Cuándo?', author: { name: 'Luis' }, replies: [] }], count: 1 } });
    const session = { targetCommentTranslation: { targetType: 'listing', targetId: 9, commentId: 21, text: 'When?', locale: 'en' } };

    session.targetCommentTranslation.binding = await require('../src/lib/ugc-translation').translationBinding({ locale: 'en' }, { locals: {} }, 'test-token', 'comment', 21, { body: '¿Cuándo?' });
    const page = await request(createApp(session)).get('/listings/9/comments?status=comment-translate-done');
    expect(page.body.locals.commentTranslation).toEqual(expect.objectContaining({ commentId: 21, text: 'When?' }));
    expect(page.body.locals.status.message).toBe(t('govuk_alpha_feed.translate.text_done'));

    const html = env.renderString('{% for comment in comments %}{% include "listings/_comment.njk" %}{% endfor %}', {
      t, comments: [{ id: 21, content: '¿Cuándo?', authorName: 'Luis', replies: [] }, { id: 22, content: 'Mañana', authorName: 'Ana', replies: [] }],
      listing: { id: 9 }, commentTranslation: page.body.locals.commentTranslation, csrfToken: 'c', urlFor: (v) => v
    });
    expect(html).toContain('When?');
    expect(html).toContain('action="/feed/comments/22/translate"');
    expect(html).not.toContain('action="/feed/comments/21/translate"');
    expect(html).toContain('name="return_to" value="/listings/9/comments"');
  });
});
