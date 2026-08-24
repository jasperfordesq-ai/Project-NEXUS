// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Count the mobile phrases that are still English in a non-English locale, and refuse to
 * let that count grow.
 *
 * 🔴 **This exists because nothing could see the gap.** Every mobile key is present in
 * every locale, so the key-set check that guards the web locales reports a clean sheet,
 * and `translate-mobile-i18n-gaps.mjs --summary` reported "0 missing". Measured on
 * 2026-08-24: **5,671 multi-word values were byte-identical to English** — roughly 1,100
 * in each of de, es, fr, it and pt, about one string in nine. That is the same blind spot
 * that let 99,139 PHP values sit in English behind a green parity gate. Comparing key sets
 * answers a different question from comparing values.
 *
 * The rule, deliberately narrow so the number stays a number of real defects:
 *
 * - single words are ignored — "Email", "OK", "Total" and many nouns are correct as-is in
 *   several of these languages, and counting them would bury the real gap in noise;
 * - placeholder-only values, URLs, mail/tel links and paths are ignored, since translating
 *   them breaks them;
 * - product names carry across untranslated;
 * - anything genuinely correct while identical can be listed in
 *   `locales/untranslated-allowlist.json`, with a reason, per locale.
 *
 * Shrink-only, in both directions: a rise fails (new English shipped into a locale) and so
 * does a fall without re-baselining, so a real improvement has to be banked in the same
 * commit and cannot be quietly spent later.
 *
 * Usage:
 *   node scripts/check-untranslated.mjs
 *   node scripts/check-untranslated.mjs --write-baseline
 *   node scripts/check-untranslated.mjs --list de
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const MOBILE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES_DIR = path.join(MOBILE_ROOT, 'locales');
const BASELINE = path.join(MOBILE_ROOT, 'untranslated-baseline.json');
const ALLOWLIST = path.join(LOCALES_DIR, 'untranslated-allowlist.json');
const LANGUAGES = ['ga', 'de', 'fr', 'it', 'pt', 'es'];

const args = process.argv.slice(2);
const WRITE_BASELINE = args.includes('--write-baseline');
const LIST = args.includes('--list') ? args[args.indexOf('--list') + 1] : null;

function readJson(file, fallback = {}) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
}

function flatten(value, prefix = '', result = {}) {
  for (const [key, child] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) flatten(child, fullKey, result);
    else if (typeof child === 'string') result[fullKey] = child;
  }
  return result;
}

/** The same rule as the translator's `isLegitimatelyIdentical`, kept in step by hand. */
function isLegitimatelyIdentical(value) {
  const text = String(value).trim();
  if (!text) return true;
  if (!text.replace(/\{\{[^}]+\}\}/g, '').match(/[A-Za-z]/)) return true;
  if (/^(https?:\/\/|mailto:|tel:|\/[a-z])/i.test(text)) return true;
  if (/^(Project NEXUS|NEXUS|Google Play|App Store|Stripe|Apple|Android|iOS|Expo)\b/.test(text)) return true;
  return false;
}

const allowlist = readJson(ALLOWLIST, { global: {}, byLocale: {} });

function isAllowed(locale, key, value) {
  if (allowlist.global?.[key] !== undefined) return true;
  if (allowlist.byLocale?.[locale]?.[key] !== undefined) return true;
  return false;
}

const english = {};
for (const file of fs.readdirSync(path.join(LOCALES_DIR, 'en')).filter(name => name.endsWith('.json'))) {
  english[file] = flatten(readJson(path.join(LOCALES_DIR, 'en', file)));
}

const counts = {};
const details = {};
for (const locale of LANGUAGES) {
  let count = 0;
  const rows = [];
  for (const [file, keys] of Object.entries(english)) {
    const target = flatten(readJson(path.join(LOCALES_DIR, locale, file)));
    for (const [key, value] of Object.entries(keys)) {
      if (target[key] !== value) continue;
      if (String(value).trim().split(/\s+/).length < 2) continue;
      if (isLegitimatelyIdentical(value)) continue;
      if (isAllowed(locale, `${file}:${key}`, value)) continue;
      count += 1;
      rows.push(`${file}:${key} = ${JSON.stringify(value)}`);
    }
  }
  counts[locale] = count;
  details[locale] = rows;
}

const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

if (LIST) {
  if (!LANGUAGES.includes(LIST)) {
    console.error(`Unknown locale: ${LIST}`);
    process.exit(1);
  }
  for (const row of details[LIST]) console.log(row);
  console.log(`\n${LIST}: ${counts[LIST]} still English`);
  process.exit(0);
}

if (WRITE_BASELINE) {
  fs.writeFileSync(BASELINE, `${JSON.stringify({ total, perLocale: counts }, null, 2)}\n`, 'utf8');
  console.log(`Baseline written: ${total} untranslated phrases`);
  for (const locale of LANGUAGES) console.log(`  ${locale}: ${counts[locale]}`);
  process.exit(0);
}

const baseline = readJson(BASELINE, null);
if (!baseline) {
  console.error('No untranslated-baseline.json. Create one with --write-baseline.');
  process.exit(1);
}

console.log('Mobile phrases still in English, per locale:');
for (const locale of LANGUAGES) {
  console.log(`  ${locale}: ${counts[locale]} (ceiling ${baseline.perLocale?.[locale] ?? '—'})`);
}
console.log(`  total: ${total} (ceiling ${baseline.total})`);

const risen = LANGUAGES.filter(locale => counts[locale] > (baseline.perLocale?.[locale] ?? Infinity));
if (total > baseline.total || risen.length > 0) {
  console.error(
    `\nFAILED: untranslated phrases rose${risen.length ? ` in ${risen.join(', ')}` : ''}.\n` +
    'A new English string shipped into a non-English locale. Translate it, or — only if it is ' +
    'genuinely correct while identical — add it to locales/untranslated-allowlist.json with a reason.',
  );
  process.exit(1);
}

if (total < baseline.total) {
  console.error(
    `\nFAILED: ${baseline.total - total} phrases were translated but the baseline still says ` +
    `${baseline.total}. Bank the improvement in this commit:\n` +
    '  node scripts/check-untranslated.mjs --write-baseline\n' +
    'The ratchet is enforced in both directions on purpose, so a real gain cannot be spent later.',
  );
  process.exit(1);
}

console.log('\nOK — no locale has more English than its ceiling.');
