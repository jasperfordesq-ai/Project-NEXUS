// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_ROOT = path.resolve(SCRIPT_DIR, '..', 'src');
const FIX = process.argv.includes('--fix');

const EXCLUDED_DIRECTORIES = new Set(['__tests__', 'test']);
const EXCLUDED_FILE_PATTERN = /\.(?:spec|stories|test)\.(?:ts|tsx)$/;
const LOCALE_FORMAT_METHODS = new Set([
  'toLocaleDateString',
  'toLocaleString',
  'toLocaleTimeString',
]);

// `Intl.X(...)` constructors render user-facing text the same way the methods
// above do, but they are NewExpressions, so the original visitor never saw them.
// That gap let ~40 sites drift onto the browser locale or onto a bare
// `i18n.language` — which has no region, so Intl falls back to the language's
// default one (the United States for English). Covered here for that reason.
const INTL_FORMATTER_CONSTRUCTORS = new Set([
  'DateTimeFormat',
  'ListFormat',
  'NumberFormat',
  'RelativeTimeFormat',
]);

// Intl constructors are reported but never auto-fixed. A module-scope
// `const fmt = new Intl.DateTimeFormat(...)` would capture the locale at import
// time — before the member's language and the community's region are known — so
// the correct repair is usually to make it a function, which a codemod cannot
// decide. Fix these by hand.
const AUTOFIX_INTL_CONSTRUCTORS = false;

// A deliberate non-member-facing formatter escapes with this marker on its own
// line or the line above, and must say why. Machine formats (an `en-CA` tag
// chosen because it yields YYYY-MM-DD for arithmetic) are the intended use.
// Not for "the browser locale is fine here" — that is the bug this gate exists
// to prevent.
const EXEMPTION_MARKER = 'locale-exempt:';

// Keep this empty unless a UI intentionally follows the browser/OS locale
// instead of the language selected inside NEXUS. Any future entry must include
// a source comment explaining that product decision. The current contract has
// no such exceptions.
const INTENTIONAL_BROWSER_LOCALE_ALLOWLIST = new Set([]);

function collectProductionFiles(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
        collectProductionFiles(entryPath, files);
      }
      continue;
    }

    if (
      /\.(?:ts|tsx)$/.test(entry.name) &&
      !EXCLUDED_FILE_PATTERN.test(entry.name)
    ) {
      files.push(entryPath);
    }
  }

  return files;
}

function toRelativePath(filePath) {
  return path.relative(SOURCE_ROOT, filePath).replaceAll('\\', '/');
}

function isGetFormattingLocaleCall(node) {
  return (
    ts.isCallExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'getFormattingLocale' &&
    node.arguments.length === 0
  );
}

/**
 * Names bound by `const x = getFormattingLocale()` in this file. Passing such a
 * name is exactly as correct as inlining the call, and several components
 * legitimately hoist it into a local before reusing it, so accept it rather than
 * forcing needless churn. Only `const` declarations count — a parameter named
 * `locale` proves nothing about what the caller supplies.
 */
function collectFormattingLocaleBindings(sourceFile) {
  const names = new Set();
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isGetFormattingLocaleCall(node.initializer) &&
      node.parent &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return names;
}

function importsFormattingLocaleHelper(sourceFile) {
  return sourceFile.statements.some((statement) => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== '@/lib/helpers'
    ) {
      return false;
    }

    const bindings = statement.importClause?.namedBindings;
    return (
      bindings &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some((element) => element.name.text === 'getFormattingLocale')
    );
  });
}

/**
 * True for `Intl.DateTimeFormat(...)` / `new Intl.NumberFormat(...)` and friends.
 * Type positions (`Intl.DateTimeFormatOptions`) are not call or new expressions,
 * so they never reach here.
 */
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

/**
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` reads the environment's own
 * IANA zone. It formats nothing, so a locale would be meaningless — exempt
 * structurally rather than by comment, which cannot drift out of date.
 */
function isResolvedOptionsProbe(node) {
  const parent = node.parent;
  return (
    parent &&
    ts.isPropertyAccessExpression(parent) &&
    parent.name.text === 'resolvedOptions'
  );
}

/**
 * Look for the exemption marker on the node's own line, or anywhere in the
 * comment block attached to the statement that contains it. Reading the whole
 * leading comment (rather than just the line above) is what lets an exemption
 * carry a real explanation instead of a cramped one-liner.
 */
function hasExemptionMarker(source, sourceFile, node) {
  const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  const lines = source.split(/\r?\n/);
  if ((lines[line] ?? '').includes(EXEMPTION_MARKER)) return true;

  for (let current = node; current; current = current.parent) {
    const ranges = ts.getLeadingCommentRanges(source, current.getFullStart()) ?? [];
    for (const range of ranges) {
      if (source.slice(range.pos, range.end).includes(EXEMPTION_MARKER)) {
        return true;
      }
    }
    if (ts.isStatement(current)) break;
  }

  return false;
}

function getAllowlistKey(relativePath, sourceFile, call) {
  const position = sourceFile.getLineAndCharacterOfPosition(call.getStart(sourceFile));
  return `${relativePath}:${position.line + 1}:${position.character + 1}`;
}

