// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Super panel route guards.
 *
 * 🔴 The panel has TWO tiers, and so do these guards:
 *
 *   - `SuperAdminRoute` — entry to the panel. Admits a platform super-admin
 *     (whole installation) AND the super-admin of a community that has
 *     communities beneath it, who is confined to their own branch by the API.
 *
 *   - `PlatformOnlyRoute` — the platform-wide screens inside it: billing and
 *     platform revenue, the federation controls, platform capabilities, the
 *     provisioning queue and pilot enquiries. Platform super-admins only.
 *
 * Why both are needed. The panel's sidebar hides the platform-only sections from
 * a branch admin, but a hidden nav item is a convention, not a control: a
 * bookmark, a pasted URL or a stale link still routes straight to the page, which
 * then fires API calls that are refused one by one and looks broken. The API is
 * the authority — it is tiered and tested — so nothing leaks either way. These
 * guards are about refusing cleanly instead of failing messily.
 */

import { Navigate, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth, useTenant } from '@/contexts';
import { LoadingScreen } from '@/components/feedback';
import { canAccessSuperPanel, superPanelLevel } from '@/lib/access';

export function SuperAdminRoute() {
  const { t } = useTranslation('super_admin');
  const { user, isLoading, status } = useAuth();
  const { tenantPath } = useTenant();

  if (isLoading || status === 'loading') {
    return <LoadingScreen message={t('layout.loading')} />;
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

/**
 * Guard for the platform-wide screens inside the panel.
 *
 * Fail closed: requires an explicit 'master'. A branch admin — or anyone whose
 * level cannot be established — is sent to the panel dashboard rather than shown
 * a page whose every request will be refused.
 */
export function PlatformOnlyRoute() {
  const { t } = useTranslation('super_admin');
  const { user, isLoading, status } = useAuth();
  const { tenantPath } = useTenant();

  if (isLoading || status === 'loading') {
    return <LoadingScreen message={t('layout.loading')} />;
  }

  if (superPanelLevel(user) !== 'master') {
    return <Navigate to={tenantPath('/super-admin')} replace />;
  }

  return <Outlet />;
}

export default SuperAdminRoute;
