#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * build-stub-route-inventory — resolve every do-nothing endpoint to its FULL
 * route path, so "is there a stub on this journey's path?" becomes answerable.
 *
 * 🔴 WHY THIS EXISTS. `check-noop-stubs.ps1` counts stubs and enforces a
 * shrink-only baseline, and `noop-stubs-baseline.json` records counts PER FILE.
 * Neither records the route PATH. That made ADR-0004 certification condition 5
 * — "no do-nothing endpoint sits on the path the journey exercises" — literally
 * uncheckable: you could not ask whether a certified journey touched a stub.
 * A 2026-08-21 audit found condition 5 had therefore never been verified for any
 * row, while 21 rows were carried as PROVEN.
 *
 * 🔴 The stub scanner sees `[HttpGet("access-log")]` but not the controller's
 * `[Route("api/...")]` prefix, so its output is a relative fragment. This script
 * joins the two and emits absolute paths, plus the `/api/v2` alias spellings the
 * clients actually call.
 *
 * Output: aspnet-backend/artifacts/parity/stubs/stub-routes.json (gitignored —
 * artifacts/ is ignored by aspnet-backend/.gitignore; regenerate on demand).
 *
 * Usage:
 *   node aspnet-backend/scripts/build-stub-route-inventory.mjs
 *   node aspnet-backend/scripts/build-stub-route-inventory.mjs --check <path...>
 *
 * `--check` takes one or more request paths and reports, for each, whether it
 * resolves to a known stub. That is the condition-5 gate for a journey: feed it
 * the endpoints a smoke step touched.
 *
 * 🔴 Honesty boundary: this is STATIC. It resolves attribute routes only. It
 * cannot see conventional routing, dynamically registered endpoints, or an alias
 * generated at runtime. A path this script calls clean is "not a known stub",
 * never "proven to do work" — for that, open the method body.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASPNET_ROOT = resolve(HERE, '..');
const CONTROLLERS = join(ASPNET_ROOT, 'src', 'Nexus.Api', 'Controllers');
const OUT_DIR = join(ASPNET_ROOT, 'artifacts', 'parity', 'stubs');
const OUT_FILE = join(OUT_DIR, 'stub-routes.json');

