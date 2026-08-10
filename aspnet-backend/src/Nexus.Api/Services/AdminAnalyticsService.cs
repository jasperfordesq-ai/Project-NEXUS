// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Comprehensive analytics service for the admin dashboard.
/// All queries are tenant-scoped via EF Core global query filters.
/// </summary>
public class AdminAnalyticsService
{
    private readonly NexusDbContext _db;
    private readonly ILogger<AdminAnalyticsService> _logger;

    public AdminAnalyticsService(NexusDbContext db, ILogger<AdminAnalyticsService> logger)
    {
        _db = db;
        _logger = logger;
    }

    /// <summary>
    /// Get a high-level overview of the platform for the current tenant.
    /// </summary>
    public async Task<PlatformOverviewDto> GetPlatformOverviewAsync()
    {
        var now = DateTime.UtcNow;
        var thirtyDaysAgo = now.AddDays(-30);

        // User stats
        var userStats = await _db.Users
            .AsNoTracking()
            .GroupBy(_ => 1)
            .Select(g => new
            {
                TotalUsers = g.Count(),
                ActiveUsers = g.Count(u => u.LastLoginAt != null && u.LastLoginAt >= thirtyDaysAgo),
                NewUsers = g.Count(u => u.CreatedAt >= thirtyDaysAgo),
                AverageLevel = g.Average(u => (double)u.Level),
                TotalXpAwarded = g.Sum(u => (long)u.TotalXp)
            })
            .FirstOrDefaultAsync();

        // Listing stats
        var listingStats = await _db.Listings
            .AsNoTracking()
            .GroupBy(_ => 1)
            .Select(g => new
            {
                TotalActive = g.Count(l => l.Status == ListingStatus.Active),
                NewListings = g.Count(l => l.CreatedAt >= thirtyDaysAgo)
            })
            .FirstOrDefaultAsync();

        // Exchange stats
        var exchangeStats = await _db.Exchanges
            .AsNoTracking()
            .GroupBy(_ => 1)
            .Select(g => new
            {
                TotalExchanges = g.Count(),
                CompletedExchanges = g.Count(e => e.Status == ExchangeStatus.Completed),
                TotalHoursExchanged = g.Where(e => e.Status == ExchangeStatus.Completed && e.ActualHours != null)
                    .Sum(e => (decimal?)e.ActualHours) ?? 0m
            })
            .FirstOrDefaultAsync();

        // Group and event counts
        var totalGroups = await _db.Groups.AsNoTracking().CountAsync();
        var totalEvents = await _db.Events.AsNoTracking().CountAsync();

        return new PlatformOverviewDto
        {
            TotalUsers = userStats?.TotalUsers ?? 0,
            ActiveUsers = userStats?.ActiveUsers ?? 0,
            NewUsersLast30Days = userStats?.NewUsers ?? 0,
            TotalActiveListings = listingStats?.TotalActive ?? 0,
            NewListingsLast30Days = listingStats?.NewListings ?? 0,
            TotalExchanges = exchangeStats?.TotalExchanges ?? 0,
            CompletedExchanges = exchangeStats?.CompletedExchanges ?? 0,
            TotalHoursExchanged = exchangeStats?.TotalHoursExchanged ?? 0m,
            TotalGroups = totalGroups,
            TotalEvents = totalEvents,
            AverageUserLevel = Math.Round(userStats?.AverageLevel ?? 1.0, 2),
            TotalXpAwarded = userStats?.TotalXpAwarded ?? 0
        };
    }

