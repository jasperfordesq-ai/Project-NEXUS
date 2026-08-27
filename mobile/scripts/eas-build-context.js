// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const path = require('path');

const SKIPPED_SEGMENTS = new Set([
  'node_modules',
  '.expo',
  '.codex-logs',
  '.apk-audit',
  'audit-screenshots',
  'screenshots',
  'coverage',
  'dist',
  'web-build',
  '.gradle',
  '.idea',
  '.maestro',
  '.cxx',
  'Pods',
]);

const SKIPPED_EXACT_PATHS = new Set([
  'android/build',
  'android/app/build',
  'ios/build',
]);

const SKIPPED_FILE_PATTERNS = [
  /^\.env$/,
  /^\.env\.local$/,
  /^\.env\..*\.local$/,
  /^\.expo-.*\.log$/,
  /^expo-web-.*\.log$/,
  /^npm-debug\.log.*$/,
  /^yarn-debug\.log.*$/,
  /^yarn-error\.log.*$/,
  /^google-services\.json$/,
  /^GoogleService-Info\.plist$/,
  /^google-play-key\.json$/,
  /^fcm-service-account.*\.json$/,
  /^firebase-service-account.*\.json$/,
  /^.*-service-account.*\.json$/,
  /^.*\.apk$/,
  /^.*\.aab$/,
  /^.*\.keystore$/,
  /^.*\.jks$/,
];

function toPosix(relativePath) {
  return relativePath.split(path.sep).join('/');
}

function createBuildContextFilter(appDir, platform) {
  return (sourcePath) => {
    const relativePath = toPosix(path.relative(appDir, sourcePath));
    if (!relativePath) return true;

    const segments = relativePath.split('/');
    if (platform === 'ios' && segments[0] === 'android') return false;
    if (SKIPPED_SEGMENTS.size > 0 && segments.some((segment) => SKIPPED_SEGMENTS.has(segment))) {
      return false;
    }
    if (SKIPPED_EXACT_PATHS.has(relativePath)) return false;

    const fileName = segments.at(-1) ?? '';
    return !SKIPPED_FILE_PATTERNS.some((pattern) => pattern.test(fileName));
  };
}

function linkLocalNodeModules(appDir, contextDir) {
  const source = path.join(appDir, 'node_modules');
  const destination = path.join(contextDir, 'node_modules');

  if (!fs.existsSync(source)) {
    throw new Error('mobile/node_modules is missing; run npm ci before starting an EAS build.');
  }

  fs.symlinkSync(source, destination, process.platform === 'win32' ? 'junction' : 'dir');
  return destination;
}

function materializeRuntimeVersion(contextDir) {
  const appJsonPath = path.join(contextDir, 'app.json');
  const config = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  const runtimeVersion = config.expo?.runtimeVersion;

  if (runtimeVersion?.policy === 'appVersion') {
    if (!config.expo.version) {
      throw new Error('Cannot materialize the appVersion runtime policy without expo.version.');
    }
    config.expo.runtimeVersion = config.expo.version;
    fs.writeFileSync(appJsonPath, `${JSON.stringify(config, null, 2)}\n`);
  }

  return config.expo?.runtimeVersion;
}

function assertProductionContextClean(profile, statusOutput) {
  if (profile !== 'production') return;

  const dirtyPaths = String(statusOutput ?? '').trim();
  if (dirtyPaths !== '') {
    throw new Error(
      `Production EAS builds require a clean committed mobile tree. Commit or resolve:\n${dirtyPaths}`,
    );
  }
}

function materializeReleaseIdentity(contextDir, sourceCommit) {
  if (!/^[0-9a-f]{40}$/i.test(sourceCommit ?? '')) {
    throw new Error('Cannot build without a full 40-character Git source commit.');
  }

  const appJsonPath = path.join(contextDir, 'app.json');
  const config = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  config.expo.extra = {
    ...(config.expo.extra ?? {}),
    releaseCommit: sourceCommit.toLowerCase(),
  };
  fs.writeFileSync(appJsonPath, `${JSON.stringify(config, null, 2)}\n`);

  return config.expo.extra.releaseCommit;
}

module.exports = {
  assertProductionContextClean,
  createBuildContextFilter,
  linkLocalNodeModules,
  materializeReleaseIdentity,
  materializeRuntimeVersion,
};
