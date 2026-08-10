// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;

namespace Nexus.Api.Controllers;

/// <summary>
/// Gamification controller - XP, levels, badges, and leaderboards.
/// Phase 13: Gamification system.
/// </summary>
[ApiController]
[Route("api/gamification")]
[Authorize]
public class GamificationController : ControllerBase
{
    private static readonly IReadOnlyDictionary<string, int> XpValues = new Dictionary<string, int>
    {
        ["listing_created"] = 10,
        ["connection_made"] = 5,
        ["transaction_completed"] = 20,
        ["event_created"] = 15,
        ["review_left"] = 10
    };

    private static readonly IReadOnlyDictionary<int, int> LevelThresholds = Enumerable
        .Range(1, Nexus.Api.Entities.User.MaxLevel)
        .ToDictionary(level => level, Nexus.Api.Entities.User.GetXpRequiredForLevel);

    private readonly NexusDbContext _db;
    private readonly ILogger<GamificationController> _logger;

    public GamificationController(NexusDbContext db, ILogger<GamificationController> logger)
    {
        _db = db;
        _logger = logger;
    }

    /// <summary>
    /// GET /api/gamification/profile - Get current user's gamification profile.
    /// </summary>
    [HttpGet("profile")]
    public async Task<IActionResult> GetProfile()
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var user = await _db.Users
            .Where(u => u.Id == userId)
            .Select(u => new
            {
                u.Id,
                u.FirstName,
                u.LastName,
                u.TotalXp,
                u.Level,
                xp_to_next_level = Entities.User.GetXpRequiredForLevel(u.Level + 1) - u.TotalXp,
                xp_required_for_current_level = Entities.User.GetXpRequiredForLevel(u.Level),
                xp_required_for_next_level = Entities.User.GetXpRequiredForLevel(u.Level + 1),
                badges_earned = u.UserBadges.Count
            })
            .FirstOrDefaultAsync();

        if (user == null)
        {
            return NotFound(new { error = "User not found" });
        }

        // Get recent XP activity
        var recentXp = await _db.XpLogs
            .Where(x => x.UserId == userId)
            .OrderByDescending(x => x.CreatedAt)
            .Take(10)
            .Select(x => new
            {
                x.Amount,
                x.Source,
                x.Description,
                x.CreatedAt
            })
            .ToListAsync();

        var currentXp = user.TotalXp - user.xp_required_for_current_level;
        var nextLevelSpan = Math.Max(1, user.xp_required_for_next_level - user.xp_required_for_current_level);
        var progressPercent = Math.Clamp(currentXp / (double)nextLevelSpan * 100, 0, 100);
        var profileData = new
        {
            user = new
            {
                id = user.Id,
                name = $"{user.FirstName} {user.LastName}".Trim(),
                avatar_url = (string?)null
            },
            xp = user.TotalXp,
            level = user.Level,
            level_progress = new
            {
                current_xp = Math.Max(0, currentXp),
                xp_for_current_level = user.xp_required_for_current_level,
                xp_for_next_level = user.xp_required_for_next_level,
                progress_percentage = Math.Round(progressPercent, 1)
            },
            badges_count = user.badges_earned,
            showcased_badges = Array.Empty<object>(),
            is_own_profile = true,
            xp_values = XpValues,
            level_thresholds = LevelThresholds
        };

