// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');

const { getCustomPage } = require('../lib/api');
const { sanitizeCmsHtml } = require('../lib/html-sanitizer');
const { asyncRoute } = require('../lib/routeHelpers');

const router = express.Router();

// 🔴 This file used to be inert. `pages` was an EMPTY object literal, so
// `staticPaths.length > 0` was false and the router registered NOTHING — while
// React served every community's own published pages at `/page/:slug`. Any custom
// page a community wrote (its own guidance, a local policy, a campaign page) was
// simply invisible on the accessible frontend, with no error and nothing in a log
// to notice. Found on 2026-08-17 by diffing web-uk against React's routes rather
// than against the retired Blade inventory, which never had this page either.
//
// The hardcoded map below is kept because it is still the mechanism the legacy
// preparation pages use; real content now comes from Laravel.
const pages = {};

const staticPaths = Object.keys(pages);

if (staticPaths.length > 0) {
  router.get(staticPaths, (req, res) => {
    const page = pages[req.path];
    res.render('static-page', {
      title: page.title,
      body: page.body,
      returnUrl: req.query.return || ''
    });
  });
}

// A community's own CMS page. Public: no sign-in, and the tenant comes from the
// request context, exactly as Laravel's public route expects.
//
// The slug pattern is deliberately narrow rather than a catch-all `:slug`. It is
// interpolated into an upstream URL, so restricting it here (plus
// encodeURIComponent in the api helper) keeps this route in the same shape as
// every other id-in-URL route that was cleared for injection.
router.get('/page/:slug([A-Za-z0-9][A-Za-z0-9_-]{0,119})', asyncRoute(async (req, res) => {
  const slug = String(req.params.slug);
  let page;

  try {
    const result = await getCustomPage(slug);
    page = (result && result.data) || result || {};
  } catch (error) {
    // 404 covers both "no such published page" and Laravel's deliberate
    // fail-closed refusal of a page that references member-account data. Neither
    // is an error worth alarming about; both are "this page is not here".
    if (error && error.status === 404) {
      return res.status(404).render('errors/404', {
        title: res.locals.t('error_pages.404_title'),
        errorTitle: res.locals.t('error_pages.404_title'),
        errorMessage: res.locals.t('error_pages.404_body')
      });
    }
    // Anything else (offline API, 5xx) is a real fault and belongs on the error
    // page rather than being dressed up as a missing page.
    throw error;
  }

  const title = String(page.title || '').trim() || res.locals.t('error_pages.404_title');

  return res.render('custom-page', {
    title,
    activeNav: '',
    metaDescription: String(page.meta_description || '').trim(),
    page: {
      title,
      // Editorial HTML from the community's own CMS: sanitized before it reaches
      // the template, which renders it with `| safe`.
      content: sanitizeCmsHtml(page.content || ''),
      updatedAt: page.updated_at || null
    }
  });
}));

module.exports = router;
module.exports.pages = pages;
