// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * WRITE-mode differential harness: send the same MUTATION to both backends and
 * diff the answers.
 *
 * 🔴 Why this exists. Until now every parity measurement in this repo has been
 * GET/HEAD only. Writes — creating a listing, sending a message, transferring
 * credits, accepting terms — were entirely unmeasured, and 208 test assertions in
 * this suite pin what this backend's write responses look like with no check that
 * Laravel agrees. Eight read-side assertions have already been found pinning
 * ASP.NET's own shape under a Laravel-parity name; there is no reason the write
 * side is cleaner.
 *
 * 🔴 THE SAFETY RULE, AND IT IS NOT ADVISORY.
 * This sends real mutations. The ordinary local Laravel on :8090 is a confidential
 * production-derived snapshot of real communities and real members — writing to it
 * would alter records that exist nowhere else in a restorable form. So this script
 * REFUSES to run unless BOTH of these hold:
 *
 *   1. --allow-writes is passed explicitly, and
 *   2. --laravel resolves to the disposable Laravel on 127.0.0.1:8091
 *
 * There is no override, no environment variable, and no "force" flag. If you need
 * a different disposable host, add it to DISPOSABLE_LARAVEL_HOSTS deliberately and
 * say why in the commit.
 *
 * Prepare the fixture first, so a run is repeatable:
 *   bash aspnet-backend/scripts/start-disposable-laravel.sh
 *   docker exec -i nexus-aspnet-dev-db psql -U postgres -d nexus_dev \
 *     < aspnet-backend/scripts/parity-fixture-aspnet.sql
 *
 * Then:
 *   node aspnet-backend/scripts/compare-live-writes.mjs --allow-writes \
 *     --laravel http://127.0.0.1:8091 --laravel-tenant 1 \
 *     --laravel-auth "e2e.user.a@project-nexus.local:TestPassword123!" \
 *     --aspnet-auth "member@acme.test:NexusV2!Demo#2026:acme" \
 *     --json out.json
 *
 * 🔴 It compares SHAPE, never values — the same rule as the read harness. The two
 * backends hold different data and mint different ids, so equal values would be a
 * bug in the test. What must match is the status code, the envelope, the field
 * names and the types.
 *
 * 🔴 Every request body is unique per run (see stamp()), because these are real
 * creates. A fixed body would collide with the previous run's row on any endpoint
 * with a uniqueness constraint and report a contract difference that is really a
 * duplicate-key error.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { classify, describeShapeDiff } from './lib/response-shape.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const LARAVEL = flag('laravel', 'http://127.0.0.1:8091');
const ASPNET = flag('aspnet', 'http://127.0.0.1:5080');
const LARAVEL_TENANT = flag('laravel-tenant', '1');
const ASPNET_TENANT = flag('aspnet-tenant', '1');
const TIMEOUT_MS = Number(flag('timeout', '20000'));
const JSON_OUT = flag('json', null);
const LARAVEL_AUTH = flag('laravel-auth', null);
const ASPNET_AUTH = flag('aspnet-auth', null);

/**
 * Hosts known to be DISPOSABLE — synthetic fixtures, no real member data, safe to
 * write to and destroy. Nothing else may ever receive a mutation from this script.
 */
const DISPOSABLE_LARAVEL_HOSTS = new Set(['127.0.0.1:8091', 'localhost:8091']);

function refuse(lines) {
  console.error(['REFUSING TO RUN.', ...lines].join('\n'));
  process.exit(2);
}

if (!has('allow-writes')) {
  refuse([
    'This harness sends real mutations, so it needs --allow-writes stated explicitly.',
    'Re-run with --allow-writes once you have confirmed --laravel points at the',
    'disposable Laravel on :8091.',
  ]);
}

let laravelHost;
try {
  laravelHost = new URL(LARAVEL).host;
} catch {
  refuse([`--laravel is not a valid URL: ${LARAVEL}`]);
}

if (!DISPOSABLE_LARAVEL_HOSTS.has(laravelHost)) {
  refuse([
    `--laravel points at ${laravelHost}, which is not a known disposable Laravel.`,
    '',
    'The ordinary local Laravel (127.0.0.1:8090) is a confidential',
    'production-derived snapshot of real communities and real members. A write there',
    'would alter records that exist nowhere else in a restorable form.',
    '',
    'Start a disposable Laravel and target it:',
    '  bash aspnet-backend/scripts/start-disposable-laravel.sh',
    '  ... --laravel http://127.0.0.1:8091',
  ]);
}

