// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Authorization;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;
using Nexus.Api.Services.Federation;
using System.Globalization;
using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Nexus.Api.Controllers;

[ApiController]
[Authorize(Policy = NexusAuthorizationPolicies.RouteAwareAdmin)]
public class AdminExplicitParityController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly IFederationWebhookSubscriptionService _webhookService;
    private readonly IConfiguration _configuration;
    private readonly FileUploadService _fileUploadService;
    private readonly VolunteerOrganisationService _volunteerOrganisations;
    private const string BillingInvoicesKey = "admin_explicit.billing.invoices";
    private const string FederationTopicsKey = "admin_explicit.federation.topics";
    private const string FederationTopicSubscriptionsKey = "admin_explicit.federation.topic_subscriptions";
    private const string FederationWebhooksKey = "admin_explicit.federation.webhooks";
    private const string FederationCreditAgreementsKey = "admin_explicit.federation.credit_agreements";
    private const string CompatibilityWritesKey = "admin_explicit.compatibility_writes";
    private const string MemberPremiumConnectAccountKey = "donations.stripe_connect_account_id";
    private const string MemberPremiumDisputesKey = "donations.disputes";
    private const string MemberPremiumTierMetadataKeyPrefix = "member_premium.tier_meta.";
    private const string SupportReportsKey = "admin_explicit.support_reports";
    private const string ApiPartnersKey = "admin_explicit.api_partners";
    private const string AdminUserRolesKeyPrefix = "admin.user_roles.";
    private const string ApiPartnerCallLogPrefix = "admin_explicit.api_partner_call_log.";
    private const string ModuleConfigPrefix = "admin_explicit.module_config.";
    private const string TranslationGlossaryKey = "admin_explicit.translation_glossary";
    private const string LocalAdvertisingCampaignsKey = "local_advertising.campaigns";
    private const string PaidPushCampaignsKey = "paid_push.campaigns";
    private const string ModerationSettingPrefix = "moderation.";
    private static readonly string[] ModerationSettingKeys =
    [
        "enabled",
        "require_post",
        "require_listing",
        "require_event",
        "require_comment",
        "auto_filter"
    ];

    private static readonly IReadOnlyDictionary<string, IReadOnlyDictionary<string, object?>> ModuleConfigDefaults =
        new Dictionary<string, IReadOnlyDictionary<string, object?>>(StringComparer.OrdinalIgnoreCase)
        {
            ["groups"] = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase)
            {
                ["allow_user_group_creation"] = true,
                ["require_group_approval"] = false,
                ["max_groups_per_user"] = 10,
                ["max_members_per_group"] = 500,
                ["allow_private_groups"] = true,
                ["default_visibility"] = "public",
                ["enable_discussions"] = true,
                ["enable_feedback"] = true,
                ["enable_achievements"] = true,
                ["moderation_enabled"] = true
            },
            ["listings"] = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase)
            {
                ["listing.moderation_enabled"] = false,
                ["listing.auto_approve_trusted"] = false,
                ["listing.max_per_user"] = 50,
                ["listing.max_images"] = 5,
                ["listing.max_image_size_mb"] = 8,
                ["listing.require_image"] = false,
                ["listing.min_title_length"] = 5,
                ["listing.min_description_length"] = 20,
                ["listing.allow_offers"] = true,
                ["listing.allow_requests"] = true,
                ["listing.require_category"] = true,
                ["listing.require_location"] = false,
                ["listing.require_hours_estimate"] = false,
                ["listing.enable_skill_tags"] = true,
                ["listing.enable_service_type"] = true,
                ["listing.auto_expire_days"] = 0,
                ["listing.max_renewals"] = 12,
                ["listing.renewal_days"] = 30,
                ["listing.expiry_reminders"] = true,
                ["listing.enable_featured"] = true,
                ["listing.featured_duration_days"] = 7,
                ["listing.enable_ai_descriptions"] = true,
                ["listing.enable_reporting"] = true,
                ["listing.enable_favourites"] = true,
                ["listing.enable_map_view"] = true,
                ["listing.enable_reciprocity"] = true
            },
            ["volunteering"] = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase)
            {
                ["volunteering.tab_opportunities"] = true,
                ["volunteering.tab_applications"] = true,
                ["volunteering.tab_hours"] = true,
                ["volunteering.tab_recommended"] = true,
                ["volunteering.tab_certificates"] = true,
                ["volunteering.tab_alerts"] = true,
                ["volunteering.tab_wellbeing"] = true,
                ["volunteering.tab_credentials"] = true,
                ["volunteering.tab_waitlist"] = true,
                ["volunteering.tab_swaps"] = true,
                ["volunteering.tab_group_signups"] = true,
                ["volunteering.tab_hours_review"] = true,
                ["volunteering.tab_expenses"] = true,
                ["volunteering.tab_safeguarding"] = true,
                ["volunteering.tab_community_projects"] = true,
                ["volunteering.tab_donations"] = true,
                ["volunteering.tab_accessibility"] = true,
                ["volunteering.swap_requires_admin"] = false,
                ["volunteering.auto_approve_applications"] = false,
                ["volunteering.require_org_note_on_decline"] = false,
                ["volunteering.cancellation_deadline_hours"] = 24,
                ["volunteering.max_hours_per_shift"] = 8,
                ["volunteering.hours_require_verification"] = true,
                ["volunteering.min_hours_for_certificate"] = 1,
                ["volunteering.alert_default_expiry_hours"] = 24,
                ["volunteering.alert_skill_matching"] = true,
                ["volunteering.expenses_enabled"] = true,
                ["volunteering.expense_require_receipt"] = false,
                ["volunteering.expense_max_amount"] = 500,
                ["volunteering.burnout_detection"] = true,
                ["volunteering.guardian_consent_required"] = false,
                ["volunteering.enable_qr_checkin"] = true,
                ["volunteering.enable_recurring_shifts"] = true,
                ["volunteering.enable_reviews"] = true,
                ["volunteering.enable_matching"] = true
            },
            ["jobs"] = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase)
            {
                ["jobs.tab_browse"] = true,
                ["jobs.tab_saved"] = true,
                ["jobs.tab_my_postings"] = true,
                ["jobs.page_kanban"] = true,
                ["jobs.page_analytics"] = true,
                ["jobs.page_bias_audit"] = true,
                ["jobs.page_talent_search"] = true,
                ["jobs.page_alerts"] = true,
                ["jobs.allow_paid"] = true,
                ["jobs.allow_volunteer"] = true,
                ["jobs.allow_timebank"] = true,
                ["jobs.require_salary"] = false,
                ["jobs.default_currency"] = "EUR",
                ["jobs.max_postings_per_user"] = 20,
                ["jobs.default_deadline_days"] = 30,
                ["jobs.moderation_enabled"] = false,
                ["jobs.spam_detection"] = true,
                ["jobs.auto_approve_trusted"] = false,
                ["jobs.enable_cv_upload"] = true,
                ["jobs.require_cover_message"] = false,
                ["jobs.enable_interview_scheduling"] = true,
                ["jobs.enable_offers"] = true,
                ["jobs.enable_scorecards"] = true,
                ["jobs.enable_pipeline_rules"] = true,
                ["jobs.enable_blind_hiring"] = false,
                ["jobs.enable_featured"] = true,
                ["jobs.featured_duration_days"] = 7,
                ["jobs.enable_ai_descriptions"] = true,
                ["jobs.enable_skills_matching"] = true,
                ["jobs.enable_referrals"] = true,
                ["jobs.enable_templates"] = true,
                ["jobs.enable_rss_feed"] = true,
                ["jobs.enable_saved_profiles"] = true,
                ["jobs.enable_employer_branding"] = true
            },
            ["identity"] = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase)
            {
                ["identity_verification_fee_cents"] = 500
            },
            ["translation"] = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase)
            {
                ["translation.enabled"] = true,
                ["translation.engine"] = "openai",
                ["translation.context_aware"] = false,
                ["translation.context_messages"] = 5,
                ["translation.auto_translate_default"] = false,
                ["translation.max_per_user_per_hour"] = 100,
                ["translation.glossary_enabled"] = false
            }
        };

    private static readonly JsonSerializerOptions StoreJsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true
    };

    public AdminExplicitParityController(
        NexusDbContext db,
        IFederationWebhookSubscriptionService webhookService,
        IConfiguration configuration,
        FileUploadService fileUploadService,
        VolunteerOrganisationService volunteerOrganisations)
    {
        _db = db;
        _webhookService = webhookService;
        _configuration = configuration;
        _fileUploadService = fileUploadService;
        _volunteerOrganisations = volunteerOrganisations;
    }

    [HttpDelete("/api/v2/admin/enterprise/config/secrets/{key}")]
    [HttpDelete("/api/v2/admin/enterprise/gdpr/consent-types/{id}")]
    [HttpDelete("/api/v2/admin/enterprise/monitoring/log-files/{filename}")]
    [HttpDelete("/api/v2/admin/fadp/processing-activities/{id}")]
    [HttpDelete("/api/v2/admin/federation/webhooks/{id}")]
    [HttpDelete("/api/v2/admin/feed/revoke-announcer/{id}")]
    [HttpDelete("/api/v2/admin/group-auto-assign-rules/{id}")]
    [HttpDelete("/api/v2/admin/group-collections/{id}")]
    [HttpDelete("/api/v2/admin/group-tags/{tagid}")]
    [HttpDelete("/api/v2/admin/help/faqs/{id}")]
    [HttpDelete("/api/v2/admin/invite-codes/{id}")]
    [HttpDelete("/api/v2/admin/jobs/templates/{id}")]
    [HttpDelete("/api/v2/admin/member-premium/tiers/{id}")]
    [HttpDelete("/api/v2/admin/reports/municipal-impact/templates/{id}")]
    [HttpDelete("/api/v2/admin/translation/glossary/{id}")]
    [HttpDelete("/api/v2/admin/users/{id}/verification-badges/{type}")]
    [HttpDelete("/api/v2/admin/volunteering/custom-fields/{id}")]
    [HttpDelete("/api/v2/admin/volunteering/webhooks/{id}")]
    public async Task<IActionResult> Delete()
    {
        var path = Request.Path.Value?.ToLowerInvariant() ?? string.Empty;

        return path switch
        {
            _ when TryGetLastInt(path, "/api/v2/admin/group-auto-assign-rules/", out var autoAssignRuleId) => await DeleteGroupAutoAssignRule(autoAssignRuleId),
            _ when TryGetLastInt(path, "/api/v2/admin/federation/webhooks/", out var webhookId) => await DeleteFederationWebhook(webhookId),
            _ when TryGetLastInt(path, "/api/v2/admin/invite-codes/", out var inviteCodeId) => await DeactivateInviteCode(inviteCodeId),
            _ when TryGetLastInt(path, "/api/v2/admin/member-premium/tiers/", out var memberPremiumTierId) => await DeleteMemberPremiumAdminTier(memberPremiumTierId),
            _ when TryGetLastInt(path, "/api/v2/admin/feed/revoke-announcer/", out var announcerUserId) => await RevokeMunicipalityAnnouncer(announcerUserId),
            _ when TryGetLastInt(path, "/api/v2/admin/translation/glossary/", out var glossaryId) => await DeleteTranslationGlossaryEntry(glossaryId),
            _ => await PersistCompatibilityWrite("delete")
        };
    }

    [HttpGet("/api/admin/users/search")]
    [HttpGet("/api/v2/admin/ad-campaigns")]
    [HttpGet("/api/v2/admin/ad-campaigns/{id}")]
    [HttpGet("/api/v2/admin/ad-campaigns/stats")]
    [HttpGet("/api/v2/admin/agents")]
    [HttpGet("/api/v2/admin/agents/proposals")]
    [HttpGet("/api/v2/admin/agents/runs")]
    [HttpGet("/api/v2/admin/api-partners")]
    [HttpGet("/api/v2/admin/api-partners/{id}")]
    [HttpGet("/api/v2/admin/api-partners/{id}/call-log")]
    [HttpGet("/api/v2/admin/billing/invoices")]
    [HttpGet("/api/v2/admin/billing/subscription")]
    [HttpGet("/api/v2/admin/config/groups")]
    [HttpGet("/api/v2/admin/config/identity")]
    [HttpGet("/api/v2/admin/config/jobs")]
    [HttpGet("/api/v2/admin/config/landing-page")]
    [HttpGet("/api/v2/admin/config/listings")]
    [HttpGet("/api/v2/admin/config/native-app/build-manifest")]
    [HttpGet("/api/v2/admin/config/onboarding")]
    [HttpGet("/api/v2/admin/config/onboarding/presets")]
    [HttpGet("/api/v2/admin/config/sitemap-stats")]
    [HttpGet("/api/v2/admin/config/translation")]
    [HttpGet("/api/v2/admin/config/volunteering")]
    [HttpGet("/api/v2/admin/enterprise/config/features")]
    [HttpGet("/api/v2/admin/enterprise/gdpr/audit/export")]
    [HttpGet("/api/v2/admin/enterprise/gdpr/breaches/{id}")]
    [HttpGet("/api/v2/admin/enterprise/gdpr/consent-types")]
    [HttpGet("/api/v2/admin/enterprise/gdpr/consent-types/{slug}/export")]
    [HttpGet("/api/v2/admin/enterprise/gdpr/consent-types/{slug}/users")]
    [HttpGet("/api/v2/admin/enterprise/gdpr/requests/{id}")]
    [HttpGet("/api/v2/admin/enterprise/gdpr/statistics")]
    [HttpGet("/api/v2/admin/enterprise/gdpr/trends")]
    [HttpGet("/api/v2/admin/enterprise/monitoring/health-history")]
    [HttpGet("/api/v2/admin/enterprise/monitoring/log-files")]
    [HttpGet("/api/v2/admin/enterprise/monitoring/log-files/{filename}")]
    [HttpGet("/api/v2/admin/enterprise/monitoring/requirements")]
    [HttpGet("/api/v2/admin/events/{id}")]
    [HttpGet("/api/v2/admin/fadp/consent-ledger")]
    [HttpGet("/api/v2/admin/fadp/disclosure-pack")]
    [HttpGet("/api/v2/admin/fadp/processing-activities")]
    [HttpGet("/api/v2/admin/fadp/processing-register")]
    [HttpGet("/api/v2/admin/fadp/processing-register.csv")]
    [HttpGet("/api/v2/admin/fadp/retention-config")]
    [HttpGet("/api/v2/admin/federation/activity")]
    [HttpGet("/api/v2/admin/federation/aggregate-consent")]
    [HttpGet("/api/v2/admin/federation/aggregate-consent/audit-log")]
    [HttpGet("/api/v2/admin/federation/aggregate-consent/preview")]
    [HttpGet("/api/v2/admin/federation/analytics/overview")]
    [HttpGet("/api/v2/admin/federation/cc-config")]
    [HttpGet("/api/v2/admin/federation/credit-agreements")]
    [HttpGet("/api/v2/admin/federation/credit-agreements/{id}/transactions")]
    [HttpGet("/api/v2/admin/federation/credit-balances")]
    [HttpGet("/api/v2/admin/federation/export/{type}")]
    [HttpGet("/api/v2/admin/federation/partnerships/{id}/audit-log")]
    [HttpGet("/api/v2/admin/federation/partnerships/{id}/stats")]
    [HttpGet("/api/v2/admin/federation/topics")]
    [HttpGet("/api/v2/admin/federation/topics/mine")]
    [HttpGet("/api/v2/admin/federation/webhooks")]
    [HttpGet("/api/v2/admin/federation/webhooks/{id}/logs")]
    [HttpGet("/api/v2/admin/gamification/badge-config")]
    [HttpGet("/api/v2/admin/group-auto-assign-rules")]
    [HttpGet("/api/v2/admin/group-collections")]
    [HttpGet("/api/v2/admin/groups/{id}")]
    [HttpGet("/api/v2/admin/groups/{id}/audit-log")]
    [HttpGet("/api/v2/admin/group-tags")]
    [HttpGet("/api/v2/admin/help/faqs")]
    [HttpGet("/api/v2/admin/invite-codes")]
    [HttpGet("/api/v2/admin/jobs/bias-audit")]
    [HttpGet("/api/v2/admin/jobs/interviews")]
    [HttpGet("/api/v2/admin/jobs/moderation-queue")]
    [HttpGet("/api/v2/admin/jobs/moderation-stats")]
    [HttpGet("/api/v2/admin/jobs/offers")]
    [HttpGet("/api/v2/admin/jobs/spam-stats")]
    [HttpGet("/api/v2/admin/jobs/templates")]
    [HttpGet("/api/v2/admin/ki-agents/config")]
    [HttpGet("/api/v2/admin/ki-agents/proposals")]
    [HttpGet("/api/v2/admin/ki-agents/runs")]
    [HttpGet("/api/v2/admin/ki-agents/runs/{id}")]
    [HttpGet("/api/v2/admin/ki-agents/stats")]
    [HttpGet("/api/v2/admin/listings/{id}")]
    [HttpGet("/api/v2/admin/listings/moderation-queue")]
    [HttpGet("/api/v2/admin/listings/moderation-stats")]
    [HttpGet("/api/v2/admin/listings/stats")]
    [HttpGet("/api/v2/admin/member-premium/finance/annual-receipts")]
    [HttpGet("/api/v2/admin/member-premium/finance/disputes")]
    [HttpGet("/api/v2/admin/member-premium/finance/gift-aid-export")]
    [HttpGet("/api/v2/admin/member-premium/finance/overview")]
    [HttpGet("/api/v2/admin/member-premium/settings")]
    [HttpGet("/api/v2/admin/member-premium/subscribers")]
    [HttpGet("/api/v2/admin/member-premium/tiers")]
    [HttpGet("/api/v2/admin/member-premium/tiers/{id}")]
    [HttpGet("/api/v2/admin/moderation/queue")]
    [HttpGet("/api/v2/admin/moderation/settings")]
    [HttpGet("/api/v2/admin/moderation/stats")]
    [HttpGet("/api/v2/admin/pilot-inquiries")]
    [HttpGet("/api/v2/admin/pilot-inquiries/{id}")]
    [HttpGet("/api/v2/admin/pilot-inquiries/export")]
    [HttpGet("/api/v2/admin/pilot-inquiries/stats")]
    [HttpGet("/api/v2/admin/push-campaigns")]
    [HttpGet("/api/v2/admin/push-campaigns/{id}")]
    [HttpGet("/api/v2/admin/push-campaigns/stats")]
    [HttpGet("/api/v2/admin/reports/hours_category/export")]
    [HttpGet("/api/v2/admin/reports/inactive/export")]
    [HttpGet("/api/v2/admin/reports/members/export")]
    [HttpGet("/api/v2/admin/reports/municipal_impact/export")]
    [HttpGet("/api/v2/admin/reports/social_value/export")]
    [HttpGet("/api/v2/admin/reports/{type}/export")]
    [HttpGet("/api/v2/admin/reports/export-types")]
    [HttpGet("/api/v2/admin/reports/municipal-impact")]
    [HttpGet("/api/v2/admin/reports/municipal-impact/templates")]
    [HttpGet("/api/v2/admin/reports/municipal-impact/verification")]
    [HttpGet("/api/v2/admin/residency-verifications")]
    [HttpGet("/api/v2/admin/support-reports")]
    [HttpGet("/api/v2/admin/support-reports/{id}")]
    [HttpGet("/api/v2/admin/support-reports/assignees")]
    [HttpGet("/api/v2/admin/support-reports/stats")]
    [HttpGet("/api/v2/admin/safeguarding/members/{userid}/activity")]
    [HttpGet("/api/v2/admin/safeguarding/members/{userid}/activity.csv")]
    [HttpGet("/api/v2/admin/safeguarding/statement")]
    [HttpGet("/api/v2/admin/safeguarding/statement/download")]
    [HttpGet("/api/v2/admin/search/analytics")]
    [HttpGet("/api/v2/admin/search/trending")]
    [HttpGet("/api/v2/admin/search/zero-results")]
    [HttpGet("/api/v2/admin/super/billing/export")]
    [HttpGet("/api/v2/admin/super/billing/revenue")]
    [HttpGet("/api/v2/admin/super/billing/snapshot")]
    [HttpGet("/api/v2/admin/super/federation/jwt-status")]
    [HttpGet("/api/v2/admin/tools/ip-debug")]
    [HttpGet("/api/v2/admin/translation/glossary")]
    [HttpGet("/api/v2/admin/users/{id}/verification-badges")]
    [HttpGet("/api/v2/admin/users/import/template")]
    [HttpGet("/api/v2/admin/volunteering/activity-feed")]
    [HttpGet("/api/v2/admin/volunteering/applications")]
    [HttpGet("/api/v2/admin/volunteering/community-projects")]
    [HttpGet("/api/v2/admin/volunteering/custom-fields")]
    [HttpGet("/api/v2/admin/volunteering/donations/export")]
    [HttpGet("/api/v2/admin/volunteering/expenses")]
    [HttpGet("/api/v2/admin/volunteering/expenses/export")]
    [HttpGet("/api/v2/admin/volunteering/expenses/policies")]
    [HttpGet("/api/v2/admin/volunteering/giving-days")]
    [HttpGet("/api/v2/admin/volunteering/giving-days/{id}/donors")]
    [HttpGet("/api/v2/admin/volunteering/giving-days/{id}/trends")]
    [HttpGet("/api/v2/admin/volunteering/incidents")]
    [HttpGet("/api/admin/volunteering/organizations")]
    [HttpGet("/api/v2/admin/volunteering/organizations")]
    [HttpGet("/api/v2/admin/volunteering/organizations/{id}/members")]
    [HttpGet("/api/v2/admin/volunteering/reminder-logs")]
    [HttpGet("/api/v2/admin/volunteering/reminder-settings")]
    [HttpGet("/api/v2/admin/volunteering/training")]
    [HttpGet("/api/v2/admin/volunteering/trends")]
    [HttpGet("/api/v2/admin/volunteering/webhooks")]
    [HttpGet("/api/v2/admin/volunteering/webhooks/{id}/logs")]
    public async Task<IActionResult> Get()
    {
        var path = Request.Path.Value?.ToLowerInvariant() ?? string.Empty;

        return path switch
        {
            "/api/admin/users/search" => await SearchUsers(),
            "/api/v2/admin/ad-campaigns" => await GetAdminAdCampaigns(),
            "/api/v2/admin/ad-campaigns/stats" => await GetAdminAdCampaignStats(),
            "/api/v2/admin/api-partners" => await GetApiPartners(),
            "/api/v2/admin/billing/subscription" => await GetBillingSubscription(),
            "/api/v2/admin/billing/invoices" => await GetBillingInvoices(),
            "/api/v2/admin/config/groups" => await GetModuleConfig("groups"),
            "/api/v2/admin/config/identity" => await GetModuleConfig("identity"),
            "/api/v2/admin/config/landing-page" => await GetLandingPageMetadata(),
            "/api/v2/admin/config/listings" => await GetModuleConfig("listings"),
            "/api/v2/admin/config/jobs" => await GetModuleConfig("jobs"),
            "/api/v2/admin/config/sitemap-stats" => await GetSitemapStats(),
            "/api/v2/admin/config/translation" => await GetModuleConfig("translation"),
            "/api/v2/admin/config/volunteering" => await GetModuleConfig("volunteering"),
            "/api/v2/admin/enterprise/config/features" => await GetEnterpriseFeatures(),
            "/api/v2/admin/enterprise/gdpr/consent-types" => await GetGdprConsentTypes(),
            "/api/v2/admin/enterprise/gdpr/statistics" => await GetGdprStatistics(),
            "/api/v2/admin/enterprise/gdpr/trends" => await GetGdprTrends(),
            "/api/v2/admin/enterprise/monitoring/requirements" => await GetMonitoringRequirements(),
            "/api/v2/admin/fadp/consent-ledger" => await GetConsentLedger(),
            "/api/v2/admin/fadp/processing-register" => await GetProcessingRegister(),
            "/api/v2/admin/fadp/processing-register.csv" => await GetProcessingRegisterCsv(),
            "/api/v2/admin/federation/activity" => await GetFederationActivity(),
            "/api/v2/admin/federation/analytics/overview" => await GetFederationAnalyticsOverview(),
            "/api/v2/admin/federation/credit-agreements" => await GetFederationCreditAgreements(),
            "/api/v2/admin/federation/credit-balances" => await GetFederationCreditBalances(),
            "/api/v2/admin/federation/topics" => await GetFederationTopics(),
            "/api/v2/admin/federation/topics/mine" => await GetFederationTopicSubscriptions(),
            "/api/v2/admin/federation/webhooks" => await GetFederationWebhooks(),
            "/api/v2/admin/group-auto-assign-rules" => await GetGroupAutoAssignRules(),
            "/api/v2/admin/help/faqs" => await GetFaqs(),
            "/api/v2/admin/invite-codes" => await GetInviteCodes(),
            "/api/v2/admin/jobs/interviews" => await GetJobInterviews(),
            "/api/v2/admin/jobs/moderation-queue" => await GetJobModerationQueue(),
            "/api/v2/admin/jobs/moderation-stats" => await GetJobModerationStats(),
            "/api/v2/admin/jobs/offers" => await GetJobOffers(),
            "/api/v2/admin/jobs/spam-stats" => await GetJobSpamStats(),
            "/api/v2/admin/jobs/templates" => await GetJobTemplates(),
            "/api/v2/admin/listings/moderation-queue" => await GetListingsModerationQueue(),
            "/api/v2/admin/listings/moderation-stats" => await GetListingsModerationStats(),
            "/api/v2/admin/listings/stats" => await GetListingsStats(),
            "/api/v2/admin/member-premium/finance/annual-receipts" => await GetMemberPremiumAnnualReceiptsCsv(),
            "/api/v2/admin/member-premium/finance/disputes" => await GetMemberPremiumFinanceDisputes(),
            "/api/v2/admin/member-premium/finance/gift-aid-export" => await GetMemberPremiumGiftAidCsv(),
            "/api/v2/admin/member-premium/finance/overview" => await GetMemberPremiumFinanceOverview(),
            "/api/v2/admin/member-premium/settings" => await GetMemberPremiumSettings(),
            "/api/v2/admin/member-premium/subscribers" => await GetMemberPremiumAdminSubscribers(),
            "/api/v2/admin/member-premium/tiers" => await GetMemberPremiumAdminTiers(),
            "/api/v2/admin/moderation/queue" => await GetModerationQueue(),
            "/api/v2/admin/moderation/settings" => await GetModerationSettings(),
            "/api/v2/admin/moderation/stats" => await GetModerationStats(),
            "/api/v2/admin/push-campaigns" => await GetAdminPushCampaigns(),
            "/api/v2/admin/push-campaigns/stats" => await GetAdminPushCampaignStats(),
            "/api/v2/admin/reports/export-types" => GetReportExportTypes(),
            _ when IsAdminReportExportPath(path) => GetAdminReportExportCsv(path),
            "/api/v2/admin/support-reports" => await GetSupportReports(),
            "/api/v2/admin/support-reports/assignees" => await GetSupportReportAssignees(),
            "/api/v2/admin/support-reports/stats" => await GetSupportReportStats(),
            "/api/v2/admin/super/billing/export" => await GetBillingExportCsv(),
            "/api/v2/admin/super/billing/revenue" => await GetBillingRevenue(),
            "/api/v2/admin/super/billing/snapshot" => await GetBillingSnapshot(),
            "/api/v2/admin/super/federation/jwt-status" => GetFederationJwtStatus(),
            "/api/v2/admin/translation/glossary" => await GetTranslationGlossary(),
            "/api/admin/volunteering/organizations" => await GetVolunteeringOrganizations(),
            "/api/v2/admin/volunteering/organizations" => await GetVolunteeringOrganizations(),
            _ when TryGetLastInt(path, "/api/v2/admin/enterprise/gdpr/breaches/", out var breachId) => await GetGdprBreach(breachId),
            _ when TryGetLastInt(path, "/api/v2/admin/enterprise/gdpr/requests/", out var requestId) => await GetGdprRequest(requestId),
            _ when TryGetLastInt(path, "/api/v2/admin/ad-campaigns/", out var adCampaignId) => await GetAdminAdCampaign(adCampaignId),
            _ when TryGetIntBeforeSuffix(path, "/api/v2/admin/api-partners/", "/call-log", out var apiPartnerCallLogId) => await GetApiPartnerCallLog(apiPartnerCallLogId),
            _ when TryGetLastInt(path, "/api/v2/admin/api-partners/", out var apiPartnerId) => await GetApiPartner(apiPartnerId),
            _ when TryGetLastInt(path, "/api/v2/admin/push-campaigns/", out var pushCampaignId) => await GetAdminPushCampaign(pushCampaignId),
            _ when TryGetSlugBeforeSuffix(path, "/api/v2/admin/enterprise/gdpr/consent-types/", "/users", out var usersSlug) => await GetConsentTypeUsers(usersSlug),
            _ when TryGetSlugBeforeSuffix(path, "/api/v2/admin/enterprise/gdpr/consent-types/", "/export", out var exportSlug) => await GetConsentTypeExport(exportSlug),
            _ when TryGetIntBeforeSuffix(path, "/api/v2/admin/federation/webhooks/", "/logs", out var webhookLogId) => await GetFederationWebhookLogs(webhookLogId),
            _ when TryGetLastInt(path, "/api/v2/admin/events/", out var eventId) => await GetEvent(eventId),
            _ when TryGetLastInt(path, "/api/v2/admin/groups/", out var groupId) => await GetGroup(groupId),
            _ when TryGetLastInt(path, "/api/v2/admin/listings/", out var listingId) => await GetListing(listingId),
            _ when TryGetLastInt(path, "/api/v2/admin/member-premium/tiers/", out var memberPremiumTierId) => await GetMemberPremiumAdminTier(memberPremiumTierId),
            _ when TryGetLastInt(path, "/api/v2/admin/support-reports/", out var supportReportId) => await GetSupportReport(supportReportId),
            _ => await GetPersistedCompatibilityRead(path)
        };
    }

    [HttpGet("/api/v2/admin/email/status")]
    public async Task<IActionResult> GetEmailStatus()
    {
        var today = DateTime.UtcNow.Date;
        var sentToday = await _db.EmailLogs.CountAsync(e => e.Status == EmailSendStatus.Sent && e.SentAt >= today);
        var failedToday = await _db.EmailLogs.CountAsync(e => e.Status == EmailSendStatus.Failed && e.CreatedAt >= today);
        var pendingEmails = await _db.EmailLogs.CountAsync(e => e.Status == EmailSendStatus.Pending);
        var activeSubscribers = await _db.NewsletterSubscriptions.CountAsync(s => s.IsSubscribed);

        var newsletterStatuses = await _db.Newsletters
            .AsNoTracking()
            .GroupBy(n => n.Status)
            .Select(g => new { status = g.Key.ToString().ToLowerInvariant(), count = g.Count() })
            .ToListAsync();

        return Ok(new
        {
            data = new
            {
                provider = "gmail",
                sent_today = sentToday,
                failed_today = failedToday,
                pending = pendingEmails,
                active_subscribers = activeSubscribers,
                newsletters = newsletterStatuses,
                generated_at = DateTime.UtcNow
            }
        });
    }

    [HttpPatch("/api/v2/admin/agents/{id}")]
    [HttpPatch("/api/v2/admin/enterprise/config/features")]
    [HttpPatch("/api/v2/admin/support-reports/{id}")]
    public async Task<IActionResult> Patch()
    {
        var path = Request.Path.Value?.ToLowerInvariant() ?? string.Empty;
        return TryGetLastInt(path, "/api/v2/admin/support-reports/", out var supportReportId)
            ? await UpdateSupportReport(supportReportId)
            : await PersistCompatibilityWrite("patch");
    }

    [HttpPost("/api/v2/admin/ad-campaigns/{id}/approve")]
    [HttpPost("/api/v2/admin/ad-campaigns/{id}/pause")]
    [HttpPost("/api/v2/admin/ad-campaigns/{id}/reject")]
    [HttpPost("/api/v2/admin/agents/{id}/run-now")]
    [HttpPost("/api/v2/admin/agents/{id}/toggle")]
    [HttpPost("/api/v2/admin/agents/proposals/{id}/approve")]
    [HttpPost("/api/v2/admin/agents/proposals/{id}/edit-approve")]
    [HttpPost("/api/v2/admin/agents/proposals/{id}/reject")]
    [HttpPost("/api/v2/admin/api-partners")]
    [HttpPost("/api/v2/admin/api-partners/{id}/activate")]
    [HttpPost("/api/v2/admin/api-partners/{id}/regenerate-credentials")]
    [HttpPost("/api/v2/admin/api-partners/{id}/suspend")]
    [HttpPost("/api/v2/admin/billing/checkout")]
    [HttpPost("/api/v2/admin/billing/portal")]
    [HttpPost("/api/v2/admin/billing/upgrade-request")]
    [HttpPost("/api/v2/admin/blog/bulk-delete")]
    [HttpPost("/api/v2/admin/blog/bulk-publish")]
    [HttpPost("/api/v2/admin/config/onboarding/apply-preset")]
    [HttpPost("/api/v2/admin/config/sitemap-clear-cache")]
    [HttpPost("/api/v2/admin/donations/{id}/refund")]
    [HttpPost("/api/v2/admin/email/test")]
    [HttpPost("/api/v2/admin/email/test-gmail")]
    [HttpPost("/api/v2/admin/enterprise/config/reset")]
    [HttpPost("/api/v2/admin/enterprise/config/secrets/{key}/rotate")]
    [HttpPost("/api/v2/admin/enterprise/config/secrets/test-vault")]
    [HttpPost("/api/v2/admin/enterprise/gdpr/breaches/{id}/notify-dpa")]
    [HttpPost("/api/v2/admin/enterprise/gdpr/consent-types")]
    [HttpPost("/api/v2/admin/enterprise/gdpr/requests")]
    [HttpPost("/api/v2/admin/enterprise/gdpr/requests/{id}/export")]
    [HttpPost("/api/v2/admin/enterprise/gdpr/requests/{id}/notes")]
    [HttpPost("/api/v2/admin/fadp/processing-activities")]
    [HttpPost("/api/v2/admin/federation/aggregate-consent/rotate-secret")]
    [HttpPost("/api/v2/admin/federation/api-keys/{id}/revoke")]
    [HttpPost("/api/v2/admin/federation/credit-agreements")]
    [HttpPost("/api/v2/admin/federation/data/export")]
    [HttpPost("/api/v2/admin/federation/data/import")]
    [HttpPost("/api/v2/admin/federation/data/purge")]
    [HttpPost("/api/v2/admin/federation/partnerships/{id}/counter-propose")]
    [HttpPost("/api/v2/admin/federation/partnerships/{id}/reactivate")]
    [HttpPost("/api/v2/admin/federation/webhook-logs/{id}/retry")]
    [HttpPost("/api/v2/admin/federation/webhooks")]
    [HttpPost("/api/v2/admin/federation/webhooks/{id}/test")]
    [HttpPost("/api/v2/admin/feed/grant-announcer")]
    [HttpPost("/api/v2/admin/gamification/badge-config/{badgekey}/reset")]
    [HttpPost("/api/v2/admin/group-auto-assign-rules")]
    [HttpPost("/api/v2/admin/group-collections")]
    [HttpPost("/api/v2/admin/groups/{id}/archive")]
    [HttpPost("/api/v2/admin/groups/{id}/clone")]
    [HttpPost("/api/v2/admin/groups/{id}/merge")]
    [HttpPost("/api/v2/admin/groups/{id}/transfer-ownership")]
    [HttpPost("/api/v2/admin/groups/{id}/unarchive")]
    [HttpPost("/api/v2/admin/groups/bulk-archive")]
    [HttpPost("/api/v2/admin/groups/bulk-unarchive")]
    [HttpPost("/api/v2/admin/group-tags")]
    [HttpPost("/api/v2/admin/help/faqs")]
    [HttpPost("/api/v2/admin/ideation/{id}/status")]
    [HttpPost("/api/v2/admin/identity/sessions/{id}/approve")]
    [HttpPost("/api/v2/admin/identity/sessions/{id}/reject")]
    [HttpPost("/api/v2/admin/invite-codes")]
    [HttpPost("/api/v2/admin/jobs/{id}/approve")]
    [HttpPost("/api/v2/admin/jobs/{id}/flag")]
    [HttpPost("/api/v2/admin/jobs/{id}/reject")]
    [HttpPost("/api/v2/admin/ki-agents/proposals/{id}/approve")]
    [HttpPost("/api/v2/admin/ki-agents/proposals/{id}/reject")]
    [HttpPost("/api/v2/admin/ki-agents/proposals/approve-eligible")]
    [HttpPost("/api/v2/admin/ki-agents/trigger")]
    [HttpPost("/api/v2/admin/listings/{id}/reject")]
    [HttpPost("/api/v2/admin/member-premium/connect/onboarding")]
    [HttpPost("/api/v2/admin/member-premium/tiers")]
    [HttpPost("/api/v2/admin/member-premium/tiers/{id}/sync-stripe")]
    [HttpPost("/api/v2/admin/members/inactive/detect")]
    [HttpPost("/api/v2/admin/pilot-inquiries/{id}/assign")]
    [HttpPost("/api/v2/admin/pilot-inquiries/{id}/notes")]
    [HttpPost("/api/v2/admin/pilot-inquiries/{id}/stage")]
    [HttpPost("/api/v2/admin/plans/{id}/sync-stripe")]
    [HttpPost("/api/v2/admin/push-campaigns/{id}/approve")]
    [HttpPost("/api/v2/admin/push-campaigns/{id}/dispatch")]
    [HttpPost("/api/v2/admin/push-campaigns/{id}/reject")]
    [HttpPost("/api/v2/admin/reports/municipal-impact/templates")]
    [HttpPost("/api/v2/admin/reports/municipal-impact/verification/{id}/revoke")]
    [HttpPost("/api/v2/admin/reports/municipal-impact/verification/attest")]
    [HttpPost("/api/v2/admin/reports/municipal-impact/verification/dns")]
    [HttpPost("/api/v2/admin/residency-verifications/{id}/attest")]
    [HttpPost("/api/v2/admin/safeguarding/statement")]
    [HttpPost("/api/v2/admin/super/billing/assign-plan")]
    [HttpPost("/api/v2/admin/super/billing/delegate/grant")]
    [HttpPost("/api/v2/admin/super/billing/delegate/revoke")]
    [HttpPost("/api/v2/admin/super/billing/grace-period")]
    [HttpPost("/api/v2/admin/super/billing/pause")]
    [HttpPost("/api/v2/admin/super/billing/resume")]
    [HttpPost("/api/v2/admin/translation/glossary")]
    [HttpPost("/api/v2/admin/users/{id}/verification-badges")]
    [HttpPost("/api/v2/admin/users/bulk-approve")]
    [HttpPost("/api/v2/admin/users/bulk-suspend")]
    [HttpPost("/api/v2/admin/volunteering/custom-fields")]
    [HttpPost("/api/v2/admin/volunteering/custom-fields/reorder")]
    [HttpPost("/api/v2/admin/volunteering/giving-days")]
    [HttpPost("/api/v2/admin/volunteering/organizations")]
    [HttpPost("/api/v2/admin/volunteering/send-shift-reminders")]
    [HttpPost("/api/v2/admin/volunteering/webhooks")]
    [HttpPost("/api/v2/admin/volunteering/webhooks/{id}/test")]
    public async Task<IActionResult> Post()
    {
        var path = Request.Path.Value?.ToLowerInvariant() ?? string.Empty;

        return path switch
        {
            "/api/v2/admin/api-partners" => await CreateApiPartner(),
            "/api/v2/admin/billing/checkout" => await CreateBillingCheckout(),
            "/api/v2/admin/billing/portal" => CreateBillingPortal(),
            "/api/v2/admin/billing/upgrade-request" => await CreateBillingUpgradeRequest(),
            "/api/v2/admin/blog/bulk-delete" => await BulkDeleteBlogPosts(),
            "/api/v2/admin/blog/bulk-publish" => await BulkPublishBlogPosts(),
            "/api/v2/admin/enterprise/gdpr/requests" => await CreateGdprRequest(),
            "/api/v2/admin/federation/webhooks" => await CreateFederationWebhook(),
            "/api/v2/admin/federation/credit-agreements" => await CreateFederationCreditAgreement(),
            "/api/v2/admin/invite-codes" => await GenerateInviteCodes(),
            "/api/v2/admin/member-premium/connect/onboarding" => await CreateMemberPremiumConnectOnboarding(),
            "/api/v2/admin/member-premium/tiers" => await CreateMemberPremiumAdminTier(),
            "/api/v2/admin/translation/glossary" => await CreateTranslationGlossaryEntry(),
            "/api/v2/admin/volunteering/organizations" => await CreateVolunteeringOrganization(),
            "/api/v2/admin/users/bulk-approve" => await BulkApproveUsers(),
            "/api/v2/admin/users/bulk-suspend" => await BulkSuspendUsers(),
            "/api/v2/admin/feed/grant-announcer" => await GrantMunicipalityAnnouncer(),
            "/api/v2/admin/group-auto-assign-rules" => await CreateGroupAutoAssignRule(),
            _ when TryGetIntBeforeSuffix(path, "/api/v2/admin/ad-campaigns/", "/approve", out var approveAdCampaignId) => await ApproveAdCampaign(approveAdCampaignId),
            _ when TryGetIntBeforeSuffix(path, "/api/v2/admin/ad-campaigns/", "/pause", out var pauseAdCampaignId) => await PauseAdCampaign(pauseAdCampaignId),
            _ when TryGetIntBeforeSuffix(path, "/api/v2/admin/ad-campaigns/", "/reject", out var rejectAdCampaignId) => await RejectAdCampaign(rejectAdCampaignId),
            _ when TryGetIntBeforeSuffix(path, "/api/v2/admin/api-partners/", "/activate", out var activateApiPartnerId) => await SetApiPartnerStatus(activateApiPartnerId, "active"),
            _ when TryGetIntBeforeSuffix(path, "/api/v2/admin/api-partners/", "/regenerate-credentials", out var regenerateApiPartnerId) => await RegenerateApiPartnerCredentials(regenerateApiPartnerId),
            _ when TryGetIntBeforeSuffix(path, "/api/v2/admin/api-partners/", "/suspend", out var suspendApiPartnerId) => await SetApiPartnerStatus(suspendApiPartnerId, "suspended"),
            _ when TryGetIntBeforeSuffix(path, "/api/v2/admin/ideation/", "/status", out var ideationStatusId) => await UpdateAdminIdeationStatus(ideationStatusId),
            _ when TryGetIntBeforeSuffix(path, "/api/v2/admin/moderation/", "/review", out var moderationReviewId) => await ReviewModerationItem(moderationReviewId),
            _ when TryGetIntBeforeSuffix(path, "/api/v2/admin/push-campaigns/", "/approve", out var approvePushCampaignId) => await ApprovePushCampaign(approvePushCampaignId),
            _ when TryGetIntBeforeSuffix(path, "/api/v2/admin/push-campaigns/", "/dispatch", out var dispatchPushCampaignId) => await DispatchPushCampaign(dispatchPushCampaignId),
            _ when TryGetIntBeforeSuffix(path, "/api/v2/admin/push-campaigns/", "/reject", out var rejectPushCampaignId) => await RejectPushCampaign(rejectPushCampaignId),
            _ when TryGetFederationCreditAgreementAction(path, out var creditAgreementId, out var creditAgreementAction) => await UpdateFederationCreditAgreementStatus(creditAgreementId, creditAgreementAction),
            _ when TryGetIntBeforeSuffix(path, "/api/v2/admin/federation/webhooks/", "/test", out var webhookId) => await TestFederationWebhook(webhookId),
            _ when TryGetIntBeforeSuffix(path, "/api/v2/admin/member-premium/tiers/", "/sync-stripe", out var syncTierId) => await SyncMemberPremiumAdminTierStripe(syncTierId),
            _ when TryGetJobModerationAction(path, out var jobId, out var action) => await ModerateJob(jobId, action),
            _ => await PersistCompatibilityWrite("post")
        };
    }

    [HttpGet("/api/v2/admin/volunteering/expenses/{id:int}/receipt")]
    public async Task<IActionResult> DownloadVolunteeringExpenseReceipt(int id)
    {
        var tenantId = User.GetTenantId();
        if (tenantId == null)
        {
            return BadRequest(new
            {
                errors = new[] { new { code = "TENANT_CONTEXT_REQUIRED", message = "Authentication required with valid tenant context." } }
            });
        }

        var expense = await _db.VolunteerExpenses
            .AsNoTracking()
            .FirstOrDefaultAsync(e => e.Id == id && e.TenantId == tenantId.Value);

        if (expense == null || string.IsNullOrWhiteSpace(expense.ReceiptUrl))
            return VolunteerExpenseReceiptNotFound();

        if (!TryExtractFileUploadId(expense.ReceiptUrl, out var fileId))
            return VolunteerExpenseReceiptNotFound();

        var upload = await _fileUploadService.GetByIdAsync(fileId);
        if (upload == null || upload.TenantId != tenantId.Value)
            return VolunteerExpenseReceiptNotFound();

        var fullPath = _fileUploadService.GetFullPath(upload);
        if (!System.IO.File.Exists(fullPath))
            return VolunteerExpenseReceiptNotFound();

        Response.Headers.CacheControl = "private, max-age=0";
        return PhysicalFile(fullPath, upload.ContentType, upload.OriginalFilename);
    }

    private IActionResult CreateBillingPortal()
    {
        return BadRequest(new
        {
            errors = new[]
            {
                new
                {
                    code = "NO_SUBSCRIPTION",
                    message = "No active subscription. Subscribe to a plan first to manage payment methods."
                }
            }
        });
    }

    private async Task<IActionResult> CreateBillingUpgradeRequest()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var payload = await ReadJsonObjectPayloadAsync();
        var message = JsonString(payload, "message") ?? string.Empty;
        var now = DateTime.UtcNow;

        _db.AuditLogs.Add(new AuditLog
        {
            TenantId = tenantId,
            UserId = GetCurrentAdminUserId(),
            Action = "billing.upgrade_requested",
            EntityType = "Tenant",
            EntityId = tenantId,
            NewValues = JsonSerializer.Serialize(new { message }, StoreJsonOptions),
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
            UserAgent = Request.Headers.UserAgent.ToString(),
            Metadata = JsonSerializer.Serialize(new
            {
                source = "laravel_react_billing",
                endpoint = "/api/v2/admin/billing/upgrade-request",
                email_delivery = "not_configured"
            }, StoreJsonOptions),
            Severity = AuditSeverity.Info,
            CreatedAt = now
        });

        await _db.SaveChangesAsync();

        return Ok(new { data = new { sent = true } });
    }

    private async Task<IActionResult> BulkDeleteBlogPosts()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var idsResult = await ReadBlogBulkIds();
        if (idsResult.Error != null) return idsResult.Error;

        var ids = idsResult.Ids;
        var posts = await _db.BlogPosts
            .Where(post => post.TenantId == tenantId && ids.Contains(post.Id))
            .ToListAsync();

        var eligibleIds = posts.Select(post => post.Id).ToHashSet();
        var skippedIds = ids.Where(id => !eligibleIds.Contains(id)).ToList();
        var success = posts.Count;

        _db.BlogPosts.RemoveRange(posts);
        await _db.SaveChangesAsync();

        return Ok(new
        {
            success = true,
            data = new
            {
                success,
                failed = skippedIds.Count,
                skipped_ids = skippedIds
            }
        });
    }

    private async Task<IActionResult> BulkPublishBlogPosts()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var idsResult = await ReadBlogBulkIds();
        if (idsResult.Error != null) return idsResult.Error;

        var ids = idsResult.Ids;
        var posts = await _db.BlogPosts
            .Where(post => post.TenantId == tenantId && ids.Contains(post.Id))
            .ToListAsync();

        var existingIds = posts.Select(post => post.Id).ToHashSet();
        var skippedIds = ids.Where(id => !existingIds.Contains(id)).ToList();
        var missingCount = skippedIds.Count;
        var success = 0;
        var now = DateTime.UtcNow;

        foreach (var post in posts)
        {
            if (string.Equals(post.Status, "published", StringComparison.OrdinalIgnoreCase))
            {
                skippedIds.Add(post.Id);
                continue;
            }

            post.Status = "published";
            post.PublishedAt ??= now;
            post.UpdatedAt = now;
            success++;
        }

        await _db.SaveChangesAsync();

        return Ok(new
        {
            success = true,
            data = new
            {
                success,
                failed = missingCount,
                skipped_ids = skippedIds
            }
        });
    }

    private async Task<(List<int> Ids, IActionResult? Error)> ReadBlogBulkIds()
    {
        var payload = await ReadJsonObjectPayloadAsync();
        var ids = JsonIntArray(payload, "post_ids")
            .Where(id => id > 0)
            .Distinct()
            .ToList();

        if (ids.Count == 0)
        {
            return (ids, UnprocessableEntity(new
            {
                success = false,
                errors = new[]
                {
                    new
                    {
                        code = "VALIDATION_FAILED",
                        message = "post_ids is required.",
                        field = "post_ids"
                    }
                }
            }));
        }

        if (ids.Count > 100)
        {
            return (ids, UnprocessableEntity(new
            {
                success = false,
                errors = new[]
                {
                    new
                    {
                        code = "VALIDATION_FAILED",
                        message = "A maximum of 100 blog posts can be processed at once.",
                        field = "post_ids"
                    }
                }
            }));
        }

        return (ids, null);
    }

    private async Task<IActionResult> BulkApproveUsers()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var payload = await ReadJsonObjectPayloadAsync();
        var ids = JsonIntArray(payload, "user_ids").Where(id => id > 0).Distinct().Take(100).ToArray();
        var users = await _db.Users
            .Where(u => u.TenantId == tenantId && ids.Contains(u.Id))
            .ToListAsync();
        var eligibleIds = users.Select(u => u.Id).ToHashSet();
        var skippedIds = ids.Where(id => !eligibleIds.Contains(id)).ToList();
        var success = 0;

        foreach (var user in users)
        {
            if (user.IsActive)
            {
                skippedIds.Add(user.Id);
                continue;
            }

            user.IsActive = true;
            user.SuspendedAt = null;
            user.SuspensionReason = null;
            user.SuspendedByUserId = null;
            user.UpdatedAt = DateTime.UtcNow;
            success++;
        }

        await _db.SaveChangesAsync();
        return Ok(new
        {
            success = true,
            data = new
            {
                success,
                failed = skippedIds.Count,
                skipped_ids = skippedIds
            }
        });
    }

    private async Task<IActionResult> CreateBillingCheckout()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var payload = await ReadJsonObjectPayloadAsync();
        var planId = JsonInt(payload, "plan_id", 0, 0, int.MaxValue);
        var billingInterval = JsonString(payload, "billing_interval")?.Trim().ToLowerInvariant();

        if (planId <= 0)
        {
            return UnprocessableEntity(new
            {
                success = false,
                errors = new[] { new { code = "VALIDATION_ERROR", message = "Invalid plan id.", field = "plan_id" } }
            });
        }

        if (billingInterval is not ("monthly" or "yearly"))
        {
            return UnprocessableEntity(new
            {
                success = false,
                errors = new[] { new { code = "VALIDATION_ERROR", message = "billing_interval must be \"monthly\" or \"yearly\"", field = "billing_interval" } }
            });
        }

        var plan = await _db.SubscriptionPlans
            .FirstOrDefaultAsync(p => p.TenantId == tenantId && p.Id == planId && p.IsActive);
        if (plan == null)
        {
            return UnprocessableEntity(new
            {
                success = false,
                errors = new[] { new { code = "VALIDATION_ERROR", message = "Invalid plan id.", field = "plan_id" } }
            });
        }

        if (plan.Price == 0m)
        {
            var now = DateTime.UtcNow;
            var adminUserId = GetCurrentAdminUserId()
                ?? await _db.Users
                    .Where(u => u.TenantId == tenantId)
                    .Select(u => (int?)u.Id)
                    .FirstOrDefaultAsync();
            if (adminUserId == null)
            {
                return UnprocessableEntity(new
                {
                    success = false,
                    errors = new[] { new { code = "VALIDATION_ERROR", message = "No tenant user is available for checkout activation.", field = "user_id" } }
                });
            }

            var subscription = await _db.UserSubscriptions
                .OrderByDescending(s => s.CreatedAt)
                .FirstOrDefaultAsync(s => s.TenantId == tenantId);

            if (subscription == null)
            {
                subscription = new UserSubscription
                {
                    TenantId = tenantId,
                    UserId = adminUserId.Value,
                    CreatedAt = now
                };
                _db.UserSubscriptions.Add(subscription);
            }

            subscription.UserId = adminUserId.Value;
            subscription.PlanId = plan.Id;
            subscription.Status = SubscriptionStatus.Active;
            subscription.StartedAt = now;
            subscription.ExpiresAt = null;
            subscription.CancelledAt = null;
            subscription.NextBillingDate = null;
            subscription.StripeSubscriptionId = null;
            subscription.UpdatedAt = now;
            await _db.SaveChangesAsync();

            return Ok(new { data = new { activated = true, checkout_url = (string?)null } });
        }

        var sessionId = $"cs_local_{tenantId}_{plan.Id}_{billingInterval}_{Guid.NewGuid():N}";
        var checkoutUrl = $"/admin/billing/checkout-return?session_id={Uri.EscapeDataString(sessionId)}";

        _db.AuditLogs.Add(new AuditLog
        {
            TenantId = tenantId,
            UserId = GetCurrentAdminUserId(),
            Action = "billing.checkout_session_created",
            EntityType = "SubscriptionPlan",
            EntityId = plan.Id,
            NewValues = JsonSerializer.Serialize(new
            {
                session_id = sessionId,
                billing_interval = billingInterval,
                checkout_url = checkoutUrl,
                stripe_provider = "not_configured"
            }, StoreJsonOptions),
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
            UserAgent = Request.Headers.UserAgent.ToString(),
            Metadata = JsonSerializer.Serialize(new
            {
                source = "laravel_react_billing",
                endpoint = "/api/v2/admin/billing/checkout",
                provider_mode = "local_compatibility"
            }, StoreJsonOptions),
            Severity = AuditSeverity.Info,
            CreatedAt = DateTime.UtcNow
        });
        await _db.SaveChangesAsync();

        return Ok(new { data = new { activated = false, checkout_url = checkoutUrl, session_id = sessionId } });
    }

    private async Task<IActionResult> BulkSuspendUsers()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var payload = await ReadJsonObjectPayloadAsync();
        var ids = JsonIntArray(payload, "user_ids").Where(id => id > 0).Distinct().Take(100).ToArray();
        var reason = JsonString(payload, "reason") ?? "Suspended by admin";
        var adminId = GetCurrentAdminUserId();
        var users = await _db.Users
            .Where(u => u.TenantId == tenantId && ids.Contains(u.Id))
            .ToListAsync();
        var eligibleById = users.ToDictionary(u => u.Id);
        var skippedIds = new List<int>();
        var success = 0;

        foreach (var id in ids)
        {
            if (!eligibleById.TryGetValue(id, out var user) ||
                id == adminId ||
                user.Role is "admin" or "tenant_admin" or "super_admin" or "god")
            {
                skippedIds.Add(id);
                continue;
            }

            user.IsActive = false;
            user.SuspendedAt = DateTime.UtcNow;
            user.SuspensionReason = reason;
            user.SuspendedByUserId = adminId;
            user.UpdatedAt = DateTime.UtcNow;
            success++;
        }

        await _db.SaveChangesAsync();
        return Ok(new
        {
            success = true,
            data = new
            {
                success,
                failed = skippedIds.Count,
                skipped_ids = skippedIds
            }
        });
    }

    private async Task<IActionResult> GrantMunicipalityAnnouncer()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var payload = await ReadJsonObjectPayloadAsync();
        var userId = JsonInt(payload, "user_id", 0, 0, int.MaxValue);
        if (userId <= 0)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity, new
            {
                success = false,
                error = new { code = "VALIDATION", message = "user_id is required" }
            });
        }

        var userExists = await _db.Users.AnyAsync(u => u.TenantId == tenantId && u.Id == userId);
        if (!userExists)
        {
            return NotFound(new
            {
                success = false,
                error = new { code = "NOT_FOUND", message = "User not found in tenant" }
            });
        }

        var roles = await LoadAdminUserRolesAsync(userId);
        if (!roles.Contains("municipality_announcer", StringComparer.OrdinalIgnoreCase))
        {
            roles.Add("municipality_announcer");
            await SaveAdminUserRolesAsync(userId, roles);
            await _db.SaveChangesAsync();
        }

        return Ok(new
        {
            success = true,
            data = new { success = true, message = "Municipality announcer role granted", user_id = userId }
        });
    }

    private async Task<IActionResult> RevokeMunicipalityAnnouncer(int userId)
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var userExists = await _db.Users.AnyAsync(u => u.TenantId == tenantId && u.Id == userId);
        if (!userExists)
        {
            return NotFound(new
            {
                success = false,
                error = new { code = "NOT_FOUND", message = "User not found in tenant" }
            });
        }

        var roles = await LoadAdminUserRolesAsync(userId);
        var updatedRoles = roles
            .Where(role => !string.Equals(role, "municipality_announcer", StringComparison.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        await SaveAdminUserRolesAsync(userId, updatedRoles);
        await _db.SaveChangesAsync();

        return Ok(new
        {
            success = true,
            data = new { success = true, message = "Municipality announcer role revoked", user_id = userId }
        });
    }

    [HttpPost("/api/v2/admin/moderation/{id:int}/review")]
    public Task<IActionResult> PostModerationReview(int id) => ReviewModerationItem(id);

    [HttpPost("/api/v2/admin/federation/credit-agreements/{id:int}/approve")]
    public Task<IActionResult> ApproveFederationCreditAgreement(int id) =>
        UpdateFederationCreditAgreementStatus(id, "approve");

    [HttpPost("/api/v2/admin/federation/credit-agreements/{id:int}/reject")]
    public Task<IActionResult> RejectFederationCreditAgreement(int id) =>
        UpdateFederationCreditAgreementStatus(id, "reject");

    [HttpPost("/api/v2/admin/federation/credit-agreements/{id:int}/suspend")]
    public Task<IActionResult> SuspendFederationCreditAgreement(int id) =>
        UpdateFederationCreditAgreementStatus(id, "suspend");

    [HttpPost("/api/v2/admin/federation/credit-agreements/{id:int}/activate")]
    public Task<IActionResult> ActivateFederationCreditAgreement(int id) =>
        UpdateFederationCreditAgreementStatus(id, "activate");

    [HttpPost("/api/v2/admin/federation/credit-agreements/{id:int}/reactivate")]
    public Task<IActionResult> ReactivateFederationCreditAgreement(int id) =>
        UpdateFederationCreditAgreementStatus(id, "reactivate");

    [HttpPost("/api/v2/admin/federation/credit-agreements/{id:int}/terminate")]
    public Task<IActionResult> TerminateFederationCreditAgreement(int id) =>
        UpdateFederationCreditAgreementStatus(id, "terminate");

    [HttpPut("/api/v2/admin/api-partners/{id}")]
    [HttpPut("/api/v2/admin/config/groups")]
    [HttpPut("/api/v2/admin/config/groups/bulk")]
    [HttpPut("/api/v2/admin/config/identity/bulk")]
    [HttpPut("/api/v2/admin/config/jobs/bulk")]
    [HttpPut("/api/v2/admin/config/landing-page")]
    [HttpPut("/api/v2/admin/config/listings")]
    [HttpPut("/api/v2/admin/config/listings/bulk")]
    [HttpPut("/api/v2/admin/config/onboarding")]
    [HttpPut("/api/v2/admin/config/translation")]
    [HttpPut("/api/v2/admin/config/translation/bulk")]
    [HttpPut("/api/v2/admin/config/volunteering/bulk")]
    [HttpPut("/api/v2/admin/enterprise/gdpr/breaches/{id}")]
    [HttpPut("/api/v2/admin/enterprise/gdpr/consent-types/{id}")]
    [HttpPut("/api/v2/admin/enterprise/gdpr/requests/{id}/assign")]
    [HttpPut("/api/v2/admin/fadp/retention-config")]
    [HttpPut("/api/v2/admin/federation/aggregate-consent")]
    [HttpPut("/api/v2/admin/federation/cc-config")]
    [HttpPut("/api/v2/admin/federation/partnerships/{id}/permissions")]
    [HttpPut("/api/v2/admin/federation/topics/mine")]
    [HttpPut("/api/v2/admin/federation/webhooks/{id}")]
    [HttpPut("/api/v2/admin/gamification/badge-config/{badgekey}")]
    [HttpPut("/api/v2/admin/group-collections/{id}")]
    [HttpPut("/api/v2/admin/group-collections/{id}/groups")]
    [HttpPut("/api/admin/groups/{id:int}")]
    [HttpPut("/api/v2/admin/groups/{id:int}")]
    [HttpPut("/api/v2/admin/help/faqs/{id}")]
    [HttpPut("/api/v2/admin/ki-agents/config")]
    [HttpPut("/api/v2/admin/member-premium/settings")]
    [HttpPut("/api/v2/admin/member-premium/tiers/{id}")]
    [HttpPut("/api/v2/admin/moderation/settings")]
    [HttpPut("/api/v2/admin/reports/municipal-impact/templates/{id}")]
    [HttpPut("/api/v2/admin/reports/social-value/config")]
    [HttpPut("/api/v2/admin/support-reports/{id}")]
    [HttpPut("/api/v2/admin/super/identity/fee")]
    [HttpPut("/api/v2/admin/group-auto-assign-rules/{id}")]
    [HttpPut("/api/v2/admin/volunteering/community-projects/{id}/review")]
    [HttpPut("/api/v2/admin/volunteering/custom-fields/{id}")]
    [HttpPut("/api/v2/admin/volunteering/expenses/{id}")]
    [HttpPut("/api/v2/admin/volunteering/expenses/policies")]
    [HttpPut("/api/v2/admin/volunteering/giving-days/{id}")]
    [HttpPut("/api/v2/admin/volunteering/incidents/{id}")]
    [HttpPut("/api/v2/admin/volunteering/organizations/{id}")]
    [HttpPut("/api/v2/admin/volunteering/organizations/{id}/dlp")]
    [HttpPut("/api/v2/admin/volunteering/organizations/{id}/status")]
    [HttpPut("/api/v2/admin/volunteering/reminder-settings")]
    [HttpPut("/api/v2/admin/volunteering/training/{id}/reject")]
    [HttpPut("/api/v2/admin/volunteering/training/{id}/verify")]
    [HttpPut("/api/v2/admin/volunteering/webhooks/{id}")]
    public async Task<IActionResult> Put()
    {
        var path = Request.Path.Value?.ToLowerInvariant() ?? string.Empty;

        return path switch
        {
            "/api/v2/admin/config/groups" => await PutModuleConfig("groups"),
            "/api/v2/admin/config/groups/bulk" => await PutModuleConfigBulk("groups"),
            "/api/v2/admin/config/identity/bulk" => await PutModuleConfigBulk("identity"),
            "/api/v2/admin/config/listings" => await PutModuleConfig("listings"),
            "/api/v2/admin/config/listings/bulk" => await PutModuleConfigBulk("listings"),
            "/api/v2/admin/config/translation" => await PutModuleConfig("translation"),
            "/api/v2/admin/config/translation/bulk" => await PutModuleConfigBulk("translation"),
            "/api/v2/admin/config/jobs/bulk" => await PutModuleConfigBulk("jobs"),
            "/api/v2/admin/config/volunteering/bulk" => await PutModuleConfigBulk("volunteering"),
            "/api/v2/admin/federation/topics/mine" => await PutFederationTopicSubscriptions(),
            "/api/v2/admin/member-premium/settings" => await PutMemberPremiumSettings(),
            "/api/v2/admin/moderation/settings" => await PutModerationSettings(),
            _ when TryGetLastInt(path, "/api/v2/admin/group-auto-assign-rules/", out var autoAssignRuleId) => await UpdateGroupAutoAssignRule(autoAssignRuleId),
            _ when TryGetIntBeforeSuffix(
                path,
                "/api/v2/admin/volunteering/organizations/",
                "/status",
                out var volunteerOrganisationStatusId) =>
                    await UpdateVolunteeringOrganizationStatus(volunteerOrganisationStatusId),
            _ when TryGetLastInt(
                path,
                "/api/v2/admin/volunteering/organizations/",
                out var volunteerOrganisationId) =>
                    await UpdateVolunteeringOrganization(volunteerOrganisationId),
            _ when TryGetLastInt(path, "/api/v2/admin/member-premium/tiers/", out var memberPremiumTierId) => await UpdateMemberPremiumAdminTier(memberPremiumTierId),
            _ when TryGetLastInt(path, "/api/v2/admin/support-reports/", out var supportReportId) => await UpdateSupportReport(supportReportId),
            _ when TryGetLastInt(path, "/api/v2/admin/federation/webhooks/", out var webhookId) => await UpdateFederationWebhook(webhookId),
            _ when TryGetLastInt(path, "/api/admin/groups/", out var legacyGroupId) => await UpdateGroup(legacyGroupId),
            _ when TryGetLastInt(path, "/api/v2/admin/groups/", out var v2GroupId) => await UpdateGroup(v2GroupId),
            _ => await PersistCompatibilityWrite("put")
        };
    }

    private async Task<IActionResult> SearchUsers()
    {
        var term = (Request.Query["q"].FirstOrDefault() ?? Request.Query["search"].FirstOrDefault() ?? string.Empty).Trim().ToLowerInvariant();
        var query = _db.Users.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(term))
        {
            query = query.Where(u =>
                u.Email.ToLower().Contains(term) ||
                u.FirstName.ToLower().Contains(term) ||
                u.LastName.ToLower().Contains(term));
        }

        var userRows = await query
            .OrderBy(u => u.Email)
            .Take(50)
            .Select(u => new
            {
                u.Id,
                u.Email,
                u.FirstName,
                u.LastName,
                u.Role,
                u.IsActive,
                u.RegistrationStatus
            })
            .ToListAsync();
        var users = userRows.Select(u => new
        {
            u.Id,
            u.Email,
            full_name = (u.FirstName + " " + u.LastName).Trim(),
            u.Role,
            u.IsActive,
            registration_status = u.RegistrationStatus.ToString().ToLowerInvariant()
        }).ToList();

        return Ok(new { data = users, meta = new { total = users.Count } });
    }

    private async Task<IActionResult> GetListingsStats()
    {
        var rawStatusCounts = await _db.Listings
            .AsNoTracking()
            .GroupBy(l => l.Status)
            .Select(g => new { status = g.Key, count = g.Count() })
            .ToListAsync();
        var statusCounts = rawStatusCounts
            .Select(g => new { status = g.status.ToString().ToLowerInvariant(), g.count })
            .ToList();

        var marketplaceModeration = await _db.MarketplaceListings
            .AsNoTracking()
            .GroupBy(l => l.ModerationStatus)
            .Select(g => new { status = g.Key, count = g.Count() })
            .ToListAsync();

        return Ok(new
        {
            data = new
            {
                total = await _db.Listings.CountAsync(),
                active = await _db.Listings.CountAsync(l => l.Status == ListingStatus.Active),
                pending = await _db.Listings.CountAsync(l => l.Status == ListingStatus.Pending),
                rejected = await _db.Listings.CountAsync(l => l.Status == ListingStatus.Rejected),
                featured = await _db.Listings.CountAsync(l => l.IsFeatured),
                marketplace_total = await _db.MarketplaceListings.CountAsync(),
                marketplace_reports_open = await _db.MarketplaceReports.CountAsync(r => r.Status != "resolved"),
                by_status = statusCounts,
                marketplace_moderation = marketplaceModeration,
                generated_at = DateTime.UtcNow
            }
        });
    }

    private async Task<IActionResult> GetListingsModerationStats()
    {
        return Ok(new
        {
            data = new
            {
                pending = await _db.Listings.CountAsync(l => l.Status == ListingStatus.Pending),
                rejected = await _db.Listings.CountAsync(l => l.Status == ListingStatus.Rejected),
                reviewed = await _db.Listings.CountAsync(l => l.ReviewedAt != null),
                marketplace_pending = await _db.MarketplaceListings.CountAsync(l => l.ModerationStatus == "pending"),
                marketplace_rejected = await _db.MarketplaceListings.CountAsync(l => l.ModerationStatus == "rejected"),
                open_marketplace_reports = await _db.MarketplaceReports.CountAsync(r => r.Status != "resolved")
            }
        });
    }

    private async Task<IActionResult> GetListingsModerationQueue()
    {
        var listingRows = await _db.Listings
            .AsNoTracking()
            .Where(l => l.Status == ListingStatus.Pending)
            .OrderByDescending(l => l.CreatedAt)
            .Take(100)
            .Select(l => new { type = "timebank", l.Id, l.Title, l.Status, l.CreatedAt })
            .ToListAsync();
        var listings = listingRows
            .Select(l => new { l.type, l.Id, l.Title, status = l.Status.ToString().ToLowerInvariant(), l.CreatedAt })
            .ToList();

        var marketplace = await _db.MarketplaceListings
            .AsNoTracking()
            .Where(l => l.ModerationStatus == "pending")
            .OrderByDescending(l => l.CreatedAt)
            .Take(100)
            .Select(l => new { type = "marketplace", l.Id, l.Title, status = l.ModerationStatus, l.CreatedAt })
            .ToListAsync();

        return Ok(new { data = listings.Cast<object>().Concat(marketplace), meta = new { total = listings.Count + marketplace.Count } });
    }

    private async Task<IActionResult> GetListing(int id)
    {
        var listing = await _db.Listings.AsNoTracking()
            .Where(l => l.Id == id)
            .Select(l => new
            {
                l.Id,
                l.Title,
                l.Description,
                l.Type,
                l.Status,
                l.IsFeatured,
                l.ViewCount,
                l.CreatedAt,
                l.UpdatedAt
            })
            .FirstOrDefaultAsync();

        return listing == null
            ? NotFound(new { error = "Listing not found" })
            : Ok(new
            {
                data = new
                {
                    listing.Id,
                    listing.Title,
                    listing.Description,
                    type = listing.Type.ToString().ToLowerInvariant(),
                    status = listing.Status.ToString().ToLowerInvariant(),
                    listing.IsFeatured,
                    listing.ViewCount,
                    listing.CreatedAt,
                    listing.UpdatedAt
                }
            });
    }

    private async Task<IActionResult> DeleteListing(int id)
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var listing = await _db.Listings
            .FirstOrDefaultAsync(l => l.TenantId == tenantId && l.Id == id);

        if (listing == null)
        {
            return NotFound(new
            {
                error = "NOT_FOUND",
                message = "Listing not found."
            });
        }

        _db.Listings.Remove(listing);
        await _db.SaveChangesAsync();

        return Ok(new
        {
            success = true,
            data = new
            {
                deleted = true,
                id
            }
        });
    }

    private async Task<IActionResult> GetApiPartners()
    {
        var partners = (await LoadApiPartners())
            .OrderByDescending(p => p.Id)
            .Select(MapApiPartner)
            .ToList();

        return Ok(new { success = true, data = new { partners } });
    }

    private async Task<IActionResult> GetApiPartner(int id)
    {
        var partner = (await LoadApiPartners()).FirstOrDefault(p => p.Id == id);
        return partner == null
            ? NotFound(new { error = "PARTNER_NOT_FOUND", message = "Partner not found." })
            : Ok(new { success = true, data = new { partner = MapApiPartner(partner), credentials = Array.Empty<object>() } });
    }

    private async Task<IActionResult> CreateApiPartner()
    {
        var payload = await ReadJsonObjectPayloadAsync();
        var name = JsonString(payload, "name");
        if (string.IsNullOrWhiteSpace(name))
        {
            return UnprocessableEntity(new { error = "invalid_request", field = "name", message = "name is required." });
        }

        var now = DateTime.UtcNow;
        var partners = await LoadApiPartners();
        var credentials = IssueApiPartnerCredentials();
        var partner = new ApiPartnerRecord
        {
            Id = partners.Count == 0 ? 1 : partners.Max(p => p.Id) + 1,
            Name = name.Trim(),
            Slug = Slugify(JsonString(payload, "slug") ?? name) + "-" + RandomToken(6).ToLowerInvariant(),
            Description = JsonString(payload, "description"),
            ContactEmail = JsonString(payload, "contact_email"),
            Status = "pending",
            IsSandbox = JsonBool(payload, "is_sandbox", fallback: true),
            AllowedScopes = JsonStringList(payload, "allowed_scopes"),
            AllowedIpCidrs = JsonStringList(payload, "allowed_ip_cidrs"),
            RateLimitPerMinute = JsonInt(payload, "rate_limit_per_minute", 60, 1, 6000),
            CurrentClientId = credentials.ClientId,
            CreatedAt = now,
            UpdatedAt = now
        };

        partners.Add(partner);
        await SaveApiPartners(partners);

        return StatusCode(StatusCodes.Status201Created, new
        {
            success = true,
            data = new
            {
                partner_id = partner.Id,
                credentials = new
                {
                    client_id = credentials.ClientId,
                    client_secret = credentials.ClientSecret
                }
            }
        });
    }

    private async Task<IActionResult> SetApiPartnerStatus(int id, string status)
    {
        var partners = await LoadApiPartners();
        var partner = partners.FirstOrDefault(p => p.Id == id);
        if (partner == null)
        {
            return NotFound(new { error = "PARTNER_NOT_FOUND", message = "Partner not found." });
        }

        partner.Status = status;
        partner.UpdatedAt = DateTime.UtcNow;
        await SaveApiPartners(partners);

        return Ok(new { success = true, data = new { partner_id = id, status } });
    }

    private async Task<IActionResult> UpdateAdminIdeationStatus(int id)
    {
        var payload = await ReadJsonObjectPayloadAsync();
        var status = JsonString(payload, "status")?.Trim().ToLowerInvariant();
        var validStatuses = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "draft",
            "open",
            "voting",
            "evaluating",
            "closed",
            "archived"
        };

        if (string.IsNullOrWhiteSpace(status) || !validStatuses.Contains(status))
        {
            return BadRequest(new
            {
                success = false,
                error = "VALIDATION_ERROR",
                message = "Invalid challenge status.",
                field = "status"
            });
        }

        var challenge = await _db.Challenges.FirstOrDefaultAsync(c => c.Id == id);
        if (challenge == null)
        {
            return NotFound(new { success = false, error = "NOT_FOUND", message = "Challenge not found." });
        }

        var now = DateTime.UtcNow;
        if (status is "open" or "voting" or "evaluating")
        {
            challenge.IsActive = true;
            if (challenge.StartsAt > now)
            {
                challenge.StartsAt = now;
            }
            if (challenge.EndsAt <= now)
            {
                challenge.EndsAt = now.AddDays(30);
            }
        }
        else
        {
            challenge.IsActive = false;
            if (status is "closed" or "archived" && challenge.EndsAt > now)
            {
                challenge.EndsAt = now;
            }
        }

        challenge.UpdatedAt = now;
        await _db.SaveChangesAsync();

        return Ok(new { success = true, data = new { id, status } });
    }

    private async Task<IActionResult> ReviewModerationItem(int id)
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var payload = await ReadJsonObjectPayloadAsync();
        var decision = JsonString(payload, "decision")?.Trim().ToLowerInvariant();
        var rejectionReason = JsonString(payload, "rejection_reason")?.Trim();

        if (string.IsNullOrWhiteSpace(decision))
        {
            return BadRequest(new
            {
                success = false,
                error = "VALIDATION_ERROR",
                message = "Decision is required.",
                field = "decision"
            });
        }

        if (decision is not ("approved" or "rejected"))
        {
            return UnprocessableEntity(new
            {
                success = false,
                error = "VALIDATION_ERROR",
                message = "Invalid decision.",
                field = "decision"
            });
        }

        if (decision == "rejected" && string.IsNullOrWhiteSpace(rejectionReason))
        {
            return BadRequest(new
            {
                success = false,
                error = "REVIEW_FAILED",
                message = "Rejection reason is required.",
                field = "rejection_reason"
            });
        }

        var report = await _db.ContentReports
            .FirstOrDefaultAsync(r => r.TenantId == tenantId && r.Id == id);

        if (report == null)
        {
            return NotFound(new { success = false, error = "NOT_FOUND", message = "Moderation item not found." });
        }

        var currentStatus = MapModerationStatus(report.Status);
        if (currentStatus is "approved" or "rejected")
        {
            return BadRequest(new { success = false, error = "REVIEW_FAILED", message = "Moderation item has already been reviewed." });
        }

        report.Status = decision == "approved" ? ReportStatus.ActionTaken : ReportStatus.Dismissed;
        report.ReviewedById = GetCurrentAdminUserId();
        report.ReviewedAt = DateTime.UtcNow;
        report.ReviewNotes = rejectionReason;
        report.ActionTaken = decision;
        report.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new
        {
            success = true,
            data = new
            {
                success = true,
                message = $"Content {decision}.",
                content_type = report.ContentType,
                content_id = report.ContentId
            }
        });
    }

    private async Task<IActionResult> RegenerateApiPartnerCredentials(int id)
    {
        var partners = await LoadApiPartners();
        var partner = partners.FirstOrDefault(p => p.Id == id);
        if (partner == null)
        {
            return NotFound(new { error = "PARTNER_NOT_FOUND", message = "Partner not found." });
        }

        var credentials = IssueApiPartnerCredentials();
        partner.CurrentClientId = credentials.ClientId;
        partner.UpdatedAt = DateTime.UtcNow;
        await SaveApiPartners(partners);

        return StatusCode(StatusCodes.Status201Created, new
        {
            success = true,
            data = new
            {
                credentials = new
                {
                    client_id = credentials.ClientId,
                    client_secret = credentials.ClientSecret
                }
            }
        });
    }

    private async Task<IActionResult> GetApiPartnerCallLog(int id)
    {
        var partner = (await LoadApiPartners()).FirstOrDefault(p => p.Id == id);
        if (partner == null)
        {
            return NotFound(new { error = "PARTNER_NOT_FOUND", message = "Partner not found." });
        }

        var page = QueryInt("page", 1, 1, int.MaxValue);
        var perPage = QueryInt("per_page", 50, 1, 200);
        var rows = await LoadApiPartnerCallLog(id);
        var items = rows
            .OrderByDescending(r => r.Id)
            .Skip((page - 1) * perPage)
            .Take(perPage)
            .Select(r => new
            {
                id = r.Id,
                method = r.Method,
                path = r.Path,
                status_code = r.StatusCode,
                response_time_ms = r.ResponseTimeMs,
                ip = r.Ip,
                user_agent = r.UserAgent,
                created_at = r.CreatedAt
            })
            .ToList();

        return Ok(new
        {
            success = true,
            data = new
            {
                items,
                meta = new
                {
                    current_page = page,
                    per_page = perPage,
                    total = rows.Count,
                    total_pages = rows.Count == 0 ? 0 : (int)Math.Ceiling(rows.Count / (double)perPage)
                }
            }
        });
    }

    private async Task<IActionResult> GetAdminAdCampaigns()
    {
        var status = Request.Query["status"].ToString();
        var advertiserType = Request.Query["advertiser_type"].ToString();
        var campaigns = (await LoadLocalAdCampaigns())
            .Where(c => string.IsNullOrWhiteSpace(status) || string.Equals(c.Status, status, StringComparison.OrdinalIgnoreCase))
            .Where(c => string.IsNullOrWhiteSpace(advertiserType) || string.Equals(c.AdvertiserType, advertiserType, StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(c => c.CreatedAt)
            .Select(c => MapLocalAdCampaign(c))
            .ToList();

        return Ok(new { data = campaigns, meta = new { total = campaigns.Count } });
    }

    private async Task<IActionResult> GetAdminAdCampaignStats()
    {
        var campaigns = await LoadLocalAdCampaigns();
        return Ok(new
        {
            data = new
            {
                active_campaigns = campaigns.Count(c => c.Status == "active"),
                impressions_today = 0,
                clicks_today = 0,
                total_revenue_cents = campaigns.Sum(c => c.SpentCents)
            }
        });
    }

    private async Task<IActionResult> GetAdminAdCampaign(int id)
    {
        var campaign = (await LoadLocalAdCampaigns()).FirstOrDefault(c => c.Id == id);
        return campaign == null
            ? NotFound(new { error = "Campaign not found" })
            : Ok(new { data = MapLocalAdCampaign(campaign, includeStats: true) });
    }

    private async Task<IActionResult> ApproveAdCampaign(int id)
    {
        var campaigns = await LoadLocalAdCampaigns();
        var campaign = campaigns.FirstOrDefault(c => c.Id == id);
        if (campaign == null)
        {
            return NotFound(new { error = "Campaign not found" });
        }

        var now = DateTime.UtcNow;
        campaign.Status = "active";
        campaign.ApprovedBy = GetCurrentAdminUserId();
        campaign.ApprovedAt = now;
        campaign.RejectionReason = null;
        campaign.UpdatedAt = now;
        await SaveLocalAdCampaigns(campaigns);

        return Ok(new { data = MapLocalAdCampaign(campaign) });
    }

    private async Task<IActionResult> PauseAdCampaign(int id)
    {
        var campaigns = await LoadLocalAdCampaigns();
        var campaign = campaigns.FirstOrDefault(c => c.Id == id);
        if (campaign == null)
        {
            return NotFound(new { error = "Campaign not found" });
        }

        campaign.Status = "paused";
        campaign.UpdatedAt = DateTime.UtcNow;
        await SaveLocalAdCampaigns(campaigns);

        return Ok(new { data = new { id, status = "paused" } });
    }

    private async Task<IActionResult> RejectAdCampaign(int id)
    {
        var campaigns = await LoadLocalAdCampaigns();
        var campaign = campaigns.FirstOrDefault(c => c.Id == id);
        if (campaign == null)
        {
            return NotFound(new { error = "Campaign not found" });
        }

        var payload = await ReadJsonObjectPayloadAsync();
        var reason = JsonString(payload, "reason");
        if (string.IsNullOrWhiteSpace(reason))
        {
            return BadRequest(new { error = "VALIDATION_ERROR", field = "reason" });
        }

        campaign.Status = "rejected";
        campaign.RejectionReason = reason.Trim();
        campaign.UpdatedAt = DateTime.UtcNow;
        await SaveLocalAdCampaigns(campaigns);

        return Ok(new { data = new { id, status = "rejected" } });
    }

    private async Task<IActionResult> GetAdminPushCampaigns()
    {
        var status = Request.Query["status"].ToString();
        var campaigns = (await LoadPushCampaigns())
            .Where(c => string.IsNullOrWhiteSpace(status) || string.Equals(c.Status, status, StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(c => c.CreatedAt)
            .Select(c => MapPushCampaign(c))
            .ToList();

        return Ok(new { data = campaigns });
    }

    private async Task<IActionResult> GetAdminPushCampaignStats()
    {
        var campaigns = await LoadPushCampaigns();
        var byStatus = campaigns
            .GroupBy(c => c.Status)
            .ToDictionary(g => g.Key, g => g.Count(), StringComparer.OrdinalIgnoreCase);

        return Ok(new
        {
            data = new
            {
                total_campaigns = campaigns.Count,
                by_status = byStatus,
                sends_this_month = campaigns.Sum(c => c.ActualSendCount),
                opens_this_month = campaigns.Sum(c => c.OpenCount),
                revenue_cents_this_month = campaigns.Sum(c => c.TotalCostCents)
            }
        });
    }

    private async Task<IActionResult> GetAdminPushCampaign(int id)
    {
        var campaign = (await LoadPushCampaigns()).FirstOrDefault(c => c.Id == id);
        return campaign == null
            ? NotFound(new { error = "Campaign not found" })
            : Ok(new { data = MapPushCampaign(campaign, includeAnalytics: true) });
    }

    private async Task<IActionResult> ApprovePushCampaign(int id)
    {
        var campaigns = await LoadPushCampaigns();
        var campaign = campaigns.FirstOrDefault(c => c.Id == id);
        if (campaign == null)
        {
            return NotFound(new { error = "Campaign not found" });
        }

        if (campaign.Status != "pending_review")
        {
            return UnprocessableEntity(new { error = "APPROVAL_FAILED" });
        }

        var now = DateTime.UtcNow;
        campaign.Status = IsFutureDate(campaign.ScheduledAt) ? "scheduled" : "sending";
        campaign.TargetCount = await _db.Users.CountAsync(u => u.TenantId == _db.CurrentTenantId && u.IsActive);
        campaign.ApprovedBy = GetCurrentAdminUserId();
        campaign.ApprovedAt = now;
        campaign.UpdatedAt = now;
        await SavePushCampaigns(campaigns);

        return Ok(new { data = MapPushCampaign(campaign) });
    }

    private async Task<IActionResult> RejectPushCampaign(int id)
    {
        var campaigns = await LoadPushCampaigns();
        var campaign = campaigns.FirstOrDefault(c => c.Id == id);
        if (campaign == null)
        {
            return NotFound(new { error = "Campaign not found" });
        }

        var payload = await ReadJsonObjectPayloadAsync();
        var reason = JsonString(payload, "reason");
        if (string.IsNullOrWhiteSpace(reason))
        {
            return UnprocessableEntity(new { error = "VALIDATION_ERROR", field = "reason" });
        }

        campaign.Status = "rejected";
        campaign.RejectionReason = reason.Trim();
        campaign.UpdatedAt = DateTime.UtcNow;
        await SavePushCampaigns(campaigns);

        return Ok(new { data = new { rejected = true } });
    }

    private async Task<IActionResult> DispatchPushCampaign(int id)
    {
        var campaigns = await LoadPushCampaigns();
        var campaign = campaigns.FirstOrDefault(c => c.Id == id);
        if (campaign == null)
        {
            return NotFound(new { error = "Campaign not found" });
        }

        if (campaign.Status is not ("scheduled" or "sending"))
        {
            return UnprocessableEntity(new { error = "DISPATCH_FAILED" });
        }

        var sent = campaign.TargetCount ?? await _db.Users.CountAsync(u => u.TenantId == _db.CurrentTenantId && u.IsActive);
        campaign.Status = "sent";
        campaign.ActualSendCount = sent;
        campaign.TotalCostCents = sent * campaign.CostPerSend;
        campaign.SentAt = DateTime.UtcNow;
        campaign.UpdatedAt = DateTime.UtcNow;
        await SavePushCampaigns(campaigns);

        return Ok(new { data = new { sent, failed = 0, total_cost_cents = campaign.TotalCostCents } });
    }

    private async Task<IActionResult> GetBillingSubscription()
    {
        var subscription = await _db.UserSubscriptions
            .AsNoTracking()
            .Include(s => s.Plan)
            .OrderByDescending(s => s.CreatedAt)
            .FirstOrDefaultAsync();

        if (subscription == null)
        {
            return Ok(new { data = (object?)null });
        }

        var planTierLevel = await BillingPlanTierLevel(subscription.Plan);
        var currentPeriodEnd = subscription.NextBillingDate
            ?? subscription.ExpiresAt
            ?? subscription.StartedAt.AddMonths(1);

        return Ok(new
        {
            data = new
            {
                id = subscription.Id,
                plan_id = subscription.PlanId,
                plan_name = subscription.Plan?.Name ?? string.Empty,
                plan_tier_level = planTierLevel,
                status = BillingStatusForReact(subscription.Status),
                billing_interval = "monthly",
                current_period_start = subscription.StartedAt,
                current_period_end = currentPeriodEnd,
                trial_ends_at = (DateTime?)null,
                cancel_at_period_end = false,
                stripe_subscription_id = subscription.StripeSubscriptionId
            }
        });
    }

    private async Task<IActionResult> GetBillingInvoices()
    {
        var subscriptionRows = await _db.UserSubscriptions
            .AsNoTracking()
            .Include(s => s.Plan)
            .Include(s => s.User)
            .OrderByDescending(s => s.NextBillingDate ?? s.StartedAt)
            .Select(s => new
            {
                s.Id,
                s.UserId,
                user_email = s.User == null ? null : s.User.Email,
                plan_name = s.Plan == null ? null : s.Plan.Name,
                amount = s.Plan == null ? 0 : s.Plan.Price,
                currency = s.Plan == null ? "EUR" : s.Plan.Currency,
                s.Status,
                s.StartedAt,
                s.NextBillingDate,
                s.ExpiresAt,
                s.StripeSubscriptionId
            })
            .Take(200)
            .ToListAsync();

        var invoices = subscriptionRows
            .Select(s => (object)new
            {
                id = $"subscription-{s.Id}",
                number = $"SUB-{s.Id:D6}",
                invoice_number = $"SUB-{s.Id:D6}",
                date = s.StartedAt,
                created = s.StartedAt,
                source = "user_subscription",
                subscription_id = s.Id,
                user_id = s.UserId,
                s.user_email,
                s.plan_name,
                amount = s.amount,
                amount_paid = s.Status == SubscriptionStatus.Active ? s.amount : 0,
                s.currency,
                status = BillingInvoiceStatusForReact(s.Status),
                issued_at = s.StartedAt,
                due_at = s.NextBillingDate,
                paid_at = s.Status == SubscriptionStatus.Active ? s.StartedAt : (DateTime?)null,
                expires_at = s.ExpiresAt,
                hosted_invoice_url = (string?)null,
                invoice_pdf = (string?)null,
                has_stripe_subscription = !string.IsNullOrWhiteSpace(s.StripeSubscriptionId)
            })
            .ToList();

        var persistedInvoices = await LoadStoredRecordsAsync(BillingInvoicesKey);
        invoices.AddRange(persistedInvoices.Select(ToResponseRecord));

        return Ok(new
        {
            data = invoices,
            meta = new
            {
                total = invoices.Count,
                subscription_backed = subscriptionRows.Count,
                persisted = persistedInvoices.Count
            }
        });
    }

    private async Task<IActionResult> GetBillingSnapshot()
    {
        var activeSubscriptions = await _db.UserSubscriptions.CountAsync(s => s.Status == SubscriptionStatus.Active);
        var pastDueSubscriptions = await _db.UserSubscriptions.CountAsync(s => s.Status == SubscriptionStatus.PastDue);
        var monthlyRevenue = await ActiveMonthlyRevenue();

        return Ok(new
        {
            data = new
            {
                plans = await _db.SubscriptionPlans.CountAsync(),
                active_plans = await _db.SubscriptionPlans.CountAsync(p => p.IsActive),
                subscriptions = await _db.UserSubscriptions.CountAsync(),
                active_subscriptions = activeSubscriptions,
                past_due_subscriptions = pastDueSubscriptions,
                monthly_recurring_revenue = monthlyRevenue,
                currency = await DefaultBillingCurrency(),
                generated_at = DateTime.UtcNow
            }
        });
    }

    private IActionResult GetFederationJwtStatus()
    {
        var secret = _configuration["Federation:JwtSecret"]
            ?? _configuration["Federation:JWT_SECRET"]
            ?? _configuration["Jwt:Secret"]
            ?? Environment.GetEnvironmentVariable("FEDERATION_JWT_SECRET")
            ?? Environment.GetEnvironmentVariable("JWT_SECRET")
            ?? string.Empty;
        var issuer = _configuration["Federation:Issuer"]
            ?? _configuration["Federation:JwtIssuer"]
            ?? _configuration["Jwt:Issuer"]
            ?? $"{Request.Scheme}://{Request.Host}";

        return Ok(new
        {
            data = new
            {
                configured = !string.IsNullOrWhiteSpace(secret),
                issuer,
                key_bits = CalculateLaravelJwtKeyBits(secret),
                recommended_bits = 256
            }
        });
    }

    private static int CalculateLaravelJwtKeyBits(string secret)
    {
        if (string.IsNullOrEmpty(secret))
            return 0;

        var raw = secret.StartsWith("base64:", StringComparison.OrdinalIgnoreCase)
            ? TryDecodeBase64Secret(secret[7..])
            : secret;

        return IsHex(raw) ? raw.Length * 4 : raw.Length * 8;
    }

    private static string TryDecodeBase64Secret(string encoded)
    {
        try
        {
            return Encoding.UTF8.GetString(Convert.FromBase64String(encoded));
        }
        catch (FormatException)
        {
            return encoded;
        }
    }

    private static bool IsHex(string value)
        => value.Length > 0 && value.All(Uri.IsHexDigit);

    private async Task<IActionResult> GetBillingRevenue()
    {
        var byPlan = await _db.UserSubscriptions
            .AsNoTracking()
            .Where(s => s.Status == SubscriptionStatus.Active)
            .GroupBy(s => new { s.PlanId, s.Plan!.Name, s.Plan.Currency, s.Plan.Price })
            .Select(g => new
            {
                plan_id = g.Key.PlanId,
                plan_name = g.Key.Name,
                currency = g.Key.Currency,
                active_subscriptions = g.Count(),
                monthly_revenue = g.Count() * g.Key.Price
            })
            .ToListAsync();

        return Ok(new
        {
            data = new
            {
                monthly_recurring_revenue = byPlan.Sum(p => p.monthly_revenue),
                currency = byPlan.FirstOrDefault()?.currency ?? await DefaultBillingCurrency(),
                by_plan = byPlan,
                generated_at = DateTime.UtcNow
            }
        });
    }

    private async Task<IActionResult> GetBillingExportCsv()
    {
        var rows = await _db.UserSubscriptions
            .AsNoTracking()
            .Include(s => s.Plan)
            .OrderBy(s => s.Id)
            .Select(s => new
            {
                s.Id,
                s.UserId,
                plan = s.Plan == null ? string.Empty : s.Plan.Name,
                s.Status,
                price = s.Plan == null ? 0 : s.Plan.Price,
                currency = s.Plan == null ? string.Empty : s.Plan.Currency,
                s.StartedAt,
                s.NextBillingDate
            })
            .ToListAsync();

        var csv = new StringBuilder("id,user_id,plan,status,price,currency,started_at,next_billing_date\n");
        foreach (var row in rows)
        {
            csv.AppendLine($"{row.Id},{row.UserId},{Csv(row.plan)},{row.Status},{row.price},{row.currency},{row.StartedAt:O},{row.NextBillingDate:O}");
        }

        return File(Encoding.UTF8.GetBytes(csv.ToString()), "text/csv", "billing-subscriptions.csv");
    }

    private async Task<IActionResult> GetEnterpriseFeatures()
    {
        var tenantId = _db.CurrentTenantId;
        var features = await _db.EnterpriseConfigs
            .AsNoTracking()
            .Where(c => !tenantId.HasValue || c.TenantId == tenantId.Value)
            .Where(c => c.Category == "features" || c.Key.StartsWith("feature."))
            .OrderBy(c => c.Key)
            .Select(c => new { c.Key, c.Value, c.Description, c.UpdatedAt })
            .ToListAsync();

        return Ok(new { data = features, meta = new { total = features.Count } });
    }

    private async Task<IActionResult> GetGdprConsentTypes()
    {
        var rows = await _db.GdprConsentTypes.AsNoTracking()
            .OrderBy(c => c.Key)
            .Select(c => new { c.Id, slug = c.Key, c.Name, c.Description, c.IsRequired, c.Version, c.IsActive, c.CreatedAt, c.UpdatedAt })
            .ToListAsync();

        return Ok(new { data = rows, meta = new { total = rows.Count } });
    }

    private async Task<IActionResult> GetGdprStatistics()
    {
        return Ok(new
        {
            data = new
            {
                consent_records = await _db.ConsentRecords.CountAsync(),
                granted_consents = await _db.ConsentRecords.CountAsync(c => c.IsGranted),
                revoked_consents = await _db.ConsentRecords.CountAsync(c => !c.IsGranted),
                export_requests = await _db.DataExportRequests.CountAsync(),
                pending_export_requests = await _db.DataExportRequests.CountAsync(r => r.Status == ExportStatus.Pending),
                deletion_requests = await _db.DataDeletionRequests.CountAsync(),
                pending_deletion_requests = await _db.DataDeletionRequests.CountAsync(r => r.Status == DeletionStatus.Pending),
                breaches = await _db.GdprBreaches.CountAsync(),
                open_breaches = await _db.GdprBreaches.CountAsync(b => b.ResolvedAt == null),
                generated_at = DateTime.UtcNow
            }
        });
    }

    private async Task<IActionResult> GetGdprTrends()
    {
        var since = DateTime.UtcNow.Date.AddDays(-29);
        var exports = await _db.DataExportRequests.AsNoTracking()
            .Where(r => r.RequestedAt >= since)
            .GroupBy(r => r.RequestedAt.Date)
            .Select(g => new { date = g.Key, export_requests = g.Count() })
            .ToListAsync();

        var deletions = await _db.DataDeletionRequests.AsNoTracking()
            .Where(r => r.CreatedAt >= since)
            .GroupBy(r => r.CreatedAt.Date)
            .Select(g => new { date = g.Key, deletion_requests = g.Count() })
            .ToListAsync();

        return Ok(new { data = new { since, exports, deletions } });
    }

    private async Task<IActionResult> CreateGdprRequest()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var payload = await ReadJsonObjectPayloadAsync();
        var userId = JsonInt(payload, "user_id", 0, 0, int.MaxValue);
        var type = (JsonString(payload, "type") ?? string.Empty).Trim().ToLowerInvariant();
        var notes = JsonString(payload, "notes");

        if (userId <= 0)
        {
            return UnprocessableEntity(new
            {
                success = false,
                errors = new[] { new { code = "VALIDATION_ERROR", message = "user_id is required", field = "user_id" } }
            });
        }

        var validTypes = new[] { "access", "erasure", "portability", "rectification", "restriction", "objection" };
        if (!validTypes.Contains(type))
        {
            return UnprocessableEntity(new
            {
                success = false,
                errors = new[] { new { code = "VALIDATION_ERROR", message = "Invalid GDPR request type", field = "type" } }
            });
        }

        var userExists = await _db.Users.AnyAsync(u => u.Id == userId);
        if (!userExists)
        {
            return NotFound(new { success = false, error = "User not found" });
        }

        var now = DateTime.UtcNow;
        int requestId;
        if (type == "erasure")
        {
            var deletion = new DataDeletionRequest
            {
                TenantId = tenantId,
                UserId = userId,
                Status = DeletionStatus.Pending,
                Reason = notes,
                CreatedAt = now
            };
            _db.DataDeletionRequests.Add(deletion);
            await _db.SaveChangesAsync();
            requestId = deletion.Id;
        }
        else
        {
            var export = new DataExportRequest
            {
                TenantId = tenantId,
                UserId = userId,
                Status = ExportStatus.Pending,
                Format = type,
                ErrorMessage = notes,
                RequestedAt = now,
                CreatedAt = now
            };
            _db.DataExportRequests.Add(export);
            await _db.SaveChangesAsync();
            requestId = export.Id;
        }

        return StatusCode(StatusCodes.Status201Created, new
        {
            success = true,
            data = new
            {
                id = requestId,
                type,
                status = "pending",
                message = "GDPR request created"
            }
        });
    }

    private async Task<IActionResult> GetGdprBreach(int id)
    {
        var breach = await _db.GdprBreaches.AsNoTracking().FirstOrDefaultAsync(b => b.Id == id);
        return breach == null ? NotFound(new { error = "GDPR breach not found" }) : Ok(new { data = breach });
    }

    private async Task<IActionResult> GetGdprRequest(int id)
    {
        var exportRequest = await _db.DataExportRequests
            .AsNoTracking()
            .Include(r => r.User)
            .FirstOrDefaultAsync(r => r.Id == id);
        var deletionRequest = await _db.DataDeletionRequests
            .AsNoTracking()
            .Include(r => r.User)
            .FirstOrDefaultAsync(r => r.Id == id);

        if (exportRequest == null && deletionRequest == null)
        {
            return NotFound(new { error = "GDPR request not found" });
        }

        var data = exportRequest != null
            ? MapLaravelGdprRequestDetail(exportRequest)
            : MapLaravelGdprRequestDetail(deletionRequest!);

        return Ok(new { data });
    }

    private async Task<IActionResult> GetConsentTypeUsers(string slug)
    {
        var rows = await _db.ConsentRecords.AsNoTracking()
            .Where(c => c.ConsentType == slug)
            .OrderByDescending(c => c.UpdatedAt ?? c.CreatedAt)
            .Select(c => new { c.UserId, c.ConsentType, c.IsGranted, c.GrantedAt, c.RevokedAt, c.CreatedAt, c.UpdatedAt })
            .ToListAsync();

        return Ok(new { data = rows, meta = new { total = rows.Count } });
    }

    private static object MapLaravelGdprRequestDetail(DataExportRequest request)
    {
        var type = MapGdprExportType(request.Format);
        var status = MapExportStatus(request.Status);
        var sla = BuildGdprSla(request.CreatedAt);

        return new
        {
            id = request.Id,
            user_id = request.UserId,
            user_name = DisplayName(request.User),
            user_email = request.User?.Email,
            type,
            request_type = type,
            status,
            priority = "normal",
            notes = request.ErrorMessage,
            created_at = request.CreatedAt,
            completed_at = request.CompletedAt,
            verified_at = (DateTime?)null,
            acknowledged_at = (DateTime?)null,
            processed_at = request.CompletedAt,
            processed_by = (int?)null,
            assigned_to = (int?)null,
            assigned_to_name = (string?)null,
            export_file_path = request.FileUrl,
            export_expires_at = request.ExpiresAt,
            rejection_reason = status == "rejected" ? request.ErrorMessage : null,
            metadata = (object?)null,
            timeline = Array.Empty<object>(),
            sla_deadline = sla.deadline,
            sla_days_remaining = sla.daysRemaining,
            sla_overdue = sla.overdue
        };
    }

    private static object MapLaravelGdprRequestDetail(DataDeletionRequest request)
    {
        var status = MapDeletionStatus(request.Status);
        var sla = BuildGdprSla(request.CreatedAt);

        return new
        {
            id = request.Id,
            user_id = request.UserId,
            user_name = DisplayName(request.User),
            user_email = request.User?.Email,
            type = "erasure",
            request_type = "erasure",
            status,
            priority = "normal",
            notes = request.Reason,
            created_at = request.CreatedAt,
            completed_at = request.CompletedAt,
            verified_at = (DateTime?)null,
            acknowledged_at = (DateTime?)null,
            processed_at = request.CompletedAt,
            processed_by = request.ReviewedById,
            assigned_to = request.ReviewedById,
            assigned_to_name = DisplayName(request.ReviewedBy),
            export_file_path = (string?)null,
            export_expires_at = (DateTime?)null,
            rejection_reason = status == "rejected" ? request.DataRetainedReason ?? request.Reason : null,
            metadata = (object?)null,
            timeline = Array.Empty<object>(),
            sla_deadline = sla.deadline,
            sla_days_remaining = sla.daysRemaining,
            sla_overdue = sla.overdue
        };
    }

    private static (DateTime deadline, int daysRemaining, bool overdue) BuildGdprSla(DateTime createdAt)
    {
        var deadline = createdAt.AddDays(30);
        var daysRemaining = (int)Math.Ceiling((deadline - DateTime.UtcNow).TotalDays);
        return (deadline, Math.Max(0, daysRemaining), daysRemaining < 0);
    }

    private static string DisplayName(User? user)
        => user == null
            ? string.Empty
            : string.Join(" ", new[] { user.FirstName, user.LastName }.Where(part => !string.IsNullOrWhiteSpace(part))).Trim();

    private static string MapGdprExportType(string? format)
    {
        var value = format?.Trim().ToLowerInvariant();
        return value is "access" or "portability" or "rectification" or "restriction" or "objection"
            ? value
            : "access";
    }

    private static string MapExportStatus(ExportStatus status)
        => status switch
        {
            ExportStatus.Pending => "pending",
            ExportStatus.Processing => "processing",
            ExportStatus.Ready or ExportStatus.Downloaded => "completed",
            ExportStatus.Failed or ExportStatus.Expired => "rejected",
            _ => "pending"
        };

    private static string MapDeletionStatus(DeletionStatus status)
        => status switch
        {
            DeletionStatus.Pending or DeletionStatus.Approved => "pending",
            DeletionStatus.Processing => "processing",
            DeletionStatus.Completed => "completed",
            DeletionStatus.Rejected => "rejected",
            _ => "pending"
        };

    private async Task<IActionResult> GetConsentTypeExport(string slug)
    {
        var rows = await _db.ConsentRecords.AsNoTracking()
            .Where(c => c.ConsentType == slug)
            .OrderBy(c => c.UserId)
            .ToListAsync();

        var csv = new StringBuilder("user_id,consent_type,is_granted,granted_at,revoked_at,created_at,updated_at\n");
        foreach (var row in rows)
        {
            csv.AppendLine($"{row.UserId},{Csv(row.ConsentType)},{row.IsGranted},{row.GrantedAt:O},{row.RevokedAt:O},{row.CreatedAt:O},{row.UpdatedAt:O}");
        }

        return File(Encoding.UTF8.GetBytes(csv.ToString()), "text/csv", $"consent-{slug}.csv");
    }

    private async Task<IActionResult> GetConsentLedger()
    {
        var rows = await _db.ConsentRecords.AsNoTracking()
            .OrderByDescending(c => c.UpdatedAt ?? c.CreatedAt)
            .Take(200)
            .Select(c => new { c.Id, c.UserId, c.ConsentType, c.IsGranted, c.GrantedAt, c.RevokedAt, c.CreatedAt, c.UpdatedAt })
            .ToListAsync();

        return Ok(new { data = rows, meta = new { total = rows.Count } });
    }

    private async Task<IActionResult> GetProcessingRegister()
    {
        var documents = await _db.LegalDocuments.AsNoTracking()
            .OrderBy(d => d.Slug)
            .Select(d => new { d.Slug, d.Title, d.Version, d.IsActive, d.RequiresAcceptance, d.UpdatedAt })
            .ToListAsync();

        var consentTypes = await _db.GdprConsentTypes.AsNoTracking()
            .OrderBy(c => c.Key)
            .Select(c => new { slug = c.Key, c.Name, c.Description, c.IsRequired, c.Version, c.IsActive })
            .ToListAsync();

        return Ok(new { data = new { legal_documents = documents, consent_types = consentTypes } });
    }

    private async Task<IActionResult> GetProcessingRegisterCsv()
    {
        var rows = await _db.GdprConsentTypes.AsNoTracking().OrderBy(c => c.Key).ToListAsync();
        var csv = new StringBuilder("slug,name,description,is_required,version,is_active\n");
        foreach (var row in rows)
        {
            csv.AppendLine($"{Csv(row.Key)},{Csv(row.Name)},{Csv(row.Description)},{row.IsRequired},{row.Version},{row.IsActive}");
        }

        return File(Encoding.UTF8.GetBytes(csv.ToString()), "text/csv", "processing-register.csv");
    }

    private async Task<IActionResult> GetMonitoringRequirements()
    {
        return Ok(new
        {
            data = new
            {
                database = "postgresql",
                scheduled_tasks = await _db.ScheduledTasks.CountAsync(),
                failed_scheduled_tasks = await _db.ScheduledTasks.CountAsync(t => t.Status == ScheduledTaskStatus.Failed),
                email_pending = await _db.EmailLogs.CountAsync(e => e.Status == EmailSendStatus.Pending),
                open_gdpr_breaches = await _db.GdprBreaches.CountAsync(b => b.ResolvedAt == null),
                active_announcements = await _db.PlatformAnnouncements.CountAsync(a => a.IsActive),
                checked_at = DateTime.UtcNow
            }
        });
    }

    private async Task<IActionResult> GetFederationActivity()
    {
        // Server-side filtering + pagination.
        var q = Request.Query;
        var partner = q["partner"].FirstOrDefault();
        var source = (q["source"].FirstOrDefault() ?? string.Empty).ToLowerInvariant();
        var severityFilter = (q["severity"].FirstOrDefault() ?? string.Empty).ToLowerInvariant();
        var eventType = q["event_type"].FirstOrDefault();
        var search = q["q"].FirstOrDefault();
        var sinceStr = q["since"].FirstOrDefault();
        var untilStr = q["until"].FirstOrDefault();
        DateTime? since = DateTime.TryParse(sinceStr, out var sParsed) ? sParsed.ToUniversalTime() : (DateTime?)null;
        DateTime? until = DateTime.TryParse(untilStr, out var uParsed) ? uParsed.ToUniversalTime() : (DateTime?)null;
        int page = int.TryParse(q["page"].FirstOrDefault(), out var p) && p >= 1 ? p : 1;
        int pageSize = int.TryParse(q["page_size"].FirstOrDefault(), out var ps) ? ps : 50;
        if (pageSize < 1) pageSize = 1;
        if (pageSize > 200) pageSize = 200;
        int? partnerId = int.TryParse(partner, out var pid) ? pid : (int?)null;

        var includeAudit = string.IsNullOrEmpty(source) || source == "audit";
        var includeApi = string.IsNullOrEmpty(source) || source == "api";

        IQueryable<ActivityRow> auditQuery = _db.FederationAuditLogs.AsNoTracking()
            .Select(l => new ActivityRow
            {
                Source = "audit",
                Id = l.Id,
                Action = l.Action,
                EntityType = l.EntityType,
                EntityId = l.EntityId,
                PartnerTenantId = l.PartnerTenantId,
                CreatedAt = l.CreatedAt,
                StatusCode = (int?)null
            });

        if (partnerId.HasValue) auditQuery = auditQuery.Where(r => r.PartnerTenantId == partnerId);
        if (!string.IsNullOrWhiteSpace(eventType)) auditQuery = auditQuery.Where(r => r.Action != null && r.Action.Contains(eventType));
        if (!string.IsNullOrWhiteSpace(search)) auditQuery = auditQuery.Where(r =>
            (r.Action != null && r.Action.Contains(search)) ||
            (r.EntityType != null && r.EntityType.Contains(search)));
        if (since.HasValue) auditQuery = auditQuery.Where(r => r.CreatedAt >= since.Value);
        if (until.HasValue) auditQuery = auditQuery.Where(r => r.CreatedAt <= until.Value);

        IQueryable<ActivityRow> apiQuery = _db.FederationApiLogs.AsNoTracking()
            .Select(l => new ActivityRow
            {
                Source = "api",
                Id = l.Id,
                Action = l.HttpMethod + " " + l.Path,
                EntityType = (string?)null,
                EntityId = (int?)null,
                PartnerTenantId = l.TenantId,
                CreatedAt = l.CreatedAt,
                StatusCode = l.StatusCode
            });

        if (partnerId.HasValue) apiQuery = apiQuery.Where(r => r.PartnerTenantId == partnerId);
        if (!string.IsNullOrWhiteSpace(eventType)) apiQuery = apiQuery.Where(r => r.Action != null && r.Action.Contains(eventType));
        if (!string.IsNullOrWhiteSpace(search)) apiQuery = apiQuery.Where(r => r.Action != null && r.Action.Contains(search));
        if (since.HasValue) apiQuery = apiQuery.Where(r => r.CreatedAt >= since.Value);
        if (until.HasValue) apiQuery = apiQuery.Where(r => r.CreatedAt <= until.Value);

        var auditRows = includeAudit ? await auditQuery.OrderByDescending(r => r.CreatedAt).Take(2000).ToListAsync() : new List<ActivityRow>();
        var apiRows = includeApi ? await apiQuery.OrderByDescending(r => r.CreatedAt).Take(2000).ToListAsync() : new List<ActivityRow>();

        IEnumerable<ActivityRow> merged = auditRows.Concat(apiRows);

        if (!string.IsNullOrWhiteSpace(severityFilter) && severityFilter != "all")
        {
            merged = merged.Where(r => ClassifyActivitySeverity(r) == severityFilter);
        }

        var ordered = merged.OrderByDescending(r => r.CreatedAt).ToList();
        var total = ordered.Count;
        var totalPages = total == 0 ? 0 : (int)Math.Ceiling(total / (double)pageSize);
        var pageItems = ordered.Skip((page - 1) * pageSize).Take(pageSize)
            .Select(r => new
            {
                source = r.Source,
                id = r.Id,
                action = r.Action,
                entityType = r.EntityType,
                entityId = r.EntityId,
                partnerTenantId = r.PartnerTenantId,
                createdAt = r.CreatedAt,
                severity = ClassifyActivitySeverity(r),
                statusCode = r.StatusCode
            })
            .ToList();

        return Ok(new
        {
            data = pageItems,
            items = pageItems,
            total,
            page,
            page_size = pageSize,
            total_pages = totalPages,
            meta = new { total, page, page_size = pageSize, total_pages = totalPages }
        });
    }

    private sealed class ActivityRow
    {
        public string Source { get; set; } = string.Empty;
        public int Id { get; set; }
        public string? Action { get; set; }
        public string? EntityType { get; set; }
        public int? EntityId { get; set; }
        public int? PartnerTenantId { get; set; }
        public DateTime CreatedAt { get; set; }
        public int? StatusCode { get; set; }
    }

    /// <summary>
    /// Mirrors the client-side severity classifier previously in
    /// AdminFederationActivityPage.tsx — error/warning/info inferred from
    /// action text + HTTP status code.
    /// </summary>
    private static string ClassifyActivitySeverity(ActivityRow r)
    {
        if (r.StatusCode.HasValue)
        {
            if (r.StatusCode.Value >= 500) return "error";
            if (r.StatusCode.Value >= 400) return "warning";
        }
        var lower = (r.Action ?? string.Empty).ToLowerInvariant();
        if (lower.Contains("fail") || lower.Contains("error") || lower.Contains("reject")) return "error";
        if (lower.Contains("warn") || lower.Contains("retry") || lower.Contains("cancel")) return "warning";
        return "info";
    }

    private async Task<IActionResult> GetFederationAnalyticsOverview()
    {
        return Ok(new
        {
            data = new
            {
                partners = await _db.FederationPartners.CountAsync(),
                active_partners = await _db.FederationPartners.CountAsync(p => p.Status == PartnerStatus.Active),
                api_keys = await _db.FederationApiKeys.CountAsync(),
                active_api_keys = await _db.FederationApiKeys.CountAsync(k => k.IsActive),
                api_calls = await _db.FederationApiLogs.CountAsync(),
                failed_api_calls = await _db.FederationApiLogs.CountAsync(l => l.StatusCode >= 400),
                federated_listings = await _db.FederatedListings.CountAsync(),
                federated_exchanges = await _db.FederatedExchanges.CountAsync(),
                generated_at = DateTime.UtcNow
            }
        });
    }

    private async Task<IActionResult> GetFederationCreditBalances()
    {
        var balances = await _db.FederationPartners.AsNoTracking()
            .GroupBy(p => p.PartnerTenantId)
            .Select(g => new
            {
                partner_tenant_id = g.Key,
                agreements = g.Count(),
                active_agreements = g.Count(p => p.Status == PartnerStatus.Active),
                average_exchange_rate = g.Average(p => p.CreditExchangeRate)
            })
            .ToListAsync();

        return Ok(new
        {
            data = balances,
            note = "V2 has federation partnership exchange rates but no persisted cross-tenant credit-balance ledger."
        });
    }

    private async Task<IActionResult> GetFederationTopics()
    {
        if (!TryRequireTenant(out _, out var tenantError)) return tenantError!;

        var stored = await GetTenantConfigValueAsync(FederationTopicsKey);
        if (!string.IsNullOrWhiteSpace(stored))
        {
            var storedPayload = ParseStoredPayload(stored);
            return Ok(new
            {
                data = storedPayload,
                meta = new { source = "tenant_config", total = CountPayloadItems(storedPayload) }
            });
        }

        var subscribed = await GetSubscribedTopicKeys();
        var topics = DefaultFederationTopics()
            .Select(t => new
            {
                t.id,
                t.key,
                t.name,
                t.description,
                status = "active",
                subscribed = subscribed.Contains(t.key)
            })
            .ToList();

        return Ok(new
        {
            data = topics,
            meta = new { source = "v1_compatibility_defaults", total = topics.Count }
        });
    }

    private async Task<IActionResult> GetFederationTopicSubscriptions()
    {
        if (!TryRequireTenant(out _, out var tenantError)) return tenantError!;

        var stored = await GetTenantConfigValueAsync(FederationTopicSubscriptionsKey);
        var data = string.IsNullOrWhiteSpace(stored)
            ? new { topics = Array.Empty<string>(), updated_at = (DateTime?)null }
            : ParseStoredPayload(stored);

        return Ok(new
        {
            data,
            meta = new { source = "tenant_config", total = CountPayloadItems(data) }
        });
    }

    private async Task<IActionResult> PutFederationTopicSubscriptions()
    {
        if (!TryRequireTenant(out _, out var tenantError)) return tenantError!;

        var payloadJson = await ReadRequestPayloadJsonAsync();
        await UpsertTenantConfigValueAsync(FederationTopicSubscriptionsKey, payloadJson);
        await _db.SaveChangesAsync();

        var data = ParseStoredPayload(payloadJson);
        return Ok(new
        {
            success = true,
            data,
            compatibility = new
            {
                mode = "tenant_config",
                key = FederationTopicSubscriptionsKey
            }
        });
    }

    private async Task<IActionResult> GetFederationWebhooks()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var subs = await _webhookService.ListAsync(tenantId);
        return Ok(new
        {
            data = subs.Select(WebhookSubscriptionToResponse).ToList(),
            meta = new { source = "typed_entity", total = subs.Count }
        });
    }

    private async Task<IActionResult> GetFederationWebhookLogs(int webhookId)
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var logs = await _webhookService.GetLogsAsync(tenantId, webhookId);
        return Ok(new
        {
            data = logs.Select(l => new
            {
                id = l.Id,
                subscription_id = l.SubscriptionId,
                success = l.Success,
                reason = l.Reason,
                action = l.Action,
                payload = ParseStoredPayload(l.PayloadJson),
                created_at = l.CreatedAt
            }).ToList(),
            meta = new { source = "typed_entity", webhook_id = webhookId, total = logs.Count }
        });
    }

    private async Task<IActionResult> CreateFederationWebhook()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var payloadJson = await ReadRequestPayloadJsonAsync();
        var input = ParseWebhookInput(payloadJson);
        var created = await _webhookService.CreateAsync(tenantId, GetCurrentAdminUserId(), input);
        return StatusCode(StatusCodes.Status201Created, new
        {
            success = true,
            data = WebhookSubscriptionToResponse(created)
        });
    }

    private async Task<IActionResult> UpdateFederationWebhook(int id)
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var payloadJson = await ReadRequestPayloadJsonAsync();
        var input = ParseWebhookInput(payloadJson);
        var updated = await _webhookService.UpdateAsync(tenantId, id, input);
        if (updated == null) return NotFound(new { error = "webhook_not_found", id });
        return Ok(new { success = true, data = WebhookSubscriptionToResponse(updated) });
    }

    private async Task<IActionResult> DeleteFederationWebhook(int id)
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;
        var deleted = await _webhookService.DeleteAsync(tenantId, id);
        if (!deleted) return NotFound(new { error = "webhook_not_found", id });
        return Ok(new { success = true, id });
    }

    private async Task<IActionResult> GetFederationCreditAgreements()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var records = await LoadFederationCreditAgreements();
        var tenantIds = records
            .Where(r => r.FromTenantId == tenantId || r.ToTenantId == tenantId)
            .SelectMany(r => new[] { r.FromTenantId, r.ToTenantId })
            .Append(tenantId)
            .Distinct()
            .ToArray();
        var tenants = await LoadTenantLookup(tenantIds);

        var data = records
            .Where(r => r.FromTenantId == tenantId || r.ToTenantId == tenantId)
            .OrderByDescending(r => r.CreatedAt)
            .Select(r => FormatFederationCreditAgreement(r, tenants))
            .ToList();

        return Ok(new { success = true, data });
    }

    private async Task<IActionResult> CreateFederationCreditAgreement()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var payload = await ReadJsonObjectPayloadAsync();
        var partnerTenantId = JsonInt(payload, "partner_tenant_id", fallback: 0, min: 0, max: int.MaxValue);
        var exchangeRate = JsonDecimal(payload, "exchange_rate", fallback: 0m);
        var monthlyLimit = JsonDecimal(payload, "monthly_limit", fallback: 0m);
        if (monthlyLimit <= 0m)
        {
            monthlyLimit = JsonDecimal(payload, "max_monthly_credits", fallback: 0m);
        }

        if (partnerTenantId <= 0)
        {
            return BadRequest(new { error = "VALIDATION_ERROR", field = "partner_tenant_id" });
        }

        if (partnerTenantId == tenantId)
        {
            return BadRequest(new { error = "VALIDATION_ERROR", field = "partner_tenant_id", message = "Cannot create agreement with the current tenant." });
        }

        if (exchangeRate <= 0m)
        {
            return BadRequest(new { error = "VALIDATION_ERROR", field = "exchange_rate" });
        }

        if (monthlyLimit <= 0m)
        {
            return BadRequest(new { error = "VALIDATION_ERROR", field = "monthly_limit" });
        }

        var partnerExists = await _db.Tenants
            .AsNoTracking()
            .AnyAsync(t => t.Id == partnerTenantId && t.IsActive);
        if (!partnerExists)
        {
            return NotFound(new { error = "PARTNER_TENANT_NOT_FOUND", field = "partner_tenant_id" });
        }

        var records = await LoadFederationCreditAgreements();
        var duplicate = records.Any(r =>
            r.Status is "pending" or "active" &&
            ((r.FromTenantId == tenantId && r.ToTenantId == partnerTenantId) ||
             (r.FromTenantId == partnerTenantId && r.ToTenantId == tenantId)));
        if (duplicate)
        {
            return Conflict(new { error = "CREATE_FAILED", message = "Agreement already exists between these tenants." });
        }

        var now = DateTime.UtcNow;
        var record = new FederationCreditAgreementRecord
        {
            Id = records.Count == 0 ? 1 : records.Max(r => r.Id) + 1,
            FromTenantId = tenantId,
            ToTenantId = partnerTenantId,
            ExchangeRate = exchangeRate,
            MaxMonthlyCredits = monthlyLimit,
            Status = "pending",
            ApprovedByFrom = GetCurrentAdminUserId(),
            CreatedAt = now,
            UpdatedAt = now
        };
        records.Add(record);
        await SaveFederationCreditAgreements(records);

        var tenants = await LoadTenantLookup(new[] { record.FromTenantId, record.ToTenantId });
        return StatusCode(StatusCodes.Status201Created, new
        {
            success = true,
            data = FormatFederationCreditAgreement(record, tenants)
        });
    }

    private async Task<IActionResult> UpdateFederationCreditAgreementStatus(int id, string action)
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var status = action switch
        {
            "approve" or "activate" or "reactivate" => "active",
            "suspend" => "suspended",
            "reject" or "terminate" => "terminated",
            _ => null
        };
        if (status == null)
        {
            return BadRequest(new { error = "VALIDATION_ERROR", field = "action" });
        }

        var records = await LoadFederationCreditAgreements();
        var record = records.FirstOrDefault(r => r.Id == id && (r.FromTenantId == tenantId || r.ToTenantId == tenantId));
        if (record == null)
        {
            return NotFound(new { error = "NOT_FOUND", message = "Credit agreement not found." });
        }

        record.Status = status;
        record.UpdatedAt = DateTime.UtcNow;
        var adminId = GetCurrentAdminUserId();
        if (action == "approve")
        {
            if (record.FromTenantId == tenantId) record.ApprovedByFrom = adminId;
            if (record.ToTenantId == tenantId) record.ApprovedByTo = adminId;
        }

        await SaveFederationCreditAgreements(records);
        return Ok(new { success = true, data = new { success = true } });
    }

    private static FederationWebhookSubscription ParseWebhookInput(string payloadJson)
    {
        var sub = new FederationWebhookSubscription();
        if (string.IsNullOrWhiteSpace(payloadJson)) return sub;
        try
        {
            using var doc = JsonDocument.Parse(payloadJson);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return sub;
            if (TryFindProperty(doc.RootElement, "name", out var n)) sub.Name = JsonElementToString(n) ?? string.Empty;
            if (TryFindProperty(doc.RootElement, "target_url", out var t) ||
                TryFindProperty(doc.RootElement, "url", out t)) sub.TargetUrl = JsonElementToString(t) ?? string.Empty;
            if (TryFindProperty(doc.RootElement, "event_types", out var ev)) sub.EventTypes = JsonElementToString(ev) ?? string.Empty;
            if (TryFindProperty(doc.RootElement, "secret", out var s)) sub.Secret = JsonElementToString(s);
            if (TryFindProperty(doc.RootElement, "direction", out var d))
            {
                var dv = (JsonElementToString(d) ?? "outbound").ToLowerInvariant();
                sub.Direction = dv == "inbound" ? FederationWebhookDirection.Inbound : FederationWebhookDirection.Outbound;
            }
            if (TryFindProperty(doc.RootElement, "status", out var st))
            {
                var sv = (JsonElementToString(st) ?? "active").ToLowerInvariant();
                sub.Status = sv switch
                {
                    "paused" or "disabled" or "inactive" => FederationWebhookStatus.Paused,
                    "failed" or "error" => FederationWebhookStatus.Failed,
                    _ => FederationWebhookStatus.Active
                };
            }
            // Also honour a boolean enabled/is_active flag (the catch-all parity
            // path already reads "enabled"). false => Paused, true => Active.
            if (TryFindProperty(doc.RootElement, "enabled", out var en) ||
                TryFindProperty(doc.RootElement, "is_active", out en))
            {
                if (en.ValueKind == JsonValueKind.False) sub.Status = FederationWebhookStatus.Paused;
                else if (en.ValueKind == JsonValueKind.True) sub.Status = FederationWebhookStatus.Active;
            }
        }
        catch (JsonException) { }
        return sub;
    }

    private static object WebhookSubscriptionToResponse(FederationWebhookSubscription s) => new Dictionary<string, object?>
    {
        ["id"] = s.Id,
        ["tenant_id"] = s.TenantId,
        ["name"] = s.Name,
        ["target_url"] = s.TargetUrl,
        ["event_types"] = s.EventTypes,
        ["direction"] = s.Direction.ToString().ToLowerInvariant(),
        ["status"] = s.Status.ToString().ToLowerInvariant(),
        ["secret"] = string.IsNullOrEmpty(s.Secret) ? null : "***",
        ["last_delivered_at"] = s.LastDeliveredAt,
        ["last_failure_at"] = s.LastFailureAt,
        ["last_failure_reason"] = s.LastFailureReason,
        ["retry_count"] = s.RetryCount,
        ["created_at"] = s.CreatedAt,
        ["updated_at"] = s.UpdatedAt,
        ["created_by"] = s.CreatedBy
    };

    private async Task<IActionResult> CreateStoredRecord(string key, string kind)
    {
        if (!TryRequireTenant(out _, out var tenantError)) return tenantError!;

        var payloadJson = await ReadRequestPayloadJsonAsync();
        var records = await LoadStoredRecordsAsync(key, includeDeleted: true);
        var requestedId = ExtractIntFromPayload(payloadJson, "id");
        var id = requestedId.HasValue && records.All(r => r.Id != requestedId.Value)
            ? requestedId.Value
            : NextStoredRecordId(records);

        var now = DateTime.UtcNow;
        var record = BuildStoredRecord(id, kind, "create", payloadJson, now);
        records.Add(record);
        await SaveStoredRecordsAsync(key, records);

        return StatusCode(StatusCodes.Status201Created, new
        {
            success = true,
            data = ToResponseRecord(record),
            compatibility = CompatibilityMetadata(key)
        });
    }

    private async Task<IActionResult> UpsertStoredRecord(string key, int id, string kind)
    {
        if (!TryRequireTenant(out _, out var tenantError)) return tenantError!;

        var payloadJson = await ReadRequestPayloadJsonAsync();
        var records = await LoadStoredRecordsAsync(key, includeDeleted: true);
        var now = DateTime.UtcNow;
        var record = records.FirstOrDefault(r => r.Id == id);

        if (record == null)
        {
            record = BuildStoredRecord(id, kind, "upsert", payloadJson, now);
            records.Add(record);
        }
        else
        {
            ApplyStoredRecordUpdate(record, payloadJson, "update", now);
        }

        await SaveStoredRecordsAsync(key, records);

        return Ok(new
        {
            success = true,
            data = ToResponseRecord(record),
            compatibility = CompatibilityMetadata(key)
        });
    }

    private async Task<IActionResult> DeleteStoredRecord(string key, int id, string kind)
    {
        if (!TryRequireTenant(out _, out var tenantError)) return tenantError!;

        var records = await LoadStoredRecordsAsync(key, includeDeleted: true);
        var now = DateTime.UtcNow;
        var record = records.FirstOrDefault(r => r.Id == id);

        if (record == null)
        {
            record = BuildStoredRecord(id, kind, "delete", "{}", now);
            records.Add(record);
        }

        record.Status = "deleted";
        record.Action = "delete";
        record.DeletedAt = now;
        record.UpdatedAt = now;
        record.Path = Request.Path.Value;
        record.Method = Request.Method;
        record.AdminUserId = GetCurrentAdminUserId();

        await SaveStoredRecordsAsync(key, records);

        return Ok(new
        {
            success = true,
            data = ToResponseRecord(record),
            compatibility = CompatibilityMetadata(key)
        });
    }

    private async Task<IActionResult> TestFederationWebhook(int webhookId)
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var payloadJson = await ReadRequestPayloadJsonAsync();
        if (string.IsNullOrWhiteSpace(payloadJson)) payloadJson = "{}";
        var (success, reason) = await _webhookService.DeliverAsync(tenantId, webhookId, payloadJson, "test");

        return Ok(new
        {
            success,
            delivery_status = success ? "delivered" : "failed",
            reason
        });
    }

    private async Task<IActionResult> GetFaqs()
    {
        var rows = await _db.Faqs.AsNoTracking()
            .OrderBy(f => f.SortOrder)
            .ThenBy(f => f.Id)
            .Select(f => new { f.Id, f.Question, f.Answer, f.Category, f.SortOrder, f.IsPublished, f.CreatedAt, f.UpdatedAt })
            .ToListAsync();

        return Ok(new { data = rows, meta = new { total = rows.Count } });
    }

    private async Task<IActionResult> GetLandingPageMetadata()
    {
        var pages = await _db.Pages.AsNoTracking()
            .Where(p => p.Slug == "home" || p.Slug == "landing" || p.ShowInMenu)
            .OrderBy(p => p.SortOrder)
            .Select(p => new { p.Id, p.Title, p.Slug, p.IsPublished, p.ShowInMenu, p.MenuLocation, p.MetaTitle, p.MetaDescription, p.UpdatedAt })
            .ToListAsync();

        var resources = await _db.Resources.AsNoTracking()
            .Where(r => r.IsPublished)
            .OrderBy(r => r.SortOrder)
            .Take(10)
            .Select(r => new { r.Id, r.Title, r.Description, r.Url, r.ResourceType })
            .ToListAsync();

        return Ok(new { data = new { pages, featured_resources = resources } });
    }

    private async Task<IActionResult> GetSitemapStats()
    {
        return Ok(new
        {
            data = new
            {
                pages = await _db.Pages.CountAsync(p => p.IsPublished),
                blog_posts = await _db.BlogPosts.CountAsync(p => p.Status == "published"),
                listings = await _db.Listings.CountAsync(l => l.Status == ListingStatus.Active),
                resources = await _db.Resources.CountAsync(r => r.IsPublished),
                faqs = await _db.Faqs.CountAsync(f => f.IsPublished),
                generated_at = DateTime.UtcNow
            }
        });
    }

    private async Task<IActionResult> GetJobTemplates()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var rows = await _db.JobTemplates.AsNoTracking()
            .Where(t => t.TenantId == tenantId)
            .OrderBy(t => t.Title)
            .Select(t => new { t.Id, t.Title, t.Description, t.Category, t.JobType, t.RequiredSkills, t.IsPublic, t.CreatedAt, t.UpdatedAt })
            .ToListAsync();

        return Ok(new { data = rows, meta = new { total = rows.Count } });
    }

    private async Task<IActionResult> GetInviteCodes()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var limit = QueryInt("limit", 50, 1, 100);
        var offset = QueryInt("offset", 0, 0, int.MaxValue);

        var query = _db.TenantInviteCodes
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId);

        var total = await query.CountAsync();
        var items = await query
            .OrderByDescending(c => c.CreatedAt)
            .Skip(offset)
            .Take(limit)
            .Select(c => new
            {
                c.Id,
                c.TenantId,
                c.Code,
                created_by = c.CreatedBy,
                creator_name = c.CreatedByUser == null ? null : c.CreatedByUser.FirstName,
                max_uses = c.MaxUses,
                uses_count = c.UsesCount,
                expires_at = c.ExpiresAt,
                note = c.Note,
                is_active = c.IsActive,
                last_used_at = c.LastUsedAt,
                last_used_by = c.LastUsedBy,
                created_at = c.CreatedAt,
                updated_at = c.UpdatedAt
            })
            .ToListAsync();

        var data = new { items, total, limit, offset };
        return Ok(new { success = true, data, items, total, limit, offset });
    }

    private async Task<IActionResult> GenerateInviteCodes()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var payload = await ReadJsonObjectPayloadAsync();
        var count = JsonInt(payload, "count", 1, 1, 100);
        var maxUses = JsonInt(payload, "max_uses", 1, 1, int.MaxValue);
        var note = Truncate(JsonString(payload, "note"), 255);
        var expiresAtText = JsonString(payload, "expires_at");
        DateTime? expiresAt = null;

        if (!string.IsNullOrWhiteSpace(expiresAtText))
        {
            if (!DateTimeOffset.TryParse(expiresAtText, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed))
            {
                return UnprocessableEntity(new
                {
                    error = "VALIDATION_INVALID_FORMAT",
                    message = "expires_at must be a valid date/time."
                });
            }

            expiresAt = parsed.UtcDateTime;
        }

        var now = DateTime.UtcNow;
        var adminId = GetCurrentAdminUserId();
        var rows = new List<TenantInviteCode>(capacity: count);

        for (var i = 0; i < count; i++)
        {
            rows.Add(new TenantInviteCode
            {
                TenantId = tenantId,
                Code = await GenerateUniqueInviteCode(tenantId),
                CreatedBy = adminId,
                MaxUses = maxUses,
                UsesCount = 0,
                ExpiresAt = expiresAt,
                Note = note,
                IsActive = true,
                CreatedAt = now,
                UpdatedAt = now
            });
        }

        _db.TenantInviteCodes.AddRange(rows);
        await _db.SaveChangesAsync();

        var codes = rows.Select(r => r.Code).ToArray();
        var data = new { codes, count = codes.Length };
        return Ok(new { success = true, data, codes, count = codes.Length });
    }

    private async Task<IActionResult> DeactivateInviteCode(int id)
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var row = await _db.TenantInviteCodes
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Id == id);

        if (row == null)
        {
            return NotFound(new
            {
                error = "RESOURCE_NOT_FOUND",
                message = "Invite code not found."
            });
        }

        row.IsActive = false;
        row.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new { success = true, data = new { deactivated = true } });
    }

    private async Task<IActionResult> GetVolunteeringOrganizations()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;
        SetVolunteerOrganisationHeaders(tenantId);
        if (!await _volunteerOrganisations.IsFeatureEnabledAsync(tenantId, HttpContext.RequestAborted))
            return VolunteerOrganisationError(403, "FEATURE_DISABLED", "Service unavailable");

        var data = await _volunteerOrganisations.ListAdminAsync(tenantId, HttpContext.RequestAborted);
        return Ok(new
        {
            data,
            meta = new
            {
                base_url = await VolunteerOrganisationBaseUrlAsync(tenantId),
                total = data.Count
            }
        });
    }

    private async Task<IActionResult> CreateVolunteeringOrganization()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;
        SetVolunteerOrganisationHeaders(tenantId);
        if (!await _volunteerOrganisations.IsFeatureEnabledAsync(tenantId, HttpContext.RequestAborted))
            return VolunteerOrganisationError(403, "FEATURE_DISABLED", "Service unavailable");

        var payload = await ReadJsonObjectPayloadAsync();
        var adminUserId = GetCurrentAdminUserId();
        if (!adminUserId.HasValue)
            return VolunteerOrganisationError(401, "UNAUTHORIZED", "Authentication required");

        var result = await _volunteerOrganisations.CreateAsync(
            tenantId,
            adminUserId.Value,
            new VolunteerOrganisationCreateCommand(
                JsonString(payload, "name"),
                JsonString(payload, "description"),
                JsonString(payload, "contact_email"),
                JsonString(payload, "website"),
                JsonString(payload, "org_type"),
                JsonString(payload, "meeting_schedule")),
            activate: true,
            HttpContext.RequestAborted);
        if (!result.Success)
        {
            var error = result.Error!;
            var status = error.Code switch
            {
                "FORBIDDEN" => StatusCodes.Status403Forbidden,
                _ => StatusCodes.Status422UnprocessableEntity
            };
            return VolunteerOrganisationError(status, error.Code, error.Message, error.Field);
        }

        return StatusCode(StatusCodes.Status201Created, new
        {
            data = result.Data,
            meta = new { base_url = await VolunteerOrganisationBaseUrlAsync(tenantId) }
        });
    }

    private async Task<IActionResult> UpdateVolunteeringOrganization(int id)
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;
        SetVolunteerOrganisationHeaders(tenantId);
        if (!await _volunteerOrganisations.IsFeatureEnabledAsync(tenantId, HttpContext.RequestAborted))
            return VolunteerOrganisationError(403, "FEATURE_DISABLED", "Service unavailable");

        var payload = await ReadJsonObjectPayloadAsync();
        var result = await _volunteerOrganisations.UpdateAsync(
            id,
            tenantId,
            AdminVolunteerOrganisationUpdateCommand(payload),
            adminSurface: true,
            HttpContext.RequestAborted);
        if (!result.Success)
        {
            var error = result.Error!;
            var statusCode = error.Code switch
            {
                "NOT_FOUND" => StatusCodes.Status404NotFound,
                "SERVER_ERROR" => StatusCodes.Status500InternalServerError,
                _ when error.Message == "No fields to update" => StatusCodes.Status400BadRequest,
                _ => StatusCodes.Status422UnprocessableEntity
            };
            return VolunteerOrganisationError(statusCode, error.Code, error.Message, error.Field);
        }

        return Ok(new
        {
            data = result.Data,
            meta = new { base_url = await VolunteerOrganisationBaseUrlAsync(tenantId) }
        });
    }

    private async Task<IActionResult> UpdateVolunteeringOrganizationStatus(int id)
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;
        SetVolunteerOrganisationHeaders(tenantId);
        if (!await _volunteerOrganisations.IsFeatureEnabledAsync(tenantId, HttpContext.RequestAborted))
            return VolunteerOrganisationError(403, "FEATURE_DISABLED", "Service unavailable");

        var payload = await ReadJsonObjectPayloadAsync();
        var status = TryGetPayloadProperty(payload, "status", out var statusValue)
            && statusValue.ValueKind == JsonValueKind.String
                ? statusValue.GetString()
                : null;
        var result = await _volunteerOrganisations.UpdateStatusAsync(
            id,
            tenantId,
            status,
            HttpContext.RequestAborted);
        if (!result.Success)
        {
            var error = result.Error!;
            var statusCode = error.Code == "NOT_FOUND"
                ? StatusCodes.Status404NotFound
                : error.Code == "SERVER_ERROR"
                    ? StatusCodes.Status500InternalServerError
                : StatusCodes.Status400BadRequest;
            return VolunteerOrganisationError(statusCode, error.Code, error.Message, error.Field);
        }

        return Ok(new
        {
            data = new
            {
                id,
                status,
                message = $"Organization status updated to {status}"
            },
            meta = new { base_url = await VolunteerOrganisationBaseUrlAsync(tenantId) }
        });
    }

    private static VolunteerOrganisationUpdateCommand AdminVolunteerOrganisationUpdateCommand(
        Dictionary<string, JsonElement> payload)
    {
        var (hasName, name) = OptionalPayloadString(payload, "name");
        var (hasDescription, description) = OptionalPayloadString(payload, "description");
        var (hasContactEmail, contactEmail) = OptionalPayloadString(payload, "contact_email");
        var (hasWebsite, website) = OptionalPayloadString(payload, "website");
        var (hasOrgType, orgType) = OptionalPayloadString(payload, "org_type");
        var (hasMeetingSchedule, meetingSchedule) = OptionalPayloadString(payload, "meeting_schedule");
        return new(
            hasName,
            name,
            hasDescription,
            description,
            hasContactEmail,
            contactEmail,
            hasWebsite,
            website,
            hasOrgType,
            orgType,
            hasMeetingSchedule,
            meetingSchedule);
    }

    private static (bool HasValue, string? Value) OptionalPayloadString(
        Dictionary<string, JsonElement> payload,
        string key)
    {
        if (!TryGetPayloadProperty(payload, key, out var value)
            || value.ValueKind == JsonValueKind.Null)
        {
            return (false, null);
        }

        return (true, JsonElementToString(value));
    }

    private void SetVolunteerOrganisationHeaders(int tenantId)
    {
        Response.Headers["API-Version"] = "2.0";
        Response.Headers["X-Tenant-ID"] = tenantId.ToString();
    }

    private async Task<string> VolunteerOrganisationBaseUrlAsync(int tenantId)
    {
        var domain = await _db.Tenants
            .AsNoTracking()
            .Where(tenant => tenant.Id == tenantId)
            .Select(tenant => tenant.Domain)
            .SingleOrDefaultAsync(HttpContext.RequestAborted);
        return string.IsNullOrWhiteSpace(domain)
            ? $"{Request.Scheme}://{Request.Host}".TrimEnd('/')
            : domain.TrimEnd('/');
    }

    private ObjectResult VolunteerOrganisationError(
        int statusCode,
        string code,
        string message,
        string? field = null)
    {
        if (field is null)
        {
            return StatusCode(statusCode, new
            {
                errors = new[] { new { code, message } }
            });
        }

        return StatusCode(statusCode, new
        {
            errors = new[] { new { code, message, field } }
        });
    }

    private async Task<IActionResult> GetJobModerationQueue()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var page = QueryInt("page", 1, 1, int.MaxValue);
        var limit = QueryInt("limit", QueryInt("per_page", 50, 1, 200), 1, 200);
        var statuses = new[] { "draft", "pending", "flagged", "rejected" };
        var query = _db.JobVacancies
            .AsNoTracking()
            .Where(j => j.TenantId == tenantId && statuses.Contains(j.Status.ToLower()));

        var total = await query.CountAsync();
        var items = await query
            .OrderByDescending(j => j.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(j => new
            {
                j.Id,
                j.Title,
                j.Description,
                j.Category,
                job_type = j.JobType,
                j.Status,
                is_featured = j.IsFeatured,
                application_count = j.ApplicationCount,
                created_at = j.CreatedAt,
                updated_at = j.UpdatedAt
            })
            .ToListAsync();

        return Ok(new { data = new { items, total, page, limit }, meta = new { total, page, limit } });
    }

    private async Task<IActionResult> GetJobModerationStats()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var jobs = _db.JobVacancies.AsNoTracking().Where(j => j.TenantId == tenantId);
        var pendingJobs = await jobs.CountAsync(j => j.Status == "draft" || j.Status == "pending" || j.Status == "flagged");
        var flaggedJobs = await jobs.CountAsync(j => j.Status == "flagged");
        var rejectedJobs = await jobs.CountAsync(j => j.Status == "rejected" || j.Status == "cancelled");

        return Ok(new
        {
            data = new
            {
                pending_jobs = pendingJobs,
                flagged_jobs = flaggedJobs,
                rejected_jobs = rejectedJobs,
                total_jobs = await jobs.CountAsync()
            }
        });
    }

    private async Task<IActionResult> GetJobSpamStats()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var jobs = _db.JobVacancies.AsNoTracking().Where(j => j.TenantId == tenantId);
        var flaggedJobs = await jobs.CountAsync(j => j.Status == "flagged" || j.Status == "draft");

        return Ok(new
        {
            data = new
            {
                suspected_spam = flaggedJobs,
                flagged_jobs = flaggedJobs,
                total_checked = await jobs.CountAsync(),
                generated_at = DateTime.UtcNow
            }
        });
    }

    private async Task<IActionResult> GetJobInterviews()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var page = QueryInt("page", 1, 1, int.MaxValue);
        var limit = QueryInt("limit", QueryInt("per_page", 50, 1, 200), 1, 200);
        var status = Request.Query["status"].FirstOrDefault();
        var query = _db.JobInterviews.AsNoTracking().Where(i => i.TenantId == tenantId);
        if (!string.IsNullOrWhiteSpace(status))
        {
            query = query.Where(i => i.Status == status);
        }

        var total = await query.CountAsync();
        var items = await query
            .OrderByDescending(i => i.StartsAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(i => new
            {
                i.Id,
                job_id = i.JobId,
                application_id = i.ApplicationId,
                candidate_user_id = i.CandidateUserId,
                created_by_user_id = i.CreatedByUserId,
                starts_at = i.StartsAt,
                ends_at = i.EndsAt,
                i.Location,
                i.Status,
                i.Notes,
                created_at = i.CreatedAt,
                updated_at = i.UpdatedAt
            })
            .ToListAsync();

        return Ok(new { data = items, meta = new { total, page, limit } });
    }

    private async Task<IActionResult> GetJobOffers()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var page = QueryInt("page", 1, 1, int.MaxValue);
        var limit = QueryInt("limit", QueryInt("per_page", 50, 1, 200), 1, 200);
        var status = Request.Query["status"].FirstOrDefault();
        var query = _db.JobOffers.AsNoTracking().Where(o => o.TenantId == tenantId);
        if (!string.IsNullOrWhiteSpace(status))
        {
            query = query.Where(o => o.Status == status);
        }

        var total = await query.CountAsync();
        var items = await query
            .OrderByDescending(o => o.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(o => new
            {
                o.Id,
                job_id = o.JobId,
                application_id = o.ApplicationId,
                candidate_user_id = o.CandidateUserId,
                created_by_user_id = o.CreatedByUserId,
                o.Title,
                o.Message,
                time_credits_per_hour = o.TimeCreditsPerHour,
                o.Status,
                created_at = o.CreatedAt,
                updated_at = o.UpdatedAt
            })
            .ToListAsync();

        return Ok(new { data = items, meta = new { total, page, limit } });
    }

    private async Task<IActionResult> ModerateJob(int id, string action)
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var payload = await ReadJsonObjectPayloadAsync();
        var job = await _db.JobVacancies.FirstOrDefaultAsync(j => j.TenantId == tenantId && j.Id == id);
        if (job == null)
        {
            return NotFound(new { error = "Job not found" });
        }

        var now = DateTime.UtcNow;
        var adminUserId = GetCurrentAdminUserId();
        switch (action)
        {
            case "approve":
                job.Status = "active";
                job.UpdatedAt = now;
                await _db.SaveChangesAsync();
                return Ok(new
                {
                    data = new
                    {
                        approved = true,
                        id = job.Id,
                        status = job.Status,
                        message = "Job approved",
                        admin_user_id = adminUserId,
                        notes = JsonString(payload, "notes")
                    }
                });

            case "reject":
            {
                var reason = JsonString(payload, "reason");
                if (string.IsNullOrWhiteSpace(reason))
                {
                    return UnprocessableEntity(new { error = "VALIDATION_REQUIRED", field = "reason" });
                }

                job.Status = "rejected";
                job.UpdatedAt = now;
                await _db.SaveChangesAsync();
                return Ok(new
                {
                    data = new
                    {
                        rejected = true,
                        id = job.Id,
                        status = job.Status,
                        reason,
                        message = "Job rejected",
                        admin_user_id = adminUserId
                    }
                });
            }

            case "flag":
            {
                var reason = JsonString(payload, "reason");
                if (string.IsNullOrWhiteSpace(reason))
                {
                    return UnprocessableEntity(new { error = "VALIDATION_REQUIRED", field = "reason" });
                }

                job.Status = "flagged";
                job.UpdatedAt = now;
                await _db.SaveChangesAsync();
                return Ok(new
                {
                    data = new
                    {
                        flagged = true,
                        id = job.Id,
                        status = job.Status,
                        reason,
                        message = "Job flagged",
                        admin_user_id = adminUserId
                    }
                });
            }

            default:
                return BadRequest(new { error = "Unsupported job moderation action" });
        }
    }

    private async Task<IActionResult> GetEvent(int id)
    {
        var item = await _db.Events.AsNoTracking().FirstOrDefaultAsync(e => e.Id == id);
        return item == null ? NotFound(new { error = "Event not found" }) : Ok(new { data = item });
    }

    private async Task<IActionResult> DeleteEvent(int id)
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var evt = await _db.Events
            .FirstOrDefaultAsync(e => e.TenantId == tenantId && e.Id == id);

        if (evt == null)
        {
            return NotFound(new
            {
                error = "NOT_FOUND",
                message = "Event not found."
            });
        }

        var rsvps = await _db.EventRsvps
            .Where(r => r.TenantId == tenantId && r.EventId == id)
            .ToListAsync();
        _db.EventRsvps.RemoveRange(rsvps);
        _db.Events.Remove(evt);
        await _db.SaveChangesAsync();

        return Ok(new
        {
            success = true,
            data = new
            {
                id,
                deleted = true
            }
        });
    }

    private async Task<IActionResult> GetGroup(int id)
    {
        var item = await _db.Groups.AsNoTracking().FirstOrDefaultAsync(g => g.Id == id);
        return item == null ? NotFound(new { error = "Group not found" }) : Ok(new { data = item });
    }

    private async Task<IActionResult> UpdateGroup(int id)
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var group = await _db.Groups
            .FirstOrDefaultAsync(g => g.TenantId == tenantId && g.Id == id);

        if (group == null)
        {
            return NotFound(new
            {
                error = "NOT_FOUND",
                message = "Group not found."
            });
        }

        var payload = await ReadJsonObjectPayloadAsync();
        var changed = false;

        if (payload.ContainsKey("name"))
        {
            var name = JsonString(payload, "name")?.Trim();
            if (string.IsNullOrWhiteSpace(name))
            {
                return UnprocessableEntity(new
                {
                    error = "VALIDATION_ERROR",
                    message = "name is required."
                });
            }

            group.Name = name;
            changed = true;
        }

        if (payload.ContainsKey("description"))
        {
            group.Description = JsonString(payload, "description");
            changed = true;
        }

        if (payload.ContainsKey("visibility"))
        {
            var visibility = JsonString(payload, "visibility")?.Trim().ToLowerInvariant();
            group.IsPrivate = visibility == "private";
            changed = true;
        }

        if (payload.ContainsKey("cover_image_url"))
        {
            group.ImageUrl = JsonString(payload, "cover_image_url");
            changed = true;
        }

        if (!changed)
        {
            return UnprocessableEntity(new
            {
                error = "VALIDATION_ERROR",
                message = "No fields to update."
            });
        }

        group.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new
        {
            success = true,
            data = new
            {
                id,
                updated = true
            }
        });
    }

    private async Task<IActionResult> DeleteGroup(int id)
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var group = await _db.Groups
            .FirstOrDefaultAsync(g => g.TenantId == tenantId && g.Id == id);

        if (group == null)
        {
            return NotFound(new
            {
                error = "NOT_FOUND",
                message = "Group not found."
            });
        }

        var members = await _db.GroupMembers
            .Where(m => m.TenantId == tenantId && m.GroupId == id)
            .ToListAsync();
        _db.GroupMembers.RemoveRange(members);
        _db.Groups.Remove(group);
        await _db.SaveChangesAsync();

        return Ok(new
        {
            success = true,
            data = new
            {
                deleted = true,
                id
            }
        });
    }

    private IActionResult GetReportExportTypes()
    {
        return Ok(new { data = new[] { "csv", "json" } });
    }

    private IActionResult GetAdminReportExportCsv(string path)
    {
        var reportType = path["/api/v2/admin/reports/".Length..^"/export".Length];
        var csv = new StringBuilder();
        csv.AppendLine("report_type,generated_at,total");
        csv.AppendLine($"{Csv(reportType)},{DateTime.UtcNow:O},0");
        return File(Encoding.UTF8.GetBytes(csv.ToString()), "text/csv", $"{reportType.Replace('_', '-')}-report.csv");
    }

    private static bool IsAdminReportExportPath(string path) =>
        path.StartsWith("/api/v2/admin/reports/", StringComparison.OrdinalIgnoreCase)
        && path.EndsWith("/export", StringComparison.OrdinalIgnoreCase)
        && !path.Equals("/api/v2/admin/reports/export", StringComparison.OrdinalIgnoreCase);

    private async Task<IActionResult> GetSupportReports()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var page = QueryInt("page", 1, 1, int.MaxValue);
        var limit = QueryInt("limit", QueryInt("per_page", 20, 1, 100), 1, 100);
        var reports = await LoadSupportReports(tenantId);
        var filtered = ApplySupportReportFilters(reports).ToList();
        var total = filtered.Count;
        var totalPages = Math.Max(1, (int)Math.Ceiling(total / (double)limit));
        var pageReports = filtered
            .OrderByDescending(r => ParseDate(r.CreatedAt))
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToList();
        var users = await LoadSupportReportUsers(pageReports);

        return Ok(new
        {
            data = pageReports.Select(r => FormatSupportReport(r, users, includeDiagnostics: false)).ToList(),
            meta = new
            {
                total,
                page,
                limit,
                per_page = limit,
                total_pages = totalPages
            }
        });
    }

    private async Task<IActionResult> GetSupportReport(int id)
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var reports = await LoadSupportReports(tenantId);
        var report = reports.FirstOrDefault(r => r.Id == id);
        if (report == null)
        {
            return NotFound(new { error = "Support report not found" });
        }

        var users = await LoadSupportReportUsers(new[] { report });
        return Ok(new { data = FormatSupportReport(report, users, includeDiagnostics: true) });
    }

    private async Task<IActionResult> GetSupportReportStats()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var reports = await LoadSupportReports(tenantId);
        return Ok(new
        {
            data = new
            {
                total = reports.Count,
                open = reports.Count(r => r.Status == "open"),
                triaged = reports.Count(r => r.Status == "triaged"),
                resolved = reports.Count(r => r.Status == "resolved"),
                closed = reports.Count(r => r.Status == "closed"),
                blocked = reports.Count(r => r.Impact == "blocked"),
                major = reports.Count(r => r.Impact == "major"),
                unassigned = reports.Count(r => r.AssignedUserId == null && (r.Status == "open" || r.Status == "triaged"))
            }
        });
    }

    private async Task<IActionResult> GetSupportReportAssignees()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var users = await _db.Users
            .AsNoTracking()
            .Where(u => u.TenantId == tenantId && u.IsActive && (u.Role == "admin" || u.Role == "tenant_admin" || u.Role == "super_admin" || u.Role == "god"))
            .OrderBy(u => u.FirstName)
            .ThenBy(u => u.LastName)
            .Select(u => new
            {
                id = u.Id,
                name = ((u.FirstName + " " + u.LastName).Trim() == string.Empty ? u.Email : (u.FirstName + " " + u.LastName).Trim()),
                email = u.Email,
                avatar_url = u.AvatarUrl,
                role = u.Role
            })
            .ToListAsync();

        return Ok(new { data = new { assignees = users } });
    }

    private async Task<IActionResult> UpdateSupportReport(int id)
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var reports = await LoadSupportReports(tenantId);
        var report = reports.FirstOrDefault(r => r.Id == id);
        if (report == null)
        {
            return NotFound(new { error = "Support report not found" });
        }

        var payloadJson = await ReadRequestPayloadJsonAsync();
        using var document = JsonDocument.Parse(payloadJson);
        if (document.RootElement.ValueKind != JsonValueKind.Object)
        {
            return UnprocessableEntity(new { error = "VALIDATION_FAILED", field = "body" });
        }

        var hasChanges = false;
        var now = DateTime.UtcNow.ToString("O", CultureInfo.InvariantCulture);
        if (TryFindProperty(document.RootElement, "status", out var statusProperty))
        {
            var status = statusProperty.GetString();
            if (!IsValidSupportReportStatus(status))
            {
                return UnprocessableEntity(new { error = "VALIDATION_FAILED", field = "status" });
            }

            report.Status = status!;
            if (status == "triaged" && string.IsNullOrWhiteSpace(report.TriagedAt)) report.TriagedAt = now;
            if (status == "resolved" && string.IsNullOrWhiteSpace(report.ResolvedAt)) report.ResolvedAt = now;
            if (status == "closed" && string.IsNullOrWhiteSpace(report.ClosedAt)) report.ClosedAt = now;
            hasChanges = true;
        }

        if (TryFindProperty(document.RootElement, "assigned_user_id", out var assignedProperty))
        {
            report.AssignedUserId = assignedProperty.ValueKind == JsonValueKind.Null ? null : assignedProperty.GetInt32();
            if (report.AssignedUserId != null && !await IsAssignableSupportReportAdmin(report.AssignedUserId.Value, tenantId))
            {
                return UnprocessableEntity(new { error = "VALIDATION_FAILED", field = "assigned_user_id" });
            }
            hasChanges = true;
        }

        if (TryFindProperty(document.RootElement, "triage_notes", out var triageNotesProperty))
        {
            report.TriageNotes = NullableJsonString(triageNotesProperty);
            hasChanges = true;
        }

        if (TryFindProperty(document.RootElement, "sentry_event_id", out var sentryEventProperty))
        {
            report.SentryEventId = NullableJsonString(sentryEventProperty);
            hasChanges = true;
        }

        if (TryFindProperty(document.RootElement, "sentry_issue_url", out var sentryIssueProperty))
        {
            report.SentryIssueUrl = NullableJsonString(sentryIssueProperty);
            hasChanges = true;
        }

        if (!hasChanges)
        {
            return UnprocessableEntity(new { error = "NO_CHANGES" });
        }

        report.UpdatedAt = now;
        await SaveSupportReports(reports);

        var users = await LoadSupportReportUsers(new[] { report });
        return Ok(new { data = FormatSupportReport(report, users, includeDiagnostics: true) });
    }

    private async Task<IActionResult> GetMemberPremiumSettings()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        return Ok(new
        {
            data = new
            {
                settings = await BuildMemberPremiumSettings(tenantId)
            }
        });
    }

    private async Task<IActionResult> GetMemberPremiumAdminTiers()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var plans = await _db.SubscriptionPlans
            .AsNoTracking()
            .Where(p => p.TenantId == tenantId)
            .OrderBy(p => p.Price)
            .ThenBy(p => p.Name)
            .ThenBy(p => p.Id)
            .ToListAsync();

        var activeSubscriberCounts = await _db.UserSubscriptions
            .AsNoTracking()
            .Where(s => s.TenantId == tenantId && s.Status == SubscriptionStatus.Active)
            .GroupBy(s => s.PlanId)
            .Select(g => new { PlanId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(row => row.PlanId, row => row.Count);

        var tiers = new List<object>();
        for (var index = 0; index < plans.Count; index++)
        {
            var plan = plans[index];
            var metadata = await LoadMemberPremiumTierMetadata(plan.Id);
            tiers.Add(MapMemberPremiumAdminTier(
                plan,
                metadata,
                index,
                activeSubscriberCounts.GetValueOrDefault(plan.Id)));
        }

        return Ok(new
        {
            success = true,
            data = new
            {
                tiers
            }
        });
    }

    private async Task<IActionResult> GetMemberPremiumAdminTier(int id)
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var plan = await _db.SubscriptionPlans
            .AsNoTracking()
            .Where(p => p.TenantId == tenantId && p.Id == id)
            .FirstOrDefaultAsync();

        if (plan == null)
        {
            return NotFound(new
            {
                error = "TIER_NOT_FOUND",
                message = "Member premium tier not found."
            });
        }

        return Ok(new
        {
            success = true,
            data = new
            {
                tier = MapMemberPremiumAdminTierDetail(plan, await LoadMemberPremiumTierMetadata(plan.Id))
            }
        });
    }

    private async Task<IActionResult> CreateMemberPremiumAdminTier()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var payload = await ReadJsonObjectPayloadAsync();
        var slug = JsonString(payload, "slug") ?? string.Empty;
        var name = JsonString(payload, "name") ?? string.Empty;
        if (string.IsNullOrWhiteSpace(slug))
        {
            return UnprocessableEntity(new
            {
                error = "VALIDATION_ERROR",
                message = "Missing required field: slug",
                field = "slug"
            });
        }

        if (string.IsNullOrWhiteSpace(name))
        {
            return UnprocessableEntity(new
            {
                error = "VALIDATION_ERROR",
                message = "Missing required field: name",
                field = "name"
            });
        }

        if (!IsValidMemberPremiumTierSlug(slug))
        {
            return UnprocessableEntity(new
            {
                error = "VALIDATION_ERROR",
                message = "Invalid member premium tier slug.",
                field = "slug"
            });
        }

        var monthlyPriceCents = JsonInt(payload, "monthly_price_cents", 0, 0, int.MaxValue);
        var yearlyPriceCents = JsonInt(payload, "yearly_price_cents", 0, 0, int.MaxValue);
        var features = JsonStringList(payload, "features");
        var now = DateTime.UtcNow;
        var plan = new SubscriptionPlan
        {
            TenantId = tenantId,
            Name = name,
            Description = JsonString(payload, "description"),
            Price = monthlyPriceCents / 100m,
            Currency = "EUR",
            Features = JsonSerializer.Serialize(features, StoreJsonOptions),
            IsActive = JsonBool(payload, "is_active", fallback: false),
            IsPublic = true,
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.SubscriptionPlans.Add(plan);
        await _db.SaveChangesAsync();

        var metadata = new MemberPremiumTierMetadata
        {
            Slug = slug,
            MonthlyPriceCents = monthlyPriceCents,
            YearlyPriceCents = yearlyPriceCents,
            SortOrder = JsonInt(payload, "sort_order", 0, int.MinValue, int.MaxValue),
            Features = features,
            CreatedAt = plan.CreatedAt,
            UpdatedAt = plan.UpdatedAt
        };
        await SaveMemberPremiumTierMetadata(plan.Id, metadata);
        await _db.SaveChangesAsync();

        return StatusCode(StatusCodes.Status201Created, new
        {
            success = true,
            data = new
            {
                tier = MapMemberPremiumAdminTierDetail(plan, metadata)
            }
        });
    }

    private async Task<IActionResult> UpdateMemberPremiumAdminTier(int id)
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var plan = await _db.SubscriptionPlans
            .Where(p => p.TenantId == tenantId && p.Id == id)
            .FirstOrDefaultAsync();

        if (plan == null)
        {
            return NotFound(new
            {
                error = "TIER_NOT_FOUND",
                message = "Member premium tier not found."
            });
        }

        var payload = await ReadJsonObjectPayloadAsync();
        var metadata = await LoadMemberPremiumTierMetadata(id) ?? new MemberPremiumTierMetadata
        {
            Slug = Slugify(plan.Name),
            MonthlyPriceCents = ToCents(plan.Price),
            YearlyPriceCents = ToCents(plan.Price * 12m),
            Features = NormalizePlanFeatures(plan.Features).ToList(),
            CreatedAt = plan.CreatedAt,
            UpdatedAt = plan.UpdatedAt
        };

        if (TryGetPayloadProperty(payload, "slug", out _))
        {
            var slug = JsonString(payload, "slug") ?? string.Empty;
            if (string.IsNullOrWhiteSpace(slug))
            {
                return UnprocessableEntity(new
                {
                    error = "VALIDATION_ERROR",
                    message = "Missing required field: slug",
                    field = "slug"
                });
            }

            if (!IsValidMemberPremiumTierSlug(slug))
            {
                return UnprocessableEntity(new
                {
                    error = "VALIDATION_ERROR",
                    message = "Invalid member premium tier slug.",
                    field = "slug"
                });
            }

            metadata.Slug = slug;
        }

        if (TryGetPayloadProperty(payload, "name", out _))
        {
            plan.Name = JsonString(payload, "name") ?? string.Empty;
        }

        if (TryGetPayloadProperty(payload, "description", out _))
        {
            var description = JsonString(payload, "description");
            plan.Description = string.IsNullOrWhiteSpace(description) ? null : description;
        }

        if (TryGetPayloadProperty(payload, "monthly_price_cents", out _))
        {
            metadata.MonthlyPriceCents = JsonInt(payload, "monthly_price_cents", 0, 0, int.MaxValue);
            metadata.StripePriceIdMonthly = null;
            metadata.StripePriceAccountId = null;
            plan.Price = metadata.MonthlyPriceCents / 100m;
        }

        if (TryGetPayloadProperty(payload, "yearly_price_cents", out _))
        {
            metadata.YearlyPriceCents = JsonInt(payload, "yearly_price_cents", 0, 0, int.MaxValue);
            metadata.StripePriceIdYearly = null;
            metadata.StripePriceAccountId = null;
        }

        if (TryGetPayloadProperty(payload, "sort_order", out _))
        {
            metadata.SortOrder = JsonInt(payload, "sort_order", 0, int.MinValue, int.MaxValue);
        }

        if (TryGetPayloadProperty(payload, "features", out _))
        {
            metadata.Features = JsonStringList(payload, "features");
            plan.Features = JsonSerializer.Serialize(metadata.Features, StoreJsonOptions);
        }

        if (TryGetPayloadProperty(payload, "is_active", out _))
        {
            plan.IsActive = JsonBool(payload, "is_active", fallback: plan.IsActive);
        }

        var now = DateTime.UtcNow;
        plan.UpdatedAt = now;
        metadata.UpdatedAt = now;
        await SaveMemberPremiumTierMetadata(id, metadata);
        await _db.SaveChangesAsync();

        return Ok(new
        {
            success = true,
            data = new
            {
                tier = MapMemberPremiumAdminTierDetail(plan, metadata)
            }
        });
    }

    private async Task<IActionResult> DeleteMemberPremiumAdminTier(int id)
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var hasActiveSubscribers = await _db.UserSubscriptions
            .AsNoTracking()
            .AnyAsync(s => s.TenantId == tenantId
                && s.PlanId == id
                && (s.Status == SubscriptionStatus.Active || s.Status == SubscriptionStatus.PastDue));

        if (hasActiveSubscribers)
        {
            return Conflict(new
            {
                error = "DELETE_FAILED",
                message = "Cannot delete a tier with active subscribers. Deactivate it instead."
            });
        }

        var plan = await _db.SubscriptionPlans
            .Where(p => p.TenantId == tenantId && p.Id == id)
            .FirstOrDefaultAsync();

        if (plan != null)
        {
            _db.SubscriptionPlans.Remove(plan);
        }

        var metadataKey = MemberPremiumTierMetadataKey(id);
        var metadata = await _db.TenantConfigs.FirstOrDefaultAsync(c => c.Key == metadataKey);
        if (metadata != null)
        {
            _db.TenantConfigs.Remove(metadata);
        }

        await _db.SaveChangesAsync();

        return Ok(new
        {
            success = true,
            data = new
            {
                deleted = true
            }
        });
    }

    private async Task<IActionResult> GetMemberPremiumAdminSubscribers()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var page = QueryInt("page", 1, 1, int.MaxValue);
        var perPage = QueryInt("per_page", 25, 1, 100);
        var statusFilter = (Request.Query["status"].FirstOrDefault() ?? string.Empty).Trim().ToLowerInvariant();

        var query = _db.UserSubscriptions
            .AsNoTracking()
            .Include(s => s.Plan)
            .Include(s => s.User)
            .Where(s => s.TenantId == tenantId);

        query = statusFilter switch
        {
            "active" => query.Where(s => s.Status == SubscriptionStatus.Active),
            "past_due" => query.Where(s => s.Status == SubscriptionStatus.PastDue),
            "canceled" or "cancelled" => query.Where(s => s.Status == SubscriptionStatus.Cancelled || s.Status == SubscriptionStatus.Expired),
            "grace" or "trialing" or "incomplete" => query.Where(s => false),
            _ => query
        };

        var total = await query.CountAsync();
        var subscriptions = await query
            .OrderByDescending(s => s.CreatedAt)
            .Skip((page - 1) * perPage)
            .Take(perPage)
            .ToListAsync();

        var rows = new List<object>();
        foreach (var subscription in subscriptions)
        {
            var plan = subscription.Plan;
            var user = subscription.User;
            var metadata = plan == null ? null : await LoadMemberPremiumTierMetadata(plan.Id);
            rows.Add(new
            {
                id = subscription.Id,
                user_id = subscription.UserId,
                tier_id = subscription.PlanId,
                status = MemberPremiumSubscriptionStatusForReact(subscription.Status),
                billing_interval = "monthly",
                current_period_end = subscription.NextBillingDate ?? subscription.ExpiresAt,
                canceled_at = subscription.CancelledAt,
                grace_period_ends_at = (DateTime?)null,
                created_at = subscription.CreatedAt,
                tier_name = plan?.Name ?? string.Empty,
                tier_slug = metadata?.Slug ?? (plan == null ? string.Empty : Slugify(plan.Name)),
                email = user?.Email,
                user_name = user == null ? null : (user.FirstName + " " + user.LastName).Trim(),
                first_name = user?.FirstName
            });
        }

        return Ok(new
        {
            success = true,
            data = new
            {
                rows,
                total,
                page,
                per_page = perPage
            }
        });
    }

    private async Task<IActionResult> SyncMemberPremiumAdminTierStripe(int id)
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var plan = await _db.SubscriptionPlans
            .Where(p => p.TenantId == tenantId && p.Id == id)
            .FirstOrDefaultAsync();

        if (plan == null)
        {
            return StatusCode(StatusCodes.Status500InternalServerError, new
            {
                error = "STRIPE_SYNC_FAILED",
                message = $"Tier {id} not found"
            });
        }

        var metadata = await LoadMemberPremiumTierMetadata(id) ?? new MemberPremiumTierMetadata
        {
            Slug = Slugify(plan.Name),
            MonthlyPriceCents = ToCents(plan.Price),
            YearlyPriceCents = ToCents(plan.Price * 12m),
            Features = NormalizePlanFeatures(plan.Features).ToList(),
            CreatedAt = plan.CreatedAt,
            UpdatedAt = plan.UpdatedAt
        };

        var priceAccountId = "platform_default";
        if (metadata.MonthlyPriceCents > 0)
        {
            metadata.StripePriceIdMonthly ??= LocalMemberPremiumStripePriceId(tenantId, id, "monthly");
        }

        if (metadata.YearlyPriceCents > 0)
        {
            metadata.StripePriceIdYearly ??= LocalMemberPremiumStripePriceId(tenantId, id, "yearly");
        }

        metadata.StripePriceAccountId = priceAccountId;
        var now = DateTime.UtcNow;
        metadata.UpdatedAt = now;
        plan.UpdatedAt = now;
        await SaveMemberPremiumTierMetadata(id, metadata);
        await _db.SaveChangesAsync();

        return Ok(new
        {
            success = true,
            data = new
            {
                tier = MapMemberPremiumAdminTierDetail(plan, metadata)
            }
        });
    }

    private async Task<IActionResult> PutMemberPremiumSettings()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var payloadJson = await ReadRequestPayloadJsonAsync();
        var accountId = ExtractStringFromPayload(payloadJson, "stripe_connect_account_id")?.Trim() ?? string.Empty;
        if (!IsValidStripeConnectAccountId(accountId))
        {
            return UnprocessableEntity(new
            {
                error = "VALIDATION_ERROR",
                message = "Invalid Stripe Connect account ID.",
                field = "stripe_connect_account_id"
            });
        }

        await UpsertTenantConfigValueAsync(MemberPremiumConnectAccountKey, accountId);
        await _db.SaveChangesAsync();

        return Ok(new
        {
            data = new
            {
                settings = await BuildMemberPremiumSettings(tenantId)
            }
        });
    }

    private async Task<IActionResult> GetModerationSettings()
    {
        if (!TryRequireTenant(out _, out var tenantError)) return tenantError!;

        return Ok(new { data = await BuildModerationSettings() });
    }

    private async Task<IActionResult> GetModerationQueue()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var page = QueryInt("page", 1, 1, int.MaxValue);
        var limit = QueryInt("limit", 50, 1, 200);
        var status = Request.Query["status"].ToString();
        var contentType = Request.Query["content_type"].ToString();
        var search = Request.Query["search"].ToString();

        var query = _db.ContentReports
            .AsNoTracking()
            .Include(r => r.Reporter)
            .Include(r => r.ReviewedBy)
            .Where(r => r.TenantId == tenantId);

        if (!string.IsNullOrWhiteSpace(status))
        {
            var normalizedStatus = status.Trim().ToLowerInvariant();
            var statuses = ModerationStatusesFor(normalizedStatus);
            query = query.Where(r => statuses.Contains(r.Status));
        }

        if (!string.IsNullOrWhiteSpace(contentType))
        {
            var normalizedContentType = contentType.Trim().ToLowerInvariant();
            query = query.Where(r => r.ContentType.ToLower() == normalizedContentType);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var normalizedSearch = search.Trim().ToLowerInvariant();
            query = query.Where(r =>
                r.Description != null && r.Description.ToLower().Contains(normalizedSearch) ||
                r.ContentType.ToLower().Contains(normalizedSearch) ||
                (r.Reporter != null &&
                    ((r.Reporter.FirstName + " " + r.Reporter.LastName).ToLower().Contains(normalizedSearch) ||
                     r.Reporter.Email.ToLower().Contains(normalizedSearch))));
        }

        var total = await query.CountAsync();
        var reports = await query
            .OrderBy(r => r.Status == ReportStatus.Escalated ? 0 : r.Status == ReportStatus.Pending ? 1 : 2)
            .ThenBy(r => r.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return Ok(new
        {
            success = true,
            data = reports.Select(FormatModerationItem).ToList(),
            meta = new
            {
                total,
                current_page = page,
                per_page = limit,
                total_pages = total > 0 ? (int)Math.Ceiling(total / (double)limit) : 0
            }
        });
    }

    private async Task<IActionResult> GetModerationStats()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var reports = await _db.ContentReports
            .AsNoTracking()
            .Where(r => r.TenantId == tenantId)
            .ToListAsync();

        var statuses = new[] { "pending", "flagged", "approved", "rejected" };
        var byType = reports
            .GroupBy(r => string.IsNullOrWhiteSpace(r.ContentType) ? "unknown" : r.ContentType.ToLowerInvariant())
            .ToDictionary(
                group => group.Key,
                group => statuses.ToDictionary(
                    status => status,
                    status => group.Count(r => MapModerationStatus(r.Status) == status)),
                StringComparer.OrdinalIgnoreCase);

        return Ok(new
        {
            success = true,
            data = new
            {
                total = reports.Count,
                pending = reports.Count(r => MapModerationStatus(r.Status) == "pending"),
                flagged = reports.Count(r => MapModerationStatus(r.Status) == "flagged"),
                approved = reports.Count(r => MapModerationStatus(r.Status) == "approved"),
                rejected = reports.Count(r => MapModerationStatus(r.Status) == "rejected"),
                auto_flagged_total = reports.Count(r => r.Status == ReportStatus.Escalated),
                by_type = byType
            }
        });
    }

    private async Task<IActionResult> PutModerationSettings()
    {
        if (!TryRequireTenant(out _, out var tenantError)) return tenantError!;

        var payload = await ReadJsonObjectPayloadAsync();
        foreach (var key in ModerationSettingKeys)
        {
            if (!payload.TryGetValue(key, out var value) || !TryReadBoolean(value, out var enabled))
            {
                continue;
            }

            await UpsertTenantConfigValueAsync(ModerationSettingPrefix + key, enabled ? "1" : "0");
        }

        await _db.SaveChangesAsync();
        return Ok(new
        {
            data = new
            {
                message = "Moderation settings updated",
                settings = await BuildModerationSettings()
            }
        });
    }

    private async Task<IActionResult> CreateMemberPremiumConnectOnboarding()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var accountId = await GetTenantConfigValueAsync(MemberPremiumConnectAccountKey);
        if (string.IsNullOrWhiteSpace(accountId))
        {
            accountId = $"acct_compat_{tenantId}_{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}";
            await UpsertTenantConfigValueAsync(MemberPremiumConnectAccountKey, accountId);
            await _db.SaveChangesAsync();
        }

        return Ok(new
        {
            data = new
            {
                settings = await BuildMemberPremiumSettings(tenantId),
                onboarding_url = $"https://connect.stripe.com/setup/{accountId}"
            }
        });
    }

    private async Task<IActionResult> GetMemberPremiumFinanceOverview()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var rows = await _db.MoneyDonations
            .AsNoTracking()
            .Where(d => d.TenantId == tenantId)
            .ToListAsync();

        var completed = rows.Where(d => d.Status == MoneyDonationStatus.Succeeded).ToList();
        var refunded = rows.Where(d => d.Status == MoneyDonationStatus.Refunded).ToList();
        var pending = rows.Where(d => d.Status == MoneyDonationStatus.Pending).ToList();
        var failed = rows.Where(d => d.Status == MoneyDonationStatus.Failed || d.Status == MoneyDonationStatus.Cancelled).ToList();
        var disputes = await LoadMemberPremiumDisputes();

        return Ok(new
        {
            data = new
            {
                overview = new
                {
                    totals = new
                    {
                        completed_cents = completed.Sum(d => d.AmountMinorUnits),
                        refunded_cents = refunded.Sum(d => d.AmountMinorUnits),
                        pending_cents = pending.Sum(d => d.AmountMinorUnits),
                        failed_count = failed.Count
                    },
                    routing = new
                    {
                        platform_fallback_cents = completed.Sum(d => d.AmountMinorUnits),
                        tenant_connect_cents = 0L,
                        platform_fallback_count = completed.Count,
                        tenant_connect_count = 0
                    },
                    gift_aid = new
                    {
                        ready_cents = 0L,
                        ready_count = 0
                    },
                    recurring = new
                    {
                        active_count = await _db.UserSubscriptions.AsNoTracking().CountAsync(s => s.Status == SubscriptionStatus.Active),
                        past_due_count = 0,
                        canceled_count = await _db.UserSubscriptions.AsNoTracking().CountAsync(s => s.Status == SubscriptionStatus.Cancelled)
                    },
                    disputes = new
                    {
                        open_count = disputes.Count
                    },
                    receipts = new
                    {
                        failed_email_count = 0
                    }
                }
            }
        });
    }

    private async Task<IActionResult> GetMemberPremiumFinanceDisputes()
    {
        if (!TryRequireTenant(out _, out var tenantError)) return tenantError!;

        var limit = 50;
        if (int.TryParse(Request.Query["limit"].FirstOrDefault(), out var parsedLimit))
        {
            limit = Math.Clamp(parsedLimit, 1, 200);
        }

        var disputes = (await LoadMemberPremiumDisputes()).Take(limit).ToList();
        return Ok(new { data = new { items = disputes } });
    }

    private async Task<IActionResult> GetMemberPremiumGiftAidCsv()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var donations = await CompletedMemberPremiumDonations(tenantId).ToListAsync();
        var lines = new List<string>
        {
            "donation_id,donor_name,donor_email,amount,currency,declaration_name,address_line1,address_line2,town,postcode,country,consented_at,donation_date"
        };

        lines.AddRange(donations.Select(d => string.Join(',', new[]
        {
            d.Id.ToString(CultureInfo.InvariantCulture),
            Csv(d.DonorDisplayName),
            Csv(d.DonorEmail),
            FormatMinorUnits(d.AmountMinorUnits),
            Csv(d.Currency.ToUpperInvariant()),
            string.Empty,
            string.Empty,
            string.Empty,
            string.Empty,
            string.Empty,
            string.Empty,
            string.Empty,
            Csv((d.CompletedAt ?? d.CreatedAt).ToString("O", CultureInfo.InvariantCulture))
        })));

        return File(Encoding.UTF8.GetBytes(string.Join('\n', lines) + "\n"), "text/csv", "gift-aid-donations.csv");
    }

    private async Task<IActionResult> GetMemberPremiumAnnualReceiptsCsv()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var year = DateTime.UtcNow.Year;
        if (int.TryParse(Request.Query["year"].FirstOrDefault(), out var parsedYear)
            && parsedYear >= 2000
            && parsedYear <= DateTime.UtcNow.Year + 1)
        {
            year = parsedYear;
        }

        var donations = await _db.MoneyDonations
            .AsNoTracking()
            .Where(d => d.TenantId == tenantId
                && (d.Status == MoneyDonationStatus.Succeeded || d.Status == MoneyDonationStatus.Refunded)
                && d.CreatedAt.Year == year)
            .OrderBy(d => d.CreatedAt)
            .ToListAsync();

        var lines = new List<string>
        {
            "donation_id,user_id,donor_name,donor_email,amount,currency,status,payment_method,fund_code,payment_route,stripe_account_id,stripe_payment_intent_id,gift_aid_claim_status,donation_date"
        };

        lines.AddRange(donations.Select(d => string.Join(',', new[]
        {
            d.Id.ToString(CultureInfo.InvariantCulture),
            d.DonorUserId?.ToString(CultureInfo.InvariantCulture) ?? string.Empty,
            Csv(d.DonorDisplayName),
            Csv(d.DonorEmail),
            FormatMinorUnits(d.AmountMinorUnits),
            Csv(d.Currency.ToUpperInvariant()),
            Csv(ToLaravelDonationStatus(d.Status)),
            Csv("stripe"),
            Csv("general"),
            Csv("platform_default"),
            string.Empty,
            Csv(d.StripePaymentIntentId),
            Csv("not_eligible"),
            Csv((d.CompletedAt ?? d.CreatedAt).ToString("O", CultureInfo.InvariantCulture))
        })));

        return File(Encoding.UTF8.GetBytes(string.Join('\n', lines) + "\n"), "text/csv", $"donation-annual-receipts-{year}.csv");
    }

    private async Task<object> BuildMemberPremiumSettings(int tenantId)
    {
        var accountId = NormalizeStripeConnectAccountId(await GetTenantConfigValueAsync(MemberPremiumConnectAccountKey));
        var configuredRoute = accountId == string.Empty ? "platform_default" : "tenant_connect";
        var accountStatus = accountId == string.Empty
            ? new
            {
                state = "not_connected",
                charges_enabled = false,
                payouts_enabled = false,
                details_submitted = false,
                requirements_due = Array.Empty<string>(),
                disabled_reason = (string?)null,
                error = (string?)null
            }
            : new
            {
                state = "unknown",
                charges_enabled = false,
                payouts_enabled = false,
                details_submitted = false,
                requirements_due = Array.Empty<string>(),
                disabled_reason = (string?)null,
                error = (string?)"Stripe account status could not be checked."
            };

        return new
        {
            stripe_connect_account_id = accountId,
            active_stripe_account_id = string.Empty,
            payment_route = "platform_default",
            configured_payment_route = configuredRoute,
            account_status = accountStatus,
            fallback_reason = accountId == string.Empty ? null : "stripe_connect_not_ready"
        };
    }

    private static object MapMemberPremiumAdminTier(
        SubscriptionPlan plan,
        MemberPremiumTierMetadata? metadata,
        int fallbackSortOrder,
        int activeSubscriberCount) => new
    {
        id = plan.Id,
        tenant_id = plan.TenantId,
        slug = metadata?.Slug ?? Slugify(plan.Name),
        name = plan.Name,
        description = plan.Description,
        monthly_price_cents = metadata?.MonthlyPriceCents ?? ToCents(plan.Price),
        yearly_price_cents = metadata?.YearlyPriceCents ?? ToCents(plan.Price * 12m),
        stripe_price_id_monthly = metadata?.StripePriceIdMonthly,
        stripe_price_id_yearly = metadata?.StripePriceIdYearly,
        stripe_price_account_id = metadata?.StripePriceAccountId,
        features = metadata?.Features.ToArray() ?? NormalizePlanFeatures(plan.Features),
        sort_order = metadata?.SortOrder ?? fallbackSortOrder,
        is_active = plan.IsActive,
        active_subscriber_count = activeSubscriberCount
    };

    private static object MapMemberPremiumAdminTierDetail(SubscriptionPlan plan, MemberPremiumTierMetadata? metadata) => new
    {
        id = plan.Id,
        tenant_id = plan.TenantId,
        slug = metadata?.Slug ?? Slugify(plan.Name),
        name = plan.Name,
        description = plan.Description,
        monthly_price_cents = metadata?.MonthlyPriceCents ?? ToCents(plan.Price),
        yearly_price_cents = metadata?.YearlyPriceCents ?? ToCents(plan.Price * 12m),
        stripe_price_id_monthly = metadata?.StripePriceIdMonthly,
        stripe_price_id_yearly = metadata?.StripePriceIdYearly,
        stripe_price_account_id = metadata?.StripePriceAccountId,
        features = metadata?.Features.ToArray() ?? NormalizePlanFeatures(plan.Features),
        sort_order = metadata?.SortOrder ?? 0,
        is_active = plan.IsActive,
        created_at = plan.CreatedAt,
        updated_at = plan.UpdatedAt
    };

    private async Task<MemberPremiumTierMetadata?> LoadMemberPremiumTierMetadata(int tierId)
    {
        var raw = await GetTenantConfigValueAsync(MemberPremiumTierMetadataKey(tierId));
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<MemberPremiumTierMetadata>(raw, StoreJsonOptions);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private async Task SaveMemberPremiumTierMetadata(int tierId, MemberPremiumTierMetadata metadata)
    {
        await UpsertTenantConfigValueAsync(
            MemberPremiumTierMetadataKey(tierId),
            JsonSerializer.Serialize(metadata, StoreJsonOptions));
    }

    private static string MemberPremiumTierMetadataKey(int tierId) => $"{MemberPremiumTierMetadataKeyPrefix}{tierId}";

    private static string LocalMemberPremiumStripePriceId(int tenantId, int tierId, string interval)
        => $"price_local_member_premium_{tenantId}_{tierId}_{interval}";

    private static bool IsValidMemberPremiumTierSlug(string slug)
    {
        if (slug.Length is < 1 or > 80 || !char.IsLetterOrDigit(slug[0]))
        {
            return false;
        }

        return slug.All(ch => char.IsAsciiLetterOrDigit(ch) || ch == '-' || ch == '_');
    }

    private static string[] NormalizePlanFeatures(string? features)
    {
        if (string.IsNullOrWhiteSpace(features))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<string[]>(features, StoreJsonOptions)?
                .Where(feature => !string.IsNullOrWhiteSpace(feature))
                .Select(feature => feature.Trim())
                .ToArray() ?? [];
        }
        catch (JsonException)
        {
            return features
                .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Where(feature => !string.IsNullOrWhiteSpace(feature))
                .ToArray();
        }
    }

    private static int ToCents(decimal amount) => (int)decimal.Round(amount * 100m, 0, MidpointRounding.AwayFromZero);

    private async Task<Dictionary<string, bool>> BuildModerationSettings()
    {
        var settings = ModerationSettingKeys.ToDictionary(key => key, _ => false, StringComparer.OrdinalIgnoreCase);
        foreach (var key in ModerationSettingKeys)
        {
            var value = await GetTenantConfigValueAsync(ModerationSettingPrefix + key);
            settings[key] = IsStoredEnabled(value);
        }

        return settings;
    }

    private static object FormatModerationItem(ContentReport report)
    {
        var title = ModerationTitle(report);
        var authorName = FormatUserName(report.Reporter);
        var reviewerName = FormatUserName(report.ReviewedBy);

        return new
        {
            id = report.Id,
            content_type = report.ContentType,
            content_id = report.ContentId,
            title,
            body = report.Description,
            author_id = report.ReporterId,
            author_name = authorName,
            author_avatar = report.Reporter?.AvatarUrl,
            author = report.Reporter == null
                ? null
                : new
                {
                    id = report.Reporter.Id,
                    name = authorName,
                    email = report.Reporter.Email,
                    avatar = report.Reporter.AvatarUrl
                },
            status = MapModerationStatus(report.Status),
            auto_flagged = report.Status == ReportStatus.Escalated,
            auto_flag_reason = report.Status == ReportStatus.Escalated ? report.Reason.ToString() : null,
            flag_reason = report.Status == ReportStatus.Escalated ? report.Reason.ToString() : null,
            reviewed_at = report.ReviewedAt,
            reviewed_by = reviewerName,
            rejection_reason = MapModerationStatus(report.Status) == "rejected" ? report.ReviewNotes : null,
            submitted_at = report.CreatedAt,
            created_at = report.CreatedAt,
            updated_at = report.UpdatedAt
        };
    }

    private static string ModerationTitle(ContentReport report)
    {
        if (!string.IsNullOrWhiteSpace(report.Description))
        {
            var firstLine = report.Description
                .Split(new[] { "\r\n", "\n" }, StringSplitOptions.None)
                .FirstOrDefault(line => !string.IsNullOrWhiteSpace(line));
            if (!string.IsNullOrWhiteSpace(firstLine))
            {
                return firstLine.Trim();
            }
        }

        return string.IsNullOrWhiteSpace(report.ContentType)
            ? $"Content #{report.ContentId}"
            : $"{report.ContentType} #{report.ContentId}";
    }

    private static string MapModerationStatus(ReportStatus status) =>
        status switch
        {
            ReportStatus.Escalated => "flagged",
            ReportStatus.ActionTaken => "approved",
            ReportStatus.Dismissed => "rejected",
            _ => "pending"
        };

    private static ReportStatus[] ModerationStatusesFor(string status) =>
        status switch
        {
            "flagged" => [ReportStatus.Escalated],
            "approved" => [ReportStatus.ActionTaken],
            "rejected" => [ReportStatus.Dismissed],
            "pending" => [ReportStatus.Pending, ReportStatus.UnderReview],
            _ => Enum.GetValues<ReportStatus>()
        };

    private static string FormatUserName(User? user)
    {
        if (user == null)
        {
            return string.Empty;
        }

        var name = string.Join(" ", new[] { user.FirstName, user.LastName }
            .Where(part => !string.IsNullOrWhiteSpace(part)));
        return string.IsNullOrWhiteSpace(name) ? user.Email : name;
    }

    private IQueryable<MoneyDonation> CompletedMemberPremiumDonations(int tenantId)
    {
        return _db.MoneyDonations
            .AsNoTracking()
            .Where(d => d.TenantId == tenantId && d.Status == MoneyDonationStatus.Succeeded)
            .OrderBy(d => d.CreatedAt);
    }

    private async Task<List<Dictionary<string, object?>>> LoadMemberPremiumDisputes()
    {
        var raw = await GetTenantConfigValueAsync(MemberPremiumDisputesKey);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return new List<Dictionary<string, object?>>();
        }

        try
        {
            using var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.ValueKind != JsonValueKind.Array)
            {
                return new List<Dictionary<string, object?>>();
            }

            return doc.RootElement.EnumerateArray()
                .Where(item => item.ValueKind == JsonValueKind.Object)
                .Select(item => item.EnumerateObject()
                    .ToDictionary(p => p.Name, p => ConvertJsonValue(p.Value), StringComparer.OrdinalIgnoreCase))
                .ToList();
        }
        catch (JsonException)
        {
            return new List<Dictionary<string, object?>>();
        }
    }

    private static bool IsValidStripeConnectAccountId(string accountId)
    {
        return accountId == string.Empty
            || (accountId.StartsWith("acct_", StringComparison.Ordinal) && accountId.Length > "acct_".Length && accountId.All(c => char.IsLetterOrDigit(c) || c == '_'));
    }

    private static string NormalizeStripeConnectAccountId(string? accountId)
    {
        var normalized = accountId?.Trim() ?? string.Empty;
        return IsValidStripeConnectAccountId(normalized) ? normalized : string.Empty;
    }

    private static string FormatMinorUnits(long minorUnits)
    {
        return (minorUnits / 100m).ToString("0.00", CultureInfo.InvariantCulture);
    }

    private static string ToLaravelDonationStatus(MoneyDonationStatus status)
    {
        return status switch
        {
            MoneyDonationStatus.Succeeded => "completed",
            MoneyDonationStatus.Refunded => "refunded",
            MoneyDonationStatus.Pending => "pending",
            MoneyDonationStatus.Failed => "failed",
            MoneyDonationStatus.Cancelled => "failed",
            _ => status.ToString().ToLowerInvariant()
        };
    }

    private async Task<List<SupportReportRecord>> LoadSupportReports(int tenantId)
    {
        var raw = await GetTenantConfigValueAsync(SupportReportsKey);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return new List<SupportReportRecord>();
        }

        try
        {
            var records = JsonSerializer.Deserialize<List<SupportReportRecord>>(raw, StoreJsonOptions) ?? new List<SupportReportRecord>();
            return records.Where(r => r.TenantId == tenantId).ToList();
        }
        catch (JsonException)
        {
            return new List<SupportReportRecord>();
        }
    }

    private async Task SaveSupportReports(List<SupportReportRecord> reports)
    {
        var json = JsonSerializer.Serialize(reports.OrderBy(r => r.Id).ToList(), StoreJsonOptions);
        await UpsertTenantConfigValueAsync(SupportReportsKey, json);
        await _db.SaveChangesAsync();
    }

    private IEnumerable<SupportReportRecord> ApplySupportReportFilters(IEnumerable<SupportReportRecord> reports)
    {
        var status = Request.Query["status"].FirstOrDefault();
        if (IsValidSupportReportStatus(status))
        {
            reports = reports.Where(r => r.Status == status);
        }

        var impact = Request.Query["impact"].FirstOrDefault();
        if (impact is "blocked" or "major" or "minor" or "cosmetic")
        {
            reports = reports.Where(r => r.Impact == impact);
        }

        var search = Request.Query["search"].FirstOrDefault()?.Trim();
        if (!string.IsNullOrWhiteSpace(search))
        {
            reports = reports.Where(r =>
                ContainsIgnoreCase(r.Reference, search) ||
                ContainsIgnoreCase(r.Summary, search) ||
                ContainsIgnoreCase(r.Description, search) ||
                ContainsIgnoreCase(r.Route, search));
        }

        return reports;
    }

    private async Task<Dictionary<int, User>> LoadSupportReportUsers(IEnumerable<SupportReportRecord> reports)
    {
        var userIds = reports
            .SelectMany(r => new[] { r.UserId, r.AssignedUserId })
            .Where(id => id.HasValue)
            .Select(id => id!.Value)
            .Distinct()
            .ToList();

        if (userIds.Count == 0)
        {
            return new Dictionary<int, User>();
        }

        return await _db.Users
            .AsNoTracking()
            .Where(u => userIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id);
    }

    private static object FormatSupportReport(SupportReportRecord report, IReadOnlyDictionary<int, User> users, bool includeDiagnostics)
    {
        var payload = new Dictionary<string, object?>
        {
            ["id"] = report.Id,
            ["tenant_id"] = report.TenantId,
            ["tenant_name"] = null,
            ["user_id"] = report.UserId,
            ["assigned_user_id"] = report.AssignedUserId,
            ["reference"] = report.Reference,
            ["source"] = report.Source,
            ["summary"] = report.Summary,
            ["description"] = report.Description,
            ["impact"] = report.Impact,
            ["status"] = report.Status,
            ["module"] = report.Module,
            ["route"] = report.Route,
            ["page_url"] = report.PageUrl,
            ["sentry_event_id"] = report.SentryEventId,
            ["sentry_issue_url"] = report.SentryIssueUrl,
            ["user_agent"] = report.UserAgent,
            ["triage_notes"] = report.TriageNotes,
            ["triaged_at"] = report.TriagedAt,
            ["resolved_at"] = report.ResolvedAt,
            ["closed_at"] = report.ClosedAt,
            ["created_at"] = report.CreatedAt,
            ["updated_at"] = report.UpdatedAt,
            ["reporter"] = report.UserId.HasValue && users.TryGetValue(report.UserId.Value, out var reporter) ? FormatSupportReportUser(reporter) : null,
            ["assignee"] = report.AssignedUserId.HasValue && users.TryGetValue(report.AssignedUserId.Value, out var assignee) ? FormatSupportReportUser(assignee) : null
        };

        if (includeDiagnostics)
        {
            payload["diagnostics"] = report.Diagnostics?.ValueKind == JsonValueKind.Undefined ? null : report.Diagnostics;
        }

        return payload;
    }

    private static object FormatSupportReportUser(User user)
    {
        var name = $"{user.FirstName} {user.LastName}".Trim();
        return new
        {
            id = user.Id,
            name = string.IsNullOrWhiteSpace(name) ? user.Email : name,
            email = user.Email,
            avatar_url = user.AvatarUrl,
            role = user.Role
        };
    }

    private async Task<bool> IsAssignableSupportReportAdmin(int userId, int tenantId)
    {
        return await _db.Users
            .AsNoTracking()
            .AnyAsync(u => u.Id == userId
                && u.TenantId == tenantId
                && u.IsActive
                && (u.Role == "admin" || u.Role == "tenant_admin" || u.Role == "super_admin" || u.Role == "god"));
    }

    private int QueryInt(string key, int fallback, int min, int max)
    {
        if (!int.TryParse(Request.Query[key].FirstOrDefault(), out var parsed))
        {
            return fallback;
        }

        return Math.Clamp(parsed, min, max);
    }

    private static bool IsValidSupportReportStatus(string? status)
    {
        return status is "open" or "triaged" or "resolved" or "closed";
    }

    private static bool ContainsIgnoreCase(string? haystack, string needle)
    {
        return haystack?.Contains(needle, StringComparison.OrdinalIgnoreCase) == true;
    }

    private static string? NullableJsonString(JsonElement value)
    {
        return value.ValueKind == JsonValueKind.Null ? null : value.GetString()?.Trim();
    }

    private static DateTime ParseDate(string? value)
    {
        return DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal, out var parsed)
            ? parsed
            : DateTime.MinValue;
    }

    private async Task<IActionResult> GetTranslationGlossary()
    {
        var language = Request.Query["language"].FirstOrDefault()?.Trim();
        var entries = await LoadTranslationGlossaryAsync();
        var filtered = string.IsNullOrWhiteSpace(language)
            ? entries
            : entries.Where(e => string.Equals(e.TargetLanguage, language, StringComparison.OrdinalIgnoreCase)).ToList();

        return Ok(new
        {
            success = true,
            data = new
            {
                items = filtered.Select(ToTranslationGlossaryResponse).ToList(),
                total = filtered.Count
            }
        });
    }

    private async Task<IActionResult> CreateTranslationGlossaryEntry()
    {
        var payloadJson = await ReadRequestPayloadJsonAsync();
        using var doc = JsonDocument.Parse(payloadJson);
        if (doc.RootElement.ValueKind != JsonValueKind.Object)
            return BadRequest(new { error = "source_term, target_term, and target_language are required" });

        var sourceTerm = TryFindProperty(doc.RootElement, "source_term", out var source)
            ? JsonElementToString(source)?.Trim()
            : null;
        var targetTerm = TryFindProperty(doc.RootElement, "target_term", out var target)
            ? JsonElementToString(target)?.Trim()
            : null;
        var targetLanguage = TryFindProperty(doc.RootElement, "target_language", out var language)
            ? JsonElementToString(language)?.Trim()
            : null;

        if (string.IsNullOrWhiteSpace(sourceTerm) ||
            string.IsNullOrWhiteSpace(targetTerm) ||
            string.IsNullOrWhiteSpace(targetLanguage))
        {
            return BadRequest(new { error = "source_term, target_term, and target_language are required" });
        }

        var entries = await LoadTranslationGlossaryAsync();
        var entry = new TranslationGlossaryEntry
        {
            Id = entries.Count == 0 ? 1 : entries.Max(e => e.Id) + 1,
            SourceTerm = sourceTerm,
            TargetTerm = targetTerm,
            TargetLanguage = targetLanguage.ToLowerInvariant(),
            IsActive = true,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };
        entries.Add(entry);
        await SaveTranslationGlossaryAsync(entries);

        return Created($"/api/v2/admin/translation/glossary/{entry.Id}", new
        {
            success = true,
            data = ToTranslationGlossaryResponse(entry)
        });
    }

    private async Task<IActionResult> DeleteTranslationGlossaryEntry(int id)
    {
        var entries = await LoadTranslationGlossaryAsync();
        var entry = entries.FirstOrDefault(e => e.Id == id);
        if (entry == null)
            return NotFound(new { error = "Glossary entry not found" });

        entries.Remove(entry);
        await SaveTranslationGlossaryAsync(entries);

        return Ok(new
        {
            success = true,
            data = new
            {
                deleted = true,
                id
            }
        });
    }

    private async Task<List<TranslationGlossaryEntry>> LoadTranslationGlossaryAsync()
    {
        var raw = await GetTenantConfigValueAsync(TranslationGlossaryKey);
        if (string.IsNullOrWhiteSpace(raw))
            return [];

        try
        {
            return JsonSerializer.Deserialize<List<TranslationGlossaryEntry>>(raw, StoreJsonOptions) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private async Task SaveTranslationGlossaryAsync(List<TranslationGlossaryEntry> entries)
    {
        await UpsertTenantConfigValueAsync(TranslationGlossaryKey, JsonSerializer.Serialize(entries, StoreJsonOptions));
        await _db.SaveChangesAsync();
    }

    private static object ToTranslationGlossaryResponse(TranslationGlossaryEntry entry) => new
    {
        id = entry.Id,
        source_term = entry.SourceTerm,
        target_term = entry.TargetTerm,
        target_language = entry.TargetLanguage,
        is_active = entry.IsActive,
        created_at = entry.CreatedAt,
        updated_at = entry.UpdatedAt
    };

    private async Task<IActionResult> GetModuleConfig(string module)
    {
        var settings = await LoadModuleConfigAsync(module);
        var defaults = GetModuleConfigDefaults(module);

        return Ok(new
        {
            success = true,
            data = new
            {
                config = settings,
                defaults
            }
        });
    }

    private async Task<IActionResult> PutModuleConfig(string module)
    {
        var payloadJson = await ReadRequestPayloadJsonAsync();
        using var doc = JsonDocument.Parse(payloadJson);
        if (doc.RootElement.ValueKind != JsonValueKind.Object ||
            !TryFindProperty(doc.RootElement, "key", out var keyElement) ||
            !TryFindProperty(doc.RootElement, "value", out var valueElement))
        {
            return BadRequest(new { error = "key and value are required" });
        }

        var key = JsonElementToString(keyElement)?.Trim();
        if (string.IsNullOrWhiteSpace(key))
            return BadRequest(new { error = "key is required" });

        var settings = await LoadModuleConfigAsync(module);
        var value = ConvertJsonValue(valueElement);
        settings[key] = value;
        await SaveModuleConfigAsync(module, settings);

        return Ok(new
        {
            success = true,
            data = new
            {
                key,
                value
            }
        });
    }

    private async Task<IActionResult> PutModuleConfigBulk(string module)
    {
        var payloadJson = await ReadRequestPayloadJsonAsync();
        using var doc = JsonDocument.Parse(payloadJson);
        if (doc.RootElement.ValueKind != JsonValueKind.Object)
            return BadRequest(new { error = "settings are required" });

        var source = doc.RootElement;
        if (TryFindProperty(doc.RootElement, "settings", out var settingsElement))
            source = settingsElement;

        if (source.ValueKind != JsonValueKind.Object)
            return BadRequest(new { error = "settings must be an object" });

        var settings = await LoadModuleConfigAsync(module);
        var updated = new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);
        foreach (var property in source.EnumerateObject())
        {
            var value = ConvertJsonValue(property.Value);
            settings[property.Name] = value;
            updated[property.Name] = value;
        }

        await SaveModuleConfigAsync(module, settings);

        return Ok(new
        {
            success = true,
            data = new
            {
                updated
            }
        });
    }

    private async Task<Dictionary<string, object?>> LoadModuleConfigAsync(string module)
    {
        var settings = new Dictionary<string, object?>(GetModuleConfigDefaults(module), StringComparer.OrdinalIgnoreCase);
        var raw = await GetTenantConfigValueAsync(ModuleConfigPrefix + module);
        if (string.IsNullOrWhiteSpace(raw))
            return settings;

        try
        {
            using var doc = JsonDocument.Parse(raw);
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
                return settings;

            foreach (var property in doc.RootElement.EnumerateObject())
                settings[property.Name] = ConvertJsonValue(property.Value);
        }
        catch (JsonException)
        {
            return settings;
        }

        return settings;
    }

    private async Task SaveModuleConfigAsync(string module, Dictionary<string, object?> settings)
    {
        var json = JsonSerializer.Serialize(settings, StoreJsonOptions);
        await UpsertTenantConfigValueAsync(ModuleConfigPrefix + module, json);
        if (string.Equals(module, "volunteering", StringComparison.OrdinalIgnoreCase)
            && settings.TryGetValue(
                VolunteerGuardianConsentService.GuardianConsentRequiredConfigKey,
                out var guardianConsentRequired))
        {
            await UpsertTenantConfigValueAsync(
                VolunteerGuardianConsentService.GuardianConsentRequiredConfigKey,
                JsonSerializer.Serialize(guardianConsentRequired, StoreJsonOptions));
        }
        if (string.Equals(module, "volunteering", StringComparison.OrdinalIgnoreCase)
            && settings.TryGetValue(
                ShiftManagementService.RecurringShiftsEnabledConfigKey,
                out var recurringShiftsEnabled))
        {
            await UpsertTenantConfigValueAsync(
                ShiftManagementService.RecurringShiftsEnabledConfigKey,
                JsonSerializer.Serialize(recurringShiftsEnabled, StoreJsonOptions));
        }
        await _db.SaveChangesAsync();
    }

    private static IReadOnlyDictionary<string, object?> GetModuleConfigDefaults(string module) =>
        ModuleConfigDefaults.TryGetValue(module, out var defaults)
            ? defaults
            : new Dictionary<string, object?>(StringComparer.OrdinalIgnoreCase);

    private async Task<IActionResult> GetGroupAutoAssignRules()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var rules = await _db.GroupAutoAssignRules
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(rule => rule.TenantId == tenantId
                && rule.Group != null
                && rule.Group.TenantId == tenantId)
            .OrderBy(rule => rule.GroupId)
            .ThenBy(rule => rule.Id)
            .Select(rule => new
            {
                id = rule.Id,
                group_id = rule.GroupId,
                rule_type = rule.RuleType,
                rule_value = rule.RuleValue,
                is_active = rule.IsActive,
                created_at = rule.CreatedAt,
                group_name = rule.Group!.Name
            })
            .ToListAsync();

        return GroupAutoAssignData(rules);
    }

    private async Task<IActionResult> CreateGroupAutoAssignRule()
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;
        var payload = await ReadJsonObjectPayloadAsync();
        var groupId = JsonInt(payload, "group_id", 0, 0, int.MaxValue);
        var ruleType = JsonString(payload, "rule_type") ?? string.Empty;
        var ruleValue = JsonString(payload, "rule_value") ?? string.Empty;

        if (groupId < 1 || string.IsNullOrEmpty(ruleType) || string.IsNullOrEmpty(ruleValue))
        {
            return GroupAutoAssignError("VALIDATION_ERROR", "Invalid input", StatusCodes.Status422UnprocessableEntity, "group_id");
        }
        if (!IsGroupAutoAssignRuleType(ruleType))
        {
            return GroupAutoAssignError("VALIDATION_ERROR", "Invalid input", StatusCodes.Status422UnprocessableEntity, "rule_type");
        }
        if (!await TenantGroupExistsAsync(tenantId, groupId))
        {
            return GroupAutoAssignError("NOT_FOUND", "Group not found", StatusCodes.Status404NotFound);
        }

        await using var transaction = await _db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
        var rule = new GroupAutoAssignRule
        {
            TenantId = tenantId,
            GroupId = groupId,
            RuleType = ruleType,
            RuleValue = ruleValue,
            IsActive = true,
            CreatedAt = DateTime.UtcNow
        };
        _db.GroupAutoAssignRules.Add(rule);
        await _db.SaveChangesAsync();
        AddGroupAutoAssignAudit(
            tenantId,
            "admin_create_group_auto_assign_rule",
            rule,
            oldValues: null,
            newValues: GroupAutoAssignSnapshot(rule));
        await _db.SaveChangesAsync();
        await transaction.CommitAsync();

        return GroupAutoAssignData(new { id = rule.Id }, StatusCodes.Status201Created);
    }

    private async Task<IActionResult> UpdateGroupAutoAssignRule(int id)
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;
        var payload = await ReadJsonObjectPayloadAsync();
        var hasGroupId = TryGetPayloadProperty(payload, "group_id", out _);
        var hasRuleType = TryGetPayloadProperty(payload, "rule_type", out _);
        var hasRuleValue = TryGetPayloadProperty(payload, "rule_value", out _);
        var hasIsActive = TryGetPayloadProperty(payload, "is_active", out var activeValue);
        if (!hasGroupId && !hasRuleType && !hasRuleValue && !hasIsActive)
        {
            return GroupAutoAssignError("VALIDATION_ERROR", "Invalid input", StatusCodes.Status422UnprocessableEntity);
        }

        var groupId = hasGroupId ? JsonInt(payload, "group_id", 0, 0, int.MaxValue) : 0;
        if (hasGroupId && (groupId < 1 || !await TenantGroupExistsAsync(tenantId, groupId)))
        {
            return GroupAutoAssignError("NOT_FOUND", "Group not found", StatusCodes.Status404NotFound);
        }

        var ruleType = hasRuleType ? JsonString(payload, "rule_type") ?? string.Empty : null;
        if (hasRuleType && !IsGroupAutoAssignRuleType(ruleType!))
        {
            return GroupAutoAssignError("VALIDATION_ERROR", "Invalid input", StatusCodes.Status422UnprocessableEntity, "rule_type");
        }

        var ruleValue = hasRuleValue ? JsonString(payload, "rule_value") ?? string.Empty : null;
        if (hasRuleValue && string.IsNullOrWhiteSpace(ruleValue))
        {
            return GroupAutoAssignError("VALIDATION_ERROR", "Invalid input", StatusCodes.Status422UnprocessableEntity, "rule_value");
        }

        var isActive = false;
        if (hasIsActive && !TryReadBoolean(activeValue, out isActive))
        {
            return GroupAutoAssignError("VALIDATION_ERROR", "Invalid input", StatusCodes.Status422UnprocessableEntity, "is_active");
        }

        await using var transaction = await _db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
        var rule = await _db.GroupAutoAssignRules
            .FromSqlInterpolated($"SELECT * FROM group_auto_assign_rules WHERE id = {id} AND tenant_id = {tenantId} FOR UPDATE")
            .IgnoreQueryFilters()
            .SingleOrDefaultAsync();
        if (rule is null)
        {
            await transaction.RollbackAsync();
            return GroupAutoAssignError("NOT_FOUND", "Auto-assign rule not found", StatusCodes.Status404NotFound);
        }

        var oldValues = GroupAutoAssignSnapshot(rule);
        if (hasGroupId) rule.GroupId = groupId;
        if (hasRuleType) rule.RuleType = ruleType!;
        if (hasRuleValue) rule.RuleValue = ruleValue!;
        if (hasIsActive) rule.IsActive = isActive;
        AddGroupAutoAssignAudit(
            tenantId,
            "admin_update_group_auto_assign_rule",
            rule,
            oldValues,
            GroupAutoAssignSnapshot(rule));
        await _db.SaveChangesAsync();
        await transaction.CommitAsync();

        return GroupAutoAssignData(new { id });
    }

    private async Task<IActionResult> DeleteGroupAutoAssignRule(int id)
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        await using var transaction = await _db.Database.BeginTransactionAsync(IsolationLevel.Serializable);
        var rule = await _db.GroupAutoAssignRules
            .FromSqlInterpolated($"SELECT * FROM group_auto_assign_rules WHERE id = {id} AND tenant_id = {tenantId} FOR UPDATE")
            .IgnoreQueryFilters()
            .SingleOrDefaultAsync();
        if (rule is null)
        {
            await transaction.RollbackAsync();
            return GroupAutoAssignError("NOT_FOUND", "Auto-assign rule not found", StatusCodes.Status404NotFound);
        }

        AddGroupAutoAssignAudit(
            tenantId,
            "admin_delete_group_auto_assign_rule",
            rule,
            GroupAutoAssignSnapshot(rule),
            new { deleted = true });
        _db.GroupAutoAssignRules.Remove(rule);
        await _db.SaveChangesAsync();
        await transaction.CommitAsync();

        return GroupAutoAssignData(new { message = "Auto-assign rule deleted" });
    }

    private async Task<bool> TenantGroupExistsAsync(int tenantId, int groupId) =>
        await _db.Groups.IgnoreQueryFilters().AnyAsync(group => group.Id == groupId && group.TenantId == tenantId);

    private void AddGroupAutoAssignAudit(
        int tenantId,
        string action,
        GroupAutoAssignRule rule,
        object? oldValues,
        object? newValues)
    {
        _db.AuditLogs.Add(new AuditLog
        {
            TenantId = tenantId,
            UserId = GetCurrentAdminUserId(),
            Action = action,
            EntityType = "group_auto_assign_rule",
            EntityId = rule.Id,
            OldValues = oldValues is null ? null : JsonSerializer.Serialize(oldValues, StoreJsonOptions),
            NewValues = newValues is null ? null : JsonSerializer.Serialize(newValues, StoreJsonOptions),
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
            UserAgent = Request.Headers.UserAgent.ToString(),
            Metadata = JsonSerializer.Serialize(new { source = "laravel_react_admin_groups" }, StoreJsonOptions),
            Severity = AuditSeverity.Info,
            CreatedAt = DateTime.UtcNow
        });
    }

    private static object GroupAutoAssignSnapshot(GroupAutoAssignRule rule) => new
    {
        id = rule.Id,
        group_id = rule.GroupId,
        rule_type = rule.RuleType,
        rule_value = rule.RuleValue,
        is_active = rule.IsActive,
        created_at = rule.CreatedAt
    };

    private static bool IsGroupAutoAssignRuleType(string value) =>
        value is "location" or "interest" or "role" or "attribute";

    private IActionResult GroupAutoAssignData(object data, int status = StatusCodes.Status200OK)
    {
        var baseUrl = $"{Request.Scheme}://{Request.Host}{Request.PathBase}".TrimEnd('/');
        return StatusCode(status, new { data, meta = new { base_url = baseUrl } });
    }

    private IActionResult GroupAutoAssignError(string code, string message, int status, string? field = null)
    {
        var error = new Dictionary<string, object?>
        {
            ["code"] = code,
            ["message"] = message
        };
        if (field is not null) error["field"] = field;
        return StatusCode(status, new { errors = new[] { error } });
    }

    private async Task<IActionResult> GetPersistedCompatibilityRead(string path)
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        // Primary read path — typed CompatibilityAuditEntry rows.
        // CLAUDE.md path-to-1000 item 12: replace TenantConfig JSON blob audit
        // with a real audit trail. Kept the legacy JSON-blob fallback below
        // until existing test fixtures stop asserting on the TenantConfig key
        // shape (see AdminExplicitParityControllerTests).
        var typedEntries = await _db.CompatibilityAuditEntries
            .AsNoTracking()
            .Where(e => e.TenantId == tenantId && e.Endpoint == path)
            .OrderByDescending(e => e.OccurredAt)
            .Take(50)
            .ToListAsync();

        if (typedEntries.Count > 0)
        {
            return Ok(new
            {
                data = typedEntries.Select(ToCompatibilityAuditResponse).ToList(),
                meta = new
                {
                    total = typedEntries.Count,
                    source = "compatibility_audit_entries",
                    path
                },
                // The "tenant_config_record" mode label is preserved as a
                // compatibility contract for existing parity tests; the
                // underlying storage is now a typed audit entity.
                compatibility = new
                {
                    mode = "tenant_config_record",
                    side_effect = "read_recorded_writes_only"
                }
            });
        }

        // Legacy fallback — TenantConfig JSON blob. Kept temporarily so old
        // rows recorded before the typed table existed remain readable.
        var records = await LoadStoredRecordsAsync(CompatibilityWritesKey);
        var matching = records
            .Where(r => string.Equals(r.Path, path, StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(r => r.UpdatedAt)
            .Select(ToResponseRecord)
            .ToList();

        return Ok(new
        {
            data = matching,
            meta = new
            {
                total = matching.Count,
                source = "tenant_config",
                path
            },
            compatibility = new
            {
                mode = "tenant_config_record",
                side_effect = "read_recorded_writes_only"
            }
        });
    }

    private async Task<IActionResult> PersistCompatibilityWrite(string action)
    {
        if (!TryRequireTenant(out var tenantId, out var tenantError)) return tenantError!;

        var payloadJson = await ReadRequestPayloadJsonAsync();
        var now = DateTime.UtcNow;

        // Primary (and now only) audit trail — typed CompatibilityAuditEntry row.
        // The legacy TenantConfig JSON dual-write was removed as part of the
        // audit cleanup (CLAUDE.md path-to-1000 item 12). The read endpoint
        // still falls back to the legacy storage for rows recorded before
        // the typed table existed, but new writes only land in the typed table.
        var auditEntry = new CompatibilityAuditEntry
        {
            TenantId = tenantId,
            UserId = GetCurrentAdminUserId(),
            Endpoint = Request.Path.Value ?? string.Empty,
            HttpMethod = Request.Method ?? string.Empty,
            Action = action,
            RequestBody = payloadJson,
            // Response body is filled in below once the audit row has an Id
            // (so the response can echo the persisted Id back to the client).
            ResponseBody = "{}",
            StatusCode = StatusCodes.Status202Accepted,
            OccurredAt = now
        };
        _db.CompatibilityAuditEntries.Add(auditEntry);
        await _db.SaveChangesAsync();

        var responseBody = new
        {
            success = true,
            data = ToCompatibilityAuditResponse(auditEntry),
            compatibility = new
            {
                mode = "tenant_config_record",
                side_effect = "recorded_only"
            }
        };

        // Backfill the persisted response payload for replay by the read path.
        auditEntry.ResponseBody = JsonSerializer.Serialize(responseBody, StoreJsonOptions);
        await _db.SaveChangesAsync();

        return Accepted(responseBody);
    }

    /// <summary>
    /// Maps a typed <see cref="CompatibilityAuditEntry"/> row to the
    /// dictionary shape returned by the legacy
    /// <see cref="GetPersistedCompatibilityRead"/> path so existing parity
    /// consumers do not see a shape change.
    /// </summary>
    private static object ToCompatibilityAuditResponse(CompatibilityAuditEntry entry)
    {
        return new Dictionary<string, object?>
        {
            ["id"] = entry.Id,
            ["kind"] = "admin_explicit_parity_write",
            ["name"] = $"{entry.HttpMethod} {entry.Endpoint}",
            ["status"] = "recorded",
            ["payload"] = ParseStoredPayload(entry.RequestBody),
            ["path"] = entry.Endpoint,
            ["method"] = entry.HttpMethod,
            ["action"] = entry.Action,
            ["admin_user_id"] = entry.UserId,
            ["created_at"] = entry.OccurredAt,
            ["updated_at"] = entry.OccurredAt,
            ["deleted_at"] = (DateTime?)null
        };
    }

    private bool TryRequireTenant(out int tenantId, out IActionResult? error)
    {
        if (_db.CurrentTenantId.HasValue)
        {
            tenantId = _db.CurrentTenantId.Value;
            error = null;
            return true;
        }

        tenantId = 0;
        error = BadRequest(new
        {
            error = "tenant_context_required",
            message = "Admin explicit parity persistence requires a resolved tenant context."
        });
        return false;
    }

    private async Task<List<ApiPartnerRecord>> LoadApiPartners()
    {
        var raw = await GetTenantConfigValueAsync(ApiPartnersKey);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<List<ApiPartnerRecord>>(raw, StoreJsonOptions) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private async Task SaveApiPartners(List<ApiPartnerRecord> partners)
    {
        var json = JsonSerializer.Serialize(partners.OrderBy(p => p.Id).ToList(), StoreJsonOptions);
        await UpsertTenantConfigValueAsync(ApiPartnersKey, json);
        await _db.SaveChangesAsync();
    }

    private async Task<List<ApiPartnerCallLogRecord>> LoadApiPartnerCallLog(int partnerId)
    {
        var raw = await GetTenantConfigValueAsync(ApiPartnerCallLogPrefix + partnerId);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<List<ApiPartnerCallLogRecord>>(raw, StoreJsonOptions) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static object MapApiPartner(ApiPartnerRecord partner) => new
    {
        id = partner.Id,
        name = partner.Name,
        slug = partner.Slug,
        description = partner.Description,
        contact_email = partner.ContactEmail,
        status = partner.Status,
        is_sandbox = partner.IsSandbox,
        allowed_scopes = partner.AllowedScopes,
        allowed_ip_cidrs = partner.AllowedIpCidrs,
        rate_limit_per_minute = partner.RateLimitPerMinute,
        created_at = partner.CreatedAt,
        updated_at = partner.UpdatedAt
    };

    private static (string ClientId, string ClientSecret) IssueApiPartnerCredentials() =>
        ($"ap_{RandomToken(20)}", $"aps_{RandomToken(40)}");

    private static string RandomToken(int length)
    {
        const string chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
        var buffer = new char[length];
        for (var i = 0; i < buffer.Length; i++)
        {
            buffer[i] = chars[RandomNumberGenerator.GetInt32(chars.Length)];
        }

        return new string(buffer);
    }

    private static string Slugify(string value)
    {
        var builder = new StringBuilder();
        foreach (var ch in value.Trim().ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(ch))
            {
                builder.Append(ch);
            }
            else if (builder.Length > 0 && builder[^1] != '-')
            {
                builder.Append('-');
            }
        }

        var slug = builder.ToString().Trim('-');
        return string.IsNullOrWhiteSpace(slug) ? "partner" : slug;
    }

    private async Task<List<LocalAdCampaignRecord>> LoadLocalAdCampaigns()
    {
        var raw = await GetTenantConfigValueAsync(LocalAdvertisingCampaignsKey);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<List<LocalAdCampaignRecord>>(raw, StoreJsonOptions) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private async Task SaveLocalAdCampaigns(List<LocalAdCampaignRecord> campaigns)
    {
        var json = JsonSerializer.Serialize(campaigns.OrderBy(c => c.Id).ToList(), StoreJsonOptions);
        await UpsertTenantConfigValueAsync(LocalAdvertisingCampaignsKey, json);
        await _db.SaveChangesAsync();
    }

    private async Task<List<PaidPushCampaignRecord>> LoadPushCampaigns()
    {
        var raw = await GetTenantConfigValueAsync(PaidPushCampaignsKey);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<List<PaidPushCampaignRecord>>(raw, StoreJsonOptions) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private async Task SavePushCampaigns(List<PaidPushCampaignRecord> campaigns)
    {
        var json = JsonSerializer.Serialize(campaigns.OrderBy(c => c.Id).ToList(), StoreJsonOptions);
        await UpsertTenantConfigValueAsync(PaidPushCampaignsKey, json);
        await _db.SaveChangesAsync();
    }

    private static Dictionary<string, object?> MapLocalAdCampaign(LocalAdCampaignRecord campaign, bool includeStats = false)
    {
        var data = new Dictionary<string, object?>
        {
            ["id"] = campaign.Id,
            ["tenant_id"] = campaign.TenantId,
            ["created_by"] = campaign.CreatedBy,
            ["name"] = campaign.Name,
            ["status"] = campaign.Status,
            ["advertiser_type"] = campaign.AdvertiserType,
            ["budget_cents"] = campaign.BudgetCents,
            ["spent_cents"] = campaign.SpentCents,
            ["start_date"] = campaign.StartDate,
            ["end_date"] = campaign.EndDate,
            ["audience_filters"] = ParseJsonOrNull(campaign.AudienceFiltersJson),
            ["placement"] = campaign.Placement,
            ["approved_by"] = campaign.ApprovedBy,
            ["approved_at"] = campaign.ApprovedAt,
            ["rejection_reason"] = campaign.RejectionReason,
            ["impression_count"] = campaign.ImpressionCount,
            ["click_count"] = campaign.ClickCount,
            ["created_at"] = campaign.CreatedAt,
            ["updated_at"] = campaign.UpdatedAt,
            ["advertiser_name"] = campaign.AdvertiserName,
            ["advertiser_email"] = campaign.AdvertiserEmail,
            ["creative_count"] = campaign.Creatives.Count,
            ["creatives"] = campaign.Creatives.Select(MapLocalAdCreative).ToList()
        };

        if (includeStats)
        {
            data["stats"] = MapLocalAdCampaignStats(campaign);
        }

        return data;
    }

    private static object MapLocalAdCreative(LocalAdCreativeRecord creative) => new
    {
        id = creative.Id,
        campaign_id = creative.CampaignId,
        tenant_id = creative.TenantId,
        headline = creative.Headline,
        body = creative.Body,
        cta_text = creative.CtaText,
        image_url = creative.ImageUrl,
        destination_url = creative.DestinationUrl,
        is_active = creative.IsActive,
        created_at = creative.CreatedAt
    };

    private static object MapLocalAdCampaignStats(LocalAdCampaignRecord campaign)
    {
        var ctr = campaign.ImpressionCount == 0
            ? 0
            : Math.Round(campaign.ClickCount * 100.0 / campaign.ImpressionCount, 2);

        return new
        {
            campaign_id = campaign.Id,
            impressions = campaign.ImpressionCount,
            clicks = campaign.ClickCount,
            ctr_percent = ctr,
            budget_cents = campaign.BudgetCents,
            spent_cents = campaign.SpentCents,
            budget_remaining = Math.Max(0, campaign.BudgetCents - campaign.SpentCents),
            daily = Enumerable.Range(0, 30)
                .Select(offset => new
                {
                    date = DateTime.UtcNow.Date.AddDays(-29 + offset).ToString("yyyy-MM-dd"),
                    impressions = 0,
                    clicks = 0
                })
                .ToList()
        };
    }

    private static Dictionary<string, object?> MapPushCampaign(PaidPushCampaignRecord campaign, bool includeAnalytics = false)
    {
        var data = new Dictionary<string, object?>
        {
            ["id"] = campaign.Id,
            ["tenant_id"] = campaign.TenantId,
            ["created_by"] = campaign.CreatedBy,
            ["name"] = campaign.Name,
            ["status"] = campaign.Status,
            ["advertiser_type"] = campaign.AdvertiserType,
            ["title"] = campaign.Title,
            ["body"] = campaign.Body,
            ["cta_url"] = campaign.CtaUrl,
            ["audience_filter"] = ParseJsonOrNull(campaign.AudienceFilterJson),
            ["audience_radius_km"] = campaign.AudienceRadiusKm,
            ["audience_min_trust_tier"] = campaign.AudienceMinTrustTier,
            ["target_count"] = campaign.TargetCount,
            ["actual_send_count"] = campaign.ActualSendCount,
            ["schedule_at"] = campaign.ScheduledAt,
            ["scheduled_at"] = campaign.ScheduledAt,
            ["sent_at"] = campaign.SentAt,
            ["cost_per_send"] = campaign.CostPerSend,
            ["total_cost_cents"] = campaign.TotalCostCents,
            ["approved_by"] = campaign.ApprovedBy,
            ["approved_at"] = campaign.ApprovedAt,
            ["rejection_reason"] = campaign.RejectionReason,
            ["open_count"] = campaign.OpenCount,
            ["click_count"] = campaign.ClickCount,
            ["created_at"] = campaign.CreatedAt,
            ["updated_at"] = campaign.UpdatedAt,
            ["advertiser_name"] = campaign.AdvertiserName,
            ["advertiser_email"] = campaign.AdvertiserEmail
        };

        if (includeAnalytics)
        {
            data["analytics"] = new
            {
                send_count = campaign.ActualSendCount,
                open_count = campaign.OpenCount,
                click_count = campaign.ClickCount,
                open_rate = campaign.ActualSendCount == 0 ? 0 : Math.Round(campaign.OpenCount * 100.0 / campaign.ActualSendCount, 2),
                daily_breakdown = Enumerable.Range(0, 30)
                    .Select(offset => new
                    {
                        date = DateTime.UtcNow.Date.AddDays(-29 + offset).ToString("yyyy-MM-dd"),
                        sends = 0,
                        opens = 0
                    })
                    .ToList()
            };
        }

        return data;
    }

    private static bool IsFutureDate(string? value) =>
        DateTime.TryParse(value, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed)
            && parsed.ToUniversalTime() > DateTime.UtcNow;

    private static object? ParseJsonOrNull(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<JsonElement>(raw);
        }
        catch (JsonException)
        {
            return raw;
        }
    }

    private async Task<string?> GetTenantConfigValueAsync(string key)
    {
        return await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.Key == key)
            .Select(c => c.Value)
            .FirstOrDefaultAsync();
    }

    private async Task<List<string>> LoadAdminUserRolesAsync(int userId)
    {
        var raw = await GetTenantConfigValueAsync(AdminUserRolesKeyPrefix + userId);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return new List<string>();
        }

        try
        {
            return JsonSerializer.Deserialize<List<string>>(raw, StoreJsonOptions)?
                .Where(role => !string.IsNullOrWhiteSpace(role))
                .Select(role => role.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList() ?? new List<string>();
        }
        catch (JsonException)
        {
            return new List<string>();
        }
    }

    private async Task SaveAdminUserRolesAsync(int userId, IReadOnlyCollection<string> roles)
    {
        var normalized = roles
            .Where(role => !string.IsNullOrWhiteSpace(role))
            .Select(role => role.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(role => role, StringComparer.OrdinalIgnoreCase)
            .ToArray();
        await UpsertTenantConfigValueAsync(AdminUserRolesKeyPrefix + userId, JsonSerializer.Serialize(normalized, StoreJsonOptions));
    }

    private async Task UpsertTenantConfigValueAsync(string key, string value)
    {
        if (!TryRequireTenant(out var tenantId, out _))
        {
            throw new InvalidOperationException("Tenant context is required to persist admin parity config.");
        }

        var existing = await _db.TenantConfigs.FirstOrDefaultAsync(c => c.Key == key);
        if (existing != null)
        {
            existing.Value = value;
            existing.UpdatedAt = DateTime.UtcNow;
            return;
        }

        _db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenantId,
            Key = key,
            Value = value,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        });
    }

    private async Task<string> ReadRequestPayloadJsonAsync()
    {
        Request.EnableBuffering();
        if (Request.Body.CanSeek)
        {
            Request.Body.Position = 0;
        }

        using var reader = new StreamReader(Request.Body, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, leaveOpen: true);
        var raw = await reader.ReadToEndAsync();

        if (Request.Body.CanSeek)
        {
            Request.Body.Position = 0;
        }

        return NormalizePayloadJson(raw);
    }

    private async Task<Dictionary<string, JsonElement>> ReadJsonObjectPayloadAsync()
    {
        var payloadJson = await ReadRequestPayloadJsonAsync();
        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(payloadJson, StoreJsonOptions)
                ?? new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);
        }
        catch (JsonException)
        {
            return new Dictionary<string, JsonElement>(StringComparer.OrdinalIgnoreCase);
        }
    }

    private async Task<List<StoredParityRecord>> LoadStoredRecordsAsync(string key, bool includeDeleted = false)
    {
        var raw = await GetTenantConfigValueAsync(key);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return new List<StoredParityRecord>();
        }

        try
        {
            var records = JsonSerializer.Deserialize<List<StoredParityRecord>>(raw, StoreJsonOptions) ?? new List<StoredParityRecord>();
            return records
                .Where(r => includeDeleted || r.DeletedAt == null)
                .OrderBy(r => r.Id)
                .ToList();
        }
        catch (JsonException)
        {
            return new List<StoredParityRecord>();
        }
    }

    private async Task SaveStoredRecordsAsync(string key, List<StoredParityRecord> records)
    {
        var json = JsonSerializer.Serialize(records.OrderBy(r => r.Id).ToList(), StoreJsonOptions);
        await UpsertTenantConfigValueAsync(key, json);
        await _db.SaveChangesAsync();
    }

    private async Task<List<FederationCreditAgreementRecord>> LoadFederationCreditAgreements()
    {
        var raw = await GetTenantConfigValueAsync(FederationCreditAgreementsKey);
        if (string.IsNullOrWhiteSpace(raw))
        {
            return new List<FederationCreditAgreementRecord>();
        }

        try
        {
            return JsonSerializer.Deserialize<List<FederationCreditAgreementRecord>>(raw, StoreJsonOptions)
                ?? new List<FederationCreditAgreementRecord>();
        }
        catch (JsonException)
        {
            return new List<FederationCreditAgreementRecord>();
        }
    }

    private async Task SaveFederationCreditAgreements(List<FederationCreditAgreementRecord> records)
    {
        var json = JsonSerializer.Serialize(records.OrderBy(r => r.Id).ToList(), StoreJsonOptions);
        await UpsertTenantConfigValueAsync(FederationCreditAgreementsKey, json);
        await _db.SaveChangesAsync();
    }

    private async Task<Dictionary<int, Tenant>> LoadTenantLookup(IEnumerable<int> tenantIds)
    {
        var ids = tenantIds.Distinct().ToArray();
        return await _db.Tenants
            .AsNoTracking()
            .Where(t => ids.Contains(t.Id))
            .ToDictionaryAsync(t => t.Id);
    }

    private StoredParityRecord BuildStoredRecord(int id, string kind, string action, string payloadJson, DateTime now)
    {
        return new StoredParityRecord
        {
            Id = id,
            Kind = kind,
            Name = ExtractNameFromPayload(payloadJson) ?? $"{kind}-{id}",
            Status = ExtractStatusFromPayload(payloadJson),
            PayloadJson = payloadJson,
            Path = Request.Path.Value,
            Method = Request.Method,
            Action = action,
            AdminUserId = GetCurrentAdminUserId(),
            CreatedAt = now,
            UpdatedAt = now
        };
    }

    private void ApplyStoredRecordUpdate(StoredParityRecord record, string payloadJson, string action, DateTime now)
    {
        record.Name = ExtractNameFromPayload(payloadJson) ?? record.Name;
        record.Status = ExtractStatusFromPayload(payloadJson, record.Status);
        record.PayloadJson = payloadJson;
        record.Path = Request.Path.Value;
        record.Method = Request.Method;
        record.Action = action;
        record.AdminUserId = GetCurrentAdminUserId();
        record.DeletedAt = null;
        record.UpdatedAt = now;
    }

    private async Task<HashSet<string>> GetSubscribedTopicKeys()
    {
        var stored = await GetTenantConfigValueAsync(FederationTopicSubscriptionsKey);
        return ExtractTopicKeys(stored);
    }

    private static HashSet<string> ExtractTopicKeys(string? payloadJson)
    {
        var topics = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(payloadJson))
        {
            return topics;
        }

        try
        {
            using var doc = JsonDocument.Parse(payloadJson);
            AddTopicKeys(doc.RootElement, topics);
        }
        catch (JsonException)
        {
            return topics;
        }

        return topics;
    }

    private static void AddTopicKeys(JsonElement element, ISet<string> topics)
    {
        if (element.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in element.EnumerateArray())
            {
                AddTopicKeys(item, topics);
            }

            return;
        }

        if (element.ValueKind == JsonValueKind.String)
        {
            var value = element.GetString();
            if (!string.IsNullOrWhiteSpace(value))
            {
                topics.Add(value);
            }

            return;
        }

        if (element.ValueKind != JsonValueKind.Object)
        {
            return;
        }

        if (TryFindProperty(element, "topics", out var topicsArray) || TryFindProperty(element, "subscriptions", out topicsArray))
        {
            AddTopicKeys(topicsArray, topics);
        }

        if (TryFindProperty(element, "key", out var keyElement) || TryFindProperty(element, "topic", out keyElement) || TryFindProperty(element, "slug", out keyElement))
        {
            var key = JsonElementToString(keyElement);
            if (!string.IsNullOrWhiteSpace(key))
            {
                topics.Add(key);
            }
        }

        foreach (var property in element.EnumerateObject())
        {
            if (property.Value.ValueKind is JsonValueKind.True or JsonValueKind.False)
            {
                if (property.Value.GetBoolean())
                {
                    topics.Add(property.Name);
                }
            }
        }
    }

    private static IEnumerable<(int id, string key, string name, string description)> DefaultFederationTopics()
    {
        return new[]
        {
            (1, "listings.shared", "Shared listings", "Listings published to federation partners."),
            (2, "events.shared", "Shared events", "Events visible across federation partners."),
            (3, "members.directory", "Member directory", "Member directory records shared by approved partnerships."),
            (4, "exchanges.completed", "Completed exchanges", "Completed exchange summaries for cross-tenant accounting."),
            (5, "credit.agreements", "Credit agreements", "Federated credit agreement and exchange-rate updates."),
            (6, "gdpr.aggregate_consent", "Aggregate consent", "Aggregate consent state for federation data sharing."),
            (7, "webhooks.delivery", "Webhook delivery", "Outbound federation webhook delivery status.")
        };
    }

    private static object ToResponseRecord(StoredParityRecord record)
    {
        return new Dictionary<string, object?>
        {
            ["id"] = record.Id,
            ["kind"] = record.Kind,
            ["name"] = record.Name,
            ["status"] = record.Status,
            ["payload"] = ParseStoredPayload(record.PayloadJson),
            ["path"] = record.Path,
            ["method"] = record.Method,
            ["action"] = record.Action,
            ["admin_user_id"] = record.AdminUserId,
            ["created_at"] = record.CreatedAt,
            ["updated_at"] = record.UpdatedAt,
            ["deleted_at"] = record.DeletedAt
        };
    }

    private static object FormatFederationCreditAgreement(
        FederationCreditAgreementRecord record,
        IReadOnlyDictionary<int, Tenant> tenants)
    {
        tenants.TryGetValue(record.FromTenantId, out var fromTenant);
        tenants.TryGetValue(record.ToTenantId, out var toTenant);

        return new Dictionary<string, object?>
        {
            ["id"] = record.Id,
            ["from_tenant_id"] = record.FromTenantId,
            ["from_tenant_name"] = fromTenant?.Name ?? string.Empty,
            ["from_tenant_slug"] = fromTenant?.Slug ?? string.Empty,
            ["to_tenant_id"] = record.ToTenantId,
            ["to_tenant_name"] = toTenant?.Name ?? string.Empty,
            ["to_tenant_slug"] = toTenant?.Slug ?? string.Empty,
            ["partner_tenant"] = toTenant == null
                ? null
                : new
                {
                    id = toTenant.Id,
                    name = toTenant.Name,
                    slug = toTenant.Slug
                },
            ["exchange_rate"] = record.ExchangeRate,
            ["max_monthly_credits"] = record.MaxMonthlyCredits,
            ["monthly_limit"] = record.MaxMonthlyCredits,
            ["current_balance"] = 0m,
            ["credits_sent"] = 0m,
            ["credits_received"] = 0m,
            ["status"] = record.Status,
            ["approved_by_from"] = record.ApprovedByFrom,
            ["approved_by_to"] = record.ApprovedByTo,
            ["created_at"] = record.CreatedAt,
            ["updated_at"] = record.UpdatedAt
        };
    }

    private static object? ParseStoredPayload(string? payloadJson)
    {
        if (string.IsNullOrWhiteSpace(payloadJson))
        {
            return new Dictionary<string, object?>();
        }

        try
        {
            using var doc = JsonDocument.Parse(payloadJson);
            return ConvertJsonValue(doc.RootElement);
        }
        catch (JsonException)
        {
            return payloadJson;
        }
    }

    private static object? ConvertJsonValue(JsonElement value)
    {
        return value.ValueKind switch
        {
            JsonValueKind.Object => value.EnumerateObject()
                .ToDictionary(p => p.Name, p => ConvertJsonValue(p.Value), StringComparer.OrdinalIgnoreCase),
            JsonValueKind.Array => value.EnumerateArray().Select(ConvertJsonValue).ToList(),
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number when value.TryGetInt64(out var longValue) => longValue,
            JsonValueKind.Number when value.TryGetDecimal(out var decimalValue) => decimalValue,
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Null => null,
            _ => value.GetRawText()
        };
    }

    private static bool TryReadBoolean(JsonElement value, out bool result)
    {
        switch (value.ValueKind)
        {
            case JsonValueKind.True:
                result = true;
                return true;
            case JsonValueKind.False:
                result = false;
                return true;
            case JsonValueKind.Number when value.TryGetInt32(out var intValue):
                result = intValue != 0;
                return true;
            case JsonValueKind.String:
                return TryReadBooleanString(value.GetString(), out result);
            default:
                result = false;
                return false;
        }
    }

    private static bool IsStoredEnabled(string? value)
    {
        return TryReadBooleanString(value, out var result) && result;
    }

    private static bool TryReadBooleanString(string? value, out bool result)
    {
        var normalized = value?.Trim();
        if (string.IsNullOrEmpty(normalized))
        {
            result = false;
            return false;
        }

        if (normalized is "1")
        {
            result = true;
            return true;
        }

        if (normalized is "0")
        {
            result = false;
            return true;
        }

        return bool.TryParse(normalized, out result);
    }

    private static int CountPayloadItems(object? payload)
    {
        return payload switch
        {
            null => 0,
            IReadOnlyCollection<object?> collection => collection.Count,
            IReadOnlyDictionary<string, object?> dictionary when dictionary.TryGetValue("topics", out var topics) => CountPayloadItems(topics),
            IReadOnlyDictionary<string, object?> dictionary => dictionary.Count,
            _ => 1
        };
    }

    private static string NormalizePayloadJson(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return "{}";
        }

        try
        {
            using var _ = JsonDocument.Parse(raw);
            return raw;
        }
        catch (JsonException)
        {
            return JsonSerializer.Serialize(new { raw }, StoreJsonOptions);
        }
    }

    private static int NextStoredRecordId(IReadOnlyCollection<StoredParityRecord> records)
    {
        return records.Count == 0 ? 1 : records.Max(r => r.Id) + 1;
    }

    private static int? ExtractIntFromPayload(string payloadJson, string propertyName)
    {
        try
        {
            using var doc = JsonDocument.Parse(payloadJson);
            if (doc.RootElement.ValueKind != JsonValueKind.Object || !TryFindProperty(doc.RootElement, propertyName, out var property))
            {
                return null;
            }

            if (property.ValueKind == JsonValueKind.Number && property.TryGetInt32(out var number))
            {
                return number;
            }

            if (property.ValueKind == JsonValueKind.String && int.TryParse(property.GetString(), out var parsed))
            {
                return parsed;
            }
        }
        catch (JsonException)
        {
            return null;
        }

        return null;
    }

    private static string? ExtractNameFromPayload(string payloadJson)
    {
        return ExtractStringFromPayload(payloadJson, "name", "title", "label", "topic", "key", "slug", "url", "endpoint", "target_url");
    }

    private static string ExtractStatusFromPayload(string payloadJson, string fallback = "active")
    {
        var status = ExtractStringFromPayload(payloadJson, "status", "state");
        if (!string.IsNullOrWhiteSpace(status))
        {
            return status;
        }

        var enabled = ExtractBoolFromPayload(payloadJson, "enabled", "active", "is_active");
        if (enabled.HasValue)
        {
            return enabled.Value ? "active" : "disabled";
        }

        return fallback;
    }

    private static string? ExtractStringFromPayload(string payloadJson, params string[] propertyNames)
    {
        try
        {
            using var doc = JsonDocument.Parse(payloadJson);
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
            {
                return null;
            }

            foreach (var propertyName in propertyNames)
            {
                if (TryFindProperty(doc.RootElement, propertyName, out var property))
                {
                    return JsonElementToString(property);
                }
            }
        }
        catch (JsonException)
        {
            return null;
        }

        return null;
    }

    private static bool? ExtractBoolFromPayload(string payloadJson, params string[] propertyNames)
    {
        try
        {
            using var doc = JsonDocument.Parse(payloadJson);
            if (doc.RootElement.ValueKind != JsonValueKind.Object)
            {
                return null;
            }

            foreach (var propertyName in propertyNames)
            {
                if (!TryFindProperty(doc.RootElement, propertyName, out var property))
                {
                    continue;
                }

                if (property.ValueKind is JsonValueKind.True or JsonValueKind.False)
                {
                    return property.GetBoolean();
                }

                if (property.ValueKind == JsonValueKind.String && bool.TryParse(property.GetString(), out var parsed))
                {
                    return parsed;
                }
            }
        }
        catch (JsonException)
        {
            return null;
        }

        return null;
    }

    private static bool TryFindProperty(JsonElement element, string propertyName, out JsonElement property)
    {
        foreach (var candidate in element.EnumerateObject())
        {
            if (string.Equals(candidate.Name, propertyName, StringComparison.OrdinalIgnoreCase))
            {
                property = candidate.Value;
                return true;
            }
        }

        property = default;
        return false;
    }

    private static string? JsonElementToString(JsonElement value)
    {
        return value.ValueKind switch
        {
            JsonValueKind.String => value.GetString(),
            JsonValueKind.Number => value.GetRawText(),
            JsonValueKind.True => "true",
            JsonValueKind.False => "false",
            JsonValueKind.Null => null,
            _ => value.GetRawText()
        };
    }

    private static string? JsonString(Dictionary<string, JsonElement> payload, string key)
    {
        foreach (var item in payload)
        {
            if (string.Equals(item.Key, key, StringComparison.OrdinalIgnoreCase))
            {
                return JsonElementToString(item.Value)?.Trim();
            }
        }

        return null;
    }

    private static bool TryGetPayloadProperty(Dictionary<string, JsonElement> payload, string key, out JsonElement value)
    {
        foreach (var item in payload)
        {
            if (string.Equals(item.Key, key, StringComparison.OrdinalIgnoreCase))
            {
                value = item.Value;
                return true;
            }
        }

        value = default;
        return false;
    }

    private static bool JsonBool(Dictionary<string, JsonElement> payload, string key, bool fallback)
    {
        foreach (var item in payload)
        {
            if (string.Equals(item.Key, key, StringComparison.OrdinalIgnoreCase)
                && TryReadBoolean(item.Value, out var result))
            {
                return result;
            }
        }

        return fallback;
    }

    private static List<string> JsonStringList(Dictionary<string, JsonElement> payload, string key)
    {
        foreach (var item in payload)
        {
            if (!string.Equals(item.Key, key, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (item.Value.ValueKind == JsonValueKind.Array)
            {
                return item.Value.EnumerateArray()
                    .Select(JsonElementToString)
                    .Where(value => !string.IsNullOrWhiteSpace(value))
                    .Select(value => value!.Trim())
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
            }

            var single = JsonElementToString(item.Value);
            return string.IsNullOrWhiteSpace(single)
                ? []
                : single.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .ToList();
        }

        return [];
    }

    private static int JsonInt(Dictionary<string, JsonElement> payload, string key, int fallback, int min, int max)
    {
        foreach (var item in payload)
        {
            if (!string.Equals(item.Key, key, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            int? parsed = item.Value.ValueKind switch
            {
                JsonValueKind.Number when item.Value.TryGetInt32(out var number) => number,
                JsonValueKind.String when int.TryParse(item.Value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var number) => number,
                _ => null
            };

            return Math.Clamp(parsed ?? fallback, min, max);
        }

        return fallback;
    }

    private static List<int> JsonIntArray(Dictionary<string, JsonElement> payload, string key)
    {
        foreach (var item in payload)
        {
            if (!string.Equals(item.Key, key, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            if (item.Value.ValueKind == JsonValueKind.Array)
            {
                return item.Value.EnumerateArray()
                    .Select(element => element.ValueKind switch
                    {
                        JsonValueKind.Number when element.TryGetInt32(out var number) => number,
                        JsonValueKind.String when int.TryParse(element.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var number) => number,
                        _ => 0
                    })
                    .Where(number => number > 0)
                    .ToList();
            }

            var single = JsonElementToString(item.Value);
            return string.IsNullOrWhiteSpace(single)
                ? []
                : single.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Select(value => int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var number) ? number : 0)
                    .Where(number => number > 0)
                    .ToList();
        }

        return [];
    }

    private static decimal JsonDecimal(Dictionary<string, JsonElement> payload, string key, decimal fallback)
    {
        foreach (var item in payload)
        {
            if (!string.Equals(item.Key, key, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            return item.Value.ValueKind switch
            {
                JsonValueKind.Number when item.Value.TryGetDecimal(out var number) => number,
                JsonValueKind.String when decimal.TryParse(item.Value.GetString(), NumberStyles.Number, CultureInfo.InvariantCulture, out var number) => number,
                _ => fallback
            };
        }

        return fallback;
    }

    private static string? Truncate(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var trimmed = value.Trim();
        return trimmed.Length <= maxLength ? trimmed : trimmed[..maxLength];
    }

    private async Task<string> GenerateUniqueInviteCode(int tenantId)
    {
        const string chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

        for (var attempt = 0; attempt < 10; attempt++)
        {
            var code = RandomInviteCode(chars, length: 8);
            var exists = await _db.TenantInviteCodes
                .AsNoTracking()
                .AnyAsync(c => c.TenantId == tenantId && c.Code == code);

            if (!exists)
            {
                return code;
            }
        }

        return RandomInviteCode(chars, length: 12);
    }

    private static string RandomInviteCode(string chars, int length)
    {
        var buffer = new char[length];
        for (var i = 0; i < buffer.Length; i++)
        {
            buffer[i] = chars[RandomNumberGenerator.GetInt32(chars.Length)];
        }

        return new string(buffer);
    }

    private static string FederationWebhookLogsKey(int webhookId)
    {
        return $"admin_explicit.federation.webhook_logs.{webhookId}";
    }

    private static object CompatibilityMetadata(string key)
    {
        return new
        {
            mode = "tenant_config",
            key,
            side_effect = "json_persisted"
        };
    }

    private int? GetCurrentAdminUserId()
    {
        var userId = User.FindFirst("sub")?.Value ?? User.FindFirst("user_id")?.Value;
        return int.TryParse(userId, out var parsed) ? parsed : null;
    }

    private async Task<decimal> ActiveMonthlyRevenue()
    {
        return await _db.UserSubscriptions
            .AsNoTracking()
            .Where(s => s.Status == SubscriptionStatus.Active)
            .Select(s => s.Plan == null ? 0 : s.Plan.Price)
            .SumAsync();
    }

    private async Task<string> DefaultBillingCurrency()
    {
        return await _db.SubscriptionPlans
            .AsNoTracking()
            .OrderBy(p => p.Id)
            .Select(p => p.Currency)
            .FirstOrDefaultAsync() ?? "EUR";
    }

    private async Task<int> BillingPlanTierLevel(SubscriptionPlan? plan)
    {
        if (plan == null)
        {
            return 1;
        }

        var cheaperPlans = await _db.SubscriptionPlans
            .AsNoTracking()
            .Where(p => p.IsActive && p.IsPublic && p.Price < plan.Price)
            .Select(p => p.Price)
            .Distinct()
            .CountAsync();

        return cheaperPlans + 1;
    }

    private static string BillingStatusForReact(SubscriptionStatus status) => status switch
    {
        SubscriptionStatus.PastDue => "past_due",
        SubscriptionStatus.Cancelled => "cancelled",
        SubscriptionStatus.Expired => "expired",
        _ => "active"
    };

    private static string MemberPremiumSubscriptionStatusForReact(SubscriptionStatus status) => status switch
    {
        SubscriptionStatus.PastDue => "past_due",
        SubscriptionStatus.Cancelled => "canceled",
        SubscriptionStatus.Expired => "canceled",
        _ => "active"
    };

    private static string BillingInvoiceStatusForReact(SubscriptionStatus status) => status switch
    {
        SubscriptionStatus.Active => "paid",
        SubscriptionStatus.PastDue => "open",
        SubscriptionStatus.Cancelled => "void",
        SubscriptionStatus.Expired => "uncollectible",
        _ => "draft"
    };

    private static bool TryGetLastInt(string path, string prefix, out int id)
    {
        id = 0;
        if (!path.StartsWith(prefix, StringComparison.Ordinal)) return false;

        var tail = path[prefix.Length..];
        if (tail.Contains('/')) return false;

        return int.TryParse(tail, out id);
    }

    private static bool TryGetIntBeforeSuffix(string path, string prefix, string suffix, out int id)
    {
        id = 0;
        if (!path.StartsWith(prefix, StringComparison.Ordinal) || !path.EndsWith(suffix, StringComparison.Ordinal)) return false;

        var tail = path[prefix.Length..^suffix.Length];
        if (tail.Contains('/')) return false;

        return int.TryParse(tail, out id);
    }

    private static bool TryGetJobModerationAction(string path, out int id, out string action)
    {
        id = 0;
        action = string.Empty;

        const string prefix = "/api/v2/admin/jobs/";
        if (!path.StartsWith(prefix, StringComparison.Ordinal))
        {
            return false;
        }

        var parts = path[prefix.Length..].Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length != 2 || !int.TryParse(parts[0], out id))
        {
            return false;
        }

        action = parts[1];
        return action is "approve" or "reject" or "flag";
    }

    private static bool TryGetFederationCreditAgreementAction(string path, out int id, out string action)
    {
        id = 0;
        action = string.Empty;

        const string prefix = "/api/v2/admin/federation/credit-agreements/";
        if (!path.StartsWith(prefix, StringComparison.Ordinal))
        {
            return false;
        }

        var parts = path[prefix.Length..].Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length != 2 || !int.TryParse(parts[0], out id))
        {
            return false;
        }

        action = parts[1];
        return action is "approve" or "reject" or "suspend" or "activate" or "reactivate" or "terminate";
    }

    private static bool TryGetSlugBeforeSuffix(string path, string prefix, string suffix, out string slug)
    {
        slug = string.Empty;
        if (!path.StartsWith(prefix, StringComparison.Ordinal) || !path.EndsWith(suffix, StringComparison.Ordinal)) return false;

        slug = path[prefix.Length..^suffix.Length];
        return !string.IsNullOrWhiteSpace(slug) && !slug.Contains('/');
    }

    private static string Csv(string? value)
    {
        value ??= string.Empty;
        return "\"" + value.Replace("\"", "\"\"") + "\"";
    }

    private sealed class StoredParityRecord
    {
        public int Id { get; set; }
        public string Kind { get; set; } = string.Empty;
        public string? Name { get; set; }
        public string Status { get; set; } = "active";
        public string PayloadJson { get; set; } = "{}";
        public string? Path { get; set; }
        public string? Method { get; set; }
        public string? Action { get; set; }
        public int? AdminUserId { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
        public DateTime? DeletedAt { get; set; }
    }

    private NotFoundObjectResult VolunteerExpenseReceiptNotFound()
        => NotFound(new
        {
            errors = new[] { new { code = "NOT_FOUND", message = "Receipt not found." } }
        });

    private static bool TryExtractFileUploadId(string receiptUrl, out int fileId)
    {
        fileId = 0;
        if (string.IsNullOrWhiteSpace(receiptUrl))
            return false;

        if (Uri.TryCreate(receiptUrl, UriKind.Absolute, out var absolute))
            receiptUrl = absolute.AbsolutePath;

        var segments = receiptUrl.Split('/', StringSplitOptions.RemoveEmptyEntries);
        for (var i = 0; i < segments.Length - 1; i++)
        {
            if (string.Equals(segments[i], "files", StringComparison.OrdinalIgnoreCase)
                && int.TryParse(segments[i + 1], out fileId))
            {
                return true;
            }
        }

        return false;
    }

    private sealed class FederationCreditAgreementRecord
    {
        public int Id { get; set; }
        public int FromTenantId { get; set; }
        public int ToTenantId { get; set; }
        public decimal ExchangeRate { get; set; }
        public decimal? MaxMonthlyCredits { get; set; }
        public string Status { get; set; } = "pending";
        public int? ApprovedByFrom { get; set; }
        public int? ApprovedByTo { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }

    private sealed class TranslationGlossaryEntry
    {
        public int Id { get; set; }
        public string SourceTerm { get; set; } = string.Empty;
        public string TargetTerm { get; set; } = string.Empty;
        public string TargetLanguage { get; set; } = string.Empty;
        public bool IsActive { get; set; } = true;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }

    private sealed class LocalAdCampaignRecord
    {
        public int Id { get; set; }
        public int TenantId { get; set; }
        public int CreatedBy { get; set; }
        public string Name { get; set; } = string.Empty;
        public string Status { get; set; } = "pending_review";
        public string AdvertiserType { get; set; } = "sme";
        public int BudgetCents { get; set; }
        public int SpentCents { get; set; }
        public string? StartDate { get; set; }
        public string? EndDate { get; set; }
        public string? AudienceFiltersJson { get; set; }
        public string Placement { get; set; } = "feed";
        public int? ApprovedBy { get; set; }
        public DateTime? ApprovedAt { get; set; }
        public string? RejectionReason { get; set; }
        public int ImpressionCount { get; set; }
        public int ClickCount { get; set; }
        public string? AdvertiserName { get; set; }
        public string? AdvertiserEmail { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
        public List<LocalAdCreativeRecord> Creatives { get; set; } = [];
    }

    private sealed class LocalAdCreativeRecord
    {
        public int Id { get; set; }
        public int CampaignId { get; set; }
        public int TenantId { get; set; }
        public string Headline { get; set; } = string.Empty;
        public string Body { get; set; } = string.Empty;
        public string? CtaText { get; set; }
        public string? ImageUrl { get; set; }
        public string? DestinationUrl { get; set; }
        public int IsActive { get; set; } = 1;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    private sealed class PaidPushCampaignRecord
    {
        public int Id { get; set; }
        public int TenantId { get; set; }
        public int CreatedBy { get; set; }
        public string Name { get; set; } = string.Empty;
        public string Status { get; set; } = "draft";
        public string AdvertiserType { get; set; } = "sme";
        public string Title { get; set; } = string.Empty;
        public string Body { get; set; } = string.Empty;
        public string? CtaUrl { get; set; }
        public string? AudienceFilterJson { get; set; }
        public int? AudienceRadiusKm { get; set; }
        public string AudienceMinTrustTier { get; set; } = "any";
        public int? TargetCount { get; set; }
        public int ActualSendCount { get; set; }
        public string? ScheduledAt { get; set; }
        public DateTime? SentAt { get; set; }
        public int CostPerSend { get; set; } = 5;
        public int TotalCostCents { get; set; }
        public int? ApprovedBy { get; set; }
        public DateTime? ApprovedAt { get; set; }
        public string? RejectionReason { get; set; }
        public int OpenCount { get; set; }
        public int ClickCount { get; set; }
        public string? AdvertiserName { get; set; }
        public string? AdvertiserEmail { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }

    private sealed class ApiPartnerRecord
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
        public string Slug { get; set; } = string.Empty;
        public string? Description { get; set; }
        public string? ContactEmail { get; set; }
        public string Status { get; set; } = "pending";
        public bool IsSandbox { get; set; } = true;
        public List<string> AllowedScopes { get; set; } = [];
        public List<string> AllowedIpCidrs { get; set; } = [];
        public int RateLimitPerMinute { get; set; } = 60;
        public string? CurrentClientId { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }

    private sealed class ApiPartnerCallLogRecord
    {
        public int Id { get; set; }
        public string Method { get; set; } = "GET";
        public string Path { get; set; } = "/";
        public int StatusCode { get; set; } = 200;
        public int ResponseTimeMs { get; set; }
        public string? Ip { get; set; }
        public string? UserAgent { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    private sealed class MemberPremiumTierMetadata
    {
        public string Slug { get; set; } = string.Empty;
        public int MonthlyPriceCents { get; set; }
        public int YearlyPriceCents { get; set; }
        public string? StripePriceIdMonthly { get; set; }
        public string? StripePriceIdYearly { get; set; }
        public string? StripePriceAccountId { get; set; }
        public List<string> Features { get; set; } = [];
        public int SortOrder { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }

    private sealed class SupportReportRecord
    {
        public int Id { get; set; }
        public int TenantId { get; set; }
        public int? UserId { get; set; }
        public int? AssignedUserId { get; set; }
        public string Reference { get; set; } = string.Empty;
        public string Source { get; set; } = "in_app";
        public string Summary { get; set; } = string.Empty;
        public string Description { get; set; } = string.Empty;
        public string Impact { get; set; } = "minor";
        public string Status { get; set; } = "open";
        public string? Module { get; set; }
        public string? Route { get; set; }
        public string? PageUrl { get; set; }
        public string? SentryEventId { get; set; }
        public string? SentryIssueUrl { get; set; }
        public JsonElement? Diagnostics { get; set; }
        public string? UserAgent { get; set; }
        public string? TriageNotes { get; set; }
        public string? TriagedAt { get; set; }
        public string? ResolvedAt { get; set; }
        public string? ClosedAt { get; set; }
        public string? CreatedAt { get; set; }
        public string? UpdatedAt { get; set; }
    }
}
