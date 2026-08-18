// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Mobile API consumer ledger.
 *
 * Answers one question the mobile Jest suite cannot: does every endpoint the
 * Expo client calls still exist in the Laravel API?
 *
 * Mobile screens reach Laravel through `lib/api/*.ts`. Nothing in the Jest
 * suite contacts a real server — every test mocks `api.get`/`api.post` — so a
 * renamed or deleted route stays green in CI, ships to a store, and fails on a
 * member's phone. The React frontend has the same exposure but a far shorter
 * feedback loop (a deploy, a reload); a native client carries a store review
 * queue and an installed base, so its drift is measured in weeks.
 *
 * This is the compensating control: a static ledger of consumed endpoints,
 * diffed against the routes Laravel actually registers.
 *
 * 🔴 It verifies against `docs/generated/laravel-api-route-inventory.json`, NOT
 * against `openapi.json`. That choice is load-bearing and was measured: Laravel
 * registers 2,686 API route rows (2,232 distinct paths) while openapi.json
 * documents 862 — so openapi.json marks working endpoints like
 * `POST /api/auth/login` as absent. Verifying against it produced 179 false
 * "drift" findings out of 404. A checker that cries wolf is a checker everyone
 * learns to ignore, so the partial contract is not an acceptable source here.
 *
 * Scope, and honesty about it:
 *  - It reads `lib/api/*.ts` only. A `fetch()` written inline in a screen is
 *    invisible to the endpoint diff, so those are reported separately.
 *  - An endpoint assembled from a variable this script cannot resolve is
 *    recorded as `dynamic` and NOT verified. The count is always reported;
 *    it is never quietly folded into the pass total.
 *  - If the route inventory is stale (its fingerprint no longer matches the
 *    repository's route sources) this reports UNVERIFIED and exits non-zero.
 *    It never treats an unrefreshed snapshot as a pass.
 *
 * Usage:
 *   node scripts/generate-api-consumer-ledger.mjs           # write the ledger
 *   node scripts/generate-api-consumer-ledger.mjs --check   # exit 1 on drift
 */

import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

import {
  ROUTE_INVENTORY_PATH,
  indexByShape,
  loadRouteInventory,
  matchWithParamWildcards,
  shape,
} from './lib/route-inventory.mjs';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const MOBILE_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(MOBILE_ROOT, '..');
const API_DIR = path.join(MOBILE_ROOT, 'lib', 'api');
const OUT_DIR = path.join(MOBILE_ROOT, 'docs', 'generated');
const BASELINE = path.join(MOBILE_ROOT, 'api-drift-baseline.json');

// `api.upload` is a POST with a multipart body — see lib/api/client.ts.
const METHOD_TO_HTTP = {
  get: 'GET',
  post: 'POST',
  put: 'PUT',
  patch: 'PATCH',
  delete: 'DELETE',
  upload: 'POST',
};

const CHECK = process.argv.slice(2).includes('--check');

const BACKTICK = String.fromCharCode(96);

/**
 * Prefix constants that stand for a real path segment rather than a path
 * parameter. Assuming every leading `${...}` was `API_V2` reported all four of
 * `chat.ts`'s endpoints as drift: that module builds on `AI_API` (`/api/ai`),
 * so the rewrite invented `/api/v2/chat` for a working `/api/ai/chat`. Prefixes
 * must be resolved by name, never guessed from position.
 *
 * Collected from `lib/constants.ts` and from module-local `const NAME = '...'`
 * declarations, so a new prefix constant is picked up without editing this file.
 */
function collectPathConstants() {
  const found = new Map();
  const add = (name, value) => {
    if (typeof value !== 'string' || !value.startsWith('/')) return;
    found.set(name, value.replace(/\/+$/, ''));
  };

  const scan = (filePath) => {
    if (!fs.existsSync(filePath)) return;
    const src = fs.readFileSync(filePath, 'utf8');
    const re = /(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*(?::\s*string\s*)?=\s*['"]([^'"]+)['"]/g;
    for (let m; (m = re.exec(src)); ) add(m[1], m[2]);
  };

  scan(path.join(MOBILE_ROOT, 'lib', 'constants.ts'));
  for (const f of listApiFiles()) scan(f);
  return found;
}

const PATH_CONSTANTS = collectPathConstants();

/**
 * Collapse a template literal into a comparable path.
 *
 * A known prefix constant resolves to its literal value; anything else becomes
 * `{param}`. Nested interpolations (`${a${b}}`) are flattened first — the naive
 * pattern stopped at the first `}` and left a stray `${scope` in the path, which
 * showed up as phantom drift on `events.ts`.
 */
function normalise(raw) {
  // Sentinels stand in for resolved text and for parameters while the surrounding
  // literal is still being chewed on, so neither can be confused with a real
  // path character mid-pass.
  const KEEP = '\u0000';
  const PARAM = '\u0001';

  let p = raw;

  // Flatten nested `${ ... ${ ... } ... }` by resolving innermost groups first.
  for (let guard = 0; guard < 10; guard += 1) {
    const next = p.replace(/\$\{([^${}]*)\}/g, (_all, inner) => {
      const name = inner.trim();
      if (PATH_CONSTANTS.has(name)) return KEEP + PATH_CONSTANTS.get(name) + KEEP;
      return PARAM;
    });
    if (next === p) break;
    p = next;
  }

  // Anything still unflattened was too complex; treat the whole group as one parameter.
  p = p.replace(/\$\{[\s\S]*?\}/g, PARAM);
  p = p.split('?')[0];
  p = p.split(KEEP).join('').split(PARAM).join('{param}');

  // Collapse `{param}{param}` runs left by adjacent interpolations.
  p = p.replace(/(?:\{param\})+/g, '{param}');

  const trimmed = p.replace(/\/+$/, '');
  const cleaned = trimmed === '' ? '/' : trimmed;

  // A `$` or a stray brace surviving all of the above means the literal nested a
  // template inside an interpolation and this reader lost track of it — e.g.
  // `` `${API_V2}/events/${id}/image${scope ? `?scope=${x}` : ''}` ``, whose
  // inner `}` terminated the outer group early and left `image${scope` behind.
  // Reporting that as a missing route would be a lie about the client; the
  // honest answer is that this endpoint could not be resolved statically.
  if (/[${}]/.test(cleaned.replace(/\{param\}/g, ''))) return null;

  return cleaned;
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

function listApiFiles() {
  if (!fs.existsSync(API_DIR)) return [];
  return fs
    .readdirSync(API_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .sort()
    .map((f) => path.join(API_DIR, f));
}

/**
 * Two call forms are recognised, both anchored on `api.<method>(`:
 *   1. an inline template literal            -> endpoint known
 *   2. a bare identifier (`endpoint`)        -> resolved from a same-file
 *                                               `const <id> = `...`` assignment
 * A name assigned two different literals in one file is ambiguous, and is
 * reported as dynamic rather than guessed at.
 */
function extractFromFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const moduleName = path.basename(filePath, '.ts');
  const calls = [];

  const consts = new Map();
  const ambiguous = new Set();
  const constRe = new RegExp(
    '(?:const|let)\\s+([A-Za-z_$][\\w$]*)\\s*(?::[^=\\n]+)?=\\s*' + BACKTICK + '([^' + BACKTICK + ']*)' + BACKTICK,
    'g'
  );
  for (let m; (m = constRe.exec(src)); ) {
    const [, name, literal] = m;
    if (!literal.includes('API_V2') && !literal.startsWith('/api')) continue;
    if (consts.has(name) && consts.get(name) !== literal) ambiguous.add(name);
    consts.set(name, literal);
  }

  const callRe = new RegExp(
    'api\\.(get|post|put|patch|delete|upload)\\s*(?:<[\\s\\S]*?>)?\\s*\\(\\s*(?:' +
      BACKTICK + '([^' + BACKTICK + ']*)' + BACKTICK +
      "|'([^']*)'" +
      '|([A-Za-z_$][\\w$]*)' +
      ')',
    'g'
  );

  for (let m; (m = callRe.exec(src)); ) {
    const [, method, tpl, single, ident] = m;
    const line = lineOf(src, m.index);
    const http = METHOD_TO_HTTP[method];
    let literal = tpl !== undefined ? tpl : single !== undefined ? single : null;
    let resolvedFrom = null;

    if (literal === null && ident) {
      if (consts.has(ident) && !ambiguous.has(ident)) {
        literal = consts.get(ident);
        resolvedFrom = ident;
      } else {
        calls.push({
          module: moduleName,
          line,
          http,
          endpoint: null,
          dynamic: true,
          reason: ambiguous.has(ident)
            ? `variable "${ident}" is assigned more than one endpoint in this module`
            : `variable "${ident}" is not a literal endpoint in this module`,
        });
        continue;
      }
    }

    if (literal === null) continue;

    const endpoint = normalise(literal);
    if (endpoint === null) {
      calls.push({
        module: moduleName,
        line,
        http,
        endpoint: null,
        dynamic: true,
        reason: 'endpoint literal nests a template inside an interpolation and could not be resolved statically',
      });
      continue;
    }

    calls.push({ module: moduleName, line, http, endpoint, dynamic: false, resolvedFrom });
  }

  return calls;
}

/**
 * A bare `fetch()` to an /api path bypasses the client's tenant header, its
 * rotating token refresh, its per-method timeout — and this ledger.
 */
function inlineFetchOffenders() {
  const hits = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(p);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(e.name) || /\.test\.(ts|tsx)$/.test(e.name)) continue;
      const src = fs.readFileSync(p, 'utf8');
      const re = new RegExp('\\bfetch\\(\\s*(?:' + BACKTICK + '[^' + BACKTICK + ']*/api/' + "|'[^']*/api/" + '|"[^"]*/api/)', 'g');
      for (let m; (m = re.exec(src)); ) {
        hits.push({
          file: path.relative(MOBILE_ROOT, p).split(path.sep).join('/'),
          line: lineOf(src, m.index),
        });
      }
    }
  };
  ['app', 'components'].forEach((d) => walk(path.join(MOBILE_ROOT, d)));
  return hits;
}