    /// <summary>
    /// Get time-series growth metrics over a specified number of days.
    /// </summary>
    public async Task<GrowthMetricsDto> GetGrowthMetricsAsync(int days = 30)
    {
        var startDate = DateTime.UtcNow.AddDays(-days).Date;

        // New users per day
        var newUsersPerDay = await _db.Users
            .AsNoTracking()
            .Where(u => u.CreatedAt >= startDate)
            .GroupBy(u => u.CreatedAt.Date)
            .Select(g => new TimeSeriesPointDto
            {
                Date = g.Key,
                Count = g.Count()
            })
            .OrderBy(x => x.Date)
            .ToListAsync();

        // New listings per day
        var newListingsPerDay = await _db.Listings
            .AsNoTracking()
            .Where(l => l.CreatedAt >= startDate)
            .GroupBy(l => l.CreatedAt.Date)
            .Select(g => new TimeSeriesPointDto
            {
                Date = g.Key,
                Count = g.Count()
            })
            .OrderBy(x => x.Date)
            .ToListAsync();

        // Exchanges completed per day
        var exchangesPerDay = await _db.Exchanges
            .AsNoTracking()
            .Where(e => e.Status == ExchangeStatus.Completed && e.CompletedAt != null && e.CompletedAt >= startDate)
            .GroupBy(e => e.CompletedAt!.Value.Date)
            .Select(g => new TimeSeriesPointDto
            {
                Date = g.Key,
                Count = g.Count()
            })
            .OrderBy(x => x.Date)
            .ToListAsync();

        // Hours exchanged per day
        var hoursPerDay = await _db.Exchanges
            .AsNoTracking()
            .Where(e => e.Status == ExchangeStatus.Completed && e.CompletedAt != null && e.CompletedAt >= startDate && e.ActualHours != null)
            .GroupBy(e => e.CompletedAt!.Value.Date)
            .Select(g => new TimeSeriesHoursPointDto
            {
                Date = g.Key,
                Hours = g.Sum(e => e.ActualHours!.Value)
            })
            .OrderBy(x => x.Date)
            .ToListAsync();

        return new GrowthMetricsDto
        {
            Days = days,
            NewUsersPerDay = newUsersPerDay,
            NewListingsPerDay = newListingsPerDay,
            ExchangesCompletedPerDay = exchangesPerDay,
            HoursExchangedPerDay = hoursPerDay
        };
    }

    /// <summary>
    /// Get user retention and engagement cohort analysis.
    /// </summary>
    public async Task<UserRetentionDto> GetUserRetentionAsync()
    {
        var now = DateTime.UtcNow;
        var totalUsers = await _db.Users.AsNoTracking().CountAsync();

        if (totalUsers == 0)
        {
            return new UserRetentionDto
            {
                TotalUsers = 0,
                ActiveLast7Days = 0,
                ActiveLast30Days = 0,
                ActiveLast90Days = 0,
                ActiveLast7DaysPercent = 0,
                ActiveLast30DaysPercent = 0,
                ActiveLast90DaysPercent = 0,
                UsersWithExchanges = 0,
                UsersWithExchangesPercent = 0,
                UsersWithoutExchanges = 0,
                UsersWithoutExchangesPercent = 0
            };
        }

        var activeLast7 = await _db.Users.AsNoTracking()
            .CountAsync(u => u.LastLoginAt != null && u.LastLoginAt >= now.AddDays(-7));
        var activeLast30 = await _db.Users.AsNoTracking()
            .CountAsync(u => u.LastLoginAt != null && u.LastLoginAt >= now.AddDays(-30));
        var activeLast90 = await _db.Users.AsNoTracking()
            .CountAsync(u => u.LastLoginAt != null && u.LastLoginAt >= now.AddDays(-90));

        // Users who have completed at least one exchange (as initiator or listing owner)
        var usersWithExchanges = await _db.Exchanges
            .AsNoTracking()
            .Where(e => e.Status == ExchangeStatus.Completed)
            .Select(e => e.InitiatorId)
            .Union(
                _db.Exchanges.AsNoTracking()
                    .Where(e => e.Status == ExchangeStatus.Completed)
                    .Select(e => e.ListingOwnerId)
            )
            .Distinct()
            .CountAsync();

        var usersWithoutExchanges = totalUsers - usersWithExchanges;

        return new UserRetentionDto
        {
            TotalUsers = totalUsers,
            ActiveLast7Days = activeLast7,
            ActiveLast30Days = activeLast30,
            ActiveLast90Days = activeLast90,
            ActiveLast7DaysPercent = Math.Round((double)activeLast7 / totalUsers * 100, 1),
            ActiveLast30DaysPercent = Math.Round((double)activeLast30 / totalUsers * 100, 1),
            ActiveLast90DaysPercent = Math.Round((double)activeLast90 / totalUsers * 100, 1),
            UsersWithExchanges = usersWithExchanges,
            UsersWithExchangesPercent = Math.Round((double)usersWithExchanges / totalUsers * 100, 1),
            UsersWithoutExchanges = usersWithoutExchanges,
            UsersWithoutExchangesPercent = Math.Round((double)usersWithoutExchanges / totalUsers * 100, 1)
        };
    }

