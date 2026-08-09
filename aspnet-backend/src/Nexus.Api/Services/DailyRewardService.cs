// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for managing daily login rewards with a 7-day cycle and scaling XP.
/// </summary>
public class DailyRewardService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly GamificationService _gamificationService;
    private readonly ILogger<DailyRewardService> _logger;

    /// <summary>
    /// XP rewards for each day in the 7-day cycle.
    /// Day 1: 5 XP, scaling up to Day 7: 50 XP.
    /// </summary>
    private static readonly int[] DayRewards = { 5, 10, 15, 20, 25, 35, 50 };

    public DailyRewardService(
        NexusDbContext db,
        TenantContext tenantContext,
        GamificationService gamificationService,
        ILogger<DailyRewardService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _gamificationService = gamificationService;
        _logger = logger;
    }

    /// <summary>
    /// Claim today's daily reward. Returns the reward info or an error.
    /// </summary>
    public async Task<DailyRewardResult> ClaimDailyRewardAsync(int userId)
    {
        var today = DateTime.UtcNow.Date;

        // Check if already claimed today
        var alreadyClaimed = await _db.Set<DailyReward>()
            .AnyAsync(dr => dr.UserId == userId && dr.ClaimedAt.Date == today);

        if (alreadyClaimed)
        {
            return new DailyRewardResult
            {
                Success = false,
                Error = "Daily reward already claimed today"
            };
        }

        // Get last claim to determine streak day
        var lastClaim = await _db.Set<DailyReward>()
            .Where(dr => dr.UserId == userId)
            .OrderByDescending(dr => dr.ClaimedAt)
            .FirstOrDefaultAsync();

        int day;
        if (lastClaim == null)
        {
            // First ever claim
            day = 1;
        }
        else if (lastClaim.ClaimedAt.Date == today.AddDays(-1))
        {
            // Consecutive day - advance in cycle
            day = lastClaim.Day >= 7 ? 1 : lastClaim.Day + 1;
        }
        else
        {
            // Streak broken - restart cycle
            day = 1;
        }

        var xpAmount = DayRewards[day - 1];

        var reward = new DailyReward
        {
            TenantId = _tenantContext.GetTenantIdOrThrow(),
            UserId = userId,
            Day = day,
            XpAwarded = xpAmount,
            ClaimedAt = DateTime.UtcNow
        };

        _db.Set<DailyReward>().Add(reward);
        await _db.SaveChangesAsync();

        // Award XP via gamification service
        var xpResult = await _gamificationService.AwardXpAsync(
            userId,
            xpAmount,
            "daily_reward",
            reward.Id,
            $"Daily reward - Day {day}");

        _logger.LogInformation(
            "User {UserId} claimed daily reward: Day {Day}, {XP} XP",
            userId, day, xpAmount);

        return new DailyRewardResult
        {
            Success = true,
            Day = day,
            XpAwarded = xpAmount,
            NextDayReward = day < 7 ? DayRewards[day] : DayRewards[0],
            IsWeekComplete = day == 7,
            XpResult = xpResult
        };
    }

    /// <summary>
    /// Check if today's daily reward is available and what day the user is on.
    /// </summary>
    public async Task<DailyRewardStatus> GetDailyRewardStatusAsync(int userId)
    {
        var today = DateTime.UtcNow.Date;

        var alreadyClaimed = await _db.Set<DailyReward>()
            .AnyAsync(dr => dr.UserId == userId && dr.ClaimedAt.Date == today);

        var lastClaim = await _db.Set<DailyReward>()
            .Where(dr => dr.UserId == userId)
            .OrderByDescending(dr => dr.ClaimedAt)
            .FirstOrDefaultAsync();

        int nextDay;
        bool streakActive;

        if (lastClaim == null)
        {
            nextDay = 1;
            streakActive = false;
        }
        else if (alreadyClaimed)
        {
            // Already claimed today - show next day
            nextDay = lastClaim.Day >= 7 ? 1 : lastClaim.Day + 1;
            streakActive = true;
        }
        else if (lastClaim.ClaimedAt.Date == today.AddDays(-1))
        {
            nextDay = lastClaim.Day >= 7 ? 1 : lastClaim.Day + 1;
            streakActive = true;
        }
        else
        {
            nextDay = 1;
            streakActive = false;
        }

        // Total XP earned from daily rewards
        var totalDailyXp = await _db.Set<DailyReward>()
            .Where(dr => dr.UserId == userId)
            .SumAsync(dr => dr.XpAwarded);

        return new DailyRewardStatus
        {
            Available = !alreadyClaimed,
            CurrentDay = alreadyClaimed ? lastClaim!.Day : nextDay,
            NextRewardXp = !alreadyClaimed ? DayRewards[nextDay - 1] : (nextDay <= 7 ? DayRewards[nextDay - 1] : DayRewards[0]),
            StreakActive = streakActive,
            TotalDailyXpEarned = totalDailyXp,
            LastClaimedAt = lastClaim?.ClaimedAt,
            DayRewards = Enumerable.Range(1, 7).Select(d => new
            {
                day = d,
                xp = DayRewards[d - 1]
            }).ToArray()
        };
    }
}

public class DailyRewardResult
{
    public bool Success { get; set; }
    public string? Error { get; set; }
    public int Day { get; set; }
    public int XpAwarded { get; set; }
    public int NextDayReward { get; set; }
    public bool IsWeekComplete { get; set; }
    public XpAwardResult? XpResult { get; set; }
}

public class DailyRewardStatus
{
    public bool Available { get; set; }
    public int CurrentDay { get; set; }
    public int NextRewardXp { get; set; }
    public bool StreakActive { get; set; }
    public int TotalDailyXpEarned { get; set; }
    public DateTime? LastClaimedAt { get; set; }
    public object[]? DayRewards { get; set; }
}
