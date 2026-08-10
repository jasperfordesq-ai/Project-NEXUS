// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for computing and caching personal insights for user dashboards.
/// Aggregates data from transactions, exchanges, connections, feed posts,
/// reviews, and XP logs to produce meaningful statistics.
/// </summary>
public class PersonalInsightsService
{
    private readonly NexusDbContext _db;
    private readonly ILogger<PersonalInsightsService> _logger;

    public PersonalInsightsService(NexusDbContext db, ILogger<PersonalInsightsService> logger)
    {
        _db = db;
        _logger = logger;
    }

    // --- DTOs ---

    public class InsightHistoryItem
    {
        public string? Period { get; set; }
        public string Value { get; set; } = string.Empty;
        public DateTime RecordedAt { get; set; }
    }

    /// <summary>
    /// Get insights for a user. Returns cached insights if fresh (less than 24h old),
    /// otherwise triggers recalculation.
    /// </summary>
    public async Task<(List<PersonalInsight>? Insights, string? Error)> GetInsightsAsync(
        int tenantId, int userId, string? period = "month")
    {
        var effectivePeriod = string.IsNullOrWhiteSpace(period) ? "month" : period;
        var cutoff = DateTime.UtcNow.AddHours(-24);

        var cached = await _db.Set<PersonalInsight>()
            .Where(i => i.UserId == userId && i.Period == effectivePeriod && i.CalculatedAt > cutoff)
            .ToListAsync();

        if (cached.Count > 0)
            return (cached, null);

        var insights = await ComputeInsightsAsync(tenantId, userId, effectivePeriod);
        return (insights, null);
    }

    /// <summary>
    /// Force recalculate insights for a user.
    /// </summary>
    public async Task<(List<PersonalInsight>? Insights, string? Error)> RecalculateAsync(int tenantId, int userId)
    {
        var insights = await ComputeInsightsAsync(tenantId, userId, "month");
        return (insights, null);
    }

    /// <summary>
    /// Recalculate and store all personal insights for a user.
    /// </summary>
    public async Task<List<PersonalInsight>> RecalculateInsightsAsync(int tenantId, int userId, string? period = "month")
    {
        return await ComputeInsightsAsync(tenantId, userId, period ?? "month");
    }

    /// <summary>
    /// Get historical values for a specific insight type.
    /// Returns InsightHistoryItem objects with Period, Value, RecordedAt.
    /// </summary>
    public async Task<(List<InsightHistoryItem>? History, string? Error)> GetHistoryAsync(
        int tenantId, int userId, string insightType)
    {
        var items = await _db.Set<PersonalInsight>()
            .Where(i => i.UserId == userId && i.InsightType == insightType)
            .OrderByDescending(i => i.CalculatedAt)
            .Take(50)
            .Select(i => new InsightHistoryItem
            {
                Period = i.Period,
                Value = i.Value,
                RecordedAt = i.CalculatedAt
            })
            .ToListAsync();

        if (items.Count == 0)
            return (null, "No history found for this insight type.");

        return (items, null);
    }

    /// <summary>
    /// Get another user's public insights (limited subset).
    /// </summary>
    public async Task<(List<PersonalInsight>? Insights, string? Error)> GetPublicInsightsAsync(
        int tenantId, int userId)
    {
        var user = await _db.Users.FirstOrDefaultAsync(x => x.Id == userId);
        if (user == null)
            return (null, "User not found.");

        // Return only public-safe insight types
        var publicTypes = new[] { "hours_given", "hours_received", "total_exchanges", "community_rank", "impact_score" };

        var insights = await _db.Set<PersonalInsight>()
            .Where(i => i.UserId == userId && publicTypes.Contains(i.InsightType))
            .OrderByDescending(i => i.CalculatedAt)
            .ToListAsync();

        // If no cached insights, compute them
        if (insights.Count == 0)
        {
            var all = await ComputeInsightsAsync(tenantId, userId, "month");
            insights = all.Where(i => publicTypes.Contains(i.InsightType)).ToList();
        }

        return (insights, null);
    }

    /// <summary>
    /// Get historical values for a specific insight type (original signature).
    /// </summary>
    public async Task<List<PersonalInsight>> GetInsightHistoryAsync(int userId, string insightType)
    {
        return await _db.Set<PersonalInsight>()
            .Where(i => i.UserId == userId && i.InsightType == insightType)
            .OrderByDescending(i => i.CalculatedAt)
            .Take(50)
            .ToListAsync();
    }

