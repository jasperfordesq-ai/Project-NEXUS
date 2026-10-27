// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Explore parity with React (27 Oct 2026).
 *
 * React's ExplorePage reads ONE aggregate (`GET /v2/explore`) and shows six tabs
 * (All, For you, Listings, People, Events, Groups), about eighteen discovery
 * sections each behind the same feature/module gate, a personalised "For you"
 * feed (`GET /v2/explore/for-you?page=N&per_page=15`) and a "Not interested"
 * dismiss on recommended listings (`POST /v2/explore/dismiss`). The accessible
 * Explore page showed module links, five listings and five events only.
 *
 * Without JavaScript the tabs are separate GET pages (`?tab=`), "load more" is a
 * next-page link, and "Not interested" is a POST form that returns to the tab.
 */

const request = require('supertest');

jest.mock('../src/lib/api', () => {
  class ApiError extends Error {
    constructor(message, status, data) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }
  return {
    ApiError,
    ApiOfflineError: class extends Error {},
    getClubs: jest.fn(),
    getExplore: jest.fn(),
    getExploreForYou: jest.fn(),
    dismissExploreItem: jest.fn()
  };
});

const api = require('../src/lib/api');
const exploreRoutes = require('../src/routes/explore');
const { PREFIX, createApp, t } = require('./react-parity-harness');

function withTenant(overrides) {
  return (req, res, next) => {
    req.accessibleRouting.tenant = { ...req.accessibleRouting.tenant, ...overrides };
    next();
  };
}

const app = (options = {}) => createApp('/explore', [exploreRoutes], options);

const aggregate = {
  community_stats: { total_members: 321, exchanges_this_month: 12, hours_exchanged: 456, active_listings: 78 },
  categories: [{ id: 1, name: 'Gardening', slug: 'gardening' }],
  trending_posts: [{ id: 11, excerpt: 'Seed swap on Saturday', author_name: 'Ann', likes_count: 3, comments_count: 1, created_at: '2026-10-20T10:00:00Z' }],
  popular_listings: [{ id: 21, title: 'Bike repairs', type: 'offer', category_name: 'Repairs', author_name: 'Bo', view_count: 9 }],
  upcoming_events: [{ id: 31, title: 'Harvest supper', start_at: '2026-11-05T18:00:00Z', location: 'Hall', rsvp_count: 4 }],
  active_groups: [{ id: 41, name: 'Allotment growers', member_count: 17 }],
  top_contributors: [{ id: 51, name: 'Cara Contributor', level: 4, xp: 900 }],
  trending_hashtags: [{ id: 61, tag: 'harvest', post_count: 5 }],
  recommended_listings: [{ id: 71, title: 'Dog walking', type: 'request', author_name: 'Dee', match_score: 82 }],
  near_you_listings: [{ id: 81, title: 'Ladder to lend', type: 'offer', author_name: 'Eve', distance_km: 1.4 }],
  suggested_connections: [{ id: 91, name: 'Finn Suggested', tagline: 'Gardener' }],
  trending_blog_posts: [{ id: 101, title: 'Our first year', slug: 'our-first-year', reading_time: 3 }],
  volunteering_opportunities: [{ id: 111, title: 'Litter pick', org_name: 'Tidy Town', application_count: 2 }],
  active_polls: [{ id: 121, question: 'Which day for the market?', vote_count: 8, option_count: 3 }],
  in_demand_skills: [{ skill_name: 'Plumbing', request_count: 6, offer_count: 1 }],
  active_organisations: [{ id: 131, name: 'Tidy Town', opportunity_count: 2 }],
  latest_jobs: [{ id: 141, title: 'Community coordinator', org_name: 'Tidy Town', application_count: 0 }],
  featured_resources: [{ id: 151, title: 'Welcome pack', category_name: 'Guides', view_count: 30 }],
  new_members: [{ id: 161, name: 'Gus Newcomer', tagline: 'Hello!' }],
  featured_challenges: [{ id: 171, title: 'Greener streets', idea_count: 7 }]
};

beforeEach(() => {
  jest.clearAllMocks();
  api.getClubs.mockResolvedValue({ data: [] });
  api.getExplore.mockResolvedValue({ data: aggregate });
  api.getExploreForYou.mockResolvedValue({ data: [], meta: { has_more: false, total: 0 } });
  api.dismissExploreItem.mockResolvedValue({ data: { dismissed: true } });
});

