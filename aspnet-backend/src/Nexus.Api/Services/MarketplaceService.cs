// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;

namespace Nexus.Api.Services;

public class MarketplaceService
{
    private readonly NexusDbContext _db;
    private readonly ILogger<MarketplaceService> _logger;

    public MarketplaceService(NexusDbContext db, ILogger<MarketplaceService> logger)
    {
        _db = db;
        _logger = logger;
    }

    public async Task<(List<MarketplaceListing> Items, int Total)> ListListingsAsync(
        string? search,
        int? categoryId,
        string? categorySlug,
        string? priceType,
        string? condition,
        string? sellerType,
        string? deliveryMethod,
        string? status,
        int? userId,
        int? groupId,
        bool featuredOnly,
        bool freeOnly,
        int page,
        int limit,
        string? cursor = null)
    {
        var query = _db.MarketplaceListings
            .Include(l => l.User)
            .Include(l => l.Category)
            .Include(l => l.Images)
            .AsQueryable();

        if (userId.HasValue)
        {
            query = query.Where(l => l.UserId == userId.Value);
            if (!string.IsNullOrWhiteSpace(status))
                query = query.Where(l => l.Status == status);
        }
        else
        {
            query = query.Where(l => l.Status == "active" && l.ModerationStatus == "approved");
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLower();
            query = query.Where(l =>
                l.Title.ToLower().Contains(term) ||
                l.Description.ToLower().Contains(term) ||
                (l.Tagline != null && l.Tagline.ToLower().Contains(term)));
        }

        if (categoryId.HasValue)
            query = query.Where(l => l.CategoryId == categoryId.Value);

        if (!string.IsNullOrWhiteSpace(categorySlug))
            query = query.Where(l => l.Category != null && l.Category.Slug == categorySlug);

        if (!string.IsNullOrWhiteSpace(priceType))
            query = query.Where(l => l.PriceType == priceType);

        if (!string.IsNullOrWhiteSpace(condition))
            query = query.Where(l => l.Condition == condition);

        if (!string.IsNullOrWhiteSpace(sellerType))
            query = query.Where(l => l.SellerType == sellerType);

        if (!string.IsNullOrWhiteSpace(deliveryMethod))
            query = query.Where(l => l.DeliveryMethod == deliveryMethod);

        if (groupId.HasValue)
            query = query.Where(l => l.GroupId == groupId.Value);

        if (featuredOnly)
            query = query.Where(l => l.PromotedUntil != null && l.PromotedUntil > DateTime.UtcNow);

        if (freeOnly)
            query = query.Where(l => l.PriceType == "free" || l.Price == 0);

        var cursorId = DecodeCursor(cursor);
        if (cursorId.HasValue)
            query = query.Where(l => l.Id < cursorId.Value);

        var total = await query.CountAsync();
        var items = await query
            .AsNoTracking()
            .OrderByDescending(l => l.PromotedUntil != null && l.PromotedUntil > DateTime.UtcNow)
            .ThenByDescending(l => l.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        return (items, total);
    }

    private static int? DecodeCursor(string? cursor)
    {
        if (string.IsNullOrWhiteSpace(cursor))
            return null;

        try
        {
            var decoded = Encoding.UTF8.GetString(Convert.FromBase64String(cursor));
            return int.TryParse(decoded, out var id) && id > 0 ? id : null;
        }
        catch (FormatException)
        {
            return null;
        }
    }

    public async Task<MarketplaceListing?> GetListingAsync(int id, bool incrementView = false)
    {
        var listing = await _db.MarketplaceListings
            .Include(l => l.User)
            .Include(l => l.Category)
            .Include(l => l.Images)
            .Include(l => l.Offers)
            .FirstOrDefaultAsync(l => l.Id == id);

        if (listing != null && incrementView)
        {
            listing.ViewsCount++;
            await _db.SaveChangesAsync();
        }

        return listing;
    }

    public async Task<MarketplaceSellerProfile> GetOrCreateSellerProfileAsync(int userId, string? displayName = null)
    {
        var profile = await _db.MarketplaceSellerProfiles.FirstOrDefaultAsync(p => p.UserId == userId);
        if (profile != null) return profile;

        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId);
        profile = new MarketplaceSellerProfile
        {
            UserId = userId,
            DisplayName = displayName?.Trim()
                ?? string.Join(' ', new[] { user?.FirstName, user?.LastName }.Where(s => !string.IsNullOrWhiteSpace(s))).Trim(),
            SellerType = "private"
        };
        if (string.IsNullOrWhiteSpace(profile.DisplayName))
            profile.DisplayName = $"Seller {userId}";

        _db.MarketplaceSellerProfiles.Add(profile);
        await _db.SaveChangesAsync();
        return profile;
    }