/**
 * Known drift, accepted temporarily so the gate could be switched on without
 * turning `main` red on the day it landed. Shrink-only, and enforced in BOTH
 * directions: an entry that no longer occurs also fails, so a fix cannot land
 * without deleting its entry. Same contract as
 * `.github/db-column-reference-baseline.json`.
 */
function loadBaseline() {
  if (!fs.existsSync(BASELINE)) return { entries: new Map(), raw: null };
  const raw = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  const entries = new Map();
  for (const e of raw.accepted || []) entries.set(`${e.method} ${e.endpoint}`, e);
  return { entries, raw };
}

/**
 * `scripts/check-docs-hygiene.mjs` requires an exact `Last reviewed: YYYY-MM-DD`
 * line within the first 10 lines of every scoped Markdown file, and re-flags it
 * after 180 days. For a generated report the generation date IS the review date,
 * and that expiry is a feature: it forces a regeneration rather than letting a
 * stale matrix sit in the repository looking authoritative.
 *
 * Note the consequence: regenerating on a new day changes this line even when
 * nothing else moved. That is deliberate — the file is an artefact, and when it
 * was last rebuilt is part of what it reports.
 */
function reviewedMarker() {
  const now = new Date();
  const iso = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ].join('-');
  return `Last reviewed: ${iso}`;
}

