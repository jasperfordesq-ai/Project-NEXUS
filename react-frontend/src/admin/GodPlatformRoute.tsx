// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Route guard for admin pages restricted to a god account that is ALSO a
 * platform super admin — both flags (owner decision 2026-10-18, for the
 * platform Integrations page: outbound webhooks).
 *
 * GodOnlyRoute admits any god; this one also requires `is_super_admin` (or
 * the super_admin role). The sidebar hides the page from everyone else, but a
 * bookmark or pasted URL would still route here, so anyone who fails the
 * check is sent back to the admin dashboard. The server enforces the same
 * rule (`BaseApiController::requireGodPlatformAdmin()`).
 */

import { Navigate, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, useTenant } from '@/contexts';
import { LoadingScreen } from '@/components/feedback';
import { AuthUnavailableScreen } from '@/components/routing/AuthUnavailableScreen';
import { isGodPlatformAdmin } from '@/lib/access';

export function GodPlatformRoute() {
  const { t } = useTranslation('super_admin');
  const { user, isLoading, status } = useAuth();
  const { tenantPath } = useTenant();

  if (isLoading || status === 'loading') {
    return <LoadingScreen message={t('layout.loading')} />;
  }

  if (status === 'unavailable') {
    return <AuthUnavailableScreen />;
  }

  if (!isGodPlatformAdmin(user)) {
    return <Navigate to={tenantPath('/admin')} replace />;
  }

  return <Outlet />;
}

export default GodPlatformRoute;
