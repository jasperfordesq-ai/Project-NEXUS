// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Contract: a selected state's colours (text, background, border) must
 * actually apply.
 *
 * Two ways they silently did not (found 9 Nov 2026, 100+ places):
 *
 * 1. The `text-theme-*`, `bg-theme-*` and `border-theme-*` classes are defined
 *    in src/index.css OUTSIDE Tailwind's cascade layers, and unlayered CSS
 *    always wins over layered utilities. So beside `text-theme-muted`, a plain
 *    `data-[selected=true]:text-white` never applied: selected chips showed grey
 *    text on the accent gradient (about 2:1 on Events — a WCAG AA failure), and
 *    beside `bg-theme-elevated` a `data-[selected=true]:bg-accent` never
 *    coloured the chip at all. They must carry Tailwind's important marker:
 *    `data-[selected=true]:text-white!`, `data-[selected=true]:bg-accent!`.
 * 2. `data-[selected=true]:text-theme-primary` (or `bg-theme-hover`, …)
 *    produces no CSS at all — these are not Tailwind colours (their hover
 *    versions are written out by hand in index.css; selected ones are not).
 *    Use the token: `data-[selected=true]:text-[var(--text-primary)]!`.
 *
 * Text and background are fixed together on purpose: making the text white
 * while the background still loses would put white text on a white chip.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '..');
const BASE_UNLAYERED: Record<'text' | 'bg' | 'border', RegExp> = {
  text: /(?<![\w:[-])text-theme-(?:primary|secondary|muted|subtle|inverse|success|warning|danger|info)(?![\w-])/,
  bg: /(?<![\w:[-])bg-theme-(?:base|elevated|overlay|hover|active|card|solid)(?![\w-])/,
  border: /(?<![\w:[-])border-theme-(?:default|hover|focus)(?![\w-])/,
};
const SELECTED = /^(?:dark:)?data-\[selected=true\]:(!?)(text|bg|border)-(\S+)$/;

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

/** Problems on one line of source. */
function problemsOn(line: string): string[] {
  const problems: string[] = [];
  for (const token of line.split(/[\s'"`{}]+/)) {
    const match = SELECTED.exec(token);
    if (!match) continue;
    const [, prefixBang, family, rest] = match as unknown as [string, string, 'text' | 'bg' | 'border', string];
    // Gradients set background-image, which the unlayered background colour
    // does not touch; border widths are not colours.
    if (family === 'bg' && /^(linear|gradient|radial|conic)-/.test(rest)) continue;
    if (family === 'border' && /^(\d|x-|y-|t-|b-|l-|r-|s-|e-)/.test(rest)) continue;
    if (/^theme-/.test(rest)) problems.push(`${token} (no such Tailwind colour)`);
    else if (BASE_UNLAYERED[family].test(line) && !prefixBang && !rest.endsWith('!')) {
      problems.push(`${token} (loses to an unlayered ${family}-theme-* class)`);
    }
  }
  return problems;
}

describe('selected-state colours', () => {
  it('apply everywhere: important beside a *-theme-* class, and never a theme-* colour Tailwind does not know', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        for (const problem of problemsOn(line)) {
          offenders.push(`${path.relative(SRC, file).split(path.sep).join('/')}:${index + 1} ${problem}`);
        }
      });
    }
    expect(offenders, 'see the note at the top of this file').toEqual([]);
  });

  it('recognises each fault, and its fix', () => {
    expect(problemsOn("'text-theme-muted data-[selected=true]:text-white'")).toHaveLength(1);
    expect(problemsOn("'text-theme-muted data-[selected=true]:text-theme-primary'")).toHaveLength(1);
    expect(problemsOn("'bg-theme-elevated data-[selected=true]:bg-accent'")).toHaveLength(1);
    expect(problemsOn("'border-theme-default data-[selected=true]:border-transparent'")).toHaveLength(1);
    expect(problemsOn("'text-theme-muted data-[selected=true]:text-white!'")).toEqual([]);
    expect(problemsOn("'bg-theme-elevated data-[selected=true]:bg-accent!'")).toEqual([]);
    expect(problemsOn("'text-theme-muted data-[selected=true]:text-[var(--text-primary)]!'")).toEqual([]);
    // Gradients and plain selected colours with no theme class beside them are fine.
    expect(problemsOn("'bg-theme-elevated data-[selected=true]:bg-linear-to-r'")).toEqual([]);
    expect(problemsOn("'text-foreground data-[selected=true]:text-white'")).toEqual([]);
  });
});
