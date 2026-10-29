// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { consumeApiRefusal } = require('../lib/api-refusal');
const express = require('express');
const {
  getFeedPosts,
  getFeedPostV2,
  getFeedItemV2,
  getFeedHashtags,
  getFeedHashtagPosts,
  getComments,
  getFeedPostAnalytics,
  getReactors,
  searchMentionUsers,
  ApiError
} = require('../lib/api');
const { POST_REACTION_TYPES } = require('../lib/feed-reactions');
const { withTokenRefresh } = require('../middleware/auth');
const { asyncRoute } = require('../lib/routeHelpers');
const { consumeFormReplay } = require('../lib/form-replay');
const { getRequestProfile } = require('../lib/request-profile');
const { flagEnabled, resolveBackendMediaUrl } = require('../lib/accessible-shell');
const { htmlToPlainText } = require('../lib/html-sanitizer');

const router = express.Router();
const COMMENTABLE_FEED_TYPES = new Set([
  'post', 'listing', 'event', 'goal', 'poll', 'review', 'volunteer',
  'challenge', 'resource', 'job', 'blog', 'discussion'
]);

function tokenFrom(req) {
  return req.token || (req.signedCookies && req.signedCookies.token ? req.signedCookies.token : '');
}

function trimmed(value, limit = null) {
  const text = String(value || '').trim();
  return limit === null ? text : text.slice(0, limit);
}

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined
    ? result.data
    : result;
}

function hashtagRows(result) {
  const data = dataFrom(result);
  const rows = Array.isArray(data) ? data : (data && Array.isArray(data.items) ? data.items : []);

  return rows.map((row) => {
    const tag = trimmed(row && (row.tag || row.name || row.hashtag), 100).replace(/^#/, '');
    const count = Number(row && (row.post_count !== undefined ? row.post_count : row.postCount));
    const postCount = Number.isFinite(count) && count >= 0 ? count : 0;
    return {
      tag,
      postCount
    };
  }).filter((row) => row.tag);
}

function strippedSearch(value) {
  return trimmed(value, 100).replace(/[%_]/g, '');
}

function positiveInteger(value, fallback, min = 1, max = 1000) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(Math.max(number, min), max);
}

function plainParagraphs(value) {
  const text = htmlToPlainText(value);

  if (!text) return [];
  return text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
}

// The list shows the first four photos with "+N more"; the post's own page shows
// all of them (a post can carry up to 10), as React's carousel does — photos 5-10
// could not be seen at all before.
function feedMedia(row, limit = 4) {
  const media = Array.isArray(row && row.media) ? row.media : [];
  const rows = media.length > 0
    ? media
    : (row && row.image_url ? [{ file_url: row.image_url, thumbnail_url: row.image_url, alt_text: null }] : []);

  return rows.slice(0, limit).map((item) => {
    const fileUrl = resolveBackendMediaUrl(item && (item.file_url || item.url));
    const thumbnailUrl = resolveBackendMediaUrl(item && (item.thumbnail_url || item.thumbnailUrl)) || fileUrl;
    return {
      fileUrl,
      thumbnailUrl,
      altText: trimmed(item && (item.alt_text || item.altText), 500)
    };
  }).filter((item) => item.fileUrl);
}

/**
 * Gamification milestone cards are not feed content.
 *
 * `badge_earned` and `level_up` were rendered as ordinary feed cards here.
 * Removed on the owner's instruction (2026-08-27): the feed carries member
 * content, and gamification lives on the achievements and profile surfaces.
 *
 * The API no longer serves them (FeedService::EXCLUDED_SOURCE_TYPES), so this is
 * this frontend's own guard against an older or cached API response. The type
 * names survive in the label maps above only as a defensive fallback label —
 * nothing reaches them.
 */
const GAMIFICATION_MILESTONE_TYPES = new Set(['badge_earned', 'level_up']);

/**
 * A normalized feed row worth rendering: a real id, and not a gamification
 * milestone. Both feed listings filter through this.
 */
function isRenderableFeedPost(post) {
  return post.id > 0 && !GAMIFICATION_MILESTONE_TYPES.has(post.type);
}

