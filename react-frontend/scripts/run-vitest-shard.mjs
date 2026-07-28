// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Sharded full-suite vitest runner.
 *
 * WHY THIS EXISTS
 * ---------------
 * CI's blocking vitest steps cover roughly 150 of the project's ~1,281 test
 * files. The other ~88% can break with a green build, which is why breakage is
 * only ever found in large batches. This runner lets CI execute EVERY suite,
 * split across a job matrix so no single job exceeds its time budget.
 *
 * WHY NOT `vitest --shard`
 * ------------------------
 * vitest shards the include glob it resolves for itself. This runner needs to
 * subtract a quarantine list first (suites known to fail, recorded so the job
 * can be blocking today rather than after every one is fixed) and to shard the
 * REMAINDER deterministically. Doing the file selection here also keeps the
 * partition inspectable via --list.
 *
 * WHY IT SPAWNS WITHOUT A SHELL
 * -----------------------------
 * ~160 file paths per shard is ~9,000 characters of argv. cmd.exe truncates at
 * 8,191 and fails with "The syntax of the command is incorrect", so going
 * through npx/cmd is not an option on Windows. Spawning node with vitest's ESM
 * entry point directly (shell: false) uses the 32,767-char CreateProcess limit
 * and behaves identically on Linux runners.
 *
 * STABLE ASSIGNMENT
 * -----------------
 * Shard membership is a hash of the file path (mirroring
 * scripts/ci/phpunit-shard.php), not an index into a sorted list. Adding or
 * removing a suite therefore reshuffles only itself, so one new test file does
 * not move every other file to a different shard and invalidate the timings.
 *
 * FLOOR CHECKS (going blind fails)
 *   - fewer than MIN_EXPECTED_TEST_FILES suites discovered: a glob or a `git
 *     ls-files` that stopped matching would otherwise run nothing and pass
 *   - a quarantined path not present in the universe: a renamed or deleted test
 *     must be pruned from the baseline, or the list silently rots
 *   - totals.count disagreeing with the array length: hand-edit drift
 *
 * CLI
 *   node scripts/run-vitest-shard.mjs --shard 1/8      # run shard 1 of 8
 *   node scripts/run-vitest-shard.mjs --shard 1/8 --list
 *   node scripts/run-vitest-shard.mjs --list-all       # whole partition
 *   node scripts/run-vitest-shard.mjs --quarantined    # run the quarantine list
 *   node scripts/run-vitest-shard.mjs --shard 1/8 --extra-arg=--bail=1
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..');
const BASELINE_RELATIVE_PATH = 'src/test/failing-suites.baseline.json';

/** Matches vitest.config.ts `include`. */
const TEST_FILE_RE = /^src\/.*\.(test|spec)\.(js|ts|jsx|tsx)$/;

/** Floor guard — the suite is ~1,281 files; far fewer means discovery broke. */
export const MIN_EXPECTED_TEST_FILES = 1000;

export function baselinePath(root) {
  return path.join(root, BASELINE_RELATIVE_PATH);
}

/**
 * Every tracked test file, POSIX-relative to the frontend root. `git ls-files`
 * rather than a directory walk: deterministic, identical on Windows and Linux,
 * and it ignores untracked work-in-progress files.
 */
export function discoverSuites(root = DEFAULT_ROOT) {
  const stdout = execFileSync('git', ['ls-files', '--', 'src'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => TEST_FILE_RE.test(line))
    .sort();
}

export function loadQuarantine(root = DEFAULT_ROOT) {
  const file = baselinePath(root);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`Corrupt quarantine baseline at ${file}: ${error.message}`);
  }
}

/** Stable path hash → shard index in [0, shardCount). */
export function shardIndexFor(filePath, shardCount) {
  const digest = createHash('sha256').update(filePath).digest();
  // 32 bits is ample and avoids BigInt; shardCount is single digits.
  const value = digest.readUInt32BE(0);
  return value % shardCount;
}

/**
 * @returns {{ universe: string[], quarantined: string[], runnable: string[], floorFailures: string[] }}
 */
export function plan(root = DEFAULT_ROOT) {
  const universe = discoverSuites(root);
  const baseline = loadQuarantine(root);
  const quarantined = baseline?.quarantined ?? [];
  const floorFailures = [];

  if (universe.length < MIN_EXPECTED_TEST_FILES) {
    floorFailures.push(
      `Only ${universe.length} test files discovered (expected >= ${MIN_EXPECTED_TEST_FILES}). ` +
        `Suite discovery has broken — running this shard would prove nothing. ` +
        `Check TEST_FILE_RE against vitest.config.ts include, not MIN_EXPECTED_TEST_FILES.`,
    );
  }

  const universeSet = new Set(universe);
  const missing = quarantined.filter((file) => !universeSet.has(file));
  if (missing.length > 0) {
    floorFailures.push(
      `${missing.length} quarantined path(s) no longer exist — prune them from ` +
        `${BASELINE_RELATIVE_PATH}: ${missing.slice(0, 5).join(', ')}`,
    );
  }

  if (baseline && baseline.totals?.count !== quarantined.length) {
    floorFailures.push(
      `Quarantine baseline totals.count (${baseline.totals?.count}) disagrees with the list length ` +
        `(${quarantined.length}) — the file has been hand-edited.`,
    );
  }

  const quarantineSet = new Set(quarantined);
  const runnable = universe.filter((file) => !quarantineSet.has(file));

  return { universe, quarantined, runnable, floorFailures };
}

