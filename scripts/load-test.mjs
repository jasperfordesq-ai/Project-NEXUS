#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Load test harness.
 *
 * Written because a partner organisation's technical review asked for
 * load-testing evidence and there was none — not a partial answer, none at all.
 * Recording per-request performance in production tells you how the platform
 * behaves at today's volume; it says nothing about what happens at ten or a
 * hundred times that, which is the question a national rollout actually poses.
 *
 * 🔴 DEPENDENCY-FREE ON PURPOSE. Node 22 has native `fetch` and `worker_threads`,
 * so this adds no package, no lockfile churn, no new npm-audit surface and no
 * binary for CI to install. A load tester that itself needs a supply chain is a
 * poor trade for a platform whose whole continuity argument is "you can fork this
 * and run it yourself".
 *
 * What it measures, per scenario and overall: request count, throughput,
 * latency p50/p90/p95/p99/max, and a status-code breakdown. Percentiles rather
 * than averages, because an average hides the member who waited nine seconds.
 *
 * Usage:
 *   node scripts/load-test.mjs                          # defaults, local stack
 *   node scripts/load-test.mjs --users 50 --duration 60
 *   node scripts/load-test.mjs --base http://127.0.0.1:8090 --json out.json
 *
 * Exit codes:
 *   0 — every threshold met
 *   1 — a threshold was breached (usable as a gate)
 *   2 — refused to run (bad target, or production without the explicit override)
 */

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { writeFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';

// ─── Scenarios ──────────────────────────────────────────────────────────────
//
// Weighted to look like real traffic rather than a synthetic hammer. Browsing
// dominates a timebank in practice: members look far more often than they post.
// All GET, all unauthenticated — this measures the platform's capacity to serve,
// and deliberately does NOT create data, so it can be run repeatedly against the
// same environment without leaving anything behind to clean up.
// 🔴 Every path here is verified to return 200 unauthenticated. That matters more
// than it sounds: a scenario pointed at a 404 or a 401 still produces a tidy
// latency table, and it would be measuring Laravel's error path rather than the
// work it claims to. Re-verify with curl before adding one.
//
// Deliberately API endpoints, not SPA page routes. In production the pages are
// static assets served by nginx and are cheap; the load that decides capacity
// lands on PHP and MariaDB. Page routes also 404 against the API container, which
// would have quietly measured nothing.
const SCENARIOS = [
  { name: 'tenant bootstrap', weight: 30, path: () => '/api/v2/tenant/bootstrap' },
  { name: 'categories',       weight: 25, path: () => '/api/v2/categories' },
  { name: 'legal terms',      weight: 15, path: () => '/api/v2/legal/terms' },
  { name: 'registration info', weight: 15, path: () => '/api/v2/auth/registration-info' },
  { name: 'api health',       weight: 10, path: () => '/api/v2/health' },
  // Bypasses the framework entirely. Included as a control: it isolates how much
  // of the measured latency is Laravel boot versus network and container.
  { name: 'health.php (no framework)', weight: 5, path: () => '/health.php' },
];

// ─── Thresholds ─────────────────────────────────────────────────────────────
//
// Deliberately modest and stated up front, so a pass means something specific
// rather than "it did not fall over". These are starting figures for discussion
// with TBUK, not an agreed service level — there isn't one yet, and pretending
// otherwise is how a made-up number becomes a commitment.
// 🔴 These target a PRODUCTION-LIKE environment. A local dev stack will breach the
// latency ones by design and that is not a fault: config and routes are uncached
// locally and the repository is bind-mounted over 9p, which is ~103× slower than
// the container's own filesystem. Measured on this machine, every Laravel endpoint
// costs ~1.45s locally while /health.php — which never boots the framework — costs
// ~9ms. Override with --p95 / --p99 / --error-rate when running locally, and read
// the SHAPE (does latency degrade as users rise?) rather than the absolute figure.
const THRESHOLDS = {
  errorRatePct: 1,   // share of responses that are 5xx or a transport failure
  p95Ms: 1500,       // 95% of requests complete within this
  p99Ms: 3000,       // 99% within this
};

// Hosts that must never be load-tested without a deliberate, explicit override.
// 365 real members share a single VM; a load test against production is an
// outage you scheduled yourself.
const PRODUCTION_HOSTS = [
  'project-nexus.ie',
  'project-nexus.net',
  'timebank.global',
  'hour-timebank.ie',
  'timebanks.us',
  'nexuscivic.ie',
  'pairc-goodman.com',
];

function parseArgs(argv) {
  const out = {
    base: process.env.LOAD_TEST_BASE_URL || 'http://127.0.0.1:5173',
    tenant: process.env.LOAD_TEST_TENANT || 'hour-timebank',
    users: 20,
    duration: 30,
    rampSeconds: 5,
    json: null,
  };
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i]?.replace(/^--/, '');
    const value = argv[i + 1];
    if (key === undefined || value === undefined) continue;
    if (key === 'users' || key === 'duration' || key === 'ramp') {
      out[key === 'ramp' ? 'rampSeconds' : key] = Number(value);
    } else if (key === 'p95' || key === 'p99') {
      // Local runs need these raised — see the note on THRESHOLDS.
      THRESHOLDS[key === 'p95' ? 'p95Ms' : 'p99Ms'] = Number(value);
    } else if (key === 'error-rate') {
      THRESHOLDS.errorRatePct = Number(value);
    } else if (key in out) {
      out[key] = value;
    }
  }
  return out;
}

