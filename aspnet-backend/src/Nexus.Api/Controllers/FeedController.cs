// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Feed controller - social feed with posts, likes, and comments.
/// Phase 12: Community activity feed.
/// </summary>
[ApiController]
[Route("api/feed")]
[Authorize]
public class FeedController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly ILogger<FeedController> _logger;
    private readonly GamificationService _gamification;
    private readonly FeedRankingService _feedRanking;
    private readonly TenantContext _tenantContext;

    public FeedController(NexusDbContext db, ILogger<FeedController> logger, GamificationService gamification, FeedRankingService feedRanking, TenantContext tenantContext)
    {
        _db = db;
        _logger = logger;
        _gamification = gamification;
        _feedRanking = feedRanking;
        _tenantContext = tenantContext;
    }

    /// <summary>
    /// GET /api/feed - List feed posts (paginated).
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> GetFeed(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        [FromQuery] int? group_id = null)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var query = _db.FeedPosts.AsQueryable();

        // Filter by group if specified
        if (group_id.HasValue)
        {
            query = query.Where(p => p.GroupId == group_id.Value);
        }

        var total = await query.CountAsync();
        var totalPages = (int)Math.Ceiling(total / (double)limit);

        var posts = await query
            .OrderByDescending(p => p.IsPinned)
            .ThenByDescending(p => p.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(p => new
            {
                p.Id,
                p.Content,
                type = "post",
                p.ImageUrl,
                image_url = p.ImageUrl,
                p.IsPinned,
                p.CreatedAt,
                created_at = p.CreatedAt,
                p.UpdatedAt,
                updated_at = p.UpdatedAt,
                author_id = p.User!.Id,
                author_name = (p.User.FirstName + " " + p.User.LastName).Trim(),
                author_avatar = p.User.AvatarUrl,
                user = new { p.User!.Id, p.User.FirstName, p.User.LastName, name = (p.User.FirstName + " " + p.User.LastName).Trim(), avatar_url = p.User.AvatarUrl },
                author = new { id = p.User.Id, name = (p.User.FirstName + " " + p.User.LastName).Trim(), avatar_url = p.User.AvatarUrl },
                group = p.GroupId != null ? new { p.Group!.Id, p.Group.Name } : null,
                like_count = p.Likes.Count,
                likes_count = p.Likes.Count,
                comment_count = p.Comments.Count,
                comments_count = p.Comments.Count,
                is_liked = p.Likes.Any(l => l.UserId == userId)
            })
            .ToListAsync();

        return Ok(new
        {
            data = posts,
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
    /// GET /api/feed/{id} - Get a single post by ID.
    /// </summary>
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetPost(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var post = await _db.FeedPosts
            .Where(p => p.Id == id)
            .Select(p => new
            {
                p.Id,
                p.Content,
                type = "post",
                p.ImageUrl,
                image_url = p.ImageUrl,
                p.IsPinned,
                p.CreatedAt,
                created_at = p.CreatedAt,
                p.UpdatedAt,
                updated_at = p.UpdatedAt,
                author_id = p.User!.Id,
                author_name = (p.User.FirstName + " " + p.User.LastName).Trim(),
                author_avatar = p.User.AvatarUrl,
                user = new { p.User!.Id, p.User.FirstName, p.User.LastName, name = (p.User.FirstName + " " + p.User.LastName).Trim(), avatar_url = p.User.AvatarUrl },
                author = new { id = p.User.Id, name = (p.User.FirstName + " " + p.User.LastName).Trim(), avatar_url = p.User.AvatarUrl },
                group = p.GroupId != null ? new { p.Group!.Id, p.Group.Name } : null,
                like_count = p.Likes.Count,
                likes_count = p.Likes.Count,
                comment_count = p.Comments.Count,
                comments_count = p.Comments.Count,
                is_liked = p.Likes.Any(l => l.UserId == userId)
            })
            .FirstOrDefaultAsync();

        if (post == null)
        {
            return NotFound(new { error = "Post not found" });
        }

        return Ok(post);
    }

    /// <summary>
    /// POST /api/feed - Create a new post.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> CreatePost([FromBody] CreatePostRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (string.IsNullOrWhiteSpace(request.Content))
        {
            return BadRequest(new { error = "Post content is required" });
        }

        if (request.Content.Length > 5000)
        {
            return BadRequest(new { error = "Post content cannot exceed 5000 characters" });
        }

        // If group_id is provided, verify user is a member
        if (request.GroupId.HasValue)
        {
            var isMember = await _db.GroupMembers
                .AnyAsync(gm => gm.GroupId == request.GroupId && gm.UserId == userId);

            if (!isMember)
            {
                return StatusCode(403, new { error = "You must be a member of the group to post" });
            }
        }

        var post = new FeedPost
        {
            UserId = userId.Value,
            GroupId = request.GroupId,
            Content = request.Content.Trim(),
            ImageUrl = request.ImageUrl?.Trim()
        };

        _db.FeedPosts.Add(post);
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} created post {PostId}", userId, post.Id);

        // Award XP and check badges for creating a post (non-critical)
        try
        {
            await _gamification.AwardXpAsync(userId.Value, XpLog.Amounts.PostCreated, XpLog.Sources.PostCreated, post.Id, "Created a post");
            await _gamification.CheckAndAwardBadgesAsync(userId.Value, "post_created");
        }
        catch (DbUpdateException ex)
        {
            _logger.LogWarning(ex, "Failed to award XP/badges for post {PostId}", post.Id);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Failed to award XP/badges for post {PostId}", post.Id);
        }

        // Load user for response
        var user = await _db.Users.FirstOrDefaultAsync(x => x.Id == userId);
        if (user == null)
        {
            return StatusCode(500, new { error = "User data unavailable" });
        }

        return CreatedAtAction(nameof(GetPost), new { id = post.Id }, new
        {
            success = true,
            message = "Post created",
            post = new
            {
                post.Id,
                post.Content,
                post.ImageUrl,
                post.IsPinned,
                post.CreatedAt,
                user = new { user.Id, user.FirstName, user.LastName },
                group_id = post.GroupId,
                like_count = 0,
                comment_count = 0,
                is_liked = false
            }
        });
    }

    /// <summary>
    /// PUT /api/feed/{id} - Update a post (owner only).
    /// </summary>
    [HttpPut("{id:int}")]
    public async Task<IActionResult> UpdatePost(int id, [FromBody] UpdatePostRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var post = await _db.FeedPosts.FirstOrDefaultAsync(p => p.Id == id);
        if (post == null)
        {
            return NotFound(new { error = "Post not found" });
        }

        // Only owner can update
        if (post.UserId != userId)
        {
            return StatusCode(403, new { error = "Only the post author can update this post" });
        }

        if (request.Content != null)
        {
            if (string.IsNullOrWhiteSpace(request.Content))
            {
                return BadRequest(new { error = "Post content cannot be empty" });
            }
            if (request.Content.Length > 5000)
            {
                return BadRequest(new { error = "Post content cannot exceed 5000 characters" });
            }
            post.Content = request.Content.Trim();
        }

        if (request.ImageUrl != null)
        {
            post.ImageUrl = string.IsNullOrWhiteSpace(request.ImageUrl) ? null : request.ImageUrl.Trim();
        }

        post.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} updated post {PostId}", userId, id);

        return Ok(new
        {
            success = true,
            message = "Post updated",
            post = new
            {
                post.Id,
                post.Content,
                post.ImageUrl,
                post.IsPinned,
                post.CreatedAt,
                post.UpdatedAt
            }
        });
    }

    /// <summary>
    /// DELETE /api/feed/{id} - Delete a post (owner only).
    /// </summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> DeletePost(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var post = await _db.FeedPosts.FirstOrDefaultAsync(p => p.Id == id);
        if (post == null)
        {
            return NotFound(new { error = "Post not found" });
        }

        // Only owner can delete (or group admin/owner if it's a group post)
        var canDelete = post.UserId == userId;

        if (!canDelete && post.GroupId.HasValue)
        {
            var membership = await _db.GroupMembers
                .FirstOrDefaultAsync(gm => gm.GroupId == post.GroupId && gm.UserId == userId);

            canDelete = membership != null && (membership.Role == Group.Roles.Admin || membership.Role == Group.Roles.Owner);
        }

        if (!canDelete)
        {
            return StatusCode(403, new { error = "Only the post author or group admins can delete this post" });
        }

        _db.FeedPosts.Remove(post);
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} deleted post {PostId}", userId, id);

        return Ok(new
        {
            success = true,
            message = "Post deleted"
        });
    }

    /// <summary>
    /// POST /api/feed/{id}/like - Like a post.
    /// </summary>
    [HttpPost("{id:int}/like")]
    public async Task<IActionResult> LikePost(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var post = await _db.FeedPosts.FirstOrDefaultAsync(p => p.Id == id);
        if (post == null)
        {
            return NotFound(new { error = "Post not found" });
        }

        // Check if already liked
        var existingLike = await _db.PostLikes
            .FirstOrDefaultAsync(l => l.PostId == id && l.UserId == userId);

        if (existingLike != null)
        {
            return BadRequest(new { error = "You have already liked this post" });
        }

        var like = new PostLike
        {
            PostId = id,
            UserId = userId.Value
        };

        _db.PostLikes.Add(like);
        await _db.SaveChangesAsync();

        var likeCount = await _db.PostLikes.CountAsync(l => l.PostId == id);

        // Check if post author should earn popular post badge (non-critical)
        try
        {
            await _gamification.CheckAndAwardBadgesAsync(post.UserId, "post_liked");
        }
        catch (DbUpdateException ex)
        {
            _logger.LogWarning(ex, "Failed to check badges for post {PostId} like", post.Id);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Failed to check badges for post {PostId} like", post.Id);
        }

        _logger.LogInformation("User {UserId} liked post {PostId}", userId, id);

        return Ok(new
        {
            success = true,
            message = "Post liked",
            like_count = likeCount
        });
    }

    /// <summary>
    /// DELETE /api/feed/{id}/like - Unlike a post.
    /// </summary>
    [HttpDelete("{id:int}/like")]
    public async Task<IActionResult> UnlikePost(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var like = await _db.PostLikes
            .FirstOrDefaultAsync(l => l.PostId == id && l.UserId == userId);

        if (like == null)
        {
            return NotFound(new { error = "You have not liked this post" });
        }

        _db.PostLikes.Remove(like);
        await _db.SaveChangesAsync();

        var likeCount = await _db.PostLikes.CountAsync(l => l.PostId == id);

        _logger.LogInformation("User {UserId} unliked post {PostId}", userId, id);

        return Ok(new
        {
            success = true,
            message = "Post unliked",
            like_count = likeCount
        });
    }

    /// <summary>
    /// GET /api/feed/{id}/comments - List comments on a post.
    /// </summary>
    [HttpGet("{id:int}/comments")]
    public async Task<IActionResult> GetComments(int id, [FromQuery] int page = 1, [FromQuery] int limit = 50)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var postExists = await _db.FeedPosts.AnyAsync(p => p.Id == id);
        if (!postExists)
        {
            return NotFound(new { error = "Post not found" });
        }

        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var total = await _db.PostComments.CountAsync(c => c.PostId == id && c.ParentCommentId == null);
        var totalPages = (int)Math.Ceiling(total / (double)limit);

        // Only return top-level comments (no parent); replies are fetched separately
        var comments = await _db.PostComments
            .Where(c => c.PostId == id && c.ParentCommentId == null)
            .OrderBy(c => c.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(c => new
            {
                c.Id,
                c.Content,
                c.CreatedAt,
                c.UpdatedAt,
                user = new { c.User!.Id, c.User.FirstName, c.User.LastName },
                reply_count = c.Replies.Count
            })
            .ToListAsync();

        return Ok(new
        {
            data = comments,
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
    /// POST /api/feed/{id}/comments - Add a comment to a post.
    /// </summary>
    [HttpPost("{id:int}/comments")]
    public async Task<IActionResult> AddComment(int id, [FromBody] AddCommentRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var post = await _db.FeedPosts.FirstOrDefaultAsync(p => p.Id == id);
        if (post == null)
        {
            return NotFound(new { error = "Post not found" });
        }

        if (string.IsNullOrWhiteSpace(request.Content))
        {
            return BadRequest(new { error = "Comment content is required" });
        }

        if (request.Content.Length > 2000)
        {
            return BadRequest(new { error = "Comment cannot exceed 2000 characters" });
        }

        // Validate parent comment if replying
        if (request.ParentCommentId.HasValue)
        {
            var parentExists = await _db.PostComments
                .AnyAsync(c => c.Id == request.ParentCommentId.Value && c.PostId == id);
            if (!parentExists)
                return BadRequest(new { error = "Parent comment not found on this post" });
        }

        var comment = new PostComment
        {
            PostId = id,
            UserId = userId.Value,
            Content = request.Content.Trim(),
            ParentCommentId = request.ParentCommentId
        };

        _db.PostComments.Add(comment);
        await _db.SaveChangesAsync();

        // Award XP for adding a comment (non-critical)
        try
        {
            await _gamification.AwardXpAsync(userId.Value, XpLog.Amounts.CommentAdded, XpLog.Sources.CommentAdded, comment.Id, "Added a comment");
        }
        catch (DbUpdateException ex)
        {
            _logger.LogWarning(ex, "Failed to award XP for comment {CommentId}", comment.Id);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Failed to award XP for comment {CommentId}", comment.Id);
        }

        var user = await _db.Users.FirstOrDefaultAsync(x => x.Id == userId);
        if (user == null)
        {
            return StatusCode(500, new { error = "User data unavailable" });
        }

        _logger.LogInformation("User {UserId} commented on post {PostId}", userId, id);

        return CreatedAtAction(nameof(GetComments), new { id }, new
        {
            success = true,
            message = "Comment added",
            comment = new
            {
                comment.Id,
                comment.Content,
                comment.CreatedAt,
                parent_comment_id = comment.ParentCommentId,
                user = new { user.Id, user.FirstName, user.LastName }
            }
        });
    }

    /// <summary>
    /// GET /api/feed/{id}/comments/{commentId}/replies - List replies to a comment.
    /// </summary>
    [HttpGet("{id:int}/comments/{commentId}/replies")]
    public async Task<IActionResult> GetReplies(int id, int commentId, [FromQuery] int page = 1, [FromQuery] int limit = 50)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var commentExists = await _db.PostComments.AnyAsync(c => c.Id == commentId && c.PostId == id);
        if (!commentExists)
            return NotFound(new { error = "Comment not found" });

        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var total = await _db.PostComments.CountAsync(c => c.ParentCommentId == commentId);
        var totalPages = (int)Math.Ceiling(total / (double)limit);

        var replies = await _db.PostComments
            .Where(c => c.ParentCommentId == commentId)
            .OrderBy(c => c.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Select(c => new
            {
                c.Id,
                c.Content,
                c.CreatedAt,
                c.UpdatedAt,
                parent_comment_id = c.ParentCommentId,
                user = new { c.User!.Id, c.User.FirstName, c.User.LastName },
                reply_count = c.Replies.Count
            })
            .ToListAsync();

        return Ok(new
        {
            data = replies,
            pagination = new { page, limit, total, pages = totalPages }
        });
    }

    /// <summary>
    /// PUT /api/feed/{id}/comments/{commentId} - Edit a comment (owner only).
    /// </summary>
    [HttpPut("{id:int}/comments/{commentId}")]
    public async Task<IActionResult> UpdateComment(int id, int commentId, [FromBody] AddCommentRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var comment = await _db.PostComments
            .FirstOrDefaultAsync(c => c.Id == commentId && c.PostId == id);

        if (comment == null)
            return NotFound(new { error = "Comment not found" });

        if (comment.UserId != userId)
            return StatusCode(403, new { error = "Only the comment author can edit this comment" });

        if (string.IsNullOrWhiteSpace(request.Content))
            return BadRequest(new { error = "Comment content is required" });

        if (request.Content.Length > 2000)
            return BadRequest(new { error = "Comment cannot exceed 2000 characters" });

        comment.Content = request.Content.Trim();
        comment.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new
        {
            success = true,
            message = "Comment updated",
            comment = new
            {
                comment.Id,
                comment.Content,
                comment.CreatedAt,
                comment.UpdatedAt,
                parent_comment_id = comment.ParentCommentId
            }
        });
    }

    /// <summary>
    /// DELETE /api/feed/{id}/comments/{commentId} - Delete a comment.
    /// </summary>
    [HttpDelete("{id:int}/comments/{commentId}")]
    public async Task<IActionResult> DeleteComment(int id, int commentId)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var comment = await _db.PostComments
            .Include(c => c.Post)
            .FirstOrDefaultAsync(c => c.Id == commentId && c.PostId == id);

        if (comment == null)
        {
            return NotFound(new { error = "Comment not found" });
        }

        // Can delete if: comment author, post author, or group admin/owner
        var canDelete = comment.UserId == userId || comment.Post!.UserId == userId;

        if (!canDelete && comment.Post!.GroupId.HasValue)
        {
            var membership = await _db.GroupMembers
                .FirstOrDefaultAsync(gm => gm.GroupId == comment.Post!.GroupId && gm.UserId == userId);

            canDelete = membership != null && (membership.Role == Group.Roles.Admin || membership.Role == Group.Roles.Owner);
        }

        if (!canDelete)
        {
            return StatusCode(403, new { error = "You cannot delete this comment" });
        }

        _db.PostComments.Remove(comment);
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} deleted comment {CommentId} on post {PostId}", userId, commentId, id);

        return Ok(new
        {
            success = true,
            message = "Comment deleted"
        });
    }


    [HttpPost("{id:int}/react")]
    public async Task<IActionResult> AddReaction(int id, [FromBody] AddReactionRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var (success, error) = await _feedRanking.AddReactionAsync(tenantId, id, userId.Value, request.ReactionType ?? "like");
        if (error == "Post not found") return NotFound(new { error });
        if (error != null) return BadRequest(new { error });
        return Ok(new { message = "Reaction added", reaction_type = request.ReactionType, post_id = id });
    }

    [HttpDelete("{id:int}/react")]
    public async Task<IActionResult> RemoveReaction(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var (success, error) = await _feedRanking.RemoveReactionAsync(tenantId, id, userId.Value);
        if (error != null) return BadRequest(new { error });
        return Ok(new { message = "Reaction removed" });
    }

    [HttpGet("{id:int}/reactions")]
    public async Task<IActionResult> GetReactions(int id)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var counts = await _feedRanking.GetReactionsAsync(tenantId, id);
        var total = counts.Values.Sum();
        return Ok(new { like = counts["like"], love = counts["love"], laugh = counts["laugh"], sad = counts["sad"], angry = counts["angry"], wow = counts["wow"], total });
    }

    [HttpGet("mentions/search")]
    public async Task<IActionResult> SearchMentions([FromQuery] string? q)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        if (string.IsNullOrWhiteSpace(q)) return Ok(new { data = Array.Empty<object>() });
        var users = await _feedRanking.SearchMentionsAsync(tenantId, q);
        return Ok(new { data = users });
    }

    [HttpPost("{id:int}/share")]
    public async Task<IActionResult> SharePost(int id, [FromBody] SharePostRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var (share, error) = await _feedRanking.SharePostWithCommentAsync(tenantId, id, userId.Value, request.Comment);
        if (error == "Post not found") return NotFound(new { error });
        if (error != null) return BadRequest(new { error });
        return StatusCode(201, new { message = "Post shared", share_id = share!.Id, post_id = id });
    }

    /// <summary>GET /api/feed/{id}/likers — users who liked a post</summary>
    [HttpGet("{id:int}/likers")]
    public async Task<IActionResult> GetLikers(int id, [FromQuery] int page = 1, [FromQuery] int pageSize = 20)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var post = await _db.FeedPosts.FirstOrDefaultAsync(p => p.Id == id && p.TenantId == tenantId);
        if (post == null) return NotFound(new { error = "Post not found" });

        var query = _db.PostLikes
            .Where(l => l.PostId == id)
            .Include(l => l.User)
            .OrderByDescending(l => l.CreatedAt);

        var total = await query.CountAsync();
        var likers = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(l => new { l.UserId, l.User!.FirstName, l.User.LastName, likedAt = l.CreatedAt })
            .ToListAsync();

        return Ok(new { data = likers, totalCount = total, page, pageSize });
    }

    /// <summary>GET /api/feed/{id}/shares — list shares/reposts of a post</summary>
    [HttpGet("{id:int}/shares")]
    public async Task<IActionResult> GetShares(int id, [FromQuery] int page = 1, [FromQuery] int pageSize = 20)
    {
        page = Math.Max(page, 1);
        pageSize = Math.Clamp(pageSize, 1, 100);

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var post = await _db.FeedPosts.FirstOrDefaultAsync(p => p.Id == id && p.TenantId == tenantId);
        if (post == null) return NotFound(new { error = "Post not found" });

        var query = _db.PostShares
            .Where(s => s.PostId == id)
            .Include(s => s.User)
            .OrderByDescending(s => s.CreatedAt);

        var total = await query.CountAsync();
        var shares = await query
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .Select(s => new { s.Id, s.UserId, s.User!.FirstName, s.User.LastName, s.SharedTo, sharedAt = s.CreatedAt })
            .ToListAsync();

        return Ok(new { data = shares, totalCount = total, page, pageSize });
    }

    /// <summary>POST /api/feed/{id}/comments/{commentId}/reply — reply to a comment (nested)</summary>
    [HttpPost("{id:int}/comments/{commentId}/reply")]
    public async Task<IActionResult> ReplyToComment(int id, int commentId, [FromBody] AddCommentRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        if (string.IsNullOrWhiteSpace(request.Content)) return BadRequest(new { error = "Reply content is required" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var parent = await _db.PostComments
            .FirstOrDefaultAsync(c => c.Id == commentId && c.PostId == id);
        if (parent == null) return NotFound(new { error = "Comment not found" });

        var reply = new PostComment
        {
            PostId = id,
            UserId = userId.Value,
            Content = request.Content,
            ParentCommentId = commentId,
            TenantId = tenantId,
            CreatedAt = DateTime.UtcNow,
        };
        _db.PostComments.Add(reply);
        await _db.SaveChangesAsync();

        return StatusCode(201, new { id = reply.Id, postId = id, parentCommentId = commentId, content = reply.Content, createdAt = reply.CreatedAt });
    }

    /// <summary>POST /api/feed/{id}/hide — hide a post from the current user's feed</summary>
    [HttpPost("{id:int}/hide")]
    public async Task<IActionResult> HidePost(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var post = await _db.FeedPosts.FirstOrDefaultAsync(p => p.Id == id && p.TenantId == tenantId);
        if (post == null) return NotFound(new { error = "Post not found" });

        var existing = await _db.HiddenPosts.FirstOrDefaultAsync(h => h.PostId == id && h.UserId == userId.Value);
        if (existing != null) return Ok(new { message = "Post already hidden" });

        _db.HiddenPosts.Add(new HiddenPost { PostId = id, UserId = userId.Value, TenantId = tenantId });
        await _db.SaveChangesAsync();

        return Ok(new { message = "Post hidden from your feed" });
    }

    /// <summary>POST /api/feed/{id}/mute — mute the author of a post</summary>
    [HttpPost("{id:int}/mute")]
    public async Task<IActionResult> MutePostAuthor(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var post = await _db.FeedPosts.FirstOrDefaultAsync(p => p.Id == id && p.TenantId == tenantId);
        if (post == null) return NotFound(new { error = "Post not found" });
        if (post.UserId == userId.Value) return BadRequest(new { error = "Cannot mute yourself" });

        var existing = await _db.MutedUsers.FirstOrDefaultAsync(m => m.MutedUserId == post.UserId && m.UserId == userId.Value);
        if (existing != null) return Ok(new { message = "User already muted" });

        _db.MutedUsers.Add(new MutedUser { UserId = userId.Value, MutedUserId = post.UserId, TenantId = tenantId });
        await _db.SaveChangesAsync();

        return Ok(new { message = "User muted", mutedUserId = post.UserId });
    }

    private int? GetCurrentUserId() => User.GetUserId();
}

public class CreatePostRequest
{
    [JsonPropertyName("content"), MaxLength(10000)]
    public string Content { get; set; } = string.Empty;

    [JsonPropertyName("image_url"), MaxLength(2000)]
    [Url(ErrorMessage = "ImageUrl must be a valid URL")]
    public string? ImageUrl { get; set; }

    [JsonPropertyName("group_id")]
    public int? GroupId { get; set; }
}

public class UpdatePostRequest
{
    [JsonPropertyName("content"), MaxLength(10000)]
    public string? Content { get; set; }

    [JsonPropertyName("image_url"), MaxLength(2000)]
    [Url(ErrorMessage = "ImageUrl must be a valid URL")]
    public string? ImageUrl { get; set; }
}

public class AddCommentRequest
{
    [JsonPropertyName("content"), MaxLength(5000)]
    public string Content { get; set; } = string.Empty;

    [JsonPropertyName("parent_comment_id")]
    public int? ParentCommentId { get; set; }
}

public class AddReactionRequest
{
    [JsonPropertyName("reaction_type"), MaxLength(50)]
    public string? ReactionType { get; set; }
}

public class SharePostRequest
{
    [JsonPropertyName("comment"), MaxLength(5000)]
    public string? Comment { get; set; }
    [JsonPropertyName("shared_to"), MaxLength(100)]
    public string? SharedTo { get; set; }
}