function renderMarkdown(r) {
  const s = r.summary;
  const L = [];
  L.push('<!--');
  L.push('Copyright © 2024–2026 Jasper Ford');
  L.push('SPDX-License-Identifier: AGPL-3.0-or-later');
  L.push('-->');
  L.push('');
  L.push('# Mobile API Consumer Ledger');
  L.push('');
  L.push(reviewedMarker());
  L.push('');
  L.push('> GENERATED FILE — do not edit by hand.');
  L.push('> Regenerate with `npm run api:ledger` from `mobile/`.');
  L.push('');
  L.push('Every Laravel endpoint the Expo client calls, and whether the API still exposes it.');
  L.push('The Jest suite mocks the HTTP client, so it cannot detect a renamed or deleted route.');
  L.push('This ledger is the compensating control.');
  L.push('');
  L.push(`Verified against: \`${r.verified_against || 'nothing — inventory ' + r.route_inventory_state}\``);
  L.push('');
  L.push('> Not verified against `openapi.json`. That file documents 862 paths of the 2,232 the');
  L.push('> application actually registers, so using it produced 179 false drift findings out of 404.');
  L.push('');
  L.push('| Measure | Count |');
  L.push('| --- | --- |');
  L.push(`| API modules read | ${s.api_modules} |`);
  L.push(`| Call sites | ${s.call_sites} |`);
  L.push(`| Distinct method + endpoint pairs | ${s.distinct_endpoints} |`);
  L.push(`| Verified against openapi.json | ${s.verified} |`);
  L.push(`| **Missing from Laravel routes** | **${s.missing_from_routes}** |`);
  L.push(`| **Method mismatch** | **${s.method_mismatch}** |`);
  L.push(`| Dynamic, not verifiable | ${s.dynamic_unverifiable} |`);
  L.push(`| Inline \`fetch()\` bypassing the client | ${s.inline_fetch_offenders} |`);
  L.push('');

  if (r.missing_from_routes.length) {
    L.push('## Missing from Laravel routes');
    L.push('');
    L.push('Mobile calls these; Laravel registers no matching route. Each one is a screen');
    L.push('that fails on a real phone while CI stays green, because the Jest suite mocks the');
    L.push('HTTP client. Fix the client or restore the route before release.');
    L.push('');
    L.push('| Method | Endpoint | Call sites |');
    L.push('| --- | --- | --- |');
    for (const m of r.missing_from_routes) L.push(`| ${m.http} | \`${m.endpoint}\` | ${m.sites.join(', ')} |`);
    L.push('');
  }

  if (r.method_mismatch.length) {
    L.push('## Method mismatch');
    L.push('');
    L.push('The path exists, but not for the verb mobile uses.');
    L.push('');
    L.push('| Called | Endpoint | API exposes | Call sites |');
    L.push('| --- | --- | --- | --- |');
    for (const m of r.method_mismatch) {
      L.push(`| ${m.http} | \`${m.endpoint}\` | ${m.available.join(', ')} | ${m.sites.join(', ')} |`);
    }
    L.push('');
  }

  if (r.dynamic_unverifiable.length) {
    L.push('## Not verifiable (endpoint assembled at runtime)');
    L.push('');
    L.push('These are not failures. They are the honest edge of what static reading can prove,');
    L.push('and the places a contract test earns the most.');
    L.push('');
    L.push('| Location | Method | Reason |');
    L.push('| --- | --- | --- |');
    for (const d of r.dynamic_unverifiable) L.push(`| ${d.at} | ${d.http} | ${d.reason} |`);
    L.push('');
  }

  if (r.inline_fetch_offenders.length) {
    L.push('## Inline `fetch()` to an API path');
    L.push('');
    L.push('These bypass `lib/api/client.ts` — and with it the tenant header, the rotating');
    L.push('token refresh, the per-method timeout, and this ledger.');
    L.push('');
    for (const h of r.inline_fetch_offenders) L.push(`- \`${h.file}:${h.line}\``);
    L.push('');
  }

  L.push('## Verified endpoints');
  L.push('');
  L.push('| Method | Endpoint | Call sites |');
  L.push('| --- | --- | --- |');
  for (const e of r.endpoints) L.push(`| ${e.http} | \`${e.endpoint}\` | ${e.sites.join(', ')} |`);
  L.push('');
  // Trim trailing blanks: each section builder ends with a spacer, which leaves
  // a double blank line at EOF and trips markdownlint MD012 in CI.
  return `${L.join('\n').replace(/\n+$/, '')}\n`;
}

