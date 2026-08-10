// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Geographic or regional cluster of tenants for federation discovery and administration.
/// Mirrors the Laravel federation_neighborhoods table used by the canonical React admin.
/// </summary>
public class FederationNeighborhood
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public string? Region { get; set; }
    public int? CreatedBy { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public User? CreatedByUser { get; set; }
    public ICollection<FederationNeighborhoodTenant> Tenants { get; set; } = new List<FederationNeighborhoodTenant>();
}

/// <summary>
/// Tenant membership in a federation neighborhood.
/// </summary>
public class FederationNeighborhoodTenant
{
    public int Id { get; set; }
    public int NeighborhoodId { get; set; }
    public int TenantId { get; set; }

    public FederationNeighborhood? Neighborhood { get; set; }
    public Tenant? Tenant { get; set; }
}
