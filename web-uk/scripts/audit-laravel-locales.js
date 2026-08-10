// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { SUPPORTED_LOCALES } = require('../src/lib/localization');

const catalogDirectory = path.join(__dirname, '..', 'src', 'lib', 'localization', 'generated');

function loadCatalog(locale) {
  return JSON.parse(fs.readFileSync(path.join(catalogDirectory, `${locale}.json`), 'utf8'));
}

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

const englishCatalog = loadCatalog('en');
const englishFlat = flattenStrings(englishCatalog.namespaces);
const englishKeys = Object.keys(englishFlat).sort();
const namespaceNames = Object.keys(englishCatalog.namespaces).sort();

const localeResults = SUPPORTED_LOCALES.map((locale) => {
  const catalog = loadCatalog(locale);
  const flattened = flattenStrings(catalog.namespaces);
  const keys = Object.keys(flattened).sort();
  const missingKeys = englishKeys.filter((key) => !(key in flattened));
  const extraKeys = keys.filter((key) => !(key in englishFlat));
  const englishIdenticalKeys = englishKeys.filter((key) => flattened[key] === englishFlat[key]);
  const fullyEnglishIdenticalNamespaces = locale === 'en'
    ? []
    : namespaceNames.filter((namespace) => {
      const source = flattenStrings(englishCatalog.namespaces[namespace]);
      const localized = flattenStrings(catalog.namespaces[namespace]);
      const sourceKeys = Object.keys(source);
      return sourceKeys.length > 0 && sourceKeys.every((key) => localized[key] === source[key]);
    });

  return {
    locale,
    namespaces: Object.keys(catalog.namespaces).length,
    stringKeys: keys.length,
    missingKeys: missingKeys.length,
    extraKeys: extraKeys.length,
    englishIdenticalKeys: englishIdenticalKeys.length,
    fullyEnglishIdenticalNamespaces
  };
});

const result = {
  source: 'Laravel lang/{locale}/{govuk_alpha*,event_*,safeguarding}.php via generated catalogs',
  supportedLocales: SUPPORTED_LOCALES.length,
  authoritativeNamespaces: namespaceNames.length,
  authoritativeEnglishStringKeys: englishKeys.length,
  locales: localeResults
};

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

if (localeResults.some(({ missingKeys, extraKeys }) => missingKeys > 0 || extraKeys > 0)) {
  process.exitCode = 1;
}
