// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import fs from 'fs';
import path from 'path';

describe('Jest HeroUI Native theme', () => {
  it('seeds the base colours used by controls during tests', () => {
    const setup = fs.readFileSync(path.join(__dirname, '..', '..', 'jest-setup.ts'), 'utf8');

    expect(setup).toContain("'--color-muted':");
    expect(setup).toContain("'--color-default':");
  });
});
