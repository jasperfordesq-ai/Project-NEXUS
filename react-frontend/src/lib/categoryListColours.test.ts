// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, expect, it } from 'vitest';
import { categoryListColours } from './categoryListColours';
import { paletteFor } from './categoryColours';

/**
 * Warmth plan W3 (10 Nov 2026): category colours were picked from each
 * category's name or id alone, so two categories in one list often matched
 * (with five categories and eight colours, four lists in five had a repeat).
 * A list's categories now get distinct colours, handed out in id order.
 */
const blue = (id: number) => ({ id, color: 'blue' });

describe('categoryListColours', () => {
  it('gives every category in a list its own colour until the palette runs out', () => {
    const palette = paletteFor(null);
    const categories = Array.from({ length: palette.length + 2 }, (_, i) => blue(i + 1));
    const colours = categoryListColours(categories, null);

    const firstEight = categories.slice(0, palette.length).map((c) => colours.get(String(c.id)));
    expect(new Set(firstEight).size).toBe(palette.length);
    // Only then do colours come round again, in the same order.
    expect(colours.get(String(palette.length + 1))).toBe(colours.get('1'));
    expect(colours.get(String(palette.length + 2))).toBe(colours.get('2'));
  });

  it('hands colours out in id order, so a category keeps its colour whatever order the list arrives in', () => {
    const inOrder = categoryListColours([blue(3), blue(10), blue(42)], null);
    const shuffled = categoryListColours([blue(42), blue(3), blue(10)], null);
    expect([...shuffled.entries()].sort()).toEqual([...inOrder.entries()].sort());
    expect(inOrder.get('3')).toBe(paletteFor(null)[0]);
  });

  it('keeps existing colours when a new category is added', () => {
    const before = categoryListColours([blue(1), blue(2), blue(3)], null);
    const after = categoryListColours([blue(1), blue(2), blue(3), blue(4)], null);
    for (const id of ['1', '2', '3']) expect(after.get(id)).toBe(before.get(id));
  });

  it('follows the community colour', () => {
    const accent = '#dc2626';
    const colours = categoryListColours([blue(1), blue(2)], accent);
    expect(colours.get('1')).toBe(paletteFor(accent)[0]);
    expect(colours.get('2')).toBe(paletteFor(accent)[1]);
  });

  it('uses the colours an admin chose, once they are not all the same', () => {
    const colours = categoryListColours([{ id: 1, color: 'emerald' }, { id: 2, color: 'rose' }], null);
    expect(colours.get('1')).toBe('emerald');
    expect(colours.get('2')).toBe('rose');
  });

  it('is empty for an empty list', () => {
    expect(categoryListColours([], null).size).toBe(0);
  });
});
