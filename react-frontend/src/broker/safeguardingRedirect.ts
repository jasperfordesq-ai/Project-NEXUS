// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Where a bare /broker/safeguarding link should land.
 *
 * Safeguarding was one page with four tabs (`?tab=`) until October 2026; each
 * tab is now its own page. Old links — the broker dashboard's tiles, emails,
 * bookmarks, the help guide — still carry `?tab=` and `?filter=`, so map them
 * onto the new pages and keep the filter. With nothing to go on, land on
 * Members' support needs, the first safeguarding page.
 *
 * Returns a tenant-relative path; the caller applies tenantPath().
 */
export function safeguardingRedirectTarget(search: string): string {
  const params = new URLSearchParams(search);
  const tab = params.get('tab');
  const filter = params.get('filter');
  params.delete('tab');

  let page: string;
  if (tab === 'preferences') {
    page = 'support-needs';
    // The old dashboard tile drill-down; the new page's full list is "show=all".
    if (filter === 'triggers') {
      params.delete('filter');
      params.set('show', 'all');
    }
  } else if (tab === 'assignments' || tab === 'guardians') {
    page = 'guardians';
  } else if (tab === 'support') {
    page = 'support-actions';
  } else if (tab === 'flagged' || filter === 'unreviewed' || filter === 'critical' || filter === 'reviewed') {
    page = 'flagged-messages';
  } else {
    page = 'support-needs';
  }

  const query = params.toString();
  return `/broker/safeguarding/${page}${query ? `?${query}` : ''}`;
}
