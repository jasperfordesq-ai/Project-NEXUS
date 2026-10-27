// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Group challenges: /groups/:id/challenges (parity with the website's
 * Challenges tab, react-frontend/src/pages/groups/tabs/GroupChallengesTab.tsx,
 * 27 Oct 2026).
 *
 * - GET  /groups/:id/challenges                    active challenges + history (?all=1, as React)
 * - GET  /groups/:id/challenges/new                create form (group admins)
 * - POST /groups/:id/challenges/new                create
 * - GET  /groups/:id/challenges/:challengeId/cancel confirmation page (group admins)
 * - POST /groups/:id/challenges/:challengeId/cancel cancel (DELETE in the API)
 *
 * Contract: GroupChallengeController. Create and cancel need a group manager
 * (GroupAccessService::canManage); the form mirrors GroupChallengeService's
 * rules (title 3–120, optional description 10–2000, metric posts/discussions/
 * members/files, target 1–1,000,000, reward 0/25/50/100, end date after now),
 * and the API remains the judge.
 */

const express = require('express');
const { callGroupApi, ApiError } = require('../lib/api');
const { requireAuth } = require('../middleware/auth');
const { asyncRoute } = require('../lib/routeHelpers');
const { readDate, splitDate } = require('../lib/date-input');
const { requireGroupSection, renderRefusal } = require('../lib/group-media-access');
const { getRequestIntlLocale } = require('../lib/request-intl-locale');
const {
  text,
  positiveInteger,
  dataFrom,
  redirectWithStatus,
  isAuthError,
  loginRedirect,
  apiErrorCode,
  apiErrorField,
  isSafeguardingRefusal,
  statusBanner,
  dateLabel
} = require('../lib/group-media-pages');

const router = express.Router();

const METRICS = ['posts', 'discussions', 'members', 'files'];
const REWARDS = [0, 25, 50, 100];
const STATUSES = new Set(['active', 'completed', 'expired', 'cancelled']);
const PAGE_OPTIONS = { redirectOn401: '/login?status=auth-required' };
const NS = 'govuk_alpha_group_media.challenges';

const SUCCESS_STATES = new Set(['created', 'cancelled']);
const ERROR_STATES = new Set(['create-failed', 'cancel-failed', 'cancel-conflict', 'limit', 'forbidden', 'safeguarding']);

/** API error field → [form field id, message key]. */
const API_FIELD_ERRORS = {
  title: ['title', 'errors.title_length'],
  description: ['description', 'errors.description_length'],
  metric: ['metric', 'errors.metric_required'],
  target_value: ['target_value', 'errors.target_invalid'],
  reward_xp: ['reward_xp', 'errors.reward_invalid'],
  ends_at: ['ends_at-day', 'errors.ends_past']
};

