#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * check-e2e-assertion-quality — a shrink-only ceiling on two browser-test
 * anti-patterns, both of which make a test report success without checking.
 *
 * 🔴 WHY. Found on 2026-08-11 while diagnosing a Safari test that kept needing
 * retries. Neither pattern is a product defect. Both cost real diagnostic time:
 * that Safari failure, and a broker 500 the same day, each presented as "CI being
 * unreliable" and each was a genuine signal hidden by a retry-rescued pass.
 *
 * PATTERN A — a non-waiting check used as an assertion.
 *   `locator.isVisible()` is an INSTANTANEOUS check. It returns the current state
 *   and IGNORES its `timeout` option. So
 *       const hasHeading = await page.locator('h1').isVisible({ timeout: 3000 });
 *       expect(hasHeading || hasCards).toBeTruthy();
 *   reads as "allow three seconds" and in fact races the first render.
 *   The fix is a WAITING assertion:
 *       await expect(heading.or(cards).first()).toBeVisible({ timeout: 15000 });
 *   See e2e/tests/smoke.spec.ts:367 for the reference fix, validated in CI.
 *
 *   🔴 The same call inside `if (await x.isVisible(...))` is FINE and is not
 *   counted — "click this if it happens to be present" genuinely should not wait.
 *   Only results fed into `expect(...)` are counted.
 *
 * PATTERN B — an assertion that cannot fail.
 *   `expect(hasThing || true).toBeTruthy()` passes whatever the page does. It is
 *   not flaky, it is decorative: it costs CI time and returns zero signal while
 *   reading as coverage. `e2e/helpers/seed.ts` already documents this as an
 *   anti-pattern to avoid.
 *
 * This is a CEILING, not a sweep. It exists so the debt cannot grow while it is
 * paid down opportunistically — the same shape as
 * .github/php-lang-untranslated-baseline.json.
 *
 * Usage:
 *   node scripts/check-e2e-assertion-quality.mjs
 *   node scripts/check-e2e-assertion-quality.mjs --write-baseline
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, relative, sep } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const E2E_DIR = join(ROOT, 'e2e');
const BASELINE = join(ROOT, '.github', 'e2e-assertion-quality-baseline.json');
const WRITE = process.argv.includes('--write-baseline');

const SKIP_DIRS = new Set(['node_modules', 'test-results', 'playwright-report', 'reports', '.cache']);

function collectFiles(dir) {
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...collectFiles(join(dir, entry.name)));
      continue;
    }
    if (entry.name.endsWith('.ts')) out.push(join(dir, entry.name));
  }
  return out;
}

/**
 * Strip comments before counting.
 *
 * 🔴 NOT optional. Three text-based guards in this repository have matched their
 * own explanatory comments — including one whose comment described the very
 * hazard it then reported as a violation. A comment that discusses
 * `expect(x || true)` must not be counted as one.
 *
 * Line positions are preserved so reported line numbers stay accurate.
 */
function stripComments(source) {
  const withoutBlocks = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return withoutBlocks
    .split('\n')
    .map((line) => {
      const at = line.indexOf('//');
      if (at === -1) return line;
      // Crude but adequate: a `//` inside a string is rare in these files, and a
      // false strip can only ever UNDER-count, never invent a violation.
      return line.slice(0, at);
    })
    .join('\n');
}

const findings = { nonWaitingAssertion: [], cannotFail: [] };

