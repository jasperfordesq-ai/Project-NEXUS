// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  BROWSER_ONLY_COMPONENTS,
  buildAssociation,
  run,
  validateAssociation,
} = require('./generate-apple-app-site-association');

describe('Apple App Site Association generator', () => {
  it('builds the exact Team ID and bundle identifier appID', () => {
    const association = buildAssociation('a1b2c3d4e5');

    expect(association.applinks.details[0].appIDs).toEqual([
      'A1B2C3D4E5.ie.project.nexus',
    ]);
  });

  it('keeps browser-owned and staff-only paths out of the native app', () => {
    const association = buildAssociation('A1B2C3D4E5');
    const components = association.applinks.details[0].components;

    for (const pathname of BROWSER_ONLY_COMPONENTS) {
      expect(components).toContainEqual(expect.objectContaining({
        '/': pathname,
        exclude: true,
      }));
    }
    expect(components.at(-1)).toEqual(expect.objectContaining({ '/': '/*' }));
  });

  it('refuses placeholders and malformed Team IDs', () => {
    expect(() => buildAssociation('APPLE_TEAM_ID')).toThrow(/exactly 10/);
    expect(() => buildAssociation('123')).toThrow(/exactly 10/);
  });

  it('writes and checks the extensionless JSON file', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-aasa-'));
    const output = path.join(tempDir, 'apple-app-site-association');

    try {
      run(['--team-id', 'A1B2C3D4E5', '--output', output], {});
      expect(path.extname(output)).toBe('');
      expect(validateAssociation(JSON.parse(fs.readFileSync(output, 'utf8')))).toEqual({
        teamId: 'A1B2C3D4E5',
        appID: 'A1B2C3D4E5.ie.project.nexus',
      });
      expect(run(['--check', '--team-id', 'A1B2C3D4E5', '--output', output], {})).toEqual({
        teamId: 'A1B2C3D4E5',
        appID: 'A1B2C3D4E5.ie.project.nexus',
      });
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
