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

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DUMP_SCRIPT = path.join(ROOT, 'scripts', 'php', 'dump-lang.php');
const LANG_DIR = path.join(ROOT, 'lang');
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
 * Run the dump script, falling back to the PHP container when there is no PHP on
 * PATH — the same fallback scripts/lib/load-php-array.mjs uses, so this gate is
 * runnable on a dev machine that only has Docker.
 */
function dumpLangTree() {
  const phpArgs = ['-d', 'display_errors=stderr', DUMP_SCRIPT, LANG_DIR];

  try {
    return JSON.parse(execFileSync('php', phpArgs, {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
    }));
  } catch (error) {
    if (!error || typeof error !== 'object' || error.code !== 'ENOENT') throw error;
  }

  const container = process.env.NEXUS_PHP_CONTAINER || 'nexus-php-app';
  const containerRoot = (process.env.NEXUS_PHP_CONTAINER_ROOT || '/var/www/html').replace(/\/$/u, '');

  return JSON.parse(execFileSync('docker', [
    'exec', container, 'php',
    '-d', 'display_errors=stderr',
    `${containerRoot}/scripts/php/dump-lang.php`,
    `${containerRoot}/lang`,
  ], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }));
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
