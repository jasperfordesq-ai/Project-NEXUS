// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * check-db-column-references.mjs — fail when PHP writes a column that does not exist.
 *
 * WHY THIS EXISTS
 * ---------------
 * On 2026-07-30 a documentation audit found `docs/modules/groups.md` citing a
 * `group_bans` table. The table had never existed — no migration, no schema dump
 * entry — and `GroupModerationService::isUserBanned()` had been querying it since
 * 2026-03-20. Chasing that down found the same bug three more times in the same
 * service, in a form no table-level check catches: writes to `updated_at`,
 * `moderated_at` and `action_taken` on `group_content_flags`, a table that DOES
 * exist, whose real columns are `resolved_at` and `moderation_action`. Every one
 * of those writes threw.
 *
 * It stayed invisible for four months because each method wrapped its whole body
 * in `catch (\Throwable)` and returned a plausible value — `null`, `false`, `[]`.
 * A schema mismatch reads as "nothing to do", not "broken". Nothing in the
 * pipeline could see it: PHPStan does not know the schema, and the tests that
 * cover these paths assert the swallowed return value.
 *
 * The provenance is a single commit: `de2e48396` (2026-03-20, "add missing
 * service methods") wrote 15 services against an imagined schema. This gate is
 * the check that commit needed.
 *
 * WHY NO DATABASE
 * ---------------
 * It parses the committed `database/schema/mysql-schema.sql`, not a live
 * connection. A gate that needs a database can pass vacuously on a CI shard whose
 * env config points somewhere empty — and "0 problems found" then means "found
 * nothing to look at". Reading the committed dump makes a green result mean
 * something everywhere, including on a laptop with Docker stopped.
 *
 * PRECISION OVER RECALL
 * ---------------------
 * Only patterns where BOTH the table and the column are literal are checked:
 *
 *   DB::table('t')->insert/update/updateOrInsert/insertGetId([ 'col' => ... ])
 *   INSERT INTO t (col, col, ...)
 *   UPDATE t SET col = ...
 *
 * The first draft of this scan used a fixed character window after `->update(`
 * and swept up keys from *return* arrays (`['success' => true]`) as if they were
 * columns: 93 hits, almost all noise. It now walks the argument list with bracket
 * matching and takes keys only from the top level of the array argument, where a
 * column name is the only thing a key can be. Keys nested inside a sub-array (a
 * JSON payload, say) are skipped deliberately.
 *
 * `where()` / `orderBy()` / `select()` are NOT checked: those can legitimately
 * name a column on a joined table, so they cannot be resolved without real query
 * analysis, and a false positive here would get the whole gate switched off.
 *
 * Usage:
 *   node scripts/check-db-column-references.mjs            # gate
 *   node scripts/check-db-column-references.mjs --details  # list every pair checked
 *   node scripts/check-db-column-references.mjs --json     # machine-readable
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCHEMA_FILE = path.join(ROOT, 'database', 'schema', 'mysql-schema.sql');
const SCAN_ROOTS = ['app'];

const args = process.argv.slice(2);
const SHOW_DETAILS = args.includes('--details');
const AS_JSON = args.includes('--json');

/**
 * Pre-existing problems live in .github/db-column-reference-baseline.json so the
 * gate can block from day one instead of being switched off until someone has
 * time, and so shrinking it is a reviewable diff rather than a code edit.
 *
 * SHRINK-ONLY, and enforced in both directions: an entry that no longer occurs
 * fails the gate, so a fix cannot land without removing its entry.
 */
const BASELINE_FILE = path.join(ROOT, '.github', 'db-column-reference-baseline.json');

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) {
    console.error(`Missing ${path.relative(ROOT, BASELINE_FILE)} — create it or the gate cannot distinguish new problems from old.`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  return {
    columns: new Map(Object.entries(raw.columns ?? {})),
    absentTables: new Map(Object.entries(raw.absentTables ?? {})),
  };
}

const baseline = loadBaseline();
const KNOWN = baseline.columns;
const KNOWN_ABSENT_TABLES = baseline.absentTables;

// ── schema ───────────────────────────────────────────────────────────────────

function loadSchema(file) {
  if (!fs.existsSync(file)) {
    console.error(`Missing ${path.relative(ROOT, file)} — this gate cannot run without the schema dump.`);
    process.exit(1);
  }
  const sql = fs.readFileSync(file, 'utf8');
  const tables = new Map();
  const re = /CREATE TABLE `([^`]+)` \(([\s\S]*?)\n\) ENGINE/g;
  let match;
  while ((match = re.exec(sql)) !== null) {
    const columns = new Set();
    for (const line of match[2].split('\n')) {
      // Column definitions only: `name` type ... . KEY/CONSTRAINT lines do not
      // match because they are not backtick-first.
      const column = line.match(/^\s+`([^`]+)`\s+\S/);
      if (column) columns.add(column[1]);
    }
    tables.set(match[1], columns);
  }
  if (tables.size === 0) {
    console.error('Parsed 0 tables from the schema dump — the parser or the dump format has changed.');
    process.exit(1);
  }
  return tables;
}

