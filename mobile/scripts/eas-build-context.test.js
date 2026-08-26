// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { linkLocalNodeModules, materializeRuntimeVersion } = require('./eas-build-context');

describe('isolated EAS build context', () => {
  let tempRoot;

  afterEach(() => {
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
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
});
