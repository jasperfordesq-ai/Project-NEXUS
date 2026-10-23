// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/** Lower-case and drop all whitespace, so "TimeBank  Ireland" matches "timebank ireland". */
function normalise(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/\s+/g, '');
}

/**
 * Join a page title and the site name as "Page | Site".
 *
 * The suffix is skipped when the page title already names the community —
 * either the site name or the branding name — compared case- and
 * whitespace-insensitively. Until 2026-10-23 every title was suffixed blindly,
 * so crawler copies read "About TimeBank Ireland | TimeBank Ireland".
 *
 * With no page title, the site name alone is the title.
 */
export function joinTitle(
  title: string | null | undefined,
  siteName: string,
  brandingName?: string | null,
): string {
  const page = (title ?? '').trim();
  if (!page) return siteName;

  const haystack = normalise(page);
  const names = [siteName, brandingName].map(normalise).filter((name) => name.length > 0);
  if (names.some((name) => haystack.includes(name))) return page;

  return siteName ? `${page} | ${siteName}` : page;
}
