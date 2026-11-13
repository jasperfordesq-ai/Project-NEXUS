// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Is the router's current pathname on (or under) a panel page?
 *
 * `path` is the bare panel path ("/partner-timebanks/webhooks").
 *
 * The comparison has to accept BOTH forms of the current pathname. On a
 * shared host the address carries the community's slug
 * ("/hour-timebank/partner-timebanks/…"), but TenantShell renders the app's
 * routes with the slug STRIPPED, so `useLocation()` inside the panel returns
 * "/partner-timebanks/…". On a community's own domain there is no slug at
 * all. `tenantPath()` always re-adds the slug on a shared host.
 *
 * Until November 2026 the Partner Timebanks, broker and admin sidebars (and
 * the broker panel's jurisdiction notice) compared `useLocation().pathname`
 * with `tenantPath(path)` only, so on every slug address (localhost and the
 * shared app host) no link was ever marked as the current page.
 *
 * A match is the page itself or a `/`-delimited descendant — a bare prefix
 * match would light "/partner-timebanks/api-keys" for a sibling whose path
 * merely starts with the same characters.
 */
export function isOnPanelPath(
  pathname: string,
  path: string,
  tenantPath: (path: string) => string,
  options: { exact?: boolean } = {},
): boolean {
  const current = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return [path, tenantPath(path)].some(
    (target) => current === target || (!options.exact && current.startsWith(target + '/')),
  );
}
