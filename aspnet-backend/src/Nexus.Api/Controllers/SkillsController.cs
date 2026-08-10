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
/// Skills and endorsements controller.
/// Phase 23: Endorsements & Skills.
/// </summary>
[ApiController]
[Route("api/skills")]
[Authorize]
public class SkillsController : ControllerBase
{
    private readonly SkillService _skillService;
    private readonly ILogger<SkillsController> _logger;

    public SkillsController(SkillService skillService, ILogger<SkillsController> logger)
    {
        _skillService = skillService;
        _logger = logger;
    }

    /// <summary>
    /// GET /api/skills - Get the skill catalog with optional search and pagination.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetSkillCatalog(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        [FromQuery] string? search = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var (data, total) = await _skillService.GetSkillCatalogAsync(page, limit, search);
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
    /// GET /api/skills/users/{userId} - Get a user's skills with endorsement counts.
    /// </summary>
    [HttpGet("users/{userId}")]
    public async Task<IActionResult> GetUserSkills(int userId)
    {
        var currentUserId = User.GetUserId();
        if (currentUserId == null) return Unauthorized(new { error = "Invalid token" });

        var skills = await _skillService.GetUserSkillsAsync(userId);

        return Ok(new
        {
            user_id = userId,
            data = skills,
            total = skills.Count
        });
    }

    /// <summary>
    /// POST /api/skills/my - Add a skill to current user's profile.
    /// </summary>
    [HttpPost("my")]
    public async Task<IActionResult> AddSkill([FromBody] AddSkillRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (success, error, data) = await _skillService.AddSkillAsync(userId.Value, request.SkillId, request.ProficiencyLevel);

        if (!success)
        {
            return BadRequest(new { error });
        }

        return Created("", data);
    }

    /// <summary>
    /// DELETE /api/skills/my/{skillId} - Remove a skill from current user's profile.
    /// </summary>
    [HttpDelete("my/{skillId}")]
    public async Task<IActionResult> RemoveSkill(int skillId)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (success, error) = await _skillService.RemoveSkillAsync(userId.Value, skillId);

        if (!success)
        {
            return NotFound(new { error });
        }

        return Ok(new { message = "Skill removed from profile" });
    }

    /// <summary>
    /// PUT /api/skills/my/{skillId} - Update proficiency level for a skill.
    /// </summary>
    [HttpPut("my/{skillId}")]
    public async Task<IActionResult> UpdateProficiency(int skillId, [FromBody] UpdateProficiencyRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (success, error, data) = await _skillService.UpdateProficiencyAsync(userId.Value, skillId, request.ProficiencyLevel);

        if (!success)
        {
            return NotFound(new { error });
        }

        return Ok(data);
    }

    /// <summary>
    /// POST /api/skills/users/{userId}/{skillId}/endorse - Endorse a user's skill.
    /// </summary>
    [HttpPost("users/{userId}/{skillId}/endorse")]
    public async Task<IActionResult> EndorseSkill(int userId, int skillId, [FromBody] EndorseSkillRequest? request = null)
    {
        var endorserId = User.GetUserId();
        if (endorserId == null) return Unauthorized(new { error = "Invalid token" });

        if (endorserId.Value == userId)
            return BadRequest(new { error = "Cannot endorse your own skill" });

        var (success, error, data) = await _skillService.EndorseSkillAsync(
            endorserId.Value, userId, skillId, request?.Comment);

        if (!success)
        {
            return BadRequest(new { error });
        }

        return Created("", data);
    }

    /// <summary>
    /// DELETE /api/skills/users/{userId}/{skillId}/endorse - Remove endorsement.
    /// </summary>
    [HttpDelete("users/{userId}/{skillId}/endorse")]
    public async Task<IActionResult> RemoveEndorsement(int userId, int skillId)
    {
        var endorserId = User.GetUserId();
        if (endorserId == null) return Unauthorized(new { error = "Invalid token" });

        var (success, error) = await _skillService.RemoveEndorsementAsync(endorserId.Value, userId, skillId);

        if (!success)
        {
            return NotFound(new { error });
        }

        return Ok(new { message = "Endorsement removed" });
    }

    /// <summary>
    /// GET /api/skills/users/{userId}/{skillId}/endorsements - List endorsements for a user's skill.
    /// </summary>
    [HttpGet("users/{userId}/{skillId}/endorsements")]
    public async Task<IActionResult> GetEndorsements(int userId, int skillId)
    {
        var currentUserId = User.GetUserId();
        if (currentUserId == null) return Unauthorized(new { error = "Invalid token" });

        var (success, error, data) = await _skillService.GetEndorsementsAsync(userId, skillId);

        if (!success)
        {
            return NotFound(new { error });
        }

        return Ok(data);
    }

    /// <summary>
    /// GET /api/skills/top-endorsed - Get top endorsed users.
    /// </summary>
    [HttpGet("top-endorsed")]
    public async Task<IActionResult> GetTopEndorsed(
        [FromQuery(Name = "skill_id")] int? skillId = null,
        [FromQuery] int limit = 20)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var data = await _skillService.GetTopEndorsedUsersAsync(skillId, limit);

        return Ok(new
        {
            data,
            total = data.Count
        });
    }

    /// <summary>
    /// GET /api/skills/suggestions - Get skill suggestions for current user.
    /// </summary>
    [HttpGet("suggestions")]
    public async Task<IActionResult> GetSuggestions()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var suggestions = await _skillService.SuggestSkillsAsync(userId.Value);

        return Ok(new
        {
            data = suggestions,
            total = suggestions.Count
        });
    }
}

public class AddSkillRequest
{
    [JsonPropertyName("skill_id")]
    public int SkillId { get; set; }

    [JsonPropertyName("proficiency_level")]
    public SkillLevel ProficiencyLevel { get; set; } = SkillLevel.Beginner;
}

public class UpdateProficiencyRequest
{
    [JsonPropertyName("proficiency_level")]
    public SkillLevel ProficiencyLevel { get; set; }
}

public class EndorseSkillRequest
{
    [JsonPropertyName("comment")]
    public string? Comment { get; set; }
}
