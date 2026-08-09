// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Fido2NetLib;
using Microsoft.AspNetCore.DataProtection;
using Nexus.Api.Clients;
using Nexus.Api.Configuration;
using Nexus.Api.Services;
using Nexus.Api.Services.Registration;
using Nexus.Messaging;
using Polly;
using Polly.Extensions.Http;

namespace Nexus.Api.Extensions;

/// <summary>
/// IServiceCollection extension methods for domain service registrations.
/// Extracted from Program.cs to keep startup file concise.
/// </summary>
public static class ServiceExtensions
{
    /// <summary>
    /// Registers all Nexus domain services, the Meilisearch HTTP client,
    /// the Registration Policy Engine, AI/SignalR services, and the Llama
    /// HTTP client with Polly resilience policies.
    /// </summary>
    public static IServiceCollection AddNexusServices(
        this IServiceCollection services,
        IConfiguration configuration)
    {
        // Core infrastructure
        services.AddMemoryCache();
        services.AddDataProtection();
        services.AddSingleton<CacheService>();
        services.AddScoped<GamificationService>();
        services.AddScoped<PersonalWalletTransferEffectsService>();
        services.AddScoped<ExchangeService>();
        services.AddScoped<MatchingService>();
        services.AddScoped<VolunteerGuardianConsentService>();
        services.AddScoped<VolunteerOrganisationService>();
        services.AddScoped<VolunteerOrganisationWalletService>();
        services.AddScoped<PersonalWalletLedgerService>();
        services.AddScoped<VolunteerAttendanceService>();
        services.AddScoped<VolunteerHoursService>();
        services.AddScoped<VolunteerService>();
        services.AddScoped<AdminVolunteerApprovalService>();
        services.AddScoped<ShiftManagementService>();
        services.AddScoped<WalletFeatureService>();
        services.AddScoped<ListingFeatureService>();
        services.AddScoped<GroupFeatureService>();

        // Gamification V2
        services.AddScoped<ChallengeService>();
        services.AddScoped<StreakService>();
        services.AddScoped<LeaderboardSeasonService>();
        services.AddScoped<DailyRewardService>();

        // Skills, audit, email
        services.AddScoped<SkillService>();
        services.AddScoped<AuditLogService>();
        services.Configure<GmailOptions>(
            configuration.GetSection(GmailOptions.SectionName));
        // 2026-05-09 — SendGrid primary + Gmail SMTP fallback per project
        // owner directive. Both transports are registered as concrete classes
        // and FallbackEmailService is wired as the IEmailService consumers see.
        // If SendGrid is disabled, we still want Gmail registered for direct use.
        services.AddScoped<SendGridEmailService>();
        services.AddHttpClient<GmailEmailService>();
        if (configuration.GetValue("SendGrid:Enabled", false))
            services.AddScoped<IEmailService, FallbackEmailService>();
        else
            services.AddScoped<IEmailService>(sp => sp.GetRequiredService<GmailEmailService>());
        services.AddScoped<EmailNotificationService>();

        // Phase 26-37
        services.AddScoped<ContentReportService>();
        services.AddScoped<GdprService>();
        services.AddScoped<LocationService>();
        services.AddScoped<FeedActivityService>();
        services.AddScoped<FeedRankingService>();
        services.AddScoped<AdminAnalyticsService>();
        services.AddScoped<AdminCrmService>();
        services.AddScoped<VolunteerWebhookService>();
        services.AddScoped<NewsletterService>();
        services.AddScoped<CookieConsentService>();
        services.AddScoped<LegalDocumentService>();
        services.AddScoped<PushNotificationService>();
        services.AddScoped<Nexus.Api.Services.WebPush.WebPushSender>();
        services.AddScoped<TranslationService>();
        services.AddScoped<FederationService>();
        services.AddSingleton<FederationJwtService>();
        services.AddScoped<FederationGatewayService>();
        services.AddScoped<FederationApiKeyService>();
        services.AddHttpClient<FederationExternalApiClient>();
        services.AddScoped<FederationExternalPartnerService>();
        services.AddScoped<PredictiveStaffingService>();
        services.AddScoped<SystemAdminService>();
        services.AddScoped<LockdownService>();
        services.AddScoped<JobService>();
        services.AddScoped<JobsBiasAuditService>();
        services.AddScoped<IdeationService>();
        services.AddScoped<SubscriptionService>();
        services.AddScoped<DeliverableService>();

        // WebAuthn/Passkeys (FIDO2)
        var fido2Config = configuration.GetSection("Fido2");
        services.AddFido2(options =>
        {
            options.ServerDomain = fido2Config["ServerDomain"] ?? "localhost";
            options.ServerName = fido2Config["ServerName"] ?? "Project NEXUS";
            options.Origins = fido2Config.GetSection("Origins").Get<HashSet<string>>()
                ?? new HashSet<string> { "http://localhost:5080" };
        });
        services.AddScoped<PasskeyService>();
        services.AddSingleton<PasskeyChallengeStore>();
        services.AddSingleton<TokenService>();
        services.AddScoped<TotpService>();
        services.AddScoped<AuthenticationConfigurationService>();
        services.AddScoped<GroupQaMutationService>();
        services.AddScoped<GroupFormService>();
        services.AddScoped<GroupInviteLifecycleService>();
        services.AddScoped<GroupDataExportService>();
        services.AddScoped<EventLifecycleService>();
        services.AddScoped<EventLifecycleHistoryQueryService>();
        services.AddScoped<EventContractProjectionService>();
        services.AddScoped<EventRecurrenceTokenService>();
        services.AddScoped<EventRecurrenceService>();
        services.AddScoped<EventRecurrenceDefinitionBlueprintService>();
        services.AddScoped<EventRecurrenceDefinitionApplicationService>();
        services.AddScoped<EventRecurrenceMaterializationService>();
        services.AddScoped<EventTemplateService>();
        services.AddSingleton<TwoFactorChallengeManager>();
        services.AddScoped<FileUploadService>();

        // Feature services
        services.AddScoped<KnowledgeBaseService>();
        services.AddScoped<UserPreferencesService>();
        services.AddScoped<PollService>();
        services.AddScoped<GoalService>();
        services.AddScoped<AvailabilityService>();
        services.AddScoped<BlogService>();
        services.AddScoped<PageService>();
        services.AddScoped<OrganisationService>();
        services.AddScoped<OrgWalletService>();
        services.AddScoped<NexusScoreService>();
        services.AddScoped<OnboardingService>();
        services.AddScoped<TenantHierarchyService>();
        services.AddScoped<InsuranceService>();
        services.AddScoped<VoiceMessageService>();
        services.AddScoped<MemberActivityService>();
        services.AddScoped<VerificationBadgeService>();
        services.AddScoped<ResourceService>();
        services.AddScoped<ThreadedCommentService>();
        services.AddScoped<VettingService>();
        services.AddScoped<SafeguardingVettingAccessService>();
        services.AddScoped<SafeguardingVettingNotificationService>();
        services.AddScoped<SafeguardingPreferencePolicyService>();
        services.AddScoped<OnboardingSafeguardingService>();
        services.AddScoped<SafeguardingJurisdictionService>();
        services.AddScoped<MemberVettingAttestationService>();
        services.AddScoped<SafeguardingInteractionPolicy>();
        services.AddScoped<ISocialCommentContactPolicy, SocialCommentContactPolicy>();
        services.AddScoped<EventBroadcastService>();
        services.AddScoped<EventRegistrationLifecycleService>();
        services.AddScoped<EventPeopleWorkflowService>();
        services.AddScoped<EventAgendaService>();
        services.AddScoped<EventStaffService>();
        services.AddScoped<EventCalendarParityService>();
        services.AddScoped<EventOfflineCheckinService>();
        services.AddScoped<EventSafetyService>();
        services.AddScoped<EventTicketService>();
        services.AddScoped<EventRegistrationProductService>();
        services.AddScoped<EventInvitationRecipientAuthorizer>();
        services.AddSingleton<EventInvitationEvidenceHasher>();
        services.AddScoped<EventNotificationPreferenceResolver>();
        services.AddScoped<EventReminderPreferenceService>();
        services.AddScoped<EventFederationStatusService>();
        services.AddScoped<EventAnalyticsQueryService>();
        services.AddScoped<EventInvitationDeliveryProcessor>();
        services.AddHostedService<EventInvitationDeliveryWorker>();
        services.AddScoped<DirectMessageMutationService>();
        services.AddScoped<SafeguardingCoordinationService>();
        services.AddScoped<DirectMessageReactionService>();
        services.AddScoped<DirectMessageTypingService>();
        services.AddHttpClient<IPusherEventPublisher, PusherEventPublisher>();
        services.AddScoped<BrokerService>();
        services.AddScoped<EnterpriseService>();
        services.AddScoped<EventReminderService>();
        services.AddScoped<EmailVerificationService>();
        services.AddScoped<FaqService>();
        services.AddScoped<GroupExchangeService>();
        services.AddScoped<CollaborativeFilterService>();
        services.AddScoped<HashtagService>();
        services.AddScoped<PersonalInsightsService>();
        services.AddScoped<SavedSearchService>();
        services.AddScoped<SubAccountService>();
        services.AddScoped<FederationAdminService>();
        services.AddScoped<SecretsVaultService>();
        services.AddScoped<TenantSsoProviderService>();
        services.AddSingleton<IPublicOidcEndpointValidator, PublicOidcEndpointValidator>();
        services.AddSingleton<ISsoOidcHttpTransport, PinnedSsoOidcHttpTransport>();
        services.AddScoped<SsoOidcAuthenticationService>();
        services.AddScoped<CaringEmergencyAlertService>();
        services.AddScoped<CaringFederationPeerService>();
        services.AddScoped<CaringSubRegionService>();
        services.AddScoped<CareProviderDirectoryService>();
        services.AddScoped<AdminCoursesService>();
        services.AddScoped<CoursesCompatibilityService>();
        services.AddScoped<PodcastsCompatibilityService>();
        services.AddScoped<AdminEmailDeliverabilityService>();
        services.AddScoped<AiModuleDocsService>();
        services.AddScoped<ExternalIntegrationBacklogService>();
        services.AddScoped<SuccessStoryService>();
        services.AddScoped<CaregiverSupportService>();
        services.AddScoped<ProjectAnnouncementService>();
        services.AddScoped<CaringCategoryCoefficientService>();
        services.AddScoped<CommercialBoundaryService>();
        services.AddScoped<MunicipalCommunicationCopilotService>();
        services.AddScoped<TenantDataQualityService>();
        services.AddScoped<CivicDigestService>();
        services.AddScoped<PilotDisclosurePackService>();
        services.AddScoped<OperatingPolicyService>();
        services.AddScoped<CaringCommunityMemberStatementService>();
        services.AddScoped<MunicipalRoiService>();
        services.AddScoped<CaringNudgeAnalyticsService>();
        services.AddScoped<PaperOnboardingIntakeService>();
        services.AddScoped<CaringFavourService>();
        services.AddScoped<MunicipalityFeedbackService>();
        services.AddScoped<MunicipalSurveyService>();
        services.AddScoped<TrustTierService>();
        services.AddScoped<WarmthPassService>();
        services.AddScoped<LeadNurtureService>();
        services.AddScoped<CaringLoyaltyService>();
        services.AddScoped<CaringCommunityForecastService>();
        services.AddScoped<IsolatedNodeReadinessService>();
        services.AddScoped<CaringInviteCodeService>();
        services.AddScoped<CaringKpiBaselineService>();
        services.AddScoped<PilotLaunchReadinessService>();
        services.AddScoped<PilotScoreboardService>();
        services.AddScoped<CaringRecipientCircleService>();
        services.AddScoped<CaringRegionalPointService>();
        services.AddScoped<CaringResearchPartnershipService>();
        services.AddScoped<ResearchAgreementTemplateService>();
        services.AddScoped<CaringCommunityRolePresetService>();
        services.AddScoped<CaringCommunityWorkflowService>();
        services.AddScoped<CaringCommunityDataExportService>();
        services.AddScoped<CaringCommunityAhvPensionExportService>();
        services.AddScoped<CaringCommunityFutureCareFundService>();
        services.AddScoped<CaringSafeguardingService>();
        services.AddScoped<CaringHelpRequestSlaService>();
        services.AddScoped<ICaringHelpRequestVoiceProcessor, CaringHelpRequestVoiceProcessor>();
        services.AddScoped<CaringSupportRelationshipService>();
        services.AddScoped<CaringCommunityVereineAdminService>();
        services.AddScoped<CaringHourEstateService>();
        services.AddScoped<CaringHourTransferService>();
        services.AddScoped<CaringHourGiftService>();
        services.AddScoped<KissTreffenService>();
        services.AddScoped<CaringCommunityMarktService>();
        services.AddScoped<CaringTandemMatchingService>();
        services.AddScoped<IntegrationShowcaseService>();
        services.AddScoped<MarketplaceService>();
        services.AddScoped<MarketplaceReportCaseService>();
        services.AddScoped<EmailTemplateService>();
        services.AddScoped<VolunteerLongTailService>();
        services.AddScoped<VolunteerWellbeingAlertService>();
        services.AddScoped<VolunteerAdminService>();

        // Phase 68 — federation protocol services
        services.AddHttpClient("NexusFederationProtocol", c =>
        {
            c.Timeout = TimeSpan.FromSeconds(20);
        });
        services.AddScoped<Nexus.Api.Services.Federation.CreditCommonsClient>();
        services.AddScoped<Nexus.Api.Services.Federation.KomunitinClient>();
        services.AddScoped<Nexus.Api.Services.Federation.NativeIngestService>();
        services.AddScoped<Nexus.Api.Services.Federation.HourTransferReconciliationService>();
        services.AddScoped<Nexus.Api.Services.Federation.IFederationWebhookSubscriptionService, Nexus.Api.Services.Federation.FederationWebhookSubscriptionService>();
        services.AddHostedService<Nexus.Api.Services.Scheduled.ReconcileFederatedHourTransfersJob>();

        // Tenant SSO provider registry and OIDC discovery probes.
        services.AddHttpClient("NexusSsoOidc", c =>
        {
            c.Timeout = TimeSpan.FromSeconds(10);
        }).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
        {
            AllowAutoRedirect = false
        });

