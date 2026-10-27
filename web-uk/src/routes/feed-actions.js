// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const fs = require('fs/promises');
const {
  createFeedPostV2,
  updateFeedPostV2,
  deleteFeedPostV2,
  hideFeedItem,
  markFeedItemNotInterested,
  muteFeedUser,
  reportFeedItem,
  shareFeedItem,
  saveSavedItem,
  checkSavedItem,
  unsaveSavedItem,
  voteFeedPoll,
  createComment,
  updateComment,
  deleteComment,
  toggleReaction,
  toggleFeedLike,
  getFeedPostV2,
  callUgcTranslateApi,
  ApiError
} = require('../lib/api');
const { htmlToPlainText } = require('../lib/html-sanitizer');
const { POST_REACTION_TYPES, COMMENT_REACTION_TYPES } = require('../lib/feed-reactions');
const { asyncRoute } = require('../lib/routeHelpers');
const { rememberFormReplay } = require('../lib/form-replay');

// The feed composer's replay bucket. One key ('composer') because the composer is a
// single form at the top of the feed, not per-item.
const FEED_POST_REPLAY = 'feedPost';
const FEED_POST_REPLAY_KEY = 'composer';

const router = express.Router();
const FEED_PATH = '/feed';
// Every reaction React offers (components/social/reactions.ts): eight on posts and
// feed items, the first six on comments (hooks/useSocialInteractions.ts). This was
// three for both until 27 Oct 2026.
const FEED_REACTIONS = new Set(POST_REACTION_TYPES);
const COMMENT_REACTIONS = new Set(COMMENT_REACTION_TYPES);

function tokenFrom(req) {
  return req.signedCookies.token || '';
}

function trimmed(value, limit = null) {
  const text = String(value || '').trim();
  return limit === null ? text : text.slice(0, limit);
}

function uploadedFile(req, fieldName) {
  const file = req.files && req.files[fieldName];
  return file && typeof file === 'object' ? file : null;
}

async function removeUploadedFile(file) {
  if (!file || !file.filepath) return;
  try {
    await fs.unlink(file.filepath);
  } catch {
    // Temporary upload cleanup is best-effort only.
  }
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeFeedTargetType(value) {
  const type = trimmed(value).toLowerCase();
  return type === 'volunteering' ? 'volunteer' : type;
}

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined
    ? result.data
    : result;
}

function isAuthError(error) {
  return error instanceof ApiError && error.status === 401;
}

function redirectAuthIfNeeded(error, res, req, targetType = null, targetId = null) {
  if (isAuthError(error)) {
    redirectTo(res, feedRedirect(req, 'auth-required', targetType, targetId));
    return true;
  }
  return false;
}

function localUrl(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return urlFor(pathname);
}

function redirectTo(res, pathname) {
  return res.redirect(localUrl(res, pathname));
}

/**
 * Comments and likes on an event or a volunteering opportunity are posted from
 * that page, so the member goes back there rather than to the feed. Only these
 * exact path shapes are accepted (no open redirect); anything else falls back
 * to the feed as before.
 */
const SOCIAL_RETURN_PATHS = [
  /^\/events\/\d+$/,
  /^\/volunteering\/opportunities\/\d+\/comments$/
];

function socialReturnPath(req) {
  const value = trimmed(req?.body?.return_to, 200);
  return SOCIAL_RETURN_PATHS.some((pattern) => pattern.test(value)) ? value : '';
}

/**
 * Actions taken on the single-post page or a hashtag page go back to that page
 * (27 Oct 2026: those pages gained the hide / mute / report / delete menu the
 * main feed list had). Only these exact shapes are accepted, so this is not an
 * open redirect. A hide or delete taken on the post page itself goes to the feed
 * instead, because the post is no longer there to show.
 */
const FEED_RETURN_PATHS = [
  /^\/feed\/posts\/\d+$/,
  /^\/feed\/hashtag\/[A-Za-z0-9_]{1,100}$/
];
const POST_PAGE_PATH = /^\/feed\/posts\/\d+$/;

