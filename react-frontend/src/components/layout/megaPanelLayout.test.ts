// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { describe, it, expect } from 'vitest';
import { layoutMegaPanel } from './megaPanelLayout';

describe('layoutMegaPanel', () => {
  it.each([
    [0, 1360, { rows: 1, columnsPerRow: 0 }],
    [1, 1360, { rows: 1, columnsPerRow: 1 }],
    [2, 1360, { rows: 1, columnsPerRow: 2 }],
    [3, 1360, { rows: 1, columnsPerRow: 3 }],
    [6, 1360, { rows: 1, columnsPerRow: 6 }],
    [6, 960,  { rows: 2, columnsPerRow: 3 }],
    [7, 1360, { rows: 2, columnsPerRow: 4 }],
    [7, 960,  { rows: 2, columnsPerRow: 4 }],
  ])('%i groups in %ipx', (n, w, expected) => {
    expect(layoutMegaPanel(n, w)).toEqual(expected);
  });
});
