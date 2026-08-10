// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { catalogFor, valueInCatalog } = require('../src/lib/localization');

const DEFAULT_SOURCE_ROOT = path.join(__dirname, '..', 'src');
const SOURCE_EXTENSIONS = new Set(['.js', '.njk']);
const STATIC_TRANSLATION_CALL = /\b(?:t|tc)\(\s*(['"])([^'"\r\n]+)\1\s*(?=[,)])/g;

function sourceFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(target));
    } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(target);
    }
  }
  return files.sort();
}

function lineNumberAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

function auditTranslationKeys(options = {}) {
  const root = options.sourceRoot || DEFAULT_SOURCE_ROOT;
  const catalog = options.catalog || catalogFor('en');
  const references = [];
  const unresolved = [];

  for (const file of sourceFiles(root)) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(STATIC_TRANSLATION_CALL)) {
      const reference = {
        file: path.relative(root, file).replaceAll('\\', '/'),
        line: lineNumberAt(source, match.index),
        key: match[2]
      };
      references.push(reference);
      if (typeof valueInCatalog(catalog, reference.key) !== 'string') {
        unresolved.push(reference);
      }
    }
  }

  return {
    sourceRoot: root,
    references: references.length,
    uniqueKeys: new Set(references.map((item) => item.key)).size,
    unresolved
  };
}

if (require.main === module) {
  const result = auditTranslationKeys();
  console.log(JSON.stringify({
    sourceRoot: result.sourceRoot,
    references: result.references,
    uniqueKeys: result.uniqueKeys,
    unresolvedCount: result.unresolved.length,
    unresolved: result.unresolved
  }, null, 2));
  process.exitCode = result.unresolved.length === 0 ? 0 : 1;
}

module.exports = {
  STATIC_TRANSLATION_CALL,
  auditTranslationKeys
};
