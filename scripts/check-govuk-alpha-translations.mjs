// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Detect untranslated English-copy values in the accessible frontend PHP
 * translations. Key parity alone is not enough for govuk_alpha.php because the
 * alpha UI is fully user-facing.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { loadPhpArray } from './lib/load-php-array.mjs';

const LANG_DIR = join(process.cwd(), 'lang');
const SOURCE_LOCALE = 'en';
const TARGET_LOCALES = ['ga', 'de', 'fr', 'it', 'pt', 'es', 'nl', 'pl', 'ja', 'ar'];

const ALWAYS_ALLOWED_KEYS = new Set([
  'feedback_url',
  'service_name',
  'federation.optin.travel_radius_suffix',
  'federation.settings.travel_radius_suffix',
  'dashboard.xp_label',
  'profile.xp_label',
  'profile_settings.languages.en',
  'profile_settings.languages.ga',
  'profile_settings.languages.de',
  'profile_settings.languages.fr',
  'profile_settings.languages.it',
  'profile_settings.languages.pt',
  'profile_settings.languages.es',
  'profile_settings.languages.nl',
  'profile_settings.languages.pl',
  'profile_settings.languages.ja',
  'profile_settings.languages.ar',
]);

const LEGAL_OR_BRAND_TOKENS = new Set([
  'AGPL-3.0-or-later',
  'NOTICE',
  'Project NEXUS',
  'Jasper Ford',
  'hOUR Timebank CLG',
  'WCAG 2.2 Level AA',
]);

// Locale/key pairs whose correct user-facing translation is intentionally
// identical to English. Keep this narrow: a word may be a valid cognate in one
// language and untranslated copy in another.
const REVIEWED_IDENTICAL_KEYS = new Set([
  // German loanwords and shared technical labels.
  'de:jobs.title',
  'de:coupons.code_label',
  'de:clubs.title',
  'de:polish_discovery.polls_create_option_label',
  'de:cookie_settings.title',
  'de:events.agenda.types.workshop',
  'de:org_depth.opportunity_remote',
  'de:jobs.remote',
  'de:jobs_t2.remote_tag',
  'de:group_exchanges.name_column',
  'de:notifications.types.system',
  'de:profile_settings.passkeys.title',
  // French cognates whose spelling is already the natural translation.
  'fr:events.analytics.sections.communications',
  'fr:events.communications.body_label',
  'fr:events.communications.audit_meta',
  'fr:events.agenda.types.session',
  'fr:polls.per_option_votes',
  'fr:leaderboard.score_column',
  'fr:nexus_score.score_column',
  'fr:nexus_score.categories.impact',
  'fr:notifications.title',
  'fr:notifications.types.messages',
  'fr:groups.discussions.content_label',
  'fr:jobs_t2.commitment_flexible',
  'fr:podcasts.title',
  'fr:coupons.title',
  'fr:clubs.title',
  'fr:federation.optin.communication_legend',
  'fr:federation.settings.notifications_legend',
  'fr:federation.settings.communications_legend',
  'fr:fed2.messages.conversations_heading',
  'fr:near_me.label',
  'fr:polish_discovery.polls_create_option_label',
  'fr:polish_federation.settings_communications_legend',
  'fr:cookie_settings.title',
  'fr:skills.proficiency.expert',
  'fr:jobs_t2.type_label',
  'fr:jobs_t3.label_type',
  'fr:jobs_t4.label_type',
  'fr:coupons.code_label',
  'fr:federation.levels.social',
  'fr:federation.listings_browse.filter_type_label',
  'fr:profile_settings.passkeys.type',
  'fr:vol_org.date_label',
  'fr:groups.visibility_public',
  'fr:clubs.contact_label',
  // Other reviewed locale-specific cognates and established loanwords.
  'it:notifications.types.ideation',
  'it:actions.post',
  'it:feed.item_types.post',
  'it:events.agenda.types.networking',
  'it:saved.types.post',
  'it:feed_t1.permalink_title',
  'it:feed_t1.permalink_heading',
  'it:groups_t1.event_online',
  'it:federation.events_browse.online_label',
  'es:cookie_settings.no',
  'es:jobs_t2.commitment_flexible',
  'es:cookie_settings.title',
  'es:notifications.types.ideation',
  'es:ideation.title',
  'es:ideation.ideas_title',
  'es:federation.levels.social',
  'nl:skills.proficiency.beginner',
  'nl:jobs_t2.app_status_screening',
  'nl:jobs_t4.criteria_type',
  'nl:courses.levels.beginner',
  'nl:clubs.title',
  'nl:federation.nav.partners',
  'nl:cookie_settings.title',
  'nl:nav.matches',
  'nl:listings.status_label',
  'nl:listings.type_label',
  'nl:listings.type',
  'nl:exchanges.status_label',
  'nl:events.agenda.types.workshop',
  'nl:events.calendar_subscription_status',
  'nl:events.poll_open_tag',
  'nl:volunteering.status',
  'nl:volunteering.status_values.open',
  'nl:group_exchanges.status_label',
  'nl:polls.open_tag',
  'nl:leaderboard.score_column',
  'nl:nexus_score.score_column',
  'nl:notifications.types.other',
  'nl:jobs_t2.type_label',
  'nl:jobs_t2.status_label',
  'nl:jobs_t3.label_type',
  'nl:jobs_t3.status_open',
  'nl:jobs_t4.label_type',
  'nl:ideation.status_label',
  'nl:ideation.status_open',
  'nl:coupons.code_label',
  'nl:clubs.contact_label',
  'nl:federation.listings_browse.filter_type_label',
  'nl:polish_discovery.ideation_filter_open',
  'nl:profile_settings.passkeys.type',
  'pl:notifications.types.system',
  'pl:saved.types.post',
  'pt:cookie_settings.title',
  'pt:federation.levels.social',
]);

