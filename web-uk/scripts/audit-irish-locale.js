// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const repositoryRoot = path.join(__dirname, '..', '..');
const defaultCatalogDirectory = path.join(__dirname, '..', 'src', 'lib', 'localization', 'generated');
const sharedInvariants = JSON.parse(fs.readFileSync(
  path.join(repositoryRoot, 'scripts', 'php-lang-invariant-allowlist.json'),
  'utf8'
));

const reviewedInvariantValues = new Set([
  ...(sharedInvariants.global || []),
  '',
  'AGPL-3.0-or-later',
  'NOTICE',
  'Project NEXUS',
  'Jasper Ford',
  'hOUR Timebank CLG',
  'WCAG 2.2 Level AA'
]);

const discouragedTerminology = [
  { concept: 'federation', pattern: /cónasc/iu },
  { concept: 'checkout', pattern: /t?seiceáil amach/iu },
  { concept: 'burnout', pattern: /dóiteán/iu },
  { concept: 'read-only', pattern: /inléite amháin/iu },
  { concept: 'impersonation', pattern: /aithris a dhéanamh ar/iu },
  { concept: 'vetted member', pattern: /baill? ghrinnfhiosrúcháin/iu }
];

function flattenStrings(value, prefix = '', output = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output;

  for (const [key, child] of Object.entries(value)) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') {
      output[nextPrefix] = child;
    } else {
      flattenStrings(child, nextPrefix, output);
    }
  }

  return output;
}

function isPlaceholderOrFormatOnly(value) {
  const withoutPlaceholders = value
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '')
    .replace(/\{\{[^}]+\}\}/g, '');

  return !/[\p{L}]/u.test(withoutPlaceholders);
}

function questionMarkCount(value) {
  return (value.match(/\?/g) || []).length;
}

function auditIrishLocale({ catalogDirectory = defaultCatalogDirectory } = {}) {
  const englishCatalog = JSON.parse(fs.readFileSync(path.join(catalogDirectory, 'en.json'), 'utf8'));
  const irishCatalog = JSON.parse(fs.readFileSync(path.join(catalogDirectory, 'ga.json'), 'utf8'));
  const english = flattenStrings(englishCatalog.namespaces);
  const irish = flattenStrings(irishCatalog.namespaces);
  const unreviewedEnglishFallbacks = [];
  const questionMarkMismatches = [];
  const terminologyViolations = [];

  for (const [key, englishValue] of Object.entries(english)) {
    const irishValue = irish[key];

    if (irishValue === englishValue
      && !reviewedInvariantValues.has(englishValue)
      && !isPlaceholderOrFormatOnly(englishValue)) {
      unreviewedEnglishFallbacks.push({ key, value: englishValue });
    }

    if (typeof irishValue === 'string'
      && questionMarkCount(englishValue) !== questionMarkCount(irishValue)) {
      questionMarkMismatches.push({ key, englishValue, irishValue });
    }

    if (typeof irishValue === 'string') {
      for (const terminology of discouragedTerminology) {
        if (terminology.pattern.test(irishValue)) {
          terminologyViolations.push({ key, concept: terminology.concept, value: irishValue });
        }
      }
    }
  }

  return {
    stringKeys: Object.keys(english).length,
    unreviewedEnglishFallbacks,
    questionMarkMismatches,
    terminologyViolations
  };
}

if (require.main === module) {
  const result = auditIrishLocale();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.unreviewedEnglishFallbacks.length > 0
    || result.questionMarkMismatches.length > 0
    || result.terminologyViolations.length > 0) {
    process.exitCode = 1;
  }
}

module.exports = {
  auditIrishLocale,
  flattenStrings,
  isPlaceholderOrFormatOnly
};