    public async Task<(MarketplaceListing? Listing, string? Error)> CreateListingAsync(int userId, MarketplaceListingInput input)
    {
        if (string.IsNullOrWhiteSpace(input.Title)) return (null, "Title is required");
        if (string.IsNullOrWhiteSpace(input.Description)) return (null, "Description is required");

        var seller = await GetOrCreateSellerProfileAsync(userId);
        if (seller.IsSuspended) return (null, "Seller is suspended");

        var status = Normalize(input.Status, "draft");
        if (status is not ("draft" or "active")) return (null, "Status must be draft or active");

        var listing = new MarketplaceListing
        {
            UserId = userId,
            CategoryId = input.CategoryId,
            GroupId = input.GroupId,
            Title = input.Title.Trim(),
            Description = input.Description.Trim(),
            Tagline = input.Tagline?.Trim(),
            Price = input.Price,
            PriceCurrency = Normalize(input.PriceCurrency, "EUR").ToUpperInvariant(),
            PriceType = Normalize(input.PriceType, input.Price == 0 ? "free" : "fixed"),
            TimeCreditPrice = input.TimeCreditPrice,
            Condition = Normalize(input.Condition, "good"),
            Quantity = Math.Max(1, input.Quantity ?? 1),
            TemplateDataJson = input.TemplateData == null ? null : JsonSerializer.Serialize(input.TemplateData),
            Location = input.Location?.Trim(),
            Latitude = input.Latitude,
            Longitude = input.Longitude,
            ShippingAvailable = input.ShippingAvailable ?? false,
            LocalPickup = input.LocalPickup ?? true,
            DeliveryMethod = Normalize(input.DeliveryMethod, "pickup"),
            SellerType = Normalize(input.SellerType, seller.SellerType),
            Status = status,
            ModerationStatus = status == "active" ? "pending" : "draft",
            ExpiresAt = DateTime.UtcNow.AddDays(Math.Clamp(input.DurationDays ?? 30, 1, 90))
        };

        _db.MarketplaceListings.Add(listing);
        seller.ListingsCount++;
        await _db.SaveChangesAsync();
        await LoadListingAsync(listing);

        _logger.LogInformation("Created marketplace listing {ListingId} by user {UserId}", listing.Id, userId);
        return (listing, null);
    }

    public async Task<(MarketplaceListing? Listing, string? Error)> UpdateListingAsync(int id, int userId, bool isAdmin, MarketplaceListingInput input)
    {
        var listing = await _db.MarketplaceListings.Include(l => l.Images).FirstOrDefaultAsync(l => l.Id == id);
        if (listing == null) return (null, "Listing not found");
        if (listing.UserId != userId && !isAdmin) return (null, "You can only modify your own marketplace listings");

        if (input.Title != null) listing.Title = input.Title.Trim();
        if (input.Description != null) listing.Description = input.Description.Trim();
        if (input.Tagline != null) listing.Tagline = input.Tagline.Trim();
        if (input.CategoryId.HasValue) listing.CategoryId = input.CategoryId;
        if (input.GroupId.HasValue) listing.GroupId = input.GroupId;
        if (input.Price.HasValue) listing.Price = input.Price;
        if (input.PriceCurrency != null) listing.PriceCurrency = input.PriceCurrency.ToUpperInvariant();
        if (input.PriceType != null) listing.PriceType = input.PriceType;
        if (input.TimeCreditPrice.HasValue) listing.TimeCreditPrice = input.TimeCreditPrice;
        if (input.Condition != null) listing.Condition = input.Condition;
        if (input.Quantity.HasValue) listing.Quantity = Math.Max(0, input.Quantity.Value);
        if (input.TemplateData != null) listing.TemplateDataJson = JsonSerializer.Serialize(input.TemplateData);
        if (input.Location != null) listing.Location = input.Location.Trim();
        if (input.Latitude.HasValue) listing.Latitude = input.Latitude;
        if (input.Longitude.HasValue) listing.Longitude = input.Longitude;
        if (input.ShippingAvailable.HasValue) listing.ShippingAvailable = input.ShippingAvailable.Value;
        if (input.LocalPickup.HasValue) listing.LocalPickup = input.LocalPickup.Value;
        if (input.DeliveryMethod != null) listing.DeliveryMethod = input.DeliveryMethod;
        if (input.SellerType != null) listing.SellerType = input.SellerType;
        if (input.Status != null)
        {
            listing.Status = input.Status;
            if (input.Status == "active" && listing.ModerationStatus == "draft")
                listing.ModerationStatus = "pending";
        }
        listing.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();
        await LoadListingAsync(listing);
        return (listing, null);
    }

