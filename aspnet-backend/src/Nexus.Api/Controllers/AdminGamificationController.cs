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

namespace Nexus.Api.Controllers;

/// <summary>
/// Admin gamification management - badges, XP, seasons.
/// </summary>
[ApiController]
[Route("api/admin/gamification")]
[Authorize(Policy = "AdminOnly")]
public class AdminGamificationController : ControllerBase
{
    private readonly NexusDbContext _db;

    public AdminGamificationController(NexusDbContext db)
    {
        _db = db;
    }

    [HttpGet("stats")]
    public async Task<IActionResult> GetStats()
    {
        var totalBadges = await _db.Badges.CountAsync();
        var earnedBadges = await _db.UserBadges.CountAsync();
        var totalXpAwarded = await _db.XpLogs.SumAsync(x => x.Amount);
        var activeStreaks = await _db.Set<Streak>().CountAsync(s => s.CurrentStreak > 0);

        return Ok(new
        {
            data = new
            {
                total_badges = totalBadges,
                badges_earned = earnedBadges,
                total_xp_awarded = totalXpAwarded,
                active_streaks = activeStreaks
            }
        });
    }

    [HttpGet("badges")]
    public async Task<IActionResult> ListBadges()
    {
        var badges = await _db.Badges.OrderBy(b => b.Name).ToListAsync();
        var earnedCounts = await _db.UserBadges
            .GroupBy(ub => ub.BadgeId)
            .Select(g => new { BadgeId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.BadgeId, x => x.Count);

        return Ok(new
        {
            data = badges.Select(b => new
            {
                b.Id, b.Slug, b.Name, b.Description, b.Icon, b.XpReward, b.IsActive,
                times_earned = earnedCounts.GetValueOrDefault(b.Id, 0)
            })
        });
    }

    [HttpPost("badges")]
    public async Task<IActionResult> CreateBadge([FromBody] AdminCreateBadgeRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
            return BadRequest(new { error = "Name is required" });
        if (request.Name.Length > 200)
            return BadRequest(new { error = "Name must not exceed 200 characters" });
        if (request.XpReward < 0)
            return BadRequest(new { error = "XP reward cannot be negative" });

        var badge = new Badge
        {
            Slug = request.Slug ?? request.Name.ToLower().Replace(' ', '-'),
            Name = request.Name,
            Description = request.Description ?? string.Empty,
            Icon = request.Icon,
            XpReward = request.XpReward
        };

        _db.Badges.Add(badge);
        await _db.SaveChangesAsync();
        return Created("/api/admin/gamification/badges", new { data = new { badge.Id, badge.Name } });
    }

    [HttpPut("badges/{id:int}")]
    public async Task<IActionResult> UpdateBadge(int id, [FromBody] AdminUpdateBadgeRequest request)
    {
        var badge = await _db.Badges.FirstOrDefaultAsync(x => x.Id == id);
        if (badge == null) return NotFound(new { error = "Badge not found" });

        if (request.Name != null) badge.Name = request.Name;
        if (request.Description != null) badge.Description = request.Description;
        if (request.Icon != null) badge.Icon = request.Icon;
        if (request.XpReward.HasValue) badge.XpReward = request.XpReward.Value;
        if (request.IsActive.HasValue) badge.IsActive = request.IsActive.Value;

        await _db.SaveChangesAsync();
        return Ok(new { data = new { badge.Id, badge.Name } });
    }

    [HttpDelete("badges/{id:int}")]
    public async Task<IActionResult> DeleteBadge(int id)
    {
        var badge = await _db.Badges.FirstOrDefaultAsync(x => x.Id == id);
        if (badge == null) return NotFound(new { error = "Badge not found" });

        var earned = await _db.UserBadges.Where(ub => ub.BadgeId == id).ToListAsync();
        _db.UserBadges.RemoveRange(earned);
        _db.Badges.Remove(badge);
        await _db.SaveChangesAsync();
        return Ok(new { message = "Badge deleted" });
    }

    [HttpPost("badges/{id:int}/award")]
    public async Task<IActionResult> AwardBadge(int id, [FromBody] AwardBadgeRequest request)
    {
        var badge = await _db.Badges.FirstOrDefaultAsync(x => x.Id == id);
        if (badge == null) return NotFound(new { error = "Badge not found" });

        var user = await _db.Users.FirstOrDefaultAsync(x => x.Id == request.UserId);
        if (user == null) return NotFound(new { error = "User not found" });

        var existing = await _db.UserBadges.AnyAsync(ub => ub.BadgeId == id && ub.UserId == request.UserId);
        if (existing) return BadRequest(new { error = "User already has this badge" });

        _db.UserBadges.Add(new UserBadge { BadgeId = id, UserId = request.UserId });
        await _db.SaveChangesAsync();
        return Ok(new { message = $"Badge '{badge.Name}' awarded to user {request.UserId}" });
    }
}

public class AdminCreateBadgeRequest
{
    [JsonPropertyName("slug")] public string? Slug { get; set; }
    [JsonPropertyName("name")] public string Name { get; set; } = string.Empty;
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("icon")] public string? Icon { get; set; }
    [JsonPropertyName("xp_reward")] public int XpReward { get; set; } = 0;
}

public class AdminUpdateBadgeRequest
{
    [JsonPropertyName("name")] public string? Name { get; set; }
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("icon")] public string? Icon { get; set; }
    [JsonPropertyName("xp_reward")] public int? XpReward { get; set; }
    [JsonPropertyName("is_active")] public bool? IsActive { get; set; }
}

public class AwardBadgeRequest
{
    [JsonPropertyName("user_id")] public int UserId { get; set; }
}
