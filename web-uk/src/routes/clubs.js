// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { getClubs } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');

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
    logoUrl: trimmed(club.logo_url || club.logoUrl),
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
  const params = { per_page: 50 };
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

  return res.render('clubs/index', {
    title: res.locals.t('clubs.title'),
    activeNav: 'explore',
    clubs,
    clubsQuery
  });
}, { notFoundTitle: 'Clubs' }));

module.exports = router;
