// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Feed gaps found by the deep React parity audit of 27 Oct 2026
 * (frontend-drift/2026-10-27-deep-evidence, F4-F11):
 *
 *  1. Posts offered 3 reactions where React offers 8; comments 3 where React offers 6.
 *  2. Nobody could see who reacted to a feed post (React ReactionSummary).
 *  3. The single-post and hashtag pages had no hide / mute / report / delete.
 *  4. "Not interested" was only on the item page, not on the main feed list.
 *  5. Sharing could not carry the member's own comment (quote-share).
 *  6. A post could not be translated (React FeedCard TranslateButton).
 *  7. No "Why am I seeing this?" explanation in the ranked feed.
 *  8. A post's author could not see its statistics (React PostAnalyticsModal).
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
    createFeedPostV2: jest.fn(),
    updateFeedPostV2: jest.fn(),
    deleteFeedPostV2: jest.fn(),
    hideFeedItem: jest.fn(),
    markFeedItemNotInterested: jest.fn(),
    muteFeedUser: jest.fn(),
    reportFeedItem: jest.fn(),
    shareFeedItem: jest.fn(),
    saveSavedItem: jest.fn(),
    checkSavedItem: jest.fn(),
    unsaveSavedItem: jest.fn(),
    voteFeedPoll: jest.fn(),
    createComment: jest.fn(),
    updateComment: jest.fn(),
    deleteComment: jest.fn(),
    toggleReaction: jest.fn(),
    toggleFeedLike: jest.fn()
  };
});

const api = require('../src/lib/api');
const feedRoutes = require('../src/routes/feed');
const feedActionRoutes = require('../src/routes/feed-actions');

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');

function buildApp() {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  env.addFilter('formatDate', (value) => String(value || ''));
  env.addFilter('formatBladeDateTime', (value) => String(value || ''));
  env.addFilter('nl2br', (value) => String(value || ''));
  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'feed-parity-oct27-test-secret-32chars', resave: false, saveUninitialized: false }));
  app.use('/feed', (req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    req.locale = 'fr';
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
      locale: 'fr',
      t: createTranslator('en'),
      tc: createChoiceTranslator('en'),
      formatLocaleNumber: (value) => String(value ?? ''),
      formatLocaleDate: (value) => String(value ?? '')
    });
    next();
  });
  app.use('/feed', feedActionRoutes);
  app.use('/feed', feedRoutes);
  return app;
}

const t = createTranslator('en');

function post(overrides = {}) {
  return {
    id: 5,
    type: 'post',
    content: 'Bonjour tout le monde',
    author: { id: 9, name: 'Ann Other' },
    likes_count: 0,
    comments_count: 0,
    reactions: { counts: { love: 2, clap: 1 }, user_reaction: null },
    ...overrides
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getProfile.mockResolvedValue({ data: { id: 1 } });
  api.getComments.mockResolvedValue({ data: { comments: [] } });
  api.getFeedPostV2.mockResolvedValue({ data: post() });
  api.toggleReaction.mockResolvedValue({ data: { action: 'added' } });
});

describe('1. all eight post reactions and six comment reactions', () => {
  it('accepts clap and time_credit on a post, as React does', async () => {
    const app = buildApp();
    for (const emoji of ['clap', 'time_credit', 'laugh', 'wow', 'sad']) {
      await request(app).post('/feed/posts/5/react').type('form').send({ emoji });
    }
    expect(api.toggleReaction.mock.calls.map((call) => call[1].reaction_type))
      .toEqual(['clap', 'time_credit', 'laugh', 'wow', 'sad']);
  });

  it('accepts the six comment reactions but not clap on a comment', async () => {
    const app = buildApp();
    await request(app).post('/feed/comments/3/react').type('form').send({ emoji: 'wow' });
    await request(app).post('/feed/comments/3/react').type('form').send({ emoji: 'clap' });
    expect(api.toggleReaction).toHaveBeenCalledTimes(1);
    expect(api.toggleReaction.mock.calls[0][1]).toEqual({ target_type: 'comment', target_id: 3, reaction_type: 'wow' });
  });

  it('renders the eight reaction buttons on the single-post page', async () => {
    const res = await request(buildApp()).get('/feed/posts/5');
    expect(res.status).toBe(200);
    for (const type of ['like', 'love', 'laugh', 'wow', 'sad', 'celebrate', 'clap', 'time_credit']) {
      expect(res.text).toContain(`name="emoji" value="${type}"`);
    }
    expect(res.text).toContain(t('govuk_alpha_feed.reactions.time_credit'));
    // The hardcoded English "Remove like" / "Like" labels are gone.
    expect(res.text).not.toMatch(/>\s*Remove like\s*</);
  });

  it('renders the six comment reactions on comments', async () => {
    api.getComments.mockResolvedValue({ data: { comments: [{ id: 3, content: 'Nice', author: { id: 4, name: 'Bo' } }] } });
    const res = await request(buildApp()).get('/feed/posts/5');
    const commentForms = res.text.split('/feed/comments/3/react').length - 1;
    expect(commentForms).toBe(6);
  });
});