// Arabic phone examples need an explicit left-to-right mark before the
// international number so it renders correctly inside right-to-left copy.
const REVIEWED_FORMAT_CONTROL_KEYS = new Set([
  'ar:auth.phone_hint',
  'ar:profile_settings.phone_hint',
]);

function flatten(value, prefix = '', out = new Map()) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => flatten(item, prefix ? `${prefix}.${index}` : String(index), out));
    return out;
  }

  if (value !== null && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      flatten(item, prefix ? `${prefix}.${key}` : key, out);
    }
    return out;
  }

  out.set(prefix, String(value));
  return out;
}

function interpolationTokens(value) {
  return [...value.matchAll(/:[A-Za-z_][A-Za-z0-9_]*/g)]
    .map((match) => match[0])
    .sort();
}

function interpolationSignature(value) {
  return interpolationTokens(value).join('|');
}

function boundaryWhitespaceSignature(value) {
  const leading = value.match(/^\s*/u)?.[0] ?? '';
  const trailing = value.match(/\s*$/u)?.[0] ?? '';
  return `${JSON.stringify(leading)}::${JSON.stringify(trailing)}`;
}

function pluralSignature(value) {
  const selectors = [...value.matchAll(/\{(?:\d+|\d+,\d+)\}|\[(?:\d+|\*),(?:\d+|\*)\]/g)]
    .map((match) => match[0]);
  const branchInterpolations = selectors.length > 0
    ? value.split('|').map((branch) => interpolationSignature(branch)).join('||')
    : '';

  return `${selectors.join('|')}::${(value.match(/\|/g) ?? []).length}::${branchInterpolations}`;
}

function isPlaceholderOrFormatOnly(value) {
  const withoutPlaceholders = value.replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '');
  return !/[\p{L}]/u.test(withoutPlaceholders);
}

function isUrlOrEmail(value) {
  // The bare-email branch deliberately rejects ':' and '?': without that, a
  // corrupted URL whose scheme had been translated (mailto: -> ميلتو:) still
  // matched as "an email address" — no spaces to give it away — and was
  // exempted from every corruption check below. That is exactly how a broken
  // Arabic feedback link survived unnoticed.
  return /^(https?:\/\/|mailto:)/i.test(value)
    || /^[^\s@:?]+@[^\s@:?]+\.[^\s@:?]+$/.test(value);
}

/**
 * A translated value must keep the URI scheme the English value had.
 *
 * Machine translation treats `mailto:` as prose: Spanish produced
 * "enviar correo a:" and Arabic the transliteration "ميلتو:", both of which
 * turn the link into dead text. Comparing the scheme is exact — no heuristic —
 * so it cannot false-positive on a legitimately translated URL path or query.
 */
function hasBrokenUrlScheme(englishValue, value) {
  // A KNOWN scheme list, not "any word before a colon". Matching the generic
  // shape flagged ordinary labels — "Error:", "Rating: :value of 5", "Data:" —
  // whose translations legitimately change the word before the colon.
  const englishScheme = /^(https?:|mailto:|tel:|sms:|webcal:|ftp:)/i.exec(englishValue.trim());
  if (englishScheme === null) return false;

  return !value.trim().toLowerCase().startsWith(englishScheme[1].toLowerCase());
}

function isNumberOrSymbolOnly(value) {
  return value.trim() !== '' && !/[\p{L}]/u.test(value);
}

function isLegalOrBrandOnly(value) {
  return LEGAL_OR_BRAND_TOKENS.has(value.trim());
}

function hasSuspiciousQuestionMark(englishValue, value) {
  if (isUrlOrEmail(value)) return false;
  const sourceCount = (englishValue.match(/\?/g) ?? []).length;
  const translatedCount = (value.match(/\?/g) ?? []).length;

  return /\p{L}\?\p{L}/u.test(value)
    || /\?{2,}/u.test(value)
    || translatedCount > sourceCount;
}

