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
 * 🔴 CONSUMED-FIELD MODE (`--consumed-fields`) is OPT-IN, and deliberately so.
 * The whole-body diff remains the default because it is the raw measurement and
 * every archived number was produced by it; changing what an existing invocation
 * prints would make those numbers incomparable. See the block above
 * `loadConsumedManifest` for what the mode does and why.
 *
 * Usage:
 *   node aspnet-backend/scripts/compare-live-responses.mjs
 *   node aspnet-backend/scripts/compare-live-responses.mjs --paths paths.txt
 *   node aspnet-backend/scripts/compare-live-responses.mjs --json out.json
 *   node aspnet-backend/scripts/compare-live-responses.mjs --consumed-fields
 *   node aspnet-backend/scripts/compare-live-responses.mjs --consumed-fields \
 *     --consumed-manifest <path/to/consumed-field-manifest.json>
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

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

import { loadManifest, bucketEndpoint } from './lib/consumed-fields.mjs';

/**
 * CONSUMED-FIELD MODE — the ADR-0004 filter.
 *
 * 🔴 What it changes. The default run reports an endpoint as SHAPE_DIFFERS the
 * moment any field name differs anywhere in the body. Laravel returns raw
 * Eloquent models, so a listing carries ~76 fields and an event ~80, including
 * internal database columns no client has ever read and at least one
 * (`category.reset_token`) that should never be serialised at all. Under that
 * measurement, reproducing an internal column counts as required work and not
 * reproducing it counts as a contract gap. This mode filters each differing
 * field through the consumed-field manifest first, so the reported number is
 * about product behaviour rather than field noise.
 *
 * 🔴 What it does NOT do: drop anything silently. Every differing field lands in
 * one of three buckets and all three are counted and stored —
 *   IN-SCOPE DIFFERENCE      a client reads it; this is the work queue
 *   OUT-OF-SCOPE DIFFERENCE  no known reader; recorded, then moved past
 *   UNKNOWN                  the scan could not decide; treated AS IN SCOPE
 * A run that reported a smaller number without showing what it set aside would
 * be worse than the upper bound it replaces.
 *
 * 🔴 It is opt-in and the default path is untouched, on purpose. Every archived
 * corpus run (`.local-docs-archive/parity-corpus/read-*.json`) was produced by
 * the whole-body diff; if this mode changed the default output, the "80 of 195"
 * figure and its successors would stop being comparable to anything.
 */
const CONSUMED_MODE = has('consumed-fields') || process.env.NEXUS_CONSUMED_FIELDS === '1';
const CONSUMED_MANIFEST = flag('consumed-manifest', path.join(
  import.meta.dirname, '..', 'docs', 'generated', 'consumed-fields', 'consumed-field-manifest.json'));

function loadConsumedManifest() {
  if (!CONSUMED_MODE) return null;
  if (!fs.existsSync(CONSUMED_MANIFEST)) {
    console.error(`🔴 consumed-field mode requested but the manifest is missing:`);
    console.error(`   ${CONSUMED_MANIFEST}`);
    console.error('   Build it first:');
    console.error('     node aspnet-backend/scripts/build-consumed-field-manifest.mjs');
    process.exit(2);
  }
  return loadManifest(CONSUMED_MANIFEST);
}


/**
 * Contract-negotiation headers the canonical React client sends on every request.
 *
 * 🔴 WITHOUT THESE THE HARNESS MEASURES A SHAPE NEITHER BACKEND SERVES THE REAL APP.
 * Laravel's `NegotiateEventsContract` middleware answers the LEGACY v1 shape unless the
 * request asks for the canonical version. Measured 2026-08-19 on the same endpoint:
 *
 *     no header               -> x-events-contract: 1, 77 keys, NO organizer/permissions
 *     X-Events-Contract: 2    -> x-events-contract: 2, 58 keys, full v2 structure
 *
 * So every events measurement this harness ever produced compared ASP.NET's output
 * against Laravel's v1 output — including the "76 fields missing" figure that drove a
 * whole work package. The client sends these (events-api.ts:19, event-safety-api.ts:11,
 * event-offline-checkin-api.ts:237); the harness must send exactly the same, or it is
 * not measuring the contract the frontend actually consumes.
 *
 * Values are the versions the client pins, NOT "the latest" — the point is to reproduce
 * the client's request, not to ask for the newest thing available.
 */
const CLIENT_CONTRACT_HEADERS = {
  'X-Events-Contract': '2',
  'X-Event-Safety-Contract': '1',
  'X-Event-Checkin-Contract': '1',
};

async function ask(base, method, urlPath, tenant, token = null) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = { Accept: 'application/json', 'X-Tenant-ID': tenant, ...CLIENT_CONTRACT_HEADERS };
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


