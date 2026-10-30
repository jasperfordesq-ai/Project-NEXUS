// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Regression (AWID pilot, Oct 2026): a community that switched identity
 * verification off still showed "Verified" tags in the member directory, on
 * listing pages and on member insights. React's badges and this site now both
 * follow the `identity_verification` feature switch.
 */

const fs = require('fs');
const path = require('path');
const { buildShellLocals } = require('../src/lib/accessible-shell');

const viewsDir = path.join(__dirname, '..', 'src', 'views');
const read = (file) => fs.readFileSync(path.join(viewsDir, file), 'utf8');

function shellFor(features) {
  return buildShellLocals({
    query: {},
    path: '/',
    originalUrl: '/acme/accessible',
    accessibleRouting: {
      tenant: { id: 9, name: 'Acme', slug: 'acme', features, modules: {} },
      tenantSlug: 'acme',
      prefix: '/acme/accessible'
    }
  }, false);
}

describe('verification badges follow the identity_verification switch', () => {
  it('exposes the switch to every page', () => {
    expect(shellFor({}).identityVerificationEnabled).toBe(true);
    expect(shellFor({ identity_verification: false }).identityVerificationEnabled).toBe(false);
  });

  it.each([
    'members/index.njk',
    'members/discover.njk',
    'members/nearby.njk'
  ])('%s shows the member "Verified" tag only when the switch is on', (file) => {
    const source = read(file);
    expect(source).not.toMatch(/\{% if member\.isVerified %\}/);
    expect(source).toMatch(/\{% if identityVerificationEnabled and member\.isVerified %\}/);
  });

  it('listing and insights pages hide their verification sections when the switch is off', () => {
    expect(read('listings/detail.njk')).toMatch(/\{% if identityVerificationEnabled %\}/);
    expect(read('members/insights.njk')).toMatch(/\{% if identityVerificationEnabled %\}/);
  });
});
