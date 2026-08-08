// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * report-dead-skip-guards.mjs — Find schema skip guards that no longer apply.
 *
 * check-test-skip-budget.mjs FREEZES schema-driven skip debt at a ceiling. It
 * deliberately does not say which of those skips are still real. This companion
 * answers that question so the ceiling can actually be lowered.
 *
 * A large share of the guards read like:
 *
 *     $this->markTestSkipped('vol_logs table not present.');
 *
 * CI builds the test database by loading database/schema/mysql-schema.sql in
 * full (see the php-tests job), so a guard naming a table that IS in that dump
 * cannot fire in CI — the test runs, and the guard is dead weight that makes the
 * suite look weaker than it is. Worse, a dead guard is indistinguishable from a
 * live one by eye, so nobody knows how much of the 281 is real.
 *
 * This script cross-references every schema-driven skip reason against the
 * committed dump and classifies it:
 *
 *   DEAD      every table/column the reason names exists in the dump
 *   LIVE      at least one named table/column is genuinely absent
 *   UNCLEAR   no identifier could be extracted from the reason text
 *
 * DEAD guards are the removal queue: delete the guard, confirm the test really
 * passes, then lower BASELINE in check-test-skip-budget.mjs by that many.
 *
 * Reporting only — it never fails a build. The blocking ratchet stays the one
 * gate, so this can be run freely without any risk of turning main red.
 *
 * Uses only built-in Node modules, so it runs in CI without `npm install`.
 *
 * Usage:
 *   node scripts/report-dead-skip-guards.mjs            # summary + per-file counts
 *   node scripts/report-dead-skip-guards.mjs --verbose  # every individual guard
 *   node scripts/report-dead-skip-guards.mjs --json     # machine-readable
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { execSync } from 'child_process';
import { join, relative } from 'path';

const PROJECT_ROOT = process.cwd();
const TESTS_DIR = join(PROJECT_ROOT, 'tests');
const SCHEMA_FILE = join(PROJECT_ROOT, 'database', 'schema', 'mysql-schema.sql');

const VERBOSE = process.argv.includes('--verbose');
const AS_JSON = process.argv.includes('--json');

// Kept byte-identical to check-test-skip-budget.mjs so the two agree on which
// skips are "schema-driven". If that gate's regexes change, change these too.
const SCHEMA_SKIP = /missing|not present|run migrations?|schema|\bcolumn\b|\btable\b|not available in/i;
const ENV_GUARD = /redis|memcached|extension|sqlite|driver not|connection refused|no second tenant|requires? the/i;

// Words that look like snake_case identifiers but are prose, not schema objects.
const NOT_IDENTIFIERS = new Set([
  'not_present', 'test_schema', 'not_available', 'not_migrated', 'run_migrations',
  'this_test', 'test_db', 'test_database', 'no_such', 'in_this',
]);

/* ------------------------------------------------------------------ schema */

/** @returns {{tables: Set<string>, columns: Map<string, Set<string>>}} */
function loadSchema() {
  let sql;
  try {
    sql = readFileSync(SCHEMA_FILE, 'utf8');
  } catch {
    console.error(`Schema dump not found at ${relative(PROJECT_ROOT, SCHEMA_FILE)}.`);
    console.error('Cannot classify guards without it. Refresh it with scripts/refresh-schema-dump.sh.');
    process.exit(2);
  }

  const tables = new Set();
  const columns = new Map();

  // Split on CREATE TABLE so each chunk carries exactly one table's columns.
  const chunks = sql.split(/CREATE TABLE\s+/i).slice(1);
  for (const chunk of chunks) {
    const nameMatch = /^`?([A-Za-z0-9_]+)`?/.exec(chunk);
    if (!nameMatch) continue;
    const table = nameMatch[1];
    tables.add(table);

    const cols = new Set();
    // Column definitions are the backticked identifiers at the start of a line
    // inside the body; stop at the closing paren of the CREATE TABLE statement.
    const body = chunk.slice(0, chunk.search(/\n\)\s*ENGINE|\n\)\s*;/i) + 1 || undefined);
    for (const m of body.matchAll(/^\s*`([A-Za-z0-9_]+)`\s+[a-z]/gim)) cols.add(m[1]);
    columns.set(table, cols);
  }

  return { tables, columns };
}

/* ------------------------------------------------------------------- skips */

