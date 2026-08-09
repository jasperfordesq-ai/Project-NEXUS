// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Tenant-scoped paid regional analytics subscription for municipalities and SME partners.
/// Mirrors Laravel's regional_analytics_subscriptions table.
/// </summary>
public class RegionalAnalyticsSubscription : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public string PartnerName { get; set; } = string.Empty;
    public string PartnerType { get; set; } = "municipality";
    public string ContactEmail { get; set; } = string.Empty;
    public string? ContactLanguage { get; set; }
    public string? BillingEmail { get; set; }
    public string PlanTier { get; set; } = "basic";
    public string Status { get; set; } = "trialing";
    public string? StripeSubscriptionId { get; set; }
    public string SubscriptionToken { get; set; } = string.Empty;
    public string? SubscriptionTokenHash { get; set; }
    public DateTime? TrialEndsAt { get; set; }
    public DateTime? CurrentPeriodStart { get; set; }
    public DateTime? CurrentPeriodEnd { get; set; }
    public int MonthlyPriceCents { get; set; }
    public string Currency { get; set; } = "CHF";
    public string? EnabledModules { get; set; }
    public long? CreatedByAdminId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public ICollection<RegionalAnalyticsReport> Reports { get; set; } = new List<RegionalAnalyticsReport>();
    public ICollection<RegionalAnalyticsAccessLog> AccessLogs { get; set; } = new List<RegionalAnalyticsAccessLog>();
}

/// <summary>
/// Tenant-scoped generated regional analytics report metadata.
/// Mirrors Laravel's regional_analytics_reports table.
/// </summary>
public class RegionalAnalyticsReport : ITenantEntity
{
    public long Id { get; set; }
    public long SubscriptionId { get; set; }
    public int TenantId { get; set; }
    public string ReportType { get; set; } = "monthly_summary";
    public DateOnly PeriodStart { get; set; }
    public DateOnly PeriodEnd { get; set; }
    public DateTime? GeneratedAt { get; set; }
    public string? FileUrl { get; set; }
    public string? PayloadJson { get; set; }
    public string? RecipientEmails { get; set; }
    public string Status { get; set; } = "queued";
    public string? ErrorMessage { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public RegionalAnalyticsSubscription? Subscription { get; set; }
}

/// <summary>
/// Tenant-scoped partner access audit log for paid regional analytics.
/// Mirrors Laravel's regional_analytics_access_log table.
/// </summary>
public class RegionalAnalyticsAccessLog : ITenantEntity
{
    public long Id { get; set; }
    public long SubscriptionId { get; set; }
    public int TenantId { get; set; }
    public string AccessedEndpoint { get; set; } = string.Empty;
    public DateTime AccessedAt { get; set; } = DateTime.UtcNow;
    public string? IpHash { get; set; }
    public string? UserAgent { get; set; }

    public Tenant? Tenant { get; set; }
    public RegionalAnalyticsSubscription? Subscription { get; set; }
}

/// <summary>
/// Tenant-scoped cache for expensive regional analytics aggregate payloads.
/// Mirrors Laravel's regional_analytics_cache table.
/// </summary>
public class RegionalAnalyticsCache : ITenantEntity
{
    public long Id { get; set; }
    public int TenantId { get; set; }
    public string ReportType { get; set; } = string.Empty;
    public string Period { get; set; } = string.Empty;
    public string Payload { get; set; } = "{}";
    public DateTime ComputedAt { get; set; }
    public DateTime ExpiresAt { get; set; }

    public Tenant? Tenant { get; set; }
}
