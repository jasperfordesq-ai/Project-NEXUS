// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Turn the canonical React frontend's GENERATED API inventory into corpora the
 * parity harnesses can consume.
 *
 * 🔴 Why this exists. Until 2026-08-19 the read corpus was a HAND-CURATED list of
 * 170 GET paths (`.local-docs-archive/react-paths.txt`) and the write corpus was 19
 * hand-written scenarios inside `compare-live-writes.mjs`. Both were honest about
 * being samples, but a sample cannot answer "is the frontend switchable" — it can
 * only answer "are these 170 paths the same". `react-frontend/scripts/
 * inventory-api-calls.mjs` (committed, `npm run inventory:api-calls`) walks the
 * TypeScript AST of the whole frontend and finds what it ACTUALLY calls:
 *
 *     2,205 call sites / 2,016 unique method-endpoint pairs
 *     438 unique STATIC GET endpoints      (vs 170 hand-curated)
 *     392 unique STATIC write endpoints    (vs 19 hand-written)
 *
 * 🔴 STATIC vs DYNAMIC matters. 1,261 of the 2,205 call sites build their path from
 * a variable (`/v2/listings/${id}`). Those cannot go in a corpus without inventing
 * ids, and an invented id measures "how do the two backends 404" rather than the
 * contract. They are emitted to a SEPARATE file as a coverage ledger — real work,
 * reachable only through the browser smoke or a fixture-aware runner, never
 * silently dropped.
 *
 * 🔴 Admin paths are split out, not mixed in. The harnesses sign in as a MEMBER, so
 * every admin path answers 403 on both backends — a MATCH that proves only that
 * both refuse. Counting those as parity would inflate the score with non-evidence.
 *
 * Writes are emitted as a coverage LEDGER, not a runnable corpus: a write needs a
 * body, and a body cannot be inferred from a call site. Phase 3 grows the hand-
 * written scenarios toward this ledger, and the ledger measures how far that got.
 *
 * Usage:
 *   npm --prefix react-frontend run inventory:api-calls      # regenerate the input
 *   node aspnet-backend/scripts/build-parity-corpus.mjs
 *   node aspnet-backend/scripts/compare-live-responses.mjs \
 *     --paths .local-docs-archive/parity-corpus/react-get-member.txt ...
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const INVENTORY = path.join(
  REPO_ROOT, '.local-docs-archive', 'react-api-inventory', 'latest', 'api-calls.json');
const OUT_DIR = path.join(REPO_ROOT, '.local-docs-archive', 'parity-corpus');

if (!fs.existsSync(INVENTORY)) {
  console.error(`Inventory not found: ${INVENTORY}`);
  console.error('Generate it first:  npm --prefix react-frontend run inventory:api-calls');
  process.exit(2);
}

const inventory = JSON.parse(fs.readFileSync(INVENTORY, 'utf8'));
const calls = inventory.calls ?? [];

/**
 * The harnesses address the API at `/api/...`; the inventory records the path as
 * the frontend writes it (`/v2/...`), because the client prepends its base itself.
 */
const toRequestPath = (endpoint) => {
  if (endpoint.startsWith('/api/')) return endpoint;
  if (endpoint.startsWith('/')) return `/api${endpoint}`;
  return `/api/${endpoint}`;
};

/** Admin surfaces need an admin session; a member run only proves both refuse. */
const isAdmin = (endpoint) => /\/v2\/admin\/|\/admin\/|\/super\//.test(endpoint);

const seen = { get: new Map(), write: new Map(), dynamic: new Map() };

for (const call of calls) {
  const method = String(call.method || 'GET').toUpperCase();
  const endpoint = String(call.endpoint || '');
  if (!endpoint.startsWith('/')) continue;

  const where = `${call.file}:${call.line}`;
  const bucket = call.dynamic ? 'dynamic' : (method === 'GET' ? 'get' : 'write');
  const key = `${method} ${endpoint}`;
  if (!seen[bucket].has(key)) {
    seen[bucket].set(key, { method, endpoint, admin: isAdmin(endpoint), sites: [] });
  }
  seen[bucket].get(key).sites.push(where);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const write = (name, lines) => {
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, `${lines.join('\n')}\n`);
  console.log(`${String(lines.length).padStart(4)}  ${path.relative(REPO_ROOT, file)}`);
};

const gets = [...seen.get.values()];
const memberGets = gets.filter((r) => !r.admin).map((r) => `GET ${toRequestPath(r.endpoint)}`).sort();
const adminGets = gets.filter((r) => r.admin).map((r) => `GET ${toRequestPath(r.endpoint)}`).sort();

write('react-get-member.txt', memberGets);
write('react-get-admin.txt', adminGets);

const writes = [...seen.write.values()].sort(
  (a, b) => a.endpoint.localeCompare(b.endpoint) || a.method.localeCompare(b.method));
write('react-write-ledger.txt', writes.map(
  (r) => `${r.method} ${toRequestPath(r.endpoint)}${r.admin ? '  [admin]' : ''}`));

const dynamics = [...seen.dynamic.values()].sort(
  (a, b) => a.endpoint.localeCompare(b.endpoint) || a.method.localeCompare(b.method));
write('react-dynamic-ledger.txt', dynamics.map(
  (r) => `${r.method} ${toRequestPath(r.endpoint)}${r.admin ? '  [admin]' : ''}`));

// A machine-readable roll-up so a later phase can measure coverage against it.
const manifest = {
  generated_at: new Date().toISOString(),
  source: path.relative(REPO_ROOT, INVENTORY),
  inventory_generated_at: inventory.summary?.generated_at ?? null,
  call_sites: calls.length,
  counts: {
    static_get_member: memberGets.length,
    static_get_admin: adminGets.length,
    static_write: writes.length,
    dynamic: dynamics.length,
  },
  note: 'Writes and dynamics are COVERAGE LEDGERS, not runnable corpora: a write needs '
    + 'a body and a dynamic path needs a real id. Neither can be inferred from a call site.',
};
fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`\nManifest: ${path.relative(REPO_ROOT, path.join(OUT_DIR, 'manifest.json'))}`);
console.log(
  `\nRead corpus grew ${memberGets.length >= 170 ? 'from' : 'to'} the hand-curated 170 `
  + `-> ${memberGets.length} member GET paths (+${adminGets.length} admin, run separately `
  + 'with an admin session or they only prove both backends refuse).');