/** Signs in and returns a bearer token. */
async function login(base, spec, tenant) {
  if (!spec) throw new Error(`credentials are required for write mode (missing for ${base})`);
  const [email, password, tenantSlug] = spec.split(':');
  const body = { email, password };
  if (tenantSlug) body.tenantSlug = tenantSlug;

  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Tenant-ID': tenant },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { /* fall through */ }
  const token = parsed?.access_token ?? parsed?.data?.access_token ?? parsed?.token;
  if (!token) throw new Error(`login failed at ${base} (HTTP ${response.status}): ${text.slice(0, 200)}`);
  return token;
}

/** Unique-per-run suffix, so a create cannot collide with a previous run's row. */
const RUN = `wh${Date.now().toString(36)}`;
const stamp = (s) => `${s} ${RUN}`;

/**
 * The write corpus.
 *
 * 🔴 Auth first, deliberately. If sign-in, refresh and sign-out do not agree, the
 * first browser run fails at the door and every later finding is noise. After that,
 * ONE mutation per screen a member actually uses.
 *
 * `expect` is a documentation aid only — the verdict comes from comparing the two
 * live responses, never from this field.
 *
 * 🔴 `body(ctx)` receives a PER-BACKEND context, because some valid payloads cannot be
 * written once for both. A listing needs a real category id, and the two backends mint
 * different ids — so a single hardcoded body can only ever exercise the REFUSAL path.
 * ctx.categoryId is resolved from each backend's own /api/v2/categories immediately
 * before the run. Without this the corpus proved the two agree on rejecting a listing
 * and said nothing about whether they agree on accepting one.
 */
