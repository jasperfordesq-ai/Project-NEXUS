// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Tailwind classes for a category's colour (`categories.color`, one of the
 * names an admin picks in Admin → Categories). Every class is written out in
 * full so Tailwind generates it.
 *
 * - `dot`: a small solid swatch beside the category name (decoration only).
 * - `band`: a soft tinted panel with readable text. Light mode uses the -800
 *   shade on -100 and dark mode the -300 shade on a -500/15 tint; both pairs
 *   clear WCAG AA (4.5:1) for normal text.
 */
interface CategoryColourClasses {
  dot: string;
  band: string;
}

const CATEGORY_COLOURS: Record<string, CategoryColourClasses> = {
  blue: { dot: 'bg-blue-500', band: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300' },
  red: { dot: 'bg-red-500', band: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300' },
  green: { dot: 'bg-green-500', band: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300' },
  orange: { dot: 'bg-orange-500', band: 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300' },
  purple: { dot: 'bg-purple-500', band: 'bg-purple-100 text-purple-800 dark:bg-purple-500/15 dark:text-purple-300' },
  pink: { dot: 'bg-pink-500', band: 'bg-pink-100 text-pink-800 dark:bg-pink-500/15 dark:text-pink-300' },
  yellow: { dot: 'bg-yellow-500', band: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300' },
  teal: { dot: 'bg-teal-500', band: 'bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300' },
  indigo: { dot: 'bg-indigo-500', band: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300' },
  cyan: { dot: 'bg-cyan-500', band: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300' },
  fuchsia: { dot: 'bg-fuchsia-500', band: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-300' },
  gray: { dot: 'bg-gray-500', band: 'bg-gray-100 text-gray-800 dark:bg-gray-500/15 dark:text-gray-300' },
  slate: { dot: 'bg-slate-500', band: 'bg-slate-100 text-slate-800 dark:bg-slate-500/15 dark:text-slate-300' },
};

/** Classes for a category colour name; slate for an unknown or missing one. */
export function categoryColour(name?: string | null): CategoryColourClasses {
  return CATEGORY_COLOURS[(name ?? '').toLowerCase()] ?? CATEGORY_COLOURS.slate!;
}

/**
 * Colours handed out in turn when a community has not coloured its themes.
 * Neighbouring entries are far apart in hue so adjacent themes never look
 * alike. Slate is left out: it is the "unknown colour" grey.
 */
export const THEME_ROTATION = [
  'blue', 'orange', 'teal', 'pink', 'purple', 'green', 'yellow', 'cyan', 'red', 'indigo', 'fuchsia',
] as const;

/**
 * The colour name to show for each theme, keyed by slug.
 *
 * Every category is created as 'blue' (the database default), so a community
 * that never opened Admin → Categories has nothing but blue themes. While all
 * its themes share one colour, they are given different colours in turn, in
 * the order given. As soon as an admin gives any two themes different colours,
 * every theme shows exactly the colour stored for it.
 */
export function themeColourNames(categories: ReadonlyArray<{ slug: string; color?: string | null }>): Record<string, string> {
  const stored = categories.map((category) => (category.color ?? '').trim().toLowerCase());
  const allTheSame = new Set(stored).size <= 1;
  const names: Record<string, string> = {};
  categories.forEach((category, index) => {
    names[category.slug] = allTheSame
      ? THEME_ROTATION[index % THEME_ROTATION.length]!
      : (stored[index] && CATEGORY_COLOURS[stored[index]!] ? stored[index]! : 'slate');
  });
  return names;
}