function normalizeFeedPost(row) {
  const id = positiveInteger(row && row.id, 0, 0, Number.MAX_SAFE_INTEGER);
  const type = trimmed(row && row.type, 40) || 'post';
  const likeCount = positiveInteger(row && (
    row.likes_count !== undefined ? row.likes_count : row.like_count !== undefined ? row.like_count : row.likeCount
  ), 0, 0, Number.MAX_SAFE_INTEGER);
  const commentCount = positiveInteger(row && (
    row.comments_count !== undefined ? row.comments_count : row.comment_count !== undefined ? row.comment_count : row.commentCount
  ), 0, 0, Number.MAX_SAFE_INTEGER);
  const author = row && row.author && typeof row.author === 'object'
    ? row.author
    : (row && row.user && typeof row.user === 'object' ? row.user : {});
  const firstName = trimmed(author.first_name || author.firstName, 100);
  const lastName = trimmed(author.last_name || author.lastName, 100);
  const authorName = trimmed(author.name || row && row.author_name, 200)
    || [firstName, lastName].filter(Boolean).join(' ')
    || 'A community member';
  const authorId = positiveInteger(author.id || row && (row.author_id || row.user_id), 0, 0, Number.MAX_SAFE_INTEGER);
  const contentParagraphs = plainParagraphs(row && row.content);
  const rawMedia = Array.isArray(row && row.media)
    ? row.media
    : (row && row.image_url ? [{ file_url: row.image_url }] : []);
  const deepLink = feedItemDeepLink(type, id, row);
  const reactions = row && row.reactions && typeof row.reactions === 'object' ? row.reactions : {};
  const reactionCounts = reactions.counts && typeof reactions.counts === 'object' ? reactions.counts : {};
  const reactionTotal = Object.values(reactionCounts).reduce(
    (total, count) => total + positiveInteger(count, 0, 0, Number.MAX_SAFE_INTEGER),
    0
  );
  const userReaction = trimmed(reactions.user_reaction || row && row.user_reaction, 40);
  const rawPoll = row && row.poll_data && typeof row.poll_data === 'object' ? row.poll_data : null;
  const userVoteOptionId = rawPoll
    ? positiveInteger(rawPoll.user_vote_option_id, null, 1, Number.MAX_SAFE_INTEGER)
    : null;
  const pollOptions = rawPoll && Array.isArray(rawPoll.options)
    ? rawPoll.options.map((option) => {
      const percentage = Number(option && option.percentage);
      return {
        id: positiveInteger(option && option.id, 0, 1, Number.MAX_SAFE_INTEGER),
        label: trimmed(option && (option.text || option.label), 500),
        voteCount: positiveInteger(option && option.vote_count, 0, 0, Number.MAX_SAFE_INTEGER),
        percentage: Number.isFinite(percentage) ? Math.max(0, Math.min(100, Math.round(percentage))) : null,
        isUserChoice: userVoteOptionId !== null && positiveInteger(option && option.id, 0, 1, Number.MAX_SAFE_INTEGER) === userVoteOptionId
      };
    }).filter((option) => option.id > 0)
    : [];

  return {
    id,
    type,
    typeLabel: feedItemTypeLabel(type),
    title: trimmed(row && row.title, 200),
    detailHref: type === 'post' ? `/feed/posts/${id}` : `/feed/item/${encodeURIComponent(type)}/${id}`,
    deepLink,
    user: {
      id: authorId,
      first_name: firstName || authorName,
      last_name: lastName
    },
    authorId,
    authorName,
    authorAvatar: resolveBackendMediaUrl(author.avatar_url || row && row.author_avatar_url),
    createdAt: trimmed(row && (row.created_at || row.createdAt)),
    content: contentParagraphs.join('\n\n'),
    contentParagraphs,
    media: feedMedia(row),
    mediaExtra: Math.max(0, rawMedia.length - 4),
    group: row && row.group,
    isPinned: !!(row && (row.is_pinned || row.isPinned)),
    likeCount,
    commentCount,
    isLiked: !!(row && (row.is_liked || row.isLiked)),
    reactionCounts,
    reactionTotal,
    userReaction,
    isShared: !!(row && (row.is_shared || row.isShared)),
    // The API's own ranking explanation (pre-translated strings), shown as
    // "Why am I seeing this?" in the ranked feed, as React WhyShown does.
    rankingReasons: Array.isArray(row && row.ranking_reasons)
      ? row.ranking_reasons.map((reason) => trimmed(reason, 300)).filter(Boolean).slice(0, 10)
      : [],
    isBookmarked: !!(row && (row.is_bookmarked || row.isBookmarked || row.is_saved || row.isSaved)),
    shareCount: positiveInteger(row && (row.share_count ?? row.shareCount), 0, 0, Number.MAX_SAFE_INTEGER),
    poll: rawPoll ? {
      options: pollOptions,
      isActive: !!rawPoll.is_active,
      userVoteOptionId,
      canVote: pollOptions.length > 0 && !!rawPoll.is_active && userVoteOptionId === null
    } : null
  };
}

