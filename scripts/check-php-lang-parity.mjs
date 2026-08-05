// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * check-php-lang-parity.mjs — Detect translation key mismatches in PHP lang files.
 *
 * Compares every non-English lang/{locale}/*.php file against the English
 * source (lang/en/*.php) and reports missing keys, extra keys, and missing
 * namespace files. This is the PHP-side counterpart of check-i18n-drift.mjs
 * (which only covers react-frontend JSON locales) — without it, new lang/en
 * keys can sit untranslated for weeks (e.g. the 52 api.php keys of 2026-05-27).
 *
 * PHP files are parsed by shelling out to `php -r "echo json_encode(require ...)"`,
 * which is far more robust than regex-parsing PHP array syntax.
 *
 * Exit code 0 = all locales match English key sets exactly.
 * Exit code 1 = mismatches found (blocks CI).
 *
 * Usage:
 *   node scripts/check-php-lang-parity.mjs            # Full check
 *   node scripts/check-php-lang-parity.mjs --summary  # Counts only, no key details
 */

import { readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { dumpLangTree } from './lib/load-php-array.mjs';

const LANG_DIR = join(process.cwd(), 'lang');
const SUMMARY_ONLY = process.argv.includes('--summary');

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Every lang file's flat key set, keyed "<locale>/<file>.php".
 *
 * 🔴 Read via the shared dumpLangTree(), which runs ONE PHP process and falls
 * back to the app container when the host has no PHP. This script previously
 * called `php` directly, once per file, and hard-exited 1 with "PHP CLI not
 * found on PATH" when it was absent. On this Docker-first project that is the
 * normal state of a dev machine — AGENTS.md forbids host PHP because the host
 * `vendor/` is incomplete — so the gate could never pass locally, and preflight
 * surfaced it as a real FAILURE, indistinguishable from actual key drift. It
 * also cost 462 process starts.
 *
 * dump-lang.php already flattens nested arrays with dots, matching Laravel's
 * dotted key syntax, so no separate flatten step is needed here.
 */
function loadKeySets() {
  const tree = dumpLangTree({ root: process.cwd() });
  const sets = new Map();
  for (const [path, values] of Object.entries(tree)) {
    if (values === null || typeof values !== 'object') {
      throw new Error(`${path} did not return a PHP array`);
    }
    sets.set(path, new Set(Object.keys(values)));
  }
  return sets;
}

// ─── Main ────────────────────────────────────────────────────

if (!existsSync(LANG_DIR)) {
  console.error(`Lang directory not found: ${LANG_DIR}`);
  process.exit(1);
}

let keySets;
try {
  keySets = loadKeySets();
} catch (error) {
  console.error('Could not read lang/*.php via PHP (host PATH or the app container).');
  console.error(`  ${error instanceof Error ? error.message : String(error)}`);
  console.error('  Start Docker (or install a PHP CLI) and re-run — this check has NOT run.');
  process.exit(1);
}

const langs = readdirSync(LANG_DIR)
  .filter(d => statSync(join(LANG_DIR, d)).isDirectory())
  .sort();

const enDir = join(LANG_DIR, 'en');
if (!existsSync(enDir)) {
  console.error('English (en) lang directory not found');
  process.exit(1);
}

const enFiles = readdirSync(enDir)
  .filter(f => f.endsWith('.php'))
  .sort();
const nonEnLangs = langs.filter(l => l !== 'en');

console.log('============================================================');
console.log('  PHP lang/ Translation Parity Check');
console.log('============================================================');
console.log(`  English namespaces: ${enFiles.length}`);
console.log(`  Languages: ${langs.join(', ')}`);
console.log('');

let totalMissing = 0;
let totalExtra = 0;
let totalMissingFiles = 0;
let totalFilesChecked = 0;

for (const file of enFiles) {
  const enKeys = keySets.get(`en/${file}`);
  if (!enKeys) {
    console.error(`[ERROR] en/${file} exists on disk but was not readable as a PHP array.`);
    process.exit(1);
  }

  for (const lang of nonEnLangs) {
    totalFilesChecked++;

    const langKeys = keySets.get(`${lang}/${file}`);
    if (!langKeys) {
      console.log(`[MISSING FILE] ${lang}/${file} — entire namespace missing`);
      totalMissingFiles++;
      totalMissing += enKeys.size;
      continue;
    }

    const missing = [...enKeys].filter(k => !langKeys.has(k));
    const extra = [...langKeys].filter(k => !enKeys.has(k));

    if (missing.length > 0) {
      totalMissing += missing.length;
      console.log(`[MISSING KEYS] ${lang}/${file} — ${missing.length} key(s) not translated`);
      if (!SUMMARY_ONLY) {
        missing.forEach(k => console.log(`    - ${k}`));
      }
    }

    if (extra.length > 0) {
      totalExtra += extra.length;
      console.log(`[EXTRA KEYS]   ${lang}/${file} — ${extra.length} key(s) not in English source`);
      if (!SUMMARY_ONLY) {
        extra.forEach(k => console.log(`    + ${k}`));
      }
    }
  }
}

console.log('');
console.log('============================================================');
console.log(`  Files checked: ${totalFilesChecked}`);
console.log(`  Missing files: ${totalMissingFiles}`);
console.log(`  Missing keys:  ${totalMissing}`);
console.log(`  Extra keys:    ${totalExtra}`);
console.log('============================================================');

if (totalMissing > 0 || totalMissingFiles > 0 || totalExtra > 0) {
  console.log('');
  console.log('FAIL: PHP lang parity drift detected. Fix key sets before merging.');
  console.log('  Run: node scripts/check-php-lang-parity.mjs');
  console.log('  Fix: Add real translations for every missing key to each lang/{locale}/*.php');
  console.log('       (and remove keys that no longer exist in lang/en).');
  process.exit(1);
} else {
  console.log('');
  console.log('PASS: All PHP lang files match the English key sets. No drift detected.');
  process.exit(0);
}
