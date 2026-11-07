// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * AWID accessibility report, Oct 2026, point 6 (second pass, 7 Nov): members
 * can describe the photo on a listing, a feed post, an event cover and a group
 * picture, and a screen reader must hear those words wherever the photo is
 * shown — not "Image for <title>", not nothing, and never a file name.
 *
 * Each list below used to ignore the stored description. Where a member wrote
 * nothing, the page keeps what it said before (a photo beside the visible title
 * that names it may stay silent).
 */
const express = require('express');
const session = require('express-session');
const request = require('supertest');
const nunjucks = require('nunjucks');
const path = require('node:path');
const { createChoiceTranslator, createTranslator } = require('../src/lib/localization');

jest.mock('../src/lib/api', () => require('./support/api-mock').apiMockFactory([
  'getProfile', 'getTenantBootstrap', 'invalidateUserCache',
  // feed + dashboard
  'getFeedPosts', 'getFeedPostV2', 'getFeedItemV2', 'getFeedHashtagPosts', 'getComments',
  'getBalance', 'getOnboardingStatus', 'getGamificationProfile', 'getMyBadges', 'getListings',
  'getMyListings', 'getMyEvents', 'getExchangeAttentionCount', 'getMemberEndorsements',
  'getFeedSidebar', 'getTopEndorsedMembers', 'getConnectionSuggestions',
  // search
  'searchV2', 'getSavedSearches', 'getListingCategories', 'getPopularListingTags',
  // events + groups
  'getEvents', 'getEventCategories', 'getGroup', 'getGroups', 'getGroupMembers', 'callGroupApi', 'callMatchesApi'
]));

jest.mock('../src/lib/auditLogger', () => ({
  audit: new Proxy({}, { get: () => () => (req, res, next) => next() })
}));

const api = require('../src/lib/api');
const feedRoutes = require('../src/routes/feed');
const dashboardRoutes = require('../src/routes/dashboard');
const searchRoutes = require('../src/routes/search');
const eventsRoutes = require('../src/routes/events');
const groupsRoutes = require('../src/routes/groups');

const t = createTranslator('en');

function mount(mountPath, router) {
  const app = express();
  const environment = nunjucks.configure(
    [path.join(__dirname, '..', 'src', 'views'),
      path.join(__dirname, '..', 'node_modules', 'govuk-frontend', 'dist')],
    { autoescape: true, noCache: true, express: app }
  );
  require('../src/lib/template-filters').registerTemplateFilters(environment);
  environment.addFilter('nl2br', (value) => value);
  environment.addFilter('formatDate', (value) => String(value || ''));
  environment.addFilter('formatBladeDateTime', (value) => String(value || ''));
  app.set('view engine', 'njk');
  app.use(express.urlencoded({ extended: true }));
  app.use(session({ secret: 'image-descriptions-nov07-test-secret', resave: false, saveUninitialized: false }));
  app.use(mountPath, (req, res, next) => {
    req.signedCookies = { token: 'token:test' };
    req.token = 'token:test';
    req.csrfToken = () => 'csrf';
    req.flash = () => [];
    req.accessibleRouting = { mode: 'shared', tenantSlug: 'test', prefix: '', tenant: { id: 2, slug: 'test', name: 'Test' } };
    Object.assign(res.locals, {
      urlFor: (value) => String(value || '/'),
      serviceName: 'Project NEXUS',
      tenantName: 'Test',
      isAuthenticated: true,
      csrfToken: 'csrf',
      alphaNavItems: [],
      alphaFooterColumns: [],
      feedbackUrl: '#',
      t,
      tc: createChoiceTranslator('en'),
      htmlLang: 'en',
      htmlDirection: 'ltr',
      locale: 'en',
      formatLocaleDate: () => '20 November 2026',
      formatLocaleNumber: (value) => String(value)
    });
    next();
  }, router);
  return app;
}

const LADDER_WORDS = 'A tall aluminium ladder leaning against a brick wall';
const CAFE_WORDS = 'Volunteers fixing a toaster at a long table';
const BIKE_WORDS = 'Two bicycles upside down on a workbench';

function listingFeedItem(overrides = {}) {
  return {
    id: 31,
    type: 'listing',
    title: 'Ladder to lend',
    content: 'Happy to lend it for the weekend.',
    image_url: '/uploads/listings/IMG_20261104_ladder.jpg',
    image_alt: LADDER_WORDS,
    author: { id: 3, name: 'Bo Ray' },
    created_at: '2026-11-04T10:00:00Z',
    ...overrides
  };
}