/** Renders a capped diff list so the cap can never be read as the total. */
function sample(list, total) {
  // The stored lists are COMPLETE; capping is this printer's job.
  const shown = (list ?? []).slice(0, 8).join(', ');
  const hidden = total - Math.min(8, (list ?? []).length);
  return hidden > 0 ? `${shown}, … and ${hidden} more` : shown;
}

// 🔴 A FEATURE-FLAG PREFLIGHT WAS ATTEMPTED HERE AND REMOVED. Recording why, so the
// next person does not rebuild the same unsound guard.
//
// The intent was sound: when the disposable Laravel is left half-prepared (its
// features never switched on — see start-disposable-laravel.sh, which failed silently
// this way on 2026-08-19), ~27 endpoints answer 403 FEATURE_DISABLED and this harness
// faithfully reports all 27 as contract differences. A run in that state reads as a
// large collapse that never happened.
//
// The guard read the feature map from /api/v2/tenant/bootstrap. That map DOES NOT
// REFLECT THE STORED FLAGS: with the tenant row set to {"events":false} it still
// reported 48 of 48 features ON, before AND after `php artisan cache:clear`. So the
// check could not fail, and a guard that cannot fail is worse than none — it converts
// "unverified" into a printed reassurance.
//
// REBUILT PROPERLY on 2026-08-20, on the real refusal rather than a projection — see
// assertFeaturesEnabled below.

/**
 * The endpoint the feature-gate preflight probes.
 *
 * 🔴 Chosen because it is MEASURED to change with the flags, which the bootstrap feature
 * map is not. Same session, same fixture, Laravel :8091:
 *
 *     features all on   -> 200 {"data":[],"meta":{…}}
 *     features '{}'      -> 403 {"errors":[{"code":"FEATURE_DISABLED",…}]}
 *
 * `/api/v2/events` and `/api/v2/gamification/profile` were tried first and REJECTED as
 * signals: both stay 200 with the flags cleared, because their features default on. A
 * probe that cannot go red is the mistake this replaces.
 */
const FEATURE_GATE_PROBE = '/api/v2/caring-community/emergency-alerts';

/**
 * Refuses to measure a half-prepared fixture.
 *
 * When the disposable Laravel's optional features are off, ~27 endpoints answer 403
 * FEATURE_DISABLED and this harness faithfully reports every one as a contract
 * difference. That is not hypothetical twice over: start-disposable-laravel.sh failed
 * silently this way on 2026-08-19, and on 2026-08-20 a leftover `{"events":false}` from a
 * previous experiment produced a 30-point false collapse (48/195 against a true 78/195)
 * with 43 phantom status disagreements.
 *
 * 🔴 Cannot pass silently. If the probe itself cannot run it WARNS and says the run is
 * unverified, because a preflight that could not execute must never read as one that
 * passed.
 */
async function assertFeaturesEnabled(token) {
  if (!token) {
    console.log('Preflight: skipped (no Laravel credentials — signed-out runs are not gated).');
    return;
  }

  let status;
  let body = '';
  try {
    const response = await fetch(`${LARAVEL}${FEATURE_GATE_PROBE}`, {
      headers: {
        Accept: 'application/json',
        'X-Tenant-ID': LARAVEL_TENANT,
        Authorization: `Bearer ${token}`,
      },
    });
    status = response.status;
    body = await response.text();
  } catch (error) {
    console.log(`⚠️  Preflight could not run (${error.message}). This run is UNVERIFIED for a`);
    console.log('   half-prepared fixture — treat any large drop with suspicion.');
    return;
  }

  if (status === 403 && body.includes('FEATURE_DISABLED')) {
    console.error('');
    console.error('🔴 REFUSING TO MEASURE: the Laravel fixture community has its optional');
    console.error(`   features OFF — ${FEATURE_GATE_PROBE} answered 403 FEATURE_DISABLED.`);
    console.error('   About 27 endpoints refuse in this state and this harness would report');
    console.error('   every one as a contract difference (measured: a 30-point false collapse).');
    console.error('   Fix it, then re-run:');
    console.error('     bash aspnet-backend/scripts/start-disposable-laravel.sh');
    console.error('   or against a running instance, apply all-features-on.mjs to tenants.features.');
    console.error('');
    process.exit(2);
  }

  console.log(`Preflight: features ON (${FEATURE_GATE_PROBE} -> ${status}) — environment is measurable.`);
}

