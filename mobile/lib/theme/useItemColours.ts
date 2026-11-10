// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Hooks for the item colours in `itemColours.ts`.
 *
 * 🔴 The palette follows the community's OWN colour (`branding.primary_color`),
 * read raw — never `usePrimaryColor()`, which falls back to the app's blue
 * `#006FEE` when a community has not chosen one. The website falls back to its
 * standard `#6366f1`, whose palette is different, so using the app's fallback
 * would give a colourless community different item colours on the phone.
 *
 * Both hooks are non-throwing: a card rendered without a TenantProvider (most
 * component tests) simply gets the standard palette.
 */

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { getExchangeCategories } from '@/lib/api/exchanges';
import { useOptionalTenantContext } from '@/lib/context/TenantContext';
import { themeStore } from '@/lib/theme/themeStore';
import { appSeed, colourForSeed, paletteFor, themeColourNames } from './itemColours';

/** The colour names that go with the community colour, as on the website. */
export function useItemPalette(): string[] {
  const accent = useOptionalTenantContext()?.tenant?.branding?.primary_color ?? null;
  return paletteFor(accent);
}

/** 'light' or 'dark', whichever is painting now. */
export function useColourScheme(): 'light' | 'dark' {
  return useSyncExternalStore(themeStore.subscribe, themeStore.getSnapshot, themeStore.getSnapshot);
}

interface ThemeRow {
  slug: string;
  color?: string | null;
}

let themesRequest: { key: string; promise: Promise<ThemeRow[]> } | null = null;

/**
 * The colour name of every offer theme (listing category), keyed by slug,
 * exactly as the website's offers page colours its theme tiles and cards. The
 * list is read once per community while the app runs.
 */
export function useListingThemeColours(): Record<string, string> {
  const tenant = useOptionalTenantContext()?.tenant ?? null;
  const accent = tenant?.branding?.primary_color ?? null;
  const key = String(tenant?.id ?? tenant?.slug ?? '');
  const [themes, setThemes] = useState<ThemeRow[]>([]);

  useEffect(() => {
    if (!key) return undefined;
    let cancelled = false;
    if (!themesRequest || themesRequest.key !== key) {
      const promise = getExchangeCategories()
        .then((response) => (Array.isArray(response?.data) ? (response.data as ThemeRow[]) : []))
        .catch(() => {
          // Without the list a card falls back to its own palette colour. Ask again next time.
          if (themesRequest?.key === key) themesRequest = null;
          return [] as ThemeRow[];
        });
      themesRequest = { key, promise };
    }
    void themesRequest.promise.then((rows) => {
      if (!cancelled) setThemes(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return useMemo(() => themeColourNames(themes.filter((row) => typeof row?.slug === 'string'), accent), [themes, accent]);
}

/**
 * The colour an offer or request shows when it has no photo — the website's
 * rule: its theme's colour, else the colour stored on the theme, else one from
 * the palette chosen by its id.
 */
export function listingColour(
  listing: { id: number | string; category_slug?: string | null; category_color?: string | null },
  themeColours: Readonly<Record<string, string>>,
  palette: readonly string[],
): string {
  // Exactly the website's order, so the two agree (an unknown stored name shows
  // as slate on both).
  return (listing.category_slug && themeColours[listing.category_slug])
    || listing.category_color
    || colourForSeed(appSeed.listing(listing.id), palette);
}

/** For tests. */
export function forgetListingThemes(): void {
  themesRequest = null;
}
