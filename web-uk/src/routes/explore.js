// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Explore — parity with React's ExplorePage (27 Oct 2026).
 *
 * React reads ONE aggregate, `GET /v2/explore`, and shows six tabs (All, For you,
 * Listings, People, Events, Groups) and about eighteen discovery sections, each
 * behind the same tenant feature/module gate and hidden when empty. "For you" also
 * reads `GET /v2/explore/for-you?page=N&per_page=15`. Recommended listings carry
 * "Not interested", which posts `POST /v2/explore/dismiss`.
 *
 * Without JavaScript the tabs are separate GET pages (`?tab=`), infinite scroll is
 * a next-page link, and "Not interested" is a POST form that returns to the tab.
 * React's "Recently viewed" strip reads the browser's localStorage only; there is
 * no server record of it, so it has no accessible equivalent.
 */

const express = require('express');
const {
  ApiError,
  dismissExploreItem,
  getClubs,
  getExplore,
  getExploreForYou
} = require('../lib/api');
const { buildExploreLinks } = require('../lib/accessible-shell');
const { gateContext } = require('../lib/help-guides');
const { formatLocaleDate, formatLocaleNumber } = require('../lib/localization');
const { asyncRoute } = require('../lib/routeHelpers');

const router = express.Router();

const LOGIN_AUTH_REQUIRED_PATH = '/login?status=auth-required';
const NS = 'govuk_alpha_explore';
const TABS = ['all', 'for_you', 'listings', 'people', 'events', 'groups'];
const FOR_YOU_PER_PAGE = 15;
const MAX_PAGE = 1000;

function tokenFrom(req) {
  return (req.signedCookies && req.signedCookies.token) || '';
}

function trimmed(value) {
  return String(value ?? '').trim();
}

function positiveInteger(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function dataList(result) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.data)) return result.data;
  if (result && result.data && Array.isArray(result.data.items)) return result.data.items;
  if (result && Array.isArray(result.items)) return result.items;
  return [];
}

