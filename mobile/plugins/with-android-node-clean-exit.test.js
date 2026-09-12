// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const path = require('path');
const { injectNodeCleanExit } = require('./with-android-node-clean-exit');

// Built with explicit newlines so the assertions below do not depend on the
// line endings this file happens to be checked out with.
const generated = [
  'apply plugin: "com.android.application"',
  '',
  'react {',
  '    // nodeExecutableAndArgs = ["node"]',
  '    entryFile = file(["node", "-e", "require(\'expo/scripts/resolveAppEntry\')", projectRoot, "android", "absolute"].execute(null, rootDir).text.trim())',
  '    cliFile = new File(["node", "--print", "require.resolve(\'@expo/cli\')"].execute(null, rootDir).text.trim())',
  '    bundleCommand = "export:embed"',
  '}',
  '',
  'android {',
  '}',
  '',
].join('\n');

describe('with-android-node-clean-exit', () => {
  it('adds the preload to the react block with forward slashes, so Groovy reads a Windows path', () => {
    const out = injectNodeCleanExit(generated, 'C:\\tmp\\nexus\\mobile\\scripts\\node-clean-exit.cjs');
    expect(out).toContain('react {\n    nodeExecutableAndArgs = ["node", "--require", "C:/tmp/nexus/mobile/scripts/node-clean-exit.cjs"]');
    expect(out).toContain('bundleCommand = "export:embed"');
    // The template's commented example must not count as an existing setting.
    expect(out.match(/^\s*nodeExecutableAndArgs\s*=/gm)).toHaveLength(1);
    expect(out).toContain('// nodeExecutableAndArgs = ["node"]');
  });

  it('replaces an existing setting instead of adding a second one', () => {
    const once = injectNodeCleanExit(generated, '/a/scripts/node-clean-exit.cjs');
    const twice = injectNodeCleanExit(once, '/b/scripts/node-clean-exit.cjs');
    expect(twice.match(/^\s*nodeExecutableAndArgs\s*=/gm)).toHaveLength(1);
    expect(twice).toContain('"/b/scripts/node-clean-exit.cjs"');
  });

  it('refuses a build.gradle without a react block rather than silently doing nothing', () => {
    expect(() => injectNodeCleanExit('android {}', '/x.cjs')).toThrow(/no `react \{` block/);
  });

  it('is listed in app.json and its preload exists', () => {
    const app = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8')).expo;
    expect(app.plugins).toContain('./plugins/with-android-node-clean-exit');
    expect(fs.existsSync(path.join(__dirname, '..', 'scripts', 'node-clean-exit.cjs'))).toBe(true);
  });
});
