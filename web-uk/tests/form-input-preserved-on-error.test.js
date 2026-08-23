// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * A failed submission must never throw away what the member typed.
 *
 * Every case here follows the same shape: POST a form that will fail, follow the
 * redirect, and assert the typed values come back in the re-rendered form. Each posts
 * the field NAMES THE TEMPLATE EMITS, not the names the handler happens to read, so a
 * template rename cannot leave the test passing against a form nobody fills in.
 *
 * The mechanism is the established session stash — `storeTransferForm`/consume in
 * routes/wallet.js, `rememberListingForm`/`consumeListingFormState` in
 * routes/marketplace-actions.js + marketplace.js.
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
    ApiOfflineError: class ApiOfflineError extends Error {
      constructor(message = 'Unable to connect') {
        super(message);
        this.name = 'ApiOfflineError';
        this.status = 503;
      }
    },
    callGroupApi: jest.fn(),
    getGroup: jest.fn(),
    getProfile: jest.fn(),
    invalidateUserCache: jest.fn(),
    callReviewApi: jest.fn(),
    getComments: jest.fn(),
    getReactionSummary: jest.fn(),
    createComment: jest.fn(),
    toggleReaction: jest.fn(),
    deleteReview: jest.fn(),
    createReview: jest.fn(),
    getBlogPosts: jest.fn(),
    getBlogPost: jest.fn(),
    getReactors: jest.fn(),
    updateComment: jest.fn(),
    deleteComment: jest.fn(),
    getFeedPosts: jest.fn(),
    getFeedHashtags: jest.fn(),
    getFeedHashtagPosts: jest.fn(),
    getFeedPostV2: jest.fn(),
    getFeedItemV2: jest.fn(),
    getSocialLikers: jest.fn(),
    createFeedPostV2: jest.fn(),
    getTenantBootstrap: jest.fn(),
    getResources: jest.fn(),
    getResourceCategories: jest.fn(),
    getResourceCategoryTree: jest.fn(),
    uploadResource: jest.fn(),
    downloadResource: jest.fn(),
    deleteResource: jest.fn(),
    reorderResources: jest.fn(),
    getListings: jest.fn(),
    getListing: jest.fn(),
    createListing: jest.fn(),
    updateListing: jest.fn(),
    deleteListing: jest.fn(),
    uploadListingImage: jest.fn(),
    getSkills: jest.fn(),
    getCategories: jest.fn(),
    getGoal: jest.fn(),
    getGoals: jest.fn(),
    toggleFeedLike: jest.fn(),
    callGoalApi: jest.fn(),
    callListingApi: jest.fn(),
    callIdeationApi: jest.fn()
  };
});

const api = require('../src/lib/api');
const groupRoutes = require('../src/routes/groups');
const reviewRoutes = require('../src/routes/reviews');
const blogRoutes = require('../src/routes/blog-posts');
const feedRoutes = require('../src/routes/feed');
const feedActionRoutes = require('../src/routes/feed-actions');
const resourceRoutes = require('../src/routes/resources');
const listingRoutes = require('../src/routes/listings');
const goalRoutes = require('../src/routes/goals');
const ideationRoutes = require('../src/routes/ideation');
const ideationActionRoutes = require('../src/routes/ideation-actions');

const PREFIX = '/acme/accessible';

const VIEWS = path.join(__dirname, '..', 'src', 'views');
const GOVUK = path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist');

