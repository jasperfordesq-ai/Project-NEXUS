// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { rememberClientRefusal } = require('../lib/api-refusal');
const express = require('express');
const { preferences, translationBinding } = require('../lib/ugc-translation');
const fs = require('fs/promises');
const {
  createFeedPostV2,
  createFeedPostWithMedia,
  updateFeedPostV2,
  deleteFeedPostV2,
  hideFeedItem,
  markFeedItemNotInterested,
  muteFeedUser,
  reportFeedItem,
  shareFeedItem,
  toggleBookmark,
  voteFeedPoll,
  createComment,
  updateComment,
  deleteComment,
  toggleReaction,
  toggleFeedLike,
  getFeedPostV2,
  getComments,
  callUgcTranslateApi,
  ApiError
} = require('../lib/api');
const { htmlToPlainText } = require('../lib/html-sanitizer');
const { POST_REACTION_TYPES, COMMENT_REACTION_TYPES } = require('../lib/feed-reactions');
const { asyncRoute } = require('../lib/routeHelpers');
const { rememberFormReplay } = require('../lib/form-replay');
const { readDateTime } = require('../lib/date-input');

// The feed composer's replay bucket. One key ('composer') because the composer is a
// single form at the top of the feed, not per-item.
const FEED_POST_REPLAY = 'feedPost';
const FEED_POST_REPLAY_KEY = 'composer';

// One-shot: the next feed page shows Laravel's reason for the refused action.
const FEED_REFUSAL_KEY = 'feed-action';
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

// React PostTab: up to 10 photos per post (MediaUploader maxFiles, and the API's
// PostMediaService::MAX_MEDIA_PER_POST), each with its own alt text. Without
// JavaScript each photo is its own file field: `image` / `image_alt`, then
// `image_2` / `image_2_alt` … `image_10` / `image_10_alt` — the same fields as the
// group composer (routes/groups.js).
const FEED_POST_MAX_IMAGES = 10;
const FEED_POST_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

function feedPostImageFields() {
  return Array.from({ length: FEED_POST_MAX_IMAGES }, (_, index) => (
    index === 0
      ? { number: 1, file: 'image', alt: 'image_alt' }
      : { number: index + 1, file: `image_${index + 1}`, alt: `image_${index + 1}_alt` }
  ));
}

