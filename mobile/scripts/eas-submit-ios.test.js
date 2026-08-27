// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const { assertEligibleProductionBuild, readArgument } = require('./eas-submit-ios');

const eligibleBuild = {
  id: '12345678-1234-4123-8123-123456789abc',
  platform: 'IOS',
  buildProfile: 'production',
  status: 'FINISHED',
  distribution: 'STORE',
  isForIosSimulator: false,
  appIdentifier: 'ie.project.nexus',
  appVersion: '1.2.0',
  appBuildVersion: '3',
};

describe('fail-closed TestFlight build selection', () => {
  it('accepts only the exact finished iOS store build for the checked app version', () => {
    expect(assertEligibleProductionBuild(eligibleBuild, '1.2.0')).toBe(eligibleBuild);
  });

  it.each([
    ['simulator', { isForIosSimulator: true }, 'Simulator'],
    ['preview profile', { buildProfile: 'preview' }, 'production profile'],
    ['internal distribution', { distribution: 'INTERNAL' }, 'store-distribution'],
    ['unfinished build', { status: 'IN_PROGRESS' }, 'not finished'],
    ['Android build', { platform: 'ANDROID' }, 'Only an iOS'],
    ['wrong bundle', { appIdentifier: 'com.example.wrong' }, 'ie.project.nexus'],
    ['wrong version', { appVersion: '1.1.0' }, 'match app.json'],
  ])('rejects a %s build', (_label, override, message) => {
    expect(() => assertEligibleProductionBuild({ ...eligibleBuild, ...override }, '1.2.0'))
      .toThrow(message);
  });

  it('reads an explicitly named build rather than relying on latest', () => {
    expect(readArgument(['--build-id', eligibleBuild.id], '--build-id')).toBe(eligibleBuild.id);
  });
});
