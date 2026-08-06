<?php
// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace App\Providers;

use App\I18n\Translator;
use App\Models\Category;
use App\Models\Connection;
use App\Models\Event;
use App\Models\EventRsvp;
use App\Models\FeedActivity;
use App\Models\FeedPost;
use App\Models\Goal;
use App\Models\GoalTemplate;
use App\Models\Group;
use App\Models\JobVacancy;
use App\Models\Listing;
use App\Models\MarketplaceListing;
use App\Models\Message;
use App\Models\Newsletter;
use App\Models\Notification;
use App\Models\Page;
use App\Models\Poll;
use App\Models\Post;
use App\Models\ResourceItem;
use App\Models\Review;
use App\Models\Tenant;
use App\Models\Transaction;
use App\Models\User;
use App\Models\UserBadge;
use App\Models\VolApplication;
use App\Models\VolOpportunity;
use App\Services\AdminAnalyticsService;
use App\Services\AuditLogService;
use App\Services\BlogService;
use App\Services\CategoryService;
use App\Services\CommentService;
use App\Services\ConnectionService;
use App\Services\EventService;
use App\Services\FeedService;
use App\Services\GamificationService;
use App\Services\GoalService;
use App\Services\GroupService;
use App\Services\HelpService;
use App\Services\ListingService;
use App\Services\MemberRankingService;
use App\Services\MessageService;
use App\Services\NewsletterService;
use App\Services\NotificationService;
use App\Services\PageService;
use App\Services\PollService;
use App\Services\ResourceService;
use App\Services\ReviewService;
use App\Services\SearchService;
use App\Services\TenantService;
use App\Services\VolunteerService;
use App\Services\UserService;
use App\Services\WalletService;
use App\Services\AuthService;
use App\Services\RegistrationService;
use App\Services\TokenService;
use App\Services\PushNotificationService;
use App\Services\ImageUploadService;
use App\Services\CookieConsentService;
use App\Services\LegalDocumentService;
use App\Services\IdeationChallengeService;
use App\Services\JobVacancyService;
use App\Services\SkillTaxonomyService;
use App\Services\MemberAvailabilityService;
use App\Services\EndorsementService;
use App\Services\MemberActivityService;
use App\Services\SubAccountService;
use App\Services\KnowledgeBaseService;
use App\Services\MetricsService;
use App\Services\FeedSidebarService;
use App\Services\FeedSocialService;
use App\Services\GroupRecommendationService;
use App\Services\ExchangeService;
use App\Services\ContentModerationService;
use App\Services\EmailService;
use App\Services\CronJobService;
use App\Services\AdminSettingsService;
use App\Services\AdminListingsService;
use App\Services\AdminUsersService;
use App\Services\DeliverableService;
use App\Services\FederationService;
use App\Services\ChallengeService;
use App\Services\BadgeService;
use App\Services\AiChatService;
use App\Services\RealtimeService;
use App\Services\SeoService;
use App\Services\LeaderboardService;
use App\Services\LeaderboardSeasonService;
use App\Services\OnboardingService;
use App\Services\StreakService;
use App\Services\NexusScoreService;
use App\Services\NexusScoreCacheService;
use App\Services\RateLimitService;
use App\Services\FeedActivityService;
use App\Services\FeedRankingService;
use App\Services\HashtagService;
use App\Services\ExchangeRatingService;
use App\Services\ExchangeWorkflowService;
use App\Services\CreditDonationService;
use App\Services\StartingBalanceService;
use App\Services\TransactionCategoryService;
use App\Services\TransactionExportService;
use App\Services\ListingAnalyticsService;
use App\Services\ListingModerationService;
use App\Services\ListingFeaturedService;
use App\Services\VolunteerCheckInService;
use App\Services\VolunteerMatchingService;
use App\Services\VolunteerReminderService;
use App\Services\EventNotificationService;
use App\Services\EventReminderService;
use App\Services\DailyRewardService;
use App\Services\XPShopService;
use App\Services\AbuseDetectionService;
use App\Services\AchievementAnalyticsService;
use App\Services\AchievementCampaignService;
use App\Services\AchievementUnlockablesService;
use App\Services\AdminBadgeCountService;
use App\Services\BadgeCollectionService;
use App\Services\BalanceAlertService;
use App\Services\BrokerControlConfigService;
use App\Services\BrokerMessageVisibilityService;
use App\Services\CSSSanitizer;
use App\Services\CampaignService;
use App\Services\ChallengeCategoryService;
use App\Services\ChallengeOutcomeService;
use App\Services\ChallengeTagService;
use App\Services\ChallengeTemplateService;
use App\Services\CollaborativeFilteringService;
use App\Services\CommunityFundService;
use App\Services\CommunityProjectService;
use App\Services\ContextualMessageService;
use App\Services\CookieInventoryService;
use App\Services\CrossModuleMatchingService;
use App\Services\EmailMonitorService;
use App\Services\EmbeddingService;
use App\Services\FCMPushService;
use App\Services\FederatedConnectionService;
use App\Services\FederatedMessageService;
use App\Services\FederationActivityService;
use App\Services\FederationAuditService;
use App\Services\FederationCreditService;
use App\Services\FederationDirectoryService;
use App\Services\FederationEmailService;

use App\Services\FederationFeatureService;
use App\Services\FederationJwtService;
use App\Services\FederationNeighborhoodService;
use App\Services\FederationPartnershipService;
use App\Services\FederationRealtimeService;
use App\Services\FederationSearchService;
use App\Services\FederationUserService;
use App\Services\GamificationEmailService;
use App\Services\GamificationRealtimeService;
use App\Services\GeocodingService;
use App\Services\GoalCheckinService;
use App\Services\GoalProgressService;
use App\Services\GoalReminderService;
use App\Services\GoalTemplateService;
use App\Services\GroupAchievementService;
use App\Services\GroupAnnouncementService;

