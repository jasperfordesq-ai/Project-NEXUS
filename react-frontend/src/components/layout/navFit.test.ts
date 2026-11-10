// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { estimatedNavCount, navCountAfterMeasure } from './navFit';

/**
 * Warmth plan W9 (10 Nov 2026): at a 1024px window, signed in, the header's
 * links spilled out of their space and the Create and Notifications buttons
 * covered part of "More" (axe target-size: 21.6px left of a 24px minimum).
 * The count came from an estimate of 110px a link; it is now checked against
 * the links' real width, one fewer at a time, the rest going under More.
 */
describe('fitting the header links', () => {
  it('starts from an estimate of the space', () => {
    expect(estimatedNavCount(505)).toBe(2);
    expect(estimatedNavCount(1000)).toBe(7);
    expect(estimatedNavCount(0)).toBe(1);
  });

  it('shows one fewer link while they spill out of their space', () => {
    expect(navCountAfterMeasure(4, 560, 505)).toBe(3);
  });

  it('keeps the count once they fit', () => {
    expect(navCountAfterMeasure(3, 505, 505)).toBe(3);
    expect(navCountAfterMeasure(3, 400, 505)).toBe(3);
  });

  it('ignores a rounding pixel', () => {
    expect(navCountAfterMeasure(3, 506, 505)).toBe(3);
  });

  it('never hides the last link', () => {
    expect(navCountAfterMeasure(1, 900, 505)).toBe(1);
  });
});
