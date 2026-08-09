'use strict';

const {
  SUPPORTED_LOCALES,
  createChoiceTranslator,
  createTranslator,
  formatLocaleDate,
  formatLocaleNumber,
  formatLocaleRelativeTime,
  isSupportedLocale
} = require('../lib/localization');
const { runWithRequestLocale } = require('../lib/request-locale-context');
const { getRequestProfile } = require('../lib/request-profile');

function localeFromAcceptLanguage(headerValue) {
  if (typeof headerValue !== 'string' || !headerValue.trim()) return null;

  const candidates = headerValue
    .split(',')
    .map((part, index) => {
      const [rawTag, ...parameters] = part.trim().split(';');
      let quality = 1;
      for (const parameter of parameters) {
        const match = parameter.trim().match(/^q=(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/i);
        if (match) quality = Number(match[1]);
      }
      return { rawTag, quality, index };
    })
    .filter(({ rawTag, quality }) => rawTag && rawTag !== '*' && quality > 0)
    .sort((left, right) => right.quality - left.quality || left.index - right.index);

  for (const candidate of candidates) {
    const normalizedTag = candidate.rawTag.toLowerCase();
    if (isSupportedLocale(normalizedTag)) return normalizedTag;
    const baseLocale = normalizedTag.split('-')[0];
    if (isSupportedLocale(baseLocale)) return baseLocale;
  }

  return null;
}

function preferredLocaleFromRequest(req, res) {
  const candidates = [
    req.user,
    req.profile,
    req.currentUser,
    res?.locals?.user,
    res?.locals?.profile,
    res?.locals?.currentUser
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const value = candidate.preferred_language || candidate.preferredLanguage;
    if (isSupportedLocale(value)) return value;
  }

  return null;
}

function preferredLocaleFromProfilePayload(payload) {
  const candidates = [
    payload,
    payload?.data,
    payload?.user,
    payload?.profile,
    payload?.account,
    payload?.data?.user,
    payload?.data?.profile,
    payload?.data?.account
  ];

  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') continue;
    const value = candidate.preferred_language || candidate.preferredLanguage;
    if (isSupportedLocale(value)) return value;
  }

  return null;
}

function resolveRequestLocale(req, res = {}) {
  const queryLocale = typeof req.query?.locale === 'string' ? req.query.locale : null;
  if (isSupportedLocale(queryLocale)) {
    if (req.session) req.session.locale = queryLocale;
    return queryLocale;
  }

  const sessionLocale = req.session?.locale;
  if (isSupportedLocale(sessionLocale)) return sessionLocale;

  const preferredLocale = preferredLocaleFromRequest(req, res);
  if (preferredLocale) {
    if (req.session) req.session.locale = preferredLocale;
    return preferredLocale;
  }

  return localeFromAcceptLanguage(req.get?.('accept-language') || req.headers?.['accept-language']) || 'en';
}

async function resolveRequestLocaleWithProfile(req, res = {}) {
  const queryLocale = typeof req.query?.locale === 'string' ? req.query.locale : null;
  if (isSupportedLocale(queryLocale)) {
    if (req.session) req.session.locale = queryLocale;
    return queryLocale;
  }

  const sessionLocale = req.session?.locale;
  if (isSupportedLocale(sessionLocale)) return sessionLocale;

  const availablePreference = preferredLocaleFromRequest(req, res);
  if (availablePreference) {
    if (req.session) req.session.locale = availablePreference;
    return availablePreference;
  }

  const token = req.signedCookies?.token;
  if (typeof token === 'string' && token) {
    try {
      const profile = await getRequestProfile(req, token);
      const profilePreference = preferredLocaleFromProfilePayload(profile);
      if (profilePreference) {
        if (req.session) req.session.locale = profilePreference;
        return profilePreference;
      }
    } catch {
      // Locale discovery is best-effort and must never make a page unavailable.
    }
  }

  return localeFromAcceptLanguage(req.get?.('accept-language') || req.headers?.['accept-language']) || 'en';
}

async function localization(req, res, next) {
  try {
    const locale = await resolveRequestLocaleWithProfile(req, res);
    const t = createTranslator(locale);
    const tc = createChoiceTranslator(locale);

    req.locale = locale;
    req.t = t;
    req.tc = tc;

    res.locals.locale = locale;
    res.locals.htmlLang = locale;
    res.locals.htmlDirection = locale === 'ar' ? 'rtl' : 'ltr';
    res.locals.t = t;
    res.locals.tc = tc;
    res.locals.formatLocaleNumber = (value, options = {}) => formatLocaleNumber(value, locale, options);
    res.locals.formatLocaleDate = (value, options = {}) => formatLocaleDate(value, locale, options);
    res.locals.formatLocaleRelativeTime = (value, now = new Date()) => formatLocaleRelativeTime(value, locale, now);
    res.set('Content-Language', locale);

    runWithRequestLocale(locale, next);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  SUPPORTED_LOCALES,
  localeFromAcceptLanguage,
  localization,
  preferredLocaleFromProfilePayload,
  preferredLocaleFromRequest,
  resolveRequestLocale,
  resolveRequestLocaleWithProfile
};
