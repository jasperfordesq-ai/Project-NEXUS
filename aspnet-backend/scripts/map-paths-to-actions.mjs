// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Asks the RUNNING ASP.NET API which action serves each path, by making the
 * request and reading the endpoint it logged.
 *
 * 🔴 Why not grep for the route. Because grep is wrong here often enough to
 * matter. Routes are spread across attribute templates, a controller-level
 * `[Route]`, and `AdminV2RouteAliasConvention`, which SYNTHESISES `/api/v2`
 * aliases at startup that appear in no source file. Several paths are also
 * claimed by more than one controller, and only the router knows which wins.
 * Editing the endpoint you found by searching, rather than the one that answers,
 * produces a confident fix to code that never runs.
 *
 * Pairs with compare-live-responses.mjs: feed it that run's JSON and it turns a
 * list of differing PATHS into a list of METHODS to edit.
 *
 * Usage:
 *   node aspnet-backend/scripts/map-paths-to-actions.mjs --parity out.json
 *   node aspnet-backend/scripts/map-paths-to-actions.mjs --paths list.txt
 *
 * Requires the dev API container to be running with Information-level request
 * logging (the default for the Development environment).
 */

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import process from 'node:process';

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const ASPNET = flag('aspnet', 'http://127.0.0.1:5080');
const TENANT = flag('tenant', '1');
const CONTAINER = flag('container', 'nexus-aspnet-dev-api');
const PARITY = flag('parity', null);
const PATHS_FILE = flag('paths', null);
const TOKEN_SPEC = flag('auth', null);
const JSON_OUT = flag('json', null);

/** Only these verdicts are worth mapping — a MATCH needs no edit. */
const INTERESTING = new Set(['SHAPE_DIFFERS', 'STATUS_DIFFERS', 'MATCH_BUT_LIST_EMPTY']);

function loadPaths() {
  if (PARITY) {
    const report = JSON.parse(fs.readFileSync(PARITY, 'utf8'));
    return report.results
      .filter((r) => INTERESTING.has(r.verdict))
      .map((r) => ({ path: r.path, verdict: r.verdict, why: describe(r) }));
  }
  if (PATHS_FILE) {
    return fs.readFileSync(PATHS_FILE, 'utf8')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map((l) => ({ path: l.includes(' ') ? l.split(/\s+/)[1] : l, verdict: '', why: '' }));
  }
  console.error('Give me --parity <report.json> or --paths <list.txt>.');
  process.exit(1);
}

/** Turn a parity row into the one-line reason it needs work. */
function describe(row) {
  if (row.verdict === 'STATUS_DIFFERS') return `status ${row.laravel_status} -> ${row.aspnet_status}`;
  const bits = [];
  if (row.missing_in_aspnet?.length) bits.push(`missing ${row.missing_in_aspnet.join(', ')}`);
  if (row.extra_in_aspnet?.length) bits.push(`extra ${row.extra_in_aspnet.join(', ')}`);
  return bits.join(' | ') || 'list empty on one side';
}

async function login() {
  if (!TOKEN_SPEC) return null;
  const [email, password, tenantSlug] = TOKEN_SPEC.split(':');
  const body = { email, password };
  if (tenantSlug) body.tenantSlug = tenantSlug;
  const response = await fetch(`${ASPNET}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Tenant-ID': TENANT },
    body: JSON.stringify(body),
  });
  const parsed = await response.json().catch(() => null);
  const token = parsed?.access_token ?? parsed?.token;
  if (!token) {
    console.error(`Could not sign in to ${ASPNET} — mapping unauthenticated paths only.`);
    return null;
  }
  return token;
}

/**
 * The action the container logged FOR THIS PATH, or null if it executed none.
 *
 * 🔴 Two traps, both hit in practice.
 *
 * The first version read "the last Executing endpoint line in the log tail",
 * which returns the PREVIOUS request's action whenever the current one executes
 * none — a 404, or a request short-circuited by middleware. That is silent
 * mis-attribution: you go and edit a controller that has nothing to do with the
 * problem.
 *
 * A time window alone is not enough either. The container health probe runs on
 * its own schedule and lands inside the same second, so `/api/v2/bookmarks` was
 * confidently reported as `HealthController.Live`. The fix is to anchor on this
 * request's own "Request starting … {path}" line and take the endpoint logged
 * AFTER it — the log's own ordering, rather than a guess about timing.
 */
function actionForPath(since, method, urlPath) {
  const out = execFileSync(
    'docker',
    ['logs', '--since', since, CONTAINER],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  );

  // Query strings are logged verbatim; anchor on the path portion only.
  const pathOnly = urlPath.split('?')[0];
  const lines = out.split(/\r?\n/);

  const startIndex = lines.findLastIndex(
    (line) => line.includes('Request starting')
      && line.includes(` ${method} `)
      && line.includes(pathOnly),
  );
  if (startIndex === -1) return null;

  for (let i = startIndex + 1; i < lines.length; i++) {
    // Stop at the next request: ours executed nothing.
    if (lines[i].includes('Request starting')) break;
    const match = lines[i].match(/Executing endpoint '([^']+)'/);
    if (match) {
      return match[1]
        .replace(/\s*\(Nexus\.Api\)$/, '')
        .replace(/^Nexus\.Api\.Controllers\./, '');
    }
  }

  return null;
}

async function main() {
  const targets = loadPaths();
  const token = await login();
  console.log(`Mapping ${targets.length} paths against ${ASPNET} (container ${CONTAINER})`);
  console.log(token ? 'Signed in.\n' : 'Signed out — protected paths will map to no action.\n');

  const rows = [];
  for (const target of targets) {
    const headers = { Accept: 'application/json', 'X-Tenant-ID': TENANT };
    if (token) headers.Authorization = `Bearer ${token}`;

    // Docker's --since is whole-second granularity, so step back one second to
    // be certain the window opens before the request rather than after it.
    const since = new Date(Date.now() - 1000).toISOString().replace(/\.\d+Z$/, 'Z');

    let status = 0;
    try {
      const response = await fetch(`${ASPNET}${target.path}`, { headers });
      status = response.status;
      await response.text();
    } catch (error) {
      status = 0;
    }

    // The request is synchronous from our side, but the container writes its log
    // line a moment later.
    await new Promise((resolve) => setTimeout(resolve, 250));
    const action = actionForPath(since, 'GET', target.path);

    rows.push({ ...target, status, action });
    console.log(`${String(status).padEnd(4)} ${(action ?? '(no action logged)').padEnd(60)} ${target.path}`);
  }

  // Group by action: one method often serves several differing paths, and that
  // is exactly the leverage worth knowing about before editing anything.
  const byAction = new Map();
  for (const row of rows) {
    const key = row.action ?? '(unmapped)';
    if (!byAction.has(key)) byAction.set(key, []);
    byAction.get(key).push(row);
  }

  console.log('\n─── grouped by action, most paths first ───');
  const grouped = [...byAction.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [action, items] of grouped) {
    console.log(`\n${action}  (${items.length})`);
    for (const item of items) console.log(`    ${item.path}  — ${item.why}`);
  }

  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify({ aspnet: ASPNET, rows }, null, 2));
    console.log(`\nWrote ${JSON_OUT}`);
  }
}

main();
