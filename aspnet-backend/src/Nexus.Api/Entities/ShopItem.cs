// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

namespace Nexus.Api.Entities;

/// <summary>
/// An item available for purchase in the XP shop.
/// Types include: "badge", "title", "avatar_frame", "theme".
/// StockLimit null means unlimited.
/// </summary>
public class ShopItem : ITenantEntity
{
    public int Id { get; set; }
    public int TenantId { get; set; }

    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;

    /// <summary>
    /// Item category: "badge", "title", "avatar_frame", or "theme".
    /// </summary>
    public string Type { get; set; } = "badge";

    /// <summary>
    /// Internal key used to apply the item (e.g., badge slug, theme key).
    /// </summary>
    public string? ItemKey { get; set; }

    public string? ImageUrl { get; set; }

    /// <summary>
    /// XP cost to purchase this item.
    /// </summary>
    public int XpCost { get; set; }

    public bool IsActive { get; set; } = true;

    /// <summary>
    /// Maximum number of purchases allowed. Null means unlimited.
    /// </summary>
    public int? StockLimit { get; set; }

    /// <summary>
    /// Running count of how many times this item has been purchased.
    /// </summary>
    public int PurchasedCount { get; set; } = 0;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public Tenant? Tenant { get; set; }
    public ICollection<ShopPurchase> Purchases { get; set; } = new List<ShopPurchase>();
}
