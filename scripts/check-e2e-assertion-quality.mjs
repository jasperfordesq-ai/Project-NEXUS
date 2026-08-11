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

/**
 * Collapse a statement that a formatter has spread over several lines back onto one,
 * while remembering which line each statement started on.
 *
 * 🔴 WHY. Both detectors were single-line regexes applied per line, so ordinary
 * formatting defeated them completely. Verified against the previous patterns:
 *
 *     const hasHeading = await page          // ← not counted
 *       .locator('h1')
 *       .isVisible();
 *
 *     expect(                                 // ← not counted
 *       hasHeading || true,
 *     ).toBeTruthy();
 *
 * Prettier produces exactly that shape once a locator chain gets long, so the
 * ceiling could be held at 139/83 while the real debt grew — a gate that reports
 * "at ceiling" while measuring less and less. Statement-level matching removes the
 * formatting dependency.
 *
 * @returns {Array<{line: number, text: string}>} statements, 1-indexed start line
 */
function statements(code) {
  const out = [];
  let buffer = '';
  let startLine = 1;

  code.split('\n').forEach((raw, index) => {
    if (buffer === '') startLine = index + 1;
    buffer += (buffer === '' ? '' : ' ') + raw.trim();

    // A statement ends at a semicolon or a block brace. Anything still open keeps
    // accumulating, which is what joins a wrapped chain back together.
    if (/[;{}]\s*$/.test(raw.trim()) || raw.trim() === '') {
      const text = buffer.replace(/\s+/g, ' ').trim();
      if (text !== '') out.push({ line: startLine, text });
      buffer = '';
    }
  });

  if (buffer.trim() !== '') out.push({ line: startLine, text: buffer.replace(/\s+/g, ' ').trim() });
  return out;
}

for (const file of collectFiles(E2E_DIR)) {
  const rel = relative(ROOT, file).split(sep).join('/');
  const code = stripComments(readFileSync(file, 'utf8'));
  const stmts = statements(code);

  // --- Pattern A -----------------------------------------------------------
  // Variables assigned from a non-waiting visibility/enabled check. Deliberately
  // excludes the `if (await ...)` form, which is a legitimate optional check.
  //
  // Also catches re-assignment (`hasX = await ...`, no declaration keyword) and
  // destructuring from Promise.all, both of which the old line-based pattern missed.
  const snapshotVars = new Set();
  for (const { text } of stmts) {
    const declared = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+[^;]*?\.(?:isVisible|isHidden|isEnabled|isDisabled|isChecked)\s*\(/.exec(text);
    if (declared) snapshotVars.add(declared[1]);

    // Re-assignment without a declaration keyword.
    const reassigned = /(?:^|[;{]\s*)([A-Za-z_$][\w$]*)\s*=\s*await\s+[^;]*?\.(?:isVisible|isHidden|isEnabled|isDisabled|isChecked)\s*\(/.exec(text);
    if (reassigned) snapshotVars.add(reassigned[1]);

    // Destructured from an array of non-waiting checks.
    const destructured = /(?:const|let|var)\s*\[([^\]]+)\]\s*=\s*await\s+[^;]*?\.(?:isVisible|isHidden|isEnabled|isDisabled|isChecked)\s*\(/.exec(text);
    if (destructured) {
      for (const name of destructured[1].split(',')) {
        const clean = name.trim();
        if (/^[A-Za-z_$][\w$]*$/.test(clean)) snapshotVars.add(clean);
      }
    }
  }

  if (snapshotVars.size > 0) {
    for (const { line, text } of stmts) {
      if (!/\bexpect\s*\(/.test(text)) continue;
      for (const name of snapshotVars) {
        // Word-boundary match so `hasCard` does not match `hasCards`.
        if (new RegExp(`\\bexpect\\s*\\([^)]*\\b${name}\\b`).test(text)) {
          findings.nonWaitingAssertion.push({ file: rel, line, text: text.slice(0, 120) });
          break;
        }
      }
    }
  }

  // --- Pattern B -----------------------------------------------------------
  for (const { line, text } of stmts) {
    if (/\bexpect\s*\([^;]*\|\|\s*true\s*[),]/.test(text)) {
      findings.cannotFail.push({ file: rel, line, text: text.slice(0, 120) });
    }
  }
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

// 🔴 AND THE CLAIM ABOVE IS NOW ACTUALLY IMPLEMENTED, PER PATTERN. It was not:
// only a zero FILE count failed, so a broken regex sent its count to 0, the script
// printed "IMPROVED — lower the ceiling" and exited 0. The checker could pass by
// measuring nothing, which is precisely the fault class it polices.
//
// 🔴 Checked INDEPENDENTLY for each pattern, because "both must be zero" is too
// weak — proved by sabotaging only detector A: its count fell 155 → 0 while
// detector B still reported 83, so a combined guard stayed quiet and the run passed
// with one detector completely blind.
//
// A non-zero ceiling collapsing to exactly zero is not a credible one-commit
// improvement; it is what a broken pattern looks like. If it IS genuine, the
// documented workflow already covers it: re-run with --write-baseline in the same
// commit, which lowers the ceiling to 0 and stops this guard applying.
for (const [key, label] of [
  ['nonWaitingAssertion', 'non-waiting check used as an assertion'],
  ['cannotFail', 'assertion that cannot fail (|| true)'],
]) {
  if ((ceiling[key] || 0) > 0 && counts[key] === 0) {
    console.error(`check-e2e-assertion-quality FAILED: "${label}" matched ZERO instances,`);
    console.error(`but the baseline expects ${ceiling[key]}.`);
    console.error(`Scanned ${scannedFiles} file(s), so the files were found — that DETECTOR is broken.`);
    console.error('A scan that measures nothing is not a clean suite.');
    console.error('If every instance really was fixed, re-baseline in the same commit and say so.');
    process.exit(1);
  }
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
