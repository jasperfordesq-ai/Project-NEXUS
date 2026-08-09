// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');

describe('template localization audit', () => {
  it('has no conservative localization matches in read-only mode', () => {
    const projectDirectory = path.join(__dirname, '..');
    const auditScript = path.join(projectDirectory, 'scripts', 'audit-template-localization.js');
    const result = spawnSync(process.execPath, [auditScript, '--summary'], {
      cwd: projectDirectory,
      encoding: 'utf8',
      timeout: 10_000,
      windowsHide: true
    });

    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');

    const report = JSON.parse(result.stdout);
    expect(report).toMatchObject({
      templatesWithConservativeMatches: 0,
      conservativeMatches: 0,
      uniqueTranslationKeys: 0,
      writeChanges: false,
      filesChanged: 0,
      topKeys: []
    });
    expect(report.templates).toBeGreaterThan(0);
  });
});