        return Ok(new
        {
            success = true,
            data = profileData,
            profileData.user,
            profileData.xp,
            profileData.level,
            profileData.level_progress,
            profileData.badges_count,
            profileData.showcased_badges,
            profileData.is_own_profile,
            profileData.xp_values,
            profileData.level_thresholds,
            profile = user,
            recent_xp = recentXp,
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    /// <summary>
    /// GET /api/gamification/profile/{userId} - Get another user's gamification profile.
    /// </summary>
    [HttpGet("profile/{userId}")]
    public async Task<IActionResult> GetUserProfile(int userId)
    {
        var currentUserId = GetCurrentUserId();
        if (currentUserId == null) return Unauthorized(new { error = "Invalid token" });

        var user = await _db.Users
            .Where(u => u.Id == userId)
            .Select(u => new
            {
                u.Id,
                u.FirstName,
                u.LastName,
                u.TotalXp,
                u.Level,
                badges_earned = u.UserBadges.Count
            })
            .FirstOrDefaultAsync();

        if (user == null)
        {
            return NotFound(new { error = "User not found" });
        }

        return Ok(user);
    }

    /// <summary>
    /// GET /api/gamification/badges - Get all available badges.
    /// </summary>
    [HttpGet("badges")]
    public async Task<IActionResult> GetBadges()
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = await _db.Users
            .Where(u => u.Id == userId.Value)
            .Select(u => (int?)u.TenantId)
            .FirstOrDefaultAsync();
        if (tenantId == null) return Unauthorized(new { error = "Invalid token" });

        var earned = await _db.UserBadges
            .Where(ub => ub.UserId == userId.Value && ub.TenantId == tenantId.Value)
            .ToDictionaryAsync(ub => ub.BadgeId, ub => ub.EarnedAt);
        var showcasedBadgeIds = await _db.BadgeShowcases
            .Where(s => s.UserId == userId.Value && s.TenantId == tenantId.Value)
            .Select(s => s.BadgeId)
            .ToListAsync();
        var showcased = showcasedBadgeIds.ToHashSet();

        var badges = await _db.Badges
            .Where(b => b.TenantId == tenantId.Value && b.IsActive)
            .OrderBy(b => b.SortOrder)
            .ThenBy(b => b.Name)
            .Select(b => new
            {
                b.Id,
                b.Slug,
                b.Name,
                b.Description,
                b.Icon,
                b.XpReward,
                b.CreatedAt
            })
            .ToListAsync();

        var rows = badges.Select(b =>
        {
            var isEarned = earned.TryGetValue(b.Id, out var earnedAt);
            var type = BadgeTypeFromSlug(b.Slug);

            return new
            {
                id = b.Id,
                key = b.Slug,
                badge_key = b.Slug,
                slug = b.Slug,
                name = b.Name,
                description = b.Description ?? string.Empty,
                icon = b.Icon ?? "medal",
                type,
                threshold = b.XpReward,
                xp_value = b.XpReward,
                xp_reward = b.XpReward,
                earned = isEarned,
                is_earned = isEarned,
                earned_at = isEarned ? earnedAt : (DateTime?)null,
                is_showcased = showcased.Contains(b.Id),
                created_at = b.CreatedAt
            };
        }).ToList();

        var availableTypes = rows
            .Select(b => b.type)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .OrderBy(t => t)
            .ToArray();
        var earnedCount = rows.Count(b => b.earned);

        return Ok(new
        {
            success = true,
            data = rows,
            meta = new
            {
                total = rows.Count,
                available_types = availableTypes,
                base_url = $"{Request.Scheme}://{Request.Host}"
            },
            summary = new
            {
                total = rows.Count,
                earned = earnedCount,
                progress_percent = rows.Count > 0 ? Math.Round((double)earnedCount / rows.Count * 100, 1) : 0
            }
        });
    }

    /// <summary>
    /// GET /api/gamification/badges/{key} - Get a badge definition by Laravel badge key.
    /// </summary>
    [HttpGet("badges/{key}")]
    public async Task<IActionResult> GetBadgeByKey(string key)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = await _db.Users
            .Where(u => u.Id == userId.Value)
            .Select(u => (int?)u.TenantId)
            .FirstOrDefaultAsync();
        if (tenantId == null) return Unauthorized(new { error = "Invalid token" });

        var badge = await _db.Badges
            .Where(b => b.TenantId == tenantId.Value && b.Slug == key && b.IsActive)
            .Select(b => new
            {
                b.Id,
                b.Slug,
                b.Name,
                b.Description,
                b.Icon,
                b.XpReward,
                b.CreatedAt
            })
            .FirstOrDefaultAsync();

        if (badge == null)
        {
            return NotFound(new
            {
                errors = new[]
                {
                    new { code = "RESOURCE_NOT_FOUND", message = "Badge not found" }
                },
                meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
            });
        }

        var earnedAt = await _db.UserBadges
            .Where(ub => ub.UserId == userId.Value && ub.TenantId == tenantId.Value && ub.BadgeId == badge.Id)
            .Select(ub => (DateTime?)ub.EarnedAt)
            .FirstOrDefaultAsync();
        var isEarned = earnedAt.HasValue;
        var isShowcased = await _db.BadgeShowcases
            .AnyAsync(s => s.UserId == userId.Value && s.TenantId == tenantId.Value && s.BadgeId == badge.Id);

        return Ok(new
        {
            success = true,
            data = new
            {
                id = badge.Id,
                key = badge.Slug,
                badge_key = badge.Slug,
                slug = badge.Slug,
                name = badge.Name,
                description = badge.Description ?? string.Empty,
                icon = badge.Icon ?? "medal",
                type = BadgeTypeFromSlug(badge.Slug),
                threshold = badge.XpReward,
                xp_value = badge.XpReward,
                xp_reward = badge.XpReward,
                earned = isEarned,
                is_earned = isEarned,
                earned_at = earnedAt,
                is_showcased = isShowcased,
                created_at = badge.CreatedAt
            },
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    /// <summary>
    /// GET /api/gamification/badges/my - Get current user's earned badges.
    /// </summary>
    [HttpGet("badges/my")]
    public async Task<IActionResult> GetMyBadges()
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var badges = await _db.UserBadges
            .Where(ub => ub.UserId == userId)
            .OrderByDescending(ub => ub.EarnedAt)
            .Select(ub => new
            {
                ub.Badge!.Id,
                ub.Badge.Slug,
                ub.Badge.Name,
                ub.Badge.Description,
                ub.Badge.Icon,
                ub.Badge.XpReward,
                ub.EarnedAt
            })
            .ToListAsync();

        return Ok(new
        {
            data = badges,
            total = badges.Count
        });
    }

    /// <summary>
    /// GET /api/gamification/leaderboard - Get XP leaderboard.
    /// </summary>
    [HttpGet("leaderboard")]
    public async Task<IActionResult> GetLeaderboard(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        [FromQuery] string period = "all")
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        IQueryable<User> query = _db.Users.Where(u => u.IsActive);

        // For period-based leaderboards, we calculate XP earned in that period
        DateTime? periodStart = period.ToLower() switch
        {
            "week" => DateTime.UtcNow.AddDays(-7),
            "month" => DateTime.UtcNow.AddDays(-30),
            "year" => DateTime.UtcNow.AddDays(-365),
            _ => null
        };

        int total;
        object leaderboard;

        if (periodStart.HasValue)
        {
            // Period-based: sum XP from xp_logs in period
            var periodLeaderboard = await _db.XpLogs
                .Where(x => x.CreatedAt >= periodStart.Value)
                .GroupBy(x => x.UserId)
                .Select(g => new
                {
                    UserId = g.Key,
                    PeriodXp = g.Sum(x => x.Amount)
                })
                .OrderByDescending(x => x.PeriodXp)
                .Skip((page - 1) * limit)
                .Take(limit)
                .ToListAsync();

            var userIds = periodLeaderboard.Select(x => x.UserId).ToList();
            var users = await _db.Users
                .Where(u => userIds.Contains(u.Id))
                .ToDictionaryAsync(u => u.Id);

            total = await _db.XpLogs
                .Where(x => x.CreatedAt >= periodStart.Value)
                .Select(x => x.UserId)
                .Distinct()
                .CountAsync();

            leaderboard = periodLeaderboard
                .Select((x, index) =>
                {
                    users.TryGetValue(x.UserId, out var u);
                    var name = $"{u?.FirstName ?? ""} {u?.LastName ?? ""}".Trim();
                    return new
                    {
                        rank = (page - 1) * limit + index + 1,
                        position = (page - 1) * limit + index + 1,
                        user = new
                        {
                            id = x.UserId,
                            first_name = u?.FirstName ?? "",
                            last_name = u?.LastName ?? "",
                            name,
                            avatar_url = u?.AvatarUrl
                        },
                        period_xp = x.PeriodXp,
                        total_xp = u?.TotalXp ?? 0,
                        xp = x.PeriodXp,
                        score = x.PeriodXp,
                        level = u?.Level ?? 1
                    };
                })
                .ToList();
        }
        else
        {
            // All-time: use TotalXp from users
            total = await query.CountAsync();

            var usersData = await query
                .AsNoTracking()
                .OrderByDescending(u => u.TotalXp)
                .ThenBy(u => u.Id) // Secondary sort for consistency
                .Skip((page - 1) * limit)
                .Take(limit)
                .Select(u => new
                {
                    user = new
                    {
                        id = u.Id,
                        first_name = u.FirstName,
                        last_name = u.LastName
                    },
                    total_xp = u.TotalXp,
                    level = u.Level,
                    // Use subquery to count badges - avoids N+1
                    badges_earned = _db.UserBadges.Count(ub => ub.UserId == u.Id)
                })
                .ToListAsync();

            // Set ranks manually since EF Core doesn't support row_number in projection
            leaderboard = usersData
                .Select((item, index) => new
                {
                    rank = (page - 1) * limit + index + 1,
                    position = (page - 1) * limit + index + 1,
                    user = new
                    {
                        item.user.id,
                        item.user.first_name,
                        item.user.last_name,
                        name = $"{item.user.first_name} {item.user.last_name}".Trim(),
                        avatar_url = (string?)null
                    },
                    item.total_xp,
                    xp = item.total_xp,
                    score = item.total_xp,
                    item.level,
                    item.badges_earned
                })
                .ToList();
        }

        // Get current user's rank
        int? currentUserRank = null;
        if (periodStart.HasValue)
        {
            var userPeriodXp = await _db.XpLogs
                .Where(x => x.UserId == userId && x.CreatedAt >= periodStart.Value)
                .SumAsync(x => x.Amount);

            currentUserRank = await _db.XpLogs
                .Where(x => x.CreatedAt >= periodStart.Value)
                .GroupBy(x => x.UserId)
                .CountAsync(g => g.Sum(x => x.Amount) > userPeriodXp) + 1;
        }
        else
        {
            var currentUser = await _db.Users.FirstOrDefaultAsync(x => x.Id == userId);
            if (currentUser != null)
            {
                currentUserRank = await _db.Users
                    .Where(u => u.IsActive)
                    .CountAsync(u => u.TotalXp > currentUser.TotalXp) + 1;
            }
        }

        var totalPages = (int)Math.Ceiling(total / (double)limit);

        return Ok(new
        {
            data = leaderboard,
            current_user_rank = currentUserRank,
            period,
            meta = new
            {
                period,
                type = "xp",
                your_position = currentUserRank,
                total_entries = total
            },
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
    /// GET /api/gamification/xp-history - Get XP history for current user.
    /// </summary>
    [HttpGet("xp-history")]
    public async Task<IActionResult> GetXpHistory(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var total = await _db.XpLogs.CountAsync(x => x.UserId == userId);
        var totalPages = (int)Math.Ceiling(total / (double)limit);

        var history = await _db.XpLogs
            .Where(x => x.UserId == userId)
            .OrderByDescending(x => x.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(x => new
            {
                x.Id,
                x.Amount,
                x.Source,
                x.ReferenceId,
                x.Description,
                x.CreatedAt
            })
            .ToListAsync();

        return Ok(new
        {
            data = history,
            pagination = new
            {
                page,
                limit,
                total,
                pages = totalPages
            }
        });
    }

    private static string BadgeTypeFromSlug(string slug)
    {
        if (string.IsNullOrWhiteSpace(slug)) return "general";
        var separator = slug.IndexOf('_', StringComparison.Ordinal);
        return separator > 0 ? slug[..separator] : "general";
    }

    private int? GetCurrentUserId() => User.GetUserId();
}
