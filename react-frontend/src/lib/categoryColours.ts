// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Colour sets for themes (`categories.color`) and for anything shown without
 * a photo: a theme tile, a card's cover, a member's initials. Every class is
 * written out in full so Tailwind generates it.
 *
 * - `dot`: a small solid swatch beside a name (decoration only).
 * - `band`: a soft flat tint with readable text — theme tiles, initials.
 * - `cover`: a soft gradient with readable text — a card or page with no photo.
 * - `vividCover`: `cover` at full strength, for the vivid colour strength.
 *
 * `band` puts the -800 shade on -100 (light) and the -300 shade on a -500/15
 * tint (dark); both clear WCAG AA (4.5:1) for normal text. `cover` is bolder —
 * -100 to -300 in light mode, a -500 tint from 45% to 10% in dark mode — and
 * any words on it sit on their own white / dark pill (see ThemedCover), so it
 * can be colourful without losing readability.
 *
 * Raw `indigo-*` and `purple-*` utilities are reserved for the platform brand
 * (react-frontend/scripts/check-design-tokens.mjs), so the admin's "purple"
 * shows in the near-identical violet shades and "indigo" in sky, which keeps
 * it distinct from "blue".
 */
interface CategoryColourClasses {
  dot: string;
  band: string;
  cover: string;
  /**
   * `cover` at full strength, for a community that chose the VIVID colour
   * strength (warmth phase 5): -400 to -600 in light mode and -700 to -900 in
   * dark (deep enough not to glare on the dark page), solid in both. It carries no words: ThemedCover puts its label on
   * the vivid chip and its picture on an opaque tile, where the text shade
   * (-800 / -200, as on `cover`) colours the picture
   * (src/test/cover-label.contract.test.ts). Chosen with `useSiteVivid()`,
   * not the `vivid:` variant, which may only paint the community's button shade.
   */
  vividCover: string;
}

