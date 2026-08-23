// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 🔴 Which "untranslated" values are actually untranslated.
 *
 * `englishIdenticalKeys` counts every value byte-identical to English, and on its own
 * that number says very little. Measured 2026-08-19 across the ten non-English
 * locales: 1,402 identical values, of which 810 were bare placeholders (":community",
 * ":value%"), 535 were single words that ARE the same word in the target language
 * ("Status", "Link", "Version", "Agenda"), and the rest were URLs, brand names, SI
 * units and language endonyms. Japanese and Arabic — the two locales least likely to
 * share vocabulary with English — had nine each: ":xp XP", "km", "XP", "AccessNI",
 * 日本語 and العربية.
 *
 * A value can be correct BECAUSE it is identical, so the raw count can never reach
 * zero, and a score deduction resting on it can never be closed by translating.
 * This applies the same judgement `scripts/php-lang-invariant-allowlist.json` applies
 * on the PHP side. The raw number is still reported beside it: this explains the
 * number, it does not hide it.
 */

// Proper nouns that must not be translated. Garda vetting and AccessNI are the Irish
// and Northern Irish disclosure services; DBS is the equivalent in England and Wales.
const INVARIANT_BRANDS = /(NEXUS|AccessNI|DBS|Garda|Stripe|Cloudflare)/;

// A language picker names each language in its OWN language, so these are identical
// in every catalogue by design — translating them is the defect.
const LANGUAGE_ENDONYMS = new Set([
  'English', 'Gaeilge', 'Deutsch', 'Français', 'Italiano',
  'Português', 'Español', 'Nederlands', 'Polski', '日本語', 'العربية'
]);

function identicalValueIsLegitimate(value) {
  const text = String(value == null ? '' : value);
  const withoutPlaceholders = text.replace(/:[a-zA-Z_]+/g, '');

  // Nothing but placeholders, punctuation and symbols — ":community", ":value%".
  if (!withoutPlaceholders.replace(/[^\p{L}]/gu, '').trim()) return true;
  if (/^(https?:|mailto:)/.test(text)) return true;
  if (INVARIANT_BRANDS.test(text)) return true;
  if (LANGUAGE_ENDONYMS.has(text.trim())) return true;

  // A single token carries no grammar to translate and is very often the same word in
  // the target language. Multi-word English is not, so it stays reportable.
  if (withoutPlaceholders.trim().split(/\s+/).filter(Boolean).length <= 1) return true;

  return false;
}

module.exports = { identicalValueIsLegitimate, INVARIANT_BRANDS, LANGUAGE_ENDONYMS };
