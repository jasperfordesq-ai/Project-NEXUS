// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The cursor for the next page of a one-type search, or null. Laravel returns it
 * in `meta.pagination` since 29 Oct 2026; an "all" search is not paged.
 */
export function searchNextCursor(meta: unknown, filters: { type?: string }): string | null {
  if (!filters.type || filters.type === 'all') return null;
  const pagination = (meta as { pagination?: { has_more?: boolean; cursor?: string | null } } | undefined)?.pagination;
  return pagination?.has_more && pagination.cursor ? pagination.cursor : null;
}