        // Phase 69 — AI multi-provider abstraction. Each concrete provider is
        // registered as a scoped service; AiProviderFactory picks one based on
        // the Ai:Provider config key. Existing AiService continues to use the
        // Ollama client directly for backwards compatibility; new callers
        // should depend on IAiProviderFactory.
        services.AddHttpClient("NexusAiProvider", c =>
        {
            c.Timeout = TimeSpan.FromSeconds(60);
        });
        services.AddScoped<Nexus.Api.Services.Ai.OllamaAiProvider>();
        services.AddScoped<Nexus.Api.Services.Ai.AnthropicAiProvider>();
        services.AddScoped<Nexus.Api.Services.Ai.OpenAiAiProvider>();
        services.AddScoped<Nexus.Api.Services.Ai.GeminiAiProvider>();
        services.AddScoped<Nexus.Api.Services.Ai.NullAiProvider>();
        services.AddScoped<Nexus.Api.Services.Ai.IAiProviderFactory, Nexus.Api.Services.Ai.AiProviderFactory>();
        services.AddScoped<Nexus.Api.Services.Ai.ActivitySummariserAgent>();
        services.AddScoped<Nexus.Api.Services.Ai.NudgeDrafterAgent>();

        // AI platform-aware knowledge + tool calling.
        services.AddScoped<Nexus.Api.Services.Ai.OllamaEmbeddingProvider>();
        services.AddScoped<Nexus.Api.Services.Ai.OpenAiEmbeddingProvider>();
        services.AddScoped<Nexus.Api.Services.Ai.IEmbeddingProviderFactory, Nexus.Api.Services.Ai.EmbeddingProviderFactory>();
        services.AddScoped<Nexus.Api.Services.Ai.AiKnowledgeService>();
        services.AddScoped<Nexus.Api.Services.Ai.KnowledgeIndexerService>();
        services.AddScoped<Nexus.Api.Services.Ai.OpenAiToolClient>();
        services.AddScoped<Nexus.Api.Services.Ai.AnthropicToolClient>();
        services.AddScoped<Nexus.Api.Services.Ai.FallbackPlatformToolClient>();
        services.AddScoped<Nexus.Api.Services.Ai.IPlatformToolClientFactory, Nexus.Api.Services.Ai.PlatformToolClientFactory>();
        services.AddScoped<Nexus.Api.Services.Ai.PlatformTools>();
        services.AddScoped<Nexus.Api.Services.Ai.ConversationSummariser>();
        services.AddScoped<Nexus.Api.Services.Ai.AiSafetyGuard>();
        services.AddSingleton<Nexus.Api.Services.Ai.IAiRateLimiter, Nexus.Api.Services.Ai.AiRateLimiter>();
        services.AddScoped<Nexus.Api.Services.Ai.PlatformChatAgent>();
        services.AddHostedService<Nexus.Api.Services.Scheduled.KnowledgeIndexBackfillJob>();

