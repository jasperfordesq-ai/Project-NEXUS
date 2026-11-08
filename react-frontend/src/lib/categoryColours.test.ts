// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { categoryColour, themeColourNames, THEME_ROTATION } from './categoryColours';

describe('themeColourNames', () => {
  it('gives each theme its own colour while a community has left them all on the default blue', () => {
    const names = themeColourNames([
      { slug: 'care', color: 'blue' },
      { slug: 'learning', color: 'blue' },
      { slug: 'transport', color: 'blue' },
    ]);

    expect(names).toEqual({
      care: THEME_ROTATION[0],
      learning: THEME_ROTATION[1],
      transport: THEME_ROTATION[2],
    });
    expect(new Set(Object.values(names)).size).toBe(3);
  });

  it('treats themes with no colour stored as left on the default', () => {
    const names = themeColourNames([
      { slug: 'a', color: null },
      { slug: 'b' },
    ]);
    expect(names.a).not.toBe(names.b);
  });

  it('keeps exactly the colours an admin chose once they differ', () => {
    expect(themeColourNames([
      { slug: 'care', color: 'pink' },
      { slug: 'learning', color: 'blue' },
      { slug: 'other', color: null },
    ])).toEqual({ care: 'pink', learning: 'blue', other: 'slate' });
  });

  it('wraps round the palette when there are more themes than colours', () => {
    const many = Array.from({ length: THEME_ROTATION.length + 2 }, (_, i) => ({ slug: `t${i}`, color: 'blue' }));
    const names = themeColourNames(many);
    expect(names[`t${THEME_ROTATION.length}`]).toBe(THEME_ROTATION[0]);
  });

  it('only rotates through colours the class map knows', () => {
    for (const name of THEME_ROTATION) {
      expect(categoryColour(name)).not.toBe(categoryColour('no-such-colour'));
    }
  });
});