    public async Task<string?> DeleteListingAsync(int id, int userId, bool isAdmin)
    {
        var listing = await _db.MarketplaceListings.FirstOrDefaultAsync(l => l.Id == id);
        if (listing == null) return "Listing not found";
        if (listing.UserId != userId && !isAdmin) return "You can only delete your own marketplace listings";

        _db.MarketplaceListings.Remove(listing);
        await _db.SaveChangesAsync();
        return null;
    }

    public async Task<MarketplaceImage?> AddImageAsync(int listingId, int userId, bool isAdmin, string url, string? altText)
    {
        var listing = await _db.MarketplaceListings.Include(l => l.Images).FirstOrDefaultAsync(l => l.Id == listingId);
        if (listing == null || (listing.UserId != userId && !isAdmin)) return null;

        var image = new MarketplaceImage
        {
            MarketplaceListingId = listingId,
            Url = url,
            AltText = altText,
            SortOrder = listing.Images.Count
        };
        _db.MarketplaceImages.Add(image);
        await _db.SaveChangesAsync();
        return image;
    }

    public async Task<bool> ReorderImagesAsync(int listingId, int userId, bool isAdmin, IReadOnlyList<int> imageIds)
    {
        var listing = await _db.MarketplaceListings.Include(l => l.Images).FirstOrDefaultAsync(l => l.Id == listingId);
        if (listing == null || (listing.UserId != userId && !isAdmin)) return false;

        for (var i = 0; i < imageIds.Count; i++)
        {
            var image = listing.Images.FirstOrDefault(x => x.Id == imageIds[i]);
            if (image != null) image.SortOrder = i;
        }
        await _db.SaveChangesAsync();
        return true;
    }

    public async Task<bool> DeleteImageAsync(int listingId, int imageId, int userId, bool isAdmin)
    {
        var listing = await _db.MarketplaceListings.FirstOrDefaultAsync(l => l.Id == listingId);
        if (listing == null || (listing.UserId != userId && !isAdmin)) return false;

        var image = await _db.MarketplaceImages.FirstOrDefaultAsync(i => i.Id == imageId && i.MarketplaceListingId == listingId);
        if (image == null) return false;
        _db.MarketplaceImages.Remove(image);
        await _db.SaveChangesAsync();
        return true;
    }

    public async Task<bool> SaveListingAsync(int listingId, int userId)
    {
        if (!await _db.MarketplaceListings.AnyAsync(l => l.Id == listingId)) return false;
        if (await _db.MarketplaceSavedListings.AnyAsync(s => s.UserId == userId && s.MarketplaceListingId == listingId)) return true;

        _db.MarketplaceSavedListings.Add(new MarketplaceSavedListing { UserId = userId, MarketplaceListingId = listingId });
        var listing = await _db.MarketplaceListings.FirstAsync(l => l.Id == listingId);
        listing.SavesCount++;
        await _db.SaveChangesAsync();
        return true;
    }

    public async Task<bool> UnsaveListingAsync(int listingId, int userId)
    {
        var saved = await _db.MarketplaceSavedListings.FirstOrDefaultAsync(s => s.UserId == userId && s.MarketplaceListingId == listingId);
        if (saved == null) return true;
        _db.MarketplaceSavedListings.Remove(saved);
        var listing = await _db.MarketplaceListings.FirstOrDefaultAsync(l => l.Id == listingId);
        if (listing != null && listing.SavesCount > 0) listing.SavesCount--;
        await _db.SaveChangesAsync();
        return true;
    }

