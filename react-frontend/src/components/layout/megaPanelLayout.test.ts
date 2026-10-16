// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { layoutMegaPanel, MEGA_PANEL_MIN_COLUMN_PX } from './megaPanelLayout';

describe('layoutMegaPanel', () => {
  it('assumes 230px columns', () => {
    expect(MEGA_PANEL_MIN_COLUMN_PX).toBe(230);
  });

  it.each([
    [0, 1408, { rows: 1, columnsPerRow: 0 }],
    [1, 1408, { rows: 1, columnsPerRow: 1 }],
    [2, 1408, { rows: 1, columnsPerRow: 2 }],
    [3, 1408, { rows: 1, columnsPerRow: 3 }],
    // 6 x 230 = 1380 <= 1408
    [6, 1408, { rows: 1, columnsPerRow: 6 }],
    // 6 x 230 = 1380 > 1379
    [6, 1379, { rows: 2, columnsPerRow: 3 }],
    [6, 960,  { rows: 2, columnsPerRow: 3 }],
    // 7 x 230 = 1610 > 1408
    [7, 1408, { rows: 2, columnsPerRow: 4 }],
    [7, 960,  { rows: 2, columnsPerRow: 4 }],
  ])('%i groups in %ipx', (n, w, expected) => {
    expect(layoutMegaPanel(n, w)).toEqual(expected);
  });
});
