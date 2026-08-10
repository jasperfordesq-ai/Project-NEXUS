// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const {
  deleteReview,
  callReviewApi,
  createReview,
  getComments,
  getReactionSummary,
  createComment,
  toggleReaction,
  ApiError
} = require('../lib/api');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute, handleApiError } = require('../lib/routeHelpers');
const { audit } = require('../lib/auditLogger');
const { getRequestProfile } = require('../lib/request-profile');

const router = express.Router();

const REVIEWS_PATH = '/reviews';
const LOGIN_AUTH_REQUIRED_PATH = '/login?status=auth-required';
const LARAVEL_REVIEW_REACTIONS = ['like', 'love', 'laugh', 'wow', 'sad', 'celebrate'];
const LARAVEL_REVIEW_REACTION_SET = new Set(LARAVEL_REVIEW_REACTIONS);
const LARAVEL_REVIEW_REACTION_EMOJI = {
  like: '\u{1F44D}',
  love: '\u2764\uFE0F',
  laugh: '\u{1F602}',
  wow: '\u{1F62E}',
  sad: '\u{1F622}',
  celebrate: '\u{1F389}'
};

function tokenFrom(req) {
  return req.signedCookies.token || '';
}

function positiveInteger(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function integerOrZero(value) {
  const id = Number(value);
  return Number.isInteger(id) ? id : 0;
}

function trimmed(value, limit = null) {
  const text = String(value || '').trim();
  return limit === null ? text : text.slice(0, limit);
}

function redirectTo(res, pathname) {
  const target = typeof pathname === 'string' && pathname ? pathname : '/';
  const activePrefix = typeof res.locals.accessibleRoutePrefix === 'string'
    ? res.locals.accessibleRoutePrefix
    : '';

  if (
    activePrefix
    && (
      target === activePrefix
      || target.startsWith(`${activePrefix}/`)
      || target.startsWith(`${activePrefix}?`)
      || target.startsWith(`${activePrefix}#`)
    )
  ) {
    return res.redirect(target);
  }

  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(target));
}

function commentsRedirect(id, status, fragment = '') {
  return `${REVIEWS_PATH}/${id}/comments?status=${encodeURIComponent(status)}${fragment}`;
}

function redirectAuthIfNeeded(error, req, res) {
  if (error instanceof ApiError && error.status === 401) {
    handleApiError(error, req, res, { redirectOn401: LOGIN_AUTH_REQUIRED_PATH });
    return true;
  }
  return false;
}

function shouldRenderNotFound(error) {
  return error instanceof ApiError && error.status === 404;
}

function dataFrom(result) {
  return result && Object.prototype.hasOwnProperty.call(result, 'data') ? result.data : result;
}

function collectionFrom(result) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.data)) return data.data;
  if (data && Array.isArray(data.reviews)) return data.reviews;
  return [];
}

function metaFrom(result) {
  const data = dataFrom(result);
  return (result && result.meta) || (data && data.meta) || {};
}

function commentCollectionFrom(result) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.comments)) return data.comments;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

function commentCountFrom(result, comments) {
  const data = dataFrom(result);
  return Number(data && (data.count ?? data.total ?? data.comments_count)) || comments.length;
}

function oneFrom(result) {
  const data = dataFrom(result);
  if (data && data.data && !Array.isArray(data.data)) return data.data;
  return data || {};
}

function personName(person) {
  if (!person) return '';
  if (typeof person === 'string') return person;
  const firstLast = [person.first_name || person.firstName, person.last_name || person.lastName]
    .filter(Boolean)
    .join(' ')
    .trim();
  return String(person.name || person.display_name || person.displayName || firstLast || person.email || '').trim();
}

function reviewerName(review, t) {
  return personName(review.reviewer) ||
    personName(review.author) ||
    personName(review.user) ||
    trimmed(review.reviewer_name || review.reviewerName || review.author_name || review.authorName) ||
    t('govuk_alpha_blogreviews.reviews_list.unknown_member');
}

