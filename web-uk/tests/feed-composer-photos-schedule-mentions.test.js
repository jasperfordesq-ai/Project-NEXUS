// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Feed composer and @mention gaps found by the deep React parity audit of 27 Oct 2026
 * (frontend-drift/2026-10-27-deep-evidence/deep_result_a.md, F3 and F13 / table #37):
 *
 *  1. The main feed composer took text and ONE image. React PostTab takes up to ten
 *     images, each with its own alt text (media[] + alt_texts[]), and can schedule a
 *     post for later (publish_status=scheduled + scheduled_at).
 *  2. The API reads "@username" from plain text (MentionService::extractMentions), but
 *     web-uk never showed anyone's username, so a member could not know what to type.
 *     The username now shows on a member's profile, and the feed and comment forms
 *     explain mentions and link to a page that finds a member's username — the same
 *     search React's mention picker uses (GET /api/v2/mentions/search).
 */

const path = require('path');
const express = require('express');
const session = require('express-session');
const nunjucks = require('nunjucks');
const request = require('supertest');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');
const { registerTemplateFilters } = require('../src/lib/template-filters');
const { parseMultipartForm } = require('../src/middleware/multipart');

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
    searchMentionUsers: jest.fn(),
    callUgcTranslateApi: jest.fn(),
    getComments: jest.fn(),
    getProfile: jest.fn(),
    getTenantBootstrap: jest.fn(),
    invalidateUserCache: jest.fn(),
    createFeedPostV2: jest.fn(),
    createFeedPostWithMedia: jest.fn(),
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
  app.use(session({ secret: 'feed-composer-photos-test-secret-32c', resave: false, saveUninitialized: false }));
  // Same limits as server.js: ten photos of up to 5 MB each.
  app.use('/feed/posts', parseMultipartForm({ maxFileSize: 5 * 1024 * 1024, maxTotalFileSize: 50 * 1024 * 1024, maxFiles: 10 }));
  app.use('/feed', (req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
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
const IMAGE = Buffer.from('fake image bytes', 'utf8');

beforeEach(() => {
  jest.clearAllMocks();
  api.getProfile.mockResolvedValue({ data: { id: 1 } });
  api.getComments.mockResolvedValue({ data: { comments: [] } });
  api.getFeedPosts.mockResolvedValue({ data: [], meta: { per_page: 10, has_more: false } });
  api.createFeedPostV2.mockResolvedValue({ data: { id: 1 } });
  api.createFeedPostWithMedia.mockResolvedValue({ data: { id: 1 } });
  api.searchMentionUsers.mockResolvedValue({ data: [] });
});

describe('1. the feed composer: up to ten photos with alt text, and publish later', () => {
  it('offers ten photo fields, each with its own description, and a publish-later date and time', async () => {
    const res = await request(buildApp()).get('/feed');
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="image"');
    expect(res.text).toContain('name="image_alt"');
    for (let number = 2; number <= 10; number += 1) {
      expect(res.text).toContain(`name="image_${number}"`);
      expect(res.text).toContain(`name="image_${number}_alt"`);
    }
    expect(res.text).not.toContain('name="image_11"');
    expect(res.text).toContain('name="schedule-day"');
    expect(res.text).toContain('name="schedule-month"');
    expect(res.text).toContain('name="schedule-year"');
    expect(res.text).toContain('name="schedule-time"');
  });

  it('sends several photos with their own alt text, as React does (media[] + alt_texts[])', async () => {
    const res = await request(buildApp())
      .post('/feed/posts')
      .field('content', 'Garden day')
      .field('image_alt', 'Planting herbs')
      .field('image_2_alt', 'The finished bed')
      .field('image_3_alt', '')
      .attach('image', IMAGE, { filename: 'one.png', contentType: 'image/png' })
      .attach('image_2', IMAGE, { filename: 'two.jpg', contentType: 'image/jpeg' })
      .attach('image_3', IMAGE, { filename: 'three.webp', contentType: 'image/webp' });

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/feed?status=post-created');
    expect(api.createFeedPostV2).not.toHaveBeenCalled();
    expect(api.createFeedPostWithMedia).toHaveBeenCalledTimes(1);
    const [token, payload] = api.createFeedPostWithMedia.mock.calls[0];
    expect(token).toBe('test-token');
    expect(payload).toEqual(expect.objectContaining({ content: 'Garden day', visibility: 'public' }));
    expect(payload).not.toHaveProperty('group_id');
    expect(payload).not.toHaveProperty('publish_status');
    expect(payload.files.map((file) => [file.filename, file.contentType, file.altText])).toEqual([
      ['one.png', 'image/png', 'Planting herbs'],
      ['two.jpg', 'image/jpeg', 'The finished bed'],
      ['three.webp', 'image/webp', '']
    ]);
    expect(payload.files[0].buffer).toEqual(IMAGE);
  });

  it('keeps a single photo on the existing call, with its alt text', async () => {
    const res = await request(buildApp())
      .post('/feed/posts')
      .field('content', 'One photo')
      .field('image_alt', 'A spade')
      .attach('image', IMAGE, { filename: 'spade.png', contentType: 'image/png' });

    expect(res.headers.location).toBe('/feed?status=post-created');
    expect(api.createFeedPostWithMedia).not.toHaveBeenCalled();
    expect(api.createFeedPostV2).toHaveBeenCalledWith('test-token', expect.objectContaining({
      content: 'One photo',
      visibility: 'public',
      image_alt: 'A spade',
      file: expect.objectContaining({ filename: 'spade.png', contentType: 'image/png' })
    }));
  });

  it('a photo in a later field alone still goes through', async () => {
    await request(buildApp())
      .post('/feed/posts')
      .field('content', 'Later field')
      .field('image_4_alt', 'A rake')
      .attach('image_4', IMAGE, { filename: 'rake.gif', contentType: 'image/gif' });

    expect(api.createFeedPostV2).toHaveBeenCalledWith('test-token', expect.objectContaining({
      image_alt: 'A rake',
      file: expect.objectContaining({ filename: 'rake.gif' })
    }));
  });

  it('refuses a file that is not a JPG, PNG, GIF or WEBP image, keeping the words', async () => {
    const agent = request.agent(buildApp());
    const res = await agent
      .post('/feed/posts')
      .field('content', 'Words to keep')
      .attach('image_2', Buffer.from('%PDF'), { filename: 'notes.pdf', contentType: 'application/pdf' });

    expect(res.headers.location).toBe('/feed?status=post-image-invalid');
    expect(api.createFeedPostV2).not.toHaveBeenCalled();
    expect(api.createFeedPostWithMedia).not.toHaveBeenCalled();

    const page = await agent.get(res.headers.location);
    expect(page.text).toContain(t('govuk_alpha_feed.compose.image_invalid'));
    expect(page.text).toContain('Words to keep');
  });

  it('schedules a text post with exactly what React sends', async () => {
    const res = await request(buildApp())
      .post('/feed/posts')
      .type('form')
      .send({
        content: 'See you Saturday',
        'schedule-day': '14',
        'schedule-month': '11',
        'schedule-year': '2030',
        'schedule-time': '9:30am'
      });

    expect(res.headers.location).toBe('/feed?status=post-scheduled');
    expect(api.createFeedPostV2).toHaveBeenCalledWith('test-token', {
      content: 'See you Saturday',
      visibility: 'public',
      publish_status: 'scheduled',
      scheduled_at: '2030-11-14T09:30:00'
    });
  });

  it('schedules a post with several photos', async () => {
    await request(buildApp())
      .post('/feed/posts')
      .field('content', 'Later, with photos')
      .field('schedule-day', '1')
      .field('schedule-month', '12')
      .field('schedule-year', '2030')
      .field('schedule-time', '18:05')
      .attach('image', IMAGE, { filename: 'a.png', contentType: 'image/png' })
      .attach('image_2', IMAGE, { filename: 'b.png', contentType: 'image/png' });

    expect(api.createFeedPostWithMedia).toHaveBeenCalledWith('test-token', expect.objectContaining({
      publish_status: 'scheduled',
      scheduled_at: '2030-12-01T18:05:00'
    }));
  });

  it('confirms a scheduled post in words', async () => {
    const res = await request(buildApp()).get('/feed?status=post-scheduled');
    expect(res.text).toContain(t('govuk_alpha_feed.compose.scheduled'));
  });

  it('refuses a half-entered date, keeps what was typed, and sends nothing', async () => {
    const agent = request.agent(buildApp());
    const res = await agent
      .post('/feed/posts')
      .type('form')
      .send({
        content: 'Half a date',
        image_2_alt: 'Second photo words',
        'schedule-day': '14',
        'schedule-month': '',
        'schedule-year': '2030',
        'schedule-time': ''
      });

    expect(res.headers.location).toBe('/feed?status=post-schedule-invalid');
    expect(api.createFeedPostV2).not.toHaveBeenCalled();

    const page = await agent.get(res.headers.location);
    expect(page.text).toContain(t('govuk_alpha_feed.compose.schedule_invalid'));
    expect(page.text).toContain('Half a date');
    expect(page.text).toContain('value="Second photo words"');
    expect(page.text).toMatch(/name="schedule-day"[^>]*value="14"|value="14"[^>]*name="schedule-day"/);
    expect(page.text).toMatch(/name="schedule-year"[^>]*value="2030"|value="2030"[^>]*name="schedule-year"/);
  });

  it('still refuses an empty post', async () => {
    const res = await request(buildApp()).post('/feed/posts').type('form').send({ content: '  ' });
    expect(res.headers.location).toBe('/feed?status=post-empty');
  });

  it('sends the words as plain text, line breaks and links untouched, as the API stores them', async () => {
    await request(buildApp())
      .post('/feed/posts')
      .type('form')
      .send({ content: 'Line one\nLine two\n\nSee https://example.org/garden @ann_lee' });

    expect(api.createFeedPostV2).toHaveBeenCalledWith('test-token', {
      content: 'Line one\nLine two\n\nSee https://example.org/garden @ann_lee',
      visibility: 'public'
    });
  });
});

describe('2. usable @mentions', () => {
  it('explains mentions on the post form and on comment forms, linking to the username finder', async () => {
    api.getFeedPosts.mockResolvedValue({
      data: [{ id: 5, type: 'post', content: 'Hello', author: { id: 9, name: 'Ann' } }],
      meta: { per_page: 10, has_more: false }
    });
    const res = await request(buildApp()).get('/feed');
    const hint = t('govuk_alpha_feed.mentions.hint');
    expect(hint).not.toBe('govuk_alpha_feed.mentions.hint');
    expect(res.text.split(hint).length - 1).toBeGreaterThanOrEqual(2);
    expect(res.text).toContain('href="/feed/mentions"');
  });

  it('explains mentions on the single post page comment form', async () => {
    api.getFeedPostV2.mockResolvedValue({ data: { id: 5, type: 'post', content: 'Hello', author: { id: 9, name: 'Ann' } } });
    const res = await request(buildApp()).get('/feed/posts/5');
    expect(res.text).toContain(t('govuk_alpha_feed.mentions.hint'));
  });

  it('finds members and shows the username to type, from the mention search React uses', async () => {
    api.searchMentionUsers.mockResolvedValue({
      data: [
        { id: 7, name: 'Ann Lee', username: 'ann_lee', first_name: 'Ann' },
        { id: 8, name: 'Bo Ng', username: null, first_name: 'Bo' },
        { id: 9, name: 'Odd Name', username: 'has space', first_name: 'Odd' }
      ]
    });
    const res = await request(buildApp()).get('/feed/mentions?q=ann');

    expect(res.status).toBe(200);
    expect(api.searchMentionUsers).toHaveBeenCalledWith('test-token', 'ann');
    expect(res.text).toContain('Ann Lee');
    expect(res.text).toContain('@ann_lee');
    expect(res.text).toContain('href="/members/7"');
    // No username, or one that the server's @mention pattern cannot read: say so
    // rather than offer something that would not work.
    expect(res.text).toContain('Bo Ng');
    expect(res.text).not.toContain('@has space');
    expect(res.text.split(t('govuk_alpha_feed.mentions.no_username')).length - 1).toBe(2);
  });

  it('shows the search form with no API call before anything is typed', async () => {
    const res = await request(buildApp()).get('/feed/mentions');
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="q"');
    expect(api.searchMentionUsers).not.toHaveBeenCalled();
  });

  it('says when nobody matches, and when the search failed', async () => {
    const empty = await request(buildApp()).get('/feed/mentions?q=zz');
    expect(empty.text).toContain(t('govuk_alpha_feed.mentions.no_results'));

    api.searchMentionUsers.mockRejectedValueOnce(new api.ApiError('boom', 500));
    const failed = await request(buildApp()).get('/feed/mentions?q=zz');
    expect(failed.text).toContain(t('govuk_alpha_feed.mentions.failed'));
  });
});

describe('server.js parses up to ten feed photos before the CSRF check', () => {
  const fs = require('node:fs');
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');

  it('mounts the /feed/posts parser with room for ten 5 MB photos', () => {
    expect(source).toContain("app.use('/feed/posts', parseMultipartForm({ maxFileSize: 5 * 1024 * 1024, maxTotalFileSize: 50 * 1024 * 1024, maxFiles: 10 }));");
  });

  it('parses the body before the CSRF check runs (the token travels in the multipart body)', () => {
    const parser = source.indexOf("app.use('/feed/posts', parseMultipartForm(");
    const csrf = source.indexOf("app.use('/feed', doubleCsrfProtection");
    expect(parser).toBeGreaterThan(-1);
    if (csrf > -1) expect(parser).toBeLessThan(csrf);
  });
});
