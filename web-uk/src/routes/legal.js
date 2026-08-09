// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');

const { ApiError, getLegalDocument } = require('../lib/api');
const { sanitizeCmsHtml } = require('../lib/html-sanitizer');
const { catalogFor, valueInCatalog } = require('../lib/localization');
const { asyncRoute } = require('../lib/routeHelpers');

const router = express.Router();

const DOCUMENT_PATHS = Object.freeze({
  terms: '/legal/terms',
  privacy: '/legal/privacy',
  cookies: '/legal/cookies',
  community_guidelines: '/legal/community-guidelines',
  acceptable_use: '/legal/acceptable-use'
});

function trimmed(value) {
  return String(value || '').trim();
}

function dataFrom(result) {
  return result && typeof result === 'object' && result.data !== undefined ? result.data : result;
}

function communityName(res) {
  const tenant = res.locals.tenant || {};
  return trimmed(tenant.name) || trimmed(tenant.slug) || 'Project NEXUS Accessible';
}

function catalogCollection(res, key) {
  const value = valueInCatalog(catalogFor(res.locals.locale), key);
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') return Object.values(value);
  return [];
}

function normalizeDocument(result, docType, t) {
  const row = dataFrom(result);
  if (!row || typeof row !== 'object' || !trimmed(row.content)) return null;

  return {
    type: trimmed(row.type || row.document_type) || docType,
    title: trimmed(row.title) || t(`legal.documents.${docType}.title`),
    content: sanitizeCmsHtml(row.content, { allowImages: false }),
    updatedAt: row.effective_date || row.updated_at || '',
    versionNumber: trimmed(row.version_number)
  };
}

async function fetchLegalDocument(type, t) {
  try {
    return normalizeDocument(await getLegalDocument(type), type, t);
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

function documentConfig(res, type, community) {
  const config = {
    path: DOCUMENT_PATHS[type],
    title: res.locals.t(`legal.documents.${type}.title`),
    summary: res.locals.t(`legal.documents.${type}.summary`)
  };
  if (type === 'terms' || type === 'privacy') {
    config.fallbackIntro = res.locals.t(`legal.fallback.${type}_intro`, { name: community });
    config.fallbackPoints = catalogCollection(res, `legal.fallback.${type}_points`);
  } else if (type === 'cookies') {
    config.fallbackIntro = res.locals.t('legal.fallback.cookies_intro', { name: community });
    config.cookiesTypesTitle = res.locals.t('legal.fallback.cookies_types_title');
    config.fallbackPoints = catalogCollection(res, 'legal.fallback.cookies_types');
    config.afterList = res.locals.t('legal.fallback.cookies_control');
  } else {
    const prefix = type === 'community_guidelines' ? 'community' : 'acceptable';
    config.fallbackIntro = res.locals.t(`legal.fallback.${prefix}_intro`, { name: community });
    config.sections = catalogCollection(res, `legal.fallback.${prefix}_sections`);
  }
  return config;
}

router.get('/accessibility', (req, res) => {
  const community = communityName(res);

  return res.render('legal/accessibility', {
    title: res.locals.t('accessibility.title'),
    titleKey: 'accessibility.title',
    activeNav: 'accessibility',
    communityName: community
  });
});

router.get('/legal', (req, res) => {
  const community = communityName(res);

  return res.render('legal/hub', {
    title: res.locals.t('legal.hub_title'),
    titleKey: 'legal.hub_title',
    activeNav: 'legal',
    communityName: community,
    documents: [
      ...Object.keys(DOCUMENT_PATHS).map((type) => documentConfig(res, type, community)),
      {
        path: '/accessibility',
        title: res.locals.t('legal.documents.accessibility.title'),
        summary: res.locals.t('legal.documents.accessibility.summary')
      }
    ]
  });
});

function legalDocument(type) {
  return asyncRoute(async (req, res) => {
    const community = communityName(res);
    const config = documentConfig(res, type, community);

    return res.render('legal/document', {
      title: config.title,
      activeNav: 'legal',
      communityName: community,
      docType: type,
      config,
      document: await fetchLegalDocument(type, res.locals.t)
    });
  }, { notFoundTitle: 'Legal document not found' });
}

router.get('/legal/terms', legalDocument('terms'));
router.get('/legal/privacy', legalDocument('privacy'));
router.get('/legal/cookies', legalDocument('cookies'));
router.get('/legal/community-guidelines', legalDocument('community_guidelines'));
router.get('/legal/acceptable-use', legalDocument('acceptable_use'));

module.exports = router;