function feedReturnPath(req, { leavesPost = false } = {}) {
  const value = trimmed(req?.body?.return_to, 200);
  if (!FEED_RETURN_PATHS.some((pattern) => pattern.test(value))) return '';
  if (leavesPost && POST_PAGE_PATH.test(value)) return '';
  return value;
}

function socialReturnRedirect(returnPath, status) {
  return `${returnPath}?social=${encodeURIComponent(status)}#comments`;
}

function feedStatusRedirect(status, req = null, options = {}) {
  const feedPage = feedReturnPath(req, options);
  if (feedPage) return `${feedPage}?status=${encodeURIComponent(status)}`;
  const returnPath = socialReturnPath(req);
  if (returnPath) return socialReturnRedirect(returnPath, status);
  return `${FEED_PATH}?status=${encodeURIComponent(status)}`;
}

function feedRedirect(req, status = '', targetType = null, targetId = null) {
  if (!status) return FEED_PATH;
  const feedPage = feedReturnPath(req);
  if (feedPage) return `${feedPage}?status=${encodeURIComponent(status)}`;
  const returnPath = socialReturnPath(req);
  if (returnPath) return socialReturnRedirect(returnPath, status);

  const params = new URLSearchParams();
  params.set('status', status);
  for (const key of ['type', 'mode', 'subtype', 'per_page', 'cursor']) {
    const value = req.body[key] !== undefined ? req.body[key] : req.query[key];
    if (value !== undefined && value !== null && value !== '') {
      params.set(key, String(value));
    }
  }

  const anchor = targetType !== null && targetId !== null
    ? `#feed-item-${String(targetType).replace(/[^a-z0-9_-]/gi, '-')}-${targetId}`
    : '';
  return `${FEED_PATH}?${params.toString()}${anchor}`;
}

function likeStatusFrom(result) {
  const data = dataFrom(result);
  return data && data.action === 'unliked' ? 'like-removed' : 'like-added';
}

function reactionStatusFrom(result) {
  const data = dataFrom(result);
  return data && data.action === 'removed' ? 'reaction-removed' : 'reaction-added';
}

function shareStatusFrom(result) {
  const data = dataFrom(result);
  return data && data.shared === false ? 'share-removed' : 'share-added';
}

function savedStatusFrom(result) {
  const data = dataFrom(result);
  return data && data.saved ? 'save-removed' : 'save-added';
}

router.post('/posts', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, FEED_PATH);
  }

  const content = trimmed(req.body.content, 5000);
  const imageAlt = trimmed(req.body.image_alt, 500);
  const image = uploadedFile(req, 'image');
  // 🔴 The composer came back blank after any failure, so a post the member had just
  // written was gone. The picked IMAGE cannot be restored — a browser forbids setting a
  // file input's value — which is exactly why keeping the words and the alt text matters:
  // re-choosing a file is a nuisance, retyping the post is the real loss.
  const rememberPost = () => rememberFormReplay(req, FEED_POST_REPLAY, FEED_POST_REPLAY_KEY, {
    content,
    imageAlt
  });

  if (content === '') {
    rememberPost();
    await removeUploadedFile(image);
    return redirectTo(res, feedStatusRedirect('post-empty'));
  }

  let status = 'post-created';
  try {
    const payload = {
      content,
      visibility: 'public'
    };
    if (imageAlt !== '') {
      payload.image_alt = imageAlt;
    }
    if (image) {
      payload.file = {
        buffer: await fs.readFile(image.filepath),
        filename: trimmed(image.originalFilename) || 'feed-image',
        contentType: trimmed(image.mimetype) || 'application/octet-stream',
        size: image.size
      };
    }
    await createFeedPostV2(token, payload);
  } catch (error) {
    if (redirectAuthIfNeeded(error, res, req)) return undefined;
    rememberPost();
    status = 'post-failed';
  } finally {
    await removeUploadedFile(image);
  }

  return redirectTo(res, feedStatusRedirect(status));
}));