const CATEGORY_COLOURS: Record<string, CategoryColourClasses> = {
  red: {
    dot: 'bg-red-500',
    band: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
    cover: 'bg-linear-to-br from-red-100 via-red-200 to-red-300 text-red-800 dark:from-red-500/45 dark:via-red-500/25 dark:to-red-500/10 dark:text-red-200',
    vividCover: 'bg-linear-to-br from-red-400 via-red-500 to-red-600 text-red-800 dark:from-red-700 dark:via-red-800 dark:to-red-900 dark:text-red-200',
  },
  orange: {
    dot: 'bg-orange-500',
    band: 'bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300',
    cover: 'bg-linear-to-br from-orange-100 via-orange-200 to-orange-300 text-orange-800 dark:from-orange-500/45 dark:via-orange-500/25 dark:to-orange-500/10 dark:text-orange-200',
    vividCover: 'bg-linear-to-br from-orange-400 via-orange-500 to-orange-600 text-orange-800 dark:from-orange-700 dark:via-orange-800 dark:to-orange-900 dark:text-orange-200',
  },
  amber: {
    dot: 'bg-amber-500',
    band: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
    cover: 'bg-linear-to-br from-amber-100 via-amber-200 to-amber-300 text-amber-800 dark:from-amber-500/45 dark:via-amber-500/25 dark:to-amber-500/10 dark:text-amber-200',
    vividCover: 'bg-linear-to-br from-amber-400 via-amber-500 to-amber-600 text-amber-800 dark:from-amber-700 dark:via-amber-800 dark:to-amber-900 dark:text-amber-200',
  },
  yellow: {
    dot: 'bg-yellow-500',
    band: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300',
    cover: 'bg-linear-to-br from-yellow-100 via-yellow-200 to-yellow-300 text-yellow-800 dark:from-yellow-500/45 dark:via-yellow-500/25 dark:to-yellow-500/10 dark:text-yellow-200',
    vividCover: 'bg-linear-to-br from-yellow-400 via-yellow-500 to-yellow-600 text-yellow-800 dark:from-yellow-700 dark:via-yellow-800 dark:to-yellow-900 dark:text-yellow-200',
  },
  green: {
    dot: 'bg-green-500',
    band: 'bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300',
    cover: 'bg-linear-to-br from-green-100 via-green-200 to-green-300 text-green-800 dark:from-green-500/45 dark:via-green-500/25 dark:to-green-500/10 dark:text-green-200',
    vividCover: 'bg-linear-to-br from-green-400 via-green-500 to-green-600 text-green-800 dark:from-green-700 dark:via-green-800 dark:to-green-900 dark:text-green-200',
  },
  emerald: {
    dot: 'bg-emerald-500',
    band: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
    cover: 'bg-linear-to-br from-emerald-100 via-emerald-200 to-emerald-300 text-emerald-800 dark:from-emerald-500/45 dark:via-emerald-500/25 dark:to-emerald-500/10 dark:text-emerald-200',
    vividCover: 'bg-linear-to-br from-emerald-400 via-emerald-500 to-emerald-600 text-emerald-800 dark:from-emerald-700 dark:via-emerald-800 dark:to-emerald-900 dark:text-emerald-200',
  },
  teal: {
    dot: 'bg-teal-500',
    band: 'bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300',
    cover: 'bg-linear-to-br from-teal-100 via-teal-200 to-teal-300 text-teal-800 dark:from-teal-500/45 dark:via-teal-500/25 dark:to-teal-500/10 dark:text-teal-200',
    vividCover: 'bg-linear-to-br from-teal-400 via-teal-500 to-teal-600 text-teal-800 dark:from-teal-700 dark:via-teal-800 dark:to-teal-900 dark:text-teal-200',
  },
  cyan: {
    dot: 'bg-cyan-500',
    band: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-500/15 dark:text-cyan-300',
    cover: 'bg-linear-to-br from-cyan-100 via-cyan-200 to-cyan-300 text-cyan-800 dark:from-cyan-500/45 dark:via-cyan-500/25 dark:to-cyan-500/10 dark:text-cyan-200',
    vividCover: 'bg-linear-to-br from-cyan-400 via-cyan-500 to-cyan-600 text-cyan-800 dark:from-cyan-700 dark:via-cyan-800 dark:to-cyan-900 dark:text-cyan-200',
  },
  sky: {
    dot: 'bg-sky-500',
    band: 'bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300',
    cover: 'bg-linear-to-br from-sky-100 via-sky-200 to-sky-300 text-sky-800 dark:from-sky-500/45 dark:via-sky-500/25 dark:to-sky-500/10 dark:text-sky-200',
    vividCover: 'bg-linear-to-br from-sky-400 via-sky-500 to-sky-600 text-sky-800 dark:from-sky-700 dark:via-sky-800 dark:to-sky-900 dark:text-sky-200',
  },
  blue: {
    dot: 'bg-blue-500',
    band: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
    cover: 'bg-linear-to-br from-blue-100 via-blue-200 to-blue-300 text-blue-800 dark:from-blue-500/45 dark:via-blue-500/25 dark:to-blue-500/10 dark:text-blue-200',
    vividCover: 'bg-linear-to-br from-blue-400 via-blue-500 to-blue-600 text-blue-800 dark:from-blue-700 dark:via-blue-800 dark:to-blue-900 dark:text-blue-200',
  },
  violet: {
    dot: 'bg-violet-500',
    band: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300',
    cover: 'bg-linear-to-br from-violet-100 via-violet-200 to-violet-300 text-violet-800 dark:from-violet-500/45 dark:via-violet-500/25 dark:to-violet-500/10 dark:text-violet-200',
    vividCover: 'bg-linear-to-br from-violet-400 via-violet-500 to-violet-600 text-violet-800 dark:from-violet-700 dark:via-violet-800 dark:to-violet-900 dark:text-violet-200',
  },
  fuchsia: {
    dot: 'bg-fuchsia-500',
    band: 'bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-300',
    cover: 'bg-linear-to-br from-fuchsia-100 via-fuchsia-200 to-fuchsia-300 text-fuchsia-800 dark:from-fuchsia-500/45 dark:via-fuchsia-500/25 dark:to-fuchsia-500/10 dark:text-fuchsia-200',
    vividCover: 'bg-linear-to-br from-fuchsia-400 via-fuchsia-500 to-fuchsia-600 text-fuchsia-800 dark:from-fuchsia-700 dark:via-fuchsia-800 dark:to-fuchsia-900 dark:text-fuchsia-200',
  },
  pink: {
    dot: 'bg-pink-500',
    band: 'bg-pink-100 text-pink-800 dark:bg-pink-500/15 dark:text-pink-300',
    cover: 'bg-linear-to-br from-pink-100 via-pink-200 to-pink-300 text-pink-800 dark:from-pink-500/45 dark:via-pink-500/25 dark:to-pink-500/10 dark:text-pink-200',
    vividCover: 'bg-linear-to-br from-pink-400 via-pink-500 to-pink-600 text-pink-800 dark:from-pink-700 dark:via-pink-800 dark:to-pink-900 dark:text-pink-200',
  },
  rose: {
    dot: 'bg-rose-500',
    band: 'bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300',
    cover: 'bg-linear-to-br from-rose-100 via-rose-200 to-rose-300 text-rose-800 dark:from-rose-500/45 dark:via-rose-500/25 dark:to-rose-500/10 dark:text-rose-200',
    vividCover: 'bg-linear-to-br from-rose-400 via-rose-500 to-rose-600 text-rose-800 dark:from-rose-700 dark:via-rose-800 dark:to-rose-900 dark:text-rose-200',
  },
  gray: {
    dot: 'bg-gray-500',
    band: 'bg-gray-100 text-gray-800 dark:bg-gray-500/15 dark:text-gray-300',
    cover: 'bg-linear-to-br from-gray-100 via-gray-200 to-gray-300 text-gray-800 dark:from-gray-500/45 dark:via-gray-500/25 dark:to-gray-500/10 dark:text-gray-200',
    vividCover: 'bg-linear-to-br from-gray-400 via-gray-500 to-gray-600 text-gray-800 dark:from-gray-700 dark:via-gray-800 dark:to-gray-900 dark:text-gray-200',
  },
  slate: {
    dot: 'bg-slate-500',
    band: 'bg-slate-100 text-slate-800 dark:bg-slate-500/15 dark:text-slate-300',
    cover: 'bg-linear-to-br from-slate-100 via-slate-200 to-slate-300 text-slate-800 dark:from-slate-500/45 dark:via-slate-500/25 dark:to-slate-500/10 dark:text-slate-200',
    vividCover: 'bg-linear-to-br from-slate-400 via-slate-500 to-slate-600 text-slate-800 dark:from-slate-700 dark:via-slate-800 dark:to-slate-900 dark:text-slate-200',
  },
};

