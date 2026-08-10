// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// A community idea or suggestion submitted by a member.
/// Ideas can be voted on, discussed, and promoted to action.
/// </summary>
public class Idea : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int AuthorId { get; set; }

    [MaxLength(255)]
    public string Title { get; set; } = string.Empty;

    public string Content { get; set; } = string.Empty;

    [MaxLength(100)]
    public string? Category { get; set; }

    /// <summary>Status: "submitted", "under_review", "approved", "in_progress", "completed", "declined".</summary>
    [MaxLength(20)]
    public string Status { get; set; } = "submitted";

    public int UpvoteCount { get; set; }
    public int CommentCount { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation
    public Tenant? Tenant { get; set; }
    public User? Author { get; set; }
    public ICollection<IdeaVote> Votes { get; set; } = new List<IdeaVote>();
    public ICollection<IdeaComment> Comments { get; set; } = new List<IdeaComment>();
}

/// <summary>
/// An upvote on an idea.
/// </summary>
public class IdeaVote : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int IdeaId { get; set; }
    public int UserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Tenant? Tenant { get; set; }
    public Idea? Idea { get; set; }
    public User? User { get; set; }
}

/// <summary>
/// A comment on an idea.
/// </summary>
public class IdeaComment : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int IdeaId { get; set; }
    public int UserId { get; set; }

    [MaxLength(2000)]
    public string Content { get; set; } = string.Empty;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Tenant? Tenant { get; set; }
    public Idea? Idea { get; set; }
    public User? User { get; set; }
}