function profileId(result) {
  const profile = dataFrom(result) || {};
  return positiveInteger(profile.id || profile.user_id || profile.userId, null, 1, Number.MAX_SAFE_INTEGER);
}

function feedItemTypeLabel(type) {
  const labels = {
    post: 'Post',
    listing: 'Listing',
    event: 'Event',
    poll: 'Poll',
    goal: 'Goal',
    review: 'Review',
    volunteer: 'Volunteer opportunity',
    challenge: 'Challenge',
    resource: 'Resource',
    blog: 'Blog post',
    discussion: 'Discussion',
    job: 'Job',
    podcast_show: 'Podcast show',
    podcast_episode: 'Podcast episode'
  };
  return labels[type] || 'Activity';
}

// The translated counterpart of feedItemTypeLabel, backed by feed.item_types —
// the English map above is a last-resort fallback field only; anything a member
// reads must come through here.
function translatedFeedTypeLabel(type, t) {
  const known = ['post', 'listing', 'event', 'goal', 'poll', 'review', 'job', 'challenge',
    'volunteer', 'blog', 'discussion', 'badge_earned', 'level_up', 'transaction',
    'connection', 'group', 'achievement', 'resource', 'podcast_show', 'podcast_episode'];
  return t(`feed.item_types.${known.includes(type) ? type : 'activity'}`);
}

function feedItemDeepLink(type, id, row) {
  // Podcast cards link to the show (or to the episode inside its show), as the
  // React feed's "View podcast show" / "Listen to episode" button does. This
  // frontend routes podcasts by numeric id, so an episode needs its show_id;
  // an older API response without one falls back to the podcast directory.
  if (type === 'podcast_show') {
    return { href: `/podcasts/${id}`, labelKey: 'feed.view_typed.podcast_show' };
  }
  if (type === 'podcast_episode') {
    const showId = positiveInteger(row && row.show_id, 0, 0, Number.MAX_SAFE_INTEGER);
    return {
      href: showId > 0 ? `/podcasts/${showId}/episodes/${id}` : '/podcasts',
      labelKey: 'feed.view_typed.podcast_episode'
    };
  }
  const links = {
    listing: { href: `/listings/${id}`, labelKey: 'feed.view_typed.listing' },
    event: { href: `/events/${id}`, labelKey: 'feed.view_typed.event' },
    volunteer: { href: `/volunteering/opportunities/${id}`, labelKey: 'feed.view_typed.volunteer' },
    goal: { href: `/goals/${id}`, labelKey: 'feed.view_typed.goal' },
    job: { href: `/jobs/${id}`, labelKey: 'feed.view_typed.job' },
    challenge: { href: `/ideation/${id}`, labelKey: 'feed.view_typed.challenge' },
    course: { href: `/courses/${id}`, labelKey: 'feed.view_typed.course' },
    post: { href: `/feed/posts/${id}`, labelKey: 'actions.view_details' }
  };
  return links[type] || null;
}

function feedPermalinkDeepLink(type, id) {
  const links = {
    listing: { href: `/listings/${id}`, labelKey: 'govuk_alpha_feed.item.view_listing' },
    post: { href: `/feed/posts/${id}`, labelKey: 'govuk_alpha_feed.item.open_full' }
  };
  return links[type] || null;
}

function isFeedItemCommentable(type) {
  return ['post', 'listing', 'event', 'poll', 'goal', 'review', 'volunteer', 'challenge', 'resource', 'blog', 'discussion', 'job'].includes(type);
}

function normalizeFeedItem(row, fallbackType, fallbackId) {
  const item = normalizeFeedPost(row);
  const type = trimmed(row && row.type, 40) || fallbackType;
  const id = item.id || fallbackId;

  return {
    ...item,
    id,
    type,
    typeLabel: feedItemTypeLabel(type),
    title: trimmed(row && row.title, 200),
    deepLink: feedPermalinkDeepLink(type, id),
    isCommentable: isFeedItemCommentable(type)
  };
}

function collectionMeta(result) {
  return result && typeof result === 'object' && result.meta && typeof result.meta === 'object'
    ? result.meta
    : {};
}

function feedCollectionRows(result) {
  const data = dataFrom(result);
  return Array.isArray(data) ? data : [];
}

function allowed(value, values, fallback) {
  const candidate = trimmed(value, 40).toLowerCase();
  return values.includes(candidate) ? candidate : fallback;
}

