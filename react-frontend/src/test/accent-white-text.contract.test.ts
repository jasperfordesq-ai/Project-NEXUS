// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Contract: white text sits on the community colour's BUTTON shade.
 *
 * The community colour has two shades (ThemeContext, 9 Nov 2026):
 *   - `accent` — text and links. On the dark theme it is lightened until it
 *     reads on the dark page, which makes it too light to carry white text;
 *   - `accent-strong` — fills that carry white text. Deepened, only if needed,
 *     until white text on it reads at 4.5:1, in both themes.
 *
 * So a fill with white text on it must use `bg-accent-strong` (or a
 * `from-accent-strong to-accent-strong-end` gradient), never `bg-accent` /
 * `from-accent` / `via-accent`. Before this, the standard colour carried white
 * text at 4.47:1, and in dark mode white text sat on lightened community
 * colours at 3:1 or worse — on buttons, chips and own message bubbles.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '..');
const WHITE_TEXT = /(^|[\s"'`{}:!])text-white!?(?=[\s"'`{}]|$)/;
// The text shade as a fill, or as a tint strong enough (50%+) to be the fill.
const PLAIN_FILL = /(^|[\s"'`{}])((?:[\w\-[\]=&>*.()]+:)*)!?(bg-accent(?:\/[5-9]\d)?|from-accent|via-accent)!?(?=[\s"'`{}]|$)/;

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

export function offendsOn(line: string): boolean {
  return WHITE_TEXT.test(line) && PLAIN_FILL.test(line);
}

describe('white text on the community colour', () => {
  it('always sits on the button shade (accent-strong), never the text shade', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        if (offendsOn(line)) {
          offenders.push(`${path.relative(SRC, file).split(path.sep).join('/')}:${index + 1}`);
        }
      });
    }
    expect(offenders, 'see the note at the top of this file').toEqual([]);
  });

  it('recognises the fault and its fix', () => {
    expect(offendsOn("'bg-accent text-white'")).toBe(true);
    expect(offendsOn("'bg-gradient-to-r from-accent to-accent-gradient-end text-white'")).toBe(true);
    expect(offendsOn("'data-[selected=true]:bg-accent! data-[selected=true]:text-white!'")).toBe(true);
    expect(offendsOn("'bg-accent-strong text-white hover:bg-accent/90'")).toBe(true);
    expect(offendsOn("'bg-accent-strong text-white'")).toBe(false);
    expect(offendsOn("'bg-accent-strong text-white hover:bg-accent-strong-end'")).toBe(false);
    expect(offendsOn("'bg-gradient-to-r from-accent-strong to-accent-strong-end text-white'")).toBe(false);
    // Tints and the soft shade are not white-text fills.
    expect(offendsOn("'bg-accent/10 text-white'")).toBe(false);
    expect(offendsOn("'bg-accent-soft text-accent-soft-foreground'")).toBe(false);
    expect(offendsOn("'bg-accent text-accent-foreground'")).toBe(false);
  });
});