// The admin's two brand-reserved names (see the note at the top).
CATEGORY_COLOURS.purple = CATEGORY_COLOURS.violet!;
CATEGORY_COLOURS.indigo = CATEGORY_COLOURS.sky!;

/** Classes for a colour name; slate for an unknown or missing one. */
export function categoryColour(name?: string | null): CategoryColourClasses {
  return CATEGORY_COLOURS[(name ?? '').toLowerCase()] ?? CATEGORY_COLOURS.slate!;
}

/**
 * The colour wheel the palette is drawn from, in hue order, with the hue
 * (degrees) of each colour's -500 shade. Lime is left out: next to the
 * community colours it read as acid rather than warm.
 */
export const HUE_WHEEL = [
  { name: 'red', hue: 0 },
  { name: 'orange', hue: 25 },
  { name: 'amber', hue: 38 },
  { name: 'yellow', hue: 45 },
  { name: 'green', hue: 142 },
  { name: 'emerald', hue: 160 },
  { name: 'teal', hue: 173 },
  { name: 'cyan', hue: 189 },
  { name: 'sky', hue: 199 },
  { name: 'blue', hue: 217 },
  { name: 'violet', hue: 258 },
  { name: 'fuchsia', hue: 292 },
  { name: 'pink', hue: 330 },
  { name: 'rose', hue: 350 },
] as const;

/** The platform's standard accent, used when no community colour is set. */
const STANDARD_ACCENT = '#6366f1';