function wholeNumber(value) {
  const raw = text(value);
  return /^\d+$/.test(raw) ? Number(raw) : null;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function normalizeChallenge(raw, locale) {
  const item = raw && typeof raw === 'object' ? raw : {};
  const id = positiveInteger(item.id);
  if (id === null) return null;
  const target = Math.max(1, Number(item.target_value) || 1);
  const current = Math.min(target, Math.max(0, Number(item.current_value) || 0));
  const percent = Number.isFinite(Number(item.progress_percentage))
    ? Math.round(Number(item.progress_percentage))
    : Math.round((current / target) * 100);
  const status = STATUSES.has(text(item.status)) ? text(item.status) : 'active';
  const metric = METRICS.includes(text(item.metric)) ? text(item.metric) : '';
  const reward = Number(item.reward_xp) || 0;
  return {
    id,
    title: text(item.title),
    description: text(item.description),
    metric,
    current,
    target,
    percent: Math.min(100, Math.max(0, percent)),
    reward,
    status,
    endsLabel: dateLabel(item.ends_at, locale),
    completedLabel: dateLabel(item.completed_at, locale),
    creatorName: text(item.creator?.name)
  };
}

async function loadChallenges(token, groupId) {
  const locale = getRequestIntlLocale();
  const rows = dataFrom(await callGroupApi(token, 'GET', `/${encodeURIComponent(groupId)}/challenges?all=1`));
  return (Array.isArray(rows) ? rows : []).map((row) => normalizeChallenge(row, locale)).filter(Boolean);
}

function formValues(body = {}) {
  return {
    title: text(body.title, 200),
    description: text(body.description, 3000),
    metric: text(body.metric),
    target_value: text(body.target_value, 20),
    reward_xp: text(body.reward_xp, 10)
  };
}

/** The form's own checks, mirroring GroupChallengeService::normalizeCreateData. */
function validate(values, ends, t) {
  const errors = {};
  if (values.title === '') errors.title = t(`${NS}.errors.title_required`);
  else if (values.title.length < 3 || values.title.length > 120) errors.title = t(`${NS}.errors.title_length`);
  if (values.description !== '' && (values.description.length < 10 || values.description.length > 2000)) {
    errors.description = t(`${NS}.errors.description_length`);
  }
  if (!METRICS.includes(values.metric)) errors.metric = t(`${NS}.errors.metric_required`);
  const target = wholeNumber(values.target_value);
  if (target === null || target < 1 || target > 1000000) errors.target_value = t(`${NS}.errors.target_invalid`);
  const reward = wholeNumber(values.reward_xp);
  if (reward === null || !REWARDS.includes(reward)) errors.reward_xp = t(`${NS}.errors.reward_invalid`);

  let endsError = null;
  let endsErrorFields = [];
  if (!ends.value) {
    const allEmpty = ['day', 'month', 'year'].every((part) => !ends.parts?.[part]);
    endsError = allEmpty || !ends.error ? t(`${NS}.errors.ends_required`) : t(`web_uk.date_input.${ends.error}`);
    endsErrorFields = ends.errorFields && ends.errorFields.length ? ends.errorFields : ['day', 'month', 'year'];
  } else if (ends.value <= todayIso()) {
    endsError = t(`${NS}.errors.ends_past`);
    endsErrorFields = ['day', 'month', 'year'];
  }
  if (endsError) errors['ends_at-day'] = endsError;

  return { errors, endsErrorFields, target, reward };
}

function renderForm(res, group, values, endsParts, errors = {}, endsErrorFields = [], generalError = '') {
  const t = res.locals.t;
  const errorList = Object.entries(errors).map(([field, message]) => ({ text: message, href: `#${field}` }));
  if (generalError) errorList.unshift({ text: generalError });
  return res.status(errorList.length ? 422 : 200).render('groups/challenges/new', {
    title: t(`${NS}.new_title`),
    group,
    values,
    endsParts,
    fieldErrors: errors,
    errorList,
    hasErrors: errorList.length > 0,
    endsErrorFields,
    metricItems: METRICS.map((metric) => ({ value: metric, text: t(`${NS}.metric_${metric}`), checked: values.metric === metric })),
    rewardItems: REWARDS.map((reward) => ({
      value: String(reward),
      text: reward === 0 ? t(`${NS}.reward_none`) : t(`${NS}.reward_value`, { xp: reward }),
      checked: values.reward_xp === String(reward)
    }))
  });
}

function failureStatus(error, fallback) {
  if (!(error instanceof ApiError)) return fallback;
  if (isSafeguardingRefusal(error)) return 'safeguarding';
  if (error.status === 403) return 'forbidden';
  return fallback;
}

router.get('/:id(\\d+)/challenges', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupSection(req, res, 'challenges');
  if (!access) return undefined;
  const { group, isAdmin } = access;
  const t = res.locals.t;

  let challenges;
  try {
    challenges = await loadChallenges(req.token, group.id);
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) return renderRefusal(res, 403);
    throw error;
  }

  // React lists active challenges first, then the rest as history.
  const active = challenges.filter((challenge) => challenge.status === 'active');
  const history = challenges.filter((challenge) => challenge.status !== 'active');
  const banner = statusBanner(t, `${NS}.states`, req.query.status, SUCCESS_STATES, ERROR_STATES);

  return res.render('groups/challenges/index', {
    title: t(`${NS}.title`),
    group,
    isAdmin,
    active,
    history,
    hasAny: challenges.length > 0,
    statusBanner: banner,
    hasErrors: Boolean(banner && banner.type === 'error')
  });
}, PAGE_OPTIONS));

