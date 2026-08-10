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

[ApiController]
[Authorize]
public class IdeationController : ControllerBase
{
    private readonly IdeationService _ideationService;
    public IdeationController(IdeationService ideationService) => _ideationService = ideationService;

    [HttpGet("api/ideas")]
    public async Task<IActionResult> ListIdeas([FromQuery] int page = 1, [FromQuery] int limit = 20, [FromQuery] string? status = null, [FromQuery] string? sort = "newest")
    {
        page = Math.Max(1, page); limit = Math.Clamp(limit, 1, 100);
        var (ideas, total) = await _ideationService.ListIdeasAsync(page, limit, status, sort);
        var data = ideas.Select(i => new { id = i.Id, title = i.Title, category = i.Category, status = i.Status, upvote_count = i.UpvoteCount, comment_count = i.CommentCount, author = i.Author != null ? new { id = i.Author.Id, first_name = i.Author.FirstName, last_name = i.Author.LastName } : null, created_at = i.CreatedAt });
        return Ok(new { data, pagination = new { page, limit, total, pages = (int)Math.Ceiling((double)total / limit) } });
    }

    [HttpGet("api/ideas/{id:int}")]
    public async Task<IActionResult> GetIdea(int id)
    {
        var idea = await _ideationService.GetIdeaAsync(id);
        if (idea == null) return NotFound(new { error = "Idea not found" });
        var userId = User.GetUserId();
        return Ok(new { id = idea.Id, title = idea.Title, content = idea.Content, category = idea.Category, status = idea.Status, upvote_count = idea.UpvoteCount, comment_count = idea.CommentCount, has_voted = userId.HasValue && idea.Votes.Any(v => v.UserId == userId.Value), author = idea.Author != null ? new { id = idea.Author.Id, first_name = idea.Author.FirstName, last_name = idea.Author.LastName } : null, comments = idea.Comments.Select(c => new { id = c.Id, content = c.Content, created_at = c.CreatedAt, user = c.User != null ? new { id = c.User.Id, first_name = c.User.FirstName, last_name = c.User.LastName } : null }), created_at = idea.CreatedAt });
    }

    [HttpPost("api/ideas")]
    public async Task<IActionResult> CreateIdea([FromBody] CreateIdeaRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var (idea, error) = await _ideationService.CreateIdeaAsync(userId.Value, request.Title, request.Content, request.Category);
        if (error != null) return BadRequest(new { error });
        return CreatedAtAction(nameof(GetIdea), new { id = idea!.Id }, new { id = idea.Id, title = idea.Title, status = idea.Status, created_at = idea.CreatedAt });
    }

    [HttpPost("api/ideas/{id:int}/vote")]
    public async Task<IActionResult> VoteIdea(int id) { var userId = User.GetUserId(); if (userId == null) return Unauthorized(new { error = "Invalid token" }); var (s, e) = await _ideationService.VoteIdeaAsync(id, userId.Value); return s ? Ok(new { message = "Upvoted" }) : BadRequest(new { error = e }); }

    [HttpDelete("api/ideas/{id:int}/vote")]
    public async Task<IActionResult> UnvoteIdea(int id) { var userId = User.GetUserId(); if (userId == null) return Unauthorized(new { error = "Invalid token" }); var (s, e) = await _ideationService.UnvoteIdeaAsync(id, userId.Value); return s ? Ok(new { message = "Removed" }) : BadRequest(new { error = e }); }

    [HttpPost("api/ideas/{id:int}/comments")]
    public async Task<IActionResult> CommentOnIdea(int id, [FromBody] IdeaCommentRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var (comment, error) = await _ideationService.CommentOnIdeaAsync(id, userId.Value, request.Content);
        if (error != null) return BadRequest(new { error });
        return CreatedAtAction(nameof(GetIdea), new { id }, new { id = comment!.Id, content = comment.Content, created_at = comment.CreatedAt });
    }

