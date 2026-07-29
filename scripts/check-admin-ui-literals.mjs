// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Reject user-facing string literals that are hidden from JSX-only i18n lint.
 *
 * Admin screens keep a substantial amount of render metadata in TypeScript
 * objects (table definitions, form fields, contextual help, API docs, etc.).
 * JSX-only linters cannot see those values once they are rendered through a
 * property such as `field.label`. This AST pass covers those indirect paths.
 *
 * A genuinely invariant technical literal may be suppressed at its exact
 * declaration with `admin-i18n-ignore` and a short reason. Suppressions stay
 * scoped to the statement they sit on — either on its own line, or anywhere in
 * the unbroken `//` comment block directly above it — so they cannot mask a
 * whole file. The comment block is allowed because the reason is the point of a
 * suppression, and a reason worth reading rarely fits in the tail of a line.
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const FRONTEND_SOURCE_ROOT = path.join(ROOT, 'react-frontend', 'src');
const require = createRequire(import.meta.url);
const ts = require(path.join(ROOT, 'react-frontend', 'node_modules', 'typescript'));

const SOURCE_ROOTS = [
  'react-frontend/src/admin',
  'react-frontend/src/super-admin',
].map((relativePath) => path.join(ROOT, relativePath));

const SHARED_SOURCE_FILES = [
  'react-frontend/src/hooks/useApi.ts',
  'react-frontend/src/hooks/useApiErrorHandler.ts',
  'react-frontend/src/components/LanguageSwitcher.tsx',
].map((relativePath) => path.join(ROOT, relativePath));

const UI_PROPERTY_NAMES = new Set([
  'actionLabel',
  'ariaLabel',
  'buttonLabel',
  'buttonText',
  'body',
  'cancelText',
  'caption',
  'category',
  'caution',
  'confirmText',
  'content',
  'ctaLabel',
  'cta_label',
  'displayName',
  'display_name',
  'description',
  'detail',
  'emptyContent',
  'emptyMessage',
  'error',
  'errorMessage',
  'footer',
  'header',
  'heading',
  'helperText',
  'helpText',
  'hint',
  'intro',
  'label',
  'message',
  'name',
  'notice',
  'placeholder',
  'prompt',
  'reason',
  'successMessage',
  'subtitle',
  'summary',
  'text',
  'title',
  'tooltip',
  'validationMessage',
  'warningMessage',
]);

const UI_ARRAY_PROPERTY_NAMES = new Set([
  'benefits',
  'bullets',
  'choices',
  'highlights',
  'instructions',
  'items',
  'notes',
  'recommendations',
  'steps',
  'tips',
  'warnings',
]);

const UI_JSX_ATTRIBUTES = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'ariaDescription',
  'ariaLabel',
  'caption',
  'content',
  'description',
  'emptyContent',
  'errorMessage',
  'helperText',
  'hint',
  'label',
  'placeholder',
  'subtitle',
  'textValue',
  'title',
  'tooltip',
  'validationMessage',
]);

const UI_CALL_NAMES = new Set([
  'alert',
  'confirm',
  'prompt',
  'setError',
  'setErrorMessage',
  'setInfoMessage',
  'setStatusMessage',
  'setSuccessMessage',
  'showToast',
  'usePageTitle',
]);

const UI_METHOD_NAMES = new Set([
  'danger',
  'error',
  'info',
  'success',
  'warning',
]);

const UI_VARIABLE_PATTERN = /(?:aria_?label|caption|description|detail|empty_?message|error(?:_?message)?|heading|helper_?text|hint|label|message|notice|placeholder|prompt|reason|subtitle|summary|title|tooltip)$/i;
const UI_ARRAY_VARIABLE_PATTERN = /(?:csv_?)?(?:headers|headings|labels|messages|steps|tips|warnings)$/i;
const RAW_ENUM_NAME_PATTERN = /^(?:action|audience|category|channel|language|operator|role|severity|status|type)$/i;
const TEST_FILE_PATTERN = /(?:^|[\\/])(?:__tests__|__mocks__)(?:[\\/])|\.(?:test|spec)\.[cm]?[jt]sx?$/i;
const SUPPRESSION_MARKER = 'admin-i18n-ignore';

const results = [];
let auditedFileCount = 0;
const sourceFiles = collectAdminDependencyGraph();
for (const filePath of sourceFiles) {
  auditedFileCount++;
  auditFile(filePath);
}