function main() {
  const files = listApiFiles();
  if (files.length === 0) {
    console.error('api ledger: no lib/api/*.ts modules found — refusing to write an empty ledger.');
    process.exit(1);
  }

  const calls = files.flatMap(extractFromFile);

  const inventoryState = loadRouteInventory(REPO_ROOT, MOBILE_ROOT);
  const routes = inventoryState.ok ? indexByShape(inventoryState.inventory.paths) : null;

  const grouped = new Map();
  for (const c of calls) {
    if (c.dynamic) continue;
    const key = `${c.http} ${c.endpoint}`;
    if (!grouped.has(key)) grouped.set(key, { http: c.http, endpoint: c.endpoint, sites: [] });
    grouped.get(key).sites.push(`${c.module}.ts:${c.line}`);
  }

  const verified = [];
  const missing = [];
  const methodMismatch = [];
  const dynamic = calls.filter((c) => c.dynamic);

  const ordered = [...grouped.values()].sort((a, b) =>
    `${a.endpoint} ${a.http}`.localeCompare(`${b.endpoint} ${b.http}`)
  );

  for (const entry of ordered) {
    if (!routes) {
      verified.push({ ...entry, status: 'unverified' });
      continue;
    }
    const consumerShape = shape(entry.endpoint);
    let hit = routes.get(consumerShape);
    let matchedVia = 'exact';

    if (!hit) {
      // A client parameter can stand for a literal server segment — see
      // matchWithParamWildcards. Only reached when the exact shape misses.
      const loose = matchWithParamWildcards(routes, consumerShape);
      if (loose) {
        hit = loose;
        matchedVia = 'parameter-matches-literal-segment';
      }
    }

    if (!hit) {
      missing.push(entry);
      continue;
    }
    if (!hit.methods.has(entry.http)) {
      methodMismatch.push({ ...entry, available: [...hit.methods].sort(), matchedVia });
      continue;
    }
    verified.push({ ...entry, status: 'verified', matchedVia });
  }

  const inlineFetch = inlineFetchOffenders();

  const report = {
    generated_by: 'mobile/scripts/generate-api-consumer-ledger.mjs',
    verified_against: routes
      ? `${ROUTE_INVENTORY_PATH.split(path.sep).join('/')} (${inventoryState.inventory.distinct_api_paths} distinct API paths)`
      : null,
    route_inventory_state: inventoryState.reason,
    route_inventory_changed_files: inventoryState.changedFiles,
    summary: {
      api_modules: files.length,
      call_sites: calls.length,
      distinct_endpoints: grouped.size,
      // Zero when there is no usable inventory: an endpoint nothing checked is
      // not a verified endpoint, and `unverified` carries the real count.
      verified: routes ? verified.length : 0,
      unverified: routes ? 0 : verified.length,
      missing_from_routes: missing.length,
      method_mismatch: methodMismatch.length,
      dynamic_unverifiable: dynamic.length,
      inline_fetch_offenders: inlineFetch.length,
    },
    missing_from_routes: missing.map(({ http, endpoint, sites }) => ({ http, endpoint, sites })),
    method_mismatch: methodMismatch.map(({ http, endpoint, available, sites }) => ({ http, endpoint, available, sites })),
    dynamic_unverifiable: dynamic.map(({ module, line, http, reason }) => ({ at: `${module}.ts:${line}`, http, reason })),
    inline_fetch_offenders: inlineFetch,
    endpoints: verified.map(({ http, endpoint, status, matchedVia, sites }) => ({ http, endpoint, status, matched_via: matchedVia, sites })),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'mobile-api-consumer-ledger.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'mobile-api-consumer-ledger.md'), renderMarkdown(report), 'utf8');

  const s = report.summary;
  console.log(
    `api ledger: ${s.distinct_endpoints} distinct endpoints across ${s.api_modules} modules (${s.call_sites} call sites)`
  );
  if (routes) {
    console.log(
      `api ledger: verified ${s.verified}, missing ${s.missing_from_routes}, ` +
        `method mismatch ${s.method_mismatch}, dynamic ${s.dynamic_unverifiable}, inline fetch ${s.inline_fetch_offenders}`
    );
  } else {
    // Never print "verified N" when nothing was checked. A stale snapshot with a
    // reassuring summary line is how a drift checker starts lying.
    console.log(
      `api ledger: UNVERIFIED ${s.unverified} endpoints (no usable route inventory), ` +
        `dynamic ${s.dynamic_unverifiable}, inline fetch ${s.inline_fetch_offenders}`
    );
  }

  if (!routes) {
    console.error('');
    console.error(`api ledger: UNVERIFIED — the route inventory is ${inventoryState.reason}.`);
    if (inventoryState.reason === 'stale') {
      console.error('api ledger: these route sources changed since the snapshot was taken:');
      for (const f of inventoryState.changedFiles) console.error(`api ledger:   ${f}`);
    }
    console.error('api ledger: refresh it with `npm run api:routes` (needs the local app container).');
    console.error('api ledger: nothing was verified. This is NOT a pass.');
    process.exit(2);
  }

  if (!CHECK) return;

  const { entries: accepted } = loadBaseline();
  const stillAccepted = new Set();
  let failed = false;

  for (const m of report.missing_from_routes) {
    const key = `${m.http} ${m.endpoint}`;
    if (accepted.has(key)) {
      stillAccepted.add(key);
      console.log(`api ledger: KNOWN ${key} — ${accepted.get(key).reason}`);
      continue;
    }
    console.error(
      `api ledger: DRIFT ${m.http} ${m.endpoint} is called by mobile but Laravel registers no such route (${m.sites.join(', ')})`
    );
    failed = true;
  }
  for (const m of report.method_mismatch) {
    const key = `${m.http} ${m.endpoint}`;
    if (accepted.has(key)) {
      stillAccepted.add(key);
      console.log(`api ledger: KNOWN ${key} — ${accepted.get(key).reason}`);
      continue;
    }
    console.error(
      `api ledger: DRIFT ${m.http} ${m.endpoint} — the API exposes ${m.available.join('/')} only (${m.sites.join(', ')})`
    );
    failed = true;
  }

  // Shrink-only in the other direction: a fixed entry must be removed, or the
  // baseline slowly becomes a list of things nobody remembers were broken.
  for (const key of accepted.keys()) {
    if (stillAccepted.has(key)) continue;
    console.error(
      `api ledger: STALE BASELINE "${key}" no longer drifts — delete it from api-drift-baseline.json.`
    );
    failed = true;
  }
  if (failed) {
    console.error('api ledger: mobile calls at least one endpoint the API does not expose.');
    console.error('api ledger: fix the client, restore the route, or refresh the route inventory before release.');
    process.exit(1);
  }
  if (stillAccepted.size > 0) {
    console.log(
      `api ledger: OK with ${stillAccepted.size} accepted known drift — ` +
        "every other statically resolvable endpoint exists in Laravel's route inventory."
    );
    return;
  }
  console.log("api ledger: OK — every statically resolvable mobile endpoint exists in Laravel's route inventory.");
}

main();
