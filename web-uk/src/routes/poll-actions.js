// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const {
  getPolls,
  getPoll,
  getPollCategories,
  getPollRankedResults,
  getPollExport,
  getFeedItemV2,
  getComments,
  createPoll,
  deletePoll,
  votePoll,
  rankPoll,
  createComment,
  toggleFeedLike,
  ApiError
} = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');

const router = express.Router();
const POLLS_PATH = '/polls';
const LOGIN_AUTH_REQUIRED_PATH = '/login?status=auth-required';

function redirectTo(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(urlFor(pathname));
}

function tokenFrom(req) {
  return (req.signedCookies && req.signedCookies.token) || '';
}

function trimmed(value, limit = null) {
  const text = String(value || '').trim();
  return limit === null ? text : text.slice(0, limit);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function valuesFrom(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  if (value === undefined || value === null) return [];
  return [value];
}

function booleanFrom(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

function isAuthError(error) {
  return error instanceof ApiError && error.status === 401;
}

function redirectAuthIfNeeded(error, res) {
  if (isAuthError(error)) {
    redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
    return true;
  }
  return false;
}

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined
    ? result.data
    : result;
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asList(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeOption(option) {
  const item = asObject(option);
  return {
    id: positiveInteger(item.id),
    text: trimmed(item.text || item.label || item.title || item.option_text),
    voteCount: positiveInteger(item.vote_count || item.voteCount) || 0,
    percentage: Number.isFinite(Number(item.percentage)) ? Number(item.percentage) : 0
  };
}

function normalizePoll(rawPoll, t = null) {
  const poll = asObject(rawPoll);
  const creator = asObject(poll.creator || poll.user);
  const isOpen = poll.status
    ? trimmed(poll.status) === 'open'
    : Boolean(poll.is_active || poll.isActive);

  return {
    id: positiveInteger(poll.id),
    question: trimmed(poll.question || poll.title),
    description: trimmed(poll.description || poll.summary),
    status: isOpen ? 'open' : 'closed',
    pollType: trimmed(poll.poll_type || poll.pollType) || 'standard',
    category: trimmed(poll.category),
    creator: {
      id: positiveInteger(creator.id || poll.user_id),
      name: trimmed(creator.name || poll.creator_name || [creator.first_name, creator.last_name].filter(Boolean).join(' '))
        || (t ? t('members.unknown_member') : 'Community member')
    },
    createdAt: trimmed(poll.created_at || poll.createdAt),
    expiresAt: trimmed(poll.expires_at || poll.end_date || poll.expiresAt),
    hasVoted: Boolean(poll.has_voted || poll.hasVoted),
    votedOptionId: positiveInteger(poll.voted_option_id || poll.user_vote_option_id || poll.votedOptionId),
    totalVotes: positiveInteger(poll.total_votes || poll.totalVotes) || 0,
    resultsVisible: Boolean(poll.results_visible || poll.resultsVisible),
    isCreator: Boolean(poll.is_creator || poll.isCreator),
    isAnonymous: Boolean(poll.is_anonymous || poll.isAnonymous),
    likeCount: positiveInteger(poll.like_count || poll.likes_count || poll.likeCount) || 0,
    hasLiked: Boolean(poll.has_liked || poll.hasLiked),
    options: asList(poll.options).map(normalizeOption).filter((option) => option.id !== null && option.text)
  };
}

function normalizeComment(comment) {
  const item = asObject(comment);
  const user = asObject(item.user || item.author);
  return {
    id: positiveInteger(item.id),
    content: trimmed(item.content || item.body),
    createdAt: trimmed(item.created_at || item.createdAt),
    user: {
      id: positiveInteger(user.id || item.user_id),
      name: trimmed(user.name || item.user_name || [user.first_name, user.last_name].filter(Boolean).join(' ')) || 'Community member'
    },
    replies: asList(item.replies || item.children).map(normalizeComment)
  };
}

function commentCount(comments) {
  return comments.reduce((count, comment) => count + 1 + commentCount(comment.replies || []), 0);
}

function categoriesFrom(result) {
  return asList(dataFrom(result))
    .map((category) => trimmed(category))
    .filter(Boolean);
}

function rankedResultRows(result, t) {
  const payload = asObject(dataFrom(result));
  const rankedResults = asObject(payload.ranked_results || payload.rankedResults);
  const rows = asList(rankedResults.results).map((row) => {
    const item = asObject(row);
    return {
      optionId: positiveInteger(item.option_id || item.optionId || item.id),
      text: trimmed(item.text || item.label || item.title) || t('govuk_alpha_gamification.common.unknown_member'),
      votes: positiveInteger(item.votes || item.vote_count || item.voteCount) || 0
    };
  });
  return {
    poll: normalizePoll(payload.poll, t),
    rankedResults: {
      totalVoters: positiveInteger(rankedResults.total_voters || rankedResults.totalVoters) || 0,
      rows,
      maxVotes: rows.reduce((maximum, row) => Math.max(maximum, row.votes), 0)
    },
    myRankings: asList(payload.my_rankings || payload.myRankings)
  };
}

function requirePollAuth(req, res) {
  const token = tokenFrom(req);
  if (!token) {
    redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
    return '';
  }
  return token;
}

function pollStatusBanner(status, t) {
  const banners = {
    voted: { type: 'success', message: t('polls.states.voted') },
    'vote-failed': { type: 'error', message: t('polls.states.vote-failed') },
    'poll-created': { type: 'success', message: t('polish_discovery.polls_create_success') },
    'poll-create-failed': { type: 'error', message: t('polish_discovery.polls_create_failed') },
    'poll-deleted': { type: 'success', message: t('polls.states.deleted') },
    'poll-delete-failed': { type: 'error', message: t('polls.states.delete-failed') },
    ranked: { type: 'success', message: t('govuk_alpha_gamification.ranked.states.ranked') },
    'rank-failed': { type: 'error', message: t('govuk_alpha_gamification.ranked.states.rank-failed') },
    'poll-liked': { type: 'success', message: t('govuk_alpha_gamification.poll_detail.states.poll-liked') },
    'poll-unliked': { type: 'success', message: t('govuk_alpha_gamification.poll_detail.states.poll-unliked') },
    'poll-like-failed': { type: 'error', message: t('govuk_alpha_gamification.poll_detail.states.poll-like-failed') },
    'poll-comment-created': { type: 'success', message: t('govuk_alpha_gamification.poll_detail.states.poll-comment-created') },
    'poll-comment-empty': { type: 'error', message: t('govuk_alpha_gamification.poll_detail.states.poll-comment-empty') },
    'poll-comment-too-long': { type: 'error', message: t('govuk_alpha_gamification.poll_detail.states.poll-comment-too-long') },
    'poll-comment-failed': { type: 'error', message: t('govuk_alpha_gamification.poll_detail.states.poll-comment-failed') }
  };
  return banners[trimmed(status)] || null;
}

function pollRedirect(status, id = null) {
  const suffix = id === null ? '' : `#poll-${id}`;
  return `${POLLS_PATH}?status=${encodeURIComponent(status)}${suffix}`;
}

function pollCreateStatusBanner(status, t) {
  const banners = {
    'poll-created': { type: 'success', message: t('govuk_alpha_gamification.poll_create.states.poll-created') },
    'poll-create-failed': { type: 'error', message: t('govuk_alpha_gamification.poll_create.states.poll-create-failed') }
  };
  return banners[trimmed(status)] || null;
}

function pollManageStatusBanner(status, t) {
  const banners = {
    'poll-deleted': { type: 'success', message: t('govuk_alpha_gamification.poll_manage.states.poll-deleted') },
    'poll-delete-failed': { type: 'error', message: t('govuk_alpha_gamification.poll_manage.states.poll-delete-failed') }
  };
  return banners[trimmed(status)] || null;
}

function tomorrowDate() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().slice(0, 10);
}

function pollDetailRedirect(id, status, fragment) {
  const suffix = fragment ? `#${fragment}` : '';
  return `${POLLS_PATH}/${encodeURIComponent(id)}?status=${encodeURIComponent(status)}${suffix}`;
}

function rankRedirect(id, status) {
  return `${POLLS_PATH}/${encodeURIComponent(id)}/rank?status=${encodeURIComponent(status)}`;
}

function createPollRedirect(status, parity = false) {
  return parity
    ? `${POLLS_PATH}/parity/create?status=${encodeURIComponent(status)}`
    : pollRedirect(status);
}

function pollOptionsFrom(body) {
  return valuesFrom(body.options !== undefined ? body.options : body['options[]'])
    .map((option) => trimmed(option, 500))
    .filter(Boolean)
    .slice(0, 20);
}

function pollTypeFrom(value, allowed) {
  const type = trimmed(value).toLowerCase();
  return allowed.has(type) ? type : 'standard';
}

function pollPayloadFrom(body, { parity = false } = {}) {
  const allowedTypes = parity
    ? new Set(['standard', 'ranked'])
    : new Set(['standard', 'multiple']);
  const payload = {
    question: trimmed(body.question, 500),
    poll_type: pollTypeFrom(body.poll_type, allowedTypes),
    options: pollOptionsFrom(body)
  };

  const description = trimmed(body.description, 5000);
  const expiresAt = trimmed(body.expires_at);
  const category = trimmed(body.category, 120);
  if (description) payload.description = description;
  if (expiresAt) payload.expires_at = expiresAt;
  if (parity && category) payload.category = category;
  if (!parity) payload.is_anonymous = booleanFrom(body.is_anonymous);

  return payload;
}

function isValidPollPayload(payload) {
  return payload.question !== '' && Array.isArray(payload.options) && payload.options.length >= 2;
}

function parseJsonMaybe(value) {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function rankingFromEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const optionId = positiveInteger(entry.option_id || entry.optionId || entry.id);
  const rank = positiveInteger(entry.rank || entry.position || entry.order);
  return optionId !== null && rank !== null ? { option_id: optionId, rank } : null;
}

function rankingsFromRankMap(rankMap) {
  if (!rankMap || typeof rankMap !== 'object' || Array.isArray(rankMap)) return [];

  return Object.entries(rankMap)
    .map(([optionId, rank]) => {
      const parsedOptionId = positiveInteger(optionId);
      const parsedRank = positiveInteger(rank);
      return parsedOptionId !== null && parsedRank !== null
        ? { option_id: parsedOptionId, rank: parsedRank }
        : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.rank - right.rank);
}

function rankingsFromRawForm(rawBody) {
  if (typeof rawBody !== 'string' || rawBody === '') return [];

  return Array.from(new URLSearchParams(rawBody).entries())
    .map(([key, value]) => {
      const match = key.match(/^rank\[(\d+)\]$/);
      if (!match) return null;
      const optionId = positiveInteger(match[1]);
      const rank = positiveInteger(value);
      return optionId !== null && rank !== null ? { option_id: optionId, rank } : null;
    })
    .filter(Boolean)
    .sort((left, right) => left.rank - right.rank);
}

function rankingsFrom(body, rawBody = '') {
  const rawRows = rankingsFromRawForm(rawBody);
  if (rawRows.length > 0) return rawRows;

  const rankRows = rankingsFromRankMap(body.rank);
  if (rankRows.length > 0) return rankRows;

  const rawRankings = parseJsonMaybe(body.rankings);
  return valuesFrom(rawRankings)
    .map(rankingFromEntry)
    .filter(Boolean)
    .sort((left, right) => left.rank - right.rank);
}

function likeStatusFrom(result) {
  const data = dataFrom(result);
  return data && data.action === 'unliked' ? 'poll-unliked' : 'poll-liked';
}

router.get('/parity/create', asyncRoute(async (req, res) => {
  const token = requirePollAuth(req, res);
  if (!token) return undefined;

  const categories = categoriesFrom(await getPollCategories(token));
  return res.render('polls/create', {
    title: res.locals.t('govuk_alpha_gamification.poll_create.title'),
    activeNav: 'explore',
    categories,
    minDate: tomorrowDate(),
    statusBanner: pollCreateStatusBanner(req.query && req.query.status, res.locals.t)
  });
}));

router.get('/parity/manage', asyncRoute(async (req, res) => {
  const token = requirePollAuth(req, res);
  if (!token) return undefined;

  const result = await getPolls(token, { mine: true, per_page: 30 });
  const polls = asList(dataFrom(result)).map((poll) => normalizePoll(poll, res.locals.t));
  return res.render('polls/manage', {
    title: res.locals.t('govuk_alpha_gamification.poll_manage.title'),
    activeNav: 'explore',
    polls,
    statusBanner: pollManageStatusBanner(req.query && req.query.status, res.locals.t)
  });
}));

router.get('/:id(\\d+)/rank', asyncRoute(async (req, res) => {
  const token = requirePollAuth(req, res);
  if (!token) return undefined;

  const id = Number(req.params.id);
  const ranked = rankedResultRows(await getPollRankedResults(token, id), res.locals.t);
  return res.render('polls/rank', {
    title: ranked.poll.question || res.locals.t('govuk_alpha_gamification.ranked.title'),
    activeNav: 'explore',
    poll: ranked.poll,
    rankedResults: ranked.rankedResults,
    myRankings: ranked.myRankings,
    statusBanner: pollStatusBanner(req.query && req.query.status, res.locals.t)
  });
}, { notFoundTitle: 'Poll not found' }));

router.get('/:id(\\d+)/export', asyncRoute(async (req, res) => {
  const token = requirePollAuth(req, res);
  if (!token) return undefined;

  const id = Number(req.params.id);
  const result = await getPollExport(token, id);
  const contentType = result.headers['content-type'] || 'text/csv; charset=utf-8';
  const disposition = result.headers['content-disposition'] || `attachment; filename="poll-${id}-export.csv"`;
  res.status(result.status || 200);
  res.type(contentType);
  res.set('Content-Disposition', disposition);
  return res.send(result.body);
}));

router.get('/:id(\\d+)', asyncRoute(async (req, res) => {
  const token = requirePollAuth(req, res);
  if (!token) return undefined;

  const id = Number(req.params.id);
  const [pollResult, feedItemResult] = await Promise.all([
    getPoll(token, id),
    Promise.resolve(getFeedItemV2(token, 'poll', id)).catch(() => null)
  ]);
  const pollData = asObject(dataFrom(pollResult));
  const feedItem = asObject(dataFrom(feedItemResult));
  const poll = normalizePoll({
    ...pollData,
    like_count: feedItem.likes_count ?? pollData.like_count ?? pollData.likes_count,
    has_liked: feedItem.is_liked === undefined
      ? pollData.has_liked ?? pollData.hasLiked
      : booleanFrom(feedItem.is_liked)
  }, res.locals.t);
  let comments = [];
  let commentsTotal = 0;
  if (poll.id !== null) {
    const commentsResult = await getComments(token, { target_type: 'poll', target_id: poll.id });
    const commentsData = asObject(dataFrom(commentsResult));
    comments = asList(commentsData.comments || dataFrom(commentsResult)).map(normalizeComment);
    commentsTotal = positiveInteger(commentsData.count) || commentCount(comments);
  }

  return res.render('polls/detail', {
    title: poll.question || 'Poll',
    activeNav: 'explore',
    poll,
    comments,
    commentsTotal,
    statusBanner: pollStatusBanner(req.query && req.query.status, res.locals.t)
  });
}, { notFoundTitle: 'Poll not found' }));

router.get('/', asyncRoute(async (req, res) => {
  const token = requirePollAuth(req, res);
  if (!token) return undefined;

  const mine = String((req.query && req.query.mine) || '') === '1';
  const category = trimmed(req.query && req.query.category);
  const params = { per_page: 30 };
  if (mine) params.mine = true;
  if (category) params.category = category;

  const [pollsResult, categoriesResult] = await Promise.all([
    getPolls(token, params),
    getPollCategories(token)
  ]);
  const polls = asList(dataFrom(pollsResult)).map((poll) => normalizePoll(poll, res.locals.t));
  const categories = categoriesFrom(categoriesResult);

  return res.render('polls/index', {
    title: 'Polls',
    titleKey: 'polls.title',
    activeNav: 'explore',
    polls,
    categories,
    pollsMine: mine,
    pollsCategory: category,
    statusBanner: pollStatusBanner(req.query && req.query.status, res.locals.t)
  });
}));

async function storePoll(req, res, { parity = false } = {}) {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
  }

  const payload = pollPayloadFrom(req.body, { parity });
  if (!isValidPollPayload(payload)) {
    return redirectTo(res, createPollRedirect('poll-create-failed', parity));
  }

  let status = 'poll-created';
  try {
    await createPoll(token, payload);
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
    status = 'poll-create-failed';
  }

  return redirectTo(res, createPollRedirect(status, parity));
}

router.post('/parity/create', asyncRoute(async (req, res) => (
  storePoll(req, res, { parity: true })
)));

router.post('/', asyncRoute(async (req, res) => (
  storePoll(req, res)
)));

router.post('/:id(\\d+)/vote', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  if (!token) {
    return redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
  }

  const optionId = positiveInteger(req.body.option_id);
  if (optionId === null) {
    return redirectTo(res, pollRedirect('vote-failed', id));
  }

  let status = 'voted';
  try {
    await votePoll(token, id, { option_id: optionId });
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
    status = 'vote-failed';
  }

  return redirectTo(res, pollRedirect(status, id));
}));

