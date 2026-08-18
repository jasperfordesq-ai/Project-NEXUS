// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { ApiError, callIdeationApi } = require('../lib/api');
const { getRequestProfile } = require('../lib/request-profile');
const { asyncRoute } = require('../lib/routeHelpers');

const router = express.Router();
const IDEATION_PATH = '/ideation';

function tokenFrom(req) {
  return req.signedCookies.token || '';
}

function trimmed(value, limit = null) {
  const text = String(value || '').trim();
  return limit === null ? text : text.slice(0, limit);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function stringArray(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }

  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function loginRedirect() {
  return '/login?status=auth-required';
}

function localUrl(res, pathname) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return urlFor(pathname);
}

function redirectTo(res, pathname) {
  return res.redirect(localUrl(res, pathname));
}

function isAuthError(error) {
  return error instanceof ApiError && error.status === 401;
}

function redirectOnAuthError(error, res) {
  if (isAuthError(error)) {
    redirectTo(res, loginRedirect());
    return true;
  }
  return false;
}

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined
    ? result.data
    : result;
}

function resultId(result) {
  const data = dataFrom(result);
  return data && typeof data === 'object' ? positiveInteger(data.id) : null;
}

async function callApi(token, method, path, data = undefined) {
  if (data === undefined) {
    return callIdeationApi(token, method, path);
  }

  return callIdeationApi(token, method, path, data);
}

async function runAction(req, res, method, path, data, successRedirect, failureRedirect, onFailure) {
  const token = tokenFrom(req);
  if (!token) {
    return redirectTo(res, loginRedirect());
  }

  try {
    const result = await callApi(token, method, path, data);
    const redirect = typeof successRedirect === 'function'
      ? successRedirect(result)
      : successRedirect;
    return redirectTo(res, redirect);
  } catch (error) {
    if (redirectOnAuthError(error, res)) return undefined;
    // Give the caller a chance to preserve the submitted form (stash it in the
    // session) before we redirect to the failure GET. This runs ONLY on a real
    // API failure — never on the success path — so a stash can only ever exist
    // after a failure.
    if (typeof onFailure === 'function') onFailure(error);
    return redirectTo(res, failureRedirect);
  }
}

// --- Failed-submission preservation ---------------------------------------
// On any failure exit we stash the raw submitted fields in the session so the
// re-rendered form echoes what the member typed instead of reverting to saved
// values or blanks. Each stash carries a `formKey` discriminator so a create
// stash can never seed an edit form (or vice versa): the GET only consumes a
// stash whose formKey matches, and discards a non-matching one. Consumed once
// (read-and-delete) by the GET handlers in ideation.js. Never called on a
// success path.

function storeChallengeForm(req, formKey, body) {
  if (!req.session) return;
  req.session.ideationChallengeForm = {
    formKey,
    values: {
      title: String(body.title || ''),
      description: String(body.description || ''),
      category_id: String(body.category_id || ''),
      category: String(body.category || ''),
      prize_description: String(body.prize_description || ''),
      submission_deadline: String(body.submission_deadline || ''),
      voting_deadline: String(body.voting_deadline || ''),
      max_ideas_per_user: String(body.max_ideas_per_user || ''),
      cover_image: String(body.cover_image || ''),
      tags: String(body.tags || ''),
      // challengePayload reads body.status, but the form field is challenge_status;
      // keep both so the re-render works whichever the submission carried.
      challenge_status: String(body.challenge_status || body.status || '')
    }
  };
}

function storeIdeaForm(req, challengeId, body) {
  if (!req.session) return;
  req.session.ideationIdeaForm = {
    formKey: String(challengeId),
    values: {
      idea_title: String(body.idea_title || ''),
      idea_content: String(body.idea_content || '')
    }
  };
}

