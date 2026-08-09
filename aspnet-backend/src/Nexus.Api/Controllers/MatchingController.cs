// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Smart matching endpoints - find compatible users and listings.
/// Phase 17: Smart Matching.
/// </summary>
[ApiController]
[Route("api/matching")]
[Authorize]
public class MatchingController : ControllerBase
{
    private readonly MatchingService _matching;
    private readonly ILogger<MatchingController> _logger;

    public MatchingController(MatchingService matching, ILogger<MatchingController> logger)
    {
        _matching = matching;
        _logger = logger;
    }

    /// <summary>
    /// GET /api/matching - Get my matches (paginated).
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetMatches(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var (data, total) = await _matching.GetMatchesForUserAsync(userId.Value, page, limit);
        var totalPages = (int)Math.Ceiling(total / (double)limit);

        return Ok(new
        {
            data = data.Select(m => FormatMatch(m)),
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
    /// POST /api/matching/compute - Trigger match computation for current user.
    /// </summary>
    [HttpPost("compute")]
    public async Task<IActionResult> ComputeMatches()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var matchCount = await _matching.ComputeMatchesForUserAsync(userId.Value);

        return Ok(new
        {
            message = $"Computed {matchCount} matches",
            matches_found = matchCount
        });
    }

    /// <summary>
    /// GET /api/matching/{id} - Get specific match detail.
    /// Marks the match as viewed if it was pending.
    /// </summary>
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetMatch(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var match = await _matching.GetMatchByIdAsync(id, userId.Value);
        if (match == null)
            return NotFound(new { error = "Match not found" });

        return Ok(FormatMatchDetail(match));
    }

    /// <summary>
    /// PUT /api/matching/{id}/respond - Accept or decline a match.
    /// </summary>
    [HttpPut("{id:int}/respond")]
    public async Task<IActionResult> RespondToMatch(int id, [FromBody] RespondToMatchRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (!Enum.TryParse<MatchStatus>(request.Status, true, out var status))
            return BadRequest(new { error = "Invalid status. Must be 'Accepted' or 'Declined'" });

        var (match, error) = await _matching.RespondToMatchAsync(id, userId.Value, status);

        if (error != null)
            return BadRequest(new { error });

        return Ok(new
        {
            message = $"Match {status.ToString().ToLower()}",
            match = FormatMatch(match!)
        });
    }

    /// <summary>
    /// GET /api/matching/preferences - Get my match preferences.
    /// </summary>
    [HttpGet("preferences")]
    public async Task<IActionResult> GetPreferences()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var preferences = await _matching.GetMatchPreferencesAsync(userId.Value);

        if (preferences == null)
        {
            return Ok(new
            {
                message = "No preferences set",
                preferences = (object?)null
            });
        }

        return Ok(new
        {
            preferences = FormatPreferences(preferences)
        });
    }

    /// <summary>
    /// PUT /api/matching/preferences - Update my match preferences.
    /// </summary>
    [HttpPut("preferences")]
    public async Task<IActionResult> UpdatePreferences([FromBody] UpdatePreferencesRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var preferences = await _matching.UpdateMatchPreferencesAsync(
            userId.Value,
            request.MaxDistanceKm,
            request.PreferredCategories,
            request.AvailableDays,
            request.AvailableTimeSlots,
            request.SkillsOffered,
            request.SkillsWanted,
            request.IsActive);

        return Ok(new
        {
            message = "Preferences updated",
            preferences = FormatPreferences(preferences)
        });
    }

    private static object FormatMatch(MatchResult m)
    {
        return new
        {
            id = m.Id,
            matched_user = m.MatchedUser != null ? new
            {
                id = m.MatchedUser.Id,
                first_name = m.MatchedUser.FirstName,
                last_name = m.MatchedUser.LastName,
                level = m.MatchedUser.Level
            } : null,
            matched_listing = m.MatchedListing != null ? new
            {
                id = m.MatchedListing.Id,
                title = m.MatchedListing.Title,
                type = m.MatchedListing.Type.ToString().ToLower()
            } : null,
            score = m.Score,
            status = m.Status.ToString().ToLower(),
            viewed_at = m.ViewedAt,
            responded_at = m.RespondedAt,
            created_at = m.CreatedAt
        };
    }

    private static object FormatMatchDetail(MatchResult m)
    {
        return new
        {
            id = m.Id,
            matched_user = m.MatchedUser != null ? new
            {
                id = m.MatchedUser.Id,
                first_name = m.MatchedUser.FirstName,
                last_name = m.MatchedUser.LastName,
                level = m.MatchedUser.Level,
                total_xp = m.MatchedUser.TotalXp
            } : null,
            matched_listing = m.MatchedListing != null ? new
            {
                id = m.MatchedListing.Id,
                title = m.MatchedListing.Title,
                description = m.MatchedListing.Description,
                type = m.MatchedListing.Type.ToString().ToLower(),
                category_id = m.MatchedListing.CategoryId,
                estimated_hours = m.MatchedListing.EstimatedHours
            } : null,
            score = m.Score,
            reasons = m.Reasons,
            status = m.Status.ToString().ToLower(),
            viewed_at = m.ViewedAt,
            responded_at = m.RespondedAt,
            created_at = m.CreatedAt,
            updated_at = m.UpdatedAt
        };
    }

    private static object FormatPreferences(MatchPreference p)
    {
        return new
        {
            id = p.Id,
            max_distance_km = p.MaxDistanceKm,
            preferred_categories = p.PreferredCategories,
            available_days = p.AvailableDays,
            available_time_slots = p.AvailableTimeSlots,
            skills_offered = p.SkillsOffered,
            skills_wanted = p.SkillsWanted,
            is_active = p.IsActive,
            created_at = p.CreatedAt,
            updated_at = p.UpdatedAt
        };
    }
}

public class RespondToMatchRequest
{
    [JsonPropertyName("status")]
    public string Status { get; set; } = string.Empty;
}

public class UpdatePreferencesRequest
{
    [JsonPropertyName("max_distance_km")]
    public double? MaxDistanceKm { get; set; }

    [JsonPropertyName("preferred_categories")]
    public string? PreferredCategories { get; set; }

    [JsonPropertyName("available_days")]
    public string? AvailableDays { get; set; }

    [JsonPropertyName("available_time_slots")]
    public string? AvailableTimeSlots { get; set; }

    [JsonPropertyName("skills_offered")]
    public string? SkillsOffered { get; set; }

    [JsonPropertyName("skills_wanted")]
    public string? SkillsWanted { get; set; }

    [JsonPropertyName("is_active")]
    public bool? IsActive { get; set; }
}
