// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a badge that a user has chosen to feature prominently on their public profile.
/// Users can showcase up to a defined limit of earned badges, ordered by DisplayOrder.
/// </summary>
public class BadgeShowcase : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public int BadgeId { get; set; }

    /// <summary>
    /// Position in the user's showcase (lower = shown first).
    /// </summary>
    public int DisplayOrder { get; set; } = 0;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
    public Badge? Badge { get; set; }
}
