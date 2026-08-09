// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Per-user or tenant-wide transaction limits.
/// When UserId is null, the limit applies globally to all users in the tenant.
/// Phase 19: Expanded Wallet.
/// </summary>
public class TransactionLimit : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    /// <summary>
    /// The user this limit applies to. Null means tenant-wide default.
    /// </summary>
    public int? UserId { get; set; }

    /// <summary>
    /// Maximum total amount that can be transferred in a single day.
    /// </summary>
    public decimal? MaxDailyAmount { get; set; }

    /// <summary>
    /// Maximum amount for a single transaction.
    /// </summary>
    public decimal? MaxSingleAmount { get; set; }

    /// <summary>
    /// Maximum number of transactions allowed per day.
    /// </summary>
    public int? MaxDailyTransactions { get; set; }

    /// <summary>
    /// Minimum balance the user must maintain (cannot go below this).
    /// </summary>
    public decimal? MinBalance { get; set; }

    public bool IsActive { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}
