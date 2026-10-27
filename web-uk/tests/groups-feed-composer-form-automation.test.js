// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Group parity with React found by the deep audit of 27 Oct 2026
 * (frontend-drift/2026-10-27-deep-evidence/deep_result_a.md, G2, G3, G9, G12, and
 * the Automation tab's welcome message and scheduled posts):
 *
 * 1. Group feed posts were plain text: no like/react, comment link, report, delete,
 *    hide, mute, poll vote, post link or paging (React GroupFeedTab + FeedCard).
 * 2. The group composer took text and one image. React takes up to 10 images with
 *    alt text, can schedule a post, and can create a poll in the group.
 * 3. The create/edit form lacked template, group type, parent group, a separate
 *    avatar, and (edit) brand colours; its "Tags" field only appended text to the
 *    description because the API has no group tags.
 * 4. Group admins could not set the automatic welcome message.
 * 5. Group admins could not list, create or cancel scheduled posts.
 */
const express = require('express');
const session = require('express-session');
const request = require('supertest');
const nunjucks = require('nunjucks');
const path = require('node:path');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');
const { parseMultipartForm } = require('../src/middleware/multipart');

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
    getGroup: jest.fn(),
    getGroups: jest.fn(),
    getGroupMembers: jest.fn(),
    getEvents: jest.fn(),
    getFeedPosts: jest.fn(),
    getProfile: jest.fn(),
    callGroupApi: jest.fn(),
    createGroup: jest.fn(),
    updateGroup: jest.fn(),
    uploadGroupImage: jest.fn(),
    createFeedPostV2: jest.fn(),
    createFeedPostWithMedia: jest.fn(),
    createFeedPoll: jest.fn(),
    toggleFeedLike: jest.fn(),
    toggleReaction: jest.fn(),
    hideFeedItem: jest.fn(),
    muteFeedUser: jest.fn(),
    reportFeedItem: jest.fn(),
    deleteFeedPostV2: jest.fn(),
    voteFeedPoll: jest.fn(),
  }, {
    get: (target, prop) => (prop in target ? target[prop] : jest.fn().mockResolvedValue({ data: [] })),
  });
});

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() }),
}));

const api = require('../src/lib/api');
const groupsRoutes = require('../src/routes/groups');

let tenant = { id: 2, slug: 'test' };

function mount() {
  const app = express();
  const environment = nunjucks.configure(
    [path.join(__dirname, '..', 'src', 'views'),
      path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
    { autoescape: true, noCache: true, express: app }
  );
  require('../src/lib/template-filters').registerTemplateFilters(environment);
  environment.addFilter('nl2br', (value) => value);
  environment.addFilter('formatBladeDateTime', (value) => String(value || ''));
  app.set('view engine', 'njk');
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'groups-feed-composer-test-secret-32ch', resave: false, saveUninitialized: false }));
  app.use(/^\/groups\/\d+\/feed$/, parseMultipartForm({ maxFileSize: 5 * 1024 * 1024, maxTotalFileSize: 50 * 1024 * 1024 }));
  app.use('/groups/new', parseMultipartForm({ maxFileSize: 8 * 1024 * 1024 }));
  app.use(/^\/groups\/\d+\/edit$/, parseMultipartForm({ maxFileSize: 8 * 1024 * 1024 }));
  app.use('/groups', (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.csrfToken = () => 'csrf';
    req.flash = () => [];
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'test', prefix: '', tenant };
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
      formatLocaleDate: () => '27 October 2026',
    });
    next();
  }, groupsRoutes);
  return app;
}

const app = mount();
const t = createTranslator('en');

const MEMBER_GROUP = { data: { id: 974, name: 'Repair crew', visibility: 'public', owner_id: 1, my_membership: { status: 'active', role: 'member' } } };
const ADMIN_GROUP = { data: { id: 974, name: 'Repair crew', visibility: 'public', owner_id: 1, my_membership: { status: 'active', role: 'admin' } } };

const POST = {
  id: 501,
  type: 'post',
  content: '<p>Bring your broken toasters</p>',
  author: { id: 7, name: 'Ann Lee' },
  created_at: '2026-10-20T10:00:00Z',
  likes_count: 2,
  comments_count: 1,
  is_liked: false,
  reactions: { counts: { love: 3 }, user_reaction: 'love' },
};
const OWN_POST = { ...POST, id: 502, author: { id: 5, name: 'Me Myself' } };
const POLL = {
  id: 77,
  type: 'poll',
  title: 'Which Saturday?',
  author: { id: 7, name: 'Ann Lee' },
  poll_data: { is_active: true, user_vote_option_id: null, options: [{ id: 1, text: 'First' }, { id: 2, text: 'Second' }] },
};