        // Phase 72 — long-tail services (donations/bookmarks/endorsements/presence)
        services.AddHttpClient("NexusStripe", c =>
        {
            c.Timeout = TimeSpan.FromSeconds(30);
            c.DefaultRequestHeaders.TryAddWithoutValidation("Stripe-Version", "2024-06-20");
        });
        services.AddScoped<IMarketplaceStripeGateway, MarketplaceStripeGateway>();
        services.AddScoped<MarketplacePaymentService>();
        services.AddScoped<MoneyDonationService>();
        services.AddScoped<BookmarkService>();
        services.AddScoped<PeerEndorsementService>();
        services.AddScoped<PresenceService>();

        // Audit follow-up: typed Provisioning backend
        services.AddScoped<Nexus.Api.Services.Provisioning.ProvisioningRequestService>();
        services.AddScoped<Nexus.Api.Services.ApiPartners.ApiPartnerService>();

        // Cloudflare Turnstile (bot challenge on public registration paths).
        // 4-second timeout; verifier short-circuits when Turnstile:SecretKey
        // is unset, so dev/CI works without a key.
        services.AddHttpClient<ITurnstileVerifier, TurnstileVerifier>(c =>
        {
            c.Timeout = TimeSpan.FromSeconds(4);
        });

        // Have I Been Pwned k-anonymity password check. 3-second timeout;
        // fails open on network errors so a HIBP outage can't block all
        // registrations. Config: Hibp:Enabled, Hibp:Threshold.
        services.AddHttpClient<IPwnedPasswordChecker, PwnedPasswordChecker>(c =>
        {
            c.Timeout = TimeSpan.FromSeconds(3);
        });

