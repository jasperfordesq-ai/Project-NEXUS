// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Preloaded (`node --require`) into every Node process the Android Gradle build
 * starts — see plugins/with-android-node-clean-exit.js.
 *
 * 🔴 Why. On 2026-09-12, building the first Expo SDK 55 release bundle on Windows,
 * `:app:createReleaseUpdatesResources` failed with exit code -1073741819 (an access
 * violation) in two runs out of three. The script it runs
 * (`expo-updates/utils/build/createUpdatesResources.js`) had already written
 * `app.manifest` every time: Node 22 was crashing while tearing itself down after
 * the work was done. Run by hand outside Gradle it crashed just the same, so this
 * is not a Gradle problem, and `--jitless` made it worse (0/3), so it is not a JIT
 * problem either. Ending the process the moment the event loop is empty — before
 * the natural teardown — was clean in 5 runs out of 5.
 *
 * `beforeExit` fires only when the loop has drained and the process was about to
 * exit on its own, so nothing that is still running is cut short, and the exit
 * code a script set is preserved.
 *
 * 🔴 Scoped to the one script that crashes. The first version applied to every
 * Node process the build starts, and Expo's bundler (`export:embed`) has moments
 * when its event loop is empty while work is still pending — the preload ended
 * it early and `:app:createBundleReleaseJsAndAssets` failed with exit code 5.
 * Everything else the build runs shuts down cleanly on its own and is left alone.
 */
const script = String(process.argv[1] || '').split('\\').join('/');
if (script.endsWith('/expo-updates/utils/build/createUpdatesResources.js')) {
  process.on('beforeExit', () => {
    process.exit(process.exitCode ?? 0);
  });
}
