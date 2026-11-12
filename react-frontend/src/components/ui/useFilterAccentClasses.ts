// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCommunityAccent } from '@/contexts/ThemeContext';
import { filterAccentClasses, type FilterAccent, type FilterAccentClasses } from './filterAccent';

/**
 * The filter colours a page should show right now.
 *
 * Each directory page has its own filter colour (offers green, events amber,
 * jobs blue…). Once a community has chosen its own colour, every page's
 * filters follow it instead — the same switch `PublicPageHero` makes for the
 * header above them, so header and filters are never two different colours.
 * Without a choice, each page keeps its colour.
 *
 * Never throws: outside a ThemeProvider it returns the page colour.
 */
export function useFilterAccentClasses(accent: FilterAccent = 'accent'): FilterAccentClasses {
  const communityAccent = useCommunityAccent();
  return filterAccentClasses(communityAccent ? 'accent' : accent);
}
