// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

/**
 * NEXUS React Frontend - Tenant route registry.
 *
 * Kept outside App.tsx so the first app chunk does not carry every route's
 * dynamic-import dependency map. TenantShell loads this module when it is ready
 * to render tenant-scoped routes.
 */

import { type ReactNode } from 'react';
import { Route, Navigate, useLocation, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useTenant } from '@/contexts/TenantContext';
import { CARING_COMMUNITY_ROUTE } from '@/pages/caring-community/config';
import { ProtectedRoute } from '@/components/routing/ProtectedRoute';
import { FeatureGate } from '@/components/routing/FeatureGate';
import { ErrorBoundary } from '@/components/feedback/ErrorBoundary';
import { FeatureErrorBoundary } from '@/components/feedback/FeatureErrorBoundary';
import { lazyWithRetry } from './lazyWithRetry';
import { renderSharedPublicFeatureRoutes } from './sharedPublicFeatureRoutes';

const VerifyIdentityOptionalPage = lazyWithRetry(() => import('@/pages/settings/VerifyIdentityOptionalPage'));

function LegacyEventEditRedirect() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const { tenantPath } = useTenant();
  return <Navigate to={`${tenantPath(`/events/${id}/edit`)}${location.search}${location.hash}`} replace />;
}

// Full app shell (navbar, drawers, footer, podcast, session/update UI) is not
// needed for login/register startup. Keep it in its own route chunk.
const Layout = lazyWithRetry(() => import('@/components/layout/Layout'));

// Admin Panel (lazy-loaded — keeps recharts, jsPDF, admin sidebar/header out of main bundle)
const AdminApp = lazyWithRetry(() => import('@/admin/AdminApp'));

// Super Admin Panel (lazy-loaded — separate platform-wide admin area)
const SuperAdminApp = lazyWithRetry(() => import('@/super-admin/SuperAdminApp'));

// Broker Panel (lazy-loaded — simplified admin interface for brokers)
const BrokerApp = lazyWithRetry(() => import('@/broker/BrokerApp'));

// Partner Timebanks Panel (lazy-loaded federation/partner hub; sensitive routes gate inside)
const PartnersApp = lazyWithRetry(() => import('@/partners/PartnersApp'));

// Community Caring Panel (lazy-loaded — dedicated hub for caring_community module)
const CaringApp = lazyWithRetry(() => import('@/caring/CaringApp'));

