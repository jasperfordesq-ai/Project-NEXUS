// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * The Platform team panel's route table, and the old `/admin/...` addresses
 * that now forward into it (E-128). Drives the REAL admin and panel route
 * tables with stand-in pages, so a page that is mounted in one and forgotten
 * in the other fails here.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('@/components/feedback', () => ({
  LoadingScreen: ({ message }: { message?: string }) => <div>{message || 'Loading'}</div>,
}));
vi.mock('@/components/feedback/LoadingScreen', () => ({
  LoadingScreen: ({ message }: { message?: string }) => <div>{message || 'Loading'}</div>,
}));
vi.mock('@/components/routing/AuthUnavailableScreen', () => ({
  AuthUnavailableScreen: () => <div>auth-unavailable</div>,
}));

const tenant = {
  tenant: { id: 2, name: 'Test Community', slug: 'test', configuration: {} },
  tenantSlug: 'test',
  hasFeature: () => true,
  hasModule: () => true,
  tenantPath: (path: string) => `/test${path}`,
};

const PLATFORM_TEAM = { id: 1, role: 'super_admin', is_god: true, is_super_admin: true };
const COMMUNITY_ADMIN = { id: 2, role: 'admin' };

const auth = vi.hoisted(() => ({ user: { id: 1 } as Record<string, unknown> }));

vi.mock('@/contexts', () => ({
  useAuth: () => ({ user: auth.user, isAuthenticated: true, isLoading: false, status: 'authenticated' }),
  useTenant: () => tenant,
}));
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => tenant }));
vi.mock('@/hooks', () => ({ usePageTitle: vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, ready: true, i18n: { language: 'en' } }),
}));

