// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The VIVID colour strength (warmth phase 5): the classes a panel adds so
 * that a community that chose "vivid" gets it FILLED with its colour instead
 * of tinted.
 *
 * They are Tailwind `vivid:` variants (index.css): they do nothing until
 * ThemeContext marks <html data-colour-strength="vivid">, so no hook is needed
 * and a soft community is unchanged.
 *
 * Readability is by construction, for any community colour, light and dark:
 *  - the fill is the button shade (`accent-strong`; `accent-strong-end` is
 *    darker still), the one fill that carries white text at 4.5:1;
 *  - words written straight on the fill are white (`text`);
 *  - anything with colours of its own — buttons, links, chips, a count pill —
 *    sits on an opaque tray of the page's surface (`tray`, `control`), never
 *    on the fill;
 *  - the pale corner glow is hidden: it would lighten the fill under the text.
 * Guarded by src/test/vivid-fill.contract.test.ts.
 *
 * A few vivid fills are a FIXED palette colour, not the community's: a
 * cover's own colour at full strength, a kind's solid picture tile. The
 * `vivid:` variant may not paint those, so the component reads
 * `useSiteVivid()` (contexts/SiteAccentContext) and picks a finished class
 * set; see categoryColours `vividCover` and feedTypeColours `kindTile`.
 *
 * Every value is a complete literal class string so Tailwind generates it.
 */
export const vivid = {
  /** The panel: a diagonal fill; the soft tint underneath is covered by it. */
  panel: 'vivid:bg-linear-to-br vivid:from-accent-strong vivid:to-accent-strong-end',
  /** The pale corner glow would lighten the fill under white text. */
  glow: 'vivid:hidden',
  /** A picture tile on the fill: white, with the picture in the button shade. */
  tile: 'vivid:from-white vivid:to-white vivid:text-accent-strong',
  /** A small label on the fill: a white pill with the button shade as its text. */
  chip: 'vivid:bg-white vivid:text-accent-strong!',
  /** Words written straight on the fill. `!` beats the site's theme text classes. */
  text: 'vivid:text-white!',
  /** A group of controls a page puts on the panel: an opaque tray under them. */
  tray: 'vivid:rounded-2xl vivid:bg-surface vivid:p-2 vivid:shadow-sm',
  /** One control on the panel (a quiet button, a chip): its own opaque surface. */
  control: 'vivid:bg-surface',
  /** A picture tile NOT on a fill (form sections, empty pages): filled, white picture. */
  solidTile: 'vivid:bg-accent-strong vivid:text-white!',
} as const;
