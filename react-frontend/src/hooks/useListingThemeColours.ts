// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { themeColourNames } from '@/lib/categoryColours';
import { useSiteAccent } from '@/contexts/SiteAccentContext';

interface ThemeRow {
  slug: string;
  color?: string | null;
}

/**
 * The colour name of every listing theme, keyed by slug, exactly as the offers
 * page colours its theme tiles and cards (`themeColourNames` with the site's
 * accent). For pages outside the offers page — such as a single offer — so a
 * photo-less offer looks the same there as on its card. The categories request
 * is cached by the API client (five minutes), so this is usually free.
 */
export function useListingThemeColours(): Record<string, string> {
  const siteAccent = useSiteAccent();
  const [themes, setThemes] = useState<ThemeRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    api.get<ThemeRow[]>('/v2/categories?type=listing')
      .then((response) => {
        if (!cancelled && response.success && Array.isArray(response.data)) setThemes(response.data);
      })
      .catch(() => {
        // Without the list the page falls back to the theme's stored colour.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return useMemo(() => themeColourNames(themes, siteAccent), [themes, siteAccent]);
}
