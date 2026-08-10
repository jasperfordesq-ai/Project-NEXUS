// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// A named, ordered grouping of badges into a thematic collection (e.g., "Community Hero Set").
/// BadgeIds is stored as a JSON array of badge IDs.
/// </summary>
public class BadgeCollection : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string? IconUrl { get; set; }

    /// <summary>
    /// JSON array of badge IDs belonging to this collection.
    /// </summary>
    public string BadgeIds { get; set; } = string.Empty;

    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
}
