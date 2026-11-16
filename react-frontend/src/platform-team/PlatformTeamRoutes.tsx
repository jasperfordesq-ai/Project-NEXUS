// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Platform team panel — every route under `/platform-team`.
 *
 * Called as `{PlatformTeamRoutes()}` inside the guard and the layout
 * (PlatformTeamApp.tsx), the way SuperAdminRoutes is. Everything here is
 * already behind PlatformTeamRoute, so no route needs its own guard, and every
 * endpoint these pages call is locked to the platform team on the server
 * (tests/Laravel/Feature/Security/PlatformTeamLocks).
 *
 * 🔴 Each page keeps the SAME address tail it had under `/admin` or
 * `/super-admin` (owner-approved design, 15 Nov 2026): `/admin/cron-jobs/logs`
 * is `/platform-team/cron-jobs/logs`, `/super-admin/billing/revenue` is
 * `/platform-team/billing/revenue`. The old addresses stay in `admin/routes.tsx`
 * and `super-admin/SuperAdminRoutes.tsx` as redirects (MovedToPlatformTeam),
 * so a bookmark still lands on the same record. Keep the two in step:
 * platform-team-routes.test.tsx drives both tables and fails when they differ.
 *
 * The page components stay in `src/admin/modules/` and are imported from
 * there; nothing was rewritten to move them.
 */

import { lazy, Suspense } from 'react';
import { Navigate, Route } from 'react-router-dom';
import { LoadingScreen } from '@/components/feedback/LoadingScreen';
import { PlatformTeamIndex } from './PlatformTeamIndex';

// The panel's front page: health at a glance (phase 3).
const PlatformTeamHome = lazy(() => import('./pages/PlatformTeamHome'));
// Pages written for the panel itself (not moved in from another panel).
const FailedJobsPage = lazy(() => import('./pages/FailedJobsPage'));
const PhoneAppPage = lazy(() => import('./pages/PhoneAppPage'));
const SeniorAccountsPage = lazy(() => import('./pages/SeniorAccountsPage'));
const FindAccountPage = lazy(() => import('./pages/FindAccountPage'));
const SecurityPage = lazy(() => import('./pages/SecurityPage'));
const CommunitiesAtAGlancePage = lazy(() => import('./pages/CommunitiesAtAGlancePage'));
const CommunityHealthPage = lazy(() => import('./pages/CommunityHealthPage'));
const CommunitySetupPage = lazy(() => import('./pages/CommunitySetupPage'));
const PlatformNoticesPage = lazy(() => import('./pages/PlatformNoticesPage'));
const UsagePage = lazy(() => import('./pages/UsagePage'));
const UnfinishedFeaturesPage = lazy(() => import('./pages/UnfinishedFeaturesPage'));

