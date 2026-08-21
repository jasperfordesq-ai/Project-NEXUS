#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * build-stub-route-inventory — resolve every do-nothing endpoint to its FULL
 * route path, so "is there a stub on this journey's path?" becomes answerable.
 *
 * 🔴 WHY THIS EXISTS. `check-noop-stubs.ps1` counts do-nothing endpoints and
 * enforces a shrink-only baseline; `noop-stubs-baseline.json` records counts per
 * file and per category. Neither records the route PATH. That made ADR-0004
 * certification condition 5 — "no do-nothing endpoint sits on the path the
 * journey exercises" — literally uncheckable: you could not ask whether a
 * certified journey touched one. A 2026-08-21 audit found condition 5 had
 * therefore never been verified for any row, while 21 rows were carried as
 * PROVEN.
 *
 * 🔴 REWRITTEN 2026-08-21, TWICE OVER. Read this before changing anything here.
 *
 * 1. It used to SCRAPE the scanner's `-Detail` human output with a regex. That
 *    is how it once read the route template from the wrong capture group, so
 *    every template came out empty, every path collapsed to the controller
 *    prefix, and `--check` answered "clean" for paths that are provably stubs
 *    (`/api/access-log` among them). A guard that answers "clean" on its own
 *    parse failure is worse than no guard. It now reads
 *    `check-noop-stubs.ps1 -Json`, a declared machine-readable contract.
 *
 * 2. It recorded ONE route per do-nothing METHOD, and a method can carry many.
 *    `ReactFrontendCompatibilityController.AdminEmptyData` carries six `[Http*]`
 *    attributes and the inventory listed one. That is exactly how certifying
 *    ledger row 1.21 asked about `/api/v2/exchanges/{id}/accept` and `/complete`
 *    and got CLEAN for both while `AdminEmptyData` served them. The scanner now
 *    emits one finding per ROUTE, so a method carrying six reports six. The
 *    2026-08-21 measurement: 316 flagged methods carried 375 routes — 59 that
 *    this inventory could not see, plus the ones below it could not resolve.
 *
 * 3. Path resolution moved INTO the scanner, because this file got it wrong in
 *    two ways that both produced false "clean" answers:
 *      - `~/api/v2/...` and `/api/...` templates are ABSOLUTE in ASP.NET (they
 *        ignore the controller prefix). This joined them onto the prefix anyway,
 *        yielding `/api/auth/~/api/v2/auth/oauth/me/identities` — a path no
 *        client can ever call, so the five OAuth stubs were unfindable.
 *      - `[Route("[controller]")]` is real in this tree (`HealthController`),
 *        and an unresolved `/[controller]/live` likewise matches nothing.
 *
 * 4. The scanner now reports FOUR categories, not one: `noop_method`,
 *    `echo_store` (a route on an `AdminExplicitParityController` catch-all
 *    dispatcher with no switch branch, falling through to the generic echo
 *    store), `hardcoded_payload`, and `defensible`. `echo_store` alone is 177
 *    routes that this inventory previously could not see at all, because the
 *    echo store touches the database and so passed the old "does it do work?"
 *    heuristic. Defensible routes are carried separately and are NOT a
 *    condition-5 failure.
 *
 * Output: aspnet-backend/artifacts/parity/stubs/stub-routes.json (gitignored —
 * artifacts/ is ignored by aspnet-backend/.gitignore; regenerate on demand).
 *
 * Usage:
 *   node aspnet-backend/scripts/build-stub-route-inventory.mjs
 *   node aspnet-backend/scripts/build-stub-route-inventory.mjs --check <path...>
 *
 * `--check` takes one or more request paths and reports, for each, whether it
 * resolves to a known do-nothing endpoint. That is the condition-5 gate for a
 * journey: feed it the endpoints a smoke step touched.
 *
 * 🔴 Honesty boundary: this is STATIC. It resolves attribute routes only. It
 * cannot see conventional routing, dynamically registered endpoints, or an alias
 * generated at runtime — `AdminV2RouteAliasConvention` synthesises most
 * `/api/v2` spellings at startup and appears in no source file, which is why the
 * `/api/` → `/api/v2/` alias below is recorded rather than discovered. A path
 * this script calls clean is "not a known do-nothing endpoint", never "proven to
 * do work" — for that, open the method body.
 */

