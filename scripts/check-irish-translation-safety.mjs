// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const requiredGuidance = 'Never use Google Translate for Irish.';

const maintainedGuides = [
  'docs/I18N.md',
  '.github/LOCALIZATION_WORKFLOW.md'
];

const runtimeGuards = [
  {
    file: 'scripts/translate-i18n-gaps.mjs',
    required: [
      "targetLangCode === 'ga'",
      'the Google path is not approved for Irish'
    ]
  },
  {
    file: 'scripts/translate-php-lang-gaps.mjs',
    required: [
      "locale === 'ga'",
      'Google translation is not approved for Irish'
    ]
  }
];

const failures = [];

for (const relativePath of maintainedGuides) {
  const content = fs.readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
  if (!content.includes(requiredGuidance)) {
    failures.push(`${relativePath}: missing exact Irish Google prohibition`);
  }
}

for (const guard of runtimeGuards) {
  const content = fs.readFileSync(path.join(repositoryRoot, guard.file), 'utf8');
  for (const requiredText of guard.required) {
    if (!content.includes(requiredText)) {
      failures.push(`${guard.file}: missing runtime guard text ${JSON.stringify(requiredText)}`);
    }
  }
}

if (failures.length > 0) {
  console.error('FAIL: Irish translation safety policy is incomplete.');
  for (const failure of failures) console.error(`  ${failure}`);
  process.exit(1);
}

console.log('PASS: Irish is blocked from Google translation in code and maintained guidance.');
