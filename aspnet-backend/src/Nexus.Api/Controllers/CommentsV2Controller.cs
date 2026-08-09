// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/comments")]
[Authorize]
public class CommentsV2Controller : ControllerBase
{
    private static readonly HashSet<string> LaravelCommentableTargetTypes = new(StringComparer.Ordinal)
    {
        "post",
        "listing",
        "event",
        "goal",
        "poll",
        "review",
        "volunteer",
        "challenge",
        "resource",
        "job",
        "blog",
        "discussion"
    };

    private readonly NexusDbContext _db;
    private readonly ThreadedCommentService _commentService;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<CommentsV2Controller> _logger;

    public CommentsV2Controller(
        NexusDbContext db,
        ThreadedCommentService commentService,
        TenantContext tenantContext,
        ILogger<CommentsV2Controller> logger)
    {
        _db = db;
        _commentService = commentService;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    [HttpGet]
    public async Task<IActionResult> List([FromQuery] string target_type, [FromQuery] int target_id,
        [FromQuery] int page = 1, [FromQuery] int limit = 20)
    {
        if (page < 1) page = 1;
        limit = Math.Clamp(limit, 1, 100);
        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });
        if (string.IsNullOrWhiteSpace(target_type) || target_id <= 0)
            return IsLaravelV2Request()
                ? LaravelError("VALIDATION_REQUIRED_FIELD", "target_type and target_id are required.", null, StatusCodes.Status400BadRequest)
                : BadRequest(new { error = "target_type is required" });

        var normalizedType = ThreadedCommentService.NormalizeTargetType(target_type);
        if (IsLaravelV2Request() && (!LaravelCommentableTargetTypes.Contains(normalizedType) || !await TargetExistsAsync(normalizedType, target_id)))
        {
            return LaravelError("RESOURCE_NOT_FOUND", "Target not found.", null, StatusCodes.Status404NotFound);
        }

        var (comments, total) = await _commentService.GetCommentsAsync(
            _tenantContext.TenantId.Value, normalizedType, target_id, page, limit);

        if (IsLaravelV2Request())
        {
            var commentIds = FlattenComments(comments).Select(c => c.Id).ToArray();
            var reactionCounts = await LoadReactionCountsAsync(commentIds);
            var userReactions = await LoadUserReactionsAsync(commentIds, User.GetUserId());
            var mapped = comments.Select(c => MapLaravelComment(c, reactionCounts, userReactions)).ToList();

            return LaravelData(new
            {
                comments = mapped,
                count = commentIds.Length
            });
        }

