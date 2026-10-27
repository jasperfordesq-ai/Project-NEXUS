// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Group Q&A — ask, answer, vote, accept (React pages/groups/api/qa.ts and
 * tabs/GroupQATab.tsx). Section rule `qa`: the community's `tab_qa` switch, and
 * an active member or group admin. Accepting an answer is offered to the
 * question's author or a group admin, as on the website; the API makes the same
 * decision (GroupQAService::acceptAnswer).
 */

const express = require('express');
const { callGroupApi, ApiError } = require('../lib/api');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute } = require('../lib/routeHelpers');
const { requireGroupTool } = require('../lib/group-tool-access');
const {
  NS, text, positiveInteger, dataFrom, objectFrom, isAuthError,
  redirectWithStatus, loginRedirect, translator, statusBanner, dateTimeLabel
} = require('../lib/group-tool-helpers');

const router = express.Router();

const SORTS = ['newest', 'most_voted', 'unanswered'];
const STATUS_CODES = {
  'question-asked': { type: 'success', key: 'qa.question_asked_success' },
  'answer-posted': { type: 'success', key: 'qa.answer_posted_success' },
  accepted: { type: 'success', key: 'qa.accept_success' },
  voted: { type: 'success', key: 'qa.vote_success' },
  'answer-required': { type: 'error', key: 'qa.answer_required', field: 'body' },
  'answer-failed': { type: 'error', key: 'qa.answer_error' },
  'vote-failed': { type: 'error', key: 'qa.vote_error' },
  'accept-failed': { type: 'error', key: 'qa.accept_error' }
};

function qaPath(id, questionId = null) {
  return questionId ? `/groups/${id}/qa/${questionId}` : `/groups/${id}/qa`;
}

function normalizeAuthor(author) {
  const raw = author && typeof author === 'object' ? author : {};
  return { id: positiveInteger(raw.id), name: text(raw.name) };
}

function normalizeQuestion(item) {
  const raw = item && typeof item === 'object' ? item : {};
  return {
    id: positiveInteger(raw.id),
    title: text(raw.title),
    body: text(raw.body),
    voteCount: Number(raw.vote_count) || 0,
    userVote: Number(raw.user_vote) || 0,
    answerCount: Number(raw.answer_count) || 0,
    hasAcceptedAnswer: raw.has_accepted_answer === true || raw.has_accepted_answer === 1,
    author: normalizeAuthor(raw.author),
    createdAtLabel: dateTimeLabel(raw.created_at)
  };
}

function normalizeAnswer(item) {
  const raw = item && typeof item === 'object' ? item : {};
  return {
    id: positiveInteger(raw.id),
    body: text(raw.body),
    voteCount: Number(raw.vote_count) || 0,
    userVote: Number(raw.user_vote) || 0,
    isAccepted: raw.is_accepted === true || raw.is_accepted === 1,
    author: normalizeAuthor(raw.author),
    createdAtLabel: dateTimeLabel(raw.created_at)
  };
}

function refused(error) {
  return error instanceof ApiError && [403, 404].includes(error.status);
}

router.get('/:id(\\d+)/qa', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupTool(req, res, 'qa');
  if (!access) return undefined;
  const { group } = access;

  const sort = SORTS.includes(text(req.query.sort)) ? text(req.query.sort) : 'newest';
  const query = text(req.query.q, 200);
  const cursor = text(req.query.cursor, 500);
  const params = new URLSearchParams({ sort, per_page: '20' });
  if (cursor) params.set('cursor', cursor);
  if (query) params.set('q', query);

  let loadFailed = false;
  const result = await callGroupApi(req.token, 'GET', `/${encodeURIComponent(group.id)}/questions?${params.toString()}`).catch((error) => {
    if (isAuthError(error) || refused(error)) throw error;
    loadFailed = true;
    return { data: { items: [] } };
  });
  const page = objectFrom(result);
  const questions = (Array.isArray(page.items) ? page.items : [])
    .map(normalizeQuestion)
    .filter((question) => question.id !== null);

  const nextParams = new URLSearchParams({ sort });
  if (query) nextParams.set('q', query);
  const nextCursor = page.has_more === true && typeof page.cursor === 'string' && page.cursor ? page.cursor : '';
  if (nextCursor) nextParams.set('cursor', nextCursor);

  const t = translator(res);
  return res.render('groups/qa/index', {
    title: t(`${NS}.qa.title`),
    activeNav: 'explore',
    group,
    questions,
    sort,
    query,
    isPaged: Boolean(cursor),
    nextPageHref: nextCursor ? `${qaPath(group.id)}?${nextParams.toString()}` : '',
    firstPageHref: `${qaPath(group.id)}?${new URLSearchParams(query ? { sort, q: query } : { sort }).toString()}`,
    loadFailed,
    sortOptions: SORTS.map((value) => ({ value, text: t(`${NS}.qa.sort_${value}`), selected: value === sort })),
    statusBanner: statusBanner(res, req.query.status, STATUS_CODES)
  });
}, { redirectOn401: '/login?status=auth-required', notFoundTitle: 'Group not found' }));

function renderAsk(res, group, values = {}, errors = {}, statusCode = 200, failed = false) {
  const t = translator(res);
  return res.status(statusCode).render('groups/qa/ask', {
    title: t(`${NS}.qa.ask_title`),
    activeNav: 'explore',
    group,
    values,
    errors,
    errorList: Object.entries(errors).map(([field, message]) => ({ text: message, href: `#${field}` })),
    statusBanner: failed ? { type: 'error', message: t(`${NS}.qa.ask_error`) } : null
  });
}

