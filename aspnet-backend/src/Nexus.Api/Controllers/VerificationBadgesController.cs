// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Verification badges controller - admin-awarded trust indicators.
/// Distinct from gamification badges (earned through activity).
/// </summary>
[ApiController]
[Authorize]
public class VerificationBadgesController : ControllerBase
{
    private readonly VerificationBadgeService _badgeService;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<VerificationBadgesController> _logger;

    public VerificationBadgesController(
        VerificationBadgeService badgeService,
        TenantContext tenantContext,
        ILogger<VerificationBadgesController> logger)
    {
        _badgeService = badgeService;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>
    /// GET /api/verification-badges/types - List all verification badge types.
    /// </summary>
    [HttpGet("api/verification-badges/types")]
    public async Task<IActionResult> GetBadgeTypes()
    {
        var types = await _badgeService.GetBadgeTypesAsync();

        return Ok(new
        {
            data = types.Select(t => new
            {
                id = t.Id,
                key = t.Key,
                name = t.Name,
                description = t.Description,
                icon_url = t.IconUrl,
                sort_order = t.SortOrder
            })
        });
    }

    /// <summary>
    /// GET /api/verification-badges/me - Get current user's verification badges.
    /// </summary>
    [HttpGet("api/verification-badges/me")]
    public async Task<IActionResult> GetMyBadges()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var badges = await _badgeService.GetUserBadgesAsync(userId.Value);

        return Ok(new
        {
            data = badges.Select(b => new
            {
                id = b.Id,
                badge_type = b.BadgeType != null ? new
                {
                    id = b.BadgeType.Id,
                    key = b.BadgeType.Key,
                    name = b.BadgeType.Name,
                    description = b.BadgeType.Description,
                    icon_url = b.BadgeType.IconUrl
                } : null,
                awarded_at = b.AwardedAt,
                expires_at = b.ExpiresAt,
                notes = b.Notes,
                awarded_by = b.AwardedBy != null ? new
                {
                    id = b.AwardedBy.Id,
                    first_name = b.AwardedBy.FirstName,
                    last_name = b.AwardedBy.LastName
                } : null
            })
        });
    }

    /// <summary>
    /// GET /api/verification-badges/users/{userId} - Get a user's verification badges.
    /// </summary>
    [HttpGet("api/verification-badges/users/{userId:int}")]
    public async Task<IActionResult> GetUserBadges(int userId)
    {
        var badges = await _badgeService.GetUserBadgesAsync(userId);

        return Ok(new
        {
            data = badges.Select(b => new
            {
                id = b.Id,
                badge_type = b.BadgeType != null ? new
                {
                    id = b.BadgeType.Id,
                    key = b.BadgeType.Key,
                    name = b.BadgeType.Name,
                    description = b.BadgeType.Description,
                    icon_url = b.BadgeType.IconUrl
                } : null,
                awarded_at = b.AwardedAt,
                expires_at = b.ExpiresAt,
                notes = b.Notes
            })
        });
    }

    /// <summary>
    /// POST /api/admin/verification-badges/award - Award a verification badge to a user.
    /// </summary>
    [HttpPost("api/admin/verification-badges/award")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AwardBadge([FromBody] AwardVerificationBadgeRequest request)
    {
        var adminId = User.GetUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var (badge, error) = await _badgeService.AwardBadgeAsync(
            tenantId, request.UserId, request.BadgeTypeId, adminId.Value, request.Notes, request.ExpiresAt);

        if (error != null)
            return BadRequest(new { error });

        _logger.LogInformation("Admin {AdminId} awarded verification badge {BadgeTypeId} to user {UserId}",
            adminId, request.BadgeTypeId, request.UserId);

        return Ok(new
        {
            success = true,
            message = "Verification badge awarded",
            badge = new
            {
                id = badge!.Id,
                user_id = badge.UserId,
                badge_type = badge.BadgeType != null ? new
                {
                    id = badge.BadgeType.Id,
                    key = badge.BadgeType.Key,
                    name = badge.BadgeType.Name
                } : null,
                awarded_at = badge.AwardedAt,
                expires_at = badge.ExpiresAt,
                notes = badge.Notes,
                awarded_by = badge.AwardedBy != null ? new
                {
                    id = badge.AwardedBy.Id,
                    first_name = badge.AwardedBy.FirstName,
                    last_name = badge.AwardedBy.LastName
                } : null
            }
        });
    }
}

public class AwardVerificationBadgeRequest
{
    [JsonPropertyName("user_id")]
    public int UserId { get; set; }

    [JsonPropertyName("badge_type_id")]
    public int BadgeTypeId { get; set; }

    [JsonPropertyName("notes")]
    public string? Notes { get; set; }

    [JsonPropertyName("expires_at")]
    public DateTime? ExpiresAt { get; set; }
}
