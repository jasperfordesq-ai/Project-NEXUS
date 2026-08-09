// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Comment on a feed post.
/// Users can comment on posts to engage in discussions.
/// </summary>
public class PostComment : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int PostId { get; set; }
    public int UserId { get; set; }

    /// <summary>
    /// Optional parent comment ID for threaded/nested replies.
    /// Null = top-level comment, set = reply to another comment.
    /// </summary>
    public int? ParentCommentId { get; set; }

    /// <summary>
    /// Comment text content.
    /// </summary>
    public string Content { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public FeedPost? Post { get; set; }
    public User? User { get; set; }
    public PostComment? ParentComment { get; set; }
    public ICollection<PostComment> Replies { get; set; } = new List<PostComment>();
}
