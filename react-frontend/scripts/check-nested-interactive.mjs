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

const EXCLUDED_DIRECTORIES = new Set(['__tests__', 'test']);
const EXCLUDED_FILE_PATTERN = /\.(?:spec|stories|test)\.tsx$/;

// Exported for reuse by sibling scanners (e.g. audit-dead-mocks.mjs). Adding the
// `export` keyword is inert for this file's own CLI behaviour.
export const INTRINSIC_INTERACTIVE_ELEMENTS = new Set([
  'button',
  'input',
  'select',
  'summary',
  'textarea',
]);

export const INTERACTIVE_COMPONENT_EXPORTS = new Set([
  'Button',
  'Checkbox',
  'Input',
  'Link',
  'NavLink',
  'Radio',
  'SearchField',
  'Select',
  'Slider',
  'Switch',
  'TextArea',
  'Textarea',
  'TextField',
]);

export const INTERACTIVE_ARIA_ROLES = new Set([
  'button',
  'checkbox',
  'link',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'radio',
  'switch',
  'tab',
]);

const INTERACTIVE_CONTAINER_KINDS = new Set([
  'Button',
  'Link',
  'NavLink',
  'button',
  'link',
  'role:button',
  'role:checkbox',
  'role:link',
  'role:menuitem',
  'role:menuitemcheckbox',
  'role:menuitemradio',
  'role:radio',
  'role:switch',
  'role:tab',
  'summary',
]);

function collectProductionTsxFiles(directory, files = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRECTORIES.has(entry.name)) {
        collectProductionTsxFiles(entryPath, files);
      }
      continue;
    }

    if (entry.name.endsWith('.tsx') && !EXCLUDED_FILE_PATTERN.test(entry.name)) {
      files.push(entryPath);
    }
  }

  return files;
}

function getTagName(openingElement) {
  return openingElement.tagName.getText();
}

function getAttribute(openingElement, name) {
  return openingElement.attributes.properties.find(
    (property) => ts.isJsxAttribute(property) && property.name.text === name,
  );
}

function getStaticStringAttribute(openingElement, name) {
  const attribute = getAttribute(openingElement, name);

  if (!attribute?.initializer) {
    return undefined;
  }

  if (ts.isStringLiteral(attribute.initializer)) {
    return attribute.initializer.text;
  }

  if (
    ts.isJsxExpression(attribute.initializer) &&
    attribute.initializer.expression &&
    ts.isStringLiteral(attribute.initializer.expression)
  ) {
    return attribute.initializer.expression.text;
  }

  return undefined;
}

function buildImportedInteractiveNames(sourceFile) {
  const names = new Map();

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause?.namedBindings) {
      continue;
    }

    if (!ts.isNamedImports(statement.importClause.namedBindings)) {
      continue;
    }

    const moduleName = ts.isStringLiteral(statement.moduleSpecifier)
      ? statement.moduleSpecifier.text
      : '';
    const isInteractiveModule =
      moduleName === 'react-router-dom' ||
      moduleName.startsWith('@heroui/react') ||
      moduleName.includes('components/ui') ||
      /(?:^|\/)(?:Button|Checkbox|Input|Link|Radio|SearchField|Select|Slider|Switch|TextArea|Textarea|TextField)$/.test(
        moduleName,
      );

    if (!isInteractiveModule) {
      continue;
    }

    for (const element of statement.importClause.namedBindings.elements) {
      const exportedName = element.propertyName?.text ?? element.name.text;

      if (INTERACTIVE_COMPONENT_EXPORTS.has(exportedName)) {
        names.set(element.name.text, exportedName);
      }
    }
  }

  return names;
}