use App\Services\GroupChatroomService;
use App\Services\GroupExchangeService;
use App\Services\GroupModerationService;
use App\Services\GroupNotificationService;
use App\Services\GroupPolicyRepository;
use App\Services\GroupRecommendationEngine;
use App\Services\GuardianConsentService;
use App\Services\HoursReportService;
use App\Services\HtmlSanitizer;
use App\Services\IdeaMediaService;
use App\Services\IdeaTeamConversionService;
use App\Services\ImpactReportingService;
use App\Services\InactiveMemberService;
use App\Services\InsuranceCertificateService;
use App\Services\ListingExpiryReminderService;
use App\Services\ListingExpiryService;
use App\Services\ListingRankingService;
use App\Services\ListingRiskTagService;
use App\Services\ListingSkillTagService;
use App\Services\MailchimpService;
use App\Services\MatchApprovalWorkflowService;
use App\Services\MatchLearningService;
use App\Services\MatchingService;
use App\Services\MemberReportService;
use App\Services\MemberVerificationBadgeService;
use App\Services\NotificationDispatcher;

use App\Services\PollExportService;
use App\Services\PollRankingService;
use App\Services\PusherService;
use App\Services\RecurringShiftService;
use App\Services\RedisCache;
use App\Services\ReportExportService;
use App\Services\SafeguardingService;

use App\Services\SearchLogService;
use App\Services\ShiftGroupReservationService;
use App\Services\ShiftSwapService;
use App\Services\ShiftWaitlistService;

use App\Services\SmartGroupRankingService;
use App\Services\SmartMatchingAnalyticsService;
use App\Services\SmartMatchingEngine;

use App\Services\SocialNotificationService;
use App\Services\SocialValueService;
use App\Services\SuperAdminAuditService;
use App\Services\TeamDocumentService;
use App\Services\TeamTaskService;
use App\Services\TenantFeatureConfig;
use App\Services\TenantHierarchyService;
use App\Services\TenantSettingsService;
use App\Services\TenantVisibilityService;
use App\Services\TotpService;
use App\Services\TwoFactorChallengeManager;