describe('2. who reacted to a post', () => {
  it('links each reaction that has reactors to its list', async () => {
    const res = await request(buildApp()).get('/feed/posts/5');
    expect(res.text).toContain('href="/feed/posts/5/reactions/love"');
    expect(res.text).toContain('href="/feed/posts/5/reactions/clap"');
    expect(res.text).not.toContain('href="/feed/posts/5/reactions/sad"');
  });

  it('lists the members who reacted', async () => {
    api.getReactors.mockResolvedValue({ data: [{ id: 7, name: 'Cara Doe' }], meta: { total: 1, has_more: false } });
    const res = await request(buildApp()).get('/feed/posts/5/reactions/love');
    expect(res.status).toBe(200);
    expect(api.getReactors).toHaveBeenCalledWith('test-token', 'post', 5, 'love', { page: 1, per_page: 20 });
    expect(res.text).toContain('Cara Doe');
    expect(res.text).toContain('href="/members/7"');
    expect(res.text).toContain('href="/feed/posts/5"');
  });

  it('falls back to "like" for an unknown reaction', async () => {
    api.getReactors.mockResolvedValue({ data: [], meta: {} });
    await request(buildApp()).get('/feed/posts/5/reactions/bogus');
    expect(api.getReactors).toHaveBeenCalledWith('test-token', 'post', 5, 'like', expect.any(Object));
  });
});

describe('3. hide / mute / report / delete on the post and hashtag pages', () => {
  it('offers hide, mute and report on someone else\'s post', async () => {
    const res = await request(buildApp()).get('/feed/posts/5');
    expect(res.text).toContain('action="/feed/posts/5/hide"');
    expect(res.text).toContain('action="/feed/users/9/mute"');
    expect(res.text).toContain('action="/feed/posts/5/report"');
    expect(res.text).toContain('name="return_to" value="/feed/posts/5"');
    expect(res.text).not.toContain('action="/feed/posts/5/delete"');
  });

  it('offers delete on the member\'s own post', async () => {
    api.getFeedPostV2.mockResolvedValue({ data: post({ author: { id: 1, name: 'Me' } }) });
    const res = await request(buildApp()).get('/feed/posts/5');
    expect(res.text).toContain('action="/feed/posts/5/delete"');
    expect(res.text).not.toContain('action="/feed/posts/5/hide"');
  });

  it('offers the same menu on the hashtag page', async () => {
    api.getFeedHashtagPosts.mockResolvedValue({ data: [post()], meta: { total_items: 1 } });
    const res = await request(buildApp()).get('/feed/hashtag/garden');
    expect(res.text).toContain('action="/feed/posts/5/hide"');
    expect(res.text).toContain('action="/feed/posts/5/report"');
    expect(res.text).toContain('name="return_to" value="/feed/hashtag/garden"');
  });

  it('returns a report to the post page it came from', async () => {
    api.reportFeedItem.mockResolvedValue({});
    const res = await request(buildApp()).post('/feed/posts/5/report').type('form')
      .send({ type: 'post', reason: 'Spam', return_to: '/feed/posts/5' });
    expect(res.headers.location).toBe('/feed/posts/5?status=content-reported');
  });

  it('returns a hide to the hashtag page it came from', async () => {
    api.hideFeedItem.mockResolvedValue({});
    const res = await request(buildApp()).post('/feed/posts/5/hide').type('form')
      .send({ type: 'post', return_to: '/feed/hashtag/garden' });
    expect(res.headers.location).toBe('/feed/hashtag/garden?status=content-hidden');
  });

  it('sends a hide or delete from the post page to the feed, since the post is gone', async () => {
    api.hideFeedItem.mockResolvedValue({});
    api.deleteFeedPostV2.mockResolvedValue({});
    const hide = await request(buildApp()).post('/feed/posts/5/hide').type('form')
      .send({ type: 'post', return_to: '/feed/posts/5' });
    expect(hide.headers.location).toBe('/feed?status=content-hidden');
    const del = await request(buildApp()).post('/feed/posts/5/delete').type('form')
      .send({ return_to: '/feed/posts/5' });
    expect(del.headers.location).toBe('/feed?status=post-deleted');
  });

  it('ignores a return address that is not a feed page', async () => {
    api.reportFeedItem.mockResolvedValue({});
    const res = await request(buildApp()).post('/feed/posts/5/report').type('form')
      .send({ type: 'post', reason: 'Spam', return_to: 'https://evil.example/' });
    expect(res.headers.location).toBe('/feed?status=content-reported');
  });

  it('shows a moderation status on the hashtag page', async () => {
    api.getFeedHashtagPosts.mockResolvedValue({ data: [], meta: {} });
    const res = await request(buildApp()).get('/feed/hashtag/garden?status=content-hidden');
    expect(res.text).toContain(t('states.content-hidden'));
  });
});