function feedCommentRows(result) {
  const data = dataFrom(result);
  const rows = Array.isArray(data) ? data : (data && Array.isArray(data.comments) ? data.comments : []);
  const project = (comment) => {
    const source = comment && typeof comment === 'object' ? comment : {};
    const author = source.author && typeof source.author === 'object' ? source.author : {};
    return {
      ...source,
      author: {
        ...author,
        avatarAssetUrl: resolveBackendMediaUrl(author.avatar || author.avatar_url || author.avatarUrl)
      },
      replies: Array.isArray(source.replies) ? source.replies.map(project) : []
    };
  };
  return rows.map(project);
}

function feedNextHref(meta, perPage, selectedType, selectedMode, selectedSubtype, authorId = null) {
  const cursor = trimmed(meta && meta.cursor, 500);
  if (!meta || meta.has_more !== true || cursor === '') return '';

  const query = new URLSearchParams({
    type: selectedType,
    cursor,
    per_page: String(perPage)
  });
  if (selectedMode === 'recent') query.set('mode', 'recent');
  if (selectedSubtype) query.set('subtype', selectedSubtype);
  if (authorId) query.set('user_id', String(authorId));
  return `/feed?${query.toString()}`;
}

// A refused post, comment or poll vote carries Laravel's reason (feed-actions.js
// stashes it); show it in place of the generic failure line.
function withFeedRefusal(req, message) {
  if (!message || message.type !== 'error') return message;
  const refusal = consumeApiRefusal(req, 'feed-action');
  return refusal ? { ...message, text: refusal } : message;
}

function feedIndexStatusMessage(status, t) {
  const keys = {
    'post-created': 'states.post-created',
    'post-scheduled': 'govuk_alpha_feed.compose.scheduled',
    'post-image-invalid': 'govuk_alpha_feed.compose.image_invalid',
    'post-schedule-invalid': 'govuk_alpha_feed.compose.schedule_invalid',
    'post-empty': 'states.post_empty',
    'post-failed': 'states.post_failed',
    'post-updated': 'states.post-updated',
    'post-update-failed': 'states.post-update-failed',
    'post-deleted': 'states.post-deleted',
    'post-delete-failed': 'states.post-delete-failed',
    'like-added': 'states.like-added',
    'like-removed': 'states.like-removed',
    'like-failed': 'states.like-failed',
    'comment-created': 'states.comment-created',
    'comment-empty': 'states.comment-empty',
    'comment-too-long': 'states.comment-too-long',
    'comment-failed': 'states.comment-failed',
    'comment-updated': 'states.comment-updated',
    'comment-update-failed': 'states.comment-update-failed',
    'comment-deleted': 'states.comment-deleted',
    'comment-delete-failed': 'states.comment-delete-failed',
    'content-hidden': 'states.content-hidden',
    'author-muted': 'states.author-muted',
    'content-reported': 'states.content-reported',
    'moderation-failed': 'states.moderation-failed',
    'poll-voted': 'states.poll-voted',
    'poll-vote-failed': 'states.poll-vote-failed',
    'reaction-added': 'feed_t1.status_reaction_added',
    'reaction-removed': 'feed_t1.status_reaction_removed',
    'reaction-failed': 'feed_t1.status_reaction_failed',
    'share-added': 'feed_t1.status_share_added',
    'share-removed': 'feed_t1.status_share_removed',
    'share-failed': 'feed_t1.status_share_failed',
    'share-own': 'feed_t1.status_share_own',
    'save-added': 'feed_t1.status_save_added',
    'save-removed': 'feed_t1.status_save_removed',
    'save-failed': 'feed_t1.status_save_failed',
    'not-interested': 'govuk_alpha_feed.states.not_interested',
    'not-interested-failed': 'govuk_alpha_feed.states.not_interested_failed',
    'translate-done': 'govuk_alpha_feed.translate.done',
    'translate-failed': 'govuk_alpha_feed.translate.failed',
    'translate-unavailable': 'govuk_alpha_feed.translate.unavailable',
    'translate-same': 'govuk_alpha_feed.translate.same',
    'translate-empty': 'govuk_alpha_feed.translate.empty'
  };
  const errorStatuses = new Set([
    'translate-failed', 'translate-unavailable', 'translate-same', 'translate-empty',
    'post-empty', 'post-failed', 'post-image-invalid', 'post-schedule-invalid', 'post-update-failed', 'post-delete-failed',
    'like-failed', 'comment-empty', 'comment-too-long', 'comment-failed',
    'comment-update-failed', 'comment-delete-failed', 'moderation-failed',
    'poll-vote-failed', 'reaction-failed', 'share-failed', 'share-own',
    'save-failed', 'not-interested-failed'
  ]);
  const key = keys[status];
  if (!key || typeof t !== 'function') return null;
  return { type: errorStatuses.has(status) ? 'error' : 'success', text: t(key) };
}

