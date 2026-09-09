// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * How far the app lets the operating system's text-size setting grow a given piece of text.
 *
 * 🔴 Why caps exist at all, and why they are high. Android offers font scales up to 2.0 and
 * iOS's accessibility sizes go further still. Body text should follow them all the way —
 * that is the whole point of the setting, and capping ordinary prose would be taking the
 * feature away from the people who need it. What cannot follow them is text in a container
 * whose height is decided by something other than the text: a tab bar the navigator sizes,
 * a single-line title in a row beside two buttons. Those clip, and a clipped label is worse
 * for a low-vision member than a slightly smaller one.
 *
 * So the rule is narrow: cap only where the container cannot grow, cap as high as the
 * container allows, and leave everything else alone. Audit 2026-09-09, item 3.
 */

/**
 * Single-line text in a row that also holds controls — screen titles, button labels.
 *
 * 1.6 rather than something smaller because both survive it: `AppTopBar`'s title has
 * `numberOfLines={1}` and truncates rather than pushing its buttons off the row, and a
 * button grows with its label.
 */
export const CHROME_MAX_FONT_SCALE = 1.6;

/**
 * Tab-bar labels, whose row height the navigator fixes.
 *
 * 1.3 is what a five-tab bar can show on a 360dp screen before "Messages" truncates to
 * nothing useful; the bar's height grows to match (see app/(tabs)/_layout.tsx). The icon
 * above each label carries the meaning when the word does not fit.
 */
export const TAB_LABEL_MAX_FONT_SCALE = 1.3;
