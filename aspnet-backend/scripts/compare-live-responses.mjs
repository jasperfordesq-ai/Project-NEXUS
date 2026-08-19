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
 * 🔴 What the output measures: THIS BACKEND, against Laravel. When run
 * with a path list extracted from a frontend's source (e.g. web-uk), that list is
 * only a choice of WHICH endpoints to compare. It does not run that frontend, does
 * not point it at this backend, and says nothing about whether that frontend
 * works. Report it as "ASP.NET is N/M contract-identical on the endpoints X
 * calls", never as "X is N/M".
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
 * The Laravel that must NEVER receive credentials or a write.
 *
 * 🔴 This is the ordinary local dev Laravel, and its database is a confidential
 * production-derived snapshot of real communities and real members. Signing in
 * to it would exercise real accounts; writing to it would alter real records
 * that exist nowhere else in a restorable form. Unauthenticated GET/HEAD is the
 * whole permitted surface.
 *
 * For anything more, run a disposable Laravel — committed schema plus synthetic
 * fixtures, no real data — with
 * `bash aspnet-backend/scripts/start-disposable-laravel.sh`, and point --laravel
 * at it.
 */
const SNAPSHOT_LARAVEL = 'http://127.0.0.1:8090';

/** "email:password" or "email:password:tenantSlug". */
const LARAVEL_AUTH = flag('laravel-auth', null);
const ASPNET_AUTH = flag('aspnet-auth', null);

if ((LARAVEL_AUTH || ASPNET_AUTH) && LARAVEL === SNAPSHOT_LARAVEL) {
  console.error([
    `REFUSING to sign in while --laravel points at ${SNAPSHOT_LARAVEL}.`,
    'That database is a confidential production-derived snapshot; only',
    'unauthenticated GET/HEAD comparisons are permitted against it.',
    '',
    'Start a disposable Laravel instead:',
    '  bash aspnet-backend/scripts/start-disposable-laravel.sh',
    'then re-run with --laravel http://127.0.0.1:8091',
  ].join(String.fromCharCode(10)));
  process.exit(2);
}

/** Signs in and returns a bearer token, or null when no credentials were given. */
async function login(base, spec, tenant) {
  if (!spec) return null;
  const [email, password, tenantSlug] = spec.split(':');
  const body = { email, password };
  if (tenantSlug) body.tenantSlug = tenantSlug;

  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-Tenant-ID': tenant,
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* fall through to the throw */ }

  const token = parsed?.access_token ?? parsed?.data?.access_token ?? parsed?.token;
  if (!token) {
    throw new Error(
      `login failed at ${base} (HTTP ${response.status}): ${text.slice(0, 200)}`);
  }
  return token;
}

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

// 🔴 Shape comparison lives in lib/response-shape.mjs so the READ and WRITE
// harnesses share ONE implementation. Two copies would drift, and these rules were
// each earned the hard way. Re-measured 79/63/28 unchanged after the extraction.
import {
  skeleton, fieldPaths, compareSkeleton, classify, describeShapeDiff,
} from './lib/response-shape.mjs';


async function ask(base, method, urlPath, tenant, token = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = { Accept: 'application/json', 'X-Tenant-ID': tenant };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${base}${urlPath}`, {
      method,
      headers,
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


async function main() {
  const pathsFile = flag('paths', null);
  const specs = pathsFile
    ? fs.readFileSync(pathsFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    : SEED_PATHS;

  const laravelToken = await login(LARAVEL, LARAVEL_AUTH, LARAVEL_TENANT);
  const aspnetToken = await login(ASPNET, ASPNET_AUTH, ASPNET_TENANT);

  console.log(`Laravel : ${LARAVEL} (tenant ${LARAVEL_TENANT})`);
  console.log(`ASP.NET : ${ASPNET} (tenant ${ASPNET_TENANT})`);

  // 🔴 Printed every run so a number can never be read out of context. A
  // signed-out run that reports "401 on both" has proven the authorisation
  // boundary agrees and NOTHING about the payload behind it.
  console.log(
    laravelToken && aspnetToken
      ? 'Mode    : SIGNED IN on both — payloads behind the login are compared'
      : 'Mode    : SIGNED OUT — most endpoints will answer 401 on both sides,'
        + ' which proves only that the door is locked the same way');
  console.log(`Comparing ${specs.length} read-only endpoints. Shape only — values are expected to differ.\n`);

  const results = [];
  for (const spec of specs) {
    const [method, urlPath] = spec.includes(' ') ? spec.split(/\s+/, 2) : ['GET', spec];
    if (!['GET', 'HEAD'].includes(method.toUpperCase())) {
      console.log(`SKIP (not read-only)  ${spec}`);
      continue;
    }

    const [laravel, aspnet] = await Promise.all([
      ask(LARAVEL, method, urlPath, LARAVEL_TENANT, laravelToken),
      ask(ASPNET, method, urlPath, ASPNET_TENANT, aspnetToken),
    ]);

    const verdict = classify(laravel, aspnet);
    const row = {
      method, path: urlPath, verdict,
      laravel_status: laravel.status,
      aspnet_status: aspnet.status,
    };
    if (verdict === 'SHAPE_DIFFERS') Object.assign(row, describeShapeDiff(laravel, aspnet));
    results.push(row);

    const mark = verdict === 'MATCH' ? '✓' : verdict === 'MATCH_BUT_LIST_EMPTY' ? '~' : '✗';
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
  const untested = tally.MATCH_BUT_LIST_EMPTY ?? 0;
  console.log(`\nContract-identical on this sample: ${matched}/${results.length}`);
  if (untested > 0) {
    console.log(
      `Plus ${untested} whose envelope matches but whose LIST CONTENTS could not be `
      + `compared, because one backend had no rows. Those are NOT proven identical.`);
  }

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