function feedItemStatusMessage(status, t) {
  const keys = {
    'reaction-added': 'govuk_alpha_feed.states.reaction_added',
    'reaction-removed': 'govuk_alpha_feed.states.reaction_removed',
    'reaction-failed': 'govuk_alpha_feed.states.reaction_failed',
    'not-interested': 'govuk_alpha_feed.states.not_interested',
    'not-interested-failed': 'govuk_alpha_feed.states.not_interested_failed',
    'comment-created': 'govuk_alpha_feed.states.success_title',
    'auth-required': 'govuk_alpha_feed.states.auth_required'
  };
  const errorStatuses = new Set(['reaction-failed', 'not-interested-failed', 'auth-required']);
  const key = keys[status];
  if (!key || typeof t !== 'function') return null;
  return { type: errorStatuses.has(status) ? 'error' : 'success', text: t(key) };
}

router.get('/hashtags', asyncRoute(async (req, res) => {
  const searchQuery = trimmed(req.query.q, 100);
  const searchTerm = strippedSearch(searchQuery);
  const isSearching = searchTerm.length >= 1;
  let hashtags = [];
  let errorMessage = null;

  try {
    const result = await getFeedHashtags(tokenFrom(req), isSearching
      ? { q: searchTerm, limit: 50 }
      : { limit: 50, days: 7 });
    hashtags = hashtagRows(result);
  } catch {
    errorMessage = (req.t || res.locals.t)('govuk_alpha_feed.states.error');
  }

  res.render('feed/hashtags', {
    title: (res.locals.t ? res.locals.t('govuk_alpha_feed.hashtags.title') : 'Hashtags'),
    activeNav: 'feed',
    alphaActiveNav: 'feed',
    communityName: res.locals.tenantName || res.locals.serviceName || 'this community',
    hashtags,
    searchQuery,
    isSearching,
    errorMessage
  });
}));

router.get('/posts/:id(\\d+)', asyncRoute(withTokenRefresh(async (req, res) => {
  const id = positiveInteger(req.params.id, 0, 1, Number.MAX_SAFE_INTEGER);
  const token = tokenFrom(req);
  let itemUnavailable = false;
  let item;
  try {
    const result = await getFeedPostV2(token, id);
    item = normalizeFeedPost(dataFrom(result));
    item.media = feedMedia(dataFrom(result), 10);
    item.mediaExtra = 0;
  } catch (error) {
    if (!token && error instanceof ApiError && error.status === 401) {
      // Laravel's Blade permalink is public, but the current v2 permalink API
      // is protected. Preserve the public document/auth prompt and disclose
      // that its item is unavailable instead of turning the page into a login
      // redirect or fabricating content.
      itemUnavailable = true;
      item = normalizeFeedPost({ id, type: 'post' });
    } else {
      throw error;
    }
  }
  const comments = token
    ? feedCommentRows(await getComments(token, { target_type: 'post', target_id: id }).catch(() => ({ data: { comments: [] } })))
    : [];
  const currentUserId = token
    ? profileId(await getRequestProfile(req, token).catch(() => null))
    : null;
  // A translation made on the previous request is shown once (POST
  // /feed/posts/:id/translate), then forgotten.
  let translation = null;
  if (req.session && req.session.feedTranslation) {
    const stored = req.session.feedTranslation;
    delete req.session.feedTranslation;
    if (stored && Number(stored.postId) === id && trimmed(stored.text)) {
      translation = { text: trimmed(stored.text, 10000), locale: trimmed(stored.locale, 10) || 'en' };
    }
  }

  res.render('feed/post', {
    title: (res.locals.t ? res.locals.t('govuk_alpha.actions.post') : 'Post'),
    activeNav: 'feed',
    alphaActiveNav: 'feed',
    communityName: res.locals.tenantName || res.locals.serviceName || 'this community',
    item,
    itemUnavailable,
    comments,
    currentUserId,
    isOwn: currentUserId !== null && item.authorId === currentUserId,
    translation,
    returnTo: `/feed/posts/${id}`,
    requiresAuth: !token,
    statusMessage: withFeedRefusal(req, feedIndexStatusMessage(trimmed(req.query.status), req.t || res.locals.t)),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}), { notFoundTitle: 'Post not found' }));

function signInRedirect(res) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor('/login?status=auth-required'));
}

/**
 * Who reacted to a post, one reaction at a time (React ReactionSummary ->
 * ReactionDetailsModal, GET /api/v2/reactions/post/{id}/users/{type}). Mirrors the
 * blog likers page.
 */