        return Ok(new
        {
            data = comments.Select(MapComment),
            pagination = new { page, limit, total, pages = (int)Math.Ceiling((double)total / limit) }
        });
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var comment = await _commentService.GetCommentAsync(id);
        if (comment == null) return NotFound(new { error = "Comment not found" });
        return Ok(MapComment(comment));
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateCommentRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        if (!_tenantContext.TenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var normalizedType = ThreadedCommentService.NormalizeTargetType(request.TargetType);
        if (IsLaravelV2Request())
        {
            if (string.IsNullOrWhiteSpace(normalizedType) || request.TargetId <= 0)
            {
                return LaravelError("VALIDATION_REQUIRED_FIELD", "target_type and target_id are required.", null, StatusCodes.Status400BadRequest);
            }

            if (string.IsNullOrWhiteSpace(request.Content))
            {
                return LaravelError("VALIDATION_REQUIRED_FIELD", "Comment text is required.", "content", StatusCodes.Status400BadRequest);
            }

            if (request.Content.Length > 10000)
            {
                return LaravelError("VALIDATION_INVALID_VALUE", "Comment is too long.", "content", StatusCodes.Status422UnprocessableEntity);
            }

            if (!LaravelCommentableTargetTypes.Contains(normalizedType) || !await TargetExistsAsync(normalizedType, request.TargetId))
            {
                return LaravelError("RESOURCE_NOT_FOUND", "Target not found.", null, StatusCodes.Status404NotFound);
            }
        }

        var (comment, error) = await _commentService.CreateCommentAsync(
            _tenantContext.TenantId.Value, userId.Value, normalizedType,
            request.TargetId, request.ParentId, request.Content);
        if (error != null)
        {
            return IsLaravelV2Request()
                ? LaravelError("VALIDATION_ERROR", error, null, StatusCodes.Status422UnprocessableEntity)
                : BadRequest(new { error });
        }

        if (IsLaravelV2Request())
        {
            return LaravelData(MapLaravelComment(comment!, new Dictionary<int, Dictionary<string, int>>(), new Dictionary<int, string[]>()), StatusCodes.Status201Created);
        }

        return CreatedAtAction(nameof(Get), new { id = comment!.Id }, MapComment(comment));
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateCommentRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var (comment, error) = await _commentService.UpdateCommentAsync(id, userId.Value, request.Content);
        if (error == "Comment not found")
            return IsLaravelV2Request() ? LaravelError("RESOURCE_FORBIDDEN", "Cannot edit comment.", null, StatusCodes.Status403Forbidden) : NotFound(new { error });
        if (error == "You can only edit your own comments")
            return IsLaravelV2Request() ? LaravelError("RESOURCE_FORBIDDEN", "Cannot edit comment.", null, StatusCodes.Status403Forbidden) : StatusCode(403, new { error });
        if (error != null)
            return IsLaravelV2Request() ? LaravelError("VALIDATION_REQUIRED_FIELD", error, "content", StatusCodes.Status400BadRequest) : BadRequest(new { error });

        if (IsLaravelV2Request())
        {
            return LaravelData(new
            {
                id = comment!.Id,
                content = comment.Content,
                edited = true
            });
        }

        return Ok(MapComment(comment!));
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var isAdmin = User.IsAdmin();
        if (IsLaravelV2Request())
        {
            var deletedCount = await _commentService.DeleteCommentTreeAsync(id, userId.Value, isAdmin);
            if (deletedCount == 0) return LaravelError("RESOURCE_FORBIDDEN", "Cannot delete comment.", null, StatusCodes.Status403Forbidden);
            if (deletedCount < 0) return LaravelError("RESOURCE_FORBIDDEN", "Cannot delete comment.", null, StatusCodes.Status403Forbidden);

            return LaravelData(new { deleted = true, id, deleted_count = deletedCount });
        }

        var (success, error) = await _commentService.DeleteCommentAsync(id, userId.Value, isAdmin);
        if (error == "Comment not found") return NotFound(new { error });
        if (error == "You can only delete your own comments") return StatusCode(403, new { error });
        if (!success) return BadRequest(new { error });
        return Ok(new { message = "Comment deleted" });
    }

    private static object MapComment(Nexus.Api.Entities.ThreadedComment c) => new
    {
        id = c.Id, target_type = c.TargetType, target_id = c.TargetId,
        parent_id = c.ParentId, content = c.Content,
        is_edited = c.IsEdited, is_deleted = c.IsDeleted,
        author = c.Author != null ? new { id = c.Author.Id, first_name = c.Author.FirstName, last_name = c.Author.LastName } : null,
        replies = c.Replies.Where(r => !r.IsDeleted).Select(MapComment),
        reply_count = c.Replies.Count(r => !r.IsDeleted),
        created_at = c.CreatedAt, updated_at = c.UpdatedAt
    };

    private object MapLaravelComment(
        ThreadedComment c,
        IReadOnlyDictionary<int, Dictionary<string, int>> reactionCounts,
        IReadOnlyDictionary<int, string[]> userReactions)
    {
        var name = c.Author == null ? "Unknown user" : $"{c.Author.FirstName} {c.Author.LastName}".Trim();
        if (string.IsNullOrWhiteSpace(name)) name = c.Author?.Email ?? "Unknown user";

        return new
        {
            id = c.Id,
            content = c.Content,
            created_at = c.CreatedAt,
            edited = c.IsEdited,
            is_own = c.AuthorId == User.GetUserId(),
            author = new
            {
                id = c.AuthorId,
                name,
                avatar = c.Author?.AvatarUrl
            },
            reactions = reactionCounts.TryGetValue(c.Id, out var counts) ? counts : new Dictionary<string, int>(),
            user_reactions = userReactions.TryGetValue(c.Id, out var mine) ? mine : Array.Empty<string>(),
            replies = c.Replies.Where(r => !r.IsDeleted).OrderBy(r => r.CreatedAt).Select(r => MapLaravelComment(r, reactionCounts, userReactions))
        };
    }