    /// <summary>
    /// Get top users ranked by a specified metric.
    /// </summary>
    public async Task<List<TopUserDto>> GetTopUsersAsync(string metric = "exchanges", int limit = 10)
    {
        limit = Math.Clamp(limit, 1, 100);

        switch (metric.ToLowerInvariant())
        {
            case "exchanges":
                return await GetTopUsersByExchangesAsync(limit);
            case "hours_given":
                return await GetTopUsersByHoursGivenAsync(limit);
            case "hours_received":
                return await GetTopUsersByHoursReceivedAsync(limit);
            case "xp":
                return await GetTopUsersByXpAsync(limit);
            case "listings":
                return await GetTopUsersByListingsAsync(limit);
            case "connections":
                return await GetTopUsersByConnectionsAsync(limit);
            default:
                _logger.LogWarning("Unknown metric requested: {Metric}, defaulting to exchanges", metric);
                return await GetTopUsersByExchangesAsync(limit);
        }
    }

    /// <summary>
    /// Get breakdown of listings by category.
    /// </summary>
    public async Task<List<CategoryBreakdownDto>> GetCategoryBreakdownAsync()
    {
        var breakdown = await _db.Listings
            .AsNoTracking()
            .Where(l => l.Status == ListingStatus.Active && l.CategoryId != null)
            .GroupBy(l => new { l.CategoryId, l.Category!.Name })
            .Select(g => new CategoryBreakdownDto
            {
                CategoryId = g.Key.CategoryId!.Value,
                CategoryName = g.Key.Name,
                ListingCount = g.Count(),
                OfferCount = g.Count(l => l.Type == ListingType.Offer),
                RequestCount = g.Count(l => l.Type == ListingType.Request)
            })
            .OrderByDescending(x => x.ListingCount)
            .ToListAsync();

        // Include uncategorized
        var uncategorized = await _db.Listings
            .AsNoTracking()
            .Where(l => l.Status == ListingStatus.Active && l.CategoryId == null)
            .CountAsync();

        if (uncategorized > 0)
        {
            var uncategorizedOffers = await _db.Listings
                .AsNoTracking()
                .CountAsync(l => l.Status == ListingStatus.Active && l.CategoryId == null && l.Type == ListingType.Offer);

            breakdown.Add(new CategoryBreakdownDto
            {
                CategoryId = 0,
                CategoryName = "Uncategorized",
                ListingCount = uncategorized,
                OfferCount = uncategorizedOffers,
                RequestCount = uncategorized - uncategorizedOffers
            });
        }

        return breakdown;
    }

