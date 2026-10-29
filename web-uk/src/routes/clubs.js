// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { getClubs } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { resolveBackendMediaUrl } = require('../lib/accessible-shell');

const router = express.Router();

function tokenFrom(req) {
  return (req.signedCookies && req.signedCookies.token) || '';
}

function trimmed(value) {
  return String(value || '').trim();
}

function positiveInteger(value) {
  const id = Number(value);
  return Number.isInteger(id) && id >= 0 ? id : 0;
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function dataList(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result && result.data)) return result.data;
  if (Array.isArray(result && result.items)) return result.items;
  return [];
}

function renderNoActiveClubs(res) {
  return res.status(404).render('errors/404', { title: res.locals.t('clubs.title') });
}

function truncate(value, length) {
  const text = trimmed(value);
  if (text.length <= length) return text;
  return `${text.slice(0, Math.max(0, length - 3))}...`;
}

function websiteHref(value) {
  const website = trimmed(value);
  if (!website) return '';
  return /^https?:\/\//i.test(website) ? website : `https://${website.replace(/^\/+/, '')}`;
}

function normalizeClub(rawClub, t) {
  const club = rawClub && typeof rawClub === 'object' ? rawClub : {};
  const name = trimmed(club.name) || t('clubs.title');
  return {
    id: positiveInteger(club.id),
    name,
    description: truncate(club.description, 200),
    logoUrl: resolveBackendMediaUrl(club.logo_url || club.logoUrl),
    contactEmail: trimmed(club.contact_email || club.contactEmail || club.email),
    websiteHref: websiteHref(club.website),
    meetingSchedule: trimmed(club.meeting_schedule || club.meetingSchedule),
    memberCount: positiveInteger(club.member_count || club.memberCount)
  };
}

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

router.get('/', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, '/login?status=auth-required');
  }

  const clubsQuery = trimmed(req.query && req.query.q);
  // Laravel pages clubs (ClubsApiController: page, per_page up to 50,
  // meta.total_pages); React loads more. The list used to stop at 50.
  const page = Math.min(Math.max(Number.parseInt(trimmed(req.query && req.query.page), 10) || 1, 1), 1000);
  const params = { per_page: 50, page };
  if (clubsQuery) {
    params.search = clubsQuery;
  }

  const result = await getClubs(params);
  const clubs = asList(dataList(result)).map((club) => normalizeClub(club, res.locals.t));

  if (!clubs.length) {
    if (!clubsQuery) {
      return renderNoActiveClubs(res);
    }

    const evidence = asList(dataList(await getClubs({ per_page: 1 })));
    if (!evidence.length) {
      return renderNoActiveClubs(res);
    }
  }

  const meta = (result && result.meta) || {};
  const totalPages = Math.max(0, Number.parseInt(meta.total_pages ?? meta.last_page, 10) || 0);
  const pageHref = (target) => {
    const params2 = new URLSearchParams();
    if (clubsQuery) params2.set('q', clubsQuery);
    if (target > 1) params2.set('page', String(target));
    const text = params2.toString();
    return `/clubs${text ? `?${text}` : ''}`;
  };

  return res.render('clubs/index', {
    title: res.locals.t('clubs.title'),
    activeNav: 'explore',
    clubs,
    clubsQuery,
    previousHref: page > 1 ? pageHref(page - 1) : '',
    nextHref: page < totalPages ? pageHref(page + 1) : ''
  });
}, { notFoundTitle: 'Clubs' }));

module.exports = router;
