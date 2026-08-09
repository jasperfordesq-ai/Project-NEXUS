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
/// Insights controller - personal analytics dashboard with historical trends.
/// </summary>
[ApiController]
[Route("api/insights")]
[Authorize]
public class InsightsController : ControllerBase
{
    private readonly PersonalInsightsService _insightsService;
    private readonly TenantContext _tenant;
    private readonly ILogger<InsightsController> _logger;

    public InsightsController(
        PersonalInsightsService insightsService,
        TenantContext tenant,
        ILogger<InsightsController> logger)
    {
        _insightsService = insightsService;
        _tenant = tenant;
        _logger = logger;
    }

    // --- Endpoints ---

    /// <summary>
    /// GET /api/insights - Get current user's insights.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetMyInsights([FromQuery] string period = "month")
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenant.GetTenantIdOrThrow();

        var validPeriods = new[] { "week", "month", "quarter", "year" };
        if (!validPeriods.Contains(period))
            return BadRequest(new { error = $"Invalid period. Must be one of: {string.Join(", ", validPeriods)}" });

        var (insights, error) = await _insightsService.GetInsightsAsync(tenantId, userId.Value, period);

        if (error != null)
            return BadRequest(new { error });

        return Ok(new { data = insights });
    }

    /// <summary>
    /// POST /api/insights/recalculate - Recalculate current user's insights.
    /// </summary>
    [HttpPost("recalculate")]
    public async Task<IActionResult> RecalculateMyInsights()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenant.GetTenantIdOrThrow();

        var (insights, error) = await _insightsService.RecalculateAsync(tenantId, userId.Value);

        if (error != null)
            return BadRequest(new { error });

        return Ok(new
        {
            message = "Insights recalculated",
            data = insights
        });
    }

    /// <summary>
    /// GET /api/insights/history/{insightType} - Get historical values for an insight type.
    /// </summary>
    [HttpGet("history/{insightType}")]
    public async Task<IActionResult> GetInsightHistory(string insightType)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenant.GetTenantIdOrThrow();

        var (history, error) = await _insightsService.GetHistoryAsync(tenantId, userId.Value, insightType);

        if (error != null)
            return NotFound(new { error });

        var data = history!.Select(h => new
        {
            period = h.Period,
            value = h.Value,
            recorded_at = h.RecordedAt
        });

        return Ok(new { data });
    }

    /// <summary>
    /// GET /api/insights/users/{userId} - Get another user's public insights (limited subset).
    /// </summary>
    [HttpGet("users/{userId:int}")]
    public async Task<IActionResult> GetUserInsights(int userId)
    {
        var currentUserId = User.GetUserId();
        if (currentUserId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenant.GetTenantIdOrThrow();

        var (insights, error) = await _insightsService.GetPublicInsightsAsync(tenantId, userId);

        if (error != null)
            return NotFound(new { error });

        return Ok(new { data = insights });
    }
}
