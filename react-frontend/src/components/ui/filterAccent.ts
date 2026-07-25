// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * filterAccent — per-page accent palettes shared by the mobile filter primitives
 * (`MobileFilterBar`, `FilterChipGroup`, `FilterSheet`).
 *
 * Tailwind cannot build class names at runtime, so every entry below is a
 * COMPLETE, literal class string. Add a new accent by adding a whole record —
 * never by interpolating a hue into a template literal, or the classes will be
 * missing from the production CSS.
 *
 * - `accent` is the default and follows the tenant theme accent token. It is the
 *   verbatim palette the Feed ships today.
 * - `emerald` is the verbatim palette Listings ships today.
 * - `indigo` is an alias of `accent`: `PublicPageHero`'s "indigo" accent is
 *   itself the theme accent (see `accentClasses.indigo` there), so pages that
 *   pass `accent="indigo"` to the hero get a matching filter bar.
 *
 * Accent names intentionally mirror `PublicPageHero`'s `accent` prop so a page
 * can pass the same literal to both.
 */

export type FilterAccent =
  | 'accent'
  | 'emerald'
  | 'amber'
  | 'blue'
  | 'indigo'
  | 'rose'
  | 'violet';

export interface FilterAccentClasses {
  /** Sticky-bar "Filters" button while at least one filter is applied (solid fill). */
  filtersButtonActive: string;
  /** Sticky-bar "Filters" button with nothing applied (outlined + accent hover). */
  filtersButtonIdle: string;
  /** Removable applied-filter chip in the sticky bar's chip row. */
  appliedChip: string;
  /** Hover + selected colours for a `FilterChipGroup` chip. */
  chip: string;
  /** `FilterSheet` footer primary (apply) button. */
  applyButton: string;
  /** Text-only accent action, e.g. a chip group's "Show all (42)". */
  linkAction: string;
}

const THEME_ACCENT: FilterAccentClasses = {
  filtersButtonActive: 'bg-accent text-white shadow-sm',
  filtersButtonIdle:
    'border border-theme-default bg-theme-elevated text-theme-muted transition-colors hover:bg-accent/5 hover:text-accent',
  appliedChip: 'bg-accent/15 text-accent transition-colors hover:bg-accent/25',
  chip: 'hover:bg-accent/5 hover:text-accent data-[selected=true]:bg-accent',
  applyButton: 'bg-accent text-white shadow-sm hover:bg-accent/90',
  linkAction: 'text-accent hover:bg-accent/10',
};

/**
 * Light-mode chip text uses the -800 shade, not -600: on the soft -500/15 tint
 * the -600 shade falls below WCAG AA 4.5:1 for this 12px text (the same axe
 * finding that drove `BADGE_TONES` in ListingsPage). Dark mode keeps -300.
 */
export const FILTER_ACCENT_CLASSES: Record<FilterAccent, FilterAccentClasses> = {
  accent: THEME_ACCENT,
  indigo: THEME_ACCENT,
  emerald: {
    filtersButtonActive: 'bg-emerald-600 text-white shadow-sm',
    filtersButtonIdle:
      'border border-theme-default bg-theme-elevated text-theme-muted transition-colors hover:bg-emerald-500/10 hover:text-emerald-600',
    appliedChip:
      'bg-emerald-500/15 text-emerald-800 transition-colors hover:bg-emerald-500/25 dark:text-emerald-300',
    chip: 'hover:bg-emerald-500/10 hover:text-emerald-600 data-[selected=true]:bg-emerald-600',
    applyButton: 'bg-emerald-600 text-white shadow-sm hover:bg-emerald-700',
    linkAction: 'text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400',
  },
  amber: {
    filtersButtonActive: 'bg-amber-600 text-white shadow-sm',
    filtersButtonIdle:
      'border border-theme-default bg-theme-elevated text-theme-muted transition-colors hover:bg-amber-500/10 hover:text-amber-600',
    appliedChip:
      'bg-amber-500/15 text-amber-800 transition-colors hover:bg-amber-500/25 dark:text-amber-300',
    chip: 'hover:bg-amber-500/10 hover:text-amber-600 data-[selected=true]:bg-amber-600',
    applyButton: 'bg-amber-600 text-white shadow-sm hover:bg-amber-700',
    linkAction: 'text-amber-600 hover:bg-amber-500/10 dark:text-amber-400',
  },
  blue: {
    filtersButtonActive: 'bg-blue-600 text-white shadow-sm',
    filtersButtonIdle:
      'border border-theme-default bg-theme-elevated text-theme-muted transition-colors hover:bg-blue-500/10 hover:text-blue-600',
    appliedChip:
      'bg-blue-500/15 text-blue-800 transition-colors hover:bg-blue-500/25 dark:text-blue-300',
    chip: 'hover:bg-blue-500/10 hover:text-blue-600 data-[selected=true]:bg-blue-600',
    applyButton: 'bg-blue-600 text-white shadow-sm hover:bg-blue-700',
    linkAction: 'text-blue-600 hover:bg-blue-500/10 dark:text-blue-400',
  },
  rose: {
    filtersButtonActive: 'bg-rose-600 text-white shadow-sm',
    filtersButtonIdle:
      'border border-theme-default bg-theme-elevated text-theme-muted transition-colors hover:bg-rose-500/10 hover:text-rose-600',
    appliedChip:
      'bg-rose-500/15 text-rose-800 transition-colors hover:bg-rose-500/25 dark:text-rose-300',
    chip: 'hover:bg-rose-500/10 hover:text-rose-600 data-[selected=true]:bg-rose-600',
    applyButton: 'bg-rose-600 text-white shadow-sm hover:bg-rose-700',
    linkAction: 'text-rose-600 hover:bg-rose-500/10 dark:text-rose-400',
  },
  violet: {
    filtersButtonActive: 'bg-violet-600 text-white shadow-sm',
    filtersButtonIdle:
      'border border-theme-default bg-theme-elevated text-theme-muted transition-colors hover:bg-violet-500/10 hover:text-violet-600',
    appliedChip:
      'bg-violet-500/15 text-violet-800 transition-colors hover:bg-violet-500/25 dark:text-violet-300',
    chip: 'hover:bg-violet-500/10 hover:text-violet-600 data-[selected=true]:bg-violet-600',
    applyButton: 'bg-violet-600 text-white shadow-sm hover:bg-violet-700',
    linkAction: 'text-violet-600 hover:bg-violet-500/10 dark:text-violet-400',
  },
};

/** Resolve an accent name to its class record (defaults to the theme accent). */
export function filterAccentClasses(accent: FilterAccent = 'accent'): FilterAccentClasses {
  return FILTER_ACCENT_CLASSES[accent] ?? FILTER_ACCENT_CLASSES.accent;
}
