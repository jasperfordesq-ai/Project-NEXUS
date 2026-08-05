// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * check-php-lang-untranslated.mjs — count lang/ values that are still English.
 *
 * check-php-lang-parity.mjs compares KEY SETS, so a locale file passes it while
 * every value in it is a verbatim copy of the English one. That is not a corner
 * case: when this gate was written, 62.3% of all non-English PHP lang values
 * (99,140 of 159,140) were byte-identical to English and the parity gate was
 * green. Pasted English is invisible to a key-set check by construction — the
 * key is present, and only its value is wrong.
 *
 * So this gate counts values instead. A value is counted as untranslated when it
 * is a string, contains at least one letter, exists under the same key in
 * lang/en, is byte-identical to the English value, and is not allowlisted.
 *
 * It is a SHRINK-ONLY RATCHET, not a pass/fail line: a 99k debt cannot be paid
 * off in the commit that starts measuring it, and a gate that fails on day one
 * gets switched off rather than fixed. The baseline is a ceiling per locale
 * file. Adding English fails. Removing English passes, and says so.
 *
 * Reading is delegated to one PHP subprocess (scripts/php/dump-lang.php).
 * Never regex-parse these files: they are executable PHP.
 *
 * Usage:
 *   node scripts/check-php-lang-untranslated.mjs                  # gate
 *   node scripts/check-php-lang-untranslated.mjs --details        # per-file counts
 *   node scripts/check-php-lang-untranslated.mjs --summary        # totals only
 *   node scripts/check-php-lang-untranslated.mjs --locale fr      # one locale
 *   node scripts/check-php-lang-untranslated.mjs --write-baseline # lock in progress
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dumpLangTree as sharedDumpLangTree } from './lib/load-php-array.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
// Still referenced by the existence pre-check below; the dump itself now goes
// through the shared reader, which resolves both paths from ROOT itself.
const DUMP_SCRIPT = path.join(ROOT, 'scripts', 'php', 'dump-lang.php');
const ALLOWLIST_PATH = path.join(ROOT, 'scripts', 'php-lang-invariant-allowlist.json');
const BASELINE_PATH = path.join(ROOT, '.github', 'php-lang-untranslated-baseline.json');
const SOURCE_LOCALE = 'en';

const args = process.argv.slice(2);
const WRITE_BASELINE = args.includes('--write-baseline');
const SHOW_DETAILS = args.includes('--details');
const SUMMARY_ONLY = args.includes('--summary');
const LOCALE_FILTER = args.includes('--locale') ? args[args.indexOf('--locale') + 1] : null;

// ── Reading ──────────────────────────────────────────────────────────────────

/**
 * Reading is delegated to the shared dumpLangTree() in
 * scripts/lib/load-php-array.mjs — one PHP process, with a host→container
 * fallback so the gate runs on a Docker-first dev machine with no host PHP.
 *
 * 🔴 That fallback used to live here, inline, which is why THIS gate worked
 * locally while check-php-lang-parity.mjs did not: parity called a bare `php`
 * and hard-failed when it was absent. Keeping one copy is the point — do not
 * re-inline it.
 */
