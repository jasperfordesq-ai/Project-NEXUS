// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.
//
// predeploy-ci-verify.mjs — decide whether a commit is fully checked, using
// result inheritance instead of demanding every job re-run on the exact SHA.
//
// A required check counts as passed for the deploy commit if EITHER:
//   (a) it ran and passed on the deploy commit itself, OR
//   (b) it ran and passed on an ANCESTOR commit, and none of the paths that
//       check watches (per .github/ci-paths.yml — the same file CI's own
//       paths-filter steps read) changed between that ancestor and the deploy
//       commit.
//
// This is CI's own skip logic applied transitively. It keeps the deploy
// guarantee literally true — everything that ships was checked on code
// identical, for that check's scope, to what ships — without forcing a
// ~40-minute full re-run when nothing relevant changed. The nightly scheduled
// run refreshes full evidence daily, so the walk is normally 1–2 commits deep.
//
// Correctness rules that must not be weakened:
//   - Walk ancestors NEWEST first; the first commit where a job actually ran
//     decides. A failure there is a refusal — never walk past a failure to
//     find an older green.
//   - "Skipped" is not evidence. Only a job that ran counts, either way.
//   - Jobs marked `always` run on every push, so they must have evidence on
//     the deploy commit itself (a cancelled run there fails closed).
//   - Unknown job names on the deploy commit's own runs are a refusal: it
//     means ci.yml gained a job this file does not know how to verify.
//
// Called by scripts/predeploy-ci-check.sh (the deploy entrypoint keeps the
// gh/auth/origin checks and the --wait/--trigger orchestration).
//
// Exit codes: 0 fully covered · 1 not covered (reasons printed) ·
//             2 could not determine (fail closed) · 3 a run for the deploy
//             commit is still in progress (line "IN_PROGRESS_RUN_ID=<id>").

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const mmMod = require('minimatch');
const minimatch = mmMod.minimatch || mmMod; // v9 exports an object, v5 a function

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PATHS_FILE = path.join(ROOT, '.github', 'ci-paths.yml');
const WORKFLOW = 'ci.yml';

// Walk bounds. The nightly full run means evidence is normally <24h old, so
// these are generous. Exhausting them without resolving every job is a
// refusal, not a pass.
const MAX_COMMITS = 100;
const MAX_RUN_LOOKUPS = 40;

// ---------------------------------------------------------------------------
// Required jobs (prefix-matched: matrix jobs expand to "PHP Tests (shard 3)"
// when they run but keep the raw template string when skipped) and which
// ci-paths.yml filter governs each. 'always' = runs on every push, so evidence
// must exist on the deploy commit itself.
//
// 🔴 ci.yml gains a job ⇒ add it here, or the verifier refuses to deploy
// (unknown-job rule) — deliberately loud rather than silently unverified.
// ---------------------------------------------------------------------------
const REQUIRED_JOBS = [
  { prefix: 'PHP Tests',                                    filters: ['php'] },
  { prefix: 'PHP Static Analysis',                          filters: ['php'] },
  { prefix: 'PHP Checks',                                   filters: ['php'] },
  { prefix: 'React Build & Tests',                          filters: ['frontend'] },
  { prefix: 'BLOCKING: API Contract Validation',            filters: ['frontend'] },
  { prefix: 'React Full Suite',                             filters: ['frontend'] },
  { prefix: 'E2E Smoke Tests',                              filters: ['frontend'] },
  { prefix: 'Accessibility Audit',                          filters: ['frontend'] },
  { prefix: 'Docker Build Verify',                          filters: ['php', 'frontend'] },
  { prefix: 'Android Native Release Gate',                  filters: ['mobile'] },
  { prefix: 'Accessible Frontend Release Gate',             filters: ['accessible'] },
  { prefix: 'Translation Drift Detection',                  filters: ['i18n'] },
  { prefix: 'Dockerfile Drift Detection',                   filters: 'always' },
  { prefix: 'Migration Safety Gate',                        filters: 'always' },
  { prefix: 'Documentation, Version, and Changelog Hygiene', filters: 'always' },
  { prefix: 'SPDX License Compliance',                      filters: 'always' },
  { prefix: 'Regression Pattern Detection',                 filters: 'always' },
  { prefix: 'Release Gate',                                 filters: 'always' },
];

// Plumbing jobs, not verification — any conclusion is fine.
const INFORMATIONAL_PREFIXES = ['Detect changed areas', 'i18n changed-files filter'];