router.get('/posts/:id(\\d+)/reactions/:reaction([a-z_]{1,30})', asyncRoute(withTokenRefresh(async (req, res) => {
  const id = positiveInteger(req.params.id, 0, 1, Number.MAX_SAFE_INTEGER);
  const token = tokenFrom(req);
  if (!token) return signInRedirect(res);
  const reaction = POST_REACTION_TYPES.includes(req.params.reaction) ? req.params.reaction : 'like';
  const page = positiveInteger(req.query.page, 1, 1, 1000);
  const result = await getReactors(token, 'post', id, reaction, { page, per_page: 20 });
  const meta = collectionMeta(result);
  const data = dataFrom(result);
  const rows = Array.isArray(data) ? data : (data && Array.isArray(data.users) ? data.users : []);
  const t = res.locals.t;
  const reactors = rows.map((row) => {
    const source = row && typeof row === 'object' ? row : {};
    return {
      id: positiveInteger(source.id || source.user_id, null, 1, Number.MAX_SAFE_INTEGER),
      name: trimmed(source.name || [source.first_name, source.last_name].filter(Boolean).join(' '), 200)
        || t('govuk_alpha_feed.reactions.unknown_member'),
      avatar: resolveBackendMediaUrl(source.avatar_url || source.avatar)
    };
  });
  const reactionLabel = t(`govuk_alpha_feed.reactions.${reaction}`);
  const hasMore = Boolean(meta.has_more || meta.hasMore);

  res.render('feed/reactors', {
    title: t('govuk_alpha_feed.reactions.reactors_title', { reaction: reactionLabel }),
    activeNav: 'feed',
    alphaActiveNav: 'feed',
    postId: id,
    reaction,
    reactionLabel,
    reactors,
    total: positiveInteger(meta.total, reactors.length, 0, Number.MAX_SAFE_INTEGER),
    nextHref: hasMore ? `/feed/posts/${id}/reactions/${reaction}?page=${page + 1}` : ''
  });
}), { notFoundTitle: 'Post not found' }));

/**
 * Statistics for the author of a post (React PostAnalyticsModal,
 * GET /api/v2/feed/posts/{id}/analytics). The API answers 403 to anyone who is
 * not the author or an administrator; that is explained, not hidden.
 */
router.get('/posts/:id(\\d+)/stats', asyncRoute(withTokenRefresh(async (req, res) => {
  const id = positiveInteger(req.params.id, 0, 1, Number.MAX_SAFE_INTEGER);
  const token = tokenFrom(req);
  const t = res.locals.t;
  if (!token) return signInRedirect(res);
  let stats = null;
  let errorMessage = '';
  let statusCode = 200;
  try {
    const data = dataFrom(await getFeedPostAnalytics(token, id)) || {};
    const count = (value) => positiveInteger(value, 0, 0, Number.MAX_SAFE_INTEGER);
    const breakdown = data.reactions_breakdown && typeof data.reactions_breakdown === 'object'
      ? data.reactions_breakdown
      : {};
    stats = {
      views: count(data.views_count),
      likes: count(data.likes_count),
      comments: count(data.comments_count),
      shares: count(data.shares_count),
      reach: count(data.reach_estimate),
      reactions: Object.entries(breakdown)
        .filter(([type]) => POST_REACTION_TYPES.includes(type))
        .map(([type, total]) => ({ type, label: t(`govuk_alpha_feed.reactions.${type}`), count: count(total) }))
        .filter((row) => row.count > 0)
    };
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 404)) throw error;
    if (error instanceof ApiError && error.status === 403) {
      statusCode = 403;
      errorMessage = t('govuk_alpha_feed.stats.forbidden');
    } else {
      statusCode = 502;
      errorMessage = t('govuk_alpha_feed.stats.failed');
    }
  }

  res.status(statusCode).render('feed/stats', {
    title: t('govuk_alpha_feed.stats.title'),
    activeNav: 'feed',
    alphaActiveNav: 'feed',
    postId: id,
    stats,
    errorMessage
  });
}), { notFoundTitle: 'Post not found' }));