function addFormattingLocaleImport(source, sourceFile, edits) {
  const helperImports = sourceFile.statements.filter(
    (statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === '@/lib/helpers',
  );

  for (const statement of helperImports) {
    const importClause = statement.importClause;
    const bindings = importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;

    if (bindings.elements.some((element) => element.name.text === 'getFormattingLocale')) {
      return;
    }

    // A runtime helper cannot be merged into `import type { ... }`.
    if (importClause.isTypeOnly) continue;

    const existingNames = bindings.elements.map((element) => element.getText(sourceFile));
    const original = bindings.getText(sourceFile);
    const replacement = original.includes('\n')
      ? `{\n  ${[...existingNames, 'getFormattingLocale'].join(',\n  ')},\n}`
      : `{ ${[...existingNames, 'getFormattingLocale'].join(', ')} }`;

    edits.push({
      end: bindings.getEnd(),
      start: bindings.getStart(sourceFile),
      text: replacement,
    });
    return;
  }

  const firstImport = sourceFile.statements.find(ts.isImportDeclaration);
  const insertionPoint =
    firstImport?.getStart(sourceFile) ??
    sourceFile.statements[0]?.getStart(sourceFile) ??
    source.length;
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  edits.push({
    end: insertionPoint,
    start: insertionPoint,
    text: `import { getFormattingLocale } from '@/lib/helpers';${newline}`,
  });
}

function applyEdits(source, edits) {
  return edits
    .sort((left, right) => right.start - left.start || right.end - left.end)
    .reduce(
      (updated, edit) => updated.slice(0, edit.start) + edit.text + updated.slice(edit.end),
      source,
    );
}

function inspectFile(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const relativePath = toRelativePath(filePath);
  const canUseFormattingLocaleHelper =
    relativePath === 'lib/helpers.ts' || importsFormattingLocaleHelper(sourceFile);
  const localeBindings = collectFormattingLocaleBindings(sourceFile);
  const isApprovedLocaleArgument = (argument) =>
    Boolean(argument) &&
    (isGetFormattingLocaleCall(argument) ||
      (ts.isIdentifier(argument) && localeBindings.has(argument.text)));
  const violations = [];
  const edits = [];
  let callCount = 0;

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      LOCALE_FORMAT_METHODS.has(node.expression.name.text)
    ) {
      callCount += 1;
      const localeArgument = node.arguments[0];
      const allowlistKey = getAllowlistKey(relativePath, sourceFile, node);

      if (
        (!isApprovedLocaleArgument(localeArgument) || !canUseFormattingLocaleHelper) &&
        !INTENTIONAL_BROWSER_LOCALE_ALLOWLIST.has(allowlistKey) &&
        !hasExemptionMarker(source, sourceFile, node)
      ) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        violations.push({
          allowlistKey,
          column: position.character + 1,
          filePath: relativePath,
          line: position.line + 1,
          method: node.expression.name.text,
          received: localeArgument?.getText(sourceFile) ?? '<missing>',
        });

        if (FIX) {
          if (localeArgument) {
            edits.push({
              end: localeArgument.getEnd(),
              start: localeArgument.getStart(sourceFile),
              text: 'getFormattingLocale()',
            });
          } else {
            const openingParenthesis = source.indexOf('(', node.expression.getEnd());
            edits.push({
              end: openingParenthesis + 1,
              start: openingParenthesis + 1,
              text: 'getFormattingLocale()',
            });
          }
        }
      }
    }

    const intlFormatter = getIntlFormatterName(node);
    if (
      intlFormatter &&
      !isResolvedOptionsProbe(node) &&
      !hasExemptionMarker(source, sourceFile, node)
    ) {
      callCount += 1;
      const localeArgument = node.arguments?.[0];

      if (!isApprovedLocaleArgument(localeArgument) || !canUseFormattingLocaleHelper) {
        const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        violations.push({
          allowlistKey: getAllowlistKey(relativePath, sourceFile, node),
          column: position.character + 1,
          filePath: relativePath,
          line: position.line + 1,
          method: `Intl.${intlFormatter}`,
          received: localeArgument?.getText(sourceFile) ?? '<missing>',
        });

        if (FIX && AUTOFIX_INTL_CONSTRUCTORS && localeArgument) {
          edits.push({
            end: localeArgument.getEnd(),
            start: localeArgument.getStart(sourceFile),
            text: 'getFormattingLocale()',
          });
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  if (FIX && edits.length > 0) {
    addFormattingLocaleImport(source, sourceFile, edits);
    fs.writeFileSync(filePath, applyEdits(source, edits), 'utf8');
  }

  return { callCount, changed: edits.length > 0, violations };
}

const files = collectProductionFiles(SOURCE_ROOT).sort();
const results = files.map(inspectFile);
const callCount = results.reduce((total, result) => total + result.callCount, 0);
const filesWithCalls = results.filter((result) => result.callCount > 0).length;
const changedCount = results.filter((result) => result.changed).length;
const violations = results.flatMap((result) => result.violations);

if (FIX && violations.length > 0) {
  console.log(
    `Updated ${violations.length} locale formatter calls across ${changedCount} production files.`,
  );
} else if (violations.length > 0) {
  console.error(`Locale-formatting contract failed (${violations.length} violations):`);
  for (const violation of violations) {
    console.error(
      `${violation.filePath}:${violation.line}:${violation.column} ` +
      `${violation.method} must receive getFormattingLocale() imported from @/lib/helpers; ` +
      `received ${violation.received}`,
    );
  }
  process.exitCode = 1;
} else {
  console.log(
    `Locale-formatting contract passed (${callCount} calls across ${filesWithCalls} files; ` +
    `${files.length} production files scanned; ` +
    `${INTENTIONAL_BROWSER_LOCALE_ALLOWLIST.size} browser-locale exceptions).`,
  );
}
