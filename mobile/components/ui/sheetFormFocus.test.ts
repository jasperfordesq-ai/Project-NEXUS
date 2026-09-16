// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { fieldScrollDelta } from './sheetFormFocus';

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
