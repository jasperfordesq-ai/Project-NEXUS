// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const {
  getFeedPosts,
  getFeedPostV2,
  getFeedItemV2,
  getFeedHashtags,
  getFeedHashtagPosts,
  getComments,
  ApiError
} = require('../lib/api');
const { withTokenRefresh } = require('../middleware/auth');
const { asyncRoute } = require('../lib/routeHelpers');
const { getRequestProfile } = require('../lib/request-profile');
const { flagEnabled, resolveBackendAssetUrl } = require('../lib/accessible-shell');

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
      postCount,
      postCountLabel: postCount === 0 ? 'No posts' : `${postCount} post${postCount === 1 ? '' : 's'}`
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

function pluralLabel(count, singular, plural = `${singular}s`, zero = `0 ${plural}`) {
  if (count === 0) return zero;
  if (count === 1) return `1 ${singular}`;
  return `${count} ${plural}`;
}

function plainParagraphs(value) {
  const text = String(value || '')
    .replace(/<\/p>\s*<p[^>]*>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .trim();

  if (!text) return [];
  return text.split(/\n{2,}/).map((paragraph) => paragraph.trim()).filter(Boolean);
}

function feedMedia(row) {
  const media = Array.isArray(row && row.media) ? row.media : [];
  const rows = media.length > 0
    ? media
    : (row && row.image_url ? [{ file_url: row.image_url, thumbnail_url: row.image_url, alt_text: null }] : []);

  return rows.slice(0, 4).map((item) => {
    const fileUrl = trimmed(item && (item.file_url || item.url));
    const thumbnailUrl = trimmed(item && (item.thumbnail_url || item.thumbnailUrl || fileUrl));
    return {
      fileUrl,
      thumbnailUrl,
      altText: trimmed(item && (item.alt_text || item.altText), 500)
    };
  }).filter((item) => item.fileUrl);
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
  const deepLink = feedItemDeepLink(type, id);
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
    authorAvatar: trimmed(author.avatar_url || row && row.author_avatar_url),
    createdAt: trimmed(row && (row.created_at || row.createdAt)),
    content: contentParagraphs.join('\n\n'),
    contentParagraphs,
    media: feedMedia(row),
    mediaExtra: Math.max(0, rawMedia.length - 4),
    group: row && row.group,
    isPinned: !!(row && (row.is_pinned || row.isPinned)),
    likeCount,
    commentCount,
    likeLabel: pluralLabel(likeCount, 'like'),
    commentLabel: pluralLabel(commentCount, 'comment'),
    isLiked: !!(row && (row.is_liked || row.isLiked)),
    reactionCounts,
    reactionTotal,
    userReaction,
    isShared: !!(row && (row.is_shared || row.isShared)),
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
    job: 'Job'
  };
  return labels[type] || 'Activity';
}

function feedItemDeepLink(type, id) {
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
        avatarAssetUrl: resolveBackendAssetUrl(author.avatar || author.avatar_url || author.avatarUrl)
      },
      replies: Array.isArray(source.replies) ? source.replies.map(project) : []
    };
  };
  return rows.map(project);
}

function feedNextHref(meta, perPage, selectedType, selectedMode, selectedSubtype) {
  const cursor = trimmed(meta && meta.cursor, 500);
  if (!meta || meta.has_more !== true || cursor === '') return '';

  const query = new URLSearchParams({
    type: selectedType,
    cursor,
    per_page: String(perPage)
  });
  if (selectedMode === 'recent') query.set('mode', 'recent');
  if (selectedSubtype) query.set('subtype', selectedSubtype);
  return `/feed?${query.toString()}`;
}

function feedIndexStatusMessage(status, t) {
  const keys = {
    'post-created': 'states.post-created',
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
    'not-interested-failed': 'govuk_alpha_feed.states.not_interested_failed'
  };
  const errorStatuses = new Set([
    'post-empty', 'post-failed', 'post-update-failed', 'post-delete-failed',
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
    title: 'Hashtags',
    activeNav: 'feed',
    alphaActiveNav: 'feed',
    communityName: res.locals.tenantName || res.locals.serviceName || 'this community',
    hashtags,
    searchQuery,
    isSearching,
    errorMessage
  });
}));

router.get('/posts/:id(\\d+)', asyncRoute(async (req, res) => {
  const id = positiveInteger(req.params.id, 0, 1, Number.MAX_SAFE_INTEGER);
  const token = tokenFrom(req);
  let itemUnavailable = false;
  let item;
  try {
    const result = await getFeedPostV2(token, id);
    item = normalizeFeedPost(dataFrom(result));
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

  res.render('feed/post', {
    title: 'Post',
    activeNav: 'feed',
    alphaActiveNav: 'feed',
    communityName: res.locals.tenantName || res.locals.serviceName || 'this community',
    item,
    itemUnavailable,
    comments,
    currentUserId,
    requiresAuth: !token,
    statusMessage: feedIndexStatusMessage(trimmed(req.query.status), req.t || res.locals.t),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}, { notFoundTitle: 'Post not found' }));

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
    title: item.title || item.typeLabel,
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

  try {
    const result = await getFeedHashtagPosts(tokenFrom(req), tag, query);
    const meta = collectionMeta(result);
    items = feedCollectionRows(result).map(normalizeFeedPost).filter((item) => item.id > 0);
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
    statusMessage: feedItemStatusMessage(trimmed(req.query.status), req.t || res.locals.t),
    errorMessage,
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

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
  const feedParams = {
    per_page: perPage,
    type: selectedType,
    mode: selectedMode === 'recent' ? 'recent' : 'ranked'
  };
  if (selectedSubtype) feedParams.subtype = selectedSubtype;
  if (cursor) feedParams.cursor = cursor;
  let feedErrorMessage = null;

  const feedResult = token
    ? await getFeedPosts(token, feedParams).catch((error) => {
      if (error instanceof ApiError && error.status === 401) throw error;
      feedErrorMessage = (req.t || res.locals.t)('feed.error_detail');
      return { data: [], meta: { per_page: perPage, has_more: false } };
    })
    : { data: [], meta: { per_page: perPage, has_more: false } };

  const posts = feedCollectionRows(feedResult).map(normalizeFeedPost).filter((post) => post.id > 0);
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
  const statusMessage = feedIndexStatusMessage(status, req.t || res.locals.t);

  res.render('feed/index', {
    title: 'Feed',
    posts,
    currentUserId,
    typeOptions,
    selectedType,
    selectedMode,
    selectedSubtype,
    cursor,
    status,
    postErrorMessage: ['post-empty', 'post-failed'].includes(status) && statusMessage
      ? statusMessage.text
      : '',
    perPage,
    requiresAuth: !token,
    listingsEnabled: flagEnabled(tenant, 'listings', 'modules', true),
    communityName: res.locals.tenantName || res.locals.serviceName || 'this community',
    nextHref: feedNextHref(meta, perPage, selectedType, selectedMode, selectedSubtype),
    csrfToken: req.csrfToken ? req.csrfToken() : '',
    statusMessage,
    feedLoadError: feedErrorMessage
  });
})));

module.exports = router;