describe('Explore "All" tab', () => {
  it('reads the React aggregate once and renders every discovery section with its link', async () => {
    const res = await request(app()).get(`${PREFIX}/explore`);
    expect(res.status).toBe(200);
    expect(api.getExplore).toHaveBeenCalledWith('test-token');
    expect(api.getExploreForYou).not.toHaveBeenCalled();

    const sections = [
      ['trending_posts', `${PREFIX}/feed/posts/11`, 'Seed swap on Saturday'],
      ['popular_listings', `${PREFIX}/listings/21`, 'Bike repairs'],
      ['upcoming_events', `${PREFIX}/events/31`, 'Harvest supper'],
      ['active_groups', `${PREFIX}/groups/41`, 'Allotment growers'],
      ['top_contributors', `${PREFIX}/members/51`, 'Cara Contributor'],
      ['trending_hashtags', `${PREFIX}/feed/hashtag/harvest`, '#harvest'],
      ['recommended', `${PREFIX}/listings/71`, 'Dog walking'],
      ['near_you', `${PREFIX}/listings/81`, 'Ladder to lend'],
      ['suggested_connections', `${PREFIX}/members/91`, 'Finn Suggested'],
      ['blog_posts', `${PREFIX}/blog/our-first-year`, 'Our first year'],
      ['volunteering', `${PREFIX}/volunteering/opportunities/111`, 'Litter pick'],
      ['polls', `${PREFIX}/polls/121`, 'Which day for the market?'],
      ['in_demand_skills', `${PREFIX}/skills`, 'Plumbing'],
      ['organisations', `${PREFIX}/organisations/131`, 'Tidy Town'],
      ['jobs', `${PREFIX}/jobs/141`, 'Community coordinator'],
      ['resources', `${PREFIX}/resources`, 'Welcome pack'],
      ['new_members', `${PREFIX}/members/161`, 'Gus Newcomer'],
      ['featured_challenges', `${PREFIX}/ideation/171`, 'Greener streets']
    ];
    for (const [key, href, text] of sections) {
      expect(res.text).toContain(t(`govuk_alpha_explore.sections.${key}.title`));
      expect(res.text).toContain(`href="${href}"`);
      expect(res.text).toContain(text);
    }
  });

  it('shows the community numbers, the search box and the category shortcuts', async () => {
    const res = await request(app()).get(`${PREFIX}/explore`);
    expect(res.text).toContain(t('govuk_alpha_explore.stats.members'));
    expect(res.text).toContain('321');
    expect(res.text).toContain('456');
    expect(res.text).toContain(`action="${PREFIX}/search"`);
    expect(res.text).toContain(`href="${PREFIX}/listings?category=gardening"`);
  });

  it('keeps the existing module-link cards', async () => {
    const res = await request(app()).get(`${PREFIX}/explore`);
    expect(res.text).toContain('class="nexus-alpha-card-list');
  });

  it('offers the six tabs as plain links, marking the current one', async () => {
    const res = await request(app()).get(`${PREFIX}/explore`);
    expect(res.text).toContain(`href="${PREFIX}/explore?tab=for_you"`);
    expect(res.text).toContain(`href="${PREFIX}/explore?tab=listings"`);
    expect(res.text).toContain(`href="${PREFIX}/explore?tab=people"`);
    expect(res.text).toContain(`href="${PREFIX}/explore?tab=events"`);
    expect(res.text).toContain(`href="${PREFIX}/explore?tab=groups"`);
    expect(res.text).toMatch(/aria-current="page"[^>]*>\s*All/);
  });
});

