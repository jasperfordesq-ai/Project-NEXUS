// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Extended group features: announcements, policies, discussions, files.
/// </summary>
[ApiController]
[Route("api/groups")]
[Authorize]
public class GroupFeaturesController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly GroupFeatureService _groupFeatures;
    private readonly ILogger<GroupFeaturesController> _logger;

    public GroupFeaturesController(NexusDbContext db, GroupFeatureService groupFeatures, ILogger<GroupFeaturesController> logger)
    {
        _db = db;
        _groupFeatures = groupFeatures;
        _logger = logger;
    }

    // === Announcements ===

    [HttpGet("{groupId:int}/announcements")]
    public async Task<IActionResult> GetAnnouncements(int groupId)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var announcements = await _groupFeatures.GetAnnouncementsAsync(groupId, userId.Value);

        return Ok(new
        {
            data = announcements.Select(a => new
            {
                id = a.Id,
                title = a.Title,
                content = a.Content,
                is_pinned = a.IsPinned,
                expires_at = a.ExpiresAt,
                author = a.Author != null ? new { id = a.Author.Id, first_name = a.Author.FirstName, last_name = a.Author.LastName } : null,
                created_at = a.CreatedAt
            })
        });
    }

    [HttpPost("{groupId:int}/announcements")]
    public async Task<IActionResult> CreateAnnouncement(int groupId, [FromBody] CreateAnnouncementRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (announcement, error) = await _groupFeatures.CreateAnnouncementAsync(
            groupId, userId.Value, request.Title, request.Content, request.IsPinned, request.ExpiresAt);

        if (error != null) return BadRequest(new { error });

        return Created($"/api/groups/{groupId}/announcements", new
        {
            id = announcement!.Id,
            title = announcement.Title,
            content = announcement.Content,
            is_pinned = announcement.IsPinned,
            created_at = announcement.CreatedAt
        });
    }

    [HttpDelete("{groupId:int}/announcements/{id:int}")]
    public async Task<IActionResult> DeleteAnnouncement(int groupId, int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var error = await _groupFeatures.DeleteAnnouncementAsync(id, userId.Value);
        if (error != null) return BadRequest(new { error });

        return NoContent();
    }

    // === Policies ===

    [HttpGet("{groupId:int}/policies")]
    public async Task<IActionResult> GetPolicies(int groupId)
    {
        var policies = await _groupFeatures.GetPoliciesAsync(groupId);

        return Ok(new
        {
            data = policies.Select(p => new { key = p.Key, value = p.Value, updated_at = p.UpdatedAt ?? p.CreatedAt })
        });
    }

    [HttpPut("{groupId:int}/policies")]
    public async Task<IActionResult> SetPolicy(int groupId, [FromBody] SetPolicyRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (policy, error) = await _groupFeatures.SetPolicyAsync(groupId, userId.Value, request.Key, request.Value);
        if (error != null) return BadRequest(new { error });

        return Ok(new { key = policy!.Key, value = policy.Value });
    }

    [HttpDelete("{groupId:int}/policies/{key}")]
    public async Task<IActionResult> DeletePolicy(int groupId, string key)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var error = await _groupFeatures.DeletePolicyAsync(groupId, userId.Value, key);
        if (error != null) return BadRequest(new { error });

        return NoContent();
    }

    // === Discussions ===

    [HttpGet("{groupId:int}/discussions")]
    public async Task<IActionResult> GetDiscussions(int groupId, [FromQuery] int page = 1, [FromQuery] int limit = 20)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (page < 1) page = 1;
        limit = Math.Clamp(limit, 1, 100);

        var discussions = await _groupFeatures.GetDiscussionsAsync(groupId, userId.Value, page, limit);

        var total = await _db.Set<Entities.GroupDiscussion>()
            .CountAsync(d => d.GroupId == groupId);

        return Ok(new
        {
            data = discussions.Select(d => new
            {
                id = d.Id,
                title = d.Title,
                content = d.Content.Length > 200 ? d.Content[..200] + "..." : d.Content,
                is_pinned = d.IsPinned,
                is_locked = d.IsLocked,
                reply_count = d.ReplyCount,
                last_reply_at = d.LastReplyAt,
                author = d.Author != null ? new { id = d.Author.Id, first_name = d.Author.FirstName, last_name = d.Author.LastName } : null,
                created_at = d.CreatedAt
            }),
            pagination = new { page, limit, total, pages = (int)Math.Ceiling((double)total / limit) }
        });
    }

    [HttpGet("{groupId:int}/discussions/{id:int}")]
    public async Task<IActionResult> GetDiscussion(int groupId, int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var discussion = await _groupFeatures.GetDiscussionWithRepliesAsync(id, userId.Value);
        if (discussion == null) return NotFound(new { error = "Discussion not found" });

        return Ok(new
        {
            id = discussion.Id,
            title = discussion.Title,
            content = discussion.Content,
            is_pinned = discussion.IsPinned,
            is_locked = discussion.IsLocked,
            reply_count = discussion.ReplyCount,
            author = discussion.Author != null ? new { id = discussion.Author.Id, first_name = discussion.Author.FirstName, last_name = discussion.Author.LastName } : null,
            replies = discussion.Replies.Select(r => new
            {
                id = r.Id,
                content = r.Content,
                author = r.Author != null ? new { id = r.Author.Id, first_name = r.Author.FirstName, last_name = r.Author.LastName } : null,
                created_at = r.CreatedAt
            }),
            created_at = discussion.CreatedAt
        });
    }

    [HttpPost("{groupId:int}/discussions")]
    public async Task<IActionResult> CreateDiscussion(int groupId, [FromBody] CreateDiscussionRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (discussion, error) = await _groupFeatures.CreateDiscussionAsync(
            groupId, userId.Value, request.Title, request.Content);

        if (error != null) return BadRequest(new { error });

        return Created($"/api/groups/{groupId}/discussions/{discussion!.Id}", new
        {
            id = discussion.Id,
            title = discussion.Title,
            content = discussion.Content,
            created_at = discussion.CreatedAt
        });
    }

    [HttpPost("{groupId:int}/discussions/{id:int}/replies")]
    public async Task<IActionResult> ReplyToDiscussion(int groupId, int id, [FromBody] CreateReplyRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (reply, error) = await _groupFeatures.ReplyToDiscussionAsync(id, userId.Value, request.Content);
        if (error != null) return BadRequest(new { error });

        return Created($"/api/groups/{groupId}/discussions/{id}", new
        {
            id = reply!.Id,
            content = reply.Content,
            created_at = reply.CreatedAt
        });
    }

    // === Files ===

    [HttpGet("{groupId:int}/files")]
    public async Task<IActionResult> GetFiles(int groupId)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var files = await _groupFeatures.GetFilesAsync(groupId, userId.Value);

        return Ok(new
        {
            data = files.Select(f => new
            {
                id = f.Id,
                file_name = f.FileName,
                file_url = f.FileUrl,
                content_type = f.ContentType,
                file_size_bytes = f.FileSizeBytes,
                description = f.Description,
                uploaded_by = f.UploadedBy != null ? new { id = f.UploadedBy.Id, first_name = f.UploadedBy.FirstName, last_name = f.UploadedBy.LastName } : null,
                created_at = f.CreatedAt
            })
        });
    }

    [HttpPost("{groupId:int}/files")]
    public async Task<IActionResult> AddFile(int groupId, [FromBody] AddFileRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (file, error) = await _groupFeatures.AddFileAsync(
            groupId, userId.Value, request.FileName, request.FileUrl,
            request.ContentType, request.FileSizeBytes, request.Description);

        if (error != null) return BadRequest(new { error });

        return Created($"/api/groups/{groupId}/files", new
        {
            id = file!.Id,
            file_name = file.FileName,
            file_url = file.FileUrl,
            created_at = file.CreatedAt
        });
    }

    [HttpDelete("{groupId:int}/files/{id:int}")]
    public async Task<IActionResult> DeleteFile(int groupId, int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var error = await _groupFeatures.DeleteFileAsync(id, userId.Value);
        if (error != null) return BadRequest(new { error });

        return NoContent();
    }
}

// === Request DTOs ===

public class CreateAnnouncementRequest
{
    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("content")]
    public string Content { get; set; } = string.Empty;

    [JsonPropertyName("is_pinned")]
    public bool IsPinned { get; set; }

    [JsonPropertyName("expires_at")]
    public DateTime? ExpiresAt { get; set; }
}

public class SetPolicyRequest
{
    [JsonPropertyName("key")]
    public string Key { get; set; } = string.Empty;

    [JsonPropertyName("value")]
    public string Value { get; set; } = string.Empty;
}

public class CreateDiscussionRequest
{
    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("content")]
    public string Content { get; set; } = string.Empty;
}

public class CreateReplyRequest
{
    [JsonPropertyName("content")]
    public string Content { get; set; } = string.Empty;
}

public class AddFileRequest
{
    [JsonPropertyName("file_name")]
    public string FileName { get; set; } = string.Empty;

    [JsonPropertyName("file_url")]
    public string FileUrl { get; set; } = string.Empty;

    [JsonPropertyName("content_type")]
    public string? ContentType { get; set; }

    [JsonPropertyName("file_size_bytes")]
    public long FileSizeBytes { get; set; }

    [JsonPropertyName("description")]
    public string? Description { get; set; }
}
