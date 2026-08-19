// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
//
// sentry-triage.mjs — collect the unresolved Sentry issues, rank them, and write
// a queue an agent (or a human) can work from. Contains NO judgement about how to
// fix anything: it is the deterministic collection half of the nightly Sentry loop.
//
// WHY: every Sentry look on this platform has been the owner asking for one. That
// makes triage sporadic and makes an agent's account of "what Sentry says"
// unverifiable. This script fixes both: it produces a ranked queue file the owner
// can read without an agent, and it is the ONLY path the nightly job uses to talk
// to Sentry — so what the agent claims and what Sentry holds cannot drift.
//
// TWO DELIBERATE GUARDS, in code rather than in a prompt:
//
//   1. SENSITIVE CLASSIFICATION. Any issue whose title/culprit touches money,
//      permissions, safeguarding, consent, deletion, encryption or migrations is
//      marked `sensitive` and MUST NOT be auto-fixed — it goes to the owner with a
//      diagnosis. Widening this list is safe; narrowing it needs the owner.
//
//   2. RESOLVE MEANS "resolve in next release", never a bare resolve. Sentry then
//      closes the issue when the fix actually ships and REOPENS it by itself if
//      the error happens again. So "resolved" reflects reality rather than an
//      agent's belief. A bare resolve is not implemented on purpose.
//
// LEDGER: .github/sentry-triage-ledger.json is committed, so a decision ("this is
// third-party noise, not worth fixing") survives and is reviewable, and the same
// harmless issue is not re-investigated every night. Ledgered issues stay OUT of
// the queue until they recur in a newer release than the one they were judged in.
//
// USAGE
//   node scripts/sentry-triage.mjs                     # collect + write the queue/report
//   node scripts/sentry-triage.mjs --probe             # test Sentry access only
//   node scripts/sentry-triage.mjs --days 7 --limit 50 # narrow the sweep
//   node scripts/sentry-triage.mjs --quiet             # queue/report only, no stdout table
//   node scripts/sentry-triage.mjs ledger <id> --decision fixed --note "..." [--sha <sha>]
//   node scripts/sentry-triage.mjs resolve <id> --in-next-release
//   node scripts/sentry-triage.mjs note <id> --text "..."
//
// EXIT CODES (via process.exitCode — process.exit() during async teardown trips a
// libuv assertion on Windows and corrupts the code to 127)
//   0  ran; queue written (an empty queue is a success, not a failure)
//   1  the requested write (ledger/resolve/note) failed
//   2  could not reach or read Sentry — treat as "did not run", never as "all clear"

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(ROOT, '.secrets.local', 'sentry.env');
const LEDGER_FILE = path.join(ROOT, '.github', 'sentry-triage-ledger.json');
const OUT_DIR = path.join(ROOT, '.local-docs-archive', 'sentry');
const HEALTH_URL = 'https://api.project-nexus.ie/api/v2/health';

// Issues touching these MUST NOT be auto-fixed. Matched case-insensitively against
// the issue title, culprit and file path. Deliberately broad: a false "sensitive"
// costs a written report the owner reads anyway; a false "safe" costs real harm.
const SENSITIVE_PATTERNS = [
  'wallet', 'transaction', 'credit', 'payment', 'stripe', 'donation', 'refund', 'invoice',
  'safeguard', 'guardian', 'vetting', 'consent', 'gdpr', 'dsar', 'legal',
  'permission', 'authoriz', 'authoris', 'role', 'admintier', 'superadmin', 'super_admin',
  'password', 'token', 'encrypt', 'crypt', 'webauthn', 'passkey',
  'delete', 'destroy', 'purge', 'truncate', 'migrat', 'schema', 'deploy',
];

const args = process.argv.slice(2);
const sub = args[0] && !args[0].startsWith('--') ? args[0] : null;
const flag = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};
const has = (name) => args.includes(name);

