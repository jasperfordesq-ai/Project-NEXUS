// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Contract: the VIVID colour strength is readable for any community colour.
 *
 * A community can choose "vivid" (warmth phase 5): page openings, picture
 * tiles and selected items are FILLED with its colour instead of tinted.
 * Components opt in with Tailwind's `vivid:` variant (index.css).
 *
 * A fill is only safe if the text on it is safe for EVERY colour a community
 * may pick, in light and dark. Two pairs are, by construction:
 *   - white on `accent-strong` (ThemeContext deepens that shade until white
 *     text on it reads at 4.5:1; `accent-strong-end` is darker still);
 *   - `accent-strong` on white (the same ratio the other way round).
 * A tint is NOT: text on a 40% tint of a community colour measured 3.0:1.
 *
 * So `vivid:` may only paint with those colours. Anything else — a vivid
 * tint, the text shade as a fill, the companion colour under text — fails here.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '..');

/** Every `vivid:` class, with any further variants in front of the utility. */
const VIVID_CLASS = /(?:^|[\s"'`{}])((?:[\w\-[\]=&>*.()]+:)*vivid:(?:[\w\-[\]=&>*.()]+:)*)(!?[\w\-[\]/.%()#,]+!?)/g;

// surface is HeroUI's own opaque raised surface: it carries the theme's text.
const FILL_COLOURS = ['accent-strong', 'accent-strong-end', 'white', 'transparent', 'surface'];
const TEXT_COLOURS = ['white', 'accent-strong'];

/** Utilities that set a colour, and the colours each may take under `vivid:`. */
const COLOUR_UTILITIES: Array<{ prefix: RegExp; allowed: string[] }> = [
  { prefix: /^(?:bg|from|via|to)-/, allowed: FILL_COLOURS },
  { prefix: /^text-/, allowed: TEXT_COLOURS },
  { prefix: /^(?:border|ring|outline|divide|fill|stroke|decoration)-/, allowed: [...FILL_COLOURS] },
];

/** `bg-linear-to-br`, `text-sm`, `border-2`, `ring-0`… set no colour. */
const NOT_A_COLOUR = /^(?:bg-(?:gradient|linear|none|clip|cover|contain|center|no-repeat)|text-(?:xs|sm|base|lg|xl|\dxl|left|center|right|balance|wrap|nowrap|ellipsis)|border-(?:\d|[trblxy]|solid|dashed|none)|ring-(?:\d|inset|offset)|outline-(?:\d|none|offset|solid)|(?:from|via|to)-\d)/;

export function vividFaults(line: string): string[] {
  const faults: string[] = [];
  for (const match of line.matchAll(VIVID_CLASS)) {
    const utility = (match[2] ?? '').replace(/^!|!$/g, '');
    if (NOT_A_COLOUR.test(utility)) continue;
    for (const { prefix, allowed } of COLOUR_UTILITIES) {
      if (!prefix.test(utility)) continue;
      const colour = utility.replace(prefix, '');
      if (!allowed.includes(colour)) faults.push(`vivid:${utility}`);
    }
  }

  // White text may share a class list only with the button-shade fill: a
  // white, surface or see-through fill in the same list puts it on a pale
  // background. (Text on a fill set by a parent element cannot be checked
  // line by line; the `vivid` helpers keep that pairing.)
  const utilities = [...line.matchAll(VIVID_CLASS)].map((m) => (m[2] ?? '').replace(/^!|!$/g, ''));
  if (utilities.some((u) => /^text-white(?:\/\d+)?$/.test(u))) {
    const paleFill = utilities.find((u) => /^(?:bg|from)-(?:white|surface|transparent)(?:\/\d+)?$/.test(u));
    if (paleFill) faults.push(`vivid:text-white on vivid:${paleFill}`);
  }
  return faults;
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

describe('the vivid colour strength', () => {
  it('only ever paints with colours that are readable for every community colour', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        if (!line.includes('vivid:')) return;
        for (const fault of vividFaults(line)) {
          offenders.push(`${path.relative(SRC, file).split(path.sep).join('/')}:${index + 1} ${fault}`);
        }
      });
    }
    expect(offenders, 'see the note at the top of this file').toEqual([]);
  });

  it('is actually used (the variant is wired up)', () => {
    const users = sourceFiles(SRC).filter((file) => /\bvivid:/.test(fs.readFileSync(file, 'utf8')));
    expect(users.length).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(SRC, 'index.css'), 'utf8')).toContain(
      '@custom-variant vivid (&:is([data-colour-strength="vivid"] *));',
    );
  });

  it('recognises the safe pairs and the faults', () => {
    expect(vividFaults("'bg-accent-soft vivid:bg-linear-to-br vivid:from-accent-strong vivid:to-accent-strong-end'")).toEqual([]);
    expect(vividFaults("'text-theme-primary vivid:text-white'")).toEqual([]);
    expect(vividFaults("'vivid:bg-white vivid:text-accent-strong!'")).toEqual([]);
    expect(vividFaults("'vivid:hidden vivid:border-2 vivid:text-sm vivid:ring-0'")).toEqual([]);
    expect(vividFaults("'data-[selected=true]:vivid:bg-accent-strong! data-[selected=true]:vivid:text-white!'")).toEqual([]);
    // A tint is not a fill; the text shade is not the button shade.
    expect(vividFaults("'vivid:bg-accent/40'")).toEqual(['vivid:bg-accent/40']);
    expect(vividFaults("'vivid:bg-accent vivid:text-white'")).toEqual(['vivid:bg-accent']);
    expect(vividFaults("'vivid:to-companion'")).toEqual(['vivid:to-companion']);
    expect(vividFaults("'vivid:text-accent'")).toEqual(['vivid:text-accent']);
    expect(vividFaults("'vivid:bg-emerald-600 vivid:text-white'")).toEqual(['vivid:bg-emerald-600']);
    expect(vividFaults("'vivid:bg-white/20'")).toEqual(['vivid:bg-white/20']);
  });

  // Each class was checked on its own, so white text on a white or surface
  // fill passed (audit of warmth phase 5, 12 Nov 2026). White text may share a
  // class list only with the button-shade fill.
  it('refuses white text on a white or surface fill in the same class list', () => {
    expect(vividFaults("'vivid:bg-white vivid:text-white'")).toEqual(['vivid:text-white on vivid:bg-white']);
    expect(vividFaults("'vivid:bg-surface vivid:text-white!'")).toEqual(['vivid:text-white on vivid:bg-surface']);
    expect(vividFaults("'vivid:from-white vivid:to-white vivid:text-white'")).toEqual(['vivid:text-white on vivid:from-white']);
    expect(vividFaults("'vivid:bg-accent-strong vivid:text-white'")).toEqual([]);
    expect(vividFaults("'vivid:from-accent-strong vivid:to-accent-strong-end vivid:text-white!'")).toEqual([]);
  });
});