function runVitest(files, root, extraArgs) {
  if (files.length === 0) {
    console.log('run-vitest-shard: no files assigned to this shard — nothing to do.');
    return 0;
  }

  const vitestEntry = path.join(root, 'node_modules', 'vitest', 'vitest.mjs');
  if (!fs.existsSync(vitestEntry)) {
    console.error(`run-vitest-shard: cannot find vitest entry at ${vitestEntry}. Run npm ci first.`);
    return 2;
  }

  // Deliberately NOT --poolOptions.forks.singleFork=true. That flag belongs to
  // the 14-file smoke step, where it fixed an IPC channel hang. At ~150 files it
  // causes a different hang: one process runs every file, and jsdom/React Aria
  // state plus heap accumulate until the run stalls — src/test/setup.ts already
  // forces a GC and wipes document.body after each file to fight exactly this.
  // vitest.config.ts is tuned for the whole suite (pool forks, maxForks 2,
  // isolate true, fileParallelism false); isolate gives each file a clean
  // environment, which is what keeps a 150-file shard from accumulating. Let the
  // config decide rather than overriding it with a 14-file step's workaround.
  const args = [vitestEntry, 'run', ...files, ...extraArgs];

  // The package.json test scripts all raise the heap; the inline ci.yml vitest
  // calls did not and inherited 8192. Set it here so every path agrees.
  const nodeOptions = process.env.NODE_OPTIONS?.includes('max-old-space-size')
    ? process.env.NODE_OPTIONS
    : `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=20480`.trim();

  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    shell: false, // see header: cmd.exe truncates this argv at 8,191 chars
    env: { ...process.env, NODE_OPTIONS: nodeOptions },
  });

  if (result.error) {
    console.error(`run-vitest-shard: failed to spawn vitest — ${result.error.message}`);
    return 2;
  }
  return result.status ?? 1;
}

function parseShardFlag(argv) {
  const index = argv.indexOf('--shard');
  if (index < 0) return null;
  const raw = argv[index + 1];
  const match = /^(\d+)\/(\d+)$/.exec(raw ?? '');
  if (!match) throw new Error(`--shard expects the form i/N (got ${raw ?? '<nothing>'})`);
  const shard = Number(match[1]);
  const total = Number(match[2]);
  if (shard < 1 || shard > total) throw new Error(`--shard ${raw} is out of range`);
  return { shard, total };
}

function main() {
  const argv = process.argv.slice(2);
  const rootFlagIndex = argv.indexOf('--root');
  const root = rootFlagIndex >= 0 && argv[rootFlagIndex + 1] ? path.resolve(argv[rootFlagIndex + 1]) : DEFAULT_ROOT;
  const wantsList = argv.includes('--list');
  const wantsListAll = argv.includes('--list-all');
  const wantsQuarantined = argv.includes('--quarantined');
  const extraArgs = argv.filter((a) => a.startsWith('--extra-arg=')).map((a) => a.slice('--extra-arg='.length));

  let shardSpec;
  try {
    shardSpec = parseShardFlag(argv);
  } catch (error) {
    console.error(`run-vitest-shard: ${error.message}`);
    process.exit(2);
    return;
  }

  let planned;
  try {
    planned = plan(root);
  } catch (error) {
    console.error(`run-vitest-shard: ${error.message}`);
    process.exit(2);
    return;
  }

  const { universe, quarantined, runnable, floorFailures } = planned;

  if (floorFailures.length > 0) {
    console.error('run-vitest-shard: THIS GATE HAS GONE BLIND');
    for (const failure of floorFailures) console.error(`  - ${failure}`);
    process.exit(2);
    return;
  }

  if (!loadQuarantine(root)) {
    console.log(
      `run-vitest-shard: no ${BASELINE_RELATIVE_PATH} — treating the quarantine list as empty ` +
        `(expected only while bootstrapping the census).`,
    );
  }

  console.log(
    `run-vitest-shard: ${universe.length} suites discovered, ${quarantined.length} quarantined, ` +
      `${runnable.length} runnable.`,
  );

  if (wantsListAll) {
    const total = shardSpec?.total ?? 8;
    const buckets = Array.from({ length: total }, () => []);
    for (const file of runnable) buckets[shardIndexFor(file, total)].push(file);
    buckets.forEach((files, i) => console.log(`  shard ${i + 1}/${total}: ${files.length} files`));
    const sum = buckets.reduce((a, b) => a + b.length, 0);
    console.log(`  total assigned: ${sum} (must equal runnable ${runnable.length})`);
    process.exit(sum === runnable.length ? 0 : 1);
    return;
  }

  let files;
  let label;
  if (wantsQuarantined) {
    files = quarantined;
    label = `quarantine list (${files.length} suites)`;
  } else if (shardSpec) {
    files = runnable.filter((file) => shardIndexFor(file, shardSpec.total) === shardSpec.shard - 1);
    label = `shard ${shardSpec.shard}/${shardSpec.total} (${files.length} suites)`;
  } else {
    files = runnable;
    label = `all runnable suites (${files.length})`;
  }

  console.log(`run-vitest-shard: ${label}`);

  if (wantsList) {
    for (const file of files) console.log(`  ${file}`);
    process.exit(0);
    return;
  }

  process.exit(runVitest(files, root, extraArgs));
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) main();