router.post('/posts', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const fields = feedPostImageFields();
  const images = fields
    .map((field) => ({ upload: uploadedFile(req, field.file), altText: trimmed(req.body[field.alt], 500) }))
    .filter((entry) => entry.upload);
  const cleanUp = () => Promise.all(images.map((entry) => removeUploadedFile(entry.upload)));
  if (!token) {
    await cleanUp();
    return redirectTo(res, FEED_PATH);
  }

  // Plain text, sent as typed: the API stores line breaks and bare links as they are
  // (HtmlSanitizer::sanitizeMemberPost keeps text; LinkPreviewService reads the URLs).
  const content = trimmed(req.body.content, 5000);
  const imageAlt = trimmed(req.body.image_alt, 500);
  // "Publish later" (React PostTab schedule): optional, but half-entered is an error.
  const schedule = readDateTime(req.body, 'schedule');
  // 🔴 The composer came back blank after any failure, so a post the member had just
  // written was gone. The picked IMAGES cannot be restored — a browser forbids setting a
  // file input's value — which is exactly why keeping the words, the alt texts and the
  // chosen date matters: re-choosing a file is a nuisance, retyping the post is the loss.
  const rememberPost = () => rememberFormReplay(req, FEED_POST_REPLAY, FEED_POST_REPLAY_KEY, {
    content,
    imageAlt,
    imageAlts: Object.fromEntries(fields.slice(1).map((field) => [field.number, trimmed(req.body[field.alt], 500)])),
    schedule: schedule.parts || { day: '', month: '', year: '', time: '' }
  });

  if (content === '') {
    rememberPost();
    await cleanUp();
    return redirectTo(res, feedStatusRedirect('post-empty'));
  }
  if (images.some((entry) => !FEED_POST_IMAGE_TYPES.has(trimmed(entry.upload.mimetype).toLowerCase()))) {
    rememberPost();
    await cleanUp();
    return redirectTo(res, feedStatusRedirect('post-image-invalid'));
  }
  if (schedule.error) {
    rememberPost();
    await cleanUp();
    return redirectTo(res, feedStatusRedirect('post-schedule-invalid'));
  }

  let status = schedule.value ? 'post-scheduled' : 'post-created';
  try {
    const payload = {
      content,
      visibility: 'public'
    };
    if (schedule.value) {
      // Exactly React's toScheduleIso(): "YYYY-MM-DDTHH:MM:00".
      payload.publish_status = 'scheduled';
      payload.scheduled_at = `${schedule.value}:00`;
    }
    const files = await Promise.all(images.map(async (entry) => ({
      buffer: await fs.readFile(entry.upload.filepath),
      filename: trimmed(entry.upload.originalFilename) || 'feed-image',
      contentType: trimmed(entry.upload.mimetype) || 'application/octet-stream',
      size: entry.upload.size,
      altText: entry.altText
    })));
    if (files.length > 1) {
      await createFeedPostWithMedia(token, { ...payload, files });
    } else {
      if (files.length === 1) {
        const [{ altText, ...file }] = files;
        if (altText !== '') payload.image_alt = altText;
        payload.file = file;
      }
      await createFeedPostV2(token, payload);
    }
  } catch (error) {
    if (redirectAuthIfNeeded(error, res, req)) return undefined;
    rememberPost();
    // Too long, safeguarding, legal acceptance...: Laravel's reason (React shows it).
    rememberClientRefusal(req, FEED_REFUSAL_KEY, error);
    status = 'post-failed';
  } finally {
    await cleanUp();
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
    // The bookmarks store (POST /v2/bookmarks, a toggle), which is what the
    // feed's is_bookmarked flag, its Saved filter and /saved all read, and what
    // React's BookmarkButton writes. Saving to /v2/me/saved-items left the post
    // "saved" somewhere no page ever looked.
    const result = await toggleBookmark(token, 'post', id);
    status = dataFrom(result)?.bookmarked === false ? 'save-removed' : 'save-added';
  } catch (error) {
    if (redirectAuthIfNeeded(error, res, req, 'post', id)) return undefined;
    status = 'save-failed';
  }

  return redirectTo(res, feedRedirect(req, status, 'post', id));
}));

// Share and save a non-post feed item (React FeedCard: SHAREABLE_TYPES and
// BookmarkButton). Shares accept ShareService::VALID_TYPES; saves accept the
// bookmark types (BookmarkService::VALID_TYPES). Until 29 Oct 2026 these items
// had only a Like button on the accessible feed.
const FEED_SHARE_TYPES = new Set(['listing', 'event', 'poll', 'job', 'blog', 'discussion', 'goal', 'challenge', 'volunteer']);
const FEED_SAVE_TYPES = new Set(['listing', 'event', 'job', 'blog', 'discussion']);

router.post('/items/:type([a-zA-Z0-9_-]+)/:id(\\d+)/share', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  const type = normalizeFeedTargetType(req.params.type);
  if (!token) {
    return redirectTo(res, feedRedirect(req, 'auth-required', type, id));
  }
  if (!FEED_SHARE_TYPES.has(type)) {
    return redirectTo(res, feedRedirect(req, 'share-failed', type, id));
  }

  let status = 'share-failed';
  try {
    status = shareStatusFrom(await shareFeedItem(token, { type, id }));
  } catch (error) {
    if (redirectAuthIfNeeded(error, res, req, type, id)) return undefined;
    status = error instanceof ApiError && error.status === 422 ? 'share-own' : 'share-failed';
  }

  return redirectTo(res, feedRedirect(req, status, type, id));
}));

