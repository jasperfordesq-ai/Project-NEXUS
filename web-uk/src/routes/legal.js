// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const express = require('express');

const {
  ApiError,
  getLegalDocument,
  getLegalVersions,
  getLegalVersion,
  compareLegalVersions
} = require('../lib/api');
const { sanitizeCmsHtml, sanitizeDiffHtml, withHeadingAnchors } = require('../lib/html-sanitizer');
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

// The public URL segment for each document type. Laravel's own routes hyphenate
// (`/legal/community-guidelines`) while the API type is underscored
// (`community_guidelines`), so the two forms must be translated in both
// directions — an unslugged notification link emits the underscore form.
const SLUG_TO_TYPE = Object.freeze({
  terms: 'terms',
  privacy: 'privacy',
  cookies: 'cookies',
  'community-guidelines': 'community_guidelines',
  community_guidelines: 'community_guidelines',
  'acceptable-use': 'acceptable_use',
  acceptable_use: 'acceptable_use',
  accessibility: 'accessibility'
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

/**
 * The date part of an ISO timestamp, which is what Blade prints
 * (`Str::of($updated)->before('T')`) and what belongs in `<time datetime>`.
 */
function isoDatePart(value) {
  const raw = trimmed(value);
  if (raw === '') return '';
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return match ? match[1] : raw.split('T')[0];
}

/**
 * Is this version not yet in force?
 *
 * 🔴 `effective_date` is routinely set in the FUTURE — a policy published now to
 * take effect next month. The page must say so, because otherwise it presents
 * terms that do not yet apply as though they do. Compared date-only, so a
 * document effective today is in force from the start of the day everywhere.
 */
function isFutureDate(value, now = new Date()) {
  const day = isoDatePart(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return day > now.toISOString().slice(0, 10);
}

function normalizeDocument(result, docType, t) {
  const row = dataFrom(result);
  if (!row || typeof row !== 'object' || !trimmed(row.content)) return null;

  // 🔴 Images are ALLOWED, matching `HtmlSanitizer::sanitizeCms()`, which Blade
  // renders legal content through. web-uk passed `{ allowImages: false }`, so a
  // published policy containing a diagram — an accessibility measure in its own
  // right — silently lost it on this frontend only. The sanitiser handles `img`
  // safely: `src` is restricted to http/https/data and every event handler
  // attribute is stripped.
  const { html, headings } = withHeadingAnchors(sanitizeCmsHtml(row.content));
  const effectiveDate = row.effective_date || row.updated_at || '';

  return {
    type: trimmed(row.type || row.document_type) || docType,
    title: trimmed(row.title) || t(`legal.documents.${docType}.title`),
    content: html,
    headings,
    updatedAt: effectiveDate,
    updatedAtIso: isoDatePart(effectiveDate),
    notYetInForce: isFutureDate(row.effective_date),
    versionNumber: trimmed(row.version_number),
    // Both were being dropped. `summary_of_changes` is the tenant's own
    // explanation of what changed, which is the single most useful thing on the
    // page when a document has just been updated; `has_previous_versions` is what
    // decides whether the history link is worth showing.
    summaryOfChanges: trimmed(row.summary_of_changes),
    hasPreviousVersions: row.has_previous_versions === true
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
  } else if (type === 'community_guidelines' || type === 'acceptable_use') {
    const prefix = type === 'community_guidelines' ? 'community' : 'acceptable';
    config.fallbackIntro = res.locals.t(`legal.fallback.${prefix}_intro`, { name: community });
    config.sections = catalogCollection(res, `legal.fallback.${prefix}_sections`);
  }
  return config;
}

/**
 * The accessibility statement.
 *
 * Blade renders this entirely from translated prose and never asks the API, so a
 * community that has published its own `accessibility` legal document has it
 * silently ignored. `accessibility` IS a valid document type
 * (`LegalController::VALID_TYPES`), so it is fetched here and the static
 * statement stays as the fallback — which is what every community sees today.
 */
router.get('/accessibility', asyncRoute(async (req, res) => {
  const community = communityName(res);

  return res.render('legal/accessibility', {
    title: res.locals.t('accessibility.title'),
    titleKey: 'accessibility.title',
    activeNav: 'accessibility',
    communityName: community,
    document: await fetchLegalDocument('accessibility', res.locals.t)
  });
}, { notFoundTitle: 'Page not found' }));

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
      docSlug: DOCUMENT_PATHS[type].replace('/legal/', ''),
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

// Version history. Laravel's accessible frontend has no equivalent — these are
// deliberate additions, recorded as extra web-uk routes in the route matrix. They
// are parameterised by slug rather than written out five times so that adding a
// document type does not mean adding three more routes.
//
// 🔴 `compare` MUST be registered before `:versionId`, or Express matches the
// literal segment as a version id and the comparison page becomes unreachable.

function slugType(req) {
  return SLUG_TO_TYPE[String(req.params.type || '').toLowerCase()] || null;
}

function versionRows(result) {
  const payload = dataFrom(result) || {};
  const rows = Array.isArray(payload.versions) ? payload.versions : [];

  return rows.map((row) => ({
    id: row.id,
    versionNumber: trimmed(row.version_number),
    versionLabel: trimmed(row.version_label),
    effectiveDate: row.effective_date || '',
    effectiveDateIso: isoDatePart(row.effective_date),
    publishedAt: row.published_at || '',
    publishedAtIso: isoDatePart(row.published_at),
    isCurrent: row.is_current === true,
    notYetInForce: isFutureDate(row.effective_date),
    summaryOfChanges: trimmed(row.summary_of_changes)
  }));
}

router.get('/legal/:type/versions', asyncRoute(async (req, res) => {
  const type = slugType(req);
  if (!type || type === 'accessibility') {
    return res.status(404).render('errors/404', { title: res.locals.t('error_pages.404_title') });
  }

  const config = documentConfig(res, type, communityName(res));
  const payload = dataFrom(await getLegalVersions(type)) || {};
  const versions = versionRows({ data: payload });

  return res.render('legal/versions', {
    title: res.locals.t('legal.versions_title'),
    activeNav: 'legal',
    communityName: communityName(res),
    docType: type,
    docSlug: String(req.params.type),
    documentTitle: trimmed(payload.title) || config.title,
    versions
  });
}, { notFoundTitle: 'Legal document not found' }));

router.get('/legal/:type/versions/compare', asyncRoute(async (req, res) => {
  const type = slugType(req);
  if (!type || type === 'accessibility') {
    return res.status(404).render('errors/404', { title: res.locals.t('error_pages.404_title') });
  }

  const config = documentConfig(res, type, communityName(res));
  const from = trimmed(req.query.v1);
  const to = trimmed(req.query.v2);

  const base = {
    title: res.locals.t('legal.compare_title'),
    activeNav: 'legal',
    communityName: communityName(res),
    docType: type,
    docSlug: String(req.params.type),
    documentTitle: config.title,
    from: null,
    to: null,
    diffHtml: '',
    changesCount: 0,
    unavailable: false
  };

  if (!/^\d+$/.test(from) || !/^\d+$/.test(to)) {
    return res.status(404).render('errors/404', { title: res.locals.t('error_pages.404_title') });
  }

  let comparison;
  try {
    comparison = dataFrom(await compareLegalVersions(from, to));
  } catch (error) {
    // 404 means one of the versions is a draft, missing, or another tenant's —
    // that is a not-found page. 400 means the pair spans two documents, and 429
    // means the comparison rate limit tripped (30 per 10 minutes). Neither of
    // those is "this page does not exist", so they degrade instead: the page
    // still renders with a link back to the history.
    if (error instanceof ApiError && error.status === 404) {
      return res.status(404).render('errors/404', { title: res.locals.t('error_pages.404_title') });
    }
    if (error instanceof ApiError && (error.status === 400 || error.status === 429)) {
      return res.render('legal/compare', { ...base, unavailable: true });
    }
    throw error;
  }

  const version = (row) => (row ? versionRows({ data: { versions: [row] } })[0] : null);

  return res.render('legal/compare', {
    ...base,
    from: version(comparison?.version1),
    to: version(comparison?.version2),
    // 🔴 Sanitised with the diff-specific allowlist, which keeps `<ins>`/`<del>`.
    // The CMS allowlist strips both, which would leave colour as the only signal
    // of what changed.
    diffHtml: sanitizeDiffHtml(comparison?.diff_html),
    changesCount: Number(comparison?.changes_count || 0)
  });
}, { notFoundTitle: 'Legal document not found' }));

router.get('/legal/:type/versions/:versionId', asyncRoute(async (req, res) => {
  const type = slugType(req);
  const versionId = trimmed(req.params.versionId);
  if (!type || type === 'accessibility' || !/^\d+$/.test(versionId)) {
    return res.status(404).render('errors/404', { title: res.locals.t('error_pages.404_title') });
  }

  const config = documentConfig(res, type, communityName(res));

  let row;
  try {
    row = dataFrom(await getLegalVersion(versionId));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      return res.status(404).render('errors/404', { title: res.locals.t('error_pages.404_title') });
    }
    throw error;
  }

  // The version id is global, so a version belonging to a DIFFERENT document
  // type would otherwise render under this document's heading and back links.
  if (!row || trimmed(row.document_type) !== type) {
    return res.status(404).render('errors/404', { title: res.locals.t('error_pages.404_title') });
  }

  const { html, headings } = withHeadingAnchors(sanitizeCmsHtml(row.content));

  return res.render('legal/version', {
    title: trimmed(row.title) || config.title,
    activeNav: 'legal',
    communityName: communityName(res),
    docType: type,
    docSlug: String(req.params.type),
    document: {
      title: trimmed(row.title) || config.title,
      content: html,
      headings,
      versionNumber: trimmed(row.version_number),
      versionLabel: trimmed(row.version_label),
      updatedAt: row.effective_date || '',
      updatedAtIso: isoDatePart(row.effective_date),
      publishedAt: row.published_at || '',
      publishedAtIso: isoDatePart(row.published_at),
      isCurrent: row.is_current === true,
      notYetInForce: isFutureDate(row.effective_date),
      summaryOfChanges: trimmed(row.summary_of_changes)
    }
  });
}, { notFoundTitle: 'Legal document not found' }));

// 🔴 `/terms` and `/privacy` used to 404. Two unrouted views existed for them
// (`views/terms.njk`, `views/privacy.njk`) carrying hardcoded English legal prose
// and no SPDX header; both are deleted. These redirects are not only tidiness:
// `LegalDocumentService::notifyUsersOfUpdate()` has been emitting React-shaped
// `/terms` links in the notification bell for a long time, so every one of those
// already-sent links currently dead-ends on this frontend.
function permanentDocumentRedirect(to) {
  return (req, res) => {
    const urlFor = typeof res.locals.urlFor === 'function' ? res.locals.urlFor : (value) => value;
    return res.redirect(301, urlFor(to));
  };
}

// Registered as literal paths. `scripts/generate-accessible-route-matrix.js`
// finds routes by matching the registration call and reading its first argument
// as a literal, so a path passed in through a helper would be invisible to it —
// which has already hidden three working routes once.
//
// 🔴 And do not quote a registration call in a comment here: the generator's
// match is textual, so a quoted example is picked up as a real route. Doing
// exactly that produced a phantom `GET /...` row in the matrix.
router.get('/terms', permanentDocumentRedirect('/legal/terms'));
router.get('/privacy', permanentDocumentRedirect('/legal/privacy'));

module.exports = router;
