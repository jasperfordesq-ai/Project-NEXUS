// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Colours for anything shown without a picture — an offer, an event, a group,
 * a podcast — and for category labels, chosen exactly as the member website
 * chooses them (AWID feedback, Nov 2026: "more vibrant, colorful… clear
 * categories, attractive visuals"), so an item has the same colour on the
 * website and in the app.
 *
 * 🔴 The choosing (HUE_WHEEL, PALETTE_STEPS, the standard accent, `paletteFor`,
 * `colourForSeed`, `themeColourNames`) is a copy of
 * react-frontend/src/lib/categoryColours.ts, and `coverSeed` of
 * react-frontend/src/lib/coverSeeds.ts. `itemColours.parity.test.ts` runs both
 * copies side by side and fails if they ever answer differently. Change the
 * website's copy first, then this one.
 *
 * The website paints with Tailwind classes; a phone needs literal colours. The
 * shades below are Tailwind 4's own (its oklch values converted to sRGB), so
 * the light and dark sets match the website's `band` and `cover` classes:
 *  - band  (labels, figures): -800 text on -100 (light); -300 text on a 15%
 *          -500 tint (dark). `itemColours.contrast.test.ts` checks every one
 *          clears WCAG AA (4.5:1) against the surfaces it is drawn on.
 *  - cover (no picture): -100 → -200 → -300 (light); a -500 tint from 45% to
 *          10% (dark), with the icon in -800 / -200.
 */

/** Tailwind 4 shades, converted from its oklch values. */
const SHADES = {
  red: { 100: '#ffe2e2', 200: '#ffc9c9', 300: '#ffa2a2', 500: '#fb2c36', 800: '#9f0712' },
  orange: { 100: '#ffedd4', 200: '#ffd6a7', 300: '#ffb86a', 500: '#ff6900', 800: '#9f2d00' },
  amber: { 100: '#fef3c6', 200: '#fee685', 300: '#ffd230', 500: '#fe9a00', 800: '#973c00' },
  yellow: { 100: '#fef9c2', 200: '#fff085', 300: '#ffdf20', 500: '#f0b100', 800: '#894b00' },
  green: { 100: '#dcfce7', 200: '#b9f8cf', 300: '#7bf1a8', 500: '#00c950', 800: '#016630' },
  emerald: { 100: '#d0fae5', 200: '#a4f4cf', 300: '#5ee9b5', 500: '#00bc7d', 800: '#006045' },
  teal: { 100: '#cbfbf1', 200: '#96f7e4', 300: '#46ecd5', 500: '#00bba7', 800: '#005f5a' },
  cyan: { 100: '#cefafe', 200: '#a2f4fd', 300: '#53eafd', 500: '#00b8db', 800: '#005f78' },
  sky: { 100: '#dff2fe', 200: '#b8e6fe', 300: '#74d4ff', 500: '#00a6f4', 800: '#00598a' },
  blue: { 100: '#dbeafe', 200: '#bedbff', 300: '#8ec5ff', 500: '#2b7fff', 800: '#193cb8' },
  violet: { 100: '#ede9fe', 200: '#ddd6ff', 300: '#c4b4ff', 500: '#8e51ff', 800: '#5d0ec0' },
  fuchsia: { 100: '#fae8ff', 200: '#f6cfff', 300: '#f4a8ff', 500: '#e12afb', 800: '#8a0194' },
  pink: { 100: '#fce7f3', 200: '#fccee8', 300: '#fda5d5', 500: '#f6339a', 800: '#a3004c' },
  rose: { 100: '#ffe4e6', 200: '#ffccd3', 300: '#ffa1ad', 500: '#ff2056', 800: '#a50036' },
  gray: { 100: '#f3f4f6', 200: '#e5e7eb', 300: '#d1d5dc', 500: '#6a7282', 800: '#1e2939' },
  slate: { 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cad5e2', 500: '#62748e', 800: '#1d293d' },
} as const;

export type ItemColourName = keyof typeof SHADES;

/** The admin's two brand-reserved names map as on the website. */
const ALIASES: Readonly<Record<string, ItemColourName>> = { purple: 'violet', indigo: 'sky' };

export function isKnownColourName(name: string | null | undefined): boolean {
  const key = (name ?? '').trim().toLowerCase();
  return key in SHADES || key in ALIASES;
}

function resolveName(name: string | null | undefined): ItemColourName {
  const key = (name ?? '').trim().toLowerCase();
  if (key in SHADES) return key as ItemColourName;
  return ALIASES[key] ?? 'slate';
}

/** `#rrggbb` + an alpha (0–1) as an `rgba()` React Native understands. */
function withAlpha(hex: string, alpha: number): string {
  const value = parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

export interface BandColours {
  background: string;
  text: string;
}

export interface CoverColours {
  /** Gradient stops, top-left to bottom-right. */
  stops: readonly [string, string, string];
  /** Opacity of each stop (dark covers are a tint over the page). */
  opacities: readonly [number, number, number];
  /** The icon and any words drawn straight on the cover. */
  foreground: string;
  /** The frosted square behind the icon. */
  iconTile: string;
  /** A small solid swatch of the colour. */
  dot: string;
}

/** A soft flat tint with readable text: category labels, figures, initials. */
export function bandColours(name: string | null | undefined, scheme: 'light' | 'dark'): BandColours {
  const shades = SHADES[resolveName(name)];
  return scheme === 'light'
    ? { background: shades[100], text: shades[800] }
    : { background: withAlpha(shades[500], 0.15), text: shades[300] };
}

/** A soft gradient for a card or page with no picture. */
export function coverColours(name: string | null | undefined, scheme: 'light' | 'dark'): CoverColours {
  const shades = SHADES[resolveName(name)];
  return scheme === 'light'
    ? {
        stops: [shades[100], shades[200], shades[300]],
        opacities: [1, 1, 1],
        foreground: shades[800],
        iconTile: 'rgba(255, 255, 255, 0.55)',
        dot: shades[500],
      }
    : {
        stops: [shades[500], shades[500], shades[500]],
        opacities: [0.45, 0.25, 0.1],
        foreground: SHADES_DARK_FOREGROUND[resolveName(name)],
        iconTile: 'rgba(255, 255, 255, 0.05)',
        dot: shades[500],
      };
}

/** -200 shades: the icon colour on a dark cover (the website's dark:text-*-200). */
const SHADES_DARK_FOREGROUND: Readonly<Record<ItemColourName, string>> = Object.fromEntries(
  (Object.keys(SHADES) as ItemColourName[]).map((name) => [name, SHADES[name][200]]),
) as Record<ItemColourName, string>;

// ---------------------------------------------------------------------------
// Choosing a colour — a copy of the website's rules (see the note at the top).
// ---------------------------------------------------------------------------

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

/** The website's standard accent, used when the community has not chosen a colour. */
const STANDARD_ACCENT = '#6366f1';

/**
 * Steps round the wheel from the community's hue: itself, then its opposite,
 * then near neighbours of each, alternating, so cards side by side never look
 * alike while the whole set stays in harmony with the community colour.
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
 * in the order they should be handed out.
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
 * The colour name to show for each theme (listing category), keyed by slug.
 * While every theme still has the database default colour, they are coloured
 * in turn from the community palette; once an admin gives two themes different
 * colours, each shows exactly the colour stored for it.
 */
export function themeColourNames(
  categories: readonly { slug: string; color?: string | null }[],
  accent?: string | null,
): Record<string, string> {
  const stored = categories.map((category) => (category.color ?? '').trim().toLowerCase());
  const allTheSame = new Set(stored).size <= 1;
  const palette = paletteFor(accent);
  const names: Record<string, string> = {};
  categories.forEach((category, index) => {
    names[category.slug] = allTheSame
      ? palette[index % palette.length]!
      : (stored[index] && isKnownColourName(stored[index]) ? stored[index]! : 'slate');
  });
  return names;
}

/**
 * The seed each kind of item's colour is chosen from, so an item has the same
 * colour on its card, its page and on the website.
 *
 * 🔴 `coverSeed` mirrors react-frontend/src/lib/coverSeeds.ts KEY FOR KEY,
 * including its rule (warmth plan W2, 10 Nov 2026): where a list colours its
 * items by category, the item's own page follows its category too; an item
 * with no category keeps a colour of its own. itemColours.parity.test.ts calls
 * every website seed beside this copy and fails when the website adds one the
 * app has not copied. `appSeed` holds the seeds the website still writes
 * inline in its pages (offers, groups, marketplace items).
 */
const lower = (name: string): string => name.trim().toLowerCase();

/** Knowledge-base category. No category is the "general" group, whatever its translated label. */
const kbCategory = (name: string | null | undefined): string =>
  `kb-category-${name && name.trim() !== '' ? lower(name) : 'general'}`;

const volunteeringCategory = (name: string): string => `volunteering-category-${lower(name)}`;

export const coverSeed = {
  /** Courses in one category share a colour; others have their own. */
  course: (course: { id: number | string; category?: { name?: string | null } | null }): string =>
    course.category?.name ? `course-category-${course.category.name.toLowerCase()}` : `course-${course.id}`,
  podcastShow: (slug: string): string => `podcast-show-${slug}`,
  podcastCategory: (name: string): string => `podcast-category-${lower(name)}`,
  jobType: (type: string): string => `job-type-${type}`,
  organisation: (id: number | string): string => `organisation-${id}`,
  volunteeringCategory,
  /** A volunteering role wears its category's colour, as on its card. */
  opportunity: (id: number | string, categoryName?: string | null): string =>
    categoryName && categoryName.trim() !== '' ? volunteeringCategory(categoryName) : `opportunity-${id}`,
  goal: (id: number | string): string => `goal-${id}`,
  idea: (id: number | string): string => `idea-${id}`,
  challenge: (id: number | string): string => `challenge-${id}`,
  campaign: (id: number | string): string => `campaign-${id}`,
  groupExchange: (id: number | string): string => `group-exchange-${id}`,
  kbCategory,
  /** An article wears its knowledge-base category's colour, as in the list. */
  article: (article: { id: number | string; category_name?: string | null }): string =>
    kbCategory(article.category_name),
  /** Events in one category share a colour (events page date tiles, Explore). */
  event: (id: number | string, categoryId?: number | string | null): string =>
    categoryId != null ? `event-category-${categoryId}` : `event-${id}`,
  /** Blog posts in one category share a colour (blog page, Explore). */
  blogPost: (id: number | string, categoryId?: number | string | null): string =>
    categoryId != null ? `category-${categoryId}` : `post-${id}`,
  marketplaceCategory: (slugOrId: number | string): string => `marketplace-${slugOrId}`,
  collection: (id: number | string): string => `collection-${id}`,
  skillsCategory: (name: string): string => `skills-category-${lower(name)}`,
  /** A federated listing's colour follows its category, or its type when it has none. */
  federatedListing: (categoryOrType: string): string => `listing-category-${lower(categoryOrType)}`,
  federatedCommunity: (id: number | string): string => `federated-community-${id}`,
} as const;

/**
 * Seeds the website writes inline in its pages rather than in coverSeeds.ts —
 * the same values, so the colours still agree.
 */
export const appSeed = {
  /** ListingsPage / ListingDetailPage — after the theme's colour (`listingColour`). */
  listing: (id: number | string): string | number => id,
  /** GroupsPage / GroupHeader. */
  group: (id: number | string): string | number => id,
  /** MarketplaceListingCard / MarketplaceListingPage, a photo-less item. */
  marketplaceItem: (id: number | string): string | number => id,
} as const;
