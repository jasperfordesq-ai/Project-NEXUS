// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Admin Routes Definition
 * Maps all admin URL paths to their React components.
 * Uses lazy loading for all module pages.
 */

import { Suspense, lazy } from 'react';
import { Route, Navigate, Outlet, useParams } from 'react-router-dom';
import { LoadingScreen } from '@/components/feedback';
import { useTenant } from '@/contexts';
import { SuperAdminRoute } from './SuperAdminRoute';
import type { TenantFeatures } from '@/types';

/** Small wrapper so Navigate targets can use tenantPath() inside Route elements. */
export function TenantRedirect({ to }: { to: string }) {
  const { tenantPath } = useTenant();
  return <Navigate to={tenantPath(to)} replace />;
}

export function TenantParamRedirect({ to }: { to: string }) {
  const { tenantPath } = useTenant();
  const params = useParams<Record<string, string | undefined>>();
  const resolved = Object.entries(params).reduce(
    (path, [key, value]) => path.replace(`:${key}`, encodeURIComponent(value ?? '')),
    to,
  );

  return <Navigate to={tenantPath(resolved)} replace />;
}

export function TenantSplatRedirect({ to }: { to: string }) {
  const { tenantPath } = useTenant();
  const params = useParams<Record<string, string | undefined>>();
  const splat = params['*'];
  const suffix = splat ? `/${splat}` : '';

  return <Navigate to={tenantPath(`${to}${suffix}`)} replace />;
}

/**
 * Route element that renders children only when a feature is enabled.
 * When disabled, redirects to the admin 404 page so the URL resolves
 * cleanly without leaking module UI to tenants that lack the feature.
 */
function FeatureGatedElement({
  feature,
  children,
}: {
  feature: keyof TenantFeatures;
  children: React.ReactNode;
}) {
  const { hasFeature, tenantPath } = useTenant();
  if (!hasFeature(feature)) {
    return <Navigate to={tenantPath('/admin/not-found')} replace />;
  }
  return <>{children}</>;
}

// Lazy-loaded admin pages
const AdminDashboard = lazy(() => import('./modules/dashboard/AdminDashboard'));
const UserList = lazy(() => import('./modules/users/UserList'));
const ModuleConfiguration = lazy(() => import('./modules/config/ModuleConfiguration'));
const Operations = lazy(() => import('./modules/system/Operations'));
const UserCreate = lazy(() => import('./modules/users/UserCreate'));
const UserEdit = lazy(() => import('./modules/users/UserEdit'));
const UserPermissions = lazy(() => import('./modules/users/UserPermissions'));
const ListingsAdmin = lazy(() => import('./modules/listings/ListingsAdmin'));
const ActivityLog = lazy(() => import('./modules/system/ActivityLog'));
const RetentionPolicies = lazy(() => import('./modules/system/RetentionPolicies'));
const SsoProviders = lazy(() => import('./modules/system/SsoProviders'));
const CategoriesAdmin = lazy(() => import('./modules/categories/CategoriesAdmin'));
const CronJobs = lazy(() => import('./modules/system/CronJobs'));
const CronJobLogs = lazy(() => import('./modules/system/CronJobLogs'));
const CronJobSettings = lazy(() => import('./modules/system/CronJobSettings'));
const CronJobSetup = lazy(() => import('./modules/system/CronJobSetup'));
const BlogAdmin = lazy(() => import('./modules/blog/BlogAdmin'));
const BlogPostForm = lazy(() => import('./modules/blog/BlogPostForm'));
const SmartMatchingOverview = lazy(() => import('./modules/matching/SmartMatchingOverview'));
const MatchingConfig = lazy(() => import('./modules/matching/MatchingConfig'));
const MatchingAnalytics = lazy(() => import('./modules/matching/MatchingAnalytics'));
const TimebankingDashboard = lazy(() => import('./modules/timebanking/TimebankingDashboard'));
const FraudAlerts = lazy(() => import('./modules/timebanking/FraudAlerts'));
const OrgWallets = lazy(() => import('./modules/timebanking/OrgWallets'));
const UserReport = lazy(() => import('./modules/timebanking/UserReport'));
const StartingBalances = lazy(() => import('./modules/timebanking/StartingBalances'));
const CommunityFund = lazy(() => import('./modules/timebanking/CommunityFund'));
// admin/modules/broker/* and the admin match-approvals pages are retired —
// the broker control panel (incl. match approvals) lives at /broker/*
// (see react-frontend/src/broker/pages/).
const GamificationHub = lazy(() => import('./modules/gamification/GamificationHub'));
const CampaignList = lazy(() => import('./modules/gamification/CampaignList'));
const CampaignForm = lazy(() => import('./modules/gamification/CampaignForm'));
const GamificationAnalytics = lazy(() => import('./modules/gamification/GamificationAnalytics'));
const CustomBadges = lazy(() => import('./modules/gamification/CustomBadges'));
const BadgeConfiguration = lazy(() => import('./modules/gamification/BadgeConfiguration'));
const CreateBadge = lazy(() => import('./modules/gamification/CreateBadge'));
const GroupList = lazy(() => import('./modules/groups/GroupList'));
const GroupAnalytics = lazy(() => import('./modules/groups/GroupAnalytics'));
const GroupApprovals = lazy(() => import('./modules/groups/GroupApprovals'));
const GroupModeration = lazy(() => import('./modules/groups/GroupModeration'));
const GroupTypes = lazy(() => import('./modules/groups/GroupTypes'));
const GroupDetail = lazy(() => import('./modules/groups/GroupDetail'));
const GroupRecommendations = lazy(() => import('./modules/groups/GroupRecommendations'));
const GroupRanking = lazy(() => import('./modules/groups/GroupRanking'));
const GroupGeocode = lazy(() => import('./modules/groups/GroupGeocode'));
const GroupOrganization = lazy(() => import('./modules/groups/GroupOrganization'));
const ResidencyVerifications = lazy(() => import('./modules/users/ResidencyVerifications'));

