// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { getContributors } = require('../lib/contributors');
const { ApiError, callNewsletterApi, getPlatformStats, verifyEmail } = require('../lib/api');
const { flagEnabled } = require('../lib/accessible-shell');
const { catalogFor, valueInCatalog } = require('../lib/localization');
const {
  ALL_CATEGORIES,
  categoryOptions,
  chromeFor,
  filterCatalogue
} = require('../lib/features-catalogue');
const { findRelease, listReleases } = require('../lib/changelog');

const router = express.Router();

// 🔴 FEATURE_KEYS was a hand-written list of six feature names rendered as bullets on
// /features. It is gone: that page now renders the shared 119-feature catalogue (see
// lib/features-catalogue.js). The `features.items.*` translations it used are left in
// lang/*/govuk_alpha.php rather than deleted, because removing keys from eleven locale
// files to tidy up is a larger change than it looks and buys nothing.

function communityName(res) {
  return res.locals.tenantName || res.locals.serviceName || 'Project NEXUS Accessible';
}

function routedTenantSlug(req) {
  return String(req.accessibleRouting?.tenantSlug || '').trim();
}

function platformStatsOptions(req) {
  const routing = req.accessibleRouting || {};
  if (routing.mode === 'custom-domain') {
    return { host: String(req.get('host') || routing.tenant?.accessible_domain || '').trim() };
  }

  const slug = String(routing.tenant?.slug || routing.tenantSlug || '').trim();
  return slug ? { slug } : {};
}

function normalizeAboutStats(result, res) {
  const stats = result?.data || result;
  if (!stats || typeof stats !== 'object' || Array.isArray(stats) || !Object.keys(stats).length) {
    return null;
  }

  const number = (value) => res.locals.formatLocaleNumber(value ?? 0, { maximumFractionDigits: 0 });
  return {
    members: number(stats.members),
    hoursExchanged: number(stats.hours_exchanged ?? stats.hoursExchanged),
    listings: number(stats.listings),
    communities: number(stats.communities)
  };
}

function translatedTitle(res, key, fallback) {
  return typeof res.locals.t === 'function' ? res.locals.t(key) : fallback;
}

function aboutContributorsByType() {
  return getContributors().reduce((groups, person) => {
    const type = person.type && Object.prototype.hasOwnProperty.call(groups, person.type)
      ? person.type
      : 'contributor';
    groups[type].push(person);
    return groups;
  }, {
    creator: [],
    founder: [],
    contributor: [],
    acknowledgement: []
  });
}

function catalogArray(res, key) {
  const value = valueInCatalog(catalogFor(res.locals.locale), key);
  return Array.isArray(value) ? value : [];
}

router.get('/about', async (req, res) => {
  const name = communityName(res);
  const contributorGroups = aboutContributorsByType();
  const hasResearchNote = contributorGroups.contributor.some((person) => (
    person.note && person.note.toLowerCase().includes('study')
  ));
  let stats = null;

  try {
    stats = normalizeAboutStats(await getPlatformStats(platformStatsOptions(req)), res);
  } catch {
    // Laravel deliberately hides the optional stats band on any API failure.
  }

  res.render('public-info/about', {
    title: res.locals.t('about.title', { name }),
    titleKey: 'about.title',
    titleReplacements: { name },
    activeNav: 'about',
    communityName: name,
    steps: catalogArray(res, 'about.how_it_works.steps'),
    values: catalogArray(res, 'about.values.items'),
    stats,
    contributorGroups,
    hasResearchNote,
    isAuthenticated: res.locals.isAuthenticated
  });
});

router.get('/guide', (req, res) => {
  const tenant = req.accessibleRouting?.tenant && typeof req.accessibleRouting.tenant === 'object'
    ? req.accessibleRouting.tenant
    : {};

  res.render('public-info/guide', {
    title: res.locals.t('guide.title'),
    titleKey: 'guide.title',
    activeNav: 'guide',
    communityName: communityName(res),
    isAuthenticated: res.locals.isAuthenticated,
    listingsEnabled: flagEnabled(tenant, 'listings', 'modules', true),
    walletEnabled: flagEnabled(tenant, 'wallet', 'modules', true)
  });
});

/**
 * The platform feature catalogue: 8 groups, 119 features, the same list the React
 * /features page renders, from the same shared source.
 *
 * 🔴 This replaced a hand-written list of SIX bullets on 2026-09-18. The two pages are
 * now generated from one catalogue (see lib/features-catalogue.js), so they cannot
 * drift — which the six-bullet version had done comprehensively.
 *
 * Search and category filtering are applied HERE rather than in the browser, so both
 * work with JavaScript switched off. `q` and `category` are the query parameters; the
 * form below submits by GET, so a filtered view is a shareable URL.
 */
