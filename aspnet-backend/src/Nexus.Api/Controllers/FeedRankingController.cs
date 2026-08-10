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
/// Feed ranking controller - ranked feed, trending posts, bookmarks, shares, and engagement stats.
/// Phase 29: Feed Ranking and Algorithm.
/// </summary>
[ApiController]
[Route("api/feed")]
[Authorize]
public class FeedRankingController : ControllerBase
{
    private readonly FeedRankingService _feedRanking;
    private readonly ILogger<FeedRankingController> _logger;

    public FeedRankingController(FeedRankingService feedRanking, ILogger<FeedRankingController> logger)
    {
        _feedRanking = feedRanking;
        _logger = logger;
    }

    /// <summary>
    /// GET /api/feed/ranked - Get ranked feed sorted by algorithmic score.
    /// </summary>
    [HttpGet("ranked")]
    public async Task<IActionResult> GetRankedFeed(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);

        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var result = await _feedRanking.GetRankedFeedAsync(userId.Value, page, limit);

        var posts = result.Posts.Select(sp => new
        {
            sp.Post.Id,
            sp.Post.Content,
            image_url = sp.Post.ImageUrl,
            is_pinned = sp.Post.IsPinned,
            created_at = sp.Post.CreatedAt,
            updated_at = sp.Post.UpdatedAt,
            user = sp.Post.User != null
                ? new { sp.Post.User.Id, first_name = sp.Post.User.FirstName, last_name = sp.Post.User.LastName }
                : null,
            group = sp.Post.GroupId != null && sp.Post.Group != null
                ? new { sp.Post.Group.Id, sp.Post.Group.Name }
                : null,
            like_count = sp.LikeCount,
            comment_count = sp.CommentCount,
            share_count = sp.ShareCount,
            is_liked = sp.IsLiked,
            score = Math.Round(sp.Score, 4)
        });

        return Ok(new
        {
            data = posts,
            pagination = new
            {
                page = result.Page,
                limit = result.Limit,
                total = result.Total,
                pages = result.TotalPages
            }
        });
    }

    /// <summary>
    /// GET /api/feed/trending - Get trending posts by engagement velocity.
    /// </summary>
    [HttpGet("trending")]
    public async Task<IActionResult> GetTrending(
        [FromQuery] int hours = 24,
        [FromQuery] int limit = 10)
    {
        limit = Math.Clamp(limit, 1, 100);

        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var trending = await _feedRanking.GetTrendingPostsAsync(hours, limit);

        var posts = trending.Select(t => new
        {
            t.Post.Id,
            t.Post.Content,
            image_url = t.Post.ImageUrl,
            is_pinned = t.Post.IsPinned,
            created_at = t.Post.CreatedAt,
            updated_at = t.Post.UpdatedAt,
            user = t.Post.User != null
                ? new { t.Post.User.Id, first_name = t.Post.User.FirstName, last_name = t.Post.User.LastName }
                : null,
            group = t.Post.GroupId != null && t.Post.Group != null
                ? new { t.Post.Group.Id, t.Post.Group.Name }
                : null,
            like_count = t.LikeCount,
            comment_count = t.CommentCount,
            share_count = t.ShareCount,
            velocity = Math.Round(t.Velocity, 4)
        });

        return Ok(new
        {
            data = posts,
            hours,
            limit
        });
    }

    /// <summary>
    /// POST /api/feed/{id}/bookmark - Bookmark a post.
    /// </summary>
    [HttpPost("{id:int}/bookmark")]
    public async Task<IActionResult> BookmarkPost(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (success, error) = await _feedRanking.BookmarkPostAsync(userId.Value, id);

        if (!success)
        {
            if (error == "Post not found")
                return NotFound(new { error });

            return BadRequest(new { error });
        }

        return Ok(new
        {
            success = true,
            message = "Post bookmarked"
        });
    }

    /// <summary>
    /// DELETE /api/feed/{id}/bookmark - Remove bookmark from a post.
    /// </summary>
    [HttpDelete("{id:int}/bookmark")]
    public async Task<IActionResult> UnbookmarkPost(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (success, error) = await _feedRanking.UnbookmarkPostAsync(userId.Value, id);

        if (!success)
        {
            return NotFound(new { error });
        }

        return Ok(new
        {
            success = true,
            message = "Bookmark removed"
        });
    }

    /// <summary>
    /// GET /api/feed/bookmarks - Get current user's bookmarked posts.
    /// </summary>
    [HttpGet("bookmarks")]
    public async Task<IActionResult> GetBookmarks(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);

        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var result = await _feedRanking.GetBookmarksAsync(userId.Value, page, limit);

        var bookmarks = result.Bookmarks.Select(b => new
        {
            bookmark_id = b.Id,
            bookmarked_at = b.CreatedAt,
            post = b.Post != null ? new
            {
                b.Post.Id,
                b.Post.Content,
                image_url = b.Post.ImageUrl,
                is_pinned = b.Post.IsPinned,
                created_at = b.Post.CreatedAt,
                updated_at = b.Post.UpdatedAt,
                user = b.Post.User != null
                    ? new { b.Post.User.Id, first_name = b.Post.User.FirstName, last_name = b.Post.User.LastName }
                    : null,
                group = b.Post.GroupId != null && b.Post.Group != null
                    ? new { b.Post.Group.Id, b.Post.Group.Name }
                    : null,
                like_count = b.Post.Likes.Count,
                comment_count = b.Post.Comments.Count
            } : (object?)null
        });

        return Ok(new
        {
            data = bookmarks,
            pagination = new
            {
                page = result.Page,
                limit = result.Limit,
                total = result.Total,
                pages = result.TotalPages
            }
        });
    }

    // Share route removed — served by FeedController.SharePost

    /// <summary>
    /// GET /api/feed/{id}/engagement - Get detailed engagement stats for a post.
    /// </summary>
    [HttpGet("{id:int}/engagement")]
    public async Task<IActionResult> GetPostEngagement(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var engagement = await _feedRanking.GetPostEngagementAsync(id);

        if (engagement == null)
        {
            return NotFound(new { error = "Post not found" });
        }

        return Ok(new
        {
            post_id = engagement.PostId,
            like_count = engagement.LikeCount,
            comment_count = engagement.CommentCount,
            share_count = engagement.ShareCount,
            bookmark_count = engagement.BookmarkCount,
            total_engagement = engagement.TotalEngagement
        });
    }
}