use App\Services\UserInsightsService;
use App\Services\VolunteerCertificateService;
use App\Services\VolunteerDonationService;
use App\Services\VolunteerEmergencyAlertService;
use App\Services\VolunteerExpenseService;
use App\Services\VolunteerFormService;
use App\Services\VolunteerWellbeingService;
use App\Services\WebAuthnChallengeStore;
use App\Services\WebPushService;
use App\Services\WebhookDispatchService;
use App\Services\AI\AIServiceFactory;
use App\Observers\CommentObserver;
use App\Observers\EventObserver;
use App\Observers\FeedPostObserver;
use App\Observers\GroupObserver;
use App\Observers\JobVacancyObserver;
use App\Observers\ListingObserver;
use App\Observers\MarketplaceListingObserver;
use App\Observers\UserObserver;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    private const TRANSLATION_CACHE_FILE = 'nexus_translations.php';

    public function register(): void
    {
        // Shared by the query listener (registered in boot) and the terminable
        // middleware that writes the sample, so both see the same request.
        $this->app->singleton(\App\Support\Performance\PerformanceRecorder::class);

        // --- Existing services ---

        $this->app->singleton(ListingService::class, function ($app) {
            return new ListingService(new Listing());
        });

        $this->app->singleton(UserService::class, function ($app) {
            return new UserService(new User());
        });

        $this->app->singleton(EventService::class, function ($app) {
            return new EventService(new Event(), new EventRsvp());
        });

        $this->app->singleton(GroupService::class, function ($app) {
            return new GroupService(new Group());
        });

        $this->app->singleton(MessageService::class, function ($app) {
            return new MessageService(new Message());
        });

        $this->app->singleton(WalletService::class, function ($app) {
            return new WalletService(new Transaction(), new User());
        });

        $this->app->singleton(NotificationService::class, function ($app) {
            return new NotificationService(new Notification());
        });

        $this->app->singleton(ReviewService::class, function ($app) {
            return new ReviewService(new Review());
        });

        $this->app->singleton(SearchService::class, function ($app) {
            return new SearchService(new User(), new Listing(), new Event(), new Group());
        });

        $this->app->singleton(ConnectionService::class, function ($app) {
            return new ConnectionService(new Connection());
        });

        $this->app->singleton(FeedService::class, function ($app) {
            return new FeedService(new FeedActivity(), new FeedPost());
        });

        // --- New services ---

        $this->app->singleton(GoalService::class, function ($app) {
            return new GoalService(new Goal());
        });

        $this->app->singleton(PollService::class, function ($app) {
            return new PollService(new Poll());
        });

        $this->app->singleton(CommentService::class, function ($app) {
            return new CommentService();
        });

        $this->app->singleton(BlogService::class, function ($app) {
            return new BlogService(new Post(), new Category());
        });

        $this->app->singleton(VolunteerService::class, function ($app) {
            return new VolunteerService(new VolOpportunity(), new VolApplication());
        });

        $this->app->singleton(GamificationService::class, function ($app) {
            return new GamificationService(new User(), new UserBadge());
        });

        $this->app->singleton(CategoryService::class, function ($app) {
            return new CategoryService(new Category());
        });

        $this->app->singleton(PageService::class, function ($app) {
            return new PageService(new Page());
        });

        $this->app->singleton(ResourceService::class, function ($app) {
            return new ResourceService(new ResourceItem());
        });

        $this->app->singleton(HelpService::class, function ($app) {
            return new HelpService();
        });

        $this->app->singleton(NewsletterService::class, function ($app) {
            return new NewsletterService(new Newsletter());
        });

        $this->app->singleton(TenantService::class, function ($app) {
            return new TenantService(new Tenant());
        });

        $this->app->singleton(AuditLogService::class, function ($app) {
            return new AuditLogService();
        });

        $this->app->singleton(AdminAnalyticsService::class, function ($app) {
            return new AdminAnalyticsService(new User(), new Transaction());
        });

        $this->app->singleton(MemberRankingService::class, function ($app) {
            return new MemberRankingService(new User());
        });

        // --- Batch 3 services (20) ---

        $this->app->singleton(AuthService::class, function ($app) {
            return new AuthService(new User());
        });

        $this->app->singleton(RegistrationService::class, function ($app) {
            return new RegistrationService(
                new User(),
                $app->make(\App\Services\TenantSettingsService::class),
                $app->make(\App\Services\PwnedPasswordService::class),
                $app->make(\App\Services\DisposableEmailService::class),
                $app->make(\App\Services\MxRecordValidator::class),
            );
        });

        $this->app->singleton(TokenService::class, function ($app) {
            return new TokenService(new User());
        });

        $this->app->singleton(PushNotificationService::class, function ($app) {
            return new PushNotificationService();
        });

        $this->app->singleton(ImageUploadService::class, function ($app) {
            return new ImageUploadService();
        });

        $this->app->singleton(CookieConsentService::class, function ($app) {
            return new CookieConsentService();
        });

        $this->app->singleton(LegalDocumentService::class, function ($app) {
            return new LegalDocumentService();
        });

        $this->app->singleton(IdeationChallengeService::class, function ($app) {
            return new IdeationChallengeService();
        });

        $this->app->singleton(JobVacancyService::class);

        $this->app->singleton(SkillTaxonomyService::class, function ($app) {
            return new SkillTaxonomyService();
        });

        $this->app->singleton(MemberAvailabilityService::class);

        $this->app->singleton(EndorsementService::class);

        $this->app->singleton(MemberActivityService::class, function ($app) {
            return new MemberActivityService();
        });

        $this->app->singleton(SubAccountService::class);

        $this->app->singleton(KnowledgeBaseService::class, function ($app) {
            return new KnowledgeBaseService();
        });

        $this->app->singleton(MetricsService::class, function ($app) {
            return new MetricsService();
        });

        $this->app->singleton(FeedSidebarService::class, function ($app) {
            return new FeedSidebarService();
        });

        $this->app->singleton(FeedSocialService::class, function ($app) {
            return new FeedSocialService();
        });

        $this->app->singleton(GroupRecommendationService::class, function ($app) {
            return new GroupRecommendationService();
        });

        $this->app->singleton(ExchangeService::class, function ($app) {
            return new ExchangeService();
        });

        // --- Batch 4 services (15) — Admin/Specialized ---

        $this->app->singleton(ContentModerationService::class);

        $this->app->singleton(EmailService::class, function ($app) {
            return new EmailService();
        });

        $this->app->singleton(CronJobService::class, function ($app) {
            return new CronJobService();
        });

        $this->app->singleton(AdminSettingsService::class, function ($app) {
            return new AdminSettingsService();
        });

        $this->app->singleton(AdminListingsService::class, function ($app) {
            return new AdminListingsService();
        });

        $this->app->singleton(AdminUsersService::class, function ($app) {
            return new AdminUsersService(new User());
        });

        $this->app->singleton(DeliverableService::class, function ($app) {
            return new DeliverableService();
        });

        $this->app->singleton(FederationService::class, function ($app) {
            return new FederationService();
        });

        $this->app->singleton(ChallengeService::class);

        $this->app->singleton(BadgeService::class, function ($app) {
            return new BadgeService(new UserBadge());
        });

        $this->app->singleton(AiChatService::class, function ($app) {
            return new AiChatService();
        });

        $this->app->singleton(RealtimeService::class, function ($app) {
            return new RealtimeService();
        });

        $this->app->singleton(SeoService::class, function ($app) {
            return new SeoService();
        });

        // --- Batch 5 services (30) — Legacy DI wrappers ---

        $this->app->singleton(LeaderboardService::class, function ($app) {
            return new LeaderboardService();
        });

        $this->app->singleton(LeaderboardSeasonService::class, function ($app) {
            return new LeaderboardSeasonService();
        });

        $this->app->singleton(OnboardingService::class, function ($app) {
            return new OnboardingService();
        });

        $this->app->singleton(StreakService::class);

        $this->app->singleton(NexusScoreService::class);

        $this->app->singleton(NexusScoreCacheService::class);

        $this->app->singleton(RateLimitService::class, function ($app) {
            return new RateLimitService();
        });

        $this->app->singleton(FeedActivityService::class, function ($app) {
            return new FeedActivityService();
        });

        $this->app->singleton(FeedRankingService::class, function ($app) {
            return new FeedRankingService();
        });

        $this->app->singleton(HashtagService::class, function ($app) {
            return new HashtagService();
        });

        $this->app->singleton(ExchangeRatingService::class, function ($app) {
            return new ExchangeRatingService();
        });

        $this->app->singleton(ExchangeWorkflowService::class);

        $this->app->singleton(CreditDonationService::class, function ($app) {
            return new CreditDonationService();
        });

        $this->app->singleton(StartingBalanceService::class, function ($app) {
            return new StartingBalanceService();
        });

        $this->app->singleton(TransactionCategoryService::class, function ($app) {
            return new TransactionCategoryService();
        });

        $this->app->singleton(TransactionExportService::class, function ($app) {
            return new TransactionExportService();
        });

        $this->app->singleton(ListingAnalyticsService::class, function ($app) {
            return new ListingAnalyticsService();
        });

        $this->app->singleton(ListingModerationService::class, function ($app) {
            return new ListingModerationService();
        });

        $this->app->singleton(ListingFeaturedService::class, function ($app) {
            return new ListingFeaturedService();
        });

        $this->app->singleton(VolunteerCheckInService::class, function ($app) {
            return new VolunteerCheckInService();
        });

        $this->app->singleton(VolunteerMatchingService::class, function ($app) {
            return new VolunteerMatchingService();
        });

        $this->app->singleton(VolunteerReminderService::class, function ($app) {
            return new VolunteerReminderService();
        });

        $this->app->singleton(EventNotificationService::class, function ($app) {
            return new EventNotificationService();
        });

        $this->app->bind(
            \App\Contracts\EventNotificationOutboxHandler::class,
            \App\Services\EventNotificationOutboxActionHandler::class,
        );

        $this->app->bind(
            \App\Contracts\EventFederationTransport::class,
            \App\Services\NexusEventFederationTransport::class,
        );

        $this->app->singleton(EventReminderService::class, function ($app) {
            return new EventReminderService();
        });

        $this->app->singleton(DailyRewardService::class, function ($app) {
            return new DailyRewardService();
        });

        $this->app->singleton(XPShopService::class, function ($app) {
            return new XPShopService();
        });

        // --- Batch 6 services (150) --- Full coverage DI wrappers ---

        $this->app->singleton(AbuseDetectionService::class, function ($app) {
            return new AbuseDetectionService();
        });

        $this->app->singleton(AchievementAnalyticsService::class, function ($app) {
            return new AchievementAnalyticsService();
        });

        $this->app->singleton(AchievementCampaignService::class, function ($app) {
            return new AchievementCampaignService();
        });

        $this->app->singleton(AchievementUnlockablesService::class, function ($app) {
            return new AchievementUnlockablesService();
        });

        $this->app->singleton(AdminBadgeCountService::class, function ($app) {
            return new AdminBadgeCountService();
        });

        $this->app->singleton(BadgeCollectionService::class);

        $this->app->singleton(BalanceAlertService::class, function ($app) {
            return new BalanceAlertService();
        });

        $this->app->singleton(BrokerControlConfigService::class, function ($app) {
            return new BrokerControlConfigService();
        });

        $this->app->singleton(BrokerMessageVisibilityService::class);

        $this->app->singleton(CSSSanitizer::class, function ($app) {
            return new CSSSanitizer();
        });

        $this->app->singleton(CampaignService::class, function ($app) {
            return new CampaignService();
        });

        $this->app->singleton(ChallengeCategoryService::class, function ($app) {
            return new ChallengeCategoryService();
        });

        $this->app->singleton(ChallengeOutcomeService::class, function ($app) {
            return new ChallengeOutcomeService();
        });

        $this->app->singleton(ChallengeTagService::class, function ($app) {
            return new ChallengeTagService();
        });

        $this->app->singleton(ChallengeTemplateService::class, function ($app) {
            return new ChallengeTemplateService();
        });

        $this->app->singleton(CollaborativeFilteringService::class, function ($app) {
            return new CollaborativeFilteringService();
        });

        $this->app->singleton(CommunityFundService::class, function ($app) {
            return new CommunityFundService();
        });

        $this->app->singleton(CommunityProjectService::class, function ($app) {
            return new CommunityProjectService();
        });

        $this->app->singleton(ContextualMessageService::class, function ($app) {
            return new ContextualMessageService();
        });

        $this->app->singleton(CookieInventoryService::class, function ($app) {
            return new CookieInventoryService();
        });

        $this->app->singleton(CrossModuleMatchingService::class, function ($app) {
            return new CrossModuleMatchingService(
                $app->make(SmartMatchingEngine::class),
                $app->make(\App\Services\GroupMatchingService::class),
            );
        });

        $this->app->singleton(EmailMonitorService::class, function ($app) {
            return new EmailMonitorService();
        });

        $this->app->singleton(EmbeddingService::class, function ($app) {
            return new EmbeddingService();
        });

        $this->app->singleton(FCMPushService::class, function ($app) {
            return new FCMPushService();
        });

        $this->app->singleton(FederatedConnectionService::class, function ($app) {
            return new FederatedConnectionService();
        });

        $this->app->singleton(FederatedMessageService::class, function ($app) {
            return new FederatedMessageService();
        });

        $this->app->singleton(FederationActivityService::class, function ($app) {
            return new FederationActivityService();
        });

        $this->app->singleton(FederationAuditService::class, function ($app) {
            return new FederationAuditService();
        });

        $this->app->singleton(FederationCreditService::class, function ($app) {
            return new FederationCreditService();
        });

        $this->app->singleton(FederationDirectoryService::class, function ($app) {
            return new FederationDirectoryService();
        });

        $this->app->singleton(FederationEmailService::class, function ($app) {
            return new FederationEmailService();
        });

        $this->app->singleton(FederationFeatureService::class);

        $this->app->singleton(FederationJwtService::class, function ($app) {
            return new FederationJwtService();
        });

        $this->app->singleton(FederationNeighborhoodService::class, function ($app) {
            return new FederationNeighborhoodService();
        });

        $this->app->singleton(FederationPartnershipService::class);

        $this->app->singleton(FederationRealtimeService::class, function ($app) {
            return new FederationRealtimeService();
        });

        $this->app->singleton(FederationSearchService::class, function ($app) {
            return new FederationSearchService();
        });

        $this->app->singleton(FederationUserService::class, function ($app) {
            return new FederationUserService();
        });

        $this->app->singleton(GamificationEmailService::class, function ($app) {
            return new GamificationEmailService();
        });

        $this->app->singleton(GamificationRealtimeService::class, function ($app) {
            return new GamificationRealtimeService();
        });

        $this->app->singleton(GeocodingService::class, function ($app) {
            return new GeocodingService();
        });

        $this->app->singleton(GoalCheckinService::class, function ($app) {
            return new GoalCheckinService();
        });

        $this->app->singleton(GoalProgressService::class, function ($app) {
            return new GoalProgressService();
        });

        $this->app->singleton(GoalReminderService::class, function ($app) {
            return new GoalReminderService();
        });

        $this->app->singleton(GoalTemplateService::class, function ($app) {
            return new GoalTemplateService(new GoalTemplate());
        });

        $this->app->singleton(GroupAchievementService::class, function ($app) {
            return new GroupAchievementService();
        });

        $this->app->singleton(GroupAnnouncementService::class, function ($app) {
            return new GroupAnnouncementService();
        });

        $this->app->singleton(GroupChatroomService::class, function ($app) {
            return new GroupChatroomService();
        });

        $this->app->singleton(GroupExchangeService::class, function ($app) {
            return new GroupExchangeService();
        });

        $this->app->singleton(GroupModerationService::class, function ($app) {
            return new GroupModerationService();
        });

        $this->app->singleton(GroupNotificationService::class, function ($app) {
            return new GroupNotificationService();
        });

        $this->app->singleton(GroupPolicyRepository::class, function ($app) {
            return new GroupPolicyRepository();
        });

        $this->app->singleton(GroupRecommendationEngine::class, function ($app) {
            return new GroupRecommendationEngine();
        });

        $this->app->singleton(GuardianConsentService::class, function ($app) {
            return new GuardianConsentService();
        });

        $this->app->singleton(HoursReportService::class, function ($app) {
            return new HoursReportService();
        });

        $this->app->singleton(HtmlSanitizer::class, function ($app) {
            return new HtmlSanitizer();
        });

        $this->app->singleton(IdeaMediaService::class, function ($app) {
            return new IdeaMediaService();
        });

        $this->app->singleton(IdeaTeamConversionService::class, function ($app) {
            return new IdeaTeamConversionService();
        });

        $this->app->singleton(ImpactReportingService::class, function ($app) {
            return new ImpactReportingService();
        });

        $this->app->singleton(InactiveMemberService::class, function ($app) {
            return new InactiveMemberService();
        });

        $this->app->singleton(InsuranceCertificateService::class, function ($app) {
            return new InsuranceCertificateService();
        });

        $this->app->singleton(ListingExpiryReminderService::class, function ($app) {
            return new ListingExpiryReminderService();
        });

        $this->app->singleton(ListingExpiryService::class, function ($app) {
            return new ListingExpiryService();
        });

        $this->app->singleton(ListingRankingService::class, function ($app) {
            return new ListingRankingService();
        });

        $this->app->singleton(ListingRiskTagService::class, function ($app) {
            return new ListingRiskTagService();
        });

        $this->app->singleton(ListingSkillTagService::class, function ($app) {
            return new ListingSkillTagService();
        });

        $this->app->singleton(MailchimpService::class, function ($app) {
            return new MailchimpService();
        });

        $this->app->singleton(MatchApprovalWorkflowService::class, function ($app) {
            return new MatchApprovalWorkflowService();
        });

        $this->app->singleton(MatchLearningService::class, function ($app) {
            return new MatchLearningService();
        });

        $this->app->singleton(MatchingService::class, function ($app) {
            return new MatchingService();
        });

        $this->app->singleton(MemberReportService::class, function ($app) {
            return new MemberReportService();
        });

        $this->app->singleton(MemberVerificationBadgeService::class, function ($app) {
            return new MemberVerificationBadgeService();
        });

        $this->app->singleton(NotificationDispatcher::class, function ($app) {
            return new NotificationDispatcher();
        });

        $this->app->singleton(PollExportService::class, function ($app) {
            return new PollExportService();
        });

        $this->app->singleton(PollRankingService::class, function ($app) {
            return new PollRankingService();
        });

        $this->app->singleton(PusherService::class, function ($app) {
            return new PusherService();
        });

        $this->app->singleton(RecurringShiftService::class, function ($app) {
            return new RecurringShiftService();
        });

        $this->app->singleton(RedisCache::class, function ($app) {
            return new RedisCache();
        });

        $this->app->singleton(ReportExportService::class, function ($app) {
            return new ReportExportService();
        });

        $this->app->singleton(SafeguardingService::class);

        $this->app->singleton(SearchLogService::class, function ($app) {
            return new SearchLogService();
        });

        $this->app->singleton(ShiftGroupReservationService::class, function ($app) {
            return new ShiftGroupReservationService();
        });

        $this->app->singleton(ShiftSwapService::class, function ($app) {
            return new ShiftSwapService();
        });

        $this->app->singleton(ShiftWaitlistService::class, function ($app) {
            return new ShiftWaitlistService();
        });

        $this->app->singleton(SmartGroupRankingService::class, function ($app) {
            return new SmartGroupRankingService();
        });

        $this->app->singleton(SmartMatchingAnalyticsService::class, function ($app) {
            return new SmartMatchingAnalyticsService();
        });

        $this->app->singleton(SmartMatchingEngine::class);

        $this->app->singleton(SocialNotificationService::class, function ($app) {
            return new SocialNotificationService();
        });

        $this->app->singleton(SocialValueService::class, function ($app) {
            return new SocialValueService();
        });

        $this->app->singleton(SuperAdminAuditService::class, function ($app) {
            return new SuperAdminAuditService();
        });

        $this->app->singleton(TeamDocumentService::class, function ($app) {
            return new TeamDocumentService();
        });

        $this->app->singleton(TeamTaskService::class, function ($app) {
            return new TeamTaskService();
        });

        $this->app->singleton(TenantFeatureConfig::class, function ($app) {
            return new TenantFeatureConfig();
        });

        $this->app->singleton(TenantHierarchyService::class, function ($app) {
            return new TenantHierarchyService();
        });

        $this->app->singleton(TenantSettingsService::class, function ($app) {
            return new TenantSettingsService();
        });

        $this->app->singleton(TenantVisibilityService::class, function ($app) {
            return new TenantVisibilityService();
        });

        $this->app->singleton(TotpService::class, function ($app) {
            return new TotpService();
        });

        $this->app->singleton(TwoFactorChallengeManager::class, function ($app) {
            return new TwoFactorChallengeManager();
        });

        $this->app->singleton(UserInsightsService::class, function ($app) {
            return new UserInsightsService();
        });

        $this->app->singleton(VolunteerCertificateService::class, function ($app) {
            return new VolunteerCertificateService();
        });

        $this->app->singleton(VolunteerDonationService::class, function ($app) {
            return new VolunteerDonationService();
        });

        $this->app->singleton(VolunteerEmergencyAlertService::class, function ($app) {
            return new VolunteerEmergencyAlertService();
        });

        $this->app->singleton(VolunteerExpenseService::class, function ($app) {
            return new VolunteerExpenseService();
        });

        $this->app->singleton(VolunteerFormService::class, function ($app) {
            return new VolunteerFormService();
        });

        $this->app->singleton(VolunteerWellbeingService::class, function ($app) {
            return new VolunteerWellbeingService();
        });

        $this->app->singleton(WebAuthnChallengeStore::class, function ($app) {
            return new WebAuthnChallengeStore();
        });

        $this->app->singleton(WebPushService::class, function ($app) {
            return new WebPushService();
        });

        $this->app->singleton(WebhookDispatchService::class, function ($app) {
            return new WebhookDispatchService();
        });

        $this->app->singleton(AIServiceFactory::class, function ($app) {
            return new AIServiceFactory();
        });
    }

    public function boot(): void
    {
        // Platform rollout switches the owner set in the UI override their
        // environment defaults. Applied here, once, so every existing
        // config('events...') read picks them up with no call site changing.
        // Only capabilities with a stored row are touched, and the lookup fails
        // open to the environment — a missing or unreadable table must never
        // slam every gate shut.
        try {
            app(\App\Services\PlatformCapabilityService::class)->applyToConfig();
        } catch (\Throwable $exception) {
            \Illuminate\Support\Facades\Log::warning('Platform capability overrides not applied', [
                'error' => $exception->getMessage(),
            ]);
        }

        // Request performance recording (feeds /admin/performance). Attached
        // here, before routing, so tenant resolution and authentication queries
        // are counted — they are part of what the request cost. No-ops when
        // config('performance.enabled') is false or in console/queue processes.
        try {
            app(\App\Support\Performance\PerformanceRecorder::class)->listen();
        } catch (\Throwable $exception) {
            \Illuminate\Support\Facades\Log::warning('Performance recorder not attached', [
                'error' => $exception->getMessage(),
            ]);
        }

        // Cloudflare terminates TLS and proxies to origin as HTTP. Without this,
        // route()/url() emit http:// URLs that the browser blocks via CSP
        // (form-action 'self') because the page is loaded over https://.
        //
        // Use resolving() to defer the forceScheme() call until the url service
        // is actually being constructed. Calling URL::forceScheme() eagerly in
        // boot() resolves the url binding immediately, which tries to inject
        // $app['request'] — null in console/queue contexts and crashes with
        // "Argument #2 ($request) must be of type Illuminate\Http\Request, null given".
        if (str_starts_with((string) config('app.url'), 'https://') || $this->app->environment('production')) {
            $this->app->resolving('url', function ($url) {
                $url->forceScheme('https');
            });
        }

        // Initialise the custom JSON translator so __() resolves lang/{locale}/*.json
        // for ALL contexts (HTTP requests and artisan/cron jobs). Without this,
        // $langDir stays '' and every __() call returns the raw key as fallback.
        Translator::init(lang_path());

        // STRUCTURAL DEFENSE against cross-tenant queue contamination.
        //
        // Horizon runs long-lived worker processes. PHP static state (notably
        // TenantContext::$cachedId / $tenant) persists between jobs. When an
        // event like UserRegistered uses SerializesModels, Laravel re-fetches
        // the model via findOrFail() at deserialize time — and the User model
        // has HasTenantScope, which filters by TenantContext::getId(). If the
        // previous job left context set to tenant 2 and the next job is for a
        // tenant-10 user, findOrFail returns null → ModelNotFoundException →
        // the welcome / activation email silently fails to send.
        //
        // The per-listener finally { TenantContext::reset(); } pattern closes
        // most of this, but a job that throws during deserialization never
        // reaches its own finally. Resetting in JobProcessing fires BEFORE
        // payload deserialization runs, guaranteeing every job starts with a
        // clean null context regardless of what the previous job did.
        //
        // Also resets after each asynchronous job and on failure as
        // defence-in-depth. The sync driver is different: it executes inline
        // inside the current HTTP/test tenant scope. Resetting before a sync
        // job silently changes the remainder of that request to the platform
        // default tenant. Preserve and restore the outer tenant for sync jobs.
        $syncQueueTenantIds = [];
        $restoreSyncQueueTenant = static function (object $event) use (&$syncQueueTenantIds): bool {
            if (($event->connectionName ?? null) !== 'sync') {
                return false;
            }

            $jobKey = spl_object_id($event->job);
            if (! array_key_exists($jobKey, $syncQueueTenantIds)) {
                return true;
            }

            $tenantId = $syncQueueTenantIds[$jobKey];
            unset($syncQueueTenantIds[$jobKey]);
            if ($tenantId !== null) {
                \App\Core\TenantContext::setById($tenantId);
            } else {
                \App\Core\TenantContext::reset();
            }

            return true;
        };

        \Illuminate\Support\Facades\Queue::before(static function (object $event) use (&$syncQueueTenantIds): void {
            if (($event->connectionName ?? null) === 'sync') {
                $syncQueueTenantIds[spl_object_id($event->job)] = \App\Core\TenantContext::currentId();
                return;
            }

            \App\Core\TenantContext::reset();
        });
        \Illuminate\Support\Facades\Queue::after(static function (object $event) use ($restoreSyncQueueTenant): void {
            if (! $restoreSyncQueueTenant($event)) {
                \App\Core\TenantContext::reset();
            }
        });
        \Illuminate\Support\Facades\Queue::exceptionOccurred(static function (object $event) use ($restoreSyncQueueTenant): void {
            if (! $restoreSyncQueueTenant($event)) {
                \App\Core\TenantContext::reset();
            }
        });
        \Illuminate\Support\Facades\Queue::failing(static function (object $event) use ($restoreSyncQueueTenant): void {
            if (! $restoreSyncQueueTenant($event)) {
                \App\Core\TenantContext::reset();
            }
        });

        // Load JSON translation files from lang/{locale}/ subdirectories.
        // Laravel only loads lang/{locale}.json by default. Our email translations
        // are in lang/en/emails.json, lang/en/emails_listings.json, etc.
        $this->loadJsonTranslations();

        // Initialize Sentry SDK for error tracking (raw sentry/sentry package).
        // sentry-laravel is not installed, so we init manually with PII scrubbing.
        $this->initializeSentry();

        Listing::observe(ListingObserver::class);
        User::observe(UserObserver::class);
        Event::observe(EventObserver::class);
        Group::observe(GroupObserver::class);
        JobVacancy::observe(JobVacancyObserver::class);
        MarketplaceListing::observe(MarketplaceListingObserver::class);
        \App\Models\Course::observe(\App\Observers\CourseObserver::class);
        FeedPost::observe(FeedPostObserver::class);
        \App\Models\Comment::observe(CommentObserver::class);

        // Prerender cache invalidation hooks. On save/delete, the observers
        // enqueue a NORMAL-priority recache for the affected route(s) and
        // delete the stale snapshot immediately. Failures are logged, never
        // thrown — model writes must never block on the prerender side-channel.
        // The base PrerenderInvalidationObserver handles all the plumbing;
        // subclasses just declare which routes depend on the model.
        \App\Models\Post::observe(\App\Observers\PostPrerenderObserver::class);
        Listing::observe(\App\Observers\ListingPrerenderObserver::class);
        Event::observe(\App\Observers\EventPrerenderObserver::class);
        Group::observe(\App\Observers\GroupPrerenderObserver::class);
        JobVacancy::observe(\App\Observers\JobVacancyPrerenderObserver::class);
        MarketplaceListing::observe(\App\Observers\MarketplaceListingPrerenderObserver::class);
        \App\Models\MarketplaceCategory::observe(\App\Observers\MarketplaceCategoryPrerenderObserver::class);
        \App\Models\VolOpportunity::observe(\App\Observers\VolOpportunityPrerenderObserver::class);
        \App\Models\IdeationChallenge::observe(\App\Observers\IdeationChallengePrerenderObserver::class);
        \App\Models\Page::observe(\App\Observers\PagePrerenderObserver::class);
        \App\Models\ResourceItem::observe(\App\Observers\ResourceItemPrerenderObserver::class);
        \App\Models\Course::observe(\App\Observers\CoursePrerenderObserver::class);
        \App\Models\CourseSection::observe(\App\Observers\CourseSectionPrerenderObserver::class);
        \App\Models\CourseLesson::observe(\App\Observers\CourseLessonPrerenderObserver::class);
        // Organization + KnowledgeBaseArticle are sitemap-included but raw-DB
        // (no Eloquent model). They rely on the drift detector for freshness;
        // see prerender:detect-drift.

        // Dynamically merge CorsHelper's full origin list (including tenant custom
        // domains from DB) into Laravel's HandleCors config. This ensures custom
        // tenant domains like hour-timebank.ie pass CORS validation.
        try {
            $corsOrigins = config('cors.allowed_origins', []);
            $helperOrigins = \App\Helpers\CorsHelper::getAllowedOrigins();
            $merged = array_values(array_unique(array_merge($corsOrigins, $helperOrigins)));
            config(['cors.allowed_origins' => $merged]);
        } catch (\Throwable $e) {
            // CorsHelper may fail if DB isn't ready (e.g., during migrations) — non-fatal
        }

        // SAFETY: Prevent migrate:fresh/refresh from wiping the main database.
        // Only nexus_test may be wiped. This guards against accidental data loss
        // from RefreshDatabase in tests or manual artisan commands.
        if ($this->app->runningInConsole()) {
            $db = config('database.connections.' . config('database.default') . '.database');
            $dangerous = ['migrate:fresh', 'migrate:refresh', 'db:wipe'];
            $command = $_SERVER['argv'][1] ?? '';
            if (in_array($command, $dangerous) && $db === 'nexus') {
                fwrite(STDERR, "\n  ❌ BLOCKED: '$command' on the main 'nexus' database.\n");
                fwrite(STDERR, "  Use DB_DATABASE=nexus_test or run against the test database.\n\n");
                throw new \RuntimeException("Blocked: '$command' is not allowed on the production 'nexus' database.");
            }
        }
    }

    /**
     * Initialize the Sentry SDK for PHP error tracking.
     *
     * Since sentry/sentry-laravel is not installed, we initialize the raw
     * sentry/sentry SDK manually. This sets up:
     * - DSN from config/services.php
     * - Environment and release tags
     * - PII scrubbing via before_send callback
     * - Send default PII disabled
     */
    /**
     * Load JSON translation files from lang/{locale}/ subdirectories.
     *
     * Laravel's __() helper only loads lang/{locale}.json (flat file).
     * Our email translations are split into lang/en/emails.json,
     * lang/en/emails_listings.json, etc. This method flattens them
     * into dot-notation keys and merges them into the translator.
     *
     * e.g. lang/en/emails.json { "federation": { "message_title": "..." } }
     * becomes accessible as __('emails.federation.message_title')
     */
    private function loadJsonTranslations(): void
    {
        try {
            $translator = app('translator');
            $basePath = lang_path();

            if (!is_dir($basePath)) return;

            // Load nested JSON translations for EVERY locale directory, not just
            // the current one. The flattened result is cached because reading and
            // decoding hundreds of JSON files on every request is extremely slow
            // on Docker Desktop bind mounts.
            foreach ($this->loadCachedJsonTranslations($basePath) as $locale => $lines) {
                if ($this->shouldSkipJsonTranslationLocaleForTesting($locale)) {
                    continue;
                }
                if (!empty($lines)) {
                    $translator->addLines($lines, $locale);
                }
            }
        } catch (\Throwable $e) {
            // Non-fatal — emails will show raw keys but the app won't crash
            \Illuminate\Support\Facades\Log::warning('loadJsonTranslations failed: ' . $e->getMessage());
        }
    }

    private function shouldSkipJsonTranslationLocaleForTesting(string $locale): bool
    {
        if (!$this->app->environment('testing')) {
            return false;
        }

        $raw = (string) config('app.test_translation_locales', 'en,ga,de');
        if ($raw === '*' || strtolower($raw) === 'all') {
            return false;
        }

        $allowed = array_filter(array_map(
            static fn (string $entry): string => trim($entry),
            explode(',', $raw)
        ));

        return !in_array($locale, $allowed, true);
    }

    private function loadCachedJsonTranslations(string $basePath): array
    {
        $cachePath = base_path('bootstrap/cache/' . self::TRANSLATION_CACHE_FILE);

        // PHPUnit in the Docker-on-Windows dev environment boots Laravel many
        // times. Walking every locale JSON file on the bind mount just to
        // freshness-check the generated bundle can take 30+ seconds before the
        // first assertion. Tests do not need to rebuild the production
        // translation cache on every bootstrap; i18n drift is covered by the
        // dedicated npm checks.
        if ($this->app->environment('testing') && is_file($cachePath)) {
            $cached = require $cachePath;
            if (is_array($cached)) {
                return $cached;
            }
        }

        if (is_file($cachePath) && $this->isJsonTranslationCacheFresh($cachePath, $basePath)) {
            $cached = require $cachePath;
            if (is_array($cached)) {
                return $cached;
            }
        }

        $translations = $this->buildJsonTranslationLines($basePath);
        $this->writeJsonTranslationCache($cachePath, $translations);

        return $translations;
    }

    private function isJsonTranslationCacheFresh(string $cachePath, string $basePath): bool
    {
        $cacheMtime = filemtime($cachePath);
        if ($cacheMtime === false) {
            return false;
        }

        foreach (glob($basePath . DIRECTORY_SEPARATOR . '*' . DIRECTORY_SEPARATOR . '*.{json,php}', GLOB_BRACE) ?: [] as $file) {
            $fileMtime = filemtime($file);
            if ($fileMtime !== false && $fileMtime > $cacheMtime) {
                return false;
            }
        }

        return true;
    }

    private function buildJsonTranslationLines(string $basePath): array
    {
        $translations = [];

        // Loading all locales up-front is important for queued jobs: a queue
        // worker boots once, then individual jobs may switch locale per tenant
        // or recipient.
        foreach (scandir($basePath) as $entry) {
            if ($entry === '.' || $entry === '..') continue;

            $langPath = $basePath . DIRECTORY_SEPARATOR . $entry;
            if (!is_dir($langPath)) continue;

            foreach (glob($langPath . '/*.json') as $file) {
                $namespace = pathinfo($file, PATHINFO_FILENAME); // e.g. 'emails_misc'
                $phpGroupPath = $langPath . DIRECTORY_SEPARATOR . $namespace . '.php';
                if (is_file($phpGroupPath)) {
                    $phpLines = require $phpGroupPath;
                    if (is_array($phpLines)) {
                        foreach (\Illuminate\Support\Arr::dot($phpLines) as $key => $value) {
                            $translations[$entry][$namespace . '.' . $key] = $value;
                        }
                    }
                }

                $contents = file_get_contents($file);
                if ($contents === false) continue;

                $data = json_decode($contents, true);
                if (!is_array($data)) continue;

                // Flatten nested arrays into dot-notation and register with the
                // translator. Convert {{var}} placeholders (i18next format used
                // in JSON) to :var (Laravel format) so __() parameter
                // substitution works.
                foreach (\Illuminate\Support\Arr::dot($data) as $key => $value) {
                    if (is_string($value)) {
                        $value = preg_replace('/\{\{(\w+)\}\}/', ':$1', $value);
                    }
                    $translations[$entry][$namespace . '.' . $key] = $value;
                }
            }
        }

        return $translations;
    }

    private function writeJsonTranslationCache(string $cachePath, array $translations): void
    {
        $directory = dirname($cachePath);
        if (!is_dir($directory) || !is_writable($directory)) {
            return;
        }

        $tmpPath = $cachePath . '.' . getmypid() . '.tmp';
        $contents = "<?php\n\nreturn " . var_export($translations, true) . ";\n";

        if (file_put_contents($tmpPath, $contents, LOCK_EX) === false) {
            return;
        }

        @rename($tmpPath, $cachePath);
        if (is_file($tmpPath)) {
            @unlink($tmpPath);
        }
    }

    private function initializeSentry(): void
    {
        if (!class_exists(\Sentry\SentrySdk::class)) {
            return;
        }

        $dsn = config('services.sentry.dsn');
        if (empty($dsn)) {
            return;
        }

        // Release = the deployed COMMIT, not the version. app.version (e.g.
        // 1.5.8) spans many deploys, so a version-based release cannot answer
        // "which deploy introduced this error". SecurityHeaders::buildCommit()
        // is the same derivation that stamps the X-Build response header
        // (.build-version file → BUILD_COMMIT env → git), so the release on a
        // Sentry event always equals the X-Build of the code that threw it.
        // Version stays as a fallback for environments with no commit at all.
        $buildCommit = \App\Http\Middleware\SecurityHeaders::buildCommit();

        try {
            \Sentry\init([
                'dsn' => $dsn,
                'environment' => config('services.sentry.environment', 'production'),
                'release' => 'nexus-php@' . ($buildCommit !== '' ? $buildCommit : config('app.version', 'unknown')),
                'sample_rate' => 1.0,
                'traces_sample_rate' => config('services.sentry.traces_sample_rate', 0.1),
                'send_default_pii' => false,
                'before_send' => function (\Sentry\Event $event): ?\Sentry\Event {
                    // Scrub sensitive data from request body
                    $request = $event->getRequest();
                    if (!empty($request['data']) && is_array($request['data'])) {
                        $sensitiveFields = [
                            'password', 'password_confirmation', 'current_password',
                            'token', 'api_key', 'secret', 'csrf_token',
                            'credit_card', 'card_number', 'cvv', 'ssn',
                            'refresh_token', 'access_token',
                        ];
                        foreach ($sensitiveFields as $field) {
                            if (isset($request['data'][$field])) {
                                $request['data'][$field] = '[FILTERED]';
                            }
                        }
                        $event->setRequest($request);
                    }
                    return $event;
                },
            ]);
        } catch (\Throwable $e) {
            // Sentry init failure is non-fatal — log and continue
            \Illuminate\Support\Facades\Log::warning('Sentry initialization failed: ' . $e->getMessage());
        }
    }
}