function contractEvent(overrides = {}) {
  return {
    id: 8,
    title: 'Repair cafe',
    cover_image: '/uploads/events/DSC_0042.jpg',
    image_url: '/uploads/events/DSC_0042.jpg',
    primary_image: { url: '/uploads/events/DSC_0042.jpg', alt_text: 'Repair cafe', description: CAFE_WORDS },
    start_time: '2026-11-20T10:00:00Z',
    location: 'Town hall',
    ...overrides
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  api.getProfile.mockResolvedValue({ data: { id: 5, first_name: 'Ann' } });
  api.getTenantBootstrap.mockResolvedValue({ data: {} });
  api.getComments.mockResolvedValue({ data: { comments: [] } });
  api.getFeedPosts.mockResolvedValue({ data: [] });
  api.getBalance.mockResolvedValue({ balance: 0 });
  api.getOnboardingStatus.mockResolvedValue({ data: { onboarding_completed: true } });
  api.getGamificationProfile.mockResolvedValue({ data: null });
  api.getMyBadges.mockResolvedValue({ data: [] });
  api.getListings.mockResolvedValue({ data: [] });
  api.getMyListings.mockResolvedValue({ data: [] });
  api.getMyEvents.mockResolvedValue({ data: [] });
  api.getExchangeAttentionCount.mockResolvedValue({ data: { count: 0, items: [] } });
  api.getMemberEndorsements.mockResolvedValue({ data: { endorsements: [] } });
  api.getFeedSidebar.mockResolvedValue({ data: {} });
  api.getTopEndorsedMembers.mockResolvedValue({ data: [] });
  api.getConnectionSuggestions.mockResolvedValue({ data: [] });
  api.searchV2.mockResolvedValue({ data: [], meta: { search: { total: 0 } } });
  api.getSavedSearches.mockResolvedValue({ data: [] });
  api.getListingCategories.mockResolvedValue({ data: [] });
  api.getPopularListingTags.mockResolvedValue({ data: [] });
  api.getEvents.mockResolvedValue({ data: [], meta: {} });
  api.getEventCategories.mockResolvedValue({ data: [] });
  api.getGroup.mockResolvedValue({ data: { id: 974, name: 'Repair crew', visibility: 'public', my_membership: { status: 'active', role: 'member' } } });
  api.getGroups.mockResolvedValue({ data: [], meta: {} });
  api.getGroupMembers.mockResolvedValue({ data: [] });
  api.callGroupApi.mockResolvedValue({ data: [] });
  api.callMatchesApi.mockResolvedValue({ data: { matches: [] } });
});

describe('the feed', () => {
  const app = mount('/feed', feedRoutes);

  it('describes a listing photo with the words its owner wrote', async () => {
    api.getFeedPosts.mockResolvedValue({ data: [listingFeedItem()] });

    const res = await request(app).get('/feed');

    expect(res.status).toBe(200);
    expect(res.text).toContain(`alt="${LADDER_WORDS}"`);
    expect(res.text).not.toContain('alt="IMG_20261104_ladder');
  });

  it('keeps its generic description when nothing was written', async () => {
    api.getFeedPosts.mockResolvedValue({ data: [listingFeedItem({ image_alt: null })] });

    const res = await request(app).get('/feed');

    expect(res.text).toContain(`alt="${t('feed.image_alt', { title: 'Ladder to lend' })}"`);
  });
});

describe('the dashboard\'s recent feed', () => {
  const app = mount('/dashboard', dashboardRoutes);

  it('describes the photo with the words its owner wrote', async () => {
    api.getFeedPosts.mockResolvedValue({ data: [listingFeedItem()] });

    const res = await request(app).get('/dashboard');

    expect(res.status).toBe(200);
    expect(res.text).toContain(`alt="${LADDER_WORDS}"`);
  });

  it('uses the post photo\'s own description when the post carries photos', async () => {
    api.getFeedPosts.mockResolvedValue({ data: [listingFeedItem({
      type: 'post', id: 40, title: 'Garden day', image_url: null, image_alt: null,
      media: [{ id: 1, file_url: '/uploads/posts/a.jpg', thumbnail_url: '/uploads/posts/a.jpg', alt_text: 'Raised beds full of kale' }]
    })] });

    const res = await request(app).get('/dashboard');

    expect(res.text).toContain('alt="Raised beds full of kale"');
  });

  it('keeps "Image for …" when nothing was written', async () => {
    api.getFeedPosts.mockResolvedValue({ data: [listingFeedItem({ image_alt: null })] });

    const res = await request(app).get('/dashboard');

    expect(res.text).toContain(`alt="${t('feed.image_alt', { title: 'Ladder to lend' })}"`);
  });
});

