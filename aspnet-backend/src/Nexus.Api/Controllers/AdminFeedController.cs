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

namespace Nexus.Api.Controllers;

/// <summary>
/// Admin feed moderation endpoints.
/// </summary>
[ApiController]
[Route("api/admin/feed")]
[Route("api/v2/admin/feed")]
[Authorize(Policy = "BrokerOrAdmin")]
public class AdminFeedController : ControllerBase
{
    private const string FeedHiddenKeyPrefix = "admin.feed.hidden.";
    private const string FeedDeletedKeyPrefix = "admin.feed.deleted.";
    private const string FeedAuthorKeyPrefix = "admin.feed.author.";
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<AdminFeedController> _logger;

    public AdminFeedController(
        NexusDbContext db,
        TenantContext tenantContext,
        ILogger<AdminFeedController> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>GET /api/admin/feed/posts — moderation queue with optional status filter.</summary>
    [HttpGet("posts")]
    public async Task<IActionResult> GetModerationQueue(
        [FromQuery] string? status = null,
        [FromQuery] string? type = null,
        [FromQuery] int? user_id = null,
        [FromQuery] string? search = null,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        if (page < 1) page = 1;
        if (limit < 1) limit = 1;
        if (limit > 100) limit = 100;

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        if (IsV2Request() && IsListingType(type))
        {
            return await GetListingModerationQueue(tenantId, status, user_id, search, page, limit);
        }

        if (IsV2Request() && IsEventType(type))
        {
            return await GetEventModerationQueue(tenantId, status, user_id, search, page, limit);
        }

        if (IsV2Request() && IsPollType(type))
        {
            return await GetPollModerationQueue(tenantId, status, user_id, search, page, limit);
        }

        if (IsV2Request() && IsGoalType(type))
        {
            return await GetGoalModerationQueue(tenantId, status, user_id, search, page, limit);
        }

        if (IsV2Request() && IsJobType(type))
        {
            return await GetJobModerationQueue(tenantId, status, user_id, search, page, limit);
        }

        if (IsV2Request() && IsChallengeType(type))
        {
            return await GetChallengeModerationQueue(tenantId, status, user_id, search, page, limit);
        }

        if (IsV2Request() && IsVolunteerType(type))
        {
            return await GetVolunteerModerationQueue(tenantId, status, user_id, search, page, limit);
        }

        if (IsV2Request() && IsBlogType(type))
        {
            return await GetBlogModerationQueue(tenantId, status, user_id, search, page, limit);
        }

        if (IsV2Request() && IsDiscussionType(type))
        {
            return await GetDiscussionModerationQueue(tenantId, status, user_id, search, page, limit);
        }

        var query = _db.FeedPosts
            .Include(p => p.User)
            .Include(p => p.Tenant)
            .Where(p => p.TenantId == tenantId);

        if (!string.IsNullOrWhiteSpace(type) && !string.Equals(type, "post", StringComparison.OrdinalIgnoreCase))
        {
            query = query.Where(p => false);
        }

        if (user_id.HasValue && user_id.Value > 0)
        {
            query = query.Where(p => p.UserId == user_id.Value);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var normalizedSearch = search.Trim();
            query = query.Where(p =>
                p.Content.Contains(normalizedSearch) ||
                p.User!.FirstName.Contains(normalizedSearch) ||
                p.User.LastName.Contains(normalizedSearch) ||
                p.User.Email.Contains(normalizedSearch));
        }

        if (!string.IsNullOrWhiteSpace(status))
        {
            if (status == "reported" || status == "flagged")
                query = query.Where(p => _db.FeedReports.Any(r => r.PostId == p.Id && r.TenantId == tenantId && r.Status == "pending"));
            else if (status == "hidden")
                query = query.Where(p => p.IsHidden);
            else if (status == "active" || status == "visible")
                query = query.Where(p => !p.IsHidden);
        }

        query = query.OrderByDescending(p => p.CreatedAt);

        var total = await query.CountAsync();
        var postEntities = await query
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        if (IsV2Request())
        {
            var posts = await MapLaravelFeedPostsAsync(postEntities, tenantId);
            return Ok(new
            {
                success = true,
                data = posts,
                meta = BuildLaravelPaginationMeta(page, limit, total)
            });
        }

        var legacyPosts = postEntities.Select(p => new
        {
            p.Id,
            p.Content,
            p.IsHidden,
            author = new { p.User!.Id, p.User.FirstName, p.User.LastName, p.User.Email },
            reportCount = _db.FeedReports.Count(r => r.PostId == p.Id && r.Status == "pending"),
            p.CreatedAt
        }).ToList();

        return Ok(new
        {
            data = legacyPosts,
            pagination = new { page, limit, total, pages = (int)Math.Ceiling(total / (double)limit) }
        });
    }

    /// <summary>GET /api/admin/feed/posts/{id} — post details with reports for moderation.</summary>
    [HttpGet("posts/{id:int}")]
    public async Task<IActionResult> GetPostForModeration(int id, [FromQuery] string? type = null)
    {
        if (IsV2Request() && IsListingType(type))
        {
            return await GetListingForModeration(id);
        }

        if (IsV2Request() && IsEventType(type))
        {
            return await GetEventForModeration(id);
        }

        if (IsV2Request() && IsPollType(type))
        {
            return await GetPollForModeration(id);
        }

        if (IsV2Request() && IsGoalType(type))
        {
            return await GetGoalForModeration(id);
        }

        if (IsV2Request() && IsJobType(type))
        {
            return await GetJobForModeration(id);
        }

        if (IsV2Request() && IsChallengeType(type))
        {
            return await GetChallengeForModeration(id);
        }

        if (IsV2Request() && IsVolunteerType(type))
        {
            return await GetVolunteerForModeration(id);
        }

        if (IsV2Request() && IsBlogType(type))
        {
            return await GetBlogForModeration(id);
        }

        if (IsV2Request() && IsDiscussionType(type))
        {
            return await GetDiscussionForModeration(id);
        }

        if (IsV2Request() && !IsPostType(type))
        {
            return LaravelNotFound("Feed item not found");
        }

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var post = await _db.FeedPosts
            .Include(p => p.User)
            .Include(p => p.Tenant)
            .FirstOrDefaultAsync(p => p.Id == id && p.TenantId == tenantId);

        if (post == null)
            return IsV2Request() ? LaravelNotFound("Post not found") : NotFound(new { error = "Post not found" });

        var reports = await _db.FeedReports
            .Include(r => r.Reporter)
            .Where(r => r.PostId == id && r.TenantId == tenantId)
            .OrderByDescending(r => r.CreatedAt)
            .Select(r => new
            {
                r.Id,
                r.Reason,
                r.Details,
                r.Status,
                reporter = new { r.Reporter!.Id, r.Reporter.FirstName, r.Reporter.LastName },
                r.CreatedAt
            })
            .ToListAsync();

        if (IsV2Request())
        {
            var recentComments = await _db.PostComments
                .Include(c => c.User)
                .Where(c => c.PostId == id && c.TenantId == tenantId)
                .OrderByDescending(c => c.CreatedAt)
                .Take(10)
                .Select(c => new
                {
                    c.Id,
                    c.UserId,
                    user_name = FullName(c.User),
                    c.Content,
                    created_at = c.CreatedAt
                })
                .ToListAsync();

            return Ok(new
            {
                success = true,
                data = MapLaravelFeedPost(
                    post,
                    likesCount: await _db.PostLikes.CountAsync(l => l.PostId == id && l.TenantId == tenantId),
                    commentsCount: await _db.PostComments.CountAsync(c => c.PostId == id && c.TenantId == tenantId),
                    pendingReportsCount: await _db.FeedReports.CountAsync(r => r.PostId == id && r.TenantId == tenantId && r.Status == "pending"),
                    recentComments)
            });
        }

        return Ok(new
        {
            id = post.Id,
            content = post.Content,
            isHidden = post.IsHidden,
            author = new { post.User!.Id, post.User.FirstName, post.User.LastName, post.User.Email },
            createdAt = post.CreatedAt,
            reports
        });
    }

    /// <summary>POST /api/admin/feed/posts/{id}/hide — admin hide post.</summary>
    [HttpPost("posts/{id:int}/hide")]
    public async Task<IActionResult> AdminHidePost(int id, [FromBody] AdminModerateRequest? request)
    {
        var adminId = User.GetUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });

        if (IsV2Request() && IsListingType(request?.Type))
        {
            return await HideListingFeedItem(id, adminId.Value);
        }

        if (IsV2Request() && IsEventType(request?.Type))
        {
            return await HideEventFeedItem(id, adminId.Value);
        }

        if (IsV2Request() && IsPollType(request?.Type))
        {
            return await HidePollFeedItem(id, adminId.Value);
        }

        if (IsV2Request() && IsGoalType(request?.Type))
        {
            return await HideGoalFeedItem(id, adminId.Value);
        }

        if (IsV2Request() && IsJobType(request?.Type))
        {
            return await HideJobFeedItem(id, adminId.Value);
        }

        if (IsV2Request() && IsChallengeType(request?.Type))
        {
            return await HideChallengeFeedItem(id, adminId.Value);
        }