beforeEach(() => {
  jest.clearAllMocks();
  tenant = { id: 2, slug: 'test' };
  api.getProfile.mockResolvedValue({ data: { id: 5 } });
  api.getGroup.mockResolvedValue(MEMBER_GROUP);
  api.getGroupMembers.mockResolvedValue({ data: [] });
  api.getEvents.mockResolvedValue({ data: [] });
  api.getFeedPosts.mockResolvedValue({ data: [], meta: {} });
  api.callGroupApi.mockResolvedValue({ data: [] });
  api.createGroup.mockResolvedValue({ data: { id: 88 } });
  api.updateGroup.mockResolvedValue({ data: { id: 974 } });
  api.uploadGroupImage.mockResolvedValue({ data: {} });
  api.createFeedPostV2.mockResolvedValue({ data: { id: 1 } });
  api.createFeedPostWithMedia.mockResolvedValue({ data: { id: 1 } });
  api.createFeedPoll.mockResolvedValue({ data: { id: 1 } });
  api.toggleFeedLike.mockResolvedValue({ data: { action: 'liked', likes_count: 3 } });
  api.toggleReaction.mockResolvedValue({ data: { action: 'added' } });
  api.hideFeedItem.mockResolvedValue({ data: {} });
  api.muteFeedUser.mockResolvedValue({ data: {} });
  api.reportFeedItem.mockResolvedValue({ data: {} });
  api.deleteFeedPostV2.mockResolvedValue({ data: {} });
  api.voteFeedPoll.mockResolvedValue({ data: {} });
});

