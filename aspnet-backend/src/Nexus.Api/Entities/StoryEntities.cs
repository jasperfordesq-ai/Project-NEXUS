// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

public class Story : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public string MediaUrl { get; set; } = string.Empty;
    public string MediaType { get; set; } = "image";
    public string? Caption { get; set; }
    public string Visibility { get; set; } = "public";
    public string? StickersJson { get; set; }
    public DateTime ExpiresAt { get; set; } = DateTime.UtcNow.AddHours(24);
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class StoryView : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int StoryId { get; set; }
    public int UserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class StoryReaction : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int StoryId { get; set; }
    public int UserId { get; set; }
    public string Reaction { get; set; } = "like";
    public string? Reply { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class StoryCloseFriend : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public int FriendUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

public class StoryHighlight : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? CoverUrl { get; set; }
    public int SortOrder { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
}

public class StoryHighlightItem : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int HighlightId { get; set; }
    public int StoryId { get; set; }
    public int SortOrder { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}