function aggregateFrom(result) {
  const data = result && typeof result === 'object' && result.data && typeof result.data === 'object'
    ? result.data
    : result;
  return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

function listFrom(aggregate, key) {
  return Array.isArray(aggregate[key]) ? aggregate[key] : [];
}

function isAuthError(error) {
  return error instanceof ApiError && error.status === 401;
}

function urlForOf(res) {
  return typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
}

function redirectTo(res, pathname) {
  return res.redirect(urlForOf(res)(pathname));
}

function routedTenantFrom(req) {
  return req.accessibleRouting?.tenant && typeof req.accessibleRouting.tenant === 'object'
    ? req.accessibleRouting.tenant
    : {};
}

function tabFrom(value) {
  const tab = trimmed(value);
  return TABS.includes(tab) ? tab : 'all';
}

function pageFrom(value) {
  const page = positiveInteger(value);
  return page && page <= MAX_PAGE ? page : 1;
}

function tabPath(tab, extra = '') {
  const query = [tab && tab !== 'all' ? `tab=${tab}` : '', extra].filter(Boolean).join('&');
  return `/explore${query ? `?${query}` : ''}`;
}

function slugSegment(value) {
  const slug = trimmed(value);
  return /^[A-Za-z0-9_-]{1,190}$/.test(slug) ? slug : '';
}

async function applyExploreCardEvidence(req, res) {
  let hasClubs = false;
  let probeFailed = false;
  try {
    hasClubs = dataList(await getClubs({ per_page: 1 })).length > 0;
  } catch (error) {
    if (isAuthError(error)) throw error;
    // Leave the Clubs card gated off (its design default) and flag the outage.
    probeFailed = true;
  }

  const urlFor = urlForOf(res);
  res.locals.alphaExploreLinks = buildExploreLinks({
    tenant: { ...routedTenantFrom(req), has_clubs: hasClubs },
    t: res.locals.t
  }).map((item) => ({ ...item, href: urlFor(item.href) }));

  return probeFailed;
}

/**
 * The gates React's ExplorePage applies (`hasFeature` / `hasModule`).
 */
function exploreGates(tenant) {
  const { hasFeature, hasModule } = gateContext(tenant);
  return {
    listings: hasModule('listings'),
    feed: hasModule('feed'),
    profile: hasModule('profile'),
    connections: hasFeature('connections'),
    events: hasFeature('events'),
    groups: hasFeature('groups'),
    gamification: hasFeature('gamification'),
    blog: hasFeature('blog'),
    volunteering: hasFeature('volunteering'),
    organisations: hasFeature('volunteering') && hasFeature('organisations'),
    polls: hasFeature('polls'),
    jobs: hasFeature('job_vacancies'),
    resources: hasFeature('resources'),
    ideation: hasFeature('ideation_challenges'),
    search: hasFeature('search')
  };
}

function availableTabs(gates) {
  return TABS.filter((tab) => (
    (tab !== 'listings' || gates.listings)
    && (tab !== 'people' || gates.connections)
    && (tab !== 'events' || gates.events)
    && (tab !== 'groups' || gates.groups)
  ));
}

function listingTag(item) {
  const type = trimmed(item.type) === 'request' ? 'request' : 'offer';
  return { type, tagClass: type === 'request' ? 'govuk-tag--purple' : 'govuk-tag--blue' };
}

/**
 * Every React section: its key, the tabs it appears on, its gate, the aggregate
 * field it reads, its "See all" destination and how one row is shown.
 */
function sectionDefinitions({ t, date, number }) {
  const text = (value) => trimmed(value);
  const count = (key, value) => t(`${NS}.meta.${key}`, { count: finiteNumber(value) ?? 0 });

  return [
    {
      key: 'trending_posts', tabs: ['all'], gate: (g) => g.feed, field: 'trending_posts', seeAll: '/feed',
      row: (item) => ({
        id: positiveInteger(item.id),
        href: (id) => `/feed/posts/${id}`,
        title: text(item.excerpt).slice(0, 160),
        meta: [text(item.author_name)]
      })
    },
    {
      key: 'popular_listings', tabs: ['all', 'listings'], gate: (g) => g.listings, field: 'popular_listings', seeAll: '/listings?sort=popular',
      row: (item) => ({
        id: positiveInteger(item.id),
        href: (id) => `/listings/${id}`,
        title: text(item.title),
        tag: listingTag(item),
        meta: [text(item.category_name), text(item.author_name)]
      })
    },
    {
      key: 'upcoming_events', tabs: ['all', 'events'], gate: (g) => g.events, field: 'upcoming_events', seeAll: '/events',
      row: (item) => ({
        id: positiveInteger(item.id),
        href: (id) => `/events/${id}`,
        title: text(item.title),
        meta: [date(item.start_at), text(item.location), count('attending', item.rsvp_count)]
      })
    },
    {
      key: 'active_groups', tabs: ['all', 'groups'], gate: (g) => g.groups, field: 'active_groups', seeAll: '/groups',
      row: (item) => ({
        id: positiveInteger(item.id),
        href: (id) => `/groups/${id}`,
        title: text(item.name),
        meta: [count('members', item.member_count)]
      })
    },
    {
      key: 'top_contributors', tabs: ['all', 'people'], gate: (g) => g.gamification, field: 'top_contributors', seeAll: '/leaderboard',
      row: (item) => ({
        id: positiveInteger(item.id),
        href: (id) => `/members/${id}`,
        title: text(item.name),
        meta: [t(`${NS}.meta.level`, { level: finiteNumber(item.level) ?? 1 }), text(item.tagline)]
      })
    },
    {
      key: 'trending_hashtags', tabs: ['all'], gate: (g) => g.feed, field: 'trending_hashtags', seeAll: '/feed/hashtags',
      row: (item) => {
        const tag = /^[A-Za-z0-9_]{1,100}$/.test(text(item.tag)) ? text(item.tag) : '';
        return { id: tag ? 1 : null, href: () => `/feed/hashtag/${tag}`, title: tag ? `#${tag}` : '', meta: [] };
      }
    },
    {
      key: 'recommended', tabs: ['all', 'for_you', 'listings'], gate: (g) => g.listings, field: 'recommended_listings', seeAll: '/matches', dismissible: true,
      row: (item) => ({
        id: positiveInteger(item.id),
        href: (id) => `/listings/${id}`,
        title: text(item.title),
        tag: listingTag(item),
        meta: [
          finiteNumber(item.match_score) !== null ? t(`${NS}.meta.match`, { score: Math.round(finiteNumber(item.match_score)) }) : '',
          text(item.author_name) ? t(`${NS}.meta.by_author`, { name: text(item.author_name) }) : ''
        ]
      })
    },
    {
      key: 'near_you', tabs: ['all', 'for_you'], gate: (g) => g.listings, field: 'near_you_listings', seeAll: '/listings?sort=nearby',
      row: (item) => ({
        id: positiveInteger(item.id),
        href: (id) => `/listings/${id}`,
        title: text(item.title),
        tag: listingTag(item),
        meta: [
          finiteNumber(item.distance_km) !== null ? t(`${NS}.meta.distance`, { distance: number(item.distance_km, { maximumFractionDigits: 1 }) }) : '',
          text(item.author_name)
        ]
      })
    },
    {
      key: 'suggested_connections', tabs: ['all', 'people'], gate: (g) => g.connections, field: 'suggested_connections', seeAll: '/members',
      row: (item) => ({
        id: positiveInteger(item.id),
        href: (id) => `/members/${id}`,
        title: text(item.name),
        meta: [text(item.tagline)]
      })
    },
    {
      key: 'blog_posts', tabs: ['all'], gate: (g) => g.blog, field: 'trending_blog_posts', seeAll: '/blog',
      row: (item) => {
        const slug = slugSegment(item.slug);
        return {
          id: slug ? 1 : null,
          href: () => `/blog/${slug}`,
          title: text(item.title),
          meta: [date(item.published_at), count('read_time', item.reading_time)]
        };
      }
    },
    {
      key: 'volunteering', tabs: ['all'], gate: (g) => g.volunteering, field: 'volunteering_opportunities', seeAll: '/volunteering',
      row: (item) => ({
        id: positiveInteger(item.id),
        href: (id) => `/volunteering/opportunities/${id}`,
        title: text(item.title),
        meta: [text(item.org_name), text(item.location), count('applications', item.application_count)]
      })
    },
    {
      key: 'polls', tabs: ['all'], gate: (g) => g.polls, field: 'active_polls', seeAll: '/polls',
      row: (item) => ({
        id: positiveInteger(item.id),
        href: (id) => `/polls/${id}`,
        title: text(item.question),
        meta: [
          count('votes', item.vote_count),
          item.closes_at && date(item.closes_at) ? t(`${NS}.meta.closes`, { date: date(item.closes_at) }) : ''
        ]
      })
    },
    {
      key: 'in_demand_skills', tabs: ['all'], gate: () => true, field: 'in_demand_skills', seeAll: '/skills',
      row: (item) => ({
        id: text(item.skill_name) ? 1 : null,
        href: () => '/skills',
        title: text(item.skill_name),
        meta: [count('requesting', item.request_count), count('offering', item.offer_count)]
      })
    },
    {
      key: 'organisations', tabs: ['all'], gate: (g) => g.organisations, field: 'active_organisations', seeAll: '/organisations',
      row: (item) => ({
        id: positiveInteger(item.id),
        href: (id) => `/organisations/${id}`,
        title: text(item.name),
        meta: [count('opportunities', item.opportunity_count)]
      })
    },
    {
      key: 'jobs', tabs: ['all'], gate: (g) => g.jobs, field: 'latest_jobs', seeAll: '/jobs',
      row: (item) => ({
        id: positiveInteger(item.id),
        href: (id) => `/jobs/${id}`,
        title: text(item.title),
        meta: [
          text(item.org_name),
          text(item.location),
          item.deadline && date(item.deadline) ? t(`${NS}.meta.deadline`, { date: date(item.deadline) }) : ''
        ]
      })
    },
    {
      key: 'resources', tabs: ['all'], gate: (g) => g.resources, field: 'featured_resources', seeAll: '/resources',
      row: (item) => ({
        id: positiveInteger(item.id),
        href: () => '/resources',
        title: text(item.title),
        meta: [text(item.category_name)]
      })
    },
    {
      key: 'new_members', tabs: ['all', 'people'], gate: (g) => g.connections, field: 'new_members', seeAll: '/members',
      row: (item) => ({
        id: positiveInteger(item.id),
        href: (id) => `/members/${id}`,
        title: text(item.name),
        meta: [text(item.tagline)]
      })
    },
    {
      key: 'featured_challenges', tabs: ['all'], gate: (g) => g.ideation, field: 'featured_challenges', seeAll: '/ideation',
      row: (item) => ({
        id: positiveInteger(item.id),
        href: (id) => `/ideation/${id}`,
        title: text(item.title),
        meta: [
          count('ideas', item.idea_count),
          item.end_date && date(item.end_date) ? t(`${NS}.meta.ends`, { date: date(item.end_date) }) : ''
        ]
      })
    }
  ];
}

function buildSections(aggregate, gates, activeTab, helpers) {
  return sectionDefinitions(helpers)
    .filter((definition) => (activeTab === 'all' || definition.tabs.includes(activeTab)) && definition.gate(gates))
    .map((definition) => {
      const items = listFrom(aggregate, definition.field)
        .filter((item) => item && typeof item === 'object')
        .map((item) => {
          const row = definition.row(item);
          if (!row.id || !row.title) return null;
          return {
            href: row.href(row.id),
            title: row.title,
            tag: row.tag || null,
            meta: row.meta.filter(Boolean),
            dismissId: definition.dismissible ? row.id : null
          };
        })
        .filter(Boolean);
      return {
        key: definition.key,
        title: helpers.t(`${NS}.sections.${definition.key}.title`),
        subtitle: helpers.t(`${NS}.sections.${definition.key}.subtitle`),
        seeAllHref: definition.seeAll,
        items
      };
    })
    .filter((section) => section.items.length > 0);
}

/**
 * React drops a For you item whose destination is switched off for the community
 * (`isNavigationPathEnabled`). The accessible member page is /members/{id}, not
 * React's /profile/{id}.
 */
function normalizeForYouItem(item, gates, { t, date }) {
  if (!item || typeof item !== 'object') return null;
  const type = trimmed(item.content_type);
  const id = positiveInteger(item.id);
  const title = trimmed(item.title);
  if (!title) return null;

  let href = '';
  let enabled = false;
  if (type === 'listing' && id) { href = `/listings/${id}`; enabled = gates.listings; }
  if (type === 'post' && id) { href = `/feed/posts/${id}`; enabled = gates.feed; }
  if (type === 'event' && id) { href = `/events/${id}`; enabled = gates.events; }
  if (type === 'group' && id) { href = `/groups/${id}`; enabled = gates.groups; }
  if (type === 'member' && id) { href = `/members/${id}`; enabled = gates.profile; }
  if (type === 'blog') {
    const match = /^\/blog\/([A-Za-z0-9_-]{1,190})$/.exec(trimmed(item.url));
    if (match) { href = `/blog/${match[1]}`; enabled = gates.blog; }
  }
  if (!href || !enabled) return null;

  const meta = type === 'event' ? date(item.meta) : trimmed(item.meta);
  return {
    href,
    title: title.slice(0, 160),
    typeLabel: t(`${NS}.content_types.${type}`),
    subtitle: trimmed(item.subtitle),
    meta
  };
}

async function loadForYou(token, page, gates, helpers) {
  try {
    const result = await getExploreForYou(token, { page, per_page: FOR_YOU_PER_PAGE });
    const meta = result && typeof result.meta === 'object' && result.meta ? result.meta : {};
    const rawItems = dataList(result);
    const items = rawItems.map((item) => normalizeForYouItem(item, gates, helpers)).filter(Boolean);
    const total = finiteNumber(meta.total);
    const hasMore = typeof meta.has_more === 'boolean'
      ? meta.has_more
      : (rawItems.length > 0 && total !== null && page * FOR_YOU_PER_PAGE < total);
    return { items, hasMore: hasMore && rawItems.length > 0, failed: false };
  } catch (error) {
    if (isAuthError(error)) throw error;
    return { items: [], hasMore: false, failed: true };
  }
}

function emptyStateFor(activeTab, aggregate, gates) {
  const empty = (key) => listFrom(aggregate, key).length === 0;
  if (activeTab === 'listings' && empty('popular_listings') && empty('recommended_listings')) {
    return { key: 'listings', ctaHref: '/listings/create', ctaKey: 'create_listing' };
  }
  if (activeTab === 'people' && gates.connections && empty('suggested_connections') && empty('new_members') && empty('top_contributors')) {
    return { key: 'people' };
  }
  // React offers "Create event" only to members allowed to create one; the
  // community can restrict that, so the accessible page omits the shortcut
  // rather than risk a dead end.
  if (activeTab === 'events' && empty('upcoming_events')) return { key: 'events' };
  if (activeTab === 'groups' && empty('active_groups')) {
    return { key: 'groups', ctaHref: '/groups/create', ctaKey: 'create_group' };
  }
  return null;
}

router.get('/', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
  }

  const t = res.locals.t;
  const locale = res.locals.htmlLang || res.locals.locale || 'en';
  const helpers = {
    t,
    date: (value) => formatLocaleDate(value, locale),
    number: (value, options) => formatLocaleNumber(value, locale, options)
  };
  const tenant = routedTenantFrom(req);
  const gates = exploreGates(tenant);
  const tabs = availableTabs(gates);
  const requested = tabFrom(req.query.tab);
  const activeTab = tabs.includes(requested) ? requested : 'all';
  const page = pageFrom(req.query.page);

  let aggregate = {};
  let aggregateFailed = false;
  let forYou = null;
  let cardProbeFailed = false;
  try {
    const [aggregateResult, forYouResult] = await Promise.all([
      getExplore(token).then((result) => ({ ok: true, result }), (error) => {
        if (isAuthError(error)) throw error;
        return { ok: false };
      }),
      activeTab === 'for_you' ? loadForYou(token, page, gates, helpers) : Promise.resolve(null)
    ]);
    if (aggregateResult.ok) aggregate = aggregateFrom(aggregateResult.result);
    else aggregateFailed = true;
    forYou = forYouResult;
    cardProbeFailed = await applyExploreCardEvidence(req, res);
  } catch (error) {
    if (isAuthError(error)) return redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
    throw error;
  }

  const stats = aggregate.community_stats && typeof aggregate.community_stats === 'object'
    ? aggregate.community_stats
    : null;
  const categories = gates.listings
    ? listFrom(aggregate, 'categories')
      .map((category) => ({ name: trimmed(category && category.name), slug: slugSegment(category && category.slug) }))
      .filter((category) => category.name && category.slug)
      .slice(0, 8)
    : [];

  const status = trimmed(req.query.status);

  res.render('explore', {
    title: 'Explore',
    titleKey: 'explore.title',
    activeNav: 'explore',
    activeTab,
    tabs: tabs.map((key) => ({ key, href: tabPath(key), label: t(`${NS}.tabs.${key}`) })),
    showSearch: gates.search,
    categories,
    stats: activeTab === 'all' && stats && !aggregateFailed
      ? {
        members: finiteNumber(stats.total_members) ?? 0,
        exchanges: finiteNumber(stats.exchanges_this_month) ?? 0,
        hours: finiteNumber(stats.hours_exchanged) ?? 0,
        listings: finiteNumber(stats.active_listings) ?? 0
      }
      : null,
    sections: buildSections(aggregate, gates, activeTab, helpers),
    forYou,
    forYouNextHref: forYou && forYou.hasMore ? tabPath('for_you', `page=${page + 1}`) : '',
    forYouPage: page,
    emptyState: aggregateFailed ? null : emptyStateFor(activeTab, aggregate, gates),
    dismissed: status === 'dismissed',
    dismissFailed: status === 'dismiss-failed',
    aggregateError: aggregateFailed,
    loadError: cardProbeFailed ? t('states.load_error') : ''
  });
}));

router.post('/dismiss', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
  }

  const tab = tabFrom(req.body && req.body.tab);
  const itemId = positiveInteger(req.body && req.body.item_id);
  let status = 'dismissed';

  if (!itemId) {
    status = 'dismiss-failed';
  } else {
    try {
      // React: handleDismiss('listing', listing.id, 'not_relevant').
      await dismissExploreItem(token, { item_type: 'listing', item_id: itemId, reason: 'not_relevant' });
    } catch (error) {
      if (isAuthError(error)) return redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
      status = 'dismiss-failed';
    }
  }

  return redirectTo(res, tabPath(tab, `status=${status}`));
}));

module.exports = router;
