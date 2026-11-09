// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { createContext, use } from 'react';
import { paletteFor } from '@/lib/categoryColours';

/**
 * The accent colour the site is showing right now — the member's own choice,
 * else the community colour, else the standard one — as ThemeProvider works
 * it out (`effectiveAccent`). Null outside a ThemeProvider.
 *
 * Its own module, not part of ThemeContext, on purpose: many tests replace
 * '@/contexts/ThemeContext' wholesale, and shared components that follow the
 * site colour (avatars, covers, the header line) must keep working there,
 * simply with the standard palette.
 */
export const SiteAccentContext = createContext<string | null>(null);

/** The site's current accent colour, or null outside a ThemeProvider. Never throws. */
export function useSiteAccent(): string | null {
  return use(SiteAccentContext);
}

/** The colour names that go with the site's colour (see `paletteFor`). */
export function useSitePalette(): string[] {
  return paletteFor(useSiteAccent());
}