// ---------------------------------------------------------------------------
describe('1. group feed actions', () => {
  it('renders like, reactions, a post link with comments and the moderation menu on each post', async () => {
    api.getFeedPosts.mockResolvedValue({ data: [POST], meta: {} });
    const res = await request(app).get('/groups/974');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Bring your broken toasters');
    expect(res.text).toContain('action="/groups/974/feed/items/post/501/like"');
    expect(res.text).toContain('action="/groups/974/feed/items/post/501/react"');
    expect(res.text).toContain('name="emoji" value="time_credit"');
    expect(res.text).toContain('href="/feed/posts/501"');
    expect(res.text).toContain('action="/groups/974/feed/items/post/501/hide"');
    expect(res.text).toContain('action="/groups/974/feed/users/7/mute"');
    expect(res.text).toContain('action="/groups/974/feed/items/post/501/report"');
    expect(res.text).not.toContain('/groups/974/feed/posts/501/delete');
  });

  it('offers delete (via a confirmation page) only on the member’s own post', async () => {
    api.getFeedPosts.mockResolvedValue({ data: [OWN_POST], meta: {} });
    const res = await request(app).get('/groups/974');
    expect(res.text).toContain('href="/groups/974/feed/posts/502/delete"');
    expect(res.text).not.toContain('action="/groups/974/feed/users/5/mute"');

    const confirm = await request(app).get('/groups/974/feed/posts/502/delete');
    expect(confirm.status).toBe(200);
    expect(confirm.text).toContain('action="/groups/974/feed/posts/502/delete"');
    expect(confirm.text).toContain(t('govuk_alpha_groups.feed.delete_title'));

    const done = await request(app).post('/groups/974/feed/posts/502/delete').type('form').send({ _csrf: 'csrf' });
    expect(api.deleteFeedPostV2).toHaveBeenCalledWith('token:test', 502);
    expect(done.status).toBe(302);
    expect(done.headers.location).toBe('/groups/974?status=post-deleted#group-feed');
  });

  it('shows a poll vote form and records the vote', async () => {
    api.getFeedPosts.mockResolvedValue({ data: [POLL], meta: {} });
    const res = await request(app).get('/groups/974');
    expect(res.text).toContain('action="/groups/974/feed/polls/77/vote"');
    expect(res.text).toContain('Which Saturday?');

    const voted = await request(app).post('/groups/974/feed/polls/77/vote').type('form').send({ option_id: '2' });
    expect(api.voteFeedPoll).toHaveBeenCalledWith('token:test', 77, { option_id: 2 });
    expect(voted.headers.location).toBe('/groups/974?status=poll-voted#group-feed');
  });

  it('likes, reacts, hides, mutes and reports, returning to the group feed', async () => {
    let res = await request(app).post('/groups/974/feed/items/post/501/like').type('form').send({});
    expect(api.toggleFeedLike).toHaveBeenCalledWith('token:test', { target_type: 'post', target_id: 501 });
    expect(res.headers.location).toBe('/groups/974?status=like-added#group-feed');

    res = await request(app).post('/groups/974/feed/items/post/501/react').type('form').send({ emoji: 'clap' });
    expect(api.toggleReaction).toHaveBeenCalledWith('token:test', { target_type: 'post', target_id: 501, reaction_type: 'clap' });
    expect(res.headers.location).toBe('/groups/974?status=reaction-added#group-feed');

    res = await request(app).post('/groups/974/feed/items/post/501/react').type('form').send({ emoji: 'nonsense' });
    expect(res.headers.location).toBe('/groups/974?status=reaction-failed#group-feed');

    res = await request(app).post('/groups/974/feed/items/post/501/hide').type('form').send({});
    expect(api.hideFeedItem).toHaveBeenCalledWith('token:test', 501, { type: 'post' });
    expect(res.headers.location).toBe('/groups/974?status=content-hidden#group-feed');

    res = await request(app).post('/groups/974/feed/users/7/mute').type('form').send({});
    expect(api.muteFeedUser).toHaveBeenCalledWith('token:test', 7);
    expect(res.headers.location).toBe('/groups/974?status=author-muted#group-feed');

    res = await request(app).post('/groups/974/feed/items/post/501/report').type('form').send({ reason: 'Spam' });
    expect(api.reportFeedItem).toHaveBeenCalledWith('token:test', 'post', 501, { reason: 'Spam' });
    expect(res.headers.location).toBe('/groups/974?status=content-reported#group-feed');
  });

  it('keeps the member on the same feed page after an action', async () => {
    const res = await request(app).post('/groups/974/feed/items/post/501/like').type('form').send({ feed_cursor: 'abc=' });
    expect(res.headers.location).toBe('/groups/974?status=like-added&feed_cursor=abc%3D#group-feed');
  });

  it('pages the group feed with the API cursor', async () => {
    api.getFeedPosts.mockResolvedValue({ data: [POST], meta: { cursor: 'next1', has_more: true } });
    const res = await request(app).get('/groups/974?feed_cursor=prev');
    expect(api.getFeedPosts).toHaveBeenCalledWith('token:test', { group_id: '974', per_page: 20, cursor: 'prev' });
    expect(res.text).toContain('href="/groups/974?feed_cursor=next1#group-feed"');
  });

  it('shows the status banner for a feed action', async () => {
    const res = await request(app).get('/groups/974?status=content-reported');
    expect(res.text).toContain(t('states.content-reported'));
  });

  it('hides the feed when the community has switched the group feed off (tab_feed)', async () => {
    tenant = { id: 2, slug: 'test', group_tabs: { tab_feed: false } };
    api.getFeedPosts.mockResolvedValue({ data: [POST], meta: {} });
    const res = await request(app).get('/groups/974');
    expect(api.getFeedPosts).not.toHaveBeenCalled();
    expect(res.text).not.toContain('id="group-feed"');
    expect(res.text).not.toContain('action="/groups/974/feed"');
  });
});

