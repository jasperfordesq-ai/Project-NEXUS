// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Contract: white text never sits on a Tailwind colour too light to read it.
 *
 * WCAG AA asks for 4.5:1 between text and its background. White on
 * emerald-500 is 2.5:1, on amber-500 2.2:1, on rose-500 3.8:1 — yet 165 places
 * put white text on such fills (survey, 9 Nov 2026): the volunteering buttons,
 * every "confirm" gradient, notification count bubbles, a 9px "featured"
 * label. Each now uses the nearest shade that passes (emerald/amber/teal/
 * orange → 700, rose/red/blue/purple → 600), or the community's button shade.
 *
 * The passing shades are not written down here: they are measured from the
 * installed Tailwind theme, so an upgrade that changes a colour is caught too.
 * The community colour has its own contract (accent-white-text.contract.test.ts).
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '..');
const THEME = path.resolve(__dirname, '../../node_modules/tailwindcss/theme.css');

/** The owner's rule: the Caring Community module is unfinished and is not touched (26 Oct 2026). */
const NOT_TOUCHED = ['pages/caring-community/', 'components/caring-community/'];

const FAMILIES = ['emerald', 'green', 'teal', 'amber', 'orange', 'yellow', 'lime', 'sky', 'cyan',
  'red', 'rose', 'pink', 'blue', 'purple', 'violet', 'fuchsia', 'indigo'];

/** Contrast of white text on each palette colour, from the theme's oklch values. */
function whiteContrastByShade(): Map<string, number> {
  const css = fs.readFileSync(THEME, 'utf8');
  const result = new Map<string, number>();
  for (const m of css.matchAll(/--color-([a-z]+)-(\d+):\s*oklch\(([\d.]+)%?\s+([\d.]+)\s+([\d.]+)\)/g)) {
    let L = Number(m[3]);
    if (L > 1) L /= 100;
    const C = Number(m[4]);
    const H = (Number(m[5]) * Math.PI) / 180;
    const a = C * Math.cos(H);
    const b = C * Math.sin(H);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    const r = clamp(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s);
    const g = clamp(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s);
    const bl = clamp(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s);
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    result.set(`${m[1]}-${m[2]}`, 1.05 / (luminance + 0.05));
  }
  return result;
}

const CONTRAST = whiteContrastByShade();
const FILL = new RegExp(String.raw`(?:^|[\s"'` + '`' + String.raw`{}])((?:[\w\-[\]=&>*.()]+:)*)!?(?:bg|from|via|to)-(` + FAMILIES.join('|') + String.raw`)-(\d{2,3})(?:\/(\d+))?!?(?=[\s"'` + '`' + String.raw`{}]|$)`, 'g');
const WHITE_TEXT = /(?:^|[\s"'`{}])((?:[\w\-[\]=&>*.()]+:)*)!?text-white!?(?=[\s"'`{}]|$)/g;

/** A white-text line whose (non-dark-mode) fill is a palette colour below 4.5:1. */
export function offendsOn(line: string): boolean {
  const lightWhite = [...line.matchAll(WHITE_TEXT)].some((m) => !m[1]!.includes('dark:'));
  if (!lightWhite) return false;
  return [...line.matchAll(FILL)].some((m) => {
    const variants = m[1]!;
    if (variants.includes('dark:')) return false;
    if (m[4] !== undefined && Number(m[4]) < 50) return false; // a tint, not the fill under the text
    const contrast = CONTRAST.get(`${m[2]}-${m[3]}`);
    return contrast !== undefined && contrast < 4.5;
  });
}

const STATUS_FILL = /(?:^|[\s"'`{}])((?:[\w\-[\]=&>*.()]+:)*)!?bg-(?:warning|success)!?(?=[\s"'`{}]|$)/g;

/** White text over HeroUI's (light) warning or success fill, outside dark mode. */
export function whiteOnStatusFill(line: string): boolean {
  const lightWhite = [...line.matchAll(WHITE_TEXT)].some((m) => !m[1]!.includes('dark:'));
  return lightWhite && [...line.matchAll(STATUS_FILL)].some((m) => !m[1]!.includes('dark:'));
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

describe('white text on Tailwind colours', () => {
  it('reads the colours from the installed theme', () => {
    expect(CONTRAST.get('emerald-500')).toBeLessThan(4.5);
    expect(CONTRAST.get('emerald-700')).toBeGreaterThanOrEqual(4.5);
    expect(CONTRAST.get('amber-700')).toBeGreaterThanOrEqual(4.5);
    expect(CONTRAST.get('rose-600')).toBeGreaterThanOrEqual(4.5);
  });

  it('never sits on a fill too light to read it (4.5:1)', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const relative = path.relative(SRC, file).split(path.sep).join('/');
      if (NOT_TOUCHED.some((prefix) => relative.startsWith(prefix))) continue;
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        if (offendsOn(line)) offenders.push(`${relative}:${index + 1}`);
      });
    }
    expect(offenders, 'see the note at the top of this file').toEqual([]);
  });

  // HeroUI's warning and success fills are light (a yellow and a light green):
  // text on them uses their own foreground token, never white (9 Nov 2026:
  // resources filter chips, two step indicators).
  it('never puts white text on the theme\'s warning or success fill', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const relative = path.relative(SRC, file).split(path.sep).join('/');
      if (NOT_TOUCHED.some((prefix) => relative.startsWith(prefix))) continue;
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        if (whiteOnStatusFill(line)) offenders.push(`${relative}:${index + 1}`);
      });
    }
    expect(offenders, 'use text-warning-foreground / text-success-foreground').toEqual([]);
    expect(whiteOnStatusFill("'bg-success border-success text-white'")).toBe(true);
    expect(whiteOnStatusFill("'data-[selected=true]:bg-warning! data-[selected=true]:text-white!'")).toBe(true);
    expect(whiteOnStatusFill("'bg-success text-success-foreground'")).toBe(false);
    expect(whiteOnStatusFill("'bg-warning/10 text-white'")).toBe(false);
    expect(whiteOnStatusFill("'bg-success-soft text-white'")).toBe(false);
  });

  it('recognises the fault and its fix', () => {
    expect(offendsOn("'bg-emerald-500 text-white'")).toBe(true);
    expect(offendsOn("'bg-gradient-to-r from-emerald-500 to-teal-600 text-white'")).toBe(true);
    expect(offendsOn("'data-[selected=true]:bg-amber-500! data-[selected=true]:text-white!'")).toBe(true);
    expect(offendsOn("'bg-red-500/80 text-white'")).toBe(true);
    expect(offendsOn("'bg-emerald-700 text-white hover:bg-emerald-800'")).toBe(false);
    expect(offendsOn("'bg-gradient-to-r from-emerald-700 to-teal-700 text-white'")).toBe(false);
    expect(offendsOn("'bg-rose-600 text-white'")).toBe(false);
    // A faint tint is not the fill under the text; dark-mode-only white text is judged elsewhere.
    expect(offendsOn("'hover:bg-emerald-500/10 data-[selected=true]:bg-emerald-700! data-[selected=true]:text-white!'")).toBe(false);
    expect(offendsOn("'text-gray-900 dark:text-white bg-emerald-100'")).toBe(false);
    expect(offendsOn("'bg-emerald-500 text-emerald-950'")).toBe(false);
  });
});
