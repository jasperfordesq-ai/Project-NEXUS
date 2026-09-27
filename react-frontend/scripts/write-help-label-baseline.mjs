#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Regenerates the Help Centre label-check baseline
 * (src/pages/help/guides/data/label-baseline.json).
 *
 * The rules live in one place, src/pages/help/guides/labelCheck.ts, and the
 * test that applies them writes the baseline when HELP_LABELS_WRITE=1, so this
 * script only runs that test in write mode. Run it from react-frontend/:
 *
 *   node scripts/write-help-label-baseline.mjs
 *   node scripts/write-help-label-baseline.mjs --report ../.local-docs-archive/help-centre/label-failures.json
 *
 * --report also writes every failure, with per-locale counts, for translators.
 *
 * Only regenerate after checking the diff is an improvement: a baseline that
 * grows is a new wrong label being accepted.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const reportIndex = args.indexOf('--report');
const env = { ...process.env, HELP_LABELS_WRITE: '1' };
if (reportIndex >= 0) {
  const target = args[reportIndex + 1];
  if (!target) {
    console.error('--report needs a file path');
    process.exit(1);
  }
  env.HELP_LABELS_REPORT = path.resolve(process.cwd(), target);
}

// Foreground only: a backgrounded vitest run deadlocks on this machine.
const result = spawnSync(
  'npx',
  ['vitest', 'run', 'src/pages/help/guides/guides.labels.test.ts', '--retry=0'],
  { cwd: frontend, env, stdio: 'inherit', shell: process.platform === 'win32' },
);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('Wrote src/pages/help/guides/data/label-baseline.json');
if (env.HELP_LABELS_REPORT) console.log(`Wrote ${env.HELP_LABELS_REPORT}`);
