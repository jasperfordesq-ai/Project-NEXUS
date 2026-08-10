// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Net;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace Nexus.Api.Middleware;

/// <summary>
/// Single source of truth for a named safeguarding-vetting fixed-window
/// policy. Registration and focused contract tests resolve the same keys and
/// defaults so a configuration rename cannot silently change the API limit.
/// </summary>
public sealed record SafeguardingVettingRateLimitContract(
    string PolicyName,
    string PermitLimitConfigurationKey,
    int DefaultPermitLimit,
    string WindowSecondsConfigurationKey,
    int DefaultWindowSeconds)
{
    public int ResolvePermitLimit(IConfiguration configuration)
        => configuration.GetValue(PermitLimitConfigurationKey, DefaultPermitLimit);

    public TimeSpan ResolveWindow(IConfiguration configuration)
        => TimeSpan.FromSeconds(configuration.GetValue(
            WindowSecondsConfigurationKey,
            DefaultWindowSeconds));
}

/// <summary>
/// Configuration for rate limiting policies.
/// Protects against brute-force attacks on auth endpoints.
/// </summary>
public static class RateLimitingExtensions
{
    public const string AuthPolicy = "auth";
    public const string GeneralPolicy = "general";
    public const string AtomicNotificationSettingsPolicy = "atomic-notification-settings";
    public const string PodcastArtworkPolicy = "podcast-artwork";
    public const string AiPolicy = "Ai";
    public const string AiProviderTestPolicy = "ai-provider-test";
    public const string VolunteerWellbeingAlertsPolicy = "volunteer-wellbeing-alerts";
    public const string VolunteerWellbeingAlertUpdatePolicy = "volunteer-wellbeing-alert-update";
    public const string GuardianConsentListPolicy = "guardian-consent-list";
    public const string GuardianConsentRequestPolicy = "guardian-consent-request";
    public const string GuardianConsentVerifyPolicy = "guardian-consent-verify";
    public const string GuardianConsentVerifyLookupPolicy = "guardian-consent-verify-lookup";
    public const string GuardianConsentWithdrawPolicy = "guardian-consent-withdraw";
    public const string RecurringPatternListPolicy = "volunteering-recurring-pattern-list";
    public const string RecurringPatternCreatePolicy = "volunteering-recurring-pattern-create";
    public const string RecurringPatternUpdatePolicy = "volunteering-recurring-pattern-update";
    public const string RecurringPatternDeletePolicy = "volunteering-recurring-pattern-delete";
    public const string VolunteerOrganisationCreatePolicy = "volunteering-organisation-create";
    public const string VolunteerOrganisationListPolicy = "volunteering-organisation-list";
    public const string VolunteerOpportunityDeletePolicy = "volunteering-opportunity-delete";
    public const string VolunteerOrganisationWalletReadPolicy = "volunteering-organisation-wallet-read";
    public const string VolunteerOrganisationWalletDepositPolicy = "volunteering-organisation-wallet-deposit";
    public const string VolunteerOrganisationWalletAdminAdjustPolicy = "volunteering-organisation-wallet-admin-adjust";
    public const string VolunteerAttendanceTokenPolicy = "volunteering-attendance-token";
    public const string VolunteerAttendanceVerifyPolicy = "volunteering-attendance-verify";
    public const string VolunteerAttendanceCheckoutPolicy = "volunteering-attendance-checkout";
    public const string VolunteerAttendanceRosterPolicy = "volunteering-attendance-roster";
    public const string VolunteerHoursListPolicy = "volunteering-hours-list";
    public const string VolunteerHoursLogPolicy = "volunteering-hours-log";
    public const string VolunteerHoursSummaryPolicy = "volunteering-hours-summary";
    public const string VolunteerHoursPendingReviewPolicy = "volunteering-hours-pending-review";
    public const string VolunteerHoursOrganisationPendingPolicy = "volunteering-hours-organisation-pending";
    public const string VolunteerHoursVerifyPolicy = "volunteering-hours-verify";
    public const string VolunteerSwapListPolicy = "volunteering-swap-list";
    public const string VolunteerSwapRequestPolicy = "volunteering-swap-request";
    public const string VolunteerSwapRespondPolicy = "volunteering-swap-respond";
    public const string VolunteerSwapCancelPolicy = "volunteering-swap-cancel";
    public const string VolunteerSwapAdminListPolicy = "volunteering-swap-admin-list";
    public const string VolunteerSwapAdminDecidePolicy = "volunteering-swap-admin-decide";
    public const string PersonalWalletTransferPolicy = "personal-wallet-transfer";
    public const string PersonalWalletUserSearchPolicy = "personal-wallet-user-search";
    public const string SafeguardingVettingPolicyUpdatePolicy = "safeguarding-vetting-policy-update";
    public const string SafeguardingVettingPolicyRotationPolicy = "safeguarding-vetting-policy-rotation";
    public const string SafeguardingVettingDecisionPolicy = "safeguarding-vetting-decision";
    public const string SafeguardingVettingMemberMutationPolicy = "safeguarding-vetting-member-mutation";
    public const string SafeguardingOnboardingMutationPolicy = "safeguarding-onboarding-mutation";
    public const string SafeguardingOptionMutationPolicy = "safeguarding-option-mutation";
    public const string MessagesRestrictionStatusPolicy = "messages-restriction-status";
    public const string MessagesEditPolicy = "messages-edit";
    public const string MessagesDeletePolicy = "messages-delete";
    public const string MessagesArchivePolicy = "messages-archive";
    public const string MessagesRestorePolicy = "messages-restore";
    public const string MessagesRequestCoordinatorPolicy = "messages-request-coordinator";
    public const string MessagesReactionPolicy = "messages-reaction";
    public const string MessagesReactionBatchPolicy = "messages-reaction-batch";
    public const string MessagesTypingPolicy = "messages-typing";
    public const string MessagesMarkReadPolicy = "messages-mark-read";
    public const string MessagesUnreadCountPolicy = "messages-unread-count";
    public const string WebAuthnSecurityConfirmPolicy = "webauthn-security-confirm";
    public const string PwaManifestPolicy = "pwa-manifest";
    public const string EventRegistrationReadPolicy = "event-registration-read";
    public const string EventRegistrationMutationPolicy = "event-registration-mutation";
    public const string EventRegistrationSubmissionPolicy = "event-registration-submission";
    public const string EventRegistrationAnswerReadPolicy = "event-registration-answer-read";
    public const string EventRegistrationRestrictedPolicy = "event-registration-restricted";
    public const string EventRegistrationRetentionApplyPolicy = "event-registration-retention-apply";
    public const string EventPublicationPolicy = "events-publish";
    public const string EventRecurrenceReadPolicy = "events-recurrence-read";
    public const string EventRecurrencePreviewPolicy = "events-recurrence-preview";
    public const string EventRecurrenceCommitPolicy = "events-recurrence-commit";
    public const string MarketplacePaymentCreatePolicy = "marketplace-payment-create";
    public const string MarketplacePaymentConfirmPolicy = "marketplace-payment-confirm";
    public const string MarketplacePaymentReadPolicy = "marketplace-payment-read";
    public const string MarketplaceSellerOnboardPolicy = "marketplace-seller-onboard";