router.get('/:id(\\d+)/qa/ask', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupTool(req, res, 'qa');
  if (!access) return undefined;
  return renderAsk(res, access.group);
}, { redirectOn401: '/login?status=auth-required', notFoundTitle: 'Group not found' }));

router.post('/:id(\\d+)/qa/ask', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupTool(req, res, 'qa');
  if (!access) return undefined;
  const { group } = access;
  const t = translator(res);
  const values = { title: text(req.body.title, 255), body: text(req.body.body, 10000) };
  const errors = {};
  if (!values.title) errors.title = t(`${NS}.qa.title_required`);
  if (!values.body) errors.body = t(`${NS}.qa.body_required`);
  if (Object.keys(errors).length) return renderAsk(res, group, values, errors, 422);

  try {
    const result = await callGroupApi(req.token, 'POST', `/${encodeURIComponent(group.id)}/questions`, values);
    const created = dataFrom(result) || {};
    const questionId = positiveInteger(created.id);
    return redirectWithStatus(res, questionId ? qaPath(group.id, questionId) : qaPath(group.id), 'question-asked');
  } catch (error) {
    if (isAuthError(error)) return loginRedirect(res);
    const serverErrors = {};
    if (error instanceof ApiError && error.status === 422 && Array.isArray(error.data?.errors)) {
      for (const entry of error.data.errors) {
        const field = text(entry?.field);
        if ((field === 'title' || field === 'body') && text(entry?.message)) serverErrors[field] = text(entry.message);
      }
    }
    return renderAsk(res, group, values, serverErrors, Object.keys(serverErrors).length ? 422 : 200, !Object.keys(serverErrors).length);
  }
}, { redirectOn401: '/login?status=auth-required', notFoundTitle: 'Group not found' }));

router.get('/:id(\\d+)/qa/:questionId(\\d+)', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupTool(req, res, 'qa');
  if (!access) return undefined;
  const { group, isAdmin, profile } = access;

  const result = await callGroupApi(req.token, 'GET', `/${encodeURIComponent(group.id)}/questions/${encodeURIComponent(req.params.questionId)}`);
  const data = objectFrom(result);
  const question = normalizeQuestion(data);
  if (question.id === null) {
    return res.status(404).render('errors/404', { title: translator(res)('govuk_alpha.error_pages.404_title') });
  }
  const answers = (Array.isArray(data.answers) ? data.answers : [])
    .map(normalizeAnswer)
    .filter((answer) => answer.id !== null);
  const viewerId = positiveInteger(profile?.id);
  const canAccept = isAdmin || (viewerId !== null && viewerId === question.author.id);

  return res.render('groups/qa/question', {
    title: question.title,
    activeNav: 'explore',
    group,
    question,
    answers,
    canAccept,
    statusBanner: statusBanner(res, req.query.status, STATUS_CODES)
  });
}, { redirectOn401: '/login?status=auth-required', notFoundTitle: 'Question not found' }));

router.post('/:id(\\d+)/qa/:questionId(\\d+)/answers', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupTool(req, res, 'qa');
  if (!access) return undefined;
  const { group } = access;
  const questionId = req.params.questionId;
  const body = text(req.body.body, 10000);
  if (!body) return redirectWithStatus(res, qaPath(group.id, questionId), 'answer-required', '#answer-form');

  try {
    await callGroupApi(req.token, 'POST', `/${encodeURIComponent(group.id)}/questions/${encodeURIComponent(questionId)}/answers`, { body });
    return redirectWithStatus(res, qaPath(group.id, questionId), 'answer-posted', '#answers');
  } catch (error) {
    if (isAuthError(error)) return loginRedirect(res);
    return redirectWithStatus(res, qaPath(group.id, questionId), 'answer-failed', '#answer-form');
  }
}, { redirectOn401: '/login?status=auth-required', notFoundTitle: 'Question not found' }));

router.post('/:id(\\d+)/qa/:questionId(\\d+)/vote', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupTool(req, res, 'qa');
  if (!access) return undefined;
  const { group } = access;
  const questionId = req.params.questionId;
  const type = text(req.body.type);
  const targetId = positiveInteger(req.body.target_id);
  const vote = Number(text(req.body.vote));
  if (!['question', 'answer'].includes(type) || targetId === null || ![1, -1].includes(vote)) {
    return redirectWithStatus(res, qaPath(group.id, questionId), 'vote-failed');
  }

  try {
    await callGroupApi(req.token, 'POST', `/${encodeURIComponent(group.id)}/qa/vote`, { type, target_id: targetId, vote });
    return redirectWithStatus(res, qaPath(group.id, questionId), 'voted');
  } catch (error) {
    if (isAuthError(error)) return loginRedirect(res);
    return redirectWithStatus(res, qaPath(group.id, questionId), 'vote-failed');
  }
}, { redirectOn401: '/login?status=auth-required', notFoundTitle: 'Question not found' }));

router.post('/:id(\\d+)/qa/:questionId(\\d+)/answers/:answerId(\\d+)/accept', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupTool(req, res, 'qa');
  if (!access) return undefined;
  const { group } = access;
  const { questionId, answerId } = req.params;

  try {
    await callGroupApi(req.token, 'POST', `/${encodeURIComponent(group.id)}/answers/${encodeURIComponent(answerId)}/accept`);
    return redirectWithStatus(res, qaPath(group.id, questionId), 'accepted');
  } catch (error) {
    if (isAuthError(error)) return loginRedirect(res);
    return redirectWithStatus(res, qaPath(group.id, questionId), 'accept-failed');
  }
}, { redirectOn401: '/login?status=auth-required', notFoundTitle: 'Question not found' }));

module.exports = router;
