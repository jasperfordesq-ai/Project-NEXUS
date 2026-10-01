// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Every masked field in the admin panel must go through <SecretInput>.
 *
 * A bare `<Input type="password">` makes Chrome's password manager treat the
 * page as a login form: it fills the admin's saved password into the field
 * (an API key, SMTP password, client secret, another member's new password)
 * and their saved email into the nearest text input before it — which on
 * every admin page is the sidebar search. `autoComplete="off"` on the search
 * box cannot prevent that; Chrome ignores it for credential fill. The fix has
 * to sit on the password field, so this test keeps new ones from bypassing it.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ADMIN_ROOT = join(process.cwd(), 'src', 'admin');

function productionTsxFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return productionTsxFiles(path);
    if (!entry.name.endsWith('.tsx') || entry.name.includes('.test.')) return [];
    return [path];
  });
}

/** True when a `type` attribute value can evaluate to the string 'password'. */
function canBePassword(initializer: ts.JsxAttributeValue | undefined): boolean {
  if (!initializer) return false;
  if (ts.isStringLiteral(initializer)) return initializer.text === 'password';
  let found = false;
  const visit = (node: ts.Node) => {
    if (found) return;
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.text === 'password') {
      found = true;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(initializer);
  return found;
}

function bareMaskedInputs(path: string): string[] {
  const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const offenders: string[] = [];
  const visit = (node: ts.Node) => {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    if (opening && opening.tagName.getText(file) !== 'SecretInput') {
      for (const attribute of opening.attributes.properties) {
        if (ts.isJsxAttribute(attribute) && attribute.name.getText(file) === 'type' && canBePassword(attribute.initializer)) {
          const { line } = file.getLineAndCharacterOfPosition(opening.getStart(file));
          offenders.push(`${relative(process.cwd(), path)}:${line + 1} <${opening.tagName.getText(file)}>`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return offenders;
}

describe('admin masked fields', () => {
  it('use <SecretInput> instead of a bare type="password" input', () => {
    const offenders = productionTsxFiles(ADMIN_ROOT)
      .filter((path) => !path.endsWith(join('components', 'SecretInput.tsx')))
      .flatMap(bareMaskedInputs);

    expect(offenders).toEqual([]);
  });
});