// ── extraction ───────────────────────────────────────────────────────────────

const lineOf = (source, index) => source.slice(0, index).split('\n').length;

/**
 * Walk the argument list starting at the '(' index, honouring nesting and PHP
 * string literals, and return the array-literal keys at the top level.
 */
function topLevelArrayKeys(source, openParenIndex) {
  const keys = [];
  let parens = 0;
  let brackets = 0;
  let quote = null;

  for (let i = openParenIndex; i < source.length; i++) {
    const ch = source[i];

    if (quote) {
      if (ch === '\\') { i++; continue; }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === "'" || ch === '"') {
      if (brackets === 1) {
        const literal = source.slice(i).match(/^(['"])([A-Za-z0-9_]+)\1\s*=>/);
        if (literal) keys.push(literal[2]);
      }
      quote = ch;
      continue;
    }

    if (ch === '(') parens++;
    else if (ch === ')') { parens--; if (parens === 0) break; }
    else if (ch === '[') brackets++;
    else if (ch === ']') brackets--;
  }

  return keys;
}

/**
 * A write can legitimately name a column that is not in the schema when it is
 * guarded by a runtime existence check — an optional column a deployment may or
 * may not have. PasswordResetController does exactly this:
 *
 *   $columns = DB::select("SHOW COLUMNS FROM users LIKE 'password_changed_at'");
 *   if (!empty($columns)) { DB::update("UPDATE users SET password_changed_at ..."); }
 *
 * The write never executes without the column, so it is not a defect. Reporting
 * it anyway would either train people to ignore this gate or push them to delete
 * a deliberate compatibility shim. Scoped to the enclosing function so a guard
 * elsewhere in the file cannot excuse an unguarded write.
 */
const GUARD_PATTERN = /SHOW\s+COLUMNS|SHOW\s+TABLES\s+LIKE|Schema::hasColumn|Schema::hasTable|information_schema/i;

/**
 * The guard must NAME the thing being guarded.
 *
 * A first version treated any guard anywhere in the enclosing function as
 * excusing every write in it, and skipped 505 of 8,442 pairs — a `hasTable()`
 * check would have silently exempted twenty unrelated column writes. Requiring
 * the guard to mention the specific identifier brings it back to the one real
 * case and keeps the gate honest.
 *
 * @param {string} identifier column or table name the write depends on
 */
function isGuarded(source, writeIndex, identifier) {
  const functionStart = source.lastIndexOf('function ', writeIndex);
  if (functionStart === -1) return false;
  const scope = source.slice(functionStart, writeIndex);
  if (!GUARD_PATTERN.test(scope)) return false;
  return scope.includes(identifier);
}

function extractPairs(file) {
  const source = fs.readFileSync(file, 'utf8');
  const pairs = [];

  const tableCall = /DB::table\(\s*'([a-z0-9_]+)'\s*\)/g;
  let match;
  while ((match = tableCall.exec(source)) !== null) {
    const table = match[1];
    const afterIndex = match.index + match[0].length;
    const rest = source.slice(afterIndex);
    // Stop at the statement end or the next DB::table(, so a write is never
    // attributed to the wrong table.
    const stop = rest.search(/;|DB::table\(/);
    const chain = stop === -1 ? rest : rest.slice(0, stop);
    const writeCall = chain.match(/->(insert|update|updateOrInsert|insertGetId)\s*\(/);
    if (!writeCall) continue;

    const openParen = afterIndex + writeCall.index + writeCall[0].length - 1;
    for (const column of topLevelArrayKeys(source, openParen)) {
      if (isGuarded(source, match.index, column)) continue;
      pairs.push({ table, column, line: lineOf(source, match.index), how: `->${writeCall[1]}()` });
    }
  }

  for (const insert of source.matchAll(/INSERT\s+(?:IGNORE\s+)?INTO\s+`?([a-z0-9_]+)`?\s*\(([^)]*)\)/gi)) {
    for (const raw of insert[2].split(',')) {
      const column = raw.trim().replace(/`/g, '');
      if (/^[a-z0-9_]+$/.test(column) && !isGuarded(source, insert.index, column)) {
        pairs.push({ table: insert[1], column, line: lineOf(source, insert.index), how: 'INSERT INTO' });
      }
    }
  }

  for (const update of source.matchAll(/UPDATE\s+`?([a-z0-9_]+)`?\s+SET\s+([\s\S]{0,500}?)(?:\bWHERE\b|["'])/gi)) {
    for (const assignment of update[2].split(',')) {
      const column = (assignment.match(/`?([a-z0-9_]+)`?\s*=/) || [])[1];
      if (column && !isGuarded(source, update.index, column)) {
        pairs.push({ table: update[1], column, line: lineOf(source, update.index), how: 'UPDATE SET' });
      }
    }
  }

  return pairs;
}

function phpFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) phpFiles(full, out);
    else if (entry.name.endsWith('.php')) out.push(full);
  }
  return out;
}

// ── main ─────────────────────────────────────────────────────────────────────

const schema = loadSchema(SCHEMA_FILE);
const files = SCAN_ROOTS.flatMap((r) => phpFiles(path.join(ROOT, r)));

const mismatches = [];
const absentTables = new Map();
const stale = [];
let checked = 0;
const seenKnown = new Set();
const seenAbsent = new Set();

for (const file of files) {
  const relative = path.relative(ROOT, file).replace(/\\/g, '/');
  for (const pair of extractPairs(file)) {
    if (!schema.has(pair.table)) {
      const key = pair.table;
      if (KNOWN_ABSENT_TABLES.has(key)) { seenAbsent.add(key); continue; }
      if (!absentTables.has(key)) absentTables.set(key, `${relative}:${pair.line}`);
      continue;
    }
    checked++;
    if (schema.get(pair.table).has(pair.column)) continue;

    const key = `${pair.table}.${pair.column}`;
    if (KNOWN.has(key)) { seenKnown.add(key); continue; }
    mismatches.push({ file: relative, ...pair });
  }
}

for (const key of KNOWN.keys()) if (!seenKnown.has(key)) stale.push(`KNOWN: ${key}`);
for (const key of KNOWN_ABSENT_TABLES.keys()) if (!seenAbsent.has(key)) stale.push(`KNOWN_ABSENT_TABLES: ${key}`);

if (AS_JSON) {
  console.log(JSON.stringify({ checked, mismatches, absentTables: [...absentTables], stale }, null, 2));
} else {
  console.log('============================================================');
  console.log('  DB Column Reference Check');
  console.log('============================================================');
  console.log(`  Schema tables:            ${schema.size}`);
  console.log(`  PHP files scanned:        ${files.length}`);
  console.log(`  (table, column) checked:  ${checked}`);
  console.log(`  Known, tracked:           ${KNOWN.size + KNOWN_ABSENT_TABLES.size}`);
  console.log('');
}

if (SHOW_DETAILS) {
  for (const [key, meta] of KNOWN) console.log(`  tracked  ${key.padEnd(40)} [${meta.status}] ${meta.where}`);
  for (const [table, meta] of KNOWN_ABSENT_TABLES) console.log(`  tracked  ${(table + ' (absent table)').padEnd(40)} [${meta.status}] ${meta.where}`);
  console.log('');
}

let failed = false;

if (mismatches.length > 0) {
  failed = true;
  console.error('FAIL: PHP writes columns that do not exist in the schema dump.');
  console.error('');
  for (const m of mismatches) {
    console.error(`  ${m.file}:${m.line}`);
    console.error(`      ${m.table}.${m.column}  via ${m.how}`);
    const columns = [...schema.get(m.table)].join(', ');
    console.error(`      ${m.table} has: ${columns}`);
  }
  console.error('');
  console.error('  Every one of these throws at runtime. If the method wraps its body in');
  console.error('  catch (\\Throwable) it will look like "nothing to do" rather than failing,');
  console.error('  which is how the group_content_flags writes went unnoticed for four months.');
  console.error('  Fix the column name, or add the migration and refresh the dump with');
  console.error('  bash scripts/refresh-schema-dump.sh.');
  console.error('');
}

if (absentTables.size > 0) {
  failed = true;
  console.error('FAIL: PHP reads or writes tables that exist in no migration and no dump.');
  console.error('');
  for (const [table, where] of absentTables) console.error(`  ${table}  first seen at ${where}`);
  console.error('');
  console.error('  Either the feature was never finished (delete the code) or a migration was');
  console.error('  lost (add it and refresh the dump). Do not leave the query in place: inside');
  console.error('  a catch-all it reports a plausible value and reads as a working control.');
  console.error('');
}

if (stale.length > 0) {
  failed = true;
  console.error('FAIL: tracked entries no longer occur — the list must shrink when a fix lands.');
  console.error('');
  for (const s of stale) console.error(`  ${s}`);
  console.error('');
  console.error('  Remove them from this script; that is what "fixed" looks like here.');
  console.error('');
}

if (failed) process.exit(1);

if (!AS_JSON) {
  console.log(`PASS: every literal column write resolves against the schema dump (${checked} checked).`);
  if (KNOWN.size + KNOWN_ABSENT_TABLES.size > 0) {
    console.log(`  ${KNOWN.size + KNOWN_ABSENT_TABLES.size} pre-existing problem(s) tracked in this script — shrink-only.`);
  }
}
