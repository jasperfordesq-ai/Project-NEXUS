// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;
using System.Text;
using System.Security.Cryptography;
using System.Globalization;
using System.Data;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Middleware;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Compatibility routes for V1.5 member-facing social/feed/notification clusters.
/// </summary>
[ApiController]
[Authorize]
public class V15SocialCompatibilityController : ControllerBase
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private static readonly JsonSerializerOptions StoreJsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true
    };
    private static readonly HashSet<string> LaravelFeedTrackingTargetTypes = new(StringComparer.Ordinal)
    {
        "post",
        "comment",
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
    private static readonly HashSet<string> LaravelFeedHideTargetTypes = new(StringComparer.Ordinal)
    {
        "post",
        "listing",
        "event",
        "poll",
        "goal",
        "review",
        "job",
        "challenge",
        "volunteer",
        "resource",
        "blog",
        "discussion"
    };
    private static readonly HashSet<string> LaravelShareableTargetTypes = new(StringComparer.Ordinal)
    {
        "post",
        "listing",
        "event",
        "poll",
        "job",
        "blog",
        "discussion",
        "goal",
        "challenge",
        "volunteer"
    };
    private static readonly string[] LaravelNotificationPreferenceKeys =
    [
        "email_messages",
        "email_listings",
        "email_digest",
        "email_connections",
        "email_transactions",
        "email_reviews",
        "email_gamification_digest",
        "email_gamification_milestones",
        "email_org_payments",
        "email_org_transfers",
        "email_org_membership",
        "email_org_admin",
        "caring_smart_nudges",
        "email_events",
        "push_enabled",
        "push_campaigns_opted_in"
    ];
    private static readonly IReadOnlyDictionary<string, bool> LaravelNotificationPreferenceDefaults = new Dictionary<string, bool>
    {
        ["email_messages"] = true,
        ["email_listings"] = true,
        ["email_digest"] = false,
        ["email_connections"] = true,
        ["email_transactions"] = true,
        ["email_reviews"] = true,
        ["email_gamification_digest"] = true,
        ["email_gamification_milestones"] = true,
        ["email_org_payments"] = true,
        ["email_org_transfers"] = true,
        ["email_org_membership"] = true,
        ["email_org_admin"] = true,
        ["caring_smart_nudges"] = true,
        ["email_events"] = true,
        ["push_enabled"] = true,
        ["push_campaigns_opted_in"] = false,
        ["federation_notifications_enabled"] = true
    };

    private const string SupportReportsKey = "admin_explicit.support_reports";
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly PushNotificationService _pushService;
    private readonly IConfiguration _configuration;
    private readonly ISocialCommentContactPolicy _socialCommentContactPolicy;

    public V15SocialCompatibilityController(
        NexusDbContext db,
        TenantContext tenantContext,
        PushNotificationService pushService,
        IConfiguration configuration,
        ISocialCommentContactPolicy socialCommentContactPolicy)
    {
        _db = db;
        _tenantContext = tenantContext;
        _pushService = pushService;
        _configuration = configuration;
        _socialCommentContactPolicy = socialCommentContactPolicy;
    }

    [HttpGet("/api/v2/feed")]
    public async Task<IActionResult> Feed([FromQuery] int page = 1, [FromQuery] int limit = 20)
    {
        var userId = RequireUserId();
        var safePage = Math.Max(page, 1);
        var safeLimit = Math.Clamp(limit, 1, 100);
        var hidden = _db.HiddenPosts.Where(h => h.UserId == userId).Select(h => h.PostId);
        var muted = _db.MutedUsers.Where(m => m.UserId == userId).Select(m => m.MutedUserId);
        var postQuery = _db.FeedPosts
            .AsNoTracking()
            .Where(p => !p.IsHidden && !hidden.Contains(p.Id) && !muted.Contains(p.UserId));
        var activityQuery =
            from activity in _db.FeedActivities.AsNoTracking()
            join author in _db.Users.AsNoTracking()
                on new { activity.TenantId, activity.UserId }
                equals new { author.TenantId, UserId = author.Id }
            where activity.SourceType != FeedActivitySourceTypes.Post
                && activity.IsVisible
                && !activity.IsHidden
                && !muted.Contains(activity.UserId)
            select new FeedPageCandidate
            {
                IsFeedPost = false,
                SortId = activity.Id,
                SourceId = activity.SourceId,
                SourceType = activity.SourceType,
                Title = activity.Title,
                Content = activity.Content,
                ImageUrl = activity.ImageUrl,
                GroupId = activity.GroupId,
                UserId = activity.UserId,
                AuthorId = author.Id,
                AuthorName = (author.FirstName + " " + author.LastName).Trim(),
                AuthorAvatarUrl = author.AvatarUrl,
                Metadata = activity.Metadata,
                CreatedAt = activity.CreatedAt
            };

        var postTotal = await postQuery.CountAsync();
        var activityTotal = await activityQuery.CountAsync();
        var total = postTotal + activityTotal;
        var pageOffset = (long)(safePage - 1) * safeLimit;
        if (pageOffset >= total)
        {
            return Ok(new { data = Array.Empty<object>(), meta = PageMeta(safePage, safeLimit, total) });
        }

        // Pull only enough rows from each source to construct the requested
        // merged page. A row below this prefix in either source cannot enter the
        // same-sized prefix after the two ordered sequences are merged.
        var fetchCount = (int)Math.Min(pageOffset + safeLimit, total);
        var posts = await postQuery
            .OrderByDescending(p => p.IsPinned)
            .ThenByDescending(p => p.CreatedAt)
            .ThenByDescending(p => p.Id)
            .Take(fetchCount)
            .Select(p => new FeedPageCandidate
            {
                IsFeedPost = true,
                IsPinned = p.IsPinned,
                SortId = p.Id,
                SourceId = p.Id,
                SourceType = FeedActivitySourceTypes.Post,
                Content = p.Content,
                ImageUrl = p.ImageUrl,
                GroupId = p.GroupId,
                UserId = p.UserId,
                AuthorId = p.User == null ? null : p.User.Id,
                AuthorName = p.User == null ? null : (p.User.FirstName + " " + p.User.LastName).Trim(),
                AuthorAvatarUrl = p.User == null ? null : p.User.AvatarUrl,
                LikesCount = p.Likes.Count,
                CommentsCount = p.Comments.Count,
                IsLiked = p.Likes.Any(l => l.UserId == userId),
                CreatedAt = p.CreatedAt,
                UpdatedAt = p.UpdatedAt
            })
            .ToListAsync();

        var activities = await activityQuery
            .OrderByDescending(activity => activity.CreatedAt)
            .ThenByDescending(activity => activity.SortId)
            .Take(fetchCount)
            .ToListAsync();

        var data = posts
            .Concat(activities)
            .OrderByDescending(candidate => candidate.IsPinned)
            .ThenByDescending(candidate => candidate.CreatedAt)
            .ThenByDescending(candidate => candidate.SortId)
            .ThenBy(candidate => candidate.SourceType, StringComparer.Ordinal)
            .Skip((int)pageOffset)
            .Take(safeLimit)
            .Select(MapFeedPageCandidate)
            .ToList();

        return Ok(new { data, meta = PageMeta(safePage, safeLimit, total) });
    }

    [HttpPost("/api/social/feed")]
    public Task<IActionResult> LegacyFeed([FromBody] JsonElement _) => Feed(1, 20);

    [HttpGet("/api/v2/feed/posts/{id:int}")]
    [HttpGet("/api/v2/feed/items/post/{id:int}")]
    public async Task<IActionResult> ShowPost(int id)
    {
        var userId = RequireUserId();
        var post = await _db.FeedPosts
            .Where(p => p.Id == id && !p.IsHidden)
            .Select(p => new
            {
                id = p.Id,
                type = "post",
                content = p.Content,
                image_url = p.ImageUrl,
                group_id = p.GroupId,
                user_id = p.UserId,
                author = p.User == null ? null : new { id = p.User.Id, name = (p.User.FirstName + " " + p.User.LastName).Trim(), avatar_url = p.User.AvatarUrl },
                likes_count = p.Likes.Count,
                comments_count = p.Comments.Count,
                shares_count = _db.PostShares.Count(s => s.PostId == p.Id),
                is_liked = p.Likes.Any(l => l.UserId == userId),
                created_at = p.CreatedAt,
                updated_at = p.UpdatedAt
            })
            .FirstOrDefaultAsync();

        return post == null ? NotFound(new { error = "Post not found" }) : Ok(new { data = post });
    }

    [HttpGet("/api/v2/feed/items/{type}/{id:int}")]
    public IActionResult ShowFeedItem(string type, int id)
    {
        return type.Equals("post", StringComparison.OrdinalIgnoreCase)
            ? RedirectToAction(nameof(ShowPost), new { id })
            : NotFound(new { error = "Feed item type not supported" });
    }

    [HttpPost("/api/social/create-post")]
    [HttpPost("/api/v2/feed/posts")]
    public async Task<IActionResult> CreatePost([FromBody] JsonElement body)
    {
        var content = ReadString(body, "content", "body", "message", "text")?.Trim();
        if (string.IsNullOrWhiteSpace(content)) return BadRequest(new { error = "content is required" });
        var post = new FeedPost
        {
            TenantId = TenantId(),
            UserId = RequireUserId(),
            GroupId = ReadInt(body, "group_id", "groupId"),
            Content = content,
            ImageUrl = ReadString(body, "image_url", "imageUrl")
        };

        _db.FeedPosts.Add(post);
        await _db.SaveChangesAsync();
        return Created($"/api/v2/feed/posts/{post.Id}", new { success = true, data = post });
    }

    [HttpPut("/api/v2/feed/posts/{id:int}")]
    public async Task<IActionResult> UpdatePost(int id, [FromBody] JsonElement body)
    {
        var userId = RequireUserId();
        var post = await _db.FeedPosts.FirstOrDefaultAsync(p => p.Id == id && p.UserId == userId);
        if (post == null) return NotFound(new { error = "Post not found" });
        var content = ReadString(body, "content", "body", "message", "text");
        if (!string.IsNullOrWhiteSpace(content)) post.Content = content.Trim();
        var imageUrl = ReadString(body, "image_url", "imageUrl");
        if (imageUrl != null) post.ImageUrl = imageUrl;
        post.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = post });
    }

    [HttpDelete("/api/v2/feed/posts/{id:int}")]
    [HttpPost("/api/v2/feed/posts/{id:int}/delete")]
    public async Task<IActionResult> DeletePost(int id)
    {
        var tenantId = TenantId();
        var userId = RequireUserId();
        var post = await _db.FeedPosts.FirstOrDefaultAsync(p => p.TenantId == tenantId && p.Id == id);
        if (post == null)
        {
            return NotFound(new
            {
                success = false,
                errors = new[]
                {
                    new { code = "RESOURCE_NOT_FOUND", message = "Post not found." }
                }
            });
        }

        if (post.UserId != userId)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                success = false,
                errors = new[]
                {
                    new { code = "FORBIDDEN", message = "You can only delete your own posts." }
                }
            });
        }

        _db.FeedPosts.Remove(post);
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = new { deleted = true, id } });
    }

    [HttpPost("/api/social/delete")]
    public Task<IActionResult> DeletePostLegacy([FromBody] JsonElement body) => DeletePost(ReadRequiredInt(body, "id", "post_id", "postId"));

    [HttpPost("/api/social/like")]
    [HttpPost("/api/v2/feed/like")]
    public async Task<IActionResult> ToggleLike([FromBody] JsonElement body)
    {
        var targetType = ReadString(body, "target_type", "type")?.Trim().ToLowerInvariant();
        var targetId = ReadInt(body, "target_id", "post_id", "postId", "id") ?? 0;

        if (string.IsNullOrWhiteSpace(targetType))
        {
            targetType = "post";
        }

        if (targetType == "volunteering")
        {
            targetType = "volunteer";
        }

        if (targetId <= 0)
        {
            return BadRequest(new
            {
                errors = new[]
                {
                    new { code = "VALIDATION_ERROR", message = "Target is required.", field = "target_id" }
                }
            });
        }

        if (!LaravelFeedTrackingTargetTypes.Contains(targetType))
        {
            return BadRequest(new
            {
                errors = new[]
                {
                    new { code = "VALIDATION_ERROR", message = "Invalid target type.", field = "target_type" }
                }
            });
        }

        if (!await FeedTrackingTargetExistsAsync(targetType, targetId))
        {
            return NotFound(new
            {
                errors = new[]
                {
                    new { code = "NOT_FOUND", message = "Target not found." }
                }
            });
        }

        return targetType == "post"
            ? await TogglePostLike(targetId)
            : await ToggleGenericLike(targetType, targetId);
    }

    [HttpPost("/api/v2/feed/posts/{id:int}/hide")]
    [HttpPost("/api/feed/hide")]
    public Task<IActionResult> HidePost(int? id, [FromBody] JsonElement body) =>
        HideFeedItem(id, body, includeHiddenFlag: true);

    [HttpPost("/api/v2/feed/posts/{id:int}/not-interested")]
    public Task<IActionResult> NotInterested(int id, [FromBody] JsonElement body) =>
        HideFeedItem(id, body, includeHiddenFlag: false);

    [HttpPost("/api/v2/feed/users/{id:int}/mute")]
    public async Task<IActionResult> MuteUserV2(int id)
    {
        return await MuteUserCore(id);
    }

    [HttpPost("/api/feed/mute")]
    public async Task<IActionResult> MuteUser([FromBody] JsonElement body)
    {
        return await MuteUserCore(ReadRequiredInt(body, "muted_user_id", "user_id", "id"));
    }

    [HttpPost("/api/feed/report")]
    [HttpPost("/api/v2/feed/posts/{id:int}/report")]
    [HttpPost("/api/v2/feed/items/post/{id:int}/report")]
    public Task<IActionResult> ReportPost(int? id, [FromBody] JsonElement body) =>
        ReportFeedTarget(
            NormalizeLegacyFeedReportType(ReadString(body, "target_type", "type")),
            id ?? ReadRequiredInt(body, "post_id", "postId", "target_id", "id"),
            body);

    [HttpPost("/api/v2/feed/items/{type}/{id:int}/report")]
    public Task<IActionResult> ReportFeedItem(string type, int id, [FromBody] JsonElement body) =>
        ReportFeedTarget(NormalizeLegacyFeedReportType(type), id, body);

    [HttpPost("/api/social/comments")]
    public async Task<IActionResult> Comments([FromBody] JsonElement body)
    {
        var action = ReadString(body, "action")?.Trim().ToLowerInvariant();
        var rawTargetType = ReadString(body, "target_type", "type");
        if (!string.IsNullOrWhiteSpace(action) || !string.IsNullOrWhiteSpace(rawTargetType))
        {
            var targetType = ThreadedCommentService.NormalizeTargetType(rawTargetType);
            var targetId = ReadInt(body, "target_id", "post_id", "postId", "id") ?? 0;
            if (string.IsNullOrWhiteSpace(targetType) || targetId <= 0)
            {
                return BadRequest(new
                {
                    errors = new[] { new { code = "VALIDATION_ERROR", message = "Invalid target." } }
                });
            }

            return action switch
            {
                "fetch" or "fetch_comments" => await LegacySocialCommentsFetch(targetType, targetId),
                "submit" or "submit_comment" => await LegacySocialCommentsSubmit(body, targetType, targetId),
                _ => BadRequest(new
                {
                    errors = new[] { new { code = "INVALID_INPUT", message = "Invalid action.", field = "action" } }
                })
            };
        }

        var postId = ReadRequiredInt(body, "post_id", "postId", "id");
        var data = await _db.PostComments
            .Where(c => c.PostId == postId && c.ParentCommentId == null)
            .OrderBy(c => c.CreatedAt)
            .Select(c => MapComment(c))
            .ToListAsync();
        return Ok(new { data });
    }

    [HttpPost("/api/social/reply")]
    public async Task<IActionResult> Reply([FromBody] JsonElement body)
    {
        var content = LaravelHtmlSanitizer.Sanitize(
            ReadString(body, "content", "body", "comment", "message")?.Trim() ?? string.Empty);
        if (string.IsNullOrWhiteSpace(content)) return BadRequest(new { error = "content is required" });
        var comment = new PostComment
        {
            TenantId = TenantId(),
            PostId = ReadRequiredInt(body, "post_id", "postId"),
            ParentCommentId = ReadInt(body, "parent_id", "parent_comment_id", "comment_id"),
            UserId = RequireUserId(),
            Content = content
        };

        _db.PostComments.Add(comment);
        await _db.SaveChangesAsync();
        return Created($"/api/v2/feed/posts/{comment.PostId}", new { success = true, data = comment });
    }

    [HttpPost("/api/social/edit-comment")]
    public async Task<IActionResult> EditComment([FromBody] JsonElement body)
    {
        var comment = await _db.PostComments.FirstOrDefaultAsync(c => c.Id == ReadRequiredInt(body, "id", "comment_id") && c.UserId == RequireUserId());
        if (comment == null) return NotFound(new { error = "Comment not found" });
        var content = ReadString(body, "content", "body", "comment", "message")?.Trim();
        if (!string.IsNullOrWhiteSpace(content)) comment.Content = content;
        comment.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = comment });
    }

    [HttpPost("/api/social/delete-comment")]
    public async Task<IActionResult> DeleteComment([FromBody] JsonElement body)
    {
        var comment = await _db.PostComments.FirstOrDefaultAsync(c => c.Id == ReadRequiredInt(body, "id", "comment_id") && c.UserId == RequireUserId());
        if (comment == null) return NotFound(new { error = "Comment not found" });
        _db.PostComments.Remove(comment);
        await _db.SaveChangesAsync();
        return Ok(new { success = true });
    }

    [HttpPost("/api/social/reaction")]
    [HttpPost("/api/v2/posts/{id:int}/reactions")]
    public async Task<IActionResult> ToggleReaction(int? id, [FromBody] JsonElement body)
    {
        if (id == null && (ReadInt(body, "comment_id") is > 0 || ReadInt(body, "target_id") is > 0))
        {
            return await ToggleLegacyCommentReaction(body);
        }

        var postId = id ?? ReadRequiredInt(body, "post_id", "postId", "id");
        var type = ReadString(body, "type", "reaction", "reaction_type") ?? PostReaction.Types.Like;
        if (!PostReaction.Types.All.Contains(type)) return BadRequest(new { error = "Unsupported reaction type" });
        var userId = RequireUserId();
        var existing = await _db.PostReactions.FirstOrDefaultAsync(r => r.PostId == postId && r.UserId == userId);
        if (existing != null && existing.ReactionType == type)
        {
            _db.PostReactions.Remove(existing);
        }
        else if (existing != null)
        {
            existing.ReactionType = type;
        }
        else
        {
            _db.PostReactions.Add(new PostReaction { TenantId = TenantId(), PostId = postId, UserId = userId, ReactionType = type });
        }

        await _db.SaveChangesAsync();
        return Ok(await ReactionSummary(postId));
    }

    [HttpGet("/api/v2/posts/{id:int}/reactions")]
    public async Task<IActionResult> Reactions(int id) => Ok(await ReactionSummary(id));

    [HttpGet("/api/v2/posts/{id:int}/reactions/{type}/users")]
    public async Task<IActionResult> Reactors(int id, string type)
    {
        var users = await _db.PostReactions
            .Where(r => r.PostId == id && r.ReactionType == type)
            .Select(r => new { id = r.UserId, name = r.User == null ? null : (r.User.FirstName + " " + r.User.LastName).Trim(), avatar_url = r.User == null ? null : r.User.AvatarUrl })
            .ToListAsync();
        return Ok(new { data = users });
    }

    [HttpPost("/api/social/share")]
    [HttpPost("/api/v2/feed/posts/{id:int}/share")]
    public async Task<IActionResult> SharePost(int? id, [FromBody] JsonElement body)
    {
        var postId = id ?? ReadRequiredInt(body, "post_id", "postId", "id");
        return await ToggleLaravelShareAsync("post", postId, ReadString(body, "comment"));
    }

    [HttpPost("/api/v2/shares")]
    public async Task<IActionResult> Share([FromBody] JsonElement body)
    {
        var type = ReadString(body, "type")?.Trim() ?? string.Empty;
        var id = ReadInt(body, "id") ?? 0;
        var comment = ReadString(body, "comment");
        if (string.IsNullOrWhiteSpace(type) || id <= 0)
        {
            return LaravelShareError("INVALID_INPUT", "Invalid input.", 422);
        }

        return await ToggleLaravelShareAsync(type, id, comment);
    }

    [HttpDelete("/api/v2/feed/posts/{id:int}/share")]
    public async Task<IActionResult> UnsharePost(int id)
    {
        return await UnshareLaravelTargetAsync("post", id);
    }

    [HttpDelete("/api/v2/shares")]
    public async Task<IActionResult> Unshare([FromBody] JsonElement body)
    {
        var type = ReadString(body, "type")?.Trim() ?? string.Empty;
        var id = ReadInt(body, "id") ?? 0;
        if (string.IsNullOrWhiteSpace(type) || id <= 0)
        {
            return LaravelShareError("INVALID_INPUT", "Invalid input.", 422);
        }

        return await UnshareLaravelTargetAsync(type, id);
    }

    [HttpGet("/api/v2/feed/posts/{id:int}/sharers")]
    public async Task<IActionResult> Sharers(int id)
    {
        var type = Request.Query.TryGetValue("type", out var rawType) && LaravelShareableTargetTypes.Contains(rawType.ToString())
            ? rawType.ToString()
            : "post";

        if (!await FeedTrackingTargetExistsAsync(type, id))
        {
            return LaravelShareError("NOT_FOUND", "Target not found.", 404);
        }

        var userId = User.GetUserId();
        var shareCount = await ShareCountAsync(type, id);
        var sharers = await _db.PostShares
            .Where(s => s.OriginalType == type && s.OriginalPostId == id)
            .OrderByDescending(s => s.CreatedAt)
            .Take(20)
            .Select(s => new
            {
                id = s.UserId,
                first_name = s.User == null ? null : s.User.FirstName,
                last_name = s.User == null ? null : s.User.LastName,
                name = s.User == null ? null : (s.User.FirstName + " " + s.User.LastName).Trim(),
                avatar_url = s.User == null ? null : s.User.AvatarUrl,
                comment = s.Comment,
                created_at = s.CreatedAt
            })
            .ToListAsync();
        return LaravelShareData(new
        {
            sharers,
            share_count = shareCount,
            has_shared = userId.HasValue && await _db.PostShares.AnyAsync(s => s.UserId == userId.Value && s.OriginalType == type && s.OriginalPostId == id),
            type,
            id
        });
    }

    [HttpPost("/api/social/likers")]
    public async Task<IActionResult> Likers([FromBody] JsonElement body)
    {
        _ = RequireUserId();

        var targetType = (ReadString(body, "target_type", "type") ?? "post").Trim().ToLowerInvariant();
        var targetId = ReadInt(body, "target_id", "post_id", "postId", "id") ?? 0;
        var page = Math.Max(1, ReadInt(body, "page") ?? 1);
        var limit = Math.Clamp(ReadInt(body, "limit") ?? 20, 5, 50);
        var offset = (page - 1) * limit;
        var tenantId = TenantId();

        if (string.IsNullOrWhiteSpace(targetType) || targetId <= 0)
        {
            return BadRequest(new
            {
                errors = new[]
                {
                    new
                    {
                        code = "VALIDATION_ERROR",
                        message = "Invalid target."
                    }
                }
            });
        }

        if (!string.Equals(targetType, "post", StringComparison.Ordinal))
        {
            var genericQuery = _db.ContentLikes
                .AsNoTracking()
                .Where(l => l.TenantId == tenantId && l.TargetType == targetType && l.TargetId == targetId)
                .OrderByDescending(l => l.CreatedAt);

            var totalGenericCount = await genericQuery.CountAsync();
            var genericLikerRows = await genericQuery
                .Skip(offset)
                .Take(limit)
                .Select(l => new
                {
                    id = l.UserId,
                    first_name = l.User == null ? null : l.User.FirstName,
                    last_name = l.User == null ? null : l.User.LastName,
                    avatar_url = l.User == null ? null : l.User.AvatarUrl,
                    liked_at = l.CreatedAt
                })
                .ToListAsync();
            var genericLikers = genericLikerRows
                .Select(l => new
                {
                    l.id,
                    name = DisplayName(l.first_name, l.last_name),
                    avatar_url = string.IsNullOrWhiteSpace(l.avatar_url)
                        ? "/assets/img/defaults/default_avatar.png"
                        : l.avatar_url,
                    liked_at = l.liked_at,
                    liked_at_formatted = l.liked_at.ToString("MMM d, yyyy", System.Globalization.CultureInfo.InvariantCulture)
                })
                .ToList();

            return Ok(new
            {
                success = true,
                data = new
                {
                    likers = genericLikers,
                    total_count = totalGenericCount,
                    page,
                    has_more = offset + genericLikers.Count < totalGenericCount
                }
            });
        }

        var query = _db.ContentLikes
            .AsNoTracking()
            .Where(l => l.TenantId == tenantId && l.TargetType == "post" && l.TargetId == targetId)
            .OrderByDescending(l => l.CreatedAt);

        var totalCount = await query.CountAsync();
        var likerRows = await query
            .Skip(offset)
            .Take(limit)
            .Select(l => new
            {
                id = l.UserId,
                first_name = l.User == null ? null : l.User.FirstName,
                last_name = l.User == null ? null : l.User.LastName,
                avatar_url = l.User == null ? null : l.User.AvatarUrl,
                liked_at = l.CreatedAt
            })
            .ToListAsync();
        var likers = likerRows
            .Select(l => new
            {
                l.id,
                name = DisplayName(l.first_name, l.last_name),
                avatar_url = string.IsNullOrWhiteSpace(l.avatar_url)
                    ? "/assets/img/defaults/default_avatar.png"
                    : l.avatar_url,
                liked_at = l.liked_at,
                liked_at_formatted = l.liked_at.ToString("MMM d, yyyy", System.Globalization.CultureInfo.InvariantCulture)
            })
            .ToList();

        return Ok(new
        {
            success = true,
            data = new
            {
                likers,
                total_count = totalCount,
                page,
                has_more = offset + likers.Count < totalCount
            }
        });
    }

    [HttpPost("/api/v2/feed/posts/{id:int}/view")]
    [HttpPost("/api/v2/feed/posts/{id:int}/click")]
    [HttpPost("/api/v2/feed/posts/{id:int}/impression")]
    [HttpPost("/api/v2/feed/click")]
    [HttpPost("/api/v2/feed/impression")]
    public async Task<IActionResult> TrackFeedEvent(int? id, [FromBody] JsonElement body)
    {
        var targetType = id.HasValue
            ? NormalizeLegacyFeedTrackingType(ReadString(body, "type", "target_type"))
            : (ReadString(body, "target_type") ?? "post").Trim();
        var targetId = id ?? ReadInt(body, "target_id", "post_id", "postId", "id") ?? 0;

        if (!LaravelFeedTrackingTargetTypes.Contains(targetType))
        {
            return BadRequest(new
            {
                errors = new[]
                {
                    new
                    {
                        code = "VALIDATION_ERROR",
                        message = "Invalid target type.",
                        field = "target_type"
                    }
                }
            });
        }

        if (targetId <= 0)
        {
            return BadRequest(new
            {
                errors = new[]
                {
                    new
                    {
                        code = "VALIDATION_ERROR",
                        message = "Invalid target.",
                        field = "target_id"
                    }
                }
            });
        }

        if (!await FeedTrackingTargetExistsAsync(targetType, targetId))
        {
            return NotFound(new
            {
                errors = new[]
                {
                    new
                    {
                        code = "RESOURCE_NOT_FOUND",
                        message = "Target not found."
                    }
                }
            });
        }

        return Ok(new
        {
            data = new { recorded = true },
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    [HttpPost("/api/v2/feed/polls")]
    public async Task<IActionResult> CreateFeedPoll([FromBody] JsonElement body)
    {
        var title = ReadString(body, "title", "question")?.Trim();
        if (string.IsNullOrWhiteSpace(title)) return BadRequest(new { error = "title is required" });
        var poll = new Poll
        {
            TenantId = TenantId(),
            CreatedById = RequireUserId(),
            Title = title,
            Description = ReadString(body, "description"),
            PollType = ReadString(body, "poll_type", "type") ?? "single",
            GroupId = ReadInt(body, "group_id", "groupId"),
            ClosesAt = ReadDate(body, "closes_at", "closesAt")
        };

        _db.Polls.Add(poll);
        await _db.SaveChangesAsync();
        return Created($"/api/v2/feed/polls/{poll.Id}", new { data = poll });
    }

    [HttpGet("/api/v2/feed/polls/{id:int}")]
    public async Task<IActionResult> FeedPoll(int id)
    {
        var poll = await _db.Polls.Include(p => p.Options).FirstOrDefaultAsync(p => p.Id == id);
        return poll == null ? NotFound(new { error = "Poll not found" }) : Ok(new { data = poll });
    }

    [HttpPost("/api/v2/feed/polls/{id:int}/vote")]
    public async Task<IActionResult> VoteFeedPoll(int id, [FromBody] JsonElement body)
    {
        var optionId = ReadRequiredInt(body, "option_id", "optionId");
        var userId = RequireUserId();
        var existing = await _db.PollVotes.FirstOrDefaultAsync(v => v.PollId == id && v.OptionId == optionId && v.UserId == userId);
        if (existing == null)
        {
            _db.PollVotes.Add(new PollVote { TenantId = TenantId(), PollId = id, OptionId = optionId, UserId = userId, Rank = ReadInt(body, "rank") });
            await _db.SaveChangesAsync();
        }

        return Ok(new { success = true });
    }

    [HttpPost("/api/v2/posts/{id:int}/media")]
    public IActionResult UploadPostMedia(int id, [FromBody] JsonElement body)
    {
        return Ok(new { success = true, data = new { post_id = id, media = JsonSerializer.Deserialize<object>(body.GetRawText(), JsonOptions) } });
    }

    [HttpPut("/api/v2/posts/{id:int}/media/reorder")]
    public IActionResult ReorderPostMedia(int id, [FromBody] JsonElement body)
    {
        return Ok(new { success = true, post_id = id, order = JsonSerializer.Deserialize<object>(body.GetRawText(), JsonOptions) });
    }

    [HttpDelete("/api/v2/posts/media/{mediaId:int}")]
    public IActionResult DeletePostMedia(int mediaId) => Ok(new { success = true, media_id = mediaId });

    [HttpPut("/api/v2/posts/media/{mediaId:int}/alt")]
    public IActionResult UpdatePostMediaAlt(int mediaId, [FromBody] JsonElement body)
    {
        return Ok(new { success = true, media_id = mediaId, alt = ReadString(body, "alt", "alt_text") });
    }

    [HttpGet("/api/v2/feed/posts/{id:int}/analytics")]
    public async Task<IActionResult> PostAnalytics(int id)
    {
        return Ok(new
        {
            data = new
            {
                post_id = id,
                likes = await _db.PostLikes.CountAsync(l => l.PostId == id),
                comments = await _db.PostComments.CountAsync(c => c.PostId == id),
                reactions = await _db.PostReactions.CountAsync(r => r.PostId == id),
                shares = await _db.PostShares.CountAsync(s => s.PostId == id)
            }
        });
    }

    [HttpGet("/api/v2/feed/posts/scheduled")]
    public async Task<IActionResult> ScheduledPosts()
    {
        var userId = RequireUserId();
        var data = await _db.GroupScheduledPosts.Where(p => p.AuthorUserId == userId && p.Status == "scheduled").OrderBy(p => p.ScheduledFor).ToListAsync();
        return Ok(new { data });
    }

    [HttpGet("/api/v2/groups/{id:int}/scheduled-posts")]
    public async Task<IActionResult> GroupScheduledPosts(int id)
    {
        var data = await _db.GroupScheduledPosts.Where(p => p.GroupId == id).OrderBy(p => p.ScheduledFor).ToListAsync();
        return Ok(new { data });
    }

    [HttpPost("/api/v2/groups/{id:int}/scheduled-posts")]
    public async Task<IActionResult> CreateGroupScheduledPost(int id, [FromBody] JsonElement body)
    {
        var content = ReadString(body, "content", "body")?.Trim();
        if (string.IsNullOrWhiteSpace(content)) return BadRequest(new { error = "content is required" });
        var row = new GroupScheduledPost
        {
            TenantId = TenantId(),
            GroupId = id,
            AuthorUserId = RequireUserId(),
            Content = content,
            ScheduledFor = ReadDate(body, "scheduled_for", "scheduledFor") ?? DateTime.UtcNow
        };

        _db.GroupScheduledPosts.Add(row);
        await _db.SaveChangesAsync();
        return Created($"/api/v2/groups/{id}/scheduled-posts/{row.Id}", new { data = row });
    }

    [HttpDelete("/api/v2/groups/{id:int}/scheduled-posts/{postId:int}")]
    public async Task<IActionResult> CancelGroupScheduledPost(int id, int postId)
    {
        var row = await _db.GroupScheduledPosts.FirstOrDefaultAsync(p => p.Id == postId && p.GroupId == id && p.AuthorUserId == RequireUserId());
        if (row == null) return NotFound(new { error = "Scheduled post not found" });
        row.Status = "cancelled";
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = row });
    }

    [HttpGet("/api/v2/feed/hashtags/trending")]
    public async Task<IActionResult> TrendingHashtags()
    {
        var limit = ReadQueryInt("limit", 20, 1, 50);
        var days = ReadQueryInt("days", 7, 1, 90);
        var since = DateTime.UtcNow.AddDays(-days);
        var data = await _db.Hashtags
            .AsNoTracking()
            .Where(h => h.TenantId == TenantId() && h.UsageCount > 0 && h.LastUsedAt >= since)
            .OrderByDescending(h => h.UsageCount)
            .ThenByDescending(h => h.LastUsedAt)
            .Take(limit)
            .Select(h => new
            {
                id = h.Id,
                tag = h.Tag,
                post_count = h.UsageCount,
                last_used_at = h.LastUsedAt
            })
            .ToListAsync();

        return Ok(new { success = true, data });
    }

    [HttpGet("/api/v2/feed/hashtags/search")]
    public async Task<IActionResult> SearchHashtags([FromQuery] string? q = null)
    {
        var limit = ReadQueryInt("limit", 10, 1, 50);
        var needle = (q ?? string.Empty).Trim().TrimStart('#').Replace("%", string.Empty).Replace("_", string.Empty).ToLowerInvariant();
        if (needle.Length < 1)
        {
            return Ok(new { success = true, data = Array.Empty<object>() });
        }

        var data = await _db.Hashtags
            .AsNoTracking()
            .Where(h => h.TenantId == TenantId() && h.Tag.StartsWith(needle))
            .OrderByDescending(h => h.UsageCount)
            .ThenBy(h => h.Tag)
            .Take(limit)
            .Select(h => new
            {
                id = h.Id,
                tag = h.Tag,
                post_count = h.UsageCount
            })
            .ToListAsync();

        return Ok(new { success = true, data });
    }

    [HttpGet("/api/v2/feed/hashtags/{tag}")]
    public async Task<IActionResult> HashtagPosts(string tag)
    {
        var tenantId = TenantId();
        var userId = RequireUserId();
        var clean = tag.Trim().TrimStart('#').ToLowerInvariant();
        var limitFallback = ReadQueryInt("limit", 20, 1, 100);
        var perPage = ReadQueryInt("per_page", limitFallback, 1, 100);
        var cursor = Request.Query.TryGetValue("cursor", out var cursorValues)
            ? cursorValues.FirstOrDefault()
            : null;
        var cursorId = DecodeFeedCursor(cursor);

        var hashtag = await _db.Hashtags
            .AsNoTracking()
            .FirstOrDefaultAsync(h => h.TenantId == tenantId && h.Tag == clean);

        if (hashtag == null)
        {
            return Ok(new
            {
                success = true,
                data = Array.Empty<object>(),
                meta = new { cursor = (string?)null, next_cursor = (string?)null, per_page = perPage, limit = perPage, has_more = false, total_items = 0 }
            });
        }

        var baseQuery =
            from usage in _db.HashtagUsages.AsNoTracking()
            join post in _db.FeedPosts.AsNoTracking() on usage.TargetId equals post.Id
            where usage.TenantId == tenantId
                && usage.HashtagId == hashtag.Id
                && usage.TargetType == "post"
                && post.TenantId == tenantId
                && !post.IsHidden
            select post.Id;

        var totalItems = await baseQuery.Distinct().CountAsync();
        var pageQuery = baseQuery.Distinct();
        if (cursorId.HasValue)
        {
            pageQuery = pageQuery.Where(id => id < cursorId.Value);
        }

        var postIds = await pageQuery
            .OrderByDescending(id => id)
            .Take(perPage + 1)
            .ToListAsync();
        var hasMore = postIds.Count > perPage;
        if (hasMore)
        {
            postIds.RemoveAt(postIds.Count - 1);
        }

        var data = await _db.FeedPosts
            .AsNoTracking()
            .Where(p => postIds.Contains(p.Id))
            .OrderByDescending(p => p.Id)
            .Select(p => new
            {
                id = p.Id,
                type = "post",
                content = p.Content,
                image_url = p.ImageUrl,
                group_id = p.GroupId,
                user_id = p.UserId,
                author = p.User == null ? null : new { id = p.User.Id, name = (p.User.FirstName + " " + p.User.LastName).Trim(), avatar_url = p.User.AvatarUrl },
                likes_count = p.Likes.Count,
                comments_count = p.Comments.Count,
                is_liked = p.Likes.Any(l => l.UserId == userId),
                created_at = p.CreatedAt,
                updated_at = p.UpdatedAt
            })
            .ToListAsync();

        var nextCursor = hasMore && postIds.Count > 0
            ? EncodeFeedCursor(postIds[^1])
            : null;

        return Ok(new
        {
            success = true,
            data,
            meta = new { cursor = nextCursor, next_cursor = nextCursor, per_page = perPage, limit = perPage, has_more = hasMore, total_items = totalItems }
        });
    }

    [HttpGet("/api/v2/feed/sidebar")]
    public async Task<IActionResult> FeedSidebar()
    {
        var tenantId = TenantId();
        var userId = RequireUserId();
        var now = DateTime.UtcNow;

        var communityStats = new
        {
            members = await _db.Users.AsNoTracking().CountAsync(u => u.TenantId == tenantId && u.IsActive),
            listings = await _db.Listings.AsNoTracking().CountAsync(l => l.TenantId == tenantId && l.Status == ListingStatus.Active),
            events = await _db.Events.AsNoTracking().CountAsync(e => e.TenantId == tenantId && !e.IsCancelled),
            groups = await _db.Groups.AsNoTracking().CountAsync(g => g.TenantId == tenantId)
        };

        var categories = await _db.Categories
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.IsActive)
            .Select(c => new
            {
                c.Id,
                c.Name,
                c.Slug,
                Count = c.Listings.Count(l => l.TenantId == tenantId && l.Status == ListingStatus.Active)
            })
            .Where(c => c.Count > 0)
            .OrderByDescending(c => c.Count)
            .ThenBy(c => c.Name)
            .Take(8)
            .ToListAsync();

        var topCategories = categories.Select(c => new
        {
            id = c.Id,
            name = c.Name,
            slug = c.Slug,
            color = (string?)null,
            count = c.Count
        }).ToList();

        var events = await _db.Events
            .AsNoTracking()
            .Where(e => e.TenantId == tenantId && !e.IsCancelled && e.StartsAt >= now)
            .OrderBy(e => e.StartsAt)
            .Take(3)
            .Select(e => new
            {
                e.Id,
                e.Title,
                e.StartsAt,
                e.Location
            })
            .ToListAsync();

        var upcomingEvents = events.Select(e => new
        {
            id = e.Id,
            title = e.Title,
            start_time = e.StartsAt.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
            location = e.Location
        }).ToList();

        var groups = await _db.Groups
            .AsNoTracking()
            .Where(g => g.TenantId == tenantId)
            .OrderByDescending(g => g.Members.Count)
            .ThenByDescending(g => g.CreatedAt)
            .Take(5)
            .Select(g => new
            {
                id = g.Id,
                name = g.Name,
                description = g.Description,
                image_url = g.ImageUrl,
                member_count = g.Members.Count
            })
            .ToListAsync();

        var suggestedListings = await _db.Listings
            .AsNoTracking()
            .Where(l => l.TenantId == tenantId && l.UserId != userId && l.Status == ListingStatus.Active)
            .OrderByDescending(l => l.CreatedAt)
            .Take(4)
            .Select(l => new
            {
                id = l.Id,
                title = l.Title,
                type = l.Type == ListingType.Request ? "request" : "offer",
                owner_name = l.User == null ? string.Empty : (l.User.FirstName + " " + l.User.LastName).Trim(),
                image_url = l.ImageUrl
            })
            .ToListAsync();

        var friendRows = await _db.Connections
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId
                && c.Status == Connection.Statuses.Accepted
                && (c.RequesterId == userId || c.AddresseeId == userId))
            .OrderByDescending(c => c.UpdatedAt ?? c.CreatedAt)
            .Take(8)
            .Select(c => c.RequesterId == userId ? c.Addressee : c.Requester)
            .Select(u => new
            {
                u.Id,
                u.FirstName,
                u.LastName,
                u.AvatarUrl,
                u.LastLoginAt
            })
            .ToListAsync();

        var friends = friendRows.Select(u => new
        {
            id = u.Id,
            name = (u.FirstName + " " + u.LastName).Trim(),
            first_name = u.FirstName,
            last_name = u.LastName,
            avatar_url = u.AvatarUrl,
            location = (string?)null,
            is_online = u.LastLoginAt.HasValue && u.LastLoginAt.Value > now.AddMinutes(-5),
            is_recent = u.LastLoginAt.HasValue && u.LastLoginAt.Value > now.AddDays(-1)
        }).ToList();

        var profileStats = new
        {
            total_listings = await _db.Listings.AsNoTracking().CountAsync(l => l.TenantId == tenantId && l.UserId == userId),
            offers = await _db.Listings.AsNoTracking().CountAsync(l => l.TenantId == tenantId && l.UserId == userId && l.Type == ListingType.Offer),
            requests = await _db.Listings.AsNoTracking().CountAsync(l => l.TenantId == tenantId && l.UserId == userId && l.Type == ListingType.Request),
            hours_given = await _db.Transactions.AsNoTracking().ExcludeInternalWalletAdapters().Where(t => t.TenantId == tenantId && t.SenderId == userId).SumAsync(t => (decimal?)t.Amount) ?? 0m,
            hours_received = await _db.Transactions.AsNoTracking().ExcludeInternalWalletAdapters().Where(t => t.TenantId == tenantId && t.ReceiverId == userId).SumAsync(t => (decimal?)t.Amount) ?? 0m
        };

        var trending = await _db.Hashtags
            .AsNoTracking()
            .Where(h => h.TenantId == tenantId)
            .OrderByDescending(h => h.UsageCount)
            .Take(10)
            .ToListAsync();

        return Ok(new
        {
            success = true,
            data = new
            {
                community_stats = communityStats,
                top_categories = topCategories,
                upcoming_events = upcomingEvents,
                popular_groups = groups.Take(3).ToList(),
                suggested_listings = suggestedListings,
                friends,
                profile_stats = profileStats,
                trending_hashtags = trending,
                suggested_groups = groups
            }
        });
    }

    [HttpGet("/api/v2/jobs/feed.json")]
    public IActionResult JobsJsonFeed() => Ok(new { version = "https://jsonfeed.org/version/1.1", title = "Project NEXUS Jobs", items = Array.Empty<object>() });

    [HttpGet("/api/v2/jobs/feed.xml")]
    [HttpGet("/api/v2/jobs/feed/indeed.xml")]
    [Produces("application/xml")]
    public IActionResult JobsXmlFeed()
    {
        return Content("""<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>Project NEXUS Jobs</title></channel></rss>""", "application/xml");
    }

    [HttpPost("/api/social/mention-search")]
    public async Task<IActionResult> MentionSearch([FromBody] JsonElement body)
    {
        _ = RequireUserId();
        var q = (ReadString(body, "q", "query", "term") ?? string.Empty).Trim();
        if (q.Length < 1)
        {
            return Ok(new { success = true, data = new { users = Array.Empty<object>() } });
        }

        var tenantId = TenantId();
        var data = await _db.Users
            .AsNoTracking()
            .Where(u => u.TenantId == tenantId && u.IsActive)
            .Where(u =>
                ((u.FirstName + " " + u.LastName).Contains(q)) ||
                u.FirstName.Contains(q) ||
                (u.Username != null && u.Username.Contains(q)) ||
                u.Email.Contains(q))
            .Take(10)
            .Select(u => new
            {
                id = u.Id,
                name = (u.FirstName + " " + u.LastName).Trim(),
                first_name = u.FirstName,
                username = u.Username,
                avatar_url = u.AvatarUrl
            })
            .ToListAsync();
        return Ok(new { success = true, data = new { users = data } });
    }

    [HttpGet("/api/social/test")]
    public IActionResult SocialTest() => Ok(new { ok = true, service = "social" });

    [HttpGet("/api/v2/notifications")]
    public async Task<IActionResult> Notifications([FromQuery] int page = 1, [FromQuery] int limit = 20)
    {
        var safePage = Math.Max(page, 1);
        var safeLimit = Math.Clamp(limit, 1, 100);
        var userId = RequireUserId();
        var query = _db.Notifications.Where(n => n.UserId == userId);
        var total = await query.CountAsync();
        var rows = await query.OrderByDescending(n => n.CreatedAt).Skip((safePage - 1) * safeLimit).Take(safeLimit).ToListAsync();
        var data = rows.Select(MapNotification).ToList();
        var unread = await query.CountAsync(n => !n.IsRead);
        return Ok(new { data, unread_count = unread, meta = PageMeta(safePage, safeLimit, total) });
    }

    [HttpGet("/api/v2/notifications/{id:int}")]
    public async Task<IActionResult> Notification(int id)
    {
        var row = await _db.Notifications.FirstOrDefaultAsync(n => n.Id == id && n.UserId == RequireUserId());
        return row == null ? NotFound(new { error = "Notification not found" }) : Ok(new { data = MapNotification(row) });
    }

    [HttpPost("/api/notifications/read")]
    public Task<IActionResult> NotificationReadLegacy([FromBody] JsonElement body) => MarkNotificationRead(ReadRequiredInt(body, "id", "notification_id"));

    [HttpPost("/api/v2/notifications/{id:int}/read")]
    public async Task<IActionResult> MarkNotificationRead(int id)
    {
        var row = await _db.Notifications.FirstOrDefaultAsync(n => n.Id == id && n.UserId == RequireUserId());
        if (row == null) return NotFound(new { error = "Notification not found" });
        row.IsRead = true;
        row.ReadAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = MapNotification(row) });
    }

    [HttpPost("/api/v2/notifications/read-all")]
    public async Task<IActionResult> MarkAllNotificationsRead()
    {
        var now = DateTime.UtcNow;
        var count = await _db.Notifications.Where(n => n.UserId == RequireUserId() && !n.IsRead)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.IsRead, true).SetProperty(n => n.ReadAt, now));
        return Ok(new { success = true, marked_count = count });
    }

    [HttpPost("/api/notifications/delete")]
    public Task<IActionResult> DeleteNotificationLegacy([FromBody] JsonElement body) => DeleteNotification(ReadRequiredInt(body, "id", "notification_id"));

    [HttpDelete("/api/v2/notifications/{id:int}")]
    public async Task<IActionResult> DeleteNotification(int id)
    {
        var row = await _db.Notifications.FirstOrDefaultAsync(n => n.Id == id && n.UserId == RequireUserId());
        if (row == null) return NotFound(new { error = "Notification not found" });
        _db.Notifications.Remove(row);
        await _db.SaveChangesAsync();
        return Ok(new { success = true });
    }

    [HttpDelete("/api/v2/notifications")]
    public async Task<IActionResult> DeleteAllNotifications()
    {
        var rows = await _db.Notifications.Where(n => n.UserId == RequireUserId()).ToListAsync();
        _db.Notifications.RemoveRange(rows);
        await _db.SaveChangesAsync();
        return Ok(new { success = true, deleted_count = rows.Count });
    }

    [HttpGet("/api/notifications/check")]
    [HttpGet("/api/v2/notifications/counts")]
    public async Task<IActionResult> NotificationCounts()
    {
        var userId = RequireUserId();
        var unread = await _db.Notifications.CountAsync(n => n.UserId == userId && !n.IsRead);
        return Ok(new { total = unread, unread, notifications = unread });
    }

    [HttpGet("/api/v2/notifications/grouped")]
    public async Task<IActionResult> GroupedNotifications()
    {
        var userId = RequireUserId();
        var rows = await _db.Notifications.Where(n => n.UserId == userId).OrderByDescending(n => n.CreatedAt).ToListAsync();
        return Ok(new
        {
            data = rows.GroupBy(n => n.Type).Select(group => new
            {
                group_key = group.Key,
                count = group.Count(),
                unread_count = group.Count(notification => !notification.IsRead),
                items = group.Select(MapNotification).ToList()
            })
        });
    }

    private static object MapNotification(Notification notification) => new
    {
        id = notification.Id,
        type = notification.Type,
        title = notification.Title,
        body = notification.Body,
        message = notification.Body,
        link = notification.Link,
        data = ParseNotificationData(notification.Data),
        is_read = notification.IsRead,
        created_at = notification.CreatedAt,
        read_at = notification.ReadAt
    };

    private static JsonElement? ParseNotificationData(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        try
        {
            var parsed = JsonSerializer.Deserialize<JsonElement>(raw);
            return parsed.ValueKind == JsonValueKind.Object
                ? parsed
                : JsonSerializer.SerializeToElement(new { value = parsed });
        }
        catch (JsonException)
        {
            return JsonSerializer.SerializeToElement(new { value = raw });
        }
    }

    [HttpGet("/api/wallet/config")]
    [HttpGet("/api/v2/wallet/config")]
    public async Task<IActionResult> WalletConfig()
    {
        var value = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.TenantId == TenantId() && c.Key == "wallet.max_transfer")
            .Select(c => c.Value)
            .FirstOrDefaultAsync();

        int? maxTransfer = int.TryParse(value, out var parsed) ? parsed : null;
        return Ok(new { success = true, data = new { max_transfer = maxTransfer } });
    }

    [HttpGet("/api/notifications/settings")]
    [HttpGet("/api/v2/notifications/settings")]
    public async Task<IActionResult> LaravelNotificationSettings()
    {
        var userId = RequireUserId();
        var prefix = NotificationSettingPrefix(userId);
        var rows = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.TenantId == TenantId() && c.Key.StartsWith(prefix))
            .Select(c => new { c.Key, c.Value })
            .ToListAsync();

        var globalFrequency = "off";
        var perGroup = new List<object>();
        var perThread = new List<object>();

        foreach (var row in rows)
        {
            var suffix = row.Key[prefix.Length..];
            var parts = suffix.Split('.', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length != 2 || !int.TryParse(parts[1], out var contextId))
            {
                continue;
            }

            var frequency = NormalizeNotificationFrequency(row.Value) ?? "off";
            switch (parts[0])
            {
                case "global":
                    globalFrequency = frequency;
                    break;
                case "group":
                    perGroup.Add(new { group_id = contextId, frequency });
                    break;
                case "thread":
                    perThread.Add(new { thread_id = contextId, frequency });
                    break;
            }
        }

        return Ok(new
        {
            success = true,
            data = new
            {
                global_frequency = globalFrequency,
                per_group = perGroup,
                per_thread = perThread
            }
        });
    }

    [HttpPost("/api/v2/notifications/group/read")]
    [HttpPost("/api/v2/notifications/group/{groupKey}/read")]
    public async Task<IActionResult> MarkNotificationGroupRead(string? groupKey, [FromBody] JsonElement body)
    {
        var key = groupKey ?? ReadString(body, "group_key", "type");
        if (string.IsNullOrWhiteSpace(key)) return BadRequest(new { error = "group_key is required" });
        var now = DateTime.UtcNow;
        var count = await _db.Notifications.Where(n => n.UserId == RequireUserId() && n.Type == key && !n.IsRead)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.IsRead, true).SetProperty(n => n.ReadAt, now));
        return Ok(new { success = true, marked_count = count });
    }

    [HttpPost("/api/notifications/settings")]
    [HttpPost("/api/v2/notifications/settings")]
    public async Task<IActionResult> UpdateNotificationSettings([FromBody] JsonElement body)
    {
        if (TryGet(body, "context_type", out _) || TryGet(body, "frequency", out _) || TryGet(body, "push_enabled", out _))
        {
            return await UpdateLaravelNotificationSettings(body);
        }

        var type = ReadString(body, "notification_type", "type") ?? "general";
        var pref = await _pushService.UpdatePreferenceAsync(
            RequireUserId(),
            type,
            ReadBool(body, "enable_in_app", "in_app"),
            ReadBool(body, "enable_push", "push"),
            ReadBool(body, "enable_email", "email"));
        return Ok(new { success = true, data = pref });
    }

    [HttpPut("/api/v2/users/me/notifications")]
    public async Task<IActionResult> UpdateUserNotificationPreferences([FromBody] JsonElement body)
    {
        var user = await CurrentUserAsync();
        var bag = ParseNotificationPreferenceBag(user.NotificationPreferences);
        var changed = false;

        foreach (var key in LaravelNotificationPreferenceKeys)
        {
            if (TryGet(body, key, out _))
            {
                bag[key] = ReadBool(body, key) ?? false;
                changed = true;
            }
        }

        if (!changed)
        {
            return BadRequest(new
            {
                success = false,
                error = "VALIDATION_ERROR",
                message = "No valid notification preferences provided."
            });
        }

        if (TryGet(body, "federation_notifications_enabled", out _))
        {
            bag["federation_notifications_enabled"] = ReadBool(body, "federation_notifications_enabled") ?? true;
        }

        user.NotificationPreferences = bag.ToJsonString(StoreJsonOptions);
        user.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new { success = true, data = new { message = "Notification preferences updated" } });
    }

    [HttpPut("/api/v2/users/me/notification-settings")]
    [EnableRateLimiting(RateLimitingExtensions.AtomicNotificationSettingsPolicy)]
    public async Task<IActionResult> UpdateAtomicNotificationSettings([FromBody] JsonElement body, CancellationToken ct)
    {
        if (!TryGet(body, "notifications", out var notifications) || notifications.ValueKind != JsonValueKind.Object)
            return NotificationValidation("notifications");
        var normalized = new Dictionary<string, bool>(StringComparer.Ordinal);
        foreach (var key in LaravelNotificationPreferenceDefaults.Keys)
        {
            if (!TryFlexibleBoolean(notifications, key, out var value)) return NotificationValidation($"notifications.{key}");
            normalized[key] = value;
        }
        if (!TryGet(body, "match_preferences", out var matches) || matches.ValueKind != JsonValueKind.Object)
            return NotificationValidation("match_preferences");
        var matchFrequency = NormalizeMatchNotificationFrequency(ReadString(matches, "notification_frequency"));
        if (matchFrequency is null) return NotificationValidation("match_preferences.notification_frequency");
        if (!TryFlexibleBoolean(matches, "notify_hot_matches", out var hot)) return NotificationValidation("match_preferences.notify_hot_matches");
        if (!TryFlexibleBoolean(matches, "notify_mutual_matches", out var mutual)) return NotificationValidation("match_preferences.notify_mutual_matches");
        var digest = NormalizeNotificationFrequency(ReadString(body, "digest_frequency"));
        if (digest is null) return NotificationValidation("digest_frequency");

        var tenantId = TenantId(); var userId = RequireUserId(); var now = DateTime.UtcNow;
        await using var tx = await _db.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
        await _db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock({tenantId}, {userId})", ct);
        var user = await _db.Users.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Id == userId, ct);
        if (user is null) return Unauthorized(new { success = false, errors = new[] { new { code = "UNAUTHORIZED", message = "Unauthorized", field = (string?)null } } });
        var bag = ParseNotificationPreferenceBag(user.NotificationPreferences);
        foreach (var (key, value) in normalized) bag[key] = value;
        bag["match_notification_frequency"] = matchFrequency;
        bag["match_notify_hot_matches"] = hot;
        bag["match_notify_mutual_matches"] = mutual;
        user.NotificationPreferences = bag.ToJsonString(StoreJsonOptions);
        user.FederationNotificationsEnabled = normalized["federation_notifications_enabled"];
        user.UpdatedAt = now;

        var match = await _db.MatchPreferences.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.UserId == userId, ct);
        if (match is null)
        {
            match = new MatchPreference { TenantId = tenantId, UserId = userId, CreatedAt = now };
            _db.MatchPreferences.Add(match);
        }
        match.NotificationFrequency = matchFrequency; match.NotifyHotMatches = hot; match.NotifyMutualMatches = mutual; match.UpdatedAt = now;
        var digestKey = $"{NotificationSettingPrefix(userId)}global.0";
        var digestRow = await _db.TenantConfigs.IgnoreQueryFilters().SingleOrDefaultAsync(x => x.TenantId == tenantId && x.Key == digestKey, ct);
        if (digestRow is null) _db.TenantConfigs.Add(new TenantConfig { TenantId = tenantId, Key = digestKey, Value = digest, CreatedAt = now, UpdatedAt = now });
        else { digestRow.Value = digest; digestRow.UpdatedAt = now; }
        await _db.SaveChangesAsync(ct); await tx.CommitAsync(ct);

        return Ok(new { success = true, data = new { notifications = normalized, match_preferences = new { notification_frequency = matchFrequency, notify_hot_matches = hot, notify_mutual_matches = mutual }, digest_frequency = digest } });
    }

    [HttpGet("/api/v2/users/me/notifications")]
    public async Task<IActionResult> NotificationSettings()
    {
        var user = await CurrentUserAsync();
        var data = BuildLaravelNotificationPreferenceData(ParseNotificationPreferenceBag(user.NotificationPreferences));
        return Ok(new { success = true, data });
    }

    [HttpPost("/api/push/register-device")]
    [HttpPost("/api/push/subscribe")]
    public async Task<IActionResult> RegisterPushDevice([FromBody] JsonElement body)
    {
        var token = ReadString(body, "device_token", "token", "endpoint") ?? JsonSerializer.Serialize(body, JsonOptions);
        var platform = ReadString(body, "platform") ?? "web";
        var device = await _pushService.RegisterDeviceAsync(RequireUserId(), token, platform, ReadString(body, "device_name", "name"));
        return Ok(new { success = true, data = device });
    }

    [HttpPost("/api/push/unregister-device")]
    [HttpPost("/api/push/unsubscribe")]
    public async Task<IActionResult> UnregisterPushDevice([FromBody] JsonElement body)
    {
        var token = ReadString(body, "device_token", "token", "endpoint");
        if (string.IsNullOrWhiteSpace(token)) return BadRequest(new { error = "device_token is required" });
        var removed = await _pushService.UnregisterDeviceAsync(RequireUserId(), token);
        return Ok(new { success = removed });
    }

    [HttpGet("/api/push/status")]
    public async Task<IActionResult> PushStatus()
    {
        var devices = await _pushService.GetUserDevicesAsync(RequireUserId());
        return Ok(new { enabled = devices.Count > 0, devices_count = devices.Count, data = devices });
    }

    [HttpPost("/api/push/send")]
    public async Task<IActionResult> SendPush([FromBody] JsonElement body)
    {
        var sent = await _pushService.SendPushAsync(
            ReadInt(body, "user_id", "userId") ?? RequireUserId(),
            ReadString(body, "title") ?? "Notification",
            ReadString(body, "body", "message") ?? string.Empty,
            body.ValueKind == JsonValueKind.Undefined ? null : JsonSerializer.Serialize(body, JsonOptions));
        return Ok(new { success = true, sent_count = sent });
    }

    [HttpPost("/api/support/reports")]
    [HttpPost("/api/v2/support/reports")]
    public async Task<IActionResult> CreateSupportReport([FromBody] JsonElement body)
    {
        var summary = ReadString(body, "summary")?.Trim();
        var description = ReadString(body, "description")?.Trim();
        var impact = ReadString(body, "impact")?.Trim().ToLowerInvariant();
        var errors = new List<object>();

        if (string.IsNullOrWhiteSpace(summary) || summary.Length < 3 || summary.Length > 180)
        {
            errors.Add(ValidationError("summary", "Summary must be between 3 and 180 characters."));
        }

        if (string.IsNullOrWhiteSpace(description) || description.Length < 10 || description.Length > 5000)
        {
            errors.Add(ValidationError("description", "Description must be between 10 and 5000 characters."));
        }

        if (impact is not ("blocked" or "major" or "minor" or "cosmetic"))
        {
            errors.Add(ValidationError("impact", "Impact must be blocked, major, minor, or cosmetic."));
        }

        if (errors.Count > 0)
        {
            return UnprocessableEntity(new { success = false, errors });
        }

        var now = DateTime.UtcNow;
        var reports = await LoadAllSupportReports();
        var report = new SupportReportCompatRecord
        {
            Id = reports.Count == 0 ? 1 : reports.Max(r => r.Id) + 1,
            TenantId = TenantId(),
            UserId = RequireUserId(),
            Reference = $"NXR-{now:yyMMdd}-{Guid.NewGuid().ToString("N")[..6].ToUpperInvariant()}",
            Source = "in_app",
            Summary = summary!,
            Description = description!,
            Impact = impact!,
            Status = "open",
            Module = ReadString(body, "module"),
            Route = ReadString(body, "route"),
            PageUrl = ReadString(body, "page_url", "pageUrl"),
            SentryEventId = ReadString(body, "sentry_event_id", "sentryEventId"),
            SentryIssueUrl = ReadString(body, "sentry_issue_url", "sentryIssueUrl"),
            Diagnostics = ReadBool(body, "include_diagnostics", "includeDiagnostics") == true ? NormalizeDiagnostics(body, now) : null,
            UserAgent = Request.Headers.UserAgent.FirstOrDefault(),
            CreatedAt = now.ToString("O"),
            UpdatedAt = now.ToString("O")
        };

        reports.Add(report);
        await SaveAllSupportReports(reports);

        return Created($"/api/v2/support/reports/{report.Id}", new
        {
            success = true,
            data = new
            {
                report = new
                {
                    id = report.Id,
                    reference = report.Reference,
                    status = report.Status,
                    impact = report.Impact,
                    summary = report.Summary,
                    created_at = report.CreatedAt
                }
            }
        });
    }

    [HttpGet("/api/push/vapid-key")]
    [HttpGet("/api/push/vapid-public-key")]
    [AllowAnonymous]
    public IActionResult VapidKey() => Ok(new { public_key = string.Empty, configured = false });

    [HttpGet("/api/pusher/config")]
    [AllowAnonymous]
    public IActionResult PusherConfig()
    {
        var userId = User.GetUserId();
        return Ok(new
        {
            success = true,
            data = BuildRealtimeConfig(userId)
        });
    }

    [HttpGet("/api/pusher/auth")]
    [HttpPost("/api/pusher/auth")]
    public IActionResult PusherAuth([FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] JsonElement body)
    {
        var userId = RequireUserId();
        var socketId = ReadString(body, "socket_id", "socketId");
        var channelName = ReadString(body, "channel_name", "channelName");

        if (string.IsNullOrWhiteSpace(socketId) || string.IsNullOrWhiteSpace(channelName))
        {
            return BadRequest(new
            {
                success = false,
                code = "VALIDATION_ERROR",
                message = "Missing socket_id or channel_name."
            });
        }

        var config = BuildRealtimeConfig(userId);
        if (!config.Enabled)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                success = false,
                code = "REALTIME_DISABLED",
                message = "Realtime transport is not configured."
            });
        }

        var auth = BuildPusherAuthResponse(channelName, socketId, userId);
        if (auth is null)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                success = false,
                code = "FORBIDDEN",
                message = "Forbidden."
            });
        }

        return Ok(auth);
    }

    private object? BuildPusherAuthResponse(string channelName, string socketId, int userId)
    {
        var key = PusherConfigValue("PUSHER_APP_KEY", "Pusher:Key", "Pusher:AppKey");
        var secret = PusherConfigValue("PUSHER_APP_SECRET", "Pusher:Secret", "Pusher:AppSecret");
        if (string.IsNullOrWhiteSpace(key) || string.IsNullOrWhiteSpace(secret))
        {
            return null;
        }

        if (channelName.StartsWith("presence-", StringComparison.Ordinal))
        {
            return BuildPusherPresenceAuthResponse(key, secret, channelName, socketId, userId);
        }

        if (channelName.StartsWith("private-", StringComparison.Ordinal))
        {
            if (!CanAccessPrivatePusherChannel(channelName, userId))
            {
                return null;
            }

            return new
            {
                auth = $"{key}:{HmacSha256Hex(secret, $"{socketId}:{channelName}")}"
            };
        }

        return null;
    }

    private object? BuildPusherPresenceAuthResponse(string key, string secret, string channelName, string socketId, int userId)
    {
        if (!CanAccessPresencePusherChannel(channelName))
        {
            return null;
        }

        var user = _db.Users
            .AsNoTracking()
            .FirstOrDefault(row => row.TenantId == TenantId() && row.Id == userId);
        var name = string.Join(" ", new[] { user?.FirstName, user?.LastName }
            .Where(part => !string.IsNullOrWhiteSpace(part)))
            .Trim();
        var channelData = JsonSerializer.Serialize(new
        {
            user_id = userId.ToString(),
            user_info = new
            {
                id = userId,
                name = string.IsNullOrWhiteSpace(name) ? "User" : name,
                avatar = user?.AvatarUrl
            }
        }, JsonOptions);

        return new
        {
            auth = $"{key}:{HmacSha256Hex(secret, $"{socketId}:{channelName}:{channelData}")}",
            channel_data = channelData
        };
    }

    private bool CanAccessPrivatePusherChannel(string channelName, int userId)
    {
        if (TryMatchPusherChannel(channelName, @"^private-user\.(\d+)$", out var privateUser))
        {
            return privateUser == userId;
        }

        var tenantMatch = System.Text.RegularExpressions.Regex.Match(channelName, @"^private-tenant\.(\d+)\.(.+)$");
        if (!tenantMatch.Success || !int.TryParse(tenantMatch.Groups[1].Value, out var channelTenantId) || channelTenantId != TenantId())
        {
            return false;
        }

        var suffix = tenantMatch.Groups[2].Value;
        if (TryMatchPusherChannel(suffix, @"^user\.(\d+)$", out var tenantUser))
        {
            return tenantUser == userId;
        }

        var chatMatch = System.Text.RegularExpressions.Regex.Match(suffix, @"^chat\.(\d+)-(\d+)$");
        if (chatMatch.Success
            && int.TryParse(chatMatch.Groups[1].Value, out var firstUser)
            && int.TryParse(chatMatch.Groups[2].Value, out var secondUser))
        {
            return userId == firstUser || userId == secondUser;
        }

        if (suffix is "feed" or "presence")
        {
            return true;
        }

        if (TryMatchPusherChannel(suffix, @"^conversation\.(\d+)$", out var conversationId))
        {
            return _db.Conversations
                .Any(row =>
                    row.TenantId == channelTenantId
                    && row.Id == conversationId
                    && (row.Participant1Id == userId || row.Participant2Id == userId));
        }

        if (TryMatchPusherChannel(suffix, @"^group\.(\d+)(?:\.|$)", out var groupId))
        {
            return _db.GroupMembers
                .Any(row => row.TenantId == channelTenantId && row.GroupId == groupId && row.UserId == userId);
        }

        return false;
    }

    private bool CanAccessPresencePusherChannel(string channelName)
    {
        var match = System.Text.RegularExpressions.Regex.Match(channelName, @"^presence-tenant\.(\d+)\b");
        return match.Success
            && int.TryParse(match.Groups[1].Value, out var channelTenantId)
            && channelTenantId == TenantId();
    }

    private static bool TryMatchPusherChannel(string value, string pattern, out int id)
    {
        var match = System.Text.RegularExpressions.Regex.Match(value, pattern);
        if (match.Success && int.TryParse(match.Groups[1].Value, out id))
        {
            return true;
        }

        id = 0;
        return false;
    }

    private static string HmacSha256Hex(string secret, string value)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(value));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    [HttpPost("/api/v2/presence/heartbeat")]
    public async Task<IActionResult> Heartbeat([FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] JsonElement body)
    {
        var userId = RequireUserId();
        var row = await UpsertPresenceAsync(
            userId,
            ReadString(body, "platform"),
            status: null,
            preserveManualStatus: true);

        return Ok(new
        {
            success = true,
            data = new
            {
                ok = true,
                status = ToLaravelPresenceStatus(row.Status),
                last_seen_at = row.LastSeenAt.ToString("O")
            }
        });
    }

    [HttpGet("/api/v2/presence/online-count")]
    public async Task<IActionResult> OnlineCount()
    {
        var cutoff = DateTime.UtcNow.AddMinutes(-15);
        var count = await _db.UserPresences
            .Where(p => p.TenantId == TenantId()
                && p.LastSeenAt >= cutoff
                && (p.Status == "online" || p.Status == "away" || p.Status == "dnd" || p.Status == "do_not_disturb"))
            .CountAsync();

        return Ok(new { success = true, data = new { online_count = count } });
    }

    [HttpGet("/api/v2/presence/users")]
    public async Task<IActionResult> PresenceUsers()
    {
        _ = RequireUserId();

        var ids = Request.Query.TryGetValue("user_ids", out var rawUserIds)
            ? rawUserIds.ToString().Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(value => int.TryParse(value, out var id) ? id : 0)
                .Where(id => id > 0)
                .Distinct()
                .Take(100)
                .ToArray()
            : Array.Empty<int>();

        if (ids.Length == 0 && !Request.Query.ContainsKey("user_ids"))
        {
            return BadRequest(new
            {
                success = false,
                code = "VALIDATION_REQUIRED_FIELD",
                message = "The user_ids field is required.",
                field = "user_ids"
            });
        }

        var rows = await _db.UserPresences
            .AsNoTracking()
            .Where(p => ids.Contains(p.UserId) && p.TenantId == TenantId())
            .ToDictionaryAsync(p => p.UserId);
        var meta = await LoadPresenceMetadata(ids);
        var data = ids.ToDictionary(
            id => id.ToString(),
            id => BuildPresencePayload(rows.TryGetValue(id, out var row) ? row : null, meta.TryGetValue(id, out var item) ? item : null));

        return Ok(new { success = true, data });
    }

    [HttpPut("/api/v2/presence/privacy")]
    [HttpPut("/api/v2/presence/status")]
    public async Task<IActionResult> SetPresencePreference([FromBody] JsonElement body)
    {
        var userId = RequireUserId();

        if (Request.Path.Value?.EndsWith("/privacy", StringComparison.OrdinalIgnoreCase) == true)
        {
            var hidePresence = ReadBool(body, "hide_presence", "hidePresence") ?? false;
            await UpsertPresenceAsync(userId, platform: null, status: hidePresence ? "invisible" : "online", preserveManualStatus: false);
            await SavePresenceMetadata(userId, hidePresence: hidePresence);

            return Ok(new { success = true, data = new { hide_presence = hidePresence } });
        }

        var status = NormalizeLaravelPresenceStatus(ReadString(body, "status"));
        if (status == null)
        {
            return BadRequest(new
            {
                success = false,
                code = "VALIDATION_INVALID",
                message = "Invalid presence status.",
                field = "status"
            });
        }

        var customStatus = TruncatePresenceText(ReadString(body, "custom_status", "customStatus"), 80);
        var emoji = TruncatePresenceText(ReadString(body, "emoji", "status_emoji", "statusEmoji"), 10);
        var row = await UpsertPresenceAsync(userId, platform: null, status, preserveManualStatus: false);
        await SavePresenceMetadata(userId, customStatus, emoji);

        return Ok(new
        {
            success = true,
            data = new
            {
                status = ToLaravelPresenceStatus(row.Status),
                custom_status = customStatus,
                emoji
            }
        });
    }

    [HttpGet("/api/recommendations/groups")]
    [HttpGet("/api/v2/groups/recommendations")]
    public async Task<IActionResult> GroupRecommendations()
    {
        var userId = RequireUserId();
        var memberGroupIds = _db.GroupMembers.Where(m => m.UserId == userId).Select(m => m.GroupId);
        var data = await _db.Groups.Where(g => !memberGroupIds.Contains(g.Id)).OrderByDescending(g => g.CreatedAt).Take(10).Select(g => new { g.Id, g.Name, g.Description }).ToListAsync();
        return Ok(new { data });
    }

    [HttpGet("/api/recommendations/metrics")]
    [HttpGet("/api/v2/groups/recommendations/metrics")]
    public async Task<IActionResult> RecommendationMetrics()
    {
        return Ok(new { groups = await _db.Groups.CountAsync(), events = await _db.GroupRecommendationEvents.CountAsync() });
    }

    [HttpGet("/api/recommendations/similar/{id:int}")]
    public async Task<IActionResult> SimilarGroups(int id)
    {
        var group = await _db.Groups.FirstOrDefaultAsync(g => g.Id == id);
        var data = await _db.Groups
            .Where(g => g.Id != id && (group == null || g.IsPrivate == group.IsPrivate))
            .Take(10)
            .Select(g => new { g.Id, g.Name, g.Description })
            .ToListAsync();
        return Ok(new { data });
    }

    [HttpPost("/api/recommendations/track")]
    [HttpPost("/api/v2/groups/recommendations/track")]
    public async Task<IActionResult> TrackRecommendation([FromBody] JsonElement body)
    {
        var row = new GroupRecommendationEvent
        {
            TenantId = TenantId(),
            UserId = RequireUserId(),
            GroupId = ReadInt(body, "group_id", "groupId", "id"),
            EventType = ReadString(body, "event_type", "type") ?? "view"
        };
        _db.GroupRecommendationEvents.Add(row);
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = row });
    }

    [HttpGet("/api/v2/groups/{id:int}/notification-prefs")]
    public async Task<IActionResult> GroupNotificationPrefs(int id)
    {
        var userId = RequireUserId();
        var row = await _db.GroupNotificationPreferences.FirstOrDefaultAsync(p => p.GroupId == id && p.UserId == userId)
            ?? new GroupNotificationPreference { GroupId = id, UserId = userId, EmailNotifications = true, PushNotifications = true, DigestFrequency = "daily" };
        return Ok(new { data = row });
    }

    [HttpPut("/api/v2/groups/{id:int}/notification-prefs")]
    public async Task<IActionResult> SetGroupNotificationPrefs(int id, [FromBody] JsonElement body)
    {
        var userId = RequireUserId();
        var row = await _db.GroupNotificationPreferences.FirstOrDefaultAsync(p => p.GroupId == id && p.UserId == userId);
        if (row == null)
        {
            row = new GroupNotificationPreference { TenantId = TenantId(), GroupId = id, UserId = userId };
            _db.GroupNotificationPreferences.Add(row);
        }

        row.EmailNotifications = ReadBool(body, "email_notifications", "email") ?? row.EmailNotifications;
        row.PushNotifications = ReadBool(body, "push_notifications", "push") ?? row.PushNotifications;
        row.DigestFrequency = ReadString(body, "digest_frequency", "digest") ?? row.DigestFrequency;
        row.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = row });
    }

    [HttpGet("/api/subscriptions")]
    public async Task<IActionResult> Subscriptions()
    {
        var data = await _db.UserSubscriptions.Where(s => s.UserId == RequireUserId()).Include(s => s.Plan).ToListAsync();
        return Ok(new { data });
    }

    [HttpGet("/api/subscriptions/{id:int}")]
    public async Task<IActionResult> Subscription(int id)
    {
        var row = await _db.UserSubscriptions.Include(s => s.Plan).FirstOrDefaultAsync(s => s.Id == id && s.UserId == RequireUserId());
        return row == null ? NotFound(new { error = "Subscription not found" }) : Ok(new { data = row });
    }

    [HttpPost("/api/subscriptions")]
    public async Task<IActionResult> CreateSubscription([FromBody] JsonElement body)
    {
        var row = new UserSubscription
        {
            TenantId = TenantId(),
            UserId = RequireUserId(),
            PlanId = ReadRequiredInt(body, "plan_id", "planId"),
            Notes = ReadString(body, "notes")
        };
        _db.UserSubscriptions.Add(row);
        await _db.SaveChangesAsync();
        return Created($"/api/subscriptions/{row.Id}", new { data = row });
    }

    [HttpPut("/api/subscriptions/{id:int}")]
    public async Task<IActionResult> UpdateSubscription(int id, [FromBody] JsonElement body)
    {
        var row = await _db.UserSubscriptions.FirstOrDefaultAsync(s => s.Id == id && s.UserId == RequireUserId());
        if (row == null) return NotFound(new { error = "Subscription not found" });
        row.Notes = ReadString(body, "notes") ?? row.Notes;
        row.ExpiresAt = ReadDate(body, "expires_at", "expiresAt") ?? row.ExpiresAt;
        row.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { data = row });
    }

    [HttpDelete("/api/subscriptions/{id:int}")]
    public async Task<IActionResult> DeleteSubscription(int id)
    {
        var row = await _db.UserSubscriptions.FirstOrDefaultAsync(s => s.Id == id && s.UserId == RequireUserId());
        if (row == null) return NotFound(new { error = "Subscription not found" });
        row.Status = SubscriptionStatus.Cancelled;
        row.CancelledAt = DateTime.UtcNow;
        row.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = row });
    }

    [HttpPost("/api/subscriptions/{id:int}/generate-report")]
    public async Task<IActionResult> SubscriptionReport(int id)
    {
        var row = await _db.UserSubscriptions.Include(s => s.Plan).FirstOrDefaultAsync(s => s.Id == id && s.UserId == RequireUserId());
        return row == null ? NotFound(new { error = "Subscription not found" }) : Ok(new { data = row, generated_at = DateTime.UtcNow });
    }

    [HttpGet("/api/v2/coupons")]
    public async Task<IActionResult> Coupons()
    {
        var data = await _db.MerchantCoupons.Where(c => c.IsActive && (c.ExpiresAt == null || c.ExpiresAt > DateTime.UtcNow)).ToListAsync();
        return Ok(new { data });
    }

    [HttpGet("/api/v2/coupons/{id:int}")]
    public async Task<IActionResult> Coupon(int id)
    {
        var row = await _db.MerchantCoupons.FirstOrDefaultAsync(c => c.Id == id);
        return row == null ? NotFound(new { error = "Coupon not found" }) : Ok(new { data = row });
    }

    [HttpPost("/api/v2/coupons/validate")]
    public async Task<IActionResult> ValidateCoupon([FromBody] JsonElement body)
    {
        var code = ReadString(body, "code")?.Trim().ToUpperInvariant();
        var orderTotalCents = Math.Max(0, ReadInt(body, "order_total_cents") ?? 0);
        var row = string.IsNullOrWhiteSpace(code)
            ? null
            : await _db.MerchantCoupons.FirstOrDefaultAsync(c =>
                c.TenantId == TenantId()
                && c.Code == code
                && c.IsActive
                && c.Status == "active"
                && (c.ValidFrom == null || c.ValidFrom <= DateTime.UtcNow)
                && (c.ExpiresAt == null || c.ExpiresAt > DateTime.UtcNow)
                && (c.MinOrderCents == null || orderTotalCents >= c.MinOrderCents)
                && (c.MaxUses == null || c.UsageCount < c.MaxUses));

        if (row == null)
            return UnprocessableEntity(new { success = false, code = "VALIDATION_ERROR", error = "Coupon is invalid." });

        var discountCents = CalculateCouponDiscountCents(row, orderTotalCents);
        return Ok(new
        {
            success = true,
            data = new
            {
                coupon = MapCoupon(row),
                discount_cents = discountCents
            }
        });
    }

    [HttpPost("/api/v2/coupons/{id:int}/qr")]
    public async Task<IActionResult> CouponQr(int id)
    {
        var row = await _db.MerchantCoupons.FirstOrDefaultAsync(c => c.Id == id);
        return row == null ? NotFound(new { error = "Coupon not found" }) : Ok(new { data = new { coupon_id = id, qr_payload = row.Code } });
    }

    [HttpPost("/api/v2/coupons/redeem-qr")]
    public async Task<IActionResult> RedeemCouponQr([FromBody] JsonElement body)
    {
        var code = ReadString(body, "code", "qr_payload");
        var coupon = string.IsNullOrWhiteSpace(code) ? null : await _db.MerchantCoupons.FirstOrDefaultAsync(c => c.Code == code && c.IsActive);
        if (coupon == null) return NotFound(new { error = "Coupon not found" });
        var redemption = new MerchantCouponRedemption { TenantId = TenantId(), MerchantCouponId = coupon.Id, UserId = RequireUserId(), MarketplaceOrderId = ReadInt(body, "order_id", "marketplace_order_id") };
        _db.MerchantCouponRedemptions.Add(redemption);
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = redemption });
    }

    [HttpGet("/api/cookie-consent")]
    [AllowAnonymous]
    public async Task<IActionResult> CookieConsent([FromQuery] string? session_id = null)
    {
        var userId = User.GetUserId();
        var query = _db.CookieConsents.AsQueryable();
        query = userId.HasValue ? query.Where(c => c.UserId == userId) : query.Where(c => c.SessionId == session_id);
        var row = await query.OrderByDescending(c => c.UpdatedAt ?? c.ConsentedAt).FirstOrDefaultAsync();
        return row == null ? Ok(new { data = (object?)null, consented = false }) : Ok(new { data = row, consented = true });
    }

    [HttpPost("/api/cookie-consent")]
    [AllowAnonymous]
    public async Task<IActionResult> StoreCookieConsent([FromBody] JsonElement body)
    {
        var row = new CookieConsent
        {
            TenantId = TenantIdOrDefault(),
            UserId = User.GetUserId(),
            SessionId = ReadString(body, "session_id", "sessionId"),
            NecessaryCookies = true,
            AnalyticsCookies = ReadBool(body, "analytics", "analytics_cookies") ?? false,
            MarketingCookies = ReadBool(body, "marketing", "marketing_cookies") ?? false,
            PreferenceCookies = ReadBool(body, "preferences", "preference_cookies") ?? false,
            IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString(),
            UserAgent = Request.Headers.UserAgent.FirstOrDefault()
        };
        _db.CookieConsents.Add(row);
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = row });
    }

    [HttpPut("/api/cookie-consent/{id:int}")]
    public async Task<IActionResult> UpdateCookieConsent(int id, [FromBody] JsonElement body)
    {
        var row = await _db.CookieConsents.FirstOrDefaultAsync(c => c.Id == id && (c.UserId == RequireUserId() || c.UserId == null));
        if (row == null) return NotFound(new { error = "Cookie consent not found" });
        row.AnalyticsCookies = ReadBool(body, "analytics", "analytics_cookies") ?? row.AnalyticsCookies;
        row.MarketingCookies = ReadBool(body, "marketing", "marketing_cookies") ?? row.MarketingCookies;
        row.PreferenceCookies = ReadBool(body, "preferences", "preference_cookies") ?? row.PreferenceCookies;
        row.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = row });
    }

    [HttpDelete("/api/cookie-consent/{id:int}")]
    public async Task<IActionResult> WithdrawCookieConsent(int id)
    {
        var row = await _db.CookieConsents.FirstOrDefaultAsync(c => c.Id == id && (c.UserId == RequireUserId() || c.UserId == null));
        if (row == null) return NotFound(new { error = "Cookie consent not found" });
        row.AnalyticsCookies = false;
        row.MarketingCookies = false;
        row.PreferenceCookies = false;
        row.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = row });
    }

    [HttpGet("/api/cookie-consent/check/{category}")]
    [AllowAnonymous]
    public async Task<IActionResult> CheckCookieConsent(string category, [FromQuery] string? session_id = null)
    {
        var result = await CookieConsent(session_id) as OkObjectResult;
        var row = (result?.Value?.GetType().GetProperty("data")?.GetValue(result.Value)) as CookieConsent;
        var allowed = category.ToLowerInvariant() switch
        {
            "necessary" => true,
            "analytics" => row?.AnalyticsCookies == true,
            "marketing" => row?.MarketingCookies == true,
            "preferences" or "preference" => row?.PreferenceCookies == true,
            _ => false
        };
        return Ok(new { category, allowed });
    }

    [HttpGet("/api/cookie-consent/inventory")]
    [AllowAnonymous]
    public IActionResult CookieInventory()
    {
        return Ok(new
        {
            data = new[]
            {
                new { category = "necessary", required = true },
                new { category = "analytics", required = false },
                new { category = "marketing", required = false },
                new { category = "preferences", required = false }
            }
        });
    }

    private async Task<IActionResult> TogglePostLike(int postId)
    {
        var userId = RequireUserId();
        var tenantId = TenantId();
        var existing = await _db.ContentLikes.FirstOrDefaultAsync(l =>
            l.TenantId == tenantId &&
            l.TargetType == "post" &&
            l.TargetId == postId &&
            l.UserId == userId);
        var liked = existing == null;
        if (existing == null)
        {
            _db.ContentLikes.Add(new ContentLike
            {
                TenantId = tenantId,
                TargetType = "post",
                TargetId = postId,
                UserId = userId,
                CreatedAt = DateTime.UtcNow
            });

            if (!await _db.PostLikes.AnyAsync(l => l.TenantId == tenantId && l.PostId == postId && l.UserId == userId))
            {
                _db.PostLikes.Add(new PostLike { TenantId = tenantId, PostId = postId, UserId = userId });
            }
        }
        else
        {
            _db.ContentLikes.Remove(existing);

            var legacyRows = await _db.PostLikes
                .Where(l => l.TenantId == tenantId && l.PostId == postId && l.UserId == userId)
                .ToListAsync();
            _db.PostLikes.RemoveRange(legacyRows);
        }

        await _db.SaveChangesAsync();
        var count = await _db.ContentLikes.CountAsync(l => l.TenantId == tenantId && l.TargetType == "post" && l.TargetId == postId);
        var action = liked ? "liked" : "unliked";
        return LaravelLikeData(action, count, liked);
    }

    private async Task<IActionResult> ToggleGenericLike(string targetType, int targetId)
    {
        var userId = RequireUserId();
        var tenantId = TenantId();
        var existing = await _db.ContentLikes.FirstOrDefaultAsync(l =>
            l.TenantId == tenantId &&
            l.TargetType == targetType &&
            l.TargetId == targetId &&
            l.UserId == userId);
        var liked = existing == null;

        if (existing == null)
        {
            _db.ContentLikes.Add(new ContentLike
            {
                TenantId = tenantId,
                TargetType = targetType,
                TargetId = targetId,
                UserId = userId,
                CreatedAt = DateTime.UtcNow
            });
        }
        else
        {
            _db.ContentLikes.Remove(existing);
        }

        await _db.SaveChangesAsync();
        var count = await _db.ContentLikes.CountAsync(l =>
            l.TenantId == tenantId &&
            l.TargetType == targetType &&
            l.TargetId == targetId);
        var action = liked ? "liked" : "unliked";
        return LaravelLikeData(action, count, liked);
    }

    private IActionResult LaravelLikeData(string action, int likesCount, bool liked)
    {
        return Ok(new
        {
            success = true,
            liked,
            likes_count = likesCount,
            data = new
            {
                action,
                status = action,
                likes_count = likesCount
            }
        });
    }

    private async Task<IActionResult> LegacySocialCommentsFetch(string targetType, int targetId)
    {
        var tenantId = TenantId();
        var userId = RequireUserId();
        var rows = await _db.ThreadedComments
            .AsNoTracking()
            .Include(c => c.Author)
            .Where(c => c.TenantId == tenantId &&
                c.TargetType == targetType &&
                c.TargetId == targetId &&
                !c.IsDeleted)
            .OrderBy(c => c.CreatedAt)
            .ToListAsync();

        var comments = BuildLegacySocialCommentTree(rows, userId);
        return Ok(new
        {
            data = new
            {
                comments,
                available_reactions = LaravelReactionTypes
            }
        });
    }

    private async Task<IActionResult> LegacySocialCommentsSubmit(JsonElement body, string targetType, int targetId)
    {
        var tenantId = TenantId();
        var userId = RequireUserId();
        var cancellationToken = HttpContext.RequestAborted;
        var content = LaravelHtmlSanitizer.Sanitize(
            ReadString(body, "content", "body", "comment", "message")?.Trim() ?? string.Empty);
        if (string.IsNullOrWhiteSpace(content))
        {
            return BadRequest(new
            {
                errors = new[] { new { code = "VALIDATION_ERROR", message = "Comment cannot be empty.", field = "content" } }
            });
        }

        if (!await FeedTrackingTargetExistsAsync(targetType, targetId))
        {
            return Ok(new
            {
                data = new
                {
                    success = false,
                    error = "Target not found."
                }
            });
        }

        var parentId = ReadInt(body, "parent_id", "parent_comment_id");
        int? parentAuthorId = null;
        if (parentId.HasValue)
        {
            parentAuthorId = await _db.ThreadedComments
                .Where(c =>
                c.TenantId == tenantId &&
                c.Id == parentId.Value &&
                c.TargetType == targetType &&
                c.TargetId == targetId &&
                !c.IsDeleted)
                .Select(c => (int?)c.AuthorId)
                .FirstOrDefaultAsync(cancellationToken);
            if (!parentAuthorId.HasValue)
            {
                return Ok(new
                {
                    data = new
                    {
                        success = false,
                        error = "Parent comment not found."
                    }
                });
            }
        }

        var mentioningUser = await _db.Users
            .AsNoTracking()
            .Where(user => user.TenantId == tenantId && user.Id == userId && user.IsActive)
            .Select(user => new { user.Id, user.FirstName, user.LastName })
            .FirstOrDefaultAsync(cancellationToken);
        if (mentioningUser is null)
        {
            return Unauthorized(new { errors = new[] { new { code = "UNAUTHORIZED", message = "Invalid user." } } });
        }

        var mentionedUsers = await ResolveCommentMentionUsersAsync(content, tenantId, userId, cancellationToken);
        var targetOwnerId = await ResolveCommentTargetOwnerIdAsync(targetType, targetId, cancellationToken);
        var recipientIds = mentionedUsers.Select(user => user.Id)
            .Concat(parentAuthorId.HasValue ? new[] { parentAuthorId.Value } : Array.Empty<int>())
            .Concat(targetOwnerId.HasValue ? new[] { targetOwnerId.Value } : Array.Empty<int>())
            .Where(id => id != userId)
            .Distinct()
            .OrderBy(id => id)
            .ToArray();

        await using var transaction = _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, cancellationToken)
            : null;

        try
        {
            await _socialCommentContactPolicy.AssertAllowedAsync(
                userId,
                recipientIds,
                tenantId,
                cancellationToken);
        }
        catch (SafeguardingPolicyException exception)
        {
            if (transaction is not null)
            {
                await transaction.RollbackAsync(cancellationToken);
            }

            var status = exception.ReasonCode switch
            {
                "SAFEGUARDING_POLICY_UNAVAILABLE" => StatusCodes.Status503ServiceUnavailable,
                "SAFEGUARDING_JURISDICTION_REQUIRED" => StatusCodes.Status409Conflict,
                _ => StatusCodes.Status403Forbidden
            };
            return StatusCode(status, new
            {
                errors = new[] { new { code = exception.ReasonCode, message = exception.Message } }
            });
        }

        var comment = new ThreadedComment
        {
            TenantId = tenantId,
            TargetType = targetType,
            TargetId = targetId,
            ParentId = parentId,
            AuthorId = userId,
            Content = content,
            CreatedAt = DateTime.UtcNow
        };

        _db.ThreadedComments.Add(comment);
        await _db.SaveChangesAsync(cancellationToken);

        foreach (var mentioned in mentionedUsers)
        {
            _db.ContentMentions.Add(new ContentMention
            {
                TenantId = tenantId,
                CommentId = comment.Id,
                MentionedUserId = mentioned.Id,
                MentioningUserId = userId,
                EntityType = "comment",
                EntityId = comment.Id,
                CreatedAt = comment.CreatedAt
            });
        }

        var actorName = DisplayName(mentioningUser.FirstName, mentioningUser.LastName) ?? "Someone";
        var link = SocialCommentLink(targetType, targetId, comment.Id);
        const string mentionLink = "/feed";
        var recipientUsers = await _db.Users
            .AsNoTracking()
            .Where(user => user.TenantId == tenantId && recipientIds.Contains(user.Id))
            .Select(user => new { user.Id, user.PreferredLanguage })
            .ToDictionaryAsync(user => user.Id, cancellationToken);
        var deliveries = new List<(int UserId, string Title, string Body, string Type, string Link)>();

        foreach (var mentioned in mentionedUsers)
        {
            var copy = SocialCommentNotificationCopy(
                recipientUsers.GetValueOrDefault(mentioned.Id)?.PreferredLanguage,
                actorName,
                "mention");
            AddSocialCommentNotification(tenantId, mentioned.Id, userId, comment, mentionLink, "mention", copy.Title, copy.Body);
            deliveries.Add((mentioned.Id, copy.Title, copy.Body, "mention", mentionLink));
        }

        if (parentAuthorId is int replyRecipient && replyRecipient != userId)
        {
            var copy = SocialCommentNotificationCopy(
                recipientUsers.GetValueOrDefault(replyRecipient)?.PreferredLanguage,
                actorName,
                "comment_reply");
            AddSocialCommentNotification(tenantId, replyRecipient, userId, comment, link, "comment_reply", copy.Title, copy.Body);
            deliveries.Add((replyRecipient, copy.Title, copy.Body, "comment_reply", link));
        }

        if (targetOwnerId is int ownerId && ownerId != userId)
        {
            var copy = SocialCommentNotificationCopy(
                recipientUsers.GetValueOrDefault(ownerId)?.PreferredLanguage,
                actorName,
                "comment");
            AddSocialCommentNotification(tenantId, ownerId, userId, comment, link, "comment", copy.Title, copy.Body);
            deliveries.Add((ownerId, copy.Title, copy.Body, "comment", link));
        }

        await _db.SaveChangesAsync(cancellationToken);
        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        foreach (var delivery in deliveries)
        {
            try
            {
                await _pushService.SendPushAsync(
                    delivery.UserId,
                    delivery.Title,
                    delivery.Body,
                    JsonSerializer.Serialize(new
                    {
                        type = delivery.Type,
                        comment_id = comment.Id,
                        target_type = targetType,
                        target_id = targetId,
                        link = delivery.Link
                    }),
                    tenantId);
            }
            catch
            {
                // Laravel treats push fan-out as non-critical after the durable
                // comment, mention, and bell transaction has committed.
            }
        }

        var saved = await _db.ThreadedComments
            .AsNoTracking()
            .Include(c => c.Author)
            .FirstAsync(c => c.Id == comment.Id);

        return Ok(new
        {
            data = new
            {
                success = true,
                status = "success",
                comment = MapLegacySocialComment(saved, userId, Array.Empty<ThreadedComment>()),
                is_reply = parentId.HasValue
            }
        });
    }

    private async Task<IActionResult> ToggleLegacyCommentReaction(JsonElement body)
    {
        var tenantId = TenantId();
        var userId = RequireUserId();
        var commentId = ReadInt(body, "target_id") ?? ReadInt(body, "comment_id") ?? 0;
        var reactionType = ReadString(body, "emoji", "reaction_type", "type", "reaction") ?? string.Empty;

        if (commentId <= 0 || string.IsNullOrWhiteSpace(reactionType))
        {
            return BadRequest(new
            {
                errors = new[] { new { code = "VALIDATION_ERROR", message = "Invalid reaction." } }
            });
        }

        if (!LaravelReactionTypes.Contains(reactionType, StringComparer.Ordinal))
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity, new
            {
                errors = new[] { new { code = "VALIDATION_ERROR", message = "Invalid reaction." } }
            });
        }

        var commentExists = await _db.ThreadedComments.AnyAsync(c =>
            c.TenantId == tenantId &&
            c.Id == commentId &&
            !c.IsDeleted);
        if (!commentExists)
        {
            return NotFound(new
            {
                errors = new[] { new { code = "NOT_FOUND", message = "Comment not found." } }
            });
        }

        var action = "added";
        var existing = await _db.CommentReactions.FirstOrDefaultAsync(r =>
            r.TenantId == tenantId &&
            r.CommentId == commentId &&
            r.UserId == userId);
        if (existing != null && existing.ReactionType == reactionType)
        {
            _db.CommentReactions.Remove(existing);
            action = "removed";
        }
        else if (existing != null)
        {
            existing.ReactionType = reactionType;
            existing.UpdatedAt = DateTime.UtcNow;
            action = "updated";
        }
        else
        {
            _db.CommentReactions.Add(new CommentReaction
            {
                TenantId = tenantId,
                CommentId = commentId,
                UserId = userId,
                ReactionType = reactionType,
                CreatedAt = DateTime.UtcNow
            });
        }

        await _db.SaveChangesAsync();

        var reactions = await _db.CommentReactions
            .Where(r => r.TenantId == tenantId && r.CommentId == commentId)
            .GroupBy(r => r.ReactionType)
            .Select(g => new { ReactionType = g.Key, Count = g.Count() })
            .ToDictionaryAsync(r => r.ReactionType, r => r.Count);

        return Ok(new
        {
            data = new
            {
                action,
                reactions
            }
        });
    }

    private static readonly string[] LaravelReactionTypes =
    {
        "love", "like", "laugh", "wow", "sad", "celebrate", "clap", "time_credit"
    };

    private static List<object> BuildLegacySocialCommentTree(IReadOnlyList<ThreadedComment> rows, int userId)
    {
        var children = rows
            .Where(c => c.ParentId.HasValue)
            .GroupBy(c => c.ParentId!.Value)
            .ToDictionary(g => g.Key, g => (IReadOnlyList<ThreadedComment>)g.OrderBy(c => c.CreatedAt).ToList());

        return rows
            .Where(c => c.ParentId == null)
            .OrderBy(c => c.CreatedAt)
            .Select(c => MapLegacySocialComment(c, userId, children.TryGetValue(c.Id, out var replies) ? replies : Array.Empty<ThreadedComment>()))
            .ToList();
    }

    private static object MapLegacySocialComment(ThreadedComment c, int userId, IReadOnlyList<ThreadedComment> replies)
    {
        var authorName = c.Author == null ? null : DisplayName(c.Author.FirstName, c.Author.LastName);
        if (string.IsNullOrWhiteSpace(authorName)) authorName = c.Author?.Email ?? "Unknown user";

        return new
        {
            id = c.Id,
            user_id = c.AuthorId,
            content = c.Content,
            parent_id = c.ParentId,
            created_at = c.CreatedAt,
            updated_at = c.UpdatedAt ?? c.CreatedAt,
            author_name = authorName,
            author_avatar = string.IsNullOrWhiteSpace(c.Author?.AvatarUrl)
                ? "/assets/img/defaults/default_avatar.png"
                : c.Author.AvatarUrl,
            reactions = new Dictionary<string, int>(),
            user_reactions = Array.Empty<string>(),
            is_owner = c.AuthorId == userId,
            is_edited = c.UpdatedAt.HasValue && c.UpdatedAt.Value != c.CreatedAt,
            replies = replies.Select(r => MapLegacySocialComment(r, userId, Array.Empty<ThreadedComment>()))
        };
    }

    private async Task<IActionResult> MuteUserCore(int mutedUserId)
    {
        var tenantId = TenantId();
        var userId = RequireUserId();
        if (mutedUserId <= 0 || mutedUserId == userId)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity, new
            {
                success = false,
                errors = new[]
                {
                    new { code = "INVALID_INPUT", message = "Invalid user." }
                }
            });
        }

        var targetExists = await _db.Users.AnyAsync(u => u.TenantId == tenantId && u.Id == mutedUserId);
        if (!targetExists)
        {
            return NotFound(new
            {
                success = false,
                errors = new[]
                {
                    new { code = "RESOURCE_NOT_FOUND", message = "User not found." }
                }
            });
        }

        if (!await _db.MutedUsers.AnyAsync(m => m.TenantId == tenantId && m.UserId == userId && m.MutedUserId == mutedUserId))
        {
            _db.MutedUsers.Add(new MutedUser
            {
                TenantId = tenantId,
                UserId = userId,
                MutedUserId = mutedUserId,
                MutedAt = DateTime.UtcNow
            });
            await _db.SaveChangesAsync();
        }

        return Ok(new { success = true, data = new { muted = true, user_id = mutedUserId } });
    }

    private async Task<object> ReactionSummary(int postId)
    {
        var rows = await _db.PostReactions.Where(r => r.PostId == postId).ToListAsync();
        return new { data = rows.GroupBy(r => r.ReactionType).Select(g => new { type = g.Key, count = g.Count() }), user_reaction = rows.FirstOrDefault(r => r.UserId == RequireUserId())?.ReactionType };
    }

    private static object MapComment(PostComment c)
    {
        return new
        {
            id = c.Id,
            post_id = c.PostId,
            user_id = c.UserId,
            parent_comment_id = c.ParentCommentId,
            content = c.Content,
            created_at = c.CreatedAt,
            updated_at = c.UpdatedAt
        };
    }

    private RealtimeBootstrapConfig BuildRealtimeConfig(int? userId)
    {
        var key = PusherConfigValue("PUSHER_APP_KEY", "Pusher:Key", "Pusher:AppKey") ?? string.Empty;
        var cluster = PusherConfigValue("PUSHER_APP_CLUSTER", "Pusher:Cluster") ?? "eu";
        var wsHost = PusherConfigValue("PUSHER_HOST", "Pusher:Host") ?? string.Empty;
        var wsPort = int.TryParse(PusherConfigValue("PUSHER_PORT", "Pusher:Port"), out var parsedPort) ? parsedPort : 443;
        var enabled = !string.IsNullOrWhiteSpace(key)
            && !string.IsNullOrWhiteSpace(PusherConfigValue("PUSHER_APP_SECRET", "Pusher:Secret", "Pusher:AppSecret"))
            && !string.IsNullOrWhiteSpace(PusherConfigValue("PUSHER_APP_ID", "Pusher:AppId"));

        return new RealtimeBootstrapConfig
        {
            Driver = "pusher",
            Key = key,
            Cluster = cluster,
            WsHost = wsHost,
            WsPort = wsPort,
            ForceTls = true,
            AuthEndpoint = "/api/pusher/auth",
            Enabled = enabled,
            Channels = userId.HasValue
                ? new Dictionary<string, string>
                {
                    ["user"] = $"private-tenant.{TenantIdOrDefault()}.user.{userId.Value}",
                    ["presence"] = $"presence-tenant.{TenantIdOrDefault()}"
                }
                : null,
            UserId = userId
        };
    }

    private string? PusherConfigValue(string environmentName, params string[] configurationKeys)
    {
        var value = Environment.GetEnvironmentVariable(environmentName);
        if (!string.IsNullOrWhiteSpace(value))
        {
            return value;
        }

        foreach (var key in configurationKeys)
        {
            value = _configuration[key];
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value;
            }
        }

        return null;
    }

    private async Task<UserPresence> UpsertPresenceAsync(int userId, string? platform, string? status, bool preserveManualStatus)
    {
        var tenantId = TenantId();
        var now = DateTime.UtcNow;
        var row = await _db.UserPresences.FirstOrDefaultAsync(p => p.TenantId == tenantId && p.UserId == userId);
        var nextStatus = status;

        if (row != null)
        {
            if (preserveManualStatus)
            {
                nextStatus = row.Status is "dnd" or "do_not_disturb" or "invisible"
                    ? row.Status
                    : "online";
            }

            row.LastSeenAt = now;
            if (!string.IsNullOrWhiteSpace(platform))
            {
                row.Platform = platform;
            }

            if (!string.IsNullOrWhiteSpace(nextStatus))
            {
                row.Status = nextStatus;
            }

            row.UpdatedAt = now;
            await _db.SaveChangesAsync();
            return row;
        }

        row = new UserPresence
        {
            TenantId = tenantId,
            UserId = userId,
            LastSeenAt = now,
            Platform = string.IsNullOrWhiteSpace(platform) ? null : platform,
            Status = string.IsNullOrWhiteSpace(nextStatus) ? "online" : nextStatus,
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.UserPresences.Add(row);
        await _db.SaveChangesAsync();
        return row;
    }

    private async Task<Dictionary<int, PresenceMetadata>> LoadPresenceMetadata(IEnumerable<int> userIds)
    {
        var ids = userIds.Distinct().ToArray();
        if (ids.Length == 0)
        {
            return new Dictionary<int, PresenceMetadata>();
        }

        var keys = ids.Select(PresenceMetadataKey).ToArray();
        var rows = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.TenantId == TenantId() && keys.Contains(c.Key))
            .ToListAsync();

        return rows
            .Select(row => new
            {
                UserId = ParsePresenceMetadataUserId(row.Key),
                Metadata = DeserializePresenceMetadata(row.Value)
            })
            .Where(row => row.UserId.HasValue)
            .ToDictionary(row => row.UserId!.Value, row => row.Metadata);
    }

    private async Task SavePresenceMetadata(int userId, string? customStatus = null, string? emoji = null, bool? hidePresence = null)
    {
        var existing = await LoadPresenceMetadata(new[] { userId });
        existing.TryGetValue(userId, out var current);
        var metadata = new PresenceMetadata
        {
            CustomStatus = customStatus ?? current?.CustomStatus,
            StatusEmoji = emoji ?? current?.StatusEmoji,
            HidePresence = hidePresence ?? current?.HidePresence ?? false
        };

        await UpsertTenantConfig(PresenceMetadataKey(userId), JsonSerializer.Serialize(metadata, StoreJsonOptions));
        await _db.SaveChangesAsync();
    }

    private static object BuildPresencePayload(UserPresence? row, PresenceMetadata? metadata)
    {
        if (metadata?.HidePresence == true || row == null)
        {
            return OfflinePresencePayload();
        }

        var status = ToLaravelPresenceStatus(row.Status);
        if (status != "dnd" && row.LastSeenAt < DateTime.UtcNow.AddMinutes(-15))
        {
            status = "offline";
        }
        else if (status == "online" && row.LastSeenAt < DateTime.UtcNow.AddMinutes(-5))
        {
            status = "away";
        }

        if (status == "offline")
        {
            return OfflinePresencePayload();
        }

        return new
        {
            status,
            last_seen_at = row.LastSeenAt.ToString("O"),
            custom_status = metadata?.CustomStatus,
            status_emoji = metadata?.StatusEmoji
        };
    }

    private static object OfflinePresencePayload() => new
    {
        status = "offline",
        last_seen_at = (string?)null,
        custom_status = (string?)null,
        status_emoji = (string?)null
    };

    private static string? NormalizeLaravelPresenceStatus(string? status)
    {
        return status?.Trim().ToLowerInvariant() switch
        {
            "online" => "online",
            "away" => "away",
            "dnd" => "dnd",
            "do_not_disturb" => "dnd",
            "offline" => "offline",
            _ => null
        };
    }

    private static string ToLaravelPresenceStatus(string? status)
    {
        return status?.Trim().ToLowerInvariant() switch
        {
            "online" => "online",
            "away" => "away",
            "dnd" => "dnd",
            "do_not_disturb" => "dnd",
            "invisible" => "offline",
            "offline" => "offline",
            _ => "offline"
        };
    }

    private static string? TruncatePresenceText(string? value, int maxLength)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var trimmed = value.Trim();
        return trimmed.Length <= maxLength ? trimmed : trimmed[..maxLength];
    }

    private static string PresenceMetadataKey(int userId) => $"presence.metadata.{userId}";

    private static int? ParsePresenceMetadataUserId(string key)
    {
        var prefix = PresenceMetadataKey(0)[..^1];
        return key.StartsWith(prefix, StringComparison.Ordinal)
            && int.TryParse(key[prefix.Length..], out var userId)
            ? userId
            : null;
    }

    private static PresenceMetadata DeserializePresenceMetadata(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return new PresenceMetadata();
        }

        try
        {
            return JsonSerializer.Deserialize<PresenceMetadata>(raw, StoreJsonOptions) ?? new PresenceMetadata();
        }
        catch (JsonException)
        {
            return new PresenceMetadata();
        }
    }

    private int RequireUserId() => User.GetUserId() ?? throw new UnauthorizedAccessException("Invalid token");

    private int TenantId() => _tenantContext.GetTenantIdOrThrow();

    private async Task<IActionResult> ToggleLaravelShareAsync(string type, int id, string? comment = null)
    {
        if (!LaravelShareableTargetTypes.Contains(type))
        {
            return LaravelShareError("INVALID_INPUT", "Invalid shareable type.", 422);
        }

        if (!await FeedTrackingTargetExistsAsync(type, id))
        {
            return LaravelShareError("NOT_FOUND", "Target not found.", 404);
        }

        var userId = RequireUserId();
        var existing = await _db.PostShares.FirstOrDefaultAsync(s =>
            s.UserId == userId &&
            s.OriginalType == type &&
            s.OriginalPostId == id);

        if (existing != null)
        {
            _db.PostShares.Remove(existing);
            await _db.SaveChangesAsync();
            return LaravelShareData(new
            {
                shared = false,
                count = await ShareCountAsync(type, id),
                share_id = (int?)null,
                type,
                id
            });
        }

        var ownerId = await ResolveLaravelShareOwnerIdAsync(type, id);
        if (ownerId == userId)
        {
            return LaravelShareError("SELF_SHARE", "Cannot share your own post.", 422);
        }

        var share = new PostShare
        {
            TenantId = TenantId(),
            UserId = userId,
            PostId = type == "post" ? id : 0,
            OriginalType = type,
            OriginalPostId = id,
            Comment = SanitizeShareComment(comment),
            SharedTo = PostShare.Channels.Internal,
            CreatedAt = DateTime.UtcNow
        };

        _db.PostShares.Add(share);
        await _db.SaveChangesAsync();

        return LaravelShareData(new
        {
            shared = true,
            count = await ShareCountAsync(type, id),
            share_id = (int?)share.Id,
            type,
            id
        }, StatusCodes.Status201Created);
    }

    private async Task<IActionResult> UnshareLaravelTargetAsync(string type, int id)
    {
        if (!LaravelShareableTargetTypes.Contains(type))
        {
            return LaravelShareError("INVALID_INPUT", "Invalid shareable type.", 422);
        }

        var userId = RequireUserId();
        var existing = await _db.PostShares.FirstOrDefaultAsync(s =>
            s.UserId == userId &&
            s.OriginalType == type &&
            s.OriginalPostId == id);

        if (existing != null)
        {
            _db.PostShares.Remove(existing);
            await _db.SaveChangesAsync();
        }

        return LaravelShareData(new
        {
            shared = false,
            count = await ShareCountAsync(type, id),
            type,
            id
        });
    }

    private async Task<int> ShareCountAsync(string type, int id)
    {
        return await _db.PostShares.CountAsync(s => s.OriginalType == type && s.OriginalPostId == id);
    }

    private async Task<int?> ResolveLaravelShareOwnerIdAsync(string type, int id)
    {
        var tenantId = TenantId();
        return type switch
        {
            "post" => await _db.FeedPosts.Where(p => p.TenantId == tenantId && p.Id == id).Select(p => (int?)p.UserId).FirstOrDefaultAsync(),
            "listing" => await _db.Listings.Where(l => l.TenantId == tenantId && l.Id == id).Select(l => (int?)l.UserId).FirstOrDefaultAsync(),
            "event" => await _db.Events.Where(e => e.TenantId == tenantId && e.Id == id).Select(e => (int?)e.CreatedById).FirstOrDefaultAsync(),
            "poll" => await _db.Polls.Where(p => p.TenantId == tenantId && p.Id == id).Select(p => (int?)p.CreatedById).FirstOrDefaultAsync(),
            "job" => await _db.JobVacancies.Where(j => j.TenantId == tenantId && j.Id == id).Select(j => (int?)j.PostedByUserId).FirstOrDefaultAsync(),
            "blog" => await _db.BlogPosts.Where(b => b.TenantId == tenantId && b.Id == id).Select(b => (int?)b.AuthorId).FirstOrDefaultAsync(),
            "discussion" => await _db.GroupDiscussions.Where(d => d.TenantId == tenantId && d.Id == id).Select(d => (int?)d.AuthorId).FirstOrDefaultAsync(),
            "goal" => await _db.Goals.Where(g => g.TenantId == tenantId && g.Id == id).Select(g => (int?)g.UserId).FirstOrDefaultAsync(),
            "volunteer" => await _db.VolunteerOpportunities.Where(v => v.TenantId == tenantId && v.Id == id).Select(v => (int?)v.OrganizerId).FirstOrDefaultAsync(),
            "challenge" => await _db.Challenges.AnyAsync(c => c.TenantId == tenantId && c.Id == id) ? -1 : null,
            _ => null
        };
    }

    private IActionResult LaravelShareData(object data, int status = StatusCodes.Status200OK)
    {
        return StatusCode(status, new
        {
            data,
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    private IActionResult LaravelShareError(string code, string message, int status)
    {
        return StatusCode(status, new
        {
            errors = new[]
            {
                new { code, message }
            }
        });
    }

    private static string? DisplayName(string? firstName, string? lastName)
    {
        var name = $"{firstName} {lastName}".Trim();
        return string.IsNullOrWhiteSpace(name) ? null : name;
    }

    private static string? SanitizeShareComment(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var chars = new List<char>(value.Length);
        var insideTag = false;
        foreach (var c in value)
        {
            if (c == '<')
            {
                insideTag = true;
                continue;
            }

            if (c == '>')
            {
                insideTag = false;
                continue;
            }

            if (!insideTag)
            {
                chars.Add(c);
            }
        }

        var stripped = new string(chars.ToArray()).Trim();
        return stripped.Length == 0 ? null : stripped[..Math.Min(stripped.Length, 1000)];
    }

    private async Task<IActionResult> HideFeedItem(int? id, JsonElement body, bool includeHiddenFlag)
    {
        var targetId = id ?? ReadRequiredInt(body, "post_id", "postId", "target_id", "id");
        var targetType = NormalizeLegacyFeedHideType(ReadString(body, "type", "target_type"));

        if (targetId <= 0)
        {
            return BadRequest(new
            {
                errors = new[]
                {
                    new { code = "VALIDATION_ERROR", message = "Invalid target.", field = "target_id" }
                }
            });
        }

        if (!await FeedTrackingTargetExistsAsync(targetType, targetId))
        {
            return NotFound(new
            {
                errors = new[]
                {
                    new { code = "RESOURCE_NOT_FOUND", message = "Target not found." }
                }
            });
        }

        var tenantId = TenantId();
        var userId = RequireUserId();
        if (targetType == "post")
        {
            if (!await _db.HiddenPosts.AnyAsync(h => h.TenantId == tenantId && h.PostId == targetId && h.UserId == userId))
            {
                _db.HiddenPosts.Add(new HiddenPost
                {
                    TenantId = tenantId,
                    PostId = targetId,
                    UserId = userId,
                    HiddenAt = DateTime.UtcNow
                });
            }
        }
        else
        {
            await UpsertTenantConfig(
                FeedHiddenKey(userId, targetType, targetId),
                JsonSerializer.Serialize(new
                {
                    user_id = userId,
                    target_type = targetType,
                    target_id = targetId,
                    created_at = DateTime.UtcNow
                }, StoreJsonOptions));
        }

        await _db.SaveChangesAsync();

        return includeHiddenFlag
            ? Ok(new { success = true, data = new { hidden = true, post_id = targetId } })
            : Ok(new { success = true, data = new { success = true, post_id = targetId } });
    }

    private async Task<IActionResult> ReportFeedTarget(string targetType, int targetId, JsonElement body)
    {
        if (!LaravelFeedTrackingTargetTypes.Contains(targetType))
        {
            return BadRequest(new
            {
                success = false,
                errors = new[]
                {
                    new { code = "VALIDATION_ERROR", message = "Invalid target type.", field = "target_type" }
                }
            });
        }

        if (targetId <= 0 || !await FeedTrackingTargetExistsAsync(targetType, targetId))
        {
            return NotFound(new
            {
                success = false,
                errors = new[]
                {
                    new { code = "RESOURCE_NOT_FOUND", message = "Target not found." }
                }
            });
        }

        var reasonText = ReadString(body, "reason")?.Trim();
        if (string.IsNullOrWhiteSpace(reasonText))
        {
            return BadRequest(new
            {
                success = false,
                errors = new[]
                {
                    new { code = "VALIDATION_REQUIRED_FIELD", message = "Reason is required.", field = "reason" }
                }
            });
        }

        reasonText = reasonText[..Math.Min(reasonText.Length, 1000)];
        var tenantId = TenantId();
        var userId = RequireUserId();
        var alreadyReported = await _db.ContentReports.AnyAsync(r =>
            r.TenantId == tenantId &&
            r.ReporterId == userId &&
            r.ContentType == targetType &&
            r.ContentId == targetId &&
            r.Status != ReportStatus.Dismissed);

        if (alreadyReported)
        {
            return Conflict(new
            {
                success = false,
                errors = new[]
                {
                    new { code = "DUPLICATE", message = "Already reported." }
                }
            });
        }

        _db.ContentReports.Add(new ContentReport
        {
            TenantId = tenantId,
            ReporterId = userId,
            ContentType = targetType,
            ContentId = targetId,
            Reason = NormalizeContentReportReason(reasonText),
            Description = ReadString(body, "details", "description"),
            Status = ReportStatus.Pending,
            CreatedAt = DateTime.UtcNow
        });

        if (targetType == "post" && !await _db.FeedReports.AnyAsync(r =>
                r.TenantId == tenantId &&
                r.ReporterId == userId &&
                r.PostId == targetId))
        {
            _db.FeedReports.Add(new FeedReport
            {
                TenantId = tenantId,
                PostId = targetId,
                ReporterId = userId,
                Reason = reasonText,
                Details = ReadString(body, "details", "description"),
                Status = "pending",
                CreatedAt = DateTime.UtcNow
            });
        }

        await _db.SaveChangesAsync();

        return Ok(new
        {
            success = true,
            data = new
            {
                reported = true,
                target_type = targetType,
                target_id = targetId
            }
        });
    }

    private async Task<bool> FeedTrackingTargetExistsAsync(string targetType, int targetId)
    {
        var tenantId = TenantId();

        return targetType switch
        {
            "post" => await _db.FeedPosts.AnyAsync(p => p.TenantId == tenantId && p.Id == targetId && !p.IsHidden),
            "comment" => await _db.PostComments.AnyAsync(c => c.TenantId == tenantId && c.Id == targetId),
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

    private async Task<List<CommentMentionRecipient>> ResolveCommentMentionUsersAsync(
        string content,
        int tenantId,
        int mentioningUserId,
        CancellationToken cancellationToken)
    {
        var handles = Regex.Matches(content, "@([A-Za-z0-9_.-]+)")
            .Select(match => match.Groups[1].Value)
            .Where(handle => !string.IsNullOrWhiteSpace(handle))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
        if (handles.Length == 0)
        {
            return [];
        }

        var candidates = await _db.Users
            .AsNoTracking()
            .Where(user => user.TenantId == tenantId && user.IsActive && user.Id != mentioningUserId)
            .Select(user => new
            {
                user.Id,
                user.Username,
                user.Email,
                user.FirstName,
                user.LastName
            })
            .ToListAsync(cancellationToken);

        var resolved = new List<CommentMentionRecipient>();
        foreach (var handle in handles)
        {
            var candidate = candidates.FirstOrDefault(user =>
                string.Equals(user.Username, handle, StringComparison.OrdinalIgnoreCase))
                ?? candidates.FirstOrDefault(user =>
                    string.Equals(user.Email.Split('@')[0], handle, StringComparison.OrdinalIgnoreCase))
                ?? candidates.FirstOrDefault(user =>
                    string.Equals(
                        $"{user.FirstName}{user.LastName}".Replace(" ", string.Empty),
                        handle,
                        StringComparison.OrdinalIgnoreCase));
            if (candidate is not null && resolved.All(user => user.Id != candidate.Id))
            {
                resolved.Add(new CommentMentionRecipient(candidate.Id));
            }
        }

        return resolved;
    }

    private async Task<int?> ResolveCommentTargetOwnerIdAsync(
        string targetType,
        int targetId,
        CancellationToken cancellationToken)
    {
        var tenantId = TenantId();
        return targetType switch
        {
            "post" => await _db.FeedPosts.Where(row => row.TenantId == tenantId && row.Id == targetId).Select(row => (int?)row.UserId).FirstOrDefaultAsync(cancellationToken),
            "comment" => await _db.PostComments.Where(row => row.TenantId == tenantId && row.Id == targetId).Select(row => (int?)row.UserId).FirstOrDefaultAsync(cancellationToken),
            "listing" => await _db.Listings.Where(row => row.TenantId == tenantId && row.Id == targetId).Select(row => (int?)row.UserId).FirstOrDefaultAsync(cancellationToken),
            "event" => await _db.Events.Where(row => row.TenantId == tenantId && row.Id == targetId).Select(row => (int?)row.CreatedById).FirstOrDefaultAsync(cancellationToken),
            "goal" => await _db.Goals.Where(row => row.TenantId == tenantId && row.Id == targetId).Select(row => (int?)row.UserId).FirstOrDefaultAsync(cancellationToken),
            "poll" => await _db.Polls.Where(row => row.TenantId == tenantId && row.Id == targetId).Select(row => (int?)row.CreatedById).FirstOrDefaultAsync(cancellationToken),
            "review" => await _db.Reviews.Where(row => row.TenantId == tenantId && row.Id == targetId).Select(row => (int?)row.ReviewerId).FirstOrDefaultAsync(cancellationToken),
            "volunteer" => await _db.VolunteerOpportunities.Where(row => row.TenantId == tenantId && row.Id == targetId).Select(row => (int?)row.OrganizerId).FirstOrDefaultAsync(cancellationToken),
            "resource" => await _db.Resources.Where(row => row.TenantId == tenantId && row.Id == targetId).Select(row => (int?)row.CreatedById).FirstOrDefaultAsync(cancellationToken),
            "job" => await _db.JobVacancies.Where(row => row.TenantId == tenantId && row.Id == targetId).Select(row => (int?)row.PostedByUserId).FirstOrDefaultAsync(cancellationToken),
            "blog" => await _db.BlogPosts.Where(row => row.TenantId == tenantId && row.Id == targetId).Select(row => (int?)row.AuthorId).FirstOrDefaultAsync(cancellationToken),
            "discussion" => await _db.GroupDiscussions.Where(row => row.TenantId == tenantId && row.Id == targetId).Select(row => (int?)row.AuthorId).FirstOrDefaultAsync(cancellationToken),
            _ => null
        };
    }

    private void AddSocialCommentNotification(
        int tenantId,
        int recipientId,
        int actorId,
        ThreadedComment comment,
        string link,
        string type,
        string title,
        string body)
    {
        _db.Notifications.Add(new Notification
        {
            TenantId = tenantId,
            UserId = recipientId,
            Type = type,
            Title = title,
            Body = body,
            Link = link,
            Data = JsonSerializer.Serialize(new
            {
                actor_id = actorId,
                comment_id = comment.Id,
                target_type = comment.TargetType,
                target_id = comment.TargetId
            }),
            CreatedAt = comment.CreatedAt
        });
    }

    private static (string Title, string Body) SocialCommentNotificationCopy(
        string? locale,
        string actorName,
        string type)
    {
        var language = string.IsNullOrWhiteSpace(locale)
            ? "en"
            : locale.Trim().Split('-', '_')[0].ToLowerInvariant();
        return (language, type) switch
        {
            ("de", "mention") => ("Neue Erwähnung", $"{actorName} hat Sie in einem Kommentar erwähnt."),
            ("de", "comment_reply") => ("Neue Antwort", $"{actorName} hat auf Ihren Kommentar geantwortet."),
            ("de", _) => ("Neuer Kommentar", $"{actorName} hat Ihren Inhalt kommentiert."),
            ("es", "mention") => ("Nueva mención", $"{actorName} te mencionó en un comentario."),
            ("es", "comment_reply") => ("Nueva respuesta", $"{actorName} respondió a tu comentario."),
            ("es", _) => ("Nuevo comentario", $"{actorName} comentó tu contenido."),
            ("fr", "mention") => ("Nouvelle mention", $"{actorName} vous a mentionné dans un commentaire."),
            ("fr", "comment_reply") => ("Nouvelle réponse", $"{actorName} a répondu à votre commentaire."),
            ("fr", _) => ("Nouveau commentaire", $"{actorName} a commenté votre contenu."),
            ("ga", "mention") => ("Lua nua", $"Luaigh {actorName} thú i nóta tráchta."),
            ("ga", "comment_reply") => ("Freagra nua", $"D'fhreagair {actorName} do nóta tráchta."),
            ("ga", _) => ("Nóta tráchta nua", $"Rinne {actorName} trácht ar d'ábhar."),
            (_, "mention") => ("New mention", $"{actorName} mentioned you in a comment."),
            (_, "comment_reply") => ("New reply", $"{actorName} replied to your comment."),
            _ => ("New comment", $"{actorName} commented on your content.")
        };
    }

    private static string SocialCommentLink(string targetType, int targetId, int commentId) => targetType switch
    {
        "post" => $"/feed/posts/{targetId}#comment-{commentId}",
        "listing" => $"/listings/{targetId}#comment-{commentId}",
        "event" => $"/events/{targetId}#comment-{commentId}",
        "goal" => $"/goals/{targetId}#comment-{commentId}",
        "poll" => $"/polls#comment-{commentId}",
        "resource" => $"/resources#comment-{commentId}",
        "volunteer" => $"/volunteering/opportunities/{targetId}#comment-{commentId}",
        "challenge" => $"/ideation/{targetId}#comment-{commentId}",
        "review" => $"/reviews#comment-{commentId}",
        "job" => $"/jobs/{targetId}#comment-{commentId}",
        "blog" => $"/blog/{targetId}#comment-{commentId}",
        "discussion" => $"/groups/discussions/{targetId}#comment-{commentId}",
        _ => "/feed"
    };

    private sealed record CommentMentionRecipient(int Id);

    private static string NormalizeLegacyFeedTrackingType(string? targetType)
    {
        var normalized = string.IsNullOrWhiteSpace(targetType)
            ? "post"
            : targetType.Trim().ToLowerInvariant();

        return LaravelFeedTrackingTargetTypes.Contains(normalized) ? normalized : "post";
    }

    private static string NormalizeLegacyFeedHideType(string? targetType)
    {
        var normalized = string.IsNullOrWhiteSpace(targetType)
            ? "post"
            : targetType.Trim().ToLowerInvariant();

        if (normalized == "volunteering")
        {
            normalized = "volunteer";
        }

        return LaravelFeedHideTargetTypes.Contains(normalized) ? normalized : "post";
    }

    private static string NormalizeLegacyFeedReportType(string? targetType)
    {
        var normalized = string.IsNullOrWhiteSpace(targetType)
            ? "post"
            : targetType.Trim().ToLowerInvariant();

        return normalized == "volunteering" ? "volunteer" : normalized;
    }

    private static string FeedHiddenKey(int userId, string targetType, int targetId) =>
        $"feed.hidden.{userId}.{targetType}.{targetId}";

    private static ReportReason NormalizeContentReportReason(string reason)
    {
        return reason.Trim().ToLowerInvariant() switch
        {
            "spam" => ReportReason.Spam,
            "harassment" or "abuse" => ReportReason.Harassment,
            "inappropriate" or "offensive" => ReportReason.Inappropriate,
            "fraud" or "scam" => ReportReason.Fraud,
            "safety" or "safety_concern" => ReportReason.SafetyConcern,
            _ => ReportReason.Other
        };
    }

    private async Task<User> CurrentUserAsync()
    {
        var userId = RequireUserId();
        return await _db.Users.FirstOrDefaultAsync(u => u.Id == userId && u.TenantId == TenantId())
            ?? throw new UnauthorizedAccessException("Invalid token");
    }

    private int TenantIdOrDefault()
    {
        try
        {
            return _tenantContext.GetTenantIdOrThrow();
        }
        catch (InvalidOperationException)
        {
            return 1;
        }
    }

    private static object MapFeedPageCandidate(FeedPageCandidate candidate)
    {
        var author = candidate.AuthorId is int authorId
            ? new
            {
                id = authorId,
                name = candidate.AuthorName,
                avatar_url = candidate.AuthorAvatarUrl
            }
            : null;

        if (candidate.IsFeedPost)
        {
            // Keep the established ASP post payload byte-for-byte compatible at
            // the property level while the canonical activity projection is
            // introduced alongside it.
            return new
            {
                id = candidate.SourceId,
                type = FeedActivitySourceTypes.Post,
                content = candidate.Content,
                image_url = candidate.ImageUrl,
                group_id = candidate.GroupId,
                user_id = candidate.UserId,
                author,
                likes_count = candidate.LikesCount,
                comments_count = candidate.CommentsCount,
                is_liked = candidate.IsLiked,
                created_at = candidate.CreatedAt,
                updated_at = candidate.UpdatedAt
            };
        }

        var volunteerMetadata = candidate.SourceType == FeedActivitySourceTypes.VolunteerHours
            ? ReadVolunteerHoursFeedMetadata(candidate.Metadata)
            : default;
        return new
        {
            id = candidate.SourceId,
            type = candidate.SourceType,
            title = candidate.Title,
            content = candidate.Content,
            image_url = candidate.ImageUrl,
            group_id = candidate.GroupId,
            user_id = candidate.UserId,
            author,
            likes_count = 0,
            comments_count = 0,
            is_liked = false,
            created_at = candidate.CreatedAt,
            organization = volunteerMetadata.Organization,
            hours = volunteerMetadata.Hours
        };
    }

    private static VolunteerHoursFeedMetadata ReadVolunteerHoursFeedMetadata(string? metadata)
    {
        if (string.IsNullOrWhiteSpace(metadata))
        {
            return default;
        }

        try
        {
            using var document = JsonDocument.Parse(metadata);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                return default;
            }

            decimal? hours = null;
            if (document.RootElement.TryGetProperty("hours", out var hoursValue))
            {
                if (hoursValue.ValueKind == JsonValueKind.Number && hoursValue.TryGetDecimal(out var numericHours))
                {
                    hours = numericHours;
                }
                else if (hoursValue.ValueKind == JsonValueKind.String
                    && decimal.TryParse(
                        hoursValue.GetString(),
                        NumberStyles.Number,
                        CultureInfo.InvariantCulture,
                        out numericHours))
                {
                    hours = numericHours;
                }
            }

            var organization = document.RootElement.TryGetProperty("organization", out var organizationValue)
                && organizationValue.ValueKind == JsonValueKind.String
                    ? organizationValue.GetString()
                    : null;
            return new VolunteerHoursFeedMetadata(hours, organization);
        }
        catch (JsonException)
        {
            // A malformed historical metadata blob must not make the whole feed
            // unavailable. Its display-only metadata is omitted instead.
            return default;
        }
    }

    private static object PageMeta(int page, int limit, int total) => new { page, limit, total, pages = (int)Math.Ceiling(total / (double)limit) };

    private static int? DecodeFeedCursor(string? cursor)
    {
        if (string.IsNullOrWhiteSpace(cursor))
        {
            return null;
        }

        if (int.TryParse(cursor, out var directId))
        {
            return directId;
        }

        try
        {
            var decoded = Encoding.UTF8.GetString(Convert.FromBase64String(cursor));
            return int.TryParse(decoded, out var id) ? id : null;
        }
        catch (FormatException)
        {
            return null;
        }
    }

    private static string EncodeFeedCursor(int id) => Convert.ToBase64String(Encoding.UTF8.GetBytes(id.ToString()));

    private async Task<IActionResult> UpdateLaravelNotificationSettings(JsonElement body)
    {
        if (TryGet(body, "push_enabled", out var pushValue))
        {
            var enabled = ReadBool(body, "push_enabled") ?? (pushValue.ValueKind == JsonValueKind.Number && pushValue.GetInt32() != 0);
            var user = await CurrentUserAsync();
            var bag = ParseNotificationPreferenceBag(user.NotificationPreferences);
            bag["push_enabled"] = enabled;
            user.NotificationPreferences = bag.ToJsonString(StoreJsonOptions);
            user.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
            return Ok(new { success = true, data = new { push_enabled = enabled } });
        }

        var contextType = ReadString(body, "context_type", "contextType")?.Trim().ToLowerInvariant();
        var frequency = NormalizeNotificationFrequency(ReadString(body, "frequency"));
        var contextId = contextType == "global" ? 0 : ReadInt(body, "context_id", "contextId");
        var errors = new List<object>();

        if (contextType is not ("global" or "group" or "thread"))
        {
            errors.Add(ValidationError("context_type", "Context type must be global, group, or thread."));
        }

        if (frequency == null)
        {
            errors.Add(ValidationError("frequency", "Frequency must be instant, daily, weekly, monthly, or off."));
        }

        if (contextType is "group" or "thread" && (!contextId.HasValue || contextId.Value <= 0))
        {
            errors.Add(ValidationError("context_id", "Context id is required for group and thread notification settings."));
        }

        if (errors.Count > 0)
        {
            return UnprocessableEntity(new { success = false, errors });
        }

        var key = $"{NotificationSettingPrefix(RequireUserId())}{contextType}.{contextId ?? 0}";
        await UpsertTenantConfig(key, frequency!);
        await _db.SaveChangesAsync();

        return Ok(new
        {
            success = true,
            data = new
            {
                context_type = contextType,
                context_id = contextId ?? 0,
                frequency
            }
        });
    }

    private static JsonObject ParseNotificationPreferenceBag(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return new JsonObject();
        }

        try
        {
            return JsonNode.Parse(raw) as JsonObject ?? new JsonObject();
        }
        catch (JsonException)
        {
            return new JsonObject();
        }
    }

    private static Dictionary<string, bool> BuildLaravelNotificationPreferenceData(JsonObject bag)
    {
        return LaravelNotificationPreferenceDefaults.ToDictionary(
            pair => pair.Key,
            pair => ReadPreferenceBool(bag, pair.Key, pair.Value));
    }

    private static bool ReadPreferenceBool(JsonObject bag, string key, bool defaultValue)
    {
        if (!bag.TryGetPropertyValue(key, out var node) || node is null)
        {
            return defaultValue;
        }

        try
        {
            if (node is JsonValue value)
            {
                if (value.TryGetValue<bool>(out var boolValue)) return boolValue;
                if (value.TryGetValue<int>(out var intValue)) return intValue != 0;
                if (value.TryGetValue<long>(out var longValue)) return longValue != 0;
                if (value.TryGetValue<string>(out var stringValue) && bool.TryParse(stringValue, out var parsed)) return parsed;
            }
        }
        catch (InvalidOperationException)
        {
            return defaultValue;
        }

        return defaultValue;
    }

    private async Task<List<SupportReportCompatRecord>> LoadAllSupportReports()
    {
        var raw = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.Key == SupportReportsKey)
            .Select(c => c.Value)
            .FirstOrDefaultAsync();

        if (string.IsNullOrWhiteSpace(raw))
        {
            return new List<SupportReportCompatRecord>();
        }

        try
        {
            return JsonSerializer.Deserialize<List<SupportReportCompatRecord>>(raw, StoreJsonOptions) ?? new List<SupportReportCompatRecord>();
        }
        catch (JsonException)
        {
            return new List<SupportReportCompatRecord>();
        }
    }

    private async Task SaveAllSupportReports(List<SupportReportCompatRecord> reports)
    {
        var json = JsonSerializer.Serialize(reports.OrderBy(r => r.Id).ToList(), StoreJsonOptions);
        await UpsertTenantConfig(SupportReportsKey, json);
        await _db.SaveChangesAsync();
    }

    private async Task UpsertTenantConfig(string key, string value)
    {
        var tenantId = TenantId();
        var existing = await _db.TenantConfigs.FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == key);
        if (existing != null)
        {
            existing.Value = value;
            existing.UpdatedAt = DateTime.UtcNow;
            return;
        }

        _db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenantId,
            Key = key,
            Value = value,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        });
    }

    private static string? NormalizeNotificationFrequency(string? frequency)
    {
        return frequency?.Trim().ToLowerInvariant() switch
        {
            "instant" => "instant",
            "daily" => "daily",
            "weekly" => "monthly",
            "monthly" => "monthly",
            "off" => "off",
            _ => null
        };
    }

    private static string? NormalizeMatchNotificationFrequency(string? frequency) => frequency?.Trim().ToLowerInvariant() switch
    {
        "daily" => "daily", "weekly" => "monthly", "monthly" => "monthly", "fortnightly" => "fortnightly", "never" => "never", _ => null
    };

    private static bool TryFlexibleBoolean(JsonElement body, string name, out bool value)
    {
        value = false;
        if (!TryGet(body, name, out var element)) return false;
        if (element.ValueKind is JsonValueKind.True or JsonValueKind.False) { value = element.GetBoolean(); return true; }
        if (element.ValueKind == JsonValueKind.Number && element.TryGetInt32(out var number) && number is 0 or 1) { value = number == 1; return true; }
        if (element.ValueKind == JsonValueKind.String)
        {
            var text = element.GetString()?.Trim().ToLowerInvariant();
            if (text is "true" or "1" or "yes" or "on") { value = true; return true; }
            if (text is "false" or "0" or "no" or "off") return true;
        }
        return false;
    }

    private IActionResult NotificationValidation(string field) => UnprocessableEntity(new { success = false, errors = new[] { new { code = "VALIDATION_ERROR", message = "Notification settings are invalid", field } } });

    private static string NotificationSettingPrefix(int userId) => $"notification_settings.{userId}.";

    private static JsonElement? NormalizeDiagnostics(JsonElement body, DateTime capturedAt)
    {
        if (!TryGet(body, "diagnostics", out var diagnostics) || diagnostics.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return JsonSerializer.SerializeToElement(new Dictionary<string, object?>
        {
            ["captured_at"] = capturedAt.ToString("O"),
            ["payload"] = NormalizeDiagnosticValue(diagnostics)
        }, StoreJsonOptions);
    }

    private static object? NormalizeDiagnosticValue(JsonElement value, string? propertyName = null, int depth = 0)
    {
        if (IsSensitiveDiagnosticKey(propertyName))
        {
            return "[filtered]";
        }

        if (depth >= 6)
        {
            return "[truncated]";
        }

        return value.ValueKind switch
        {
            JsonValueKind.Object => value.EnumerateObject().ToDictionary(
                property => IsSensitiveDiagnosticKey(property.Name) ? "[filtered]" : property.Name,
                property => NormalizeDiagnosticValue(property.Value, property.Name, depth + 1)),
            JsonValueKind.Array => value.EnumerateArray().Select(item => NormalizeDiagnosticValue(item, null, depth + 1)).ToList(),
            JsonValueKind.String => RedactDiagnosticString(value.GetString()),
            JsonValueKind.Number => value.TryGetInt64(out var integer) ? integer : value.GetDouble(),
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Null => null,
            _ => value.ToString()
        };
    }

    private static string? RedactDiagnosticString(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return value;
        }

        var normalized = value.ToLowerInvariant();
        return normalized.Contains("bearer ") || normalized.Contains("secret") || normalized.Contains("token=")
            ? "[filtered]"
            : value;
    }

    private static bool IsSensitiveDiagnosticKey(string? key)
    {
        if (string.IsNullOrWhiteSpace(key))
        {
            return false;
        }

        var normalized = key.ToLowerInvariant();
        return normalized.Contains("authorization")
            || normalized.Contains("password")
            || normalized.Contains("secret")
            || normalized.Contains("token")
            || normalized.Contains("cookie");
    }

    private static object ValidationError(string field, string message) => new { field, message };

    private static int CalculateCouponDiscountCents(MerchantCoupon coupon, int orderTotalCents)
    {
        return coupon.DiscountType switch
        {
            "percent" => (int)Math.Round(orderTotalCents * Math.Clamp(coupon.DiscountAmount, 0m, 100m) / 100m),
            "fixed" => Math.Min(orderTotalCents, Math.Max(0, (int)Math.Round(coupon.DiscountAmount))),
            "bogo" => (int)Math.Round(orderTotalCents / 2m),
            _ => 0
        };
    }

    private static object MapCoupon(MerchantCoupon coupon) => new
    {
        id = coupon.Id,
        seller_id = coupon.SellerUserId,
        code = coupon.Code,
        title = coupon.Title,
        description = string.IsNullOrWhiteSpace(coupon.Description) ? null : coupon.Description,
        discount_type = coupon.DiscountType,
        discount_value = coupon.DiscountAmount,
        min_order_cents = coupon.MinOrderCents,
        max_uses = coupon.MaxUses,
        max_uses_per_member = coupon.MaxUsesPerMember <= 0 ? 1 : coupon.MaxUsesPerMember,
        valid_from = coupon.ValidFrom,
        valid_until = coupon.ExpiresAt,
        status = coupon.Status,
        applies_to = string.IsNullOrWhiteSpace(coupon.AppliesTo) ? "all_listings" : coupon.AppliesTo,
        usage_count = coupon.UsageCount,
        created_at = coupon.CreatedAt
    };

    private static string? ReadString(JsonElement body, params string[] names)
    {
        foreach (var name in names)
        {
            if (TryGet(body, name, out var value))
            {
                return value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString();
            }
        }

        return null;
    }

    private static int? ReadInt(JsonElement body, params string[] names)
    {
        foreach (var name in names)
        {
            if (TryGet(body, name, out var value))
            {
                if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number)) return number;
                if (value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), out number)) return number;
            }
        }

        return null;
    }

    private static int ReadRequiredInt(JsonElement body, params string[] names)
    {
        return ReadInt(body, names) ?? throw new BadHttpRequestException($"{string.Join("/", names)} is required");
    }

    private int ReadQueryInt(string name, int defaultValue, int min, int max)
    {
        if (!Request.Query.TryGetValue(name, out var raw) || !int.TryParse(raw.ToString(), out var value))
        {
            value = defaultValue;
        }

        return Math.Clamp(value, min, max);
    }

    private static bool? ReadBool(JsonElement body, params string[] names)
    {
        foreach (var name in names)
        {
            if (TryGet(body, name, out var value))
            {
                if (value.ValueKind is JsonValueKind.True or JsonValueKind.False) return value.GetBoolean();
                if (value.ValueKind == JsonValueKind.String && bool.TryParse(value.GetString(), out var flag)) return flag;
            }
        }

        return null;
    }

    private static DateTime? ReadDate(JsonElement body, params string[] names)
    {
        foreach (var name in names)
        {
            if (TryGet(body, name, out var value) && value.ValueKind == JsonValueKind.String && DateTime.TryParse(value.GetString(), out var date))
            {
                return date.ToUniversalTime();
            }
        }

        return null;
    }

    private static bool TryGet(JsonElement body, string name, out JsonElement value)
    {
        if (body.ValueKind == JsonValueKind.Object && body.TryGetProperty(name, out value))
        {
            return true;
        }

        value = default;
        return false;
    }

    private sealed class FeedPageCandidate
    {
        public bool IsFeedPost { get; set; }
        public bool IsPinned { get; set; }
        public long SortId { get; set; }
        public int SourceId { get; set; }
        public string SourceType { get; set; } = string.Empty;
        public string? Title { get; set; }
        public string? Content { get; set; }
        public string? ImageUrl { get; set; }
        public int? GroupId { get; set; }
        public int UserId { get; set; }
        public int? AuthorId { get; set; }
        public string? AuthorName { get; set; }
        public string? AuthorAvatarUrl { get; set; }
        public int LikesCount { get; set; }
        public int CommentsCount { get; set; }
        public bool IsLiked { get; set; }
        public string? Metadata { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime? UpdatedAt { get; set; }
    }

    private readonly record struct VolunteerHoursFeedMetadata(
        decimal? Hours,
        string? Organization);

    private sealed class SupportReportCompatRecord
    {
        public int Id { get; set; }
        public int TenantId { get; set; }
        public int? UserId { get; set; }
        public int? AssignedUserId { get; set; }
        public string Reference { get; set; } = string.Empty;
        public string Source { get; set; } = "in_app";
        public string Summary { get; set; } = string.Empty;
        public string Description { get; set; } = string.Empty;
        public string Impact { get; set; } = "minor";
        public string Status { get; set; } = "open";
        public string? Module { get; set; }
        public string? Route { get; set; }
        public string? PageUrl { get; set; }
        public string? SentryEventId { get; set; }
        public string? SentryIssueUrl { get; set; }
        public JsonElement? Diagnostics { get; set; }
        public string? UserAgent { get; set; }
        public string? TriageNotes { get; set; }
        public string? TriagedAt { get; set; }
        public string? ResolvedAt { get; set; }
        public string? ClosedAt { get; set; }
        public string? CreatedAt { get; set; }
        public string? UpdatedAt { get; set; }
    }

    private sealed class PresenceMetadata
    {
        public string? CustomStatus { get; set; }
        public string? StatusEmoji { get; set; }
        public bool HidePresence { get; set; }
    }

    private sealed class RealtimeBootstrapConfig
    {
        [JsonPropertyName("driver")]
        public string Driver { get; set; } = "pusher";

        [JsonPropertyName("key")]
        public string Key { get; set; } = string.Empty;

        [JsonPropertyName("cluster")]
        public string Cluster { get; set; } = "eu";

        [JsonPropertyName("ws_host")]
        public string WsHost { get; set; } = string.Empty;

        [JsonPropertyName("ws_port")]
        public int WsPort { get; set; } = 443;

        [JsonPropertyName("force_tls")]
        public bool ForceTls { get; set; } = true;

        [JsonPropertyName("authEndpoint")]
        public string AuthEndpoint { get; set; } = "/api/pusher/auth";

        [JsonPropertyName("enabled")]
        public bool Enabled { get; set; }

        [JsonPropertyName("channels")]
        public Dictionary<string, string>? Channels { get; set; }

        [JsonPropertyName("userId")]
        public int? UserId { get; set; }
    }
}
