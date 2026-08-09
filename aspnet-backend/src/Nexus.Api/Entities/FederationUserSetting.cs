// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Per-user federation settings: opt-in, privacy, service reach.
/// Implements the user layer of the 3-layer feature gating system.
/// </summary>
public class FederationUserSetting : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    /// <summary>Whether the user has opted into federation.</summary>
    public bool FederationOptIn { get; set; } = false;

    /// <summary>Whether the user's profile is visible to federated tenants.</summary>
    public bool ProfileVisible { get; set; } = false;

    /// <summary>Whether the user's listings are visible to federated tenants.</summary>
    public bool ListingsVisible { get; set; } = true;

    /// <summary>Whether the user accepts federated wallet transactions.</summary>
    public bool TransactionsEnabled { get; set; }

    /// <summary>Comma-separated list of partner tenant IDs the user blocks.</summary>
    [MaxLength(500)]
    public string? BlockedPartnerTenants { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}