    private async Task<List<PersonalInsight>> ComputeInsightsAsync(int tenantId, int userId, string period)
    {
        var since = GetPeriodStart(period);

        _logger.LogInformation(
            "Recalculating insights for user {UserId} period {Period}", userId, period);

        // Remove stale insights for this user and period
        var stale = await _db.Set<PersonalInsight>()
            .Where(i => i.UserId == userId && i.Period == period)
            .ToListAsync();
        _db.Set<PersonalInsight>().RemoveRange(stale);

        var insights = new List<PersonalInsight>();

        // hours_given: sum of transaction amounts where user is sender
        var hoursGiven = await _db.Set<Transaction>()
            .ExcludeInternalWalletAdapters()
            .Where(t => t.SenderId == userId && t.Status == TransactionStatus.Completed && t.CreatedAt >= since)
            .SumAsync(t => (decimal?)t.Amount) ?? 0m;
        insights.Add(CreateInsight(tenantId, userId, "hours_given", hoursGiven.ToString("F1"), "Hours Given", period));

        // hours_received: sum of transaction amounts where user is receiver
        var hoursReceived = await _db.Set<Transaction>()
            .ExcludeInternalWalletAdapters()
            .Where(t => t.ReceiverId == userId && t.Status == TransactionStatus.Completed && t.CreatedAt >= since)
            .SumAsync(t => (decimal?)t.Amount) ?? 0m;
        insights.Add(CreateInsight(tenantId, userId, "hours_received", hoursReceived.ToString("F1"), "Hours Received", period));

        // total_exchanges: count of completed exchanges
        var totalExchanges = await _db.Set<Exchange>()
            .Where(e => (e.InitiatorId == userId || e.ListingOwnerId == userId)
                && e.Status == ExchangeStatus.Completed && e.CreatedAt >= since)
            .CountAsync();
        insights.Add(CreateInsight(tenantId, userId, "total_exchanges", totalExchanges.ToString(), "Total Exchanges", period));

        // top_category: most frequent listing category from user transactions
        var topCategory = await _db.Set<Transaction>()
            .Where(t => (t.SenderId == userId || t.ReceiverId == userId)
                && t.ListingId != null && t.CreatedAt >= since)
            .Join(_db.Set<Listing>(), t => t.ListingId, l => l.Id, (t, l) => l.CategoryId)
            .Where(cid => cid != null)
            .GroupBy(cid => cid)
            .OrderByDescending(g => g.Count())
            .Select(g => g.Key)
            .FirstOrDefaultAsync();

        var categoryName = "None";
        if (topCategory != null)
        {
            var cat = await _db.Set<Category>().FirstOrDefaultAsync(x => x.Id == topCategory.Value);
            categoryName = cat?.Name ?? "Unknown";
        }
        insights.Add(CreateInsight(tenantId, userId, "top_category", categoryName, "Top Category", period));

        // connections_made: count of accepted connections
        var connectionsMade = await _db.Set<Connection>()
            .Where(c => (c.RequesterId == userId || c.AddresseeId == userId)
                && c.Status == "accepted" && c.CreatedAt >= since)
            .CountAsync();
        insights.Add(CreateInsight(tenantId, userId, "connections_made", connectionsMade.ToString(), "Connections Made", period));

        // posts_created: count of feed posts
        var postsCreated = await _db.Set<FeedPost>()
            .Where(p => p.UserId == userId && p.CreatedAt >= since)
            .CountAsync();
        insights.Add(CreateInsight(tenantId, userId, "posts_created", postsCreated.ToString(), "Posts Created", period));

        // community_rank: percentile rank by XP among tenant users
        var userXp = await _db.Set<XpLog>()
            .Where(x => x.UserId == userId)
            .SumAsync(x => (int?)x.Amount) ?? 0;

        var totalUsers = await _db.Users.CountAsync();
        var usersWithLessXp = 0;

        if (totalUsers > 1)
        {
            usersWithLessXp = await _db.Set<XpLog>()
                .GroupBy(x => x.UserId)
                .Select(g => new { UserId = g.Key, TotalXp = g.Sum(x => x.Amount) })
                .Where(u => u.TotalXp < userXp)
                .CountAsync();
        }

        var rank = totalUsers > 1 ? Math.Round((decimal)usersWithLessXp / totalUsers * 100, 1) : 100m;
        insights.Add(CreateInsight(tenantId, userId, "community_rank", rank.ToString("F1"), "Community Rank (percentile)", period));

        // impact_score: weighted composite
        var impactScore = (hoursGiven * 2) + totalExchanges + connectionsMade + postsCreated;
        insights.Add(CreateInsight(tenantId, userId, "impact_score", impactScore.ToString("F1"), "Impact Score", period));

        _db.Set<PersonalInsight>().AddRange(insights);
        await _db.SaveChangesAsync();

        _logger.LogInformation(
            "Recalculated {Count} insights for user {UserId}", insights.Count, userId);

        return insights;
    }

    private static PersonalInsight CreateInsight(
        int tenantId, int userId, string type, string value, string label, string period)
    {
        return new PersonalInsight
        {
            TenantId = tenantId,
            UserId = userId,
            InsightType = type,
            Value = value,
            Label = label,
            Period = period,
            CalculatedAt = DateTime.UtcNow
        };
    }

    private static DateTime GetPeriodStart(string period)
    {
        return period.ToLowerInvariant() switch
        {
            "week" => DateTime.UtcNow.AddDays(-7),
            "month" => DateTime.UtcNow.AddMonths(-1),
            "quarter" => DateTime.UtcNow.AddMonths(-3),
            "year" => DateTime.UtcNow.AddYears(-1),
            "all_time" => DateTime.MinValue,
            _ => DateTime.UtcNow.AddMonths(-1)
        };
    }
}
