// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');
const { getContributors } = require('../lib/contributors');
const { callNewsletterApi, getPlatformStats, verifyEmail } = require('../lib/api');
const { flagEnabled } = require('../lib/accessible-shell');
const { catalogFor, valueInCatalog } = require('../lib/localization');

const router = express.Router();

const FEATURE_KEYS = Object.freeze(['find_help', 'wallet', 'events', 'volunteering', 'groups', 'recognition']);

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

router.get('/features', (req, res) => {
  res.render('public-info/features', {
    title: res.locals.t('features.title'),
    activeNav: 'features',
    communityName: communityName(res),
    features: FEATURE_KEYS.map((key) => res.locals.t(`features.items.${key}`))
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

router.get('/newsletter/unsubscribe', async (req, res) => {
  const token = typeof req.query.token === 'string' ? req.query.token.trim() : '';
  let state = 'missing';

  if (token) {
    const query = new URLSearchParams({ token });
    try {
      await callNewsletterApi('GET', `?${query.toString()}`);
      state = 'success';
    } catch {
      state = 'invalid';
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
      state = verified ? 'success' : 'invalid';
    } catch {
      state = 'invalid';
    }
  }

  res.render('public-info/email-verify', {
    title: translatedTitle(res, 'auth.verify_email_title', 'Verify your email address'),
    activeNav: 'login',
    state
  });
});

module.exports = router;
