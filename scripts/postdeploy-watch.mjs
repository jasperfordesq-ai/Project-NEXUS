// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
//
// postdeploy-watch.mjs — watch production error rates AFTER a deploy switches
// traffic, and say plainly whether the new release looks healthy.
//
// WHY: the blue/green deploy smoke-tests the candidate BEFORE switching, but
// nothing watched the minutes AFTER the switch — a deploy that passed its
// health check and started erroring ten minutes later was only noticed when a
// user complained. Post-deployment verification ("watch the metrics for a
// defined period; if error rates spike, act") is standard professional
// practice. This is the watch. It NEVER rolls back by itself — on a spike it
// alarms loudly and prints the one-command rollback for a human to run.
//
// DATA SOURCE: Sentry error counts, scoped to the release tag that deploys
// stamp on every event (nexus-php@<commit> / nexus-react@<commit> — wired
// 2026-08-03). Reads the API token from .secrets.local/sentry.env
// (SENTRY_AUTH_TOKEN_MONITOR, falling back to SENTRY_AUTH_TOKEN). The token
// needs scopes: org:read, project:read, event:read. If the token is missing
// or under-scoped the script says so and finishes UNKNOWN — it never lets
// "couldn't check" read as "healthy".
//
// USAGE
//   node scripts/postdeploy-watch.mjs                 # watch the live release, 30 min
//   node scripts/postdeploy-watch.mjs --window 15     # shorter window (minutes)
//   node scripts/postdeploy-watch.mjs --release <sha> # watch a specific release
//   node scripts/postdeploy-watch.mjs --probe         # just test the token, no watch
//
// EXIT CODES (via process.exitCode — process.exit() during async teardown
// trips a libuv assertion on Windows and corrupts the code to 127)
//   0  window completed, error levels normal
//   1  SPIKE — errors well above normal; rollback command printed
//   2  could not determine (token/network) — treat as unverified, not healthy

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(ROOT, '.secrets.local', 'sentry.env');
const HEALTH_URL = 'https://api.project-nexus.ie/api/v2/health';
const TICK_MIN = 5;

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

function say(msg) { console.log(`[watch] ${msg}`); }
function bad(msg) { console.error(`[watch] ✗ ${msg}`); }

function tokenInstructions() {
  bad('The Sentry key in .secrets.local/sentry.env cannot read error counts.');
  bad('One-time fix (~2 minutes):');
  bad('  1. Open https://hour-timebank-clg.sentry.io/settings/auth-tokens/');
  bad('  2. Create a token with scopes: org:read, project:read, event:read');
  bad('  3. Put it in .secrets.local/sentry.env as SENTRY_AUTH_TOKEN_MONITOR=<token>');
}

