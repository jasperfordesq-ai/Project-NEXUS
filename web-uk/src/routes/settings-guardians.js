// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { getMyGuardians, getMyWards, respondToGuardian, updateGuardianPermissions } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { formatLocaleDate } = require('../lib/localization');

const router = express.Router();

/**
 * Guardian arrangements, member side.
 *
 * 🔴 Coordinators record that someone is responsible for supporting a member.
 * That member is the SUBJECT of the arrangement and the only person who can
 * answer it. Web UK had no screen for this at all, so a member using this
 * frontend could not see an arrangement, agree to it, refuse it or withdraw —
 * on the frontend most likely to be used by the very people these arrangements
 * are about. The project's safeguarding notes are explicit that an API with no
 * caller is not a fix, and that a screen in one frontend is not a fix either.
 *
 * HTML-first by design: every action is a plain form POST with a submit button.
 * Nothing here requires JavaScript.
 *
 * 🔴 An arrangement is a RECORD, not a capability. Agreeing to one grants
 * nothing. What the guardian may actually DO is a separate decision, made only
 * by the supported member, and offered only after they have agreed — a grant
 * must never stand in for the consent.
 */

// Mirrors GuardianArrangementService::ALLOWED_FROM, so the page never offers an
// answer the backend will refuse.
const NEXT_ACTIONS = Object.freeze({
  pending: ['consented', 'declined'],
  consented: ['withdrawn'],
  declined: ['consented'],
  withdrawn: ['consented']
});

const WARD_ACTIONS = Object.freeze(['consented', 'declined', 'withdrawn']);

// Levels the supported member may grant. `assist` is deliberately NOT offered:
// there is no draft-only screen behind it.
const GRANTABLE_TIERS = Object.freeze(['none', 'co_decide', 'represent']);
const TIER_CAPABILITIES = Object.freeze(['listings', 'credits']);

const SUCCESS_STATES = Object.freeze([
  'guardian-consented', 'guardian-declined', 'guardian-withdrawn', 'guardian-tiers-saved'
]);
const ERROR_STATES = Object.freeze([
  'guardian-not-found', 'guardian-not-allowed', 'guardian-failed', 'guardian-tiers-failed'
]);
const STATUS_KEYS = Object.freeze({
  'guardian-consented': 'status_consented',
  'guardian-declined': 'status_declined',
  'guardian-withdrawn': 'status_withdrawn',
  'guardian-tiers-saved': 'status_tiers_saved',
  'guardian-tiers-failed': 'status_tiers_failed',
  'guardian-not-found': 'status_not_found',
  'guardian-not-allowed': 'status_not_allowed',
  'guardian-failed': 'status_failed'
});

const STATE_TAG_CLASS = Object.freeze({
  consented: 'govuk-tag--green',
  declined: 'govuk-tag--red',
  withdrawn: 'govuk-tag--grey',
  pending: 'govuk-tag--yellow'
});

function unwrap(result) {
  return result?.data && typeof result.data === 'object' ? result.data : (result || {});
}

function positiveInt(value) {
  const number = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function redirectToGuardians(res, status) {
  return res.redirect(`${res.locals.urlFor('/settings/guardians')}?status=${encodeURIComponent(status)}`);
}

router.get('/', asyncRoute(async (req, res) => {
  const locale = res.locals.locale || 'en';

  // A failure on either side must not blank the page: a member needs to see the
  // arrangements that DID load. Blade swallows both the same way.
  const [guardiansResult, wardsResult] = await Promise.all([
    getMyGuardians(req.token).catch(() => null),
    getMyWards(req.token).catch(() => null)
  ]);

  const guardians = (() => {
    const data = unwrap(guardiansResult);
    return Array.isArray(data.guardians) ? data.guardians : [];
  })();
  const wards = (() => {
    const data = unwrap(wardsResult);
    return Array.isArray(data.wards) ? data.wards : [];
  })();

  const status = typeof req.query.status === 'string' ? req.query.status : null;

  return res.render('settings/guardians', {
    title: res.locals.t('govuk_alpha_settings.guardians.title'),
    activeNav: 'account',
    guardians: guardians.map((guardian) => {
      const state = guardian?.state || 'pending';
      const tiers = guardian?.tiers && typeof guardian.tiers === 'object' ? guardian.tiers : {};
      return {
        ...guardian,
        id: positiveInt(guardian?.id),
        state,
        stateTagClass: STATE_TAG_CLASS[state] || STATE_TAG_CLASS.pending,
        allowedActions: NEXT_ACTIONS[state] || ['consented'],
        addedOnLabel: guardian?.assigned_at
          ? formatLocaleDate(guardian.assigned_at, locale, { day: 'numeric', month: 'long', year: 'numeric' })
          : null,
        // One row per capability so the template needs no lookups.
        capabilities: TIER_CAPABILITIES.map((capability) => ({
          key: capability,
          current: tiers[capability] || 'none'
        }))
      };
    }),
    wards: wards.map((ward) => {
      const state = ward?.state || 'pending';
      return { ...ward, state, stateTagClass: STATE_TAG_CLASS[state] || STATE_TAG_CLASS.pending };
    }),
    grantableTiers: GRANTABLE_TIERS,
    statusKey: status ? STATUS_KEYS[status] || null : null,
    statusIsSuccess: SUCCESS_STATES.includes(status),
    statusIsError: ERROR_STATES.includes(status),
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

/**
 * One handler for agree, refuse and withdraw — the action is a form field, so
 * the page uses plain submit buttons and needs no JavaScript.
 */
router.post('/respond', asyncRoute(async (req, res) => {
  const assignmentId = positiveInt(req.body?.assignment_id);
  const action = String(req.body?.action ?? '');
  const reason = typeof req.body?.reason === 'string' ? req.body.reason : '';

  if (assignmentId <= 0 || !WARD_ACTIONS.includes(action)) {
    return redirectToGuardians(res, 'guardian-failed');
  }

  try {
    await respondToGuardian(req.token, action, assignmentId, reason);
  } catch (error) {
    // "That is not yours" and "you cannot do that from here" need different
    // wording for the member, so the two are reported distinctly rather than
    // collapsed into one failure.
    const status = error?.status === 404
      ? 'guardian-not-found'
      : (error?.status === 422 || error?.status === 409 ? 'guardian-not-allowed' : 'guardian-failed');
    return redirectToGuardians(res, status);
  }

  return redirectToGuardians(res, `guardian-${action}`);
}));

/**
 * What the guardian may actually do — the supported member's decision, and the
 * only place it can be made. The guardian-driven linked-accounts path refuses
 * staff-recorded arrangements outright, so without this the levels are
 * unreachable for any pair a coordinator recorded.
 */
router.post('/permissions', asyncRoute(async (req, res) => {
  const assignmentId = positiveInt(req.body?.assignment_id);
  const capability = String(req.body?.capability ?? '');
  const tier = String(req.body?.tier ?? '');

  // The tier is checked against the grantable list here as well as server-side.
  // `assist` is not grantable from this page and must not become so by a
  // hand-edited form post.
  if (assignmentId <= 0 || !TIER_CAPABILITIES.includes(capability) || !GRANTABLE_TIERS.includes(tier)) {
    return redirectToGuardians(res, 'guardian-tiers-failed');
  }

  try {
    await updateGuardianPermissions(req.token, assignmentId, capability, tier);
  } catch {
    return redirectToGuardians(res, 'guardian-tiers-failed');
  }

  return redirectToGuardians(res, 'guardian-tiers-saved');
}));

module.exports = router;
