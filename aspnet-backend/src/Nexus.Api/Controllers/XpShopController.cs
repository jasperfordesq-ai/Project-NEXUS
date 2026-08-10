// Copyright © 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.ComponentModel.DataAnnotations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// XP Shop -- members redeem earned XP for cosmetic and functional rewards.
/// Closes the XP economy loop (gap feature for 1,000/1,000 migration score).
/// </summary>
[ApiController]
[Route("api/gamification/shop")]
[Authorize]
public class XpShopController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly GamificationService _gamification;
    private readonly ILogger<XpShopController> _logger;

    public XpShopController(NexusDbContext db, GamificationService gamification, ILogger<XpShopController> logger)
    {
        _db = db;
        _gamification = gamification;
        _logger = logger;
    }

    /// <summary>GET /api/gamification/shop/items - Browse available XP shop items.</summary>
    [HttpGet("items")]
    public async Task<IActionResult> GetItems([FromQuery] string? category = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var currentXp = await _db.Users
            .Where(u => u.Id == userId.Value)
            .Select(u => u.TotalXp)
            .FirstOrDefaultAsync();

        var items = GetShopCatalogue()
            .Where(i => category == null || i.Category.Equals(category, StringComparison.OrdinalIgnoreCase))
            .Select(i => new
            {
                i.Id, i.Name, i.Description, i.Category, i.XpCost, i.Icon,
                affordable = currentXp >= i.XpCost,
                i.IsLimitedTime, i.AvailableUntil,
            })
            .ToList();

        return Ok(new { currentXp, categories = new[] { "cosmetic", "feature", "badge", "boost" }, items });
    }

    /// <summary>GET /api/gamification/shop/items/{id} - Single item detail.</summary>
    [HttpGet("items/{id:int}")]
    public async Task<IActionResult> GetItem(string id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var item = GetShopCatalogue().FirstOrDefault(i => i.Id == id);
        if (item == null) return NotFound(new { error = "Item not found" });

        var currentXp = await _db.Users
            .Where(u => u.Id == userId.Value)
            .Select(u => u.TotalXp)
            .FirstOrDefaultAsync();

        var owned = await _db.XpShopRedemptions
            .AnyAsync(r => r.UserId == userId.Value && r.ItemId == id && r.IsActive);

        return Ok(new {
            item.Id, item.Name, item.Description, item.Category, item.XpCost, item.Icon,
            affordable = currentXp >= item.XpCost, owned, currentXp,
            item.IsLimitedTime, item.AvailableUntil, item.Stackable, item.DurationDays
        });
    }

    /// <summary>GET /api/gamification/shop/inventory - List items the current user has redeemed.</summary>
    [HttpGet("inventory")]
    public async Task<IActionResult> GetInventory()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var redemptions = await _db.XpShopRedemptions
            .Where(r => r.UserId == userId.Value)
            .OrderByDescending(r => r.RedeemedAt)
            .Select(r => new { r.Id, r.ItemId, r.ItemName, r.XpSpent, r.RedeemedAt, r.IsActive, r.ExpiresAt })
            .ToListAsync();

        return Ok(redemptions);
    }

    /// <summary>POST /api/gamification/shop/redeem - Purchase an item with XP.</summary>
    [HttpPost("redeem")]
    public async Task<IActionResult> RedeemItem([FromBody] RedeemItemRequest request)
    {
        if (!ModelState.IsValid) return BadRequest(ModelState);
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var item = GetShopCatalogue().FirstOrDefault(i => i.Id == request.ItemId);
        if (item == null) return NotFound(new { error = "Item not found" });

        if (item.IsLimitedTime && item.AvailableUntil.HasValue && item.AvailableUntil.Value < DateTime.UtcNow)
            return BadRequest(new { error = "This limited-time item is no longer available" });

        var user = await _db.Users.FirstOrDefaultAsync(x => x.Id == userId.Value);
        if (user == null) return Unauthorized(new { error = "User not found" });

        if (user.TotalXp < item.XpCost)
            return BadRequest(new { error = string.Format("Insufficient XP. Need {0}, have {1}.", item.XpCost, user.TotalXp) });

        if (!item.Stackable)
        {
            var alreadyOwned = await _db.XpShopRedemptions
                .AnyAsync(r => r.UserId == userId.Value && r.ItemId == item.Id && r.IsActive);
            if (alreadyOwned) return BadRequest(new { error = "You already own this item" });
        }

        // Deduct XP (negative award — GamificationService clamps to 0 minimum)
        var xpResult = await _gamification.AwardXpAsync(userId.Value, -item.XpCost, "xp_shop_purchase",
            description: "XP Shop: " + item.Name);

        var redemption = new XpShopRedemption
        {
            UserId = userId.Value,
            ItemId = item.Id,
            ItemName = item.Name,
            XpSpent = item.XpCost,
            IsActive = true,
            ExpiresAt = item.DurationDays.HasValue ? DateTime.UtcNow.AddDays(item.DurationDays.Value) : null,
        };
        _db.XpShopRedemptions.Add(redemption);
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} redeemed XP shop item {ItemId} for {Xp} XP", userId, item.Id, item.XpCost);

        return Ok(new {
            redemption.Id, item.Name, item.Category,
            xpSpent = item.XpCost,
            remainingXp = xpResult.NewXp,
            redemption.ExpiresAt,
            message = "You redeemed " + item.Name + " for " + item.XpCost + " XP!"
        });
    }

    private static List<XpShopItem> GetShopCatalogue() =>
    [
        new("profile-border-gold",   "Gold Profile Border",      "A gold border around your profile avatar", "cosmetic", 500,  "🟥", false),
        new("profile-border-silver", "Silver Profile Border",    "A silver border around your profile avatar", "cosmetic", 250, "⚪", false),
        new("xp-boost-7d",           "XP Boost (7 days)",        "Earn 1.5x XP from all exchanges for 7 days", "boost", 1000, "⚡", false, DurationDays: 7),
        new("xp-boost-30d",          "XP Boost (30 days)",       "Earn 1.5x XP from all exchanges for 30 days", "boost", 3500, "⚡⚡", false, DurationDays: 30),
        new("featured-listing",      "Featured Listing Slot",    "Pin one of your listings to the top of search results for 7 days", "feature", 750, "📌", true, DurationDays: 7),
        new("custom-badge",          "Custom Badge",             "Add a custom achievement badge to your profile", "badge", 2000, "🏅", false),
        new("community-supporter",   "Community Supporter Badge", "A permanent supporter badge on your profile", "badge", 5000, "❤️", false),
    ];
}

public record XpShopItem(
    string Id, string Name, string Description, string Category,
    int XpCost, string Icon, bool Stackable,
    bool IsLimitedTime = false, DateTime? AvailableUntil = null, int? DurationDays = null
);

public class RedeemItemRequest
{
    [Required]
    public string ItemId { get; set; } = "";
}
