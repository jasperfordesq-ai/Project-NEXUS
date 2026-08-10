// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Durable Laravel-compatible mention evidence for comments and future social
/// entities. Comment mentions populate both CommentId and EntityId.
/// </summary>
public sealed class ContentMention : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int? CommentId { get; set; }
    public int MentionedUserId { get; set; }
    public int MentioningUserId { get; set; }
    public string EntityType { get; set; } = "comment";
    public int? EntityId { get; set; }
    public DateTime? SeenAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Tenant? Tenant { get; set; }
    public ThreadedComment? Comment { get; set; }
    public User? MentionedUser { get; set; }
    public User? MentioningUser { get; set; }
}
