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
  getMyAppreciations,
  toggleBookmark,
  sendAppreciation,
  setAppreciationVisibility,
  deleteAppreciation,
  reactToAppreciation,
  ApiError
} = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { rememberFormReplay, consumeFormReplay } = require('../lib/form-replay');
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

function appreciationRedirect(userId, status, fragment = '', page = 1) {
  // No page to go back to (the profile gave no id): the account hub, never /users/0.
  if (!userId) return '/account';
  const pageQuery = page > 1 ? `&page=${page}` : '';
  const target = `/users/${userId}/appreciations?status=${encodeURIComponent(status)}${pageQuery}`;
  return fragment ? `${target}${fragment}` : target;
}

// The page of their own list a member acted from, so "Hide" on page 2 returns to page 2.
function listPage(value) {
  const number = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(number) && number > 1 ? number : 1;
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
  // 🔴 Members see first names only (owner, 10 Nov 2026). The API's `name` is already
  // the first name; the fallback must never rebuild a full name from `last_name`.
  return {
    id: positiveInteger(row.id) || fallbackId,
    name: trimmed(row.name) || trimmed(row.first_name ?? row.firstName)
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
  // A saved post opens the post itself (React BookmarksPage), not the feed.
  if (type === 'post' && id) return `/feed/posts/${id}`;
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
    myReaction: trimmed(row.my_reaction ?? row.myReaction),
    // Every note starts private; only the receiver can show it on their profile.
    // Anything that is not an explicit "yes" is treated as private.
    isPublic: [true, 1, '1', 'true'].includes(row.is_public ?? row.isPublic)
  };
}

function apiErrorCode(error) {
  const errors = Array.isArray(error?.data?.errors) ? error.data.errors : [];
  const firstError = errors.find((item) => item && typeof item === 'object') || {};
  return trimmed(
    firstError.code || error?.data?.code || error?.data?.error_code || error?.data?.error
  ).toUpperCase();
}

// A community can switch thank-you notes off. Laravel then answers every
// appreciation endpoint with 403 FEATURE_DISABLED.
function isFeatureDisabled(error) {
  return error instanceof ApiError && error.status === 403 && apiErrorCode(error) === 'FEATURE_DISABLED';
}

// The same "not available in this community" page the tenant feature gate shows
// (middleware/tenant-feature-gates.js): a settled state, not an error to retry.
function featureOff(res) {
  return res.status(403).render('errors/403', {
    title: res.locals.t('govuk_alpha.error_pages.403_title'),
    reason: 'feature-disabled'
  });
}

