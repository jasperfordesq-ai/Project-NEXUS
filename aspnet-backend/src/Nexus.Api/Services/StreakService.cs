// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for tracking daily activity streaks.
/// </summary>
public class StreakService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<StreakService> _logger;

    public StreakService(NexusDbContext db, TenantContext tenantContext, ILogger<StreakService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>
    /// Record an activity for today. Creates or updates the streak.
    /// Returns the updated streak.
    /// </summary>
    public async Task<Streak> RecordActivityAsync(int userId, string streakType)
    {
        var today = DateTime.UtcNow.Date;

        // Wrap in SERIALIZABLE transaction with advisory lock to prevent double-counting
        // when concurrent requests record activity for the same user/streak type.
        await using var transaction = await _db.Database.BeginTransactionAsync(
            System.Data.IsolationLevel.Serializable);
        try
        {
            await _db.Database.ExecuteSqlRawAsync(
                "SELECT pg_advisory_xact_lock({0})", userId);

            var streak = await _db.Set<Streak>()
                .FirstOrDefaultAsync(s => s.UserId == userId && s.StreakType == streakType);

            if (streak == null)
            {
                // First activity of this type
                streak = new Streak
                {
                    TenantId = _tenantContext.GetTenantIdOrThrow(),
                    UserId = userId,
                    StreakType = streakType,
                    CurrentStreak = 1,
                    LongestStreak = 1,
                    LastActivityDate = today
                };
                _db.Set<Streak>().Add(streak);
            }
            else
            {
                var lastDate = streak.LastActivityDate.Date;

                if (lastDate == today)
                {
                    // Already recorded today, no change
                    await transaction.CommitAsync();
                    return streak;
                }

                if (lastDate == today.AddDays(-1))
                {
                    // Consecutive day - extend streak
                    streak.CurrentStreak++;
                }
                else
                {
                    // Streak broken - restart
                    streak.CurrentStreak = 1;
                }

                if (streak.CurrentStreak > streak.LongestStreak)
                {
                    streak.LongestStreak = streak.CurrentStreak;
                }

                streak.LastActivityDate = today;
                streak.UpdatedAt = DateTime.UtcNow;
            }

            await _db.SaveChangesAsync();
            await transaction.CommitAsync();

            _logger.LogInformation(
                "User {UserId} streak '{StreakType}': current={Current}, longest={Longest}",
                userId, streakType, streak.CurrentStreak, streak.LongestStreak);

            return streak;
        }
        catch
        {
            await transaction.RollbackAsync();
            throw;
        }
    }

    /// <summary>
    /// Get all streaks for a user.
    /// </summary>
    public async Task<List<object>> GetUserStreaksAsync(int userId)
    {
        var today = DateTime.UtcNow.Date;

        var streaks = await _db.Set<Streak>()
            .Where(s => s.UserId == userId)
            .OrderByDescending(s => s.CurrentStreak)
            .Select(s => new
            {
                s.Id,
                streak_type = s.StreakType,
                current_streak = s.CurrentStreak,
                longest_streak = s.LongestStreak,
                last_activity_date = s.LastActivityDate,
                is_active_today = s.LastActivityDate.Date == today,
                s.CreatedAt,
                s.UpdatedAt
            })
            .ToListAsync();

        return streaks.Cast<object>().ToList();
    }

    /// <summary>
    /// Get top streakers for a given streak type.
    /// </summary>
    public async Task<List<object>> GetStreakLeaderboardAsync(string streakType, int limit)
    {
        var leaderboard = await _db.Set<Streak>()
            .Where(s => s.StreakType == streakType && s.CurrentStreak > 0)
            .OrderByDescending(s => s.CurrentStreak)
            .ThenByDescending(s => s.LongestStreak)
            .Take(limit)
            .Select(s => new
            {
                rank = 0, // Will be set below
                user = new
                {
                    id = s.UserId,
                    first_name = s.User != null ? s.User.FirstName : "",
                    last_name = s.User != null ? s.User.LastName : ""
                },
                current_streak = s.CurrentStreak,
                longest_streak = s.LongestStreak,
                last_activity_date = s.LastActivityDate
            })
            .ToListAsync();

        // Assign ranks
        var ranked = leaderboard.Select((entry, index) => new
        {
            rank = index + 1,
            entry.user,
            entry.current_streak,
            entry.longest_streak,
            entry.last_activity_date
        }).ToList();

        return ranked.Cast<object>().ToList();
    }
    /// <summary>
    /// Get detailed streak info for a user including next milestone and milestone reward.
    /// </summary>
    public async Task<object?> GetStreakDetailsAsync(int tenantId, int userId)
    {
        var today = DateTime.UtcNow.Date;

        var streak = await _db.Set<Streak>()
            .AsNoTracking()
            .Where(s => s.UserId == userId && s.TenantId == tenantId)
            .OrderByDescending(s => s.CurrentStreak)
            .FirstOrDefaultAsync();

        if (streak == null) return null;

        // Determine next milestone
        int[] milestones = { 7, 30, 100 };
        int nextMilestone = milestones.FirstOrDefault(m => m > streak.CurrentStreak);
        if (nextMilestone == 0) nextMilestone = streak.CurrentStreak + 100; // beyond 100

        string milestoneReward = nextMilestone switch
        {
            7 => "streak_7d badge + 50 XP",
            30 => "streak_30d badge + 200 XP",
            100 => "streak_100d badge + 500 XP",
            _ => "Bonus XP"
        };

        return new
        {
            current_streak = streak.CurrentStreak,
            longest_streak = streak.LongestStreak,
            streak_type = streak.StreakType,
            last_activity_at = streak.LastActivityDate,
            is_active_today = streak.LastActivityDate.Date == today,
            next_milestone = nextMilestone,
            milestone_reward = milestoneReward
        };
    }

    /// <summary>
    /// Get top users by current streak across the tenant.
    /// </summary>
    public async Task<List<object>> GetStreakLeaderboardByTenantAsync(int tenantId, int limit)
    {
        var leaderboard = await _db.Set<Streak>()
            .Where(s => s.TenantId == tenantId && s.CurrentStreak > 0)
            .OrderByDescending(s => s.CurrentStreak)
            .ThenByDescending(s => s.LongestStreak)
            .Take(limit)
            .Select(s => new
            {
                user = new
                {
                    id = s.UserId,
                    first_name = s.User != null ? s.User.FirstName : "",
                    last_name = s.User != null ? s.User.LastName : ""
                },
                streak_type = s.StreakType,
                current_streak = s.CurrentStreak,
                longest_streak = s.LongestStreak,
                last_activity_date = s.LastActivityDate
            })
            .ToListAsync();

        var ranked = leaderboard.Select((entry, index) => (object)new
        {
            rank = index + 1,
            entry.user,
            entry.streak_type,
            entry.current_streak,
            entry.longest_streak,
            entry.last_activity_date
        }).ToList();

        return ranked;
    }

    /// <summary>
    /// Get streak milestones for a user with achieved status.
    /// </summary>
    public async Task<List<object>> GetStreakMilestonesAsync(int userId)
    {
        var streak = await _db.Set<Streak>()
            .AsNoTracking()
            .Where(s => s.UserId == userId)
            .OrderByDescending(s => s.LongestStreak)
            .FirstOrDefaultAsync();

        int longestEver = streak?.LongestStreak ?? 0;

        var milestones = new[]
        {
            new { days = 7, reward = "streak_7d badge + 50 XP" },
            new { days = 30, reward = "streak_30d badge + 200 XP" },
            new { days = 100, reward = "streak_100d badge + 500 XP" }
        };

        return milestones.Select(m => (object)new
        {
            days = m.days,
            achieved = longestEver >= m.days,
            reward = m.reward
        }).ToList();
    }

}