function refuseIfProduction(base) {
  let host;
  try {
    host = new URL(base).hostname.toLowerCase();
  } catch {
    console.error(`✗ Not a usable URL: ${base}`);
    process.exit(2);
  }

  const isProd = PRODUCTION_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  if (!isProd) return;

  if (process.env.LOAD_TEST_I_KNOW_THIS_IS_PRODUCTION === '1') {
    console.warn(
      `⚠ Load-testing PRODUCTION host ${host} because `
      + 'LOAD_TEST_I_KNOW_THIS_IS_PRODUCTION=1 is set. Real members share this server.',
    );
    return;
  }

  console.error(
    `✗ Refusing to load-test ${host} — it is a production host serving real members `
    + 'on a single VM.\n'
    + '  Run against the local stack instead (default http://127.0.0.1:5173), or set\n'
    + '  LOAD_TEST_I_KNOW_THIS_IS_PRODUCTION=1 deliberately, during a maintenance window.',
  );
  process.exit(2);
}

function pickScenario(rand) {
  const total = SCENARIOS.reduce((sum, s) => sum + s.weight, 0);
  let n = rand * total;
  for (const s of SCENARIOS) {
    n -= s.weight;
    if (n <= 0) return s;
  }
  return SCENARIOS[SCENARIOS.length - 1];
}

// ─── Worker: drives one slice of the virtual users ──────────────────────────

if (!isMainThread) {
  const { base, tenant, users, endAt, rampMs, startedAt } = workerData;
  const samples = [];

  const virtualUser = async (index) => {
    // Stagger arrivals across the ramp so the whole fleet does not hit a cold
    // application in the same millisecond, which measures the cold start rather
    // than the platform.
    const delay = rampMs > 0 ? (rampMs * index) / Math.max(users, 1) : 0;
    await new Promise((r) => setTimeout(r, delay));

    while (Date.now() < endAt) {
      const scenario = pickScenario(Math.random());
      const url = base + scenario.path(tenant);
      const t0 = performance.now();
      let status = 0;
      let failed = false;
      try {
        const res = await fetch(url, {
          headers: { Accept: 'text/html,application/json', 'User-Agent': 'nexus-load-test' },
          redirect: 'follow',
        });
        status = res.status;
        // Drain the body: without this we are timing headers, not a served page.
        await res.arrayBuffer();
      } catch {
        failed = true;
      }
      samples.push({
        scenario: scenario.name,
        ms: performance.now() - t0,
        status,
        failed,
      });
    }
  };

  await Promise.all(Array.from({ length: users }, (_, i) => virtualUser(i)));
  parentPort.postMessage({ samples, startedAt, finishedAt: Date.now() });
}

// ─── Main thread ────────────────────────────────────────────────────────────