    private static IReadOnlyList<ThreadedComment> FlattenComments(IEnumerable<ThreadedComment> comments)
    {
        var rows = new List<ThreadedComment>();
        foreach (var comment in comments)
        {
            rows.Add(comment);
            rows.AddRange(FlattenComments(comment.Replies.Where(r => !r.IsDeleted)));
        }

        return rows;
    }

    private async Task<Dictionary<int, Dictionary<string, int>>> LoadReactionCountsAsync(IEnumerable<int> commentIds)
    {
        var ids = commentIds.Distinct().ToArray();
        if (ids.Length == 0) return new Dictionary<int, Dictionary<string, int>>();

        var rows = await _db.CommentReactions
            .Where(r => ids.Contains(r.CommentId))
            .GroupBy(r => new { r.CommentId, r.ReactionType })
            .Select(g => new { g.Key.CommentId, g.Key.ReactionType, Count = g.Count() })
            .ToListAsync();

        return rows
            .GroupBy(r => r.CommentId)
            .ToDictionary(
                g => g.Key,
                g => g.ToDictionary(r => r.ReactionType, r => r.Count));
    }

    private async Task<Dictionary<int, string[]>> LoadUserReactionsAsync(IEnumerable<int> commentIds, int? userId)
    {
        if (!userId.HasValue) return new Dictionary<int, string[]>();
        var ids = commentIds.Distinct().ToArray();
        if (ids.Length == 0) return new Dictionary<int, string[]>();

        var rows = await _db.CommentReactions
            .Where(r => ids.Contains(r.CommentId) && r.UserId == userId.Value)
            .Select(r => new { r.CommentId, r.ReactionType })
            .ToListAsync();

        return rows
            .GroupBy(r => r.CommentId)
            .ToDictionary(g => g.Key, g => g.Select(r => r.ReactionType).ToArray());
    }

    private async Task<bool> TargetExistsAsync(string targetType, int targetId)
    {
        var tenantId = _tenantContext.TenantId;
        if (!tenantId.HasValue) return false;

        return targetType switch
        {
            "post" => await _db.FeedPosts.AnyAsync(p => p.TenantId == tenantId && p.Id == targetId && !p.IsHidden),
            "listing" => await _db.Listings.AnyAsync(l => l.TenantId == tenantId && l.Id == targetId),
            "event" => await _db.Events.AnyAsync(e => e.TenantId == tenantId && e.Id == targetId && !e.IsCancelled),
            "goal" => await _db.Goals.AnyAsync(g => g.TenantId == tenantId && g.Id == targetId),
            "poll" => await _db.Polls.AnyAsync(p => p.TenantId == tenantId && p.Id == targetId),
            "review" => await _db.Reviews.AnyAsync(r => r.TenantId == tenantId && r.Id == targetId),
            "volunteer" => await _db.VolunteerOpportunities.AnyAsync(v => v.TenantId == tenantId && v.Id == targetId),
            "challenge" => await _db.Challenges.AnyAsync(c => c.TenantId == tenantId && c.Id == targetId),
            "resource" => await _db.Resources.AnyAsync(r => r.TenantId == tenantId && r.Id == targetId),
            "job" => await _db.JobVacancies.AnyAsync(j => j.TenantId == tenantId && j.Id == targetId),
            "blog" => await _db.BlogPosts.AnyAsync(b => b.TenantId == tenantId && b.Id == targetId),
            "discussion" => await _db.GroupDiscussions.AnyAsync(d => d.TenantId == tenantId && d.Id == targetId),
            _ => false
        };
    }

    private IActionResult LaravelData(object data, int status = StatusCodes.Status200OK)
    {
        return StatusCode(status, new
        {
            data,
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    private IActionResult LaravelError(string code, string message, string? field, int status)
    {
        object error = field == null
            ? new { code, message }
            : new { code, message, field };

        return StatusCode(status, new
        {
            errors = new[] { error },
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    private bool IsLaravelV2Request() => Request.Path.StartsWithSegments("/api/v2");

    public class CreateCommentRequest
    {
        [JsonPropertyName("target_type")] public string TargetType { get; set; } = string.Empty;
        [JsonPropertyName("target_id")] public int TargetId { get; set; }
        [JsonPropertyName("parent_id")] public int? ParentId { get; set; }
        [JsonPropertyName("content")] public string Content { get; set; } = string.Empty;
    }

    public class UpdateCommentRequest
    {
        [JsonPropertyName("content")] public string Content { get; set; } = string.Empty;
    }

}
