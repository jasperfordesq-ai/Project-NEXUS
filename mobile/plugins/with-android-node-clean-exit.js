// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const path = require('path');

/**
 * Make every Node process the Android Gradle build starts load
 * scripts/node-clean-exit.cjs first. React Native's Gradle plugin exposes the
 * command as `react { nodeExecutableAndArgs = ["node"] }`, and expo-updates'
 * plugin reads the same property, so one setting covers autolinking, the Metro
 * bundle step and the updates-resources step. The reason is in the preload's
 * own header: Node 22 crashed on Windows while shutting down after
 * `createReleaseUpdatesResources` had finished its work, failing 2 in 3 release
 * builds on the day the first SDK 55 store build was needed.
 */
// `[ 	]*`, never `\s*`: `\s` would swallow the line break, and the injected line
// would then land inside a doubled newline instead of directly under `react {`.
const REACT_BLOCK = /^([ 	]*)react[ 	]*\{[ 	]*$/m;

function injectNodeCleanExit(gradleSource, preloadPath) {
  const forwardSlashes = preloadPath.replace(/\\/g, '/');
  const line = `nodeExecutableAndArgs = ["node", "${forwardSlashes}"]`;
  // Only an ACTIVE setting counts. The template Expo generates carries a commented
  // `// nodeExecutableAndArgs = ["node"]`; a plain `includes()` matched that on the
  // first build, replaced nothing, and the crash it was meant to stop happened again.
  const active = /^([ 	]*)nodeExecutableAndArgs[ 	]*=.*$/m;
  if (active.test(gradleSource)) {
    return gradleSource.replace(active, `$1${line}`);
  }
  const match = REACT_BLOCK.exec(gradleSource);
  if (!match) {
    throw new Error('with-android-node-clean-exit: no `react {` block in android/app/build.gradle');
  }
  const indent = `${match[1]}    `;
  return gradleSource.replace(REACT_BLOCK, `$&\n${indent}${line}`);
}

module.exports = function withAndroidNodeCleanExit(config) {
  // Required here, not at the top: the unit test imports the pure transform and
  // `@expo/config-plugins` drags in an ESM-only `uuid` that Jest cannot parse.
  const { withAppBuildGradle } = require('@expo/config-plugins');
  return withAppBuildGradle(config, (modConfig) => {
    // The wrapper preloads scripts/node-clean-exit.cjs itself and retries the one
    // script that still crashes at teardown even with the preload (see its header).
    const wrapper = path.join(modConfig.modRequest.projectRoot, 'scripts', 'node-retrying.cjs');
    modConfig.modResults.contents = injectNodeCleanExit(modConfig.modResults.contents, wrapper);
    return modConfig;
  });
};

module.exports.injectNodeCleanExit = injectNodeCleanExit;
