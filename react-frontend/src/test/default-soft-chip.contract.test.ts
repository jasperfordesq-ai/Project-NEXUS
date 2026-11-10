// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Contract: a plain soft label shows as a pill.
 *
 * `<Chip variant="flat">` with no colour (about 850 uses) is HeroUI's
 * "default soft" chip: half of `--default`. This site sets `--default` to its
 * elevated surface (90% white on the light theme, 5% white on the dark one),
 * so the pill was white on a white card and 2.5% white on a dark one — the
 * label read as bare bold text (found in the browser, 10 Nov 2026; warmth
 * plan W10 / P7). tokens.css now gives the pill its own visible neutral.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const TOKENS = fs.readFileSync(path.resolve(__dirname, '../styles/tokens.css'), 'utf8');

function alpha(theme: 'dark' | 'light', token: string): { rgb: string; alpha: number } {
  const start = theme === 'dark' ? TOKENS.indexOf('\n.dark {') : TOKENS.indexOf(':root[data-theme="light"],\n.light {');
  expect(start, `tokens.css has the ${theme} block`).toBeGreaterThanOrEqual(0);
  const block = TOKENS.slice(start, TOKENS.indexOf('\n}\n', start));
  const m = new RegExp(String.raw`--${token}:\s*rgba\((\d+, \d+, \d+), ([\d.]+)\)`).exec(block);
  expect(m, `${theme} theme sets --${token} as its own colour`).not.toBeNull();
  return { rgb: m![1]!, alpha: Number(m![2]) };
}

describe('a plain soft label', () => {
  it('is a visible warm-grey pill on the light theme', () => {
    const pill = alpha('light', 'default-soft');
    expect(pill.rgb).toBe('28, 25, 23');
    expect(pill.alpha).toBeGreaterThanOrEqual(0.06);
    expect(pill.alpha).toBeLessThanOrEqual(0.12); // dark text on it stays far above 4.5:1
    expect(alpha('light', 'default-soft-hover').alpha).toBeGreaterThan(pill.alpha);
  });

  it('is a visible light pill on the dark theme', () => {
    const pill = alpha('dark', 'default-soft');
    expect(pill.rgb).toBe('255, 255, 255');
    expect(pill.alpha).toBeGreaterThanOrEqual(0.08);
    expect(pill.alpha).toBeLessThanOrEqual(0.16); // white text on it stays far above 4.5:1
    expect(alpha('dark', 'default-soft-hover').alpha).toBeGreaterThan(pill.alpha);
  });
});
