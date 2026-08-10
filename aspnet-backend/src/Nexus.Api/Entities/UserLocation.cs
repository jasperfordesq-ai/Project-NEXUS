// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Stores a user's geographic location for proximity-based features.
/// One location per user per tenant (unique: TenantId + UserId).
/// Privacy-aware: IsPublic controls whether other users can see exact coordinates.
/// </summary>
public class UserLocation : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    public double Latitude { get; set; }
    public double Longitude { get; set; }

    [MaxLength(255)]
    public string? City { get; set; }

    [MaxLength(255)]
    public string? Region { get; set; }

    [MaxLength(100)]
    public string? Country { get; set; }

    [MaxLength(20)]
    public string? PostalCode { get; set; }

    [MaxLength(500)]
    public string? FormattedAddress { get; set; }

    /// <summary>
    /// Whether other users can see the exact location.
    /// If false, only city/region is shown to others.
    /// </summary>
    public bool IsPublic { get; set; } = false;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}
