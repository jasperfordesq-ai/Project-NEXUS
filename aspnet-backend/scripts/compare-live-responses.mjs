// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Differential response harness: ask BOTH backends the same question and diff
 * the answers.
 *
 * 🔴 Why this exists. Every parity instrument in this repo compares source
 * trees — routes, files, schema, translations — and the generated contract
 * matrix reports `aspnet_gap_count = 0` while 229 endpoints answer with
 * nothing at all. Route existence is satisfied by a handler that does no work,
 * so none of those instruments can see the thing "carbon copy" actually means:
 * the same request producing the same shape of answer.
 *
 * 🔴 It compares SHAPE, never values. The two backends hold different data —
 * Laravel local is a production-derived snapshot, ASP.NET has a demo seed — so
 * equal values would be a bug in the test, not a pass. What must match is the
 * status code, the envelope, the field names, and the types.
 *
 * 🔴 Read-only and unauthenticated by default. The local Laravel database is a
 * confidential production-derived snapshot; this sends GET/HEAD only and no
 * credentials unless you explicitly pass tokens, which you should only do
 * against a disposable Laravel environment.
 *
 * Usage:
 *   node aspnet-backend/scripts/compare-live-responses.mjs
 *   node aspnet-backend/scripts/compare-live-responses.mjs --paths paths.txt
 *   node aspnet-backend/scripts/compare-live-responses.mjs --json out.json
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const LARAVEL = flag('laravel', 'http://127.0.0.1:8090');
const ASPNET = flag('aspnet', 'http://127.0.0.1:5080');
const LARAVEL_TENANT = flag('laravel-tenant', '2');
const ASPNET_TENANT = flag('aspnet-tenant', '1');
const TIMEOUT_MS = Number(flag('timeout', '15000'));
const JSON_OUT = flag('json', null);

/**
 * The seed list. Deliberately hand-picked read-only endpoints that a signed-out
 * visitor can reach, because that is the widest surface we can compare without
 * credentials. Extend with --paths (one `METHOD /path` per line).
 */
const SEED_PATHS = [
  'GET /api/v2/health',
  'GET /api/v2/tenant/bootstrap',
  'GET /api/v2/tenants/public',
  'GET /api/v2/categories',
  'GET /api/v2/listings',
  'GET /api/v2/events',
  'GET /api/v2/groups',
  'GET /api/v2/blog/posts',
  'GET /api/v2/resources',
  'GET /api/v2/volunteering/opportunities',
  'GET /api/v2/volunteering/organisations',
  'GET /api/v2/members',
  'GET /api/v2/search?q=test',
  'GET /api/v2/leaderboard',
  'GET /api/v2/achievements',
  'GET /api/v2/features',
  'GET /api/v2/settings/public',
  'GET /api/v2/legal/documents',
  'GET /api/v2/help/articles',
  'GET /api/v2/marketplace/listings',
];

/**
 * Reduce a JSON value to a type skeleton: field names and types, no values.
 * Arrays collapse to the skeleton of their first element, because a list of 3
 * and a list of 40 are the same contract.
 */
function skeleton(value, depth = 0) {
  if (depth > 6) return '…';
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return value.length === 0 ? '[]' : `[${skeleton(value[0], depth + 1)}]`;
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${k}:${skeleton(value[k], depth + 1)}`).join(',')}}`;
  }
  return typeof value;
}

/** Field paths present in a skeleton, for a readable diff. */
function fieldPaths(value, prefix = '', depth = 0, out = new Set()) {
  if (depth > 6 || value === null || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    if (value.length > 0) fieldPaths(value[0], `${prefix}[]`, depth + 1, out);
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    const p = prefix ? `${prefix}.${k}` : k;
    out.add(p);
    fieldPaths(v, p, depth + 1, out);
  }
  return out;
}