function dumpLangTree() {
  return sharedDumpLangTree({ root: ROOT });
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

// ── Counting ─────────────────────────────────────────────────────────────────

/**
 * Values that are correct *because* they are the same in English.
 *
 * Keyed by value, not by key path: the same invariant string ("EUR (€)",
 * "Twitter / X") shows up under many keys, and listing each key path would turn
 * the allowlist into a per-key suppression list — which is how an allowlist
 * stops being read and starts hiding things.
 */
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

/**
 * Enforce the one mechanical part of the allowlist's curation rule.
 *
 * A `byLocale` entry claims a translator would leave that value alone in that
 * language. There is a cheap, decisive counter-example available: if the same
 * English value appears under some other key and that locale DID render it
 * differently, then a translator did not leave it alone, and the entry is
 * suppressing real work rather than describing an invariant.
 *
 * This is what separates the entries that are here from the ones that are not:
 * "Status" is invariant in Dutch (30 of 30 occurrences identical) but German,
 * Polish and Portuguese also produce Stand / Stan / Estado, so they stay
 * counted. Without this check the distinction is a comment nobody re-derives,
 * and the allowlist becomes the suppression list its own README warns about.
 *
 * `global` entries are deliberately NOT checked this way. They are proper nouns,
 * units, placeholder-only strings and language endonyms, where one locale having
 * translated an occurrence is a bug in that locale rather than evidence against
 * the invariant.
 */
function findAllowlistContradictions(tree, allowlist) {
  const contradictions = [];

  for (const [locale, values] of Object.entries(allowlist.byLocale)) {
    for (const value of values) {
      const rendered = new Set();

      for (const localeFile of Object.keys(tree)) {
        const separator = localeFile.indexOf('/');
        if (localeFile.slice(0, separator) !== SOURCE_LOCALE) continue;
        const namespace = localeFile.slice(separator + 1);
        const translated = tree[`${locale}/${namespace}`];
        if (!translated) continue;

        for (const [key, englishValue] of Object.entries(tree[localeFile])) {
          if (englishValue !== value) continue;
          const localeValue = translated[key];
          if (typeof localeValue === 'string' && localeValue !== value) {
            rendered.add(localeValue);
          }
        }
      }

      if (rendered.size > 0) {
        contradictions.push({ locale, value, rendered: [...rendered].slice(0, 3) });
      }
    }
  }

  return contradictions;
}

/**
 * A value with no letter in it cannot be translated in any meaningful sense —
 * "1", "—", "%s", "12:00". Counting those would inflate the debt with work that
 * does not exist and would make the number stop meaning anything.
 */
function isTranslatableText(value) {
  return typeof value === 'string' && /\p{L}/u.test(value);
}

function buildSnapshot(tree, allowlist) {
  const files = {};
  const perFileSamples = {};
  let total = 0;

  const localeFiles = Object.keys(tree).sort();

  for (const localeFile of localeFiles) {
    const separator = localeFile.indexOf('/');
    const locale = localeFile.slice(0, separator);
    const namespace = localeFile.slice(separator + 1);

    if (locale === SOURCE_LOCALE) continue;
    if (LOCALE_FILTER && locale !== LOCALE_FILTER) continue;

    const englishValues = tree[`${SOURCE_LOCALE}/${namespace}`];
    // A namespace with no English counterpart is a parity problem, and
    // check-php-lang-parity.mjs is the gate that owns it. Untranslated-ness is
    // undefined without an English value to compare against.
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

  return { files, total, perFileSamples };
}

// ── Comparison ───────────────────────────────────────────────────────────────

function findRegressions(current, baseline) {
  const regressions = [];
  for (const [file, count] of Object.entries(current.files)) {
    const allowed = baseline.files?.[file] ?? 0;
    if (count > allowed) {
      regressions.push({ file, count, allowed, delta: count - allowed });
    }
  }

  return regressions.sort((left, right) => right.delta - left.delta);
}

// ── Main ─────────────────────────────────────────────────────────────────────

if (!fs.existsSync(DUMP_SCRIPT)) {
  console.error(`Missing ${path.relative(ROOT, DUMP_SCRIPT)} — this gate cannot read lang/ without it.`);
  process.exit(1);
}

const allowlist = loadAllowlist();
const startedAt = Date.now();
const tree = dumpLangTree();
const snapshot = buildSnapshot(tree, allowlist);
const elapsedSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);

const locales = [...new Set(Object.keys(snapshot.files).map((file) => file.split('/')[0]))].sort();

console.log('============================================================');
console.log('  PHP lang/ Untranslated Value Check');
console.log('============================================================');
console.log(`  Namespaces read: ${Object.keys(tree).length} (in ${elapsedSeconds}s)`);
console.log(`  Locales with English values: ${locales.join(', ') || 'none'}`);
console.log(`  Untranslated values: ${snapshot.total}`);
console.log('');

if (SHOW_DETAILS && !SUMMARY_ONLY) {
  const worstFirst = Object.entries(snapshot.files).sort((left, right) => right[1] - left[1]);
  for (const [file, count] of worstFirst) {
    console.log(`  ${String(count).padStart(6)}  ${file}`);
    for (const sample of snapshot.perFileSamples[file] ?? []) {
      console.log(`          ${sample}`);
    }
  }
  console.log('');
}

// Checked before the baseline comparison, and before --write-baseline: a bad
// allowlist entry lowers the count, so letting it through would bake the
// suppression into the ceiling and make it permanent.
const contradictions = findAllowlistContradictions(tree, allowlist);

if (contradictions.length > 0) {
  console.error('FAIL: byLocale allowlist entries contradicted by the lang files themselves.');
  console.error('');
  console.error('  Each of these claims a translator leaves the value alone in that language,');
  console.error('  but that same locale renders the same English value differently elsewhere:');
  for (const { locale, value, rendered } of contradictions.slice(0, 25)) {
    console.error(`    ${locale}: ${JSON.stringify(value)} — also rendered as ${rendered.map((v) => JSON.stringify(v)).join(', ')}`);
  }
  if (contradictions.length > 25) {
    console.error(`    …and ${contradictions.length - 25} more.`);
  }
  console.error('');
  console.error('  Remove the entry from scripts/php-lang-invariant-allowlist.json and translate');
  console.error('  the value: it is real work, not an invariant.');
  process.exit(1);
}

if (WRITE_BASELINE) {
  if (LOCALE_FILTER) {
    console.error('Refusing to write a baseline from a --locale run: it would erase every other locale.');
    process.exit(1);
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'scripts/check-php-lang-untranslated.mjs',
    note: 'Shrink-only ceiling. Values byte-identical to lang/en, minus scripts/php-lang-invariant-allowlist.json. Regenerate ONLY with --write-baseline; never hand-edit.',
    langDir: 'lang',
    sourceLocale: SOURCE_LOCALE,
    totalUntranslated: snapshot.total,
    files: snapshot.files,
  };

  fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Wrote ${path.relative(ROOT, BASELINE_PATH)} — ceiling is now ${snapshot.total}.`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE_PATH)) {
  console.error(`Missing ${path.relative(ROOT, BASELINE_PATH)}.`);
  console.error('  Create it: node scripts/check-php-lang-untranslated.mjs --write-baseline');
  process.exit(1);
}

const baseline = readJson(BASELINE_PATH);
const regressions = findRegressions(snapshot, baseline);

if (regressions.length > 0) {
  console.error('FAIL: English values were added to non-English lang files.');
  console.error(`  Baseline total: ${baseline.totalUntranslated}   Current total: ${snapshot.total}`);
  console.error('');
  console.error('  Files above their ceiling:');
  for (const regression of regressions.slice(0, 25)) {
    console.error(`    ${regression.file}: ${regression.count} (ceiling ${regression.allowed}, +${regression.delta})`);
    for (const sample of snapshot.perFileSamples[regression.file] ?? []) {
      console.error(`        ${sample}`);
    }
  }
  if (regressions.length > 25) {
    console.error(`    …and ${regressions.length - 25} more file(s).`);
  }
  console.error('');
  console.error('  Almost always this means a new lang/en key was copied verbatim into the');
  console.error('  other locales to satisfy the parity gate. Translate the value instead:');
  console.error('    node scripts/translate-php-lang-gaps.mjs --google --namespace <file>');
  console.error('');
  console.error('  If a value is genuinely the same in that language (a product name, a');
  console.error('  currency code, a borrowed technical term), add the VALUE to');
  console.error('  scripts/php-lang-invariant-allowlist.json — global, or under byLocale.');
  console.error('  Do not raise the baseline to make this pass.');
  process.exit(1);
}

const improvement = (baseline.totalUntranslated ?? 0) - snapshot.total;

if (improvement > 0) {
  console.log(`PASS: ${improvement} fewer untranslated value(s) than the baseline.`);
  console.log('  Lock the progress in so it cannot be given back:');
  console.log('    node scripts/check-php-lang-untranslated.mjs --write-baseline');
} else {
  console.log(`PASS: no English added (${snapshot.total} untranslated, ceiling ${baseline.totalUntranslated}).`);
}

process.exit(0);
