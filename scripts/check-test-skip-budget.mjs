// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * check-test-skip-budget.mjs — Ratchet guard against schema-driven test skips.
 *
 * A large share of the PHPUnit suite calls markTestSkipped() with reasons like
 * "Required tables missing" / "column not present in test schema" / "run
 * migrations first". Those tests provide ZERO regression protection: when the
 * test database (built from database/schema/mysql-schema.sql) drifts from
 * production, whole feature areas silently skip and CI stays green.
 *
 * This guard does NOT fix the drift — it freezes it. It counts schema-driven
 * skips and fails if the count rises above a committed baseline, so new
 * schema-skip debt cannot be added. The number can only go DOWN: when the
 * schema dump is refreshed and a skip is converted to a real assertion, lower
 * BASELINE accordingly.
 *
 * Companion fix (manual, requires production access — see AGENTS.md):
 *   bash scripts/refresh-schema-dump.sh --production   # then rebuild test DB
 *
 * Uses only built-in Node modules so it runs in CI without `npm install`.
 *
 * Usage:
 *   node scripts/check-test-skip-budget.mjs            # enforce baseline
 *   node scripts/check-test-skip-budget.mjs --report   # list every skip, no fail
 *   TEST_SKIP_BUDGET=200 node scripts/check-test-skip-budget.mjs  # override ceiling
 *
 * Exit 0 = at or below budget. Exit 1 = budget exceeded (or --report finds none).
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { join, relative } from 'path';

const PROJECT_ROOT = process.cwd();
const TESTS_DIR = join(PROJECT_ROOT, 'tests');

// Committed baseline.
//
// 2026-06-24: raised 180 -> 288 (owner-authorised) to absorb the completed
// automated coverage push (batches 1–21). Those generated tests carry DEFENSIVE
// markTestSkipped() guards for tables that DO exist in the committed schema dump,
// so they actually run and pass — only ~52 of the counted skips fire at runtime;
// the static scan over-reports the rest. The pre-commit gate
// (scripts/git-hooks/pre-commit) now runs this check on the tracked+staged tree,
// so the number cannot creep further.
// 2026-06-24: lowered 288 -> 286 to lock in the current tracked-tree count
// (later coverage batches stripped two dead guards). Tightening the ratchet
// converts that headroom into protection so the slack can't silently refill.
// 2026-07-08: lowered 286 -> 285 after the platform audit confirmed the
// tracked-tree count had dropped again.
// 2026-07-13: lowered 285 -> 281 after removing obsolete guards for tables
// and columns present in the authoritative committed schema dump.
// 2026-08-08: lowered 281 -> 140. report-dead-skip-guards.mjs identified 184
// guards naming tables/columns that all exist in the committed schema dump;
// 141 of them were the canonical `if (! Schema::hasTable(...)) { skip }` /
// `DB::getSchemaBuilder()->has*` shape and were removed outright. The 776
// affected tests were run against the real database first and all passed, so
// nothing was switched off to achieve this number. What remains is deliberate:
// ~34 guards sit inside `catch { markTestSkipped() }`, which turns a genuine
// failure into a skip — those need the behaviour verified before the guard can
// go, and are tracked separately rather than stripped mechanically.
// Right direction is still DOWN: lower this as dead guards are stripped or the
// schema dump is refreshed. Do not raise it further without a matching reason.
// Lowered 140 -> 128 on 2026-08-28: the real count had already fallen to 128, and
// the script itself flagged the 12 skips of unclaimed headroom.
const BASELINE = 128;
const BUDGET = Number.parseInt(process.env.TEST_SKIP_BUDGET ?? '', 10) || BASELINE;

const REPORT_ONLY = process.argv.includes('--report');

// A skip is "schema-driven" (actionable debt) when its reason points at a
// missing table/column/migration rather than a legitimate runtime guard
// (Redis unavailable, no second tenant, driver not installed, etc.).
const SCHEMA_SKIP = /missing|not present|run migrations?|schema|\bcolumn\b|\btable\b|not available in/i;
// Reasons that are legitimate environment guards — never counted as debt.
const ENV_GUARD = /redis|memcached|extension|sqlite|driver not|connection refused|no second tenant|requires? the/i;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.php')) out.push(full);
  }
  return out;
}

/** Extract the first quoted string argument of each markTestSkipped( call. */
function extractSkipReasons(source) {
  const reasons = [];
  const needle = 'markTestSkipped(';
  let i = 0;
  while ((i = source.indexOf(needle, i)) !== -1) {
    const after = source.slice(i + needle.length, i + needle.length + 400);
    // First quoted literal (single or double), possibly on the next line.
    const m = /(['"])((?:\\.|(?!\1).)*)\1/s.exec(after);
    reasons.push(m ? m[2] : '');
    i += needle.length;
  }
  return reasons;
}

const files = (() => {
  // Prefer git-tracked + staged files so untracked work-in-progress (e.g. a
  // coverage loop mid-generation) does not inflate the count — the gate must
  // measure what is actually being committed, and CI sees a clean checkout
  // either way. Fall back to a filesystem walk if git is unavailable.
  try {
    const out = execSync('git ls-files -- tests', {
      cwd: PROJECT_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    const list = out.split('\n').map((s) => s.trim())
      .filter((s) => s.endsWith('.php')).map((s) => join(PROJECT_ROOT, s));
    if (list.length > 0) return list;
  } catch { /* not a git repo / git unavailable — fall back to FS walk */ }
  try {
    statSync(TESTS_DIR);
  } catch {
    console.error(`tests/ directory not found at ${TESTS_DIR}`);
    process.exit(2);
  }
  return walk(TESTS_DIR);
})();

let total = 0;
let schemaCount = 0;
const schemaHits = [];

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const reasons = extractSkipReasons(source);
  for (const reason of reasons) {
    total += 1;
    const isSchema = SCHEMA_SKIP.test(reason) && !ENV_GUARD.test(reason);
    if (isSchema) {
      schemaCount += 1;
      schemaHits.push(`${relative(PROJECT_ROOT, file).replaceAll('\\', '/')} :: ${reason || '(no inline reason)'}`);
    }
  }
}

console.log('============================================================');
console.log('  Test-skip budget (schema-driven skips)');
console.log('============================================================');
console.log(`  Test files scanned:     ${files.length}`);
console.log(`  markTestSkipped total:  ${total}`);
console.log(`  Schema-driven skips:    ${schemaCount}`);
console.log(`  Budget (ceiling):       ${BUDGET}`);
console.log('============================================================');

if (REPORT_ONLY) {
  for (const hit of schemaHits.sort()) console.log(`  • ${hit}`);
  console.log('');
  console.log(`Report only — ${schemaCount} schema-driven skips listed above.`);
  process.exit(0);
}

if (schemaCount > BUDGET) {
  console.log('');
  console.log(`FAIL: schema-driven test skips rose to ${schemaCount} (budget ${BUDGET}).`);
  console.log('  These tests do not run — they skip when the test DB lacks a table/column.');
  console.log('  Either add a real test (preferred) or refresh the schema so it runs:');
  console.log('    bash scripts/refresh-schema-dump.sh --production');
  console.log('  Do NOT raise the budget to make this pass.');
  process.exit(1);
}

if (schemaCount < BUDGET) {
  console.log('');
  console.log(`PASS — and progress! ${schemaCount} < budget ${BUDGET}.`);
  console.log(`  Lower BASELINE in this script to ${schemaCount} to lock in the gain.`);
  process.exit(0);
}

console.log('');
console.log('PASS: schema-driven skips at budget. Drive this number DOWN over time.');
process.exit(0);
