// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// User preferences for email digest notifications.
/// </summary>
public class DigestPreference : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    /// <summary>
    /// How often to receive digests.
    /// </summary>
    public DigestFrequency Frequency { get; set; } = DigestFrequency.Weekly;

    public bool IncludeNewListings { get; set; } = true;
    public bool IncludeExchangeUpdates { get; set; } = true;
    public bool IncludeGroupActivity { get; set; } = true;
    public bool IncludeEventReminders { get; set; } = true;
    public bool IncludeCommunityHighlights { get; set; } = true;

    /// <summary>
    /// When the last digest was sent.
    /// </summary>
    public DateTime? LastSentAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}

public enum DigestFrequency
{
    None,
    Daily,
    Weekly,
    Monthly
}
