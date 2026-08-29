// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const MOBILE_ROOT = path.resolve(__dirname, '..');

describe('native store audience policy', () => {
  it('passes the fail-closed audience policy checker', () => {
    const result = spawnSync(process.execPath, ['scripts/check-store-audience-policy.mjs'], {
      cwd: MOBILE_ROOT,
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('adults-only native boundary: OK');
  });

  it('keeps guardian consent and Care in Community outside both native apps', () => {
    const parity = JSON.parse(fs.readFileSync(path.join(MOBILE_ROOT, 'parity-map.json'), 'utf8'));
    expect(parity.routes['events/:id/guardian-consent']).toMatchObject({ status: 'out-of-scope' });

    const careRoutes = Object.entries(parity.routes)
      .filter(([route]) => route.startsWith('caring-community/'));
    expect(careRoutes.length).toBeGreaterThan(0);
    expect(careRoutes.every(([, decision]) => decision.status === 'out-of-scope')).toBe(true);
    expect(parity.routes['wallet/regional-points']).toMatchObject({ status: 'out-of-scope' });
    expect(parity.routes['wallet/regional-points'].reason).toContain('Care in Community');
    for (const route of ['me/verein-dues', 'me/verein-invitations', 'join/:code']) {
      expect(parity.routes[route]).toMatchObject({ status: 'out-of-scope' });
      expect(parity.routes[route].reason).toContain('Care in Community');
    }
  });

  it('records the current official Google and Apple requirements', () => {
    const policy = fs.readFileSync(path.join(MOBILE_ROOT, 'docs/STORE_AUDIENCE_POLICY.md'), 'utf8');
    expect(policy).toContain('https://support.google.com/googleplay/android-developer/answer/9867159');
    expect(policy).toContain('https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/');
    expect(policy).toContain('https://developer.apple.com/app-store/review/guidelines/#user-generated-content');
    expect(policy).toContain('Restrict minor access');
    expect(policy).toContain('Override to Higher Age Rating: 18+');
    expect(policy).toContain('Care in Community');
  });
});
