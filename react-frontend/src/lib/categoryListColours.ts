// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { themeColourNames } from './categoryColours';

/**
 * The colour of each category in one list (events, blog, help centre,
 * volunteering…), keyed by id as a string — warmth plan W3, 10 Nov 2026.
 *
 * Picking a colour from a category's name or id alone (`colourForSeed`) often
 * gave two categories of the same list one colour: with five categories and
 * eight colours, four lists in five had a repeat. Here the categories share
 * the palette out in id order, so no two match until all eight are used, a
 * category keeps its colour whatever order a page lists it in, and adding a
 * category never recolours the others.
 *
 * As with offer themes (`themeColourNames`), once an admin has given the
 * categories different colours, each shows exactly the colour chosen for it.
 */
export function categoryListColours(
  categories: ReadonlyArray<{ id: number | string; color?: string | null }>,
  accent?: string | null,
): Map<string, string> {
  const inIdOrder = [...categories].sort((a, b) => {
    const left = Number(a.id);
    const right = Number(b.id);
    if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
    return String(a.id).localeCompare(String(b.id));
  });
  const names = themeColourNames(
    inIdOrder.map((category) => ({ slug: String(category.id), color: category.color })),
    accent,
  );
  return new Map(Object.entries(names));
}
