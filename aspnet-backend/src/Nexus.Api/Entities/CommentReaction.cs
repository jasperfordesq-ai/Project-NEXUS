// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Emoji reaction on a threaded comment. One reaction per user per comment.
/// </summary>
public class CommentReaction : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int CommentId { get; set; }
    public int UserId { get; set; }

    [MaxLength(20)]
    public string ReactionType { get; set; } = PostReaction.Types.Like;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public ThreadedComment? Comment { get; set; }
    public User? User { get; set; }
}