    [HttpGet("api/challenges")]
    public async Task<IActionResult> ListChallenges([FromQuery] int page = 1, [FromQuery] int limit = 20, [FromQuery] bool? active = null)
    {
        page = Math.Max(1, page); limit = Math.Clamp(limit, 1, 100);
        var (challenges, total) = await _ideationService.ListChallengesAsync(page, limit, active);
        var userId = User.GetUserId();
        var data = challenges.Select(c => new { id = c.Id, title = c.Title, description = c.Description, challenge_type = c.ChallengeType.ToString().ToLowerInvariant(), target_action = c.TargetAction, target_count = c.TargetCount, xp_reward = c.XpReward, is_active = c.IsActive, difficulty = c.Difficulty.ToString().ToLowerInvariant(), participant_count = c.Participants.Count, is_participating = userId.HasValue && c.Participants.Any(p => p.UserId == userId.Value), starts_at = c.StartsAt, ends_at = c.EndsAt, created_at = c.CreatedAt });
        return Ok(new { data, pagination = new { page, limit, total, pages = (int)Math.Ceiling((double)total / limit) } });
    }

    [HttpPost("api/challenges/{id:int}/join")]
    public async Task<IActionResult> JoinChallenge(int id) { var userId = User.GetUserId(); if (userId == null) return Unauthorized(new { error = "Invalid token" }); var (s, e) = await _ideationService.JoinChallengeAsync(id, userId.Value); return s ? Ok(new { message = "Joined" }) : BadRequest(new { error = e }); }

    [HttpPut("api/challenges/{id:int}/progress")]
    public async Task<IActionResult> UpdateChallengeProgress(int id, [FromBody] UpdateChallengeProgressRequest request) { var userId = User.GetUserId(); if (userId == null) return Unauthorized(new { error = "Invalid token" }); var (s, e) = await _ideationService.UpdateChallengeProgressAsync(id, userId.Value, request.Value); return s ? Ok(new { message = "Updated" }) : BadRequest(new { error = e }); }
    [HttpPost("api/ideas/{id:int}/favorite")]
    public async Task<IActionResult> FavoriteIdea(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var (favorited, error) = await _ideationService.AddFavoriteIdeaAsync(id, userId.Value);
        if (error == "Already favorited") return Conflict(new { error });
        if (error != null) return BadRequest(new { error });
        return Ok(new { favorited, idea_id = id });
    }

    [HttpDelete("api/ideas/{id:int}/favorite")]
    public async Task<IActionResult> UnfavoriteIdea(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var (removed, error) = await _ideationService.RemoveFavoriteIdeaAsync(id, userId.Value);
        if (error == "Not favorited") return NotFound(new { error });
        if (error != null) return BadRequest(new { error });
        return Ok(new { favorited = false, idea_id = id });
    }

    [HttpPost("api/ideas/{id:int}/duplicate")]
    public async Task<IActionResult> DuplicateIdea(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var (idea, error) = await _ideationService.DuplicateIdeaAsync(id, userId.Value);
        if (error != null) return BadRequest(new { error });
        return CreatedAtAction(nameof(GetIdea), new { id = idea!.Id },
            new { id = idea.Id, title = idea.Title, status = idea.Status, created_at = idea.CreatedAt });
    }

    [HttpPost("api/ideas/{id:int}/convert-to-group")]
    public async Task<IActionResult> ConvertToGroup(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var (group, error) = await _ideationService.ConvertToGroupAsync(id, userId.Value);
        if (error == "Idea not found") return NotFound(new { error });
        if (error != null) return BadRequest(new { error });
        return Ok(new { group_id = group!.Id, group_name = group.Name, idea_id = id });
    }


}


public class CreateIdeaRequest { [JsonPropertyName("title")] public string Title { get; set; } = string.Empty; [JsonPropertyName("content")] public string Content { get; set; } = string.Empty; [JsonPropertyName("category")] public string? Category { get; set; } }
public class IdeaCommentRequest { [JsonPropertyName("content")] public string Content { get; set; } = string.Empty; }
public class UpdateChallengeProgressRequest { [JsonPropertyName("value")] public int Value { get; set; } }