// Lazy-loaded Pages (all use lazyWithRetry to handle stale chunk errors after deploys)
const HomePage = lazyWithRetry(() => import('@/pages/public/HomePage'));
const DashboardPage = lazyWithRetry(() => import('@/pages/dashboard/DashboardPage'));
const ListingsPage = lazyWithRetry(() => import('@/pages/listings/ListingsPage'));
const ListingDetailPage = lazyWithRetry(() => import('@/pages/listings/ListingDetailPage'));
const CreateListingPage = lazyWithRetry(() => import('@/pages/listings/CreateListingPage'));
const MessagesPage = lazyWithRetry(() => import('@/pages/messages/MessagesPage'));
const ConversationPage = lazyWithRetry(() => import('@/pages/messages/ConversationPage'));
const WalletPage = lazyWithRetry(() => import('@/pages/wallet/WalletPage'));
const ProfilePage = lazyWithRetry(() => import('@/pages/profile/ProfilePage'));
// SOC10 / SOC14 — collections & appreciations
const MyCollectionsPage = lazyWithRetry(() => import('@/pages/profile/MyCollectionsPage'));
const CollectionDetailPage = lazyWithRetry(() => import('@/pages/profile/CollectionDetailPage'));
const UserCollectionsView = lazyWithRetry(() => import('@/pages/profile/UserCollectionsView'));
const AppreciationWallPage = lazyWithRetry(() => import('@/pages/profile/AppreciationWallPage'));
const SettingsPage = lazyWithRetry(() => import('@/pages/settings/SettingsPage'));
const BlockedUsersPage = lazyWithRetry(() => import('@/pages/settings/BlockedUsersPage'));
const SearchPage = lazyWithRetry(() => import('@/pages/search/SearchPage'));
const NotificationsPage = lazyWithRetry(() => import('@/pages/notifications/NotificationsPage'));
const MembersPage = lazyWithRetry(() => import('@/pages/members/MembersPage'));
const EventsPage = lazyWithRetry(() => import('@/pages/events/EventsPage'));
const EventDetailPage = lazyWithRetry(() => import('@/pages/events/EventDetailPage'));
const EventManagePage = lazyWithRetry(() => import('@/pages/events/EventManagePage'));
const CreateEventPage = lazyWithRetry(() => import('@/pages/events/CreateEventPage'));
const GroupsPage = lazyWithRetry(() => import('@/pages/groups/GroupsPage'));
const GroupDetailPage = lazyWithRetry(() => import('@/pages/groups/GroupDetailPage'));
const CreateGroupPage = lazyWithRetry(() => import('@/pages/groups/CreateGroupPage'));
const GroupInviteAcceptPage = lazyWithRetry(() => import('@/pages/groups/GroupInviteAcceptPage'));
const NotFoundPage = lazyWithRetry(() => import('@/pages/errors/NotFoundPage'));
const ComingSoonPage = lazyWithRetry(() => import('@/pages/errors/ComingSoonPage'));
const ExchangesPage = lazyWithRetry(() => import('@/pages/exchanges/ExchangesPage'));
const ExchangeDetailPage = lazyWithRetry(() => import('@/pages/exchanges/ExchangeDetailPage'));
const RequestExchangePage = lazyWithRetry(() => import('@/pages/exchanges/RequestExchangePage'));
const LeaderboardPage = lazyWithRetry(() => import('@/pages/leaderboard/LeaderboardPage'));
const AchievementsPage = lazyWithRetry(() => import('@/pages/achievements/AchievementsPage'));
const NexusScorePage = lazyWithRetry(() => import('@/pages/nexus-score/NexusScorePage'));
const GoalsPage = lazyWithRetry(() => import('@/pages/goals/GoalsPage'));
const GoalDetailPage = lazyWithRetry(() => import('@/pages/goals/GoalDetailPage'));
const PollsPage = lazyWithRetry(() => import('@/pages/polls/PollsPage'));
const JobsPage = lazyWithRetry(() => import('@/pages/jobs/JobsPage'));
const JobDetailPage = lazyWithRetry(() => import('@/pages/jobs/JobDetailPage'));
const CreateJobPage = lazyWithRetry(() => import('@/pages/jobs/CreateJobPage'));
const JobAnalyticsPage = lazyWithRetry(() => import('@/pages/jobs/JobAnalyticsPage'));
const JobAlertsPage = lazyWithRetry(() => import('@/pages/jobs/JobAlertsPage'));
const MyApplicationsPage = lazyWithRetry(() => import('@/pages/jobs/MyApplicationsPage'));
const JobKanbanPage = lazyWithRetry(() => import('@/pages/jobs/JobKanbanPage'));
const EmployerBrandPage = lazyWithRetry(() => import('@/pages/jobs/EmployerBrandPage'));
const TalentSearchPage = lazyWithRetry(() => import('@/pages/jobs/TalentSearchPage'));
const BiasAuditPage = lazyWithRetry(() => import('@/pages/jobs/BiasAuditPage'));
const EmployerOnboardingPage = lazyWithRetry(() => import('@/pages/jobs/EmployerOnboardingPage'));
const IdeationPage = lazyWithRetry(() => import('@/pages/ideation/IdeationPage'));
const ChallengeDetailPage = lazyWithRetry(() => import('@/pages/ideation/ChallengeDetailPage'));
const IdeaDetailPage = lazyWithRetry(() => import('@/pages/ideation/IdeaDetailPage'));
const CreateChallengePage = lazyWithRetry(() => import('@/pages/ideation/CreateChallengePage'));
const CampaignsPage = lazyWithRetry(() => import('@/pages/ideation/CampaignsPage'));
const CampaignDetailPage = lazyWithRetry(() => import('@/pages/ideation/CampaignDetailPage'));
const OutcomesDashboardPage = lazyWithRetry(() => import('@/pages/ideation/OutcomesDashboardPage'));
const CaringCommunityPage = lazyWithRetry(() => import('@/pages/caring-community/CaringCommunityPage'));
const RequestHelpPage = lazyWithRetry(() => import('@/pages/caring-community/RequestHelpPage'));
const MySupportRelationshipsPage = lazyWithRetry(() => import('@/pages/caring-community/MySupportRelationshipsPage'));
const InviteRedemptionPage = lazyWithRetry(() => import('@/pages/caring-community/InviteRedemptionPage'));
const OfferFavourPage = lazyWithRetry(() => import('@/pages/caring-community/OfferFavourPage'));
const MarktPage = lazyWithRetry(() => import('@/pages/caring-community/MarktPage'));
const LoyaltyHistoryPage = lazyWithRetry(() => import('@/pages/caring-community/LoyaltyHistoryPage'));
const FutureCareFundPage = lazyWithRetry(() => import('@/pages/caring-community/FutureCareFundPage'));
const HourTransferPage = lazyWithRetry(() => import('@/pages/caring-community/HourTransferPage'));
const HourGiftPage = lazyWithRetry(() => import('@/pages/caring-community/HourGiftPage'));
const SafeguardingReportPage = lazyWithRetry(() => import('@/pages/caring-community/SafeguardingReportPage'));
const MySafeguardingReportsPage = lazyWithRetry(() => import('@/pages/caring-community/MySafeguardingReportsPage'));
const CareProviderDirectoryPage = lazyWithRetry(() => import('@/pages/caring-community/CareProviderDirectoryPage'));
const MyTrustTierPage = lazyWithRetry(() => import('@/pages/caring-community/MyTrustTierPage'));
const MyDataExportPage = lazyWithRetry(() => import('@/pages/caring-community/MyDataExportPage'));
const WarmthPassPage = lazyWithRetry(() => import('@/pages/caring-community/WarmthPassPage'));
const CaregiverDashboardPage = lazyWithRetry(() => import('@/pages/caring-community/CaregiverDashboardPage'));
const LinkCareReceiverPage = lazyWithRetry(() => import('@/pages/caring-community/LinkCareReceiverPage'));
const CoverCarePage = lazyWithRetry(() => import('@/pages/caring-community/CoverCarePage'));
const MunicipalSurveyPage = lazyWithRetry(() => import('@/pages/caring-community/MunicipalSurveyPage'));
const ProjectAnnouncementsPage = lazyWithRetry(() => import('@/pages/caring-community/ProjectAnnouncementsPage'));
const CivicDigestPage = lazyWithRetry(() => import('@/pages/caring-community/CivicDigestPage'));
const MunicipalityFeedbackPage = lazyWithRetry(() => import('@/pages/caring-community/MunicipalityFeedbackPage'));
const SuccessStoriesPage = lazyWithRetry(() => import('@/pages/caring-community/SuccessStoriesPage'));
const DataExportPage = lazyWithRetry(() => import('@/pages/settings/DataExportPage'));
const ClubsPage = lazyWithRetry(() => import('@/pages/clubs/ClubsPage'));
const VereinMembersImportPage = lazyWithRetry(() => import('@/pages/clubs/VereinMembersImportPage'));
const MyVereinInvitationsPage = lazyWithRetry(() => import('@/pages/profile/MyVereinInvitationsPage'));
const VereinDuesManagementPage = lazyWithRetry(() => import('@/pages/vereine/VereinDuesManagementPage'));
const MyVereinDuesPage = lazyWithRetry(() => import('@/pages/profile/MyVereinDuesPage'));
const MunicipalityCalendarPage = lazyWithRetry(() => import('@/pages/public/MunicipalityCalendarPage'));
const RegionalPointsPage = lazyWithRetry(() => import('@/pages/wallet/RegionalPointsPage'));
const MyAdCampaignsPage = lazyWithRetry(() => import('@/pages/advertise/MyAdCampaignsPage'));
const MyPushCampaignsPage = lazyWithRetry(() => import('@/pages/advertise/MyPushCampaignsPage'));
const VolunteeringPage = lazyWithRetry(() => import('@/pages/volunteering/VolunteeringPage'));
const CreateOpportunityPage = lazyWithRetry(() => import('@/pages/volunteering/CreateOpportunityPage'));
const OpportunityDetailPage = lazyWithRetry(() => import('@/pages/volunteering/OpportunityDetailPage'));
const VolOrgDashboardPage = lazyWithRetry(() => import('@/pages/volunteering/VolOrgDashboardPage'));
const MyOrganisationsPage = lazyWithRetry(() => import('@/pages/volunteering/MyOrganisationsPage'));
const DonationReceiptPage = lazyWithRetry(() => import('@/pages/volunteering/DonationReceiptPage'));
const CheckInVerifyPage = lazyWithRetry(() => import('@/pages/volunteering/CheckInVerifyPage'));
const PartnerVenuesPage = lazyWithRetry(() => import('@/pages/venues/PartnerVenuesPage'));
const MyPassPage = lazyWithRetry(() => import('@/pages/venues/MyPassPage'));
const VenueVisitVerifyPage = lazyWithRetry(() => import('@/pages/venues/VenueVisitVerifyPage'));
const OrganisationsPage = lazyWithRetry(() => import('@/pages/organisations/OrganisationsPage'));
const OrganisationDetailPage = lazyWithRetry(() => import('@/pages/organisations/OrganisationDetailPage'));
const RegisterOrganisationPage = lazyWithRetry(() => import('@/pages/organisations/RegisterOrganisationPage'));
const FeedPage = lazyWithRetry(() => import('@/pages/feed/FeedPage'));
const BookmarksPage = lazyWithRetry(() => import('@/pages/bookmarks/BookmarksPage'));
const ResourcesPage = lazyWithRetry(() => import('@/pages/resources/ResourcesPage'));
const KnowledgeBasePage = lazyWithRetry(() => import('@/pages/kb/KnowledgeBasePage'));
const KBArticlePage = lazyWithRetry(() => import('@/pages/kb/KBArticlePage'));
const FederationHubPage = lazyWithRetry(() => import('@/pages/federation/FederationHubPage'));
const FederationPartnersPage = lazyWithRetry(() => import('@/pages/federation/FederationPartnersPage'));
const FederationPartnerDetailPage = lazyWithRetry(() => import('@/pages/federation/FederationPartnerDetailPage'));
const FederationMembersPage = lazyWithRetry(() => import('@/pages/federation/FederationMembersPage'));
const FederationMemberProfilePage = lazyWithRetry(() => import('@/pages/federation/FederationMemberProfilePage'));
const FederationMessagesPage = lazyWithRetry(() => import('@/pages/federation/FederationMessagesPage'));
const FederationListingsPage = lazyWithRetry(() => import('@/pages/federation/FederationListingsPage'));
const FederationEventsPage = lazyWithRetry(() => import('@/pages/federation/FederationEventsPage'));
const FederationGroupsPage = lazyWithRetry(() => import('@/pages/federation/FederationGroupsPage'));
const FederationSettingsPage = lazyWithRetry(() => import('@/pages/federation/FederationSettingsPage'));
const FederationOnboardingPage = lazyWithRetry(() => import('@/pages/federation/FederationOnboardingPage'));
const FederationConnectionsPage = lazyWithRetry(() => import('@/pages/federation/FederationConnectionsPage'));
const OnboardingPage = lazyWithRetry(() => import('@/pages/onboarding/OnboardingPage'));
const GroupExchangesPage = lazyWithRetry(() => import('@/pages/group-exchanges/GroupExchangesPage'));
const CreateGroupExchangePage = lazyWithRetry(() => import('@/pages/group-exchanges/CreateGroupExchangePage'));
const GroupExchangeDetailPage = lazyWithRetry(() => import('@/pages/group-exchanges/GroupExchangeDetailPage'));
const MatchesPage = lazyWithRetry(() => import('@/pages/matches/MatchesPage'));
const MatchPreferencesPage = lazyWithRetry(() => import('@/pages/matches/MatchPreferencesPage'));
const ReviewsPage = lazyWithRetry(() => import('@/pages/reviews/ReviewsPage'));
const NewsletterUnsubscribePage = lazyWithRetry(() => import('@/pages/newsletter/NewsletterUnsubscribePage'));
const EventGuardianConsentPage = lazyWithRetry(() => import('@/pages/events/EventGuardianConsentPage'));
const AiChatPage = lazyWithRetry(() => import('@/pages/chat/AiChatPage'));
const ConnectionsPage = lazyWithRetry(() => import('@/pages/connections/ConnectionsPage'));
const SkillsBrowsePage = lazyWithRetry(() => import('@/pages/skills/SkillsBrowsePage'));
const ActivityDashboardPage = lazyWithRetry(() => import('@/pages/activity/ActivityDashboardPage'));
const HashtagPage = lazyWithRetry(() => import('@/pages/feed/HashtagPage'));
const HashtagsDiscoveryPage = lazyWithRetry(() => import('@/pages/feed/HashtagsDiscoveryPage'));
const PostDetailPage = lazyWithRetry(() => import('@/pages/feed/PostDetailPage'));
const ExplorePage = lazyWithRetry(() => import('@/pages/explore/ExplorePage'));

