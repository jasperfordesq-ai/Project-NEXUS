// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// A listing shared from one tenant to a partner tenant via federation.
/// This is a denormalized copy of the source listing for cross-tenant browsing.
/// </summary>
public class FederatedListing : ITenantEntity
{
    public int Id { get; set; }

    /// <summary>
    /// The receiving tenant where this listing is displayed.
    /// </summary>
    public int TenantId { get; set; }

    /// <summary>
    /// The origin tenant that owns the original listing.
    /// </summary>
    public int SourceTenantId { get; set; }

    /// <summary>
    /// The ID of the original listing in the source tenant.
    /// </summary>
    public int SourceListingId { get; set; }

    [MaxLength(255)]
    public string Title { get; set; } = string.Empty;

    public string? Description { get; set; }

    /// <summary>
    /// Type of listing: "offer" or "request".
    /// </summary>
    [MaxLength(20)]
    public string ListingType { get; set; } = "offer";

    /// <summary>
    /// Display name of the listing owner (denormalized for privacy).
    /// </summary>
    [MaxLength(255)]
    public string OwnerDisplayName { get; set; } = string.Empty;

    public FederatedListingStatus Status { get; set; } = FederatedListingStatus.Active;

    /// <summary>
    /// When this listing was last synced from the source tenant.
    /// </summary>
    public DateTime SyncedAt { get; set; } = DateTime.UtcNow;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public Tenant? SourceTenant { get; set; }
}

/// <summary>
/// Status of a federated listing.
/// </summary>
public enum FederatedListingStatus
{
    /// <summary>Listing is active and visible in the partner tenant.</summary>
    Active,
    /// <summary>Listing has expired in the source tenant.</summary>
    Expired,
    /// <summary>Listing was withdrawn by the source tenant.</summary>
    Withdrawn
}
