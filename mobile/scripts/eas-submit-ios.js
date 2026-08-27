// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const IOS_BUNDLE_IDENTIFIER = 'ie.project.nexus';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readArgument(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function assertEligibleProductionBuild(build, expectedVersion) {
  if (!build || typeof build !== 'object') {
    throw new Error('EAS did not return a build record.');
  }
  if (!UUID_PATTERN.test(String(build.id ?? ''))) {
    throw new Error('The selected EAS build has no valid build ID.');
  }
  if (String(build.platform ?? '').toUpperCase() !== 'IOS') {
    throw new Error('Only an iOS build can be submitted to TestFlight.');
  }
  if (build.buildProfile !== 'production') {
    throw new Error('TestFlight requires a build created with the production profile.');
  }
  if (String(build.status ?? '').toUpperCase() !== 'FINISHED') {
    throw new Error('The selected iOS production build has not finished successfully.');
  }
  if (String(build.distribution ?? '').toUpperCase() !== 'STORE') {
    throw new Error('TestFlight requires a store-distribution build, not an internal build.');
  }
  if (build.isForIosSimulator === true) {
    throw new Error('An iOS Simulator build cannot be submitted to TestFlight.');
  }
  if (build.appIdentifier !== IOS_BUNDLE_IDENTIFIER) {
    throw new Error(`The selected build must use bundle identifier ${IOS_BUNDLE_IDENTIFIER}.`);
  }
  if (build.appVersion !== expectedVersion) {
    throw new Error(`The selected build version must match app.json (${expectedVersion}).`);
  }
  return build;
}

function runCommand(commandArgs, options = {}) {
  const result = spawnSync('npx', ['eas-cli@latest', ...commandArgs], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, EAS_NO_VCS: '1' },
    encoding: options.capture ? 'utf8' : undefined,
    stdio: options.capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`EAS CLI exited with status ${result.status ?? 'unknown'}.`);
  }
  return result.stdout;
}

function run(args = process.argv.slice(2)) {
  const buildId = readArgument(args, '--build-id');
  if (!UUID_PATTERN.test(String(buildId ?? ''))) {
    throw new Error('Pass the exact signed production build UUID with --build-id.');
  }

  const app = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../app.json'), 'utf8')).expo;
  const raw = runCommand(['build:view', buildId, '--json'], { capture: true });
  const build = assertEligibleProductionBuild(JSON.parse(raw), app.version);

  console.log(
    `Validated iOS production build ${build.id}: ${build.appIdentifier} `
    + `${build.appVersion} (${build.appBuildVersion ?? 'unknown build number'}).`,
  );

  if (!args.includes('--confirm-testflight')) {
    throw new Error(
      'Validation passed, but no upload was started. Add --confirm-testflight only after '
      + 'the owner explicitly approves uploading this exact build to TestFlight.',
    );
  }

  runCommand([
    'submit',
    '-p',
    'ios',
    '--profile',
    'production',
    '--id',
    build.id,
    '--non-interactive',
    '--wait',
  ]);
}

if (require.main === module) {
  try {
    run();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = { IOS_BUNDLE_IDENTIFIER, UUID_PATTERN, assertEligibleProductionBuild, readArgument };