router.post('/items/:type([a-zA-Z0-9_-]+)/:id(\\d+)/save', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  const type = normalizeFeedTargetType(req.params.type);
  if (!token) {
    return redirectTo(res, feedRedirect(req, 'auth-required', type, id));
  }
  if (!FEED_SAVE_TYPES.has(type)) {
    return redirectTo(res, feedRedirect(req, 'save-failed', type, id));
  }

  let status = 'save-failed';
  try {
    const result = await toggleBookmark(token, type, id);
    status = dataFrom(result)?.bookmarked === false ? 'save-removed' : 'save-added';
  } catch (error) {
    if (redirectAuthIfNeeded(error, res, req, type, id)) return undefined;
    status = 'save-failed';
  }

  return redirectTo(res, feedRedirect(req, status, type, id));
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
    rememberClientRefusal(req, FEED_REFUSAL_KEY, error);
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
  // The community switched translation off, or AI is off / not set up on the
  // platform: also permanent, not "try again later" (30 Oct 2026).
  if (['TRANSLATION_DISABLED', 'AI_NOT_CONFIGURED', 'AI_UNAVAILABLE'].includes(code)) return 'translate-unavailable';
  return 'translate-failed';
}

router.post('/posts/:id(\\d+)/translate', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  const postPath = `${FEED_PATH}/posts/${id}`;
  if (!token) {
    return redirectTo(res, `${postPath}?status=auth-required`);
  }

  const targetLocale = (await preferences(req, res, token)).locale;

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
        req.session.feedTranslation = { postId: id, text: translated, locale: targetLocale, binding: await translationBinding(req, res, token, 'feed_post', id, { body: sourceText }) };
      }
    }
  } catch (error) {
    if (isAuthError(error)) return redirectTo(res, `${postPath}?status=auth-required`);
    status = translateFailureStatus(error);
  }

  const anchor = status === 'translate-done' ? '#post-translation' : '';
  return redirectTo(res, `${postPath}?status=${encodeURIComponent(status)}${anchor}`);
}));

/**
 * Translate one comment or reply on a post (React CommentsSection's Translate,
 * AWID feedback 30 Oct 2026). Like the post route above, the text is read from
 * the API — the comment found in that post's thread — never taken from the form.
 * The result is shown once, under that comment, on the post page.
 */
function findComment(rows, id) {
  for (const row of Array.isArray(rows) ? rows : []) {
    if (Number(row?.id) === id) return row;
    const nested = findComment(row?.replies, id);
    if (nested) return nested;
  }
  return null;
}

// The non-feed targets whose comment threads can be translated, with the page
// each returns to (31 Oct 2026). Only these shapes: not an open redirect.
const TRANSLATABLE_COMMENT_TARGETS = {
  event: { path: /^\/events\/\d+$/, param: 'social', fragment: '#comments' },
  volunteer: { path: /^\/volunteering\/opportunities\/\d+\/comments$/, param: 'social', fragment: '#comments' },
  listing: { path: /^\/listings\/\d+\/comments$/, param: 'status', fragment: '' }
};

