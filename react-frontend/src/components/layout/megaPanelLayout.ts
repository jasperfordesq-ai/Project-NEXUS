// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Layout rule for the desktop header's mega panel.
 *
 * One column per group. If every group fits in one row at the minimum column
 * width, use one row; otherwise split the groups into two rows of
 * ceil(n / 2) columns, reading left to right then down. Never three rows: the
 * header carries at most seven groups (Main + six), which is 4 + 3.
 */

export const MEGA_PANEL_MIN_COLUMN_PX = 200;

export interface MegaPanelLayout {
  rows: 1 | 2;
  columnsPerRow: number;
}

export function layoutMegaPanel(
  groupCount: number,
  availableWidthPx: number,
  minColumnPx = MEGA_PANEL_MIN_COLUMN_PX,
): MegaPanelLayout {
  if (groupCount <= 0) {
    return { rows: 1, columnsPerRow: 0 };
  }

  if (groupCount * minColumnPx <= availableWidthPx) {
    return { rows: 1, columnsPerRow: groupCount };
  }

  return { rows: 2, columnsPerRow: Math.ceil(groupCount / 2) };
}