import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASPNET_ROOT = resolve(HERE, '..');
const OUT_DIR = join(ASPNET_ROOT, 'artifacts', 'parity', 'stubs');
const OUT_FILE = join(OUT_DIR, 'stub-routes.json');

/**
 * Run the canonical scanner so there is ONE definition of "does no work", not
 * two, and read its declared JSON output rather than scraping its prose.
 */
const runScanner = () => {
  const script = join(ASPNET_ROOT, 'scripts', 'check-noop-stubs.ps1');
  const tmp = join(tmpdir(), `nexus-noop-findings-${process.pid}.json`);
  try {
    // The scanner exits non-zero when a count differs from its baseline; that is
    // its ratchet talking, not a failure of this inventory. The JSON is written
    // before the ratchet runs, so read it either way.
    try {
      execFileSync('powershell', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Json', tmp
      ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      // The scanner's own ratchet exits non-zero on a count change and that is
      // fine - the JSON is written before the ratchet runs. Anything that
      // prevented the JSON from appearing is NOT fine, and must fail closed:
      // this file's predecessor answered "clean" on its own failure.
      if (!existsSync(tmp)) {
        console.error('\u{1F534} Could not run the stub scanner, so there is NO evidence about any path.');
        console.error('   This is UNAVAILABLE, not clean. Exit 2.');
        const detail = (error && (error.stderr || error.message)) || String(error);
        console.error('   ' + String(detail).split(/\r?\n/).filter(Boolean).slice(0, 3).join('\n   '));
        process.exit(2);
      }
    }
    if (!existsSync(tmp)) {
      console.error('🔴 The scanner produced no findings file. Refusing to emit an inventory');
      console.error('   that would report every path as clean. Run the scanner by hand:');
      console.error(`   powershell -NoProfile -ExecutionPolicy Bypass -File ${script} -Json out.json`);
      process.exit(2);
    }
    return JSON.parse(readFileSync(tmp, 'utf8').replace(/^﻿/, ''));
  } finally {
    try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* best effort */ }
  }
};

/**
 * Normalise for comparison: lowercase, strip the route constraint from
 * `{id:int}` so it matches a client's `{id}`, and collapse any parameter to a
 * single wildcard token so `/users/{id}` matches `/users/42`.
 */
const normalise = (p) => p
  .toLowerCase()
  .replace(/\{[^}]*\}/g, '{*}')
  .replace(/\/+/g, '/')
  .replace(/\/$/, '');

const toMatcher = (p) => new RegExp('^' + normalise(p)
  .split('{*}')
  .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('[^/]+') + '$');

