// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  getUserV2,
  getBookmarks,
  getUserPublicCollections,
  getUserAppreciations,
  toggleBookmark,
  sendAppreciation,
  reactToAppreciation,
  ApiError
} = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');
const { getRequestProfile } = require('../lib/request-profile');

const router = express.Router();
const APPRECIATION_REACTIONS = new Set(['heart', 'clap', 'star']);
const APPRECIATION_REACTION_TYPES = [
  { value: 'heart' },
  { value: 'clap' },
  { value: 'star' }
];
const SAVED_TYPES = [
  { value: 'post' },
  { value: 'listing' },
  { value: 'event' },
  { value: 'job' },
  { value: 'blog' },
  { value: 'discussion' }
];

function tokenFrom(req) {
  return (req.signedCookies && req.signedCookies.token) || req.token || '';
}

function loginRedirect() {
  return '/login?status=auth-required';
}

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

function savedRedirect(status) {
  return `/saved?status=${encodeURIComponent(status)}`;
}

function appreciationRedirect(userId, status, fragment = '') {
  const target = `/users/${userId}/appreciations?status=${encodeURIComponent(status)}`;
  return fragment ? `${target}${fragment}` : target;
}

function trimmed(value, limit = null) {
  const text = String(value || '').trim();
  return limit === null ? text : text.slice(0, limit);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined ? result.data : result;
}

function rowsFrom(result) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

function metaFrom(result) {
  if (result && typeof result === 'object' && result.meta && typeof result.meta === 'object') return result.meta;
  const data = dataFrom(result);
  if (data && data.meta && typeof data.meta === 'object') return data.meta;
  return {};
}

function selectedSavedType(value) {
  const text = trimmed(value).toLowerCase();
  return SAVED_TYPES.some((type) => type.value === text) ? text : '';
}

function safeColor(value) {
  const color = trimmed(value);
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#6366f1';
}

function normalizeOwner(result, fallbackId) {
  const data = dataFrom(result) || {};
  const row = data.user || data.member || data.profile || data;
  const firstLast = `${trimmed(row.first_name ?? row.firstName)} ${trimmed(row.last_name ?? row.lastName)}`.trim();
  return {
    id: positiveInteger(row.id) || fallbackId,
    name: trimmed(row.name) || firstLast
  };
}

function bookmarkType(value) {
  const raw = trimmed(value).split('\\').pop().toLowerCase();
  return raw.replace(/[_-]*model$/, '');
}

function bookmarkHref(type, id, slug) {
  if (type === 'listing' && id) return `/listings/${id}`;
  if (type === 'event' && id) return `/events/${id}`;
  if (type === 'job' && id) return `/jobs/${id}`;
  if (type === 'blog' && slug) return `/blog/${encodeURIComponent(slug)}`;
  if (['post', 'discussion'].includes(type)) return '/feed';
  return '';
}