function receiverName(review, t) {
  return personName(review.receiver) ||
    personName(review.reviewee) ||
    personName(review.subject) ||
    trimmed(review.receiver_name || review.receiverName || review.reviewee_name || review.revieweeName) ||
    t('govuk_alpha_blogreviews.reviews_list.unknown_member');
}

function ratingLabel(value, t, key = 'reviews_page.rating_label') {
  const rating = Number(value);
  return Number.isFinite(rating) && rating > 0 ? t(key, { value: rating }) : '';
}

function normalizeReview(review = {}, direction = 'received', t = (key) => key) {
  const rating = Number(review.rating || review.score || 0);
  const anonymous = direction !== 'given' && Boolean(review.is_anonymous ?? review.isAnonymous);
  const otherName = anonymous
    ? t('reviews_page.anonymous')
    : (direction === 'given' ? receiverName(review, t) : reviewerName(review, t));
  return {
    id: review.id,
    direction,
    rating,
    ratingLabel: ratingLabel(rating, t),
    comment: trimmed(review.comment || review.body || review.content),
    otherName,
    createdAt: review.created_at || review.createdAt || review.date || '',
    canDelete: direction === 'given'
  };
}

function normalizePendingReview(item = {}, t = (key) => key) {
  return {
    receiverId: item.receiver_id || item.receiverId || (item.receiver && item.receiver.id) || '',
    receiverName: receiverName(item, t),
    transactionId: item.transaction_id || item.transactionId || item.exchange_id || item.exchangeId || '',
    title: trimmed(item.exchange_title || item.exchangeTitle || item.title || item.description)
  };
}

function normalizeComment(comment = {}, t = (key) => key) {
  const author = comment.author || comment.user || {};
  const reactions = comment.reactions && typeof comment.reactions === 'object' && !Array.isArray(comment.reactions)
    ? comment.reactions
    : {};
  const userReactions = Array.isArray(comment.user_reactions)
    ? comment.user_reactions
    : (Array.isArray(comment.userReactions) ? comment.userReactions : []);
  const replies = Array.isArray(comment.replies)
    ? comment.replies
    : (Array.isArray(comment.children) ? comment.children : []);

  return {
    id: comment.id,
    body: trimmed(comment.content || comment.body || comment.comment),
    authorName: personName(author) || trimmed(comment.author_name || comment.authorName || comment.user_name || comment.userName) || t('govuk_alpha_blogreviews.reviews_list.unknown_member'),
    createdAt: comment.created_at || comment.createdAt || '',
    updatedAt: comment.updated_at || comment.updatedAt || '',
    isOwner: Boolean(comment.is_owner ?? comment.is_own ?? comment.isOwner ?? comment.isOwn),
    isEdited: Boolean(comment.is_edited ?? comment.edited ?? comment.isEdited),
    reactions,
    userReactions,
    reactionTotal: Object.values(reactions).reduce((total, count) => total + (Number(count) || 0), 0),
    replies: replies.map((reply) => normalizeComment(reply, t))
  };
}

function reviewListApiPath(tab, userId, cursor = '') {
  const params = new URLSearchParams();
  params.set('per_page', '20');
  if (cursor) params.set('cursor', cursor);
  const basePath = tab === 'given' ? '/given' : `/user/${encodeURIComponent(userId)}`;
  return `${basePath}?${params.toString()}`;
}

function listHref(tab, cursor = '') {
  const params = new URLSearchParams();
  params.set('tab', tab);
  if (cursor) params.set('cursor', cursor);
  return `${REVIEWS_PATH}/list?${params.toString()}`;
}

function reviewStatusMessage(status, t) {
  const messages = {
    'review-submitted': { type: 'success', key: 'reviews_page.submit_success' },
    'review-invalid': { type: 'error', key: 'reviews_page.submit_invalid' },
    'review-duplicate': { type: 'error', key: 'reviews_page.submit_duplicate' },
    'review-failed': { type: 'error', key: 'reviews_page.submit_failed' },
    'review-deleted': { type: 'success', key: 'polish_members.review_deleted_success' },
    'review-delete-failed': { type: 'error', key: 'polish_members.review_deleted_failed' }
  };
  const message = messages[status];
  return message ? { type: message.type, text: t(message.key) } : null;
}

