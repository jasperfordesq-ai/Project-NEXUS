// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Data;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Expanded Gamification controller - challenges, streaks, seasons, and daily rewards.
/// Phase 22: Expanded Gamification.
/// </summary>
[ApiController]
[Route("api/gamification/v2")]
[Authorize]
public class GamificationV2Controller : ControllerBase
{
    private readonly ChallengeService _challengeService;
    private readonly StreakService _streakService;
    private readonly LeaderboardSeasonService _seasonService;
    private readonly DailyRewardService _dailyRewardService;
    private readonly GamificationService _gamificationService;
    private readonly TenantContext _tenantContext;
    private readonly NexusDbContext _db;
    private readonly ILogger<GamificationV2Controller> _logger;

    public GamificationV2Controller(
        ChallengeService challengeService,
        StreakService streakService,
        LeaderboardSeasonService seasonService,
        DailyRewardService dailyRewardService,
        GamificationService gamificationService,
        TenantContext tenantContext,
        NexusDbContext db,
        ILogger<GamificationV2Controller> logger)
    {
        _challengeService = challengeService;
        _streakService = streakService;
        _seasonService = seasonService;
        _dailyRewardService = dailyRewardService;
        _gamificationService = gamificationService;
        _tenantContext = tenantContext;
        _db = db;
        _logger = logger;
    }

    // ==================== Challenges ====================

    /// <summary>
    /// GET /api/gamification/v2/challenges - List active challenges.
    /// </summary>
    [HttpGet("challenges")]
    public async Task<IActionResult> GetChallenges(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var (data, total) = await _challengeService.GetActiveChallengesAsync(page, limit);
        var totalPages = (int)Math.Ceiling(total / (double)limit);

        return Ok(new
        {
            data,
            pagination = new
            {
                page,
                limit,
                total,
                pages = totalPages
            }
        });
    }

    /// <summary>
    /// GET /api/gamification/v2/challenges/{id} - Get challenge detail.
    /// </summary>
    [HttpGet("challenges/{id:int}")]
    public async Task<IActionResult> GetChallenge(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var result = await _challengeService.GetChallengeAsync(id, userId);
        if (result == null) return NotFound(new { error = "Challenge not found" });

        return Ok(result);
    }

    /// <summary>
    /// POST /api/gamification/v2/challenges/{id}/join - Join a challenge.
    /// </summary>
    [HttpPost("challenges/{id:int}/join")]
    public async Task<IActionResult> JoinChallenge(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var error = await _challengeService.JoinChallengeAsync(id, userId.Value);
        if (error != null)
        {
            return BadRequest(new { error });
        }

        return Ok(new { message = "Successfully joined the challenge" });
    }

    /// <summary>
    /// GET /api/gamification/v2/challenges/my - Get my challenges.
    /// </summary>
    [HttpGet("challenges/my")]
    public async Task<IActionResult> GetMyChallenges()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var challenges = await _challengeService.GetUserChallengesAsync(userId.Value);

