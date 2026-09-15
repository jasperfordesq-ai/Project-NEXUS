// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('node:fs');
const path = require('node:path');

const mobileRoot = path.resolve(__dirname, '..');
const workflow = fs.readFileSync(
  path.resolve(mobileRoot, '..', '.github', 'workflows', 'mobile-emulator.yml'),
  'utf8',
);
const packageJson = require('../package.json');

describe('native launch-smoke toolchain', () => {
  it('uses Expo SDK 55 minimum Xcode instead of the retired SDK 54 pin', () => {
    expect(packageJson.dependencies.expo).toMatch(/^55\./);
    expect(workflow).toContain('/Applications/Xcode_26.2.app');
    expect(workflow).not.toContain('[ "$MAJOR" -lt 26 ]');
    expect(workflow).not.toContain('no Xcode below 26');
  });
});