router.post('/comments/:id(\\d+)/translate', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const commentId = Number(req.params.id);
  const postId = positiveInteger(req.body.post_id);
  if (postId === null) return translateTargetComment(req, res, token, commentId);
  const postPath = `${FEED_PATH}/posts/${postId}`;
  if (!token) {
    return redirectTo(res, `${postPath}?status=auth-required`);
  }

  const targetLocale = (await preferences(req, res, token)).locale;

  let status = 'comment-translate-done';
  try {
    const thread = dataFrom(await getComments(token, { target_type: 'post', target_id: postId }));
    const rows = Array.isArray(thread) ? thread : (thread && Array.isArray(thread.comments) ? thread.comments : []);
    const comment = findComment(rows, commentId);
    const sourceText = htmlToPlainText(comment?.content || comment?.body || '').slice(0, 8000).trim();
    if (sourceText === '') {
      status = 'comment-translate-empty';
    } else {
      const result = await callUgcTranslateApi(token, {
        content_type: 'comment',
        content_id: commentId,
        source_text: sourceText,
        target_locale: targetLocale
      });
      const translated = trimmed(dataFrom(result)?.translated_text, 10000);
      if (translated === '') {
        status = 'translate-unavailable';
      } else if (translated === sourceText) {
        status = 'comment-translate-same';
      } else if (req.session) {
        req.session.feedCommentTranslation = { postId, commentId, text: translated, locale: targetLocale, binding: await translationBinding(req, res, token, 'comment', commentId, { body: sourceText }) };
      }
    }
  } catch (error) {
    if (isAuthError(error)) return redirectTo(res, `${postPath}?status=auth-required`);
    const failure = translateFailureStatus(error);
    status = failure === 'translate-failed' ? 'comment-translate-failed' : failure;
  }

  const anchor = status === 'comment-translate-done' ? `#comment-${commentId}` : '';
  return redirectTo(res, `${postPath}?status=${encodeURIComponent(status)}${anchor}`);
}));

/**
 * The same for a comment on an event or a volunteering opportunity (the shared
 * target-social section). The thread is read from the API for that target; the
 * result is shown once under the comment on the page it came from.
 */
async function translateTargetComment(req, res, token, commentId) {
  const targetType = trimmed(req.body.item_type, 30);
  const targetId = positiveInteger(req.body.item_id);
  const returnTo = trimmed(req.body.return_to, 200);
  const target = Object.prototype.hasOwnProperty.call(TRANSLATABLE_COMMENT_TARGETS, targetType)
    ? TRANSLATABLE_COMMENT_TARGETS[targetType]
    : null;
  if (!target || targetId === null || !target.path.test(returnTo)) return redirectTo(res, FEED_PATH);
  if (!token) return redirectTo(res, `${returnTo}?${target.param}=auth-required${target.fragment}`);

  const targetLocale = (await preferences(req, res, token)).locale;

  let status = 'comment-translate-done';
  try {
    const thread = dataFrom(await getComments(token, { target_type: targetType, target_id: targetId }));
    const rows = Array.isArray(thread) ? thread : (thread && Array.isArray(thread.comments) ? thread.comments : []);
    const comment = findComment(rows, commentId);
    const sourceText = htmlToPlainText(comment?.content || comment?.body || '').slice(0, 8000).trim();
    if (sourceText === '') {
      status = 'comment-translate-empty';
    } else {
      const result = await callUgcTranslateApi(token, {
        content_type: 'comment',
        content_id: commentId,
        source_text: sourceText,
        target_locale: targetLocale
      });
      const translated = trimmed(dataFrom(result)?.translated_text, 10000);
      if (translated === '') {
        status = 'translate-unavailable';
      } else if (translated === sourceText) {
        status = 'comment-translate-same';
      } else if (req.session) {
        req.session.targetCommentTranslation = { targetType, targetId, commentId, text: translated, locale: targetLocale, binding: await translationBinding(req, res, token, 'comment', commentId, { body: sourceText }) };
      }
    }
  } catch (error) {
    if (isAuthError(error)) return redirectTo(res, `${returnTo}?${target.param}=auth-required${target.fragment}`);
    const failure = translateFailureStatus(error);
    status = failure === 'translate-failed' ? 'comment-translate-failed' : failure;
  }

  const anchor = status === 'comment-translate-done' ? `#comment-${commentId}` : target.fragment;
  return redirectTo(res, `${returnTo}?${target.param}=${encodeURIComponent(status)}${anchor}`);
}

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
    // Poll closed, already voted... (SocialController 409s).
    rememberClientRefusal(req, FEED_REFUSAL_KEY, error);
    status = 'poll-vote-failed';
  }

  return redirectTo(res, feedRedirect(req, status, 'poll', id));
}));

module.exports = router;