// Enterprise module
const EnterpriseDashboard = lazy(() => import('./modules/enterprise/EnterpriseDashboard'));
const RoleList = lazy(() => import('./modules/enterprise/RoleList'));
const RoleForm = lazy(() => import('./modules/enterprise/RoleForm'));
const PermissionBrowser = lazy(() => import('./modules/enterprise/PermissionBrowser'));
const GdprDashboard = lazy(() => import('./modules/enterprise/GdprDashboard'));
const FadpAdminPage = lazy(() => import('./modules/legal/FadpAdminPage'));
const GdprRequests = lazy(() => import('./modules/enterprise/GdprRequests'));
const GdprConsents = lazy(() => import('./modules/enterprise/GdprConsents'));
const GdprBreaches = lazy(() => import('./modules/enterprise/GdprBreaches'));
const GdprAuditLog = lazy(() => import('./modules/enterprise/GdprAuditLog'));
const SystemMonitoring = lazy(() => import('./modules/enterprise/SystemMonitoring'));
const HealthCheck = lazy(() => import('./modules/enterprise/HealthCheck'));
const ErrorLogs = lazy(() => import('./modules/enterprise/ErrorLogs'));
const LegalDocList = lazy(() => import('./modules/enterprise/LegalDocList'));
const LegalDocForm = lazy(() => import('./modules/enterprise/LegalDocForm'));
const LegalDocVersionList = lazy(() => import('./modules/enterprise/LegalDocVersionList'));
const LegalDocVersionEditor = lazy(() => import('./modules/enterprise/LegalDocVersionEditor'));
const LegalDocComplianceDashboard = lazy(() => import('./modules/enterprise/LegalDocComplianceDashboard'));
const GdprRequestDetail = lazy(() => import('./modules/enterprise/GdprRequestDetail'));
const GdprRequestCreate = lazy(() => import('./modules/enterprise/GdprRequestCreate'));
const GdprConsentTypes = lazy(() => import('./modules/enterprise/GdprConsentTypes'));
const GdprBreachDetail = lazy(() => import('./modules/enterprise/GdprBreachDetail'));
const LogFiles = lazy(() => import('./modules/enterprise/LogFiles'));
const LogFileViewer = lazy(() => import('./modules/enterprise/LogFileViewer'));
const SystemRequirements = lazy(() => import('./modules/enterprise/SystemRequirements'));

// Performance module
const PerformanceDashboard = lazy(() => import('./modules/performance/PerformanceDashboard'));

// Newsletter module
const NewsletterList = lazy(() => import('./modules/newsletters/NewsletterList'));
const NewsletterForm = lazy(() => import('./modules/newsletters/NewsletterForm'));
const NewsletterDesignStudio = lazy(() => import('./modules/newsletters/NewsletterDesignStudio'));
const Subscribers = lazy(() => import('./modules/newsletters/Subscribers'));
const Segments = lazy(() => import('./modules/newsletters/Segments'));
const SegmentForm = lazy(() => import('./modules/newsletters/SegmentForm'));
const Templates = lazy(() => import('./modules/newsletters/Templates'));
const TemplateForm = lazy(() => import('./modules/newsletters/TemplateForm'));
const NewsletterAnalytics = lazy(() => import('./modules/newsletters/NewsletterAnalytics'));
const NewsletterBounces = lazy(() => import('./modules/newsletters/NewsletterBounces'));
const NewsletterSendTimeOptimizer = lazy(() => import('./modules/newsletters/NewsletterSendTimeOptimizer'));
const NewsletterDiagnostics = lazy(() => import('./modules/newsletters/NewsletterDiagnostics'));
const NewsletterStats = lazy(() => import('./modules/newsletters/NewsletterStats'));
const NewsletterActivity = lazy(() => import('./modules/newsletters/NewsletterActivity'));

// Volunteering module
const VolunteeringOverview = lazy(() => import('./modules/volunteering/VolunteeringOverview'));
const VolunteerApprovals = lazy(() => import('./modules/volunteering/VolunteerApprovals'));
const VolunteerSwaps = lazy(() => import('./modules/volunteering/VolunteerSwaps'));
const VolunteerOrganizations = lazy(() => import('./modules/volunteering/VolunteerOrganizations'));
const VolunteerExpenses = lazy(() => import('./modules/volunteering/VolunteerExpenses'));
const VolunteerTraining = lazy(() => import('./modules/volunteering/VolunteerTraining'));
const VolunteerSafeguarding = lazy(() => import('./modules/volunteering/VolunteerSafeguarding'));
const VolunteerHoursAudit = lazy(() => import('./modules/volunteering/VolunteerHoursAudit'));
const VolunteerGivingDays = lazy(() => import('./modules/volunteering/VolunteerGivingDays'));
const VolunteerConsents = lazy(() => import('./modules/volunteering/VolunteerConsents'));
const VolunteerProjects = lazy(() => import('./modules/volunteering/VolunteerProjects'));
const VolunteerConfig = lazy(() => import('./modules/volunteering/VolunteerConfig'));
const DonationRefunds = lazy(() => import('./modules/volunteering/DonationRefunds'));
// Caring Community pages moved to /caring/* (CaringApp) — no longer registered here.

// Advertising module
const AdCampaignAdminPage = lazy(() => import('./modules/advertising/AdCampaignAdminPage'));
const PushCampaignAdminPage = lazy(() => import('./modules/advertising/PushCampaignAdminPage'));

// AI / KI-Agents module
const KiAgentAdminPage = lazy(() => import('./modules/ai/KiAgentAdminPage'));
const AiModuleDocsAdminPage = lazy(() => import('./modules/ai/AiModuleDocsAdminPage'));
const AiTraceMetricsAdminPage = lazy(() => import('./modules/ai/AiTraceMetricsAdminPage'));

// AG61 — KI-Agenten new framework (definitions, proposals, runs)
const AgentsAdminPage = lazy(() => import('./modules/agents/AgentsAdminPage'));
const AgentProposalsPage = lazy(() => import('./modules/agents/AgentProposalsPage'));
const AgentRunsPage = lazy(() => import('./modules/agents/AgentRunsPage'));

// Regional analytics
const RegionalAnalyticsPage = lazy(() => import('./modules/analytics/RegionalAnalyticsPage'));

// Platform — pilot inquiries (super-admin)

// AG44 — Tenant provisioning queue (super-admin)

// Events module
const EventsAdmin = lazy(() => import('./modules/events/EventsAdmin'));
const EventSettings = lazy(() => import('./modules/events/EventSettings'));

// Polls module
const PollsAdmin = lazy(() => import('./modules/polls/PollsAdmin'));

// Goals module
const GoalsAdmin = lazy(() => import('./modules/goals/GoalsAdmin'));

// Resources / Knowledge Base module
const ResourcesAdmin = lazy(() => import('./modules/resources/ResourcesAdmin'));
const KBArticleForm = lazy(() => import('./modules/resources/KBArticleForm'));
const ResourceCategoriesAdmin = lazy(() => import('./modules/resources/ResourceCategoriesAdmin'));