function commentStatusMessage(status, t) {
  const success = new Set(['comment-added', 'reply-added', 'comment-updated', 'comment-deleted', 'reaction-added', 'reaction-removed']);
  const known = new Set([...success, 'comment-invalid', 'comment-empty', 'comment-failed', 'comment-update-failed', 'comment-delete-failed', 'reaction-failed']);
  return known.has(status) ? {
    type: success.has(status) ? 'success' : 'error',
    status,
    text: t(`govuk_alpha_blogreviews.comment_states.${status}`)
  } : null;
}

router.post('/', audit.reviewCreate(), asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
  }

  const transactionId = positiveInteger(req.body.transaction_id);
  const comment = trimmed(req.body.comment);
  const payload = {
    receiver_id: integerOrZero(req.body.receiver_id),
    rating: integerOrZero(req.body.rating),
    comment: comment !== '' ? comment : null,
    transaction_id: transactionId
  };

  let status = 'review-submitted';
  try {
    await createReview(token, payload);
  } catch (error) {
    if (redirectAuthIfNeeded(error, req, res)) return;
    if (error instanceof ApiError && (error.status === 400 || error.status === 422)) {
      status = 'review-invalid';
    } else if (error instanceof ApiError && error.status === 409) {
      status = 'review-duplicate';
    } else {
      status = 'review-failed';
    }
  }

  return redirectTo(res, `${REVIEWS_PATH}?status=${status}`);
}));

router.post('/:id(\\d+)/comments', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
  }

  const id = Number(req.params.id);
  const body = trimmed(req.body.body, 5000);
  const parentId = positiveInteger(req.body.parent_id);

  if (body === '') {
    return redirectTo(res, commentsRedirect(id, 'comment-invalid'));
  }

  let status = parentId !== null ? 'reply-added' : 'comment-added';
  try {
    await createComment(token, {
      target_type: 'review',
      target_id: id,
      content: body,
      parent_id: parentId
    });
  } catch (error) {
    if (redirectAuthIfNeeded(error, req, res)) return;
    if (shouldRenderNotFound(error)) throw error;
    status = 'comment-failed';
  }

  return redirectTo(res, commentsRedirect(id, status));
}));

router.post('/:id(\\d+)/react', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
  }

  const id = Number(req.params.id);
  const emoji = trimmed(req.body.emoji);
  let status = 'reaction-failed';

  if (LARAVEL_REVIEW_REACTION_SET.has(emoji)) {
    try {
      const result = await toggleReaction(token, {
        target_type: 'review',
        target_id: id,
        reaction_type: emoji
      });
      const action = result && result.data && result.data.action;
      status = action === 'removed' ? 'reaction-removed' : 'reaction-added';
    } catch (error) {
      if (redirectAuthIfNeeded(error, req, res)) return;
      if (shouldRenderNotFound(error)) throw error;
    }
  }

  return redirectTo(res, commentsRedirect(id, status, '#review-reactions'));
}));

