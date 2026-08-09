// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Alert that triggers when a user's balance falls to or below a threshold.
/// Phase 19: Expanded Wallet.
/// </summary>
public class BalanceAlert : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    /// <summary>
    /// The balance threshold that triggers the alert.
    /// </summary>
    public decimal ThresholdAmount { get; set; }

    public bool IsActive { get; set; } = true;

    /// <summary>
    /// When this alert was last triggered (to avoid spamming).
    /// </summary>
    public DateTime? LastTriggeredAt { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}
