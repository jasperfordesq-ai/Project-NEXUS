// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// Records a user's purchase of an XP shop item.
/// </summary>
public class ShopPurchase : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }
    public int ShopItemId { get; set; }
    public int UserId { get; set; }

    /// <summary>
    /// Amount of XP deducted from the user at time of purchase.
    /// </summary>
    public int XpSpent { get; set; }

    public DateTime PurchasedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public ShopItem? ShopItem { get; set; }
    public User? User { get; set; }
}
