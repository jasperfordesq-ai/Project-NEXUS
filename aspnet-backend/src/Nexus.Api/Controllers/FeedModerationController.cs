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
/// Feed moderation controller - report posts and review reported content.
/// Supplements the existing FeedController with moderation capabilities.
/// </summary>
[ApiController]
[Authorize]
public class FeedModerationController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<FeedModerationController> _logger;

    public FeedModerationController(
        NexusDbContext db,
        TenantContext tenantContext,
        ILogger<FeedModerationController> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>
    /// POST /api/feed/{id}/report - Report a post.
    /// </summary>
    [HttpPost("api/feed/{id:int}/report")]
    public async Task<IActionResult> ReportPost(int id, [FromBody] ReportPostRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.GetTenantIdOrThrow();

        // Verify post exists
        var post = await _db.FeedPosts.FirstOrDefaultAsync(p => p.Id == id);
        if (post == null)
            return NotFound(new { error = "Post not found" });

        // Cannot report your own post
        if (post.UserId == userId.Value)
            return BadRequest(new { error = "You cannot report your own post" });

        // Check if user already reported this post
        var alreadyReported = await _db.ContentReports
            .AnyAsync(r => r.ReporterId == userId.Value
                        && r.ContentType == "post"
                        && r.ContentId == id);

        if (alreadyReported)
            return Conflict(new { error = "You have already reported this post" });

        // Parse reason, default to Other
        ReportReason reason;
        if (!Enum.TryParse<ReportReason>(request.Reason, ignoreCase: true, out reason))
            reason = ReportReason.Other;

        var report = new ContentReport
        {
            TenantId = tenantId,
            ReporterId = userId.Value,
            ContentType = "post",
            ContentId = id,
            Reason = reason,
            Description = request.Description?.Trim(),
            Status = ReportStatus.Pending,
            CreatedAt = DateTime.UtcNow
        };

        _db.ContentReports.Add(report);
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} reported post {PostId} for {Reason}",
            userId, id, reason);

        return Ok(new
        {
            success = true,
            message = "Post reported successfully",
            report_id = report.Id
        });
    }

    /// <summary>
    /// GET /api/admin/feed/reported - List reported posts with report details.
    /// </summary>
    [HttpGet("api/admin/feed/reported")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> GetReportedPosts(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        [FromQuery] string? status = null)
    {
        if (page < 1) page = 1;
        limit = Math.Clamp(limit, 1, 100);

        var query = _db.ContentReports
            .Include(r => r.Reporter)
            .Where(r => r.ContentType == "post");

        // Filter by status if provided
        if (!string.IsNullOrEmpty(status) && Enum.TryParse<ReportStatus>(status, ignoreCase: true, out var parsedStatus))
        {
            query = query.Where(r => r.Status == parsedStatus);
        }

        var total = await query.CountAsync();

        var reports = await query
            .OrderByDescending(r => r.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        // Load the associated posts
        var postIds = reports.Select(r => r.ContentId).Distinct().ToList();
        var posts = await _db.FeedPosts
            .Include(p => p.User)
            .Where(p => postIds.Contains(p.Id))
            .ToDictionaryAsync(p => p.Id);

        var result = reports.Select(r =>
        {
            posts.TryGetValue(r.ContentId, out var post);
            return new
            {
                report_id = r.Id,
                reason = r.Reason.ToString(),
                description = r.Description,
                status = r.Status.ToString(),
                created_at = r.CreatedAt,
                reporter = r.Reporter != null ? new
                {
                    id = r.Reporter.Id,
                    first_name = r.Reporter.FirstName,
                    last_name = r.Reporter.LastName
                } : null,
                post = post != null ? new
                {
                    id = post.Id,
                    content = post.Content,
                    created_at = post.CreatedAt,
                    author = post.User != null ? new
                    {
                        id = post.User.Id,
                        first_name = post.User.FirstName,
                        last_name = post.User.LastName
                    } : null
                } : null,
                reviewed_at = r.ReviewedAt,
                review_notes = r.ReviewNotes,
                action_taken = r.ActionTaken
            };
        });

        return Ok(new
        {
            data = result,
            pagination = new
            {
                page,
                limit,
                total,
                pages = (int)Math.Ceiling((double)total / limit)
            }
        });
    }
}

public class ReportPostRequest
{
    [JsonPropertyName("reason")]
    public string Reason { get; set; } = "Other";

    [JsonPropertyName("description")]
    public string? Description { get; set; }
}
