// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * `node` for the Android Gradle build: runs the requested script in a child Node
 * with scripts/node-clean-exit.cjs preloaded, and — for the one script known to
 * crash while Node shuts down — retries when the child dies with an access
 * violation after doing its work.
 *
 * 🔴 Why a wrapper and not only the preload. `expo-updates/utils/build/
 * createUpdatesResources.js` crashes at teardown on Windows with Node 22.23
 * (exit 0xC0000005, which Gradle reports as -1073741819) in roughly two runs out
 * of three; `app.manifest` has been written every time. Exiting on `beforeExit`
 * cut the failure rate but did not remove it — the seventh 1.5.0 build crashed
 * with the preload in place. The work is idempotent, so a bounded retry is the
 * honest remedy; every other exit code, and every other script, passes straight
 * through, so nothing else is masked.
 *
 * Wired by plugins/with-android-node-clean-exit.js as
 *   react { nodeExecutableAndArgs = ["node", "<mobile>/scripts/node-retrying.cjs"] }
 * which both the React Native and the expo-updates Gradle plugins read.
 */
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ACCESS_VIOLATION_CODES = new Set([3221225477, -1073741819]);
const MAX_ATTEMPTS = 4;

function isUpdatesResourcesScript(scriptPath) {
  return String(scriptPath || '')
    .split('\\')
    .join('/')
    .endsWith('/expo-updates/utils/build/createUpdatesResources.js');
}

function run(argv, { execPath = process.execPath, spawn = spawnSync, log = console.error } = {}) {
  const preload = path.join(__dirname, 'node-clean-exit.cjs');
  const retryable = isUpdatesResourcesScript(argv[0]);
  let code = 1;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const result = spawn(execPath, ['--require', preload, ...argv], { stdio: 'inherit' });
    code = result.status === null || result.status === undefined ? 1 : result.status;
    if (!ACCESS_VIOLATION_CODES.has(code) || !retryable) return code;
    log(`node crashed while shutting down (0xC0000005) after createUpdatesResources.js; attempt ${attempt} of ${MAX_ATTEMPTS}`);
  }
  return code;
}

if (require.main === module) {
  process.exit(run(process.argv.slice(2)));
}

module.exports = { run, isUpdatesResourcesScript, ACCESS_VIOLATION_CODES, MAX_ATTEMPTS };
