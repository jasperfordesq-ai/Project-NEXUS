// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for managing leaderboard seasons and seasonal XP tracking.
/// </summary>
public class LeaderboardSeasonService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<LeaderboardSeasonService> _logger;

    public LeaderboardSeasonService(
        NexusDbContext db,
        TenantContext tenantContext,
        ILogger<LeaderboardSeasonService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>
    /// Get the currently active season, or null if none.
    /// </summary>
    public async Task<object?> GetCurrentSeasonAsync()
    {
        var now = DateTime.UtcNow;

        var season = await _db.Set<LeaderboardSeason>()
            .Where(s => s.Status == SeasonStatus.Active && s.StartsAt <= now && s.EndsAt > now)
            .Select(s => new
            {
                s.Id,
                s.Name,
                starts_at = s.StartsAt,
                ends_at = s.EndsAt,
                status = s.Status.ToString().ToLower(),
                s.PrizeDescription,
                participant_count = s.Entries.Count,
                days_remaining = (int)(s.EndsAt - now).TotalDays,
                s.CreatedAt
            })
            .FirstOrDefaultAsync();

        return season;
    }

    /// <summary>
    /// Get the leaderboard for a season with pagination.
    /// </summary>
    public async Task<(List<object> Data, int Total)?> GetSeasonLeaderboardAsync(int seasonId, int page, int limit)
    {
        var season = await _db.Set<LeaderboardSeason>().FirstOrDefaultAsync(x => x.Id == seasonId);
        if (season == null) return null;

        var query = _db.Set<LeaderboardEntry>()
            .Where(e => e.SeasonId == seasonId);

        var total = await query.CountAsync();

        var entries = await query
            .OrderByDescending(e => e.Score)
            .ThenBy(e => e.UserId)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(e => new
            {
                user = new
                {
                    id = e.UserId,
                    first_name = e.User != null ? e.User.FirstName : "",
                    last_name = e.User != null ? e.User.LastName : ""
                },
                e.Score,
                e.UpdatedAt
            })
            .ToListAsync();

        var ranked = entries.Select((entry, index) => new
        {
            rank = (page - 1) * limit + index + 1,
            entry.user,
            score = entry.Score,
            updated_at = entry.UpdatedAt
        }).ToList();

        return (ranked.Cast<object>().ToList(), total);
    }

    /// <summary>
    /// Record XP earned during the current active season.
    /// Creates a leaderboard entry if one doesn't exist.
    /// </summary>
    public async Task RecordSeasonXpAsync(int userId, int amount)
    {
        var now = DateTime.UtcNow;
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var season = await _db.Set<LeaderboardSeason>()
            .FirstOrDefaultAsync(s => s.Status == SeasonStatus.Active && s.StartsAt <= now && s.EndsAt > now);

        if (season == null) return; // No active season

        // Use an atomic upsert to avoid read-modify-write race conditions.
        // Try the atomic UPDATE first; if no rows affected, INSERT the entry.
        var updated = await _db.Database.ExecuteSqlRawAsync(
            "UPDATE \"leaderboard_entries\" SET \"Score\" = \"Score\" + {0}, \"UpdatedAt\" = {1} WHERE \"SeasonId\" = {2} AND \"UserId\" = {3}",
            amount, DateTime.UtcNow, season.Id, userId);

        if (updated == 0)
        {
            // No existing entry — insert a new one (EF handles conflicts via exception if duplicate)
            try
            {
                var entry = new LeaderboardEntry
                {
                    TenantId = tenantId,
                    SeasonId = season.Id,
                    UserId = userId,
                    Score = amount
                };
                _db.Set<LeaderboardEntry>().Add(entry);
                await _db.SaveChangesAsync();
            }
            catch (Microsoft.EntityFrameworkCore.DbUpdateException)
            {
                // Concurrent insert won the race — retry the atomic update
                await _db.Database.ExecuteSqlRawAsync(
                    "UPDATE \"leaderboard_entries\" SET \"Score\" = \"Score\" + {0}, \"UpdatedAt\" = {1} WHERE \"SeasonId\" = {2} AND \"UserId\" = {3}",
                    amount, DateTime.UtcNow, season.Id, userId);
            }
        }

        _logger.LogDebug(
            "User {UserId} earned {Amount} season XP in season {SeasonId}",
            userId, amount, season.Id);
    }

    /// <summary>
    /// Admin: create a new leaderboard season.
    /// </summary>
    public async Task<LeaderboardSeason> CreateSeasonAsync(
        string name,
        DateTime startsAt,
        DateTime endsAt,
        string? prizeDescription)
    {
        var now = DateTime.UtcNow;
        var status = startsAt <= now && endsAt > now
            ? SeasonStatus.Active
            : startsAt > now
                ? SeasonStatus.Upcoming
                : SeasonStatus.Completed;

        var season = new LeaderboardSeason
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            Name = name,
            StartsAt = startsAt,
            EndsAt = endsAt,
            Status = status,
            PrizeDescription = prizeDescription
        };

        _db.Set<LeaderboardSeason>().Add(season);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Leaderboard season '{Name}' created (ID: {Id}, Status: {Status})",
            season.Name, season.Id, season.Status);

        return season;
    }
    /// <summary>
    /// Get all seasons for a tenant ordered by start date descending.
    /// </summary>
    public async Task<List<object>> GetAllSeasonsAsync(int tenantId)
    {
        var seasons = await _db.Set<LeaderboardSeason>()
            .Where(s => s.TenantId == tenantId)
            .OrderByDescending(s => s.StartsAt)
            .Select(s => new
            {
                s.Id,
                s.Name,
                starts_at = s.StartsAt,
                ends_at = s.EndsAt,
                status = s.Status.ToString().ToLower(),
                s.PrizeDescription,
                participant_count = s.Entries.Count,
                s.CreatedAt
            })
            .ToListAsync();

        return seasons.Cast<object>().ToList();
    }

    /// <summary>
    /// Get a season by ID (tenant-scoped).
    /// </summary>
    public async Task<object?> GetSeasonByIdAsync(int tenantId, int seasonId)
    {
        var now = DateTime.UtcNow;
        return await _db.Set<LeaderboardSeason>()
            .Where(s => s.TenantId == tenantId && s.Id == seasonId)
            .Select(s => new
            {
                s.Id,
                s.Name,
                starts_at = s.StartsAt,
                ends_at = s.EndsAt,
                status = s.Status.ToString().ToLower(),
                s.PrizeDescription,
                participant_count = s.Entries.Count,
                days_remaining = s.Status == SeasonStatus.Active ? (int)(s.EndsAt - now).TotalDays : 0,
                s.CreatedAt
            })
            .FirstOrDefaultAsync();
    }

    /// <summary>
    /// Get top users by XP earned for a specific XpLog source category.
    /// </summary>
    public async Task<List<object>> GetCategoryLeaderboardAsync(int tenantId, string category, int limit)
    {
        var leaderboard = await _db.XpLogs
            .Where(x => x.Source == category)
            .GroupBy(x => x.UserId)
            .Select(g => new
            {
                UserId = g.Key,
                CategoryXp = g.Sum(x => x.Amount)
            })
            .OrderByDescending(x => x.CategoryXp)
            .Take(limit)
            .ToListAsync();

        var userIds = leaderboard.Select(x => x.UserId).ToList();
        var users = await _db.Users
            .Where(u => userIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id);

        var ranked = leaderboard.Select((entry, index) => (object)new
        {
            rank = index + 1,
            user = new
            {
                id = entry.UserId,
                first_name = users.TryGetValue(entry.UserId, out var u) ? u.FirstName : string.Empty,
                last_name = users.TryGetValue(entry.UserId, out var u2) ? u2.LastName : string.Empty
            },
            category_xp = entry.CategoryXp
        }).ToList();

        return ranked;
    }

    /// <summary>
    /// Admin: end (close) a season, setting status to Completed.
    /// </summary>
    public async Task<(bool Success, string? Error)> EndSeasonAsync(int tenantId, int seasonId)
    {
        var season = await _db.Set<LeaderboardSeason>()
            .FirstOrDefaultAsync(s => s.TenantId == tenantId && s.Id == seasonId);

        if (season == null) return (false, "Season not found");
        if (season.Status == SeasonStatus.Completed) return (false, "Season already ended");

        season.Status = SeasonStatus.Completed;
        season.EndsAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Season {SeasonId} ended by admin", seasonId);
        return (true, null);
    }

}