/**
 * Steps round the wheel from the community's hue: itself, then its opposite,
 * then near neighbours of each, alternating. Consecutive entries are always
 * far apart, so cards side by side never look alike, while the whole set stays
 * in harmony with the community colour (its own family plus its complement).
 */
const PALETTE_STEPS = [0, 7, 2, 8, -2, 6, 1, -1] as const;

function hueAndSaturation(hex: string): { hue: number; saturation: number } | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1]!, 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  if (delta === 0) return { hue: 0, saturation: 0 };
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue: number;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return { hue: (hue * 60 + 360) % 360, saturation };
}

function nearestWheelIndex(accent?: string | null): number {
  const measured = accent ? hueAndSaturation(accent) : null;
  // A grey community colour has no hue worth following.
  const source = measured && measured.saturation >= 0.15 ? measured : hueAndSaturation(STANDARD_ACCENT)!;
  let best = 0;
  let bestDistance = Infinity;
  HUE_WHEEL.forEach(({ hue }, index) => {
    const raw = Math.abs(hue - source.hue);
    const distance = Math.min(raw, 360 - raw);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}

const paletteCache = new Map<string, string[]>();

/**
 * Eight colour names that go with the community colour (or the standard one),
 * in the order they should be handed out. Follows the colour the site is
 * actually showing, so it changes when an admin picks a new community colour.
 */
export function paletteFor(accent?: string | null): string[] {
  const key = (accent ?? '').toLowerCase();
  const cached = paletteCache.get(key);
  if (cached) return cached;
  const base = nearestWheelIndex(accent);
  const size = HUE_WHEEL.length;
  const palette = PALETTE_STEPS.map((step) => HUE_WHEEL[(((base + step) % size) + size) % size]!.name);
  paletteCache.set(key, palette);
  return palette;
}

/**
 * How far round the wheel the companion colour sits from the community's own
 * hue: two steps, a near neighbour. Close enough that a gradient from one to
 * the other blends (violet into pink, green into teal, red into amber) instead
 * of passing through grey, as a gradient to the opposite colour would.
 */
const COMPANION_STEP = 2;

/**
 * The name of the colour that goes with the community colour: a second,
 * decorative colour for gradients and soft glows (warmth plan P1). Before it,
 * the site's "second colour" was a fixed cyan whatever the community chose.
 */
export function companionColourName(accent?: string | null): string {
  const size = HUE_WHEEL.length;
  return HUE_WHEEL[(nearestWheelIndex(accent) + COMPANION_STEP) % size]!.name;
}

// Tailwind's own colour variables, written out in full so nothing is built at
// run time. tokens.css keeps every one of them in the compiled CSS (Tailwind
// drops theme variables no utility uses) — see its "companion shades" block.
const COMPANION_PAINT: Record<string, { light: string; dark: string }> = {
  red: { light: 'var(--color-red-500)', dark: 'var(--color-red-400)' },
  orange: { light: 'var(--color-orange-500)', dark: 'var(--color-orange-400)' },
  amber: { light: 'var(--color-amber-500)', dark: 'var(--color-amber-400)' },
  yellow: { light: 'var(--color-yellow-500)', dark: 'var(--color-yellow-400)' },
  green: { light: 'var(--color-green-500)', dark: 'var(--color-green-400)' },
  emerald: { light: 'var(--color-emerald-500)', dark: 'var(--color-emerald-400)' },
  teal: { light: 'var(--color-teal-500)', dark: 'var(--color-teal-400)' },
  cyan: { light: 'var(--color-cyan-500)', dark: 'var(--color-cyan-400)' },
  sky: { light: 'var(--color-sky-500)', dark: 'var(--color-sky-400)' },
  blue: { light: 'var(--color-blue-500)', dark: 'var(--color-blue-400)' },
  violet: { light: 'var(--color-violet-500)', dark: 'var(--color-violet-400)' },
  fuchsia: { light: 'var(--color-fuchsia-500)', dark: 'var(--color-fuchsia-400)' },
  pink: { light: 'var(--color-pink-500)', dark: 'var(--color-pink-400)' },
  rose: { light: 'var(--color-rose-500)', dark: 'var(--color-rose-400)' },
};

/**
 * The companion colour as a CSS value for `--companion` (set by ThemeContext).
 * Decoration only: it is never used as text and never carries text.
 * `name` overrides the lookup (tests walk every colour with it).
 */
export function companionPaint(
  accent: string | null | undefined,
  theme: 'light' | 'dark',
  name: string = companionColourName(accent),
): string {
  return (COMPANION_PAINT[name] ?? COMPANION_PAINT.pink!)[theme];
}

// Gradient end stops for the header line, written out so Tailwind sees them.
const LINE_FROM: Record<string, string> = {
  red: 'from-red-500 dark:from-red-400', orange: 'from-orange-500 dark:from-orange-400',
  amber: 'from-amber-500 dark:from-amber-400', yellow: 'from-yellow-500 dark:from-yellow-400',
  green: 'from-green-500 dark:from-green-400', emerald: 'from-emerald-500 dark:from-emerald-400',
  teal: 'from-teal-500 dark:from-teal-400', cyan: 'from-cyan-500 dark:from-cyan-400',
  sky: 'from-sky-500 dark:from-sky-400', blue: 'from-blue-500 dark:from-blue-400',
  violet: 'from-violet-500 dark:from-violet-400', fuchsia: 'from-fuchsia-500 dark:from-fuchsia-400',
  pink: 'from-pink-500 dark:from-pink-400', rose: 'from-rose-500 dark:from-rose-400',
};
const LINE_TO: Record<string, string> = {
  red: 'to-red-500 dark:to-red-400', orange: 'to-orange-500 dark:to-orange-400',
  amber: 'to-amber-500 dark:to-amber-400', yellow: 'to-yellow-500 dark:to-yellow-400',
  green: 'to-green-500 dark:to-green-400', emerald: 'to-emerald-500 dark:to-emerald-400',
  teal: 'to-teal-500 dark:to-teal-400', cyan: 'to-cyan-500 dark:to-cyan-400',
  sky: 'to-sky-500 dark:to-sky-400', blue: 'to-blue-500 dark:to-blue-400',
  violet: 'to-violet-500 dark:to-violet-400', fuchsia: 'to-fuchsia-500 dark:to-fuchsia-400',
  pink: 'to-pink-500 dark:to-pink-400', rose: 'to-rose-500 dark:to-rose-400',
};

/**
 * Gradient classes for the thin line under the site header: from the hue just
 * below the community's on the wheel, through the community colour itself
 * (HeroUI's `accent` token, already lightened for dark mode), to the hue just
 * above. Only the community's own colour family, so it reads as one colour
 * with a little life in it, not a rainbow.
 */
export function accentLineClasses(palette: readonly string[]): string {
  const below = palette[7] ?? palette[0]!;
  const above = palette[6] ?? palette[0]!;
  return `${LINE_FROM[below] ?? 'from-accent'} via-accent ${LINE_TO[above] ?? 'to-accent'}`;
}

/**
 * A stable colour for one item (an id, a name): the same item always gets the
 * same colour, and different items spread across the palette.
 */
export function colourForSeed(seed: string | number, palette: readonly string[]): string {
  const text = String(seed);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return palette[(hash >>> 0) % palette.length]!;
}

/**
 * The colour name to show for each theme, keyed by slug.
 *
 * Every category is created as 'blue' (the database default), so a community
 * that never opened Admin → Categories has nothing but blue themes. While all
 * its themes share one colour, they are coloured in turn from the community
 * palette (`paletteFor`), so they follow the community colour. As soon as an
 * admin gives any two themes different colours, every theme shows exactly the
 * colour stored for it.
 */
export function themeColourNames(
  categories: ReadonlyArray<{ slug: string; color?: string | null }>,
  accent?: string | null,
): Record<string, string> {
  const stored = categories.map((category) => (category.color ?? '').trim().toLowerCase());
  const allTheSame = new Set(stored).size <= 1;
  const palette = paletteFor(accent);
  const names: Record<string, string> = {};
  categories.forEach((category, index) => {
    names[category.slug] = allTheSame
      ? palette[index % palette.length]!
      : (stored[index] && CATEGORY_COLOURS[stored[index]!] ? stored[index]! : 'slate');
  });
  return names;
}