    public static IReadOnlyList<SafeguardingVettingRateLimitContract> SafeguardingVettingRateLimitContracts { get; } =
    [
        new(
            SafeguardingVettingPolicyUpdatePolicy,
            "RateLimiting:SafeguardingVetting:PolicyUpdatePermitLimit",
            20,
            "RateLimiting:SafeguardingVetting:PolicyUpdateWindowSeconds",
            60),
        new(
            SafeguardingVettingPolicyRotationPolicy,
            "RateLimiting:SafeguardingVetting:PolicyRotationPermitLimit",
            5,
            "RateLimiting:SafeguardingVetting:PolicyRotationWindowSeconds",
            60),
        new(
            SafeguardingVettingDecisionPolicy,
            "RateLimiting:SafeguardingVetting:DecisionPermitLimit",
            60,
            "RateLimiting:SafeguardingVetting:DecisionWindowSeconds",
            60),
        new(
            SafeguardingVettingMemberMutationPolicy,
            "RateLimiting:SafeguardingVetting:MemberMutationPermitLimit",
            10,
            "RateLimiting:SafeguardingVetting:MemberMutationWindowSeconds",
            60),
        new(
            SafeguardingOnboardingMutationPolicy,
            "RateLimiting:SafeguardingVetting:OnboardingPermitLimit",
            5,
            "RateLimiting:SafeguardingVetting:OnboardingWindowSeconds",
            60),
        new(
            SafeguardingOptionMutationPolicy,
            "RateLimiting:SafeguardingVetting:OptionMutationPermitLimit",
            60,
            "RateLimiting:SafeguardingVetting:OptionMutationWindowSeconds",
            60)
    ];

    // Known trusted proxy IPs/networks (configure via appsettings in production)
    // These are common Docker/Kubernetes internal network ranges
    private static readonly string[] DefaultTrustedProxies = new[]
    {
        "10.0.0.0/8",      // Private network (Docker default)
        "172.16.0.0/12",   // Private network (Docker bridge)
        "192.168.0.0/16",  // Private network
        "127.0.0.1",       // Localhost
        "::1",             // IPv6 localhost
    };

