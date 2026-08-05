// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Super Admin Routes
 * Platform-wide administration routes rendered inside the dedicated
 * super-admin layout.
 */

import { Suspense, lazy } from 'react';
import type { ReactNode } from 'react';
import { Navigate, Route, useParams } from 'react-router-dom';
import { LoadingScreen } from '@/components/feedback';
import { useTenant } from '@/contexts';
import { PlatformOnlyRoute } from '@/admin/SuperAdminRoute';

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
const FederationControls = lazy(() => import('@/admin/modules/super/FederationControls'));
const FederationWhitelist = lazy(() => import('@/admin/modules/super/FederationWhitelist'));
const SuperPartnerships = lazy(() => import('@/admin/modules/super/SuperPartnerships'));
const FederationAuditLog = lazy(() => import('@/admin/modules/super/FederationAuditLog'));
const FederationTenantFeatures = lazy(() => import('@/admin/modules/super/FederationTenantFeatures'));
const BillingControl = lazy(() => import('@/admin/modules/billing/BillingControl'));
const RevenueDashboard = lazy(() => import('@/admin/modules/billing/RevenueDashboard'));
const PilotInquiryAdminPage = lazy(() => import('@/admin/modules/super/PilotInquiryAdminPage'));
const ProvisioningRequestsPage = lazy(() => import('@/admin/modules/provisioning/ProvisioningRequestsPage'));
const NationalKissDashboardPage = lazy(() => import('@/admin/modules/national/NationalKissDashboardPage'));
const RegionalAnalyticsAdminPage = lazy(() => import('@/admin/modules/regional-analytics/RegionalAnalyticsAdminPage'));

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

      {/* Per-community federation feature toggles are subtree-scoped by the API
          (canAccessTenant), so a branch admin may use them. */}
      <Route path="federation/tenant/:tenantId/features" element={<Lazy><FederationTenantFeatures /></Lazy>} />
      <Route path="tenants/:tenantId/features" element={<SuperAdminTenantFeatureRedirect />} />

      {/*
        🔴 PLATFORM-ONLY screens. Hiding these from the sidebar is not enough — a
        bookmark, a pasted URL or a stale link routes straight here, and the page
        then fires requests the API refuses one by one, which looks broken rather
        than refused. PlatformOnlyRoute sends a branch admin back to the panel
        dashboard instead.

        The API remains the authority: these endpoints sit behind
        EnsureIsSuperAdmin, which refuses tenant super-admins, and
        RegionalPanelIsolationTest proves it. This guard is about refusing
        cleanly. If you add a platform-wide screen, add it INSIDE this block.
      */}
      <Route element={<PlatformOnlyRoute />}>
        <Route path="federation" element={<Lazy><FederationControls /></Lazy>} />
        <Route path="federation/whitelist" element={<Lazy><FederationWhitelist /></Lazy>} />
        <Route path="federation/partnerships" element={<Lazy><SuperPartnerships /></Lazy>} />
        <Route path="federation/audit" element={<Lazy><FederationAuditLog /></Lazy>} />
        <Route path="billing" element={<Lazy><BillingControl /></Lazy>} />
        <Route path="billing/revenue" element={<Lazy><RevenueDashboard /></Lazy>} />
        <Route path="platform/pilot-inquiries" element={<Lazy><PilotInquiryAdminPage /></Lazy>} />
        <Route path="provisioning-requests" element={<Lazy><ProvisioningRequestsPage /></Lazy>} />
        <Route path="national/kiss" element={<Lazy><NationalKissDashboardPage /></Lazy>} />
        <Route path="regional-analytics/subscriptions" element={<Lazy><RegionalAnalyticsAdminPage /></Lazy>} />
      </Route>

      <Route path="*" element={<SuperAdminNotFoundRedirect />} />
    </>
  );
}

export default SuperAdminRoutes;