describe('advanced search results', () => {
  const app = mount('/search', searchRoutes);

  function listingHit(overrides = {}) {
    return { type: 'listing', id: 4, title: 'Ladder to lend', description: 'For the weekend', image_url: '/uploads/listings/ladder.jpg', image_alt: LADDER_WORDS, ...overrides };
  }

  it('describes a listing photo with the words its owner wrote', async () => {
    api.searchV2.mockResolvedValue({ data: [listingHit()], meta: { search: { total: 1 } } });

    const res = await request(app).get('/search/advanced?q=ladder');

    expect(res.status).toBe(200);
    expect(res.text).toContain(`alt="${LADDER_WORDS}"`);
  });

  it('keeps "Image for …" when nothing was written', async () => {
    api.searchV2.mockResolvedValue({ data: [listingHit({ image_alt: null })], meta: { search: { total: 1 } } });

    const res = await request(app).get('/search/advanced?q=ladder');

    expect(res.text).toContain(`alt="${t('govuk_alpha_search.results.image_alt', { title: 'Ladder to lend' })}"`);
  });
});

describe('the events list', () => {
  const app = mount('/events', eventsRoutes);

  it('describes an event cover with the words its organiser wrote', async () => {
    api.getEvents.mockResolvedValue({ data: [contractEvent()], meta: {} });

    const res = await request(app).get('/events');

    expect(res.status).toBe(200);
    expect(res.text).toContain(`alt="${CAFE_WORDS}"`);
  });

  it('keeps "Photo for …" when nothing was written', async () => {
    api.getEvents.mockResolvedValue({ data: [contractEvent({ primary_image: { url: '/uploads/events/DSC_0042.jpg', alt_text: 'Repair cafe', description: null } })], meta: {} });

    const res = await request(app).get('/events');

    expect(res.text).toContain(`alt="${t('events.image_alt', { title: 'Repair cafe' })}"`);
  });
});

describe('a group\'s page', () => {
  const app = mount('/groups', groupsRoutes);

  it('describes an upcoming event\'s cover with the organiser\'s words', async () => {
    api.getEvents.mockResolvedValue({ data: [contractEvent()], meta: {} });

    const res = await request(app).get('/groups/974');

    expect(res.status).toBe(200);
    expect(res.text).toContain(`alt="${CAFE_WORDS}"`);
  });

  it('leaves an undescribed event cover silent beside its title', async () => {
    api.getEvents.mockResolvedValue({ data: [contractEvent({ primary_image: { url: '/uploads/events/DSC_0042.jpg', alt_text: 'Repair cafe', description: null } })], meta: {} });

    const res = await request(app).get('/groups/974');

    expect(res.text).toMatch(/<img class="nexus-alpha-card-thumb" src="[^"]*DSC_0042\.jpg" alt=""/);
  });

  it('describes a sub-group\'s picture with the words its organisers wrote', async () => {
    api.getGroup.mockResolvedValue({ data: {
      id: 974, name: 'Repair crew', visibility: 'public', my_membership: { status: 'active', role: 'member' },
      sub_groups: [
        { id: 975, name: 'Bike repairs', visibility: 'public', member_count: 4, image_url: '/uploads/groups/bike.jpg', image_alt: BIKE_WORDS },
        { id: 976, name: 'Sewing', visibility: 'public', member_count: 2, image_url: '/uploads/groups/sewing.jpg', image_alt: null }
      ]
    } });

    const res = await request(app).get('/groups/974');

    expect(res.text).toContain(`alt="${BIKE_WORDS}"`);
    // Undescribed, it stays silent beside the sub-group's visible name.
    expect(res.text).toMatch(/src="[^"]*sewing\.jpg" alt=""/);
  });
});

describe('a group\'s events page', () => {
  const app = mount('/groups', groupsRoutes);

  it('describes each event cover with the organiser\'s words', async () => {
    api.getEvents.mockResolvedValue({ data: [contractEvent()], meta: {} });

    const res = await request(app).get('/groups/974/events');

    expect(res.status).toBe(200);
    expect(res.text).toContain(`alt="${CAFE_WORDS}"`);
  });

  it('leaves an undescribed cover silent beside its title', async () => {
    api.getEvents.mockResolvedValue({ data: [contractEvent({ primary_image: null, image_alt: null })], meta: {} });

    const res = await request(app).get('/groups/974/events');

    expect(res.text).toMatch(/src="[^"]*DSC_0042\.jpg" alt=""/);
  });
});
