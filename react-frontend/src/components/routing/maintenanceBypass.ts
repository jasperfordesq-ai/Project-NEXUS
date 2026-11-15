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

export function staysOpenDuringMaintenance(pathname: string, slugPrefix?: string | null): boolean {
  const path = pathname.toLowerCase();
  const prefix = slugPrefix ? `/${slugPrefix.toLowerCase()}` : null;

  return PANELS_OPEN_DURING_MAINTENANCE.some((panel) => {
    const bases = prefix ? [`/${panel}`, `${prefix}/${panel}`] : [`/${panel}`];
    return bases.some((base) => path === base || path.startsWith(`${base}/`));
  });
}