function createApp(prefix, mountPath, routers) {
  const app = express();
  const env = nunjucks.configure([VIEWS, GOVUK], { autoescape: true, express: app, watch: false });
  registerTemplateFilters(env);
  // Only the filters these templates cannot render without. Kept deliberately dumb so a
  // formatting change cannot make a preservation assertion pass or fail.
  env.addFilter('formatDate', (value) => String(value || ''));
  env.addFilter('nl2br', (value) => String(value || ''));
  env.addFilter('string', String);
  app.set('view engine', 'njk');
  app.set('views', VIEWS);
  app.use(express.urlencoded({ extended: true }));
  app.use(session({
    secret: 'form-input-preserved-test-secret',
    resave: false,
    saveUninitialized: false,
    name: 'form-input-preserved-test.sid'
  }));

  app.use(mountPath, (req, res, next) => {
    req.signedCookies = { token: 'test-token' };
    req.token = 'test-token';
    req.accessibleRouting = {
      mode: 'shared',
      tenantSlug: 'acme',
      tenant: { id: 2, slug: 'acme', name: 'Acme Timebank' },
      prefix
    };
    res.locals.urlFor = (value) => {
      const target = String(value || '/');
      return target.startsWith(prefix) ? target : `${prefix}${target.startsWith('/') ? target : `/${target}`}`;
    };
    Object.assign(res.locals, {
      serviceName: 'Project NEXUS',
      tenantName: 'Acme Timebank',
      isAuthenticated: true,
      csrfToken: 'test-csrf-token',
      alphaNavItems: [],
      feedbackUrl: `${prefix}/feedback`,
      currentPath: mountPath,
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
  }, ...routers);

  return app;
}

// 🔴 The `(?![-\w])` guard matters: `id="body"` also matches inside `id="body-hint"`, and a
// hint div has no value attribute — without the guard these helpers can report a working
// fix as broken (or read the wrong element entirely).
function valueOf(html, id) {
  const match = new RegExp(`id="${id}"(?![-\\w])[^>]*\\svalue="([^"]*)"`).exec(html);
  return match ? match[1] : null;
}

function textareaValue(html, id) {
  const match = new RegExp(`id="${id}"(?![-\\w])[^>]*>([\\s\\S]*?)</textarea>`).exec(html);
  return match ? match[1].trim() : null;
}

function isChecked(html, id) {
  return new RegExp(`id="${id}"(?![-\\w])[^>]*\\schecked`).test(html);
}

// --------------------------------------------------------------------------------------
// Group announcements
// --------------------------------------------------------------------------------------

describe('group announcements keep what the member typed after a failure', () => {
  const MOUNT = `${PREFIX}/groups`;
  const LONG_CONTENT = 'The hall is booked for Saturday. Please bring your own mug, and let Mary know if you need a lift.';

  function buildApp() {
    return createApp(PREFIX, MOUNT, [groupRoutes]);
  }

  beforeEach(() => {
    api.getProfile.mockReset();
    api.getGroup.mockReset();
    api.callGroupApi.mockReset();

    api.getProfile.mockResolvedValue({ data: { id: 7, name: 'Test Admin' } });
    api.getGroup.mockResolvedValue({
      data: {
        id: 42,
        name: 'Bantry Repair Cafe',
        owner_id: 7,
        membership: { role: 'admin', status: 'active' }
      }
    });
    api.callGroupApi.mockImplementation(async (token, method, apiPath) => {
      if (method === 'GET' && /\/announcements$/.test(apiPath)) {
        return {
          data: {
            items: [{
              id: 9,
              title: 'Saved title',
              content: 'Saved content',
              is_pinned: false,
              expires_at: '2027-03-04'
            }]
          }
        };
      }
      throw new api.ApiError('Announcement service unavailable', 500, {});
    });
  });

  it('refills the CREATE form after a validation failure instead of blanking it', async () => {
    const agent = request.agent(buildApp());

    const post = await agent
      .post(`${MOUNT}/42/announcements`)
      .type('form')
      .send({
        _csrf: 'test-csrf-token',
        title: '',
        content: LONG_CONTENT,
        is_pinned: '1',
        'expires_at-day': '31',
        'expires_at-month': '2',
        'expires_at-year': '2027'
      });

    expect(post.status).toBe(302);
    expect(post.headers.location).toContain('status=ann-title-required');

    const page = await agent.get(`${MOUNT}/42/announcements?status=ann-title-required`);
    expect(page.status).toBe(200);
    expect(textareaValue(page.text, 'ann-content')).toBe(LONG_CONTENT);
    expect(isChecked(page.text, 'ann-is-pinned')).toBe(true);
    expect(valueOf(page.text, 'expires_at-day')).toBe('31');
    expect(valueOf(page.text, 'expires_at-month')).toBe('2');
    expect(valueOf(page.text, 'expires_at-year')).toBe('2027');
  });

  it('refills the CREATE form after an API failure', async () => {
    const agent = request.agent(buildApp());

    const post = await agent
      .post(`${MOUNT}/42/announcements`)
      .type('form')
      .send({ _csrf: 'test-csrf-token', title: 'Hall booked', content: LONG_CONTENT });

    expect(post.status).toBe(302);
    expect(post.headers.location).toContain('status=ann-create-failed');

    const page = await agent.get(`${MOUNT}/42/announcements?status=ann-create-failed`);
    expect(valueOf(page.text, 'ann-title')).toBe('Hall booked');
    expect(textareaValue(page.text, 'ann-content')).toBe(LONG_CONTENT);
  });

  it('consumes the stash once, so a later clean visit shows an empty CREATE form', async () => {
    const agent = request.agent(buildApp());

    await agent
      .post(`${MOUNT}/42/announcements`)
      .type('form')
      .send({ _csrf: 'test-csrf-token', title: 'Hall booked', content: LONG_CONTENT });

    await agent.get(`${MOUNT}/42/announcements?status=ann-create-failed`);
    const second = await agent.get(`${MOUNT}/42/announcements`);

    expect(valueOf(second.text, 'ann-title')).toBe('');
    expect(textareaValue(second.text, 'ann-content')).toBe('');
  });

  it('shows the EDIT form the members own unsaved edits, not the saved announcement', async () => {
    const agent = request.agent(buildApp());

    const post = await agent
      .post(`${MOUNT}/42/announcements/9/edit`)
      .type('form')
      .send({
        _csrf: 'test-csrf-token',
        title: 'Rewritten title',
        content: LONG_CONTENT,
        is_pinned: '1'
      });

    expect(post.status).toBe(302);
    expect(post.headers.location).toContain('status=ann-update-failed');

    const page = await agent.get(`${MOUNT}/42/announcements/9/edit?status=ann-update-failed`);
    expect(page.status).toBe(200);
    expect(valueOf(page.text, 'edit-ann-title')).toBe('Rewritten title');
    expect(textareaValue(page.text, 'edit-ann-content')).toBe(LONG_CONTENT);
    expect(isChecked(page.text, 'edit-ann-is-pinned')).toBe(true);
    expect(page.text).not.toContain('Saved content');
  });

  it('still shows the saved announcement on a clean EDIT visit', async () => {
    const agent = request.agent(buildApp());
    const page = await agent.get(`${MOUNT}/42/announcements/9/edit`);

    expect(valueOf(page.text, 'edit-ann-title')).toBe('Saved title');
    expect(textareaValue(page.text, 'edit-ann-content')).toBe('Saved content');
    expect(valueOf(page.text, 'expires_at-year')).toBe('2027');
  });
});

// --------------------------------------------------------------------------------------
// Review comments
// --------------------------------------------------------------------------------------

describe('review comments keep what the member typed after a failure', () => {
  const MOUNT = `${PREFIX}/reviews`;
  const LONG_COMMENT = 'Thanks again for the lift to the hospital, it made a real difference that morning.';

  function buildApp() {
    return createApp(PREFIX, MOUNT, [reviewRoutes]);
  }

  beforeEach(() => {
    api.callReviewApi.mockReset();
    api.getComments.mockReset();
    api.getReactionSummary.mockReset();
    api.createComment.mockReset();
    api.getProfile.mockReset();

    api.getProfile.mockResolvedValue({ data: { id: 7, name: 'Test Member' } });
    api.callReviewApi.mockResolvedValue({
      data: { id: 5, rating: 5, comment: 'Great neighbour', created_at: '2026-08-01T09:00:00Z' }
    });
    api.getComments.mockResolvedValue({ data: [] });
    api.getReactionSummary.mockResolvedValue({ data: { counts: {}, total: 0, user_reaction: null } });
    api.createComment.mockRejectedValue(new api.ApiError('Comment service unavailable', 500, {}));
  });

  it('refills the comment box after the comment could not be posted', async () => {
    const agent = request.agent(buildApp());

    const post = await agent
      .post(`${MOUNT}/5/comments`)
      .type('form')
      .send({ _csrf: 'test-csrf-token', body: LONG_COMMENT });

    expect(post.status).toBe(302);
    expect(post.headers.location).toContain('status=comment-failed');

    const page = await agent.get(`${MOUNT}/5/comments?status=comment-failed`);
    expect(page.status).toBe(200);
    expect(textareaValue(page.text, 'body')).toBe(LONG_COMMENT);
  });

  it('refills the REPLY box the reply came from, not the top-level composer', async () => {
    api.getComments.mockResolvedValue({
      data: [{
        id: 31,
        content: 'Original comment',
        user: { id: 8, name: 'Mary' },
        created_at: '2026-08-02T09:00:00Z',
        replies: []
      }]
    });

    const agent = request.agent(buildApp());

    await agent
      .post(`${MOUNT}/5/comments`)
      .type('form')
      .send({ _csrf: 'test-csrf-token', body: LONG_COMMENT, parent_id: '31' });

    const page = await agent.get(`${MOUNT}/5/comments?status=comment-failed`);
    expect(textareaValue(page.text, 'reply-31')).toBe(LONG_COMMENT);
    expect(textareaValue(page.text, 'body')).toBe('');
  });

  it('consumes the stash once, so a later clean visit shows an empty comment box', async () => {
    const agent = request.agent(buildApp());

    await agent
      .post(`${MOUNT}/5/comments`)
      .type('form')
      .send({ _csrf: 'test-csrf-token', body: LONG_COMMENT });

    await agent.get(`${MOUNT}/5/comments?status=comment-failed`);
    const second = await agent.get(`${MOUNT}/5/comments`);

    expect(textareaValue(second.text, 'body')).toBe('');
  });
});

// --------------------------------------------------------------------------------------
// Blog comments — one handler, two templates (/blog/:slug and /blog/:slug/comments)
// --------------------------------------------------------------------------------------

describe('blog comments keep what the member typed after a failure', () => {
  const MOUNT = `${PREFIX}/blog`;
  const TEXT = 'I have a spare ladder if anyone needs one for the gutter clearing day.';

  function buildApp() {
    return createApp(PREFIX, MOUNT, [blogRoutes]);
  }

  beforeEach(() => {
    api.getBlogPost.mockReset();
    api.getBlogPosts.mockReset();
    api.getComments.mockReset();
    api.getReactionSummary.mockReset();
    api.createComment.mockReset();

    api.getBlogPost.mockResolvedValue({
      data: { id: 5, slug: 'gutter-day', title: 'Gutter day', content: 'Join us', created_at: '2026-08-01T09:00:00Z' }
    });
    api.getBlogPosts.mockResolvedValue({ data: [] });
    api.getComments.mockResolvedValue({ data: [] });
    api.getReactionSummary.mockResolvedValue({ data: { counts: {}, total: 0, user_reaction: null } });
    api.createComment.mockRejectedValue(new api.ApiError('comments unavailable', 500, {}));
  });

  it('refills the comments-page box after a failure', async () => {
    const agent = request.agent(buildApp());

    const post = await agent
      .post(`${MOUNT}/gutter-day/comments/add`)
      .type('form')
      .send({ _csrf: 'test-csrf-token', body: TEXT });
    expect(post.status).toBe(302);
    expect(post.headers.location).toContain('status=comment-failed');

    const page = await agent.get(`${MOUNT}/gutter-day/comments?status=comment-failed`);
    expect(page.status).toBe(200);
    expect(textareaValue(page.text, 'body')).toBe(TEXT);
  });

  it('refills the REPLY box the reply came from, not the top-level composer', async () => {
    api.getComments.mockResolvedValue({
      data: [{ id: 44, content: 'Original', user: { id: 8, name: 'Mary' }, created_at: '2026-08-02T09:00:00Z', replies: [] }]
    });
    const agent = request.agent(buildApp());

    await agent
      .post(`${MOUNT}/gutter-day/comments/add`)
      .type('form')
      .send({ _csrf: 'test-csrf-token', body: TEXT, parent_id: '44' });

    const page = await agent.get(`${MOUNT}/gutter-day/comments?status=comment-failed`);
    expect(textareaValue(page.text, 'reply-44')).toBe(TEXT);
    expect(textareaValue(page.text, 'body')).toBe('');
  });

  it('refills the post-detail box after a failure', async () => {
    const agent = request.agent(buildApp());

    const post = await agent
      .post(`${MOUNT}/gutter-day/comments`)
      .type('form')
      .send({ _csrf: 'test-csrf-token', body: TEXT });
    expect(post.status).toBe(302);

    const page = await agent.get(`${MOUNT}/gutter-day?status=comment-failed`);
    expect(page.status).toBe(200);
    expect(textareaValue(page.text, 'body')).toBe(TEXT);
  });

  it('consumes the stash once', async () => {
    const agent = request.agent(buildApp());
    await agent.post(`${MOUNT}/gutter-day/comments/add`).type('form').send({ _csrf: 'test-csrf-token', body: TEXT });
    await agent.get(`${MOUNT}/gutter-day/comments?status=comment-failed`);
    const second = await agent.get(`${MOUNT}/gutter-day/comments`);
    expect(textareaValue(second.text, 'body')).toBe('');
  });
});

// --------------------------------------------------------------------------------------
// Feed composer
// --------------------------------------------------------------------------------------

describe('feed composer keeps what the member typed after a failure', () => {
  const MOUNT = `${PREFIX}/feed`;
  const TEXT = 'Anyone free on Thursday morning to help move a piano? Two people should do it.';

  function buildApp() {
    // Mounted in the same order as server.js: actions first, then the GET routes.
    return createApp(PREFIX, MOUNT, [feedActionRoutes, feedRoutes]);
  }

  beforeEach(() => {
    api.getFeedPosts.mockReset();
    api.createFeedPostV2.mockReset();
    api.getTenantBootstrap.mockReset();
    api.getProfile.mockReset();

    api.getProfile.mockResolvedValue({ data: { id: 7, name: 'Test Member' } });
    api.getTenantBootstrap.mockResolvedValue({
      data: { id: 2, slug: 'acme', modules: { feed: true, listings: true }, features: {} }
    });
    api.getFeedPosts.mockResolvedValue({ data: [], meta: { per_page: 20, has_more: false } });
    api.createFeedPostV2.mockRejectedValue(new api.ApiError('feed unavailable', 500, {}));
  });

  it('refills the composer and the image alt text after a failed post', async () => {
    const agent = request.agent(buildApp());

    const post = await agent
      .post(`${MOUNT}/posts`)
      .type('form')
      .send({ _csrf: 'test-csrf-token', content: TEXT, image_alt: 'Upright piano in a hallway' });
    expect(post.status).toBe(302);
    expect(post.headers.location).toContain('status=post-failed');

    const page = await agent.get(`${MOUNT}?status=post-failed`);
    expect(page.status).toBe(200);
    expect(textareaValue(page.text, 'content')).toBe(TEXT);
    expect(valueOf(page.text, 'image_alt')).toBe('Upright piano in a hallway');
  });

  it('consumes the stash once, so a later clean visit shows an empty composer', async () => {
    const agent = request.agent(buildApp());
    await agent.post(`${MOUNT}/posts`).type('form').send({ _csrf: 'test-csrf-token', content: TEXT });
    await agent.get(`${MOUNT}?status=post-failed`);
    const second = await agent.get(MOUNT);
    expect(textareaValue(second.text, 'content')).toBe('');
    expect(valueOf(second.text, 'image_alt')).toBe('');
  });
});

// --------------------------------------------------------------------------------------
// Resource comments
// --------------------------------------------------------------------------------------

describe('resource comments keep what the member typed after a failure', () => {
  const MOUNT = `${PREFIX}/resources`;
  const TEXT = 'The second page of this guide is out of date — the tip closes at 4pm now, not 6.';

  function buildApp() {
    return createApp(PREFIX, MOUNT, [resourceRoutes]);
  }

  beforeEach(() => {
    api.getResources.mockReset();
    api.getComments.mockReset();
    api.getReactionSummary.mockReset();
    api.createComment.mockReset();
    api.getProfile.mockReset();

    api.getProfile.mockResolvedValue({ data: { id: 7, name: 'Test Member' } });
    api.getResources.mockResolvedValue({
      data: [{ id: 11, title: 'Repair cafe guide', file_path: 'guide.pdf', created_at: '2026-08-01T09:00:00Z' }],
      meta: { has_more: false }
    });
    api.getComments.mockResolvedValue({ data: [] });
    api.getReactionSummary.mockResolvedValue({ data: { counts: {}, total: 0, user_reaction: null } });
    api.createComment.mockRejectedValue(new api.ApiError('comments unavailable', 500, {}));
  });

  it('refills the comment box after a failure', async () => {
    const agent = request.agent(buildApp());

    const post = await agent
      .post(`${MOUNT}/11/comments/add`)
      .type('form')
      .send({ _csrf: 'test-csrf-token', body: TEXT });
    expect(post.status).toBe(302);
    expect(post.headers.location).toContain('status=comment-failed');

    const page = await agent.get(`${MOUNT}/11/comments?status=comment-failed`);
    expect(page.status).toBe(200);
    expect(textareaValue(page.text, 'body')).toBe(TEXT);
  });

  it('consumes the stash once', async () => {
    const agent = request.agent(buildApp());
    await agent.post(`${MOUNT}/11/comments/add`).type('form').send({ _csrf: 'test-csrf-token', body: TEXT });
    await agent.get(`${MOUNT}/11/comments?status=comment-failed`);
    const second = await agent.get(`${MOUNT}/11/comments`);
    expect(textareaValue(second.text, 'body')).toBe('');
  });
});

// --------------------------------------------------------------------------------------
// Listing comments
// --------------------------------------------------------------------------------------

describe('listing comments keep what the member typed after a failure', () => {
  const MOUNT = `${PREFIX}/listings`;
  const TEXT = 'Is this still available? I could collect on Saturday afternoon if that suits.';

  function buildApp() {
    return createApp(PREFIX, MOUNT, [listingRoutes]);
  }

  beforeEach(() => {
    api.callListingApi.mockReset();
    api.getComments.mockReset();
    api.createComment.mockReset();
    api.getProfile.mockReset();

    api.getProfile.mockResolvedValue({ data: { id: 7, name: 'Test Member' } });
    api.callListingApi.mockResolvedValue({ data: { id: 21, title: 'Garden shears', description: 'Sharp' } });
    api.getComments.mockResolvedValue({ data: [] });
    api.createComment.mockRejectedValue(new api.ApiError('comments unavailable', 500, {}));
  });

  it('refills the comment box after a failure', async () => {
    const agent = request.agent(buildApp());

    const post = await agent
      .post(`${MOUNT}/21/comments`)
      .type('form')
      .send({ _csrf: 'test-csrf-token', body: TEXT });
    expect(post.status).toBe(302);
    expect(post.headers.location).toContain('status=comment-failed');

    const page = await agent.get(`${MOUNT}/21/comments?status=comment-failed`);
    expect(page.status).toBe(200);
    expect(textareaValue(page.text, 'body')).toBe(TEXT);
  });

  it('consumes the stash once', async () => {
    const agent = request.agent(buildApp());
    await agent.post(`${MOUNT}/21/comments`).type('form').send({ _csrf: 'test-csrf-token', body: TEXT });
    await agent.get(`${MOUNT}/21/comments?status=comment-failed`);
    const second = await agent.get(`${MOUNT}/21/comments`);
    expect(textareaValue(second.text, 'body')).toBe('');
  });
});

// --------------------------------------------------------------------------------------
// Goal comments
// --------------------------------------------------------------------------------------

describe('goal comments keep what the member typed after a failure', () => {
  const MOUNT = `${PREFIX}/goals`;
  const TEXT = 'Well done on week three — the walking group is definitely helping my knees too.';

  function buildApp() {
    return createApp(PREFIX, MOUNT, [goalRoutes]);
  }

  beforeEach(() => {
    api.getGoal.mockReset();
    api.getFeedItemV2.mockReset();
    api.getComments.mockReset();
    api.createComment.mockReset();
    api.getProfile.mockReset();

    api.getProfile.mockResolvedValue({ data: { id: 7, name: 'Test Member' } });
    api.getFeedItemV2.mockResolvedValue({ data: { like_count: 0, liked: false } });
    api.getGoal.mockResolvedValue({
      data: { id: 31, title: 'Walk every day', description: 'Thirty days', created_at: '2026-08-01T09:00:00Z' }
    });
    api.getComments.mockResolvedValue({ data: [] });
    api.createComment.mockRejectedValue(new api.ApiError('comments unavailable', 500, {}));
  });

  it('refills the comment box after a failure', async () => {
    const agent = request.agent(buildApp());

    const post = await agent
      .post(`${MOUNT}/31/comments`)
      .type('form')
      .send({ _csrf: 'test-csrf-token', body: TEXT });
    expect(post.status).toBe(302);
    expect(post.headers.location).toContain('status=comment-failed');

    const page = await agent.get(`${MOUNT}/31/social?status=comment-failed`);
    expect(page.status).toBe(200);
    expect(textareaValue(page.text, 'body')).toBe(TEXT);
  });

  it('refills the REPLY box the reply came from, not the top-level composer', async () => {
    api.getComments.mockResolvedValue({
      data: [{ id: 77, content: 'Keep going', user: { id: 8, name: 'Mary' }, created_at: '2026-08-02T09:00:00Z', replies: [] }]
    });
    const agent = request.agent(buildApp());

    await agent
      .post(`${MOUNT}/31/comments`)
      .type('form')
      .send({ _csrf: 'test-csrf-token', body: TEXT, parent_id: '77' });

    const page = await agent.get(`${MOUNT}/31/social?status=comment-failed`);
    expect(textareaValue(page.text, 'reply-77')).toBe(TEXT);
    expect(textareaValue(page.text, 'body')).toBe('');
  });

  it('consumes the stash once', async () => {
    const agent = request.agent(buildApp());
    await agent.post(`${MOUNT}/31/comments`).type('form').send({ _csrf: 'test-csrf-token', body: TEXT });
    await agent.get(`${MOUNT}/31/social?status=comment-failed`);
    const second = await agent.get(`${MOUNT}/31/social`);
    expect(textareaValue(second.text, 'body')).toBe('');
  });
});

// --------------------------------------------------------------------------------------
// Ideation idea comments
// --------------------------------------------------------------------------------------

describe('ideation idea comments keep what the member typed after a failure', () => {
  const MOUNT = `${PREFIX}/ideation`;
  const TEXT = 'This would work better if the library opened late on Thursdays rather than Mondays.';

  function buildApp() {
    // Same order as server.js: the GET routes then the action routes.
    return createApp(PREFIX, MOUNT, [ideationRoutes, ideationActionRoutes]);
  }

  beforeEach(() => {
    api.callIdeationApi.mockReset();
    api.getProfile.mockReset();

    api.getProfile.mockResolvedValue({ data: { id: 7, name: 'Test Member' } });
    api.callIdeationApi.mockImplementation(async (token, method, apiPath) => {
      if (method === 'POST') throw new api.ApiError('ideation unavailable', 500, {});
      if (/^\/ideation-ideas\/\d+\/comments/.test(apiPath)) return { data: [] };
      if (/^\/ideation-ideas\/\d+\/media/.test(apiPath)) return { data: [] };
      if (/^\/ideation-ideas\/\d+/.test(apiPath)) {
        return { data: { id: 4, challenge_id: 3, title: 'Open the library late', description: 'Warm' } };
      }
      if (/^\/challenges\/\d+/.test(apiPath)) {
        return { data: { id: 3, title: 'Warm rooms', description: 'Ideas', status: 'open' } };
      }
      return { data: [] };
    });
  });

  it('refills the comment box after a failure', async () => {
    const agent = request.agent(buildApp());

    const post = await agent
      .post(`${MOUNT}/3/ideas/4/comments`)
      .type('form')
      .send({ _csrf: 'test-csrf-token', comment_body: TEXT });
    expect(post.status).toBe(302);
    expect(post.headers.location).toContain('status=comment-failed');

    const page = await agent.get(`${MOUNT}/3/ideas/4?status=comment-failed`);
    expect(page.status).toBe(200);
    expect(textareaValue(page.text, 'comment_body')).toBe(TEXT);
  });

  it('consumes the stash once', async () => {
    const agent = request.agent(buildApp());
    await agent.post(`${MOUNT}/3/ideas/4/comments`).type('form').send({ _csrf: 'test-csrf-token', comment_body: TEXT });
    await agent.get(`${MOUNT}/3/ideas/4?status=comment-failed`);
    const second = await agent.get(`${MOUNT}/3/ideas/4`);
    expect(textareaValue(second.text, 'comment_body')).toBe('');
  });

  it('does not leak one idea stash onto a different idea', async () => {
    const agent = request.agent(buildApp());
    await agent.post(`${MOUNT}/3/ideas/4/comments`).type('form').send({ _csrf: 'test-csrf-token', comment_body: TEXT });

    api.callIdeationApi.mockImplementation(async (token, method, apiPath) => {
      if (/^\/ideation-ideas\/\d+\/comments/.test(apiPath)) return { data: [] };
      if (/^\/ideation-ideas\/\d+\/media/.test(apiPath)) return { data: [] };
      if (/^\/ideation-ideas\/\d+/.test(apiPath)) {
        return { data: { id: 9, challenge_id: 3, title: 'Another idea', description: 'Other' } };
      }
      if (/^\/challenges\/\d+/.test(apiPath)) {
        return { data: { id: 3, title: 'Warm rooms', description: 'Ideas', status: 'open' } };
      }
      return { data: [] };
    });

    const other = await agent.get(`${MOUNT}/3/ideas/9?status=comment-failed`);
    expect(other.status).toBe(200);
    expect(textareaValue(other.text, 'comment_body')).toBe('');
  });
});