async function ask(base, method, urlPath, tenant) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${base}${urlPath}`, {
      method,
      headers: { Accept: 'application/json', 'X-Tenant-ID': tenant },
      signal: controller.signal,
    });
    const text = await response.text();
    let body = null;
    let parsed = false;
    try {
      body = JSON.parse(text);
      parsed = true;
    } catch {
      body = text.slice(0, 200);
    }
    return { status: response.status, parsed, body };
  } catch (error) {
    return { status: 0, parsed: false, body: `TRANSPORT: ${error.message}` };
  } finally {
    clearTimeout(timer);
  }
}

function classify(laravel, aspnet) {
  if (laravel.status === 0 || aspnet.status === 0) return 'UNREACHABLE';
  if (laravel.status !== aspnet.status) return 'STATUS_DIFFERS';
  if (!laravel.parsed || !aspnet.parsed) return 'NOT_JSON';
  const a = skeleton(laravel.body);
  const b = skeleton(aspnet.body);
  return a === b ? 'MATCH' : 'SHAPE_DIFFERS';
}

function describeShapeDiff(laravel, aspnet) {
  const l = fieldPaths(laravel.body);
  const a = fieldPaths(aspnet.body);
  const missing = [...l].filter((f) => !a.has(f)).slice(0, 8);
  const extra = [...a].filter((f) => !l.has(f)).slice(0, 8);
  return { missing_in_aspnet: missing, extra_in_aspnet: extra };
}

async function main() {
  const pathsFile = flag('paths', null);
  const specs = pathsFile
    ? fs.readFileSync(pathsFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    : SEED_PATHS;

  console.log(`Laravel : ${LARAVEL} (tenant ${LARAVEL_TENANT})`);
  console.log(`ASP.NET : ${ASPNET} (tenant ${ASPNET_TENANT})`);
  console.log(`Comparing ${specs.length} read-only endpoints. Shape only — values are expected to differ.\n`);

  const results = [];
  for (const spec of specs) {
    const [method, urlPath] = spec.includes(' ') ? spec.split(/\s+/, 2) : ['GET', spec];
    if (!['GET', 'HEAD'].includes(method.toUpperCase())) {
      console.log(`SKIP (not read-only)  ${spec}`);
      continue;
    }

    const [laravel, aspnet] = await Promise.all([
      ask(LARAVEL, method, urlPath, LARAVEL_TENANT),
      ask(ASPNET, method, urlPath, ASPNET_TENANT),
    ]);

    const verdict = classify(laravel, aspnet);
    const row = {
      method, path: urlPath, verdict,
      laravel_status: laravel.status,
      aspnet_status: aspnet.status,
    };
    if (verdict === 'SHAPE_DIFFERS') Object.assign(row, describeShapeDiff(laravel, aspnet));
    results.push(row);

    const mark = verdict === 'MATCH' ? '✓' : '✗';
    console.log(`${mark} ${verdict.padEnd(14)} ${String(laravel.status).padEnd(4)}→${String(aspnet.status).padEnd(4)} ${method} ${urlPath}`);
    if (verdict === 'SHAPE_DIFFERS') {
      if (row.missing_in_aspnet.length) console.log(`      missing in ASP.NET: ${row.missing_in_aspnet.join(', ')}`);
      if (row.extra_in_aspnet.length) console.log(`      extra in ASP.NET  : ${row.extra_in_aspnet.join(', ')}`);
    }
  }

  const tally = results.reduce((acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] ?? 0) + 1 }), {});
  console.log('\n─── summary ───');
  for (const [verdict, count] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`${String(count).padStart(4)}  ${verdict}`);
  }
  const matched = tally.MATCH ?? 0;
  console.log(`\nContract-identical on this sample: ${matched}/${results.length}`);

  if (JSON_OUT) {
    fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
    fs.writeFileSync(JSON_OUT, JSON.stringify({ generated_at: new Date().toISOString(), laravel: LARAVEL, aspnet: ASPNET, results }, null, 2));
    console.log(`\nWrote ${JSON_OUT}`);
  }

  // Reporting tool, not a gate: it must never fail a build while the baseline
  // is this far from parity. Exit 0 always; read the number.
  process.exit(0);
}

main();