/** Run the canonical scanner so there is ONE definition of "stub", not two. */
const runScanner = () => {
  const script = join(ASPNET_ROOT, 'scripts', 'check-noop-stubs.ps1');
  // The scanner exits non-zero when the count differs from its baseline; that is
  // its ratchet talking, not a failure of this inventory. Capture output anyway.
  try {
    return execFileSync('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Detail'
    ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  } catch (error) {
    if (typeof error.stdout === 'string' && error.stdout.length > 0) return error.stdout;
    throw error;
  }
};

/** `  File.cs:114  MethodName  [HttpGet("access-log")]` */
const DETAIL = /^\s{2}(\S+\.cs):(\d+)\s+(\S+)\s+\[Http(Get|Post|Put|Delete|Patch)\b(?:\(\s*"([^"]*)"\s*\))?/;

const parseFindings = (stdout) => {
  const findings = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = DETAIL.exec(line);
    if (!m) continue;
    findings.push({
      file: m[1],
      line: Number(m[2]),
      method: m[3],
      verb: m[4].toUpperCase(),
      template: m[5] ?? ''
    });
  }
  return findings;
};

/** Controller-level [Route("...")] prefix, and its [ApiController] area if any. */
const controllerPrefix = (fileName) => {
  const full = join(CONTROLLERS, fileName);
  if (!existsSync(full)) return null;
  const text = readFileSync(full, 'utf8');
  // Take the LAST [Route(...)] before the class declaration — attributes stack.
  const beforeClass = text.split(/\bpublic\s+(?:sealed\s+|abstract\s+|partial\s+)*class\b/)[0] ?? text;
  const routes = [...beforeClass.matchAll(/\[Route\(\s*"([^"]*)"\s*\)\]/g)].map((m) => m[1]);
  return routes.length ? routes[routes.length - 1] : '';
};

const joinPath = (prefix, template) => {
  const clean = (s) => String(s ?? '').replace(/^\/+|\/+$/g, '');
  const parts = [clean(prefix), clean(template)].filter(Boolean);
  return '/' + parts.join('/');
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

const build = () => {
  const findings = parseFindings(runScanner());
  if (findings.length === 0) {
    console.error('🔴 Parsed zero stub findings. The scanner output format may have changed —');
    console.error('   fix this parser rather than accepting an empty inventory as "no stubs".');
    process.exit(2);
  }

  // 🔴 PARSER SANITY CHECK. The first version of this script read the route
  // template from the wrong regex capture group, so EVERY template came out
  // empty, every path collapsed to the controller prefix, and `--check` reported
  // "clean" for paths that are provably stubs (`/api/access-log` among them). A
  // guard that answers "clean" on its own parse failure is worse than no guard.
  // If most templates are empty, the format has changed: fail loudly.
  const emptyTemplates = findings.filter((f) => !f.template).length;
  if (emptyTemplates > findings.length / 2) {
    console.error(`🔴 ${emptyTemplates} of ${findings.length} findings parsed with an EMPTY route`);
    console.error('   template. That is a parser failure, not a codebase without routes.');
    console.error('   Refusing to emit an inventory that would report real stubs as clean.');
    process.exit(2);
  }

  const prefixCache = new Map();
  const routes = [];
  const unresolved = [];

  for (const f of findings) {
    if (!prefixCache.has(f.file)) prefixCache.set(f.file, controllerPrefix(f.file));
    const prefix = prefixCache.get(f.file);
    if (prefix === null) {
      unresolved.push({ ...f, reason: 'controller file not found' });
      continue;
    }
    const path = joinPath(prefix, f.template);
    const entry = { ...f, prefix, path, normalised: normalise(path), aliases: [] };
    // Clients call /api/v2/... where controllers often declare /api/...; the
    // alias convention generates the v2 spelling, so record both.
    if (/^\/api\//i.test(path) && !/^\/api\/v2\//i.test(path)) {
      entry.aliases.push(path.replace(/^\/api\//i, '/api/v2/'));
    }
    routes.push(entry);
  }

  routes.sort((a, b) => a.path.localeCompare(b.path) || a.verb.localeCompare(b.verb));

  const byFile = {};
  for (const r of routes) byFile[r.file] = (byFile[r.file] ?? 0) + 1;

  const report = {
    _comment: 'Generated. Full route paths for every do-nothing endpoint, so ADR-0004 '
      + 'certification condition 5 can be checked. STATIC: attribute routes only.',
    generated_at: new Date().toISOString().slice(0, 10),
    scanner: 'aspnet-backend/scripts/check-noop-stubs.ps1 -Detail',
    total_findings: findings.length,
    total_routes_resolved: routes.length,
    unresolved: unresolved.length,
    by_file: byFile,
    routes
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(report, null, 2) + '\n', 'utf8');

  console.log(`stub-route-inventory: ${routes.length} of ${findings.length} findings resolved to full paths`);
  if (unresolved.length) {
    console.log(`  🔴 ${unresolved.length} unresolved — listed in the artifact, do not treat as clean`);
  }
  console.log(`  wrote ${OUT_FILE}`);
  return report;
};

/** Condition-5 gate: does any of these request paths hit a known stub? */
const check = (report, paths) => {
  const matchers = report.routes.flatMap((r) =>
    [r.path, ...r.aliases].map((p) => ({ re: toMatcher(p), r, declared: p })));

  let hits = 0;
  for (const raw of paths) {
    const p = normalise(raw.split('?')[0]);
    const found = matchers.filter((m) => m.re.test(p));
    if (found.length === 0) {
      console.log(`  clean   ${raw}`);
      continue;
    }
    hits += 1;
    for (const m of found) {
      console.log(`  🔴 STUB  ${raw}  ->  ${m.r.file}:${m.r.line} ${m.r.method} (${m.r.verb} ${m.declared})`);
    }
  }
  console.log('');
  if (hits === 0) {
    console.log('condition 5: no known stub on any path given. NOTE: "not a known stub" is');
    console.log('not "proven to do work" — this scan is static and sees attribute routes only.');
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