const say = (m) => console.log(`[sentry] ${m}`);
const bad = (m) => console.error(`[sentry] ✗ ${m}`);

function tokenInstructions() {
  bad('The Sentry key in .secrets.local/sentry.env cannot read or update issues.');
  bad('One-time fix (~2 minutes):');
  bad('  1. Open https://hour-timebank-clg.sentry.io/settings/developer-settings/');
  bad('  2. Open the "Claude Code" internal integration and edit its scopes.');
  bad('  3. It needs: event:read, project:read, org:read and event:write (to resolve).');
  bad('  4. Put the token in .secrets.local/sentry.env as SENTRY_AUTH_TOKEN=<token>');
}

function loadEnv() {
  if (!existsSync(ENV_FILE)) return null;
  const env = {};
  for (const line of readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2].trim();
  }
  return env;
}

function loadLedger() {
  if (!existsSync(LEDGER_FILE)) {
    return { note: 'Decisions already taken on Sentry issues. See scripts/sentry-triage.mjs.', lastRunAt: null, issues: {} };
  }
  try {
    const l = JSON.parse(readFileSync(LEDGER_FILE, 'utf8'));
    l.issues ||= {};
    return l;
  } catch (e) {
    bad(`${LEDGER_FILE} is not valid JSON (${e.message}) — refusing to overwrite it.`);
    return null;
  }
}

const saveLedger = (l) => writeFileSync(LEDGER_FILE, `${JSON.stringify(l, null, 2)}\n`, 'utf8');

function classify(issue) {
  const haystack = [
    issue.title, issue.culprit, issue.metadata?.filename, issue.metadata?.type, issue.metadata?.value,
  ].filter(Boolean).join(' ').toLowerCase();
  const hits = SENSITIVE_PATTERNS.filter((p) => haystack.includes(p));
  return hits.length ? { risk: 'sensitive', why: hits } : { risk: 'candidate', why: [] };
}

// Rank by blast radius, not by volume alone: one member hitting a wall 400 times is
// less urgent than 40 members hitting it once, and a brand-new issue outranks one
// that has been quietly present for months.
function score(issue, isNew) {
  const users = Number(issue.userCount || 0);
  const events = Number(issue.count || 0);
  const ageDays = issue.lastSeen ? (Date.now() - Date.parse(issue.lastSeen)) / 86_400_000 : 99;
  return Math.round(
    users * 10 + Math.log10(events + 1) * 20 + (isNew ? 40 : 0) + Math.max(0, 14 - ageDays) * 2,
  );
}

