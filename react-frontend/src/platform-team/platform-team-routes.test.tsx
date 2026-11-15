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

import { AdminRoutes } from '@/admin/routes';
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

beforeEach(() => {
  auth.user = { ...PLATFORM_TEAM };
});

describe('the Platform team panel mounts every moved page', () => {
  it.each(PAGES)('/platform-team/%s opens for the platform team', async (tail, page) => {
    renderAt(`/test/platform-team/${tail}`);
    expect(await screen.findByText(page)).toBeInTheDocument();
    expect(await address()).toBe(`/test/platform-team/${tail}`);
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
