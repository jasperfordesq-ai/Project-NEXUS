// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Where an old safeguarding link should land.
 *
 * Safeguarding was one page with four tabs (`?tab=`) until October 2026; each
 * tab became its own page, and the flagged-messages tab was then merged into
 * the Messages queue, which lists the same message copies. Old links — the
 * broker dashboard's tiles, emails, bell notifications, bookmarks, the help
 * guide — still carry `?tab=` and `?filter=`, so map them onto the new pages
 * and keep what they asked for. With nothing to go on, land on Members'
 * support needs, the first safeguarding page.
 *
 * Returns a tenant-relative path; the caller applies tenantPath().
 */

/** Old flagged-messages `?filter=` → the Messages queue's `?status=`. */
const FLAGGED_FILTER_TO_STATUS: Record<string, string | null> = {
  unreviewed: null, // Messages' default view
  critical: 'urgent',
  reviewed: 'reviewed',
  all: 'all',
};

function isOldFlaggedFilter(filter: string): boolean {
  return Object.prototype.hasOwnProperty.call(FLAGGED_FILTER_TO_STATUS, filter);
}

/** The Messages queue view an old flagged-messages link asked for. */
export function flaggedMessagesTarget(filter: string | null): string {
  const status = filter !== null && isOldFlaggedFilter(filter) ? FLAGGED_FILTER_TO_STATUS[filter] ?? null : null;
  return status ? `/broker/messages?status=${status}` : '/broker/messages';
}

export function safeguardingRedirectTarget(search: string): string {
  const params = new URLSearchParams(search);
  const tab = params.get('tab');
  const filter = params.get('filter');

  if (tab === 'flagged' || (tab === null && filter !== null && isOldFlaggedFilter(filter))) {
    return flaggedMessagesTarget(filter);
  }

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
  } else {
    page = 'support-needs';
  }

  const query = params.toString();
  return `/broker/safeguarding/${page}${query ? `?${query}` : ''}`;
}