for (const file of collectFiles(E2E_DIR)) {
  const rel = relative(ROOT, file).split(sep).join('/');
  const code = stripComments(readFileSync(file, 'utf8'));
  const lines = code.split('\n');

  // --- Pattern A -----------------------------------------------------------
  // Variables assigned from a non-waiting visibility/enabled check. Deliberately
  // excludes the `if (await ...)` form, which is a legitimate optional check.
  const snapshotVars = new Set();
  lines.forEach((line) => {
    const m = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+.*\.(isVisible|isHidden|isEnabled|isDisabled|isChecked)\s*\(/.exec(line);
    if (m) snapshotVars.add(m[1]);
  });

  if (snapshotVars.size > 0) {
    lines.forEach((line, i) => {
      if (!/\bexpect\s*\(/.test(line)) return;
      for (const name of snapshotVars) {
        // Word-boundary match so `hasCard` does not match `hasCards`.
        if (new RegExp(`\\bexpect\\s*\\([^)]*\\b${name}\\b`).test(line)) {
          findings.nonWaitingAssertion.push({ file: rel, line: i + 1, text: line.trim().slice(0, 120) });
          break;
        }
      }
    });
  }

  // --- Pattern B -----------------------------------------------------------
  lines.forEach((line, i) => {
    if (/\bexpect\s*\([^;]*\|\|\s*true\s*\)/.test(line)) {
      findings.cannotFail.push({ file: rel, line: i + 1, text: line.trim().slice(0, 120) });
    }
  });
}

const counts = {
  nonWaitingAssertion: findings.nonWaitingAssertion.length,
  cannotFail: findings.cannotFail.length,
};

if (WRITE) {
  writeFileSync(
    BASELINE,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: 'scripts/check-e2e-assertion-quality.mjs',
        note:
          'Shrink-only ceiling on two browser-test anti-patterns. nonWaitingAssertion: a '
          + 'non-waiting isVisible()/isEnabled() result used inside expect(); the timeout '
          + 'option on those calls is IGNORED, so the assertion races rendering. cannotFail: '
          + 'expect(... || true), which passes whatever the page does. Regenerate ONLY with '
          + '--write-baseline, and only on genuine improvement. Never hand-edit.',
        reference: 'e2e/tests/smoke.spec.ts:367 — the fixed form, validated in CI run 31527851183',
        counts,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.log(`baseline written: ${JSON.stringify(counts)}`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(`Missing baseline: ${relative(ROOT, BASELINE)}`);
  console.error('Create it with: node scripts/check-e2e-assertion-quality.mjs --write-baseline');
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const ceiling = baseline.counts || {};

// 🔴 A count of zero for BOTH patterns is treated as a broken scan, not a clean
// suite — the e2e directory is large and known to contain hundreds of instances.
// A checker that reports success because it matched nothing is the exact fault
// this script exists to catch, and it has already happened five times in this
// codebase in a single day.
const scannedFiles = collectFiles(E2E_DIR).length;
if (scannedFiles === 0) {
  console.error('check-e2e-assertion-quality FAILED: no .ts files found under e2e/.');
  console.error('The scan measured nothing, which is not a pass.');
  process.exit(1);
}

let failed = false;
const report = [];

for (const [key, label] of [
  ['nonWaitingAssertion', 'non-waiting check used as an assertion'],
  ['cannotFail', 'assertion that cannot fail (|| true)'],
]) {
  const now = counts[key];
  const max = ceiling[key];
  if (typeof max !== 'number') {
    console.error(`Baseline is missing a ceiling for "${key}". Regenerate it.`);
    process.exit(1);
  }
  if (now > max) {
    failed = true;
    report.push(`  ✗ ${label}: ${now}, ceiling ${max} (+${now - max})`);
    for (const f of findings[key].slice(0, 10)) {
      report.push(`      ${f.file}:${f.line}  ${f.text}`);
    }
    if (findings[key].length > 10) report.push(`      … and ${findings[key].length - 10} more`);
  } else if (now < max) {
    report.push(`  ↓ ${label}: ${now}, ceiling ${max} — IMPROVED, lower the ceiling with --write-baseline`);
  } else {
    report.push(`  = ${label}: ${now} (at ceiling)`);
  }
}

console.log(`e2e assertion quality — ${scannedFiles} file(s) scanned`);
report.forEach((l) => console.log(l));

if (failed) {
  console.error('');
  console.error('check-e2e-assertion-quality FAILED — a new instance was added.');
  console.error('');
  console.error('Neither pattern is a product defect; both make a test report success');
  console.error('without checking, which is how a real failure hides behind a retry.');
  console.error('');
  console.error('  isVisible()/isEnabled() do NOT wait — the timeout option is ignored.');
  console.error('  Use a waiting assertion instead:');
  console.error('    await expect(a.or(b).first()).toBeVisible({ timeout: 15000 });');
  console.error('');
  console.error('  expect(x || true) passes whatever happens. Assert something real,');
  console.error('  or delete the assertion.');
  process.exit(1);
}

console.log('');
console.log('OK — no new instances. This is a CEILING, not a clean bill of health:');
console.log('the existing instances are tracked debt, to be paid down opportunistically.');
