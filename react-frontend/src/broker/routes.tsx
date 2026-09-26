// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * Broker Panel Routes
 * All broker pages are lazy-loaded for code splitting.
 */

import { Suspense, lazy } from 'react';
import { Route, Navigate } from 'react-router-dom';
import { LoadingScreen } from '@/components/feedback';
import { useTenant } from '@/contexts';

/**
 * Tenant-aware fallback for unmatched /broker/* paths. Without using
 * tenantPath() here a literal `/broker` redirect would drop the tenant
 * slug; with relative `to=""` React Router preserves the current path
 * and never resolves the unmatched segment.
 */
function BrokerNotFoundRedirect() {
  const { tenantPath } = useTenant();
  return <Navigate to={tenantPath('/broker')} replace />;
}

/** Bare /broker/moderation → the Content Queue (its landing page). */
function BrokerModerationIndexRedirect() {
  const { tenantPath } = useTenant();
  return <Navigate to={tenantPath('/broker/moderation/queue')} replace />;
}

/**
 * Exchange pages depend on the `exchange_workflow` tenant feature. The rest of
 * the broker panel does not, so only these routes are feature-gated (the nav
 * item is hidden too — see BrokerSidebar). A broker on a tenant without the
 * feature who deep-links here is bounced back to the broker dashboard.
 */
function ExchangeFeatureRoute({ children }: { children: React.ReactNode }) {
  const { tenantPath, hasFeature } = useTenant();
  if (!hasFeature('exchange_workflow')) {
    return <Navigate to={tenantPath('/broker')} replace />;
  }
  return <>{children}</>;
}

/**
 * Generic tenant-feature gate for broker sub-pages (e.g. reviews moderation
 * on the `reviews` feature). Deep-links on a tenant without the feature bounce
 * back to the broker dashboard, matching how the admin sidebar hides them.
 */
function FeatureRoute({ feature, children }: { feature: 'reviews'; children: React.ReactNode }) {
  const { tenantPath, hasFeature } = useTenant();
  if (!hasFeature(feature)) {
    return <Navigate to={tenantPath('/broker')} replace />;
  }
  return <>{children}</>;
}

/** Generic tenant-module gate (e.g. feed moderation on the `feed` module). */
function ModuleRoute({ module, children }: { module: 'feed'; children: React.ReactNode }) {
  const { tenantPath, hasModule } = useTenant();
  if (!hasModule(module)) {
    return <Navigate to={tenantPath('/broker')} replace />;
  }
  return <>{children}</>;
}

// Core daily-workflow pages
const BrokerDashboardPage = lazy(() => import('./pages/BrokerDashboardPage'));
const MembersPage = lazy(() => import('./pages/MembersPage'));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage'));
const SafeguardingPage = lazy(() => import('./pages/SafeguardingPage'));
const VettingPage = lazy(() => import('./pages/VettingPage'));
const ExchangesPage = lazy(() => import('./pages/ExchangesPage'));
const MessageReviewPage = lazy(() => import('./pages/MessageReviewPage'));

// Matching (gated on exchange_workflow like Exchanges)
const MatchApprovalsPage = lazy(() => import('./pages/MatchApprovalsPage'));
const MatchApprovalDetailPage = lazy(() => import('./pages/MatchApprovalDetailPage'));

// Detail / drill-down pages
const ExchangeDetailPage = lazy(() => import('./pages/ExchangeDetailPage'));
const MessageDetailPage = lazy(() => import('./pages/MessageDetailPage'));
const ArchiveDetailPage = lazy(() => import('./pages/ArchiveDetailPage'));

// Compliance & oversight pages (ported from admin/broker-controls)
const RiskTagsPage = lazy(() => import('./pages/RiskTagsPage'));
const UserMonitoringPage = lazy(() => import('./pages/UserMonitoringPage'));
const InsuranceCertificatesPage = lazy(() => import('./pages/InsuranceCertificatesPage'));
const ReviewArchivePage = lazy(() => import('./pages/ReviewArchivePage'));
const SafeguardingOptionsPage = lazy(() => import('./pages/SafeguardingOptionsPage'));

