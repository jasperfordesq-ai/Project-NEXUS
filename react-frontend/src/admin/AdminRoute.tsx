// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Route Guard
 * Restricts access to admin/super_admin/god users only.
 * Redirects non-admins to the dashboard.
 */

import { Navigate, useLocation, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, useTenant } from '@/contexts';
import { LoadingScreen } from '@/components/feedback';
import { AuthUnavailableScreen } from '@/components/routing/AuthUnavailableScreen';
import { hasAdminPanelAccess } from '@/lib/access';
import { buildLoginTarget } from '@/lib/auth-return';

export function AdminRoute() {
  const { user, isAuthenticated, isLoading, status } = useAuth();
  const { tenantPath } = useTenant();
  const location = useLocation();
  const { t } = useTranslation('admin_nav');

  if (isLoading || status === 'loading') {
    return <LoadingScreen message={t('checking_permissions')} />;
  }

  if (status === 'unavailable') {
    return <AuthUnavailableScreen />;
  }

  if (!isAuthenticated) {
    // The whole address (query and fragment too) survives sign-in — see lib/auth-return.ts.
    const login = buildLoginTarget(tenantPath('/login'), tenantPath(location.pathname) + location.search + location.hash);
    return <Navigate to={login.to} state={login.state} replace />;
  }

  const isAdmin = hasAdminPanelAccess(user);

  if (!isAdmin) {
    return <Navigate to={tenantPath('/dashboard')} replace />;
  }

  return <Outlet />;
}

export default AdminRoute;
