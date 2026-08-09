// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;
using Microsoft.EntityFrameworkCore;

namespace Nexus.Api.Entities;

/// <summary>
/// Bookmark (save) a feed post for later reading.
/// Unique constraint on TenantId + UserId + PostId prevents duplicate bookmarks.
/// </summary>
[Index(nameof(TenantId), nameof(UserId), nameof(PostId), IsUnique = true)]
public class FeedBookmark : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// User who bookmarked the post.
    /// </summary>
    public int UserId { get; set; }

    /// <summary>
    /// The bookmarked post.
    /// </summary>
    public int PostId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
    public FeedPost? Post { get; set; }
}