// Marketplace Pages
const MarketplacePage = lazyWithRetry(() => import('@/pages/marketplace/MarketplacePage'));
const MarketplaceListingPage = lazyWithRetry(() => import('@/pages/marketplace/MarketplaceListingPage'));
const MarketplaceReportPage = lazyWithRetry(() => import('@/pages/marketplace/MarketplaceReportPage'));
const MarketplaceReportsPage = lazyWithRetry(() => import('@/pages/marketplace/MarketplaceReportsPage'));
const CreateMarketplaceListingPage = lazyWithRetry(() => import('@/pages/marketplace/CreateMarketplaceListingPage'));
const MarketplaceSearchPage = lazyWithRetry(() => import('@/pages/marketplace/MarketplaceSearchPage'));
const SellerProfilePage = lazyWithRetry(() => import('@/pages/marketplace/SellerProfilePage'));
const MarketplaceCategoryPage = lazyWithRetry(() => import('@/pages/marketplace/MarketplaceCategoryPage'));
const EditMarketplaceListingPage = lazyWithRetry(() => import('@/pages/marketplace/EditMarketplaceListingPage'));
const MyListingsPage = lazyWithRetry(() => import('@/pages/marketplace/MyListingsPage'));
const MyOffersPage = lazyWithRetry(() => import('@/pages/marketplace/MyOffersPage'));
const MarketplaceCollectionsPage = lazyWithRetry(() => import('@/pages/marketplace/MarketplaceCollectionsPage'));
const FreeItemsPage = lazyWithRetry(() => import('@/pages/marketplace/FreeItemsPage'));
const MarketplaceMapSearchPage = lazyWithRetry(() => import('@/pages/marketplace/MarketplaceMapSearchPage'));
const BuyerOrdersPage = lazyWithRetry(() => import('@/pages/marketplace/BuyerOrdersPage'));
const SellerOrdersPage = lazyWithRetry(() => import('@/pages/marketplace/SellerOrdersPage'));
const StripeOnboardingPage = lazyWithRetry(() => import('@/pages/marketplace/StripeOnboardingPage'));
const MerchantOnboardingPage = lazyWithRetry(() => import('@/pages/marketplace/MerchantOnboardingPage'));
const CouponsPage = lazyWithRetry(() => import('@/pages/coupons/CouponsPage'));

// Premium (member tiers — AG58)
const PricingPage = lazyWithRetry(() => import('@/pages/premium/PricingPage'));
const SubscriptionReturnPage = lazyWithRetry(() => import('@/pages/premium/SubscriptionReturnPage'));
const MySubscriptionPage = lazyWithRetry(() => import('@/pages/premium/MySubscriptionPage'));
const CouponDetailPage = lazyWithRetry(() => import('@/pages/coupons/CouponDetailPage'));
const SellerCouponsPage = lazyWithRetry(() => import('@/pages/marketplace/seller/SellerCouponsPage'));
const SellerCouponEditPage = lazyWithRetry(() => import('@/pages/marketplace/seller/SellerCouponEditPage'));
const SellerPickupSlotsPage = lazyWithRetry(() => import('@/pages/marketplace/seller/SellerPickupSlotsPage'));
const SellerShippingOptionsPage = lazyWithRetry(() => import('@/pages/marketplace/seller/SellerShippingOptionsPage'));
const SellerPickupScanPage = lazyWithRetry(() => import('@/pages/marketplace/seller/SellerPickupScanPage'));
const MyPickupsPage = lazyWithRetry(() => import('@/pages/marketplace/MyPickupsPage'));

// Courses Pages (alpha)
const CoursesPage = lazyWithRetry(() => import('@/pages/courses/CoursesPage'));
const CourseDetailPage = lazyWithRetry(() => import('@/pages/courses/CourseDetailPage'));
const CoursePlayerPage = lazyWithRetry(() => import('@/pages/courses/CoursePlayerPage'));
const MyLearningPage = lazyWithRetry(() => import('@/pages/courses/MyLearningPage'));
const InstructorDashboardPage = lazyWithRetry(() => import('@/pages/courses/InstructorDashboardPage'));
const CreateCoursePage = lazyWithRetry(() => import('@/pages/courses/CreateCoursePage'));
const CourseAnalyticsPage = lazyWithRetry(() => import('@/pages/courses/CourseAnalyticsPage'));
const CourseGradingPage = lazyWithRetry(() => import('@/pages/courses/CourseGradingPage'));

// Podcasts Pages
const PodcastsPage = lazyWithRetry(() => import('@/pages/podcasts/PodcastsPage'));
const PodcastShowPage = lazyWithRetry(() => import('@/pages/podcasts/PodcastShowPage'));
const PodcastEpisodePage = lazyWithRetry(() => import('@/pages/podcasts/PodcastEpisodePage'));
const PodcastStudioPage = lazyWithRetry(() => import('@/pages/podcasts/PodcastStudioPage'));

// Static Pages
const FeaturesPage = lazyWithRetry(() => import('@/pages/public/FeaturesPage'));
const ChangelogPage = lazyWithRetry(() => import('@/pages/public/ChangelogPage'));
const AboutPage = lazyWithRetry(() => import('@/pages/public/AboutPage'));
const ContactPage = lazyWithRetry(() => import('@/pages/public/ContactPage'));
const TermsPage = lazyWithRetry(() => import('@/pages/public/TermsPage'));
const PrivacyPage = lazyWithRetry(() => import('@/pages/public/PrivacyPage'));
const AccessibilityPage = lazyWithRetry(() => import('@/pages/public/AccessibilityPage'));
const CookiesPage = lazyWithRetry(() => import('@/pages/public/CookiesPage'));
const CommunityGuidelinesPage = lazyWithRetry(() => import('@/pages/public/CommunityGuidelinesPage'));
const TrustSafetyPage = lazyWithRetry(() => import('@/pages/public/TrustSafetyPage'));
const AcceptableUsePage = lazyWithRetry(() => import('@/pages/public/AcceptableUsePage'));
const LegalHubPage = lazyWithRetry(() => import('@/pages/public/LegalHubPage'));
const LegalVersionHistoryPage = lazyWithRetry(() => import('@/pages/public/LegalVersionHistoryPage'));
const FaqPage = lazyWithRetry(() => import('@/pages/public/FaqPage'));
const HelpCenterPage = lazyWithRetry(() => import('@/pages/help/HelpCenterPage'));
const PilotInquiryPage = lazyWithRetry(() => import('@/pages/public/PilotInquiryPage'));
const PilotApplyPage = lazyWithRetry(() => import('@/pages/public/PilotApplyPage'));
const PilotApplyStatusPage = lazyWithRetry(() => import('@/pages/public/PilotApplyStatusPage'));

// Platform Legal Pages (provider-level, distinct from tenant legal docs)
const PlatformTermsPage = lazyWithRetry(() => import('@/pages/platform/PlatformTermsPage'));
const PlatformPrivacyPage = lazyWithRetry(() => import('@/pages/platform/PlatformPrivacyPage'));
const PlatformDisclaimerPage = lazyWithRetry(() => import('@/pages/platform/PlatformDisclaimerPage'));
const CustomPage = lazyWithRetry(() => import('@/pages/public/CustomPage'));

// About Sub-Pages
const TimebankingGuidePage = lazyWithRetry(() => import('@/pages/about/TimebankingGuidePage'));
// AG60 — Developers portal (Partner API docs)
const DevelopersHomePage = lazyWithRetry(() => import('@/pages/developers/DevelopersHomePage'));
// AG59 — Paid Regional Analytics product (public landing + partner dashboard)
const RegionalAnalyticsLandingPage = lazyWithRetry(() => import('@/pages/public/RegionalAnalyticsLandingPage'));
const PartnerDashboardPage = lazyWithRetry(() => import('@/pages/partner-analytics/PartnerDashboardPage'));
const DevelopersAuthPage = lazyWithRetry(() => import('@/pages/developers/DevelopersAuthPage'));
const DevelopersEndpointsPage = lazyWithRetry(() => import('@/pages/developers/DevelopersEndpointsPage'));
const DevelopersWebhooksPage = lazyWithRetry(() => import('@/pages/developers/DevelopersWebhooksPage'));
const PartnerPage = lazyWithRetry(() => import('@/pages/about/PartnerPage'));
const SocialPrescribingPage = lazyWithRetry(() => import('@/pages/about/SocialPrescribingPage'));
const ImpactSummaryPage = lazyWithRetry(() => import('@/pages/about/ImpactSummaryPage'));
const ImpactReportPage = lazyWithRetry(() => import('@/pages/about/ImpactReportPage'));
const StrategicPlanPage = lazyWithRetry(() => import('@/pages/about/StrategicPlanPage'));

/**
 * Gate that only renders children for a specific tenant slug.
 * Other tenants see NotFoundPage. Used for tenant-specific content pages
 * (e.g. hOUR Timebank's impact report, strategic plan, etc.)
 */
function TenantSlugGate({ slug, children }: { slug: string; children: ReactNode }) {
  const { tenant } = useTenant();
  if (tenant?.slug !== slug) {
    return <Navigate to="about" replace />;
  }
  return <>{children}</>;
}

/**
 * All application routes rendered inside TenantShell.
 * This is rendered identically at both / and /:tenantSlug/ prefixes.
 */
