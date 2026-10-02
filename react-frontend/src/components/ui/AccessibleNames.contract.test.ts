// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const SOURCE_ROOT = join(process.cwd(), 'src');

function productionTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTsxFiles(path);
    if (!entry.name.endsWith('.tsx') || entry.name.includes('.test.')) return [];
    return [path];
  });
}

function sourceFile(path: string): ts.SourceFile {
  return ts.createSourceFile(
    path,
    readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function openingElement(node: ts.Node): ts.JsxOpeningLikeElement | null {
  if (ts.isJsxElement(node)) return node.openingElement;
  if (ts.isJsxSelfClosingElement(node)) return node;
  return null;
}

function hasAttribute(opening: ts.JsxOpeningLikeElement, names: string[]): boolean {
  return opening.attributes.properties.some((attribute) => (
    ts.isJsxAttribute(attribute) && names.includes(attribute.name.getText())
  ));
}

function hasDescendantTag(node: ts.Node, file: ts.SourceFile, tagName: string): boolean {
  let found = false;
  const visit = (child: ts.Node) => {
    if (found) return;
    const opening = openingElement(child);
    if (opening?.tagName.getText(file) === tagName) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

const PRODUCTION_SOURCE_FILES = productionTsxFiles(SOURCE_ROOT).map((path) => ({
  file: sourceFile(path),
  path,
}));

describe('HeroUI accessible-name production contracts', () => {
  it('registers an official PopoverHeading for every production PopoverContent dialog', () => {
    const unnamed: string[] = [];
    let popoverCount = 0;

    for (const { file, path } of PRODUCTION_SOURCE_FILES) {
      const visit = (node: ts.Node) => {
        if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'PopoverContent') {
          popoverCount += 1;
          if (!hasDescendantTag(node, file, 'PopoverHeading')) {
            const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
            unnamed.push(`${relative(SOURCE_ROOT, path)}:${line + 1}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }

    expect(popoverCount).toBe(19);
    expect(unnamed).toEqual([]);
  });

  it('requires every production Progress meter to have a visible or ARIA label', () => {
    const unnamed: string[] = [];
    let progressCount = 0;

    for (const { file, path } of PRODUCTION_SOURCE_FILES) {
      const visit = (node: ts.Node) => {
        const opening = openingElement(node);
        if (opening?.tagName.getText(file) === 'Progress') {
          progressCount += 1;
          if (!hasAttribute(opening, ['label', 'aria-label', 'aria-labelledby'])) {
            const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
            unnamed.push(`${relative(SOURCE_ROOT, path)}:${line + 1}`);
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(file);
    }

    expect(progressCount).toBeGreaterThanOrEqual(76);
    expect(unnamed).toEqual([]);
  });
});
