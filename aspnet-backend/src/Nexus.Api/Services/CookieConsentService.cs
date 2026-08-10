// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for cookie consent recording and policy management.
/// Phase 32: Cookie Consent system.
/// </summary>
public class CookieConsentService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<CookieConsentService> _logger;

    public CookieConsentService(
        NexusDbContext db,
        TenantContext tenantContext,
        ILogger<CookieConsentService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>
    /// Record a new cookie consent. Creates a new record (consent is append-only for audit).
    /// </summary>
    public async Task<CookieConsent> RecordConsentAsync(
        int? userId,
        string? sessionId,
        bool analytics,
        bool marketing,
        bool preferences,
        string? ipAddress = null,
        string? userAgent = null)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var consent = new CookieConsent
        {
            TenantId = tenantId,
            UserId = userId,
            SessionId = sessionId,
            NecessaryCookies = true, // Always true
            AnalyticsCookies = analytics,
            MarketingCookies = marketing,
            PreferenceCookies = preferences,
            IpAddress = ipAddress,
            UserAgent = userAgent,
            ConsentedAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<CookieConsent>().Add(consent);
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Cookie consent recorded for {Identifier} in tenant {TenantId} (analytics={Analytics}, marketing={Marketing}, preferences={Preferences})",
            userId?.ToString() ?? sessionId ?? "unknown", tenantId, analytics, marketing, preferences);

        return consent;
    }

    /// <summary>
    /// Get the most recent consent for a user or session.
    /// </summary>
    public async Task<CookieConsent?> GetConsentAsync(int? userId, string? sessionId)
    {
        var query = _db.Set<CookieConsent>().AsNoTracking().AsQueryable();

        if (userId.HasValue)
        {
            query = query.Where(c => c.UserId == userId.Value);
        }
        else if (!string.IsNullOrEmpty(sessionId))
        {
            query = query.Where(c => c.SessionId == sessionId);
        }
        else
        {
            return null;
        }

        return await query
            .OrderByDescending(c => c.ConsentedAt)
            .FirstOrDefaultAsync();
    }

    /// <summary>
    /// Update consent by creating a new consent record (for audit trail).
    /// </summary>
    public async Task<CookieConsent?> UpdateConsentAsync(
        int? userId,
        string? sessionId,
        bool? analytics = null,
        bool? marketing = null,
        bool? preferences = null)
    {
        // Get the current consent to use as baseline
        var current = await GetConsentAsync(userId, sessionId);

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var consent = new CookieConsent
        {
            TenantId = tenantId,
            UserId = userId,
            SessionId = sessionId,
            NecessaryCookies = true,
            AnalyticsCookies = analytics ?? current?.AnalyticsCookies ?? false,
            MarketingCookies = marketing ?? current?.MarketingCookies ?? false,
            PreferenceCookies = preferences ?? current?.PreferenceCookies ?? false,
            ConsentedAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<CookieConsent>().Add(consent);
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Cookie consent updated for {Identifier} in tenant {TenantId}",
            userId?.ToString() ?? sessionId ?? "unknown", tenantId);

        return consent;
    }

    /// <summary>
    /// Get the currently active cookie policy for the tenant.
    /// </summary>
    public async Task<CookiePolicy?> GetActivePolicyAsync()
    {
        return await _db.Set<CookiePolicy>()
            .AsNoTracking()
            .Where(p => p.IsActive)
            .OrderByDescending(p => p.PublishedAt ?? p.CreatedAt)
            .FirstOrDefaultAsync();
    }

    /// <summary>
    /// Create a new cookie policy version. Deactivates all previous versions.
    /// </summary>
    public async Task<CookiePolicy> CreatePolicyVersionAsync(string version, string contentHtml)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        // Deactivate existing active policies
        var activePolicies = await _db.Set<CookiePolicy>()
            .Where(p => p.IsActive)
            .ToListAsync();

        foreach (var existing in activePolicies)
        {
            existing.IsActive = false;
        }

        var policy = new CookiePolicy
        {
            TenantId = tenantId,
            Version = version,
            ContentHtml = contentHtml,
            IsActive = true,
            PublishedAt = DateTime.UtcNow,
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<CookiePolicy>().Add(policy);
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Cookie policy version {Version} created for tenant {TenantId}",
            version, tenantId);

        return policy;
    }

    /// <summary>
    /// Get consent statistics: percentage of users with each consent type.
    /// </summary>
    public async Task<ConsentStats> GetConsentStatsAsync()
    {
        // Get the latest consent per user/session using a subquery approach
        var allConsents = await _db.Set<CookieConsent>()
            .AsNoTracking()
            .ToListAsync();

        // Group by userId (or sessionId for anonymous) and take the latest consent per group
        var latestConsents = allConsents
            .GroupBy(c => c.UserId.HasValue ? $"user:{c.UserId}" : $"session:{c.SessionId}")
            .Select(g => g.OrderByDescending(c => c.ConsentedAt).First())
            .ToList();

        var total = latestConsents.Count;
        if (total == 0)
        {
            return new ConsentStats();
        }

        return new ConsentStats
        {
            TotalConsents = total,
            AnalyticsPercentage = Math.Round(100.0 * latestConsents.Count(c => c.AnalyticsCookies) / total, 1),
            MarketingPercentage = Math.Round(100.0 * latestConsents.Count(c => c.MarketingCookies) / total, 1),
            PreferencesPercentage = Math.Round(100.0 * latestConsents.Count(c => c.PreferenceCookies) / total, 1)
        };
    }
}

public class ConsentStats
{
    public int TotalConsents { get; set; }
    public double AnalyticsPercentage { get; set; }
    public double MarketingPercentage { get; set; }
    public double PreferencesPercentage { get; set; }
}