function classifyInteractiveElement(openingElement, importedInteractiveNames) {
  const tagName = getTagName(openingElement);
  const role = getStaticStringAttribute(openingElement, 'role');

  if (role && INTERACTIVE_ARIA_ROLES.has(role)) {
    return `role:${role}`;
  }

  if (tagName === 'a') {
    return getAttribute(openingElement, 'href') ? 'link' : undefined;
  }

  if (tagName === 'audio' || tagName === 'video') {
    return getAttribute(openingElement, 'controls') ? tagName : undefined;
  }

  if (INTRINSIC_INTERACTIVE_ELEMENTS.has(tagName)) {
    if (tagName === 'input' && getStaticStringAttribute(openingElement, 'type') === 'hidden') {
      return undefined;
    }

    return tagName;
  }

  const componentKind = importedInteractiveNames.get(tagName);

  if (!componentKind) {
    return undefined;
  }

  if (componentKind === 'Button') {
    const polymorphicTarget = getStaticStringAttribute(openingElement, 'as');

    // A label wrapping its own file input is the valid implicit-label pattern,
    // not a button containing another control.
    if (polymorphicTarget === 'label') {
      return undefined;
    }

    if (polymorphicTarget === 'div' || polymorphicTarget === 'span') {
      return undefined;
    }
  }

  return componentKind;
}

function findViolations(filePath) {
  const source = fs.readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const importedInteractiveNames = buildImportedInteractiveNames(sourceFile);
  const violations = [];

  function recordViolation(node, tagName, kind, ancestors) {
    if (ancestors.length === 0) {
      return;
    }

    const ancestor = ancestors.at(-1);
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    const ancestorPosition = sourceFile.getLineAndCharacterOfPosition(
      ancestor.node.getStart(sourceFile),
    );

    violations.push({
      ancestorKind: ancestor.kind,
      ancestorLine: ancestorPosition.line + 1,
      ancestorTagName: ancestor.tagName,
      column: position.character + 1,
      filePath,
      kind,
      line: position.line + 1,
      tagName,
    });
  }

  function visit(node, ancestors = []) {
    if (ts.isJsxElement(node)) {
      const openingElement = node.openingElement;
      const tagName = getTagName(openingElement);
      const kind = classifyInteractiveElement(openingElement, importedInteractiveNames);

      if (kind) {
        recordViolation(openingElement, tagName, kind, ancestors);
      }

      const nextAncestors = kind && INTERACTIVE_CONTAINER_KINDS.has(kind)
        ? [...ancestors, { kind, node: openingElement, tagName }]
        : ancestors;

      // JSX passed as visual content props is rendered inside the component.
      visit(openingElement.attributes, nextAncestors);
      for (const child of node.children) {
        visit(child, nextAncestors);
      }
      return;
    }

    if (ts.isJsxSelfClosingElement(node)) {
      const tagName = getTagName(node);
      const kind = classifyInteractiveElement(node, importedInteractiveNames);

      if (kind) {
        recordViolation(node, tagName, kind, ancestors);
      }

      const nextAncestors = kind && INTERACTIVE_CONTAINER_KINDS.has(kind)
        ? [...ancestors, { kind, node, tagName }]
        : ancestors;

      // Input visual slots are siblings of the actual input in the rendered
      // DOM. Button/link visual slots, however, are rendered inside that one
      // interactive control and must remain free of nested controls.
      visit(node.attributes, nextAncestors);
      return;
    }

    ts.forEachChild(node, (child) => visit(child, ancestors));
  }

  visit(sourceFile);
  return violations;
}

const files = collectProductionTsxFiles(SOURCE_ROOT).sort();
const violations = files.flatMap(findViolations);

if (violations.length > 0) {
  console.error(`Nested interactive controls found: ${violations.length}`);

  for (const violation of violations) {
    const relativePath = path.relative(SOURCE_ROOT, violation.filePath).replaceAll('\\', '/');
    console.error(
      `${relativePath}:${violation.line}:${violation.column} ` +
      `<${violation.tagName}> (${violation.kind}) is nested inside ` +
      `<${violation.ancestorTagName}> (${violation.ancestorKind}) ` +
      `from line ${violation.ancestorLine}`,
    );
  }

  process.exitCode = 1;
} else {
  console.log(`Nested interactive-control contract passed (${files.length} production TSX files).`);
}
