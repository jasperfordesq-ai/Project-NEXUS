// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { categoryListColours } from '@/lib/categoryListColours';
import { useSiteAccent } from '@/contexts/SiteAccentContext';

interface CategoryRow {
  id: number | string;
  color?: string | null;
}

const FIVE_MINUTES = 5 * 60 * 1000;

/**
 * The colour of each category in one list, by id — distinct within the list
 * (warmth plan W3; see `categoryListColours`). Give it the endpoint that lists
 * the categories (for example `/v2/categories?type=event`), so a page that
 * shows one item colours it exactly as the list page does.
 *
 * Returns undefined for an id the list does not have, and for every id until
 * the list has loaded or when it cannot be loaded: callers fall back to the
 * item's own seed colour (`coverSeed`). The response is cached for five
 * minutes, so pages sharing a list ask once.
 */
export function useCategoryListColours(path: string | null): (id?: number | string | null) => string | undefined {
  const accent = useSiteAccent();
  const [rows, setRows] = useState<CategoryRow[]>([]);

  useEffect(() => {
    if (!path) return undefined;
    let cancelled = false;
    // Promise.resolve().then: a failure of any kind, even a synchronous one,
    // only leaves the seed colours in place.
    Promise.resolve()
      .then(() => api.get<CategoryRow[]>(path, { cacheTtlMs: FIVE_MINUTES }))
      .then((response) => {
        if (!cancelled && response?.success && Array.isArray(response.data)) setRows(response.data);
      })
      .catch(() => {
        // Without the list, each item keeps its own seed colour.
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  const colours = useMemo(() => categoryListColours(rows, accent), [rows, accent]);

  return useCallback(
    (id?: number | string | null) => (id == null ? undefined : colours.get(String(id))),
    [colours],
  );
}
