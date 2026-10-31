// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
'use strict';

const { createHash } = require('node:crypto');
const { callUserSettingsApi, callUgcTranslateApi } = require('./api');
const { isPermanentTranslationFailure } = require('./translate-failure');
const preferencesKey = Symbol('ugcTranslationPreferences');
const locales = new Set(['en', 'ga', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'pl', 'ja', 'ar']);

async function preferences(req, res, token) {
  if (!req[preferencesKey]) {
    req[preferencesKey] = Promise.resolve().then(() => callUserSettingsApi(token, 'GET', '/preferences'))
      .then(result => result?.data?.translation || {}).catch(() => ({}));
  }
  const value = await req[preferencesKey];
  const interfaceLocale = String(req.locale || res.locals.locale || 'en').slice(0, 2);
  return { automatic: value.auto_translate_ugc === true, locale: locales.has(value.auto_translate_target_locale)
    && value.auto_translate_ugc === true ? value.auto_translate_target_locale : (locales.has(interfaceLocale) ? interfaceLocale : 'en') };
}

function fingerprint(req, token, locale, spec) {
  return createHash('sha256').update(JSON.stringify([
    req.accessibleRouting?.tenant?.id || req.tenant?.id, token, locale, spec.type, String(spec.id), spec.fields
  ])).digest('hex');
}

/** Fields come exclusively from the authorised content API, never the submitted form. */
async function translateFields(req, res, token, spec, manual = false) {
  const tenant = req.accessibleRouting?.tenant || res.locals.tenant;
  if (!token || tenant?.translation?.enabled === false) return null;
  const preference = await preferences(req, res, token);
  const signature = fingerprint(req, token, preference.locale, spec);
  if (!manual) {
    const saved = req.session?.ugcTranslation;
    if (saved?.signature === signature) delete req.session.ugcTranslation;
    if (req.query?.translation === 'original') return null;
    if (saved?.signature === signature) return saved;
    if (!preference.automatic) return null;
  }
  const entries = Object.entries(spec.fields).filter(([, value]) => typeof value === 'string' && value.trim());
  const results = await Promise.allSettled(entries.map(([key, text]) => callUgcTranslateApi(token, {
    content_type: key === 'body' ? spec.type : `${spec.type}_${key}`,
    content_id: spec.id, source_text: text, target_locale: preference.locale,
    ...(!manual ? { cache_only: true } : {})
  })));
  const fields = {};
  results.forEach((result, index) => {
    const text = result.status === 'fulfilled' ? result.value?.data?.translated_text : null;
    if (typeof text === 'string' && text) fields[entries[index][0]] = text;
  });
  if (!Object.keys(fields).length) {
    // Tell the caller it is permanent (no key, switched off), not "try again".
    if (manual && results.some((result) => result.status === 'rejected' && isPermanentTranslationFailure(result.reason))) {
      req.translationUnavailable = true;
    }
    return null;
  }
  return { fields, locale: preference.locale, signature, partial: Object.keys(fields).length !== entries.length };
}

/** Reuse a detail page's authorised loader for its no-JavaScript translation action. */
function registerDetailTranslation(router, config) {
  const { asyncRoute } = require('./routeHelpers');
  router.post(config.path || '/:id(\\d+)/translate', asyncRoute(async (req, res) => {
    const token = req.token || req.signedCookies?.token;
    if (!token) return res.redirect(res.locals.urlFor('/login?status=auth-required'));
    const item = await config.load(req, res, token);
    const result = await translateFields(req, res, token, config.spec(item), true);
    if (req.session && result) req.session.ugcTranslation = result;
    const status = result ? 'done' : (req.translationUnavailable ? 'unavailable' : 'failed');
    return res.redirect(res.locals.urlFor(`${config.href(item, req)}?translationStatus=${status}#content-translation`));
  }));
}

async function detailTranslationLocals(req, res, token, item, config) {
  const href = config.href(item, req);
  return {
    contentTranslation: await translateFields(req, res, token, config.spec(item)),
    translationAction: `${href}/translate`, translationOriginal: href,
    translationAvailable: Boolean(token) && (req.accessibleRouting?.tenant || res.locals.tenant)?.translation?.enabled !== false,
    translationFailed: req.query?.translationStatus === 'unavailable' ? 'unavailable' : req.query?.translationStatus === 'failed'
  };
}

async function translationBinding(req, res, token, type, id, fields) {
  const preference = await preferences(req, res, token);
  return fingerprint(req, token, preference.locale, { type, id, fields });
}

async function validSavedTranslation(req, res, token, saved, type, id, fields) {
  if (!saved || req.query?.translation === 'original'
      || (req.accessibleRouting?.tenant || res.locals.tenant)?.translation?.enabled === false) return false;
  return saved.binding === await translationBinding(req, res, token, type, id, fields);
}

async function translateCommentTree(req, res, token, rows) {
  for (const row of rows) {
    const body = require('./html-sanitizer').htmlToPlainText(row.content || row.body || '').slice(0, 8000).trim();
    const result = await translateFields(req, res, token, { type: 'comment', id: row.id, fields: { body } });
    if (result?.fields.body) row.cachedTranslation = { text: result.fields.body, locale: result.locale };
    if (Array.isArray(row.replies)) await translateCommentTree(req, res, token, row.replies);
  }
  return rows;
}

module.exports = { translateFields, registerDetailTranslation, detailTranslationLocals,
  preferences, translationBinding, validSavedTranslation, translateCommentTree };
