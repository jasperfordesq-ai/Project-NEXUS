// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const contracts = [
  {
    file: 'e2e/tests/accessibility-audit.spec.ts',
    required: [
      ["'wcag22aa'", 'explicit WCAG 2.2 AA axe coverage'],
      ['IRISH_MEMBER_ROUTES', 'authenticated Irish route matrix'],
      ["language: 'ga'", 'Irish browser profile'],
      ['largeText: true', 'large-text browser profile'],
      ['assertNoHorizontalOverflow', 'narrow reflow assertion'],
    ],
  },
  {
    file: 'web-uk/tests/accessibility/public-pages.spec.js',
    required: [
      ['IRISH_ROUTES', 'accessible frontend Irish route matrix'],
      ['?locale=ga', 'explicit Irish request locale'],
      ["translate('ga'", 'Irish catalogue rendering assertion'],
      ['320px CSS viewport', 'narrow reflow assertion'],
    ],
  },
];

const failures = [];

for (const contract of contracts) {
  const content = fs.readFileSync(path.join(repositoryRoot, contract.file), 'utf8');
  for (const [needle, description] of contract.required) {
    if (!content.includes(needle)) {
      failures.push(`${contract.file}: missing ${description} (${JSON.stringify(needle)})`);
    }
  }
}

if (failures.length > 0) {
  console.error(`Accessibility readiness gate contract failed with ${failures.length} issue(s):`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Accessibility readiness gate contract passed: WCAG 2.2, Irish, reflow, and authenticated coverage are present.');
