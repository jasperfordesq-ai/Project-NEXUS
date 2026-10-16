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

/**
 * 230px leaves a 150px description area once the column (2×10px), item
 * (2×10px), 30px icon tile and 10px gap are taken out — room for a
 * 45-character description on two lines.
 */
export const MEGA_PANEL_MIN_COLUMN_PX = 230;

/** Space kept clear between the panel and each side of the viewport. */
export const MEGA_PANEL_VIEWPORT_GUTTER_PX = 16;

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