router.post('/:id(\\d+)/rank', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  if (!token) {
    return redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
  }

  const rankings = rankingsFrom(req.body, req.rawUrlencodedBody);
  if (rankings.length === 0) {
    return redirectTo(res, rankRedirect(id, 'rank-failed'));
  }

  let status = 'ranked';
  try {
    await rankPoll(token, id, { rankings });
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
    status = 'rank-failed';
  }

  return redirectTo(res, rankRedirect(id, status));
}));

router.post('/:id(\\d+)/delete', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  if (!token) {
    return redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
  }

  let status = 'poll-deleted';
  try {
    await deletePoll(token, id);
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
    status = 'poll-delete-failed';
  }

  return redirectTo(res, `${POLLS_PATH}/parity/manage?status=${encodeURIComponent(status)}`);
}));

router.post('/:id(\\d+)/like', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  if (!token) {
    return redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
  }

  let status = 'poll-like-failed';
  try {
    const result = await toggleFeedLike(token, {
      target_type: 'poll',
      target_id: id
    });
    status = likeStatusFrom(result);
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
    status = 'poll-like-failed';
  }

  return redirectTo(res, pollDetailRedirect(id, status, 'poll-social'));
}));

router.post('/:id(\\d+)/comment', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  const id = Number(req.params.id);
  if (!token) {
    return redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
  }

  const content = trimmed(req.body.content || req.body.body, 10000);
  const rawContent = String(req.body.content || req.body.body || '');
  const parentId = positiveInteger(req.body.parent_id);
  if (content === '') {
    return redirectTo(res, pollDetailRedirect(id, 'poll-comment-empty', 'poll-comments'));
  }
  if (rawContent.length > 10000) {
    return redirectTo(res, pollDetailRedirect(id, 'poll-comment-too-long', 'poll-comments'));
  }

  let status = 'poll-comment-created';
  try {
    await createComment(token, {
      target_type: 'poll',
      target_id: id,
      content,
      parent_id: parentId
    });
  } catch (error) {
    if (redirectAuthIfNeeded(error, res)) return undefined;
    status = 'poll-comment-failed';
  }

  return redirectTo(res, pollDetailRedirect(id, status, 'poll-comments'));
}));

module.exports = router;
