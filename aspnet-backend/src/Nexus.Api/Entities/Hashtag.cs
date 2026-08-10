// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a hashtag used across the platform (posts, listings, events).
/// </summary>
public class Hashtag : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public string Tag { get; set; } = string.Empty; // stored lowercase without #
    public int UsageCount { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime LastUsedAt { get; set; } = DateTime.UtcNow;

    public Tenant? Tenant { get; set; }
    public List<HashtagUsage> Usages { get; set; } = new();
}

/// <summary>
/// Links a hashtag to a specific content item.
/// </summary>
public class HashtagUsage : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int HashtagId { get; set; }
    public string TargetType { get; set; } = string.Empty; // post, listing, event
    public int TargetId { get; set; }
    public int CreatedById { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public Tenant? Tenant { get; set; }
    public Hashtag? Hashtag { get; set; }
    public User? CreatedBy { get; set; }
}