function appreciationStatus(error) {
  const code = apiErrorCode(error);

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
  // Saved items showed page 1 of 50 and nothing more (until 27 Oct 2026). Laravel's
  // GET /v2/bookmarks is page-numbered (meta.current_page / total_pages), so follow it.
  const requestedPage = Number.parseInt(String(req.query.page || ''), 10);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;
  const bookmarksResult = await getBookmarks(token, {
    type,
    page,
    per_page: 50
  });
  const bookmarks = rowsFrom(bookmarksResult)
    .map((item) => normalizeBookmark(item, res.locals.t))
    .filter((item) => item.title || item.type);
  const meta = metaFrom(bookmarksResult);
  const currentPage = Number(meta.current_page) > 0 ? Number(meta.current_page) : page;
  const lastPage = Math.max(currentPage, Number(meta.total_pages) || 0);
  const pageHref = (number) => {
    const params = new URLSearchParams();
    if (type) params.set('type', type);
    params.set('page', String(number));
    return `/saved?${params.toString()}`;
  };
  const pagination = lastPage > 1
    ? {
        currentPage,
        lastPage,
        previousHref: currentPage > 1 ? pageHref(currentPage - 1) : '',
        nextHref: currentPage < lastPage ? pageHref(currentPage + 1) : ''
      }
    : null;

  return res.render('saved/index', {
    title: res.locals.t('saved.title'),
    activeNav: 'saved',
    bookmarks,
    pagination,
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
  const [viewerResult, ownerResult] = await Promise.all([
    getRequestProfile(req, token),
    getUserV2(token, userId)
  ]);
  const viewer = normalizeOwner(viewerResult, 0);
  const owner = normalizeOwner(ownerResult, userId);
  const isSelf = viewer.id === owner.id;

  // Who is looking decides which list is read. Everyone else sees only the notes
  // the receiver has chosen to show; the receiver reads their own list, which
  // also holds the notes only they can see.
  let appreciationsResult;
  try {
    appreciationsResult = isSelf
      ? await getMyAppreciations(token, { tab: 'received', page, per_page: 20 })
      : await getUserAppreciations(token, userId, { page, per_page: 20 });
  } catch (error) {
    if (isFeatureDisabled(error)) return featureOff(res);
    throw error;
  }

  const meta = metaFrom(appreciationsResult);
  const currentPage = Number(meta.current_page || page || 1);
  const lastPage = Number(meta.last_page || 1);
  const appreciations = rowsFrom(appreciationsResult)
    .map(normalizeAppreciation)
    .filter((appreciation) => appreciation.id !== null);

  // Removing the last note on the last page leaves that page number pointing past
  // the end. Go to the real last page rather than showing "no notes yet".
  if (appreciations.length === 0 && page > 1 && lastPage < page) {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (lastPage > 1) params.set('page', String(lastPage));
    const query = params.toString();
    return redirectTo(res, `/users/${userId}/appreciations${query ? `?${query}` : ''}`);
  }

  return res.render('saved-social/appreciations', {
    title: res.locals.t('govuk_alpha_saved.wall.title'),
    activeNav: 'members',
    owner,
    isSelf,
    appreciations,
    appreciationForm: consumeFormReplay(req, 'appreciation', owner.id),
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

  // Six of the seven failure statuses are server-side conditions (rate limit,
  // safeguarding, a generic failure) that a member did nothing wrong to trigger, and every
  // one of them used to discard the message they had written.
  //
  // 🔴 There is no public/private choice to keep any more (owner, 12 Nov 2026): every
  // note is private until the RECEIVER shows it on their profile. `is_public` is not
  // read from the form and not sent — Laravel ignores it.
  rememberFormReplay(req, 'appreciation', userId, { message });

  if (!message) {
    return redirectTo(res, appreciationRedirect(userId, 'appreciation-message-required'));
  }

  let status = 'appreciation-sent';
  try {
    await sendAppreciation(req.token, {
      receiver_id: userId,
      message,
      context_type: 'general'
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    if (isFeatureDisabled(error)) {
      // Nothing to refill: there is no form to come back to.
      consumeFormReplay(req, 'appreciation', userId);
      return featureOff(res);
    }
    status = appreciationStatus(error);
  }

  return redirectTo(res, appreciationRedirect(userId, status));
}));

// Where to send a member back to after they act on one of their own notes. The
// form carries the page owner's id (as the reaction form does); without it, the
// only page these controls exist on is the signed-in member's own.
async function ownAppreciationsOwnerId(req) {
  const fromForm = positiveInteger(req.body && req.body.owner_id);
  if (fromForm) return fromForm;
  return normalizeOwner(await getRequestProfile(req, req.token), 0).id;
}

// The receiver shows a note on their profile, or hides it again.
router.post('/appreciations/:id(\\d+)/visibility', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const choice = String(req.body.is_public ?? '').trim();
  const page = listPage(req.body.page);
  const ownerId = await ownAppreciationsOwnerId(req);
  const back = (status) => redirectTo(res, appreciationRedirect(ownerId, status, `#appreciation-${id}`, page));

  if (choice !== '1' && choice !== '0') {
    return back('appreciation-visibility-failed');
  }

  const show = choice === '1';
  try {
    await setAppreciationVisibility(req.token, id, show);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    if (isFeatureDisabled(error)) return featureOff(res);
    // 404 included: Laravel answers 404 to anyone but the receiver, and to a note
    // that has since been removed. Either way the member is told it did not work.
    return back('appreciation-visibility-failed');
  }

  return back(show ? 'appreciation-shown' : 'appreciation-hidden');
}));

// Removing a note is permanent, so it goes through the shared confirmation page
// (views/confirm-delete.njk), like every other destructive action here.
router.get('/appreciations/:id(\\d+)/remove', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = Number(req.params.id);
  const page = listPage(req.query.page);
  const viewer = normalizeOwner(await getRequestProfile(req, token), 0);
  const t = res.locals.t;
  const pageQuery = page > 1 ? `?page=${page}` : '';

  return res.render('confirm-delete', {
    title: t('govuk_alpha_saved.manage.remove_heading'),
    activeNav: 'members',
    confirmHeading: t('govuk_alpha_saved.manage.remove_heading'),
    confirmWarning: t('govuk_alpha_saved.manage.remove_warning'),
    confirmButton: t('govuk_alpha_saved.manage.remove_confirm'),
    confirmAction: `/appreciations/${id}/remove`,
    confirmFields: [
      { name: 'owner_id', value: viewer.id },
      { name: 'page', value: page }
    ],
    cancelHref: viewer.id
      ? `/users/${viewer.id}/appreciations${pageQuery}#appreciation-${id}`
      : '/account'
  });
}, { redirectOn401: loginRedirect() }));

router.post('/appreciations/:id(\\d+)/remove', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const page = listPage(req.body.page);
  const ownerId = await ownAppreciationsOwnerId(req);

  try {
    await deleteAppreciation(req.token, id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    if (isFeatureDisabled(error)) return featureOff(res);
    return redirectTo(res, appreciationRedirect(ownerId, 'appreciation-remove-failed', `#appreciation-${id}`, page));
  }

  return redirectTo(res, appreciationRedirect(ownerId, 'appreciation-removed', '', page));
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
    if (isFeatureDisabled(error)) return featureOff(res);
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
