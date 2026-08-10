// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Authorization;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;

namespace Nexus.Api.Controllers;

/// <summary>
/// Laravel React super-admin contract for paid Regional Analytics subscriptions.
/// </summary>
[ApiController]
[Route("api/super-admin/regional-analytics")]
[Authorize(Policy = NexusAuthorizationPolicies.PlatformSuperAdminOnly)]
public sealed class RegionalAnalyticsSuperAdminController : ControllerBase
{
    private static readonly string[] AllowedModules = ["trends", "demand_supply", "demographics", "footfall"];
    private static readonly string[] AllowedPartnerTypes = ["municipality", "sme_partner"];
    private static readonly string[] AllowedPlanTiers = ["basic", "pro", "enterprise"];
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly NexusDbContext _db;

    public RegionalAnalyticsSuperAdminController(NexusDbContext db)
    {
        _db = db;
    }

    [HttpGet("subscriptions")]
    [HttpGet("/api/v2/super-admin/regional-analytics/subscriptions")]
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var rows = await _db.RegionalAnalyticsSubscriptions
            .IgnoreQueryFilters()
            .AsNoTracking()
            .OrderByDescending(row => row.Id)
            .Select(row => ProjectSubscription(row))
            .ToListAsync(ct);

        return Ok(Data(new { subscriptions = rows }));
    }

    [HttpPost("subscriptions")]
    [HttpPost("/api/v2/super-admin/regional-analytics/subscriptions")]
    public async Task<IActionResult> Store([FromBody] RegionalAnalyticsSubscriptionRequest request, CancellationToken ct)
    {
        var tenantId = request.TenantId;
        var partnerName = (request.PartnerName ?? string.Empty).Trim();
        var contactEmail = (request.ContactEmail ?? string.Empty).Trim();

        if (tenantId <= 0 || partnerName.Length == 0 || contactEmail.Length == 0)
        {
            return UnprocessableEntity(Error("invalid_request", "tenant_id, partner_name and contact_email are required."));
        }

        var modules = NormalizeModules(request.EnabledModules);
        var rawToken = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
        var tokenHash = Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(rawToken))).ToLowerInvariant();
        var now = DateTime.UtcNow;

        var subscription = new RegionalAnalyticsSubscription
        {
            TenantId = tenantId,
            PartnerName = partnerName,
            PartnerType = NormalizeChoice(request.PartnerType, AllowedPartnerTypes, "municipality"),
            ContactEmail = contactEmail,
            BillingEmail = string.IsNullOrWhiteSpace(request.BillingEmail) ? null : request.BillingEmail.Trim(),
            PlanTier = NormalizeChoice(request.PlanTier, AllowedPlanTiers, "basic"),
            Status = "trialing",
            SubscriptionToken = $"token-ref-new-{Guid.NewGuid():N}"[..34],
            SubscriptionTokenHash = tokenHash,
            TrialEndsAt = now.AddDays(14),
            MonthlyPriceCents = Math.Max(0, request.MonthlyPriceCents ?? 0),
            Currency = NormalizeCurrency(request.Currency),
            EnabledModules = JsonSerializer.Serialize(modules, JsonOptions),
            CreatedByAdminId = User.GetUserId(),
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.RegionalAnalyticsSubscriptions.Add(subscription);
        await _db.SaveChangesAsync(ct);

        subscription.SubscriptionToken = $"token-ref-{subscription.Id}-{tokenHash[..16]}";
        subscription.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        return StatusCode(StatusCodes.Status201Created, Data(new
        {
            subscription_id = subscription.Id,
            subscription_token = rawToken
        }));
    }

    [HttpPut("subscriptions/{id:long}")]
    [HttpPut("/api/v2/super-admin/regional-analytics/subscriptions/{id:long}")]
    public async Task<IActionResult> Update(long id, [FromBody] RegionalAnalyticsSubscriptionRequest request, CancellationToken ct)
    {
        var subscription = await FindSubscriptionAsync(id, ct);
        if (subscription is null)
        {
            return NotFound(Error("SUBSCRIPTION_NOT_FOUND", "Subscription not found."));
        }

        if (request.PartnerName is not null) subscription.PartnerName = request.PartnerName.Trim();
        if (request.ContactEmail is not null) subscription.ContactEmail = request.ContactEmail.Trim();
        if (request.BillingEmail is not null) subscription.BillingEmail = string.IsNullOrWhiteSpace(request.BillingEmail) ? null : request.BillingEmail.Trim();
        if (request.PartnerType is not null) subscription.PartnerType = NormalizeChoice(request.PartnerType, AllowedPartnerTypes, subscription.PartnerType);
        if (request.PlanTier is not null) subscription.PlanTier = NormalizeChoice(request.PlanTier, AllowedPlanTiers, subscription.PlanTier);
        if (request.Status is not null) subscription.Status = NormalizeStatus(request.Status, subscription.Status);
        if (request.MonthlyPriceCents is not null) subscription.MonthlyPriceCents = Math.Max(0, request.MonthlyPriceCents.Value);
        if (request.Currency is not null) subscription.Currency = NormalizeCurrency(request.Currency);
        if (request.EnabledModules is not null) subscription.EnabledModules = JsonSerializer.Serialize(NormalizeModules(request.EnabledModules), JsonOptions);

        subscription.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        return Ok(Data(new { subscription_id = id }));
    }

    [HttpDelete("subscriptions/{id:long}")]
    [HttpDelete("/api/v2/super-admin/regional-analytics/subscriptions/{id:long}")]
    public async Task<IActionResult> Destroy(long id, CancellationToken ct)
    {
        var subscription = await FindSubscriptionAsync(id, ct);
        if (subscription is null)
        {
            return NotFound(Error("SUBSCRIPTION_NOT_FOUND", "Subscription not found."));
        }

        subscription.Status = "cancelled";
        subscription.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(ct);

        return Ok(Data(new { subscription_id = id, status = "cancelled" }));
    }

    [HttpPost("subscriptions/{id:long}/generate-report")]
    [HttpPost("/api/v2/super-admin/regional-analytics/subscriptions/{id:long}/generate-report")]
    public async Task<IActionResult> GenerateReport(long id, CancellationToken ct)
    {
        var subscription = await FindSubscriptionAsync(id, ct);
        if (subscription is null)
        {
            return NotFound(Error("SUBSCRIPTION_NOT_FOUND", "Subscription not found."));
        }

        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        _db.RegionalAnalyticsReports.Add(new RegionalAnalyticsReport
        {
            TenantId = subscription.TenantId,
            SubscriptionId = subscription.Id,
            ReportType = "monthly_summary",
            PeriodStart = new DateOnly(today.Year, today.Month, 1).AddMonths(-1),
            PeriodEnd = new DateOnly(today.Year, today.Month, 1).AddDays(-1),
            Status = "queued",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        });
        await _db.SaveChangesAsync(ct);

        return Ok(Data(new { subscription_id = id, queued = true }));
    }

    [HttpGet("access-log")]
    [HttpGet("/api/v2/super-admin/regional-analytics/access-log")]
    public async Task<IActionResult> AccessLog([FromQuery(Name = "page")] int page = 1, [FromQuery(Name = "per_page")] int perPage = 50, CancellationToken ct = default)
    {
        page = Math.Max(1, page);
        perPage = Math.Clamp(perPage, 1, 200);
        var offset = (page - 1) * perPage;

        var query = _db.RegionalAnalyticsAccessLogs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .OrderByDescending(row => row.Id);
        var total = await query.CountAsync(ct);
        var items = await query
            .Skip(offset)
            .Take(perPage)
            .Select(row => new
            {
                id = row.Id,
                subscription_id = row.SubscriptionId,
                tenant_id = row.TenantId,
                accessed_endpoint = row.AccessedEndpoint,
                accessed_at = row.AccessedAt,
                ip_hash = row.IpHash,
                user_agent = row.UserAgent
            })
            .ToListAsync(ct);

        return Ok(Data(new
        {
            items,
            meta = new
            {
                current_page = page,
                per_page = perPage,
                total,
                total_pages = total > 0 ? (int)Math.Ceiling(total / (double)perPage) : 0,
                has_more = page * perPage < total
            }
        }));
    }

    private async Task<RegionalAnalyticsSubscription?> FindSubscriptionAsync(long id, CancellationToken ct) =>
        await _db.RegionalAnalyticsSubscriptions
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row => row.Id == id, ct);

    private static object ProjectSubscription(RegionalAnalyticsSubscription row) => new
    {
        id = row.Id,
        tenant_id = row.TenantId,
        partner_name = row.PartnerName,
        partner_type = string.IsNullOrWhiteSpace(row.PartnerType) ? "municipality" : row.PartnerType,
        contact_email = row.ContactEmail,
        billing_email = row.BillingEmail,
        plan_tier = string.IsNullOrWhiteSpace(row.PlanTier) ? "basic" : row.PlanTier,
        status = string.IsNullOrWhiteSpace(row.Status) ? "trialing" : row.Status,
        stripe_subscription_id = row.StripeSubscriptionId,
        trial_ends_at = row.TrialEndsAt,
        current_period_start = row.CurrentPeriodStart,
        current_period_end = row.CurrentPeriodEnd,
        monthly_price_cents = row.MonthlyPriceCents,
        currency = string.IsNullOrWhiteSpace(row.Currency) ? "CHF" : row.Currency,
        enabled_modules = ParseModules(row.EnabledModules),
        created_at = row.CreatedAt,
        updated_at = row.UpdatedAt
    };

    private static object Data(object data) => new
    {
        data,
        meta = new { base_url = "" }
    };

    private static object Error(string code, string message) => new
    {
        errors = new[] { new { code, message } }
    };

    private static string NormalizeChoice(string? value, IReadOnlyCollection<string> allowed, string fallback)
    {
        var normalized = (value ?? string.Empty).Trim().ToLowerInvariant();
        return allowed.Contains(normalized) ? normalized : fallback;
    }

    private static string NormalizeStatus(string? value, string fallback)
    {
        var normalized = (value ?? string.Empty).Trim().ToLowerInvariant();
        return new[] { "trialing", "active", "past_due", "cancelled" }.Contains(normalized) ? normalized : fallback;
    }

    private static string NormalizeCurrency(string? value)
    {
        var normalized = new string((value ?? "CHF").Trim().ToUpperInvariant().Where(char.IsLetter).Take(3).ToArray());
        return normalized.Length == 3 ? normalized : "CHF";
    }

    private static IReadOnlyList<string> NormalizeModules(IEnumerable<string>? modules)
    {
        var selected = (modules ?? AllowedModules)
            .Select(module => module.Trim().ToLowerInvariant())
            .Where(module => AllowedModules.Contains(module))
            .Distinct()
            .ToArray();
        return selected.Length == 0 ? [] : selected;
    }

    private static IReadOnlyList<string> ParseModules(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<string[]>(raw, JsonOptions) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }
}

public sealed class RegionalAnalyticsSubscriptionRequest
{
    [JsonPropertyName("tenant_id")]
    public int TenantId { get; set; }

    [JsonPropertyName("partner_name")]
    public string? PartnerName { get; set; }

    [JsonPropertyName("partner_type")]
    public string? PartnerType { get; set; }

    [JsonPropertyName("contact_email")]
    public string? ContactEmail { get; set; }

    [JsonPropertyName("billing_email")]
    public string? BillingEmail { get; set; }

    [JsonPropertyName("plan_tier")]
    public string? PlanTier { get; set; }

    [JsonPropertyName("status")]
    public string? Status { get; set; }

    [JsonPropertyName("monthly_price_cents")]
    public int? MonthlyPriceCents { get; set; }

    [JsonPropertyName("currency")]
    public string? Currency { get; set; }

    [JsonPropertyName("enabled_modules")]
    public string[]? EnabledModules { get; set; }
}
