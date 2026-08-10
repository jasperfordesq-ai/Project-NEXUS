// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const QRCode = require('qrcode-svg');
const {
  ApiError,
  getPartnerVenues,
  getVenuePass,
  rotateVenuePass,
  getMyVenueVisits,
  recordVenueVisit
} = require('../lib/api');
const { asyncRoute } = require('../lib/routeHelpers');
const { formatLocaleDate } = require('../lib/localization');

const router = express.Router();

// Matches the Blade route constraint `where('token', '[A-Za-z0-9]+')`, so a
// malformed pass token is a routing miss rather than an API call.
const PASS_TOKEN = /^[A-Za-z0-9]+$/;

/**
 * Render the member pass QR as inline SVG, server-side.
 *
 * The Blade page does this with endroid/qr-code's SvgWriter because the
 * accessible frontend must work with no JavaScript and no external request —
 * a client-side QR renderer or a third-party image URL would break both. This
 * is the Node equivalent (qrcode-svg, MIT, zero dependencies).
 *
 * Error correction is Medium to match Blade. The quiet zone is expressed in
 * MODULES here (4, the QR specification minimum) where endroid takes pixels
 * (12), so the border is equivalent in purpose rather than identical in width.
 * The encoded content is the same check-in URL the React pass encodes, so staff
 * scanning either pass land on one canonical flow.
 */
function passQrSvg(qrUrl) {
  const content = typeof qrUrl === 'string' ? qrUrl.trim() : '';
  if (content === '') return null;

  try {
    return new QRCode({
      content,
      padding: 4,
      width: 260,
      height: 260,
      color: '#0b0c0c',
      background: '#ffffff',
      ecl: 'M',
      join: true
    }).svg();
  } catch {
    // A pass whose QR cannot be encoded must still render its page — the
    // rotate control is how a member recovers.
    return null;
  }
}

function unwrap(result) {
  return result?.data && typeof result.data === 'object' ? result.data : (result || {});
}

router.get('/', asyncRoute(async (req, res) => {
  const result = await getPartnerVenues(req.token);
  const data = unwrap(result);

  return res.render('venues/index', {
    title: res.locals.t('govuk_alpha_venues.index.title'),
    activeNav: 'venues',
    venues: Array.isArray(data.venues) ? data.venues : []
  });
}));

router.get('/pass', asyncRoute(async (req, res) => {
  const [passResult, visitsResult] = await Promise.all([
    getVenuePass(req.token),
    getMyVenueVisits(req.token)
  ]);

  const pass = unwrap(passResult);
  const visits = (() => {
    const data = unwrap(visitsResult);
    return Array.isArray(data.visits) ? data.visits : [];
  })();
  const locale = res.locals.locale || 'en';

  return res.render('venues/pass', {
    title: res.locals.t('govuk_alpha_venues.pass.title'),
    activeNav: 'venues',
    pass,
    qrSvg: passQrSvg(pass.qr_url),
    // Blade renders `translatedFormat('j F Y')` per visit.
    visits: visits.map((visit) => ({
      ...visit,
      visitedOnLabel: formatLocaleDate(visit?.visited_on, locale, {
        day: 'numeric', month: 'long', year: 'numeric'
      })
    })),
    rotated: req.query.status === 'rotated',
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.post('/pass/rotate', asyncRoute(async (req, res) => {
  await rotateVenuePass(req.token);

  // Redirect-after-post, so a refresh does not rotate the pass again. The
  // status flag drives the success banner, exactly as Blade does.
  return res.redirect(`${res.locals.urlFor('/venues/pass')}?status=rotated`);
}));

router.get('/checkin/:token', asyncRoute(async (req, res) => {
  if (!PASS_TOKEN.test(String(req.params.token))) {
    return res.status(404).render('errors/404', {
      title: res.locals.t('govuk_alpha_venues.checkin.title')
    });
  }

  // Deliberately records NOTHING on GET: link-preview crawlers prefetch URLs,
  // and a scanned pass must not be consumed by a prefetch. The visit happens
  // only on the POST below.
  return res.render('venues/checkin', {
    title: res.locals.t('govuk_alpha_venues.checkin.title'),
    activeNav: 'venues',
    token: req.params.token,
    result: null,
    venueChoices: [],
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

router.post('/checkin/:token', asyncRoute(async (req, res) => {
  const passToken = String(req.params.token);
  if (!PASS_TOKEN.test(passToken)) {
    return res.status(404).render('errors/404', {
      title: res.locals.t('govuk_alpha_venues.checkin.title')
    });
  }

  const rawVenueId = req.body?.venue_id;
  const venueId = rawVenueId !== undefined && rawVenueId !== null && String(rawVenueId).trim() !== ''
    && Number.isFinite(Number(rawVenueId))
    ? Number(rawVenueId)
    : null;

  let result;
  try {
    result = unwrap(await recordVenueVisit(req.token, passToken, venueId));
  } catch (error) {
    // The Blade page calls the service directly and receives every outcome as
    // a STATUS string. The HTTP contract converts two of them into error
    // codes (invalid_pass -> 404, forbidden -> 403), so they are mapped back
    // here to render the same two page states. Without this the staff member
    // sees a generic error page instead of "this pass is not valid" or "you
    // cannot record visits", which is the difference between a usable message
    // and a dead end.
    if (error instanceof ApiError && error.status === 404) {
      result = { status: 'invalid_pass' };
    } else if (error instanceof ApiError && error.status === 403) {
      result = { status: 'forbidden' };
    } else {
      throw error;
    }
  }

  return res.render('venues/checkin', {
    title: res.locals.t('govuk_alpha_venues.checkin.title'),
    activeNav: 'venues',
    token: passToken,
    result,
    venueChoices: Array.isArray(result?.venues) ? result.venues : [],
    csrfToken: req.csrfToken ? req.csrfToken() : ''
  });
}));

module.exports = router;
