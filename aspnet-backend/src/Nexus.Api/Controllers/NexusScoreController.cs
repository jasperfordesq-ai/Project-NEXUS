// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// NexusScore reputation endpoints.
/// </summary>
[ApiController]
[Route("api/nexus-score")]
[Authorize]
public class NexusScoreController : ControllerBase
{
    private readonly NexusScoreService _nexusScore;

    public NexusScoreController(NexusScoreService nexusScore)
    {
        _nexusScore = nexusScore;
    }

    /// <summary>
    /// GET /api/nexus-score/me - Get my NexusScore.
    /// </summary>
    [HttpGet("me")]
    public async Task<IActionResult> GetMyScore()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var score = await _nexusScore.GetScoreAsync(userId.Value);
        if (score == null) return Ok(new { data = (object?)null, message = "Score not yet calculated" });

        return Ok(new { data = MapScore(score) });
    }

    /// <summary>
    /// GET /api/nexus-score/{userId} - Get another user's NexusScore.
    /// </summary>
    [HttpGet("{userId:int}")]
    public async Task<IActionResult> GetUserScore(int userId)
    {
        var callerId = User.GetUserId();
        if (callerId == null) return Unauthorized(new { error = "Invalid token" });

        var score = await _nexusScore.GetScoreAsync(userId);
        if (score == null) return NotFound(new { error = "Score not found" });

        return Ok(new { data = MapScore(score) });
    }

    /// <summary>
    /// POST /api/nexus-score/recalculate - Recalculate my score.
    /// </summary>
    [HttpPost("recalculate")]
    public async Task<IActionResult> Recalculate()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (score, error) = await _nexusScore.RecalculateAsync(userId.Value, "user_request");
        if (error != null) return NotFound(new { error });
        return Ok(new { data = MapScore(score!) });
    }

    /// <summary>
    /// GET /api/nexus-score/leaderboard - Score leaderboard.
    /// </summary>
    [HttpGet("leaderboard")]
    public async Task<IActionResult> GetLeaderboard([FromQuery] int page = 1, [FromQuery] int limit = 20)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);

        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var scores = await _nexusScore.GetLeaderboardAsync(page, limit);
        return Ok(new
        {
            data = scores.Select(s => new
            {
                s.UserId, s.Score, s.Tier, last_calculated_at = s.LastCalculatedAt,
                user = s.User != null ? new { s.User.Id, s.User.FirstName, s.User.LastName } : null
            })
        });
    }

    /// <summary>
    /// GET /api/nexus-score/history - My score history.
    /// </summary>
    [HttpGet("history")]
    public async Task<IActionResult> GetHistory([FromQuery] int limit = 20)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var history = await _nexusScore.GetHistoryAsync(userId.Value, limit);
        return Ok(new
        {
            data = history.Select(h => new
            {
                previous_score = h.PreviousScore,
                new_score = h.NewScore,
                previous_tier = h.PreviousTier,
                new_tier = h.NewTier,
                h.Reason,
                created_at = h.CreatedAt
            })
        });
    }

    /// <summary>
    /// GET /api/nexus-score/distribution - Tier distribution (admin).
    /// </summary>
    [HttpGet("distribution")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> GetDistribution()
    {
        var distribution = await _nexusScore.GetTierDistributionAsync();
        return Ok(new { data = distribution });
    }

    /// <summary>
    /// POST /api/nexus-score/admin/recalculate/{userId} - Admin recalculate user's score.
    /// </summary>
    [HttpPost("admin/recalculate/{userId}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> AdminRecalculate(int userId)
    {
        var (score, error) = await _nexusScore.RecalculateAsync(userId, "admin_recalculation");
        if (error != null) return NotFound(new { error });
        return Ok(new { data = MapScore(score!) });
    }

    private static object MapScore(Entities.NexusScore s) => new
    {
        s.UserId, s.Score, s.Tier,
        exchange_score = s.ExchangeScore,
        review_score = s.ReviewScore,
        engagement_score = s.EngagementScore,
        reliability_score = s.ReliabilityScore,
        tenure_score = s.TenureScore,
        last_calculated_at = s.LastCalculatedAt
    };
}
