// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { fieldScrollDelta, sheetViewportBounds } from './sheetFormFocus';

describe('native sheet viewport bounds', () => {
  it('bounds the Android scroll view above the keyboard, including the status-bar offset', () => {
    // Measured on the 1080x2000 emulator: body top 700px, keyboard top 1128px.
    const bounds = sheetViewportBounds(223.62, 761.9, 429.71, 43.05);
    expect(bounds.maxHeight).toBeCloseTo(163.04);
    expect(223.62 + bounds.maxHeight! + 43.05).toBeCloseTo(429.71);
    expect(fieldScrollDelta(402.66, 112, 223.62, bounds.bottom)).toBeCloseTo(140);
  });

  it('does not collapse and blur the editor while the sheet is still moving above the keyboard', () => {
    expect(sheetViewportBounds(452.19, 761.9, 429.71, 43.05).maxHeight).toBeUndefined();
  });

  it('restores available space when the keyboard closes', () => {
    expect(sheetViewportBounds(223.62, 761.9, undefined, 43.05).maxHeight).toBeCloseTo(495.23);
  });

  it('keeps iOS screen and window coordinates aligned without the Android offset', () => {
    expect(sheetViewportBounds(250, 844, 500, 0)).toEqual({ bottom: 500, maxHeight: 250 });
  });
});

describe('sheet field visibility', () => {
  it('scrolls a note hidden by the Samsung keyboard into the visible viewport', () => {
    expect(fieldScrollDelta(398, 112, 258, 452)).toBe(70);
  });
  it('does not move an already visible field or subtract keyboard space twice', () => {
    expect(fieldScrollDelta(280, 112, 258, 452)).toBe(0);
  });
  it('reveals an earlier field after scrolling down the form', () => {
    expect(fieldScrollDelta(190, 48, 258, 452)).toBe(-80);
  });
  it('keeps an oversized editor top reachable in a short landscape viewport', () => {
    expect(fieldScrollDelta(300, 112, 258, 350)).toBe(30);
  });
  it('ignores a viewport with no usable room during layout transitions', () => {
    expect(fieldScrollDelta(300, 112, 258, 260)).toBe(0);
  });
});