// Stand-ins for every page these cases can land on, so nothing fetches.
vi.mock('./pages/PlatformTeamHome', () => ({ default: () => <div>page:PlatformTeamHome</div> }));
vi.mock('./pages/FailedJobsPage', () => ({ default: () => <div>page:FailedJobsPage</div> }));
vi.mock('./pages/DeploymentsPage', () => ({ default: () => <div>page:DeploymentsPage</div> }));
vi.mock('./pages/RecentErrorsPage', () => ({ default: () => <div>page:RecentErrorsPage</div> }));
vi.mock('./pages/SearchRebuildPage', () => ({ default: () => <div>page:SearchRebuildPage</div> }));
vi.mock('./pages/DomainsPage', () => ({ default: () => <div>page:DomainsPage</div> }));
vi.mock('./pages/ConnectionsPage', () => ({ default: () => <div>page:ConnectionsPage</div> }));
vi.mock('./pages/PhoneAppPage', () => ({ default: () => <div>page:PhoneAppPage</div> }));
vi.mock('./pages/SeniorAccountsPage', () => ({ default: () => <div>page:SeniorAccountsPage</div> }));
vi.mock('./pages/FindAccountPage', () => ({ default: () => <div>page:FindAccountPage</div> }));
vi.mock('./pages/AccessReviewPage', () => ({ default: () => <div>page:AccessReviewPage</div> }));
vi.mock('./pages/SecurityPage', () => ({ default: () => <div>page:SecurityPage</div> }));
vi.mock('./pages/CommunitiesAtAGlancePage', () => ({ default: () => <div>page:CommunitiesAtAGlancePage</div> }));
vi.mock('./pages/CommunityHealthPage', () => ({ default: () => <div>page:CommunityHealthPage</div> }));
vi.mock('./pages/CommunitySetupPage', () => ({ default: () => <div>page:CommunitySetupPage</div> }));
vi.mock('./pages/PlatformNoticesPage', () => ({ default: () => <div>page:PlatformNoticesPage</div> }));
vi.mock('./pages/UsagePage', () => ({ default: () => <div>page:UsagePage</div> }));
vi.mock('./pages/UnfinishedFeaturesPage', () => ({ default: () => <div>page:UnfinishedFeaturesPage</div> }));
vi.mock('./pages/DataRequestsPage', () => ({ default: () => <div>page:DataRequestsPage</div> }));
vi.mock('./pages/LegalDocumentsPage', () => ({ default: () => <div>page:LegalDocumentsPage</div> }));
vi.mock('./pages/CleanUpJobsPage', () => ({ default: () => <div>page:CleanUpJobsPage</div> }));
vi.mock('./pages/PushNotificationsPage', () => ({ default: () => <div>page:PushNotificationsPage</div> }));
vi.mock('./pages/TranslationsPage', () => ({ default: () => <div>page:TranslationsPage</div> }));
vi.mock('./pages/AgreementsPage', () => ({ default: () => <div>page:AgreementsPage</div> }));
vi.mock('./pages/AssuranceFactsPage', () => ({ default: () => <div>page:AssuranceFactsPage</div> }));
vi.mock('@/admin/modules/content/MenusAdmin', () => ({ default: () => <div>page:MenusAdmin</div> }));
vi.mock('@/admin/modules/content/MenuBuilder', () => ({ default: () => <div>page:MenuBuilder</div> }));
vi.mock('@/admin/modules/advanced/EmailSettings', () => ({ default: () => <div>page:EmailSettings</div> }));
vi.mock('@/admin/modules/advanced/EmailDeliverability', () => ({ default: () => <div>page:EmailDeliverability</div> }));
vi.mock('@/admin/modules/deliverability/DeliverabilityDashboard', () => ({ default: () => <div>page:DeliverabilityDashboard</div> }));
vi.mock('@/admin/modules/deliverability/DeliverablesList', () => ({ default: () => <div>page:DeliverablesList</div> }));
vi.mock('@/admin/modules/deliverability/CreateDeliverable', () => ({ default: () => <div>page:CreateDeliverable</div> }));
vi.mock('@/admin/modules/deliverability/EditDeliverable', () => ({ default: () => <div>page:EditDeliverable</div> }));
vi.mock('@/admin/modules/deliverability/DeliverabilityAnalytics', () => ({ default: () => <div>page:DeliverabilityAnalytics</div> }));
vi.mock('@/admin/modules/analytics/RegionalAnalyticsPage', () => ({ default: () => <div>page:RegionalAnalyticsPage</div> }));
vi.mock('@/admin/modules/performance/PerformanceDashboard', () => ({ default: () => <div>page:PerformanceDashboard</div> }));
vi.mock('@/admin/modules/advanced/SeoAudit', () => ({ default: () => <div>page:SeoAudit</div> }));
vi.mock('@/admin/modules/advanced/Redirects', () => ({ default: () => <div>page:Redirects</div> }));
vi.mock('@/admin/modules/advanced/prerender/PrerenderAdmin', () => ({ default: () => <div>page:PrerenderAdmin</div> }));
vi.mock('@/admin/modules/advanced/Error404Tracking', () => ({ default: () => <div>page:Error404Tracking</div> }));
vi.mock('@/admin/modules/analytics/SearchAnalytics', () => ({ default: () => <div>page:SearchAnalytics</div> }));
vi.mock('@/admin/modules/content/PlansAdmin', () => ({ default: () => <div>page:PlansAdmin</div> }));
vi.mock('@/admin/modules/content/PlanForm', () => ({ default: () => <div>page:PlanForm</div> }));
vi.mock('@/admin/modules/content/Subscriptions', () => ({ default: () => <div>page:SubscriptionsAdmin</div> }));
vi.mock('@/admin/modules/system/RegistrationPolicySettings', () => ({ default: () => <div>page:RegistrationPolicySettings</div> }));
vi.mock('@/admin/modules/system/CronJobs', () => ({ default: () => <div>page:CronJobs</div> }));
vi.mock('@/admin/modules/system/CronJobLogs', () => ({ default: () => <div>page:CronJobLogs</div> }));
vi.mock('@/admin/modules/system/CronJobSettings', () => ({ default: () => <div>page:CronJobSettings</div> }));
vi.mock('@/admin/modules/system/CronJobSetup', () => ({ default: () => <div>page:CronJobSetup</div> }));
vi.mock('@/admin/modules/enterprise/EnterpriseDashboard', () => ({ default: () => <div>page:EnterpriseDashboard</div> }));
vi.mock('@/admin/modules/enterprise/RoleList', () => ({ default: () => <div>page:RoleList</div> }));
vi.mock('@/admin/modules/enterprise/RoleForm', () => ({ default: () => <div>page:RoleForm</div> }));
vi.mock('@/admin/modules/enterprise/PermissionBrowser', () => ({ default: () => <div>page:PermissionBrowser</div> }));
vi.mock('@/admin/modules/enterprise/SystemMonitoring', () => ({ default: () => <div>page:SystemMonitoring</div> }));
vi.mock('@/admin/modules/enterprise/HealthCheck', () => ({ default: () => <div>page:HealthCheck</div> }));
vi.mock('@/admin/modules/enterprise/ErrorLogs', () => ({ default: () => <div>page:ErrorLogs</div> }));
vi.mock('@/admin/modules/enterprise/LogFiles', () => ({ default: () => <div>page:LogFiles</div> }));
vi.mock('@/admin/modules/enterprise/LogFileViewer', () => ({ default: () => <div>page:LogFileViewer</div> }));
vi.mock('@/admin/modules/enterprise/SystemRequirements', () => ({ default: () => <div>page:SystemRequirements</div> }));
vi.mock('@/admin/modules/integrations/OutboundWebhooks', () => ({ default: () => <div>page:OutboundWebhooks</div> }));
vi.mock('@/admin/modules/diagnostics/MatchingDiagnostic', () => ({ default: () => <div>page:MatchingDiagnostic</div> }));
vi.mock('@/admin/modules/advanced/MatchDebugPanel', () => ({ default: () => <div>page:MatchDebugPanel</div> }));
vi.mock('@/admin/modules/system/TestRunner', () => ({ default: () => <div>page:TestRunner</div> }));
vi.mock('@/admin/modules/dashboard/AdminDashboard', () => ({ default: () => <div>page:AdminDashboard</div> }));
vi.mock('@/admin/modules/billing/BillingPage', () => ({ default: () => <div>page:BillingPage</div> }));
vi.mock('@/admin/modules/impact/ImpactReport', () => ({ default: () => <div>page:ImpactReport</div> }));
vi.mock('@/admin/modules/advanced/SeoOverview', () => ({ default: () => <div>page:SeoOverview</div> }));
// Phase 2: the platform-wide half of the super admin panel, and what stays there.
vi.mock('@/admin/modules/super/FederationControls', () => ({ default: () => <div>page:FederationControls</div> }));
vi.mock('@/admin/modules/super/FederationWhitelist', () => ({ default: () => <div>page:FederationWhitelist</div> }));
vi.mock('@/admin/modules/super/SuperPartnerships', () => ({ default: () => <div>page:SuperPartnerships</div> }));
vi.mock('@/admin/modules/super/FederationAuditLog', () => ({ default: () => <div>page:FederationAuditLog</div> }));
vi.mock('@/admin/modules/billing/BillingControl', () => ({ default: () => <div>page:BillingControl</div> }));
vi.mock('@/admin/modules/billing/RevenueDashboard', () => ({ default: () => <div>page:RevenueDashboard</div> }));
vi.mock('@/admin/modules/super/PilotInquiryAdminPage', () => ({ default: () => <div>page:PilotInquiryAdminPage</div> }));
vi.mock('@/admin/modules/super/PlatformTranslationKeyPage', () => ({ default: () => <div>page:PlatformTranslationKeyPage</div> }));
vi.mock('@/admin/modules/provisioning/ProvisioningRequestsPage', () => ({ default: () => <div>page:ProvisioningRequestsPage</div> }));
vi.mock('@/admin/modules/national/NationalKissDashboardPage', () => ({ default: () => <div>page:NationalKissDashboardPage</div> }));
vi.mock('@/admin/modules/regional-analytics/RegionalAnalyticsAdminPage', () => ({ default: () => <div>page:RegionalAnalyticsAdminPage</div> }));
vi.mock('@/admin/modules/advanced/PlatformCapabilities', () => ({ default: () => <div>page:PlatformCapabilities</div> }));
vi.mock('@/admin/modules/super/SuperDashboard', () => ({ default: () => <div>page:SuperDashboard</div> }));
vi.mock('@/admin/modules/super/FederationTenantFeatures', () => ({ default: () => <div>page:FederationTenantFeatures</div> }));