        if (IsV2Request() && IsVolunteerType(request?.Type))
        {
            return await HideVolunteerFeedItem(id, adminId.Value);
        }

        if (IsV2Request() && IsBlogType(request?.Type))
        {
            return await HideBlogFeedItem(id, adminId.Value);
        }

        if (IsV2Request() && IsDiscussionType(request?.Type))
        {
            return await HideDiscussionFeedItem(id, adminId.Value);
        }

        if (IsV2Request() && !IsPostType(request?.Type))
        {
            return LaravelNotFound("Feed item not found");
        }

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var post = await _db.FeedPosts.FirstOrDefaultAsync(p => p.Id == id && p.TenantId == tenantId);
        if (post == null) return IsV2Request() ? LaravelNotFound("Feed item not found") : NotFound(new { error = "Post not found" });

        if (IsV2Request())
        {
            var guard = GuardBrokerNotAuthor(post.UserId, adminId.Value);
            if (guard != null) return guard;
        }

        post.IsHidden = true;

        // Mark pending reports as actioned
        var pendingReports = await _db.FeedReports
            .Where(r => r.PostId == id && r.Status == "pending")
            .ToListAsync();

        foreach (var report in pendingReports)
        {
            report.Status = "action_taken";
            report.ReviewedByAdminId = adminId.Value;
            report.ReviewedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} hid feed post {PostId}", adminId, id);
        if (IsV2Request())
        {
            return Ok(new { success = true, data = new { success = true, message = "Feed item hidden" } });
        }

