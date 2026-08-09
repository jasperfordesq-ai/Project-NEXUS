// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Organisation / employer profile. Tenant-scoped.
/// Supports verification, public profiles, and member associations.
/// </summary>
public class Organisation : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    public string Name { get; set; } = string.Empty;
    public string Slug { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? LogoUrl { get; set; }
    public string? WebsiteUrl { get; set; }
    public string? Email { get; set; }
    public string? Phone { get; set; }

    /// <summary>
    /// Address / location text.
    /// </summary>
    public string? Address { get; set; }
    public double? Latitude { get; set; }
    public double? Longitude { get; set; }

    /// <summary>
    /// Organisation type: business, charity, government, education, other
    /// </summary>
    public string Type { get; set; } = "business";

    /// <summary>
    /// Industry / sector.
    /// </summary>
    public string? Industry { get; set; }

    /// <summary>
    /// pending, verified, suspended
    /// </summary>
    public string Status { get; set; } = "pending";

    public bool IsPublic { get; set; } = true;

    /// <summary>
    /// User who created / owns this org profile.
    /// </summary>
    public int OwnerId { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    public DateTime? VerifiedAt { get; set; }

    // Navigation
    public Tenant? Tenant { get; set; }
    public User? Owner { get; set; }
    public ICollection<OrganisationMember> Members { get; set; } = new List<OrganisationMember>();
}
