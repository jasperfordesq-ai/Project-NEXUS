// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const path = require('path');
const { nativeSurface, nativeSurfaceDifferences } = require('./native-surface-lib.cjs');

const build9 = {
  pkg: {
    dependencies: {
      expo: '~54.0.37',
      'expo-av': '~16.0.8',
      'expo-updates': '~29.0.20',
      react: '^19.1.0',
      'react-native': '^0.81.5',
      lodash: '^4.17.21',
    },
  },
  app: {
    expo: {
      version: '1.4.0',
      newArchEnabled: true,
      plugins: ['expo-router', 'expo-secure-store', './plugins/with-android-network-security'],
      runtimeVersion: { policy: 'appVersion' },
      updates: { url: 'https://u.expo.dev/x', requestHeaders: { 'expo-channel-name': 'production' } },
    },
  },
};

const clone = (value) => JSON.parse(JSON.stringify(value));

describe('native surface comparison', () => {
  it('sees no difference between a build and itself', () => {
    const live = nativeSurface(build9.pkg, build9.app);
    expect(nativeSurfaceDifferences(live, nativeSurface(build9.pkg, build9.app))).toEqual([]);
  });

  it('ignores a pure-JavaScript dependency version bump', () => {
    const candidate = clone(build9);
    candidate.pkg.dependencies.lodash = '^4.17.22';
    expect(nativeSurfaceDifferences(nativeSurface(build9.pkg, build9.app), nativeSurface(candidate.pkg, candidate.app))).toEqual([]);
  });

  it('refuses the 2026-09-12 case: SDK upgrade plus new native modules under the same app version', () => {
    const candidate = clone(build9);
    delete candidate.pkg.dependencies['expo-av'];
    Object.assign(candidate.pkg.dependencies, {
      expo: '55.0.31',
      'expo-audio': '~55.0.18',
      'expo-video': '~55.0.21',
      'expo-updates': '~55.0.30',
      react: '19.2.0',
      'react-native': '0.83.10',
    });
    delete candidate.app.expo.newArchEnabled;
    candidate.app.expo.plugins.push(['expo-audio', { microphonePermission: 'x' }], './plugins/with-android-font-scale');

    const differences = nativeSurfaceDifferences(nativeSurface(build9.pkg, build9.app), nativeSurface(candidate.pkg, candidate.app));

    expect(differences).toEqual(expect.arrayContaining([
      'dependency added: expo-audio',
      'dependency added: expo-video',
      'dependency removed: expo-av',
      'native package version changed: expo ~54.0.37 -> 55.0.31',
      'native package version changed: react-native ^0.81.5 -> 0.83.10',
      'app.json plugins changed',
      'app.json newArchEnabled changed',
    ]));
  });

  it('treats any new dependency as native until proven otherwise', () => {
    const candidate = clone(build9);
    candidate.pkg.dependencies['some-new-thing'] = '1.0.0';
    expect(nativeSurfaceDifferences(nativeSurface(build9.pkg, build9.app), nativeSurface(candidate.pkg, candidate.app)))
      .toEqual(['dependency added: some-new-thing']);
  });

  it('notices a permission or update-channel change that prebuild bakes into the binary', () => {
    const candidate = clone(build9);
    candidate.app.expo.android = { permissions: ['android.permission.RECORD_AUDIO'] };
    candidate.app.expo.updates.requestHeaders['expo-channel-name'] = 'staging';
    const differences = nativeSurfaceDifferences(nativeSurface(build9.pkg, build9.app), nativeSurface(candidate.pkg, candidate.app));
    expect(differences).toEqual(['app.json androidPermissions changed', 'app.json updatesChannel changed']);
  });
});

describe('live store build record', () => {
  const record = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'live-store-build.json'), 'utf8'));

  it('names the commit, version code and runtime version of the build members have installed', () => {
    expect(record.android.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(Number.isInteger(record.android.versionCode)).toBe(true);
    expect(record.android.runtimeVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('is behind or equal to the version code the tree is about to build (Play refuses a repeat)', () => {
    const app = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8')).expo;
    expect(app.android.versionCode).toBeGreaterThanOrEqual(record.android.versionCode);
  });
});