describe('feature and module gates', () => {
  it('hides each section, tab and shortcut React hides when its switch is off', async () => {
    const tenant = withTenant({
      modules: { feed: false, listings: false },
      features: {
        events: false, groups: false, gamification: false, connections: false, blog: false,
        volunteering: false, polls: false, job_vacancies: false, resources: false,
        ideation_challenges: false, search: false
      }
    });
    const res = await request(app({ before: [tenant] })).get(`${PREFIX}/explore`);
    expect(res.status).toBe(200);
    for (const key of ['trending_posts', 'popular_listings', 'upcoming_events', 'active_groups',
      'top_contributors', 'trending_hashtags', 'recommended', 'near_you', 'suggested_connections',
      'blog_posts', 'volunteering', 'polls', 'organisations', 'jobs', 'resources', 'new_members',
      'featured_challenges']) {
      expect(res.text).not.toContain(t(`govuk_alpha_explore.sections.${key}.title`));
    }
    // Skills in demand has no gate in React.
    expect(res.text).toContain(t('govuk_alpha_explore.sections.in_demand_skills.title'));
    expect(res.text).not.toContain('?tab=listings');
    expect(res.text).not.toContain('?tab=people');
    expect(res.text).not.toContain('?tab=events');
    expect(res.text).not.toContain('?tab=groups');
    expect(res.text).toContain('?tab=for_you');
    expect(res.text).not.toContain(`action="${PREFIX}/search"`);
    expect(res.text).not.toContain('listings?category=gardening');
  });

  it('falls back to All when a gated-off tab is asked for', async () => {
    const tenant = withTenant({ features: { events: false } });
    const res = await request(app({ before: [tenant] })).get(`${PREFIX}/explore?tab=events`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_explore.sections.trending_posts.title'));
  });

  it('hides an empty section', async () => {
    api.getExplore.mockResolvedValueOnce({ data: { ...aggregate, active_polls: [] } });
    const res = await request(app()).get(`${PREFIX}/explore`);
    expect(res.text).not.toContain(t('govuk_alpha_explore.sections.polls.title'));
  });
});

describe('tabs show the same sections as React', () => {
  it('Listings shows popular and recommended listings only', async () => {
    const res = await request(app()).get(`${PREFIX}/explore?tab=listings`);
    expect(res.text).toContain(t('govuk_alpha_explore.sections.popular_listings.title'));
    expect(res.text).toContain(t('govuk_alpha_explore.sections.recommended.title'));
    expect(res.text).not.toContain(t('govuk_alpha_explore.sections.near_you.title'));
    expect(res.text).not.toContain(t('govuk_alpha_explore.sections.upcoming_events.title'));
    expect(res.text).not.toContain(t('govuk_alpha_explore.stats.members'));
  });

  it('People shows contributors, suggestions and new members', async () => {
    const res = await request(app()).get(`${PREFIX}/explore?tab=people`);
    expect(res.text).toContain(t('govuk_alpha_explore.sections.top_contributors.title'));
    expect(res.text).toContain(t('govuk_alpha_explore.sections.suggested_connections.title'));
    expect(res.text).toContain(t('govuk_alpha_explore.sections.new_members.title'));
    expect(res.text).not.toContain(t('govuk_alpha_explore.sections.popular_listings.title'));
  });

  it('Events and Groups show their empty states when there is nothing', async () => {
    api.getExplore.mockResolvedValue({ data: { ...aggregate, upcoming_events: [], active_groups: [] } });
    const events = await request(app()).get(`${PREFIX}/explore?tab=events`);
    expect(events.text).toContain(t('govuk_alpha_explore.empty.events'));
    const groups = await request(app()).get(`${PREFIX}/explore?tab=groups`);
    expect(groups.text).toContain(t('govuk_alpha_explore.empty.groups'));
    expect(groups.text).toContain(`href="${PREFIX}/groups/create"`);
  });
});

describe('the For you tab', () => {
  it('reads the personalised feed and links each item it is allowed to show', async () => {
    api.getExploreForYou.mockResolvedValueOnce({
      data: [
        { content_type: 'listing', id: 7, title: 'Garden help', subtitle: 'Hal', meta: 'Gardening', url: '/listings/7' },
        { content_type: 'member', id: 8, title: 'Ivy Member', url: '/profile/8' },
        { content_type: 'blog', id: 9, title: 'News post', url: '/blog/news-post' },
        { content_type: 'event', id: 10, title: 'Hidden event', url: '/events/10' }
      ],
      meta: { has_more: true, total: 40, current_page: 1 }
    });
    const tenant = withTenant({ features: { events: false } });
    const res = await request(app({ before: [tenant] })).get(`${PREFIX}/explore?tab=for_you`);
    expect(api.getExploreForYou).toHaveBeenCalledWith('test-token', { page: 1, per_page: 15 });
    expect(res.text).toContain(`href="${PREFIX}/listings/7"`);
    expect(res.text).toContain(`href="${PREFIX}/members/8"`);
    expect(res.text).toContain(`href="${PREFIX}/blog/news-post"`);
    expect(res.text).not.toContain('Hidden event');
    expect(res.text).toContain(t('govuk_alpha_explore.content_types.listing'));
    expect(res.text).toContain(`href="${PREFIX}/explore?tab=for_you&amp;page=2"`);
    // React also shows recommended and near-you listings on this tab.
    expect(res.text).toContain(t('govuk_alpha_explore.sections.recommended.title'));
    expect(res.text).toContain(t('govuk_alpha_explore.sections.near_you.title'));
    expect(res.text).not.toContain(t('govuk_alpha_explore.sections.trending_posts.title'));
  });

  it('asks for the next page and says when the member is caught up', async () => {
    api.getExploreForYou.mockResolvedValueOnce({
      data: [{ content_type: 'post', id: 3, title: 'Last post', url: '/feed/posts/3' }],
      meta: { has_more: false, total: 16, current_page: 2 }
    });
    const res = await request(app()).get(`${PREFIX}/explore?tab=for_you&page=2`);
    expect(api.getExploreForYou).toHaveBeenCalledWith('test-token', { page: 2, per_page: 15 });
    expect(res.text).toContain(t('govuk_alpha_explore.for_you.end_of_feed').replace(/'/g, '&#39;'));
    expect(res.text).not.toContain('page=3');
  });

  it('shows the empty message when there is nothing personalised yet', async () => {
    const res = await request(app()).get(`${PREFIX}/explore?tab=for_you`);
    expect(res.text).toContain(t('govuk_alpha_explore.for_you.empty'));
  });

  it('a failed feed does not break the page', async () => {
    api.getExploreForYou.mockRejectedValueOnce(new api.ApiError('down', 503));
    const res = await request(app()).get(`${PREFIX}/explore?tab=for_you`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(t('govuk_alpha_explore.for_you.load_error'));
    expect(res.text).toContain(t('govuk_alpha_explore.sections.recommended.title'));
  });
});

describe('a failed aggregate', () => {
  it('keeps the page and the module cards, and says the sections could not load', async () => {
    api.getExplore.mockRejectedValueOnce(new api.ApiError('down', 503));
    const res = await request(app()).get(`${PREFIX}/explore`);
    expect(res.status).toBe(200);
    expect(res.text).toContain('class="nexus-alpha-card-list');
    expect(res.text).toContain(t('govuk_alpha_explore.load_error'));
    expect(res.text).not.toContain(t('govuk_alpha_explore.sections.popular_listings.title'));
  });

  it('sends a signed-out session to sign in', async () => {
    api.getExplore.mockRejectedValueOnce(new api.ApiError('Unauthenticated', 401));
    const res = await request(app()).get(`${PREFIX}/explore`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${PREFIX}/login?status=auth-required`);
  });
});

describe('Not interested', () => {
  it('offers a POST form on each recommended listing', async () => {
    const res = await request(app()).get(`${PREFIX}/explore?tab=listings`);
    expect(res.text).toContain(`action="${PREFIX}/explore/dismiss"`);
    expect(res.text).toContain('name="item_id" value="71"');
    expect(res.text).toContain('name="tab" value="listings"');
    expect(res.text).toContain('name="_csrf" value="test-csrf-token"');
    expect(res.text).toContain(t('govuk_alpha_explore.dismiss'));
  });

  it('posts React\'s dismiss payload and returns to the same tab', async () => {
    const res = await request(app())
      .post(`${PREFIX}/explore/dismiss`)
      .type('form')
      .send({ item_id: '71', tab: 'for_you' });
    expect(api.dismissExploreItem).toHaveBeenCalledWith('test-token', {
      item_type: 'listing', item_id: 71, reason: 'not_relevant'
    });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${PREFIX}/explore?tab=for_you&status=dismissed`);
  });

  it('returns to All for an unknown tab, and reports a failure honestly', async () => {
    api.dismissExploreItem.mockRejectedValueOnce(new api.ApiError('nope', 500));
    const res = await request(app())
      .post(`${PREFIX}/explore/dismiss`)
      .type('form')
      .send({ item_id: '71', tab: '<script>' });
    expect(res.headers.location).toBe(`${PREFIX}/explore?status=dismiss-failed`);
  });

  it('refuses a missing item without calling Laravel', async () => {
    const res = await request(app())
      .post(`${PREFIX}/explore/dismiss`)
      .type('form')
      .send({ tab: 'all' });
    expect(api.dismissExploreItem).not.toHaveBeenCalled();
    expect(res.headers.location).toBe(`${PREFIX}/explore?status=dismiss-failed`);
  });

  it('confirms the dismissal on return', async () => {
    const res = await request(app()).get(`${PREFIX}/explore?tab=for_you&status=dismissed`);
    expect(res.text).toContain(t('govuk_alpha_explore.dismissed'));
  });
});
