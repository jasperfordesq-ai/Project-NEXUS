// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Data plumbing shared by the member window's record tabs.
 *
 * None of the broker list endpoints (exchanges, message copies, monitoring,
 * risk tags, support needs) accepts a `user_id` filter — verified against
 * `AdminBrokerController` on 2026-10-03 — so each tab fetches the list and
 * keeps the member's rows itself. Paginated lists are read at the server's
 * maximum page size up to `MAX_PAGES`, and the tab says so when the cap was
 * hit, so an older record is never silently missing.
 */

import { useCallback, useEffect, useState } from 'react';

/** Server maximum for `per_page` on the broker lists. */
export const PAGE_SIZE = 100;
/** Pages read before giving up (500 rows). */
export const MAX_PAGES = 5;

export interface PageResult<T> {
  rows: T[];
  hasMore: boolean;
}

/** Read pages 1..MAX_PAGES (or until the list ends) and flatten them. */
export async function collectAllPages<T>(
  fetchPage: (page: number) => Promise<PageResult<T>>,
  maxPages = MAX_PAGES,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const result = await fetchPage(page);
    rows.push(...result.rows);
    if (!result.hasMore || result.rows.length === 0) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

/** Whether a paginated response says a further page exists. */
export function hasMorePages(
  meta: { has_more?: boolean; total_pages?: number; current_page?: number; total?: number } | undefined,
  page: number,
  pageRows: number,
): boolean {
  if (!meta) return pageRows >= PAGE_SIZE;
  if (typeof meta.has_more === 'boolean') return meta.has_more;
  if (typeof meta.total_pages === 'number') return page < meta.total_pages;
  if (typeof meta.total === 'number') return page * PAGE_SIZE < meta.total;
  return pageRows >= PAGE_SIZE;
}

export function asArray<T>(payload: unknown): T[] {
  if (Array.isArray(payload)) return payload as T[];
  if (payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: T[] }).data;
  }
  return [];
}

export interface MemberTabData<T> {
  rows: T[];
  loading: boolean;
  error: boolean;
  /** The page cap was hit, so older records may be missing. */
  truncated: boolean;
  reload: () => void;
}

/**
 * Load one tab's rows for a member. `load` must return the member's rows only
 * (it does the filtering); it may reject or throw on failure.
 */
export function useMemberTabData<T>(
  userId: number | null | undefined,
  load: (userId: number) => Promise<{ rows: T[]; truncated: boolean }>,
): MemberTabData<T> {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (typeof userId !== 'number') {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    load(userId)
      .then((result) => {
        if (cancelled) return;
        setRows(result.rows);
        setTruncated(result.truncated);
      })
      .catch(() => {
        if (cancelled) return;
        setRows([]);
        setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Callers pass a module-level function or a useCallback — never an inline
    // closure — so keying on `load` refetches only when its inputs change.
  }, [userId, tick, load]);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  return { rows, loading, error, truncated, reload };
}
