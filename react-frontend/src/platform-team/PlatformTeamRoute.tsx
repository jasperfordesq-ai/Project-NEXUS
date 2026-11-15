// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Guard for the Platform team panel (`/platform-team`).
 *
 * The platform team is `is_god` AND super admin — see `isPlatformTeamUser()`,
 * an exact mirror of the server's check. Every endpoint behind the panel is
 * locked to the same rule on the server (E-128), so this guard decides nothing:
 * it is here so that someone who is not on the team lands on their own panel
 * instead of on a page whose every request is refused.
 *
 * Replaces `GodOnlyRoute` and `GodPlatformRoute`, which guarded these pages one
 * block at a time inside the admin panel.
 */

import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, useTenant } from '@/contexts';
import { LoadingScreen } from '@/components/feedback';
import { AuthUnavailableScreen } from '@/components/routing/AuthUnavailableScreen';
import { hasAdminPanelAccess, hasBrokerPanelAccess, isPlatformTeamUser } from '@/lib/access';
import { buildReturnTarget } from '@/lib/auth-return';

export function PlatformTeamRoute() {
  const { t } = useTranslation('platform_team');
  const { user, isAuthenticated, isLoading, status } = useAuth();
  const { tenantPath } = useTenant();
  const location = useLocation();

  if (isLoading || status === 'loading') {
    return <LoadingScreen message={t('layout.loading')} />;
  }

  if (status === 'unavailable') {
    return <AuthUnavailableScreen />;
  }

  if (!isAuthenticated) {
    // The whole address (query and fragment too) survives sign-in — see lib/auth-return.ts.
    const login = buildReturnTarget(
      tenantPath('/login'),
      tenantPath(location.pathname) + location.search + location.hash,
    );
    return <Navigate to={login.to} state={login.state} replace />;
  }

  if (!isPlatformTeamUser(user)) {
    // Each to the panel they do have, never to a blank page.
    if (hasAdminPanelAccess(user)) return <Navigate to={tenantPath('/admin')} replace />;
    if (hasBrokerPanelAccess(user)) return <Navigate to={tenantPath('/broker')} replace />;
    return <Navigate to={tenantPath('/dashboard')} replace />;
  }

  return <Outlet />;
}

export default PlatformTeamRoute;
