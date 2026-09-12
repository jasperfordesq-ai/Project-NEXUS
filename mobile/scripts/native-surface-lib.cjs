// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The "native surface" of a build: everything an over-the-air update CANNOT change.
 *
 * 🔴 Why this exists. On 2026-09-12 the fix for administrators locked out of the
 * store app (mandatory two-factor went live; the installed app had no code for the
 * new sign-in answer) was going to be an OTA of `main`. The store build (version
 * code 9) was on Expo SDK 54 / React Native 0.81 with expo-av. The commit that
 * added the two-factor client had ALSO moved the app to SDK 55 / React Native 0.83
 * and to the native modules expo-audio and expo-video — while `expo.version` stayed
 * 1.4.0. The runtime-version policy is `appVersion`, so the update service would
 * have served that JavaScript to a binary without those modules, and every
 * member's app would have failed to start. Nothing in the repository compared the
 * two; the runtime version alone does not prove compatibility.
 *
 * The publisher now records the commit the live store build was made from
 * (`live-store-build.json`) and refuses a public update when this surface differs
 * between that commit and the code being published. The only correct remedy for
 * a difference is a new store build, never an override.
 */

/** Packages whose version matters natively (native code, autolinking, or the RN/Expo SDK itself). */
const NATIVE_PACKAGE = /^(expo|expo-[a-z0-9-]+|@expo\/[a-z0-9-]+|react-native|react-native-[a-z0-9-]+|@react-native(?:-community)?\/[a-z0-9-]+|@sentry\/react-native|@stripe\/stripe-react-native|react|@shopify\/[a-z0-9-]+|heroui-native|nativewind)$/;

function sortedObject(source) {
  const out = {};
  for (const key of Object.keys(source ?? {}).sort()) out[key] = source[key];
  return out;
}

/**
 * Build a comparable description of the native surface from `package.json` and
 * `app.json` contents (parsed objects, not paths — pure, so it is testable).
 *
 * `dependencyNames` is every dependency: a new package is assumed native until proven
 * otherwise, because a missing native module is a crash on the first `require`.
 * `nativeVersions` is the version of each package the regex above marks as native.
 * The `app.json` fields are the ones prebuild bakes into the binary.
 */
function nativeSurface(pkg, app) {
  const expo = app?.expo ?? app ?? {};
  const deps = pkg?.dependencies ?? {};
  const nativeVersions = {};
  for (const name of Object.keys(deps).sort()) {
    if (NATIVE_PACKAGE.test(name)) nativeVersions[name] = deps[name];
  }
  return {
    dependencyNames: Object.keys(deps).sort(),
    nativeVersions,
    plugins: JSON.stringify(expo.plugins ?? []),
    newArchEnabled: expo.newArchEnabled ?? null,
    jsEngine: expo.jsEngine ?? null,
    sdkVersion: expo.sdkVersion ?? null,
    androidPermissions: JSON.stringify([...(expo.android?.permissions ?? [])].sort()),
    androidBlockedPermissions: JSON.stringify([...(expo.android?.blockedPermissions ?? [])].sort()),
    iosInfoPlist: JSON.stringify(sortedObject(expo.ios?.infoPlist ?? {})),
    runtimeVersionPolicy: JSON.stringify(expo.runtimeVersion ?? null),
    updatesUrl: expo.updates?.url ?? null,
    updatesChannel: expo.updates?.requestHeaders?.['expo-channel-name'] ?? null,
  };
}

/**
 * Human-readable differences between the live build's surface and a candidate's.
 * An empty array means an OTA built from the candidate can run on the live binary
 * as far as this check can tell.
 */
function nativeSurfaceDifferences(live, candidate) {
  const differences = [];
  const liveNames = new Set(live.dependencyNames);
  const candidateNames = new Set(candidate.dependencyNames);
  for (const name of candidate.dependencyNames) {
    if (!liveNames.has(name)) differences.push(`dependency added: ${name}`);
  }
  for (const name of live.dependencyNames) {
    if (!candidateNames.has(name)) differences.push(`dependency removed: ${name}`);
  }
  for (const [name, version] of Object.entries(candidate.nativeVersions)) {
    const liveVersion = live.nativeVersions[name];
    if (liveVersion !== undefined && liveVersion !== version) {
      differences.push(`native package version changed: ${name} ${liveVersion} -> ${version}`);
    }
  }
  for (const field of [
    'plugins',
    'newArchEnabled',
    'jsEngine',
    'sdkVersion',
    'androidPermissions',
    'androidBlockedPermissions',
    'iosInfoPlist',
    'runtimeVersionPolicy',
    'updatesUrl',
    'updatesChannel',
  ]) {
    if (live[field] !== candidate[field]) differences.push(`app.json ${field} changed`);
  }
  return differences;
}

module.exports = { nativeSurface, nativeSurfaceDifferences, NATIVE_PACKAGE };
