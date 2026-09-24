// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Partner Timebanks Route Guard
 * Any admin can open the panel (overview, partnerships, directory,
 * activity). The sensitive setup surfaces are individually gated to
 * super admins in routes.tsx/PartnersSidebar. Members are bounced to
 * the member dashboard; unauthenticated users go to login.
 */

import { Navigate, useLocation, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, useTenant } from '@/contexts';
import { LoadingScreen } from '@/components/feedback';
import { AuthUnavailableScreen } from '@/components/routing/AuthUnavailableScreen';
import { hasPartnerPanelAccess, isSuperAdminUser } from '@/lib/access';

export function PartnersRoute() {
  const { t } = useTranslation('partners');
  const { user, isAuthenticated, isLoading, status } = useAuth();
  const { tenantPath, hasFeature } = useTenant();
  const location = useLocation();

  if (isLoading || status === 'loading') {
    return <LoadingScreen message={t('checking_permissions')} />;
  }

  if (status === 'unavailable') {
    return <AuthUnavailableScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to={tenantPath('/login')} state={{ from: tenantPath(location.pathname) }} replace />;
  }

  // Any admin may enter; the setup/plumbing pages inside are gated to
  // super admins individually (see hasPartnerPanelAccess for the rule).
  if (!hasPartnerPanelAccess(user)) {
    return <Navigate to={tenantPath('/dashboard')} replace />;
  }

  // The panel is pointless when it would render empty: no partnering surface
  // at all, or — for ordinary admins — a tenant whose only surfaces
  // (partner_api / caring_community) are super-admin-only plumbing.
  const anyVisibleSurface =
    hasFeature('federation') ||
    (isSuperAdminUser(user) && (hasFeature('partner_api') || hasFeature('caring_community')));
  if (!anyVisibleSurface) {
    return <Navigate to={tenantPath('/admin')} replace />;
  }

  return <Outlet />;
}

export default PartnersRoute;