async function main() {
  const env = loadEnv();
  if (!env) { bad(`${ENV_FILE} not found — cannot reach Sentry. Did not run.`); return 2; }

  // Issue listing and issue UPDATES need the internal-integration token (issue
  // admin). The monitor token is read-only and is only a fallback for the sweep.
  const TOKEN = env.SENTRY_AUTH_TOKEN || env.SENTRY_AUTH_TOKEN_MONITOR;
  const ORG = env.SENTRY_ORG;
  const BASE = (env.SENTRY_API_BASE || '').replace(/\/$/, '');
  const PROJECTS = {
    php: env.SENTRY_PROJECT_PHP,
    react: env.SENTRY_PROJECT_REACT,
    webuk: env.SENTRY_PROJECT_WEBUK,
    // 🔴 The mobile app had no project here, which mattered twice over: its own Sentry
    // is disabled in all six build profiles, AND this automation had no slot for it — so
    // even supplying a DSN would not have got mobile crashes into the nightly triage.
    // Optional like react/webuk: absent means "not configured yet", not an error.
    //
    // Until a mobile project exists, mobile crashes still reach the owner by the other
    // route: the app posts them to POST /api/app/log, which logs at `error` level, which
    // the `sentry` log channel captures into the PHP project. So they appear in this
    // sweep under `php` rather than being lost.
    mobile: env.SENTRY_PROJECT_MOBILE,
  };
  if (!TOKEN || !ORG || !BASE || !PROJECTS.php) {
    bad('sentry.env is missing SENTRY_AUTH_TOKEN, SENTRY_ORG, SENTRY_API_BASE or SENTRY_PROJECT_PHP.');
    return 2;
  }
  const projectName = Object.fromEntries(Object.entries(PROJECTS).filter(([, v]) => v).map(([k, v]) => [String(v), k]));

  async function api(pathname, init = {}) {
    const res = await fetch(`${BASE}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
    });
    if (res.status === 401 || res.status === 403) throw Object.assign(new Error('permission'), { scope: true });
    if (!res.ok) throw new Error(`Sentry API ${res.status} on ${pathname}`);
    return res.status === 204 ? null : res.json();
  }

  // --- write subcommands ------------------------------------------------------
  // These exist so the nightly job never hand-rolls a Sentry write. One tested
  // path, one place to audit.

  if (sub === 'resolve') {
    const id = args[1];
    if (!id || !has('--in-next-release')) {
      bad('usage: resolve <issueId> --in-next-release');
      bad('A bare resolve is deliberately not available — see the header of this file.');
      return 1;
    }
    try {
      await api(`/organizations/${ORG}/issues/${id}/`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'resolvedInNextRelease' }),
      });
      say(`✓ issue ${id} set to resolve in next release — it will close on the next deploy, and reopen by itself if the error returns.`);
      return 0;
    } catch (e) {
      if (e.scope) tokenInstructions(); else bad(`could not update issue ${id}: ${e.message}`);
      return 1;
    }
  }

  if (sub === 'note') {
    const id = args[1];
    const text = flag('--text');
    if (!id || !text) { bad('usage: note <issueId> --text "..."'); return 1; }
    try {
      await api(`/organizations/${ORG}/issues/${id}/comments/`, {
        method: 'POST',
        body: JSON.stringify({ text }),
      });
      say(`✓ comment added to issue ${id}`);
      return 0;
    } catch (e) {
      if (e.scope) tokenInstructions(); else bad(`could not comment on issue ${id}: ${e.message}`);
      return 1;
    }
  }

  if (sub === 'ledger') {
    const id = args[1];
    const decision = flag('--decision');
    const note = flag('--note');
    const allowed = ['fixed', 'wont-fix', 'needs-owner', 'watching'];
    if (!id || !allowed.includes(decision) || !note) {
      bad(`usage: ledger <issueId> --decision <${allowed.join('|')}> --note "why" [--sha <sha>]`);
      return 1;
    }
    const ledger = loadLedger();
    if (!ledger) return 1;
    let seenIn = null;
    try {
      const issue = await api(`/organizations/${ORG}/issues/${id}/`);
      seenIn = issue?.lastRelease?.version || null;
      ledger.issues[id] = {
        title: issue?.title || '(unknown)',
        culprit: issue?.culprit || null,
        decision,
        note,
        sha: flag('--sha'),
        decidedAt: new Date().toISOString(),
        decidedAtRelease: seenIn,
      };
    } catch (e) {
      // A ledger entry must be recordable even when Sentry is unreachable —
      // otherwise a decision gets lost, which is worse than a thin entry.
      if (e.scope) tokenInstructions(); else bad(`could not read issue ${id} for context: ${e.message}`);
      ledger.issues[id] = {
        title: '(Sentry unreachable when recorded)',
        decision,
        note,
        sha: flag('--sha'),
        decidedAt: new Date().toISOString(),
        decidedAtRelease: null,
      };
    }
    saveLedger(ledger);
    say(`✓ ledger updated: issue ${id} → ${decision}`);
    say('Commit .github/sentry-triage-ledger.json so the decision survives.');
    return 0;
  }

  if (sub && !['sweep'].includes(sub)) { bad(`unknown subcommand "${sub}"`); return 1; }

  // --- probe ------------------------------------------------------------------
  if (has('--probe')) {
    try {
      const issues = await api(`/organizations/${ORG}/issues/?query=is:unresolved&statsPeriod=24h&limit=1&project=${PROJECTS.php}`);
      say(`✓ token works — issue listing reachable (${issues.length ? 'issues present' : 'none in last 24h'}).`);
      return 0;
    } catch (e) {
      if (e.scope) tokenInstructions(); else bad(`Sentry unreachable: ${e.message}`);
      return 2;
    }
  }

  // --- sweep ------------------------------------------------------------------
  const DAYS = Number(flag('--days', '14'));
  const LIMIT = Number(flag('--limit', '100'));
  const QUIET = has('--quiet');

  const ledger = loadLedger();
  if (!ledger) return 2;
  const previousRunAt = ledger.lastRunAt;

  let liveRelease = null;
  try {
    const res = await fetch(HEALTH_URL);
    liveRelease = res.headers.get('x-build');
  } catch { /* not fatal — only used to spot "new in the live release" */ }

  const ids = Object.values(PROJECTS).filter(Boolean);
  let raw = [];
  try {
    for (const pid of ids) {
      const p = new URLSearchParams({
        query: 'is:unresolved',
        statsPeriod: `${DAYS}d`,
        limit: String(LIMIT),
        sort: 'freq',
        project: pid,
      });
      const batch = await api(`/organizations/${ORG}/issues/?${p}`);
      raw.push(...(Array.isArray(batch) ? batch : []));
    }
  } catch (e) {
    if (e.scope) tokenInstructions(); else bad(`Sentry unreachable: ${e.message}`);
    bad('The sweep did not run. This is NOT "no issues found".');
    return 2;
  }

  const items = raw.map((issue) => {
    const { risk, why } = classify(issue);
    const seen = ledger.issues[issue.id];
    const lastRelease = issue.lastRelease?.version || null;
    // When does a judged issue come back into the queue?
    //   wont-fix  → never. It is known, accepted noise (e.g. the owner's own admin
    //               tests). Only a human deleting the ledger entry revives it.
    //   otherwise → as soon as it is seen AGAIN after the decision was recorded.
    //               For `fixed` that is the honest check that the fix worked: if the
    //               error still happens, the queue says so instead of trusting us.
    // Deliberately keyed on lastSeen vs decidedAt, NOT on release tags — an issue
    // with no release attached would otherwise be parked for ever by accident.
    const recurredSinceDecision = Boolean(
      seen
      && seen.decision !== 'wont-fix'
      && issue.lastSeen && seen.decidedAt
      && Date.parse(issue.lastSeen) > Date.parse(seen.decidedAt),
    );
    const isNew = Boolean(previousRunAt && issue.firstSeen && Date.parse(issue.firstSeen) > Date.parse(previousRunAt));
    return {
      id: issue.id,
      shortId: issue.shortId,
      project: projectName[String(issue.project?.id)] || issue.project?.slug || 'unknown',
      title: issue.title,
      culprit: issue.culprit,
      level: issue.level,
      events: Number(issue.count || 0),
      users: Number(issue.userCount || 0),
      firstSeen: issue.firstSeen,
      lastSeen: issue.lastSeen,
      firstRelease: issue.firstRelease?.version || null,
      lastRelease,
      inLiveRelease: Boolean(liveRelease && lastRelease && lastRelease.includes(liveRelease)),
      permalink: issue.permalink,
      risk,
      sensitiveBecause: why,
      isNew,
      ledger: seen ? { decision: seen.decision, note: seen.note, decidedAt: seen.decidedAt } : null,
      recurredSinceDecision,
      score: score(issue, isNew),
    };
  });

  const queue = items
    .filter((i) => !i.ledger || i.recurredSinceDecision)
    .sort((a, b) => b.score - a.score);
  const parked = items.filter((i) => i.ledger && !i.recurredSinceDecision);

  const now = new Date();
  const stamp = now.toISOString().slice(0, 10);
  mkdirSync(OUT_DIR, { recursive: true });

  const payload = {
    generatedAt: now.toISOString(),
    previousRunAt,
    liveRelease,
    window: `${DAYS}d`,
    counts: {
      unresolved: items.length,
      queued: queue.length,
      parkedByLedger: parked.length,
      newSinceLastRun: queue.filter((i) => i.isNew).length,
      sensitive: queue.filter((i) => i.risk === 'sensitive').length,
      recurred: queue.filter((i) => i.recurredSinceDecision).length,
    },
    queue,
    parked: parked.map(({ id, shortId, title, ledger: l }) => ({ id, shortId, title, ...l })),
  };
  writeFileSync(path.join(OUT_DIR, 'queue.json'), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  // Plain-English report — written so it stands alone without an agent's summary.
  const lines = [];
  lines.push(`# Sentry triage — ${stamp}`, '');
  lines.push(`Looked at the last ${DAYS} days. Live version: ${liveRelease || 'could not read'}.`);
  lines.push(previousRunAt ? `Previous run: ${previousRunAt}.` : 'First run — nothing to compare against yet.', '');
  lines.push(`- ${payload.counts.unresolved} unresolved issue(s) in Sentry`);
  lines.push(`- ${payload.counts.queued} need a look (${payload.counts.newSinceLastRun} brand new, ${payload.counts.recurred} came back after being judged before)`);
  lines.push(`- ${payload.counts.sensitive} of those touch money, permissions, safeguarding or data deletion — these must NOT be fixed automatically`);
  lines.push(`- ${payload.counts.parkedByLedger} already judged previously and unchanged, so left alone`, '');
  if (!queue.length) {
    lines.push('Nothing needs attention.', '');
  } else {
    lines.push('## Ranked', '');
    for (const [n, i] of queue.entries()) {
      lines.push(`### ${n + 1}. ${i.shortId} — ${i.title}`);
      lines.push(`- where: ${i.project}${i.culprit ? ` — \`${i.culprit}\`` : ''}`);
      lines.push(`- hit ${i.users} member(s), ${i.events} time(s); last seen ${i.lastSeen}`);
      lines.push(`- first appeared in release: ${i.firstRelease || 'unknown'}${i.inLiveRelease ? ' (still happening in the live version)' : ''}`);
      lines.push(`- classification: **${i.risk}**${i.sensitiveBecause.length ? ` (matched: ${i.sensitiveBecause.join(', ')})` : ''}`);
      if (i.recurredSinceDecision) lines.push(`- ⚠️ came back after being marked "${i.ledger.decision}" on ${i.ledger.decidedAt}`);
      lines.push(`- ${i.permalink}`, '');
    }
  }
  const reportPath = path.join(OUT_DIR, `triage-${stamp}.md`);
  writeFileSync(reportPath, `${lines.join('\n')}\n`, 'utf8');

  ledger.lastRunAt = now.toISOString();
  saveLedger(ledger);

  if (!QUIET) {
    say(`${payload.counts.unresolved} unresolved, ${payload.counts.queued} queued (${payload.counts.sensitive} sensitive, ${payload.counts.newSinceLastRun} new).`);
    for (const i of queue.slice(0, 10)) {
      say(`  ${String(i.score).padStart(4)}  ${i.risk === 'sensitive' ? '[SENSITIVE]' : '[candidate]'} ${i.shortId} ${i.title.slice(0, 90)}`);
    }
  }
  say(`queue  → ${path.relative(ROOT, path.join(OUT_DIR, 'queue.json'))}`);
  say(`report → ${path.relative(ROOT, reportPath)}`);
  return 0;
}

main().then(
  (code) => { process.exitCode = code; },
  (e) => { bad(`internal error: ${e.message}`); process.exitCode = 2; },
);