router.post('/posts/:id(\\d+)/update', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  if (!token) {
    return redirectTo(res, feedStatusRedirect('auth-required'));
  }

  const content = trimmed(req.body.content, 5000);
  if (content === '') {
    return redirectTo(res, feedStatusRedirect('post-empty'));
  }

  let status = 'post-updated';
  try {
    await updateFeedPostV2(token, id, { content });
  } catch (error) {
    if (redirectAuthIfNeeded(error, res, req)) return undefined;
    status = 'post-update-failed';
  }

  return redirectTo(res, feedStatusRedirect(status));
}));

router.post('/posts/:id(\\d+)/delete', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  if (!token) {
    return redirectTo(res, feedStatusRedirect('auth-required'));
  }

  let status = 'post-deleted';
  try {
    await deleteFeedPostV2(token, id);
  } catch (error) {
    if (redirectAuthIfNeeded(error, res, req)) return undefined;
    status = 'post-delete-failed';
  }

  return redirectTo(res, feedStatusRedirect(status, req, { leavesPost: status === 'post-deleted' }));
}));

router.post('/posts/:id(\\d+)/hide', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  if (!token) {
    return redirectTo(res, feedStatusRedirect('auth-required'));
  }

  const type = normalizeFeedTargetType(req.body.type || 'post');
  let status = 'content-hidden';
  try {
    await hideFeedItem(token, id, { type });
  } catch (error) {
    if (redirectAuthIfNeeded(error, res, req)) return undefined;
    status = 'moderation-failed';
  }

  return redirectTo(res, feedStatusRedirect(status, req, { leavesPost: status === 'content-hidden' }));
}));

router.post('/users/:id(\\d+)/mute', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  if (!token) {
    return redirectTo(res, feedStatusRedirect('auth-required'));
  }

  let status = 'author-muted';
  try {
    await muteFeedUser(token, id);
  } catch (error) {
    if (redirectAuthIfNeeded(error, res, req)) return undefined;
    status = 'moderation-failed';
  }

  return redirectTo(res, feedStatusRedirect(status, req));
}));

router.post('/posts/:id(\\d+)/report', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  if (!token) {
    return redirectTo(res, feedStatusRedirect('auth-required'));
  }

  const type = normalizeFeedTargetType(req.body.type || 'post');
  const reason = trimmed(req.body.reason, 1000);
  let status = 'moderation-failed';
  if (reason !== '') {
    try {
      await reportFeedItem(token, type, id, { reason });
      status = 'content-reported';
    } catch (error) {
      if (redirectAuthIfNeeded(error, res, req)) return undefined;
      status = error instanceof ApiError && error.status === 409
        ? 'content-reported'
        : 'moderation-failed';
    }
  }

  return redirectTo(res, feedStatusRedirect(status, req));
}));

router.post('/comments/:id(\\d+)/update', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  if (!token) {
    return redirectTo(res, feedStatusRedirect('auth-required', req));
  }

  const content = trimmed(req.body.content, 10000);
  if (content === '') {
    return redirectTo(res, feedStatusRedirect('comment-empty', req));
  }

  let status = 'comment-updated';
  try {
    await updateComment(token, id, { content });
  } catch (error) {
    if (redirectAuthIfNeeded(error, res, req)) return undefined;
    status = 'comment-update-failed';
  }

  return redirectTo(res, feedStatusRedirect(status, req));
}));

router.post('/comments/:id(\\d+)/delete', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  if (!token) {
    return redirectTo(res, feedStatusRedirect('auth-required', req));
  }

  let status = 'comment-deleted';
  try {
    await deleteComment(token, id);
  } catch (error) {
    if (redirectAuthIfNeeded(error, res, req)) return undefined;
    status = 'comment-delete-failed';
  }

  return redirectTo(res, feedStatusRedirect(status, req));
}));

router.post('/comments/:id(\\d+)/react', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  if (!token) {
    return redirectTo(res, feedRedirect(req, 'auth-required', 'comment', id));
  }

  const emoji = trimmed(req.body.emoji);
  let status = 'reaction-failed';
  if (COMMENT_REACTIONS.has(emoji)) {
    try {
      const result = await toggleReaction(token, {
        target_type: 'comment',
        target_id: id,
        reaction_type: emoji
      });
      status = reactionStatusFrom(result);
    } catch (error) {
      if (redirectAuthIfNeeded(error, res, req, 'comment', id)) return undefined;
      status = 'reaction-failed';
    }
  }

  return redirectTo(res, feedRedirect(req, status, 'comment', id));
}));

