// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const {
  ApiError,
  getClubs,
  getEvents,
  getListings
} = require('../lib/api');
const { buildExploreLinks, flagEnabled } = require('../lib/accessible-shell');
const { asyncRoute } = require('../lib/routeHelpers');

const router = express.Router();

const LOGIN_AUTH_REQUIRED_PATH = '/login?status=auth-required';

function tokenFrom(req) {
  return (req.signedCookies && req.signedCookies.token) || '';
}

function trimmed(value) {
  return String(value || '').trim();
}

function positiveInteger(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function dataList(result) {
  if (Array.isArray(result)) return result;
  if (result && Array.isArray(result.data)) return result.data;
  if (result && result.data && Array.isArray(result.data.items)) return result.data.items;
  if (result && Array.isArray(result.items)) return result.items;
  return [];
}

function normalizeListing(item) {
  const title = trimmed(item && item.title);
  const id = positiveInteger(item && item.id);
  if (!title) return null;

  const type = trimmed(item && item.type) === 'request' ? 'request' : 'offer';
  return {
    id,
    title,
    type,
    tagClass: type === 'request' ? 'govuk-tag--purple' : 'govuk-tag--blue',
    href: id ? `/listings/${id}` : ''
  };
}

function normalizeEvent(item) {
  const title = trimmed(item && item.title);
  const id = positiveInteger(item && item.id);
  if (!title) return null;

  return {
    id,
    title,
    date: item.start_date || item.event_date || item.starts_at || item.startsAt || '',
    href: id ? `/events/${id}` : ''
  };
}

function compact(items) {
  return items.filter(Boolean);
}

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

function prefixExploreLinks(items, res) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return items.map((item) => ({
    ...item,
    href: urlFor(item.href)
  }));
}

function routedTenantFrom(req) {
  return req.accessibleRouting?.tenant && typeof req.accessibleRouting.tenant === 'object'
    ? req.accessibleRouting.tenant
    : {};
}

async function hasActiveClubEvidence() {
  return dataList(await getClubs({ per_page: 1 })).length > 0;
}

async function applyExploreCardEvidence(req, res) {
  let hasClubs = false;
  try {
    hasClubs = await hasActiveClubEvidence();
  } catch {
    hasClubs = false;
  }

  res.locals.alphaExploreLinks = prefixExploreLinks(buildExploreLinks({
    tenant: {
      ...routedTenantFrom(req),
      has_clubs: hasClubs
    },
    t: res.locals.t
  }), res);
}

function renderExploreAuthError(error, res) {
  if (error instanceof ApiError && error.status === 401) {
    redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
    return true;
  }
  return false;
}

async function optionalExploreCollection(promise) {
  try {
    return dataList(await promise);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    return [];
  }
}

router.get('/', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
  }

  let recentListings = [];
  let upcomingEvents = [];
  try {
    const tenant = routedTenantFrom(req);
    const [listingItems, eventItems] = await Promise.all([
      flagEnabled(tenant, 'listings', 'modules', true)
        ? optionalExploreCollection(getListings(token, { per_page: 5 }))
        : Promise.resolve([]),
      flagEnabled(tenant, 'events', 'features', true)
        ? optionalExploreCollection(getEvents(token, { per_page: 5, when: 'upcoming' }))
        : Promise.resolve([])
    ]);
    recentListings = compact(listingItems.map(normalizeListing)).slice(0, 5);
    upcomingEvents = compact(eventItems.map(normalizeEvent)).slice(0, 5);
    await applyExploreCardEvidence(req, res);
  } catch (error) {
    if (renderExploreAuthError(error, res)) return undefined;
    throw error;
  }

  res.render('explore', {
    title: 'Explore',
    titleKey: 'explore.title',
    activeNav: 'explore',
    recentListings,
    upcomingEvents
  });
}));

module.exports = router;
