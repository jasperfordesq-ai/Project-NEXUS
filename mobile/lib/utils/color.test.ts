// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { contrastRatio, contrastText, readReceiptColor } from './color';

describe('contrastRatio', () => {
  it('is 21:1 between black and white and 1:1 for the same colour', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 1);
    expect(contrastRatio('#3B82F6', '#3B82F6')).toBeCloseTo(1, 5);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#1D4ED8', '#7DD3FC')).toBeCloseTo(contrastRatio('#7DD3FC', '#1D4ED8'), 5);
  });
});

/*
  The "read" double tick is painted on the member's OWN bubble, whose background is the
  community colour. A fixed blue is unreadable on a blue community, so the tint is chosen
  against the actual primary and falls back to the bubble's text colour when neither
  candidate reaches 3:1 (WCAG non-text contrast).
*/
describe('readReceiptColor', () => {
  it('uses the light sky tint on a dark primary where it reaches 3:1', () => {
    expect(contrastText('#1D4ED8')).toBe('#FFFFFF');
    expect(readReceiptColor('#1D4ED8')).toBe('#7DD3FC');
    expect(contrastRatio('#7DD3FC', '#1D4ED8')).toBeGreaterThanOrEqual(3);
  });

  it('uses the deep sky tint on a pale primary where it reaches 3:1', () => {
    expect(contrastText('#FDE68A')).toBe('#000000');
    expect(readReceiptColor('#FDE68A')).toBe('#0369A1');
    expect(contrastRatio('#0369A1', '#FDE68A')).toBeGreaterThanOrEqual(3);
  });

  it('falls back to the bubble text colour when the tint would not be legible', () => {
    // Mid-tone indigo: black text wins, and the deep tint only reaches ~1.3:1 against it.
    expect(contrastRatio('#0369A1', '#6366F1')).toBeLessThan(3);
    expect(readReceiptColor('#6366F1')).toBe(contrastText('#6366F1'));
  });
});