    /// <summary>
    /// Get exchange health metrics: completion rate, average time, dispute rate.
    /// </summary>
    public async Task<ExchangeHealthDto> GetExchangeHealthAsync()
    {
        var totalExchanges = await _db.Exchanges.AsNoTracking().CountAsync();

        if (totalExchanges == 0)
        {
            return new ExchangeHealthDto
            {
                TotalExchanges = 0,
                CompletedCount = 0,
                CancelledCount = 0,
                DisputedCount = 0,
                ExpiredCount = 0,
                CompletionRate = 0,
                DisputeRate = 0,
                AverageDaysToComplete = 0
            };
        }

        var completed = await _db.Exchanges.AsNoTracking()
            .CountAsync(e => e.Status == ExchangeStatus.Completed);
        var cancelled = await _db.Exchanges.AsNoTracking()
            .CountAsync(e => e.Status == ExchangeStatus.Cancelled);
        var disputed = await _db.Exchanges.AsNoTracking()
            .CountAsync(e => e.Status == ExchangeStatus.Disputed || e.Status == ExchangeStatus.Resolved);
        var expired = await _db.Exchanges.AsNoTracking()
            .CountAsync(e => e.Status == ExchangeStatus.Expired);

        // Average days to complete (from creation to completion)
        var completedExchangeDates = await _db.Exchanges
            .AsNoTracking()
            .Where(e => e.Status == ExchangeStatus.Completed && e.CompletedAt != null)
            .Select(e => new { e.CreatedAt, CompletedAt = e.CompletedAt!.Value })
            .ToListAsync();
        var avgDays = completedExchangeDates.Count > 0
            ? completedExchangeDates.Average(e => (e.CompletedAt - e.CreatedAt).TotalDays)
            : 0.0;

        // Terminal states for rate calculations
        var terminalCount = completed + cancelled + expired;

        return new ExchangeHealthDto
        {
            TotalExchanges = totalExchanges,
            CompletedCount = completed,
            CancelledCount = cancelled,
            DisputedCount = disputed,
            ExpiredCount = expired,
            CompletionRate = terminalCount > 0
                ? Math.Round((double)completed / terminalCount * 100, 1)
                : 0,
            DisputeRate = totalExchanges > 0
                ? Math.Round((double)disputed / totalExchanges * 100, 1)
                : 0,
            AverageDaysToComplete = Math.Round(avgDays, 1)
        };
    }

    /// <summary>
    /// Calculate Social Return on Investment (SROI) for the tenant.
    /// V1 feature: quantifies the economic value of time exchanged.
    /// </summary>
    public async Task<SroiReportDto> CalculateSroiAsync(decimal hourValueInCurrency = 15.0m, decimal socialMultiplier = 2.5m)
    {
        var now = DateTime.UtcNow;

        var completedExchanges = await _db.Exchanges
            .AsNoTracking()
            .Where(e => e.Status == ExchangeStatus.Completed && e.ActualHours != null)
            .Select(e => new { e.ActualHours, e.CompletedAt, e.CreatedAt })
            .ToListAsync();

        var totalHours = completedExchanges.Sum(e => e.ActualHours!.Value);
        var directEconomicValue = totalHours * hourValueInCurrency;
        var socialValue = directEconomicValue * socialMultiplier;

        // Monthly breakdown for the last 12 months
        var monthlyBreakdown = completedExchanges
            .Where(e => e.CompletedAt != null && e.CompletedAt >= now.AddMonths(-12))
            .GroupBy(e => new { e.CompletedAt!.Value.Year, e.CompletedAt!.Value.Month })
            .Select(g => new SroiMonthlyDto
            {
                Year = g.Key.Year,
                Month = g.Key.Month,
                HoursExchanged = g.Sum(e => e.ActualHours!.Value),
                EconomicValue = g.Sum(e => e.ActualHours!.Value) * hourValueInCurrency,
                SocialValue = g.Sum(e => e.ActualHours!.Value) * hourValueInCurrency * socialMultiplier,
                ExchangeCount = g.Count()
            })
            .OrderBy(x => x.Year).ThenBy(x => x.Month)
            .ToList();

        // Unique participants
        var uniqueParticipants = await _db.Exchanges
            .AsNoTracking()
            .Where(e => e.Status == ExchangeStatus.Completed)
            .Select(e => e.InitiatorId)
            .Union(_db.Exchanges.AsNoTracking()
                .Where(e => e.Status == ExchangeStatus.Completed)
                .Select(e => e.ListingOwnerId))
            .Distinct()
            .CountAsync();

        return new SroiReportDto
        {
            TotalHoursExchanged = totalHours,
            HourValueInCurrency = hourValueInCurrency,
            SocialMultiplier = socialMultiplier,
            DirectEconomicValue = directEconomicValue,
            SocialValue = socialValue,
            TotalCompletedExchanges = completedExchanges.Count,
            UniqueParticipants = uniqueParticipants,
            MonthlyBreakdown = monthlyBreakdown
        };
    }