router.post('/posts/:id(\\d+)/react', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  if (!token) {
    return redirectTo(res, feedRedirect(req, 'auth-required', 'post', id));
  }

  const emoji = trimmed(req.body.emoji);
  let status = 'reaction-failed';
  if (FEED_REACTIONS.has(emoji)) {
    try {
      const result = await toggleReaction(token, {
        target_type: 'post',
        target_id: id,
        reaction_type: emoji
      });
      status = reactionStatusFrom(result);
    } catch (error) {
      if (redirectAuthIfNeeded(error, res, req, 'post', id)) return undefined;
      status = 'reaction-failed';
    }
  }

  return redirectTo(res, feedRedirect(req, status, 'post', id));
}));

router.post('/posts/:id(\\d+)/share', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  if (!token) {
    return redirectTo(res, feedRedirect(req, 'auth-required', 'post', id));
  }

  const comment = trimmed(req.body.comment, 1000);
  let status = 'share-failed';
  try {
    const payload = { type: 'post', id };
    if (comment) payload.comment = comment;
    const result = await shareFeedItem(token, payload);
    status = shareStatusFrom(result);
  } catch (error) {
    if (redirectAuthIfNeeded(error, res, req, 'post', id)) return undefined;
    status = error instanceof ApiError && error.status === 422 ? 'share-own' : 'share-failed';
  }

  return redirectTo(res, feedRedirect(req, status, 'post', id));
}));

router.post('/posts/:id(\\d+)/save', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  if (!token) {
    return redirectTo(res, feedRedirect(req, 'auth-required', 'post', id));
  }

  let status = 'save-failed';
  try {
    const check = await checkSavedItem(token, 'post', id);
    status = savedStatusFrom(check);
    if (status === 'save-removed') {
      await unsaveSavedItem(token, 'post', id);
    } else {
      await saveSavedItem(token, {
        item_type: 'post',
        item_id: id
      });
    }
  } catch (error) {
    if (redirectAuthIfNeeded(error, res, req, 'post', id)) return undefined;
    status = 'save-failed';
  }

  return redirectTo(res, feedRedirect(req, status, 'post', id));
}));

router.post('/items/:type([a-zA-Z0-9_-]+)/:id(\\d+)/like', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  const type = normalizeFeedTargetType(req.params.type);
  if (!token) {
    return redirectTo(res, feedRedirect(req, 'auth-required', type, id));
  }

  let status = 'like-failed';
  try {
    const result = await toggleFeedLike(token, {
      target_type: type,
      target_id: id
    });
    status = likeStatusFrom(result);
  } catch (error) {
    if (redirectAuthIfNeeded(error, res, req, type, id)) return undefined;
    status = 'like-failed';
  }

  return redirectTo(res, feedRedirect(req, status, type, id));
}));

router.post('/items/:type([a-zA-Z0-9_-]+)/:id(\\d+)/comments', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  const type = normalizeFeedTargetType(req.params.type);
  if (!token) {
    return redirectTo(res, feedRedirect(req, 'auth-required', type, id));
  }

  const content = trimmed(req.body.content, 10000);
  const parentId = positiveInteger(req.body.parent_id);
  if (content === '') {
    return redirectTo(res, feedRedirect(req, 'comment-empty', type, id));
  }

  let status = 'comment-created';
  try {
    await createComment(token, {
      target_type: type,
      target_id: id,
      content,
      parent_id: parentId
    });
  } catch (error) {
    if (redirectAuthIfNeeded(error, res, req, type, id)) return undefined;
    status = 'comment-failed';
  }

  return redirectTo(res, feedRedirect(req, status, type, id));
}));