import { AdminRoutes } from '@/admin/routes';
import { SuperAdminRoute } from '@/admin/SuperAdminRoute';
import { SuperAdminRoutes } from '@/super-admin/SuperAdminRoutes';
import { PlatformTeamRoute } from './PlatformTeamRoute';
import { PlatformTeamRoutes } from './PlatformTeamRoutes';

function LocationProbe() {
  const { pathname, search, hash } = useLocation();
  return <output aria-label="address">{pathname + search + hash}</output>;
}

function renderAt(address: string) {
  return render(
    <MemoryRouter initialEntries={[address]}>
      <Routes>
        <Route element={<><Outlet /><LocationProbe /></>}>
          <Route path="/test/admin/*">{AdminRoutes()}</Route>
          <Route path="/test/super-admin/*" element={<SuperAdminRoute />}>
            {SuperAdminRoutes()}
          </Route>
          <Route path="/test/platform-team/*" element={<PlatformTeamRoute />}>
            {PlatformTeamRoutes()}
          </Route>
          <Route path="/test/broker" element={<div>page:Broker</div>} />
          <Route path="/test/dashboard" element={<div>page:Dashboard</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

async function address(): Promise<string> {
  return (await screen.findByLabelText('address')).textContent ?? '';
}

// [address tail, the page that must render]
const PAGES: Array<[string, string]> = [
  ['menus', 'page:MenusAdmin'],
  ['menus/builder/7', 'page:MenuBuilder'],
  ['email-settings', 'page:EmailSettings'],
  ['email-deliverability', 'page:EmailDeliverability'],
  ['deliverability', 'page:DeliverabilityDashboard'],
  ['deliverability/list', 'page:DeliverablesList'],
  ['deliverability/create', 'page:CreateDeliverable'],
  ['deliverability/edit/12', 'page:EditDeliverable'],
  ['deliverability/analytics', 'page:DeliverabilityAnalytics'],
  ['analytics/regional', 'page:RegionalAnalyticsPage'],
  ['performance', 'page:PerformanceDashboard'],
  ['seo/audit', 'page:SeoAudit'],
  ['seo/redirects', 'page:Redirects'],
  ['seo/prerender', 'page:PrerenderAdmin'],
  ['404-errors', 'page:Error404Tracking'],
  ['search-analytics', 'page:SearchAnalytics'],
  ['plans', 'page:PlansAdmin'],
  ['plans/create', 'page:PlanForm'],
  ['plans/edit/3', 'page:PlanForm'],
  ['plans/subscriptions', 'page:SubscriptionsAdmin'],
  ['settings/registration-policy', 'page:RegistrationPolicySettings'],
  ['cron-jobs', 'page:CronJobs'],
  ['cron-jobs/logs', 'page:CronJobLogs'],
  ['cron-jobs/settings', 'page:CronJobSettings'],
  ['cron-jobs/setup', 'page:CronJobSetup'],
  ['enterprise', 'page:EnterpriseDashboard'],
  ['enterprise/roles', 'page:RoleList'],
  ['enterprise/roles/create', 'page:RoleForm'],
  ['enterprise/roles/5', 'page:RoleForm'],
  ['enterprise/roles/5/edit', 'page:RoleForm'],
  ['enterprise/permissions', 'page:PermissionBrowser'],
  ['enterprise/monitoring', 'page:SystemMonitoring'],
  ['enterprise/monitoring/health', 'page:HealthCheck'],
  ['enterprise/monitoring/logs', 'page:ErrorLogs'],
  ['enterprise/monitoring/log-files', 'page:LogFiles'],
  ['enterprise/monitoring/log-files/laravel.log', 'page:LogFileViewer'],
  ['enterprise/monitoring/requirements', 'page:SystemRequirements'],
  ['integrations/webhooks', 'page:OutboundWebhooks'],
  ['matching-diagnostic', 'page:MatchingDiagnostic'],
  ['match-debug', 'page:MatchDebugPanel'],
  ['tests', 'page:TestRunner'],
];

// Phase 2 — the platform-wide half of the super admin panel. Same tails as
// they had under `/super-admin`.
const SUPER_PAGES: Array<[string, string]> = [
  ['federation', 'page:FederationControls'],
  ['federation/whitelist', 'page:FederationWhitelist'],
  ['federation/partnerships', 'page:SuperPartnerships'],
  ['federation/audit', 'page:FederationAuditLog'],
  ['billing', 'page:BillingControl'],
  ['billing/revenue', 'page:RevenueDashboard'],
  ['platform/pilot-inquiries', 'page:PilotInquiryAdminPage'],
  ['platform/translation', 'page:PlatformTranslationKeyPage'],
  ['provisioning-requests', 'page:ProvisioningRequestsPage'],
  ['national/kiss', 'page:NationalKissDashboardPage'],
  ['regional-analytics/subscriptions', 'page:RegionalAnalyticsAdminPage'],
];

const GLOBAL_SUPER_ADMIN_NOT_ON_TEAM = { id: 3, role: 'super_admin', is_super_admin: true, super_panel_level: 'master' };
const TENANT_SUPER_ADMIN = { id: 6, role: 'admin', is_tenant_super_admin: true, super_panel_level: 'regional' };

beforeEach(() => {
  auth.user = { ...PLATFORM_TEAM };
});

describe('the Platform team panel mounts every moved page', () => {
  it.each(PAGES)('/platform-team/%s opens for the platform team', async (tail, page) => {
    renderAt(`/test/platform-team/${tail}`);
    expect(await screen.findByText(page)).toBeInTheDocument();
    expect(await address()).toBe(`/test/platform-team/${tail}`);
  });

  it('opens on the health page', async () => {
    renderAt('/test/platform-team');
    expect(await screen.findByText('page:PlatformTeamHome')).toBeInTheDocument();
    expect(await address()).toBe('/test/platform-team');
  });

  it('opens Failed background jobs, a page of the panel\'s own', async () => {
    renderAt('/test/platform-team/failed-jobs');
    expect(await screen.findByText('page:FailedJobsPage')).toBeInTheDocument();
  });

  it('opens Deployments, a page of the panel\'s own', async () => {
    renderAt('/test/platform-team/deployments');
    expect(await screen.findByText('page:DeploymentsPage')).toBeInTheDocument();
  });

  it('opens Recent errors, a page of the panel\'s own', async () => {
    renderAt('/test/platform-team/errors');
    expect(await screen.findByText('page:RecentErrorsPage')).toBeInTheDocument();
  });

  it('opens Rebuild search, a page of the panel\'s own', async () => {
    renderAt('/test/platform-team/search-rebuild');
    expect(await screen.findByText('page:SearchRebuildPage')).toBeInTheDocument();
  });

  it('opens Addresses and certificates, a page of the panel\'s own', async () => {
    renderAt('/test/platform-team/domains');
    expect(await screen.findByText('page:DomainsPage')).toBeInTheDocument();
  });

  it('opens Keys and connections, a page of the panel\'s own', async () => {
    renderAt('/test/platform-team/connections');
    expect(await screen.findByText('page:ConnectionsPage')).toBeInTheDocument();
  });

  it('opens the Notices page', async () => {
    renderAt('/test/platform-team/notices');
    expect(await screen.findByText('page:PlatformNoticesPage')).toBeInTheDocument();
  });

  it('opens the Communities at a glance page', async () => {
    renderAt('/test/platform-team/communities');
    expect(await screen.findByText('page:CommunitiesAtAGlancePage')).toBeInTheDocument();
  });

  it('opens the Community health page', async () => {
    renderAt('/test/platform-team/community-health');
    expect(await screen.findByText('page:CommunityHealthPage')).toBeInTheDocument();
  });

  it('opens the Community setup page', async () => {
    renderAt('/test/platform-team/community-setup');
    expect(await screen.findByText('page:CommunitySetupPage')).toBeInTheDocument();
  });

  it('opens the Usage per community page', async () => {
    renderAt('/test/platform-team/usage');
    expect(await screen.findByText('page:UsagePage')).toBeInTheDocument();
  });

  it('opens the Unfinished features page', async () => {
    renderAt('/test/platform-team/unfinished-features');
    expect(await screen.findByText('page:UnfinishedFeaturesPage')).toBeInTheDocument();
  });

  it('opens the Data requests page', async () => {
    renderAt('/test/platform-team/data-requests');
    expect(await screen.findByText('page:DataRequestsPage')).toBeInTheDocument();
  });

  it('opens the Legal documents page', async () => {
    renderAt('/test/platform-team/legal-documents');
    expect(await screen.findByText('page:LegalDocumentsPage')).toBeInTheDocument();
  });

  it('opens the Clean-up jobs page', async () => {
    renderAt('/test/platform-team/clean-up-jobs');
    expect(await screen.findByText('page:CleanUpJobsPage')).toBeInTheDocument();
  });

  it('opens the Agreements and renewals page', async () => {
    renderAt('/test/platform-team/agreements');
    expect(await screen.findByText('page:AgreementsPage')).toBeInTheDocument();
  });

  it('opens the Assurance facts page', async () => {
    renderAt('/test/platform-team/assurance');
    expect(await screen.findByText('page:AssuranceFactsPage')).toBeInTheDocument();
  });

  it('opens the Security page', async () => {
    renderAt('/test/platform-team/security');
    expect(await screen.findByText('page:SecurityPage')).toBeInTheDocument();
  });

  it('opens the Senior accounts page', async () => {
    renderAt('/test/platform-team/senior-accounts');
    expect(await screen.findByText('page:SeniorAccountsPage')).toBeInTheDocument();
  });

  it('opens the Find an account page', async () => {
    renderAt('/test/platform-team/accounts');
    expect(await screen.findByText('page:FindAccountPage')).toBeInTheDocument();
  });

  it('opens the Access review page', async () => {
    renderAt('/test/platform-team/access-review');
    expect(await screen.findByText('page:AccessReviewPage')).toBeInTheDocument();
  });

  it('opens the Phone app page', async () => {
    renderAt('/test/platform-team/phone-app');
    expect(await screen.findByText('page:PhoneAppPage')).toBeInTheDocument();
  });

  it('opens the Push notifications page', async () => {
    renderAt('/test/platform-team/push-notifications');
    expect(await screen.findByText('page:PushNotificationsPage')).toBeInTheDocument();
  });

  it('opens the Translations page', async () => {
    renderAt('/test/platform-team/translations');
    expect(await screen.findByText('page:TranslationsPage')).toBeInTheDocument();
  });

  it('forwards /platform-team/integrations to its only page', async () => {
    renderAt('/test/platform-team/integrations');
    expect(await screen.findByText('page:OutboundWebhooks')).toBeInTheDocument();
    expect(await address()).toBe('/test/platform-team/integrations/webhooks');
  });

  it('shows the panel\'s own "not in this panel" page for an address that does not exist', async () => {
    renderAt('/test/platform-team/no-such-page');
    expect(await screen.findByText('index.not_found_title')).toBeInTheDocument();
  });
});

describe('the old admin addresses forward into the panel', () => {
  it.each(PAGES)('/admin/%s lands on the same page in the panel', async (tail, page) => {
    renderAt(`/test/admin/${tail}`);
    expect(await screen.findByText(page)).toBeInTheDocument();
    expect(await address()).toBe(`/test/platform-team/${tail}`);
  });

  it('keeps the record, the query string and the fragment of an old bookmark', async () => {
    renderAt('/test/admin/deliverability/edit/12?tab=notes#x');
    expect(await screen.findByText('page:EditDeliverable')).toBeInTheDocument();
    expect(await address()).toBe('/test/platform-team/deliverability/edit/12?tab=notes#x');
  });

  it('keeps the record id in the middle of an address', async () => {
    renderAt('/test/admin/enterprise/roles/5/edit?from=list');
    expect(await screen.findByText('page:RoleForm')).toBeInTheDocument();
    expect(await address()).toBe('/test/platform-team/enterprise/roles/5/edit?from=list');
  });

  it('forwards the old Integrations address too', async () => {
    renderAt('/test/admin/integrations');
    expect(await screen.findByText('page:OutboundWebhooks')).toBeInTheDocument();
    expect(await address()).toBe('/test/platform-team/integrations/webhooks');
  });
});

describe('someone who is not on the platform team', () => {
  it.each(PAGES)('a community admin typing /admin/%s ends up on the admin home page', async (tail, page) => {
    auth.user = { ...COMMUNITY_ADMIN };
    renderAt(`/test/admin/${tail}`);
    expect(await screen.findByText('page:AdminDashboard')).toBeInTheDocument();
    expect(await address()).toBe('/test/admin');
    expect(screen.queryByText(page)).not.toBeInTheDocument();
  });

  it('a global super admin who is not on the team is sent to the admin home page', async () => {
    auth.user = { id: 3, role: 'super_admin', is_super_admin: true };
    renderAt('/test/platform-team/cron-jobs');
    expect(await address()).toBe('/test/admin');
    expect(screen.queryByText('page:CronJobs')).not.toBeInTheDocument();
  });

  it('a broker is sent to the broker panel', async () => {
    auth.user = { id: 4, role: 'broker' };
    renderAt('/test/platform-team/cron-jobs');
    expect(await screen.findByText('page:Broker')).toBeInTheDocument();
  });

  it('a member is sent to their dashboard', async () => {
    auth.user = { id: 5, role: 'member' };
    renderAt('/test/platform-team/cron-jobs');
    expect(await screen.findByText('page:Dashboard')).toBeInTheDocument();
  });
});

describe('the platform-wide half of the super admin panel lives in the Platform team panel', () => {
  it.each([...SUPER_PAGES, ['platform-capabilities', 'page:PlatformCapabilities'] as [string, string]])(
    '/platform-team/%s opens for the platform team',
    async (tail, page) => {
      renderAt(`/test/platform-team/${tail}`);
      expect(await screen.findByText(page)).toBeInTheDocument();
      expect(await address()).toBe(`/test/platform-team/${tail}`);
    },
  );

  it.each(SUPER_PAGES)('/super-admin/%s lands on the same page in the panel', async (tail, page) => {
    renderAt(`/test/super-admin/${tail}`);
    expect(await screen.findByText(page)).toBeInTheDocument();
    expect(await address()).toBe(`/test/platform-team/${tail}`);
  });

  it('keeps the query string and the fragment of an old super admin bookmark', async () => {
    renderAt('/test/super-admin/billing/revenue?year=2026#totals');
    expect(await screen.findByText('page:RevenueDashboard')).toBeInTheDocument();
    expect(await address()).toBe('/test/platform-team/billing/revenue?year=2026#totals');
  });

  it('forwards the old admin address of Platform capabilities', async () => {
    renderAt('/test/admin/platform-capabilities');
    expect(await screen.findByText('page:PlatformCapabilities')).toBeInTheDocument();
    expect(await address()).toBe('/test/platform-team/platform-capabilities');
  });

  // These four admin addresses were already redirects into the super admin
  // panel; they now go straight to where the page is.
  it.each([
    ['platform/pilot-inquiries', 'page:PilotInquiryAdminPage'],
    ['provisioning-requests', 'page:ProvisioningRequestsPage'],
    ['national/kiss', 'page:NationalKissDashboardPage'],
    ['regional-analytics/subscriptions', 'page:RegionalAnalyticsAdminPage'],
  ])('the older /admin/%s address lands in the panel too', async (tail, page) => {
    renderAt(`/test/admin/${tail}`);
    expect(await screen.findByText(page)).toBeInTheDocument();
    expect(await address()).toBe(`/test/platform-team/${tail}`);
  });
});

// Review Focus 4: an old super admin address must never leave someone on a
// blank page or throw them out of the panel they are allowed in.
describe('someone in the super admin panel who is not on the platform team', () => {
  it.each(SUPER_PAGES)('a tenant super admin typing /super-admin/%s lands on the super admin home page', async (tail, page) => {
    auth.user = { ...TENANT_SUPER_ADMIN };
    renderAt(`/test/super-admin/${tail}`);
    expect(await screen.findByText('page:SuperDashboard')).toBeInTheDocument();
    expect(await address()).toBe('/test/super-admin');
    expect(screen.queryByText(page)).not.toBeInTheDocument();
  });

  it.each(SUPER_PAGES)('a global super admin who is not on the team typing /super-admin/%s lands there too', async (tail, page) => {
    auth.user = { ...GLOBAL_SUPER_ADMIN_NOT_ON_TEAM };
    renderAt(`/test/super-admin/${tail}`);
    expect(await screen.findByText('page:SuperDashboard')).toBeInTheDocument();
    expect(await address()).toBe('/test/super-admin');
    expect(screen.queryByText(page)).not.toBeInTheDocument();
  });

  it('a global super admin who is not on the team cannot open Platform capabilities by its old address', async () => {
    auth.user = { ...GLOBAL_SUPER_ADMIN_NOT_ON_TEAM };
    renderAt('/test/admin/platform-capabilities');
    expect(await screen.findByText('page:AdminDashboard')).toBeInTheDocument();
    expect(await address()).toBe('/test/admin');
  });

  // The per-community federation switches did NOT move: the server confines
  // them to the caller's own branch, so a tenant super admin may use them.
  it('a tenant super admin still opens a community\'s federation switches in the super admin panel', async () => {
    auth.user = { ...TENANT_SUPER_ADMIN };
    renderAt('/test/super-admin/federation/tenant/12/features');
    expect(await screen.findByText('page:FederationTenantFeatures')).toBeInTheDocument();
    expect(await address()).toBe('/test/super-admin/federation/tenant/12/features');
  });
});

// Owner decisions, 15 Nov 2026: these three are a community admin's pages
// and did not move.
describe('pages that stay in the admin panel', () => {
  it.each([
    ['billing', 'page:BillingPage'],
    ['impact-report', 'page:ImpactReport'],
    ['seo', 'page:SeoOverview'],
  ])('/admin/%s still opens for a community admin', async (tail, page) => {
    auth.user = { ...COMMUNITY_ADMIN };
    renderAt(`/test/admin/${tail}`);
    expect(await screen.findByText(page)).toBeInTheDocument();
    expect(await address()).toBe(`/test/admin/${tail}`);
  });
});
