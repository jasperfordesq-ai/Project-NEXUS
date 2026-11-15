// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Super panel route guards.
 *
 * `SuperAdminRoute` — entry to the panel. Admits a platform super-admin
 * (whole installation) AND the super-admin of a community that has
 * communities beneath it, who is confined to their own branch by the API.
 *
 * 🔴 There is no second guard any more. `PlatformOnlyRoute` used to guard the
 * platform-wide screens inside this panel (billing, revenue, the federation
 * controls, the provisioning queue, pilot enquiries). Those screens moved to
 * the Platform team panel on 15 Nov 2026, behind `PlatformTeamRoute`; their
 * old addresses here are redirects (`MovedToPlatformTeam from="super-admin"`).
 * Do not restore it: a platform-wide screen goes in `src/platform-team/`.
 */

import { Navigate, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, useTenant } from '@/contexts';
import { LoadingScreen } from '@/components/feedback';
import { AuthUnavailableScreen } from '@/components/routing/AuthUnavailableScreen';
import { canAccessSuperPanel } from '@/lib/access';

export function SuperAdminRoute() {
  const { t } = useTranslation('super_admin');
  const { user, isLoading, status } = useAuth();
  const { tenantPath } = useTenant();

  if (isLoading || status === 'loading') {
    return <LoadingScreen message={t('layout.loading')} />;
  }

  if (status === 'unavailable') {
    return <AuthUnavailableScreen />;
  }

  /*
   * 🔴 Was `isPlatformSuperAdminUser(user)`, which refused tenant super-admins —
   * so once the sidebar started offering them the panel entry, clicking it
   * silently bounced them back to /admin. A dead link is worse than no link.
   *
   * `canAccessSuperPanel` uses the SERVER-resolved level, so it admits exactly
   * who the API will admit: eligibility also requires the community to allow
   * sub-communities and to have a usable position in the hierarchy.
   */
  if (!canAccessSuperPanel(user)) {
    return <Navigate to={tenantPath('/admin')} replace />;
  }

  return <Outlet />;
}

export default SuperAdminRoute;