/** Clients call /api/v2/... where controllers often declare /api/...; record both. */
const withAliases = (f) => {
  const aliases = [];
  if (/^\/api\//i.test(f.path) && !/^\/api\/v2\//i.test(f.path)) {
    aliases.push(f.path.replace(/^\/api\//i, '/api/v2/'));
  }
  return {
    file: f.file,
    line: f.line,
    method: f.method,
    category: f.category,
    verb: f.verb,
    template: f.template,
    path: f.path,
    normalised: normalise(f.path),
    reason: f.reason,
    aliases
  };
};

const build = () => {
  const scan = runScanner();
  const findings = Array.isArray(scan.findings) ? scan.findings : [];
  const defensibleFindings = Array.isArray(scan.defensible_findings) ? scan.defensible_findings : [];

  if (findings.length === 0) {
    console.error('🔴 The scanner reported ZERO do-nothing endpoints. That has never been true of');
    console.error('   this backend. Treat it as a broken scanner, not a clean codebase, and fix');
    console.error('   the scanner rather than accepting an empty inventory.');
    process.exit(2);
  }

  // 🔴 CONTRACT CHECKS. The predecessor of this file answered "clean" on its own
  // parse failure. These make that impossible to repeat silently.
  const problems = [];
  const withoutPath = findings.filter((f) => !f.path || f.path === '/' || f.path.includes('[controller]'));
  if (withoutPath.length > 0) {
    problems.push(`${withoutPath.length} finding(s) carry an unusable path (empty, "/" or an unresolved [controller] token)`);
  }
  const categories = new Set(findings.map((f) => f.category));
  for (const required of ['noop_method', 'echo_store']) {
    if (!categories.has(required)) {
      problems.push(`no finding carries category "${required}" — a whole detector has gone silent`);
    }
  }
  const distinct = new Set(findings.map((f) => `${f.verb} ${f.path}`));
  if (typeof scan.total_routes === 'number' && scan.total_routes !== distinct.size) {
    problems.push(`scanner reported total_routes=${scan.total_routes} but its findings hold ${distinct.size} distinct verb+path`);
  }
  if (problems.length > 0) {
    console.error('🔴 The scanner output does not satisfy this inventory\'s contract:');
    for (const p of problems) console.error(`   - ${p}`);
    console.error('   Refusing to emit an inventory that would report real stubs as clean.');
    process.exit(2);
  }

  const routes = findings.map(withAliases)
    .sort((a, b) => a.path.localeCompare(b.path) || a.verb.localeCompare(b.verb));
  const defensible = defensibleFindings.map(withAliases)
    .sort((a, b) => a.path.localeCompare(b.path) || a.verb.localeCompare(b.verb));

  const byFile = {};
  const byCategory = {};
  for (const r of routes) {
    byFile[r.file] = (byFile[r.file] ?? 0) + 1;
    byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
  }

  const report = {
    _comment: 'Generated. Full route paths for every do-nothing endpoint, so ADR-0004 '
      + 'certification condition 5 can be checked. STATIC: attribute routes only. One '
      + 'entry per ROUTE, not per method.',
    generated_at: new Date().toISOString().slice(0, 10),
    scanner: 'aspnet-backend/scripts/check-noop-stubs.ps1 -Json',
    unit: 'routes',
    total_routes: routes.length,
    total_distinct_routes: distinct.size,
    total_methods: scan.total_methods ?? null,
    by_category: byCategory,
    by_file: byFile,
    dispatchers: scan.dispatchers ?? [],
    routes,
    defensible_routes: defensible
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(report, null, 2) + '\n', 'utf8');

  console.log(`stub-route-inventory: ${routes.length} do-nothing route(s) across ${report.total_methods} method(s)`);
  for (const [cat, n] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${cat}`);
  }
  console.log(`  ${String(defensible.length).padStart(5)}  defensible (recorded, not a condition-5 failure)`);
  console.log(`  wrote ${OUT_FILE}`);
  return report;
};

/** Condition-5 gate: does any of these request paths hit a known stub? */
const check = (report, paths) => {
  const matchers = report.routes.flatMap((r) =>
    [r.path, ...r.aliases].map((p) => ({ re: toMatcher(p), r, declared: p })));
  const defensibleMatchers = report.defensible_routes.flatMap((r) =>
    [r.path, ...r.aliases].map((p) => ({ re: toMatcher(p), r, declared: p })));

  let hits = 0;
  for (const raw of paths) {
    const p = normalise(raw.split('?')[0]);
    const found = matchers.filter((m) => m.re.test(p));
    if (found.length === 0) {
      const excused = defensibleMatchers.filter((m) => m.re.test(p));
      if (excused.length > 0) {
        for (const m of excused) {
          console.log(`  ok(declared) ${raw}  ->  ${m.r.file}:${m.r.line} ${m.r.method} — ${m.r.reason}`);
        }
        continue;
      }
      console.log(`  clean   ${raw}`);
      continue;
    }
    hits += 1;
    for (const m of found) {
      console.log(`  🔴 STUB  ${raw}  ->  ${m.r.file}:${m.r.line} ${m.r.method} (${m.r.verb} ${m.declared}) [${m.r.category}]`);
    }
  }
  console.log('');
  if (hits === 0) {
    console.log('condition 5: no known do-nothing endpoint on any path given. NOTE: "not a known');
    console.log('stub" is not "proven to do work" — this scan is static and sees attribute routes only.');
  } else {
    console.log(`condition 5 FAILS: ${hits} of ${paths.length} path(s) resolve to a do-nothing endpoint.`);
  }
  return hits;
};

const args = process.argv.slice(2);
const checkAt = args.indexOf('--check');
const report = build();
if (checkAt !== -1) {
  const paths = args.slice(checkAt + 1).filter((a) => !a.startsWith('--'));
  if (paths.length === 0) {
    console.error('🔴 --check needs at least one request path.');
    process.exit(2);
  }
  console.log('');
  const hits = check(report, paths);
  process.exit(hits === 0 ? 0 : 1);
}