const MenusAdmin = lazy(() => import('@/admin/modules/content/MenusAdmin'));
const MenuBuilder = lazy(() => import('@/admin/modules/content/MenuBuilder'));
const EmailSettings = lazy(() => import('@/admin/modules/advanced/EmailSettings'));
const EmailDeliverability = lazy(() => import('@/admin/modules/advanced/EmailDeliverability'));
const DeliverabilityDashboard = lazy(() => import('@/admin/modules/deliverability/DeliverabilityDashboard'));
const DeliverablesList = lazy(() => import('@/admin/modules/deliverability/DeliverablesList'));
const CreateDeliverable = lazy(() => import('@/admin/modules/deliverability/CreateDeliverable'));
const EditDeliverable = lazy(() => import('@/admin/modules/deliverability/EditDeliverable'));
const DeliverabilityAnalytics = lazy(() => import('@/admin/modules/deliverability/DeliverabilityAnalytics'));
const RegionalAnalyticsPage = lazy(() => import('@/admin/modules/analytics/RegionalAnalyticsPage'));
const PerformanceDashboard = lazy(() => import('@/admin/modules/performance/PerformanceDashboard'));
const SeoAudit = lazy(() => import('@/admin/modules/advanced/SeoAudit'));
const Redirects = lazy(() => import('@/admin/modules/advanced/Redirects'));
const PrerenderAdmin = lazy(() => import('@/admin/modules/advanced/prerender/PrerenderAdmin'));
const Error404Tracking = lazy(() => import('@/admin/modules/advanced/Error404Tracking'));
const SearchAnalytics = lazy(() => import('@/admin/modules/analytics/SearchAnalytics'));
const PlansAdmin = lazy(() => import('@/admin/modules/content/PlansAdmin'));
const PlanForm = lazy(() => import('@/admin/modules/content/PlanForm'));
const SubscriptionsAdmin = lazy(() => import('@/admin/modules/content/Subscriptions'));
const RegistrationPolicySettings = lazy(() => import('@/admin/modules/system/RegistrationPolicySettings'));
const CronJobs = lazy(() => import('@/admin/modules/system/CronJobs'));
const CronJobLogs = lazy(() => import('@/admin/modules/system/CronJobLogs'));
const CronJobSettings = lazy(() => import('@/admin/modules/system/CronJobSettings'));
const CronJobSetup = lazy(() => import('@/admin/modules/system/CronJobSetup'));
const EnterpriseDashboard = lazy(() => import('@/admin/modules/enterprise/EnterpriseDashboard'));
const RoleList = lazy(() => import('@/admin/modules/enterprise/RoleList'));
const RoleForm = lazy(() => import('@/admin/modules/enterprise/RoleForm'));
const PermissionBrowser = lazy(() => import('@/admin/modules/enterprise/PermissionBrowser'));
const SystemMonitoring = lazy(() => import('@/admin/modules/enterprise/SystemMonitoring'));
const HealthCheck = lazy(() => import('@/admin/modules/enterprise/HealthCheck'));
const ErrorLogs = lazy(() => import('@/admin/modules/enterprise/ErrorLogs'));
const LogFiles = lazy(() => import('@/admin/modules/enterprise/LogFiles'));
const LogFileViewer = lazy(() => import('@/admin/modules/enterprise/LogFileViewer'));
const SystemRequirements = lazy(() => import('@/admin/modules/enterprise/SystemRequirements'));
const OutboundWebhooks = lazy(() => import('@/admin/modules/integrations/OutboundWebhooks'));
const MatchingDiagnostic = lazy(() => import('@/admin/modules/diagnostics/MatchingDiagnostic'));
const MatchDebugPanel = lazy(() => import('@/admin/modules/advanced/MatchDebugPanel'));
const TestRunner = lazy(() => import('@/admin/modules/system/TestRunner'));
// Phase 2 — the platform-wide half of the super admin panel (same tails as
// they had under /super-admin), and Platform capabilities from the admin panel.
const FederationControls = lazy(() => import('@/admin/modules/super/FederationControls'));
const FederationWhitelist = lazy(() => import('@/admin/modules/super/FederationWhitelist'));
const SuperPartnerships = lazy(() => import('@/admin/modules/super/SuperPartnerships'));
const FederationAuditLog = lazy(() => import('@/admin/modules/super/FederationAuditLog'));
const BillingControl = lazy(() => import('@/admin/modules/billing/BillingControl'));
const RevenueDashboard = lazy(() => import('@/admin/modules/billing/RevenueDashboard'));
const PilotInquiryAdminPage = lazy(() => import('@/admin/modules/super/PilotInquiryAdminPage'));
const PlatformTranslationKeyPage = lazy(() => import('@/admin/modules/super/PlatformTranslationKeyPage'));
const ProvisioningRequestsPage = lazy(() => import('@/admin/modules/provisioning/ProvisioningRequestsPage'));
const NationalKissDashboardPage = lazy(() => import('@/admin/modules/national/NationalKissDashboardPage'));
const RegionalAnalyticsAdminPage = lazy(() => import('@/admin/modules/regional-analytics/RegionalAnalyticsAdminPage'));
const PlatformCapabilities = lazy(() => import('@/admin/modules/advanced/PlatformCapabilities'));

function Lazy({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<LoadingScreen />}>{children}</Suspense>;
}

