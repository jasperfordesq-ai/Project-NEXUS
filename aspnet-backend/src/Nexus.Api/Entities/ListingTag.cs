// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// A tag attached to a listing (skill tag or risk tag).
/// Unique constraint: TenantId + ListingId + Tag.
/// Phase 20: Expanded Listings.
/// </summary>
public class ListingTag : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int ListingId { get; set; }

    [Required]
    [MaxLength(100)]
    public string Tag { get; set; } = string.Empty;

    /// <summary>
    /// Type of tag: "skill" or "risk".
    /// </summary>
    [Required]
    [MaxLength(20)]
    public string TagType { get; set; } = "skill";

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public Listing? Listing { get; set; }
}
