// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

/// <summary>
/// Extended group features: announcements, policies, files, discussions.
/// </summary>
public class GroupFeatureService
{
    private readonly NexusDbContext _db;
    private readonly ILogger<GroupFeatureService> _logger;

    public GroupFeatureService(NexusDbContext db, ILogger<GroupFeatureService> logger)
    {
        _db = db;
        _logger = logger;
    }

    // === Announcements ===

    public async Task<(GroupAnnouncement? Announcement, string? Error)> CreateAnnouncementAsync(
        int groupId, int authorId, string title, string content, bool isPinned, DateTime? expiresAt)
    {
        var membership = await GetMembershipAsync(groupId, authorId);
        if (membership == null)
            return (null, "You are not a member of this group");

        if (membership.Role != Group.Roles.Admin && membership.Role != Group.Roles.Owner)
            return (null, "Only group admins can create announcements");

        var announcement = new GroupAnnouncement
        {
            GroupId = groupId,
            AuthorId = authorId,
            Title = title.Trim(),
            Content = content.Trim(),
            IsPinned = isPinned,
            ExpiresAt = expiresAt,
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<GroupAnnouncement>().Add(announcement);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Announcement created in group {GroupId} by user {UserId}", groupId, authorId);
        return (announcement, null);
    }

    public async Task<List<GroupAnnouncement>> GetAnnouncementsAsync(int groupId, int userId)
    {
        var membership = await GetMembershipAsync(groupId, userId);
        if (membership == null) return new List<GroupAnnouncement>();

        return await _db.Set<GroupAnnouncement>()
            .Where(a => a.GroupId == groupId && (a.ExpiresAt == null || a.ExpiresAt > DateTime.UtcNow))
            .OrderByDescending(a => a.IsPinned)
            .ThenByDescending(a => a.CreatedAt)
            .Include(a => a.Author)
            .ToListAsync();
    }

    public async Task<string?> DeleteAnnouncementAsync(int announcementId, int userId)
    {
        var announcement = await _db.Set<GroupAnnouncement>()
            .FirstOrDefaultAsync(a => a.Id == announcementId);

        if (announcement == null) return "Announcement not found";

        var membership = await GetMembershipAsync(announcement.GroupId, userId);
        if (membership == null) return "You are not a member of this group";

        if (announcement.AuthorId != userId && membership.Role != Group.Roles.Owner)
            return "Only the author or group owner can delete announcements";

        _db.Set<GroupAnnouncement>().Remove(announcement);
        await _db.SaveChangesAsync();
        return null;
    }

    // === Policies ===

    public async Task<(GroupPolicy? Policy, string? Error)> SetPolicyAsync(
        int groupId, int userId, string key, string value)
    {
        var membership = await GetMembershipAsync(groupId, userId);
        if (membership == null)
            return (null, "You are not a member of this group");
        if (membership.Role != Group.Roles.Owner && membership.Role != Group.Roles.Admin)
            return (null, "Only admins can manage group policies");

        var existing = await _db.Set<GroupPolicy>()
            .FirstOrDefaultAsync(p => p.GroupId == groupId && p.Key == key);

        if (existing != null)
        {
            existing.Value = value;
            existing.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
            return (existing, null);
        }

        var policy = new GroupPolicy
        {
            GroupId = groupId,
            Key = key.Trim(),
            Value = value,
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<GroupPolicy>().Add(policy);
        await _db.SaveChangesAsync();
        return (policy, null);
    }

    public async Task<List<GroupPolicy>> GetPoliciesAsync(int groupId)
    {
        return await _db.Set<GroupPolicy>()
            .Where(p => p.GroupId == groupId)
            .OrderBy(p => p.Key)
            .ToListAsync();
    }

    public async Task<string?> DeletePolicyAsync(int groupId, int userId, string key)
    {
        var membership = await GetMembershipAsync(groupId, userId);
        if (membership == null) return "You are not a member of this group";
        if (membership.Role != Group.Roles.Owner && membership.Role != Group.Roles.Admin)
            return "Only admins can manage group policies";

        var policy = await _db.Set<GroupPolicy>()
            .FirstOrDefaultAsync(p => p.GroupId == groupId && p.Key == key);

        if (policy == null) return "Policy not found";

        _db.Set<GroupPolicy>().Remove(policy);
        await _db.SaveChangesAsync();
        return null;
    }

    // === Discussions ===

    public async Task<(GroupDiscussion? Discussion, string? Error)> CreateDiscussionAsync(
        int groupId, int authorId, string title, string content)
    {
        var membership = await GetMembershipAsync(groupId, authorId);
        if (membership == null)
            return (null, "You are not a member of this group");

        var discussion = new GroupDiscussion
        {
            GroupId = groupId,
            AuthorId = authorId,
            Title = title.Trim(),
            Content = content.Trim(),
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<GroupDiscussion>().Add(discussion);
        await _db.SaveChangesAsync();
        return (discussion, null);
    }

    public async Task<(GroupDiscussionReply? Reply, string? Error)> ReplyToDiscussionAsync(
        int discussionId, int authorId, string content)
    {
        var discussion = await _db.Set<GroupDiscussion>()
            .FirstOrDefaultAsync(d => d.Id == discussionId);

        if (discussion == null)
            return (null, "Discussion not found");

        if (discussion.IsLocked)
            return (null, "This discussion is locked");

        var membership = await GetMembershipAsync(discussion.GroupId, authorId);
        if (membership == null)
            return (null, "You are not a member of this group");

        var reply = new GroupDiscussionReply
        {
            DiscussionId = discussionId,
            AuthorId = authorId,
            Content = content.Trim(),
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<GroupDiscussionReply>().Add(reply);

        discussion.ReplyCount++;
        discussion.LastReplyAt = DateTime.UtcNow;
        discussion.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        return (reply, null);
    }

    public async Task<List<GroupDiscussion>> GetDiscussionsAsync(int groupId, int userId, int page, int limit)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);

        var membership = await GetMembershipAsync(groupId, userId);
        if (membership == null) return new List<GroupDiscussion>();

        return await _db.Set<GroupDiscussion>()
            .Where(d => d.GroupId == groupId)
            .OrderByDescending(d => d.IsPinned)
            .ThenByDescending(d => d.LastReplyAt ?? d.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Include(d => d.Author)
            .ToListAsync();
    }

    public async Task<GroupDiscussion?> GetDiscussionWithRepliesAsync(int discussionId, int userId)
    {
        var discussion = await _db.Set<GroupDiscussion>()
            .Include(d => d.Author)
            .Include(d => d.Replies.OrderBy(r => r.CreatedAt))
            .ThenInclude(r => r.Author)
            .FirstOrDefaultAsync(d => d.Id == discussionId);

        if (discussion == null) return null;

        var membership = await GetMembershipAsync(discussion.GroupId, userId);
        if (membership == null) return null;

        return discussion;
    }

    // === Files ===

    public async Task<(GroupFile? File, string? Error)> AddFileAsync(
        int groupId, int userId, string fileName, string fileUrl, string? contentType, long fileSizeBytes, string? description)
    {
        var membership = await GetMembershipAsync(groupId, userId);
        if (membership == null)
            return (null, "You are not a member of this group");

        var file = new GroupFile
        {
            GroupId = groupId,
            UploadedById = userId,
            FileName = fileName.Trim(),
            FileUrl = fileUrl,
            ContentType = contentType,
            FileSizeBytes = fileSizeBytes,
            Description = description?.Trim(),
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<GroupFile>().Add(file);
        await _db.SaveChangesAsync();
        return (file, null);
    }

    public async Task<List<GroupFile>> GetFilesAsync(int groupId, int userId)
    {
        var membership = await GetMembershipAsync(groupId, userId);
        if (membership == null) return new List<GroupFile>();

        return await _db.Set<GroupFile>()
            .Where(f => f.GroupId == groupId)
            .OrderByDescending(f => f.CreatedAt)
            .Include(f => f.UploadedBy)
            .ToListAsync();
    }

    public async Task<string?> DeleteFileAsync(int fileId, int userId)
    {
        var file = await _db.Set<GroupFile>()
            .FirstOrDefaultAsync(f => f.Id == fileId);

        if (file == null) return "File not found";

        var membership = await GetMembershipAsync(file.GroupId, userId);
        if (membership == null) return "You are not a member of this group";

        if (file.UploadedById != userId && membership.Role != Group.Roles.Owner && membership.Role != Group.Roles.Admin)
            return "Only the uploader or group admins can delete files";

        _db.Set<GroupFile>().Remove(file);
        await _db.SaveChangesAsync();
        return null;
    }

    // === Helpers ===

    private async Task<GroupMember?> GetMembershipAsync(int groupId, int userId)
    {
        return await _db.GroupMembers
            .FirstOrDefaultAsync(m => m.GroupId == groupId && m.UserId == userId);
    }
}
