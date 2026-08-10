// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Member activity controller - recent activity feeds and dashboard stats.
/// Provides per-user activity history and admin-level activity analytics.
/// </summary>
[ApiController]
[Authorize]
public class MemberActivityController : ControllerBase
{
    private readonly MemberActivityService _activityService;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<MemberActivityController> _logger;

    public MemberActivityController(
        MemberActivityService activityService,
        TenantContext tenantContext,
        ILogger<MemberActivityController> logger)
    {
        _activityService = activityService;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>
    /// GET /api/users/me/activity - Get current user's recent activity.
    /// </summary>
    [HttpGet("api/users/me/activity")]
    public async Task<IActionResult> GetMyActivity(
        [FromQuery] int days = 30,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (page < 1) page = 1;
        limit = Math.Clamp(limit, 1, 100);

        var (items, total) = await _activityService.GetUserActivityAsync(userId.Value, days, page, limit);

        return Ok(new
        {
            data = items.Select(a => new
            {
                id = a.Id,
                activity_type = a.ActivityType,
                details = a.Details,
                occurred_at = a.OccurredAt
            }),
            pagination = new
            {
                page,
                limit,
                total,
                pages = (int)Math.Ceiling((double)total / limit)
            }
        });
    }

    /// <summary>
    /// GET /api/users/me/activity/dashboard - Get current user's dashboard stats.
    /// </summary>
    [HttpGet("api/users/me/activity/dashboard")]
    public async Task<IActionResult> GetMyDashboard()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var stats = await _activityService.GetUserDashboardAsync(userId.Value);

        return Ok(new
        {
            total_exchanges = stats.TotalExchanges,
            messages_sent = stats.MessagesSent,
            posts_created = stats.PostsCreated,
            total_xp_earned = stats.TotalXpEarned,
            login_streak = stats.LoginStreak,
            member_since = stats.MemberSince,
            last_active = stats.LastActive
        });
    }

    /// <summary>
    /// GET /api/users/{userId}/activity - Get another user's recent activity.
    /// </summary>
    [HttpGet("api/users/{userId:int}/activity")]
    public async Task<IActionResult> GetUserActivity(
        int userId,
        [FromQuery] int days = 30,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        if (page < 1) page = 1;
        limit = Math.Clamp(limit, 1, 100);

        var (items, total) = await _activityService.GetUserActivityAsync(userId, days, page, limit);

        return Ok(new
        {
            data = items.Select(a => new
            {
                id = a.Id,
                activity_type = a.ActivityType,
                details = a.Details,
                occurred_at = a.OccurredAt
            }),
            pagination = new
            {
                page,
                limit,
                total,
                pages = (int)Math.Ceiling((double)total / limit)
            }
        });
    }

    /// <summary>
    /// GET /api/users/{userId}/activity/dashboard - Get another user's dashboard stats.
    /// </summary>
    [HttpGet("api/users/{userId:int}/activity/dashboard")]
    public async Task<IActionResult> GetUserDashboard(int userId)
    {
        var stats = await _activityService.GetUserDashboardAsync(userId);

        return Ok(new
        {
            total_exchanges = stats.TotalExchanges,
            messages_sent = stats.MessagesSent,
            posts_created = stats.PostsCreated,
            total_xp_earned = stats.TotalXpEarned,
            login_streak = stats.LoginStreak,
            member_since = stats.MemberSince,
            last_active = stats.LastActive
        });
    }

    /// <summary>
    /// GET /api/admin/activity/stats - Admin: activity breakdown by type for the tenant.
    /// </summary>
    [HttpGet("api/admin/activity/stats")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> GetActivityStats()
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var stats = await _activityService.GetActivityStatsAsync(tenantId);

        return Ok(new
        {
            data = stats.Select(s => new
            {
                activity_type = s.ActivityType,
                count = s.Count,
                unique_users = s.UniqueUsers,
                last_occurred = s.LastOccurred
            }),
            period_days = 30
        });
    }
}
