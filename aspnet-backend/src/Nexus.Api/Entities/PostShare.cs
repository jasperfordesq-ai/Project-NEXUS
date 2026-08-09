// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Tracks when a user shares a feed post.
/// SharedTo indicates the channel: "internal", "external", or "copy_link".
/// </summary>
public class PostShare : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// User who shared the post.
    /// </summary>
    public int UserId { get; set; }

    /// <summary>
    /// The shared post.
    /// </summary>
    public int PostId { get; set; }

    /// <summary>
    /// Laravel-compatible polymorphic feed item type.
    /// </summary>
    [MaxLength(50)]
    public string OriginalType { get; set; } = "post";

    /// <summary>
    /// Laravel-compatible polymorphic feed item id.
    /// </summary>
    public int OriginalPostId { get; set; }

    /// <summary>
    /// Optional repost/share comment.
    /// </summary>
    [MaxLength(1000)]
    public string? Comment { get; set; }

    /// <summary>
    /// Where the post was shared to: "internal", "external", or "copy_link".
    /// </summary>
    [MaxLength(50)]
    public string? SharedTo { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
    public FeedPost? Post { get; set; }

    // Valid SharedTo values
    public static class Channels
    {
        public const string Internal = "internal";
        public const string External = "external";
        public const string CopyLink = "copy_link";

        public static readonly string[] All = { Internal, External, CopyLink };
    }
}
