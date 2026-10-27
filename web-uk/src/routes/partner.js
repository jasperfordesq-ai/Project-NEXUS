// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

/**
 * Timebank Ireland's "Partner With Us" page, ported from React
 * (react-frontend/src/pages/about/PartnerPage.tsx). Public, static content, no API
 * call, and served ONLY for the hour-timebank community, exactly like the other
 * Timebank Ireland pages: React wraps it in `<TenantSlugGate slug="hour-timebank">`
 * (AppRoutes.tsx), and every other community falls through to the ordinary 404
 * (see lib/tbi-pages.js for why a 404 is React's outcome).
 *
 * React's coloured cards become GOV.UK headings, summary text and lists carrying the
 * same text; its three images are served from this frontend's public/images.
 */

const express = require('express');

const { breadcrumbJsonLdFor, pageDescription } = require('../lib/seo-meta');
const { isTbiTenant, relatedPages, requestTenant } = require('../lib/tbi-pages');

const router = express.Router();

const NS = 'govuk_alpha_partner.page.';
// The organisation's own name (React partner.tbuk_heading is the same in every locale).
const TBUK_NAME = 'Timebanking UK';

function range(count) {
  return Array.from({ length: count }, (_, index) => index);
}

router.get('/partner', (req, res, next) => {
  if (!isTbiTenant(requestTenant(req))) return next();
  const text = (key) => res.locals.t(NS + key);
  const title = text('page_title');

  return res.render('tbi-pages/partner', {
    title,
    metaDescription: pageDescription(text('meta_description')),
    breadcrumbJsonLd: breadcrumbJsonLdFor(res, [
      { name: text('breadcrumb_about'), path: '/about' },
      { name: title, path: '/partner' }
    ]),
    activeNav: 'about',
    breadcrumbAbout: text('breadcrumb_about'),
    tbukHeading: TBUK_NAME,
    impactCards: range(3).map((index) => ({
      highlight: text(`impact_card_${index}_highlight`),
      title: text(`impact_card_${index}_title`),
      description: text(`impact_card_${index}_description`)
    })),
    partnershipTypes: range(4).map((index) => ({
      title: text(`partnership_type_${index}_title`),
      description: text(`partnership_type_${index}_description`)
    })),
    // React's learnMoreLinks: impact summary, strategic plan, timebanking guide
    // (/guide on this frontend).
    learnMore: ['/impact-summary', '/strategic-plan', '/guide'].map((href, index) => ({
      href,
      title: text(`learn_more_${index}_title`),
      description: text(`learn_more_${index}_description`)
    })),
    related: relatedPages('/partner', res.locals.t),
    relatedHeading: res.locals.t('govuk_alpha_tbi_pages.related.heading')
  });
});

module.exports = router;
