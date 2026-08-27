// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'audit-touch-targets.mjs'), 'utf8');

describe('touch-target audit route isolation', () => {
  it('force-stops the app immediately before every deep-link probe', () => {
    expect(source).toMatch(/for \(const route of screens\)[\s\S]*?forceStopApp\(\);\s*openScreen\(route\);/);
  });

  it('fingerprint-gates the widened member-facing screen set', () => {
    for (const route of ['connections', 'activity', 'endorsements', 'reviews', 'skills']) {
      expect(source).toContain(`'${route}'`);
      expect(source).toMatch(new RegExp(`\\b${route.replace('-', "['-]")}\\s*:`));
    }
  });
});
