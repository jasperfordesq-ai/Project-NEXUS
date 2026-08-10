// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// A threaded discussion within a group (like a forum topic).
/// </summary>
public class GroupDiscussion : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int GroupId { get; set; }
    public int AuthorId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public bool IsPinned { get; set; }
    public bool IsLocked { get; set; }
    public int ReplyCount { get; set; }
    public DateTime? LastReplyAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation
    public Tenant? Tenant { get; set; }
    public Group? Group { get; set; }
    public User? Author { get; set; }
    public ICollection<GroupDiscussionReply> Replies { get; set; } = new List<GroupDiscussionReply>();
}

/// <summary>
/// A reply to a group discussion.
/// </summary>
public class GroupDiscussionReply : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int DiscussionId { get; set; }
    public int AuthorId { get; set; }
    public string Content { get; set; } = string.Empty;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation
    public Tenant? Tenant { get; set; }
    public GroupDiscussion? Discussion { get; set; }
    public User? Author { get; set; }
}