router.get('/item/:type([a-z]+)/:id(\\d+)', asyncRoute(withTokenRefresh(async (req, res) => {
  const type = trimmed(req.params.type, 40);
  const id = positiveInteger(req.params.id, 0, 1, Number.MAX_SAFE_INTEGER);
  const token = tokenFrom(req);
  let itemUnavailable = false;
  let item;
  try {
    const result = await getFeedItemV2(token, type, id);
    item = normalizeFeedItem(dataFrom(result), type, id);
  } catch (error) {
    if (!token && error instanceof ApiError && error.status === 401) {
      itemUnavailable = true;
      item = normalizeFeedItem({ id, type }, type, id);
    } else {
      throw error;
    }
  }
  const comments = token && item.isCommentable
    ? feedCommentRows(await getComments(token, { target_type: item.type, target_id: item.id }).catch(() => ({ data: { comments: [] } })))
    : [];
  const currentUserId = token
    ? profileId(await getRequestProfile(req, token).catch(() => null))
    : null;

  res.render('feed/item', {
    title: item.title || translatedFeedTypeLabel(item.type, res.locals.t),
    activeNav: 'feed',
    alphaActiveNav: 'feed',
    communityName: res.locals.tenantName || res.locals.serviceName || 'this community',
    item,
    itemUnavailable,
    comments,
    currentUserId,
    requiresAuth: !token,
    statusMessage: feedItemStatusMessage(trimmed(req.query.status), req.t || res.locals.t),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}), { notFoundTitle: 'Feed item not found' }));

router.get('/hashtag/:tag([A-Za-z0-9_]{1,100})', asyncRoute(async (req, res) => {
  const tag = trimmed(req.params.tag, 100).replace(/^#/, '').toLowerCase();
  const perPage = positiveInteger(req.query.per_page, 20, 1, 50);
  const cursor = trimmed(req.query.cursor, 500);
  const query = { limit: perPage };
  if (cursor) query.cursor = cursor;

  let items = [];
  let totalCount = 0;
  let hasMore = false;
  let nextCursor = '';
  let errorMessage = null;

  const hashtagToken = tokenFrom(req);
  const currentUserId = hashtagToken
    ? profileId(await getRequestProfile(req, hashtagToken).catch(() => null))
    : null;

  try {
    const result = await getFeedHashtagPosts(hashtagToken, tag, query);
    const meta = collectionMeta(result);
    items = feedCollectionRows(result).map(normalizeFeedPost).filter(isRenderableFeedPost);
    totalCount = positiveInteger(meta.total_items, items.length, 0, Number.MAX_SAFE_INTEGER);
    hasMore = !!meta.has_more;
    nextCursor = trimmed(meta.cursor, 500);
  } catch {
    errorMessage = (req.t || res.locals.t)('govuk_alpha_feed.states.error');
  }

  res.render('feed/hashtag', {
    title: `#${tag}`,
    activeNav: 'feed',
    alphaActiveNav: 'feed',
    communityName: res.locals.tenantName || res.locals.serviceName || 'this community',
    tag,
    items,
    totalCount,
    hasMore,
    nextCursor,
    perPage,
    nextHref: hasMore && nextCursor ? `/feed/hashtag/${encodeURIComponent(tag)}?cursor=${encodeURIComponent(nextCursor)}&per_page=${perPage}` : '',
    requiresAuth: !tokenFrom(req),
    currentUserId,
    returnTo: `/feed/hashtag/${tag}`,
    statusMessage: withFeedRefusal(req, feedIndexStatusMessage(trimmed(req.query.status), req.t || res.locals.t)),
    errorMessage,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

// Which composer field each composer failure points at (GOV.UK error summary link).
const COMPOSER_ERROR_FIELDS = {
  'post-empty': 'content',
  'post-failed': 'content',
  'post-image-invalid': 'image',
  'post-schedule-invalid': 'feed-schedule-day'
};

// The characters MentionService::extractMentions reads after "@". A username outside
// them cannot be mentioned by typing it, so it is not offered as one.
const MENTIONABLE_USERNAME = /^[A-Za-z0-9_.-]{1,100}$/;

/**
 * Find a member's username to @mention them (React MentionInput uses the same
 * GET /api/v2/mentions/search). Without JavaScript there is no live dropdown, so this
 * is a small search page. The API applies its own rules: same community, active and
 * approved members, each member's "show me in member search" choice, blocks both
 * ways, and never the searcher.
 */
router.get('/mentions', asyncRoute(withTokenRefresh(async (req, res) => {
  const token = tokenFrom(req);
  const t = res.locals.t;
  const query = trimmed(req.query.q, 100);
  let members = [];
  let errorMessage = '';
  if (token && query) {
    try {
      const data = dataFrom(await searchMentionUsers(token, query));
      const rows = Array.isArray(data) ? data : (data && Array.isArray(data.items) ? data.items : []);
      members = rows.map((row) => {
        const source = row && typeof row === 'object' ? row : {};
        const username = trimmed(source.username, 100);
        return {
          id: positiveInteger(source.id, null, 1, Number.MAX_SAFE_INTEGER),
          name: trimmed(source.name || [source.first_name, source.last_name].filter(Boolean).join(' '), 200),
          username: MENTIONABLE_USERNAME.test(username) ? username : ''
        };
      }).filter((row) => row.id && row.name);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw error;
      errorMessage = t('govuk_alpha_feed.mentions.failed');
    }
  }

  res.render('feed/mentions', {
    title: t('govuk_alpha_feed.mentions.title'),
    activeNav: 'feed',
    alphaActiveNav: 'feed',
    query,
    searched: Boolean(token && query),
    members,
    errorMessage,
    requiresAuth: !token
  });
})));

// Laravel deliberately renders the feed shell to signed-out visitors and only
// calls the protected feed API for authenticated users.
router.get('/', asyncRoute(withTokenRefresh(async (req, res) => {
  const token = tokenFrom(req);
  const typeOptions = [
    'all', 'following', 'saved', 'posts', 'listings', 'events', 'goals',
    'polls', 'jobs', 'challenges', 'volunteering', 'blogs', 'discussions'
  ];
  const selectedType = allowed(req.query.type, typeOptions, 'all');
  const selectedMode = allowed(req.query.mode, ['ranking', 'recent'], 'ranking');
  const selectedSubtype = selectedType === 'listings'
    ? allowed(req.query.subtype, ['offer', 'request'], '')
    : '';
  const perPage = positiveInteger(req.query.per_page, 10, 1, 50);
  const cursor = trimmed(req.query.cursor, 500);
  // Laravel ranks or not by `personalised` (SocialController::feedV2 ignores
  // `mode`), which is what React's sort toggle sends.
  const feedParams = {
    per_page: perPage,
    type: selectedType,
    personalised: selectedMode !== 'recent'
  };
  if (selectedSubtype) feedParams.subtype = selectedSubtype;
  if (cursor) feedParams.cursor = cursor;
  // One member's posts (React's profile Posts tab: GET /v2/feed?user_id=).
  const authorFilter = positiveInteger(req.query.user_id, null, 1, Number.MAX_SAFE_INTEGER);
  if (authorFilter) feedParams.user_id = authorFilter;
  let feedErrorMessage = null;

  const feedResult = token
    ? await getFeedPosts(token, feedParams).catch((error) => {
      if (error instanceof ApiError && error.status === 401) throw error;
      feedErrorMessage = (req.t || res.locals.t)('feed.error_detail');
      return { data: [], meta: { per_page: perPage, has_more: false } };
    })
    : { data: [], meta: { per_page: perPage, has_more: false } };

  const posts = feedCollectionRows(feedResult).map(normalizeFeedPost).filter(isRenderableFeedPost);
  await Promise.all(posts.map(async (post) => {
    post.isCommentable = COMMENTABLE_FEED_TYPES.has(post.type);
    post.comments = post.isCommentable
      ? feedCommentRows(await getComments(token, { target_type: post.type, target_id: post.id }).catch(() => ({ data: { comments: [] } })))
      : [];
  }));
  const currentUserId = token
    ? profileId(await getRequestProfile(req, token).catch(() => null))
    : null;
  for (const post of posts) {
    post.isOwn = post.type === 'post' && currentUserId !== null && post.authorId === currentUserId;
  }
  const meta = collectionMeta(feedResult);
  const tenant = req.accessibleRouting?.tenant || res.locals.tenant || {};
  const status = trimmed(req.query.status);
  const statusMessage = withFeedRefusal(req, feedIndexStatusMessage(status, req.t || res.locals.t));

  res.render('feed/index', {
    title: res.locals.t('govuk_alpha.feed.title'),
    posts,
    currentUserId,
    typeOptions,
    selectedType,
    selectedMode,
    selectedSubtype,
    cursor,
    status,
    postErrorMessage: COMPOSER_ERROR_FIELDS[status] && statusMessage
      ? statusMessage.text
      : '',
    postErrorField: COMPOSER_ERROR_FIELDS[status] || '',
    // What the member had just typed into the composer, if the post failed. Consumed
    // once, so a later clean visit to the feed shows an empty composer.
    postForm: consumeFormReplay(req, 'feedPost', 'composer'),
    perPage,
    requiresAuth: !token,
    listingsEnabled: flagEnabled(tenant, 'listings', 'modules', true),
    communityName: res.locals.tenantName || res.locals.serviceName || 'this community',
    nextHref: feedNextHref(meta, perPage, selectedType, selectedMode, selectedSubtype, authorFilter),
    csrfToken: req.csrfToken ? req.csrfToken() : '',
    statusMessage,
    feedLoadError: feedErrorMessage
  });
})));

module.exports = router;
