// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');

const { ApiError, getLegalAcceptanceStatus, acceptAllLegalDocuments } = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { validateReturnUrl } = require('../lib/urlValidator');
const { clearLegalGateCache, normalizeDocuments } = require('../middleware/legal-gate');

const router = express.Router();

const ACCEPTANCE_PATH = '/legal-acceptance';
const LOGIN_AUTH_REQUIRED_PATH = '/login?status=auth-required';

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined ? result.data : result;
}

function redirectTo(res, pathname, status = 302) {
  const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
  return res.redirect(status, urlFor(pathname));
}

/**
 * Where to send the member after accepting.
 *
 * 🔴 Uses the existing `validateReturnUrl` rather than a new check. A
 * return-to parameter is an open-redirect vector, and this app already has one
 * hardened, tested implementation of that decision — a second one would be a
 * second thing to get wrong.
 */
function returnTarget(value) {
  return validateReturnUrl(value, '/');
}

/**
 * The acceptance page.
 *
 * Server-rendered with NO JavaScript: one form, one button, and a way out. That is
 * not a stylistic choice — this page can stand between a member and the whole
 * platform, so it must work in the least capable browser that can reach it.
 */
router.get('/legal-acceptance', asyncRoute(async (req, res) => {
  const token = req.signedCookies.token;
  if (!token) {
    return redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
  }

  const returnTo = returnTarget(req.query.return);
  const status = String(req.query.status || '');

  let documents = [];
  try {
    documents = normalizeDocuments(dataFrom(await getLegalAcceptanceStatus(token)));
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error;
    }
    // Reaching this page with an unreadable status is not a reason to trap
    // somebody. Fall through with nothing pending, which sends them on.
    documents = [];
  }

  // Nothing outstanding — the member accepted in another tab, or arrived here by
  // an old link. Send them where they were going rather than showing an empty
  // form with a button that does nothing.
  if (documents.length === 0) {
    return redirectTo(res, returnTo);
  }

  return res.render('legal/accept', {
    title: res.locals.t('legal.acceptance.title'),
    titleKey: 'legal.acceptance.title',
    activeNav: '',
    documents,
    returnTo,
    error: status === 'failed' ? res.locals.t('legal.acceptance.error') : ''
  });
}, { notFoundTitle: 'Page not found' }));

router.post('/legal-acceptance', asyncRoute(async (req, res) => {
  const token = req.signedCookies.token;
  if (!token) {
    return redirectTo(res, LOGIN_AUTH_REQUIRED_PATH);
  }

  const returnTo = returnTarget(req.body.return);

  try {
    await acceptAllLegalDocuments(token);
  } catch (error) {
    if (!(error instanceof ApiError)) {
      throw error;
    }
    // 🔴 Nothing partial is reported as success. The API records acceptances in a
    // transaction and returns 500 if any of them failed, so a failure here means
    // the member's agreement may not be recorded — and telling them it was would
    // be the one lie this page must never tell.
    return redirectTo(res, `${ACCEPTANCE_PATH}?status=failed&return=${encodeURIComponent(returnTo)}`);
  }

  // 🔴 Clear the cached verdict BEFORE redirecting, or the gate sends the member
  // straight back here — the accept → blocked → accept loop.
  clearLegalGateCache(req);

  return redirectTo(res, returnTo, 303);
}));

module.exports = router;