function storeCampaignForm(req, formKey, body) {
  if (!req.session) return;
  req.session.ideationCampaignForm = {
    formKey,
    values: {
      title: String(body.title || ''),
      description: String(body.description || ''),
      cover_image: String(body.cover_image || ''),
      start_date: String(body.start_date || ''),
      end_date: String(body.end_date || ''),
      // campaignPayload reads body.campaign_status || body.status.
      campaign_status: String(body.campaign_status || body.status || '')
    }
  };
}

function favoriteStatus(result) {
  const data = dataFrom(result);
  return data && typeof data === 'object' && data.favorited === false ? 'unfavorited' : 'favorited';
}

function ideationAdministrator(profileResult) {
  const profile = dataFrom(profileResult) || {};
  const role = trimmed(profile.role || profile.user_role || profile.userRole).toLowerCase();
  return ['admin', 'tenant_admin', 'tenant_super_admin', 'super_admin'].includes(role);
}

async function guardCampaignAdministrator(req, res) {
  const token = tokenFrom(req);
  if (!token) {
    redirectTo(res, loginRedirect());
    return false;
  }

  if (!ideationAdministrator(await getRequestProfile(req, token))) {
    res.status(403).render('errors/403', { title: (res.locals.t ? res.locals.t('govuk_alpha.error_pages.403_title') : 'Forbidden') });
    return false;
  }

  return true;
}

function challengeRedirect(id, status) {
  return `${IDEATION_PATH}/${id}?status=${encodeURIComponent(status)}`;
}

function challengeManageRedirect(id, status) {
  return `${IDEATION_PATH}/${id}/manage?status=${encodeURIComponent(status)}`;
}

function ideaRedirect(challengeId, ideaId, status, fragment = '') {
  return `${IDEATION_PATH}/${challengeId}/ideas/${ideaId}?status=${encodeURIComponent(status)}${fragment}`;
}

function campaignRedirect(id, status) {
  return `${IDEATION_PATH}/campaigns/${id}?status=${encodeURIComponent(status)}`;
}

function ideationRedirect(status) {
  return `${IDEATION_PATH}?status=${encodeURIComponent(status)}`;
}

function ideationSubpageRedirect(subpage, status, fragment = '') {
  return `${IDEATION_PATH}/${subpage}?status=${encodeURIComponent(status)}${fragment}`;
}

function challengeSubpageRedirect(id, subpage, status, fragment = '') {
  return `${IDEATION_PATH}/${id}/${subpage}?status=${encodeURIComponent(status)}${fragment}`;
}

function challengePayload(body) {
  const payload = {
    title: trimmed(body.title, 200),
    description: trimmed(body.description, 10000)
  };

  const categoryId = positiveInteger(body.category_id);
  if (categoryId !== null) {
    payload.category_id = categoryId;
  }

  const status = trimmed(body.status, 64);
  if (status !== '') {
    payload.status = status;
  }

  const tags = stringArray(body.tags);
  if (tags.length > 0) {
    payload.tags = tags;
  }

  return payload;
}

function ideaPayload(body) {
  const payload = {
    title: trimmed(body.idea_title || body.title, 200),
    description: trimmed(body.idea_content || body.description, 10000)
  };

  const action = trimmed(body.action, 64);
  if (action !== '') {
    payload.action = action;
  }

  return payload;
}

// The drafts form posts draft_title/draft_description/draft_action, which
// ideaPayload does not read — every save arrived at Laravel with an empty title
// and was rejected, and Publish could never publish because nothing set the
// `publish` flag updateDraftIdea checks.
function draftPayload(body) {
  const payload = {
    title: trimmed(body.draft_title || body.title, 255),
    description: trimmed(body.draft_description || body.description, 10000)
  };

  if (trimmed(body.draft_action, 64) === 'publish') {
    payload.publish = true;
  }

  return payload;
}

function campaignPayload(body) {
  const payload = {
    title: trimmed(body.title, 255),
    description: trimmed(body.description, 5000),
    cover_image: trimmed(body.cover_image, 500),
    start_date: trimmed(body.start_date) || null,
    end_date: trimmed(body.end_date) || null
  };

  const requestedStatus = trimmed(body.campaign_status || body.status, 64);
  payload.status = ['draft', 'active', 'completed', 'archived'].includes(requestedStatus)
    ? requestedStatus
    : 'draft';

  return payload;
}

