// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Gives the Gradle daemon enough memory to run R8.
 *
 * 🔴 Why this is needed. Expo's Android template writes
 *   org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m
 * into the generated android/gradle.properties. That was sufficient for as long
 * as release builds were unminified. The first minified build of this app
 * (version code 11, 2026-09-12) failed with
 *   ERROR: R8: java.lang.OutOfMemoryError: Java heap space
 * in `:app:minifyReleaseWithR8`, having already warned that the daemon would
 * expire after running out of metaspace. R8 holds the whole app plus every
 * dependency in memory to build its reference graph, so the template's budget is
 * simply too small for an app this size once minification is on.
 *
 * Set here rather than in scripts/build-aab-play.sh so it applies to every build
 * path — the script, a bare `./gradlew bundleRelease`, and EAS cloud builds —
 * and survives the prebuild that regenerates android/ on every release build.
 *
 * 4 GB is deliberately modest: it is comfortably enough for R8 here, and it
 * still fits the memory of a standard cloud build machine. The dev machine has
 * 96 GB, so do not read this number as a measured ceiling — it is the smallest
 * round value that worked. If a future dependency pushes R8 over it, the symptom
 * is the same OutOfMemoryError and the remedy is to raise it here.
 */

const HEAP = '4096m';
const METASPACE = '1024m';
const JVM_ARGS = `-Xmx${HEAP} -XX:MaxMetaspaceSize=${METASPACE}`;

/**
 * Pure transform, exported for the unit test. `gradleProperties` is the array of
 * property/comment records @expo/config-plugins hands to withGradleProperties.
 */
function setJvmArgs(gradleProperties, value = JVM_ARGS) {
  const existing = gradleProperties.find(
    (item) => item.type === 'property' && item.key === 'org.gradle.jvmargs'
  );
  if (existing) {
    existing.value = value;
    return gradleProperties;
  }
  return [...gradleProperties, { type: 'property', key: 'org.gradle.jvmargs', value }];
}

module.exports = function withAndroidGradleMemory(config) {
  // Required here, not at the top: the unit test imports the pure transform and
  // `@expo/config-plugins` drags in an ESM-only `uuid` that Jest cannot parse.
  const { withGradleProperties } = require('@expo/config-plugins');

  return withGradleProperties(config, (modConfig) => {
    modConfig.modResults = setJvmArgs(modConfig.modResults);
    return modConfig;
  });
};

module.exports.setJvmArgs = setJvmArgs;
module.exports.JVM_ARGS = JVM_ARGS;