router.get('/', requireAuth, asyncRoute(async (req, res) => {
  const profile = dataFrom(await getRequestProfile(req, req.token || tokenFrom(req)));
  const userId = profile && (profile.id || profile.user_id || profile.userId);

  const [receivedResult, givenResult, pendingResult, statsResult] = await Promise.all([
    callReviewApi(req.token, 'GET', reviewListApiPath('received', userId)),
    callReviewApi(req.token, 'GET', '/given?per_page=20'),
    callReviewApi(req.token, 'GET', '/pending?per_page=20'),
    callReviewApi(req.token, 'GET', `/user/${encodeURIComponent(userId)}/stats`)
  ]);

  const stats = oneFrom(statsResult);

  res.render('reviews/index', {
    title: res.locals.t('reviews_page.title'),
    statusMessage: reviewStatusMessage(req.query.status, res.locals.t),
    reviewsReceived: collectionFrom(receivedResult).map((review) => normalizeReview(review, 'received', res.locals.t)),
    reviewsGiven: collectionFrom(givenResult).map((review) => normalizeReview(review, 'given', res.locals.t)),
    reviewsPending: collectionFrom(pendingResult).map((review) => normalizePendingReview(review, res.locals.t)),
    reviewStats: {
      average: stats.average ?? stats.average_rating ?? stats.averageRating ?? '',
      total: stats.total ?? stats.count ?? stats.reviews_count ?? stats.reviewsCount ?? 0
    },
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.get('/list', requireAuth, asyncRoute(async (req, res) => {
  const tab = req.query.tab === 'given' ? 'given' : 'received';
  const cursor = trimmed(req.query.cursor);
  const token = req.token || tokenFrom(req);
  let userId = null;

  if (tab === 'received') {
    const profile = dataFrom(await getRequestProfile(req, token));
    userId = profile && (profile.id || profile.user_id || profile.userId);
  }

  const result = await callReviewApi(token, 'GET', reviewListApiPath(tab, userId, cursor));
  const meta = metaFrom(result);
  const nextCursor = meta.cursor || meta.next_cursor || meta.nextCursor || '';
  const hasMore = Boolean(meta.has_more ?? meta.hasMore ?? nextCursor);

  res.render('reviews/list', {
    title: res.locals.t('govuk_alpha_blogreviews.reviews_list.title'),
    reviewsTab: tab,
    reviewsItems: collectionFrom(result).map((review) => normalizeReview(review, tab, res.locals.t)),
    reviewsCursor: nextCursor,
    reviewsHasMore: hasMore,
    loadMoreHref: hasMore && nextCursor ? listHref(tab, nextCursor) : '',
    isFirstPage: cursor === ''
  });
}));

router.get('/:id(\\d+)/comments', requireAuth, asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const token = req.token || tokenFrom(req);
  const [reviewResult, commentsResult, reactionsResult] = await Promise.all([
    callReviewApi(token, 'GET', `/${id}`),
    getComments(token, { target_type: 'review', target_id: id }),
    getReactionSummary(token, 'review', id)
  ]);

  const rawReview = oneFrom(reviewResult);
  const comments = commentCollectionFrom(commentsResult).map((comment) => normalizeComment(comment, res.locals.t));
  const reactionData = oneFrom(reactionsResult);

  res.render('reviews/comments', {
    title: res.locals.t('govuk_alpha_blogreviews.review_comments.title'),
    statusMessage: commentStatusMessage(req.query.status, res.locals.t),
    review: normalizeReview(rawReview, 'received', res.locals.t),
    comments,
    commentsCount: commentCountFrom(commentsResult, comments),
    alphaReactions: LARAVEL_REVIEW_REACTIONS.map((value) => ({
      value,
      emoji: LARAVEL_REVIEW_REACTION_EMOJI[value],
      label: res.locals.t(`govuk_alpha_blogreviews.reactions.${value}`),
      count: Number((reactionData.counts && reactionData.counts[value]) || 0),
      selected: reactionData.user_reaction === value || reactionData.userReaction === value
    })),
    reactionTotal: Number(reactionData.total || 0),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { notFoundTitle: 'Review not found' }));

// Delete review
router.post('/:id/delete', requireAuth, audit.reviewDelete(), asyncRoute(async (req, res) => {
  const { id } = req.params;
  let status = 'review-deleted';

  try {
    await deleteReview(req.token, id);

    if (req.flash) {
      req.flash('success', 'Review deleted');
    }
  } catch (error) {
    if (error instanceof ApiError && error.status !== 401) {
      status = 'review-delete-failed';
      if (req.flash) {
        req.flash('error', error.message);
      }
    } else {
      throw error;
    }
  }

  return redirectTo(res, `${REVIEWS_PATH}?status=${status}`);
}));

module.exports = router;