const CORPUS = [
  // ── auth lifecycle ─────────────────────────────────────────────────────────
  {
    name: 'login (wrong password)',
    method: 'POST',
    path: '/api/auth/login',
    anonymous: true,
    body: () => ({ email: 'e2e.user.a@project-nexus.local', password: 'definitely-not-the-password' }),
    expect: 'a refusal with the same status and envelope on both',
  },
  {
    name: 'login (missing fields)',
    method: 'POST',
    path: '/api/auth/login',
    anonymous: true,
    body: () => ({}),
    expect: 'validation envelope',
  },
  // ── the legal gate: what a member must do before anything else ─────────────
  {
    name: 'legal accept-all',
    method: 'POST',
    path: '/api/legal/accept-all',  // 🔴 Laravel has no v2 spelling for these three
    body: () => ({}),
    expect: '{data:{message}}',
  },
  {
    name: 'legal accept (missing ids)',
    method: 'POST',
    path: '/api/legal/accept',
    body: () => ({}),
    expect: '400 VALIDATION_ERROR',
  },
  // ── the mutations behind the main screens ──────────────────────────────────
  {
    name: 'create feed post',
    method: 'POST',
    path: '/api/v2/feed/posts',
    body: () => ({ content: stamp('Write-harness post'), visibility: 'public' }),
  },
  // ── Corpus widened 2026-08-19 ───────────────────────────────────────────────
  // 🔴 Added to raise N before extending the shared envelope filter to writes.
  // Six samples were not enough to justify a rule applied to every write in the
  // backend; over-generalising from a small count is the specific mistake that
  // cost this workstream 22 wrong endpoints once already. These are creates that
  // need no pre-existing row id, so they work on either backend's fixtures.
  {
    name: 'create group',
    method: 'POST',
    path: '/api/v2/groups',
    body: () => ({
      name: stamp('Write-harness group'),
      description: stamp('Created by the write-mode parity harness'),
      privacy: 'public',
      visibility: 'public',
    }),
  },
  {
    name: 'create event',
    method: 'POST',
    path: '/api/v2/events',
    body: () => ({
      title: stamp('Write-harness event'),
      description: stamp('Created by the write-mode parity harness'),
      start_date: '2027-01-15 10:00:00',
      end_date: '2027-01-15 12:00:00',
      location: 'Write-harness venue',
      capacity: 10,
    }),
  },
  {
    name: 'create goal',
    method: 'POST',
    path: '/api/v2/goals',
    body: () => ({
      title: stamp('Write-harness goal'),
      description: stamp('Created by the write-mode parity harness'),
      target_hours: 5,
    }),
  },
  {
    name: 'create resource',
    method: 'POST',
    path: '/api/v2/resources',
    body: () => ({
      title: stamp('Write-harness resource'),
      description: stamp('Created by the write-mode parity harness'),
      content: stamp('Body text for the write-mode parity harness'),
      type: 'article',
    }),
  },
  {
    // 🔴 `notification-SETTINGS`, not `notification-preferences`. The first spelling
    // was my guess and 404s on BOTH backends, so the row agreed and measured nothing
    // — a matched 404 pair reads as harmless in a tally while proving only that
    // neither backend has an endpoint nobody asked for. Read off Laravel's route
    // table: routes/api.php:768.
    name: 'update my notification settings',
    method: 'PUT',
    path: '/api/v2/users/me/notification-settings',
    body: () => ({ email_notifications: true, push_notifications: false }),
  },
  {
    // 🔴 The SUCCESS path. Needs a per-backend category id and a description long
    // enough to clear the configured minimum (20 characters by default), or it only
    // ever measures the refusal.
    name: 'create listing (valid)',
    method: 'POST',
    path: '/api/v2/listings',
    body: (ctx) => ({
      title: stamp('Write-harness listing'),
      description: stamp('Created by the write-mode parity harness to exercise a valid create'),
      type: 'offer',
      category_id: ctx.categoryId,
    }),
  },
  {
    name: 'create listing (no category)',
    method: 'POST',
    path: '/api/v2/listings',
    body: () => ({
      title: stamp('Write-harness listing'),
      description: stamp('Created by the write-mode parity harness to exercise a valid create'),
      type: 'offer',
    }),
    expect: '422 when listing.require_category is on, which is the default',
  },
  {
    name: 'create listing (missing title)',
    method: 'POST',
    path: '/api/v2/listings',
    body: () => ({ description: stamp('no title on purpose') }),
    expect: 'validation envelope — the shape a form relies on',
  },
  {
    name: 'update my profile',
    method: 'PUT',
    path: '/api/v2/users/me',
    body: () => ({ bio: stamp('Write-harness bio') }),
  },
  {
    name: 'create saved search',
    method: 'POST',
    path: '/api/v2/search/saved',
    body: () => ({ name: stamp('Write-harness search'), query_params: { q: 'bike' } }),
  },
  {
    name: 'mark all notifications read',
    method: 'POST',
    path: '/api/v2/notifications/read-all',
    body: () => ({}),
  },
  {
    name: 'create poll',
    method: 'POST',
    path: '/api/v2/polls',
    body: () => ({ question: stamp('Write-harness poll?'), options: ['Yes', 'No'] }),
  },
  {
    name: 'wallet transfer (no recipient)',
    method: 'POST',
    path: '/api/v2/wallet/transfer',
    body: () => ({ amount: 1 }),
    expect: 'validation refusal — never a successful transfer',
  },
];

/**
 * Values that differ per backend and must be looked up rather than hardcoded.
 * Resolved once per run, immediately before the corpus executes.
 */
async function resolveContext(base, tenant, token) {
  const ctx = { categoryId: null };
  try {
    const r = await fetch(`${base}/api/v2/categories`, {
      headers: { Accept: 'application/json', 'X-Tenant-ID': tenant, Authorization: `Bearer ${token}` },
    });
    const j = await r.json();
    const rows = Array.isArray(j?.data) ? j.data : Array.isArray(j?.data?.items) ? j.data.items : [];
    const first = rows.find((c) => Number.isInteger(c?.id));
    if (first) ctx.categoryId = first.id;
  } catch { /* leave null; the spec decides what to do without one */ }
  return ctx;
}