function outcomePayload(body) {
  const status = trimmed(body.outcome_status || body.status, 64);
  const winningIdea = positiveInteger(body.winning_idea_id);
  const impactDescription = trimmed(body.impact_description, 5000);

  const payload = {
    status: ['not_started', 'in_progress', 'implemented', 'abandoned'].includes(status)
      ? status
      : 'not_started',
    winning_idea_id: winningIdea,
    impact_description: impactDescription || null
  };

  return payload;
}

function mediaPayload(body) {
  return {
    media_type: trimmed(body.media_type, 64),
    url: trimmed(body.media_url || body.url, 2048),
    caption: trimmed(body.media_caption || body.caption, 255)
  };
}

function convertPayload(body) {
  // Laravel reads name/visibility/description (IdeaTeamConversionService::convert),
  // NOT group_name — a group_name key is silently ignored and the visibility the
  // member chose was never sent at all, so private/secret produced a public group.
  const payload = {
    description: trimmed(body.group_description || body.description, 10000)
  };

  // Omitted when blank so Laravel falls back to the idea title rather than
  // creating a group with an empty name.
  const name = trimmed(body.group_name || body.name, 200);
  if (name !== '') {
    payload.name = name;
  }

  const visibility = trimmed(body.group_visibility || body.visibility, 32);
  if (['public', 'private', 'secret'].includes(visibility)) {
    payload.visibility = visibility;
  }

  return payload;
}

router.post('/campaigns', asyncRoute(async (req, res) => {
  if (!await guardCampaignAdministrator(req, res)) return undefined;

  const payload = campaignPayload(req.body);
  if (payload.title === '') {
    storeCampaignForm(req, 'create', req.body);
    return redirectTo(res, `${ideationSubpageRedirect('campaigns', 'campaign-invalid')}#create`);
  }

  return runAction(
    req,
    res,
    'POST',
    '/ideation-campaigns',
    payload,
    (result) => {
      const id = resultId(result);
      return id === null
        ? ideationSubpageRedirect('campaigns', 'campaign-created')
        : campaignRedirect(id, 'campaign-created');
    },
    `${ideationSubpageRedirect('campaigns', 'campaign-failed')}#create`,
    () => storeCampaignForm(req, 'create', req.body)
  );
}));

router.post('/campaigns/:id(\\d+)', asyncRoute(async (req, res) => {
  if (!await guardCampaignAdministrator(req, res)) return undefined;

  const id = Number(req.params.id);
  const payload = campaignPayload(req.body);
  if (payload.title === '') {
    storeCampaignForm(req, `edit:${id}`, req.body);
    return redirectTo(res, `${campaignRedirect(id, 'campaign-invalid')}#edit`);
  }

  return runAction(
    req,
    res,
    'PUT',
    `/ideation-campaigns/${id}`,
    payload,
    campaignRedirect(id, 'campaign-updated'),
    campaignRedirect(id, 'campaign-failed'),
    () => storeCampaignForm(req, `edit:${id}`, req.body)
  );
}));

router.post('/campaigns/:id(\\d+)/challenges/:challengeId(\\d+)/unlink', asyncRoute(async (req, res) => {
  if (!await guardCampaignAdministrator(req, res)) return undefined;

  const id = Number(req.params.id);
  const challengeId = Number(req.params.challengeId);
  return runAction(
    req,
    res,
    'DELETE',
    `/ideation-campaigns/${id}/challenges/${challengeId}`,
    undefined,
    campaignRedirect(id, 'challenge-unlinked'),
    campaignRedirect(id, 'campaign-failed')
  );
}));

router.post('/campaigns/:id(\\d+)/delete', asyncRoute(async (req, res) => {
  if (!await guardCampaignAdministrator(req, res)) return undefined;

  const id = Number(req.params.id);
  return runAction(
    req,
    res,
    'DELETE',
    `/ideation-campaigns/${id}`,
    undefined,
    ideationSubpageRedirect('campaigns', 'campaign-deleted'),
    campaignRedirect(id, 'campaign-failed')
  );
}));

