// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { linkLocalNodeModules, materializeRuntimeVersion } = require('./eas-build-context');

const appDir = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
let platform = 'android';
let profile = 'website';
let inspectArchive = false;
const passthrough = [];

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];

  if ((arg === '--platform' || arg === '-p') && args[index + 1]) {
    platform = args[index + 1];
    index += 1;
    continue;
  }

  if ((arg === '--profile' || arg === '-e') && args[index + 1]) {
    profile = args[index + 1];
    index += 1;
    continue;
  }

  if (arg === '--inspect-archive') {
    inspectArchive = true;
    continue;
  }

  passthrough.push(arg);
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-mobile-eas-'));
const contextDir = path.join(tempRoot, 'mobile');
const inspectOutputDir = path.join(tempRoot, 'archive-inspect');

const skipSegmentNames = new Set([
  'node_modules',
  '.expo',
  '.codex-logs',
  '.apk-audit',
  'audit-screenshots',
  'coverage',
  'dist',
  'web-build',
  '.gradle',
  '.idea',
  '.maestro',
  'Pods',
]);

const skipExactPaths = new Set([
  'android/build',
  'android/app/build',
  'ios/build',
]);

const skipFilePatterns = [
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

function shouldCopy(sourcePath) {
  const relativePath = toPosix(path.relative(appDir, sourcePath));

  if (!relativePath) {
    return true;
  }

  const segments = relativePath.split('/');
  if (segments.some((segment) => skipSegmentNames.has(segment))) {
    return false;
  }

  if (skipExactPaths.has(relativePath)) {
    return false;
  }

  const fileName = segments[segments.length - 1] ?? '';
  return !skipFilePatterns.some((pattern) => pattern.test(fileName));
}

function runEas() {
  const npx = 'npx';
  const easArgs = inspectArchive
    ? [
        'eas-cli@latest',
        'build:inspect',
        '-p',
        platform,
        '-e',
        profile,
        '-s',
        'archive',
        '-o',
        inspectOutputDir,
        '--force',
      ]
    : ['eas-cli@latest', 'build', '-p', platform, '--profile', profile, ...passthrough];

  console.log(`Prepared mobile-only EAS context: ${contextDir}`);

  if (inspectArchive) {
    console.log(`Inspect output: ${inspectOutputDir}`);
  }

  return spawnSync(npx, easArgs, {
    cwd: contextDir,
    env: {
      ...process.env,
      EAS_NO_VCS: '1',
    },
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
}

let result;

try {
  fs.cpSync(appDir, contextDir, {
    recursive: true,
    filter: shouldCopy,
  });
  // Expo evaluates config plugins locally before EAS creates the upload archive.
  // Keep dependencies available for that phase without copying them into the
  // isolated context; .easignore excludes this junction from the remote archive.
  linkLocalNodeModules(appDir, contextDir);
  // Runtime policies are a managed-workflow convenience. This app includes its
  // native Android project, so give EAS the equivalent explicit runtime in the
  // temporary context while keeping the source policy tied to the app version.
  materializeRuntimeVersion(contextDir);

  result = runEas();

  if (result.error) {
    console.error(`Failed to start EAS CLI: ${result.error.message}`);
  }
} finally {
  if (!process.env.NEXUS_KEEP_EAS_CONTEXT && !inspectArchive) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

process.exit(typeof result?.status === 'number' ? result.status : 1);
