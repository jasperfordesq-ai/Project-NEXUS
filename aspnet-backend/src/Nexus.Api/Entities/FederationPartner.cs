// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Represents a trusted federation partnership between two tenants.
/// Enables cross-tenant listing sharing, events, and exchanges.
/// </summary>
public class FederationPartner : ITenantEntity
{
    public int Id { get; set; }

    /// <summary>
    /// The local tenant that owns this partnership record.
    /// </summary>
    public int TenantId { get; set; }

    /// <summary>
    /// The partner tenant being federated with.
    /// </summary>
    public int PartnerTenantId { get; set; }

    public PartnerStatus Status { get; set; } = PartnerStatus.Pending;

    /// <summary>
    /// Whether listings are shared between the two tenants.
    /// </summary>
    public bool SharedListings { get; set; } = true;

    /// <summary>
    /// Whether events are shared between the two tenants.
    /// </summary>
    public bool SharedEvents { get; set; } = false;

    /// <summary>
    /// Whether the member directory is shared between the two tenants.
    /// </summary>
    public bool SharedMembers { get; set; } = false;

    /// <summary>Whether this partnership permits cross-tenant credit transactions.</summary>
    public bool TransactionsEnabled { get; set; }

    /// <summary>
    /// Exchange rate for cross-tenant credit transfers.
    /// 1.0 means 1 hour in tenant A = 1 hour in tenant B.
    /// </summary>
    public decimal CreditExchangeRate { get; set; } = 1.0m;

    /// <summary>
    /// The admin who initiated the partnership request.
    /// </summary>
    public int RequestedById { get; set; }

    /// <summary>
    /// The admin who approved the partnership (on the partner side).
    /// </summary>
    public int? ApprovedById { get; set; }

    public DateTime? ApprovedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public Tenant? PartnerTenant { get; set; }
    public User? RequestedBy { get; set; }
    public User? ApprovedBy { get; set; }
}

/// <summary>
/// Status of a federation partnership.
/// </summary>
public enum PartnerStatus
{
    /// <summary>Partnership has been requested but not yet approved.</summary>
    Pending,
    /// <summary>Partnership is active and data is being shared.</summary>
    Active,
    /// <summary>Partnership request was rejected by the receiving tenant.</summary>
    Rejected,
    /// <summary>Partnership has been temporarily suspended.</summary>
    Suspended,
    /// <summary>Partnership has been permanently revoked.</summary>
    Revoked
}
