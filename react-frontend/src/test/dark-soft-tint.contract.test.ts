// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Contract: soft community-colour surfaces show as colour in dark mode.
 *
 * HeroUI's dark soft tint is 12% of the community colour. On the near-black
 * page a page opening in the community colour read as a plain grey card
 * (checked in a browser, 10 Nov 2026 — warmth plan W5), while the fixed amber
 * or emerald openings, at 15%, read as warm. The site's dark soft tint is set
 * in tokens.css: strong enough to read as the colour, weak enough that
 * HeroUI's soft text (`text-accent-soft-foreground`) keeps 4.5:1 on it — the
 * accent-on-tint contract refuses soft text on tints above 25%, and axe found
 * no contrast failures on 20 member pages with it.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const TOKENS = fs.readFileSync(path.resolve(__dirname, '../styles/tokens.css'), 'utf8');

function darkShare(token: string): number {
  const m = new RegExp(String.raw`:root\[data-theme="dark"\]\s*\{[^}]*--${token}:\s*color-mix\(in oklab, var\(--accent\) (\d+)%, transparent\)`).exec(TOKENS);
  expect(m, `tokens.css sets --${token} for the dark theme`).not.toBeNull();
  return Number(m![1]);
}

describe('soft community-colour surfaces on the dark theme', () => {
  it('are strong enough to read as the colour (HeroUI default: 12%)', () => {
    expect(darkShare('accent-soft')).toBeGreaterThanOrEqual(16);
  });

  it('stay soft enough for soft text to read on them', () => {
    expect(darkShare('accent-soft')).toBeLessThanOrEqual(20);
    expect(darkShare('accent-soft-hover')).toBeLessThanOrEqual(25);
    expect(darkShare('accent-soft-hover')).toBeGreaterThan(darkShare('accent-soft'));
  });
});