// ---------------------------------------------------------------------------
describe('2. group composer', () => {
  it('offers up to ten photos with alt text, scheduling and a poll form', async () => {
    const res = await request(app).get('/groups/974');
    expect(res.text).toContain('name="image"');
    expect(res.text).toContain('name="image_10"');
    expect(res.text).toContain('name="image_10_alt"');
    expect(res.text).toContain('name="schedule-day"');
    expect(res.text).toContain('name="schedule-time"');
    expect(res.text).toContain('action="/groups/974/feed/polls"');
    expect(res.text).toContain('name="option_6"');
  });

  it('does not offer a poll when the community has polls switched off', async () => {
    tenant = { id: 2, slug: 'test', features: { polls: false } };
    const res = await request(app).get('/groups/974');
    expect(res.text).not.toContain('action="/groups/974/feed/polls"');
  });

  it('posts several photos, each with its own alt text, in one post', async () => {
    const res = await request(app)
      .post('/groups/974/feed')
      .field('content', 'Workshop photos')
      .field('image_alt', 'The bench')
      .field('image_2_alt', 'The tools')
      .attach('image', Buffer.from('one'), { filename: 'one.png', contentType: 'image/png' })
      .attach('image_2', Buffer.from('two'), { filename: 'two.jpg', contentType: 'image/jpeg' });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/groups/974?status=group-posted#group-feed');
    expect(api.createFeedPostWithMedia).toHaveBeenCalledWith('token:test', expect.objectContaining({
      content: 'Workshop photos',
      visibility: 'public',
      group_id: 974,
      files: [
        expect.objectContaining({ filename: 'one.png', contentType: 'image/png', altText: 'The bench' }),
        expect.objectContaining({ filename: 'two.jpg', contentType: 'image/jpeg', altText: 'The tools' }),
      ],
    }));
  });

  it('refuses a file that is not an image', async () => {
    const res = await request(app)
      .post('/groups/974/feed')
      .field('content', 'Look')
      .attach('image_3', Buffer.from('x'), { filename: 'x.exe', contentType: 'application/octet-stream' });
    expect(res.headers.location).toBe('/groups/974?status=group-post-image-invalid#group-feed');
    expect(api.createFeedPostV2).not.toHaveBeenCalled();
    expect(api.createFeedPostWithMedia).not.toHaveBeenCalled();
  });

  it('schedules a post for later', async () => {
    const res = await request(app)
      .post('/groups/974/feed')
      .field('content', 'See you Saturday')
      .field('schedule-day', '14')
      .field('schedule-month', '11')
      .field('schedule-year', '2030')
      .field('schedule-time', '9:30am');
    expect(api.createFeedPostV2).toHaveBeenCalledWith('token:test', expect.objectContaining({
      content: 'See you Saturday',
      group_id: 974,
      publish_status: 'scheduled',
      scheduled_at: '2030-11-14T09:30',
    }));
    expect(res.headers.location).toBe('/groups/974?status=group-post-scheduled#group-feed');
  });

  it('refuses a half-entered publish date', async () => {
    const res = await request(app)
      .post('/groups/974/feed')
      .field('content', 'See you Saturday')
      .field('schedule-day', '14');
    expect(res.headers.location).toBe('/groups/974?status=group-post-schedule-invalid#group-feed');
    expect(api.createFeedPostV2).not.toHaveBeenCalled();
  });

  it('creates a poll inside the group', async () => {
    const res = await request(app).post('/groups/974/feed/polls').type('form').send({
      question: 'Which Saturday?', option_1: 'First', option_2: ' Second ', option_3: '',
    });
    expect(api.createFeedPoll).toHaveBeenCalledWith('token:test', {
      question: 'Which Saturday?', options: ['First', 'Second'], group_id: 974,
    });
    expect(res.headers.location).toBe('/groups/974?status=poll-created#group-feed');
  });

  it('asks for at least two poll options', async () => {
    const res = await request(app).post('/groups/974/feed/polls').type('form').send({ question: 'Q', option_1: 'Only' });
    expect(res.headers.location).toBe('/groups/974?status=poll-options-required#group-poll');
    expect(api.createFeedPoll).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('3. create and edit group form', () => {
  const CAPABILITIES = {
    data: {
      allowed_visibility: ['public', 'private', 'secret'],
      templates: [{ id: 3, name: 'Book club', default_visibility: 'public' }],
      group_types: [{ id: 9, name: 'Interest' }],
      parent_candidates: [{ id: 974, name: 'Repair crew' }, { id: 40, name: 'Makers' }],
      fields: { type: true, parent: true, branding: true },
      capabilities: { can_create: true },
    },
  };

  beforeEach(() => {
    api.callGroupApi.mockImplementation(async (token, method, p) => (p === '/form-capabilities' ? CAPABILITIES : { data: [] }));
  });

  it('offers template, type, parent group, secret visibility and a separate avatar; no tags field', async () => {
    const res = await request(app).get('/groups/new');
    expect(res.status).toBe(200);
    expect(res.text).toContain('name="template_id" type="radio" value="3"');
    expect(res.text).toContain('Book club');
    expect(res.text).toContain('<option value="9">Interest</option>');
    expect(res.text).toContain('<option value="40">Makers</option>');
    expect(res.text).toContain('value="secret"');
    expect(res.text).toContain('id="avatar" name="avatar" type="file"');
    expect(res.text).toContain('id="cover" name="cover" type="file"');
    expect(res.text).not.toContain('name="tags"');
    // React offers brand colours only when editing (GroupModals), not on create.
    expect(res.text).not.toContain('name="primary_color"');
  });

  it('creates with template, type and parent and uploads the avatar and cover; tags no longer leak into the description', async () => {
    const res = await request(app)
      .post('/groups/new')
      .field('name', 'Fixers')
      .field('description', 'We fix things together')
      .field('visibility', 'secret')
      .field('template_id', '3')
      .field('type_id', '9')
      .field('parent_id', '40')
      .field('tags', 'repair')
      .attach('avatar', Buffer.from('a'), { filename: 'a.png', contentType: 'image/png' })
      .attach('cover', Buffer.from('c'), { filename: 'c.png', contentType: 'image/png' });
    expect(res.headers.location).toBe('/groups/88?status=group-created');
    expect(api.createGroup).toHaveBeenCalledWith('token:test', {
      name: 'Fixers',
      description: 'We fix things together',
      location: null,
      visibility: 'secret',
      template_id: 3,
      type_id: 9,
      parent_id: 40,
    });
    expect(api.uploadGroupImage).toHaveBeenCalledWith('token:test', 88, expect.objectContaining({ type: 'avatar' }));
    expect(api.uploadGroupImage).toHaveBeenCalledWith('token:test', 88, expect.objectContaining({ type: 'cover' }));
  });

  it('edit form offers type, parent (not itself), brand colours and avatar', async () => {
    api.getGroup.mockResolvedValue({ data: { ...ADMIN_GROUP.data, type_id: 9, parent_id: 40, primary_color: '#1D70B8' } });
    const res = await request(app).get('/groups/974/edit');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<option value="9" selected>Interest</option>');
    expect(res.text).toContain('<option value="40" selected>Makers</option>');
    expect(res.text).not.toContain('<option value="974"');
    expect(res.text).toContain('name="primary_color"');
    expect(res.text).toContain('value="#1D70B8"');
    expect(res.text).toContain('name="accent_color"');
    expect(res.text).toContain('id="avatar" name="avatar" type="file"');
    expect(res.text).not.toContain('name="tags"');
  });

  it('saves type, parent and colours (blank colour = platform colours)', async () => {
    api.getGroup.mockResolvedValue(ADMIN_GROUP);
    const res = await request(app)
      .post('/groups/974/edit')
      .field('name', 'Repair crew')
      .field('description', 'Fixing things')
      .field('visibility', 'public')
      .field('has_type', '1')
      .field('type_id', '')
      .field('has_parent', '1')
      .field('parent_id', '40')
      .field('has_branding', '1')
      .field('primary_color', '#00703c')
      .field('accent_color', '');
    expect(res.headers.location).toBe('/groups/974?status=group-updated');
    expect(api.updateGroup).toHaveBeenCalledWith('token:test', 974, {
      name: 'Repair crew',
      description: 'Fixing things',
      location: null,
      visibility: 'public',
      type_id: null,
      parent_id: 40,
      primary_color: '#00703c',
      accent_color: null,
    });
  });
});

// ---------------------------------------------------------------------------
describe('4. automatic welcome message', () => {
  it('links group admins to it and shows the saved settings', async () => {
    api.getGroup.mockResolvedValue(ADMIN_GROUP);
    const detail = await request(app).get('/groups/974');
    expect(detail.text).toContain('href="/groups/974/welcome"');

    api.callGroupApi.mockResolvedValue({ data: { enabled: true, message: 'Hi {member_name}' } });
    const res = await request(app).get('/groups/974/welcome');
    expect(res.status).toBe(200);
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'GET', '/974/welcome');
    expect(res.text).toContain('Hi {member_name}');
    expect(res.text).toMatch(/name="enabled"[^>]*value="1"[^>]*checked/);
  });

  it('is not offered to ordinary members', async () => {
    const detail = await request(app).get('/groups/974');
    expect(detail.text).not.toContain('href="/groups/974/welcome"');
    const res = await request(app).get('/groups/974/welcome');
    expect(res.status).toBe(403);
  });

  it('saves the welcome message', async () => {
    api.getGroup.mockResolvedValue(ADMIN_GROUP);
    api.callGroupApi.mockResolvedValue({ data: { enabled: false, message: '' } });
    const res = await request(app).post('/groups/974/welcome').type('form').send({ enabled: '1', message: ' Welcome! ' });
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'PUT', '/974/welcome', { enabled: true, message: 'Welcome!' });
    expect(res.headers.location).toBe('/groups/974/welcome?status=welcome-saved');
  });
});

// ---------------------------------------------------------------------------
describe('5. scheduled posts', () => {
  const SCHEDULED = { data: [{ id: 31, post_type: 'announcement', title: 'AGM reminder', content: 'Bring tea', scheduled_at: '2030-01-05T09:00:00Z', is_recurring: 1, recurrence_pattern: 'weekly' }] };

  it('lists scheduled posts with a create form and cancel links for admins', async () => {
    api.getGroup.mockResolvedValue(ADMIN_GROUP);
    const detail = await request(app).get('/groups/974');
    expect(detail.text).toContain('href="/groups/974/scheduled-posts"');

    api.callGroupApi.mockResolvedValue(SCHEDULED);
    const res = await request(app).get('/groups/974/scheduled-posts');
    expect(res.status).toBe(200);
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'GET', '/974/scheduled-posts');
    expect(res.text).toContain('AGM reminder');
    expect(res.text).toContain('href="/groups/974/scheduled-posts/31/cancel"');
    expect(res.text).toContain('value="discussion"');
    expect(res.text).toContain('value="announcement"');
    expect(res.text).toContain('name="scheduled_at-day"');
  });

  it('only offers post types whose group section is switched on', async () => {
    tenant = { id: 2, slug: 'test', group_tabs: { tab_announcements: false } };
    api.getGroup.mockResolvedValue(ADMIN_GROUP);
    api.callGroupApi.mockResolvedValue({ data: [] });
    const res = await request(app).get('/groups/974/scheduled-posts');
    expect(res.text).toContain('value="discussion"');
    expect(res.text).not.toContain('value="announcement"');
  });

  it('is refused to ordinary members', async () => {
    const res = await request(app).get('/groups/974/scheduled-posts');
    expect(res.status).toBe(403);
  });

  it('schedules a recurring post', async () => {
    api.getGroup.mockResolvedValue(ADMIN_GROUP);
    api.callGroupApi.mockResolvedValue({ data: { id: 32 } });
    const res = await request(app).post('/groups/974/scheduled-posts').type('form').send({
      post_type: 'discussion',
      title: 'Weekly check-in',
      content: 'How is everyone?',
      'scheduled_at-day': '6', 'scheduled_at-month': '1', 'scheduled_at-year': '2031', 'scheduled_at-time': '18:00',
      is_recurring: '1',
      recurrence_pattern: 'weekly',
    });
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'POST', '/974/scheduled-posts', {
      post_type: 'discussion',
      title: 'Weekly check-in',
      content: 'How is everyone?',
      scheduled_at: '2031-01-06T18:00',
      is_recurring: true,
      recurrence_pattern: 'weekly',
    });
    expect(res.headers.location).toBe('/groups/974/scheduled-posts?status=scheduled-created');
  });

  it('shows field errors instead of calling the API when the form is incomplete', async () => {
    api.getGroup.mockResolvedValue(ADMIN_GROUP);
    api.callGroupApi.mockResolvedValue({ data: [] });
    const res = await request(app).post('/groups/974/scheduled-posts').type('form').send({ post_type: 'discussion', title: '', content: '' });
    expect(res.status).toBe(200);
    expect(res.text).toContain('govuk-error-summary');
    expect(res.text).toContain('href="#title"');
    expect(res.text).toContain('href="#content"');
    expect(api.callGroupApi).not.toHaveBeenCalledWith('token:test', 'POST', expect.anything(), expect.anything());
  });

  it('confirms before cancelling, then cancels', async () => {
    api.getGroup.mockResolvedValue(ADMIN_GROUP);
    api.callGroupApi.mockResolvedValue(SCHEDULED);
    const confirm = await request(app).get('/groups/974/scheduled-posts/31/cancel');
    expect(confirm.status).toBe(200);
    expect(confirm.text).toContain('AGM reminder');
    expect(confirm.text).toContain('action="/groups/974/scheduled-posts/31/cancel"');

    api.callGroupApi.mockResolvedValue({ data: {} });
    const res = await request(app).post('/groups/974/scheduled-posts/31/cancel').type('form').send({});
    expect(api.callGroupApi).toHaveBeenCalledWith('token:test', 'DELETE', '/974/scheduled-posts/31');
    expect(res.headers.location).toBe('/groups/974/scheduled-posts?status=scheduled-cancelled');
  });
});