    public async Task<List<MarketplaceListing>> GetSavedListingsAsync(int userId)
    {
        var listingIds = await _db.MarketplaceSavedListings
            .Where(s => s.UserId == userId)
            .Select(s => s.MarketplaceListingId)
            .ToListAsync();

        return await _db.MarketplaceListings
            .Include(l => l.User)
            .Include(l => l.Category)
            .Include(l => l.Images)
            .Where(l => listingIds.Contains(l.Id))
            .OrderByDescending(l => l.CreatedAt)
            .ToListAsync();
    }

    public async Task<MarketplaceOffer?> CreateOfferAsync(int listingId, int buyerUserId, decimal? amount, decimal? timeCreditAmount, string? currency, string? message)
    {
        var listing = await _db.MarketplaceListings.FirstOrDefaultAsync(l => l.Id == listingId);
        if (listing == null || listing.UserId == buyerUserId) return null;

        var offer = new MarketplaceOffer
        {
            TenantId = listing.TenantId,
            MarketplaceListingId = listingId,
            BuyerUserId = buyerUserId,
            SellerUserId = listing.UserId,
            Amount = amount,
            TimeCreditAmount = timeCreditAmount,
            Currency = string.IsNullOrWhiteSpace(currency) ? listing.PriceCurrency : currency,
            Message = message ?? string.Empty
        };
        _db.MarketplaceOffers.Add(offer);
        await _db.SaveChangesAsync();
        return offer;
    }

    public async Task<MarketplaceOffer?> SetOfferStatusAsync(int offerId, int userId, bool isAdmin, string status, decimal? counterAmount = null, string? counterMessage = null)
    {
        var offer = await _db.MarketplaceOffers.FirstOrDefaultAsync(o => o.Id == offerId);
        if (offer == null) return null;
        if (offer.SellerUserId != userId && offer.BuyerUserId != userId && !isAdmin) return null;

        offer.Status = status;
        offer.CounterAmount = counterAmount ?? offer.CounterAmount;
        offer.CounterMessage = counterMessage ?? offer.CounterMessage;
        offer.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return offer;
    }

    public async Task<MarketplaceOrder?> CreateOrderAsync(int listingId, int buyerUserId, int quantity, string? deliveryMethod, string? shippingAddress)
    {
        var listing = await _db.MarketplaceListings.FirstOrDefaultAsync(l => l.Id == listingId);
        if (listing == null || listing.UserId == buyerUserId || listing.Quantity < quantity) return null;

        var order = new MarketplaceOrder
        {
            OrderNumber = MarketplaceOrder.GenerateOrderNumber(),
            MarketplaceListingId = listingId,
            BuyerUserId = buyerUserId,
            SellerUserId = listing.UserId,
            Quantity = Math.Max(1, quantity),
            TotalAmount = listing.Price.HasValue ? listing.Price.Value * Math.Max(1, quantity) : null,
            TimeCreditTotal = listing.TimeCreditPrice.HasValue ? listing.TimeCreditPrice.Value * Math.Max(1, quantity) : null,
            Status = listing.Price.HasValue && listing.Price.Value > 0 ? "pending_payment" : "pending",
            PaymentExpiresAt = listing.Price.HasValue && listing.Price.Value > 0 ? DateTime.UtcNow.AddMinutes(30) : null,
            DeliveryMethod = deliveryMethod ?? listing.DeliveryMethod,
            ShippingAddress = shippingAddress
        };
        listing.Quantity -= Math.Max(1, quantity);
        if (listing.Quantity == 0) listing.MarketplaceStatus = "sold";
        _db.MarketplaceOrders.Add(order);
        await _db.SaveChangesAsync();
        return order;
    }

    public async Task<MarketplaceOrder?> SetOrderStatusAsync(
        int id,
        int userId,
        bool isAdmin,
        string status,
        string? trackingNumber = null,
        string? trackingUrl = null,
        string? shippingMethod = null)
    {
        var order = await _db.MarketplaceOrders.Include(o => o.Listing).FirstOrDefaultAsync(o => o.Id == id);
        if (order == null) return null;
        if (order.BuyerUserId != userId && order.SellerUserId != userId && !isAdmin) return null;

        order.Status = status;
        order.TrackingNumber = trackingNumber ?? order.TrackingNumber;
        order.TrackingUrl = trackingUrl ?? order.TrackingUrl;
        order.DeliveryMethod = shippingMethod ?? order.DeliveryMethod;
        order.UpdatedAt = DateTime.UtcNow;
        if (status == "shipped") order.ShippedAt = DateTime.UtcNow;
        if (status == "delivered") order.DeliveredAt = DateTime.UtcNow;
        if (status == "cancelled") order.CancelledAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return order;
    }