// Moderation pages — reuse the admin modules inside the broker shell.
const ContentQueuePage = lazy(() => import('./pages/ContentQueuePage'));
const FeedModerationPage = lazy(() => import('./pages/FeedModerationPage'));
const CommentsModerationPage = lazy(() => import('./pages/CommentsModerationPage'));
const ReviewsModerationPage = lazy(() => import('./pages/ReviewsModerationPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));

// Settings & help
const BrokerConfigurationPage = lazy(() => import('./pages/BrokerConfigurationPage'));
const BrokerHelpPage = lazy(() => import('./pages/BrokerHelpPage'));

function Lazy({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<LoadingScreen />}>{children}</Suspense>;
}

export function BrokerRoutes() {
  return (
    <>
      <Route index element={<Lazy><BrokerDashboardPage /></Lazy>} />

      {/* Daily workflow */}
      <Route path="members" element={<Lazy><MembersPage /></Lazy>} />
      <Route path="onboarding" element={<Lazy><OnboardingPage /></Lazy>} />
      <Route path="safeguarding" element={<Lazy><SafeguardingPage /></Lazy>} />

      {/* Exchanges — gated on the exchange_workflow feature */}
      <Route path="exchanges" element={<ExchangeFeatureRoute><Lazy><ExchangesPage /></Lazy></ExchangeFeatureRoute>} />
      <Route path="exchanges/:id" element={<ExchangeFeatureRoute><Lazy><ExchangeDetailPage /></Lazy></ExchangeFeatureRoute>} />

      {/* Match approvals — same feature gate as Exchanges (smart matching
          feeds the exchange workflow; the admin sidebar gates it the same way). */}
      <Route path="match-approvals" element={<ExchangeFeatureRoute><Lazy><MatchApprovalsPage /></Lazy></ExchangeFeatureRoute>} />
      <Route path="match-approvals/:id" element={<ExchangeFeatureRoute><Lazy><MatchApprovalDetailPage /></Lazy></ExchangeFeatureRoute>} />

      {/* Messages */}
      <Route path="messages" element={<Lazy><MessageReviewPage /></Lazy>} />
      <Route path="messages/:id" element={<Lazy><MessageDetailPage /></Lazy>} />

      {/* Moderation — reuses the admin modules; feed gated on the feed module,
          reviews on the reviews feature (mirrors the old admin sidebar gates). */}
      <Route path="moderation" element={<BrokerModerationIndexRedirect />} />
      <Route path="moderation/queue" element={<Lazy><ContentQueuePage /></Lazy>} />
      <Route path="moderation/feed" element={<ModuleRoute module="feed"><Lazy><FeedModerationPage /></Lazy></ModuleRoute>} />
      <Route path="moderation/comments" element={<Lazy><CommentsModerationPage /></Lazy>} />
      <Route path="moderation/reviews" element={<FeatureRoute feature="reviews"><Lazy><ReviewsModerationPage /></Lazy></FeatureRoute>} />
      <Route path="moderation/reports" element={<Lazy><ReportsPage /></Lazy>} />

      {/* Vetting */}
      <Route path="vetting" element={<Lazy><VettingPage /></Lazy>} />

      {/* Compliance & oversight */}
      <Route path="monitoring" element={<Lazy><UserMonitoringPage /></Lazy>} />
      <Route path="risk-tags" element={<Lazy><RiskTagsPage /></Lazy>} />
      <Route path="insurance" element={<Lazy><InsuranceCertificatesPage /></Lazy>} />
      <Route path="safeguarding-options" element={<Lazy><SafeguardingOptionsPage /></Lazy>} />

      {/* Records */}
      <Route path="archives" element={<Lazy><ReviewArchivePage /></Lazy>} />
      <Route path="archives/:id" element={<Lazy><ArchiveDetailPage /></Lazy>} />

      {/* Settings & help */}
      <Route path="configuration" element={<Lazy><BrokerConfigurationPage /></Lazy>} />
      <Route path="help" element={<Lazy><BrokerHelpPage /></Lazy>} />
      <Route path="help/:sectionId/:articleId" element={<Lazy><BrokerHelpPage /></Lazy>} />

      {/* Unknown sub-route under /broker → bounce back to the broker dashboard. */}
      <Route path="*" element={<BrokerNotFoundRedirect />} />
    </>
  );
}
