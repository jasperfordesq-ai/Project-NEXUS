// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The job detail route resolved the current member for its owner-controls
 * fallback with `getUserV2(token)` — no id — which requests /api/v2/users/undefined
 * (a guaranteed 404, swallowed) on every authenticated job view, so the fallback
 * never matched and a real owner saw no edit/manage controls. It must use
 * getRequestProfile(req, token), like the edit route.
 */

const fs = require('fs');
const path = require('path');

describe('job detail owner lookup', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'jobs.js'), 'utf8');

  it('never calls getUserV2 without an id (which would hit /users/undefined)', () => {
    expect(src).not.toMatch(/getUserV2\(\s*token\s*\)/);
  });

  it('resolves the current member via getRequestProfile for the owner fallback', () => {
    expect(src).toContain('profileResult = await getRequestProfile(req, token)');
  });
});
