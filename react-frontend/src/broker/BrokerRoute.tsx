// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker Route Guard
 * Restricts access to broker + admin/super_admin users.
 * Redirects non-authorized users to the dashboard.
 */

import { Navigate, useLocation, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, useTenant } from '@/contexts';
import { LoadingScreen } from '@/components/feedback';
import { AuthUnavailableScreen } from '@/components/routing/AuthUnavailableScreen';
import { hasBrokerPanelAccess } from '@/lib/access';

export function BrokerRoute() {
  const { t } = useTranslation('broker');
  const { user, isAuthenticated, isLoading, status } = useAuth();
  const { tenantPath } = useTenant();
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

  // Access is role-based only. The panel spans safeguarding, vetting,
  // insurance, member and monitoring tools that are unrelated to exchanges, so
  // it must NOT be gated on the `exchange_workflow` feature. Exchange-specific
  // surfaces (the Exchanges nav item, routes, and the exchange-workflow config
  // card) are individually feature-gated instead — see BrokerSidebar,
  // BrokerRoutes (ExchangeFeatureRoute), and BrokerConfigurationPage.
  if (!hasBrokerPanelAccess(user)) {
    return <Navigate to={tenantPath('/dashboard')} replace />;
  }

  return <Outlet />;
}

export default BrokerRoute;