router.post('/new', asyncRoute(async (req, res) => runAction(
  req,
  res,
  'POST',
  '/ideation-challenges',
  challengePayload(req.body),
  (result) => challengeRedirect(resultId(result) || 'new', 'challenge-created'),
  ideationSubpageRedirect('new', 'challenge-failed'),
  () => storeChallengeForm(req, 'create', req.body)
)));

router.post('/:id(\\d+)/edit', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runAction(
    req,
    res,
    'PUT',
    `/ideation-challenges/${id}`,
    challengePayload(req.body),
    // Success MUST stay on the manage page (existing contract/test).
    challengeManageRedirect(id, 'challenge-updated'),
    // On failure, re-render the EDIT FORM (not manage) so the stashed input
    // can be echoed back.
    `${IDEATION_PATH}/${id}/edit?status=challenge-failed`,
    () => storeChallengeForm(req, `edit:${id}`, req.body)
  );
}));

router.post('/:id(\\d+)/status', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runAction(
    req,
    res,
    'PUT',
    `/ideation-challenges/${id}/status`,
    { status: trimmed(req.body.status, 64) },
    challengeManageRedirect(id, 'challenge-status-updated'),
    challengeManageRedirect(id, 'challenge-status-failed')
  );
}));

router.post('/:id(\\d+)/favorite', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runAction(
    req,
    res,
    'POST',
    `/ideation-challenges/${id}/favorite`,
    undefined,
    (result) => challengeRedirect(id, favoriteStatus(result)),
    challengeRedirect(id, 'challenge-failed')
  );
}));

router.post('/:id(\\d+)/duplicate', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runAction(
    req,
    res,
    'POST',
    `/ideation-challenges/${id}/duplicate`,
    undefined,
    (result) => challengeRedirect(resultId(result) || id, 'challenge-duplicated'),
    challengeManageRedirect(id, 'challenge-failed')
  );
}));

router.post('/:id(\\d+)/delete', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runAction(
    req,
    res,
    'DELETE',
    `/ideation-challenges/${id}`,
    undefined,
    ideationRedirect('challenge-deleted'),
    challengeManageRedirect(id, 'challenge-failed')
  );
}));

router.post('/:id(\\d+)/link-campaign', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const campaignId = positiveInteger(req.body.campaign_id);
  if (campaignId === null) {
    return redirectTo(res, challengeRedirect(id, 'campaign-link-failed'));
  }

  const sortOrder = positiveInteger(req.body.sort_order);
  const payload = { challenge_id: id };
  if (sortOrder !== null) {
    payload.sort_order = sortOrder;
  }

  return runAction(
    req,
    res,
    'POST',
    `/ideation-campaigns/${campaignId}/challenges`,
    payload,
    challengeRedirect(id, 'campaign-linked'),
    challengeRedirect(id, 'campaign-link-failed')
  );
}));

router.post('/:id(\\d+)/outcome', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runAction(
    req,
    res,
    'PUT',
    `/ideation-challenges/${id}/outcome`,
    outcomePayload(req.body),
    challengeSubpageRedirect(id, 'outcome', 'outcome-saved'),
    challengeSubpageRedirect(id, 'outcome', 'outcome-failed')
  );
}));

router.post('/:id(\\d+)/drafts/:ideaId(\\d+)', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const ideaId = Number(req.params.ideaId);
  const payload = draftPayload(req.body);

  if (payload.title === '') {
    return redirectTo(res, challengeSubpageRedirect(id, 'drafts', 'draft-invalid'));
  }

  return runAction(
    req,
    res,
    'PUT',
    `/ideation-ideas/${ideaId}/draft`,
    payload,
    challengeSubpageRedirect(id, 'drafts', 'draft-saved'),
    challengeSubpageRedirect(id, 'drafts', 'draft-failed')
  );
}));

