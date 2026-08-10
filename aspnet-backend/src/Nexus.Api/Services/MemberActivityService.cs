// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for tracking and querying member activities.
/// Provides activity logging, recent activity feeds, and dashboard statistics.
/// </summary>
public class MemberActivityService
{
    private readonly NexusDbContext _db;
    private readonly ILogger<MemberActivityService> _logger;

    public MemberActivityService(NexusDbContext db, ILogger<MemberActivityService> logger)
    {
        _db = db;
        _logger = logger;
    }

    /// <summary>
    /// Log a user activity event.
    /// </summary>
    public async Task LogActivityAsync(int tenantId, int userId, string activityType, string? details = null)
    {
        var log = new MemberActivityLog
        {
            TenantId = tenantId,
            UserId = userId,
            ActivityType = activityType,
            Details = details,
            OccurredAt = DateTime.UtcNow
        };

        _db.MemberActivityLogs.Add(log);
        await _db.SaveChangesAsync();

        _logger.LogDebug("Logged activity {ActivityType} for user {UserId}", activityType, userId);
    }

    /// <summary>
    /// Get recent activity for a user, paginated.
    /// </summary>
    public async Task<(List<MemberActivityLog> Items, int Total)> GetUserActivityAsync(
        int userId, int days = 30, int page = 1, int limit = 20)
    {
        var since = DateTime.UtcNow.AddDays(-days);

        var query = _db.MemberActivityLogs
            .Where(a => a.UserId == userId && a.OccurredAt >= since);

        var total = await query.CountAsync();

        var items = await query
            .OrderByDescending(a => a.OccurredAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return (items, total);
    }

    /// <summary>
    /// Get dashboard summary stats for a user.
    /// Aggregates data from multiple tables: Users, Transactions, Messages, FeedPosts, XpLogs.
    /// </summary>
    public async Task<DashboardStats> GetUserDashboardAsync(int userId)
    {
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (user == null)
            return new DashboardStats();

        var totalExchanges = await _db.Exchanges
            .CountAsync(e => (e.InitiatorId == userId || e.ListingOwnerId == userId)
                          && e.Status == ExchangeStatus.Completed);

        var messagesSent = await _db.Messages.CountAsync(m => m.SenderId == userId);

        var postsCreated = await _db.FeedPosts.CountAsync(p => p.UserId == userId);

        var totalXpEarned = await _db.XpLogs
            .Where(x => x.UserId == userId && x.Amount > 0)
            .SumAsync(x => (int?)x.Amount) ?? 0;

        // Login streak: count consecutive days with activity logs of type "login"
        var loginStreak = await CalculateLoginStreakAsync(userId);

        return new DashboardStats
        {
            TotalExchanges = totalExchanges,
            MessagesSent = messagesSent,
            PostsCreated = postsCreated,
            TotalXpEarned = totalXpEarned,
            LoginStreak = loginStreak,
            MemberSince = user.CreatedAt,
            LastActive = user.LastLoginAt ?? user.CreatedAt
        };
    }

    /// <summary>
    /// Admin: get activity breakdown by type for the tenant.
    /// </summary>
    public async Task<List<ActivityStatEntry>> GetActivityStatsAsync(int tenantId)
    {
        var thirtyDaysAgo = DateTime.UtcNow.AddDays(-30);

        var stats = await _db.MemberActivityLogs
            .Where(a => a.TenantId == tenantId && a.OccurredAt >= thirtyDaysAgo)
            .GroupBy(a => a.ActivityType)
            .Select(g => new ActivityStatEntry
            {
                ActivityType = g.Key,
                Count = g.Count(),
                UniqueUsers = g.Select(a => a.UserId).Distinct().Count(),
                LastOccurred = g.Max(a => a.OccurredAt)
            })
            .OrderByDescending(s => s.Count)
            .ToListAsync();

        return stats;
    }

    private async Task<int> CalculateLoginStreakAsync(int userId)
    {
        var logins = await _db.MemberActivityLogs
            .Where(a => a.UserId == userId && a.ActivityType == "login")
            .OrderByDescending(a => a.OccurredAt)
            .Select(a => a.OccurredAt.Date)
            .Distinct()
            .Take(365)
            .ToListAsync();

        if (logins.Count == 0)
            return 0;

        var streak = 0;
        var expected = DateTime.UtcNow.Date;

        foreach (var loginDate in logins)
        {
            if (loginDate == expected || loginDate == expected.AddDays(-1))
            {
                streak++;
                expected = loginDate.AddDays(-1);
            }
            else
            {
                break;
            }
        }

        return streak;
    }
}

public class DashboardStats
{
    public int TotalExchanges { get; set; }
    public int MessagesSent { get; set; }
    public int PostsCreated { get; set; }
    public int TotalXpEarned { get; set; }
    public int LoginStreak { get; set; }
    public DateTime MemberSince { get; set; }
    public DateTime LastActive { get; set; }
}

public class ActivityStatEntry
{
    public string ActivityType { get; set; } = string.Empty;
    public int Count { get; set; }
    public int UniqueUsers { get; set; }
    public DateTime LastOccurred { get; set; }
}
