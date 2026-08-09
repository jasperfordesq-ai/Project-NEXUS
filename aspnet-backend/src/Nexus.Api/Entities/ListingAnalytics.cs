// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Tracks analytics metrics for a listing.
/// Phase 20: Expanded Listings.
/// </summary>
public class ListingAnalytics : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int ListingId { get; set; }

    public int ViewCount { get; set; } = 0;
    public int UniqueViewCount { get; set; } = 0;

    /// <summary>
    /// How many users initiated an exchange from this listing.
    /// </summary>
    public int ContactCount { get; set; } = 0;

    public int FavoriteCount { get; set; } = 0;
    public int ShareCount { get; set; } = 0;

    public DateTime? LastViewedAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public Listing? Listing { get; set; }
}