export function AppRoutes() {
  const { t } = useTranslation(['utility', 'podcasts']);
  return (
    <>
      {/* Main Routes (with navbar/footer) */}
      <Route element={<Layout />}>
        {/* Public Routes */}
        <Route index element={<ErrorBoundary><HomePage /></ErrorBoundary>} />
        <Route path="features" element={<ErrorBoundary><FeaturesPage /></ErrorBoundary>} />
        <Route path="changelog" element={<ErrorBoundary><ChangelogPage /></ErrorBoundary>} />
        <Route path="development-status" element={<Navigate to="../features" replace />} />
        <Route path="about" element={<ErrorBoundary><AboutPage /></ErrorBoundary>} />
        <Route path="faq" element={<ErrorBoundary><FaqPage /></ErrorBoundary>} />
        <Route path="contact" element={<ErrorBoundary><ContactPage /></ErrorBoundary>} />
        <Route path="pilot-inquiry" element={<ErrorBoundary><PilotInquiryPage /></ErrorBoundary>} />
        <Route path="pilot-apply" element={<ErrorBoundary><PilotApplyPage /></ErrorBoundary>} />
        <Route path="pilot-apply/status/:token" element={<ErrorBoundary><PilotApplyStatusPage /></ErrorBoundary>} />
        <Route path="help" element={<ErrorBoundary><HelpCenterPage /></ErrorBoundary>} />
        <Route path="terms" element={<ErrorBoundary><TermsPage /></ErrorBoundary>} />
        <Route path="terms/versions" element={<ErrorBoundary><LegalVersionHistoryPage /></ErrorBoundary>} />
        <Route path="privacy" element={<ErrorBoundary><PrivacyPage /></ErrorBoundary>} />
        <Route path="privacy/versions" element={<ErrorBoundary><LegalVersionHistoryPage /></ErrorBoundary>} />
        <Route path="accessibility" element={<ErrorBoundary><AccessibilityPage /></ErrorBoundary>} />
        <Route path="accessibility/versions" element={<ErrorBoundary><LegalVersionHistoryPage /></ErrorBoundary>} />
        <Route path="cookies" element={<ErrorBoundary><CookiesPage /></ErrorBoundary>} />
        <Route path="cookies/versions" element={<ErrorBoundary><LegalVersionHistoryPage /></ErrorBoundary>} />
        <Route path="community-guidelines" element={<ErrorBoundary><CommunityGuidelinesPage /></ErrorBoundary>} />
        <Route path="community-guidelines/versions" element={<ErrorBoundary><LegalVersionHistoryPage /></ErrorBoundary>} />
        <Route path="trust-and-safety" element={<ErrorBoundary><TrustSafetyPage /></ErrorBoundary>} />
        <Route path="acceptable-use" element={<ErrorBoundary><AcceptableUsePage /></ErrorBoundary>} />
        <Route path="acceptable-use/versions" element={<ErrorBoundary><LegalVersionHistoryPage /></ErrorBoundary>} />
        <Route path="legal" element={<ErrorBoundary><LegalHubPage /></ErrorBoundary>} />
        <Route path="platform/terms" element={<ErrorBoundary><PlatformTermsPage /></ErrorBoundary>} />
        <Route path="platform/privacy" element={<ErrorBoundary><PlatformPrivacyPage /></ErrorBoundary>} />
        <Route path="platform/disclaimer" element={<ErrorBoundary><PlatformDisclaimerPage /></ErrorBoundary>} />
        <Route path="timebanking-guide" element={<ErrorBoundary><TimebankingGuidePage /></ErrorBoundary>} />

        {/* AG60 â€” Developers portal (public docs for the Partner API) */}
        <Route path="developers" element={<ErrorBoundary><DevelopersHomePage /></ErrorBoundary>} />
        <Route path="developers/auth" element={<ErrorBoundary><DevelopersAuthPage /></ErrorBoundary>} />
        <Route path="developers/endpoints" element={<ErrorBoundary><DevelopersEndpointsPage /></ErrorBoundary>} />
        <Route path="developers/webhooks" element={<ErrorBoundary><DevelopersWebhooksPage /></ErrorBoundary>} />

        {/* AG59 â€” Paid Regional Analytics â€” public marketing + token-auth partner dashboard */}
        <Route path="regional-analytics" element={<ErrorBoundary><RegionalAnalyticsLandingPage /></ErrorBoundary>} />
        <Route path="partner-analytics/dashboard" element={<ErrorBoundary><PartnerDashboardPage /></ErrorBoundary>} />

        {/* Newsletter unsubscribe â€” public, no auth, token-based */}
        <Route path="newsletter/unsubscribe" element={<ErrorBoundary><NewsletterUnsubscribePage /></ErrorBoundary>} />
        <Route path="events/:id/guardian-consent" element={<ErrorBoundary><EventGuardianConsentPage /></ErrorBoundary>} />

        {/* Shared public routes use one path/auth/feature policy in both registries. */}
        {renderSharedPublicFeatureRoutes()}

        {/* Tenant 2 (hOUR Timebank) specific pages â€” redirect other tenants to /about */}
        <Route path="partner" element={<ErrorBoundary><TenantSlugGate slug="hour-timebank"><PartnerPage /></TenantSlugGate></ErrorBoundary>} />
        <Route path="social-prescribing" element={<ErrorBoundary><TenantSlugGate slug="hour-timebank"><SocialPrescribingPage /></TenantSlugGate></ErrorBoundary>} />
        <Route path="impact-summary" element={<ErrorBoundary><TenantSlugGate slug="hour-timebank"><ImpactSummaryPage /></TenantSlugGate></ErrorBoundary>} />
        <Route path="impact-report" element={<ErrorBoundary><TenantSlugGate slug="hour-timebank"><ImpactReportPage /></TenantSlugGate></ErrorBoundary>} />
        <Route path="strategic-plan" element={<ErrorBoundary><TenantSlugGate slug="hour-timebank"><StrategicPlanPage /></TenantSlugGate></ErrorBoundary>} />

        {/* Dynamic CMS pages created via admin Page Builder */}
        <Route path="page/:slug" element={<ErrorBoundary><CustomPage /></ErrorBoundary>} />

        <Route path="coupons" element={
          <FeatureGate feature="merchant_coupons" fallback={<ComingSoonPage feature={t('coming_soon.features.coupons')} />}>
            <FeatureErrorBoundary featureName="Coupons">
              <CouponsPage />
            </FeatureErrorBoundary>
          </FeatureGate>
        } />
        <Route path="coupons/:id" element={
          <FeatureGate feature="merchant_coupons" redirect="/coupons">
            <FeatureErrorBoundary featureName="Coupons">
              <CouponDetailPage />
            </FeatureErrorBoundary>
          </FeatureGate>
        } />
        {/* Public: Caring Community (feature-gated hub) */}
        <Route path={CARING_COMMUNITY_ROUTE.path} element={
          <FeatureGate feature={CARING_COMMUNITY_ROUTE.feature} fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
            <FeatureErrorBoundary featureName="Caring Community">
              <CaringCommunityPage />
            </FeatureErrorBoundary>
          </FeatureGate>
        } />

        <Route element={<ProtectedRoute />}>
        {/* Member-facing: Low-friction help request (AG10) */}
        <Route path="caring-community/request-help" element={
          <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
            <FeatureErrorBoundary featureName="Caring Community">
              <RequestHelpPage />
            </FeatureErrorBoundary>
          </FeatureGate>
        } />

        {/* Member-facing: My Support Relationships (AG4) */}
        <Route path="caring-community/my-relationships" element={
          <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
            <FeatureErrorBoundary featureName="Caring Community">
              <MySupportRelationshipsPage />
            </FeatureErrorBoundary>
          </FeatureGate>
        } />

        {/* Caring Community â€” Offer a Favour (AG11) */}
        <Route path="caring-community/offer-favour" element={
          <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
            <FeatureErrorBoundary featureName="Caring Community">
              <OfferFavourPage />
            </FeatureErrorBoundary>
          </FeatureGate>
        } />

        {/* Caring Community â€” Unified Marktplatz (AG13) */}
        <Route path="caring-community/markt" element={
          <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
            <FeatureErrorBoundary featureName="Caring Community">
              <MarktPage />
            </FeatureErrorBoundary>
          </FeatureGate>
        } />

        {/* Caring Community â€” Time-credit â†” marketplace loyalty redemption history */}
        <Route path="caring-community/loyalty/history" element={
          <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
            <FeatureErrorBoundary featureName="Caring Community">
              <LoyaltyHistoryPage />
            </FeatureErrorBoundary>
          </FeatureGate>
        } />

        {/* Caring Community â€” Future Care Fund (Zeitvorsorge) (K1) */}
        <Route path="caring-community/future-care-fund" element={
          <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
            <FeatureErrorBoundary featureName="Caring Community">
              <FutureCareFundPage />
            </FeatureErrorBoundary>
          </FeatureGate>
        } />

        {/* Caring Community â€” Cooperative-to-cooperative hour transfer (K3) */}
        <Route path="caring-community/hour-transfer" element={
          <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
            <FeatureErrorBoundary featureName="Caring Community">
              <HourTransferPage />
            </FeatureErrorBoundary>
          </FeatureGate>
        } />

        {/* Caring Community â€” Time-credit gifting (K5) */}
        <Route path="caring-community/hour-gift" element={
          <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
            <FeatureErrorBoundary featureName="Caring Community">
              <HourGiftPage />
            </FeatureErrorBoundary>
          </FeatureGate>
        } />

        {/* Caring Community â€” Safeguarding report submission (K9) */}
        <Route path="caring-community/safeguarding/report" element={
          <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
            <FeatureErrorBoundary featureName="Caring Community">
              <SafeguardingReportPage />
            </FeatureErrorBoundary>
          </FeatureGate>
        } />

        {/* Caring Community â€” Member's own safeguarding reports (K9) */}
        <Route path="caring-community/safeguarding/my-reports" element={
          <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
            <FeatureErrorBoundary featureName="Caring Community">
              <MySafeguardingReportsPage />
            </FeatureErrorBoundary>
          </FeatureGate>
        } />

        {/* AG64 â€” Care-provider directory */}
        <Route path="caring-community/providers" element={
          <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
            <FeatureErrorBoundary featureName="Caring Community">
              <CareProviderDirectoryPage />
            </FeatureErrorBoundary>
          </FeatureGate>
        } />

        {/* AG67 â€” Trust tier */}
        <Route path="caring-community/my-trust-tier" element={
          <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
            <FeatureErrorBoundary featureName="Caring Community">
              <MyTrustTierPage />
            </FeatureErrorBoundary>
          </FeatureGate>
        } />

        {/* E3 â€” Member-side GDPR/FADP data export */}
        <Route path="caring-community/my-data-export" element={
          <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
            <FeatureErrorBoundary featureName="Caring Community">
              <MyDataExportPage />
            </FeatureErrorBoundary>
          </FeatureGate>
        } />

        <Route path="caring-community/warmth-pass" element={
          <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
            <FeatureErrorBoundary featureName="Caring Community">
              <WarmthPassPage />
            </FeatureErrorBoundary>
          </FeatureGate>
        } />

        {/* AG68 â€” Caregiver dashboard + link flow */}
        <Route path="caring-community/caregiver" element={
          <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
            <FeatureErrorBoundary featureName="Caring Community">
              <CaregiverDashboardPage />
            </FeatureErrorBoundary>
          </FeatureGate>
        } />
        <Route path="caring-community/caregiver/link" element={
          <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
            <FeatureErrorBoundary featureName="Caring Community">
              <LinkCareReceiverPage />
            </FeatureErrorBoundary>
          </FeatureGate>
        } />
        <Route path="caring-community/caregiver/cover" element={
          <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
            <FeatureErrorBoundary featureName="Caring Community">
              <CoverCarePage />
            </FeatureErrorBoundary>
          </FeatureGate>
        } />
        <Route path="caring-community/surveys" element={
          <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
            <FeatureErrorBoundary featureName="Caring Community">
              <MunicipalSurveyPage />
            </FeatureErrorBoundary>
          </FeatureGate>
        } />
        <Route path="caring-community/surveys/:id" element={
          <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
            <FeatureErrorBoundary featureName="Caring Community">
              <MunicipalSurveyPage />
            </FeatureErrorBoundary>
          </FeatureGate>
        } />
        <Route path="caring-community/projects" element={
          <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
            <FeatureErrorBoundary featureName="Caring Community">
              <ProjectAnnouncementsPage />
            </FeatureErrorBoundary>
          </FeatureGate>
        } />
        <Route path="caring-community/projects/:id" element={
          <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
            <FeatureErrorBoundary featureName="Caring Community">
              <ProjectAnnouncementsPage />
            </FeatureErrorBoundary>
          </FeatureGate>
        } />

        {/* AG90 â€” Personalised Civic Digest */}
        <Route path="caring-community/civic-digest" element={
          <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
            <FeatureErrorBoundary featureName="Caring Community">
              <CivicDigestPage />
            </FeatureErrorBoundary>
          </FeatureGate>
        } />

        {/* AG91 â€” Success Stories */}
        <Route path="caring-community/success-stories" element={
          <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
            <FeatureErrorBoundary featureName="Caring Community">
              <SuccessStoriesPage />
            </FeatureErrorBoundary>
          </FeatureGate>
        } />

        {/* AG92 â€” Two-Way Municipality Feedback */}
        <Route path="caring-community/feedback" element={
          <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
            <FeatureErrorBoundary featureName="Caring Community">
              <MunicipalityFeedbackPage />
            </FeatureErrorBoundary>
          </FeatureGate>
        } />
        </Route>

        {/* Clubs & Associations directory (AG15) â€” public, no feature gate */}
        <Route path="clubs" element={<ErrorBoundary><ClubsPage /></ErrorBoundary>} />

        {/* Advertiser self-serve portal (AG56/AG57) */}
        <Route path="advertise/campaigns" element={
          <ProtectedRoute>
            <FeatureGate feature="local_advertising" redirect="/">
              <ErrorBoundary><MyAdCampaignsPage /></ErrorBoundary>
            </FeatureGate>
          </ProtectedRoute>
        } />
        <Route path="advertise/push-campaigns" element={
          <ProtectedRoute>
            <FeatureGate feature="local_advertising" redirect="/">
              <ErrorBoundary><MyPushCampaignsPage /></ErrorBoundary>
            </FeatureGate>
          </ProtectedRoute>
        } />

        {/* Public: Caring Community invite redemption â€” no auth, no feature gate needed */}
        <Route path="join/:code" element={<ErrorBoundary><InviteRedemptionPage /></ErrorBoundary>} />

        {/* Protected Routes */}
        <Route element={<ProtectedRoute />}>
          {/* Member identity-bearing discovery and content routes */}
          <Route path="explore" element={
            <FeatureGate feature="explore" redirect="/">
              <FeatureErrorBoundary featureName="Explore">
                <ExplorePage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="listings" element={
            <FeatureGate module="listings" redirect="/">
              <FeatureErrorBoundary featureName="Listings">
                <ListingsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="listings/:id" element={
            <FeatureGate module="listings" redirect="/">
              <FeatureErrorBoundary featureName="Listings">
                <ListingDetailPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="events" element={
            <FeatureGate feature="events" fallback={<ComingSoonPage feature={t('coming_soon.features.events')} />}>
              <FeatureErrorBoundary featureName="Events">
                <EventsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="events/:id" element={
            <FeatureGate feature="events" redirect="/">
              <FeatureErrorBoundary featureName="Events">
                <EventDetailPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="groups" element={
            <FeatureGate feature="groups" fallback={<ComingSoonPage feature={t('coming_soon.features.groups')} />}>
              <FeatureErrorBoundary featureName="Groups">
                <GroupsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="groups/invite/:token" element={
            <FeatureGate feature="groups" redirect="/">
              <FeatureErrorBoundary featureName="Groups">
                <GroupInviteAcceptPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="groups/:id" element={
            <FeatureGate feature="groups" redirect="/">
              <FeatureErrorBoundary featureName="Groups">
                <GroupDetailPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="jobs" element={
            <FeatureGate feature="job_vacancies" fallback={<ComingSoonPage feature={t('coming_soon.features.job_vacancies')} />}>
              <FeatureErrorBoundary featureName="Job Vacancies">
                <JobsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="jobs/:id" element={
            <FeatureGate feature="job_vacancies" redirect="/">
              <FeatureErrorBoundary featureName="Job Vacancies">
                <JobDetailPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />

          {/* Courses and podcasts expose account-derived authorship. */}
          <Route path="courses" element={
            <FeatureGate feature="courses" redirect="/">
              <FeatureErrorBoundary featureName="Courses">
                <CoursesPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="courses/my-learning" element={
            <FeatureGate feature="courses" redirect="/">
              <FeatureErrorBoundary featureName="Courses">
                <MyLearningPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="courses/instructor" element={
            <FeatureGate feature="courses" redirect="/">
              <FeatureErrorBoundary featureName="Courses">
                <InstructorDashboardPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="courses/instructor/new" element={
            <FeatureGate feature="courses" redirect="/">
              <FeatureErrorBoundary featureName="Courses">
                <CreateCoursePage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="courses/instructor/:id/edit" element={
            <FeatureGate feature="courses" redirect="/">
              <FeatureErrorBoundary featureName="Courses">
                <CreateCoursePage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="courses/instructor/:id/analytics" element={
            <FeatureGate feature="courses" redirect="/">
              <FeatureErrorBoundary featureName="Courses">
                <CourseAnalyticsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="courses/instructor/:id/grading" element={
            <FeatureGate feature="courses" redirect="/">
              <FeatureErrorBoundary featureName="Courses">
                <CourseGradingPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="courses/:id/learn" element={
            <FeatureGate feature="courses" redirect="/">
              <FeatureErrorBoundary featureName="Courses">
                <CoursePlayerPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="courses/:idOrSlug" element={
            <FeatureGate feature="courses" redirect="/">
              <FeatureErrorBoundary featureName="Courses">
                <CourseDetailPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="podcasts" element={
            <FeatureGate feature="podcasts" redirect="/">
              <FeatureErrorBoundary featureName={t('podcasts:title')}>
                <PodcastsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="podcasts/studio" element={
            <FeatureGate feature="podcasts" redirect="/">
              <FeatureErrorBoundary featureName={t('podcasts:title')}>
                <PodcastStudioPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="podcasts/:showSlug" element={
            <FeatureGate feature="podcasts" redirect="/">
              <FeatureErrorBoundary featureName={t('podcasts:title')}>
                <PodcastShowPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="podcasts/:showSlug/:episodeSlug" element={
            <FeatureGate feature="podcasts" redirect="/">
              <FeatureErrorBoundary featureName={t('podcasts:title')}>
                <PodcastEpisodePage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />

          {/* Marketplace pages can expose seller account identity. */}
          <Route path="marketplace" element={
            <FeatureGate feature="marketplace" fallback={<ComingSoonPage feature={t('coming_soon.features.marketplace')} />}>
              <FeatureErrorBoundary featureName="Marketplace">
                <MarketplacePage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="marketplace/search" element={
            <FeatureGate feature="marketplace" redirect="/">
              <FeatureErrorBoundary featureName="Marketplace">
                <MarketplaceSearchPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="marketplace/map" element={
            <FeatureGate feature="marketplace" redirect="/">
              <FeatureErrorBoundary featureName="Marketplace">
                <MarketplaceMapSearchPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="marketplace/seller/:id" element={
            <FeatureGate feature="marketplace" redirect="/">
              <FeatureErrorBoundary featureName="Marketplace">
                <SellerProfilePage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="marketplace/category/:slug" element={
            <FeatureGate feature="marketplace" redirect="/">
              <FeatureErrorBoundary featureName="Marketplace">
                <MarketplaceCategoryPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="marketplace/my-listings" element={
            <FeatureGate feature="marketplace" redirect="/">
              <FeatureErrorBoundary featureName="Marketplace">
                <MyListingsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="marketplace/my-offers" element={
            <FeatureGate feature="marketplace" redirect="/">
              <FeatureErrorBoundary featureName="Marketplace">
                <MyOffersPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="marketplace/collections" element={
            <FeatureGate feature="marketplace" redirect="/">
              <FeatureErrorBoundary featureName="Marketplace">
                <MarketplaceCollectionsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="marketplace/free" element={
            <FeatureGate feature="marketplace" fallback={<ComingSoonPage feature={t('coming_soon.features.marketplace')} />}>
              <FeatureErrorBoundary featureName="Marketplace">
                <FreeItemsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="marketplace/:id" element={
            <FeatureGate feature="marketplace" redirect="/">
              <FeatureErrorBoundary featureName="Marketplace">
                <MarketplaceListingPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />

          {/* Volunteering, resources, organisations, and ideation include member attribution. */}
          <Route path="volunteering" element={
            <FeatureGate feature="volunteering" fallback={<ComingSoonPage feature={t('coming_soon.features.volunteering')} />}>
              <FeatureErrorBoundary featureName="Volunteering">
                <VolunteeringPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="volunteering/opportunities/:id" element={
            <FeatureGate feature="volunteering" redirect="/">
              <FeatureErrorBoundary featureName="Volunteering">
                <OpportunityDetailPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="resources" element={
            <FeatureGate feature="resources" fallback={<ComingSoonPage feature={t('coming_soon.features.resources')} />}>
              <FeatureErrorBoundary featureName="Resources">
                <ResourcesPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="kb" element={
            <FeatureGate feature="resources" fallback={<ComingSoonPage feature={t('coming_soon.features.knowledge_base')} />}>
              <FeatureErrorBoundary featureName="Knowledge Base">
                <KnowledgeBasePage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="kb/:id" element={
            <FeatureGate feature="resources" redirect="/">
              <FeatureErrorBoundary featureName="Knowledge Base">
                <KBArticlePage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="organisations" element={
            <FeatureGate feature="volunteering" fallback={<ComingSoonPage feature={t('coming_soon.features.volunteering')} />}>
              <FeatureErrorBoundary featureName="Organisations">
                <OrganisationsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="organisations/:id" element={
            <FeatureGate feature="volunteering" redirect="/">
              <FeatureErrorBoundary featureName="Organisations">
                <OrganisationDetailPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="ideation" element={
            <FeatureGate feature="ideation_challenges" fallback={<ComingSoonPage feature={t('coming_soon.features.ideation_challenges')} />}>
              <FeatureErrorBoundary featureName="Ideation Challenges">
                <IdeationPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="ideation/:id" element={
            <FeatureGate feature="ideation_challenges" redirect="/">
              <FeatureErrorBoundary featureName="Ideation Challenges">
                <ChallengeDetailPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="ideation/:challengeId/ideas/:id" element={
            <FeatureGate feature="ideation_challenges" redirect="/">
              <FeatureErrorBoundary featureName="Ideation Challenges">
                <IdeaDetailPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />

          {/* Sensitive member and club administration routes. */}
          <Route path="settings/data-export" element={<ErrorBoundary><DataExportPage /></ErrorBoundary>} />
          <Route path="clubs/:id/admin/import" element={
            <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
              <FeatureErrorBoundary featureName="Verein Import">
                <VereinMembersImportPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="clubs/:id/admin/dues" element={
            <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
              <FeatureErrorBoundary featureName="Verein Dues">
                <VereinDuesManagementPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="me/verein-dues" element={
            <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
              <FeatureErrorBoundary featureName="My Verein Dues">
                <MyVereinDuesPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="me/verein-invitations" element={
            <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
              <FeatureErrorBoundary featureName="Verein Invitations">
                <MyVereinInvitationsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="municipality-calendar" element={
            <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.caring_community')} />}>
              <FeatureErrorBoundary featureName="Municipality Calendar">
                <MunicipalityCalendarPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />

          {/* Core Features (module-gated) */}
          <Route path="dashboard" element={
            <FeatureGate module="dashboard" redirect="/">
              <FeatureErrorBoundary featureName="Dashboard">
                <DashboardPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="listings/create" element={
            <FeatureGate module="listings" redirect="/">
              <FeatureErrorBoundary featureName="Listings">
                <CreateListingPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="listings/edit/:id" element={
            <FeatureGate module="listings" redirect="/">
              <FeatureErrorBoundary featureName="Listings">
                <CreateListingPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="messages" element={
            <FeatureGate module="messages" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Messages">
                <MessagesPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="messages/new/:userId" element={
            <FeatureGate module="messages" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Messages">
                <ConversationPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="messages/:id" element={
            <FeatureGate module="messages" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Messages">
                <ConversationPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="wallet" element={
            <FeatureGate module="wallet" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Wallet">
                <WalletPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="wallet/regional-points" element={
            <FeatureGate feature="caring_community" fallback={<ComingSoonPage feature={t('coming_soon.features.regional_points')} />}>
              <FeatureErrorBoundary featureName="Regional Points">
                <RegionalPointsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="profile" element={
            <FeatureGate module="profile" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Profile">
                <ProfilePage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="profile/:id" element={
            <FeatureGate module="profile" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Profile">
                <ProfilePage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          {/* SOC10 â€” Saved collections */}
          <Route path="me/collections" element={
            <FeatureErrorBoundary featureName="My Collections">
              <MyCollectionsPage />
            </FeatureErrorBoundary>
          } />
          <Route path="me/collections/:id" element={
            <FeatureErrorBoundary featureName="Collection">
              <CollectionDetailPage />
            </FeatureErrorBoundary>
          } />
          <Route path="users/:userId/collections" element={
            <FeatureErrorBoundary featureName="Public Collections">
              <UserCollectionsView />
            </FeatureErrorBoundary>
          } />
          {/* SOC14 â€” Appreciation wall */}
          <Route path="users/:userId/appreciations" element={
            <FeatureErrorBoundary featureName="Appreciations">
              <AppreciationWallPage />
            </FeatureErrorBoundary>
          } />
          <Route path="settings" element={
            <FeatureGate module="settings" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Settings">
                <SettingsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="settings/blocked" element={
            <FeatureErrorBoundary featureName="Blocked Users">
              <BlockedUsersPage />
            </FeatureErrorBoundary>
          } />
          <Route path="verify-identity-optional" element={
            <FeatureGate feature="identity_verification" redirect="/dashboard">
              <VerifyIdentityOptionalPage />
            </FeatureGate>
          } />
          <Route path="verify-identity/callback" element={
            <FeatureGate feature="identity_verification" redirect="/dashboard">
              <VerifyIdentityOptionalPage />
            </FeatureGate>
          } />
          <Route path="search" element={
            <FeatureGate feature="search" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Search">
                <SearchPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="notifications" element={
            <FeatureGate module="notifications" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Notifications">
                <NotificationsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />

          {/* Onboarding Wizard */}
          <Route path="onboarding" element={<FeatureErrorBoundary featureName="Onboarding"><OnboardingPage /></FeatureErrorBoundary>} />

          {/* Feature-gated: Group Exchanges */}
          <Route path="group-exchanges" element={
            <FeatureGate feature="group_exchanges" fallback={<ComingSoonPage feature={t('coming_soon.features.group_exchanges')} />}>
              <FeatureErrorBoundary featureName="Group Exchanges">
                <GroupExchangesPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="group-exchanges/create" element={
            <FeatureGate feature="group_exchanges" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Group Exchanges">
                <CreateGroupExchangePage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="group-exchanges/:id" element={
            <FeatureGate feature="group_exchanges" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Group Exchanges">
                <GroupExchangeDetailPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />

          {/* Feature-gated: Exchanges */}
          <Route path="exchanges" element={
            <FeatureGate feature="exchange_workflow" fallback={<ComingSoonPage feature={t('coming_soon.features.exchanges')} />}>
              <FeatureErrorBoundary featureName="Exchanges">
                <ExchangesPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="exchanges/:id" element={
            <FeatureGate feature="exchange_workflow" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Exchanges">
                <ExchangeDetailPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="listings/:id/request-exchange" element={
            <FeatureGate feature="exchange_workflow" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Exchanges">
                <RequestExchangePage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />

          {/* Feature-gated: Members/Connections */}
          <Route path="members" element={
            <FeatureGate feature="connections" fallback={<ComingSoonPage feature={t('coming_soon.features.members_directory')} />}>
              <FeatureErrorBoundary featureName="Members Directory">
                <MembersPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="connections" element={
            <FeatureGate feature="connections" fallback={<ComingSoonPage feature={t('coming_soon.features.connections')} />}>
              <FeatureErrorBoundary featureName="Connections">
                <ConnectionsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />

          {/* Skills Browse */}
          <Route path="skills" element={
            <FeatureErrorBoundary featureName="Skills">
              <SkillsBrowsePage />
            </FeatureErrorBoundary>
          } />

          {/* Activity Dashboard */}
          <Route path="activity" element={
            <FeatureErrorBoundary featureName="Activity Dashboard">
              <ActivityDashboardPage />
            </FeatureErrorBoundary>
          } />

          {/* Feature-gated: AI Chat */}
          <Route path="chat" element={
            <FeatureGate feature="ai_chat" fallback={<ComingSoonPage feature={t('coming_soon.features.ai_assistant')} />}>
              <FeatureErrorBoundary featureName="AI Assistant">
                <AiChatPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />

          {/* Feature-gated: authenticated Event management routes */}
          <Route path="events/create" element={
            <FeatureGate feature="events" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Events">
                <CreateEventPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="events/:id/edit" element={
            <FeatureGate feature="events" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Events">
                <CreateEventPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="events/:id/manage/:section?" element={
            <FeatureGate feature="events" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Events">
                <EventManagePage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="events/edit/:id" element={<LegacyEventEditRedirect />} />

          {/* Feature-gated: Groups (create/edit only â€” view routes are public) */}
          <Route path="groups/create" element={
            <FeatureGate feature="groups" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Groups">
                <CreateGroupPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="groups/edit/:id" element={
            <FeatureGate feature="groups" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Groups">
                <CreateGroupPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />

          {/* Feature-gated: Gamification */}
          <Route path="achievements" element={
            <FeatureGate feature="gamification" fallback={<ComingSoonPage feature={t('coming_soon.features.achievements')} />}>
              <FeatureErrorBoundary featureName="Achievements">
                <AchievementsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="leaderboard" element={
            <FeatureGate feature="gamification" fallback={<ComingSoonPage feature={t('coming_soon.features.leaderboard')} />}>
              <FeatureErrorBoundary featureName="Leaderboard">
                <LeaderboardPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="nexus-score" element={
            <FeatureGate feature="gamification" fallback={<ComingSoonPage feature={t('coming_soon.features.nexus_score')} />}>
              <FeatureErrorBoundary featureName="NexusScore">
                <NexusScorePage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />

          {/* Feature-gated: Goals */}
          <Route path="goals" element={
            <FeatureGate feature="goals" fallback={<ComingSoonPage feature={t('coming_soon.features.goals')} />}>
              <FeatureErrorBoundary featureName="Goals">
                <GoalsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="goals/:id" element={
            <FeatureGate feature="goals" fallback={<ComingSoonPage feature={t('coming_soon.features.goals')} />}>
              <FeatureErrorBoundary featureName="Goals">
                <GoalDetailPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />

          {/* Feature-gated: Polls */}
          <Route path="polls" element={
            <FeatureGate feature="polls" fallback={<ComingSoonPage feature={t('coming_soon.features.polls')} />}>
              <FeatureErrorBoundary featureName="Polls">
                <PollsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />

          {/* Feature-gated: Job Vacancies (create/edit/manage only â€” view routes are public) */}
          <Route path="jobs/create" element={
            <FeatureGate feature="job_vacancies" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Job Vacancies">
                <CreateJobPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="jobs/:id/edit" element={
            <FeatureGate feature="job_vacancies" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Job Vacancies">
                <CreateJobPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="jobs/:id/analytics" element={
            <FeatureGate feature="job_vacancies" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Job Vacancies">
                <JobAnalyticsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="jobs/alerts" element={
            <FeatureGate feature="job_vacancies" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Job Vacancies">
                <JobAlertsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="jobs/my-applications" element={
            <FeatureGate feature="job_vacancies" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Job Vacancies">
                <MyApplicationsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="jobs/:id/kanban" element={
            <FeatureGate feature="job_vacancies" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Job Vacancies">
                <JobKanbanPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="jobs/employers/:userId" element={
            <FeatureGate feature="job_vacancies" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Job Vacancies">
                <EmployerBrandPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="jobs/talent-search" element={
            <FeatureGate feature="job_vacancies" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Job Vacancies">
                <TalentSearchPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="jobs/bias-audit" element={
            <FeatureGate feature="job_vacancies" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Job Vacancies">
                <BiasAuditPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="jobs/employer-onboarding" element={
            <FeatureGate feature="job_vacancies" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Job Vacancies">
                <EmployerOnboardingPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />

          {/* Feature-gated: Marketplace (create/sell only â€” view routes are public) */}
          <Route path="marketplace/seller/coupons" element={
            <FeatureGate feature="merchant_coupons" redirect="/">
              <FeatureErrorBoundary featureName="Merchant Coupons">
                <SellerCouponsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="marketplace/seller/coupons/new" element={
            <FeatureGate feature="merchant_coupons" redirect="/">
              <FeatureErrorBoundary featureName="Merchant Coupons">
                <SellerCouponEditPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="marketplace/seller/coupons/:id/edit" element={
            <FeatureGate feature="merchant_coupons" redirect="/">
              <FeatureErrorBoundary featureName="Merchant Coupons">
                <SellerCouponEditPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="marketplace/sell" element={
            <FeatureGate feature="marketplace" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Marketplace">
                <CreateMarketplaceListingPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="marketplace/reports/:id" element={
            <FeatureGate feature="marketplace" redirect="/dashboard">
              <FeatureErrorBoundary featureName={t('coming_soon.features.marketplace')}>
                <MarketplaceReportPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="marketplace/reports" element={
            <FeatureGate feature="marketplace" redirect="/dashboard">
              <FeatureErrorBoundary featureName={t('coming_soon.features.marketplace')}>
                <MarketplaceReportsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="marketplace/:id/edit" element={
            <FeatureGate feature="marketplace" redirect="/">
              <FeatureErrorBoundary featureName="Marketplace">
                <EditMarketplaceListingPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="marketplace/orders" element={
            <FeatureGate feature="marketplace" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Marketplace">
                <BuyerOrdersPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="marketplace/orders/sales" element={
            <FeatureGate feature="marketplace" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Marketplace">
                <SellerOrdersPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="marketplace/seller/onboard" element={
            <FeatureGate feature="marketplace" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Marketplace">
                <StripeOnboardingPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="marketplace/become-partner" element={
            <FeatureGate feature="marketplace" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Marketplace">
                <MerchantOnboardingPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          {/* AG48 â€” alternate canonical path for the wizard */}
          <Route path="marketplace/seller/onboarding" element={
            <FeatureGate feature="marketplace" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Marketplace">
                <MerchantOnboardingPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          {/* AG45 â€” Click-and-collect */}
          <Route path="marketplace/seller/pickup-slots" element={
            <FeatureGate feature="marketplace" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Marketplace">
                <SellerPickupSlotsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="marketplace/seller/shipping-options" element={
            <FeatureGate feature="marketplace" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Marketplace">
                <SellerShippingOptionsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="marketplace/seller/pickup-scan" element={
            <FeatureGate feature="marketplace" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Marketplace">
                <SellerPickupScanPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="marketplace/me/pickups" element={
            <FeatureGate feature="marketplace" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Marketplace">
                <MyPickupsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />

          {/* AG58 â€” Member Premium Tiers */}
          <Route path="premium" element={
            <FeatureGate feature="member_premium" redirect="/">
              <FeatureErrorBoundary featureName="Premium">
                <PricingPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="premium/return" element={
            <FeatureGate feature="member_premium" redirect="/">
              <FeatureErrorBoundary featureName="Premium">
                <SubscriptionReturnPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="premium/manage" element={
            <FeatureGate feature="member_premium" redirect="/">
              <FeatureErrorBoundary featureName="Premium">
                <MySubscriptionPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />

          {/* Feature-gated: Ideation Challenges (create/edit/manage only â€” view routes are public) */}
          <Route path="ideation/create" element={
            <FeatureGate feature="ideation_challenges" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Ideation Challenges">
                <CreateChallengePage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="ideation/:id/edit" element={
            <FeatureGate feature="ideation_challenges" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Ideation Challenges">
                <CreateChallengePage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="ideation/campaigns" element={
            <FeatureGate feature="ideation_challenges" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Ideation Challenges">
                <CampaignsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="ideation/campaigns/:id" element={
            <FeatureGate feature="ideation_challenges" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Ideation Challenges">
                <CampaignDetailPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="ideation/outcomes" element={
            <FeatureGate feature="ideation_challenges" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Ideation Challenges">
                <OutcomesDashboardPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />

          {/* Feature-gated: Volunteering (create/manage only â€” view routes are public) */}
          <Route path="volunteering/create" element={
            <FeatureGate feature="volunteering" fallback={<ComingSoonPage feature={t('coming_soon.features.volunteering')} />}>
              <FeatureErrorBoundary featureName="Volunteering">
                <CreateOpportunityPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="volunteering/org/:orgId/dashboard" element={
            <FeatureGate feature="volunteering" fallback={<ComingSoonPage feature={t('coming_soon.features.volunteering')} />}>
              <FeatureErrorBoundary featureName="Volunteering">
                <VolOrgDashboardPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="volunteering/my-organisations" element={
            <FeatureGate feature="volunteering" fallback={<ComingSoonPage feature={t('coming_soon.features.volunteering')} />}>
              <FeatureErrorBoundary featureName="Volunteering">
                <MyOrganisationsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="volunteering/my-applications" element={<Navigate to="../volunteering?tab=applications" replace />} />
          <Route path="volunteering/checkin/:token" element={
            <FeatureGate feature="volunteering" fallback={<ComingSoonPage feature={t('coming_soon.features.volunteering')} />}>
              <FeatureErrorBoundary featureName="Volunteering">
                <CheckInVerifyPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="donations/:id/receipt" element={
            <FeatureGate feature="volunteering" fallback={<ComingSoonPage feature={t('coming_soon.features.volunteering')} />}>
              <FeatureErrorBoundary featureName="Donations">
                <DonationReceiptPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />

          {/* Feature-gated: Partner venues. The scan-landing route sits inside
              ProtectedRoute like volunteering/checkin/:token, so an
              unauthenticated scanner is sent through login and returns here. */}
          <Route path="venues" element={
            <FeatureGate feature="partner_venues" fallback={<ComingSoonPage feature={t('coming_soon.features.partner_venues')} />}>
              <FeatureErrorBoundary featureName="Partner venues">
                <PartnerVenuesPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="venues/pass" element={
            <FeatureGate feature="partner_venues" fallback={<ComingSoonPage feature={t('coming_soon.features.partner_venues')} />}>
              <FeatureErrorBoundary featureName="Partner venues">
                <MyPassPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="venues/checkin/:token" element={
            <FeatureGate feature="partner_venues" fallback={<ComingSoonPage feature={t('coming_soon.features.partner_venues')} />}>
              <FeatureErrorBoundary featureName="Partner venues">
                <VenueVisitVerifyPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />

          {/* Feature-gated: Organisations (register only â€” view routes are public) */}
          <Route path="organisations/register" element={
            <FeatureGate feature="volunteering" fallback={<ComingSoonPage feature={t('coming_soon.features.volunteering')} />}>
              <FeatureErrorBoundary featureName="Organisations">
                <RegisterOrganisationPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />

          {/* Module-gated: Feed */}
          <Route path="feed" element={
            <FeatureGate module="feed" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Feed">
                <FeedPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="feed/posts/:id" element={
            <FeatureGate module="feed" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Feed">
                <PostDetailPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="feed/item/:type/:id" element={
            <FeatureGate module="feed" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Feed">
                <PostDetailPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="feed/hashtag/:tag" element={
            <FeatureGate module="feed" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Feed">
                <HashtagPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="feed/hashtags" element={
            <FeatureGate module="feed" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Feed">
                <HashtagsDiscoveryPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />

          {/* Bookmarks / Saved Items */}
          <Route path="saved" element={
            <FeatureErrorBoundary featureName="Bookmarks">
              <BookmarksPage />
            </FeatureErrorBoundary>
          } />

          {/* Feature-gated: Federation */}
          <Route path="federation" element={
            <FeatureGate feature="federation" fallback={<ComingSoonPage feature={t('coming_soon.features.federation')} />}>
              <FeatureErrorBoundary featureName="Federation">
                <FederationHubPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="federation/partners" element={
            <FeatureGate feature="federation" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Federation">
                <FederationPartnersPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="federation/partners/:id" element={
            <FeatureGate feature="federation" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Federation">
                <FederationPartnerDetailPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="federation/members" element={
            <FeatureGate feature="federation" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Federation">
                <FederationMembersPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="federation/members/:id" element={
            <FeatureGate feature="federation" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Federation">
                <FederationMemberProfilePage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="federation/messages" element={
            <FeatureGate feature="federation" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Federation">
                <FederationMessagesPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="federation/listings" element={
            <FeatureGate feature="federation" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Federation">
                <FederationListingsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="federation/events" element={
            <FeatureGate feature="federation" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Federation">
                <FederationEventsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="federation/groups" element={
            <FeatureGate feature="federation" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Federation">
                <FederationGroupsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="federation/settings" element={
            <FeatureGate feature="federation" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Federation">
                <FederationSettingsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="federation/onboarding" element={
            <FeatureGate feature="federation" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Federation">
                <FederationOnboardingPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />
          <Route path="federation/connections" element={
            <FeatureGate feature="federation" redirect="/dashboard">
              <FeatureErrorBoundary featureName="Federation">
                <FederationConnectionsPage />
              </FeatureErrorBoundary>
            </FeatureGate>
          } />

          {/* Matches â€” cross-module matches page (MA1, requires auth) */}
          <Route path="matches" element={
            <FeatureGate module="listings" redirect="/dashboard">
              <ErrorBoundary><MatchesPage /></ErrorBoundary>
            </FeatureGate>
          } />
          <Route path="matches/preferences" element={
            <FeatureGate module="listings" redirect="/dashboard">
              <ErrorBoundary><MatchPreferencesPage /></ErrorBoundary>
            </FeatureGate>
          } />

          {/* Reviews â€” user reviews for completed exchanges */}
          <Route path="reviews" element={
            <FeatureGate feature="reviews" redirect="/dashboard">
              <ErrorBoundary><ReviewsPage /></ErrorBoundary>
            </FeatureGate>
          } />
          {/* Deep link target for the review-request email (?transaction_id=â€¦) */}
          <Route path="reviews/create" element={
            <FeatureGate feature="reviews" redirect="/dashboard">
              <ErrorBoundary><ReviewsPage /></ErrorBoundary>
            </FeatureGate>
          } />
        </Route>
      </Route>

      {/* Admin Panel (separate layout, no main navbar/footer) â€” fully lazy-loaded */}
      <Route path="admin/*" element={<AdminApp />} />

      {/* Super Admin Panel (separate platform-wide area) â€” fully lazy-loaded */}
      <Route path="super-admin/*" element={<SuperAdminApp />} />

      {/* Broker Panel (simplified admin for brokers) â€” fully lazy-loaded */}
      <Route path="broker/*" element={<BrokerApp />} />

      {/* Partner Timebanks Panel â€” fully lazy-loaded; route-level gates live inside the panel */}
      <Route path="partner-timebanks/*" element={<PartnersApp />} />

      {/* Community Caring Panel â€” fully lazy-loaded, gated by caring_community feature */}
      <Route path="caring/*" element={<CaringApp />} />

      {/* 404 Fallback (must be after admin to avoid catching /admin paths) */}
      <Route element={<Layout />}>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </>
  );
}

