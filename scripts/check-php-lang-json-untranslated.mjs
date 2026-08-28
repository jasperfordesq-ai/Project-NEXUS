// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * check-php-lang-json-untranslated.mjs — count lang/<locale>/<ns>.json values
 * that are still English.
 *
 * The sibling gate check-php-lang-untranslated.mjs covers lang/**\/*.php and
 * ratcheted that debt from 99,140 down to under 200 — but `__()` resolves
 * lang/<locale>/<ns>.json FIRST (App\I18n\Translator) and falls back to the
 * .php loader only on a miss. The JSON catalogue is therefore the LIVE one for
 * every namespace it covers, and NOTHING measured it: dump-lang.php reads only
 * .php, the React gates read react-frontend/public/locales, and
 * check-i18n-json-integrity.mjs checks validity, not values. Measured on
 * 2026-08-28: 49,347 of 77,638 non-English JSON values (63.6%) were
 * byte-identical to English — the same disease the .php gate was built for, in
 * a catalogue ~250× the size of what that gate still tracks. 80% of it sits in
 * admin.json.
 *
 * Same rules as the sibling: a value counts as untranslated when it is a
 * string, contains at least one letter, exists under the same key in lang/en,
 * is byte-identical to the English value, and is not allowlisted
 * (scripts/php-lang-invariant-allowlist.json — SHARED with the .php gate, one
 * curation rule for both). SHRINK-ONLY RATCHET per locale file against
 * .github/php-lang-json-untranslated-baseline.json: adding English fails,
 * removing it passes and says so. Re-baseline (--write-baseline) only on
 * genuine improvement.
 *
 * Usage:
 *   node scripts/check-php-lang-json-untranslated.mjs                  # gate
 *   node scripts/check-php-lang-json-untranslated.mjs --details        # per-file counts
 *   node scripts/check-php-lang-json-untranslated.mjs --summary        # totals only
 *   node scripts/check-php-lang-json-untranslated.mjs --locale fr      # one locale
 *   node scripts/check-php-lang-json-untranslated.mjs --write-baseline # lock in progress
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LANG_DIR = path.join(ROOT, 'lang');
const ALLOWLIST_PATH = path.join(ROOT, 'scripts', 'php-lang-invariant-allowlist.json');
const BASELINE_PATH = path.join(ROOT, '.github', 'php-lang-json-untranslated-baseline.json');
const SOURCE_LOCALE = 'en';

const args = process.argv.slice(2);
const WRITE_BASELINE = args.includes('--write-baseline');
const SHOW_DETAILS = args.includes('--details');
const SUMMARY_ONLY = args.includes('--summary');
const LOCALE_FILTER = args.includes('--locale') ? args[args.indexOf('--locale') + 1] : null;

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Flatten nested objects with dots, arrays by index — matching dump-lang.php. */
function flatten(values, prefix = '', out = {}) {
  for (const [key, value] of Object.entries(values)) {
    const p = prefix === '' ? String(key) : `${prefix}.${key}`;
    if (value !== null && typeof value === 'object') {
      flatten(value, p, out);
    } else {
      out[p] = value;
    }
  }
  return out;
}

/** {"<locale>/<file>.json": {"dotted.key": value}} for every lang JSON file. */
function loadTree() {
  const tree = {};
  for (const locale of fs.readdirSync(LANG_DIR).sort()) {
    const dir = path.join(LANG_DIR, locale);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir).sort()) {
      if (!file.endsWith('.json')) continue;
      tree[`${locale}/${file}`] = flatten(readJson(path.join(dir, file)));
    }
  }
  return tree;
}

function loadAllowlist() {
  if (!fs.existsSync(ALLOWLIST_PATH)) {
    return { global: new Set(), byLocale: {} };
  }
  const raw = readJson(ALLOWLIST_PATH);
  const byLocale = {};
  for (const [locale, values] of Object.entries(raw.byLocale ?? {})) {
    byLocale[locale] = new Set(values);
  }
  return { global: new Set(raw.global ?? []), byLocale };
}

function isAllowlisted(allowlist, locale, value) {
  return allowlist.global.has(value) || Boolean(allowlist.byLocale[locale]?.has(value));
}

/** A value with no letter cannot be translated — "1", "—", "{{count}}". */
function isTranslatableText(value) {
  return typeof value === 'string' && /\p{L}/u.test(value);
}