// ---------------------------------------------------------------------------

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', cwd: ROOT, ...opts }).trim();
}

function gh(args) {
  return run('gh', args);
}

function say(msg) { console.log(`[ci-verify] ${msg}`); }
function bad(msg) { console.error(`[ci-verify] ✗ ${msg}`); }

function loadFilters() {
  const doc = yaml.load(readFileSync(PATHS_FILE, 'utf8'));
  if (!doc || typeof doc !== 'object') throw new Error(`${PATHS_FILE} did not parse to a map`);
  for (const job of REQUIRED_JOBS) {
    if (job.filters === 'always') continue;
    for (const f of job.filters) {
      if (!Array.isArray(doc[f])) throw new Error(`filter '${f}' missing from ${PATHS_FILE}`);
    }
  }
  return doc;
}

// dot:true is deliberate: dotfiles inside watched dirs count as watched.
// Being MORE willing to call evidence stale is the safe direction.
function fileMatchesAny(file, globs) {
  return globs.some((g) => minimatch(file, g, { dot: true }));
}

function jobFor(name) {
  if (INFORMATIONAL_PREFIXES.some((p) => name.startsWith(p))) return null;
  return REQUIRED_JOBS.find((j) => name.startsWith(j.prefix)) ?? undefined; // undefined = unknown
}

