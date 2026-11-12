// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Contract: no VIVID class is put together while the app runs.
 *
 * runtime-colour-class.contract.test.ts holds the rule for every colour class:
 * Tailwind only generates what it can read, whole, in the source, so a class
 * built from pieces (`bg-${colour}`) silently shows nothing. The vivid colour
 * strength (warmth phase 5) adds two more ways to break it:
 *   - a `vivid:` variant glued on at run time (`vivid:${cls}`, `'vivid:' + x`),
 *     which Tailwind never sees, so a vivid community quietly looks soft;
 *   - the vivid class sets that are chosen in code (a cover's strong shades,
 *     a kind's solid tile — they follow `useSiteVivid()` because the `vivid:`
 *     variant may not paint palette colours). Each must be a finished string
 *     for every colour, never assembled from a hue name.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { categoryColour, HUE_WHEEL } from '@/lib/categoryColours';
import { kindColour } from '@/components/feed/feedTypeColours';
import { vivid } from '@/lib/vivid';

const SRC = path.resolve(__dirname, '..');

/** `vivid:${…}`, `vivid:bg-${…}`, `'vivid:' + x`, `` `vivid:` `` — a vivid class built at run time. */
const BUILT = [
  /vivid:(?:[\w\-[\]=&>*.()]+:)*[\w\-[\]/.]*\$\{/,
  /['"`]vivid:['"`]\s*\+/,
  /\$\{[^}]*\}:vivid:/,
];

export function buildsAVividClass(line: string): boolean {
  const code = line.trim();
  if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return false;
  return BUILT.some((pattern) => pattern.test(line));
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

/** A class list that is only whole Tailwind utilities (no template, no stray spaces). */
const WHOLE = /^[\w\-[\]/.:!%()#,&>=*]+(?: [\w\-[\]/.:!%()#,&>=*]+)*$/;

describe('vivid classes are written out in full', () => {
  it('never glues a vivid variant on while the app runs', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const relative = path.relative(SRC, file).split(path.sep).join('/');
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        if (buildsAVividClass(line)) offenders.push(`${relative}:${index + 1}`);
      });
    }
    expect(offenders, 'see the note at the top of this file').toEqual([]);
  });

  it('keeps the shared vivid helpers as finished strings', () => {
    const source = fs.readFileSync(path.resolve(SRC, 'lib/vivid.ts'), 'utf8');
    expect(source).not.toMatch(/\$\{/);
    for (const [name, classes] of Object.entries(vivid)) {
      expect(classes, name).toMatch(WHOLE);
    }
  });

  it('gives every cover colour its own finished vivid shades', () => {
    const source = fs.readFileSync(path.resolve(SRC, 'lib/categoryColours.ts'), 'utf8');
    for (const { name } of [...HUE_WHEEL, { name: 'gray' }, { name: 'slate' }]) {
      const strong = categoryColour(name).vividCover;
      expect(strong, name).toMatch(WHOLE);
      // Read back from the file itself, so Tailwind has seen every class.
      expect(source, name).toContain(`vividCover: '${strong}'`);
      expect(strong, name).toContain(`from-${name}-`);
    }
  });

  it('gives every kind with a solid tile a finished class list', () => {
    const source = fs.readFileSync(path.resolve(SRC, 'components/feed/feedTypeColours.ts'), 'utf8');
    const withSolid = ['event', 'poll', 'goal', 'review', 'job', 'challenge', 'volunteer', 'blog', 'discussion', 'resource', 'group', 'member', 'message', 'hours'];
    for (const kind of withSolid) {
      const solid = kindColour(kind).solid;
      expect(solid, kind).toMatch(WHOLE);
      expect(source, kind).toContain(`solid: '${solid}'`);
    }
  });

  it('recognises the fault and leaves the fix alone', () => {
    expect(buildsAVividClass('className={`vivid:${tone}`}')).toBe(true);
    expect(buildsAVividClass('className={`vivid:bg-${colour}-700`}')).toBe(true);
    expect(buildsAVividClass("const cls = 'vivid:' + fill;")).toBe(true);
    // A whole class added to a list is fine: Tailwind reads it in full.
    expect(buildsAVividClass("const cls = base + ' vivid:hidden';")).toBe(false);
    expect(buildsAVividClass('className={`${variant}:vivid:bg-white`}')).toBe(true);
    expect(buildsAVividClass('className={`rounded-xl ${vivid.solidTile}`}')).toBe(false);
    expect(buildsAVividClass("panel: 'vivid:bg-linear-to-br vivid:from-accent-strong',")).toBe(false);
    expect(buildsAVividClass('// was `vivid:${tone}`, built at run time')).toBe(false);
  });
});
