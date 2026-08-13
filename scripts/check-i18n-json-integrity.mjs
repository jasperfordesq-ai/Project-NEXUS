// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Reject invalid translation JSON and duplicate object keys. JSON.parse accepts
 * duplicates by silently keeping the last value, which can erase translated
 * copy while ordinary key-parity checks still appear healthy.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRANSLATION_ROOTS = [
  path.join(ROOT, 'lang'),
  path.join(ROOT, 'react-frontend', 'public', 'locales'),
  path.join(ROOT, 'mobile', 'locales'),
];

const MOJIBAKE_PATTERNS = [
  /\u00C3[\u0080-\u00BF]/u,
  /\u00E2(?:\u20AC|\u0080|\u0082|\u0084)/u,
  /\u00EF\u00BF\u00BD/u,
  /\uFFFD/u,
];

function collectJsonFiles(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      collectJsonFiles(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      files.push(fullPath);
    }
  }
  return files;
}

function findDuplicateKeys(source) {
  let index = 0;
  const duplicates = [];

  function skipWhitespace() {
    while (index < source.length && /\s/u.test(source[index])) index += 1;
  }

  function parseString() {
    const start = index;
    index += 1;
    while (index < source.length) {
      if (source[index] === '\\') {
        index += 2;
        continue;
      }
      if (source[index] === '"') {
        index += 1;
        return { value: JSON.parse(source.slice(start, index)), offset: start };
      }
      index += 1;
    }
    throw new SyntaxError('Unterminated JSON string');
  }

  function parseValue(keyPath) {
    skipWhitespace();
    if (source[index] === '{') {
      parseObject(keyPath);
      return;
    }
    if (source[index] === '[') {
      parseArray(keyPath);
      return;
    }
    if (source[index] === '"') {
      parseString();
      return;
    }
    while (index < source.length && !/[\s,\]}]/u.test(source[index])) index += 1;
  }

  function parseObject(keyPath) {
    index += 1;
    skipWhitespace();
    if (source[index] === '}') {
      index += 1;
      return;
    }

    const seen = new Map();
    while (index < source.length) {
      skipWhitespace();
      const key = parseString();
      const fullPath = [...keyPath, key.value];
      if (seen.has(key.value)) {
        duplicates.push({
          key: fullPath.join('.'),
          offset: key.offset,
          firstOffset: seen.get(key.value),
        });
      } else {
        seen.set(key.value, key.offset);
      }

      skipWhitespace();
      index += 1; // colon; JSON.parse already validated the grammar.
      parseValue(fullPath);
      skipWhitespace();
      if (source[index] === '}') {
        index += 1;
        return;
      }
      index += 1; // comma
    }
  }

  function parseArray(keyPath) {
    index += 1;
    skipWhitespace();
    if (source[index] === ']') {
      index += 1;
      return;
    }

    let itemIndex = 0;
    while (index < source.length) {
      parseValue([...keyPath, `[${itemIndex}]`]);
      itemIndex += 1;
      skipWhitespace();
      if (source[index] === ']') {
        index += 1;
        return;
      }
      index += 1; // comma
    }
  }

  parseValue([]);
  return duplicates;
}

function lineAt(source, offset) {
  let line = 1;
  for (let index = 0; index < offset; index += 1) {
    if (source[index] === '\n') line += 1;
  }
  return line;
}

const files = TRANSLATION_ROOTS.flatMap((directory) => collectJsonFiles(directory)).sort();
const invalid = [];
const duplicates = [];
const corrupted = [];

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  try {
    JSON.parse(source);
  } catch (error) {
    invalid.push({ file, message: error instanceof Error ? error.message : String(error) });
    continue;
  }

  if (MOJIBAKE_PATTERNS.some((pattern) => pattern.test(source))) {
    const firstOffset = source.search(new RegExp(MOJIBAKE_PATTERNS.map((pattern) => pattern.source).join('|'), 'u'));
    corrupted.push({ file, line: lineAt(source, Math.max(0, firstOffset)) });
  }

  for (const duplicate of findDuplicateKeys(source)) {
    duplicates.push({
      file,
      key: duplicate.key,
      line: lineAt(source, duplicate.offset),
      firstLine: lineAt(source, duplicate.firstOffset),
    });
  }
}

console.log('============================================================');
console.log('  i18n JSON Integrity Check');
console.log('============================================================');
console.log(`  Files checked:    ${files.length}`);
console.log(`  Invalid JSON:     ${invalid.length}`);
console.log(`  Duplicate keys:   ${duplicates.length}`);
console.log(`  Encoding errors:  ${corrupted.length}`);

for (const issue of invalid) {
  console.error(`  INVALID ${path.relative(ROOT, issue.file)}: ${issue.message}`);
}
for (const issue of duplicates) {
  console.error(
    `  DUPLICATE ${path.relative(ROOT, issue.file)}:${issue.line} ${issue.key} (first at line ${issue.firstLine})`,
  );
}
for (const issue of corrupted) {
  console.error(`  MOJIBAKE ${path.relative(ROOT, issue.file)}:${issue.line}`);
}

if (invalid.length > 0 || duplicates.length > 0 || corrupted.length > 0) {
  process.exit(1);
}

console.log('  PASS: Translation JSON is valid, uniquely keyed, and valid UTF-8 text.');
