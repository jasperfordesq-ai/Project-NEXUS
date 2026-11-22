// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Which addresses stay reachable while a community is in maintenance mode.
 *
 * TenantShell shows the maintenance page to everyone who is not an admin, on
 * every address except these and the sign-in pages. The two panels listed
 * here carry their own guards, so keeping the address open lets nobody in who
 * could not get in anyway: it only stops the maintenance page being shown to
 * the people who have to fix whatever the maintenance is for.
 *
 * `/platform-team` is here because TenantShell's "is this an admin?" test reads
 * the role string, and a platform-team account is defined by flags
 * (`is_god` AND super admin) whatever its role says. Without it the health
 * pages would show the maintenance screen exactly when they are needed.
 */
const PANELS_OPEN_DURING_MAINTENANCE = ['admin', 'platform-team'] as const;

function isUnderPanel(panels: readonly string[], pathname: string, slugPrefix?: string | null): boolean {
  const path = pathname.toLowerCase();
  const prefix = slugPrefix ? `/${slugPrefix.toLowerCase()}` : null;

  return panels.some((panel) => {
    const bases = prefix ? [`/${panel}`, `${prefix}/${panel}`] : [`/${panel}`];
    return bases.some((base) => path === base || path.startsWith(`${base}/`));
  });
}

export function staysOpenDuringMaintenance(pathname: string, slugPrefix?: string | null): boolean {
  return isUnderPanel(PANELS_OPEN_DURING_MAINTENANCE, pathname, slugPrefix);
}

/**
 * Which addresses stay reachable while a community is paused for non-payment.
 *
 * The same two panels, plus the super admin panel: a paused parent community's
 * manager must still be able to manage the payment standing of the communities
 * below it (Branch payments lives there), and the panel's API is open for a
 * paused community. The broker panel is not here: a paused community's member
 * side, which is what a broker works on, is closed.
 */
const PANELS_OPEN_WHILE_PAUSED = ['admin', 'platform-team', 'super-admin'] as const;

/**
 * Single pages that stay open while a community is paused, at exactly this
 * address and nothing below it.
 *
 * The newsletter unsubscribe page: a person must always be able to stop
 * emails, whatever the standing of the community that sent them. The link in
 * a newsletter opens this page, and the server keeps the one request it makes
 * open too (CheckBillingLock::OPEN_AT_EXACTLY).
 */
const PAGES_OPEN_WHILE_PAUSED = ['newsletter/unsubscribe'] as const;

function isExactlyPage(pages: readonly string[], pathname: string, slugPrefix?: string | null): boolean {
  const path = pathname.toLowerCase().replace(/\/+$/, '');
  const prefix = slugPrefix ? `/${slugPrefix.toLowerCase()}` : null;

  return pages.some((page) => path === `/${page}` || (prefix !== null && path === `${prefix}/${page}`));
}

export function staysOpenWhilePaused(pathname: string, slugPrefix?: string | null): boolean {
  return (
    isUnderPanel(PANELS_OPEN_WHILE_PAUSED, pathname, slugPrefix) ||
    isExactlyPage(PAGES_OPEN_WHILE_PAUSED, pathname, slugPrefix)
  );
}
