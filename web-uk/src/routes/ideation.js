// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { callIdeationApi } = require('../lib/api');
const { getRequestProfile } = require('../lib/request-profile');
const { asyncRoute } = require('../lib/routeHelpers');

const router = express.Router();

function tokenFrom(req) {
  return (req.signedCookies && req.signedCookies.token) || req.token || '';
}

function loginRedirect() {
  return '/login?status=auth-required';
}

function urlFor(res, pathname) {
  const helper = res?.locals && typeof res.locals.urlFor === 'function'
    ? res.locals.urlFor
    : (value) => value;
  return helper(pathname);
}

function redirectTo(res, pathname) {
  return res.redirect(urlFor(res, pathname));
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

function collectionFrom(result) {
  const data = dataFrom(result);
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.items)) return data.items;
  if (data && Array.isArray(data.data)) return data.data;
  if (Array.isArray(result?.items)) return result.items;
  return [];
}

function compact(items) {
  return items.filter(Boolean);
}

function itemFrom(result) {
  const data = dataFrom(result);
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) return data.data;
    return data;
  }
  return {};
}

function ideationAdministrator(profileResult) {
  const profile = itemFrom(profileResult);
  const role = trimmed(profile.role || profile.user_role || profile.account_role);
  return ['admin', 'tenant_admin', 'tenant_super_admin', 'super_admin'].includes(role);
}

function compactQuery(params) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const text = trimmed(value);
    if (text !== '') query.append(key, text);
  }
  return query.toString();
}

function plural(count, singular, pluralText) {
  return count === 1 ? `1 ${singular}` : `${count} ${pluralText}`;
}

function statusDetails(status) {
  switch (trimmed(status).toLowerCase()) {
    case 'open':
      return { label: 'Open', className: 'govuk-tag--green' };
    case 'voting':
      return { label: 'Voting', className: 'govuk-tag--blue' };
    case 'evaluating':
      return { label: 'Evaluating', className: 'govuk-tag--purple' };
    case 'closed':
    case 'archived':
      return { label: 'Closed', className: 'govuk-tag--grey' };
    default:
      return { label: 'Draft', className: 'govuk-tag--grey' };
  }
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map((item) => trimmed(item)).filter(Boolean);
  return [];
}

