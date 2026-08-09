// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Goals controller - personal goal setting and tracking.
/// Phase 47: Goals Module.
/// </summary>
[ApiController]
[Authorize]
public class GoalsController : ControllerBase
{
    private readonly GoalService _goalService;

    public GoalsController(GoalService goalService) => _goalService = goalService;

    [HttpGet("api/goals")]
    public async Task<IActionResult> ListGoals(
        [FromQuery] int page = 1, [FromQuery] int limit = 20, [FromQuery] string? status = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        page = Math.Max(1, page);
        limit = Math.Clamp(limit, 1, 100);

        var (goals, total) = await _goalService.ListGoalsAsync(userId.Value, page, limit, status);

        var data = goals.Select(g => new
        {
            id = g.Id, title = g.Title, description = g.Description,
            goal_type = g.GoalType, target_value = g.TargetValue, current_value = g.CurrentValue,
            category = g.Category, status = g.Status, target_date = g.TargetDate,
            completed_at = g.CompletedAt, created_at = g.CreatedAt,
            milestones = g.Milestones.Select(m => new
            {
                id = m.Id, title = m.Title, is_completed = m.IsCompleted,
                completed_at = m.CompletedAt
            }),
            progress = g.TargetValue > 0 ? Math.Round((double)(g.CurrentValue / g.TargetValue.Value) * 100, 1) : (double?)null
        });

        return Ok(new { data, pagination = new { page, limit, total, pages = (int)Math.Ceiling((double)total / limit) } });
    }

    [HttpGet("api/goals/{id:int}")]
    public async Task<IActionResult> GetGoal(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var goal = await _goalService.GetGoalAsync(id, userId.Value);
        if (goal == null) return NotFound(new { error = "Goal not found" });

        return Ok(new
        {
            id = goal.Id, title = goal.Title, description = goal.Description,
            goal_type = goal.GoalType, target_value = goal.TargetValue,
            current_value = goal.CurrentValue, category = goal.Category,
            status = goal.Status, target_date = goal.TargetDate,
            completed_at = goal.CompletedAt, created_at = goal.CreatedAt,
            milestones = goal.Milestones.Select(m => new
            {
                id = m.Id, title = m.Title, is_completed = m.IsCompleted,
                completed_at = m.CompletedAt, sort_order = m.SortOrder
            }),
            progress = goal.TargetValue > 0 ? Math.Round((double)(goal.CurrentValue / goal.TargetValue.Value) * 100, 1) : (double?)null
        });
    }

    [HttpPost("api/goals")]
    public async Task<IActionResult> CreateGoal([FromBody] CreateGoalRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (goal, error) = await _goalService.CreateGoalAsync(
            userId.Value, request.Title, request.Description, request.GoalType,
            request.TargetValue, request.Category, request.TargetDate, request.Milestones);

        if (error != null) return BadRequest(new { error });

        return CreatedAtAction(nameof(GetGoal), new { id = goal!.Id }, new
        {
            id = goal.Id, title = goal.Title, goal_type = goal.GoalType,
            status = goal.Status, created_at = goal.CreatedAt
        });
    }

    [HttpPut("api/goals/{id:int}/progress")]
    public async Task<IActionResult> UpdateProgress(int id, [FromBody] UpdateProgressRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (goal, error) = await _goalService.UpdateProgressAsync(id, userId.Value, request.Value);
        if (error != null) return BadRequest(new { error });

        return Ok(new { id = goal!.Id, current_value = goal.CurrentValue, status = goal.Status, completed_at = goal.CompletedAt });
    }

    [HttpPut("api/goals/{id:int}/milestones/{milestoneId:int}/complete")]
    public async Task<IActionResult> CompleteMilestone(int id, int milestoneId)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (success, error) = await _goalService.CompleteMilestoneAsync(id, milestoneId, userId.Value);
        if (!success) return BadRequest(new { error });

        return Ok(new { message = "Milestone completed" });
    }

    [HttpPut("api/goals/{id:int}/abandon")]
    public async Task<IActionResult> AbandonGoal(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (success, error) = await _goalService.AbandonGoalAsync(id, userId.Value);
        if (!success) return BadRequest(new { error });

        return Ok(new { message = "Goal abandoned" });
    }
}

public class CreateGoalRequest
{
    [JsonPropertyName("title")] public string Title { get; set; } = string.Empty;
    [JsonPropertyName("description")] public string? Description { get; set; }
    [JsonPropertyName("goal_type")] public string GoalType { get; set; } = "custom";
    [JsonPropertyName("target_value")] public decimal? TargetValue { get; set; }
    [JsonPropertyName("category")] public string? Category { get; set; }
    [JsonPropertyName("target_date")] public DateTime? TargetDate { get; set; }
    [JsonPropertyName("milestones")] public List<string>? Milestones { get; set; }
}

public class UpdateProgressRequest
{
    [JsonPropertyName("value")] public decimal Value { get; set; }
}
