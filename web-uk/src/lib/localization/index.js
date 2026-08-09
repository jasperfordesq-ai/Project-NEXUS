'use strict';

const SUPPORTED_LOCALES = Object.freeze([
  'en', 'ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar'
]);

const catalogCache = Object.create(null);

function catalogFor(locale) {
  const supportedLocale = isSupportedLocale(locale) ? locale : 'en';
  if (!catalogCache[supportedLocale]) {
    catalogCache[supportedLocale] = require(`./generated/${supportedLocale}.json`);
  }
  return catalogCache[supportedLocale];
}

const catalogs = {};
for (const locale of SUPPORTED_LOCALES) {
  Object.defineProperty(catalogs, locale, {
    enumerable: true,
    get: () => catalogFor(locale)
  });
}
Object.freeze(catalogs);

const intlLocales = Object.freeze({
  en: 'en-GB',
  ga: 'ga-IE',
  de: 'de-DE',
  fr: 'fr-FR',
  it: 'it-IT',
  pt: 'pt-PT',
  es: 'es-ES',
  nl: 'nl-NL',
  pl: 'pl-PL',
  ja: 'ja-JP',
  ar: 'ar'
});

function isSupportedLocale(value) {
  return typeof value === 'string' && SUPPORTED_LOCALES.includes(value);
}

function valueAtPath(source, key) {
  if (!source || typeof key !== 'string' || !key) return undefined;
  return key.split('.').reduce((value, part) => (
    value && typeof value === 'object' ? value[part] : undefined
  ), source);
}

function valueInCatalog(catalog, key) {
  if (!catalog || typeof key !== 'string' || !key) return undefined;

  const separator = key.indexOf('.');
  const candidateNamespace = separator > 0 ? key.slice(0, separator) : '';
  const hasExplicitNamespace = Object.prototype.hasOwnProperty.call(
    catalog.namespaces || {},
    candidateNamespace
  );
  const namespace = hasExplicitNamespace ? candidateNamespace : 'govuk_alpha';
  const translationKey = hasExplicitNamespace ? key.slice(separator + 1) : key;
  return valueAtPath(catalog.namespaces?.[namespace], translationKey);
}

function interpolate(value, replacements = {}) {
  if (typeof value !== 'string') return value;
  return value.replace(/\{\{([A-Za-z0-9_]+)\}\}|\{([A-Za-z0-9_]+)\}|:([A-Za-z0-9_]+)/g, (match, doubleBraceKey, braceKey, colonKey) => {
    const key = doubleBraceKey || braceKey || colonKey;
    return Object.prototype.hasOwnProperty.call(replacements, key)
      ? String(replacements[key])
      : match;
  });
}

function translate(locale, key, replacements = {}) {
  const selectedCatalog = catalogFor(locale);
  const localized = valueInCatalog(selectedCatalog, key);
  const fallback = valueInCatalog(catalogFor('en'), key);
  const resolved = typeof localized === 'string'
    ? localized
    : (typeof fallback === 'string' ? fallback : key);
  return interpolate(resolved, replacements);
}

function choiceMatches(condition, count) {
  const exact = condition.match(/^\{(-?\d+)\}$/);
  if (exact) return count === Number(exact[1]);

  const leftBracket = condition[0];
  const rightBracket = condition.at(-1);
  if (!['[', ']'].includes(leftBracket) || ![']', '['].includes(rightBracket)) return false;

  const [rawMinimum, rawMaximum, ...extra] = condition.slice(1, -1).split(',').map((part) => part.trim());
  if (extra.length > 0 || !rawMinimum || !rawMaximum) return false;
  const minimum = rawMinimum === '*' ? -Infinity : Number(rawMinimum);
  const maximum = rawMaximum === '*' ? Infinity : Number(rawMaximum);
  if (Number.isNaN(minimum) || Number.isNaN(maximum)) return false;
  const aboveMinimum = leftBracket === '[' ? count >= minimum : count > minimum;
  const belowMaximum = rightBracket === ']' ? count <= maximum : count < maximum;
  return aboveMinimum && belowMaximum;
}

function leadingChoiceCondition(choice) {
  if (choice.startsWith('{')) {
    const end = choice.indexOf('}');
    return end > 0 ? choice.slice(0, end + 1) : '';
  }

  if (!['[', ']'].includes(choice[0])) return '';
  for (let index = 1; index < choice.length; index += 1) {
    if (choice[index] === ']' || choice[index] === '[') {
      return choice.slice(0, index + 1);
    }
  }
  return '';
}

function chooseTranslation(value, count) {
  if (typeof value !== 'string' || !value.includes('|')) return value;

  const choices = value.split('|').map((choice) => choice.trim());
  for (const choice of choices) {
    const condition = leadingChoiceCondition(choice);
    if (condition && choiceMatches(condition, count)) {
      return choice.slice(condition.length).trim();
    }
  }

  const unconditional = choices.filter((choice) => !leadingChoiceCondition(choice));
  if (unconditional.length > 0) {
    return unconditional[count === 1 ? 0 : Math.min(1, unconditional.length - 1)];
  }

  const fallback = choices.at(-1);
  const fallbackCondition = leadingChoiceCondition(fallback);
  return fallback.slice(fallbackCondition.length).trim();
}

function translateChoice(locale, key, count, replacements = {}) {
  const raw = translate(locale, key, { ...replacements, count });
  return interpolate(chooseTranslation(raw, Number(count)), { ...replacements, count });
}

function createTranslator(locale) {
  return (key, replacements = {}) => translate(locale, key, replacements);
}

function createChoiceTranslator(locale) {
  return (key, count, replacements = {}) => translateChoice(locale, key, count, replacements);
}

function localeForIntl(locale) {
  return intlLocales[isSupportedLocale(locale) ? locale : 'en'];
}

function formatLocaleNumber(value, locale, options = {}) {
  if (value === null || value === undefined || value === '') return '';
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return '';
  return new Intl.NumberFormat(localeForIntl(locale), options).format(numeric);
}

function formatLocaleDate(value, locale, options = {}) {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(localeForIntl(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...options
  }).format(date);
}

function formatLocaleRelativeTime(value, locale, now = new Date()) {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  const reference = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime()) || Number.isNaN(reference.getTime())) return '';

  const seconds = (date.getTime() - reference.getTime()) / 1000;
  const units = [
    ['year', 31557600],
    ['month', 2629800],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
    ['second', 1]
  ];
  const [unit, divisor] = units.find(([, size]) => Math.abs(seconds) >= size) || units[units.length - 1];
  return new Intl.RelativeTimeFormat(localeForIntl(locale), { numeric: 'always' })
    .format(Math.round(seconds / divisor), unit);
}

module.exports = {
  SUPPORTED_LOCALES,
  catalogFor,
  catalogs,
  createChoiceTranslator,
  createTranslator,
  formatLocaleDate,
  formatLocaleNumber,
  formatLocaleRelativeTime,
  isSupportedLocale,
  localeForIntl,
  translate,
  translateChoice,
  valueInCatalog
};