// Jobs module
const JobsAdmin = lazy(() => import('./modules/jobs/JobsAdmin'));
const JobModerationQueue = lazy(() => import('./modules/jobs/JobModerationQueue'));
const JobBiasAudit = lazy(() => import('./modules/jobs/JobBiasAudit'));
const JobPipelineOverview = lazy(() => import('./modules/jobs/JobPipelineOverview'));
const JobTemplatesAdmin = lazy(() => import('./modules/jobs/JobTemplatesAdmin'));

// Translation config module
const TranslationConfig = lazy(() => import('./modules/config/TranslationConfig'));

// Marketplace module
const MarketplaceAdmin = lazy(() => import('./modules/marketplace/MarketplaceAdmin'));
const CoursesAdmin = lazy(() => import('./modules/courses/CoursesAdmin'));
const PodcastsAdmin = lazy(() => import('./modules/podcasts/PodcastsAdmin'));
const MarketplaceModerationPage = lazy(() => import('./modules/marketplace/MarketplaceModerationPage'));
const MarketplaceSellerAdmin = lazy(() => import('./modules/marketplace/MarketplaceSellerAdmin'));
const MarketplaceCasesPage = lazy(() => import('./modules/marketplace/MarketplaceCasesPage'));
const AdminCouponsPage = lazy(() => import('./modules/marketplace/AdminCouponsPage'));
const PartnerVenuesAdminPage = lazy(() => import('./modules/venues/PartnerVenuesAdminPage'));

// Ideation / Challenges module
const IdeationAdmin = lazy(() => import('./modules/ideation/IdeationAdmin'));

// Federation module — retired from the admin panel 2026-07-02; all pages
// now live in the super-admin-only Partner Timebanks panel (/partner-timebanks/*).

// Safeguarding module — the dashboard + options pages moved to the broker
// panel (/broker/safeguarding, /broker/safeguarding-options) on 2026-07-02.
// The components stay on disk and are reused there via broker wrappers.

// Onboarding module
const OnboardingSettings = lazy(() => import('./modules/system/OnboardingSettings'));

// Advanced/SEO module
const AiSettings = lazy(() => import('./modules/advanced/AiSettings'));
const EmailSettings = lazy(() => import('./modules/advanced/EmailSettings'));
const EmailDeliverability = lazy(() => import('./modules/advanced/EmailDeliverability'));
const AlgorithmSettings = lazy(() => import('./modules/advanced/AlgorithmSettings'));
const SeoOverview = lazy(() => import('./modules/advanced/SeoOverview'));
const SeoAudit = lazy(() => import('./modules/advanced/SeoAudit'));
const PrerenderAdmin = lazy(() => import('./modules/advanced/prerender/PrerenderAdmin'));
const Redirects = lazy(() => import('./modules/advanced/Redirects'));
const Error404Tracking = lazy(() => import('./modules/advanced/Error404Tracking'));
const MatchDebugPanel = lazy(() => import('./modules/advanced/MatchDebugPanel'));

// CRM module
const CrmDashboard = lazy(() => import('./modules/crm/CrmDashboard'));
const MemberNotes = lazy(() => import('./modules/crm/MemberNotes'));
const CoordinatorTasks = lazy(() => import('./modules/crm/CoordinatorTasks'));
const OnboardingFunnel = lazy(() => import('./modules/crm/OnboardingFunnel'));
const MemberTags = lazy(() => import('./modules/crm/MemberTags'));
const ActivityTimeline = lazy(() => import('./modules/crm/ActivityTimeline'));

// System tools
const AdminSettings = lazy(() => import('./modules/system/AdminSettings'));
const RegistrationPolicySettings = lazy(() => import('./modules/system/RegistrationPolicySettings'));
const TestRunner = lazy(() => import('./modules/system/TestRunner'));
const SeedGenerator = lazy(() => import('./modules/system/SeedGenerator'));
const WebpConverter = lazy(() => import('./modules/system/WebpConverter'));
const ImageSettings = lazy(() => import('./modules/system/ImageSettings'));
const NativeApp = lazy(() => import('./modules/system/NativeApp'));
const BlogRestore = lazy(() => import('./modules/system/BlogRestore'));

// Community tools
const SmartMatchUsers = lazy(() => import('./modules/community/SmartMatchUsers'));
const SmartMatchMonitoring = lazy(() => import('./modules/community/SmartMatchMonitoring'));

// Deliverability module
const DeliverabilityDashboard = lazy(() => import('./modules/deliverability/DeliverabilityDashboard'));
const DeliverablesList = lazy(() => import('./modules/deliverability/DeliverablesList'));
const CreateDeliverable = lazy(() => import('./modules/deliverability/CreateDeliverable'));
const EditDeliverable = lazy(() => import('./modules/deliverability/EditDeliverable'));
const DeliverabilityAnalytics = lazy(() => import('./modules/deliverability/DeliverabilityAnalytics'));

// Diagnostics module
const MatchingDiagnostic = lazy(() => import('./modules/diagnostics/MatchingDiagnostic'));
const NexusScoreAnalytics = lazy(() => import('./modules/diagnostics/NexusScoreAnalytics'));

// Analytics & Reporting
const CommunityAnalytics = lazy(() => import('./modules/analytics/CommunityAnalytics'));
const SearchAnalytics = lazy(() => import('./modules/analytics/SearchAnalytics'));
const ImpactReport = lazy(() => import('./modules/impact/ImpactReport'));

// Admin Reports & Moderation Queue (A1-A5, A7)
const MemberReportsPage = lazy(() => import('./modules/reports/MemberReportsPage'));
const HoursReportsPage = lazy(() => import('./modules/reports/HoursReportsPage'));
const InactiveMembersPage = lazy(() => import('./modules/reports/InactiveMembersPage'));
// Content Queue moved to the broker panel (/broker/moderation/queue) 2026-07-02.
// National (Caring Community Foundation) module

// Help Centre
const AdminHelpCenterPage = lazy(() => import('./modules/help/AdminHelpCenterPage'));
const HelpFaqsAdmin = lazy(() => import('./modules/help/HelpFaqsAdmin'));

// Admin 404
const AdminNotFound = lazy(() => import('./modules/AdminNotFound'));

// Moderation module — the pages moved to the broker panel
// (/broker/moderation/*) on 2026-07-02; the components stay on disk and are
// reused there via thin broker wrappers.
const SupportReportsPage = lazy(() => import('./modules/support/SupportReportsPage'));

// Super Admin module — all implementations live in modules/super/

// AG58 — Member Premium admin
const MemberPremiumAdminPage = lazy(() => import('./modules/premium/MemberPremiumAdminPage'));
const MemberPremiumSubscribersPage = lazy(() => import('./modules/premium/MemberPremiumSubscribersPage'));