if (isMainThread) {
  const args = parseArgs(process.argv);
  refuseIfProduction(args.base);

  const threads = Math.max(1, Math.min(availableParallelism() - 1, 8));
  const perThread = Math.max(1, Math.ceil(args.users / threads));
  const startedAt = Date.now();
  const endAt = startedAt + args.duration * 1000;

  console.log('');
  console.log('═'.repeat(64));
  console.log('  NEXUS LOAD TEST');
  console.log('═'.repeat(64));
  console.log(`  target      ${args.base}`);
  console.log(`  tenant      ${args.tenant}`);
  console.log(`  users       ${args.users} concurrent, ramped over ${args.rampSeconds}s`);
  console.log(`  duration    ${args.duration}s`);
  console.log(`  threads     ${threads} (${perThread} users each)`);
  console.log('');

  const results = await Promise.all(
    Array.from({ length: threads }, () => new Promise((resolve, reject) => {
      const w = new Worker(new URL(import.meta.url), {
        workerData: {
          base: args.base.replace(/\/$/, ''),
          tenant: args.tenant,
          users: perThread,
          endAt,
          rampMs: args.rampSeconds * 1000,
          startedAt,
        },
      });
      w.on('message', resolve);
      w.on('error', reject);
    })),
  );

  const samples = results.flatMap((r) => r.samples);
  const wallSeconds = (Date.now() - startedAt) / 1000;

  if (samples.length === 0) {
    console.error('✗ No requests completed — is the target running?');
    process.exit(2);
  }

  const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
  const summarise = (rows) => {
    const sorted = rows.map((r) => r.ms).sort((a, b) => a - b);
    const bad = rows.filter((r) => r.failed || r.status >= 500).length;
    // 🔴 429 is NOT an error — it is the rate limiter working, and counting it as
    // a failure would make correct behaviour look like a fault. But it must not be
    // counted as a success either: a run where half the responses were throttled
    // is measuring the throttle, not the platform's capacity, and reporting only
    // "0% errors" would overstate what was proven. Tracked separately.
    const throttled = rows.filter((r) => r.status === 429).length;
    return {
      count: rows.length,
      rps: rows.length / wallSeconds,
      p50: pct(sorted, 50),
      p90: pct(sorted, 90),
      p95: pct(sorted, 95),
      p99: pct(sorted, 99),
      max: sorted[sorted.length - 1],
      errorRatePct: (bad / rows.length) * 100,
      throttled,
      throttledPct: (throttled / rows.length) * 100,
    };
  };

  const overall = summarise(samples);

  const pad = (s, n) => String(s).padEnd(n);
  const num = (v, n = 7) => String(Math.round(v)).padStart(n);

  // Header is padded as text, not through num() — that ran Math.round over the
  // strings and printed a row of NaN.
  const head = (s, n = 7) => String(s).padStart(n);
  console.log(`  ${pad('scenario', 26)}${pad('reqs', 7)}${head('p50')}${head('p95')}${head('p99')}${head('max')}  err%`);
  console.log('  ' + '─'.repeat(64));
  for (const s of SCENARIOS) {
    const rows = samples.filter((r) => r.scenario === s.name);
    if (rows.length === 0) continue;
    const m = summarise(rows);
    console.log(
      `  ${pad(s.name, 26)}${pad(m.count, 7)}${num(m.p50)}${num(m.p95)}${num(m.p99)}${num(m.max)}  ${m.errorRatePct.toFixed(1)}`,
    );
  }
  console.log('  ' + '─'.repeat(64));
  console.log(
    `  ${pad('OVERALL', 26)}${pad(overall.count, 7)}${num(overall.p50)}${num(overall.p95)}${num(overall.p99)}${num(overall.max)}  ${overall.errorRatePct.toFixed(1)}`,
  );
  console.log('');
  console.log(`  throughput  ${overall.rps.toFixed(1)} requests/second over ${wallSeconds.toFixed(1)}s`);

  // Status breakdown — a wall of 302s or 404s can otherwise look like a clean run.
  const byStatus = samples.reduce((acc, r) => {
    const key = r.failed ? 'transport failure' : String(r.status);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  console.log(`  statuses    ${Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join('  ')}`);

  if (overall.throttled > 0) {
    console.log('');
    console.log(
      `  ⚠ ${overall.throttled} of ${overall.count} responses (${overall.throttledPct.toFixed(1)}%) were `
      + 'rate-limited (429).',
    );
    console.log(
      '    That is the limiter working, not a fault — but it caps measured throughput,',
    );
    console.log(
      '    so this run does NOT establish server capacity. Raise the limits in the test',
    );
    console.log(
      '    environment to measure the platform rather than its own DoS protection.',
    );
  }
  console.log('');

  const breaches = [];
  if (overall.errorRatePct > THRESHOLDS.errorRatePct) {
    breaches.push(`error rate ${overall.errorRatePct.toFixed(2)}% > ${THRESHOLDS.errorRatePct}%`);
  }
  if (overall.p95 > THRESHOLDS.p95Ms) breaches.push(`p95 ${Math.round(overall.p95)}ms > ${THRESHOLDS.p95Ms}ms`);
  if (overall.p99 > THRESHOLDS.p99Ms) breaches.push(`p99 ${Math.round(overall.p99)}ms > ${THRESHOLDS.p99Ms}ms`);

  if (args.json) {
    writeFileSync(args.json, JSON.stringify({
      target: args.base,
      tenant: args.tenant,
      users: args.users,
      durationSeconds: args.duration,
      wallSeconds,
      thresholds: THRESHOLDS,
      overall,
      byStatus,
      perScenario: SCENARIOS.map((s) => {
        const rows = samples.filter((r) => r.scenario === s.name);
        return rows.length ? { name: s.name, ...summarise(rows) } : null;
      }).filter(Boolean),
      breaches,
    }, null, 2));
    console.log(`  results written to ${args.json}`);
    console.log('');
  }

  if (breaches.length) {
    console.error('✗ THRESHOLD BREACH');
    for (const b of breaches) console.error(`    ${b}`);
    console.error('');
    process.exit(1);
  }

  console.log(`✓ Within thresholds (error <${THRESHOLDS.errorRatePct}%, p95 <${THRESHOLDS.p95Ms}ms, p99 <${THRESHOLDS.p99Ms}ms)`);
  console.log('');
}