    /// <summary>
    /// Get inactive members who haven't logged in within the specified days.
    /// V1 feature: helps admins re-engage dormant members.
    /// </summary>
    public async Task<InactiveMembersDto> GetInactiveMembersAsync(int inactiveDays = 90, int page = 1, int limit = 20)
    {
        var cutoff = DateTime.UtcNow.AddDays(-inactiveDays);

        var query = _db.Users
            .AsNoTracking()
            .Where(u => u.IsActive && (u.LastLoginAt == null || u.LastLoginAt < cutoff));

        var total = await query.CountAsync();
        var members = await query
            .OrderBy(u => u.LastLoginAt ?? u.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(u => new InactiveMemberDto
            {
                UserId = u.Id,
                FirstName = u.FirstName,
                LastName = u.LastName,
                Email = u.Email,
                LastLoginAt = u.LastLoginAt,
                CreatedAt = u.CreatedAt,
                DaysInactive = u.LastLoginAt != null
                    ? (int)(DateTime.UtcNow - u.LastLoginAt.Value).TotalDays
                    : (int)(DateTime.UtcNow - u.CreatedAt).TotalDays
            })
            .ToListAsync();

        return new InactiveMembersDto
        {
            InactiveDaysThreshold = inactiveDays,
            TotalInactive = total,
            Members = members
        };
    }

    #region Private helpers

    private async Task<List<TopUserDto>> GetTopUsersByExchangesAsync(int limit)
    {
        // Count exchanges where user was initiator or listing owner and exchange completed
        var initiatorCounts = _db.Exchanges.AsNoTracking()
            .Where(e => e.Status == ExchangeStatus.Completed)
            .GroupBy(e => e.InitiatorId)
            .Select(g => new { UserId = g.Key, Count = g.Count() });

        var ownerCounts = _db.Exchanges.AsNoTracking()
            .Where(e => e.Status == ExchangeStatus.Completed)
            .GroupBy(e => e.ListingOwnerId)
            .Select(g => new { UserId = g.Key, Count = g.Count() });

        // Use a raw approach: get all completed exchanges, then aggregate in memory
        var completedExchanges = await _db.Exchanges.AsNoTracking()
            .Where(e => e.Status == ExchangeStatus.Completed)
            .Select(e => new { e.InitiatorId, e.ListingOwnerId })
            .ToListAsync();

        var userCounts = completedExchanges
            .SelectMany(e => new[] { e.InitiatorId, e.ListingOwnerId })
            .GroupBy(id => id)
            .Select(g => new { UserId = g.Key, Count = g.Count() })
            .OrderByDescending(x => x.Count)
            .Take(limit)
            .ToList();

        var userIds = userCounts.Select(x => x.UserId).ToList();
        var users = await _db.Users.AsNoTracking()
            .Where(u => userIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id);

        return userCounts.Select(x => new TopUserDto
        {
            UserId = x.UserId,
            FirstName = users.GetValueOrDefault(x.UserId)?.FirstName ?? "",
            LastName = users.GetValueOrDefault(x.UserId)?.LastName ?? "",
            Email = users.GetValueOrDefault(x.UserId)?.Email ?? "",
            Value = x.Count,
            Metric = "exchanges"
        }).ToList();
    }

    private async Task<List<TopUserDto>> GetTopUsersByHoursGivenAsync(int limit)
    {
        var results = await _db.Exchanges.AsNoTracking()
            .Where(e => e.Status == ExchangeStatus.Completed && e.ProviderId != null && e.ActualHours != null)
            .GroupBy(e => e.ProviderId!.Value)
            .Select(g => new { UserId = g.Key, Hours = g.Sum(e => e.ActualHours!.Value) })
            .OrderByDescending(x => x.Hours)
            .Take(limit)
            .ToListAsync();

        var userIds = results.Select(x => x.UserId).ToList();
        var users = await _db.Users.AsNoTracking()
            .Where(u => userIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id);

        return results.Select(x => new TopUserDto
        {
            UserId = x.UserId,
            FirstName = users.GetValueOrDefault(x.UserId)?.FirstName ?? "",
            LastName = users.GetValueOrDefault(x.UserId)?.LastName ?? "",
            Email = users.GetValueOrDefault(x.UserId)?.Email ?? "",
            Value = (double)x.Hours,
            Metric = "hours_given"
        }).ToList();
    }

    private async Task<List<TopUserDto>> GetTopUsersByHoursReceivedAsync(int limit)
    {
        var results = await _db.Exchanges.AsNoTracking()
            .Where(e => e.Status == ExchangeStatus.Completed && e.ReceiverId != null && e.ActualHours != null)
            .GroupBy(e => e.ReceiverId!.Value)
            .Select(g => new { UserId = g.Key, Hours = g.Sum(e => e.ActualHours!.Value) })
            .OrderByDescending(x => x.Hours)
            .Take(limit)
            .ToListAsync();

        var userIds = results.Select(x => x.UserId).ToList();
        var users = await _db.Users.AsNoTracking()
            .Where(u => userIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id);

        return results.Select(x => new TopUserDto
        {
            UserId = x.UserId,
            FirstName = users.GetValueOrDefault(x.UserId)?.FirstName ?? "",
            LastName = users.GetValueOrDefault(x.UserId)?.LastName ?? "",
            Email = users.GetValueOrDefault(x.UserId)?.Email ?? "",
            Value = (double)x.Hours,
            Metric = "hours_received"
        }).ToList();
    }

    private async Task<List<TopUserDto>> GetTopUsersByXpAsync(int limit)
    {
        var results = await _db.Users.AsNoTracking()
            .OrderByDescending(u => u.TotalXp)
            .Take(limit)
            .Select(u => new TopUserDto
            {
                UserId = u.Id,
                FirstName = u.FirstName,
                LastName = u.LastName,
                Email = u.Email,
                Value = u.TotalXp,
                Metric = "xp"
            })
            .ToListAsync();

        return results;
    }

    private async Task<List<TopUserDto>> GetTopUsersByListingsAsync(int limit)
    {
        var results = await _db.Listings.AsNoTracking()
            .Where(l => l.Status == ListingStatus.Active)
            .GroupBy(l => l.UserId)
            .Select(g => new { UserId = g.Key, Count = g.Count() })
            .OrderByDescending(x => x.Count)
            .Take(limit)
            .ToListAsync();

        var userIds = results.Select(x => x.UserId).ToList();
        var users = await _db.Users.AsNoTracking()
            .Where(u => userIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id);

        return results.Select(x => new TopUserDto
        {
            UserId = x.UserId,
            FirstName = users.GetValueOrDefault(x.UserId)?.FirstName ?? "",
            LastName = users.GetValueOrDefault(x.UserId)?.LastName ?? "",
            Email = users.GetValueOrDefault(x.UserId)?.Email ?? "",
            Value = x.Count,
            Metric = "listings"
        }).ToList();
    }

    private async Task<List<TopUserDto>> GetTopUsersByConnectionsAsync(int limit)
    {
        var connections = await _db.Connections.AsNoTracking()
            .Where(c => c.Status == Connection.Statuses.Accepted)
            .Select(c => new { c.RequesterId, c.AddresseeId })
            .ToListAsync();

        var userCounts = connections
            .SelectMany(c => new[] { c.RequesterId, c.AddresseeId })
            .GroupBy(id => id)
            .Select(g => new { UserId = g.Key, Count = g.Count() })
            .OrderByDescending(x => x.Count)
            .Take(limit)
            .ToList();

        var userIds = userCounts.Select(x => x.UserId).ToList();
        var users = await _db.Users.AsNoTracking()
            .Where(u => userIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id);

        return userCounts.Select(x => new TopUserDto
        {
            UserId = x.UserId,
            FirstName = users.GetValueOrDefault(x.UserId)?.FirstName ?? "",
            LastName = users.GetValueOrDefault(x.UserId)?.LastName ?? "",
            Email = users.GetValueOrDefault(x.UserId)?.Email ?? "",
            Value = x.Count,
            Metric = "connections"
        }).ToList();
    }

    #endregion
}

#region DTOs

public class PlatformOverviewDto
{
    [JsonPropertyName("total_users")]
    public int TotalUsers { get; set; }