async function send(base, spec, tenant, token, ctx) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Tenant-ID': tenant,
    };
    if (token && !spec.anonymous) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${base}${spec.path}`, {
      method: spec.method,
      headers,
      body: JSON.stringify(spec.body(ctx)),
      signal: controller.signal,
    });
    const text = await response.text();
    let body = null;
    let parsed = false;
    try { body = JSON.parse(text); parsed = true; } catch { body = text.slice(0, 200); }
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

async function main() {
  const laravelToken = await login(LARAVEL, LARAVEL_AUTH, LARAVEL_TENANT);
  const aspnetToken = await login(ASPNET, ASPNET_AUTH, ASPNET_TENANT);

  console.log(`Laravel : ${LARAVEL} (tenant ${LARAVEL_TENANT})  [DISPOSABLE]`);
  console.log(`ASP.NET : ${ASPNET} (tenant ${ASPNET_TENANT})`);
  console.log('Mode    : WRITE — real mutations, shape compared, values expected to differ');
  console.log(`Run id  : ${RUN} (every create body carries it, so runs cannot collide)`);
  console.log(`Comparing ${CORPUS.length} mutations.\n`);

  const laravelCtx = await resolveContext(LARAVEL, LARAVEL_TENANT, laravelToken);
  const aspnetCtx = await resolveContext(ASPNET, ASPNET_TENANT, aspnetToken);
  console.log(`Category id : Laravel ${laravelCtx.categoryId ?? '(none)'} / ASP.NET ${aspnetCtx.categoryId ?? '(none)'}`);

  const results = [];
  for (const spec of CORPUS) {
    // Sequential, not parallel: these mutate, and a later case may depend on the
    // state an earlier one left (accept-all before a gated write, for instance).
    const laravel = await send(LARAVEL, spec, LARAVEL_TENANT, laravelToken, laravelCtx);
    const aspnet = await send(ASPNET, spec, ASPNET_TENANT, aspnetToken, aspnetCtx);

    const verdict = classify(laravel, aspnet);

    // 🔴 Envelope observations recorded on EVERY row, match or not. The shared
    // envelope filter is restricted to GET/HEAD and /api/v2 because that is the
    // only surface that had ever been measured; extending it needs a count of
    // Laravel's actual behaviour on writes, per path, not an assumption that the
    // GET rule carries over. Captured here so the count is evidence in a file.
    const envelope = (r) => ({
      has_data: !!r.parsed && r.body !== null && typeof r.body === 'object' && 'data' in r.body,
      has_meta_base_url: !!r.parsed && typeof r.body?.meta?.base_url === 'string',
      has_top_level_success: !!r.parsed && r.body !== null && typeof r.body === 'object' && 'success' in r.body,
    });
    const row = {
      name: spec.name,
      method: spec.method,
      path: spec.path,
      verdict,
      laravel_status: laravel.status,
      aspnet_status: aspnet.status,
      laravel_envelope: envelope(laravel),
      aspnet_envelope: envelope(aspnet),
    };
    if (verdict === 'SHAPE_DIFFERS') Object.assign(row, describeShapeDiff(laravel, aspnet));
    results.push(row);

    const mark = verdict === 'MATCH' ? '✓' : verdict === 'MATCH_BUT_LIST_EMPTY' ? '~' : '✗';
    console.log(
      `${mark} ${verdict.padEnd(21)} ${String(laravel.status).padEnd(4)}→${String(aspnet.status).padEnd(4)} `
      + `${spec.method.padEnd(5)} ${spec.path}   (${spec.name})`);
    if (verdict === 'SHAPE_DIFFERS') {
      if (row.missing_count) console.log(`      missing in ASP.NET (${row.missing_count}): ${sample(row.missing_in_aspnet, row.missing_count)}`);
      if (row.extra_count) console.log(`      extra in ASP.NET   (${row.extra_count}): ${sample(row.extra_in_aspnet, row.extra_count)}`);
    }
  }

  const tally = results.reduce((acc, r) => ({ ...acc, [r.verdict]: (acc[r.verdict] ?? 0) + 1 }), {});
  console.log('\n─── summary ───');
  for (const [verdict, count] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
    console.log(`${String(count).padStart(4)}  ${verdict}`);
  }
  console.log(`\nContract-identical writes: ${tally.MATCH ?? 0}/${results.length}`);
  console.log(
    '🔴 This is a FIRST measurement of a surface that was previously unmeasured. A low\n'
    + '   number here is discovery, not regression — nothing broke today that was working\n'
    + '   yesterday; it simply was never checked.');

  if (JSON_OUT) {
    fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
    fs.writeFileSync(JSON_OUT, JSON.stringify(
      { generated_at: new Date().toISOString(), run: RUN, laravel: LARAVEL, aspnet: ASPNET, results }, null, 2));
    console.log(`\nWrote ${JSON_OUT}`);
  }

  // Reporting tool, not a gate: exit 0 always and read the number.
  process.exit(0);
}

main();
