// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Route guard for admin pages restricted to god accounts.
 *
 * The sidebar hides these pages from everyone else, but a hidden nav item is a
 * convention, not a control: a bookmark or pasted URL would still route to the
 * page. Anyone who is not a god is sent back to the admin dashboard.
 *
 * Currently wraps the Communications section (email settings, email
 * deliverability, deliverability), the Performance page, the whole Growth &
 * Discovery section (SEO overview, SEO audit, URL redirects, Search Analytics,
 * Prerender Engine, 404 error tracking) and the Cron Jobs pages — owner
 * decisions 2026-10-02 — and the
 * platform-maintenance tools (tests, seed generator, WebP converter, blog
 * restore; F-534).
 */

import { Navigate, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, useTenant } from '@/contexts';
import { LoadingScreen } from '@/components/feedback';
import { AuthUnavailableScreen } from '@/components/routing/AuthUnavailableScreen';
import { isGodUser } from '@/lib/access';

export function GodOnlyRoute() {
  const { t } = useTranslation('super_admin');
  const { user, isLoading, status } = useAuth();
  const { tenantPath } = useTenant();

  if (isLoading || status === 'loading') {
    return <LoadingScreen message={t('layout.loading')} />;
  }

  if (status === 'unavailable') {
    return <AuthUnavailableScreen />;
  }

  if (!isGodUser(user)) {
    return <Navigate to={tenantPath('/admin')} replace />;
  }

  return <Outlet />;
}

export default GodOnlyRoute;