    [JsonPropertyName("active_users")]
    public int ActiveUsers { get; set; }

    [JsonPropertyName("new_users_last_30_days")]
    public int NewUsersLast30Days { get; set; }

    [JsonPropertyName("total_active_listings")]
    public int TotalActiveListings { get; set; }

    [JsonPropertyName("new_listings_last_30_days")]
    public int NewListingsLast30Days { get; set; }

    [JsonPropertyName("total_exchanges")]
    public int TotalExchanges { get; set; }

    [JsonPropertyName("completed_exchanges")]
    public int CompletedExchanges { get; set; }

    [JsonPropertyName("total_hours_exchanged")]
    public decimal TotalHoursExchanged { get; set; }

    [JsonPropertyName("total_groups")]
    public int TotalGroups { get; set; }

    [JsonPropertyName("total_events")]
    public int TotalEvents { get; set; }

    [JsonPropertyName("average_user_level")]
    public double AverageUserLevel { get; set; }

    [JsonPropertyName("total_xp_awarded")]
    public long TotalXpAwarded { get; set; }
}

public class GrowthMetricsDto
{
    [JsonPropertyName("days")]
    public int Days { get; set; }

    [JsonPropertyName("new_users_per_day")]
    public List<TimeSeriesPointDto> NewUsersPerDay { get; set; } = new();

