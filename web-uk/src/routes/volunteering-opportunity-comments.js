// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Comments and likes on one volunteering opportunity (React's
 * OpportunityDetailPage shows a SocialInteractionPanel with targetType
 * "volunteer"). The opportunity page links here; every write posts to the
 * existing /feed/items/volunteer/{id}/… actions, which send the member back.
 */

const express = require('express');
const { getVolunteerOpportunity, ApiError } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { getRequestProfile } = require('../lib/request-profile');
const { loadTargetComments, socialStatusFrom, takeCommentTranslation } = require('../lib/target-comments');

const router = express.Router();

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

router.get('/opportunities/:id(\\d+)/comments', asyncRoute(async (req, res) => {
  const id = Number(req.params.id);
  const token = req.token || req.signedCookies?.token || '';
  const [opportunityResult, comments, profile] = await Promise.all([
    getVolunteerOpportunity(id, token),
    loadTargetComments(token, 'volunteer', id),
    getRequestProfile(req, token).catch((error) => {
      if (error instanceof ApiError && error.status === 401) throw error;
      return null;
    })
  ]);
  const opportunity = opportunityResult && typeof opportunityResult.data === 'object' && opportunityResult.data !== null
    ? opportunityResult.data
    : (opportunityResult || {});
  const profileData = profile && typeof profile.data === 'object' && profile.data !== null ? profile.data : (profile || {});

  return res.render('volunteering/opportunity-comments', {
    title: res.locals.t('govuk_alpha_events.social.opportunity_title', { title: String(opportunity.title || '').trim() }),
    activeNav: 'volunteering',
    opportunity: { id, title: String(opportunity.title || '').trim() },
    comments,
    commentTranslation: takeCommentTranslation(req, 'volunteer', id),
    currentUserId: positiveInteger(profileData.id),
    socialStatus: socialStatusFrom(req.query.social)
  });
}, { redirectOn401: '/login?status=auth-required', notFoundTitle: 'Opportunity not found' }));

module.exports = router;