    public static IServiceCollection AddRateLimitingPolicies(this IServiceCollection services, IConfiguration config)
    {
        // Get trusted proxy networks from config, or use defaults
        var trustedProxies = config.GetSection("RateLimiting:TrustedProxies").Get<string[]>()
            ?? DefaultTrustedProxies;

        services.AddRateLimiter(options =>
        {
            // Global limiter as fallback
            options.GlobalLimiter = PartitionedRateLimiter.Create<HttpContext, string>(context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetClientIdentifier(context, trustedProxies),
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        AutoReplenishment = true,
                        PermitLimit = config.GetValue("RateLimiting:General:PermitLimit", 100),
                        Window = TimeSpan.FromSeconds(config.GetValue("RateLimiting:General:WindowSeconds", 60))
                    }));

            // Strict policy for auth endpoints (login, register, forgot-password)
            options.AddPolicy(AuthPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetClientIdentifier(context, trustedProxies),
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        AutoReplenishment = true,
                        PermitLimit = config.GetValue("RateLimiting:Auth:PermitLimit", 5),
                        Window = TimeSpan.FromSeconds(config.GetValue("RateLimiting:Auth:WindowSeconds", 60)),
                        QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                        QueueLimit = 0 // No queuing - reject immediately
                    }));

            // General API policy
            options.AddPolicy(GeneralPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetClientIdentifier(context, trustedProxies),
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        AutoReplenishment = true,
                        PermitLimit = config.GetValue("RateLimiting:General:PermitLimit", 100),
                        Window = TimeSpan.FromSeconds(config.GetValue("RateLimiting:General:WindowSeconds", 60))
                    }));

            options.AddPolicy(AtomicNotificationSettingsPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:AtomicNotificationSettings:PermitLimit", 10),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:AtomicNotificationSettings:WindowSeconds", 60)))));

            options.AddPolicy(PodcastArtworkPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:PodcastArtwork:PermitLimit", 10),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:PodcastArtwork:WindowSeconds", 60)))));

            // Laravel assigns independent authenticated one-minute buckets to
            // the Event Registration Product route groups. Keeping the buckets
            // separate prevents a high-volume attendee read from consuming an
            // organizer mutation, export, or retention allowance.
            AddAuthenticatedFixedWindowPolicy(
                options, EventRegistrationReadPolicy, config, trustedProxies,
                "RateLimiting:EventRegistration:ReadPermitLimit", 120);
            AddAuthenticatedFixedWindowPolicy(
                options, EventRegistrationMutationPolicy, config, trustedProxies,
                "RateLimiting:EventRegistration:MutationPermitLimit", 20);
            AddAuthenticatedFixedWindowPolicy(
                options, EventRegistrationSubmissionPolicy, config, trustedProxies,
                "RateLimiting:EventRegistration:SubmissionPermitLimit", 30);
            AddAuthenticatedFixedWindowPolicy(
                options, EventRegistrationAnswerReadPolicy, config, trustedProxies,
                "RateLimiting:EventRegistration:AnswerReadPermitLimit", 60);
            AddAuthenticatedFixedWindowPolicy(
                options, EventRegistrationRestrictedPolicy, config, trustedProxies,
                "RateLimiting:EventRegistration:RestrictedPermitLimit", 10);
            AddAuthenticatedFixedWindowPolicy(
                options, EventRegistrationRetentionApplyPolicy, config, trustedProxies,
                "RateLimiting:EventRegistration:RetentionApplyPermitLimit", 5);
            AddAuthenticatedFixedWindowPolicy(
                options, EventPublicationPolicy, config, trustedProxies,
                "RateLimiting:Events:PublishPermitLimit", 10);
            AddAuthenticatedFixedWindowPolicy(
                options, EventRecurrenceReadPolicy, config, trustedProxies,
                "RateLimiting:Events:RecurrenceReadPermitLimit", 60);
            AddAuthenticatedFixedWindowPolicy(
                options, MarketplacePaymentCreatePolicy, config, trustedProxies,
                "RateLimiting:Marketplace:PaymentCreatePermitLimit", 10);
            AddAuthenticatedFixedWindowPolicy(
                options, MarketplacePaymentConfirmPolicy, config, trustedProxies,
                "RateLimiting:Marketplace:PaymentConfirmPermitLimit", 10);
            AddAuthenticatedFixedWindowPolicy(
                options, MarketplacePaymentReadPolicy, config, trustedProxies,
                "RateLimiting:Marketplace:PaymentReadPermitLimit", 30);
            AddAuthenticatedFixedWindowPolicy(
                options, MarketplaceSellerOnboardPolicy, config, trustedProxies,
                "RateLimiting:Marketplace:SellerOnboardPermitLimit", 5);
            AddAuthenticatedFixedWindowPolicy(
                options, EventRecurrencePreviewPolicy, config, trustedProxies,
                "RateLimiting:Events:RecurrencePreviewPermitLimit", 30);
            AddAuthenticatedFixedWindowPolicy(
                options, EventRecurrenceCommitPolicy, config, trustedProxies,
                "RateLimiting:Events:RecurrenceCommitPermitLimit", 10);

            // Laravel uses an independent authenticated 30/minute bucket for
            // the live messaging restriction-status read.
            options.AddPolicy(MessagesRestrictionStatusPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:Messages:RestrictionStatusPermitLimit", 30),
                        TimeSpan.FromSeconds(config.GetValue(
                            "RateLimiting:Messages:RestrictionStatusWindowSeconds",
                            60)))));

            options.AddPolicy(MessagesEditPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:Messages:EditPermitLimit", 30),
                        TimeSpan.FromSeconds(config.GetValue(
                            "RateLimiting:Messages:EditWindowSeconds",
                            60)))));

            options.AddPolicy(MessagesDeletePolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:Messages:DeletePermitLimit", 20),
                        TimeSpan.FromSeconds(config.GetValue(
                            "RateLimiting:Messages:DeleteWindowSeconds",
                            60)))));

            options.AddPolicy(MessagesArchivePolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:Messages:ArchivePermitLimit", 10),
                        TimeSpan.FromSeconds(config.GetValue(
                            "RateLimiting:Messages:ArchiveWindowSeconds",
                            60)))));

            options.AddPolicy(MessagesRestorePolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:Messages:RestorePermitLimit", 20),
                        TimeSpan.FromSeconds(config.GetValue(
                            "RateLimiting:Messages:RestoreWindowSeconds",
                            60)))));

            options.AddPolicy(MessagesRequestCoordinatorPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:Messages:RequestCoordinatorPermitLimit", 5),
                        TimeSpan.FromSeconds(config.GetValue(
                            "RateLimiting:Messages:RequestCoordinatorWindowSeconds",
                            300)))));

            options.AddPolicy(MessagesReactionPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:Messages:ReactionPermitLimit", 60),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:Messages:ReactionWindowSeconds", 60)))));

            options.AddPolicy(MessagesReactionBatchPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:Messages:ReactionBatchPermitLimit", 30),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:Messages:ReactionBatchWindowSeconds", 60)))));

            options.AddPolicy(MessagesTypingPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:Messages:TypingPermitLimit", 60),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:Messages:TypingWindowSeconds", 60)))));

            // Laravel keeps these reads in separate authenticated 60/minute
            // buckets so badge polling cannot consume conversation read writes.
            options.AddPolicy(MessagesMarkReadPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:Messages:MarkReadPermitLimit", 60),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:Messages:MarkReadWindowSeconds", 60)))));

            options.AddPolicy(MessagesUnreadCountPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:Messages:UnreadCountPermitLimit", 60),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:Messages:UnreadCountWindowSeconds", 60)))));

            options.AddPolicy(WebAuthnSecurityConfirmPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:WebAuthn:SecurityConfirmPermitLimit", 10),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:WebAuthn:SecurityConfirmWindowSeconds", 600)))));

            options.AddPolicy(PwaManifestPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:PwaManifest:PermitLimit", 60),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:PwaManifest:WindowSeconds", 60)))));

            // AI endpoints policy (more restrictive due to resource cost)
            options.AddPolicy(AiPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetClientIdentifier(context, trustedProxies),
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        AutoReplenishment = true,
                        PermitLimit = config.GetValue("RateLimiting:Ai:PermitLimit", 10),
                        Window = TimeSpan.FromSeconds(config.GetValue("RateLimiting:Ai:WindowSeconds", 60)),
                        QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                        QueueLimit = 5 // Allow some queuing for AI requests
                    }));

            // Provider connectivity tests can trigger paid or resource-intensive
            // upstream calls. Laravel limits these to 10 attempts per user/minute.
            options.AddPolicy(AiProviderTestPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        AutoReplenishment = true,
                        PermitLimit = 10,
                        Window = TimeSpan.FromSeconds(60),
                        QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                        QueueLimit = 0
                    }));

            // Laravel uses independent 30/minute buckets for listing and updating
            // coordinator wellbeing alerts.
            options.AddPolicy(VolunteerWellbeingAlertsPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        AutoReplenishment = true,
                        PermitLimit = 30,
                        Window = TimeSpan.FromSeconds(60),
                        QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                        QueueLimit = 0
                    }));

            options.AddPolicy(VolunteerWellbeingAlertUpdatePolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => new FixedWindowRateLimiterOptions
                    {
                        AutoReplenishment = true,
                        PermitLimit = 30,
                        Window = TimeSpan.FromSeconds(60),
                        QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
                        QueueLimit = 0
                    }));

            options.AddPolicy(GuardianConsentListPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:GuardianConsent:ListPermitLimit", 30),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:GuardianConsent:ListWindowSeconds", 60)))));

            options.AddPolicy(GuardianConsentRequestPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:GuardianConsent:RequestPermitLimit", 5),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:GuardianConsent:RequestWindowSeconds", 60)))));

            options.AddPolicy(GuardianConsentVerifyPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:GuardianConsent:VerifyPermitLimit", 10),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:GuardianConsent:VerifyWindowSeconds", 300)))));

            options.AddPolicy(GuardianConsentVerifyLookupPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:GuardianConsent:VerifyLookupPermitLimit", 20),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:GuardianConsent:VerifyLookupWindowSeconds", 300)))));

            options.AddPolicy(GuardianConsentWithdrawPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:GuardianConsent:WithdrawPermitLimit", 10),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:GuardianConsent:WithdrawWindowSeconds", 60)))));

            // Laravel throttles these authenticated workflows per user. Keep
            // separate named buckets because policy configuration, rotation,
            // broker decisions, and member requests have different ceilings.
            foreach (var contract in SafeguardingVettingRateLimitContracts)
            {
                options.AddPolicy(contract.PolicyName, context =>
                    RateLimitPartition.GetFixedWindowLimiter(
                        partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                        factory: _ => FixedWindow(
                            contract.ResolvePermitLimit(config),
                            contract.ResolveWindow(config))));
            }

            options.AddPolicy(RecurringPatternListPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:RecurringPattern:ListPermitLimit", 60),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:RecurringPattern:ListWindowSeconds", 60)))));

            options.AddPolicy(RecurringPatternCreatePolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:RecurringPattern:CreatePermitLimit", 10),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:RecurringPattern:CreateWindowSeconds", 60)))));

            options.AddPolicy(RecurringPatternUpdatePolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:RecurringPattern:UpdatePermitLimit", 10),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:RecurringPattern:UpdateWindowSeconds", 60)))));

            options.AddPolicy(RecurringPatternDeletePolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:RecurringPattern:DeletePermitLimit", 10),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:RecurringPattern:DeleteWindowSeconds", 60)))));

            options.AddPolicy(VolunteerOrganisationCreatePolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:VolunteerOrganisation:CreatePermitLimit", 5),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:VolunteerOrganisation:CreateWindowSeconds", 60)))));

            options.AddPolicy(VolunteerOrganisationListPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:VolunteerOrganisation:ListPermitLimit", 60),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:VolunteerOrganisation:ListWindowSeconds", 60)))));

            options.AddPolicy(VolunteerOpportunityDeletePolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:VolunteerOpportunity:DeletePermitLimit", 10),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:VolunteerOpportunity:DeleteWindowSeconds", 60)))));

            options.AddPolicy(VolunteerOrganisationWalletReadPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:VolunteerOrganisationWallet:ReadPermitLimit", 60),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:VolunteerOrganisationWallet:ReadWindowSeconds", 60)))));

            options.AddPolicy(VolunteerOrganisationWalletDepositPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:VolunteerOrganisationWallet:DepositPermitLimit", 10),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:VolunteerOrganisationWallet:DepositWindowSeconds", 60)))));

            options.AddPolicy(VolunteerOrganisationWalletAdminAdjustPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:VolunteerOrganisationWallet:AdminAdjustPermitLimit", 20),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:VolunteerOrganisationWallet:AdminAdjustWindowSeconds", 60)))));

            options.AddPolicy(VolunteerAttendanceTokenPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:VolunteerAttendance:TokenPermitLimit", 60),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:VolunteerAttendance:TokenWindowSeconds", 60)))));

            options.AddPolicy(VolunteerAttendanceVerifyPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:VolunteerAttendance:VerifyPermitLimit", 30),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:VolunteerAttendance:VerifyWindowSeconds", 60)))));

            options.AddPolicy(VolunteerAttendanceCheckoutPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:VolunteerAttendance:CheckoutPermitLimit", 30),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:VolunteerAttendance:CheckoutWindowSeconds", 60)))));

            options.AddPolicy(VolunteerAttendanceRosterPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:VolunteerAttendance:RosterPermitLimit", 60),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:VolunteerAttendance:RosterWindowSeconds", 60)))));

            options.AddPolicy(VolunteerHoursListPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:VolunteerHours:ListPermitLimit", 60),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:VolunteerHours:ListWindowSeconds", 60)))));

            options.AddPolicy(VolunteerHoursLogPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:VolunteerHours:LogPermitLimit", 20),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:VolunteerHours:LogWindowSeconds", 60)))));

            options.AddPolicy(VolunteerHoursSummaryPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:VolunteerHours:SummaryPermitLimit", 60),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:VolunteerHours:SummaryWindowSeconds", 60)))));

            options.AddPolicy(VolunteerHoursPendingReviewPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:VolunteerHours:PendingReviewPermitLimit", 60),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:VolunteerHours:PendingReviewWindowSeconds", 60)))));

            options.AddPolicy(VolunteerHoursOrganisationPendingPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:VolunteerHours:OrganisationPendingPermitLimit", 60),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:VolunteerHours:OrganisationPendingWindowSeconds", 60)))));

            options.AddPolicy(VolunteerHoursVerifyPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:VolunteerHours:VerifyPermitLimit", 30),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:VolunteerHours:VerifyWindowSeconds", 60)))));

            options.AddPolicy(VolunteerSwapListPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:VolunteerSwap:ListPermitLimit", 60),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:VolunteerSwap:ListWindowSeconds", 60)))));

            options.AddPolicy(VolunteerSwapRequestPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:VolunteerSwap:RequestPermitLimit", 10),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:VolunteerSwap:RequestWindowSeconds", 60)))));

            options.AddPolicy(VolunteerSwapRespondPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:VolunteerSwap:RespondPermitLimit", 20),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:VolunteerSwap:RespondWindowSeconds", 60)))));

            options.AddPolicy(VolunteerSwapCancelPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:VolunteerSwap:CancelPermitLimit", 20),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:VolunteerSwap:CancelWindowSeconds", 60)))));

            options.AddPolicy(VolunteerSwapAdminListPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:VolunteerSwap:AdminListPermitLimit", 60),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:VolunteerSwap:AdminListWindowSeconds", 60)))));

            options.AddPolicy(VolunteerSwapAdminDecidePolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:VolunteerSwap:AdminDecidePermitLimit", 20),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:VolunteerSwap:AdminDecideWindowSeconds", 60)))));

            options.AddPolicy(PersonalWalletTransferPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:PersonalWallet:TransferPermitLimit", 10),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:PersonalWallet:TransferWindowSeconds", 60)))));

            options.AddPolicy(PersonalWalletUserSearchPolicy, context =>
                RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                    factory: _ => FixedWindow(
                        config.GetValue("RateLimiting:PersonalWallet:UserSearchPermitLimit", 30),
                        TimeSpan.FromSeconds(config.GetValue("RateLimiting:PersonalWallet:UserSearchWindowSeconds", 60)))));

            // Custom rejection response
            options.OnRejected = async (context, cancellationToken) =>
            {
                context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
                context.HttpContext.Response.ContentType = "application/json";

                var retryAfter = context.Lease.TryGetMetadata(MetadataName.RetryAfter, out var retryAfterValue)
                    ? retryAfterValue.TotalSeconds
                    : 60;

                context.HttpContext.Response.Headers.RetryAfter = retryAfter.ToString("0");

                var path = context.HttpContext.Request.Path;
                var isGuardianConsentPath =
                    path.StartsWithSegments("/api/v2/volunteering/guardian-consents")
                    || path.StartsWithSegments("/api/volunteering/guardian-consents");
                var isRecurringPatternPath =
                    path.Value?.Contains("/volunteering/", StringComparison.OrdinalIgnoreCase) == true
                    && path.Value.Contains("/recurring-patterns", StringComparison.OrdinalIgnoreCase);
                var isVolunteerOrganisationCreatePath =
                    context.HttpContext.Request.Method == "POST"
                    && (string.Equals(
                            path.Value?.TrimEnd('/'),
                            "/api/v2/volunteering/organisations",
                            StringComparison.OrdinalIgnoreCase)
                        || string.Equals(
                            path.Value?.TrimEnd('/'),
                            "/api/volunteering/organisations",
                            StringComparison.OrdinalIgnoreCase));
                var isVolunteerOrganisationListPath =
                    context.HttpContext.Request.Method == "GET"
                    && (string.Equals(
                            path.Value?.TrimEnd('/'),
                            "/api/v2/volunteering/my-organisations",
                            StringComparison.OrdinalIgnoreCase)
                        || string.Equals(
                            path.Value?.TrimEnd('/'),
                            "/api/volunteering/my-organisations",
                            StringComparison.OrdinalIgnoreCase));
                var isVolunteerOrganisationWalletPath =
                    path.Value?.Contains("/volunteering/organisations/", StringComparison.OrdinalIgnoreCase) == true
                    && path.Value.EndsWith("/wallet", StringComparison.OrdinalIgnoreCase);
                var isVolunteerOrganisationWalletTransactionsPath =
                    path.Value?.Contains("/volunteering/organisations/", StringComparison.OrdinalIgnoreCase) == true
                    && path.Value.EndsWith("/wallet/transactions", StringComparison.OrdinalIgnoreCase);
                var isVolunteerOrganisationWalletDepositPath =
                    HttpMethods.IsPost(context.HttpContext.Request.Method)
                    && path.Value?.Contains("/volunteering/organisations/", StringComparison.OrdinalIgnoreCase) == true
                    && path.Value.EndsWith("/wallet/deposit", StringComparison.OrdinalIgnoreCase);
                var isVolunteerOrganisationWalletAdminAdjustPath =
                    HttpMethods.IsPut(context.HttpContext.Request.Method)
                    && path.Value?.Contains("/admin/volunteering/organizations/", StringComparison.OrdinalIgnoreCase) == true
                    && path.Value.EndsWith("/wallet/adjust", StringComparison.OrdinalIgnoreCase);
                var isPersonalWalletTransferPath = HttpMethods.IsPost(context.HttpContext.Request.Method)
                    && string.Equals(
                        path.Value?.TrimEnd('/'),
                        "/api/v2/wallet/transfer",
                        StringComparison.OrdinalIgnoreCase);
                var isVolunteerAttendancePath =
                    path.Value?.Contains("/volunteering/", StringComparison.OrdinalIgnoreCase) == true
                    && (path.Value.Contains("/checkin/verify/", StringComparison.OrdinalIgnoreCase)
                        || path.Value.Contains("/checkin/checkout/", StringComparison.OrdinalIgnoreCase)
                        || (path.Value.Contains("/volunteering/shifts/", StringComparison.OrdinalIgnoreCase)
                            && (path.Value.EndsWith("/checkin", StringComparison.OrdinalIgnoreCase)
                                || path.Value.EndsWith("/checkins", StringComparison.OrdinalIgnoreCase))));
                var normalizedPath = path.Value?.TrimEnd('/');
                var isVolunteerHoursOrganisationPendingPath =
                    normalizedPath?.Contains(
                        "/volunteering/organisations/",
                        StringComparison.OrdinalIgnoreCase) == true
                    && normalizedPath.EndsWith(
                        "/hours/pending",
                        StringComparison.OrdinalIgnoreCase);
                var isVolunteerHoursPath =
                    normalizedPath?.StartsWith(
                        "/api/v2/volunteering/hours",
                        StringComparison.OrdinalIgnoreCase) == true
                    || normalizedPath?.StartsWith(
                        "/api/volunteering/hours",
                        StringComparison.OrdinalIgnoreCase) == true
                    || isVolunteerHoursOrganisationPendingPath;
                var isVolunteerSwapAdminPath =
                    normalizedPath?.StartsWith(
                        "/api/v2/volunteering/admin/swaps",
                        StringComparison.OrdinalIgnoreCase) == true
                    || normalizedPath?.StartsWith(
                        "/api/volunteering/admin/swaps",
                        StringComparison.OrdinalIgnoreCase) == true;
                var isVolunteerSwapMemberPath =
                    normalizedPath?.StartsWith(
                        "/api/v2/volunteering/swaps",
                        StringComparison.OrdinalIgnoreCase) == true
                    || normalizedPath?.StartsWith(
                        "/api/volunteering/swaps",
                        StringComparison.OrdinalIgnoreCase) == true;
                var isVolunteerSwapPath =
                    isVolunteerSwapAdminPath || isVolunteerSwapMemberPath;
                var isSafeguardingVettingPolicyUpdatePath =
                    HttpMethods.IsPut(context.HttpContext.Request.Method)
                    && string.Equals(
                        normalizedPath,
                        "/api/v2/admin/vetting/policy",
                        StringComparison.OrdinalIgnoreCase);
                var isSafeguardingVettingPolicyRotationPath =
                    HttpMethods.IsPost(context.HttpContext.Request.Method)
                    && string.Equals(
                        normalizedPath,
                        "/api/v2/admin/vetting/policy/rotate",
                        StringComparison.OrdinalIgnoreCase);
                var isSafeguardingVettingDecisionPath =
                    HttpMethods.IsPost(context.HttpContext.Request.Method)
                    && ((normalizedPath?.StartsWith(
                            "/api/v2/admin/vetting/user/",
                            StringComparison.OrdinalIgnoreCase) == true
                        && (normalizedPath.EndsWith("/confirm", StringComparison.OrdinalIgnoreCase)
                            || normalizedPath.EndsWith("/revoke", StringComparison.OrdinalIgnoreCase)))
                        || (normalizedPath?.StartsWith(
                                "/api/v2/admin/vetting/reviews/",
                                StringComparison.OrdinalIgnoreCase) == true
                            && normalizedPath.EndsWith("/resolve", StringComparison.OrdinalIgnoreCase)));
                var isSafeguardingVettingMemberMutationPath =
                    HttpMethods.IsPost(context.HttpContext.Request.Method)
                    && (string.Equals(
                            normalizedPath,
                            "/api/v2/safeguarding/confirm-policy-review",
                            StringComparison.OrdinalIgnoreCase)
                        || string.Equals(
                            normalizedPath,
                            "/api/v2/safeguarding/vetting-review-request",
                            StringComparison.OrdinalIgnoreCase));
                var isSafeguardingOnboardingMutationPath =
                    HttpMethods.IsPost(context.HttpContext.Request.Method)
                    && string.Equals(
                        normalizedPath,
                        "/api/v2/onboarding/safeguarding",
                        StringComparison.OrdinalIgnoreCase);
                var isSafeguardingOptionMutationPath =
                    (HttpMethods.IsPost(context.HttpContext.Request.Method)
                        || HttpMethods.IsPut(context.HttpContext.Request.Method)
                        || HttpMethods.IsDelete(context.HttpContext.Request.Method))
                    && (normalizedPath?.StartsWith(
                            "/api/v2/admin/safeguarding/options",
                            StringComparison.OrdinalIgnoreCase) == true
                        || normalizedPath?.StartsWith(
                            "/api/admin/safeguarding/options",
                            StringComparison.OrdinalIgnoreCase) == true);
                var isMessageRestrictionStatusPath =
                    HttpMethods.IsGet(context.HttpContext.Request.Method)
                    && (string.Equals(
                            normalizedPath,
                            "/api/messages/restriction-status",
                            StringComparison.OrdinalIgnoreCase)
                        || string.Equals(
                            normalizedPath,
                            "/api/v2/messages/restriction-status",
                            StringComparison.OrdinalIgnoreCase));
                var isMessageEditPath =
                    HttpMethods.IsPut(context.HttpContext.Request.Method)
                    && IsDirectMessageItemPath(normalizedPath);
                var isMessageDeletePath =
                    HttpMethods.IsDelete(context.HttpContext.Request.Method)
                    && IsDirectMessageItemPath(normalizedPath);
                var isMessageArchivePath =
                    HttpMethods.IsDelete(context.HttpContext.Request.Method)
                    && IsDirectConversationArchivePath(normalizedPath);
                var isMessageRestorePath =
                    HttpMethods.IsPost(context.HttpContext.Request.Method)
                    && IsDirectConversationRestorePath(normalizedPath);
                var isSafeguardingVettingMutationPath =
                    isSafeguardingVettingPolicyUpdatePath
                    || isSafeguardingVettingPolicyRotationPath
                    || isSafeguardingVettingDecisionPath
                    || isSafeguardingVettingMemberMutationPath
                    || isSafeguardingOptionMutationPath;

                if (isSafeguardingOnboardingMutationPath)
                {
                    await context.HttpContext.Response.WriteAsJsonAsync(new
                    {
                        errors = new[]
                        {
                            new
                            {
                                code = "RATE_LIMIT_EXCEEDED",
                                message = "Rate limit exceeded. Please try again later."
                            }
                        }
                    }, cancellationToken);
                    return;
                }

                if (isSafeguardingVettingMutationPath)
                {
                    var retryAfterSeconds = Math.Max(1, (int)Math.Ceiling(retryAfter));
                    context.HttpContext.Response.Headers.RetryAfter = retryAfterSeconds.ToString();
                    context.HttpContext.Response.Headers["API-Version"] = "2.0";

                    var tenantId = context.HttpContext.User.FindFirst("tenant_id")?.Value;
                    if (!string.IsNullOrWhiteSpace(tenantId))
                    {
                        context.HttpContext.Response.Headers["X-Tenant-ID"] = tenantId;
                    }

                    await context.HttpContext.Response.WriteAsJsonAsync(new
                    {
                        errors = new[]
                        {
                            new
                            {
                                code = "rate_limited",
                                message = "Rate limit exceeded. Please try again later."
                            }
                        },
                        success = false,
                        retry_after = retryAfterSeconds
                    }, cancellationToken);
                    return;
                }

                var eventRegistrationPolicy = context.HttpContext.GetEndpoint()?
                    .Metadata.GetMetadata<EnableRateLimitingAttribute>()?.PolicyName;
                var eventRegistrationLimit = eventRegistrationPolicy switch
                {
                    EventRegistrationReadPolicy => config.GetValue("RateLimiting:EventRegistration:ReadPermitLimit", 120),
                    EventRegistrationMutationPolicy => config.GetValue("RateLimiting:EventRegistration:MutationPermitLimit", 20),
                    EventRegistrationSubmissionPolicy => config.GetValue("RateLimiting:EventRegistration:SubmissionPermitLimit", 30),
                    EventRegistrationAnswerReadPolicy => config.GetValue("RateLimiting:EventRegistration:AnswerReadPermitLimit", 60),
                    EventRegistrationRestrictedPolicy => config.GetValue("RateLimiting:EventRegistration:RestrictedPermitLimit", 10),
                    EventRegistrationRetentionApplyPolicy => config.GetValue("RateLimiting:EventRegistration:RetentionApplyPermitLimit", 5),
                    EventPublicationPolicy => config.GetValue("RateLimiting:Events:PublishPermitLimit", 10),
                    EventRecurrenceReadPolicy => config.GetValue("RateLimiting:Events:RecurrenceReadPermitLimit", 60),
                    EventRecurrencePreviewPolicy => config.GetValue("RateLimiting:Events:RecurrencePreviewPermitLimit", 30),
                    EventRecurrenceCommitPolicy => config.GetValue("RateLimiting:Events:RecurrenceCommitPermitLimit", 10),
                    _ => (int?)null
                };

                var canonicalLimit = eventRegistrationLimit
                    ?? (isVolunteerOrganisationCreatePath
                    ? config.GetValue("RateLimiting:VolunteerOrganisation:CreatePermitLimit", 5)
                    : isVolunteerOrganisationListPath
                    ? config.GetValue("RateLimiting:VolunteerOrganisation:ListPermitLimit", 60)
                    : isVolunteerOrganisationWalletDepositPath
                    ? config.GetValue("RateLimiting:VolunteerOrganisationWallet:DepositPermitLimit", 10)
                    : isVolunteerOrganisationWalletAdminAdjustPath
                    ? config.GetValue("RateLimiting:VolunteerOrganisationWallet:AdminAdjustPermitLimit", 20)
                    : isVolunteerOrganisationWalletPath || isVolunteerOrganisationWalletTransactionsPath
                    ? config.GetValue("RateLimiting:VolunteerOrganisationWallet:ReadPermitLimit", 60)
                    : isPersonalWalletTransferPath
                    ? config.GetValue("RateLimiting:PersonalWallet:TransferPermitLimit", 10)
                    : isMessageRestrictionStatusPath
                    ? config.GetValue("RateLimiting:Messages:RestrictionStatusPermitLimit", 30)
                    : isMessageEditPath
                    ? config.GetValue("RateLimiting:Messages:EditPermitLimit", 30)
                    : isMessageDeletePath
                    ? config.GetValue("RateLimiting:Messages:DeletePermitLimit", 20)
                    : isMessageArchivePath
                    ? config.GetValue("RateLimiting:Messages:ArchivePermitLimit", 10)
                    : isMessageRestorePath
                    ? config.GetValue("RateLimiting:Messages:RestorePermitLimit", 20)
                    : isVolunteerHoursPath
                    ? HttpMethods.IsPost(context.HttpContext.Request.Method)
                        ? config.GetValue("RateLimiting:VolunteerHours:LogPermitLimit", 20)
                        : HttpMethods.IsPut(context.HttpContext.Request.Method)
                            ? config.GetValue("RateLimiting:VolunteerHours:VerifyPermitLimit", 30)
                            : normalizedPath?.EndsWith("/summary", StringComparison.OrdinalIgnoreCase) == true
                                ? config.GetValue("RateLimiting:VolunteerHours:SummaryPermitLimit", 60)
                                : isVolunteerHoursOrganisationPendingPath
                                    ? config.GetValue("RateLimiting:VolunteerHours:OrganisationPendingPermitLimit", 60)
                                : normalizedPath?.Contains("/pending", StringComparison.OrdinalIgnoreCase) == true
                                    ? config.GetValue("RateLimiting:VolunteerHours:PendingReviewPermitLimit", 60)
                                    : config.GetValue("RateLimiting:VolunteerHours:ListPermitLimit", 60)
                    : isVolunteerSwapPath
                    ? isVolunteerSwapAdminPath
                        ? HttpMethods.IsGet(context.HttpContext.Request.Method)
                            ? config.GetValue("RateLimiting:VolunteerSwap:AdminListPermitLimit", 60)
                            : config.GetValue("RateLimiting:VolunteerSwap:AdminDecidePermitLimit", 20)
                        : context.HttpContext.Request.Method switch
                        {
                            "GET" => config.GetValue("RateLimiting:VolunteerSwap:ListPermitLimit", 60),
                            "POST" => config.GetValue("RateLimiting:VolunteerSwap:RequestPermitLimit", 10),
                            "PUT" => config.GetValue("RateLimiting:VolunteerSwap:RespondPermitLimit", 20),
                            "DELETE" => config.GetValue("RateLimiting:VolunteerSwap:CancelPermitLimit", 20),
                            _ => 20
                        }
                    : isVolunteerAttendancePath
                    ? path.Value?.Contains("/checkin/verify/", StringComparison.OrdinalIgnoreCase) == true
                        ? config.GetValue("RateLimiting:VolunteerAttendance:VerifyPermitLimit", 30)
                        : path.Value?.Contains("/checkin/checkout/", StringComparison.OrdinalIgnoreCase) == true
                            ? config.GetValue("RateLimiting:VolunteerAttendance:CheckoutPermitLimit", 30)
                            : path.Value?.EndsWith("/checkins", StringComparison.OrdinalIgnoreCase) == true
                                ? config.GetValue("RateLimiting:VolunteerAttendance:RosterPermitLimit", 60)
                                : config.GetValue("RateLimiting:VolunteerAttendance:TokenPermitLimit", 60)
                    : isRecurringPatternPath
                    ? context.HttpContext.Request.Method switch
                    {
                        "GET" => config.GetValue("RateLimiting:RecurringPattern:ListPermitLimit", 60),
                        "POST" => config.GetValue("RateLimiting:RecurringPattern:CreatePermitLimit", 10),
                        "PUT" => config.GetValue("RateLimiting:RecurringPattern:UpdatePermitLimit", 10),
                        "DELETE" => config.GetValue("RateLimiting:RecurringPattern:DeletePermitLimit", 10),
                        _ => 10
                    }
                    : isGuardianConsentPath
                    ? path.Value?.Contains("/verify/", StringComparison.OrdinalIgnoreCase) == true
                        ? config.GetValue("RateLimiting:GuardianConsent:VerifyPermitLimit", 10)
                        : context.HttpContext.Request.Method switch
                        {
                            "POST" => config.GetValue("RateLimiting:GuardianConsent:RequestPermitLimit", 5),
                            "DELETE" => config.GetValue("RateLimiting:GuardianConsent:WithdrawPermitLimit", 10),
                            _ => config.GetValue("RateLimiting:GuardianConsent:ListPermitLimit", 30)
                        }
                    : path.StartsWithSegments("/api/v2/admin/volunteering/wellbeing/alerts")
                    ? 30
                    : path.StartsWithSegments("/api/ai/test-provider") || path.StartsWithSegments("/api/v2/ai/test-provider")
                        ? 10
                        : (int?)null);

                if (canonicalLimit.HasValue)
                {
                    var retryAfterSeconds = Math.Max(1, (int)Math.Ceiling(retryAfter));
                    context.HttpContext.Response.Headers["X-RateLimit-Limit"] = canonicalLimit.Value.ToString();
                    context.HttpContext.Response.Headers["X-RateLimit-Remaining"] = "0";
                    context.HttpContext.Response.Headers["X-RateLimit-Reset"] =
                        (DateTimeOffset.UtcNow.ToUnixTimeSeconds() + retryAfterSeconds).ToString();
                    context.HttpContext.Response.Headers["API-Version"] = "2.0";

                    var tenantId = context.HttpContext.User.FindFirst("tenant_id")?.Value;
                    if (!string.IsNullOrWhiteSpace(tenantId))
                    {
                        context.HttpContext.Response.Headers["X-Tenant-ID"] = tenantId;
                    }

                    await context.HttpContext.Response.WriteAsJsonAsync(new
                    {
                        success = false,
                        error = "Rate limit exceeded. Please try again later.",
                        code = "RATE_LIMIT_EXCEEDED"
                    }, cancellationToken);
                    return;
                }

                await context.HttpContext.Response.WriteAsJsonAsync(new
                {
                    error = "Too many requests",
                    message = "Rate limit exceeded. Please try again later.",
                    retry_after_seconds = (int)retryAfter
                }, cancellationToken);
            };
        });

        return services;
    }

    private static bool IsDirectMessageItemPath(string? normalizedPath)
    {
        var segments = SplitPath(normalizedPath);
        return (segments.Length == 3
                && SegmentEquals(segments[0], "api")
                && SegmentEquals(segments[1], "messages")
                && int.TryParse(segments[2], out _))
            || (segments.Length == 4
                && SegmentEquals(segments[0], "api")
                && SegmentEquals(segments[1], "v2")
                && SegmentEquals(segments[2], "messages")
                && int.TryParse(segments[3], out _));
    }

    private static bool IsDirectConversationArchivePath(string? normalizedPath)
    {
        var segments = SplitPath(normalizedPath);
        return (segments.Length == 4
                && SegmentEquals(segments[0], "api")
                && SegmentEquals(segments[1], "messages")
                && SegmentEquals(segments[2], "conversations")
                && int.TryParse(segments[3], out _))
            || (segments.Length == 5
                && SegmentEquals(segments[0], "api")
                && SegmentEquals(segments[1], "v2")
                && SegmentEquals(segments[2], "messages")
                && SegmentEquals(segments[3], "conversations")
                && int.TryParse(segments[4], out _))
            || (segments.Length == 4
                && SegmentEquals(segments[0], "api")
                && SegmentEquals(segments[1], "v2")
                && SegmentEquals(segments[2], "conversations")
                && int.TryParse(segments[3], out _));
    }

    private static bool IsDirectConversationRestorePath(string? normalizedPath)
    {
        var segments = SplitPath(normalizedPath);
        return (segments.Length == 5
                && SegmentEquals(segments[0], "api")
                && SegmentEquals(segments[1], "messages")
                && SegmentEquals(segments[2], "conversations")
                && int.TryParse(segments[3], out _)
                && SegmentEquals(segments[4], "restore"))
            || (segments.Length == 6
                && SegmentEquals(segments[0], "api")
                && SegmentEquals(segments[1], "v2")
                && SegmentEquals(segments[2], "messages")
                && SegmentEquals(segments[3], "conversations")
                && int.TryParse(segments[4], out _)
                && SegmentEquals(segments[5], "restore"));
    }

    private static string[] SplitPath(string? path) =>
        path?.Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries) ?? [];

    private static bool SegmentEquals(string value, string expected) =>
        string.Equals(value, expected, StringComparison.OrdinalIgnoreCase);

    private static FixedWindowRateLimiterOptions FixedWindow(int permitLimit, TimeSpan window) => new()
    {
        AutoReplenishment = true,
        PermitLimit = permitLimit,
        Window = window,
        QueueProcessingOrder = QueueProcessingOrder.OldestFirst,
        QueueLimit = 0
    };

    /// <summary>
    /// Returns the stable tenant/user partition used by authenticated policies,
    /// or null when the request has no usable authenticated identity.
    /// </summary>
    public static string? GetAuthenticatedUserPartitionKey(HttpContext context)
    {
        if (context.User.Identity?.IsAuthenticated == true)
        {
            var userId = context.User.FindFirst("sub")?.Value
                ?? context.User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value;
            if (!string.IsNullOrWhiteSpace(userId))
            {
                var tenantId = context.User.FindFirst("tenant_id")?.Value ?? "unknown";
                return $"user:{tenantId}:{userId}";
            }
        }

        return null;
    }

    private static string GetAuthenticatedUserOrClientIdentifier(HttpContext context, string[] trustedProxies)
    {
        return GetAuthenticatedUserPartitionKey(context)
            ?? $"client:{GetClientIdentifier(context, trustedProxies)}";
    }

    private static void AddAuthenticatedFixedWindowPolicy(
        RateLimiterOptions options,
        string policyName,
        IConfiguration configuration,
        string[] trustedProxies,
        string permitLimitConfigurationKey,
        int defaultPermitLimit)
    {
        options.AddPolicy(policyName, context =>
            RateLimitPartition.GetFixedWindowLimiter(
                partitionKey: GetAuthenticatedUserOrClientIdentifier(context, trustedProxies),
                factory: _ => FixedWindow(
                    configuration.GetValue(permitLimitConfigurationKey, defaultPermitLimit),
                    TimeSpan.FromSeconds(configuration.GetValue(
                        "RateLimiting:EventRegistration:WindowSeconds",
                        60)))));
    }

    /// <summary>
    /// Get client identifier for rate limiting.
    /// Only trusts X-Forwarded-For header if the direct connection is from a trusted proxy.
    /// </summary>
    private static string GetClientIdentifier(HttpContext context, string[] trustedProxies)
    {
        var remoteIp = context.Connection.RemoteIpAddress;

        // Only trust X-Forwarded-For if the direct connection is from a trusted proxy
        if (remoteIp != null && IsTrustedProxy(remoteIp, trustedProxies))
        {
            var forwardedFor = context.Request.Headers["X-Forwarded-For"].FirstOrDefault();
            if (!string.IsNullOrEmpty(forwardedFor))
            {
                // Take the first IP (original client) from the chain
                var clientIp = forwardedFor.Split(',')[0].Trim();
                if (!string.IsNullOrEmpty(clientIp) && IPAddress.TryParse(clientIp, out _))
                {
                    return clientIp;
                }
            }
        }

        // Fall back to direct connection IP
        return remoteIp?.ToString() ?? "unknown";
    }

    /// <summary>
    /// Check if an IP address is from a trusted proxy network.
    /// </summary>
    private static bool IsTrustedProxy(IPAddress address, string[] trustedProxies)
    {
        foreach (var trusted in trustedProxies)
        {
            if (trusted.Contains('/'))
            {
                // CIDR notation (e.g., "10.0.0.0/8")
                if (IsInNetwork(address, trusted))
                    return true;
            }
            else
            {
                // Single IP
                if (IPAddress.TryParse(trusted, out var trustedIp) && address.Equals(trustedIp))
                    return true;
            }
        }

        return false;
    }

    /// <summary>
    /// Check if an IP address is within a CIDR network range.
    /// </summary>
    private static bool IsInNetwork(IPAddress address, string cidr)
    {
        try
        {
            var parts = cidr.Split('/');
            if (parts.Length != 2 || !IPAddress.TryParse(parts[0], out var networkAddress) || !int.TryParse(parts[1], out var prefixLength))
                return false;

            // Ensure both addresses are the same type (IPv4 or IPv6)
            if (address.AddressFamily != networkAddress.AddressFamily)
            {
                // Try to map IPv4 to IPv6 if needed
                if (address.IsIPv4MappedToIPv6)
                    address = address.MapToIPv4();
                if (networkAddress.IsIPv4MappedToIPv6)
                    networkAddress = networkAddress.MapToIPv4();

                if (address.AddressFamily != networkAddress.AddressFamily)
                    return false;
            }

            var addressBytes = address.GetAddressBytes();
            var networkBytes = networkAddress.GetAddressBytes();

            // Calculate how many full bytes and remaining bits to compare
            var fullBytes = prefixLength / 8;
            var remainingBits = prefixLength % 8;

            // Compare full bytes
            for (int i = 0; i < fullBytes && i < addressBytes.Length; i++)
            {
                if (addressBytes[i] != networkBytes[i])
                    return false;
            }

            // Compare remaining bits
            if (remainingBits > 0 && fullBytes < addressBytes.Length)
            {
                var mask = (byte)(0xFF << (8 - remainingBits));
                if ((addressBytes[fullBytes] & mask) != (networkBytes[fullBytes] & mask))
                    return false;
            }

            return true;
        }
        catch
        {
            return false;
        }
    }
}