/** Extract the first quoted string argument of each markTestSkipped( call. */
function extractSkipReasons(source) {
  const reasons = [];
  const needle = 'markTestSkipped(';
  let i = 0;
  while ((i = source.indexOf(needle, i)) !== -1) {
    const after = source.slice(i + needle.length, i + needle.length + 400);
    const m = /(['"])((?:\\.|(?!\1).)*)\1/s.exec(after);
    reasons.push(m ? m[2] : '');
    i += needle.length;
  }
  return reasons;
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.php')) out.push(full);
  }
  return out;
}

function testFiles() {
  try {
    const out = execSync('git ls-files -- tests', {
      cwd: PROJECT_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    const list = out.split('\n').map((s) => s.trim())
      .filter((s) => s.endsWith('.php')).map((s) => join(PROJECT_ROOT, s));
    if (list.length > 0) return list;
  } catch { /* fall through to a filesystem walk */ }
  try {
    statSync(TESTS_DIR);
  } catch {
    console.error(`tests/ directory not found at ${TESTS_DIR}`);
    process.exit(2);
  }
  return walk(TESTS_DIR);
}

/**
 * Pull candidate schema identifiers out of a free-text skip reason.
 *
 * Three shapes occur in practice and all three must be handled, because getting
 * this wrong flips a verdict:
 *   qualified  "users.date_of_birth column not present"   → table + column
 *   bare table "caring_help_requests table missing"       → table
 *   bare column "support_recipient_id not present on vol_logs" → column, no table
 *
 * A qualified table may be a single word ("users"), so the table half must NOT
 * require an underscore. A BARE identifier must contain one, otherwise ordinary
 * prose ("missing", "schema") is mistaken for a schema object.
 */
function identifiersIn(reason) {
  const found = [];
  const consumed = [];

  // Qualified table.column first, so its halves are not re-read as bare names.
  for (const m of reason.matchAll(/`?\b([a-z][a-z0-9_]*)`?\.`?([a-z][a-z0-9_]*)`?/g)) {
    found.push({ table: m[1], column: m[2], raw: `${m[1]}.${m[2]}` });
    consumed.push(m[0]);
  }

  let rest = reason;
  for (const c of consumed) rest = rest.replace(c, ' ');

  // Wildcards ("caring_research_* tables not present") mean a family of tables.
  for (const m of rest.matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+)*)_\*/g)) {
    found.push({ prefix: m[1], raw: `${m[1]}_*` });
    rest = rest.replace(m[0], ' ');
  }

  // Bare identifiers: underscore required to keep prose out.
  for (const m of rest.matchAll(/`?\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)`?/g)) {
    if (NOT_IDENTIFIERS.has(m[1])) continue;
    found.push({ bare: m[1], raw: m[1] });
  }

  return found;
}

/** Every column name that exists anywhere in the schema. */
function allColumnNames(columns) {
  const all = new Set();
  for (const cols of columns.values()) for (const c of cols) all.add(c);
  return all;
}

/**
 * Is this identifier present in the committed schema?
 *
 * A bare name resolves as EITHER a table or a column on any table — the reason
 * text usually does not say which, and "present as a column somewhere" is
 * enough to conclude the guard's premise no longer holds.
 */
function isPresent(id, tables, columns, everyColumn) {
  if (id.prefix !== undefined) {
    for (const t of tables) if (t.startsWith(`${id.prefix}_`)) return true;
    return false;
  }
  if (id.bare !== undefined) {
    return tables.has(id.bare) || everyColumn.has(id.bare);
  }
  if (!tables.has(id.table)) return false;
  return columns.get(id.table)?.has(id.column) ?? false;
}

/* ---------------------------------------------------------------- classify */

const { tables, columns } = loadSchema();
const everyColumn = allColumnNames(columns);
const files = testFiles();

const results = [];
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const reason of extractSkipReasons(source)) {
    if (!SCHEMA_SKIP.test(reason) || ENV_GUARD.test(reason)) continue;

    const ids = identifiersIn(reason);
    const rel = relative(PROJECT_ROOT, file).replaceAll('\\', '/');

    if (ids.length === 0) {
      results.push({ file: rel, reason, verdict: 'UNCLEAR', absent: [] });
      continue;
    }

    const absent = ids
      .filter((id) => !isPresent(id, tables, columns, everyColumn))
      .map((id) => id.raw);

    results.push({
      file: rel,
      reason,
      verdict: absent.length === 0 ? 'DEAD' : 'LIVE',
      absent,
    });
  }
}

const dead = results.filter((r) => r.verdict === 'DEAD');
const live = results.filter((r) => r.verdict === 'LIVE');
const unclear = results.filter((r) => r.verdict === 'UNCLEAR');

if (AS_JSON) {
  console.log(JSON.stringify({
    schemaTables: tables.size,
    totals: { dead: dead.length, live: live.length, unclear: unclear.length, all: results.length },
    results,
  }, null, 2));
  process.exit(0);
}

const line = '='.repeat(60);
console.log(line);
console.log('  Dead schema-skip guards (reporting only — never fails)');
console.log(line);
console.log(`  Tables in committed schema dump: ${tables.size}`);
console.log(`  Schema-driven skip guards:       ${results.length}`);
console.log(`    DEAD    (table/column exists): ${dead.length}`);
console.log(`    LIVE    (genuinely absent):    ${live.length}`);
console.log(`    UNCLEAR (no identifier found): ${unclear.length}`);
console.log(line);

if (dead.length > 0) {
  const byFile = new Map();
  for (const r of dead) byFile.set(r.file, (byFile.get(r.file) ?? 0) + 1);
  const ranked = [...byFile.entries()].sort((a, b) => b[1] - a[1]);

  console.log('\nDEAD guards by file (best removal candidates first):\n');
  for (const [file, count] of ranked.slice(0, VERBOSE ? ranked.length : 25)) {
    console.log(`  ${String(count).padStart(3)}  ${file}`);
  }
  if (!VERBOSE && ranked.length > 25) {
    console.log(`  ... and ${ranked.length - 25} more files (--verbose for all)`);
  }

  if (VERBOSE) {
    console.log('\nEvery DEAD guard:\n');
    for (const r of dead) console.log(`  ${r.file}\n      "${r.reason}"`);
  }
}

if (live.length > 0 && VERBOSE) {
  console.log('\nLIVE guards (the named object really is missing from the dump):\n');
  for (const r of live) console.log(`  ${r.file}\n      "${r.reason}"  → absent: ${r.absent.join(', ')}`);
}

console.log('\nNext step: delete a DEAD guard, run that test file, confirm it passes,');
console.log('then lower BASELINE in scripts/check-test-skip-budget.mjs by the number removed.');

// Reporting only. The blocking ratchet is check-test-skip-budget.mjs.
process.exit(0);
