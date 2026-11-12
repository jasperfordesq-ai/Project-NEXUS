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

/**
 * Whether the community's VIVID colour strength is showing (warmth phase 5):
 * the community chose it and the member is not in high-contrast mode — the
 * same `showVivid` with which ThemeProvider marks <html
 * data-colour-strength="vivid">. False outside a ThemeProvider. Never throws.
 *
 * Most components follow vivid through the Tailwind `vivid:` variant and need
 * no hook. This is for the few whose vivid fill is a FIXED palette colour — a
 * cover's own colour at full strength, a kind's solid picture tile — which the
 * `vivid:` variant may not paint (vivid-fill.contract.test.ts lets it use only
 * the community's button shade). They choose a finished class set in code;
 * what keeps those readable is pinned by cover-label.contract.test.ts and
 * feedTypeColours.test.ts ("kind tiles in vivid").
 */
export const SiteVividContext = createContext<boolean>(false);

/** True while the community's vivid colour strength is showing. Never throws. */
export function useSiteVivid(): boolean {
  return use(SiteVividContext);
}