function hasSuspiciousCorruption(locale, key, englishValue, value) {
  // Checked BEFORE the URL exemption: the whole point is to catch a value that
  // no longer looks like a URL because its scheme was translated away.
  if (hasBrokenUrlScheme(englishValue, value)) return true;

  if (isUrlOrEmail(value)) return false;

  const hasMojibake = /\uFFFD|[\u00C2\u00C3][\u0080-\u00BF]|\u00E2(?:[\u0080-\u00BF]|\u20AC)|\u00F0\u0178|\u00EF\u00BF\u00BD/u.test(value);
  const hasControlCharacter = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(value);
  const hasUnexpectedFormatControl = /[\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/u.test(value)
    && !REVIEWED_FORMAT_CONTROL_KEYS.has(`${locale}:${key}`);
  const hasHtmlEntity = /&(?:#\d+|#x[\dA-F]+|[A-Z][A-Z0-9]+);/iu.test(value);

  return hasSuspiciousQuestionMark(englishValue, value)
    || hasMojibake
    || hasControlCharacter
    || hasUnexpectedFormatControl
    || hasHtmlEntity;
}

function isAllowedSameAsEnglish(locale, key, value) {
  return value === ''
    || ALWAYS_ALLOWED_KEYS.has(key)
    || REVIEWED_IDENTICAL_KEYS.has(`${locale}:${key}`)
    || isPlaceholderOrFormatOnly(value)
    || isNumberOrSymbolOnly(value)
    || isLegalOrBrandOnly(value);
}

const sourceFile = join(LANG_DIR, SOURCE_LOCALE, 'govuk_alpha.php');
if (!existsSync(sourceFile)) {
  console.error(`Missing source translation file: ${sourceFile}`);
  process.exit(1);
}

const source = flatten(loadPhpArray(sourceFile));
const untranslated = [];
const allowed = [];
const structuralFailures = [];
const interpolationFailures = [];
const formattingFailures = [];
const pluralFailures = [];
const corruptionFailures = [];

for (const locale of TARGET_LOCALES) {
  const file = join(LANG_DIR, locale, 'govuk_alpha.php');
  if (!existsSync(file)) {
    structuralFailures.push({ locale, key: '(file)', issue: 'missing govuk_alpha.php' });
    continue;
  }

  const translated = flatten(loadPhpArray(file));
  for (const [key, englishValue] of source.entries()) {
    const translatedValue = translated.get(key);
    if (translatedValue === undefined) {
      structuralFailures.push({ locale, key, issue: 'missing key' });
      continue;
    }

    if (interpolationSignature(englishValue) !== interpolationSignature(translatedValue)) {
      interpolationFailures.push({ locale, key, englishValue, translatedValue });
    }
    if (boundaryWhitespaceSignature(englishValue) !== boundaryWhitespaceSignature(translatedValue)) {
      formattingFailures.push({ locale, key, englishValue, translatedValue });
    }
    if (pluralSignature(englishValue) !== pluralSignature(translatedValue)) {
      pluralFailures.push({ locale, key, englishValue, translatedValue });
    }
    if (hasSuspiciousCorruption(locale, key, englishValue, translatedValue)) {
      corruptionFailures.push({ locale, key, value: translatedValue });
    }

    if (translatedValue !== englishValue) continue;

    if (isAllowedSameAsEnglish(locale, key, englishValue)) {
      allowed.push({ locale, key, value: englishValue });
      continue;
    }

    untranslated.push({ locale, key, value: englishValue });
  }

  for (const key of translated.keys()) {
    if (!source.has(key)) structuralFailures.push({ locale, key, issue: 'extra key' });
  }
}

console.log('============================================================');
console.log('  Accessible Frontend Translation Integrity Check');
console.log('============================================================');
console.log(`  Source keys:       ${source.size}`);
console.log(`  Locales checked:   ${TARGET_LOCALES.join(', ')}`);
console.log(`  Allowed unchanged: ${allowed.length}`);
console.log(`  Untranslated:      ${untranslated.length}`);
console.log(`  Structural issues: ${structuralFailures.length}`);
console.log(`  Placeholder issues:${String(interpolationFailures.length).padStart(2, ' ')}`);
console.log(`  Whitespace issues: ${formattingFailures.length}`);
console.log(`  Plural issues:     ${pluralFailures.length}`);
console.log(`  Corrupted values:  ${corruptionFailures.length}`);

const failures = [
  ...structuralFailures.map((item) => ({ ...item, category: 'structure' })),
  ...interpolationFailures.map((item) => ({ ...item, category: 'placeholder' })),
  ...formattingFailures.map((item) => ({ ...item, category: 'whitespace' })),
  ...pluralFailures.map((item) => ({ ...item, category: 'plural' })),
  ...corruptionFailures.map((item) => ({ ...item, category: 'corruption' })),
  ...untranslated.map((item) => ({ ...item, category: 'untranslated' })),
];

if (failures.length > 0) {
  console.error('');
  console.error('FAIL: govuk_alpha.php contains translation integrity issues.');
  for (const item of failures.slice(0, 200)) {
    const detail = item.issue
      ?? item.value
      ?? `${JSON.stringify(item.englishValue)} -> ${JSON.stringify(item.translatedValue)}`;
    console.error(`  [${item.category}] ${item.locale}: ${item.key} = ${detail}`);
  }
  if (failures.length > 200) {
    console.error(`  ...and ${failures.length - 200} more`);
  }
  process.exit(1);
}

console.log('');
console.log('PASS: govuk_alpha.php values are translated or intentionally allowlisted.');
