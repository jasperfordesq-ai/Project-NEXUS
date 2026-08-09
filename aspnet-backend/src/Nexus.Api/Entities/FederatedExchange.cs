// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;

namespace Nexus.Api.Entities;

/// <summary>
/// A cross-tenant exchange that tracks an exchange between users in different tenants.
/// Each tenant keeps its own record with a local credit transaction.
/// </summary>
public class FederatedExchange : ITenantEntity
{
    public int Id { get; set; }

    /// <summary>
    /// The initiator's tenant (local side of this record).
    /// </summary>
    public int TenantId { get; set; }

    /// <summary>
    /// The partner tenant involved in this exchange.
    /// </summary>
    public int PartnerTenantId { get; set; }

    /// <summary>
    /// The local user participating in this exchange.
    /// </summary>
    public int LocalUserId { get; set; }

    /// <summary>
    /// Display name of the remote user (denormalized for privacy).
    /// </summary>
    [MaxLength(255)]
    public string RemoteUserDisplayName { get; set; } = string.Empty;

    /// <summary>
    /// The remote user's ID, if known.
    /// </summary>
    public int? RemoteUserId { get; set; }

    /// <summary>
    /// The source listing ID this exchange is based on.
    /// </summary>
    public int SourceListingId { get; set; }

    public ExchangeStatus Status { get; set; } = ExchangeStatus.Requested;

    /// <summary>
    /// Agreed hours for the exchange.
    /// </summary>
    public decimal AgreedHours { get; set; }

    /// <summary>
    /// Actual hours worked, recorded at completion.
    /// </summary>
    public decimal? ActualHours { get; set; }

    /// <summary>
    /// Credit exchange rate applied (from the federation partnership).
    /// </summary>
    public decimal CreditExchangeRate { get; set; } = 1.0m;

    /// <summary>
    /// The local credit transaction created when the exchange is completed.
    /// </summary>
    public int? LocalTransactionId { get; set; }

    /// <summary>
    /// Optional notes about the exchange.
    /// </summary>
    public string? Notes { get; set; }

    public DateTime? CompletedAt { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public Tenant? PartnerTenant { get; set; }
    public User? LocalUser { get; set; }
    public Transaction? LocalTransaction { get; set; }
}