function main() {
  const shaArg = process.argv.indexOf('--sha');
  if (shaArg === -1 || !process.argv[shaArg + 1]) {
    bad('usage: node scripts/predeploy-ci-verify.mjs --sha <full-sha>');
    process.exit(2);
  }
  const deploySha = process.argv[shaArg + 1];
  const short = deploySha.slice(0, 9);
  const filters = loadFilters();

  // First-parent history, newest first, deploy commit included.
  const commits = run('git', ['rev-list', '--first-parent', `-n${MAX_COMMITS}`, deploySha]).split('\n');

  // unresolved: prefix -> job def. Resolved entries collect evidence rows.
  const unresolved = new Map(REQUIRED_JOBS.map((j) => [j.prefix, j]));
  const evidence = [];   // { prefix, sha, runId, inherited }
  const failures = [];   // { prefix, sha, runId, conclusion }
  const staleness = []; // { prefix, sha, changed }  — evidence found but invalidated
  const unknownOnDeploy = new Set();
  let runLookups = 0;

  const diffCache = new Map();
  const changedSince = (ancestor) => {
    if (!diffCache.has(ancestor)) {
      const out = run('git', ['diff', '--name-only', ancestor, deploySha]);
      diffCache.set(ancestor, out ? out.split('\n') : []);
    }
    return diffCache.get(ancestor);
  };

  for (const commit of commits) {
    if (unresolved.size === 0) break;
    if (runLookups >= MAX_RUN_LOOKUPS) break;

    let list;
    try {
      list = JSON.parse(gh(['run', 'list', '--workflow', WORKFLOW, '--commit', commit,
        '--limit', '10', '--json', 'databaseId,status,conclusion']));
    } catch (e) {
      bad(`could not list runs for ${commit.slice(0, 9)}: ${e.message}`);
      process.exit(2);
    }

    // An in-flight run on the DEPLOY commit itself may be about to provide
    // first-hand evidence — tell the wrapper so it can wait instead of
    // walking past it to older commits.
    if (commit === deploySha) {
      const inflight = list.find((r) => r.status !== 'completed');
      if (inflight) {
        say(`a run for ${short} is still in progress`);
        console.log(`IN_PROGRESS_RUN_ID=${inflight.databaseId}`);
        process.exit(3);
      }
    }

    // Per-commit verdicts across its completed runs, newest run first.
    // The NEWEST run in which a job actually ran decides for this commit
    // (a rerun updates the same run in place, so newest = latest attempt).
    // 'skipped' and 'cancelled' are NOT evidence either way: skipped means CI
    // chose not to run it, cancelled means it never finished — neither proves
    // nor disproves anything, so the walk continues to older evidence and the
    // path-staleness check still guards correctness. Anything else that is
    // not 'success' (failure, timed_out, …) is a hard verdict and refuses.
    const verdicts = new Map(); // prefix -> {conclusion, runId}
    for (const r of list.filter((r) => r.status === 'completed')) {
      if (runLookups >= MAX_RUN_LOOKUPS) break;
      runLookups += 1;
      let jobs;
      try {
        jobs = JSON.parse(gh(['run', 'view', String(r.databaseId), '--json', 'jobs']))
          .jobs.map((j) => ({ name: j.name, conclusion: j.conclusion }));
      } catch {
        continue; // unreadable run: not evidence, keep looking
      }
      for (const j of jobs) {
        const def = jobFor(j.name);
        if (def === null) continue;
        if (def === undefined) {
          if (commit === deploySha) unknownOnDeploy.add(j.name);
          continue;
        }
        if (j.conclusion === 'skipped' || j.conclusion === 'cancelled' || j.conclusion === null) continue;
        const prev = verdicts.get(def.prefix);
        const isSuccess = j.conclusion === 'success';
        // Matrix shards share one job prefix and one runId: ALL shards must
        // succeed, so within the deciding run a failed shard overrides a
        // passed one. Across runs, the newest run was recorded first and
        // stands — an older run never overrides a newer verdict.
        if (!prev) {
          verdicts.set(def.prefix, { conclusion: j.conclusion, runId: r.databaseId });
        } else if (prev.runId === r.databaseId && !isSuccess) {
          verdicts.set(def.prefix, { conclusion: j.conclusion, runId: r.databaseId });
        }
      }
    }

    // First commit where a job ran DECIDES for that job.
    for (const [prefix, v] of verdicts) {
      if (!unresolved.has(prefix)) continue;
      const def = unresolved.get(prefix);
      unresolved.delete(prefix);

      if (v.conclusion !== 'success') {
        failures.push({ prefix, sha: commit, runId: v.runId, conclusion: v.conclusion });
        continue;
      }
      if (commit === deploySha) {
        evidence.push({ prefix, sha: commit, runId: v.runId, inherited: false });
        continue;
      }
      if (def.filters === 'always') {
        // Runs on every push, yet its newest evidence is an older commit —
        // the deploy commit's own run never produced it. Fail closed.
        staleness.push({ prefix, sha: commit, changed: ['(must run on the deploy commit itself)'] });
        continue;
      }
      const globs = def.filters.flatMap((f) => filters[f]);
      const touched = changedSince(commit).filter((f) => fileMatchesAny(f, globs));
      if (touched.length === 0) {
        evidence.push({ prefix, sha: commit, runId: v.runId, inherited: true });
      } else {
        staleness.push({ prefix, sha: commit, changed: touched.slice(0, 5) });
      }
    }
  }

  // ---- report ------------------------------------------------------------
  let ok = true;

  if (unknownOnDeploy.size) {
    ok = false;
    bad('this commit\'s CI run contains jobs this verifier does not know:');
    for (const n of unknownOnDeploy) console.error(`        - ${n}`);
    bad('  ci.yml gained a job. Add it to REQUIRED_JOBS in scripts/predeploy-ci-verify.mjs.');
  }
  if (failures.length) {
    ok = false;
    bad('these checks FAILED on the most recent code they ran against:');
    for (const f of failures) console.error(`        - ${f.prefix} (${f.conclusion} on ${f.sha.slice(0, 9)}, run ${f.runId})`);
  }
  if (staleness.length) {
    ok = false;
    bad('these checks last passed on OLDER code — files they watch changed since:');
    for (const s of staleness) console.error(`        - ${s.prefix} (passed on ${s.sha.slice(0, 9)}; since changed: ${s.changed.join(', ')})`);
  }
  if (unresolved.size) {
    ok = false;
    bad(`no run of these checks was found in the last ${MAX_COMMITS} commits:`);
    for (const prefix of unresolved.keys()) console.error(`        - ${prefix}`);
  }

  if (!ok) {
    bad(`commit ${short} is NOT fully checked.`);
    process.exit(1);
  }

  say(`commit ${short} is fully checked. Evidence:`);
  const direct = evidence.filter((e) => !e.inherited).length;
  for (const e of evidence.sort((a, b) => a.prefix.localeCompare(b.prefix))) {
    say(`  ✓ ${e.prefix} — passed on ${e.sha.slice(0, 9)}${e.inherited ? ', and nothing it watches changed since' : ' (this commit)'}`);
  }
  say(`${direct} checked on this commit, ${evidence.length - direct} inherited from identical code.`);
  process.exit(0);
}

try {
  main();
} catch (e) {
  bad(`internal error: ${e.message}`);
  process.exit(2);
}