        return Ok(new
        {
            data = challenges,
            total = challenges.Count
        });
    }

    // ==================== Streaks ====================

    /// <summary>
    /// GET /api/gamification/v2/streaks - Get my streaks.
    /// </summary>
    [HttpGet("streaks")]
    public async Task<IActionResult> GetMyStreaks()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var streaks = await _streakService.GetUserStreaksAsync(userId.Value);

        return Ok(new
        {
            data = streaks,
            total = streaks.Count
        });
    }

    /// <summary>
    /// GET /api/gamification/v2/streaks/leaderboard - Streak leaderboard.
    /// </summary>
    [HttpGet("streaks/leaderboard")]
    public async Task<IActionResult> GetStreakLeaderboard(
        [FromQuery] string type = "daily_login",
        [FromQuery] int limit = 20)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var leaderboard = await _streakService.GetStreakLeaderboardAsync(type, limit);

        return Ok(new
        {
            data = leaderboard,
            streak_type = type,
            total = leaderboard.Count
        });
    }

    // ==================== Seasons ====================

    /// <summary>
    /// GET /api/gamification/v2/seasons/current - Get current active season.
    /// </summary>
    [HttpGet("seasons/current")]
    public async Task<IActionResult> GetCurrentSeason()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var season = await _seasonService.GetCurrentSeasonAsync();
        if (season == null) return NotFound(new { error = "No active season" });

        return Ok(season);
    }

    /// <summary>
    /// GET /api/gamification/v2/seasons/{id}/leaderboard - Season leaderboard.
    /// </summary>
    [HttpGet("seasons/{id:int}/leaderboard")]
    public async Task<IActionResult> GetSeasonLeaderboard(
        int id,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var result = await _seasonService.GetSeasonLeaderboardAsync(id, page, limit);
        if (result == null) return NotFound(new { error = "Season not found" });

        var (data, total) = result.Value;
        var totalPages = (int)Math.Ceiling(total / (double)limit);

        return Ok(new
        {
            data,
            pagination = new
            {
                page,
                limit,
                total,
                pages = totalPages
            }
        });
    }

    // ==================== Daily Rewards ====================

    /// <summary>
    /// POST /api/gamification/v2/daily-reward - Claim daily reward.
    /// </summary>
    [HttpPost("daily-reward")]
    public async Task<IActionResult> ClaimDailyReward()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var result = await _dailyRewardService.ClaimDailyRewardAsync(userId.Value);

        if (!result.Success)
        {
            return BadRequest(new { error = result.Error });
        }

        return Ok(new
        {
            message = "Daily reward claimed!",
            day = result.Day,
            xp_awarded = result.XpAwarded,
            next_day_reward = result.NextDayReward,
            is_week_complete = result.IsWeekComplete,
            xp_result = result.XpResult != null ? new
            {
                new_xp = result.XpResult.NewXp,
                new_level = result.XpResult.NewLevel,
                leveled_up = result.XpResult.LeveledUp
            } : null
        });
    }

    /// <summary>
    /// GET /api/gamification/v2/daily-reward/status - Check daily reward status.
    /// </summary>
    [HttpGet("daily-reward/status")]
    public async Task<IActionResult> GetDailyRewardStatus()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var status = await _dailyRewardService.GetDailyRewardStatusAsync(userId.Value);

        return Ok(new
        {
            available = status.Available,
            current_day = status.CurrentDay,
            next_reward_xp = status.NextRewardXp,
            streak_active = status.StreakActive,
            total_daily_xp_earned = status.TotalDailyXpEarned,
            last_claimed_at = status.LastClaimedAt,
            day_rewards = status.DayRewards
        });
    }
    // ==================== Achievements ====================

    [HttpGet("/api/gamification/achievements")]
    public async Task<IActionResult> GetAchievements()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var achievements = await _gamificationService.GetAchievementsAsync(tenantId, userId.Value);
        return Ok(new { data = achievements, total = achievements.Count });
    }

    [HttpGet("/api/gamification/achievements/{userId}")]
    public async Task<IActionResult> GetUserAchievements(int userId)
    {
        var currentUserId = User.GetUserId();
        if (currentUserId == null) return Unauthorized(new { error = "Invalid token" });
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var achievements = await _gamificationService.GetAchievementsAsync(tenantId, userId);
        return Ok(new { data = achievements, total = achievements.Count, user_id = userId });
    }

    [HttpPost("/api/gamification/badges/recheck")]
    public async Task<IActionResult> RecheckBadges()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var (newlyEarned, error) = await _gamificationService.RecheckAllBadgesAsync(tenantId, userId.Value);
        if (error != null) return BadRequest(new { error });
        return Ok(new
        {
            newly_earned = newlyEarned.Select(ub => new { badge_id = ub.BadgeId, earned_at = ub.EarnedAt }),
            total_badges = newlyEarned.Count
        });
    }

    // ==================== Streak Detail + Milestones ====================

    [HttpGet("streaks/detail")]
    public async Task<IActionResult> GetStreakDetail()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var detail = await _streakService.GetStreakDetailsAsync(tenantId, userId.Value);
        if (detail == null) return NotFound(new { error = "No streaks found" });
        return Ok(detail);
    }

    [HttpGet("streaks/milestones")]
    public async Task<IActionResult> GetStreakMilestones()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var milestones = await _streakService.GetStreakMilestonesAsync(userId.Value);
        return Ok(new { data = milestones, total = milestones.Count });
    }

    // ==================== Seasons ====================

    [HttpGet("seasons")]
    public async Task<IActionResult> GetSeasons()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var seasons = await _seasonService.GetAllSeasonsAsync(_tenantContext.GetTenantIdOrThrow());
        return Ok(new { data = seasons, total = seasons.Count });
    }

    [HttpGet("seasons/{id:int}")]
    public async Task<IActionResult> GetSeason(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var season = await _seasonService.GetSeasonByIdAsync(_tenantContext.GetTenantIdOrThrow(), id);
        if (season == null) return NotFound(new { error = "Season not found" });
        return Ok(season);
    }

    [HttpGet("leaderboard/category")]
    public async Task<IActionResult> GetCategoryLeaderboard(
        [FromQuery] string category = "exchange",
        [FromQuery] int limit = 20)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var leaderboard = await _seasonService.GetCategoryLeaderboardAsync(tenantId, category, limit);
        return Ok(new { data = leaderboard, category, total = leaderboard.Count });
    }

    // ==================== Admin: Award / Revoke Badge ====================

    [HttpPost("/api/admin/gamification/users/{userId}/badges/{badgeId}/award")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminAwardBadge(int userId, int badgeId)
    {
        var adminId = User.GetUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var (userBadge, error) = await _gamificationService.AwardBadgeManuallyAsync(tenantId, userId, badgeId, adminId.Value);
        if (error != null) return BadRequest(new { error });
        return Ok(new { message = "Badge awarded", badge_id = badgeId, user_id = userId, earned_at = userBadge!.EarnedAt });
    }

    [HttpDelete("/api/admin/gamification/users/{userId}/badges/{badgeId}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminRevokeBadge(int userId, int badgeId)
    {
        var adminId = User.GetUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var (success, error) = await _gamificationService.RevokeBadgeAsync(tenantId, userId, badgeId, adminId.Value);
        if (!success) return NotFound(new { error = error ?? "Badge not found" });
        return NoContent();
    }

    // ==================== Admin: Seasons ====================

    [HttpPost("/api/admin/gamification/seasons")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminCreateSeason([FromBody] CreateSeasonRequest request)
    {
        var adminId = User.GetUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { error = "Name is required" });
        if (request.StartsAt >= request.EndsAt)
            return BadRequest(new { error = "starts_at must be before ends_at" });
        var season = await _seasonService.CreateSeasonAsync(request.Name, request.StartsAt, request.EndsAt, request.PrizeDescription);
        return Created($"api/gamification/v2/seasons/{season.Id}", new
        {
            season.Id,
            season.Name,
            starts_at = season.StartsAt,
            ends_at = season.EndsAt,
            status = season.Status.ToString().ToLower(),
            season.PrizeDescription
        });
    }

    [HttpPut("/api/admin/gamification/seasons/{id:int}/end")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminEndSeason(int id)
    {
        var adminId = User.GetUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var (success, error) = await _seasonService.EndSeasonAsync(tenantId, id);
        if (!success) return NotFound(new { error = error ?? "Season not found" });
        return Ok(new { message = "Season ended", season_id = id });
    }

    // ==================== Badge Collections ====================

    /// <summary>GET /api/gamification/v2/collections — badge collection groupings</summary>
    [HttpGet("collections")]
    public async Task<IActionResult> GetBadgeCollections()
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var collections = await _db.BadgeCollections
            .Where(c => c.TenantId == tenantId && c.IsActive)
            .OrderBy(c => c.Name)
            .Select(c => new { c.Id, c.Name, c.Description, c.IconUrl, c.BadgeIds })
            .ToListAsync();
        return Ok(new { data = collections, totalCount = collections.Count });
    }

    // ==================== XP Shop ====================

    /// <summary>GET /api/gamification/v2/shop — available XP shop items</summary>
    [HttpGet("shop")]
    public async Task<IActionResult> GetShopItems([FromQuery] string? type)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var query = _db.ShopItems.Where(i => i.TenantId == tenantId && i.IsActive);
        if (!string.IsNullOrWhiteSpace(type)) query = query.Where(i => i.Type == type);

        var items = await query
            .OrderBy(i => i.XpCost)
            .Select(i => new { i.Id, i.Name, i.Description, i.Type, i.ItemKey, i.ImageUrl, i.XpCost, i.StockLimit, i.PurchasedCount })
            .ToListAsync();
        return Ok(new { data = items, totalCount = items.Count });
    }

    /// <summary>POST /api/gamification/v2/shop/purchase — purchase an XP shop item</summary>
    [HttpPost("shop/purchase")]
    public async Task<IActionResult> PurchaseShopItem([FromBody] PurchaseShopItemRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        // Wrap the entire purchase flow in a SERIALIZABLE transaction with advisory lock
        // to prevent double-purchases and race conditions on stock/XP balance.
        await using var dbTransaction = await _db.Database.BeginTransactionAsync(System.Data.IsolationLevel.Serializable);
        try
        {
            // Advisory lock scoped to this user to serialize concurrent purchases
            await _db.Database.ExecuteSqlRawAsync("SELECT pg_advisory_xact_lock({0})", userId.Value);

            var item = await _db.ShopItems.FirstOrDefaultAsync(i => i.Id == request.ItemId && i.TenantId == tenantId && i.IsActive);
            if (item == null)
            {
                await dbTransaction.RollbackAsync();
                return NotFound(new { error = "Shop item not found" });
            }

            // Check not already purchased (for unique items) — inside the lock
            var alreadyPurchased = await _db.ShopPurchases.AnyAsync(p => p.UserId == userId.Value && p.ShopItemId == item.Id);
            if (alreadyPurchased)
            {
                await dbTransaction.RollbackAsync();
                return BadRequest(new { error = "You have already purchased this item" });
            }

            // Check stock — inside the lock
            if (item.StockLimit.HasValue && item.PurchasedCount >= item.StockLimit.Value)
            {
                await dbTransaction.RollbackAsync();
                return BadRequest(new { error = "Item out of stock" });
            }

            // Check user has enough XP — inside the lock
            var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId.Value);
            if (user == null)
            {
                await dbTransaction.RollbackAsync();
                return BadRequest(new { error = "User not found" });
            }
            if (user.TotalXp < item.XpCost)
            {
                await dbTransaction.RollbackAsync();
                return BadRequest(new { error = "Insufficient XP", required = item.XpCost, current = user.TotalXp });
            }

            // Deduct XP
            await _gamificationService.AwardXpAsync(userId.Value, -item.XpCost, "shop_purchase", description: $"XP shop purchase: {item.Name}");

            // Decrement stock and record purchase
            item.PurchasedCount++;
            var purchase = new ShopPurchase { UserId = userId.Value, ShopItemId = item.Id, TenantId = tenantId };
            _db.ShopPurchases.Add(purchase);
            await _db.SaveChangesAsync();
            await dbTransaction.CommitAsync();

            _logger.LogInformation("User {UserId} purchased shop item {ItemId} for {XpCost} XP", userId, item.Id, item.XpCost);
            return Ok(new { message = "Purchase successful", item_id = item.Id, item_key = item.ItemKey, xp_spent = item.XpCost });
        }
        catch (Exception)
        {
            await dbTransaction.RollbackAsync();
            throw;
        }
    }

    // ==================== Summary ====================

    /// <summary>GET /api/gamification/v2/summary — user gamification dashboard summary</summary>
    [HttpGet("summary")]
    public async Task<IActionResult> GetGamificationSummary()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var summaryUser = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId.Value);
        var badges = await _db.UserBadges
            .Where(ub => ub.UserId == userId.Value)
            .CountAsync();
        var streak = await _db.Set<Nexus.Api.Entities.Streak>()
            .FirstOrDefaultAsync(s => s.UserId == userId.Value && s.StreakType == "daily_login");
        var dailyStatus = await _dailyRewardService.GetDailyRewardStatusAsync(userId.Value);

        return Ok(new
        {
            profile = summaryUser == null ? null : new { summaryUser.TotalXp, summaryUser.Level },
            badgesEarned = badges,
            currentStreak = streak?.CurrentStreak ?? 0,
            dailyReward = dailyStatus,
        });
    }

    // ==================== Badge Showcase ====================

    /// <summary>POST /api/gamification/v2/showcase — toggle a badge in/out of showcase</summary>
    [HttpPost("showcase")]
    public async Task<IActionResult> ToggleBadgeShowcase([FromBody] ToggleBadgeShowcaseRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        // Verify user has earned this badge
        var earned = await _db.UserBadges.AnyAsync(ub => ub.UserId == userId.Value && ub.BadgeId == request.BadgeId);
        if (!earned) return BadRequest(new { error = "You have not earned this badge" });

        var existing = await _db.BadgeShowcases.FirstOrDefaultAsync(s => s.UserId == userId.Value && s.BadgeId == request.BadgeId);
        if (existing != null)
        {
            _db.BadgeShowcases.Remove(existing);
            await _db.SaveChangesAsync();
            return Ok(new { message = "Badge removed from showcase", badge_id = request.BadgeId, showcased = false });
        }

        // Limit showcase to 5 badges
        var showcaseCount = await _db.BadgeShowcases.CountAsync(s => s.UserId == userId.Value);
        if (showcaseCount >= 5) return BadRequest(new { error = "Showcase is full (max 5 badges)" });

        var displayOrder = showcaseCount;
        _db.BadgeShowcases.Add(new BadgeShowcase { UserId = userId.Value, BadgeId = request.BadgeId, TenantId = tenantId, DisplayOrder = displayOrder });
        await _db.SaveChangesAsync();

        return Ok(new { message = "Badge added to showcase", badge_id = request.BadgeId, showcased = true });
    }

    // ==================== Admin: Badge Definitions ====================

    /// <summary>GET /api/admin/gamification/badges/definitions — all badge definitions</summary>
    [HttpGet("/api/admin/gamification/badges/definitions")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminGetBadgeDefinitions()
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var badges = await _db.Badges
            .Where(b => b.TenantId == tenantId)
            .OrderBy(b => b.Name)
            .Select(b => new { b.Id, b.Name, b.Description, b.Icon, b.XpReward, b.IsActive, b.Slug })
            .ToListAsync();
        return Ok(new { data = badges, totalCount = badges.Count });
    }

    // NOTE: AdminCreateBadge removed — duplicate of AdminGamificationController.CreateBadge
}

