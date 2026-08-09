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
/// Polls controller - community polls with single-choice, multiple-choice, and ranked voting.
/// Phase 46: Polls Module.
/// </summary>
[ApiController]
[Authorize]
public class PollsController : ControllerBase
{
    private readonly PollService _pollService;
    private readonly ILogger<PollsController> _logger;

    public PollsController(PollService pollService, ILogger<PollsController> logger)
    {
        _pollService = pollService;
        _logger = logger;
    }

    /// <summary>
    /// GET /api/polls - List polls.
    /// </summary>
    [HttpGet("api/polls")]
    public async Task<IActionResult> ListPolls(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        [FromQuery] string? status = null)
    {
        page = Math.Max(1, page);
        limit = Math.Clamp(limit, 1, 100);

        var (polls, total) = await _pollService.ListPollsAsync(page, limit, status);

        var data = polls.Select(p => new
        {
            id = p.Id,
            title = p.Title,
            description = p.Description,
            poll_type = p.PollType,
            status = p.Status,
            is_anonymous = p.IsAnonymous,
            option_count = p.Options.Count,
            created_by = p.CreatedBy != null ? new { id = p.CreatedBy.Id, first_name = p.CreatedBy.FirstName, last_name = p.CreatedBy.LastName } : null,
            closes_at = p.ClosesAt,
            created_at = p.CreatedAt
        });

        return Ok(new
        {
            data,
            pagination = new { page, limit, total, pages = (int)Math.Ceiling((double)total / limit) }
        });
    }

    /// <summary>
    /// GET /api/polls/{id} - Get poll details with options and results.
    /// </summary>
    [HttpGet("api/polls/{id:int}")]
    public async Task<IActionResult> GetPoll(int id)
    {
        var poll = await _pollService.GetPollAsync(id);
        if (poll == null)
            return NotFound(new { error = "Poll not found" });

        var userId = User.GetUserId();
        var hasVoted = poll.Votes.Any(v => v.UserId == userId);
        var showResults = poll.ShowResultsBeforeClose || poll.Status == "closed" || hasVoted;

        return Ok(new
        {
            id = poll.Id,
            title = poll.Title,
            description = poll.Description,
            poll_type = poll.PollType,
            status = poll.Status,
            is_anonymous = poll.IsAnonymous,
            show_results_before_close = poll.ShowResultsBeforeClose,
            max_choices = poll.MaxChoices,
            has_voted = hasVoted,
            options = poll.Options.Select(o => new
            {
                id = o.Id,
                text = o.Text,
                vote_count = showResults ? poll.Votes.Count(v => v.OptionId == o.Id) : (int?)null
            }),
            total_voters = showResults ? poll.Votes.Select(v => v.UserId).Distinct().Count() : (int?)null,
            created_by = poll.CreatedBy != null ? new { id = poll.CreatedBy.Id, first_name = poll.CreatedBy.FirstName, last_name = poll.CreatedBy.LastName } : null,
            closes_at = poll.ClosesAt,
            created_at = poll.CreatedAt
        });
    }

    /// <summary>
    /// POST /api/polls - Create a poll.
    /// </summary>
    [HttpPost("api/polls")]
    public async Task<IActionResult> CreatePoll([FromBody] CreatePollRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (poll, error) = await _pollService.CreatePollAsync(
            userId.Value, request.Title, request.Description, request.PollType,
            request.Options, request.IsAnonymous, request.ShowResultsBeforeClose,
            request.MaxChoices, request.GroupId, request.ClosesAt);

        if (error != null)
            return BadRequest(new { error });

        return CreatedAtAction(nameof(GetPoll), new { id = poll!.Id }, new
        {
            id = poll.Id,
            title = poll.Title,
            poll_type = poll.PollType,
            status = poll.Status,
            created_at = poll.CreatedAt
        });
    }

    /// <summary>
    /// POST /api/polls/{id}/vote - Cast a vote.
    /// </summary>
    [HttpPost("api/polls/{id:int}/vote")]
    public async Task<IActionResult> Vote(int id, [FromBody] VotePollRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (success, error) = await _pollService.VoteAsync(id, userId.Value, request.OptionIds, request.Ranks);

        if (!success)
            return BadRequest(new { error });

        return Ok(new { message = "Vote recorded" });
    }

    /// <summary>
    /// GET /api/polls/{id}/results - Get poll results.
    /// </summary>
    [HttpGet("api/polls/{id:int}/results")]
    public async Task<IActionResult> GetResults(int id)
    {
        var userId = User.GetUserId();
        var (results, notFound, forbidden) = await _pollService.GetPollResultsAsync(id, userId);
        if (notFound) return NotFound(results);
        if (forbidden) return StatusCode(403, results);
        return Ok(results);
    }

    /// <summary>
    /// PUT /api/polls/{id}/close - Close a poll (creator only).
    /// </summary>
    [HttpPut("api/polls/{id:int}/close")]
    public async Task<IActionResult> ClosePoll(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (success, error) = await _pollService.ClosePollAsync(id, userId.Value);

        if (!success)
            return BadRequest(new { error });

        return Ok(new { message = "Poll closed" });
    }
}

#region Request DTOs

public class CreatePollRequest
{
    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("poll_type")]
    public string PollType { get; set; } = "single";

    [JsonPropertyName("options")]
    public List<string> Options { get; set; } = new();

    [JsonPropertyName("is_anonymous")]
    public bool IsAnonymous { get; set; }

    [JsonPropertyName("show_results_before_close")]
    public bool ShowResultsBeforeClose { get; set; } = true;

    [JsonPropertyName("max_choices")]
    public int? MaxChoices { get; set; }

    [JsonPropertyName("group_id")]
    public int? GroupId { get; set; }

    [JsonPropertyName("closes_at")]
    public DateTime? ClosesAt { get; set; }
}

public class VotePollRequest
{
    [JsonPropertyName("option_ids")]
    public List<int> OptionIds { get; set; } = new();

    [JsonPropertyName("ranks")]
    public List<int>? Ranks { get; set; }
}

#endregion
