// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

import { Navigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth, useTenant } from '@/contexts';
import { LoadingScreen } from '@/components/feedback';
import { AuthUnavailableScreen } from '@/components/routing/AuthUnavailableScreen';
import { stripTenantSlug } from '@/lib/tenant-routing';
import { hasFullCaringAccess, hasSafeguardingAccess } from './access';

export function CaringRoute() {
  const { user, isAuthenticated, isLoading, status } = useAuth();
  const { tenantPath, tenantSlug, hasFeature } = useTenant();
  const location = useLocation();
  const routePath = tenantSlug
    ? stripTenantSlug(location.pathname, tenantSlug)
    : location.pathname;

  if (isLoading || status === 'loading') {
    return <LoadingScreen />;
  }

  if (status === 'unavailable') {
    return <AuthUnavailableScreen />;
  }

  if (!isAuthenticated) {
    return <Navigate to={tenantPath('/login')} state={{ from: tenantPath(location.pathname) }} replace />;
  }

  const fullAccess = hasFullCaringAccess(user);
  const safeguardingAccess = hasSafeguardingAccess(user);

  if (!safeguardingAccess) {
    return <Navigate to={tenantPath('/dashboard')} replace />;
  }

  if (!fullAccess && !hasFeature('caring_community')) {
    return <Navigate to={tenantPath('/dashboard')} replace />;
  }

  if (!fullAccess) {
    if (!routePath.startsWith('/caring/safeguarding')) {
      return <Navigate to={tenantPath('/caring/safeguarding')} replace />;
    }
  }

  if (!hasFeature('caring_community')) {
    const normalizedRoutePath = routePath.replace(/\/+$/, '') || '/';
    const isCaringOverview =
      normalizedRoutePath === '/caring';

    if (!isCaringOverview) {
      return <Navigate to={tenantPath('/caring')} replace />;
    }
  }

  return <Outlet />;
}

export default CaringRoute;