    [JsonPropertyName("new_listings_per_day")]
    public List<TimeSeriesPointDto> NewListingsPerDay { get; set; } = new();

    [JsonPropertyName("exchanges_completed_per_day")]
    public List<TimeSeriesPointDto> ExchangesCompletedPerDay { get; set; } = new();

    [JsonPropertyName("hours_exchanged_per_day")]
    public List<TimeSeriesHoursPointDto> HoursExchangedPerDay { get; set; } = new();
}

public class TimeSeriesPointDto
{
    [JsonPropertyName("date")]
    public DateTime Date { get; set; }

    [JsonPropertyName("count")]
    public int Count { get; set; }
}

public class TimeSeriesHoursPointDto
{
    [JsonPropertyName("date")]
    public DateTime Date { get; set; }

    [JsonPropertyName("hours")]
    public decimal Hours { get; set; }
}

public class UserRetentionDto
{
    [JsonPropertyName("total_users")]
    public int TotalUsers { get; set; }

    [JsonPropertyName("active_last_7_days")]
    public int ActiveLast7Days { get; set; }

    [JsonPropertyName("active_last_30_days")]
    public int ActiveLast30Days { get; set; }

    [JsonPropertyName("active_last_90_days")]
    public int ActiveLast90Days { get; set; }

    [JsonPropertyName("active_last_7_days_percent")]
    public double ActiveLast7DaysPercent { get; set; }

    [JsonPropertyName("active_last_30_days_percent")]
    public double ActiveLast30DaysPercent { get; set; }

    [JsonPropertyName("active_last_90_days_percent")]
    public double ActiveLast90DaysPercent { get; set; }

    [JsonPropertyName("users_with_exchanges")]
    public int UsersWithExchanges { get; set; }

    [JsonPropertyName("users_with_exchanges_percent")]
    public double UsersWithExchangesPercent { get; set; }

    [JsonPropertyName("users_without_exchanges")]
    public int UsersWithoutExchanges { get; set; }

    [JsonPropertyName("users_without_exchanges_percent")]
    public double UsersWithoutExchangesPercent { get; set; }
}

public class TopUserDto
{
    [JsonPropertyName("user_id")]
    public int UserId { get; set; }

    [JsonPropertyName("first_name")]
    public string FirstName { get; set; } = string.Empty;