results.sort((left, right) =>
  left.file.localeCompare(right.file) || left.line - right.line || left.value.localeCompare(right.value),
);

const listMode = process.argv.includes('--list') || process.argv.includes('--json');
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(results, null, 2));
} else {
  console.log('============================================================');
  console.log('  Admin Indirect UI Literal Check');
  console.log('============================================================');
  console.log(`  Source files: ${auditedFileCount}`);
  console.log(`  Violations:   ${results.length}`);
  // Always list on failure: the FAIL message below says "above", and a bare
  // count leaves whoever hits this in CI with no file to open. --list only
  // controls listing when the check PASSES.
  if ((listMode || results.length > 0) && results.length > 0) {
    console.log('');
    for (const result of results) {
      console.log(`${result.file}:${result.line}:${result.column} [${result.context}] ${JSON.stringify(result.value)}`);
    }
  }
}

if (results.length > 0) {
  if (!process.argv.includes('--json')) {
    console.error('');
    console.error('FAIL: Translate the indirect admin UI strings above.');
    console.error('Use a line-scoped `admin-i18n-ignore: <reason>` only for invariant technical text.');
  }
  process.exitCode = 1;
}

function auditFile(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const lines = source.split(/\r?\n/);

  /**
   * A suppression applies to the statement it annotates: the marker may sit on
   * that line, or anywhere in the unbroken `//` comment block immediately above
   * it. The block has to touch the statement, so widening it cannot reach past
   * the next line of code.
   */
  function isSuppressed(lineIndex) {
    if ((lines[lineIndex] ?? '').includes(SUPPRESSION_MARKER)) return true;
    // The original single-line-above rule, kept verbatim so a marker in a
    // trailing comment on the preceding line still counts.
    if ((lines[lineIndex - 1] ?? '').includes(SUPPRESSION_MARKER)) return true;
    for (let index = lineIndex - 1; index >= 0; index--) {
      const text = (lines[index] ?? '').trim();
      if (!isCommentOnlyLine(text)) return false;
      if (text.includes(SUPPRESSION_MARKER)) return true;
    }
    return false;
  }

  function report(node, value, context) {
    const normalized = normalizeDisplayText(value);
    if (!looksUserFacing(normalized)) return;
    const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    if (isSuppressed(location.line)) return;
    results.push({
      file: normalizePath(path.relative(ROOT, filePath)),
      line: location.line + 1,
      column: location.character + 1,
      context,
      value: normalized,
    });
  }

  function visit(node) {
    if (ts.isJsxExpression(node) && !ts.isJsxAttribute(node.parent) && isRawEnumExpression(node.expression)) {
      reportUnfiltered(node.expression, node.expression.getText(sourceFile), 'raw-enum-render');
    } else if (ts.isJsxText(node)) {
      if (!isInsideTechnicalCode(node)) report(node, node.text, 'jsx-text');
    } else if (ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const value = node.text;
      const context = literalContext(node);
      if (context) report(node, value, context);
    } else if (ts.isTemplateExpression(node)) {
      const context = literalContext(node);
      if (context) {
        const staticText = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join('');
        report(node, staticText, context);
      }
    } else if (isHumanizerExpression(node)) {
      const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      if (!isSuppressed(location.line)) {
        results.push({
          file: normalizePath(path.relative(ROOT, filePath)),
          line: location.line + 1,
          column: location.character + 1,
          context: 'generated-label',
          value: node.getText(sourceFile),
        });
      }
    } else if (isHardcodedLocaleArgument(node)) {
      reportUnfiltered(node.arguments[0], node.arguments[0].text, 'hardcoded-locale');
    } else if (isRawTranslationFallback(node)) {
      const fallback = getObjectProperty(node.arguments[1], 'defaultValue');
      reportUnfiltered(fallback.initializer, fallback.initializer.getText(sourceFile), 'raw-translation-fallback');
    } else if (isServerMessageFallback(node)) {
      reportUnfiltered(node.left, node.left.getText(sourceFile), 'server-message-bypass');
    } else if (isApiMessageAccess(node) && isMessageDisplaySink(node)) {
      reportUnfiltered(node, node.getText(sourceFile), 'server-message-bypass');
    } else if (isExceptionMessageAccess(node) && isMessageDisplaySink(node)) {
      reportUnfiltered(node, node.getText(sourceFile), 'exception-message-bypass');
    }

    ts.forEachChild(node, visit);
  }

  function isRawTranslationFallback(node) {
    if (!ts.isCallExpression(node)) return false;
    const name = getCallName(node.expression);
    if (name !== 't' && !name.endsWith('.t') && name !== 'i18n.t') return false;
    const fallback = getObjectProperty(node.arguments[1], 'defaultValue');
    return Boolean(fallback && isRawEnumExpression(fallback.initializer));
  }

  function isServerMessageFallback(node) {
    if (!ts.isBinaryExpression(node)) return false;
    if (
      node.operatorToken.kind !== ts.SyntaxKind.BarBarToken
      && node.operatorToken.kind !== ts.SyntaxKind.QuestionQuestionToken
    ) {
      return false;
    }

    return isApiMessageAccess(node.left);
  }

  function isApiMessageAccess(node) {
    if (!ts.isPropertyAccessExpression(node)) return false;
    if (!['error', 'message'].includes(node.name.text)) return false;
    const receiver = receiverText(node.expression);
    return /(?:^|\.)(?:res|response|result)$/i.test(receiver)
      || /(?:Res|Response|Result)$/i.test(receiver);
  }

  function isExceptionMessageAccess(node) {
    if (!ts.isPropertyAccessExpression(node) || node.name.text !== 'message') return false;
    const receiver = receiverText(node.expression);
    return /^(?:err|error|exception|caughtError|requestError)$/i.test(receiver);
  }

  /**
   * Read the receiver's name through any wrapping that does not change what is
   * being read: a cast, parentheses, or a non-null assertion.
   *
   * This is what let `(res as { message?: string }).message` past the gate. The
   * raw node text of that receiver is `(res as { message?: string })`, which
   * matches no receiver pattern, so the whole family of casted server-message
   * reads was invisible — and casts are exactly what a caller writes when the
   * property is not on the declared type, which is the case worth catching.
   */
  function receiverText(node) {
    let current = node;
    while (
      ts.isParenthesizedExpression(current)
      || ts.isAsExpression(current)
      || ts.isNonNullExpression(current)
      || ts.isSatisfiesExpression?.(current)
      || ts.isTypeAssertionExpression?.(current)
    ) {
      current = current.expression;
    }
    return current.getText(sourceFile);
  }

  function isMessageDisplaySink(node) {
    if (ts.isBinaryExpression(node.parent) && isServerMessageFallback(node.parent)) return false;

    const enclosingCall = nearestAncestor(node, (ancestor) => (
      ts.isCallExpression(ancestor) || ts.isNewExpression(ancestor)
    ));
    if (enclosingCall && enclosingCall.arguments?.some((argument) => containsNode(argument, node))) {
      const callName = getCallName(enclosingCall.expression);
      if (
        /^(?:console\.(?:debug|error|info|log|warn)|log(?:Debug|Error|Info|Warn)?|capture(?:Exception|Message|Telemetry\w*)|queueSentry\w*)$/i.test(callName)
      ) {
        return false;
      }
      if (
        callName === 'Error'
        || callName === 't'
        || callName.endsWith('.t')
        || callName === 'i18n.t'
        || UI_CALL_NAMES.has(callName)
        || /^(?:set|show|display|open).*(?:alert|error|message|notice|status|toast)$/i.test(callName)
      ) {
        return true;
      }
      const parts = callName.split('.');
      if (
        parts.length > 1
        && UI_METHOD_NAMES.has(parts.at(-1))
        && /(?:^|_)(?:toast|notification|notify|snackbar)s?$/i.test(parts.at(-2) ?? '')
      ) {
        return true;
      }
    }

    let current = node.parent;
    while (current && !isFunctionBoundary(current)) {
      if (ts.isJsxExpression(current)) return true;
      if (ts.isVariableDeclaration(current) && ts.isIdentifier(current.name)) {
        return UI_VARIABLE_PATTERN.test(current.name.text);
      }
      if (ts.isPropertyAssignment(current) && containsNode(current.initializer, node)) {
        return ['description', 'detail', 'error', 'errorMessage', 'message', 'title'].includes(
          getPropertyName(current.name),
        );
      }
      current = current.parent;
    }
    return false;
  }

  function reportUnfiltered(node, value, context) {
    const normalized = normalizeDisplayText(value);
    const location = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    if (isSuppressed(location.line)) return;
    results.push({
      file: normalizePath(path.relative(ROOT, filePath)),
      line: location.line + 1,
      column: location.character + 1,
      context,
      value: normalized,
    });
  }

  function literalContext(node) {
    const parent = node.parent;
    if (!parent) return null;

    if (isDeclarationNameOrModuleSpecifier(node, parent)) return null;
    if (isTranslationKeyArgument(node)) return null;
    if (isInsideTechnicalCode(node)) return null;

    if (ts.isJsxAttribute(parent) && parent.initializer === node) {
      const attributeName = parent.name.getText(sourceFile);
      return UI_JSX_ATTRIBUTES.has(attributeName) ? `jsx-attribute:${attributeName}` : null;
    }

    const jsxAttribute = nearestAncestor(node, (ancestor) => ts.isJsxAttribute(ancestor));
    if (jsxAttribute) {
      const attributeName = jsxAttribute.name.getText(sourceFile);
      return UI_JSX_ATTRIBUTES.has(attributeName) ? `jsx-attribute:${attributeName}` : null;
    }

    const jsxExpression = nearestAncestor(node, (ancestor) => ts.isJsxExpression(ancestor));
    if (jsxExpression && !nearestAncestorBefore(node, jsxExpression, isFunctionBoundary)) {
      return 'jsx-expression';
    }

    if (ts.isPropertyAssignment(parent) && parent.initializer === node) {
      const propertyName = getPropertyName(parent.name);
      if (UI_PROPERTY_NAMES.has(propertyName) || UI_VARIABLE_PATTERN.test(propertyName)) {
        return `property:${propertyName}`;
      }
      if (propertyName === 'defaultValue' && isInsideTranslationCall(parent)) {
        return 'translation-default';
      }
    }

    const arrayProperty = findContainingArrayProperty(node);
    if (arrayProperty && UI_ARRAY_PROPERTY_NAMES.has(arrayProperty)) {
      return `array-property:${arrayProperty}`;
    }

    const arrayVariable = findContainingArrayVariable(node);
    if (arrayVariable && UI_ARRAY_VARIABLE_PATTERN.test(arrayVariable)) {
      return `array-variable:${arrayVariable}`;
    }

    if (isUiCallArgument(node)) return 'ui-call';

    if (ts.isVariableDeclaration(parent) && parent.initializer === node && ts.isIdentifier(parent.name)) {
      return UI_VARIABLE_PATTERN.test(parent.name.text) ? `variable:${parent.name.text}` : null;
    }

    return null;
  }

  function isTranslationKeyArgument(node) {
    const parent = node.parent;
    if (!ts.isCallExpression(parent) || parent.arguments[0] !== node) return false;
    const name = getCallName(parent.expression);
    return name === 't' || name.endsWith('.t') || name === 'i18n.t';
  }

  function isInsideTranslationCall(node) {
    const call = nearestAncestor(node, (ancestor) => ts.isCallExpression(ancestor));
    if (!call) return false;
    const name = getCallName(call.expression);
    return name === 't' || name.endsWith('.t') || name === 'i18n.t';
  }

  function isUiCallArgument(node) {
    const call = nearestAncestor(node, (ancestor) => ts.isCallExpression(ancestor));
    if (!call || !call.arguments.some((argument) => containsNode(argument, node))) return false;
    const name = getCallName(call.expression);
    if (UI_CALL_NAMES.has(name)) return true;
    if (/^(?:set|show|display|open).*(?:alert|error|message|notice|status|toast)$/i.test(name)) return true;
    const parts = name.split('.');
    const receiver = parts.at(-2) ?? '';
    return (
      parts.length > 1 &&
      UI_METHOD_NAMES.has(parts.at(-1)) &&
      /(?:^|_)(?:toast|notification|notify|snackbar)s?$/i.test(receiver)
    );
  }

  function findContainingArrayProperty(node) {
    let current = node.parent;
    while (current && !isFunctionBoundary(current)) {
      if (ts.isArrayLiteralExpression(current)) {
        const assignment = current.parent;
        if (ts.isPropertyAssignment(assignment) && assignment.initializer === current) {
          return getPropertyName(assignment.name);
        }
      }
      if (ts.isPropertyAssignment(current) || ts.isVariableDeclaration(current)) break;
      current = current.parent;
    }
    return null;
  }

  function findContainingArrayVariable(node) {
    let current = node.parent;
    while (current && !isFunctionBoundary(current)) {
      if (ts.isArrayLiteralExpression(current)) {
        const declaration = current.parent;
        if (ts.isVariableDeclaration(declaration) && declaration.initializer === current && ts.isIdentifier(declaration.name)) {
          return declaration.name.text;
        }
      }
      if (ts.isPropertyAssignment(current) || ts.isVariableDeclaration(current)) break;
      current = current.parent;
    }
    return null;
  }

  function isInsideTechnicalCode(node) {
    let current = node.parent;
    while (current) {
      if (ts.isJsxElement(current)) {
        const tag = current.openingElement.tagName.getText(sourceFile);
        if (/^(?:code|pre|Code|CodeBlock|CodeSnippet|CommandBlock|InlineCode|Kbd|Snippet)$/.test(tag)) return true;
      }
      current = current.parent;
    }
    return false;
  }

  visit(sourceFile);
}