// Billing module
const BillingPage = lazy(() => import('./modules/billing/BillingPage'));
const PlanSelector = lazy(() => import('./modules/billing/PlanSelector'));
const InvoiceHistory = lazy(() => import('./modules/billing/InvoiceHistory'));
const CheckoutReturn = lazy(() => import('./modules/billing/CheckoutReturn'));

// Content module
const PagesAdmin = lazy(() => import('./modules/content/PagesAdmin'));
const PageBuilder = lazy(() => import('./modules/content/PageBuilder'));
const MenusAdmin = lazy(() => import('./modules/content/MenusAdmin'));
const MenuBuilder = lazy(() => import('./modules/content/MenuBuilder'));
const AttributesAdmin = lazy(() => import('./modules/content/AttributesAdmin'));
const PlansAdmin = lazy(() => import('./modules/content/PlansAdmin'));
const PlanForm = lazy(() => import('./modules/content/PlanForm'));
const SubscriptionsAdmin = lazy(() => import('./modules/content/Subscriptions'));
const LandingPageBuilder = lazy(() => import('./modules/content/LandingPageBuilder'));
// AG60 — API Partners admin retired 2026-07-02 → /partner-timebanks/inbound-api
// AG59 — Paid Regional Analytics admin (super-admin only)

// Wrap lazy components in Suspense
function Lazy({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<LoadingScreen />}>{children}</Suspense>;
}

/**
 * All admin routes — rendered inside AdminLayout + AdminRoute guard.
 * Matches the PHP admin navigation structure exactly.
 */