async function main() {
  const manifest = loadConsumedManifest();
  const pathsFile = flag('paths', null);
  const specs = pathsFile
    ? fs.readFileSync(pathsFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
    : SEED_PATHS;

  const laravelToken = await login(LARAVEL, LARAVEL_AUTH, LARAVEL_TENANT);
  const aspnetToken = await login(ASPNET, ASPNET_AUTH, ASPNET_TENANT);

  console.log(`Laravel : ${LARAVEL} (tenant ${LARAVEL_TENANT})`);
  console.log(`ASP.NET : ${ASPNET} (tenant ${ASPNET_TENANT})`);

  await assertFeaturesEnabled(laravelToken);


  // 🔴 Printed every run so a number can never be read out of context. A
  // signed-out run that reports "401 on both" has proven the authorisation
  // boundary agrees and NOTHING about the payload behind it.
  console.log(
    laravelToken && aspnetToken
      ? 'Mode    : SIGNED IN on both — payloads behind the login are compared'
      : 'Mode    : SIGNED OUT — most endpoints will answer 401 on both sides,'
        + ' which proves only that the door is locked the same way');
  if (manifest) {
    console.log(
      `Scope   : CONSUMED-FIELD MODE (ADR-0004) — manifest ${manifest.meta.unique_names} field `
      + `names from ${manifest.meta.clients.join(', ')}, built ${manifest.meta.generated_at}`);
    // 🔴 A stale manifest fails in the dangerous direction: a field a client
    // started reading yesterday looks unread today, so a real defect is filed as
    // out of scope. Cheap SHA comparison, warn rather than refuse — refusing
    // would block a run every time the working tree moved.
    let headSha = null;
    try {
      headSha = (await import('node:child_process'))
        .execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    } catch { /* not a git checkout, or no git — say nothing rather than guess */ }
    if (headSha && manifest.meta.repo_sha && headSha !== manifest.meta.repo_sha) {
      console.log(
        `          ⚠️  manifest was built at ${manifest.meta.repo_sha.slice(0, 12)}, HEAD is `
        + `${headSha.slice(0, 12)}. A stale manifest makes a newly-read field look UNREAD,`);
      console.log('              which files a real defect as out of scope. Rebuild it:'
        + ' node aspnet-backend/scripts/build-consumed-field-manifest.mjs');
    }
    console.log(
      '          A differing field is a DEFECT only if a client reads it. Fields with no'
      + ' known reader are counted separately, never dropped.');
  }
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

    // Consumed-field mode annotates the row; it never rewrites `verdict`, so a
    // JSON file from this mode stays directly comparable to an archived one.
    if (manifest) {
      if (verdict === 'SHAPE_DIFFERS') {
        const scoped = bucketEndpoint(row, { laravel: laravel.body, aspnet: aspnet.body }, manifest);
        row.consumed = scoped.counts;
        row.consumed_fields = scoped.buckets;
        row.consumed_verdict = scoped.is_defect_candidate ? 'IN_SCOPE_DIFFERS' : 'OUT_OF_SCOPE_ONLY';
      } else if (['STATUS_DIFFERS', 'NOT_JSON', 'UNREACHABLE'].includes(verdict)) {
        // 🔴 Always in scope. ADR-0004 clause 3: a difference that changes an
        // outcome is in scope regardless of which fields are involved, and a
        // status code, an unparseable body and an unreachable endpoint are all
        // outcomes a client acts on. No manifest lookup can excuse these.
        row.consumed_verdict = 'IN_SCOPE_DIFFERS';
        row.consumed = { in_scope: 1, out_of_scope: 0, unknown: 0 };
        row.consumed_reason = 'status code / parseability is itself an outcome a client acts on';
      } else {
        row.consumed_verdict = verdict === 'MATCH' ? 'MATCH' : 'NOT_PROVEN';
      }
    }

    results.push(row);

    const mark = verdict === 'MATCH' ? '✓' : verdict === 'MATCH_BUT_LIST_EMPTY' ? '~' : '✗';
    const shown = manifest && row.consumed_verdict === 'OUT_OF_SCOPE_ONLY' ? 'OUT_OF_SCOPE  ' : verdict.padEnd(14);
    console.log(`${manifest && row.consumed_verdict === 'OUT_OF_SCOPE_ONLY' ? '·' : mark} ${shown} ${String(laravel.status).padEnd(4)}→${String(aspnet.status).padEnd(4)} ${method} ${urlPath}`);

    if (verdict === 'SHAPE_DIFFERS' && !manifest) {
      if (row.missing_count) console.log(`      missing in ASP.NET (${row.missing_count}): ${sample(row.missing_in_aspnet, row.missing_count)}`);
      if (row.extra_count) console.log(`      extra in ASP.NET   (${row.extra_count}): ${sample(row.extra_in_aspnet, row.extra_count)}`);
    }

    if (verdict === 'SHAPE_DIFFERS' && manifest) {
      const c = row.consumed;
      console.log(
        `      missing in ASP.NET: ${c.in_scope} in scope, ${c.unknown} unknown (counted as in scope), `
        + `${c.out_of_scope} out of scope`
        + `  |  extra in ASP.NET: ${c.extra_in_aspnet} (a superset is not a gap)`);
      // Only the missing-side in-scope fields are work. An ASP.NET superset is
      // explicitly not a gap under ADR-0004.
      const work = row.consumed_fields.IN_SCOPE.filter((f) => f.direction === 'missing_in_aspnet');
      for (const f of work.slice(0, 6)) {
        console.log(`        MISSING ${f.path}`);
        console.log(`                read by ${f.evidence.join(' | ') || f.readers.join(', ')}`);
      }
      if (work.length > 6) console.log(`        … and ${work.length - 6} more in-scope missing field(s)`);
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

  if (manifest) {
    const differing = results.filter((r) => r.verdict === 'SHAPE_DIFFERS');
    const inScope = results.filter((r) => r.consumed_verdict === 'IN_SCOPE_DIFFERS');
    const outOnly = differing.filter((r) => r.consumed_verdict === 'OUT_OF_SCOPE_ONLY');
    const sum = (rows, key) => rows.reduce((s, r) => s + (r.consumed?.[key] ?? 0), 0);

    console.log('\n─── consumed-field mode (ADR-0004) ───');
    console.log(`Whole-body differing endpoints (the upper bound) : ${differing.length}`);
    console.log(`Endpoints differing on a field a client READS    : ${differing.filter((r) => r.consumed_verdict === 'IN_SCOPE_DIFFERS').length}`);
    // 🔴 This label used to read "differing ONLY on unread fields", which was
    // wrong in a way that mattered. Measured on the 195-path read corpus, all 18
    // of these endpoints have ZERO unread missing fields — every one of them is
    // an ASP.NET SUPERSET. Two different mechanisms clear an endpoint, and the
    // label must not credit the reduction to the wrong one.
    console.log(`Endpoints with no in-scope field MISSING         : ${outOnly.length}`);
    console.log(`  (${sum(outOnly, 'out_of_scope')} unread missing field path(s)`
      + ` + ${sum(outOnly, 'extra_in_aspnet')} extra ASP.NET field(s). Neither is a gap under`
      + ' ADR-0004; a superset of what a client reads is allowed.)');
    console.log('');
    console.log(`Fields MISSING in ASP.NET, all differing endpoints: `
      + `${sum(differing, 'in_scope')} IN SCOPE, `
      + `${sum(differing, 'unknown')} UNKNOWN (counted as in scope), `
      + `${sum(differing, 'out_of_scope')} OUT OF SCOPE`);
    console.log(`Fields EXTRA in ASP.NET: ${sum(differing, 'extra_in_aspnet')} `
      + `(not gaps — a superset of what a client reads is allowed)`);
    console.log('');
    console.log('🔴 Reading this honestly:');
    console.log('   IN SCOPE     = a client reads the field. This is the work queue.');
    console.log('   UNKNOWN      = the scan could not decide. Treated as in scope, by design:');
    console.log('                  a false "nothing reads it" hides a defect, a false "in scope"');
    console.log('                  only wastes an investigation.');
    console.log('   OUT OF SCOPE = no reader in react, web-uk, mobile or the published contract.');
    console.log('                  Laravel serialising it is a LARAVEL defect, not ASP.NET work.');
    console.log(`   Status-code and non-JSON differences are ALWAYS in scope (${inScope.length - differing.filter((r) => r.consumed_verdict === 'IN_SCOPE_DIFFERS').length} here).`);

    const queue = differing
      .filter((r) => r.consumed_verdict === 'IN_SCOPE_DIFFERS')
      .map((r) => ({ r, work: r.consumed_fields.IN_SCOPE.filter((f) => f.direction === 'missing_in_aspnet') }))
      .sort((a, b) => b.work.length - a.work.length);

    if (queue.length) {
      console.log('\n─── in-scope work queue, worst first ───');
      for (const { r, work } of queue.slice(0, 15)) {
        console.log(`${String(work.length).padStart(3)} read-field(s) missing  ${r.method} ${r.path}`);
        for (const f of work.slice(0, 4)) {
          console.log(`      ${f.path}  ←  ${f.evidence.join(' | ') || f.readers.join(', ')}`);
        }
      }
      if (queue.length > 15) console.log(`… and ${queue.length - 15} more endpoint(s)`);
    }
  }

  if (JSON_OUT) {
    fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
    fs.writeFileSync(JSON_OUT, JSON.stringify({
      generated_at: new Date().toISOString(),
      laravel: LARAVEL,
      aspnet: ASPNET,
      ...(manifest ? { consumed_field_mode: manifest.meta } : {}),
      results,
    }, null, 2));
    console.log(`\nWrote ${JSON_OUT}`);
  }

  // Reporting tool, not a gate: it must never fail a build while the baseline
  // is this far from parity. Exit 0 always; read the number.
  process.exit(0);
}

main();