        return Ok(new { message = "Post hidden", postId = id });
    }

    /// <summary>DELETE /api/admin/feed/posts/{id} — admin delete post.</summary>
    [HttpDelete("posts/{id:int}")]
    public async Task<IActionResult> AdminDeletePost(int id, [FromQuery] string? type = null)
    {
        var adminId = User.GetUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });

        if (IsV2Request() && IsListingType(type))
        {
            return await DeleteListingFeedItem(id, adminId.Value);
        }

        if (IsV2Request() && IsEventType(type))
        {
            return await DeleteEventFeedItem(id, adminId.Value);
        }

        if (IsV2Request() && IsPollType(type))
        {
            return await DeletePollFeedItem(id, adminId.Value);
        }

        if (IsV2Request() && IsGoalType(type))
        {
            return await DeleteGoalFeedItem(id, adminId.Value);
        }

        if (IsV2Request() && IsJobType(type))
        {
            return await DeleteJobFeedItem(id, adminId.Value);
        }

        if (IsV2Request() && IsChallengeType(type))
        {
            return await DeleteChallengeFeedItem(id, adminId.Value);
        }

        if (IsV2Request() && IsVolunteerType(type))
        {
            return await DeleteVolunteerFeedItem(id, adminId.Value);
        }

        if (IsV2Request() && IsBlogType(type))
        {
            return await DeleteBlogFeedItem(id, adminId.Value);
        }

        if (IsV2Request() && IsDiscussionType(type))
        {
            return await DeleteDiscussionFeedItem(id, adminId.Value);
        }

        if (IsV2Request() && !IsPostType(type))
        {
            return LaravelNotFound("Feed item not found");
        }

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var post = await _db.FeedPosts.FirstOrDefaultAsync(p => p.Id == id && p.TenantId == tenantId);
        if (post == null) return IsV2Request() ? LaravelNotFound("Feed item not found") : NotFound(new { error = "Post not found" });

        if (IsV2Request())
        {
            var guard = GuardBrokerNotAuthor(post.UserId, adminId.Value);
            if (guard != null) return guard;
        }

        _db.FeedPosts.Remove(post);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} deleted feed post {PostId}", adminId, id);
        if (IsV2Request())
        {
            return Ok(new { success = true, data = new { success = true, message = "Feed item deleted" } });
        }

        return NoContent();
    }

    /// <summary>GET /api/admin/feed/stats — feed analytics dashboard.</summary>
    [HttpGet("stats")]
    public async Task<IActionResult> GetFeedStats()
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();

        var totalPosts = await _db.FeedPosts.CountAsync(p => p.TenantId == tenantId);
        var hiddenPosts = await _db.FeedPosts.CountAsync(p => p.TenantId == tenantId && p.IsHidden);
        var pendingReports = await _db.FeedReports.CountAsync(r => r.TenantId == tenantId && r.Status == "pending");
        var totalReports = await _db.FeedReports.CountAsync(r => r.TenantId == tenantId);
        var postsLast7Days = await _db.FeedPosts
            .CountAsync(p => p.TenantId == tenantId && p.CreatedAt >= DateTime.UtcNow.AddDays(-7));

        if (IsV2Request())
        {
            var totalComments = await _db.PostComments.CountAsync(c => c.TenantId == tenantId);
            var resolvedReports = await _db.FeedReports.CountAsync(r =>
                r.TenantId == tenantId && (r.Status == "reviewed" || r.Status == "action_taken"));
            var dismissedReports = await _db.FeedReports.CountAsync(r => r.TenantId == tenantId && r.Status == "dismissed");

            return Ok(new
            {
                success = true,
                data = new
                {
                    total = totalPosts,
                    hidden = hiddenPosts,
                    total_comments = totalComments,
                    feed_posts_total = totalPosts,
                    feed_posts_hidden = hiddenPosts,
                    feed_posts_flagged = pendingReports,
                    comments_total = totalComments,
                    comments_hidden = 0,
                    comments_flagged = 0,
                    reviews_total = await _db.Reviews.CountAsync(r => r.TenantId == tenantId),
                    reviews_hidden = 0,
                    reviews_flagged = 0,
                    reports_pending = pendingReports,
                    reports_resolved = resolvedReports,
                    reports_dismissed = dismissedReports,
                    pending = pendingReports,
                    resolved = resolvedReports,
                    dismissed = dismissedReports
                }
            });
        }

        return Ok(new
        {
            totalPosts,
            hiddenPosts,
            pendingReports,
            totalReports,
            postsLast7Days
        });
    }

    private bool IsV2Request()
    {
        return Request.Path.Value?.StartsWith("/api/v2/", StringComparison.OrdinalIgnoreCase) == true;
    }

    private static bool IsPostType(string? type)
    {
        return string.IsNullOrWhiteSpace(type) || string.Equals(type, "post", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsListingType(string? type)
    {
        return string.Equals(type, "listing", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsEventType(string? type)
    {
        return string.Equals(type, "event", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsPollType(string? type)
    {
        return string.Equals(type, "poll", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsGoalType(string? type)
    {
        return string.Equals(type, "goal", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsJobType(string? type)
    {
        return string.Equals(type, "job", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsChallengeType(string? type)
    {
        return string.Equals(type, "challenge", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsVolunteerType(string? type)
    {
        return string.Equals(type, "volunteer", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsBlogType(string? type)
    {
        return string.Equals(type, "blog", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsDiscussionType(string? type)
    {
        return string.Equals(type, "discussion", StringComparison.OrdinalIgnoreCase);
    }

    private async Task<IActionResult> GetListingModerationQueue(
        int tenantId,
        string? status,
        int? userId,
        string? search,
        int page,
        int limit)
    {
        var hiddenIds = await LoadFeedFlaggedIdsAsync(tenantId, "listing", deleted: false);
        var deletedIds = await LoadFeedFlaggedIdsAsync(tenantId, "listing", deleted: true);

        var query = _db.Listings
            .Include(l => l.User)
            .Include(l => l.Tenant)
            .Where(l => l.TenantId == tenantId && l.DeletedAt == null && !deletedIds.Contains(l.Id));

        if (userId.HasValue && userId.Value > 0)
        {
            query = query.Where(l => l.UserId == userId.Value);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var normalizedSearch = search.Trim();
            query = query.Where(l =>
                l.Title.Contains(normalizedSearch) ||
                (l.Description != null && l.Description.Contains(normalizedSearch)) ||
                l.User!.FirstName.Contains(normalizedSearch) ||
                l.User.LastName.Contains(normalizedSearch) ||
                l.User.Email.Contains(normalizedSearch));
        }

        if (!string.IsNullOrWhiteSpace(status))
        {
            if (status == "hidden")
                query = query.Where(l => hiddenIds.Contains(l.Id));
            else if (status == "active" || status == "visible")
                query = query.Where(l => !hiddenIds.Contains(l.Id));
            else if (status == "reported" || status == "flagged")
                query = query.Where(l => false);
        }

        query = query.OrderByDescending(l => l.CreatedAt);
        var total = await query.CountAsync();
        var listings = await query
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return Ok(new
        {
            success = true,
            data = listings.Select(listing => MapLaravelFeedListing(listing, hiddenIds.Contains(listing.Id), recentComments: null)).ToList(),
            meta = BuildLaravelPaginationMeta(page, limit, total)
        });
    }

    private async Task<IActionResult> GetListingForModeration(int id)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        if (await IsFeedItemDeletedAsync(tenantId, "listing", id))
        {
            return LaravelNotFound("Feed item not found");
        }

        var listing = await _db.Listings
            .Include(l => l.User)
            .Include(l => l.Tenant)
            .FirstOrDefaultAsync(l => l.TenantId == tenantId && l.Id == id && l.DeletedAt == null);

        if (listing == null)
        {
            return LaravelNotFound("Feed item not found");
        }

        var isHidden = await IsFeedItemHiddenAsync(tenantId, "listing", id);
        return Ok(new
        {
            success = true,
            data = MapLaravelFeedListing(listing, isHidden, Array.Empty<object>())
        });
    }

    private async Task<IActionResult> HideListingFeedItem(int id, int adminId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var authorId = await _db.Listings
            .Where(l => l.TenantId == tenantId && l.Id == id && l.DeletedAt == null)
            .Select(l => (int?)l.UserId)
            .FirstOrDefaultAsync();
        if (!authorId.HasValue || await IsFeedItemDeletedAsync(tenantId, "listing", id))
        {
            return LaravelNotFound("Feed item not found");
        }

        var guard = GuardBrokerNotAuthor(authorId.Value, adminId);
        if (guard != null) return guard;

        await SetFeedFlagAsync(tenantId, "listing", id, deleted: false);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} hid listing feed item {ListingId}", adminId, id);
        return Ok(new { success = true, data = new { success = true, message = "Feed item hidden" } });
    }

    private async Task<IActionResult> DeleteListingFeedItem(int id, int adminId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var authorId = await _db.Listings
            .Where(l => l.TenantId == tenantId && l.Id == id && l.DeletedAt == null)
            .Select(l => (int?)l.UserId)
            .FirstOrDefaultAsync();
        if (!authorId.HasValue || await IsFeedItemDeletedAsync(tenantId, "listing", id))
        {
            return LaravelNotFound("Feed item not found");
        }

        var guard = GuardBrokerNotAuthor(authorId.Value, adminId);
        if (guard != null) return guard;

        await SetFeedFlagAsync(tenantId, "listing", id, deleted: true);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} deleted listing feed item {ListingId}", adminId, id);
        return Ok(new { success = true, data = new { success = true, message = "Feed item deleted" } });
    }

    private async Task<IActionResult> GetEventModerationQueue(
        int tenantId,
        string? status,
        int? userId,
        string? search,
        int page,
        int limit)
    {
        var hiddenIds = await LoadFeedFlaggedIdsAsync(tenantId, "event", deleted: false);
        var deletedIds = await LoadFeedFlaggedIdsAsync(tenantId, "event", deleted: true);

        var query = _db.Events
            .Include(e => e.CreatedBy)
            .Include(e => e.Tenant)
            .Where(e => e.TenantId == tenantId && !e.IsCancelled && !deletedIds.Contains(e.Id));

        if (userId.HasValue && userId.Value > 0)
        {
            query = query.Where(e => e.CreatedById == userId.Value);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var normalizedSearch = search.Trim();
            query = query.Where(e =>
                e.Title.Contains(normalizedSearch) ||
                (e.Description != null && e.Description.Contains(normalizedSearch)) ||
                e.CreatedBy!.FirstName.Contains(normalizedSearch) ||
                e.CreatedBy.LastName.Contains(normalizedSearch) ||
                e.CreatedBy.Email.Contains(normalizedSearch));
        }

        if (!string.IsNullOrWhiteSpace(status))
        {
            if (status == "hidden")
                query = query.Where(e => hiddenIds.Contains(e.Id));
            else if (status == "active" || status == "visible")
                query = query.Where(e => !hiddenIds.Contains(e.Id));
            else if (status == "reported" || status == "flagged")
                query = query.Where(e => false);
        }

        query = query.OrderByDescending(e => e.CreatedAt);
        var total = await query.CountAsync();
        var events = await query
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return Ok(new
        {
            success = true,
            data = events.Select(evt => MapLaravelFeedEvent(evt, hiddenIds.Contains(evt.Id), recentComments: null)).ToList(),
            meta = BuildLaravelPaginationMeta(page, limit, total)
        });
    }

    private async Task<IActionResult> GetEventForModeration(int id)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        if (await IsFeedItemDeletedAsync(tenantId, "event", id))
        {
            return LaravelNotFound("Feed item not found");
        }

        var evt = await _db.Events
            .Include(e => e.CreatedBy)
            .Include(e => e.Tenant)
            .FirstOrDefaultAsync(e => e.TenantId == tenantId && e.Id == id && !e.IsCancelled);

        if (evt == null)
        {
            return LaravelNotFound("Feed item not found");
        }

        var isHidden = await IsFeedItemHiddenAsync(tenantId, "event", id);
        return Ok(new
        {
            success = true,
            data = MapLaravelFeedEvent(evt, isHidden, Array.Empty<object>())
        });
    }

    private async Task<IActionResult> HideEventFeedItem(int id, int adminId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var authorId = await _db.Events
            .Where(e => e.TenantId == tenantId && e.Id == id && !e.IsCancelled)
            .Select(e => (int?)e.CreatedById)
            .FirstOrDefaultAsync();
        if (!authorId.HasValue || await IsFeedItemDeletedAsync(tenantId, "event", id))
        {
            return LaravelNotFound("Feed item not found");
        }

        var guard = GuardBrokerNotAuthor(authorId.Value, adminId);
        if (guard != null) return guard;

        await SetFeedFlagAsync(tenantId, "event", id, deleted: false);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} hid event feed item {EventId}", adminId, id);
        return Ok(new { success = true, data = new { success = true, message = "Feed item hidden" } });
    }

    private async Task<IActionResult> DeleteEventFeedItem(int id, int adminId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var authorId = await _db.Events
            .Where(e => e.TenantId == tenantId && e.Id == id && !e.IsCancelled)
            .Select(e => (int?)e.CreatedById)
            .FirstOrDefaultAsync();
        if (!authorId.HasValue || await IsFeedItemDeletedAsync(tenantId, "event", id))
        {
            return LaravelNotFound("Feed item not found");
        }

        var guard = GuardBrokerNotAuthor(authorId.Value, adminId);
        if (guard != null) return guard;

        await SetFeedFlagAsync(tenantId, "event", id, deleted: true);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} deleted event feed item {EventId}", adminId, id);
        return Ok(new { success = true, data = new { success = true, message = "Feed item deleted" } });
    }

    private async Task<IActionResult> GetPollModerationQueue(
        int tenantId,
        string? status,
        int? userId,
        string? search,
        int page,
        int limit)
    {
        var hiddenIds = await LoadFeedFlaggedIdsAsync(tenantId, "poll", deleted: false);
        var deletedIds = await LoadFeedFlaggedIdsAsync(tenantId, "poll", deleted: true);

        var query = _db.Polls
            .Include(p => p.CreatedBy)
            .Include(p => p.Tenant)
            .Where(p => p.TenantId == tenantId && !deletedIds.Contains(p.Id));

        if (userId.HasValue && userId.Value > 0)
        {
            query = query.Where(p => p.CreatedById == userId.Value);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var normalizedSearch = search.Trim();
            query = query.Where(p =>
                p.Title.Contains(normalizedSearch) ||
                (p.Description != null && p.Description.Contains(normalizedSearch)) ||
                p.CreatedBy!.FirstName.Contains(normalizedSearch) ||
                p.CreatedBy.LastName.Contains(normalizedSearch) ||
                p.CreatedBy.Email.Contains(normalizedSearch));
        }

        if (!string.IsNullOrWhiteSpace(status))
        {
            if (status == "hidden")
                query = query.Where(p => hiddenIds.Contains(p.Id));
            else if (status == "active" || status == "visible")
                query = query.Where(p => !hiddenIds.Contains(p.Id));
            else if (status == "reported" || status == "flagged")
                query = query.Where(p => false);
        }

        query = query.OrderByDescending(p => p.CreatedAt);
        var total = await query.CountAsync();
        var polls = await query
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return Ok(new
        {
            success = true,
            data = polls.Select(poll => MapLaravelFeedPoll(poll, hiddenIds.Contains(poll.Id), recentComments: null)).ToList(),
            meta = BuildLaravelPaginationMeta(page, limit, total)
        });
    }

    private async Task<IActionResult> GetPollForModeration(int id)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        if (await IsFeedItemDeletedAsync(tenantId, "poll", id))
        {
            return LaravelNotFound("Feed item not found");
        }

        var poll = await _db.Polls
            .Include(p => p.CreatedBy)
            .Include(p => p.Tenant)
            .FirstOrDefaultAsync(p => p.TenantId == tenantId && p.Id == id);

        if (poll == null)
        {
            return LaravelNotFound("Feed item not found");
        }

        var isHidden = await IsFeedItemHiddenAsync(tenantId, "poll", id);
        return Ok(new
        {
            success = true,
            data = MapLaravelFeedPoll(poll, isHidden, Array.Empty<object>())
        });
    }

    private async Task<IActionResult> HidePollFeedItem(int id, int adminId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var authorId = await _db.Polls
            .Where(p => p.TenantId == tenantId && p.Id == id)
            .Select(p => (int?)p.CreatedById)
            .FirstOrDefaultAsync();
        if (!authorId.HasValue || await IsFeedItemDeletedAsync(tenantId, "poll", id))
        {
            return LaravelNotFound("Feed item not found");
        }

        var guard = GuardBrokerNotAuthor(authorId.Value, adminId);
        if (guard != null) return guard;

        await SetFeedFlagAsync(tenantId, "poll", id, deleted: false);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} hid poll feed item {PollId}", adminId, id);
        return Ok(new { success = true, data = new { success = true, message = "Feed item hidden" } });
    }

    private async Task<IActionResult> DeletePollFeedItem(int id, int adminId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var authorId = await _db.Polls
            .Where(p => p.TenantId == tenantId && p.Id == id)
            .Select(p => (int?)p.CreatedById)
            .FirstOrDefaultAsync();
        if (!authorId.HasValue || await IsFeedItemDeletedAsync(tenantId, "poll", id))
        {
            return LaravelNotFound("Feed item not found");
        }

        var guard = GuardBrokerNotAuthor(authorId.Value, adminId);
        if (guard != null) return guard;

        await SetFeedFlagAsync(tenantId, "poll", id, deleted: true);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} deleted poll feed item {PollId}", adminId, id);
        return Ok(new { success = true, data = new { success = true, message = "Feed item deleted" } });
    }

    private async Task<IActionResult> GetGoalModerationQueue(
        int tenantId,
        string? status,
        int? userId,
        string? search,
        int page,
        int limit)
    {
        var hiddenIds = await LoadFeedFlaggedIdsAsync(tenantId, "goal", deleted: false);
        var deletedIds = await LoadFeedFlaggedIdsAsync(tenantId, "goal", deleted: true);

        var query = _db.Goals
            .Include(g => g.User)
            .Include(g => g.Tenant)
            .Where(g => g.TenantId == tenantId && !deletedIds.Contains(g.Id));

        if (userId.HasValue && userId.Value > 0)
        {
            query = query.Where(g => g.UserId == userId.Value);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var normalizedSearch = search.Trim();
            query = query.Where(g =>
                g.Title.Contains(normalizedSearch) ||
                (g.Description != null && g.Description.Contains(normalizedSearch)) ||
                g.User!.FirstName.Contains(normalizedSearch) ||
                g.User.LastName.Contains(normalizedSearch) ||
                g.User.Email.Contains(normalizedSearch));
        }

        if (!string.IsNullOrWhiteSpace(status))
        {
            if (status == "hidden")
                query = query.Where(g => hiddenIds.Contains(g.Id));
            else if (status == "active" || status == "visible")
                query = query.Where(g => !hiddenIds.Contains(g.Id));
            else if (status == "reported" || status == "flagged")
                query = query.Where(g => false);
        }

        query = query.OrderByDescending(g => g.CreatedAt);
        var total = await query.CountAsync();
        var goals = await query
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return Ok(new
        {
            success = true,
            data = goals.Select(goal => MapLaravelFeedGoal(goal, hiddenIds.Contains(goal.Id), recentComments: null)).ToList(),
            meta = BuildLaravelPaginationMeta(page, limit, total)
        });
    }

    private async Task<IActionResult> GetGoalForModeration(int id)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        if (await IsFeedItemDeletedAsync(tenantId, "goal", id))
        {
            return LaravelNotFound("Feed item not found");
        }

        var goal = await _db.Goals
            .Include(g => g.User)
            .Include(g => g.Tenant)
            .FirstOrDefaultAsync(g => g.TenantId == tenantId && g.Id == id);

        if (goal == null)
        {
            return LaravelNotFound("Feed item not found");
        }

        var isHidden = await IsFeedItemHiddenAsync(tenantId, "goal", id);
        return Ok(new
        {
            success = true,
            data = MapLaravelFeedGoal(goal, isHidden, Array.Empty<object>())
        });
    }

    private async Task<IActionResult> HideGoalFeedItem(int id, int adminId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var authorId = await _db.Goals
            .Where(g => g.TenantId == tenantId && g.Id == id)
            .Select(g => (int?)g.UserId)
            .FirstOrDefaultAsync();
        if (!authorId.HasValue || await IsFeedItemDeletedAsync(tenantId, "goal", id))
        {
            return LaravelNotFound("Feed item not found");
        }

        var guard = GuardBrokerNotAuthor(authorId.Value, adminId);
        if (guard != null) return guard;

        await SetFeedFlagAsync(tenantId, "goal", id, deleted: false);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} hid goal feed item {GoalId}", adminId, id);
        return Ok(new { success = true, data = new { success = true, message = "Feed item hidden" } });
    }

    private async Task<IActionResult> DeleteGoalFeedItem(int id, int adminId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var authorId = await _db.Goals
            .Where(g => g.TenantId == tenantId && g.Id == id)
            .Select(g => (int?)g.UserId)
            .FirstOrDefaultAsync();
        if (!authorId.HasValue || await IsFeedItemDeletedAsync(tenantId, "goal", id))
        {
            return LaravelNotFound("Feed item not found");
        }

        var guard = GuardBrokerNotAuthor(authorId.Value, adminId);
        if (guard != null) return guard;

        await SetFeedFlagAsync(tenantId, "goal", id, deleted: true);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} deleted goal feed item {GoalId}", adminId, id);
        return Ok(new { success = true, data = new { success = true, message = "Feed item deleted" } });
    }

    private async Task<IActionResult> GetJobModerationQueue(
        int tenantId,
        string? status,
        int? userId,
        string? search,
        int page,
        int limit)
    {
        var hiddenIds = await LoadFeedFlaggedIdsAsync(tenantId, "job", deleted: false);
        var deletedIds = await LoadFeedFlaggedIdsAsync(tenantId, "job", deleted: true);

        var query = _db.JobVacancies
            .Include(j => j.PostedBy)
            .Include(j => j.Tenant)
            .Where(j => j.TenantId == tenantId && !deletedIds.Contains(j.Id));

        if (userId.HasValue && userId.Value > 0)
        {
            query = query.Where(j => j.PostedByUserId == userId.Value);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var normalizedSearch = search.Trim();
            query = query.Where(j =>
                j.Title.Contains(normalizedSearch) ||
                (j.Description != null && j.Description.Contains(normalizedSearch)) ||
                j.PostedBy!.FirstName.Contains(normalizedSearch) ||
                j.PostedBy.LastName.Contains(normalizedSearch) ||
                j.PostedBy.Email.Contains(normalizedSearch));
        }

        if (!string.IsNullOrWhiteSpace(status))
        {
            if (status == "hidden")
                query = query.Where(j => hiddenIds.Contains(j.Id));
            else if (status == "active" || status == "visible")
                query = query.Where(j => !hiddenIds.Contains(j.Id));
            else if (status == "reported" || status == "flagged")
                query = query.Where(j => false);
        }

        query = query.OrderByDescending(j => j.CreatedAt);
        var total = await query.CountAsync();
        var jobs = await query
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return Ok(new
        {
            success = true,
            data = jobs.Select(job => MapLaravelFeedJob(job, hiddenIds.Contains(job.Id), recentComments: null)).ToList(),
            meta = BuildLaravelPaginationMeta(page, limit, total)
        });
    }

    private async Task<IActionResult> GetJobForModeration(int id)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        if (await IsFeedItemDeletedAsync(tenantId, "job", id))
        {
            return LaravelNotFound("Feed item not found");
        }

        var job = await _db.JobVacancies
            .Include(j => j.PostedBy)
            .Include(j => j.Tenant)
            .FirstOrDefaultAsync(j => j.TenantId == tenantId && j.Id == id);

        if (job == null)
        {
            return LaravelNotFound("Feed item not found");
        }

        var isHidden = await IsFeedItemHiddenAsync(tenantId, "job", id);
        return Ok(new
        {
            success = true,
            data = MapLaravelFeedJob(job, isHidden, Array.Empty<object>())
        });
    }

    private async Task<IActionResult> HideJobFeedItem(int id, int adminId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var authorId = await _db.JobVacancies
            .Where(j => j.TenantId == tenantId && j.Id == id)
            .Select(j => (int?)j.PostedByUserId)
            .FirstOrDefaultAsync();
        if (!authorId.HasValue || await IsFeedItemDeletedAsync(tenantId, "job", id))
        {
            return LaravelNotFound("Feed item not found");
        }

        var guard = GuardBrokerNotAuthor(authorId.Value, adminId);
        if (guard != null) return guard;

        await SetFeedFlagAsync(tenantId, "job", id, deleted: false);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} hid job feed item {JobId}", adminId, id);
        return Ok(new { success = true, data = new { success = true, message = "Feed item hidden" } });
    }

    private async Task<IActionResult> DeleteJobFeedItem(int id, int adminId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var authorId = await _db.JobVacancies
            .Where(j => j.TenantId == tenantId && j.Id == id)
            .Select(j => (int?)j.PostedByUserId)
            .FirstOrDefaultAsync();
        if (!authorId.HasValue || await IsFeedItemDeletedAsync(tenantId, "job", id))
        {
            return LaravelNotFound("Feed item not found");
        }

        var guard = GuardBrokerNotAuthor(authorId.Value, adminId);
        if (guard != null) return guard;

        await SetFeedFlagAsync(tenantId, "job", id, deleted: true);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} deleted job feed item {JobId}", adminId, id);
        return Ok(new { success = true, data = new { success = true, message = "Feed item deleted" } });
    }

    private async Task<IActionResult> GetChallengeModerationQueue(
        int tenantId,
        string? status,
        int? userId,
        string? search,
        int page,
        int limit)
    {
        var hiddenIds = await LoadFeedFlaggedIdsAsync(tenantId, "challenge", deleted: false);
        var deletedIds = await LoadFeedFlaggedIdsAsync(tenantId, "challenge", deleted: true);
        HashSet<int>? authorChallengeIds = null;
        if (userId.HasValue && userId.Value > 0)
        {
            var authorExists = await _db.Users.AsNoTracking().AnyAsync(u => u.TenantId == tenantId && u.Id == userId.Value);
            if (!authorExists)
            {
                return Ok(new { success = true, data = Array.Empty<object>(), meta = BuildLaravelPaginationMeta(page, limit, 0) });
            }

            authorChallengeIds = await LoadFeedSourceIdsForAuthorAsync(tenantId, "challenge", userId.Value);
        }

        var query = _db.Challenges
            .Include(c => c.Tenant)
            .Where(c => c.TenantId == tenantId && !deletedIds.Contains(c.Id));

        if (authorChallengeIds != null)
        {
            query = query.Where(c => authorChallengeIds.Contains(c.Id));
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var normalizedSearch = search.Trim();
            query = query.Where(c =>
                c.Title.Contains(normalizedSearch) ||
                (c.Description != null && c.Description.Contains(normalizedSearch)));
        }

        if (!string.IsNullOrWhiteSpace(status))
        {
            if (status == "hidden")
                query = query.Where(c => hiddenIds.Contains(c.Id));
            else if (status == "active" || status == "visible")
                query = query.Where(c => !hiddenIds.Contains(c.Id));
            else if (status == "reported" || status == "flagged")
                query = query.Where(c => false);
        }

        query = query.OrderByDescending(c => c.CreatedAt);
        var total = await query.CountAsync();
        var challenges = await query
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();
        var authorsByChallengeId = await LoadFeedAuthorsBySourceIdAsync(tenantId, "challenge", challenges.Select(c => c.Id));
        var fallbackAuthor = await GetFeedSystemUserAsync(tenantId);

        return Ok(new
        {
            success = true,
            data = challenges
                .Select(challenge => MapLaravelFeedChallenge(
                    challenge,
                    authorsByChallengeId.GetValueOrDefault(challenge.Id) ?? fallbackAuthor,
                    hiddenIds.Contains(challenge.Id),
                    recentComments: null))
                .ToList(),
            meta = BuildLaravelPaginationMeta(page, limit, total)
        });
    }

    private async Task<IActionResult> GetChallengeForModeration(int id)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        if (await IsFeedItemDeletedAsync(tenantId, "challenge", id))
        {
            return LaravelNotFound("Feed item not found");
        }

        var challenge = await _db.Challenges
            .Include(c => c.Tenant)
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Id == id);

        if (challenge == null)
        {
            return LaravelNotFound("Feed item not found");
        }

        var isHidden = await IsFeedItemHiddenAsync(tenantId, "challenge", id);
        var feedAuthor = await LoadFeedAuthorAsync(tenantId, "challenge", id)
            ?? await GetFeedSystemUserAsync(tenantId);
        return Ok(new
        {
            success = true,
            data = MapLaravelFeedChallenge(challenge, feedAuthor, isHidden, Array.Empty<object>())
        });
    }

    private async Task<IActionResult> HideChallengeFeedItem(int id, int adminId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var challengeExists = await _db.Challenges.AnyAsync(c => c.TenantId == tenantId && c.Id == id);
        if (!challengeExists || await IsFeedItemDeletedAsync(tenantId, "challenge", id))
        {
            return LaravelNotFound("Feed item not found");
        }

        var authorId = await LoadFeedAuthorIdAsync(tenantId, "challenge", id);
        if (authorId.HasValue)
        {
            var guard = GuardBrokerNotAuthor(authorId.Value, adminId);
            if (guard != null) return guard;
        }

        await SetFeedFlagAsync(tenantId, "challenge", id, deleted: false);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} hid challenge feed item {ChallengeId}", adminId, id);
        return Ok(new { success = true, data = new { success = true, message = "Feed item hidden" } });
    }

    private async Task<IActionResult> DeleteChallengeFeedItem(int id, int adminId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var challengeExists = await _db.Challenges.AnyAsync(c => c.TenantId == tenantId && c.Id == id);
        if (!challengeExists || await IsFeedItemDeletedAsync(tenantId, "challenge", id))
        {
            return LaravelNotFound("Feed item not found");
        }

        var authorId = await LoadFeedAuthorIdAsync(tenantId, "challenge", id);
        if (authorId.HasValue)
        {
            var guard = GuardBrokerNotAuthor(authorId.Value, adminId);
            if (guard != null) return guard;
        }

        await SetFeedFlagAsync(tenantId, "challenge", id, deleted: true);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} deleted challenge feed item {ChallengeId}", adminId, id);
        return Ok(new { success = true, data = new { success = true, message = "Feed item deleted" } });
    }

    private async Task<IActionResult> GetVolunteerModerationQueue(
        int tenantId,
        string? status,
        int? userId,
        string? search,
        int page,
        int limit)
    {
        var hiddenIds = await LoadFeedFlaggedIdsAsync(tenantId, "volunteer", deleted: false);
        var deletedIds = await LoadFeedFlaggedIdsAsync(tenantId, "volunteer", deleted: true);

        var query = _db.VolunteerOpportunities
            .Include(o => o.Organizer)
            .Include(o => o.Tenant)
            .Where(o => o.TenantId == tenantId && o.Status != OpportunityStatus.Cancelled && !deletedIds.Contains(o.Id));

        if (userId.HasValue && userId.Value > 0)
        {
            query = query.Where(o => o.OrganizerId == userId.Value);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var normalizedSearch = search.Trim();
            query = query.Where(o =>
                o.Title.Contains(normalizedSearch) ||
                (o.Description != null && o.Description.Contains(normalizedSearch)) ||
                o.Organizer!.FirstName.Contains(normalizedSearch) ||
                o.Organizer.LastName.Contains(normalizedSearch) ||
                o.Organizer.Email.Contains(normalizedSearch));
        }

        if (!string.IsNullOrWhiteSpace(status))
        {
            if (status == "hidden")
                query = query.Where(o => hiddenIds.Contains(o.Id));
            else if (status == "active" || status == "visible")
                query = query.Where(o => !hiddenIds.Contains(o.Id));
            else if (status == "reported" || status == "flagged")
                query = query.Where(o => false);
        }

        query = query.OrderByDescending(o => o.CreatedAt);
        var total = await query.CountAsync();
        var opportunities = await query
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return Ok(new
        {
            success = true,
            data = opportunities.Select(opportunity => MapLaravelFeedVolunteer(opportunity, hiddenIds.Contains(opportunity.Id), recentComments: null)).ToList(),
            meta = BuildLaravelPaginationMeta(page, limit, total)
        });
    }

    private async Task<IActionResult> GetVolunteerForModeration(int id)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        if (await IsFeedItemDeletedAsync(tenantId, "volunteer", id))
        {
            return LaravelNotFound("Feed item not found");
        }

        var opportunity = await _db.VolunteerOpportunities
            .Include(o => o.Organizer)
            .Include(o => o.Tenant)
            .FirstOrDefaultAsync(o => o.TenantId == tenantId && o.Id == id && o.Status != OpportunityStatus.Cancelled);

        if (opportunity == null)
        {
            return LaravelNotFound("Feed item not found");
        }

        var isHidden = await IsFeedItemHiddenAsync(tenantId, "volunteer", id);
        return Ok(new
        {
            success = true,
            data = MapLaravelFeedVolunteer(opportunity, isHidden, Array.Empty<object>())
        });
    }

    private async Task<IActionResult> HideVolunteerFeedItem(int id, int adminId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var authorId = await _db.VolunteerOpportunities
            .Where(o => o.TenantId == tenantId && o.Id == id && o.Status != OpportunityStatus.Cancelled)
            .Select(o => (int?)o.OrganizerId)
            .FirstOrDefaultAsync();
        if (!authorId.HasValue || await IsFeedItemDeletedAsync(tenantId, "volunteer", id))
        {
            return LaravelNotFound("Feed item not found");
        }

        var guard = GuardBrokerNotAuthor(authorId.Value, adminId);
        if (guard != null) return guard;

        await SetFeedFlagAsync(tenantId, "volunteer", id, deleted: false);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} hid volunteer feed item {OpportunityId}", adminId, id);
        return Ok(new { success = true, data = new { success = true, message = "Feed item hidden" } });
    }

    private async Task<IActionResult> DeleteVolunteerFeedItem(int id, int adminId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var authorId = await _db.VolunteerOpportunities
            .Where(o => o.TenantId == tenantId && o.Id == id && o.Status != OpportunityStatus.Cancelled)
            .Select(o => (int?)o.OrganizerId)
            .FirstOrDefaultAsync();
        if (!authorId.HasValue || await IsFeedItemDeletedAsync(tenantId, "volunteer", id))
        {
            return LaravelNotFound("Feed item not found");
        }

        var guard = GuardBrokerNotAuthor(authorId.Value, adminId);
        if (guard != null) return guard;

        await SetFeedFlagAsync(tenantId, "volunteer", id, deleted: true);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} deleted volunteer feed item {OpportunityId}", adminId, id);
        return Ok(new { success = true, data = new { success = true, message = "Feed item deleted" } });
    }

    private async Task<IActionResult> GetBlogModerationQueue(
        int tenantId,
        string? status,
        int? userId,
        string? search,
        int page,
        int limit)
    {
        var hiddenIds = await LoadFeedFlaggedIdsAsync(tenantId, "blog", deleted: false);
        var deletedIds = await LoadFeedFlaggedIdsAsync(tenantId, "blog", deleted: true);

        var query = _db.BlogPosts
            .Include(b => b.Author)
            .Include(b => b.Tenant)
            .Where(b => b.TenantId == tenantId && b.Status != "archived" && !deletedIds.Contains(b.Id));

        if (userId.HasValue && userId.Value > 0)
        {
            query = query.Where(b => b.AuthorId == userId.Value);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var normalizedSearch = search.Trim();
            query = query.Where(b =>
                b.Title.Contains(normalizedSearch) ||
                b.Content.Contains(normalizedSearch) ||
                (b.Excerpt != null && b.Excerpt.Contains(normalizedSearch)) ||
                b.Author!.FirstName.Contains(normalizedSearch) ||
                b.Author.LastName.Contains(normalizedSearch) ||
                b.Author.Email.Contains(normalizedSearch));
        }

        if (!string.IsNullOrWhiteSpace(status))
        {
            if (status == "hidden")
                query = query.Where(b => hiddenIds.Contains(b.Id));
            else if (status == "active" || status == "visible")
                query = query.Where(b => !hiddenIds.Contains(b.Id));
            else if (status == "reported" || status == "flagged")
                query = query.Where(b => false);
        }

        query = query.OrderByDescending(b => b.CreatedAt);
        var total = await query.CountAsync();
        var blogs = await query
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return Ok(new
        {
            success = true,
            data = blogs.Select(blog => MapLaravelFeedBlog(blog, hiddenIds.Contains(blog.Id), recentComments: null)).ToList(),
            meta = BuildLaravelPaginationMeta(page, limit, total)
        });
    }

    private async Task<IActionResult> GetBlogForModeration(int id)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        if (await IsFeedItemDeletedAsync(tenantId, "blog", id))
        {
            return LaravelNotFound("Feed item not found");
        }

        var blog = await _db.BlogPosts
            .Include(b => b.Author)
            .Include(b => b.Tenant)
            .FirstOrDefaultAsync(b => b.TenantId == tenantId && b.Id == id && b.Status != "archived");

        if (blog == null)
        {
            return LaravelNotFound("Feed item not found");
        }

        var isHidden = await IsFeedItemHiddenAsync(tenantId, "blog", id);
        return Ok(new
        {
            success = true,
            data = MapLaravelFeedBlog(blog, isHidden, Array.Empty<object>())
        });
    }

    private async Task<IActionResult> HideBlogFeedItem(int id, int adminId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var authorId = await _db.BlogPosts
            .Where(b => b.TenantId == tenantId && b.Id == id && b.Status != "archived")
            .Select(b => (int?)b.AuthorId)
            .FirstOrDefaultAsync();
        if (!authorId.HasValue || await IsFeedItemDeletedAsync(tenantId, "blog", id))
        {
            return LaravelNotFound("Feed item not found");
        }

        var guard = GuardBrokerNotAuthor(authorId.Value, adminId);
        if (guard != null) return guard;

        await SetFeedFlagAsync(tenantId, "blog", id, deleted: false);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} hid blog feed item {BlogId}", adminId, id);
        return Ok(new { success = true, data = new { success = true, message = "Feed item hidden" } });
    }

    private async Task<IActionResult> DeleteBlogFeedItem(int id, int adminId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var authorId = await _db.BlogPosts
            .Where(b => b.TenantId == tenantId && b.Id == id && b.Status != "archived")
            .Select(b => (int?)b.AuthorId)
            .FirstOrDefaultAsync();
        if (!authorId.HasValue || await IsFeedItemDeletedAsync(tenantId, "blog", id))
        {
            return LaravelNotFound("Feed item not found");
        }

        var guard = GuardBrokerNotAuthor(authorId.Value, adminId);
        if (guard != null) return guard;

        await SetFeedFlagAsync(tenantId, "blog", id, deleted: true);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} deleted blog feed item {BlogId}", adminId, id);
        return Ok(new { success = true, data = new { success = true, message = "Feed item deleted" } });
    }

    private async Task<IActionResult> GetDiscussionModerationQueue(
        int tenantId,
        string? status,
        int? userId,
        string? search,
        int page,
        int limit)
    {
        var hiddenIds = await LoadFeedFlaggedIdsAsync(tenantId, "discussion", deleted: false);
        var deletedIds = await LoadFeedFlaggedIdsAsync(tenantId, "discussion", deleted: true);

        var query = _db.GroupDiscussions
            .Include(d => d.Author)
            .Include(d => d.Tenant)
            .Where(d => d.TenantId == tenantId && !deletedIds.Contains(d.Id));

        if (userId.HasValue && userId.Value > 0)
        {
            query = query.Where(d => d.AuthorId == userId.Value);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var normalizedSearch = search.Trim();
            query = query.Where(d =>
                d.Title.Contains(normalizedSearch) ||
                d.Content.Contains(normalizedSearch) ||
                d.Author!.FirstName.Contains(normalizedSearch) ||
                d.Author.LastName.Contains(normalizedSearch) ||
                d.Author.Email.Contains(normalizedSearch));
        }

        if (!string.IsNullOrWhiteSpace(status))
        {
            if (status == "hidden")
                query = query.Where(d => hiddenIds.Contains(d.Id));
            else if (status == "active" || status == "visible")
                query = query.Where(d => !hiddenIds.Contains(d.Id));
            else if (status == "reported" || status == "flagged")
                query = query.Where(d => false);
        }

        query = query.OrderByDescending(d => d.CreatedAt);
        var total = await query.CountAsync();
        var discussions = await query
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return Ok(new
        {
            success = true,
            data = discussions.Select(discussion => MapLaravelFeedDiscussion(discussion, hiddenIds.Contains(discussion.Id), recentComments: null)).ToList(),
            meta = BuildLaravelPaginationMeta(page, limit, total)
        });
    }

    private async Task<IActionResult> GetDiscussionForModeration(int id)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        if (await IsFeedItemDeletedAsync(tenantId, "discussion", id))
        {
            return LaravelNotFound("Feed item not found");
        }

        var discussion = await _db.GroupDiscussions
            .Include(d => d.Author)
            .Include(d => d.Tenant)
            .FirstOrDefaultAsync(d => d.TenantId == tenantId && d.Id == id);

        if (discussion == null)
        {
            return LaravelNotFound("Feed item not found");
        }

        var isHidden = await IsFeedItemHiddenAsync(tenantId, "discussion", id);
        return Ok(new
        {
            success = true,
            data = MapLaravelFeedDiscussion(discussion, isHidden, Array.Empty<object>())
        });
    }

    private async Task<IActionResult> HideDiscussionFeedItem(int id, int adminId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var authorId = await _db.GroupDiscussions
            .Where(d => d.TenantId == tenantId && d.Id == id)
            .Select(d => (int?)d.AuthorId)
            .FirstOrDefaultAsync();
        if (!authorId.HasValue || await IsFeedItemDeletedAsync(tenantId, "discussion", id))
        {
            return LaravelNotFound("Feed item not found");
        }

        var guard = GuardBrokerNotAuthor(authorId.Value, adminId);
        if (guard != null) return guard;

        await SetFeedFlagAsync(tenantId, "discussion", id, deleted: false);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} hid discussion feed item {DiscussionId}", adminId, id);
        return Ok(new { success = true, data = new { success = true, message = "Feed item hidden" } });
    }

    private async Task<IActionResult> DeleteDiscussionFeedItem(int id, int adminId)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var authorId = await _db.GroupDiscussions
            .Where(d => d.TenantId == tenantId && d.Id == id)
            .Select(d => (int?)d.AuthorId)
            .FirstOrDefaultAsync();
        if (!authorId.HasValue || await IsFeedItemDeletedAsync(tenantId, "discussion", id))
        {
            return LaravelNotFound("Feed item not found");
        }

        var guard = GuardBrokerNotAuthor(authorId.Value, adminId);
        if (guard != null) return guard;

        await SetFeedFlagAsync(tenantId, "discussion", id, deleted: true);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Admin {AdminId} deleted discussion feed item {DiscussionId}", adminId, id);
        return Ok(new { success = true, data = new { success = true, message = "Feed item deleted" } });
    }

    private IActionResult LaravelNotFound(string message)
    {
        return NotFound(new
        {
            success = false,
            error = new { code = "NOT_FOUND", message }
        });
    }

    private IActionResult? GuardBrokerNotAuthor(int authorId, int callerId)
    {
        if (CallerIsAdminTier() || authorId != callerId)
        {
            return null;
        }

        return StatusCode(StatusCodes.Status403Forbidden, new
        {
            success = false,
            error = new
            {
                code = "AUTH_INSUFFICIENT_PERMISSIONS",
                message = "Broker or coordinator cannot moderate their own content"
            }
        });
    }

    private bool CallerIsAdminTier()
    {
        var role = User.GetRole();
        return string.Equals(role, "admin", StringComparison.OrdinalIgnoreCase)
            || string.Equals(role, "super_admin", StringComparison.OrdinalIgnoreCase)
            || string.Equals(role, "tenant_admin", StringComparison.OrdinalIgnoreCase)
            || string.Equals(role, "god", StringComparison.OrdinalIgnoreCase);
    }

    private async Task<IReadOnlyList<object>> MapLaravelFeedPostsAsync(IReadOnlyList<FeedPost> posts, int tenantId)
    {
        var postIds = posts.Select(p => p.Id).ToArray();
        var likeCounts = await _db.PostLikes
            .Where(l => l.TenantId == tenantId && postIds.Contains(l.PostId))
            .GroupBy(l => l.PostId)
            .Select(g => new { PostId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.PostId, x => x.Count);
        var commentCounts = await _db.PostComments
            .Where(c => c.TenantId == tenantId && postIds.Contains(c.PostId))
            .GroupBy(c => c.PostId)
            .Select(g => new { PostId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.PostId, x => x.Count);
        var reportCounts = await _db.FeedReports
            .Where(r => r.TenantId == tenantId && r.Status == "pending" && postIds.Contains(r.PostId))
            .GroupBy(r => r.PostId)
            .Select(g => new { PostId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.PostId, x => x.Count);

        return posts
            .Select(post => MapLaravelFeedPost(
                post,
                likeCounts.GetValueOrDefault(post.Id),
                commentCounts.GetValueOrDefault(post.Id),
                reportCounts.GetValueOrDefault(post.Id),
                recentComments: null))
            .ToList();
    }

    private static object MapLaravelFeedPost(
        FeedPost post,
        int likesCount,
        int commentsCount,
        int pendingReportsCount,
        object? recentComments)
    {
        return new
        {
            id = post.Id,
            activity_id = post.Id,
            user_id = post.UserId,
            tenant_id = post.TenantId,
            tenant_name = post.Tenant?.Name ?? "Unknown",
            user_name = FullName(post.User),
            user_email = post.User?.Email,
            user_avatar = post.User?.AvatarUrl,
            type = "post",
            content = post.Content,
            image_url = post.ImageUrl,
            likes_count = likesCount,
            comments_count = commentsCount,
            is_hidden = post.IsHidden,
            is_flagged = pendingReportsCount > 0,
            reports_count = pendingReportsCount,
            visibility = post.IsHidden ? "hidden" : "visible",
            created_at = post.CreatedAt,
            recent_comments = recentComments ?? Array.Empty<object>()
        };
    }

    private static object MapLaravelFeedListing(Listing listing, bool isHidden, object? recentComments)
    {
        return new
        {
            id = listing.Id,
            activity_id = listing.Id,
            user_id = listing.UserId,
            tenant_id = listing.TenantId,
            tenant_name = listing.Tenant?.Name ?? "Unknown",
            user_name = FullName(listing.User),
            user_email = listing.User?.Email,
            user_avatar = listing.User?.AvatarUrl,
            type = "listing",
            content = string.IsNullOrWhiteSpace(listing.Description)
                ? listing.Title
                : $"{listing.Title}\n{listing.Description}",
            image_url = listing.ImageUrl,
            likes_count = 0,
            comments_count = 0,
            is_hidden = isHidden,
            is_flagged = false,
            reports_count = 0,
            visibility = isHidden ? "hidden" : "visible",
            created_at = listing.CreatedAt,
            recent_comments = recentComments ?? Array.Empty<object>()
        };
    }

    private static object MapLaravelFeedEvent(Event evt, bool isHidden, object? recentComments)
    {
        return new
        {
            id = evt.Id,
            activity_id = evt.Id,
            user_id = evt.CreatedById,
            tenant_id = evt.TenantId,
            tenant_name = evt.Tenant?.Name ?? "Unknown",
            user_name = FullName(evt.CreatedBy),
            user_email = evt.CreatedBy?.Email,
            user_avatar = evt.CreatedBy?.AvatarUrl,
            type = "event",
            content = string.IsNullOrWhiteSpace(evt.Description)
                ? evt.Title
                : $"{evt.Title}\n{evt.Description}",
            image_url = evt.ImageUrl,
            likes_count = 0,
            comments_count = 0,
            is_hidden = isHidden,
            is_flagged = false,
            reports_count = 0,
            visibility = isHidden ? "hidden" : "visible",
            created_at = evt.CreatedAt,
            recent_comments = recentComments ?? Array.Empty<object>()
        };
    }

    private static object MapLaravelFeedPoll(Poll poll, bool isHidden, object? recentComments)
    {
        return new
        {
            id = poll.Id,
            activity_id = poll.Id,
            user_id = poll.CreatedById,
            tenant_id = poll.TenantId,
            tenant_name = poll.Tenant?.Name ?? "Unknown",
            user_name = FullName(poll.CreatedBy),
            user_email = poll.CreatedBy?.Email,
            user_avatar = poll.CreatedBy?.AvatarUrl,
            type = "poll",
            content = string.IsNullOrWhiteSpace(poll.Description)
                ? poll.Title
                : $"{poll.Title}\n{poll.Description}",
            image_url = (string?)null,
            likes_count = 0,
            comments_count = 0,
            is_hidden = isHidden,
            is_flagged = false,
            reports_count = 0,
            visibility = isHidden ? "hidden" : "visible",
            created_at = poll.CreatedAt,
            recent_comments = recentComments ?? Array.Empty<object>()
        };
    }

    private static object MapLaravelFeedGoal(Goal goal, bool isHidden, object? recentComments)
    {
        return new
        {
            id = goal.Id,
            activity_id = goal.Id,
            user_id = goal.UserId,
            tenant_id = goal.TenantId,
            tenant_name = goal.Tenant?.Name ?? "Unknown",
            user_name = FullName(goal.User),
            user_email = goal.User?.Email,
            user_avatar = goal.User?.AvatarUrl,
            type = "goal",
            content = string.IsNullOrWhiteSpace(goal.Description)
                ? goal.Title
                : $"{goal.Title}\n{goal.Description}",
            image_url = (string?)null,
            likes_count = 0,
            comments_count = 0,
            is_hidden = isHidden,
            is_flagged = false,
            reports_count = 0,
            visibility = isHidden ? "hidden" : "visible",
            created_at = goal.CreatedAt,
            recent_comments = recentComments ?? Array.Empty<object>()
        };
    }

    private static object MapLaravelFeedJob(JobVacancy job, bool isHidden, object? recentComments)
    {
        return new
        {
            id = job.Id,
            activity_id = job.Id,
            user_id = job.PostedByUserId,
            tenant_id = job.TenantId,
            tenant_name = job.Tenant?.Name ?? "Unknown",
            user_name = FullName(job.PostedBy),
            user_email = job.PostedBy?.Email,
            user_avatar = job.PostedBy?.AvatarUrl,
            type = "job",
            content = string.IsNullOrWhiteSpace(job.Description)
                ? job.Title
                : $"{job.Title}\n{job.Description}",
            image_url = (string?)null,
            likes_count = 0,
            comments_count = 0,
            is_hidden = isHidden,
            is_flagged = false,
            reports_count = 0,
            visibility = isHidden ? "hidden" : "visible",
            created_at = job.CreatedAt,
            recent_comments = recentComments ?? Array.Empty<object>()
        };
    }

    private static object MapLaravelFeedChallenge(Challenge challenge, User? user, bool isHidden, object? recentComments)
    {
        return new
        {
            id = challenge.Id,
            activity_id = challenge.Id,
            user_id = user?.Id ?? 0,
            tenant_id = challenge.TenantId,
            tenant_name = challenge.Tenant?.Name ?? "Unknown",
            user_name = FullName(user),
            user_email = user?.Email,
            user_avatar = user?.AvatarUrl,
            type = "challenge",
            content = string.IsNullOrWhiteSpace(challenge.Description)
                ? challenge.Title
                : $"{challenge.Title}\n{challenge.Description}",
            image_url = (string?)null,
            likes_count = 0,
            comments_count = 0,
            is_hidden = isHidden,
            is_flagged = false,
            reports_count = 0,
            visibility = isHidden ? "hidden" : "visible",
            created_at = challenge.CreatedAt,
            recent_comments = recentComments ?? Array.Empty<object>()
        };
    }

    private static object MapLaravelFeedVolunteer(VolunteerOpportunity opportunity, bool isHidden, object? recentComments)
    {
        return new
        {
            id = opportunity.Id,
            activity_id = opportunity.Id,
            user_id = opportunity.OrganizerId,
            tenant_id = opportunity.TenantId,
            tenant_name = opportunity.Tenant?.Name ?? "Unknown",
            user_name = FullName(opportunity.Organizer),
            user_email = opportunity.Organizer?.Email,
            user_avatar = opportunity.Organizer?.AvatarUrl,
            type = "volunteer",
            content = string.IsNullOrWhiteSpace(opportunity.Description)
                ? opportunity.Title
                : $"{opportunity.Title}\n{opportunity.Description}",
            image_url = (string?)null,
            likes_count = 0,
            comments_count = 0,
            is_hidden = isHidden,
            is_flagged = false,
            reports_count = 0,
            visibility = isHidden ? "hidden" : "visible",
            created_at = opportunity.CreatedAt,
            recent_comments = recentComments ?? Array.Empty<object>()
        };
    }

    private static object MapLaravelFeedBlog(BlogPost blog, bool isHidden, object? recentComments)
    {
        return new
        {
            id = blog.Id,
            activity_id = blog.Id,
            user_id = blog.AuthorId,
            tenant_id = blog.TenantId,
            tenant_name = blog.Tenant?.Name ?? "Unknown",
            user_name = FullName(blog.Author),
            user_email = blog.Author?.Email,
            user_avatar = blog.Author?.AvatarUrl,
            type = "blog",
            content = string.IsNullOrWhiteSpace(blog.Excerpt)
                ? blog.Title
                : $"{blog.Title}\n{blog.Excerpt}",
            image_url = blog.FeaturedImageUrl,
            likes_count = 0,
            comments_count = 0,
            is_hidden = isHidden,
            is_flagged = false,
            reports_count = 0,
            visibility = isHidden ? "hidden" : "visible",
            created_at = blog.CreatedAt,
            recent_comments = recentComments ?? Array.Empty<object>()
        };
    }

    private static object MapLaravelFeedDiscussion(GroupDiscussion discussion, bool isHidden, object? recentComments)
    {
        return new
        {
            id = discussion.Id,
            activity_id = discussion.Id,
            user_id = discussion.AuthorId,
            tenant_id = discussion.TenantId,
            tenant_name = discussion.Tenant?.Name ?? "Unknown",
            user_name = FullName(discussion.Author),
            user_email = discussion.Author?.Email,
            user_avatar = discussion.Author?.AvatarUrl,
            type = "discussion",
            content = string.IsNullOrWhiteSpace(discussion.Content)
                ? discussion.Title
                : $"{discussion.Title}\n{discussion.Content}",
            image_url = (string?)null,
            likes_count = 0,
            comments_count = discussion.ReplyCount,
            is_hidden = isHidden,
            is_flagged = false,
            reports_count = 0,
            visibility = isHidden ? "hidden" : "visible",
            created_at = discussion.CreatedAt,
            recent_comments = recentComments ?? Array.Empty<object>()
        };
    }

    private async Task<User?> GetFeedSystemUserAsync(int tenantId)
    {
        var userId = User.GetUserId();
        if (userId.HasValue)
        {
            var currentUser = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId.Value && u.TenantId == tenantId);
            if (currentUser != null)
            {
                return currentUser;
            }
        }

        return await _db.Users
            .AsNoTracking()
            .OrderByDescending(u => u.Role == "admin")
            .ThenBy(u => u.Id)
            .FirstOrDefaultAsync(u => u.TenantId == tenantId);
    }

    private async Task<HashSet<int>> LoadFeedFlaggedIdsAsync(int tenantId, string type, bool deleted)
    {
        var prefix = FeedFlagKeyPrefix(type, deleted);
        var keys = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key.StartsWith(prefix) && c.Value == "true")
            .Select(c => c.Key)
            .ToListAsync();

        return keys
            .Select(key => int.TryParse(key[prefix.Length..], out var id) ? id : 0)
            .Where(id => id > 0)
            .ToHashSet();
    }

    private async Task<bool> IsFeedItemHiddenAsync(int tenantId, string type, int id)
    {
        var key = FeedFlagKey(type, id, deleted: false);
        return await _db.TenantConfigs.AnyAsync(c => c.TenantId == tenantId && c.Key == key && c.Value == "true");
    }

    private async Task<bool> IsFeedItemDeletedAsync(int tenantId, string type, int id)
    {
        var key = FeedFlagKey(type, id, deleted: true);
        return await _db.TenantConfigs.AnyAsync(c => c.TenantId == tenantId && c.Key == key && c.Value == "true");
    }

    private async Task<HashSet<int>> LoadFeedSourceIdsForAuthorAsync(int tenantId, string type, int authorId)
    {
        var prefix = FeedAuthorKeyPrefixFor(type);
        var keys = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key.StartsWith(prefix) && c.Value == authorId.ToString())
            .Select(c => c.Key)
            .ToListAsync();

        return keys
            .Select(key => int.TryParse(key[prefix.Length..], out var id) ? id : 0)
            .Where(id => id > 0)
            .ToHashSet();
    }

    private async Task<Dictionary<int, User?>> LoadFeedAuthorsBySourceIdAsync(int tenantId, string type, IEnumerable<int> sourceIds)
    {
        var sourceIdSet = sourceIds.Where(id => id > 0).ToHashSet();
        if (sourceIdSet.Count == 0)
        {
            return new Dictionary<int, User?>();
        }

        var prefix = FeedAuthorKeyPrefixFor(type);
        var authorRows = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key.StartsWith(prefix))
            .Select(c => new { c.Key, c.Value })
            .ToListAsync();

        var authorIdsBySourceId = authorRows
            .Select(row => new
            {
                SourceId = int.TryParse(row.Key[prefix.Length..], out var sourceId) ? sourceId : 0,
                AuthorId = int.TryParse(row.Value, out var authorId) ? authorId : 0
            })
            .Where(row => sourceIdSet.Contains(row.SourceId) && row.AuthorId > 0)
            .ToDictionary(row => row.SourceId, row => row.AuthorId);

        if (authorIdsBySourceId.Count == 0)
        {
            return new Dictionary<int, User?>();
        }

        var authorIds = authorIdsBySourceId.Values.ToHashSet();
        var usersById = await _db.Users
            .AsNoTracking()
            .Where(u => u.TenantId == tenantId && authorIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id);

        return authorIdsBySourceId.ToDictionary(
            pair => pair.Key,
            pair => usersById.GetValueOrDefault(pair.Value));
    }

    private async Task<User?> LoadFeedAuthorAsync(int tenantId, string type, int id)
    {
        var authorId = await LoadFeedAuthorIdAsync(tenantId, type, id);
        if (!authorId.HasValue)
        {
            return null;
        }

        return await _db.Users
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.TenantId == tenantId && u.Id == authorId.Value);
    }

    private async Task<int?> LoadFeedAuthorIdAsync(int tenantId, string type, int id)
    {
        var key = FeedAuthorKey(type, id);
        var value = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key == key)
            .Select(c => c.Value)
            .FirstOrDefaultAsync();

        return int.TryParse(value, out var authorId) && authorId > 0 ? authorId : null;
    }

    private async Task SetFeedFlagAsync(int tenantId, string type, int id, bool deleted)
    {
        var key = FeedFlagKey(type, id, deleted);
        var existing = await _db.TenantConfigs.FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == key);
        if (existing != null)
        {
            existing.Value = "true";
            existing.UpdatedAt = DateTime.UtcNow;
            return;
        }

        _db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenantId,
            Key = key,
            Value = "true",
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        });
    }

    private static string FeedFlagKey(string type, int id, bool deleted)
    {
        return FeedFlagKeyPrefix(type, deleted) + id;
    }

    private static string FeedFlagKeyPrefix(string type, bool deleted)
    {
        return (deleted ? FeedDeletedKeyPrefix : FeedHiddenKeyPrefix) + type + ".";
    }

    private static string FeedAuthorKey(string type, int id)
    {
        return FeedAuthorKeyPrefixFor(type) + id;
    }

    private static string FeedAuthorKeyPrefixFor(string type)
    {
        return FeedAuthorKeyPrefix + type + ".";
    }

    private static object BuildLaravelPaginationMeta(int page, int limit, int total)
    {
        var totalPages = total > 0 ? (int)Math.Ceiling(total / (double)limit) : 1;
        return new
        {
            current_page = page,
            page,
            total_pages = totalPages,
            per_page = limit,
            total,
            has_more = page < totalPages
        };
    }

    private static string FullName(User? user)
    {
        if (user == null)
        {
            return "Unknown";
        }

        var name = $"{user.FirstName} {user.LastName}".Trim();
        return string.IsNullOrWhiteSpace(name) ? user.Email : name;
    }
}

/// <summary>Request body for moderation actions.</summary>
public class AdminModerateRequest
{
    [JsonPropertyName("reason")]
    public string? Reason { get; set; }

    [JsonPropertyName("type")]
    public string? Type { get; set; }
}
