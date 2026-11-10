// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Contract: grey helper text reads on the light surfaces it is used on.
 *
 * `--text-muted` on the light theme was stone-500 (#78716c): 4.59:1 on the
 * page, but 4.4:1 on a lightly tinted pill (`--surface-hover`, 4% black over a
 * white card) — 24 failures on the members page (axe, 10 Nov 2026). It must
 * clear 4.5:1 on the page, on a white card, and on that pill.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getContrastRatio } from '@/lib/colorContrast';

const TOKENS = fs.readFileSync(path.resolve(__dirname, '../styles/tokens.css'), 'utf8');

describe('grey helper text on the light theme', () => {
  const start = TOKENS.indexOf(':root[data-theme="light"],\n.light {');
  const block = TOKENS.slice(start, TOKENS.indexOf('\n}\n', start));
  const muted = /--text-muted:\s*(#[0-9a-f]{6});/.exec(block)?.[1];

  it('is set as a plain colour', () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(muted).toBeDefined();
  });

  it.each([
    ['the page', '#fafaf9'],
    ['a white card', '#ffffff'],
    ['a lightly tinted pill on a white card', '#f5f5f5'],
  ])('reads at 4.5:1 or better on %s', (_name, surface) => {
    expect(getContrastRatio(muted!, surface)!).toBeGreaterThanOrEqual(4.5);
  });
});
