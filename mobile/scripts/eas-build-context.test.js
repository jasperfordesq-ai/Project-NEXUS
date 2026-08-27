// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  assertProductionContextClean,
  createBuildContextFilter,
  linkLocalNodeModules,
  materializeReleaseIdentity,
  materializeRuntimeVersion,
} = require('./eas-build-context');

describe('isolated EAS build context', () => {
  let tempRoot;

  afterEach(() => {
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('refuses a production build when any mobile path is not committed', () => {
    expect(() => assertProductionContextClean('production', ' M mobile/app.json'))
      .toThrow('Production EAS builds require a clean committed mobile tree');
    expect(() => assertProductionContextClean('preview', ' M mobile/app.json')).not.toThrow();
    expect(() => assertProductionContextClean('production', '')).not.toThrow();
  });

  it('embeds the exact source commit into the temporary build config', () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-eas-release-id-'));
    fs.writeFileSync(path.join(tempRoot, 'app.json'), JSON.stringify({
      expo: { extra: { apiUrl: 'https://api.project-nexus.ie' } },
    }));

    const sha = '0123456789abcdef0123456789abcdef01234567';
    expect(materializeReleaseIdentity(tempRoot, sha)).toBe(sha);
    const written = JSON.parse(fs.readFileSync(path.join(tempRoot, 'app.json'), 'utf8'));
    expect(written.expo.extra).toEqual({
      apiUrl: 'https://api.project-nexus.ie',
      releaseCommit: sha,
    });
    expect(() => materializeReleaseIdentity(tempRoot, 'short')).toThrow('40-character');
  });

  it('resolves Expo config plugins through local dependencies without copying them', () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-eas-context-test-'));
    const appDir = path.join(tempRoot, 'source');
    const contextDir = path.join(tempRoot, 'context');
    const routerDir = path.join(appDir, 'node_modules', 'expo-router');
    fs.mkdirSync(routerDir, { recursive: true });
    fs.mkdirSync(contextDir, { recursive: true });
    fs.writeFileSync(path.join(routerDir, 'package.json'), JSON.stringify({ name: 'expo-router' }));

    const linkedPath = linkLocalNodeModules(appDir, contextDir);
    const resolved = require.resolve('expo-router/package.json', { paths: [contextDir] });

    expect(fs.lstatSync(linkedPath).isSymbolicLink()).toBe(true);
    expect(resolved).toBe(path.join(routerDir, 'package.json'));
  });

  it('fails with an actionable message when dependencies are not installed', () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-eas-context-test-'));
    const appDir = path.join(tempRoot, 'source');
    const contextDir = path.join(tempRoot, 'context');
    fs.mkdirSync(appDir);
    fs.mkdirSync(contextDir);

    expect(() => linkLocalNodeModules(appDir, contextDir)).toThrow('run npm ci');
  });

  it('materializes the app-version runtime policy for the native EAS context', () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-eas-context-test-'));
    fs.writeFileSync(
      path.join(tempRoot, 'app.json'),
      JSON.stringify({ expo: { version: '1.2.0', runtimeVersion: { policy: 'appVersion' } } }),
    );

    expect(materializeRuntimeVersion(tempRoot)).toBe('1.2.0');
    const written = JSON.parse(fs.readFileSync(path.join(tempRoot, 'app.json'), 'utf8'));
    expect(written.expo.runtimeVersion).toBe('1.2.0');
  });

  it('removes Android source and local build products from an iOS upload context', () => {
    const appDir = path.resolve('C:/example/mobile');
    const shouldCopy = createBuildContextFilter(appDir, 'ios');

    expect(shouldCopy(path.join(appDir, 'app', 'index.tsx'))).toBe(true);
    expect(shouldCopy(path.join(appDir, 'android', 'app', 'src', 'main', 'MainActivity.kt'))).toBe(false);
    expect(shouldCopy(path.join(appDir, 'android', 'app', '.cxx', 'object.o'))).toBe(false);
    expect(shouldCopy(path.join(appDir, 'screenshots', 'baseline', 'home.png'))).toBe(false);
    expect(shouldCopy(path.join(appDir, '.env.local'))).toBe(false);
  });

  it('keeps Android source but removes Android build products for Android uploads', () => {
    const appDir = path.resolve('C:/example/mobile');
    const shouldCopy = createBuildContextFilter(appDir, 'android');

    expect(shouldCopy(path.join(appDir, 'android', 'app', 'src', 'main', 'MainActivity.kt'))).toBe(true);
    expect(shouldCopy(path.join(appDir, 'android', 'app', '.cxx', 'object.o'))).toBe(false);
    expect(shouldCopy(path.join(appDir, 'android', 'app', 'build', 'outputs', 'app.aab'))).toBe(false);
  });
});