export function AdminRoutes() {
  return (
    <>
      {/* Dashboard */}
      <Route index element={<Lazy><AdminDashboard /></Lazy>} />

      {/* ─── USERS ─── */}
      <Route path="users" element={<Lazy><UserList /></Lazy>} />
      <Route path="users/create" element={<Lazy><UserCreate /></Lazy>} />
      <Route path="users/:id/edit" element={<Lazy><UserEdit /></Lazy>} />
      <Route path="users/:id/permissions" element={<Lazy><UserPermissions /></Lazy>} />

      {/* ─── CRM ─── */}
      <Route path="crm" element={<Lazy><CrmDashboard /></Lazy>} />
      <Route path="crm/notes" element={<Lazy><MemberNotes /></Lazy>} />
      <Route path="crm/tasks" element={<Lazy><CoordinatorTasks /></Lazy>} />
      <Route path="crm/tags" element={<Lazy><MemberTags /></Lazy>} />
      <Route path="crm/timeline" element={<Lazy><ActivityTimeline /></Lazy>} />
      <Route path="crm/funnel" element={<Lazy><OnboardingFunnel /></Lazy>} />

      {/* ─── LISTINGS ─── */}
      <Route path="listings" element={<Lazy><ListingsAdmin /></Lazy>} />

      {/* ─── CONTENT ─── */}
      <Route path="blog" element={<Lazy><BlogAdmin /></Lazy>} />
      <Route path="blog/create" element={<Lazy><BlogPostForm /></Lazy>} />
      <Route path="blog/edit/:id" element={<Lazy><BlogPostForm /></Lazy>} />
      <Route path="pages" element={<Lazy><PagesAdmin /></Lazy>} />
      <Route path="pages/builder/:id" element={<Lazy><PageBuilder /></Lazy>} />
      <Route path="menus" element={<Lazy><MenusAdmin /></Lazy>} />
      <Route path="menus/builder/:id" element={<Lazy><MenuBuilder /></Lazy>} />
      <Route path="categories" element={<Lazy><CategoriesAdmin /></Lazy>} />
      <Route path="categories/create" element={<Lazy><CategoriesAdmin /></Lazy>} />
      <Route path="categories/edit/:id" element={<Lazy><CategoriesAdmin /></Lazy>} />
      <Route path="attributes" element={<Lazy><AttributesAdmin /></Lazy>} />
      <Route path="landing-page" element={<Lazy><LandingPageBuilder /></Lazy>} />

      {/* ─── ENGAGEMENT ─── */}
      <Route path="gamification" element={<Lazy><GamificationHub /></Lazy>} />
      <Route path="gamification/campaigns" element={<Lazy><CampaignList /></Lazy>} />
      <Route path="gamification/campaigns/create" element={<Lazy><CampaignForm /></Lazy>} />
      <Route path="gamification/campaigns/edit/:id" element={<Lazy><CampaignForm /></Lazy>} />
      <Route path="gamification/analytics" element={<Lazy><GamificationAnalytics /></Lazy>} />
      <Route path="gamification/badge-config" element={<Lazy><BadgeConfiguration /></Lazy>} />
      <Route path="custom-badges" element={<Lazy><CustomBadges /></Lazy>} />
      <Route path="custom-badges/create" element={<Lazy><CreateBadge /></Lazy>} />

      {/* ─── MATCHING & BROKER ─── */}
      <Route path="smart-matching" element={<Lazy><SmartMatchingOverview /></Lazy>} />
      <Route path="smart-matching/analytics" element={<Lazy><MatchingAnalytics /></Lazy>} />
      <Route path="smart-matching/configuration" element={<Lazy><MatchingConfig /></Lazy>} />
      {/* /admin/match-approvals and /admin/broker-controls/* are fully
          retired (owner-approved 2026-07-02, no redirects) — match approvals
          and all broker duties live at /broker/*. */}

      {/* ─── MODERATION ─── */}
      {/* Content moderation (queue, feed, comments, reviews, reports) is fully
          retired from the admin panel (owner-approved 2026-07-02, no redirects)
          — it lives in the broker panel at /broker/moderation/*. */}

      {/* ─── MARKETING ─── */}
      <Route element={
        <FeatureGatedElement feature="newsletter">
          <Outlet />
        </FeatureGatedElement>
      }>
      <Route path="newsletters" element={<Lazy><NewsletterList /></Lazy>} />
      <Route path="newsletters/create" element={<Lazy><NewsletterForm /></Lazy>} />
      <Route path="newsletters/edit/:id" element={<Lazy><NewsletterForm /></Lazy>} />
      <Route path="newsletters/edit/:id/design" element={<Lazy><NewsletterDesignStudio /></Lazy>} />
      <Route path="newsletters/subscribers" element={<Lazy><Subscribers /></Lazy>} />
      <Route path="newsletters/segments/create" element={<Lazy><SegmentForm /></Lazy>} />
      <Route path="newsletters/segments/edit/:id" element={<Lazy><SegmentForm /></Lazy>} />
      <Route path="newsletters/segments" element={<Lazy><Segments /></Lazy>} />
      <Route path="newsletters/templates/create" element={<Lazy><TemplateForm /></Lazy>} />
      <Route path="newsletters/templates/edit/:id" element={<Lazy><TemplateForm /></Lazy>} />
      <Route path="newsletters/templates" element={<Lazy><Templates /></Lazy>} />
      <Route path="newsletters/analytics" element={<Lazy><NewsletterAnalytics /></Lazy>} />
      <Route path="newsletters/bounces" element={<Lazy><NewsletterBounces /></Lazy>} />
      <Route path="newsletters/send-time-optimizer" element={<Lazy><NewsletterSendTimeOptimizer /></Lazy>} />
      <Route path="newsletters/diagnostics" element={<Lazy><NewsletterDiagnostics /></Lazy>} />
      <Route path="newsletters/:id/stats" element={<Lazy><NewsletterStats /></Lazy>} />
      <Route path="newsletters/:id/activity" element={<Lazy><NewsletterActivity /></Lazy>} />
      </Route>

      {/* ─── ADVANCED ─── */}
      <Route path="ai-settings" element={<Lazy><AiSettings /></Lazy>} />
      <Route path="email-settings" element={<Lazy><EmailSettings /></Lazy>} />
      <Route path="email-deliverability" element={<Lazy><EmailDeliverability /></Lazy>} />
      <Route path="feed-algorithm" element={<TenantRedirect to="/admin/algorithm-settings" />} />
      <Route path="algorithm-settings" element={<Lazy><AlgorithmSettings /></Lazy>} />
      <Route path="seo" element={<Lazy><SeoOverview /></Lazy>} />
      <Route path="seo/audit" element={<Lazy><SeoAudit /></Lazy>} />
      <Route path="seo/redirects" element={<Lazy><Redirects /></Lazy>} />
      <Route element={<SuperAdminRoute />}>
        <Route path="seo/prerender" element={<Lazy><PrerenderAdmin /></Lazy>} />
      </Route>
      <Route path="404-errors" element={<Lazy><Error404Tracking /></Lazy>} />
      <Route path="match-debug" element={<Lazy><MatchDebugPanel /></Lazy>} />

      {/* ─── BILLING ─── */}
      <Route path="member-premium" element={
        <FeatureGatedElement feature="member_premium">
          <Lazy><MemberPremiumAdminPage /></Lazy>
        </FeatureGatedElement>
      } />
      <Route path="member-premium/subscribers" element={
        <FeatureGatedElement feature="member_premium">
          <Lazy><MemberPremiumSubscribersPage /></Lazy>
        </FeatureGatedElement>
      } />
      <Route path="billing" element={<Lazy><BillingPage /></Lazy>} />
      <Route path="billing/plans" element={<Lazy><PlanSelector /></Lazy>} />
      <Route path="billing/invoices" element={<Lazy><InvoiceHistory /></Lazy>} />
      <Route path="billing/checkout-return" element={<Lazy><CheckoutReturn /></Lazy>} />

      {/* ─── FINANCIAL ─── */}
      <Route path="timebanking" element={<Lazy><TimebankingDashboard /></Lazy>} />
      <Route path="timebanking/alerts" element={<Lazy><FraudAlerts /></Lazy>} />
      <Route path="timebanking/user-report" element={<Lazy><UserReport /></Lazy>} />
      <Route path="timebanking/user-report/:id" element={<Lazy><UserReport /></Lazy>} />
      <Route path="timebanking/org-wallets" element={<Lazy><OrgWallets /></Lazy>} />
      <Route path="timebanking/create-org" element={<Lazy><OrgWallets /></Lazy>} />
      <Route path="timebanking/starting-balances" element={<Lazy><StartingBalances /></Lazy>} />
      <Route path="timebanking/community-fund" element={<Lazy><CommunityFund /></Lazy>} />
      <Route path="plans" element={<Lazy><PlansAdmin /></Lazy>} />
      <Route path="plans/subscriptions" element={<Lazy><SubscriptionsAdmin /></Lazy>} />
      <Route element={<SuperAdminRoute />}>
        <Route path="plans/create" element={<Lazy><PlanForm /></Lazy>} />
        <Route path="plans/edit/:id" element={<Lazy><PlanForm /></Lazy>} />
      </Route>

      {/* ─── ENTERPRISE ─── */}
      <Route path="enterprise" element={<Lazy><EnterpriseDashboard /></Lazy>} />
      <Route path="enterprise/roles" element={<Lazy><RoleList /></Lazy>} />
      <Route path="enterprise/roles/create" element={<Lazy><RoleForm /></Lazy>} />
      <Route path="enterprise/roles/:id" element={<Lazy><RoleForm /></Lazy>} />
      <Route path="enterprise/roles/:id/edit" element={<Lazy><RoleForm /></Lazy>} />
      <Route path="enterprise/permissions" element={<Lazy><PermissionBrowser /></Lazy>} />
      <Route path="enterprise/gdpr" element={<Lazy><GdprDashboard /></Lazy>} />
      <Route path="enterprise/gdpr/requests" element={<Lazy><GdprRequests /></Lazy>} />
      <Route path="enterprise/gdpr/requests/create" element={<Lazy><GdprRequestCreate /></Lazy>} />
      <Route path="enterprise/gdpr/requests/:id" element={<Lazy><GdprRequestDetail /></Lazy>} />
      <Route path="enterprise/gdpr/consents" element={<Lazy><GdprConsents /></Lazy>} />
      <Route path="enterprise/gdpr/consent-types" element={<Lazy><GdprConsentTypes /></Lazy>} />
      <Route path="enterprise/gdpr/breaches" element={<Lazy><GdprBreaches /></Lazy>} />
      <Route path="enterprise/gdpr/breaches/:id" element={<Lazy><GdprBreachDetail /></Lazy>} />
      <Route path="enterprise/gdpr/audit" element={<Lazy><GdprAuditLog /></Lazy>} />

      {/* AG42 — Swiss FADP compliance */}
      <Route path="enterprise/fadp" element={<Lazy><FadpAdminPage /></Lazy>} />
      <Route path="enterprise/monitoring" element={<Lazy><SystemMonitoring /></Lazy>} />
      <Route path="enterprise/monitoring/health" element={<Lazy><HealthCheck /></Lazy>} />
      <Route path="enterprise/monitoring/logs" element={<Lazy><ErrorLogs /></Lazy>} />
      <Route path="enterprise/monitoring/log-files" element={<Lazy><LogFiles /></Lazy>} />
      <Route path="enterprise/monitoring/log-files/:filename" element={<Lazy><LogFileViewer /></Lazy>} />
      <Route path="enterprise/monitoring/requirements" element={<Lazy><SystemRequirements /></Lazy>} />

      {/* ─── PERFORMANCE ─── */}
      <Route path="performance" element={<Lazy><PerformanceDashboard /></Lazy>} />
      <Route path="legal-documents" element={<Lazy><LegalDocList /></Lazy>} />
      <Route path="legal-documents/create" element={<Lazy><LegalDocForm /></Lazy>} />
      <Route path="legal-documents/compliance" element={<Lazy><LegalDocComplianceDashboard /></Lazy>} />
      <Route path="legal-documents/:id" element={<TenantParamRedirect to="/admin/legal-documents/:id/edit" />} />
      <Route path="legal-documents/:id/edit" element={<Lazy><LegalDocForm /></Lazy>} />
      <Route path="legal-documents/:id/versions" element={<Lazy><LegalDocVersionList /></Lazy>} />
      <Route path="legal-documents/:id/versions/new" element={<Lazy><LegalDocVersionEditor /></Lazy>} />
      <Route path="legal-documents/:id/versions/:versionId/edit" element={<Lazy><LegalDocVersionEditor /></Lazy>} />

      {/* ─── FEDERATION ─── */}
      {/* Partner Timebanks (all /admin/federation/* pages) + Inbound API
          Partners are fully retired from the admin panel (owner-approved
          2026-07-02, no redirects) — they live in the super-admin-only
          Partner Timebanks panel at /partner-timebanks/*. */}

      {/* ─── SAFEGUARDING ─── */}
      {/* Safeguarding dashboard + options are fully retired from the admin
          panel (owner-approved 2026-07-02, no redirects) — they live in the
          broker panel at /broker/safeguarding and /broker/safeguarding-options. */}

      {/* ─── SYSTEM ─── */}
      <Route path="settings" element={<Lazy><AdminSettings /></Lazy>} />
      <Route path="settings/registration-policy" element={<Lazy><RegistrationPolicySettings /></Lazy>} />
      <Route path="onboarding-settings" element={<Lazy><OnboardingSettings /></Lazy>} />
      {/* /admin/tenant-features retired — unified into module-configuration */}
      <Route path="tenant-features" element={<TenantRedirect to="/admin/module-configuration" />} />
      <Route path="module-configuration" element={<Lazy><ModuleConfiguration /></Lazy>} />
      <Route path="operations" element={<Lazy><Operations /></Lazy>} />
      <Route path="support-reports" element={<Lazy><SupportReportsPage /></Lazy>} />
      <Route path="translation-config" element={<Lazy><TranslationConfig /></Lazy>} />
      <Route path="cron-jobs" element={<Lazy><CronJobs /></Lazy>} />
      <Route path="cron-jobs/logs" element={<Lazy><CronJobLogs /></Lazy>} />
      <Route path="cron-jobs/settings" element={<Lazy><CronJobSettings /></Lazy>} />
      <Route path="cron-jobs/setup" element={<Lazy><CronJobSetup /></Lazy>} />
      <Route path="activity-log" element={<Lazy><ActivityLog /></Lazy>} />
      <Route path="retention" element={<Lazy><RetentionPolicies /></Lazy>} />
      <Route path="sso" element={<Lazy><SsoProviders /></Lazy>} />
      <Route path="tests" element={<Lazy><TestRunner /></Lazy>} />
      <Route path="seed-generator" element={<Lazy><SeedGenerator /></Lazy>} />
      <Route path="webp-converter" element={<Lazy><WebpConverter /></Lazy>} />
      <Route path="image-settings" element={<Lazy><ImageSettings /></Lazy>} />
      <Route path="native-app" element={<Lazy><NativeApp /></Lazy>} />
      <Route path="blog-restore" element={<Lazy><BlogRestore /></Lazy>} />

      {/* ─── COMMUNITY TOOLS ─── */}
      <Route path="groups" element={<Lazy><GroupList /></Lazy>} />
      <Route path="groups/analytics" element={<Lazy><GroupAnalytics /></Lazy>} />
      <Route path="groups/approvals" element={<Lazy><GroupApprovals /></Lazy>} />
      <Route path="groups/moderation" element={<Lazy><GroupModeration /></Lazy>} />
      <Route path="groups/types" element={<Lazy><GroupTypes /></Lazy>} />
      <Route path="groups/:id/detail" element={<Lazy><GroupDetail /></Lazy>} />
      <Route path="groups/:id/edit" element={<TenantParamRedirect to="/groups/edit/:id" />} />
      <Route path="groups/recommendations" element={<Lazy><GroupRecommendations /></Lazy>} />
      <Route path="groups/ranking" element={<Lazy><GroupRanking /></Lazy>} />
      <Route path="groups/organization" element={<Lazy><GroupOrganization /></Lazy>} />
      <Route path="residency-verifications" element={<FeatureGatedElement feature="caring_community"><Lazy><ResidencyVerifications /></Lazy></FeatureGatedElement>} />
      <Route path="group-types" element={<Lazy><GroupList /></Lazy>} />
      <Route path="group-ranking" element={<Lazy><GroupList /></Lazy>} />
      <Route path="group-locations" element={<Lazy><GroupGeocode /></Lazy>} />
      <Route path="geocode-groups" element={<Lazy><GroupGeocode /></Lazy>} />
      <Route path="smart-match-users" element={<Lazy><SmartMatchUsers /></Lazy>} />
      <Route path="smart-match-monitoring" element={<Lazy><SmartMatchMonitoring /></Lazy>} />
      <Route path="volunteering" element={<FeatureGatedElement feature="volunteering"><Lazy><VolunteeringOverview /></Lazy></FeatureGatedElement>} />
      <Route path="volunteering/approvals" element={<FeatureGatedElement feature="volunteering"><Lazy><VolunteerApprovals /></Lazy></FeatureGatedElement>} />
      <Route path="volunteering/swaps" element={<FeatureGatedElement feature="volunteering"><Lazy><VolunteerSwaps /></Lazy></FeatureGatedElement>} />
      <Route path="volunteering/organizations" element={<FeatureGatedElement feature="volunteering"><Lazy><VolunteerOrganizations /></Lazy></FeatureGatedElement>} />
      <Route path="volunteering/expenses" element={<FeatureGatedElement feature="volunteering"><Lazy><VolunteerExpenses /></Lazy></FeatureGatedElement>} />
      <Route path="volunteering/training" element={<FeatureGatedElement feature="volunteering"><Lazy><VolunteerTraining /></Lazy></FeatureGatedElement>} />
      <Route path="volunteering/safeguarding" element={<FeatureGatedElement feature="volunteering"><Lazy><VolunteerSafeguarding /></Lazy></FeatureGatedElement>} />
      <Route path="volunteering/hours" element={<FeatureGatedElement feature="volunteering"><Lazy><VolunteerHoursAudit /></Lazy></FeatureGatedElement>} />
      <Route path="volunteering/giving-days" element={<FeatureGatedElement feature="volunteering"><Lazy><VolunteerGivingDays /></Lazy></FeatureGatedElement>} />
      <Route path="volunteering/donations" element={<FeatureGatedElement feature="volunteering"><Lazy><DonationRefunds /></Lazy></FeatureGatedElement>} />
      <Route path="volunteering/consents" element={<FeatureGatedElement feature="volunteering"><Lazy><VolunteerConsents /></Lazy></FeatureGatedElement>} />
      <Route path="volunteering/projects" element={<FeatureGatedElement feature="volunteering"><Lazy><VolunteerProjects /></Lazy></FeatureGatedElement>} />
      <Route path="volunteering/config" element={<FeatureGatedElement feature="volunteering"><Lazy><VolunteerConfig /></Lazy></FeatureGatedElement>} />
      {/* ─── CARING COMMUNITY — retired from /admin, now lives at /caring/* ─── */}
      {/* These redirects preserve bookmarks to the old /admin/caring-community/* URLs. */}
      <Route path="caring-community" element={<TenantRedirect to="/caring" />} />
      <Route path="caring-community/workflow" element={<TenantRedirect to="/caring/workflow" />} />
      <Route path="caring-community/projects" element={<TenantRedirect to="/caring/projects" />} />
      <Route path="caring-community/loyalty" element={<TenantRedirect to="/caring/loyalty" />} />
      <Route path="caring-community/hour-transfers" element={<TenantRedirect to="/caring/hour-transfers" />} />
      <Route path="caring-community/sub-regions" element={<TenantRedirect to="/caring/sub-regions" />} />
      <Route path="caring-community/regional-points" element={<TenantRedirect to="/caring/regional-points" />} />
      <Route path="caring-community/federation-peers" element={<TenantRedirect to="/partner-timebanks/caring/peers" />} />
      <Route path="caring-community/sla-dashboard" element={<TenantRedirect to="/caring/sla-dashboard" />} />
      <Route path="caring-community/providers" element={<TenantRedirect to="/caring/providers" />} />
      <Route path="caring-community/warmth-pass" element={<TenantRedirect to="/caring/warmth-pass" />} />
      <Route path="caring-community/warmth-pass/:userId" element={<TenantParamRedirect to="/caring/warmth-pass/:userId" />} />
      <Route path="caring-community/recipient-circle" element={<TenantRedirect to="/caring/recipient-circle" />} />
      <Route path="caring-community/nudges" element={<TenantRedirect to="/caring/nudges" />} />
      <Route path="caring-community/emergency-alerts" element={<TenantRedirect to="/caring/emergency-alerts" />} />
      <Route path="caring-community/surveys" element={<TenantRedirect to="/caring/surveys" />} />
      <Route path="caring-community/copilot" element={<TenantRedirect to="/caring/copilot" />} />
      <Route path="caring-community/civic-digest" element={<TenantRedirect to="/caring/civic-digest" />} />
      <Route path="caring-community/lead-nurture" element={<TenantRedirect to="/caring/lead-nurture" />} />
      <Route path="caring-community/success-stories" element={<TenantRedirect to="/caring/success-stories" />} />
      <Route path="caring-community/feedback" element={<TenantRedirect to="/caring/feedback" />} />
      <Route path="caring-community/verification" element={<TenantRedirect to="/caring/verification" />} />
      <Route path="caring-community/safeguarding" element={<TenantRedirect to="/caring/safeguarding" />} />
      <Route path="caring-community/trust-tier" element={<TenantRedirect to="/caring/trust-tier" />} />
      <Route path="caring-community/launch-readiness" element={<TenantRedirect to="/caring/launch-readiness" />} />
      <Route path="caring-community/pilot-scoreboard" element={<TenantRedirect to="/caring/pilot-scoreboard" />} />
      <Route path="caring-community/data-quality" element={<TenantRedirect to="/caring/data-quality" />} />
      <Route path="caring-community/operating-policy" element={<TenantRedirect to="/caring/operating-policy" />} />
      <Route path="caring-community/disclosure-pack" element={<TenantRedirect to="/caring/disclosure-pack" />} />
      <Route path="caring-community/commercial-boundary" element={<TenantRedirect to="/caring/commercial-boundary" />} />
      <Route path="caring-community/isolated-node" element={<TenantRedirect to="/caring/isolated-node" />} />
      <Route path="caring-community/research" element={<TenantRedirect to="/caring/research" />} />
      <Route path="caring-community/external-integrations" element={<TenantRedirect to="/caring/external-integrations" />} />
      <Route path="caring-community/integration-showcase" element={<TenantRedirect to="/caring/integration-showcase" />} />
      <Route path="caring-community/municipal-impact" element={<TenantRedirect to="/caring/municipal-impact" />} />
      <Route path="caring-community/kpi-baselines" element={<TenantRedirect to="/caring/kpi-baselines" />} />
      <Route path="caring-community/municipal-roi" element={<TenantRedirect to="/caring/municipal-roi" />} />
      <Route path="caring-community/category-coefficients" element={<TenantRedirect to="/caring/category-coefficients" />} />

      {/* /admin/regional-points → /caring/regional-points */}
      <Route path="regional-points" element={<TenantRedirect to="/caring/regional-points" />} />


      {/* AG56 — Local advertising campaigns */}
      <Route path="advertising/campaigns" element={<Lazy><AdCampaignAdminPage /></Lazy>} />

      {/* AG57 — Paid push campaigns */}
      <Route path="advertising/push-campaigns" element={<Lazy><PushCampaignAdminPage /></Lazy>} />

      {/* AG61 — KI-Agenten autonomous framework */}
      <Route path="ai/ki-agents" element={<Lazy><KiAgentAdminPage /></Lazy>} />

      {/* AI chat — admin-editable "how each module works" prompt docs */}
      <Route path="ai/module-docs" element={<Lazy><AiModuleDocsAdminPage /></Lazy>} />

      {/* AI chat — cost / latency / tool / unanswered-question metrics */}
      <Route path="ai/metrics" element={<Lazy><AiTraceMetricsAdminPage /></Lazy>} />

      {/* AG61 — new KI-Agenten admin (definitions, proposals, runs) */}
      <Route path="agents" element={<Lazy><AgentsAdminPage /></Lazy>} />
      <Route path="agents/proposals" element={<Lazy><AgentProposalsPage /></Lazy>} />
      <Route path="agents/runs" element={<Lazy><AgentRunsPage /></Lazy>} />

      {/* AG59 — Regional analytics product */}
      <Route path="analytics/regional" element={<Lazy><RegionalAnalyticsPage /></Lazy>} />

      {/* AG71 — Pilot region inquiry funnel */}
      <Route path="platform/pilot-inquiries" element={<TenantRedirect to="/super-admin/platform/pilot-inquiries" />} />

      {/* AG44 — Self-service tenant provisioning queue (super-admin) */}
      <Route path="provisioning-requests" element={<TenantRedirect to="/super-admin/provisioning-requests" />} />

      {/* ─── EVENTS ─── */}
      <Route path="events" element={<Lazy><EventsAdmin /></Lazy>} />
      <Route path="events/settings" element={<Lazy><EventSettings /></Lazy>} />

      {/* ─── POLLS ─── */}
      <Route path="polls" element={<Lazy><PollsAdmin /></Lazy>} />

      {/* ─── GOALS ─── */}
      <Route path="goals" element={<Lazy><GoalsAdmin /></Lazy>} />

      {/* ─── RESOURCES / KNOWLEDGE BASE ─── */}
      <Route path="resources" element={<Lazy><ResourcesAdmin /></Lazy>} />
      <Route path="resources/create" element={<Lazy><KBArticleForm /></Lazy>} />
      <Route path="resources/edit/:id" element={<Lazy><KBArticleForm /></Lazy>} />
      <Route path="resources/categories" element={<Lazy><ResourceCategoriesAdmin /></Lazy>} />

      {/* ─── JOBS ─── */}
      <Route path="jobs" element={<Lazy><JobsAdmin /></Lazy>} />
      <Route path="jobs/moderation" element={<Lazy><JobModerationQueue /></Lazy>} />
      <Route path="jobs/bias-audit" element={<Lazy><JobBiasAudit /></Lazy>} />
      <Route path="jobs/pipeline" element={<Lazy><JobPipelineOverview /></Lazy>} />
      <Route path="jobs/templates" element={<Lazy><JobTemplatesAdmin /></Lazy>} />

      {/* ─── COURSES (ALPHA) ─── */}
      <Route path="courses" element={<Lazy><CoursesAdmin /></Lazy>} />

      <Route path="podcasts" element={
        <FeatureGatedElement feature="podcasts">
          <Lazy><PodcastsAdmin /></Lazy>
        </FeatureGatedElement>
      } />

      {/* ─── MARKETPLACE ─── */}
      <Route path="marketplace" element={<Lazy><MarketplaceAdmin /></Lazy>} />
      <Route path="marketplace/moderation" element={<Lazy><MarketplaceModerationPage /></Lazy>} />
      <Route path="marketplace/sellers" element={<Lazy><MarketplaceSellerAdmin /></Lazy>} />
      <Route path="marketplace/cases" element={<Lazy><MarketplaceCasesPage /></Lazy>} />
      <Route path="marketplace/coupons" element={<Lazy><AdminCouponsPage /></Lazy>} />

      {/* ─── PARTNER VENUES ─── */}
      <Route path="partner-venues" element={<Lazy><PartnerVenuesAdminPage /></Lazy>} />

      {/* ─── IDEATION / CHALLENGES ─── */}
      <Route path="ideation" element={<Lazy><IdeationAdmin /></Lazy>} />

      {/* ─── DELIVERABILITY ─── */}
      <Route path="deliverability" element={<Lazy><DeliverabilityDashboard /></Lazy>} />
      <Route path="deliverability/list" element={<Lazy><DeliverablesList /></Lazy>} />
      <Route path="deliverability/create" element={<Lazy><CreateDeliverable /></Lazy>} />
      <Route path="deliverability/edit/:id" element={<Lazy><EditDeliverable /></Lazy>} />
      <Route path="deliverability/analytics" element={<Lazy><DeliverabilityAnalytics /></Lazy>} />

      {/* ─── MATCHING DIAGNOSTIC ─── */}
      <Route path="matching-diagnostic" element={<Lazy><MatchingDiagnostic /></Lazy>} />

      {/* ─── NEXUS SCORE ─── */}
      <Route path="nexus-score/analytics" element={<Lazy><NexusScoreAnalytics /></Lazy>} />

      {/* ─── SUPER ADMIN (requires super admin role) ─── */}
      <Route path="super" element={<TenantRedirect to="/super-admin" />} />
      <Route path="super/*" element={<TenantSplatRedirect to="/super-admin" />} />

      {/* ─── NATIONAL CARING COMMUNITY FOUNDATION DASHBOARD (super-admin / national_admin) ─── */}
      <Route path="national/kiss" element={<TenantRedirect to="/super-admin/national/kiss" />} />

      {/* ─── ANALYTICS & REPORTING ─── */}
      <Route path="community-analytics" element={<Lazy><CommunityAnalytics /></Lazy>} />
      <Route path="search-analytics" element={<Lazy><SearchAnalytics /></Lazy>} />
      <Route path="impact-report" element={<Lazy><ImpactReport /></Lazy>} />
      <Route path="reports/social-value" element={<TenantRedirect to="/admin/impact-report" />} />
      <Route path="reports/members" element={<Lazy><MemberReportsPage /></Lazy>} />
      <Route path="reports/hours" element={<Lazy><HoursReportsPage /></Lazy>} />
      <Route path="reports/municipal-impact" element={<TenantRedirect to="/caring/municipal-impact" />} />
      <Route path="reports/inactive-members" element={<Lazy><InactiveMembersPage /></Lazy>} />
      {/* Content Queue (moderation/queue) retired — now at /broker/moderation/queue. */}

      {/* ─── SELLABLE PRODUCTS — Regional Analytics (AG59) ─── */}
      <Route path="regional-analytics/subscriptions" element={<TenantRedirect to="/super-admin/regional-analytics/subscriptions" />} />

      {/* ─── INTEGRATIONS — API Partners (AG60) ─── */}
      {/* Retired from the admin panel 2026-07-02 (no redirects) — now at
          /partner-timebanks/inbound-api in the Partner Timebanks panel. */}

      {/* ─── REDIRECT: /admin/login → main login page ─── */}
      <Route path="login" element={<TenantRedirect to="/login" />} />

      {/* ─── HELP CENTRE ─── */}
      <Route path="help" element={<Lazy><AdminHelpCenterPage /></Lazy>} />
      <Route path="help/faqs" element={<Lazy><HelpFaqsAdmin /></Lazy>} />

      {/* ─── 404 CATCH-ALL ─── */}
      <Route path="*" element={<Lazy><AdminNotFound /></Lazy>} />
    </>
  );
}

export default AdminRoutes;
