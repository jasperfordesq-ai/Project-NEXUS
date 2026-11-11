// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Contract: long text uses HeroUI's `typography-prose`, never Tailwind's `prose`.
 *
 * `prose`, `prose-sm`, `prose-invert`, `prose-a:…` and the rest come from the
 * @tailwindcss/typography plugin, which this project does not install. They
 * generate nothing, so offer descriptions, help articles, wiki pages, blog
 * posts and custom pages had no paragraph spacing, list bullets or heading
 * sizes at all (found 11 Nov 2026, 16 files). Use HeroUI's Typography.Prose
 * class instead — `typography-prose`, plus `typography-prose--sm` for the
 * compact variant (tuned in src/index.css). `max-w-prose` is a core Tailwind
 * width and is fine.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '..');

/** A Tailwind-typography class token: prose, prose-sm, dark:prose-invert, prose-a:underline … */
const DEAD_PROSE = /(?:^|[\s"'`{:])(?:[a-z-]+:)*prose(?:-[a-z0-9]+)?(?::[^\s"'`]+)?(?=[\s"'`}$]|$)/;

export function usesDeadProseClass(line: string): boolean {
  const code = line.trim();
  if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return false;
  const withoutAllowed = line.replace(/max-w-prose/g, '').replace(/typography-prose(?:--sm)?/g, '');
  return DEAD_PROSE.test(withoutAllowed);
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'test' || entry.name === '__tests__') continue;
      sourceFiles(full, out);
    } else if (/\.tsx$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('long text styling', () => {
  it('recognises the dead classes and allows the live ones', () => {
    expect(usesDeadProseClass('<div className="prose prose-sm max-w-none">')).toBe(true);
    expect(usesDeadProseClass('<div className="text-sm dark:prose-invert">')).toBe(true);
    expect(usesDeadProseClass('  prose-a:text-blue-700 hover:prose-a:underline')).toBe(true);
    expect(usesDeadProseClass('className={`max-w-none dark:prose-invert${extra}`}')).toBe(true);
    expect(usesDeadProseClass('<div className="typography-prose typography-prose--sm">')).toBe(false);
    expect(usesDeadProseClass('<p className="max-w-prose text-xs">')).toBe(false);
    expect(usesDeadProseClass('// the old prose classes did nothing')).toBe(false);
  });

  it('no page uses Tailwind typography classes, which are not installed', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const lines = fs.readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (usesDeadProseClass(line)) offenders.push(`${path.relative(SRC, file)}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
