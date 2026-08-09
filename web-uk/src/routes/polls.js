// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { getPolls, getPoll, votePoll, ApiError } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { normalizeResponse } = require('../lib/normalizeResponse');

const router = express.Router();

router.use(requireAuth);

function redirectTo(res, pathname) {
  const urlFor = res.locals && res.locals.urlFor ? res.locals.urlFor : (target) => target;
  return res.redirect(urlFor(pathname));
}

// List polls
router.get('/', asyncRoute(async (req, res) => {
  const page = parseInt(req.query.page, 10) || 1;

  const result = await getPolls(req.token, { page, limit: 20 });

  const polls = (result.items || result.data || []).map(normalizeResponse);

  res.render('polls/index', {
    title: 'Polls',
    polls,
    pagination: result.pagination || { page, totalPages: 1 },
    successMessage: req.flash ? req.flash('success')[0] : null
  });
}));

// View poll
router.get('/:id', asyncRoute(async (req, res) => {
  const result = await getPoll(req.token, req.params.id);
  const poll = normalizeResponse(result.poll || result);

  res.render('polls/detail', {
    title: poll.title || poll.question || 'Poll',
    poll,
    successMessage: req.flash ? req.flash('success')[0] : null,
    errorMessage: req.flash ? req.flash('error')[0] : null
  });
}, { notFoundTitle: 'Poll not found' }));

// Vote on poll
router.post('/:id/vote', asyncRoute(async (req, res) => {
  const { id } = req.params;
  const { option_id, option_ids } = req.body;

  try {
    const voteData = {};
    if (option_ids) {
      voteData.option_ids = Array.isArray(option_ids) ? option_ids.map(Number) : [Number(option_ids)];
    } else if (option_id) {
      // Backend only accepts option_ids (array), not option_id (single)
      voteData.option_ids = [Number(option_id)];
    }

    await votePoll(req.token, id, voteData);

    if (req.flash) {
      req.flash('success', 'Your vote has been recorded');
    }
  } catch (error) {
    if (error instanceof ApiError && error.status !== 401) {
      if (req.flash) {
        req.flash('error', error.message || 'Unable to record vote');
      }
      return redirectTo(res, `/polls/${id}`);
    }
    throw error;
  }

  redirectTo(res, `/polls/${id}`);
}));

module.exports = router;