    [JsonPropertyName("last_name")]
    public string LastName { get; set; } = string.Empty;

    [JsonPropertyName("email")]
    public string Email { get; set; } = string.Empty;

    [JsonPropertyName("value")]
    public double Value { get; set; }

    [JsonPropertyName("metric")]
    public string Metric { get; set; } = string.Empty;
}

public class CategoryBreakdownDto
{
    [JsonPropertyName("category_id")]
    public int CategoryId { get; set; }

    [JsonPropertyName("category_name")]
    public string CategoryName { get; set; } = string.Empty;

    [JsonPropertyName("listing_count")]
    public int ListingCount { get; set; }

    [JsonPropertyName("offer_count")]
    public int OfferCount { get; set; }

    [JsonPropertyName("request_count")]
    public int RequestCount { get; set; }
}

public class ExchangeHealthDto
{
    [JsonPropertyName("total_exchanges")]
    public int TotalExchanges { get; set; }

    [JsonPropertyName("completed_count")]
    public int CompletedCount { get; set; }

    [JsonPropertyName("cancelled_count")]
    public int CancelledCount { get; set; }

    [JsonPropertyName("disputed_count")]
    public int DisputedCount { get; set; }

    [JsonPropertyName("expired_count")]
    public int ExpiredCount { get; set; }

    [JsonPropertyName("completion_rate")]
    public double CompletionRate { get; set; }

    [JsonPropertyName("dispute_rate")]
    public double DisputeRate { get; set; }

    [JsonPropertyName("average_days_to_complete")]
    public double AverageDaysToComplete { get; set; }
}

public class SroiReportDto
{
    [JsonPropertyName("total_hours_exchanged")]
    public decimal TotalHoursExchanged { get; set; }

    [JsonPropertyName("hour_value_in_currency")]
    public decimal HourValueInCurrency { get; set; }

    [JsonPropertyName("social_multiplier")]
    public decimal SocialMultiplier { get; set; }

    [JsonPropertyName("direct_economic_value")]
    public decimal DirectEconomicValue { get; set; }

    [JsonPropertyName("social_value")]
    public decimal SocialValue { get; set; }

    [JsonPropertyName("total_completed_exchanges")]
    public int TotalCompletedExchanges { get; set; }

    [JsonPropertyName("unique_participants")]
    public int UniqueParticipants { get; set; }

    [JsonPropertyName("monthly_breakdown")]
    public List<SroiMonthlyDto> MonthlyBreakdown { get; set; } = new();
}

public class SroiMonthlyDto
{
    [JsonPropertyName("year")]
    public int Year { get; set; }

    [JsonPropertyName("month")]
    public int Month { get; set; }

    [JsonPropertyName("hours_exchanged")]
    public decimal HoursExchanged { get; set; }

    [JsonPropertyName("economic_value")]
    public decimal EconomicValue { get; set; }

    [JsonPropertyName("social_value")]
    public decimal SocialValue { get; set; }

    [JsonPropertyName("exchange_count")]
    public int ExchangeCount { get; set; }
}

public class InactiveMembersDto
{
    [JsonPropertyName("inactive_days_threshold")]
    public int InactiveDaysThreshold { get; set; }

    [JsonPropertyName("total_inactive")]
    public int TotalInactive { get; set; }

    [JsonPropertyName("members")]
    public List<InactiveMemberDto> Members { get; set; } = new();
}

public class InactiveMemberDto
{
    [JsonPropertyName("user_id")]
    public int UserId { get; set; }

    [JsonPropertyName("first_name")]
    public string FirstName { get; set; } = string.Empty;

    [JsonPropertyName("last_name")]
    public string LastName { get; set; } = string.Empty;

    [JsonPropertyName("email")]
    public string Email { get; set; } = string.Empty;

    [JsonPropertyName("last_login_at")]
    public DateTime? LastLoginAt { get; set; }

    [JsonPropertyName("created_at")]
    public DateTime CreatedAt { get; set; }

    [JsonPropertyName("days_inactive")]
    public int DaysInactive { get; set; }
}

#endregion
