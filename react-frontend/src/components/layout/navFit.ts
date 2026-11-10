// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * How many of the header's links fit beside its other buttons; the rest go
 * under "More".
 *
 * The count used to come from an estimate alone (about 110px a link, 220px kept
 * for Community and More). At a 1024px window, signed in, the real links were
 * wider: they spilled out of their space and the Create and Notifications
 * buttons covered part of "More" (axe target-size, 10 Nov 2026 — warmth plan
 * W9). The estimate is now only the starting point; the header then measures
 * the links and shows one fewer while they still spill.
 */

/** A first guess from the space the links have. */
export function estimatedNavCount(availableWidth: number): number {
  const itemWidth = 110;
  const reserved = 220;
  return Math.max(1, Math.floor((availableWidth - reserved) / itemWidth));
}

/** One fewer link while they spill out of their space (by more than a rounding pixel). */
export function navCountAfterMeasure(count: number, scrollWidth: number, clientWidth: number): number {
  return scrollWidth > clientWidth + 1 && count > 1 ? count - 1 : count;
}