        // Background services
        services.AddHostedService<SavedSearchAlertService>();
        services.AddHostedService<GroupDataExportWorker>();

        // Phase 73 — singleton registry that hosted services write to so the
        // /api/admin/system/diagnostics endpoint can show ops staff which jobs
        // are running, idle, or failing.
        services.AddSingleton<Nexus.Api.Services.Scheduled.ScheduledJobsRegistry>();

        // Phase 63 — V1 cron task port (8 hosted services). Each can be disabled
        // individually via Scheduled:{JobName}:Enabled=false in appsettings.
        services.AddHostedService<Nexus.Api.Services.Scheduled.SyncFederationPartnersJob>();
        services.AddHostedService<Nexus.Api.Services.Scheduled.PruneFederationLogsJob>();
        services.AddHostedService<Nexus.Api.Services.Scheduled.CheckInactiveGroupsJob>();
        services.AddHostedService<Nexus.Api.Services.Scheduled.PollStuckIdentityVerificationsJob>();
        services.AddHostedService<Nexus.Api.Services.Scheduled.SafeguardingSlaEscalateJob>();
        services.AddHostedService<Nexus.Api.Services.Scheduled.MarkOverdueDuesJob>();
        services.AddHostedService<Nexus.Api.Services.Scheduled.PruneLogsJob>();
        services.AddHostedService<Nexus.Api.Services.Scheduled.GenerateMonthlyReportsJob>();
        // Phase 73 — 5 additional high-impact cron ports closing operational
        // gaps vs V1 (job expiry, featured expiry, listing expiry, onboarding
        // nurture, refresh-token cleanup).
        services.AddHostedService<Nexus.Api.Services.Scheduled.JobVacancyExpiryJob>();
        services.AddHostedService<Nexus.Api.Services.Scheduled.FeaturedExpiryJob>();
        services.AddHostedService<Nexus.Api.Services.Scheduled.ListingExpiryJob>();
        services.AddHostedService<Nexus.Api.Services.Scheduled.OnboardingNurtureJob>();
        services.AddHostedService<Nexus.Api.Services.Scheduled.ExpiredTokenCleanupJob>();
        services.AddHostedService<Nexus.Api.Services.Scheduled.VolunteerWaitlistOfferExpiryJob>();
        services.AddHostedService<Nexus.Api.Services.Scheduled.VolunteerGuardianConsentExpiryJob>();
        services.AddHostedService<Nexus.Api.Services.Scheduled.VolunteerRecurringShiftGenerationJob>();
        services.AddHostedService<Nexus.Api.Services.Scheduled.EventRecurrenceMaterializationJob>();
        services.AddHostedService<Nexus.Api.Services.Scheduled.MarketplaceEscrowReleaseJob>();

