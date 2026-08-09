// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// Audit log for federation activities between tenants.
/// Records all significant actions: partnership changes, listing syncs, exchanges.
/// </summary>
public class FederationAuditLog : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// The partner tenant involved in this action.
    /// </summary>
    public int PartnerTenantId { get; set; }

    /// <summary>
    /// Action identifier, e.g. "partner.requested", "listing.shared", "exchange.completed".
    /// </summary>
    [MaxLength(100)]
    public string Action { get; set; } = string.Empty;

    /// <summary>
    /// Type of entity involved, e.g. "FederationPartner", "FederatedListing".
    /// </summary>
    [MaxLength(50)]
    public string? EntityType { get; set; }

    /// <summary>
    /// ID of the entity involved.
    /// </summary>
    public int? EntityId { get; set; }

    /// <summary>
    /// Additional details in JSON format.
    /// </summary>
    public string? Details { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
}