    public async Task<MarketplaceReport> ReportListingAsync(int listingId, int reporterUserId, string reason, string? details)
    {
        var report = new MarketplaceReport
        {
            MarketplaceListingId = listingId,
            ReporterUserId = reporterUserId,
            Reason = reason,
            Details = details
        };
        _db.MarketplaceReports.Add(report);
        await _db.SaveChangesAsync();
        return report;
    }

    public async Task<MarketplaceListing?> ModerateListingAsync(int id, int adminUserId, string status, string? notes)
    {
        var listing = await _db.MarketplaceListings.FirstOrDefaultAsync(l => l.Id == id);
        if (listing == null) return null;
        listing.ModerationStatus = status;
        listing.ModerationNotes = notes;
        listing.ModeratedByUserId = adminUserId;
        listing.ModeratedAt = DateTime.UtcNow;
        if (status == "approved" && listing.Status == "draft") listing.Status = "active";
        await _db.SaveChangesAsync();
        return listing;
    }

    public async Task<MarketplaceSellerProfile?> SetSellerStatusAsync(int sellerId, bool verify, bool suspend, string? reason)
    {
        var profile = await _db.MarketplaceSellerProfiles.FirstOrDefaultAsync(p => p.Id == sellerId || p.UserId == sellerId);
        if (profile == null) return null;
        if (verify) profile.IsVerified = true;
        if (suspend)
        {
            profile.IsSuspended = true;
            profile.SuspensionReason = reason;
        }
        profile.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return profile;
    }

    public async Task EnsureDefaultCategoriesAsync()
    {
        if (await _db.MarketplaceCategories.AnyAsync()) return;

        var categories = new[]
        {
            ("Home & Garden", "home-garden", "household, garden, and DIY items"),
            ("Tools", "tools", "tools and shared equipment"),
            ("Books & Media", "books-media", "books, learning, and media"),
            ("Children", "children", "children's items and family supplies"),
            ("Free", "free", "items offered free to the community")
        };

        var order = 0;
        foreach (var (name, slug, description) in categories)
        {
            _db.MarketplaceCategories.Add(new MarketplaceCategory
            {
                Name = name,
                Slug = slug,
                Description = description,
                SortOrder = order++
            });
        }
        await _db.SaveChangesAsync();
    }

    private async Task LoadListingAsync(MarketplaceListing listing)
    {
        await _db.Entry(listing).Reference(l => l.User).LoadAsync();
        await _db.Entry(listing).Reference(l => l.Category).LoadAsync();
        await _db.Entry(listing).Collection(l => l.Images).LoadAsync();
    }

    private static string Normalize(string? value, string fallback)
        => string.IsNullOrWhiteSpace(value) ? fallback : value.Trim().ToLowerInvariant();
}

public record MarketplaceListingInput(
    string? Title,
    string? Description,
    string? Tagline,
    decimal? Price,
    [property: JsonPropertyName("price_currency")]
    string? PriceCurrency,
    [property: JsonPropertyName("price_type")]
    string? PriceType,
    [property: JsonPropertyName("time_credit_price")]
    decimal? TimeCreditPrice,
    [property: JsonPropertyName("category_id")]
    int? CategoryId,
    [property: JsonPropertyName("group_id")]
    int? GroupId,
    string? Condition,
    int? Quantity,
    [property: JsonPropertyName("template_data")]
    Dictionary<string, object>? TemplateData,
    string? Location,
    double? Latitude,
    double? Longitude,
    [property: JsonPropertyName("shipping_available")]
    bool? ShippingAvailable,
    [property: JsonPropertyName("local_pickup")]
    bool? LocalPickup,
    [property: JsonPropertyName("delivery_method")]
    string? DeliveryMethod,
    [property: JsonPropertyName("seller_type")]
    string? SellerType,
    string? Status,
    [property: JsonPropertyName("duration_days")]
    int? DurationDays);