function buildSnapshot(tree, allowlist) {
  const files = {};
  const perFileSamples = {};
  let total = 0;

  for (const localeFile of Object.keys(tree).sort()) {
    const separator = localeFile.indexOf('/');
    const locale = localeFile.slice(0, separator);
    const namespace = localeFile.slice(separator + 1);

    if (locale === SOURCE_LOCALE) continue;
    if (LOCALE_FILTER && locale !== LOCALE_FILTER) continue;

    const englishValues = tree[`${SOURCE_LOCALE}/${namespace}`];
    // No English counterpart → a parity problem owned by the parity tooling;
    // untranslated-ness is undefined without an English value to compare to.
    if (!englishValues) continue;

    let count = 0;
    const samples = [];

    for (const [key, value] of Object.entries(tree[localeFile])) {
      if (!isTranslatableText(value)) continue;
      if (value !== englishValues[key]) continue;
      if (isAllowlisted(allowlist, locale, value)) continue;

      count++;
      if (samples.length < 3) samples.push(`${key} = ${JSON.stringify(value)}`);
    }

    if (count > 0) {
      files[localeFile] = count;
      perFileSamples[localeFile] = samples;
      total += count;
    }
  }

  return { files, perFileSamples, total };
}

// ── Main ─────────────────────────────────────────────────────────────────────

const allowlist = loadAllowlist();
const tree = loadTree();
const snapshot = buildSnapshot(tree, allowlist);

if (SHOW_DETAILS) {
  for (const [file, count] of Object.entries(snapshot.files).sort((a, b) => b[1] - a[1])) {
    console.log(`${String(count).padStart(6)}  ${file}`);
    for (const sample of snapshot.perFileSamples[file] ?? []) {
      console.log(`          ${sample}`);
    }
  }
}

console.log(`lang/ JSON values byte-identical to English (after allowlist): ${snapshot.total}`);

if (SUMMARY_ONLY) {
  process.exit(0);
}

if (WRITE_BASELINE) {
  const baseline = {
    _readme: [
      'Shrink-only ceiling for English-identical values in lang/<locale>/<ns>.json,',
      'per locale file. Enforced by scripts/check-php-lang-json-untranslated.mjs.',
      'This catalogue is LIVE: __() reads lang/<locale>/<ns>.json BEFORE the .php',
      'loader. Lower a ceiling by translating (scripts/translate tooling), never by',
      'copying English across — and re-run --write-baseline only on genuine',
      'improvement. Invariant values (brand names, endonyms, placeholder-only',
      'strings) belong in scripts/php-lang-invariant-allowlist.json, shared with',
      'the .php gate.',
    ],
    generatedAt: new Date().toISOString(),
    totalUntranslated: snapshot.total,
    files: snapshot.files,
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(baseline, null, 2) + '\n', 'utf8');
  console.log(`Baseline written: ${path.relative(ROOT, BASELINE_PATH)} (${snapshot.total} across ${Object.keys(snapshot.files).length} files)`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE_PATH)) {
  console.error('FAIL: no baseline. Run with --write-baseline to record the starting ceiling.');
  process.exit(1);
}

const baseline = readJson(BASELINE_PATH);
const baselineFiles = baseline.files ?? {};
const regressions = [];
const improvements = [];

const allFiles = new Set([...Object.keys(baselineFiles), ...Object.keys(snapshot.files)]);
for (const file of allFiles) {
  if (LOCALE_FILTER && !file.startsWith(`${LOCALE_FILTER}/`)) continue;
  const ceiling = baselineFiles[file] ?? 0;
  const current = snapshot.files[file] ?? 0;
  if (current > ceiling) {
    regressions.push({ file, ceiling, current, samples: snapshot.perFileSamples[file] ?? [] });
  } else if (current < ceiling) {
    improvements.push({ file, ceiling, current });
  }
}

if (regressions.length > 0) {
  console.error(`\nFAIL: ${regressions.length} locale JSON file(s) gained English-identical values:`);
  for (const r of regressions) {
    console.error(`  ${r.file}: ${r.current} (ceiling ${r.ceiling})`);
    for (const sample of r.samples) console.error(`    e.g. ${sample}`);
  }
  console.error('\nTranslate the new values (do NOT copy English across), or — for a genuine');
  console.error('invariant — add the VALUE to scripts/php-lang-invariant-allowlist.json.');
  process.exit(1);
}

if (improvements.length > 0) {
  const reclaimed = improvements.reduce((sum, i) => sum + (i.ceiling - i.current), 0);
  console.log(`PASS — and ${reclaimed} value(s) across ${improvements.length} file(s) are now translated below the ceiling.`);
  console.log('Lock the progress in with: node scripts/check-php-lang-json-untranslated.mjs --write-baseline');
} else {
  console.log('PASS: no locale JSON file exceeds its untranslated ceiling.');
}
