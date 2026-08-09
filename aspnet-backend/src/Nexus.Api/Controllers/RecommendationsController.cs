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
/// Recommendations controller - collaborative filtering, similar users, interaction tracking, and match feedback.
/// </summary>
[ApiController]
[Route("api/recommendations")]
[Authorize]
public class RecommendationsController : ControllerBase
{
    private readonly CollaborativeFilterService _collaborativeFilter;
    private readonly TenantContext _tenant;
    private readonly ILogger<RecommendationsController> _logger;

    public RecommendationsController(
        CollaborativeFilterService collaborativeFilter,
        TenantContext tenant,
        ILogger<RecommendationsController> logger)
    {
        _collaborativeFilter = collaborativeFilter;
        _tenant = tenant;
        _logger = logger;
    }

    // --- DTOs ---

    public class RecordInteractionRequest
    {
        [JsonPropertyName("interaction_type")]
        public string InteractionType { get; set; } = string.Empty;

        [JsonPropertyName("target_type")]
        public string TargetType { get; set; } = string.Empty;

        [JsonPropertyName("target_id")]
        public int TargetId { get; set; }

        [JsonPropertyName("score")]
        public double? Score { get; set; }
    }

    public class MatchFeedbackRequest
    {
        [JsonPropertyName("match_result_id")]
        public int MatchResultId { get; set; }

        [JsonPropertyName("feedback_type")]
        public string FeedbackType { get; set; } = string.Empty;

        [JsonPropertyName("comment")]
        public string? Comment { get; set; }
    }

    // --- Endpoints ---

    /// <summary>
    /// GET /api/recommendations - Get recommendations for current user.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetRecommendations(
        [FromQuery] string targetType = "listings",
        [FromQuery] int limit = 10)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenant.GetTenantIdOrThrow();
        limit = Math.Clamp(limit, 1, 100);

        var (recommendations, error) = await _collaborativeFilter.GetRecommendationsAsync(
            tenantId, userId.Value, targetType, limit);

        if (error != null)
            return BadRequest(new { error });

        var data = recommendations!.Select(r => new
        {
            target_id = r.TargetId,
            score = r.Score,
            target_type = r.TargetType
        });

        return Ok(new { data });
    }

    /// <summary>
    /// GET /api/recommendations/similar-users - Get similar users.
    /// </summary>
    [HttpGet("similar-users")]
    public async Task<IActionResult> GetSimilarUsers([FromQuery] int limit = 10)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenant.GetTenantIdOrThrow();
        limit = Math.Clamp(limit, 1, 100);

        var (similarUsers, error) = await _collaborativeFilter.GetSimilarUsersAsync(
            tenantId, userId.Value, limit);

        if (error != null)
            return BadRequest(new { error });

        var data = similarUsers!.Select(u => new
        {
            user_id = u.UserId,
            similarity_score = u.SimilarityScore,
            common_interactions = u.CommonInteractions
        });

        return Ok(new { data });
    }

    /// <summary>
    /// POST /api/recommendations/interactions - Record an interaction.
    /// </summary>
    [HttpPost("interactions")]
    public async Task<IActionResult> RecordInteraction([FromBody] RecordInteractionRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenant.GetTenantIdOrThrow();

        if (string.IsNullOrWhiteSpace(request.InteractionType))
            return BadRequest(new { error = "interaction_type is required" });
        if (string.IsNullOrWhiteSpace(request.TargetType))
            return BadRequest(new { error = "target_type is required" });

        var (interaction, error) = await _collaborativeFilter.RecordInteractionAsync(
            tenantId, userId.Value, request.InteractionType, request.TargetType,
            request.TargetId, request.Score);

        if (error != null)
            return BadRequest(new { error });

        return Ok(new
        {
            id = interaction!.Id,
            interaction_type = interaction.InteractionType,
            target_type = interaction.TargetType,
            target_id = interaction.TargetId,
            score = interaction.Score,
            created_at = interaction.CreatedAt
        });
    }

    /// <summary>
    /// POST /api/recommendations/match-feedback - Submit match feedback.
    /// </summary>
    [HttpPost("match-feedback")]
    public async Task<IActionResult> SubmitMatchFeedback([FromBody] MatchFeedbackRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenant.GetTenantIdOrThrow();

        if (string.IsNullOrWhiteSpace(request.FeedbackType))
            return BadRequest(new { error = "feedback_type is required" });

        var (feedback, error) = await _collaborativeFilter.SubmitMatchFeedbackAsync(
            tenantId, userId.Value, request.MatchResultId, request.FeedbackType, request.Comment);

        if (error != null)
            return BadRequest(new { error });

        return Ok(new
        {
            id = feedback!.Id,
            match_result_id = feedback.MatchResultId,
            feedback_type = feedback.FeedbackType,
            comment = feedback.Comment,
            created_at = feedback.CreatedAt
        });
    }

    /// <summary>
    /// GET /api/recommendations/match-feedback/stats - Get feedback stats (admin only).
    /// </summary>
    [HttpGet("match-feedback/stats")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> GetMatchFeedbackStats()
    {
        var tenantId = _tenant.GetTenantIdOrThrow();

        var stats = await _collaborativeFilter.GetMatchFeedbackStatsAsync(tenantId);

        return Ok(new { data = stats });
    }

    /// <summary>
    /// POST /api/recommendations/recalculate - Trigger similarity recalculation (admin only).
    /// </summary>
    [HttpPost("recalculate")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> Recalculate()
    {
        var tenantId = _tenant.GetTenantIdOrThrow();

        var (result, error) = await _collaborativeFilter.RecalculateSimilaritiesAsync(tenantId);

        if (error != null)
            return BadRequest(new { error });

        return Ok(new
        {
            message = "Similarity recalculation triggered",
            users_processed = result!.UsersProcessed,
            similarities_computed = result.SimilaritiesComputed
        });
    }

    /// <summary>
    /// GET /api/recommendations/weighted - Get weighted recommendations for current user.
    /// </summary>
    [HttpGet("weighted")]
    public async Task<IActionResult> GetWeightedRecommendations(
        [FromQuery] string targetType = "listings", [FromQuery] int limit = 10)
    {
        limit = Math.Clamp(limit, 1, 100);

        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var recommendations = await _collaborativeFilter.GetWeightedRecommendationsAsync(userId.Value, targetType, limit);
        return Ok(new { data = recommendations.Select(r => new { target_id = r.TargetId, score = r.Score, target_type = r.TargetType }) });
    }

    /// <summary>
    /// POST /api/recommendations/recalculate-multi - Trigger multi-algorithm recalculation (admin only).
    /// </summary>
    [HttpPost("recalculate-multi")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> RecalculateMultiAlgorithm()
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var result = await _collaborativeFilter.RecalculateWithMultipleAlgorithmsAsync(tenantId);
        return Ok(result);
    }
}