/**
 * Include every local TypeScript dependency reachable from an admin entry
 * point. Admin pages intentionally reuse shared feedback, editor, and UI
 * components; auditing only the two admin directories would let literals in
 * those shared render paths bypass this gate.
 */
function collectAdminDependencyGraph() {
  const queue = [];
  const queued = new Set();
  const visited = new Set();

  function enqueue(filePath) {
    const normalized = path.resolve(filePath);
    if (queued.has(normalized) || TEST_FILE_PATTERN.test(normalized)) return;
    if (!/\.[cm]?[jt]sx?$/.test(normalized) || !fs.existsSync(normalized)) return;
    queued.add(normalized);
    queue.push(normalized);
  }

  for (const sourceRoot of SOURCE_ROOTS) {
    if (!fs.existsSync(sourceRoot)) continue;
    for (const filePath of walk(sourceRoot)) enqueue(filePath);
  }
  for (const filePath of SHARED_SOURCE_FILES) enqueue(filePath);

  for (let index = 0; index < queue.length; index++) {
    const filePath = queue[index];
    if (visited.has(filePath)) continue;
    visited.add(filePath);

    const sourceFile = ts.createSourceFile(
      filePath,
      fs.readFileSync(filePath, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );

    sourceFile.forEachChild((node) => {
      if (
        !(ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        || !node.moduleSpecifier
        || !ts.isStringLiteralLike(node.moduleSpecifier)
      ) {
        return;
      }
      const dependency = resolveLocalImport(filePath, node.moduleSpecifier.text);
      if (dependency) enqueue(dependency);
    });
  }

  return [...visited].sort();
}

function resolveLocalImport(importerPath, specifier) {
  let basePath;
  if (specifier.startsWith('@/')) {
    basePath = path.join(FRONTEND_SOURCE_ROOT, specifier.slice(2));
  } else if (specifier.startsWith('.')) {
    basePath = path.resolve(path.dirname(importerPath), specifier);
  } else {
    return null;
  }

  const candidates = [
    basePath,
    ...['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'].map((extension) => `${basePath}${extension}`),
    ...['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts'].map((extension) => path.join(basePath, `index${extension}`)),
  ];

  return candidates.find((candidate) => (
    candidate.startsWith(FRONTEND_SOURCE_ROOT)
    && fs.existsSync(candidate)
    && fs.statSync(candidate).isFile()
  )) ?? null;
}

function isDeclarationNameOrModuleSpecifier(node, parent) {
  if ((ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) && parent.moduleSpecifier === node) {
    return true;
  }
  if ((ts.isPropertyAssignment(parent) || ts.isPropertySignature(parent)) && parent.name === node) return true;
  if (ts.isElementAccessExpression(parent) && parent.argumentExpression === node) return true;
  if (ts.isLiteralTypeNode(parent) || ts.isEnumMember(parent)) return true;
  return false;
}

function getPropertyName(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  return name.getText();
}

function getObjectProperty(node, propertyName) {
  if (!node || !ts.isObjectLiteralExpression(node)) return null;
  return node.properties.find((property) =>
    ts.isPropertyAssignment(property) && getPropertyName(property.name) === propertyName,
  ) ?? null;
}

function isRawEnumExpression(node) {
  if (!node) return false;
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node)) {
    return isRawEnumExpression(node.expression);
  }
  if (ts.isIdentifier(node)) return RAW_ENUM_NAME_PATTERN.test(node.text);
  if (ts.isPropertyAccessExpression(node)) return RAW_ENUM_NAME_PATTERN.test(node.name.text);
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    return RAW_ENUM_NAME_PATTERN.test(node.argumentExpression.text);
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken) {
    return isRawEnumExpression(node.left);
  }
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    /^(?:toLocaleUpperCase|toLocaleLowerCase|toUpperCase|toLowerCase)$/.test(node.expression.name.text)
  ) {
    return isRawEnumExpression(node.expression.expression);
  }
  return false;
}