router.get('/features', (req, res) => {
  const locale = res.locals.alphaCurrentLocale || 'en';
  const query = typeof req.query.q === 'string' ? req.query.q : '';
  const category = typeof req.query.category === 'string' ? req.query.category : ALL_CATEGORIES;

  const result = filterCatalogue({ locale, query, category });
  const chrome = chromeFor(locale);

  res.render('public-info/features', {
    title: chrome.title || res.locals.t('features.title'),
    activeNav: 'features',
    communityName: communityName(res),
    features: chrome,
    featureGroups: result.groups,
    featureCategories: categoryOptions(locale),
    featureQuery: query,
    featureCategory: result.categoryIsKnown ? category : ALL_CATEGORIES,
    featureShown: result.shown,
    featureTotal: result.total,
    featureIsFiltered: result.isFiltered,
    featureAllCategories: ALL_CATEGORIES,
    changelogUrl: res.locals.urlFor('/changelog')
  });
});

/**
 * The release history, as a list of releases you drill into.
 *
 * 🔴 NOT one page. The React changelog renders the whole 7,900-line file in the
 * browser; the largest single release here is over 2,000 lines on its own. A list plus
 * a page per release is the GOV.UK shape and keeps every page readable on a slow
 * connection or with a screen reader.
 */
router.get('/changelog', (req, res) => {
  res.render('public-info/changelog', {
    title: res.locals.t('changelog.title'),
    titleKey: 'changelog.title',
    activeNav: 'features',
    communityName: communityName(res),
    releases: listReleases(),
    sourceCodeUrl: res.locals.sourceCodeUrl
  });
});

router.get('/changelog/:slug', (req, res, next) => {
  const release = findRelease(req.params.slug);

  // Fall through to the app's own styled 404 rather than inventing one here.
  if (!release) return next();

  return res.render('public-info/changelog-release', {
    title: res.locals.t('changelog.release_title', { version: release.version }),
    activeNav: 'features',
    communityName: communityName(res),
    release,
    changelogUrl: res.locals.urlFor('/changelog'),
    sourceCodeUrl: res.locals.sourceCodeUrl
  });
});

router.get('/faq', (req, res) => {
  res.render('public-info/faq', {
    title: res.locals.t('faq.title'),
    titleKey: 'faq.title',
    activeNav: 'faq',
    communityName: communityName(res),
    faqs: ['1', '2', '3', '4', '5'].map((key) => ({
      question: res.locals.t(`faq.q${key}`),
      answer: res.locals.t(`faq.a${key}`)
    }))
  });
});

/**
 * Which failure state a token check should report.
 *
 * 🔴 Both of these pages used to answer 'invalid' for EVERY failure, so a
 * backend that was merely unreachable told a member their perfectly good
 * verification or unsubscribe link was broken — and the page then advised them
 * to request another one, which would have failed the same way. Only the backend
 * can judge a token, and it only does so on a 4xx; a timeout, an offline API or
 * a 5xx says nothing about the link, and a 429 means try again shortly.
 */
function tokenFailureState(error) {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.status !== 429) {
    return 'invalid';
  }

  return 'unavailable';
}

router.get('/newsletter/unsubscribe', async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  let state = 'missing';

  if (token) {
    const query = new URLSearchParams({ token });
    try {
      await callNewsletterApi('GET', `?${query.toString()}`);
      state = 'success';
    } catch (error) {
      state = tokenFailureState(error);
    }
  }

  res.render('public-info/newsletter-unsubscribe', {
    title: translatedTitle(res, 'auth.unsubscribe_title', 'Unsubscribe from emails'),
    activeNav: '',
    state
  });
});

router.get('/verify-email', async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  let state = 'missing';

  if (token) {
    try {
      const result = await verifyEmail(token, routedTenantSlug(req));
      const verified = Boolean(result?.data?.verified ?? result?.verified);
      // A 200 that reports verified:false IS the backend judging the token.
      state = verified ? 'success' : 'invalid';
    } catch (error) {
      state = tokenFailureState(error);
    }
  }

  res.render('public-info/email-verify', {
    title: translatedTitle(res, 'auth.verify_email_title', 'Verify your email address'),
    activeNav: 'login',
    state
  });
});

module.exports = router;