function savedTypeLabel(type, t) {
  const key = `saved.types.${type}`;
  const translated = typeof t === 'function' ? t(key) : key;
  return translated !== key
    ? translated
    : type.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function normalizeBookmark(item, t) {
  const row = item && typeof item === 'object' ? item : {};
  const itemId = positiveInteger(row.bookmarkable_id ?? row.bookmarkableId ?? row.item_id ?? row.itemId);
  const type = bookmarkType(row.bookmarkable_type ?? row.bookmarkableType ?? row.item_type ?? row.itemType);
  const slug = trimmed(row.slug);
  const label = savedTypeLabel(type, t);
  const title = trimmed(row.title);
  return {
    id: positiveInteger(row.id),
    itemId,
    type,
    label,
    title,
    href: bookmarkHref(type, itemId, slug)
  };
}

function normalizeCollection(item) {
  const row = item && typeof item === 'object' ? item : {};
  const count = Number.isFinite(Number(row.items_count ?? row.itemsCount))
    ? Number(row.items_count ?? row.itemsCount)
    : 0;
  return {
    id: positiveInteger(row.id),
    name: trimmed(row.name),
    description: trimmed(row.description),
    color: safeColor(row.color),
    itemsCount: count
  };
}

function formatDate(value) {
  const raw = trimmed(value);
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(getRequestIntlLocale(), { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}

function normalizeAppreciation(item) {
  const row = item && typeof item === 'object' ? item : {};
  const sender = row.sender && typeof row.sender === 'object' ? row.sender : {};
  const senderId = positiveInteger(sender.id ?? row.sender_id ?? row.senderId);
  const reactionCount = Number.isFinite(Number(row.reactions_count ?? row.reactionsCount))
    ? Number(row.reactions_count ?? row.reactionsCount)
    : 0;
  return {
    id: positiveInteger(row.id),
    sender: {
      id: senderId,
      name: trimmed(sender.name ?? row.sender_name ?? row.senderName)
    },
    message: trimmed(row.message),
    receivedOn: formatDate(row.created_at ?? row.createdAt),
    reactionCount,
    myReaction: trimmed(row.my_reaction ?? row.myReaction)
  };
}

function appreciationStatus(error) {
  const errors = Array.isArray(error?.data?.errors) ? error.data.errors : [];
  const firstError = errors.find((item) => item && typeof item === 'object') || {};
  const code = trimmed(
    firstError.code || error?.data?.code || error?.data?.error_code || error?.data?.error
  ).toUpperCase();

  if (code === 'SAFEGUARDING_POLICY_UNAVAILABLE') return 'appreciation-safeguarding-unavailable';
  if (code === 'SAFEGUARDING_CONTACT_RESTRICTED') return 'appreciation-safeguarding-restricted';

  const message = String(error?.message || '');
  if (/cannot_thank_self/i.test(message)) return 'appreciation-self';
  if (/message_too_long/i.test(message)) return 'appreciation-too-long';
  if (/rate_limit/i.test(message)) return 'appreciation-rate-limited';
  return 'appreciation-failed';
}

router.get('/saved', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const type = selectedSavedType(req.query.type);
  const status = trimmed(req.query.status);
  const bookmarks = rowsFrom(await getBookmarks(token, {
    type,
    page: 1,
    per_page: 50
  }))
    .map((item) => normalizeBookmark(item, res.locals.t))
    .filter((item) => item.title || item.type);

  return res.render('saved/index', {
    title: res.locals.t('saved.title'),
    activeNav: 'saved',
    bookmarks,
    savedTypes: SAVED_TYPES,
    selectedType: type,
    status,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { redirectOn401: loginRedirect() }));

router.get('/users/:userId(\\d+)/collections', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const userId = Number(req.params.userId);
  const [ownerResult, collectionsResult] = await Promise.all([
    getUserV2(token, userId),
    getUserPublicCollections(token, userId)
  ]);
  const owner = normalizeOwner(ownerResult, userId);
  const collections = rowsFrom(collectionsResult)
    .map(normalizeCollection)
    .filter((collection) => collection.id !== null);

  return res.render('saved-social/public-collections', {
    title: res.locals.t('govuk_alpha_saved.public.title'),
    activeNav: 'members',
    owner,
    collections
  });
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Member not found' }));

router.get('/users/:userId(\\d+)/appreciations', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const userId = Number(req.params.userId);
  const page = Math.max(1, Number(req.query.page || 1));
  const status = trimmed(req.query.status);
  const [viewerResult, ownerResult, appreciationsResult] = await Promise.all([
    getRequestProfile(req, token),
    getUserV2(token, userId),
    getUserAppreciations(token, userId, { page, per_page: 20 })
  ]);
  const viewer = normalizeOwner(viewerResult, 0);
  const owner = normalizeOwner(ownerResult, userId);
  const meta = metaFrom(appreciationsResult);
  const currentPage = Number(meta.current_page || page || 1);
  const lastPage = Number(meta.last_page || 1);
  const appreciations = rowsFrom(appreciationsResult)
    .map(normalizeAppreciation)
    .filter((appreciation) => appreciation.id !== null);

  return res.render('saved-social/appreciations', {
    title: res.locals.t('govuk_alpha_saved.wall.title'),
    activeNav: 'members',
    owner,
    isSelf: viewer.id === owner.id,
    appreciations,
    reactionTypes: APPRECIATION_REACTION_TYPES,
    currentPage,
    lastPage,
    status
  });
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Member not found' }));

router.post('/saved/destroy', requireAuth, asyncRoute(async (req, res) => {
  const type = String(req.body.type || '').trim();
  const id = Number(req.body.id);
  let ok = false;

  if (type && Number.isInteger(id) && id > 0) {
    try {
      await toggleBookmark(req.token, type, id);
      ok = true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw error;
    }
  }

  return redirectTo(res, savedRedirect(ok ? 'bookmark-removed' : 'bookmark-failed'));
}));

router.post('/users/:userId(\\d+)/appreciations', requireAuth, asyncRoute(async (req, res) => {
  const userId = Number(req.params.userId);
  const message = String(req.body.message || '').trim();
  const isPublic = req.body.is_public === undefined
    ? true
    : ['1', 'on', 'true'].includes(String(req.body.is_public).toLowerCase());

  if (!message) {
    return redirectTo(res, appreciationRedirect(userId, 'appreciation-message-required'));
  }

  let status = 'appreciation-sent';
  try {
    await sendAppreciation(req.token, {
      receiver_id: userId,
      message,
      context_type: 'general',
      is_public: isPublic
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    status = appreciationStatus(error);
  }

  return redirectTo(res, appreciationRedirect(userId, status));
}));

router.post('/appreciations/:id(\\d+)/react', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const ownerId = Number(req.body.owner_id);
  const reaction = String(req.body.reaction_type || '').trim();
  const returnOwnerId = Number.isInteger(ownerId) && ownerId > 0 ? ownerId : 0;

  if (!APPRECIATION_REACTIONS.has(reaction)) {
    return redirectTo(
      res,
      returnOwnerId > 0
        ? appreciationRedirect(returnOwnerId, 'reaction-failed', `#appreciation-${id}`)
        : `${savedRedirect('reaction-failed')}#appreciation-${id}`
    );
  }

  let status = 'reaction-updated';
  try {
    await reactToAppreciation(req.token, id, reaction);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    if (error instanceof ApiError && error.status === 404) throw error;
    status = 'reaction-failed';
  }

  return redirectTo(
    res,
    returnOwnerId > 0
      ? appreciationRedirect(returnOwnerId, status, `#appreciation-${id}`)
      : `${savedRedirect(status)}#appreciation-${id}`
  );
}));

module.exports = router;