        // Meilisearch (semantic search — optional, falls back to ILIKE)
        services.Configure<MeilisearchOptions>(
            configuration.GetSection(MeilisearchOptions.SectionName));
        var meilisearchOptions = configuration
            .GetSection(MeilisearchOptions.SectionName)
            .Get<MeilisearchOptions>() ?? new MeilisearchOptions();
        services.AddHttpClient<MeilisearchService>(client =>
        {
            client.BaseAddress = new Uri(meilisearchOptions.BaseUrl);
            client.Timeout = TimeSpan.FromSeconds(meilisearchOptions.TimeoutSeconds);
            if (!string.IsNullOrEmpty(meilisearchOptions.ApiKey))
                client.DefaultRequestHeaders.Authorization =
                    new System.Net.Http.Headers.AuthenticationHeaderValue(
                        "Bearer", meilisearchOptions.ApiKey);
        });

        // Registration Policy Engine
        services.AddSingleton<IIdentityVerificationProvider, MockIdentityVerificationProvider>();
        services.AddSingleton<IIdentityVerificationProvider, StripeIdentityProvider>();
        services.AddSingleton<IIdentityVerificationProvider, VeriffIdentityProvider>();
        services.AddSingleton<IIdentityVerificationProvider, OnfidoIdentityProvider>();
        services.AddSingleton<IIdentityVerificationProvider, JumioIdentityProvider>();
        services.AddSingleton<IIdentityVerificationProvider, IdenfyIdentityProvider>();
        services.AddSingleton<IdentityVerificationProviderFactory>();
        services.AddSingleton<ProviderConfigEncryption>();
        services.AddScoped<RegistrationOrchestrator>();

