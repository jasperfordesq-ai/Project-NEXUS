// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Contract: the community colour as text never sits on a tint of itself.
 *
 * `text-accent` is the community colour, shaded to read at 4.5:1 on the page.
 * On a tint of the same colour (`bg-accent-soft`, `bg-accent/20`…) the
 * background moves towards the text and the contrast falls: measured on
 * 10 Nov 2026 (warmth plan W4) at 3.5–4.1:1 for most colours on a 20% tint —
 * the standard colour included — and 3.0:1 for the members page's level chips
 * on a 40% tint in dark mode. HeroUI pairs its soft accent surface with
 * `text-accent-soft-foreground` (the colour mixed towards dark on the light
 * theme, towards light on the dark theme), which reads at 4.9:1 or better on
 * those tints for every colour measured. Use that pairing.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '..');

/** The owner's rule: the Caring Community module is unfinished and is not touched (26 Oct 2026). */
const NOT_TOUCHED = ['pages/caring-community/', 'components/caring-community/', 'admin/modules/caring-community/', 'caring/'];

const TINT = /(?<![\w-])(?:[\w\-[\]=&>*.():]+:)?bg-accent(?:-soft|\/\d+)(?![\w-])/;
const ACCENT_TEXT = /(?<![\w-])(?:[\w\-[\]=&>*.():]+:)?text-accent(?![\w-])/;

export function accentTextOnTint(line: string): boolean {
  return TINT.test(line) && ACCENT_TEXT.test(line);
}

/** HeroUI's soft text reads on soft tints (up to about 25%), not on a strong one: 40% measured 3.0:1. */
const STRONG_TINT = /(?<![\w-])(?:[\w\-[\]=&>*.():]+:)?bg-accent\/([3-9]\d|100)(?![\w-])/;
const SOFT_TEXT = /(?<![\w-])(?:[\w\-[\]=&>*.():]+:)?text-accent-soft-foreground(?![\w-])/;

export function softTextOnStrongTint(line: string): boolean {
  return STRONG_TINT.test(line) && SOFT_TEXT.test(line);
}

describe('community colour text on a tint of itself', () => {
  it('recognises the fault and its fix', () => {
    expect(accentTextOnTint('className="bg-accent/20 text-accent dark:text-accent"')).toBe(true);
    expect(accentTextOnTint('className="bg-accent-soft dark:bg-accent/40 text-accent"')).toBe(true);
    expect(accentTextOnTint('className="hover:bg-accent/10 hover:text-accent"')).toBe(true);
    expect(accentTextOnTint('className="bg-accent-soft text-accent-soft-foreground"')).toBe(false);
    expect(accentTextOnTint('className="bg-accent-strong text-white"')).toBe(false);
    expect(accentTextOnTint('className="text-accent underline"')).toBe(false);
    expect(softTextOnStrongTint('className="bg-accent-soft dark:bg-accent/40 text-accent-soft-foreground"')).toBe(true);
    expect(softTextOnStrongTint('className="bg-accent/20 text-accent-soft-foreground"')).toBe(false);
  });

  it('never happens in the member site, admin or broker panel', () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const relative = path.relative(SRC, full).split(path.sep).join('/');
        if (NOT_TOUCHED.some((prefix) => relative.startsWith(prefix))) continue;
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          fs.readFileSync(full, 'utf8').split('\n').forEach((line, index) => {
            if (accentTextOnTint(line) || softTextOnStrongTint(line)) offenders.push(`${relative}:${index + 1}`);
          });
        }
      }
    };
    walk(SRC);
    expect(offenders, 'use text-accent-soft-foreground on an accent tint').toEqual([]);
  });
});
