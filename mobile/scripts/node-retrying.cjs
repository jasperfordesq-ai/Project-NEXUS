// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * `node` for the Android Gradle build: runs the requested script in a child Node
 * with scripts/node-clean-exit.cjs preloaded, and — for the steps known to crash
 * while Node shuts down — retries when the child dies with an access violation
 * after doing its work.
 *
 * 🔴 Why a wrapper and not only the preload. `expo-updates/utils/build/
 * createUpdatesResources.js` crashes at teardown on Windows with Node 22.23
 * (exit 0xC0000005, which Gradle reports as -1073741819) in roughly two runs out
 * of three; `app.manifest` has been written every time. Exiting on `beforeExit`
 * cut the failure rate but did not remove it — the seventh 1.5.0 build crashed
 * with the preload in place. The work is idempotent, so a bounded retry is the
 * honest remedy.
 *
 * 🔴 The Metro bundle step does it too (added 2026-09-12). Building version code
 * 11, `:app:createBundleReleaseJsAndAssets` died with the same 0xC0000005 —
 * AFTER logging "Done writing bundle output" and "Done writing sourcemap
 * output", with a complete 25 MB index.android.bundle on disk. So it is the same
 * teardown crash in a different Node invocation, and this file's first version
 * deliberately excluded it because it had not been seen there yet. `export:embed`
 * regenerates the bundle and sourcemap from scratch, so it is as idempotent as
 * the updates step.
 *
 * What is still NOT masked: every other exit code (a real Metro or manifest
 * error exits 1 and passes straight through on the first attempt), and every
 * other script. The Expo CLI entry point is only treated as retryable when the
 * command really is `export:embed` — the same binary runs other commands.
 *
 * Wired by plugins/with-android-node-clean-exit.js as
 *   react { nodeExecutableAndArgs = ["node", "<mobile>/scripts/node-retrying.cjs"] }
 * which both the React Native and the expo-updates Gradle plugins read.
 */
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ACCESS_VIOLATION_CODES = new Set([3221225477, -1073741819]);
const MAX_ATTEMPTS = 4;

function normalize(scriptPath) {
  return String(scriptPath || '').split('\\').join('/');
}

function isUpdatesResourcesScript(scriptPath) {
  return normalize(scriptPath).endsWith('/expo-updates/utils/build/createUpdatesResources.js');
}

function isMetroBundleInvocation(argv) {
  return (
    normalize(argv?.[0]).endsWith('/@expo/cli/build/bin/cli') &&
    (argv ?? []).slice(1).includes('export:embed')
  );
}

/** Which Gradle step this is, for the retry message — and null when it is neither. */
function retryableStep(argv) {
  if (isUpdatesResourcesScript(argv?.[0])) return 'createUpdatesResources.js';
  if (isMetroBundleInvocation(argv)) return 'the Metro bundle (export:embed)';
  return null;
}

function run(argv, { execPath = process.execPath, spawn = spawnSync, log = console.error } = {}) {
  const preload = path.join(__dirname, 'node-clean-exit.cjs');
  const step = retryableStep(argv);
  let code = 1;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = spawn(execPath, ['--require', preload, ...argv], { stdio: 'inherit' });
    code = result.status === null || result.status === undefined ? 1 : result.status;
    if (!ACCESS_VIOLATION_CODES.has(code) || !step) return code;
    log(`node crashed while shutting down (0xC0000005) after ${step}; attempt ${attempt} of ${MAX_ATTEMPTS}`);
  }
  return code;
}

if (require.main === module) {
  process.exit(run(process.argv.slice(2)));
}

module.exports = {
  run,
  isUpdatesResourcesScript,
  isMetroBundleInvocation,
  retryableStep,
  ACCESS_VIOLATION_CODES,
  MAX_ATTEMPTS,
};