export function PlatformTeamRoutes() {
  return (
    <>
      <Route index element={<Lazy><PlatformTeamHome /></Lazy>} />

      <Route path="failed-jobs" element={<Lazy><FailedJobsPage /></Lazy>} />
      <Route path="phone-app" element={<Lazy><PhoneAppPage /></Lazy>} />
      <Route path="senior-accounts" element={<Lazy><SeniorAccountsPage /></Lazy>} />
      <Route path="accounts" element={<Lazy><FindAccountPage /></Lazy>} />
      <Route path="security" element={<Lazy><SecurityPage /></Lazy>} />
      <Route path="communities" element={<Lazy><CommunitiesAtAGlancePage /></Lazy>} />
      <Route path="community-health" element={<Lazy><CommunityHealthPage /></Lazy>} />
      <Route path="community-setup" element={<Lazy><CommunitySetupPage /></Lazy>} />
      <Route path="notices" element={<Lazy><PlatformNoticesPage /></Lazy>} />
      <Route path="usage" element={<Lazy><UsagePage /></Lazy>} />
      <Route path="unfinished-features" element={<Lazy><UnfinishedFeaturesPage /></Lazy>} />

      <Route path="menus" element={<Lazy><MenusAdmin /></Lazy>} />
      <Route path="menus/builder/:id" element={<Lazy><MenuBuilder /></Lazy>} />
      <Route path="email-settings" element={<Lazy><EmailSettings /></Lazy>} />
      <Route path="email-deliverability" element={<Lazy><EmailDeliverability /></Lazy>} />
      <Route path="deliverability" element={<Lazy><DeliverabilityDashboard /></Lazy>} />
      <Route path="deliverability/list" element={<Lazy><DeliverablesList /></Lazy>} />
      <Route path="deliverability/create" element={<Lazy><CreateDeliverable /></Lazy>} />
      <Route path="deliverability/edit/:id" element={<Lazy><EditDeliverable /></Lazy>} />
      <Route path="deliverability/analytics" element={<Lazy><DeliverabilityAnalytics /></Lazy>} />
      <Route path="analytics/regional" element={<Lazy><RegionalAnalyticsPage /></Lazy>} />
      <Route path="performance" element={<Lazy><PerformanceDashboard /></Lazy>} />
      <Route path="seo/audit" element={<Lazy><SeoAudit /></Lazy>} />
      <Route path="seo/redirects" element={<Lazy><Redirects /></Lazy>} />
      <Route path="seo/prerender" element={<Lazy><PrerenderAdmin /></Lazy>} />
      <Route path="404-errors" element={<Lazy><Error404Tracking /></Lazy>} />
      <Route path="search-analytics" element={<Lazy><SearchAnalytics /></Lazy>} />
      <Route path="plans" element={<Lazy><PlansAdmin /></Lazy>} />
      <Route path="plans/create" element={<Lazy><PlanForm /></Lazy>} />
      <Route path="plans/edit/:id" element={<Lazy><PlanForm /></Lazy>} />
      <Route path="plans/subscriptions" element={<Lazy><SubscriptionsAdmin /></Lazy>} />
      <Route path="settings/registration-policy" element={<Lazy><RegistrationPolicySettings /></Lazy>} />
      <Route path="cron-jobs" element={<Lazy><CronJobs /></Lazy>} />
      <Route path="cron-jobs/logs" element={<Lazy><CronJobLogs /></Lazy>} />
      <Route path="cron-jobs/settings" element={<Lazy><CronJobSettings /></Lazy>} />
      <Route path="cron-jobs/setup" element={<Lazy><CronJobSetup /></Lazy>} />
      <Route path="enterprise" element={<Lazy><EnterpriseDashboard /></Lazy>} />
      <Route path="enterprise/roles" element={<Lazy><RoleList /></Lazy>} />
      <Route path="enterprise/roles/create" element={<Lazy><RoleForm /></Lazy>} />
      <Route path="enterprise/roles/:id" element={<Lazy><RoleForm /></Lazy>} />
      <Route path="enterprise/roles/:id/edit" element={<Lazy><RoleForm /></Lazy>} />
      <Route path="enterprise/permissions" element={<Lazy><PermissionBrowser /></Lazy>} />
      <Route path="enterprise/monitoring" element={<Lazy><SystemMonitoring /></Lazy>} />
      <Route path="enterprise/monitoring/health" element={<Lazy><HealthCheck /></Lazy>} />
      <Route path="enterprise/monitoring/logs" element={<Lazy><ErrorLogs /></Lazy>} />
      <Route path="enterprise/monitoring/log-files" element={<Lazy><LogFiles /></Lazy>} />
      <Route path="enterprise/monitoring/log-files/:filename" element={<Lazy><LogFileViewer /></Lazy>} />
      <Route path="enterprise/monitoring/requirements" element={<Lazy><SystemRequirements /></Lazy>} />
      {/* The "Integrations" breadcrumb links here; webhooks is its only page. */}
      <Route path="integrations" element={<Navigate to="webhooks" replace />} />
      <Route path="integrations/webhooks" element={<Lazy><OutboundWebhooks /></Lazy>} />
      <Route path="matching-diagnostic" element={<Lazy><MatchingDiagnostic /></Lazy>} />
      <Route path="match-debug" element={<Lazy><MatchDebugPanel /></Lazy>} />
      <Route path="tests" element={<Lazy><TestRunner /></Lazy>} />

      {/* Moved from the super admin panel (phase 2). "/platform-team/billing" is the
          PLATFORM's billing control; a community's own billing page stays at
          "/admin/billing". The per-community federation switches
          ("/super-admin/federation/tenant/:id/features") did not move. */}
      <Route path="federation" element={<Lazy><FederationControls /></Lazy>} />
      <Route path="federation/whitelist" element={<Lazy><FederationWhitelist /></Lazy>} />
      <Route path="federation/partnerships" element={<Lazy><SuperPartnerships /></Lazy>} />
      <Route path="federation/audit" element={<Lazy><FederationAuditLog /></Lazy>} />
      <Route path="billing" element={<Lazy><BillingControl /></Lazy>} />
      <Route path="billing/revenue" element={<Lazy><RevenueDashboard /></Lazy>} />
      <Route path="platform/pilot-inquiries" element={<Lazy><PilotInquiryAdminPage /></Lazy>} />
      <Route path="platform/translation" element={<Lazy><PlatformTranslationKeyPage /></Lazy>} />
      <Route path="provisioning-requests" element={<Lazy><ProvisioningRequestsPage /></Lazy>} />
      <Route path="national/kiss" element={<Lazy><NationalKissDashboardPage /></Lazy>} />
      <Route path="regional-analytics/subscriptions" element={<Lazy><RegionalAnalyticsAdminPage /></Lazy>} />
      <Route path="platform-capabilities" element={<Lazy><PlatformCapabilities /></Lazy>} />

      <Route path="*" element={<PlatformTeamIndex notFound />} />
    </>
  );
}

export default PlatformTeamRoutes;
