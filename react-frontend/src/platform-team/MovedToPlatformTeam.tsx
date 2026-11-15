// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Redirect for a page that moved from the admin (or super admin) panel into
 * the Platform team panel, keeping the SAME address tail.
 *
 * `/admin/deliverability/edit/12?tab=notes#x` becomes
 * `/platform-team/deliverability/edit/12?tab=notes#x`: the record id, the
 * query string and the fragment all survive, so an old bookmark or a link in
 * an old email lands on the same record. (`TenantRedirect` and friends drop
 * the query and the fragment, which is why this does not reuse them.)
 *
 * The target is behind PlatformTeamRoute, so someone who is not on the
 * platform team is sent on to their own panel from there.
 *
 * `from` is the panel segment the page used to live under. The pathname may
 * or may not carry the community slug (TenantShell strips it inside the app's
 * routes; a test router does not), so the segment is found wherever it is.
 */

import { Navigate, useLocation } from 'react-router-dom';
import { useTenant } from '@/contexts';

export function movedAddressTail(pathname: string, from: 'admin' | 'super-admin'): string {
  const match = pathname.match(new RegExp(`^(?:.*?)/${from}(/.*)?$`));
  return (match?.[1] ?? '').replace(/\/+$/, '');
}

export function MovedToPlatformTeam({ from = 'admin' }: { from?: 'admin' | 'super-admin' }) {
  const { tenantPath } = useTenant();
  const location = useLocation();
  const tail = movedAddressTail(location.pathname, from);

  return (
    <Navigate
      to={{
        pathname: tenantPath(`/platform-team${tail}`),
        search: location.search,
        hash: location.hash,
      }}
      replace
    />
  );
}

export default MovedToPlatformTeam;
