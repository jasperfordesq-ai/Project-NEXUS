// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Super Admin Routes
 * The super admin panel: communities, hierarchy, users, bulk operations and
 * the audit log, each confined by the server to the caller's own branch. The
 * platform-wide screens moved to the Platform team panel on 15 Nov 2026 and
 * are redirects here.
 */

import { Suspense, lazy } from 'react';
import type { ReactNode } from 'react';
import { Navigate, Route, useParams } from 'react-router-dom';
import { LoadingScreen } from '@/components/feedback';
import { useTenant } from '@/contexts';
import { MovedToPlatformTeam } from '@/platform-team/MovedToPlatformTeam';

const SuperDashboard = lazy(() => import('@/admin/modules/super/SuperDashboard'));
const TenantListAdmin = lazy(() => import('@/admin/modules/super/TenantList'));
const TenantForm = lazy(() => import('@/admin/modules/super/TenantForm'));
const TenantShow = lazy(() => import('@/admin/modules/super/TenantShow'));
const TenantHierarchy = lazy(() => import('@/admin/modules/super/TenantHierarchy'));
const SuperUserList = lazy(() => import('@/admin/modules/super/SuperUserList'));
const SuperUserForm = lazy(() => import('@/admin/modules/super/SuperUserForm'));
const UserShow = lazy(() => import('@/admin/modules/super/UserShow'));
const BulkOperations = lazy(() => import('@/admin/modules/super/BulkOperations'));
const SuperAuditLog = lazy(() => import('@/admin/modules/super/SuperAuditLog'));
const BranchPayments = lazy(() => import('@/admin/modules/super/BranchPayments'));
const FederationTenantFeatures = lazy(() => import('@/admin/modules/super/FederationTenantFeatures'));

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<LoadingScreen />}>{children}</Suspense>;
}

function SuperAdminNotFoundRedirect() {
  const { tenantPath } = useTenant();
  return <Navigate to={tenantPath('/super-admin')} replace />;
}

function SuperAdminTenantFeatureRedirect() {
  const { tenantPath } = useTenant();
  const { tenantId } = useParams();
  return <Navigate to={tenantPath(`/super-admin/federation/tenant/${tenantId ?? ''}/features`)} replace />;
}

export function SuperAdminRoutes() {
  return (
    <>
      <Route index element={<Lazy><SuperDashboard /></Lazy>} />
      <Route path="tenants" element={<Lazy><TenantListAdmin /></Lazy>} />
      <Route path="tenants/create" element={<Lazy><TenantForm /></Lazy>} />
      <Route path="tenants/hierarchy" element={<Lazy><TenantHierarchy /></Lazy>} />
      <Route path="tenants/:id" element={<Lazy><TenantShow /></Lazy>} />
      <Route path="tenants/:id/edit" element={<Lazy><TenantForm /></Lazy>} />
      <Route path="users" element={<Lazy><SuperUserList /></Lazy>} />
      <Route path="users/create" element={<Lazy><SuperUserForm /></Lazy>} />
      <Route path="users/:id" element={<Lazy><UserShow /></Lazy>} />
      <Route path="users/:id/edit" element={<Lazy><SuperUserForm /></Lazy>} />
      <Route path="bulk" element={<Lazy><BulkOperations /></Lazy>} />
      <Route path="audit" element={<Lazy><SuperAuditLog /></Lazy>} />
      <Route path="branch-payments" element={<Lazy><BranchPayments /></Lazy>} />

      {/* Per-community federation feature toggles are subtree-scoped by the API
          (canAccessTenant), so a tenant super admin may use them. */}
      <Route path="federation/tenant/:tenantId/features" element={<Lazy><FederationTenantFeatures /></Lazy>} />
      <Route path="tenants/:tenantId/features" element={<SuperAdminTenantFeatureRedirect />} />

      {/*
        🔴 The platform-wide screens are NOT in this panel any more (owner, 15 Nov
        2026: "Yes, move it"). They live in the Platform team panel under the same
        address tails, and these are redirects so an old bookmark still works.

        MovedToPlatformTeam sends the platform team to the new address, and
        anyone else in this panel — a tenant super admin, or a global super admin
        who is not on the platform team — to this panel's home page, never to a
        blank page. This panel now holds only what is confined to the caller's
        own branch. A platform-wide screen belongs in
        src/platform-team/PlatformTeamRoutes.tsx, not here.
      */}
      <Route path="federation" element={<MovedToPlatformTeam from="super-admin" />} />
      <Route path="federation/whitelist" element={<MovedToPlatformTeam from="super-admin" />} />
      <Route path="federation/partnerships" element={<MovedToPlatformTeam from="super-admin" />} />
      <Route path="federation/audit" element={<MovedToPlatformTeam from="super-admin" />} />
      <Route path="billing" element={<MovedToPlatformTeam from="super-admin" />} />
      <Route path="billing/revenue" element={<MovedToPlatformTeam from="super-admin" />} />
      <Route path="platform/pilot-inquiries" element={<MovedToPlatformTeam from="super-admin" />} />
      <Route path="platform/translation" element={<MovedToPlatformTeam from="super-admin" />} />
      <Route path="provisioning-requests" element={<MovedToPlatformTeam from="super-admin" />} />
      <Route path="national/kiss" element={<MovedToPlatformTeam from="super-admin" />} />
      <Route path="regional-analytics/subscriptions" element={<MovedToPlatformTeam from="super-admin" />} />

      <Route path="*" element={<SuperAdminNotFoundRedirect />} />
    </>
  );
}

export default SuperAdminRoutes;
