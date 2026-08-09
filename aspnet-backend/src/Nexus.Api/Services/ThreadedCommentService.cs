// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Service for managing threaded comments on any target type (listings, posts, events, etc.).
/// Supports two levels of nesting (top-level + replies), soft-delete, and edit tracking.
/// </summary>
public class ThreadedCommentService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<ThreadedCommentService> _logger;

    private static readonly HashSet<string> ValidTargetTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "post", "listing", "event", "goal", "poll", "review", "volunteer", "challenge",
        "resource", "job", "blog", "discussion", "group", "page", "idea"
    };

    public ThreadedCommentService(NexusDbContext db, TenantContext tenantContext, ILogger<ThreadedCommentService> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>
    /// Get top-level comments with replies (2 levels deep) for a target, ordered by CreatedAt desc.
    /// </summary>
    public async Task<(List<ThreadedComment> Data, int Total)> GetCommentsAsync(
        int tenantId, string targetType, int targetId, int page, int limit)
    {
        var normalizedType = NormalizeTargetType(targetType);

        var query = _db.Set<ThreadedComment>()
            .AsNoTracking()
            .Where(c => c.TargetType == normalizedType && c.TargetId == targetId && c.ParentId == null);

        var total = await query.CountAsync();

        var data = await query
            .Include(c => c.Author)
            .Include(c => c.Replies.OrderBy(r => r.CreatedAt))
                .ThenInclude(r => r.Author)
            .OrderByDescending(c => c.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return (data, total);
    }

    /// <summary>
    /// Get a single comment with its author and replies.
    /// </summary>
    public async Task<ThreadedComment?> GetCommentAsync(int id)
    {
        return await _db.Set<ThreadedComment>()
            .AsNoTracking()
            .Include(c => c.Author)
            .Include(c => c.Replies.OrderBy(r => r.CreatedAt))
                .ThenInclude(r => r.Author)
            .FirstOrDefaultAsync(c => c.Id == id);
    }

    /// <summary>
    /// Create a comment. Validates content not empty and parent exists if provided.
    /// </summary>
    public async Task<(ThreadedComment? Comment, string? Error)> CreateCommentAsync(
        int tenantId, int userId, string targetType, int targetId, int? parentId, string content)
    {
        var sanitizedContent = LaravelHtmlSanitizer.Sanitize(content?.Trim() ?? string.Empty);
        if (string.IsNullOrWhiteSpace(sanitizedContent))
            return (null, "Content is required");

        var normalizedType = NormalizeTargetType(targetType);
        if (!ValidTargetTypes.Contains(normalizedType))
            return (null, "Invalid target type");

        if (parentId.HasValue)
        {
            var parent = await _db.Set<ThreadedComment>().FirstOrDefaultAsync(x => x.Id == parentId.Value);
            if (parent == null)
                return (null, "Parent comment not found");

            if (parent.TargetType != normalizedType || parent.TargetId != targetId)
                return (null, "Parent comment belongs to a different target");
        }

        var comment = new ThreadedComment
        {
            TenantId = tenantId,
            AuthorId = userId,
            TargetType = normalizedType,
            TargetId = targetId,
            ParentId = parentId,
            Content = sanitizedContent,
            IsEdited = false,
            IsDeleted = false,
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<ThreadedComment>().Add(comment);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Comment {CommentId} created by user {UserId} on {TargetType}/{TargetId}",
            comment.Id, userId, normalizedType, targetId);

        return (await GetCommentAsync(comment.Id), null);
    }

    /// <summary>
    /// Update a comment. Only the author can edit; sets IsEdited=true.
    /// </summary>
    public async Task<(ThreadedComment? Comment, string? Error)> UpdateCommentAsync(
        int id, int userId, string content)
    {
        var sanitizedContent = LaravelHtmlSanitizer.Sanitize(content?.Trim() ?? string.Empty);
        if (string.IsNullOrWhiteSpace(sanitizedContent))
            return (null, "Content is required");

        var comment = await _db.Set<ThreadedComment>().FirstOrDefaultAsync(x => x.Id == id);
        if (comment == null)
            return (null, "Comment not found");

        if (comment.IsDeleted)
            return (null, "Cannot edit a deleted comment");

        if (comment.AuthorId != userId)
            return (null, "You can only edit your own comments");

        comment.Content = sanitizedContent;
        comment.IsEdited = true;
        comment.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Comment {CommentId} updated by user {UserId}", id, userId);
        return (await GetCommentAsync(id), null);
    }

    /// <summary>
    /// Soft-delete a comment: sets IsDeleted=true and Content to "[deleted]". Only the author can delete.
    /// </summary>
    public async Task<(bool Success, string? Error)> DeleteCommentAsync(int id, int userId, bool isAdmin = false)
    {
        var comment = await _db.Set<ThreadedComment>().FirstOrDefaultAsync(x => x.Id == id);
        if (comment == null)
            return (false, "Comment not found");

        if (comment.IsDeleted)
            return (false, "Comment already deleted");

        if (comment.AuthorId != userId && !isAdmin)
            return (false, "You can only delete your own comments");

        comment.IsDeleted = true;
        comment.Content = "[deleted]";
        comment.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Comment {CommentId} soft-deleted by user {UserId}", id, userId);
        return (true, null);
    }

    /// <summary>
    /// Get count of non-deleted comments for a target.
    /// </summary>
    public async Task<int> GetCommentCountAsync(string targetType, int targetId)
    {
        return await _db.Set<ThreadedComment>()
            .CountAsync(c => c.TargetType == NormalizeTargetType(targetType) && c.TargetId == targetId && !c.IsDeleted);
    }

    public async Task<int> DeleteCommentTreeAsync(int id, int userId, bool isAdmin = false)
    {
        var comment = await _db.Set<ThreadedComment>().FirstOrDefaultAsync(x => x.Id == id);
        if (comment == null || comment.IsDeleted)
            return 0;

        if (comment.AuthorId != userId && !isAdmin)
            return -1;

        var ids = new List<int> { id };
        var frontier = new List<int> { id };

        while (frontier.Count > 0)
        {
            var children = await _db.Set<ThreadedComment>()
                .Where(c => c.ParentId.HasValue && frontier.Contains(c.ParentId.Value))
                .Select(c => c.Id)
                .ToListAsync();

            children = children.Except(ids).ToList();
            if (children.Count == 0) break;

            ids.AddRange(children);
            frontier = children;
        }

        var rows = await _db.Set<ThreadedComment>()
            .Where(c => ids.Contains(c.Id))
            .ToListAsync();

        _db.Set<ThreadedComment>().RemoveRange(rows);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Comment {CommentId} hard-deleted with {DeletedCount} rows by user {UserId}", id, rows.Count, userId);
        return rows.Count;
    }

    public static string NormalizeTargetType(string? targetType)
    {
        var normalized = targetType?.Trim().ToLowerInvariant() ?? string.Empty;
        return normalized switch
        {
            "feed_post" => "post",
            "blog_post" => "blog",
            "volunteering" or "volunteering_opportunity" => "volunteer",
            "ideation_challenge" => "challenge",
            _ => normalized
        };
    }
}