function getCallName(expression) {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) {
    return `${getCallName(expression.expression)}.${expression.name.text}`;
  }
  return expression.getText();
}

function isHumanizerExpression(node) {
  if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return false;
  if (!['replace', 'replaceAll'].includes(node.expression.name.text) || node.arguments.length < 2) return false;
  const replacement = node.arguments[1];
  if (!ts.isStringLiteralLike(replacement) || replacement.text.trim() !== '') return false;
  const search = node.arguments[0];
  if (ts.isStringLiteralLike(search)) return ['_', '-'].includes(search.text);
  if (!ts.isRegularExpressionLiteral(search)) return false;
  const lastSlash = search.text.lastIndexOf('/');
  const pattern = lastSlash > 0 ? search.text.slice(1, lastSlash) : search.text;
  return /^(?:_|-|\[_-\]|\[-_\])(?:\+|\*)?$/.test(pattern);
}

function isHardcodedLocaleArgument(node) {
  if ((!ts.isCallExpression(node) && !ts.isNewExpression(node)) || !node.arguments?.length) return false;
  const first = node.arguments[0];
  if (!ts.isStringLiteralLike(first) || !/^[a-z]{2}(?:-[A-Z]{2})?$/.test(first.text)) return false;
  const name = getCallName(node.expression);
  return /(?:^|\.)(?:toLocaleString|toLocaleDateString|toLocaleTimeString|DateTimeFormat|NumberFormat)$/.test(name);
}