        // AI services
        services.AddScoped<AiService>();
        services.AddScoped<ContentModerationService>();
        services.AddScoped<AiNotificationService>();

        // Real-time messaging (SignalR)
        services.AddSignalR();
        services.AddSingleton<IUserConnectionService, UserConnectionService>();
        services.AddScoped<IRealTimeMessagingService, RealTimeMessagingService>();

        // Event publishing (RabbitMQ)
        services.AddEventPublishing(configuration);

        // Llama AI service — typed HttpClient with Polly resilience policies
        services.Configure<LlamaServiceOptions>(
            configuration.GetSection(LlamaServiceOptions.SectionName));
        var llamaOptions = configuration
            .GetSection(LlamaServiceOptions.SectionName)
            .Get<LlamaServiceOptions>() ?? new LlamaServiceOptions();

        services.AddHttpClient<ILlamaClient, LlamaClient>(client =>
        {
            client.BaseAddress = new Uri(llamaOptions.BaseUrl);
            client.Timeout = TimeSpan.FromSeconds(llamaOptions.TimeoutSeconds);
        })
        .AddPolicyHandler(HttpPolicyExtensions
            .HandleTransientHttpError()
            .WaitAndRetryAsync(
                llamaOptions.MaxRetries,
                attempt => TimeSpan.FromSeconds(Math.Pow(2, attempt)),
                onRetry: (outcome, timespan, retryAttempt, context) =>
                {
                    var logger = context.GetLogger();
                    logger?.LogWarning(
                        "Llama request failed with {StatusCode}. Retry {RetryAttempt} after {Delay}ms",
                        outcome.Result?.StatusCode,
                        retryAttempt,
                        timespan.TotalMilliseconds);
                }))
        .AddPolicyHandler((svcProvider, _) =>
        {
            var logger = svcProvider.GetService<ILogger<LlamaClient>>();
            return HttpPolicyExtensions
                .HandleTransientHttpError()
                .CircuitBreakerAsync(
                    llamaOptions.CircuitBreakerFailures,
                    TimeSpan.FromSeconds(llamaOptions.CircuitBreakerDurationSeconds),
                    onBreak: (outcome, timespan) =>
                    {
                        logger?.LogWarning(
                            "Llama circuit breaker opened for {Duration}s. Reason: {StatusCode}",
                            timespan.TotalSeconds,
                            outcome.Result?.StatusCode);
                    },
                    onReset: () =>
                    {
                        logger?.LogInformation("Llama circuit breaker reset");
                    });
        });

        return services;
    }
}
