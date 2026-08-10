// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a listing (offer or request) in the timebanking system.
/// Listings are scoped to a single tenant.
/// </summary>
public class Listing : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string? Description { get; set; }
    public ListingType Type { get; set; } = ListingType.Offer;
    public ListingStatus Status { get; set; } = ListingStatus.Active;
    public int? CategoryId { get; set; }
    public string? Location { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }
    public string? ImageUrl { get; set; }
    public decimal? EstimatedHours { get; set; }
    public bool IsFeatured { get; set; }
    public int ViewCount { get; set; }
    public DateTime? ExpiresAt { get; set; }
    public DateTime? DeletedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Admin moderation fields
    public string? RejectionReason { get; set; }
    public DateTime? ReviewedAt { get; set; }
    public int? ReviewedByUserId { get; set; }

    // Navigation
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
    public User? ReviewedByUser { get; set; }
    public Category? Category { get; set; }
}

/// <summary>
/// Type of listing: what the user is offering or requesting.
/// </summary>
public enum ListingType
{
    Offer,
    Request
}

/// <summary>
/// Status of the listing.
/// </summary>
public enum ListingStatus
{
    Draft,
    Active,
    Fulfilled,
    Expired,
    Cancelled,
    Pending,
    Rejected
}
