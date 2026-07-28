// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * check-quarantine-budget.mjs — ceiling on the full-suite quarantine list.
 *
 * src/test/failing-suites.baseline.json lists suites the sharded full-suite job
 * (scripts/run-vitest-shard.mjs) skips because they already fail. That list is
 * what lets the job run everything else and still be blocking, instead of
 * waiting until all 1,283 suites are green.
 *
 * It is also the obvious way to cheat. When a shard goes red, adding the
 * offending suite to the list turns it green in one line — and that trade buys a
 * green build by DELETING coverage, which is precisely the disease this whole
 * effort is treating. This guard makes that move require deliberately editing a
 * committed number, next to a comment saying not to.
 *
 * The number may only go DOWN. When a quarantined suite is fixed and removed,
 * lower BASELINE to match. It is a fix-and-remove queue, not a set of permanent
 * exemptions.
 *
 * Not a substitute for the runner's own floor checks (a quarantined path that no
 * longer exists, or a totals count that disagrees with the list, already fail
 * there). This guard only governs the SIZE of the list.
 *
 * Uses only built-in Node modules so it runs in CI without npm install.
 *
 * Usage:
 *   node scripts/check-quarantine-budget.mjs            # enforce the ceiling
 *   node scripts/check-quarantine-budget.mjs --report   # list every entry, never fails
 *   QUARANTINE_BUDGET=130 node scripts/check-quarantine-budget.mjs   # override
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const BASELINE_FILE = path.join(ROOT, 'src/test/failing-suites.baseline.json');

// Committed ceiling. LOWER ONLY — never raise it to make a red shard green.
//
// 2026-07-28: set to 123. Seeded at 39 from a partial local census, then
// extended to 117 with failures the first CI shakedown found (most of which fail
// only on a Linux runner, so a local sweep could not have seen them), then to 123
// with the six real failures that surfaced once shard 3 stopped hanging.
//
// The single legitimate reason to raise this is a genuinely flaky suite that
// cannot be stabilised, and even then prefer the runner's --retry=1 first: retry
// keeps the coverage, quarantine throws it away. If you raise it, say why here.
const BASELINE = 123;

const budget = Number(process.env.QUARANTINE_BUDGET ?? BASELINE);

function main() {
  const wantsReport = process.argv.includes('--report');

  if (!fs.existsSync(BASELINE_FILE)) {
    console.error(`check-quarantine-budget: missing ${path.relative(ROOT, BASELINE_FILE)}`);
    process.exit(2);
    return;
  }

  let baseline;
  try {
    baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  } catch (error) {
    console.error(`check-quarantine-budget: corrupt baseline — ${error.message}`);
    process.exit(2);
    return;
  }

  const quarantined = baseline.quarantined ?? [];
  const declared = baseline.totals?.count;

  if (wantsReport) {
    console.log(`check-quarantine-budget: ${quarantined.length} quarantined suite(s), budget ${budget}\n`);
    for (const file of quarantined) console.log(`  ${file}`);
    process.exit(0);
    return;
  }

  // Mirrors a floor check in the runner. Duplicated deliberately: this gate is
  // cheap and runs before npm ci, so it catches a hand-edited file early.
  if (declared !== quarantined.length) {
    console.error(
      `check-quarantine-budget: totals.count (${declared}) disagrees with the list length ` +
        `(${quarantined.length}) — the baseline has been hand-edited.`,
    );
    process.exit(1);
    return;
  }

  if (quarantined.length > budget) {
    console.error(
      `check-quarantine-budget: ${quarantined.length} quarantined suites exceeds the budget of ${budget}.\n\n` +
        `Adding a suite here removes it from the full-suite job, which buys a green build by dropping\n` +
        `coverage. Fix the suite, or — if it is flaky rather than broken — rely on the runner's --retry=1,\n` +
        `which keeps the coverage. Raise BASELINE in this script only as a deliberate, documented decision.`,
    );
    process.exit(1);
    return;
  }

  const headroom = budget - quarantined.length;
  console.log(
    `check-quarantine-budget: OK — ${quarantined.length} quarantined of 1,283 suites (budget ${budget}` +
      `${headroom > 0 ? `, ${headroom} under` : ' — at the ceiling'}).`,
  );
  if (headroom > 0) {
    console.log(`  ${headroom} suite(s) have been fixed and removed. Lower BASELINE to ${quarantined.length} to lock that in.`);
  }
  process.exit(0);
}

main();
