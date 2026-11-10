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
 * The last list seen for each endpoint, kept in this browser so a later visit
 * colours its items before the list arrives (without it, a cover could show
 * its fallback colour and then change). Only category ids and colour names —
 * public data — are kept. Ids are unique across communities, so a list kept
 * for one community never gives another's categories a colour.
 */
const STORAGE_PREFIX = 'nexus_category_list_colours:';

function rememberedRows(path: string | null): CategoryRow[] {
  if (!path) return [];
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_PREFIX + path) ?? 'null');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((row): row is CategoryRow =>
      row !== null && typeof row === 'object' && (typeof row.id === 'number' || typeof row.id === 'string'));
  } catch {
    return [];
  }
}

function remember(path: string, rows: CategoryRow[]): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + path, JSON.stringify(rows.map((row) => ({ id: row.id, color: row.color ?? null }))));
  } catch {
    // Storage full or blocked: the next visit simply waits for the list.
  }
}

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
  const [loaded, setLoaded] = useState<{ path: string | null; rows: CategoryRow[] }>(() => ({ path, rows: rememberedRows(path) }));
  const rows = loaded.path === path ? loaded.rows : rememberedRows(path);

  useEffect(() => {
    if (!path) return undefined;
    let cancelled = false;
    // Promise.resolve().then: a failure of any kind, even a synchronous one,
    // only leaves the seed colours in place.
    Promise.resolve()
      .then(() => api.get<CategoryRow[]>(path, { cacheTtlMs: FIVE_MINUTES }))
      .then((response) => {
        if (!cancelled && response?.success && Array.isArray(response.data)) {
          setLoaded({ path, rows: response.data });
          remember(path, response.data);
        }
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