router.get('/:id(\\d+)/challenges/new', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupSection(req, res, 'challenges');
  if (!access) return undefined;
  if (!access.isAdmin) return renderRefusal(res, 403);
  return renderForm(res, access.group, formValues({ reward_xp: '0' }), splitDate(''));
}, PAGE_OPTIONS));

router.post('/:id(\\d+)/challenges/new', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupSection(req, res, 'challenges');
  if (!access) return undefined;
  const { group, isAdmin } = access;
  if (!isAdmin) return renderRefusal(res, 403);
  const t = res.locals.t;

  const values = formValues(req.body);
  const ends = readDate(req.body, 'ends_at');
  const endsParts = ends.parts || splitDate(ends.value || '');
  const { errors, endsErrorFields, target, reward } = validate(values, ends, t);
  if (Object.keys(errors).length > 0) {
    return renderForm(res, group, values, endsParts, errors, endsErrorFields);
  }

  try {
    await callGroupApi(req.token, 'POST', `/${encodeURIComponent(group.id)}/challenges`, {
      title: values.title,
      description: values.description,
      metric: values.metric,
      target_value: target,
      reward_xp: reward,
      ends_at: ends.value
    });
  } catch (error) {
    if (isAuthError(error)) return loginRedirect(res);
    if (error instanceof ApiError && apiErrorCode(error) === 'CHALLENGE_LIMIT_REACHED') {
      return renderForm(res, group, values, endsParts, {}, [], t(`${NS}.states.limit`));
    }
    const mapped = API_FIELD_ERRORS[apiErrorField(error)];
    if (error instanceof ApiError && error.status === 422 && mapped) {
      const [field, key] = mapped;
      return renderForm(res, group, values, endsParts, { [field]: t(`${NS}.${key}`) },
        field === 'ends_at-day' ? ['day', 'month', 'year'] : []);
    }
    const status = failureStatus(error, 'create-failed');
    return renderForm(res, group, values, endsParts, {}, [], t(`${NS}.states.${status}`));
  }

  return redirectWithStatus(res, `/groups/${group.id}/challenges`, 'created');
}, PAGE_OPTIONS));

router.get('/:id(\\d+)/challenges/:challengeId(\\d+)/cancel', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupSection(req, res, 'challenges');
  if (!access) return undefined;
  const { group, isAdmin } = access;
  if (!isAdmin) return renderRefusal(res, 403);
  const t = res.locals.t;

  const challengeId = Number(req.params.challengeId);
  const challenge = (await loadChallenges(req.token, group.id)).find((item) => item.id === challengeId);
  if (!challenge) return renderRefusal(res, 404);
  if (challenge.status !== 'active') {
    return redirectWithStatus(res, `/groups/${group.id}/challenges`, 'cancel-conflict');
  }

  return res.render('confirm-delete', {
    title: t(`${NS}.cancel_title`, { title: challenge.title }),
    confirmHeading: t(`${NS}.cancel_title`, { title: challenge.title }),
    confirmWarning: t(`${NS}.cancel_warning`),
    confirmButton: t(`${NS}.cancel_confirm`),
    confirmAction: `/groups/${group.id}/challenges/${challengeId}/cancel`,
    cancelHref: `/groups/${group.id}/challenges`
  });
}, PAGE_OPTIONS));

router.post('/:id(\\d+)/challenges/:challengeId(\\d+)/cancel', requireAuth, asyncRoute(async (req, res) => {
  const access = await requireGroupSection(req, res, 'challenges');
  if (!access) return undefined;
  const { group, isAdmin } = access;
  if (!isAdmin) return renderRefusal(res, 403);
  const back = `/groups/${group.id}/challenges`;

  try {
    await callGroupApi(req.token, 'DELETE', `/${encodeURIComponent(group.id)}/challenges/${encodeURIComponent(req.params.challengeId)}`);
  } catch (error) {
    if (isAuthError(error)) return loginRedirect(res);
    if (error instanceof ApiError && (error.status === 409 || apiErrorCode(error) === 'CHALLENGE_IMMUTABLE')) {
      return redirectWithStatus(res, back, 'cancel-conflict');
    }
    return redirectWithStatus(res, back, failureStatus(error, 'cancel-failed'));
  }

  return redirectWithStatus(res, back, 'cancelled');
}, PAGE_OPTIONS));

module.exports = router;
