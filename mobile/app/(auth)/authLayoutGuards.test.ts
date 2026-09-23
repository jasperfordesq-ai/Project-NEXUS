// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Source guards for two historical auth-screen defects whose fixes had no test:
 *
 * D104 — at 200% text with the keyboard open, the auth cards were squeezed by the
 * ScrollView and their content collapsed. Each top-level auth HeroCard now opts out of
 * shrinking (`flexShrink: 0`).
 *
 * D72 — status symbols on coloured tiles used the tenant accent's contrast even on red and
 * green tiles, which could be unreadable. Each tile icon must take its colour from
 * `contrastText(<the tile's own colour>)`.
 */
import fs from 'fs';
import path from 'path';

const read = (file: string) => fs.readFileSync(path.join(__dirname, file), 'utf8');
const cards = ['login.tsx', 'register.tsx', 'forgot-password.tsx', 'reset-password.tsx', 'verify-email.tsx'];

describe('D104: auth cards do not shrink behind the keyboard', () => {
  it.each(cards)('%s gives every top-level HeroCard flexShrink: 0', file => {
    const source = read(file);
    // Opening tags of the card itself, not HeroCard.Header / .Body / etc.
    const openings = [...source.matchAll(/<HeroCard(?![.\w])[\s\S]*?>/g)].map(match => match[0]);
    expect(openings.length).toBeGreaterThan(0);
    for (const opening of openings) expect(opening).toMatch(/flexShrink:\s*0/);
  });
});

describe('D72: status tile symbols use the contrast of their own tile colour', () => {
  it('forgot-password and reset-password colour the success/primary tile icon from the same tone', () => {
    for (const file of ['forgot-password.tsx', 'reset-password.tsx']) {
      expect(read(file)).toMatch(/color=\{contrastText\(isSubmitted \? theme\.success : primary\)\}/);
    }
  });
  it('reset-password colours the invalid-link symbol against the error tile', () => {
    expect(read('reset-password.tsx')).toMatch(/color=\{contrastText\(theme\.error\)\}/);
  });
  it('verify-email colours its status symbol against the tile tone', () => {
    expect(read('verify-email.tsx')).toMatch(/color=\{contrastText\(tone\)\}/);
  });
});
