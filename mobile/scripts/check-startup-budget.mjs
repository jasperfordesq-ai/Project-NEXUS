#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Is the app's JavaScript bundle still inside its budget? — journey 7.16.
 *
 * 🔴 Why this exists. The row read "no budget exists", and behind it there was no
 * measurement either: nothing in this repo had ever recorded how big the shipped bundle
 * is or how long the app takes to open. A budget nobody measures is not a budget, so this
 * measures first and compares second.
 *
 * What it measures: `npx expo export --platform android` produces exactly the Hermes
 * bytecode bundle that a release build embeds, and needs no Android toolchain — so it
 * runs on a CI runner as well as here. The ceiling lives in `startup-budget.json`.
 *
 * 🔴 Honest statuses, the same rule as preflight: exit 0 = inside budget, 1 = over it,
 * 2 = could NOT be measured. An export that fails is never a pass.
 *
 * Usage:
 *   node scripts/check-startup-budget.mjs                # export, then compare
 *   node scripts/check-startup-budget.mjs --bundle <f>   # compare a bundle already built
 *   node scripts/check-startup-budget.mjs --measure      # print the size, compare nothing
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const HERE = import.meta.dirname;
const MOBILE = path.resolve(HERE, '..');
const BUDGET_FILE = path.join(MOBILE, 'startup-budget.json');
const WARN_WITHIN = 0.05;

const argv = process.argv.slice(2);
const measureOnly = argv.includes('--measure');
const bundleArgIndex = argv.indexOf('--bundle');
const bundleArg = bundleArgIndex === -1 ? null : argv[bundleArgIndex + 1];

function unavailable(reason) {
  console.log(`startup budget: UNAVAILABLE — ${reason}`);
  console.log('startup budget: this is NOT a pass. Nothing was measured.');
  process.exit(2);
}

function readBudget() {
  try {
    return JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8'));
  } catch (error) {
    unavailable(`could not read startup-budget.json (${error.message})`);
  }
}

/** The single .hbc an Android export produces. More than one means the shape changed. */
function findBundle(dir) {
  const jsDir = path.join(dir, '_expo', 'static', 'js', 'android');
  if (!fs.existsSync(jsDir)) return { error: `no android bundle directory under ${dir}` };
  const files = fs.readdirSync(jsDir).filter((f) => f.endsWith('.hbc') || f.endsWith('.js'));
  if (files.length === 0) return { error: `no bundle file in ${jsDir}` };
  if (files.length > 1) {
    return { error: `expected one android bundle, found ${files.length}: ${files.join(', ')}` };
  }
  return { file: path.join(jsDir, files[0]) };
}

function exportBundle() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-startup-budget-'));
  /*
    🔴 Run Expo's CLI through node directly, never `npx`. On Windows `execFileSync('npx.cmd')`
    fails with EINVAL — Node refuses to spawn a .cmd without a shell — and `shell: true`
    would then need every argument quoted by hand. The CLI file is a plain script.
  */
  const cli = path.join(MOBILE, 'node_modules', 'expo', 'bin', 'cli');
  if (!fs.existsSync(cli)) {
    return { error: `expo CLI not found at ${cli} — run npm install in mobile/` };
  }
  try {
    execFileSync(
      process.execPath,
      [cli, 'export', '--platform', 'android', '--output-dir', outDir],
      { cwd: MOBILE, stdio: 'pipe', timeout: 20 * 60 * 1000 },
    );
  } catch (error) {
    const detail = (error.stderr?.toString() || error.stdout?.toString() || error.message || '').slice(-400);
    return { error: `expo export failed: ${detail}` };
  }
  return findBundle(outDir);
}

const budget = readBudget();
const ceiling = budget?.bundle?.ceilingBytes;
if (typeof ceiling !== 'number' || ceiling <= 0) {
  unavailable('startup-budget.json has no positive bundle.ceilingBytes');
}

let bundleFile;
if (bundleArg) {
  if (!fs.existsSync(bundleArg)) unavailable(`--bundle path does not exist: ${bundleArg}`);
  bundleFile = bundleArg;
} else {
  const result = exportBundle();
  if (result.error) unavailable(result.error);
  bundleFile = result.file;
}

const bytes = fs.statSync(bundleFile).size;
const mb = (n) => `${(n / 1024 / 1024).toFixed(2)} MB`;
console.log(`startup budget: android bundle ${bytes} bytes (${mb(bytes)}) — ${path.basename(bundleFile)}`);

if (measureOnly) {
  console.log(`startup budget: ceiling ${ceiling} bytes (${mb(ceiling)}); recorded measurement `
    + `${budget.bundle.measuredBytes} bytes on ${budget.bundle.measuredOn}`);
  process.exit(0);
}

if (bytes > ceiling) {
  const over = bytes - ceiling;
  console.log(`startup budget: OVER BUDGET by ${over} bytes (${mb(over)}) — ceiling is ${ceiling} (${mb(ceiling)})`);
  console.log('startup budget: either take weight out of the bundle, or raise ceilingBytes in '
    + 'mobile/startup-budget.json deliberately, with the new measurement and its date.');
  process.exit(1);
}

const headroom = ceiling - bytes;
if (headroom < ceiling * WARN_WITHIN) {
  console.log(`startup budget: WARNING — only ${headroom} bytes (${mb(headroom)}) of headroom left, `
    + `under ${Math.round(WARN_WITHIN * 100)}% of the ceiling. Review the ceiling on purpose now, `
    + 'rather than being stopped by it later.');
}
console.log(`startup budget: OK — ${mb(bytes)} against a ceiling of ${mb(ceiling)} `
  + `(${mb(headroom)} spare).`);