#region Request DTOs

public class CreateSeasonRequest
{
    [System.Text.Json.Serialization.JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [System.Text.Json.Serialization.JsonPropertyName("starts_at")]
    public DateTime StartsAt { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("ends_at")]
    public DateTime EndsAt { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("prize_description")]
    public string? PrizeDescription { get; set; }
}

public class PurchaseShopItemRequest
{
    [System.Text.Json.Serialization.JsonPropertyName("item_id")]
    public int ItemId { get; set; }
}

public class ToggleBadgeShowcaseRequest
{
    [System.Text.Json.Serialization.JsonPropertyName("badge_id")]
    public int BadgeId { get; set; }
}

public class CreateBadgeDefinitionRequest
{
    [System.Text.Json.Serialization.JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [System.Text.Json.Serialization.JsonPropertyName("description")]
    public string? Description { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("image_url")]
    public string? ImageUrl { get; set; }

    [System.Text.Json.Serialization.JsonPropertyName("xp_reward")]
    public int XpReward { get; set; } = 0;

    [System.Text.Json.Serialization.JsonPropertyName("is_auto_award")]
    public bool IsAutoAward { get; set; } = false;

    [System.Text.Json.Serialization.JsonPropertyName("trigger_event")]
    public string? TriggerEvent { get; set; }
}

#endregion
