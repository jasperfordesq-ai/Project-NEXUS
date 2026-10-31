// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * 31 Oct 2026: the Help Centre asked for a 'help' namespace that does not
 * exist (the real ones are help_centre, help_members, …). With Suspense the
 * page waited for it for ever and every visitor saw "Loading" — caught only by
 * the E2E smoke test. Every namespace a component names must have a file.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '..');
const LOCALES = path.resolve(SRC, '..', 'public', 'locales', 'en');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') sourceFiles(full, out);
    } else if (/\.(tsx?)$/.test(entry.name) && !/\.(test|spec|stories)\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('translation namespaces', () => {
  it('every namespace named in useTranslation has an English file', () => {
    const missing: string[] = [];
    for (const file of sourceFiles(SRC)) {
      // Comments mention useTranslation('namespace') as prose; only code counts.
      const source = fs.readFileSync(file, 'utf8').replace(/^\s*(\/\/|\*).*$/gm, '');
      for (const call of source.matchAll(/useTranslation\(\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/g)) {
        for (const ns of call[1]!.matchAll(/['"]([a-z0-9_]+)['"]/g)) {
          if (!fs.existsSync(path.join(LOCALES, `${ns[1]}.json`))) {
            missing.push(`${path.relative(SRC, file)}: '${ns[1]}'`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