async function main() {
  const WINDOW_MIN = Number(flag('--window', '30'));
  const RELEASE_ARG = flag('--release');
  const PROBE = args.includes('--probe');

  // --- config ---------------------------------------------------------------
  if (!existsSync(ENV_FILE)) {
    bad(`${ENV_FILE} not found — cannot reach Sentry. Finishing UNKNOWN.`);
    return 2;
  }
  const env = {};
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  const TOKEN = env.SENTRY_AUTH_TOKEN_MONITOR || env.SENTRY_AUTH_TOKEN;
  const ORG = env.SENTRY_ORG;
  const BASE = (env.SENTRY_API_BASE || '').replace(/\/$/, '');
  // 🔴 webuk is OPTIONAL, following react's existing pattern: absent id ⇒ counted
  // as 0, never a failed watch. It is not deployed yet, so it will normally be
  // absent — but once it is, a spike in the accessible frontend must be visible
  // in the post-deploy window, which is the whole point of this watch.
  const PROJECTS = {
    php: env.SENTRY_PROJECT_PHP,
    react: env.SENTRY_PROJECT_REACT,
    webuk: env.SENTRY_PROJECT_WEBUK
  };
  if (!TOKEN || !ORG || !BASE || !PROJECTS.php) {
    bad('sentry.env is missing SENTRY_AUTH_TOKEN(_MONITOR), SENTRY_ORG, SENTRY_API_BASE or SENTRY_PROJECT_PHP.');
    return 2;
  }
  const allProjects = [PROJECTS.php, PROJECTS.react, PROJECTS.webuk].filter(Boolean);

  // One Sentry counting query. Throws {scope:true} on a permissions failure
  // so callers can print the fix instead of a bare error.
  // 🔴 Errors from an inline `php -r` one-liner typed into the production
  // container are tagged `invocation:cli-eval` by the PHP before_send hook
  // (app/Support/Sentry/SentryInvocation.php) and are excluded here. On
  // 2026-08-30 a single mistyped verification command spent 3 of the alarm
  // budget of 10 inside the very window meant to prove the deploy safe; a
  // second typo would have alarmed a healthy deploy.
  //
  // `!tag:value` also matches events that carry no such tag at all, so this is
  // safe against older releases whose events predate the tag. It excludes ONLY
  // hand-typed inline code — artisan commands, queue workers and the scheduler
  // are real production and still counted.
  const EXCLUDE_HAND_RUN = `!${'invocation'}:cli-eval`;

  async function countErrors(projectIds, query, range) {
    const p = new URLSearchParams();
    p.append('field', 'count()');
    // dataset=errors, with NO event.type filter: logged error messages arrive
    // as event.type:default, not :error, and a type filter silently dropped
    // them (verified live 2026-08-03: 5 real events counted as 0). The
    // errors dataset is exactly what the Sentry UI calls "errors".
    p.append('dataset', 'errors');
    // Every count in this script excludes hand-run one-liners, including the
    // 24h baseline — so the baseline and the post-switch window stay comparable.
    p.append('query', `${query.trim()} ${EXCLUDE_HAND_RUN}`.trim());
    for (const id of projectIds) p.append('project', id);
    if (range.statsPeriod) p.append('statsPeriod', range.statsPeriod);
    if (range.start) { p.append('start', range.start); p.append('end', range.end); }
    const res = await fetch(`${BASE}/organizations/${ORG}/events/?${p}`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    if (res.status === 403 || res.status === 401) throw Object.assign(new Error('permission'), { scope: true });
    if (!res.ok) throw new Error(`Sentry API ${res.status}`);
    const body = await res.json();
    return Number(body?.data?.[0]?.['count()'] ?? 0);
  }

  // --- probe mode -------------------------------------------------------------
  if (PROBE) {
    try {
      const n = await countErrors(allProjects, '', { statsPeriod: '24h' });
      say(`✓ token works — ${n} error event(s) recorded in the last 24h.`);
      return 0;
    } catch (e) {
      if (e.scope) tokenInstructions(); else bad(`Sentry unreachable: ${e.message}`);
      return 2;
    }
  }

  // --- resolve the release to watch ---------------------------------------------
  let release = RELEASE_ARG;
  if (!release) {
    try {
      const res = await fetch(HEALTH_URL);
      release = res.headers.get('x-build');
    } catch { /* handled below */ }
  }
  if (!release) {
    bad(`Could not read the live version from ${HEALTH_URL} and no --release given. Finishing UNKNOWN.`);
    return 2;
  }

  // --- baseline, then watch --------------------------------------------------------
  const t0 = new Date();
  say(`watching release ${release} for ${WINDOW_MIN} minutes (started ${t0.toISOString()})`);

  let baselinePerDay;
  try {
    baselinePerDay = await countErrors(allProjects, '', { statsPeriod: '24h' });
    say(`normal level: ${baselinePerDay} error event(s) per 24h across php+react`);
  } catch (e) {
    if (e.scope) tokenInstructions(); else bad(`Sentry unreachable: ${e.message}`);
    return 2;
  }

  const rollbackHint = () => {
    bad('If the site is misbehaving, roll back with:');
    bad('  ssh -i "$PROD_SSH_KEY" -o RequestTTY=force "$PROD_SSH_HOST" \\');
    bad('    "cd /opt/nexus-php && sudo bash scripts/deploy/bluegreen-deploy.sh rollback --detach"');
  };

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const deadline = t0.getTime() + WINDOW_MIN * 60_000;

  while (true) {
    await sleep(Math.min(TICK_MIN * 60_000, Math.max(deadline - Date.now(), 1)));
    const now = new Date();
    const elapsedMin = (now.getTime() - t0.getTime()) / 60_000;
    const range = { start: t0.toISOString(), end: now.toISOString() };

    let sinceSwitch; let newRelPhp; let newRelReact; let newRelWebuk;
    try {
      sinceSwitch = await countErrors(allProjects, '', range);
      newRelPhp = await countErrors([PROJECTS.php], `release:nexus-php@${release}`, range);
      newRelReact = PROJECTS.react ? await countErrors([PROJECTS.react], `release:nexus-react@${release}`, range) : 0;
      newRelWebuk = PROJECTS.webuk ? await countErrors([PROJECTS.webuk], `release:nexus-webuk@${release}`, range) : 0;
    } catch (e) {
      bad(e.scope ? 'token lost permission mid-watch' : `Sentry unreachable: ${e.message}`);
      bad('The watch could not finish — the deploy is UNVERIFIED, not unhealthy.');
      return 2;
    }

    // Spike = clearly above the normal background rate for the elapsed time,
    // with an absolute floor so a near-silent project doesn't alarm on 2 events.
    const expected = (baselinePerDay * elapsedMin) / 1440;
    const threshold = Math.max(3 * expected, 10);
    say(`${Math.round(elapsedMin)}m in: ${sinceSwitch} error(s) since switch (normal for this span ≈ ${expected.toFixed(1)}, alarm at ${threshold.toFixed(0)}); new release: php=${newRelPhp} react=${newRelReact} webuk=${newRelWebuk}`);

    if (sinceSwitch > threshold) {
      bad(`ERROR SPIKE: ${sinceSwitch} errors since the switch — well above the normal rate.`);
      rollbackHint();
      return 1;
    }
    if (Date.now() >= deadline) break;
  }

  say(`✓ window complete — error levels stayed normal for ${WINDOW_MIN} minutes after the deploy.`);
  return 0;
}

main().then(
  (code) => { process.exitCode = code; },
  (e) => { bad(`internal error: ${e.message}`); process.exitCode = 2; },
);
