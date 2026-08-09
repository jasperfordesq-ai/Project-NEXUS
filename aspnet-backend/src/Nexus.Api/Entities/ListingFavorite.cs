// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a user's favorited listing.
/// Unique constraint: TenantId + ListingId + UserId.
/// Phase 20: Expanded Listings.
/// </summary>
public class ListingFavorite : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int ListingId { get; set; }
    public int UserId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public Listing? Listing { get; set; }
    public User? User { get; set; }
}
