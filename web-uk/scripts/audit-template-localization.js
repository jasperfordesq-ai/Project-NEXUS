// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { SUPPORTED_LOCALES, catalogFor, valueInCatalog } = require('../src/lib/localization');

const viewsDirectory = path.join(__dirname, '..', 'src', 'views');
const coreNamespace = catalogFor('en').namespaces.govuk_alpha;
const writeChanges = process.argv.includes('--write');
const summaryOnly = process.argv.includes('--summary');

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

function templateFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return templateFiles(absolute);
    return entry.isFile() && entry.name.endsWith('.njk') ? [absolute] : [];
  });
}

function normalizeLiteral(value) {
  return value.replace(/\s+/g, ' ').trim();
}

const english = flattenStrings(coreNamespace);
const keysByEnglishValue = new Map();
for (const [key, value] of Object.entries(english)) {
  const normalized = normalizeLiteral(value);
  if (
    !normalized
    || /^(?:https?:|mailto:|\/)/.test(normalized)
    || /:[A-Za-z_][A-Za-z0-9_]*|\{[A-Za-z_][A-Za-z0-9_]*\}|\|/.test(normalized)
  ) continue;
  const keys = keysByEnglishValue.get(normalized) || [];
  keys.push(key);
  keysByEnglishValue.set(normalized, keys);
}

function localizedVector(key) {
  return SUPPORTED_LOCALES.map((locale) => valueInCatalog(catalogFor(locale), key));
}

function translationKeyFor(value) {
  const normalized = normalizeLiteral(value);
  const keys = keysByEnglishValue.get(normalized) || [];
  if (keys.length === 0) return null;

  const vectors = keys.map((key) => JSON.stringify(localizedVector(key)));
  if (new Set(vectors).size !== 1) return null;

  const selectedKey = [...keys].sort((left, right) => (
    left.split('.').length - right.split('.').length || left.localeCompare(right)
  ))[0];
  const vector = localizedVector(selectedKey);
  if (vector.slice(1).every((localized) => localized === vector[0])) return null;
  return selectedKey;
}

const matchers = [
  {
    kind: 'text',
    expression: />([^<>{}]+)</g,
    valueIndex: 1,
    replacement(match, literal, key) {
      const leading = literal.match(/^\s*/)[0];
      const trailing = literal.match(/\s*$/)[0];
      const valueOffset = match[0].indexOf(literal);
      return {
        startOffset: valueOffset,
        endOffset: valueOffset + literal.length,
        value: `${leading}{{ t("${key}") }}${trailing}`
      };
    }
  },
  {
    kind: 'attribute',
    expression: /\b(?:aria-label|title|placeholder|data-label|data-loading)="([^"{}]+)"/g,
    valueIndex: 1,
    replacement(match, literal, key) {
      const valueOffset = match[0].indexOf(literal);
      return {
        startOffset: valueOffset,
        endOffset: valueOffset + literal.length,
        value: `{{ t("${key}") }}`
      };
    }
  },
  {
    kind: 'macro',
    expression: /\b(?:text|titleText):\s*"([^"{}]+)"/g,
    valueIndex: 1,
    replacement(match, literal, key) {
      const quoteOffset = match[0].indexOf(`"${literal}"`);
      return {
        startOffset: quoteOffset,
        endOffset: quoteOffset + literal.length + 2,
        value: `t("${key}")`
      };
    }
  }
];

function protectedRanges(source) {
  const expressions = [
    /\{#[\s\S]*?#\}/g,
    /<!--[\s\S]*?-->/g,
    /<script\b[\s\S]*?<\/script>/gi,
    /<style\b[\s\S]*?<\/style>/gi
  ];
  return expressions.flatMap((expression) => [...source.matchAll(expression)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length
  })));
}

const files = templateFiles(viewsDirectory);
const matches = [];
const matchedTemplates = new Set();
let filesChanged = 0;

for (const file of files) {
  let source = fs.readFileSync(file, 'utf8');
  const protectedSourceRanges = protectedRanges(source);
  const edits = [];
  for (const matcher of matchers) {
    for (const match of source.matchAll(matcher.expression)) {
      if (protectedSourceRanges.some(({ start, end }) => match.index >= start && match.index < end)) continue;
      const literal = match[matcher.valueIndex];
      const key = translationKeyFor(literal);
      if (!key) continue;
      const line = source.slice(0, match.index).split('\n').length;
      const relativeFile = path.relative(viewsDirectory, file).replaceAll('\\', '/');
      matches.push({ file: relativeFile, line, kind: matcher.kind, literal: normalizeLiteral(literal), key });
      matchedTemplates.add(relativeFile);

      const replacement = matcher.replacement(match, literal, key);
      edits.push({
        start: match.index + replacement.startOffset,
        end: match.index + replacement.endOffset,
        value: replacement.value
      });
    }
  }

  if (writeChanges && edits.length > 0) {
    const nonOverlappingEdits = edits
      .sort((left, right) => right.start - left.start)
      .filter((edit, index, all) => index === 0 || edit.end <= all[index - 1].start);
    for (const edit of nonOverlappingEdits) {
      source = `${source.slice(0, edit.start)}${edit.value}${source.slice(edit.end)}`;
    }
    fs.writeFileSync(file, source);
    filesChanged += 1;
  }
}

const matchesByKey = matches.reduce((groups, record) => {
  const records = groups.get(record.key) || [];
  records.push(record);
  groups.set(record.key, records);
  return groups;
}, new Map());

const byKey = Array.from(matchesByKey.entries())
  .map(([key, records]) => ({ key, matches: records.length, literal: records[0].literal }))
  .sort((left, right) => right.matches - left.matches || left.key.localeCompare(right.key));

process.stdout.write(`${JSON.stringify({
  templates: files.length,
  templatesWithConservativeMatches: matchedTemplates.size,
  conservativeMatches: matches.length,
  uniqueTranslationKeys: byKey.length,
  writeChanges,
  filesChanged,
  topKeys: byKey.slice(0, 40),
  ...(!summaryOnly && { matches })
}, null, 2)}\n`);
