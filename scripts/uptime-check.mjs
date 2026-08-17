// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Availability probe for the platform's public endpoints.
 *
 * Replaces the uptime monitoring that lived in the archived
 * jasperfordesq-ai/api.project-nexus.net repository. Archiving a repository
 * disables its scheduled workflows, so on 2026-08-10 the ASP.NET API and the
 * Web UK frontend lost their only automated up/down check.
 *
 * Design notes, because the failure mode of a monitor is to lie:
 *
 *   - A single failed request is NOT an outage. Each target is retried
 *     (`attempts` / `retryDelayMs`) and only counts as down when every attempt
 *     fails. A monitor that alarms on one dropped packet gets muted, and a
 *     muted monitor is worse than none.
 *
 *   - This script NEVER exits non-zero for a target being down. Down is a
 *     result, not a script error; the caller decides what to do with it. It
 *     exits non-zero only when it cannot do its job at all (unreadable or
 *     invalid config), so "the monitor is broken" can never be mistaken for
 *     "everything is fine".
 *
 *   - Requests are unauthenticated GETs against public URLs only. See the
 *     comment block in scripts/uptime-targets.json.
 *
 * Usage:
 *   node scripts/uptime-check.mjs                 # probe and print a report
 *   node scripts/uptime-check.mjs --json          # machine-readable output
 *   node scripts/uptime-check.mjs --config <path>
 *
 * When GITHUB_OUTPUT is set, writes `status`, `summary` and `detail` for the
 * calling workflow.
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const wantJson = args.includes('--json');

function argValue(flag, fallback) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}

const configPath = path.resolve(argValue('--config', path.join(scriptDir, 'uptime-targets.json')));

function fail(message) {
  console.error(`uptime-check: ${message}`);
  process.exit(2);
}

let config;
try {
  config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
  fail(`cannot read config at ${configPath}: ${error.message}`);
}

if (!Array.isArray(config.targets) || config.targets.length === 0) {
  fail(`config at ${configPath} defines no targets`);
}

const timeoutMs = Number(config.timeoutMs) || 15000;
const attempts = Math.max(1, Number(config.attempts) || 3);
const retryDelayMs = Math.max(0, Number(config.retryDelayMs) ?? 5000);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One request. Resolves to a result; never throws. */
async function probeOnce(target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(target.url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'project-nexus-uptime-check/1.0 (+https://github.com/jasperfordesq-ai/Project-NEXUS)' }
    });

    const expected = Array.isArray(target.expectStatus) && target.expectStatus.length
      ? target.expectStatus
      : [200];
    const statusOk = expected.includes(response.status);

    // 🔴 A status code cannot tell one service from another, and on this platform
    // that is a real gap rather than a theoretical one: a React SPA answers 200 on
    // ANY path, so a vhost pointed at the wrong container serves 200 at every URL
    // while members get the wrong application. `expectBodyContains` lets a target
    // assert WHICH service answered. Only the first 2 KB is inspected — these
    // assertions identify a service from a small JSON body, and downloading whole
    // pages every 15 minutes would be waste.
    let bodyReason = null;
    if (statusOk && typeof target.expectBodyContains === 'string' && target.expectBodyContains !== '') {
      const body = (await response.text()).slice(0, 2048);
      if (!body.includes(target.expectBodyContains)) {
        bodyReason = `HTTP ${response.status} but the response did not identify itself as "${target.expectBodyContains}"`;
      }
    }

    return {
      ok: statusOk && bodyReason === null,
      status: response.status,
      ms: Date.now() - startedAt,
      reason: statusOk
        ? bodyReason
        : `HTTP ${response.status} (expected ${expected.join(' or ')})`
    };
  } catch (error) {
    const timedOut = error.name === 'AbortError';
    return {
      ok: false,
      status: null,
      ms: Date.now() - startedAt,
      reason: timedOut ? `no response within ${timeoutMs}ms` : (error.cause?.code || error.message)
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Retries before calling a target down, so one dropped request is not an outage. */
async function probeTarget(target) {
  const tried = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await probeOnce(target);
    tried.push(result);

    if (result.ok) {
      return { ...target, ...result, attempts: attempt };
    }
    if (attempt < attempts) {
      await sleep(retryDelayMs);
    }
  }

  const last = tried[tried.length - 1];
  return { ...target, ...last, attempts: attempts, allAttempts: tried.map((t) => t.reason) };
}

const results = await Promise.all(config.targets.map(probeTarget));
const down = results.filter((r) => !r.ok);
const healthy = down.length === 0;

// A stable identity for the current state. The workflow compares this against
// the previous run so it only messages on a CHANGE - alerting every 15 minutes
// for the length of an outage is how a monitor trains its owner to ignore it.
const stateKey = healthy
  ? 'healthy'
  : `down:${down.map((r) => r.name).sort().join(',')}`;

const summary = healthy
  ? `All ${results.length} endpoints responding`
  : `${down.length} of ${results.length} endpoints DOWN: ${down.map((r) => r.name).join(', ')}`;

const detail = results
  .map((r) => `${r.ok ? 'UP  ' : 'DOWN'}  ${r.name.padEnd(22)} ${r.ok ? `${r.ms}ms` : r.reason}`)
  .join('\n');

if (wantJson) {
  console.log(JSON.stringify({ healthy, stateKey, summary, results }, null, 2));
} else {
  console.log(summary);
  console.log('');
  console.log(detail);
}

if (process.env.GITHUB_OUTPUT) {
  // 🔴 Random, not derived from the content. Part of `detail` is network error
  // text from a remote host, so a deterministic delimiter is something an
  // outside party could in principle reproduce and use to close the block early
  // and append their own lines to this workflow's outputs.
  const delimiter = `EOF_${randomUUID().replace(/-/g, '')}`;
  fs.appendFileSync(process.env.GITHUB_OUTPUT, [
    `healthy=${healthy}`,
    `state_key=${stateKey}`,
    `summary=${summary}`,
    `detail<<${delimiter}`,
    detail,
    delimiter,
    ''
  ].join('\n'));
}

// Deliberately exit 0 whether or not endpoints are down. See the header.
process.exit(0);
