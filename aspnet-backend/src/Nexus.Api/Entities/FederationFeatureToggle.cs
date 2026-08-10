// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Per-tenant feature toggle for federation capabilities.
/// Implements the tenant layer of the 3-layer feature gating system
/// (System → Tenant → User).
/// </summary>
public class FederationFeatureToggle : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>Feature name, e.g. "federation.enabled", "federation.listings.share",
    /// "federation.exchanges", "federation.messaging".</summary>
    [MaxLength(100)]
    public string Feature { get; set; } = string.Empty;

    public bool IsEnabled { get; set; } = false;

    /// <summary>Optional JSON config for the feature.</summary>
    public string? Configuration { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
}
