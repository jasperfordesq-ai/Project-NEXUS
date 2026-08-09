// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

const fs = require('fs');
const path = require('path');

const { reservedChildSegments } = require('../src/middleware/tenant-routing');

function parseLaravelReservedPaths() {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../../../../staging/app/Core/TenantContext.php'),
    'utf8'
  );
  const match = source.match(/private static function getReservedPaths\(\): array[\s\S]*?return \[([\s\S]*?)\];/);
  if (!match) {
    throw new Error('Could not locate Laravel TenantContext::getReservedPaths()');
  }

  return [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

describe('tenant routing source parity', () => {
  it('keeps parent-domain reserved child segments aligned with Laravel TenantContext', () => {
    const laravelReserved = [...new Set(parseLaravelReservedPaths())].sort();
    const webReserved = [...new Set(reservedChildSegments)].sort();

    expect(webReserved).toEqual(laravelReserved);
  });
});