describe('4-5, 7-8. the main feed list', () => {
  function feedWith(rows, meta = {}) {
    api.getFeedPosts.mockResolvedValue({ data: rows, meta });
  }

  it('offers "Not interested" on someone else\'s item', async () => {
    feedWith([post()]);
    const res = await request(buildApp()).get('/feed');
    expect(res.text).toContain('action="/feed/items/post/5/not-interested"');
  });

  it('lets a member share with their own comment', async () => {
    feedWith([post()]);
    const res = await request(buildApp()).get('/feed');
    expect(res.text).toMatch(/<form method="post" action="\/feed\/posts\/5\/share" novalidate>[\s\S]*?name="comment"/);
    expect(res.text).toContain(t('govuk_alpha_feed.quote.submit'));
  });

  it('passes the share comment to the API', async () => {
    api.shareFeedItem.mockResolvedValue({ data: { shared: true } });
    await request(buildApp()).post('/feed/posts/5/share').type('form').send({ comment: 'Worth a read' });
    expect(api.shareFeedItem).toHaveBeenCalledWith('test-token', { type: 'post', id: 5, comment: 'Worth a read' });
  });

  it('explains why an item is shown in the ranked feed, using the API reasons', async () => {
    feedWith([post({ ranking_reasons: ['Popular in your community'] })]);
    const res = await request(buildApp()).get('/feed');
    expect(res.text).toContain(t('govuk_alpha_feed.why_shown.label'));
    expect(res.text).toContain('Popular in your community');
  });

  it('falls back to the neutral reason, and says nothing in the recent feed', async () => {
    feedWith([post()]);
    const ranked = await request(buildApp()).get('/feed');
    expect(ranked.text).toContain(t('govuk_alpha_feed.why_shown.default_reason'));
    const recent = await request(buildApp()).get('/feed?mode=recent');
    expect(recent.text).not.toContain(t('govuk_alpha_feed.why_shown.label'));
  });

  it('links the author to their post statistics, and nobody else', async () => {
    feedWith([post({ author: { id: 1, name: 'Me' } }), post({ id: 6 })]);
    const res = await request(buildApp()).get('/feed');
    expect(res.text).toContain('href="/feed/posts/5/stats"');
    expect(res.text).not.toContain('href="/feed/posts/6/stats"');
  });
});

describe('6. translate a post', () => {
  it('translates the post content into the member\'s language and shows it once', async () => {
    api.callUgcTranslateApi.mockResolvedValue({ data: { translated_text: 'Hello everyone' } });
    const agent = request.agent(buildApp());
    const res = await agent.post('/feed/posts/5/translate').type('form').send({});
    expect(api.callUgcTranslateApi).toHaveBeenCalledWith('test-token', {
      content_type: 'feed_post',
      content_id: 5,
      source_text: 'Bonjour tout le monde',
      target_locale: 'fr'
    });
    expect(res.headers.location).toBe('/feed/posts/5?status=translate-done#post-translation');
    const page = await agent.get('/feed/posts/5?status=translate-done');
    expect(page.text).toContain('Hello everyone');
    expect(page.text).toContain('lang="fr"');
    const again = await agent.get('/feed/posts/5');
    expect(again.text).not.toContain('Hello everyone');
  });

  it('offers the translate button on the post page and on posts in the feed', async () => {
    const page = await request(buildApp()).get('/feed/posts/5');
    expect(page.text).toContain('action="/feed/posts/5/translate"');
    api.getFeedPosts.mockResolvedValue({ data: [post()], meta: {} });
    const feed = await request(buildApp()).get('/feed');
    expect(feed.text).toContain('action="/feed/posts/5/translate"');
  });

  it('reports a failed translation honestly', async () => {
    const { ApiError } = api;
    api.callUgcTranslateApi.mockRejectedValue(new ApiError('nope', 503, {}));
    const res = await request(buildApp()).post('/feed/posts/5/translate').type('form').send({});
    expect(res.headers.location).toBe('/feed/posts/5?status=translate-failed');
    const page = await request(buildApp()).get('/feed/posts/5?status=translate-failed');
    expect(page.text).toContain(t('govuk_alpha_feed.translate.failed'));
    expect(page.text).toContain('govuk-error-summary');
  });
});

describe('8. post statistics', () => {
  it('shows the author the numbers the API returns', async () => {
    api.getFeedPostAnalytics.mockResolvedValue({
      data: { views_count: 120, likes_count: 4, comments_count: 3, shares_count: 2, reach_estimate: 80, reactions_breakdown: { love: 2 } }
    });
    const res = await request(buildApp()).get('/feed/posts/5/stats');
    expect(res.status).toBe(200);
    expect(api.getFeedPostAnalytics).toHaveBeenCalledWith('test-token', 5);
    expect(res.text).toContain(t('govuk_alpha_feed.stats.title'));
    expect(res.text).toContain('120');
    expect(res.text).toContain('80');
    expect(res.text).toContain(t('govuk_alpha_feed.reactions.love'));
  });

  it('explains when someone else\'s post is refused', async () => {
    const { ApiError } = api;
    api.getFeedPostAnalytics.mockRejectedValue(new ApiError('Forbidden', 403, {}));
    const res = await request(buildApp()).get('/feed/posts/5/stats');
    expect(res.status).toBe(403);
    expect(res.text).toContain(t('govuk_alpha_feed.stats.forbidden'));
  });
});
