#!/usr/bin/env node
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Every user-facing date/number formatter must take dateLocale().
 *
 * Two ways this regressed, both of which shipped:
 *
 *  1. No locale argument — `toLocaleString()` follows the DEVICE, not the
 *     language the member chose in Settings.
 *  2. A bare `i18n.language` — `'en'` carries no region, so Intl falls back to
 *     the language's default one, which for English is the United States.
 *     17 August 2026 renders as 8/17/2026.
 *
 * `dateLocale()` combines the member's language with the community's region and
 * is the only correct argument. A deliberate machine format (an 'en-CA' tag
 * chosen because it yields YYYY-MM-DD for arithmetic) escapes with a
 * `locale-exempt:` comment stating why.
 *
 * Mirrors react-frontend/scripts/check-locale-formatting.mjs so both clients
 * are held to the same rule.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_ROOTS = ['app', 'components', 'lib', 'hooks'];
const EXCLUDED_DIRECTORIES = new Set(['node_modules', '__tests__', '__mocks__']);
const EXCLUDED_FILE_PATTERN = /\.(?:spec|test)\.(?:ts|tsx)$/;
const EXEMPTION_MARKER = 'locale-exempt:';

const LOCALE_FORMAT_METHODS = new Set([
  'toLocaleDateString',
  'toLocaleString',
  'toLocaleTimeString',
]);
const INTL_FORMATTER_CONSTRUCTORS = new Set([
  'DateTimeFormat',
  'ListFormat',
  'NumberFormat',
  'RelativeTimeFormat',
]);

function collectSourceFiles(directory, files = []) {
  if (!fs.existsSync(directory)) return files;

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) collectSourceFiles(entryPath, files);
      continue;
    }
    if (/\.(?:ts|tsx)$/.test(entry.name) && !EXCLUDED_FILE_PATTERN.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

function isDateLocaleCall(node) {
  return (
    node &&
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'dateLocale' &&
    node.arguments.length === 0
  );
}

/** Names bound by `const x = dateLocale()` — as correct as inlining the call. */
function collectLocaleBindings(sourceFile) {
  const names = new Set();
  (function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      isDateLocaleCall(node.initializer)
    ) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  })(sourceFile);
  return names;
}

function getIntlFormatterName(node) {
  if (!ts.isNewExpression(node) && !ts.isCallExpression(node)) return null;
  const callee = node.expression;
  if (
    !ts.isPropertyAccessExpression(callee) ||
    !ts.isIdentifier(callee.expression) ||
    callee.expression.text !== 'Intl' ||
    !INTL_FORMATTER_CONSTRUCTORS.has(callee.name.text)
  ) {
    return null;
  }
  return callee.name.text;
}

/** `Intl.DateTimeFormat().resolvedOptions()` reads the environment's own zone. */
function isResolvedOptionsProbe(node) {
  const parent = node.parent;
  return parent && ts.isPropertyAccessExpression(parent) && parent.name.text === 'resolvedOptions';
}

function hasExemptionMarker(source, sourceFile, node) {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const lines = source.split(/\r?\n/);
  if ((lines[line] ?? '').includes(EXEMPTION_MARKER)) return true;

  for (let current = node; current; current = current.parent) {
    for (const range of ts.getLeadingCommentRanges(source, current.getFullStart()) ?? []) {
      if (source.slice(range.pos, range.end).includes(EXEMPTION_MARKER)) return true;
    }
    if (ts.isStatement(current)) break;
  }
  return false;
}

const violations = [];
let scanned = 0;
let checked = 0;

for (const scanRoot of SCAN_ROOTS) {
  for (const filePath of collectSourceFiles(path.join(ROOT, scanRoot))) {
    scanned += 1;
    const source = fs.readFileSync(filePath, 'utf8');
    const sourceFile = ts.createSourceFile(
      filePath,
      source,
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const relativePath = path.relative(ROOT, filePath).split(path.sep).join('/');
    // The helper itself, and the store it reads, are where the rule is defined.
    if (relativePath === 'lib/utils/dateLocale.ts') continue;

    const bindings = collectLocaleBindings(sourceFile);
    const approved = (argument) =>
      Boolean(argument) &&
      (isDateLocaleCall(argument) ||
        (ts.isIdentifier(argument) && bindings.has(argument.text)));

    (function visit(node) {
      const isMethod =
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        LOCALE_FORMAT_METHODS.has(node.expression.name.text);
      const intlName = getIntlFormatterName(node);

      if ((isMethod || intlName) && !(intlName && isResolvedOptionsProbe(node))) {
        checked += 1;
        const localeArgument = node.arguments?.[0];
        // `toLocaleTimeString([], …)` is the device locale spelled differently.
        const isEmptyArrayLiteral =
          localeArgument &&
          ts.isArrayLiteralExpression(localeArgument) &&
          localeArgument.elements.length === 0;

        if (
          (!approved(localeArgument) || isEmptyArrayLiteral) &&
          !hasExemptionMarker(source, sourceFile, node)
        ) {
          const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
          violations.push({
            file: relativePath,
            line: position.line + 1,
            method: intlName ? `Intl.${intlName}` : node.expression.name.text,
            received: localeArgument?.getText(sourceFile) ?? '<missing>',
          });
        }
      }

      ts.forEachChild(node, visit);
    })(sourceFile);
  }
}

if (violations.length > 0) {
  console.error(`Date-locale contract failed (${violations.length} violations):`);
  for (const violation of violations) {
    console.error(
      `  ${violation.file}:${violation.line}  ${violation.method} ` +
      `must receive dateLocale(); received ${violation.received}`,
    );
  }
  console.error('');
  console.error(
    'A bare language code has no region, so Intl formats as US English; no argument ' +
    `follows the device instead of the chosen language. Machine formats may use a ` +
    `"${EXEMPTION_MARKER} <reason>" comment.`,
  );
  process.exit(1);
}

console.log(
  `Date-locale contract passed (${checked} formatter calls; ${scanned} source files scanned).`,
);
