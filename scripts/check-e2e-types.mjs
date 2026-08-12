#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * check-e2e-types — a shrink-only ceiling on TypeScript errors in the browser suite.
 *
 * 🔴 WHY. Found on 2026-08-12: NOTHING typechecks `e2e/`. There is an
 * `e2e/tsconfig.json`, but no npm script and no CI job ever runs `tsc` against it.
 * The React app is typechecked (`react-frontend`, plus a separate shrink-only gate
 * for its test files); the browser suite was not checked at all.
 *
 * It was found the honest way: a change of mine declared `const content` twice in
 * one block in `e2e/tests/smoke.spec.ts`. That is a hard type error, it was
 * committed, and no gate anywhere noticed. Fifteen further errors had accumulated
 * the same way, and they are not cosmetic — for example
 * `groups.spec.ts: Expected 0-1 arguments, but got 2` means an argument a test
 * passes is being silently ignored, so that test does not do what it reads as doing.
 * A browser test that does not do what it says is exactly the class of problem this
 * repository has been paying down all week.
 *
 * A CEILING, not a sweep, and for the usual reason: 15 pre-existing errors cannot be
 * fixed safely in the same change that introduces the gate, and a gate that starts
 * red is a gate everybody learns to ignore. Same shape as
 * .github/e2e-assertion-quality-baseline.json.
 *
 * Usage:
 *   node scripts/check-e2e-types.mjs
 *   node scripts/check-e2e-types.mjs --write-baseline
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, '.github', 'e2e-types-baseline.json');
const WRITE = process.argv.includes('--write-baseline');

/**
 * Run tsc and return its diagnostic lines.
 *
 * tsc exits non-zero when there are errors, which is the normal case here, so a
 * non-zero status is NOT treated as a failure of this script. A missing tsc or an
 * unreadable project IS — see the distinction below, because "tsc could not run"
 * must never be reported as "no errors".
 */
function collectErrors() {
  // 🔴 The LOCAL tsc entry point via node, not `npx`. On Windows `npx.cmd` needs a
  // shell to spawn and otherwise fails with no output at all — which the guard below
  // caught, but which would have been a silent pass had that guard not existed.
  // Invoking node with the resolved script is identical on every platform and needs
  // no shell.
  const tsc = join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!existsSync(tsc)) {
    console.error(`check-e2e-types FAILED: ${tsc} not found. Run npm ci at the repository root.`);
    process.exit(1);
  }

  let output = '';
  try {
    output = execFileSync(
      process.execPath,
      [tsc, '--noEmit', '-p', 'e2e/tsconfig.json'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } catch (error) {
    // tsc found errors: stdout carries them and the exit code is non-zero.
    output = `${error.stdout || ''}${error.stderr || ''}`;

    // 🔴 Distinguish "tsc reported errors" from "tsc never ran". Without this, a
    // missing dependency or a renamed tsconfig would produce zero matched lines and
    // this gate would pass while checking nothing.
    if (!output.trim()) {
      console.error('check-e2e-types FAILED: tsc produced no output at all.');
      console.error('It probably did not run (missing dependency, or e2e/tsconfig.json moved).');
      console.error('A check that measured nothing is not a pass.');
      process.exit(1);
    }
  }

  // `path(line,col): error TSxxxx: message`
  return output
    .split(/\r?\n/)
    .filter((line) => /^\S.*\(\d+,\d+\): error TS\d+/.test(line))
    .map((line) => line.trim());
}

const errors = collectErrors();
const byFile = new Map();
for (const line of errors) {
  const file = line.split('(')[0];
  byFile.set(file, (byFile.get(file) || 0) + 1);
}

console.log(`e2e types — ${errors.length} error(s) across ${byFile.size} file(s)`);

if (WRITE) {
  writeFileSync(
    BASELINE,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: 'scripts/check-e2e-types.mjs',
        note:
          'Shrink-only ceiling on TypeScript errors under e2e/. Nothing typechecked the '
          + 'browser suite before 2026-08-12, so these accumulated unseen. Regenerate ONLY '
          + 'with --write-baseline, and only when the count goes DOWN. Never hand-edit.',
        count: errors.length,
        files: Object.fromEntries([...byFile.entries()].sort()),
      },
      null,
      2,
    )}\n`,
  );
  console.log(`baseline written: ${errors.length}`);
  process.exit(0);
}

if (!existsSync(BASELINE)) {
  console.error(`Baseline missing: ${BASELINE}`);
  console.error('Create it with: node scripts/check-e2e-types.mjs --write-baseline');
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const ceiling = typeof baseline.count === 'number' ? baseline.count : null;
if (ceiling === null) {
  console.error('Baseline has no numeric "count". Regenerate it.');
  process.exit(1);
}

// 🔴 A drop to zero from a non-zero ceiling is not a credible single change; it is
// what a broken invocation looks like. The same guard the assertion-quality ratchet
// needed after one of its detectors was sabotaged and it happily reported success.
if (ceiling > 0 && errors.length === 0) {
  console.error(`check-e2e-types FAILED: zero errors reported, but the baseline expects ${ceiling}.`);
  console.error('That is more likely a broken tsc invocation than a fixed suite.');
  console.error('If the suite really is clean, re-baseline in the same change and say so.');
  process.exit(1);
}

if (errors.length > ceiling) {
  console.error('');
  console.error(`check-e2e-types FAILED — ${errors.length} error(s), ceiling ${ceiling} (+${errors.length - ceiling}).`);
  console.error('');
  console.error('New TypeScript errors in the browser suite. These are not cosmetic: a');
  console.error('wrong argument count or a redeclared variable means the test does not do');
  console.error('what it reads as doing.');
  console.error('');
  for (const line of errors.slice(0, 20)) console.error(`  ${line}`);
  if (errors.length > 20) console.error(`  … and ${errors.length - 20} more`);
  console.error('');
  console.error('Reproduce locally with:  npx tsc --noEmit -p e2e/tsconfig.json');
  process.exit(1);
}

if (errors.length < ceiling) {
  console.log(`↓ ${errors.length} error(s), ceiling ${ceiling} — IMPROVED.`);
  console.log('Lower the ceiling in the same commit: node scripts/check-e2e-types.mjs --write-baseline');
} else {
  console.log(`= ${errors.length} error(s) (at ceiling)`);
}

console.log('');
console.log('OK — no new type errors in the browser suite. This is a CEILING, not a');
console.log('clean bill of health: the remaining errors are tracked debt.');