router.post('/:id(\\d+)/ideas', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  return runAction(
    req,
    res,
    'POST',
    `/ideation-challenges/${id}/ideas`,
    ideaPayload(req.body),
    challengeRedirect(id, 'idea-submitted') + '#ideas',
    challengeRedirect(id, 'idea-failed') + '#ideas',
    () => storeIdeaForm(req, id, req.body)
  );
}));

router.post('/:id(\\d+)/ideas/:ideaId(\\d+)/comments', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const ideaId = Number(req.params.ideaId);
  return runAction(
    req,
    res,
    'POST',
    `/ideation-ideas/${ideaId}/comments`,
    { body: trimmed(req.body.comment_body || req.body.body, 5000) },
    ideaRedirect(id, ideaId, 'comment-added', '#comments'),
    ideaRedirect(id, ideaId, 'comment-failed', '#comments')
  );
}));

router.post('/:id(\\d+)/ideas/:ideaId(\\d+)/comments/:commentId(\\d+)/delete', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const ideaId = Number(req.params.ideaId);
  const commentId = Number(req.params.commentId);
  return runAction(
    req,
    res,
    'DELETE',
    `/ideation-comments/${commentId}`,
    undefined,
    ideaRedirect(id, ideaId, 'comment-deleted', '#comments'),
    ideaRedirect(id, ideaId, 'comment-failed', '#comments')
  );
}));

router.post('/:id(\\d+)/ideas/:ideaId(\\d+)/toggle-vote', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const ideaId = Number(req.params.ideaId);
  return runAction(
    req,
    res,
    'POST',
    `/ideation-ideas/${ideaId}/vote`,
    undefined,
    ideaRedirect(id, ideaId, 'idea-voted'),
    ideaRedirect(id, ideaId, 'idea-failed')
  );
}));

router.post('/:id(\\d+)/ideas/:ideaId(\\d+)/vote', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const ideaId = Number(req.params.ideaId);
  return runAction(
    req,
    res,
    'POST',
    `/ideation-ideas/${ideaId}/vote`,
    undefined,
    challengeRedirect(id, 'idea-voted') + '#ideas',
    challengeRedirect(id, 'idea-failed') + '#ideas'
  );
}));

router.post('/:id(\\d+)/ideas/:ideaId(\\d+)/status', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const ideaId = Number(req.params.ideaId);
  return runAction(
    req,
    res,
    'PUT',
    `/ideation-ideas/${ideaId}/status`,
    { status: trimmed(req.body.idea_status || req.body.status, 64) },
    ideaRedirect(id, ideaId, 'idea-status-updated'),
    ideaRedirect(id, ideaId, 'idea-failed')
  );
}));

router.post('/:id(\\d+)/ideas/:ideaId(\\d+)/delete', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const ideaId = Number(req.params.ideaId);
  return runAction(
    req,
    res,
    'DELETE',
    `/ideation-ideas/${ideaId}`,
    undefined,
    challengeRedirect(id, 'idea-deleted') + '#ideas',
    challengeRedirect(id, 'idea-failed') + '#ideas'
  );
}));

router.post('/:id(\\d+)/ideas/:ideaId(\\d+)/media', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const ideaId = Number(req.params.ideaId);
  return runAction(
    req,
    res,
    'POST',
    `/ideation-ideas/${ideaId}/media`,
    mediaPayload(req.body),
    ideaRedirect(id, ideaId, 'media-added'),
    ideaRedirect(id, ideaId, 'media-failed')
  );
}));

router.post('/:id(\\d+)/ideas/:ideaId(\\d+)/convert', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const ideaId = Number(req.params.ideaId);
  return runAction(
    req,
    res,
    'POST',
    `/ideation-ideas/${ideaId}/convert-to-group`,
    convertPayload(req.body),
    ideaRedirect(id, ideaId, 'converted'),
    ideaRedirect(id, ideaId, 'convert-failed')
  );
}));

module.exports = router;