router.post('/items/:type([a-zA-Z0-9_-]+)/:id(\\d+)/not-interested', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  const type = normalizeFeedTargetType(req.params.type);
  if (!token) {
    return redirectTo(res, feedRedirect(req, 'auth-required', type, id));
  }

  let status = 'not-interested';
  try {
    await markFeedItemNotInterested(token, id, { type });
  } catch (error) {
    if (redirectAuthIfNeeded(error, res, req, type, id)) return undefined;
    status = 'not-interested-failed';
  }

  return redirectTo(res, feedRedirect(req, status, type, id));
}));

router.post('/items/:type([a-zA-Z0-9_-]+)/:id(\\d+)/react', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  const type = normalizeFeedTargetType(req.params.type);
  if (!token) {
    return redirectTo(res, feedRedirect(req, 'auth-required', type, id));
  }

  const emoji = trimmed(req.body.emoji);
  let status = 'reaction-failed';
  if (FEED_REACTIONS.has(emoji)) {
    try {
      const result = await toggleReaction(token, {
        target_type: type,
        target_id: id,
        reaction_type: emoji
      });
      status = reactionStatusFrom(result);
    } catch (error) {
      if (redirectAuthIfNeeded(error, res, req, type, id)) return undefined;
      status = 'reaction-failed';
    }
  }

  return redirectTo(res, feedRedirect(req, status, type, id));
}));

/**
 * Translate a feed post into the member's language (React FeedCard
 * TranslateButton, POST /api/v2/ugc-translate with content_type feed_post).
 * The text is read from the API rather than taken from the form, so what is
 * translated is the post itself. The result is shown once on the post page.
 */
function translateFailureStatus(error) {
  const code = String(error?.data?.code || error?.data?.errors?.[0]?.code || '').toUpperCase();
  if (code === 'TRANSLATION_UNAVAILABLE' || code.includes('FEATURE_DISABLED')) return 'translate-unavailable';
  return 'translate-failed';
}

router.post('/posts/:id(\\d+)/translate', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  const postPath = `${FEED_PATH}/posts/${id}`;
  if (!token) {
    return redirectTo(res, `${postPath}?status=auth-required`);
  }

  const requestedLocale = trimmed(req.locale || res.locals.locale || 'en', 10);
  const targetLocale = /^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(requestedLocale) ? requestedLocale : 'en';

  let status = 'translate-done';
  try {
    const post = dataFrom(await getFeedPostV2(token, id)) || {};
    const sourceText = htmlToPlainText(post.content || '').slice(0, 8000).trim();
    if (sourceText === '') {
      status = 'translate-empty';
    } else {
      const result = await callUgcTranslateApi(token, {
        content_type: 'feed_post',
        content_id: id,
        source_text: sourceText,
        target_locale: targetLocale
      });
      const translated = trimmed(dataFrom(result)?.translated_text, 10000);
      if (translated === '') {
        status = 'translate-unavailable';
      } else if (translated === sourceText) {
        status = 'translate-same';
      } else if (req.session) {
        req.session.feedTranslation = { postId: id, text: translated, locale: targetLocale };
      }
    }
  } catch (error) {
    if (isAuthError(error)) return redirectTo(res, `${postPath}?status=auth-required`);
    status = translateFailureStatus(error);
  }

  const anchor = status === 'translate-done' ? '#post-translation' : '';
  return redirectTo(res, `${postPath}?status=${encodeURIComponent(status)}${anchor}`);
}));

router.post('/polls/:id(\\d+)/vote', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  if (!token) {
    return redirectTo(res, feedRedirect(req, 'auth-required', 'poll', id));
  }

  const optionId = positiveInteger(req.body.option_id);
  if (optionId === null) {
    return redirectTo(res, feedRedirect(req, 'poll-vote-failed', 'poll', id));
  }

  let status = 'poll-voted';
  try {
    await voteFeedPoll(token, id, { option_id: optionId });
  } catch (error) {
    if (redirectAuthIfNeeded(error, res, req, 'poll', id)) return undefined;
    status = 'poll-vote-failed';
  }

  return redirectTo(res, feedRedirect(req, status, 'poll', id));
}));

module.exports = router;
