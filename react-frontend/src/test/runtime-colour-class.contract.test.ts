// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Contract: no colour class is put together while the app runs.
 *
 * Tailwind only generates the classes it can read, whole, in the source. A
 * class such as `bg-${color}/10` or `text-${tone}` is never generated, so the
 * element silently shows no colour at all. Five places did this (9 Nov 2026):
 * the "regarding" tile on a message, the promotion choices in the
 * marketplace, and three admin status icons. Write the full class names out
 * in a map instead (see components/feed/feedTypeColours.ts).
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '..');
const UTILITIES = ['bg', 'text', 'from', 'via', 'to', 'border', 'ring', 'fill', 'stroke', 'outline', 'decoration', 'shadow', 'divide', 'accent', 'caret', 'placeholder'];
const BUILT = new RegExp(String.raw`(?:^|[\s"'` + '`' + String.raw`{:!])(?:` + UTILITIES.join('|') + String.raw`)-\$\{`);

export function buildsAColourClass(line: string): boolean {
  const code = line.trim();
  if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return false;
  return BUILT.test(line);
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'test' || entry.name === '__tests__') continue;
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.|\.d\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe('colour classes are written out in full', () => {
  it('never builds one while the app runs', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const relative = path.relative(SRC, file).split(path.sep).join('/');
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        if (buildsAColourClass(line)) offenders.push(`${relative}:${index + 1}`);
      });
    }
    expect(offenders, 'see the note at the top of this file').toEqual([]);
  });

  it('recognises the fault and leaves the fix alone', () => {
    expect(buildsAColourClass('<div className={`p-2 rounded-lg bg-${color}/10`}>')).toBe(true);
    expect(buildsAColourClass('<Icon className={`w-5 h-5 text-${color}`} />')).toBe(true);
    expect(buildsAColourClass("const x = `hover:from-${tone}-500`;")).toBe(true);
    expect(buildsAColourClass('<div className={`p-2 rounded-lg ${tile}`}>')).toBe(false);
    expect(buildsAColourClass('// was `bg-${color}/10`, built at runtime')).toBe(false);
    expect(buildsAColourClass('className={`w-${size} h-${size}`}')).toBe(false);
  });
});