function limitText(value, maxLength = 160) {
  const text = trimmed(value);
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}...`;
}

function normalizeChallenge(item) {
  const row = item && typeof item === 'object' ? item : {};
  const id = positiveInteger(row.id);
  const status = statusDetails(row.status);
  const ideasCount = Number(row.ideas_count ?? row.ideasCount ?? 0) || 0;
  return {
    ...row,
    id,
    title: trimmed(row.title) || 'Ideas',
    description: trimmed(row.description),
    statusLabel: status.label,
    statusClass: status.className,
    ideasCount,
    ideasCountText: ideasCount === 0 ? 'No ideas yet' : plural(ideasCount, 'idea', 'ideas'),
    tags: normalizeTags(row.tags),
    category: trimmed(row.category),
    submissionDeadline: trimmed(row.submission_deadline ?? row.submissionDeadline),
    votingDeadline: trimmed(row.voting_deadline ?? row.votingDeadline),
    maxIdeasPerUser: row.max_ideas_per_user ?? row.maxIdeasPerUser ?? null,
    viewsCount: Number(row.views_count ?? row.viewsCount ?? 0) || 0,
    favoritesCount: Number(row.favorites_count ?? row.favoritesCount ?? 0) || 0,
    prizeDescription: trimmed(row.prize_description ?? row.prizeDescription),
    isOpenForIdeas: ['open', 'voting'].includes(trimmed(row.status).toLowerCase()),
    isOpenForVotes: ['open', 'voting'].includes(trimmed(row.status).toLowerCase())
  };
}

function normalizeChallengeForm(item) {
  const challenge = normalizeChallenge(item);
  const row = item && typeof item === 'object' ? item : {};
  return {
    ...challenge,
    description: trimmed(row.description),
    categoryId: positiveInteger(row.category_id ?? row.categoryId),
    prizeDescription: trimmed(row.prize_description ?? row.prizeDescription),
    coverImage: trimmed(row.cover_image ?? row.coverImage),
    tagsText: challenge.tags.join(', ')
  };
}

function challengeTransitions(status) {
  const transitions = {
    draft: ['open'],
    open: ['voting', 'evaluating', 'closed'],
    voting: ['evaluating', 'closed'],
    evaluating: ['closed'],
    closed: ['open', 'archived'],
    archived: ['closed']
  };
  return transitions[trimmed(status).toLowerCase()] || [];
}

function normalizeTag(item) {
  const row = item && typeof item === 'object' ? item : {};
  const name = trimmed(row.tag || row.name);
  const count = Number(row.count ?? row.challenge_count ?? row.challengeCount ?? 0) || 0;
  if (!name) return null;
  return {
    name,
    count,
    countText: plural(count, 'challenge', 'challenges')
  };
}

function normalizeCategory(item) {
  const row = item && typeof item === 'object' ? item : {};
  const id = positiveInteger(row.id);
  const name = trimmed(row.name || row.title);
  if (id === null || !name) return null;
  return { id, name };
}

function normalizeTemplate(item) {
  const row = item && typeof item === 'object' ? item : {};
  const id = positiveInteger(row.id);
  const title = trimmed(row.title || row.name);
  if (id === null || !title) return null;
  return {
    id,
    title,
    description: limitText(row.description, 120)
  };
}

function campaignStatusDetails(status) {
  switch (trimmed(status).toLowerCase()) {
    case 'active':
      return { label: 'Active', className: 'govuk-tag--green' };
    case 'completed':
      return { label: 'Completed', className: 'govuk-tag--blue' };
    case 'archived':
      return { label: 'Archived', className: 'govuk-tag--grey' };
    default:
      return { label: 'Draft', className: 'govuk-tag--grey' };
  }
}

function normalizeCampaign(item) {
  const row = item && typeof item === 'object' ? item : {};
  const id = positiveInteger(row.id);
  const statusValue = ['active', 'completed', 'archived'].includes(trimmed(row.status).toLowerCase())
    ? trimmed(row.status).toLowerCase()
    : 'draft';
  const status = campaignStatusDetails(statusValue);
  const challengeCount = Number(row.challenge_count ?? row.challengeCount ?? 0) || 0;
  const creator = row.creator && typeof row.creator === 'object' ? row.creator : {};
  return {
    ...row,
    id,
    title: trimmed(row.title) || 'Campaigns',
    description: limitText(row.description),
    status: statusValue,
    statusLabel: status.label,
    statusClass: status.className,
    challengeCount,
    challengeCountText: plural(challengeCount, 'challenge', 'challenges'),
    creatorName: trimmed(creator.name || row.creator_name || row.creatorName)
  };
}

function normalizeCampaignDetail(item) {
  const campaign = normalizeCampaign(item);
  const row = item && typeof item === 'object' ? item : {};
  return {
    ...campaign,
    description: trimmed(row.description),
    startDate: trimmed(row.start_date ?? row.startDate),
    endDate: trimmed(row.end_date ?? row.endDate),
    challenges: collectionFrom(row.challenges)
      .map(normalizeChallenge)
      .filter((challenge) => challenge.id !== null)
  };
}

function outcomeStatusDetails(status) {
  switch (trimmed(status).toLowerCase()) {
    case 'implemented':
      return { label: 'Implemented', className: 'govuk-tag--green' };
    case 'in_progress':
      return { label: 'In progress', className: 'govuk-tag--blue' };
    case 'abandoned':
      return { label: 'Abandoned', className: 'govuk-tag--red' };
    default:
      return { label: 'Not started', className: 'govuk-tag--grey' };
  }
}

function dashboardFrom(result) {
  const data = dataFrom(result);
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    if (data.data && typeof data.data === 'object' && !Array.isArray(data.data)) return data.data;
    return data;
  }
  return {};
}

function normalizeStats(stats) {
  const row = stats && typeof stats === 'object' ? stats : {};
  return {
    total: Number(row.total ?? 0) || 0,
    implemented: Number(row.implemented ?? 0) || 0,
    inProgress: Number(row.in_progress ?? row.inProgress ?? 0) || 0,
    notStarted: Number(row.not_started ?? row.notStarted ?? 0) || 0,
    abandoned: Number(row.abandoned ?? 0) || 0
  };
}

function normalizeOutcome(item) {
  const row = item && typeof item === 'object' ? item : {};
  const challengeId = positiveInteger(row.challenge_id ?? row.challengeId);
  const status = outcomeStatusDetails(row.status);
  return {
    ...row,
    challengeId,
    challengeTitle: trimmed(row.challenge_title ?? row.challengeTitle) || 'Challenges',
    ideaTitle: trimmed(row.idea_title ?? row.ideaTitle) || 'Not set',
    statusLabel: status.label,
    statusClass: status.className
  };
}

function normalizeOutcomeForm(item) {
  const row = item && typeof item === 'object' ? item : {};
  return {
    winningIdeaId: positiveInteger(row.winning_idea_id ?? row.winningIdeaId),
    status: trimmed(row.status) || 'not_started',
    impactDescription: trimmed(row.impact_description ?? row.impactDescription, 5000)
  };
}

function ideationStateMessage(status, t, aliases = {}) {
  const value = trimmed(status);
  if (!value || typeof t !== 'function') return '';
  return t(`govuk_alpha_ideation.states.${aliases[value] || value}`);
}

function outcomeEditStatusMessage(status, t) {
  return trimmed(status) === 'outcome-saved' ? ideationStateMessage(status, t) : '';
}

function outcomeEditErrorMessage(status, t) {
  return ['outcome-failed', 'outcome-save-failed'].includes(trimmed(status))
    ? ideationStateMessage(status, t, { 'outcome-save-failed': 'outcome-failed' })
    : '';
}

function normalizeIdea(item) {
  const row = item && typeof item === 'object' ? item : {};
  const id = positiveInteger(row.id);
  const votes = Number(row.vote_count ?? row.voteCount ?? row.votes_count ?? 0) || 0;
  const creator = row.creator && typeof row.creator === 'object' ? row.creator : {};
  return {
    ...row,
    id,
    title: trimmed(row.title) || 'Your idea',
    description: trimmed(row.description),
    voteCount: votes,
    voteText: votes === 0 ? 'No votes' : plural(votes, 'vote', 'votes'),
    authorName: trimmed(creator.name || row.creator_name || row.creatorName)
  };
}

function normalizeDraft(item) {
  const row = item && typeof item === 'object' ? item : {};
  const id = positiveInteger(row.id);
  return {
    ...row,
    id,
    title: trimmed(row.title),
    description: trimmed(row.description),
    updatedAt: trimmed(row.updated_at ?? row.updatedAt),
    createdAt: trimmed(row.created_at ?? row.createdAt)
  };
}

function ideaStatusDetails(status) {
  switch (trimmed(status).toLowerCase()) {
    case 'shortlisted':
      return { label: 'Shortlisted', className: 'govuk-tag--yellow' };
    case 'winner':
      return { label: 'Winner', className: 'govuk-tag--green' };
    case 'withdrawn':
      return { label: 'Withdrawn', className: 'govuk-tag--grey' };
    default:
      return { label: 'Submitted', className: 'govuk-tag--blue' };
  }
}

function normalizeIdeaDetail(item, challenge) {
  const idea = normalizeIdea(item);
  const row = item && typeof item === 'object' ? item : {};
  const status = ideaStatusDetails(row.status);
  const challengeStatus = trimmed(challenge?.status).toLowerCase();
  const isOwner = Boolean(row.is_owner || row.isOwner);
  const isAdmin = Boolean(row.is_admin || row.isAdmin);
  const ideaStatus = trimmed(row.status || 'submitted').toLowerCase();
  const hasVoted = Boolean(row.has_voted || row.hasVoted);
  return {
    ...idea,
    challengeId: positiveInteger(row.challenge_id ?? row.challengeId),
    status: ideaStatus || 'submitted',
    statusLabel: status.label,
    statusClass: status.className,
    hasVoted,
    isOwner,
    isAdmin,
    canVote: Boolean(row.can_vote || row.canVote)
      || (['open', 'voting'].includes(challengeStatus) && !isOwner && !['withdrawn', 'draft'].includes(ideaStatus)),
    canComment: row.can_comment !== false && row.canComment !== false && !['withdrawn', 'draft'].includes(ideaStatus),
    canConvert: Boolean(row.can_convert || row.canConvert || ((isAdmin || isOwner) && ['shortlisted', 'winner'].includes(ideaStatus)))
  };
}

function normalizeComment(item) {
  const row = item && typeof item === 'object' ? item : {};
  const author = row.author && typeof row.author === 'object' ? row.author : {};
  return {
    id: positiveInteger(row.id),
    body: trimmed(row.body || row.comment || row.content),
    authorName: trimmed(author.name || row.author_name || row.authorName)
  };
}

function normalizeMedia(item) {
  const row = item && typeof item === 'object' ? item : {};
  const type = trimmed(row.media_type ?? row.mediaType ?? row.type).toLowerCase();
  const typeLabels = {
    image: 'Image',
    video: 'Video',
    document: 'Document',
    link: 'Link'
  };
  return {
    id: positiveInteger(row.id),
    url: trimmed(row.url),
    caption: trimmed(row.caption),
    type: ['image', 'video', 'document', 'link'].includes(type) ? type : 'link',
    typeLabel: typeLabels[type] || 'Link'
  };
}

function statusMessage(status, t) {
  return ['idea-submitted', 'idea-voted'].includes(trimmed(status)) ? ideationStateMessage(status, t) : '';
}

function errorMessage(status, t) {
  if (trimmed(status) === 'idea-invalid') return t('ideation.states.idea-invalid');
  return trimmed(status) === 'idea-failed' ? t('ideation.states.idea-failed') : '';
}

function ideaDetailStatusMessage(status, t) {
  const allowed = ['idea-voted', 'idea-status-updated', 'idea-deleted', 'comment-added', 'comment-deleted', 'media-added', 'converted'];
  return allowed.includes(trimmed(status)) ? ideationStateMessage(status, t) : '';
}

function ideaDetailErrorMessage(status, t) {
  const allowed = ['idea-failed', 'comment-invalid', 'comment-failed', 'media-invalid', 'media-failed', 'convert-failed'];
  return allowed.includes(trimmed(status)) ? ideationStateMessage(status, t) : '';
}

function draftStatusMessage(status, t) {
  return trimmed(status) === 'draft-saved' ? ideationStateMessage(status, t) : '';
}

function draftErrorMessage(status, t) {
  return ['draft-invalid', 'draft-failed'].includes(trimmed(status)) ? ideationStateMessage(status, t) : '';
}

function manageStatusMessage(status, t) {
  const allowed = ['challenge-status-updated', 'campaign-linked', 'favorited', 'unfavorited'];
  return allowed.includes(trimmed(status)) ? ideationStateMessage(status, t) : '';
}

function manageErrorMessage(status, t) {
  const allowed = ['challenge-status-failed', 'challenge-failed', 'campaign-link-failed'];
  return allowed.includes(trimmed(status)) ? ideationStateMessage(status, t) : '';
}

router.get('/', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const status = trimmed(req.query.status);
  const query = trimmed(req.query.q);
  const queryString = compactQuery({
    limit: 30,
    status,
    search: query
  });
  const result = await callIdeationApi(token, 'GET', `/ideation-challenges?${queryString}`);
  const challenges = collectionFrom(result)
    .map(normalizeChallenge)
    .filter((challenge) => challenge.id !== null);

  return res.render('ideation/index', {
    title: 'Ideas',
    activeNav: 'explore',
    challenges,
    activeStatus: status,
    activeQuery: query
  });
}, { redirectOn401: loginRedirect() }));

router.get('/new', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const isAdmin = ideationAdministrator(await getRequestProfile(req, token));
  if (!isAdmin) {
    return res.status(403).render('errors/403', { title: 'Forbidden' });
  }

  const categoriesResult = await callIdeationApi(token, 'GET', '/ideation-categories');
  const templatesResult = await callIdeationApi(token, 'GET', '/ideation-templates');
  const categories = compact(collectionFrom(categoriesResult).map(normalizeCategory));
  const templates = compact(collectionFrom(templatesResult).map(normalizeTemplate));
  const status = trimmed(req.query.status);

  return res.render('ideation/challenge-form', {
    title: 'Create challenge',
    activeNav: 'explore',
    mode: 'create',
    challenge: {
      status: 'draft',
      tagsText: ''
    },
    categories,
    templates,
    status,
    errorMessage: status === 'challenge-failed' ? ideationStateMessage(status, res.locals.t) : ''
  });
}, { redirectOn401: loginRedirect() }));

router.get('/campaigns', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const [result, profileResult] = await Promise.all([
    callIdeationApi(token, 'GET', '/ideation-campaigns?per_page=50'),
    getRequestProfile(req, token)
  ]);
  const campaigns = collectionFrom(result)
    .map(normalizeCampaign)
    .filter((campaign) => campaign.id !== null);
  const status = trimmed(req.query.status);

  return res.render('ideation/campaigns', {
    title: 'Campaigns',
    activeNav: 'explore',
    campaigns,
    ideationIsAdmin: ideationAdministrator(profileResult),
    status
  });
}, { redirectOn401: loginRedirect() }));

router.get('/campaigns/:id(\\d+)', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = positiveInteger(req.params.id);
  const [result, profileResult] = await Promise.all([
    callIdeationApi(token, 'GET', `/ideation-campaigns/${id}`),
    getRequestProfile(req, token)
  ]);
  const campaign = normalizeCampaignDetail({ id, ...itemFrom(result) });
  const status = trimmed(req.query.status);

  return res.render('ideation/campaign-detail', {
    title: campaign.title,
    activeNav: 'explore',
    campaign,
    status,
    ideationIsAdmin: ideationAdministrator(profileResult)
  });
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Ideation campaign not found' }));

router.get('/outcomes', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const [result, profileResult] = await Promise.all([
    callIdeationApi(token, 'GET', '/ideation-outcomes/dashboard'),
    getRequestProfile(req, token)
  ]);
  const dashboard = dashboardFrom(result);
  const outcomes = collectionFrom(dashboard.outcomes)
    .map(normalizeOutcome)
    .filter((outcome) => outcome.challengeId !== null);

  return res.render('ideation/outcomes', {
    title: 'Outcomes',
    activeNav: 'explore',
    stats: normalizeStats(dashboard.stats),
    outcomes,
    ideationIsAdmin: ideationAdministrator(profileResult)
  });
}, { redirectOn401: loginRedirect() }));

router.get('/tags', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const selectedTag = trimmed(req.query.tag, 100);
  const tagsResult = await callIdeationApi(token, 'GET', '/ideation-tags/popular');
  const tags = compact(collectionFrom(tagsResult).map(normalizeTag));
  let matches = [];

  if (selectedTag) {
    const selected = selectedTag.toLowerCase();
    const challengesResult = await callIdeationApi(token, 'GET', '/ideation-challenges?limit=100');
    matches = collectionFrom(challengesResult)
      .map(normalizeChallenge)
      .filter((challenge) => challenge.id !== null)
      .filter((challenge) => challenge.tags.some((tag) => tag.toLowerCase() === selected))
      .map((challenge) => ({
        ...challenge,
        description: limitText(challenge.description)
      }));
  }

  return res.render('ideation/tags', {
    title: 'Browse by tag',
    activeNav: 'explore',
    tags,
    selectedTag,
    matches
  });
}, { redirectOn401: loginRedirect() }));

router.get('/:id(\\d+)/manage', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = positiveInteger(req.params.id);
  const challengeResult = await callIdeationApi(token, 'GET', `/ideation-challenges/${id}`);
  const campaignsResult = await callIdeationApi(token, 'GET', '/ideation-campaigns?per_page=100');
  const challenge = normalizeChallenge({ id, ...itemFrom(challengeResult) });
  const campaigns = collectionFrom(campaignsResult)
    .map(normalizeCampaign)
    .filter((campaign) => campaign.id !== null);
  const status = trimmed(req.query.status);

  return res.render('ideation/manage', {
    title: 'Manage challenge',
    activeNav: 'explore',
    challenge,
    campaigns,
    transitions: challengeTransitions(challenge.status),
    isFavorited: Boolean(challenge.is_favorited || challenge.isFavorited || challenge.has_favorited || challenge.hasFavorited),
    status,
    successMessage: manageStatusMessage(status, res.locals.t),
    errorMessage: manageErrorMessage(status, res.locals.t)
  });
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Ideation challenge not found' }));

router.get('/:id(\\d+)/outcome', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = positiveInteger(req.params.id);
  const challengeResult = await callIdeationApi(token, 'GET', `/ideation-challenges/${id}`);
  const ideasResult = await callIdeationApi(token, 'GET', `/ideation-challenges/${id}/ideas?limit=100&sort=votes`);
  const outcomeResult = await callIdeationApi(token, 'GET', `/ideation-challenges/${id}/outcome`);
  const challenge = normalizeChallenge({ id, ...itemFrom(challengeResult) });
  const ideas = collectionFrom(ideasResult)
    .map(normalizeIdea)
    .filter((idea) => idea.id !== null);
  const outcome = normalizeOutcomeForm(itemFrom(outcomeResult));
  const status = trimmed(req.query.status);

  return res.render('ideation/outcome-form', {
    title: 'Record challenge outcome',
    activeNav: 'explore',
    challenge,
    ideas,
    outcome,
    status,
    successMessage: outcomeEditStatusMessage(status, res.locals.t),
    errorMessage: outcomeEditErrorMessage(status, res.locals.t)
  });
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Ideation challenge not found' }));

router.get('/:id(\\d+)/drafts', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = positiveInteger(req.params.id);
  const challengeResult = await callIdeationApi(token, 'GET', `/ideation-challenges/${id}`);
  const draftsResult = await callIdeationApi(token, 'GET', `/ideation-challenges/${id}/ideas/drafts`);
  const challenge = normalizeChallenge({ id, ...itemFrom(challengeResult) });
  const drafts = collectionFrom(draftsResult)
    .map(normalizeDraft)
    .filter((draft) => draft.id !== null);
  const status = trimmed(req.query.status);

  return res.render('ideation/drafts', {
    title: 'Your draft ideas',
    activeNav: 'explore',
    challenge,
    drafts,
    status,
    successMessage: draftStatusMessage(status, res.locals.t),
    errorMessage: draftErrorMessage(status, res.locals.t)
  });
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Ideation challenge not found' }));

router.get('/:id(\\d+)/ideas/:ideaId(\\d+)', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = positiveInteger(req.params.id);
  const ideaId = positiveInteger(req.params.ideaId);
  const ideaResult = await callIdeationApi(token, 'GET', `/ideation-ideas/${ideaId}`);
  const ideaData = itemFrom(ideaResult);
  if (positiveInteger(ideaData.challenge_id ?? ideaData.challengeId) !== id) {
    return res.status(404).render('errors/404', { title: 'Ideation idea not found' });
  }

  const challengeResult = await callIdeationApi(token, 'GET', `/ideation-challenges/${id}`);
  const commentsResult = await callIdeationApi(token, 'GET', `/ideation-ideas/${ideaId}/comments?per_page=30`);
  const mediaResult = await callIdeationApi(token, 'GET', `/ideation-ideas/${ideaId}/media`);
  const challenge = normalizeChallenge({ id, ...itemFrom(challengeResult) });
  const idea = normalizeIdeaDetail({ id: ideaId, ...ideaData }, challenge);
  const comments = collectionFrom(commentsResult)
    .map(normalizeComment)
    .filter((comment) => comment.id !== null && comment.body);
  const media = collectionFrom(mediaResult)
    .map(normalizeMedia)
    .filter((item) => item.id !== null && item.url);
  const status = trimmed(req.query.status);

  return res.render('ideation/idea-detail', {
    title: idea.title,
    activeNav: 'explore',
    challenge,
    idea,
    comments,
    media,
    status,
    successMessage: ideaDetailStatusMessage(status, res.locals.t),
    errorMessage: ideaDetailErrorMessage(status, res.locals.t)
  });
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Ideation idea not found' }));

router.get('/:id(\\d+)/edit', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = positiveInteger(req.params.id);
  const challengeResult = await callIdeationApi(token, 'GET', `/ideation-challenges/${id}`);
  const categoriesResult = await callIdeationApi(token, 'GET', '/ideation-categories');
  const challenge = normalizeChallengeForm({ id, ...itemFrom(challengeResult) });
  const categories = compact(collectionFrom(categoriesResult).map(normalizeCategory));
  const status = trimmed(req.query.status);

  return res.render('ideation/challenge-form', {
    title: 'Edit challenge',
    activeNav: 'explore',
    mode: 'edit',
    challenge,
    categories,
    templates: [],
    status,
    errorMessage: status === 'challenge-failed' ? ideationStateMessage(status, res.locals.t) : ''
  });
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Ideation challenge not found' }));

router.get('/:id(\\d+)', asyncRoute(async (req, res) => {
  const token = tokenFrom(req);
  if (!token) return redirectTo(res, loginRedirect());

  const id = positiveInteger(req.params.id);
  const challengeResult = await callIdeationApi(token, 'GET', `/ideation-challenges/${id}`);
  const ideasResult = await callIdeationApi(token, 'GET', `/ideation-challenges/${id}/ideas?limit=30&sort=votes`);
  const challenge = normalizeChallenge({ id, ...itemFrom(challengeResult) });
  const ideas = collectionFrom(ideasResult)
    .map(normalizeIdea)
    .filter((idea) => idea.id !== null);
  const status = trimmed(req.query.status);

  return res.render('ideation/detail', {
    title: challenge.title,
    activeNav: 'explore',
    challenge,
    ideas,
    status,
    successMessage: statusMessage(status, res.locals.t),
    errorMessage: errorMessage(status, res.locals.t)
  });
}, { redirectOn401: loginRedirect(), notFoundTitle: 'Ideation challenge not found' }));

module.exports = router;
