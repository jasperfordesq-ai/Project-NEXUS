// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Records a user's redemption of an XP shop item.
/// </summary>
public class XpShopRedemption : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int UserId { get; set; }

    /// <summary>The shop item identifier (slug).</summary>
    public string ItemId { get; set; } = "";

    /// <summary>Display name at the time of redemption.</summary>
    public string ItemName { get; set; } = "";

    /// <summary>XP deducted for this redemption.</summary>
    public int XpSpent { get; set; }

    public DateTime RedeemedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Whether the item is currently active (not expired or revoked).</summary>
    public bool IsActive { get; set; } = true;

    /// <summary>Null for permanent items; set for time-limited items.</summary>
    public DateTime? ExpiresAt { get; set; }

    // Navigation
    public Tenant? Tenant { get; set; }
    public User? User { get; set; }
}