function isFunctionBoundary(node) {
  return ts.isFunctionLike(node) || ts.isSourceFile(node);
}

function nearestAncestor(node, predicate) {
  let current = node.parent;
  while (current) {
    if (predicate(current)) return current;
    current = current.parent;
  }
  return null;
}

function nearestAncestorBefore(node, stopNode, predicate) {
  let current = node.parent;
  while (current && current !== stopNode) {
    if (predicate(current)) return current;
    current = current.parent;
  }
  return null;
}

function containsNode(container, target) {
  return target.pos >= container.pos && target.end <= container.end;
}

/**
 * Whether a trimmed line carries nothing but a comment. Covers `//`, JSX
 * `{/* ... *\/}`, and both the opening and continuation lines of a block
 * comment, so a multi-line reason works in JSX and in plain TypeScript alike.
 */
function isCommentOnlyLine(text) {
  return text.startsWith('//')
    || text.startsWith('{/*')
    || text.startsWith('/*')
    || text.startsWith('*');
}

function normalizeDisplayText(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function looksUserFacing(value) {
  if (!value || value.length < 2) return false;
  if (value.startsWith('<') && value.replace(/<[^>]+>/g, '').trim() === '') return false;
  if (/^(?:https?:\/\/|\/|\.\/|\.\.\/|#|--)/.test(value)) return false;
  if (/^(?:var|calc|min|max|clamp|rgb|rgba|hsl|hsla|oklch)\(/i.test(value)) return false;
  if (/^\([^)]*(?:min|max)-(?:width|height)[^)]*\)/i.test(value)) return false;
  if (/^[a-z][a-z0-9_.:/-]*$/.test(value)) return false;
  if (/^[A-Z0-9_]{2,12}$/.test(value)) return false;
  if (/^[A-Z]{3}\s*\([^\p{L}]*\)$/u.test(value)) return false;
  if (/^[\d\s.,:+\-/%()]+$/.test(value)) return false;
  if (/^(?:GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)(?:\s|$)/.test(value)) return false;
  if (/^(?:text|application|image|audio|video)\/[a-z0-9.+-]+$/i.test(value)) return false;
  if (/^(?:[a-z]+:)?[\w@.-]+\.(?:com|org|net|ie|json|csv|xml|txt|pdf|php|tsx?|jsx?|mjs|sql)$/i.test(value)) return false;
  if (/^(?:[a-z]+-)+(?:\[[^\]]+\]|[a-z0-9/%.]+)(?:\s+(?:[a-z]+-)+(?:\[[^\]]+\]|[a-z0-9/%.]+))*$/i.test(value)) return false;
  return /\p{L}/u.test(value) && (/\s/u.test(value) || /^\p{Lu}/u.test(value));
}

function* walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* walk(fullPath);
    } else if (/\.[cm]?[jt]sx?$/.test(entry.name)) {
      yield fullPath;
    }
  }
}

function normalizePath(filePath) {
  return filePath.replaceAll('\\', '/');
}
