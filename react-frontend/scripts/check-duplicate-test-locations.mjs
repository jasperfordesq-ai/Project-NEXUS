#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * check-duplicate-test-locations — shrink-only ratchet on the same component
 * being tested from two files in the same directory.
 *
 * 🔴 Why this exists. `src` uses two test conventions at once: co-located
 * `Foo.test.tsx` and `__tests__/Foo.test.tsx`. Where BOTH exist beside each
 * other they are not copies — every pair was checked on 2026-08-28 and all 103
 * differ — they are two suites written independently by people who did not know
 * the other file was there.
 *
 * That is not merely untidy, and the cost is on record: `SavedSearches` was
 * QUARANTINED IN BOTH LOCATIONS at once. The same component's tests rotted
 * twice, separately, because a fix to one file never reached the other. A
 * reader who opens one file and sees it passing has no signal that the other
 * exists at all.
 *
 * This check deliberately does NOT flag two same-named test files in DIFFERENT
 * directories — `components/marketplace/RatingModal.test.tsx` and
 * `components/wallet/RatingModal.test.tsx` cover genuinely different
 * components, and forbidding that would be noise. Only the sibling case is a
 * real duplicate.
 *
 * Fixing a pair means merging the two suites into one file and deleting the
 * other, then lowering BASELINE in the same commit. Do not "fix" it by renaming
 * one file, which keeps both suites and only hides them from this check.
 *
 * Usage:
 *   node scripts/check-duplicate-test-locations.mjs
 *   node scripts/check-duplicate-test-locations.mjs --list
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Lower this — never raise it — as pairs are merged. It was 103 when the check
// was introduced on 2026-08-28.
const BASELINE = 103;

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '..', 'src');

const TEST_FILE = /\.(test|spec)\.(tsx?|jsx?)$/;

/** @returns {string[]} posix-style paths relative to src/ */
function collectTestFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectTestFiles(full, acc);
      continue;
    }
    if (!TEST_FILE.test(entry.name)) continue;
    acc.push(path.relative(SRC, full).split(path.sep).join('/'));
  }
  return acc;
}

if (!fs.existsSync(SRC)) {
  console.error(`check-duplicate-test-locations: ${SRC} does not exist.`);
  process.exit(2);
}

const files = collectTestFiles(SRC);

// A scan that finds nothing must not read as a pass.
if (files.length < 100) {
  console.error(
    `check-duplicate-test-locations: only ${files.length} test files found under src/ — `
    + 'that is implausible, so the scan is pointed at the wrong place.',
  );
  process.exit(2);
}

const present = new Set(files);
const pairs = [];

for (const file of files) {
  const dir = path.posix.dirname(file);
  if (path.posix.basename(dir) !== '__tests__') continue;

  const sibling = `${path.posix.dirname(dir)}/${path.posix.basename(file)}`;
  if (present.has(sibling)) pairs.push([sibling, file]);
}

pairs.sort((a, b) => a[0].localeCompare(b[0]));

const count = pairs.length;
const listing = process.argv.includes('--list');

console.log('='.repeat(60));
console.log('  Duplicate test locations (same component, two suites)');
console.log('='.repeat(60));
console.log(`  Test files scanned:  ${files.length}`);
console.log(`  Duplicate pairs:     ${count}`);
console.log(`  Budget (ceiling):    ${BASELINE}`);
console.log('');

if (listing) {
  for (const [colocated, nested] of pairs) {
    console.log(`  ${colocated}\n  ${nested}\n`);
  }
}

if (count > BASELINE) {
  console.error(
    `FAIL: ${count} duplicate pair(s) exceeds the ceiling of ${BASELINE}.\n`
    + 'A component must not be tested from both Foo.test.tsx and __tests__/Foo.test.tsx\n'
    + 'in the same directory — the two suites drift apart, and a fix to one never\n'
    + 'reaches the other. Merge the new suite into the existing file.\n'
    + 'Run with --list to see every pair.',
  );
  process.exit(1);
}

if (count < BASELINE) {
  console.log(`PASS — and progress! ${count} < budget ${BASELINE}.`);
  console.log(`  Lower BASELINE in this script to ${count} to lock in the gain.`);
  process.exit(0);
}

console.log('PASS: at budget. Drive this number DOWN by merging pairs.');
