// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Middleware;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/marketplace")]
[Route("api/v2/marketplace")]
public class MarketplaceController : ControllerBase
{
    private readonly MarketplaceService _marketplace;
    private readonly NexusDbContext _db;
    private readonly FileUploadService? _fileUploadService;
    private readonly MarketplacePaymentService? _paymentService;
    private readonly IConfiguration? _configuration;

    public MarketplaceController(
        MarketplaceService marketplace,
        NexusDbContext db,
        FileUploadService? fileUploadService = null,
        MarketplacePaymentService? paymentService = null,
        IConfiguration? configuration = null)
    {
        _marketplace = marketplace;
        _db = db;
        _fileUploadService = fileUploadService;
        _paymentService = paymentService;
        _configuration = configuration;
    }

    [HttpGet("listings")]
    [AllowAnonymous]
    public async Task<IActionResult> ListListings(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        [FromQuery] string? q = null,
        [FromQuery] int? category_id = null,
        [FromQuery] string? category = null,
        [FromQuery] string? price_type = null,
        [FromQuery] string? condition = null,
        [FromQuery] string? seller_type = null,
        [FromQuery] string? delivery_method = null,
        [FromQuery] string? status = null,
        [FromQuery] int? user_id = null,
        [FromQuery] string? cursor = null)
    {
        limit = Math.Clamp(limit, 1, 100);
        var currentUserId = User.GetUserId();
        var ownUserId = user_id.HasValue && user_id == currentUserId ? user_id : null;
        var (items, total) = await _marketplace.ListListingsAsync(q, category_id, category, price_type,
            condition, seller_type, delivery_method, status, ownUserId, null, false, false, 1, limit + 1, cursor);
        var hasMore = items.Count > limit;
        if (hasMore) items.RemoveAt(items.Count - 1);
        var savedIds = await LoadSavedListingIdsAsync(currentUserId, items.Select(l => l.Id));
        var nextCursor = hasMore && items.Count > 0 ? EncodeListingCursor(items[^1].Id) : null;
        return Ok(new
        {
            success = true,
            data = items.Select(l => MapListing(l, detailed: false, currentUserId, savedIds)),
            meta = new { per_page = limit, cursor = nextCursor, next_cursor = nextCursor, has_more = hasMore, total }
        });
    }

    [HttpGet("listings/nearby")]
    [AllowAnonymous]
    public async Task<IActionResult> NearbyListings(
        [FromQuery] double? lat = null,
        [FromQuery] double? lng = null,
        [FromQuery] double? latitude = null,
        [FromQuery] double? longitude = null,
        [FromQuery] double? radius = null,
        [FromQuery] double? radius_km = null,
        [FromQuery] string? q = null,
        [FromQuery] int? category_id = null,
        [FromQuery] int limit = 20)
    {
        var originLat = lat ?? latitude;
        var originLng = lng ?? longitude;
        if (!originLat.HasValue || !originLng.HasValue)
        {
            return UnprocessableEntity(new
            {
                success = false,
                code = "VALIDATION_ERROR",
                error = "latitude and longitude are required."
            });
        }

        if (originLat is < -90 or > 90 || originLng is < -180 or > 180)
        {
            return UnprocessableEntity(new
            {
                success = false,
                code = "VALIDATION_ERROR",
                error = "Coordinates are invalid."
            });
        }

        var radiusKm = Math.Clamp(radius_km ?? radius ?? 25d, 1d, 200d);
        limit = Math.Clamp(limit, 1, 100);

        var query = _db.MarketplaceListings
            .Include(l => l.User)
            .Include(l => l.Category)
            .Include(l => l.Images)
            .Where(l => l.Status == "active"
                && l.ModerationStatus == "approved"
                && l.Latitude.HasValue
                && l.Longitude.HasValue);

        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = q.Trim().ToLowerInvariant();
            query = query.Where(l =>
                l.Title.ToLower().Contains(term)
                || l.Description.ToLower().Contains(term));
        }

        if (category_id.HasValue)
            query = query.Where(l => l.CategoryId == category_id);

        var rows = await query.ToListAsync();
        var nearby = rows
            .Select(listing => new
            {
                Listing = listing,
                DistanceKm = DistanceKm(originLat.Value, originLng.Value, listing.Latitude!.Value, listing.Longitude!.Value)
            })
            .Where(row => row.DistanceKm <= radiusKm)
            .OrderBy(row => row.DistanceKm)
            .Take(limit)
            .ToList();

        var currentUserId = User.GetUserId();
        var savedIds = await LoadSavedListingIdsAsync(currentUserId, nearby.Select(row => row.Listing.Id));
        return Ok(new
        {
            success = true,
            data = nearby.Select(row => MapListing(
                row.Listing,
                currentUserId: currentUserId,
                savedListingIds: savedIds,
                distanceKm: Math.Round(row.DistanceKm, 1))),
            meta = new
            {
                total = nearby.Count,
                per_page = limit,
                radius_km = radiusKm,
                lat = originLat,
                lng = originLng
            }
        });
    }

    [HttpGet("listings/featured")]
    [AllowAnonymous]
    public async Task<IActionResult> FeaturedListings([FromQuery] int limit = 20)
    {
        var (items, total) = await _marketplace.ListListingsAsync(null, null, null, null, null, null, null, null, null, null, true, false, 1, Math.Clamp(limit, 1, 100));
        var savedIds = await LoadSavedListingIdsAsync(User.GetUserId(), items.Select(l => l.Id));
        return Ok(new { success = true, data = items.Select(l => MapListing(l, currentUserId: User.GetUserId(), savedListingIds: savedIds)), meta = new { total } });
    }

    [HttpGet("listings/free")]
    [AllowAnonymous]
    public async Task<IActionResult> FreeListings([FromQuery] int limit = 20)
    {
        var (items, total) = await _marketplace.ListListingsAsync(null, null, null, null, null, null, null, null, null, null, false, true, 1, Math.Clamp(limit, 1, 100));
        var savedIds = await LoadSavedListingIdsAsync(User.GetUserId(), items.Select(l => l.Id));
        return Ok(new { success = true, data = items.Select(l => MapListing(l, currentUserId: User.GetUserId(), savedListingIds: savedIds)), meta = new { total } });
    }

    [HttpGet("listings/saved")]
    [Authorize]
    public async Task<IActionResult> SavedListings()
    {
        var userId = RequireUserId();
        var listings = await _marketplace.GetSavedListingsAsync(userId);
        var savedIds = listings.Select(l => l.Id).ToHashSet();
        return Ok(new { success = true, data = listings.Select(l => MapListing(l, currentUserId: userId, savedListingIds: savedIds)), meta = new { total = listings.Count } });
    }

    [HttpGet("listings/export-csv")]
    [Authorize]
    public async Task<IActionResult> ExportListingsCsv()
    {
        var userId = RequireUserId();
        var (items, _) = await _marketplace.ListListingsAsync(null, null, null, null, null, null, null, null, userId, null, false, false, 1, 1000);
        var rows = new[] { "id,title,status,price,price_type,created_at" }
            .Concat(items.Select(l => $"{l.Id},\"{l.Title.Replace("\"", "\"\"")}\",{l.Status},{l.Price},{l.PriceType},{l.CreatedAt:O}"));
        return File(System.Text.Encoding.UTF8.GetBytes(string.Join("\n", rows)), "text/csv", "marketplace-listings.csv");
    }

    [HttpPost("listings/import-csv")]
    [Authorize]
    public IActionResult ImportListingsCsv()
        => Ok(new { data = new { imported = 0, skipped = 0 }, message = "CSV import accepted; use the listing create endpoint for validated imports." });

    [HttpPost("listings/bulk-action")]
    [Authorize]
    public async Task<IActionResult> BulkAction([FromBody] BulkActionRequest request)
    {
        var userId = RequireUserId();
        var isAdmin = User.IsAdmin();
        var changed = 0;
        foreach (var id in request.Ids ?? Array.Empty<int>())
        {
            if (request.Action == "delete" && await _marketplace.DeleteListingAsync(id, userId, isAdmin) == null)
                changed++;
            if ((request.Action == "activate" || request.Action == "draft")
                && (await _marketplace.UpdateListingAsync(id, userId, isAdmin, new MarketplaceListingInput(null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, request.Action == "activate" ? "active" : "draft", null))).Listing != null)
                changed++;
        }
        return Ok(new { data = new { changed } });
    }

    [HttpGet("listings/{id:int}")]
    [AllowAnonymous]
    public async Task<IActionResult> GetListing(int id)
    {
        var listing = await _marketplace.GetListingAsync(id, incrementView: true);
        var currentUserId = User.GetUserId();
        var savedIds = listing == null ? new HashSet<int>() : await LoadSavedListingIdsAsync(currentUserId, new[] { listing.Id });
        return listing == null
            ? NotFound(new { success = false, error = "Listing not found" })
            : Ok(new { success = true, data = MapListing(listing, detailed: true, currentUserId, savedIds) });
    }

    [HttpPost("listings")]
    [Authorize]
    public async Task<IActionResult> CreateListing([FromBody] MarketplaceListingInput request)
    {
        var userId = RequireUserId();
        var (listing, error) = await _marketplace.CreateListingAsync(userId, request);
        if (error != null) return BadRequest(new { error });
        return Created($"/api/marketplace/listings/{listing!.Id}", new { success = true, data = MapListing(listing, detailed: true, currentUserId: userId) });
    }

    [HttpPut("listings/{id:int}")]
    [Authorize]
    public async Task<IActionResult> UpdateListing(int id, [FromBody] MarketplaceListingInput request)
    {
        var (listing, error) = await _marketplace.UpdateListingAsync(id, RequireUserId(), User.IsAdmin(), request);
        if (error == "Listing not found") return NotFound(new { error });
        if (error != null) return StatusCode(403, new { error });
        return Ok(new { success = true, data = MapListing(listing!, detailed: true, currentUserId: RequireUserId()) });
    }

    [HttpDelete("listings/{id:int}")]
    [Authorize]
    public async Task<IActionResult> DeleteListing(int id)
    {
        var error = await _marketplace.DeleteListingAsync(id, RequireUserId(), User.IsAdmin());
        if (error == "Listing not found") return NotFound(new { success = false, error });
        if (error != null) return StatusCode(403, new { success = false, error });
        return Ok(new { success = true, data = new { deleted = true, id } });
    }

    [HttpPost("listings/{id:int}/images")]
    [Authorize]
    public async Task<IActionResult> AddImage(int id)
    {
        var userId = RequireUserId();
        var uploads = await ReadMarketplaceImageUploadsAsync();
        if (uploads.Count == 0)
            return BadRequest(new { success = false, code = "VALIDATION_ERROR", error = "Image URL or image file is required" });

        var images = new List<MarketplaceImage>();
        foreach (var upload in uploads)
        {
            var image = await _marketplace.AddImageAsync(id, userId, User.IsAdmin(), upload.Url, upload.AltText);
            if (image == null) return NotFound(new { success = false, error = "Listing not found" });
            images.Add(image);
        }

        return Created($"/api/marketplace/listings/{id}/images", new { success = true, data = images.Select(MapMarketplaceImage) });
    }

    [HttpPut("listings/{id:int}/images/reorder")]
    [Authorize]
    public async Task<IActionResult> ReorderImages(int id, [FromBody] ReorderImagesRequest request)
        => await _marketplace.ReorderImagesAsync(id, RequireUserId(), User.IsAdmin(), request.ImageIds ?? Array.Empty<int>())
            ? Ok(new { data = new { id } })
            : NotFound(new { error = "Listing not found" });

    [HttpDelete("listings/{id:int}/images/{imageId:int}")]
    [Authorize]
    public async Task<IActionResult> DeleteImage(int id, int imageId)
        => await _marketplace.DeleteImageAsync(id, imageId, RequireUserId(), User.IsAdmin())
            ? NoContent()
            : NotFound(new { success = false, error = "Image not found" });

    [HttpPost("listings/{id:int}/video")]
    [Authorize]
    public async Task<IActionResult> SetVideo(int id)
    {
        var url = await ReadMarketplaceVideoUploadAsync();
        if (string.IsNullOrWhiteSpace(url))
            return BadRequest(new { success = false, code = "VALIDATION_ERROR", error = "Video URL or video file is required" });

        var (listing, error) = await _marketplace.UpdateListingAsync(id, RequireUserId(), User.IsAdmin(), new MarketplaceListingInput(null, null, null, null, null, null, null, null, null, null, null, new() { ["video_url"] = url }, null, null, null, null, null, null, null, null, null));
        if (listing != null) listing.VideoUrl = url;
        await _db.SaveChangesAsync();
        return error == null
            ? StatusCode(201, new { success = true, data = new { video_url = url } })
            : NotFound(new { success = false, error });
    }

    [HttpDelete("listings/{id:int}/video")]
    [Authorize]
    public async Task<IActionResult> DeleteVideo(int id)
    {
        var listing = await _db.MarketplaceListings.FirstOrDefaultAsync(l => l.Id == id);
        if (listing == null) return NotFound(new { error = "Listing not found" });
        if (listing.UserId != RequireUserId() && !User.IsAdmin()) return StatusCode(403, new { error = "Forbidden" });
        listing.VideoUrl = null;
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPost("listings/{id:int}/renew")]
    [Authorize]
    public async Task<IActionResult> RenewListing(int id)
    {
        var listing = await _db.MarketplaceListings.FirstOrDefaultAsync(l => l.Id == id);
        var userId = RequireUserId();
        if (listing == null) return NotFound(new { success = false, error = "Listing not found" });
        if (listing.UserId != userId && !User.IsAdmin()) return StatusCode(403, new { success = false, error = "Forbidden" });
        listing.Status = "active";
        listing.MarketplaceStatus = "available";
        listing.ModerationStatus = "approved";
        listing.RenewedAt = DateTime.UtcNow;
        listing.RenewalCount++;
        listing.ExpiresAt = DateTime.UtcNow.AddDays(30);
        listing.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = MapListing(listing, detailed: true, currentUserId: userId) });
    }

    [HttpGet("listings/{id:int}/analytics")]
    [Authorize]
    public async Task<IActionResult> ListingAnalytics(int id)
    {
        var listing = await _marketplace.GetListingAsync(id);
        if (listing == null) return NotFound(new { error = "Listing not found" });
        if (listing.UserId != RequireUserId() && !User.IsAdmin()) return StatusCode(403, new { error = "Forbidden" });
        return Ok(new { data = new { listing.Id, listing.ViewsCount, listing.SavesCount, listing.ContactsCount, offers = listing.Offers.Count } });
    }

    [HttpPost("listings/generate-description")]
    [Authorize]
    public IActionResult GenerateDescription([FromBody] GenerateDescriptionRequest request)
        => Ok(new { success = true, data = new { description = $"A clear community marketplace listing for {request.Title ?? "this item"}. Include condition, pickup details, and what makes it useful." } });

    [HttpPost("listings/{id:int}/save")]
    [Authorize]
    public async Task<IActionResult> SaveListing(int id)
        => await _marketplace.SaveListingAsync(id, RequireUserId())
            ? StatusCode(201, new { success = true, data = new { saved = true } })
            : NotFound(new { success = false, error = "Listing not found" });

    [HttpDelete("listings/{id:int}/save")]
    [Authorize]
    public async Task<IActionResult> UnsaveListing(int id)
        => await _marketplace.UnsaveListingAsync(id, RequireUserId())
            ? Ok(new { success = true, data = new { saved = false } })
            : NotFound(new { success = false, error = "Listing not found" });

    [HttpPost("listings/{id:int}/offers")]
    [Authorize]
    public async Task<IActionResult> CreateOffer(int id, [FromBody] OfferRequest request)
    {
        var offer = await _marketplace.CreateOfferAsync(id, RequireUserId(), request.Amount, request.TimeCreditAmount, request.Currency, request.Message);
        return offer == null
            ? BadRequest(new { success = false, code = "VALIDATION_ERROR", error = "Offer could not be created" })
            : Created($"/api/marketplace/offers/{offer.Id}", new { success = true, data = MapMarketplaceOffer(offer) });
    }

    [HttpGet("listings/{id:int}/offers")]
    [Authorize]
    public async Task<IActionResult> ListingOffers(int id)
    {
        var userId = RequireUserId();
        var listing = await _db.MarketplaceListings.FirstOrDefaultAsync(l => l.Id == id);
        if (listing == null) return NotFound(new { error = "Listing not found" });
        if (listing.UserId != userId && !User.IsAdmin()) return StatusCode(403, new { error = "Forbidden" });
        var offers = await _db.MarketplaceOffers.Where(o => o.MarketplaceListingId == id).OrderByDescending(o => o.CreatedAt).ToListAsync();
        var buyers = await LoadUsersAsync(offers.Select(o => o.BuyerUserId));
        return Ok(new { success = true, data = offers.Select(o => MapMarketplaceOffer(o, listing, buyers.GetValueOrDefault(o.BuyerUserId), null)), meta = new { total = offers.Count } });
    }

    [HttpPut("offers/{id:int}/accept")]
    [Authorize]
    public Task<IActionResult> AcceptOffer(int id) => SellerOfferStatus(id, "accepted");

    [HttpPut("offers/{id:int}/decline")]
    [Authorize]
    public Task<IActionResult> DeclineOffer(int id) => SellerOfferStatus(id, "declined");

    [HttpPut("offers/{id:int}/counter")]
    [Authorize]
    public async Task<IActionResult> CounterOffer(int id, [FromBody] OfferRequest request)
    {
        var offer = await _marketplace.SetOfferStatusAsync(id, RequireUserId(), User.IsAdmin(), "countered", request.Amount, request.Message);
        return offer == null ? NotFound(new { success = false, code = "NOT_FOUND", error = "Offer not found" }) : Ok(new { success = true, data = MapMarketplaceOffer(offer) });
    }

    [HttpPut("offers/{id:int}/accept-counter")]
    [Authorize]
    public Task<IActionResult> AcceptCounterOffer(int id) => OfferStatus(id, "accepted", useCounterAmount: true);

    [HttpDelete("offers/{id:int}")]
    [Authorize]
    public async Task<IActionResult> DeleteOffer(int id)
    {
        var offer = await _marketplace.SetOfferStatusAsync(id, RequireUserId(), User.IsAdmin(), "withdrawn");
        return offer == null
            ? NotFound(new { success = false, code = "NOT_FOUND", error = "Offer not found" })
            : Ok(new { success = true, data = new { message = "Offer withdrawn", offer = MapMarketplaceOffer(offer) } });
    }

    [HttpGet("my-offers/sent")]
    [Authorize]
    public async Task<IActionResult> SentOffers([FromQuery] int? limit = null, [FromQuery(Name = "per_page")] int? perPage = null, [FromQuery] string? cursor = null)
    {
        var userId = RequireUserId();
        var pageSize = ResolveOfferLimit(limit, perPage);
        var cursorId = DecodeListingCursor(cursor);
        var query = _db.MarketplaceOffers.Where(o => o.BuyerUserId == userId);
        if (cursorId.HasValue) query = query.Where(o => o.Id < cursorId.Value);
        var offers = await query.OrderByDescending(o => o.Id).Take(pageSize + 1).ToListAsync();
        var hasMore = offers.Count > pageSize;
        if (hasMore) offers.RemoveAt(offers.Count - 1);

        var listings = await LoadListingsAsync(offers.Select(o => o.MarketplaceListingId));
        var sellers = await LoadUsersAsync(offers.Select(o => o.SellerUserId));
        var nextCursor = hasMore && offers.Count > 0 ? EncodeCursor(offers[^1].Id) : null;

        return Ok(new
        {
            success = true,
            data = offers.Select(o => MapMarketplaceOffer(o, listings.GetValueOrDefault(o.MarketplaceListingId), null, sellers.GetValueOrDefault(o.SellerUserId))),
            meta = new { per_page = pageSize, cursor = nextCursor, next_cursor = nextCursor, has_more = hasMore }
        });
    }

    [HttpGet("my-offers/received")]
    [Authorize]
    public async Task<IActionResult> ReceivedOffers([FromQuery] int? limit = null, [FromQuery(Name = "per_page")] int? perPage = null, [FromQuery] string? cursor = null)
    {
        var userId = RequireUserId();
        var pageSize = ResolveOfferLimit(limit, perPage);
        var cursorId = DecodeListingCursor(cursor);
        var query = _db.MarketplaceOffers.Where(o => o.SellerUserId == userId);
        if (cursorId.HasValue) query = query.Where(o => o.Id < cursorId.Value);
        var offers = await query.OrderByDescending(o => o.Id).Take(pageSize + 1).ToListAsync();
        var hasMore = offers.Count > pageSize;
        if (hasMore) offers.RemoveAt(offers.Count - 1);

        var listings = await LoadListingsAsync(offers.Select(o => o.MarketplaceListingId));
        var buyers = await LoadUsersAsync(offers.Select(o => o.BuyerUserId));
        var nextCursor = hasMore && offers.Count > 0 ? EncodeCursor(offers[^1].Id) : null;

        return Ok(new
        {
            success = true,
            data = offers.Select(o => MapMarketplaceOffer(o, listings.GetValueOrDefault(o.MarketplaceListingId), buyers.GetValueOrDefault(o.BuyerUserId), null)),
            meta = new { per_page = pageSize, cursor = nextCursor, next_cursor = nextCursor, has_more = hasMore }
        });
    }

    [HttpPost("seller/profile")]
    [Authorize]
    public async Task<IActionResult> UpsertSellerProfile()
    {
        if (Request.HasFormContentType)
            return await UploadSellerProfileMediaAsync();

        var request = await ReadSellerProfileRequestAsync();
        var profile = await _marketplace.GetOrCreateSellerProfileAsync(RequireUserId(), request.DisplayName);
        if (request.Bio != null) profile.Bio = request.Bio;
        if (request.SellerType != null) profile.SellerType = request.SellerType;
        profile.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = profile });
    }

    [HttpGet("seller/dashboard")]
    [Authorize]
    public async Task<IActionResult> SellerDashboard()
    {
        var userId = RequireUserId();
        var profile = await _marketplace.GetOrCreateSellerProfileAsync(userId);
        var sellerListings = _db.MarketplaceListings.Where(l => l.UserId == userId);
        var activeListings = await sellerListings.CountAsync(l => l.Status == "active" && l.ModerationStatus == "approved");
        var draftListings = await sellerListings.CountAsync(l => l.Status == "draft");
        var soldListings = await sellerListings.CountAsync(l => l.Status == "sold");
        var expiredListings = await sellerListings.CountAsync(l => l.Status == "expired");
        var totalListings = await sellerListings.CountAsync();
        var totalViews = await sellerListings.SumAsync(l => l.ViewsCount);
        var totalSaves = await sellerListings.SumAsync(l => l.SavesCount);
        var pendingOffers = await _db.MarketplaceOffers.CountAsync(o => o.SellerUserId == userId && o.Status == "pending");
        var orders = await _db.MarketplaceOrders.CountAsync(o => o.SellerUserId == userId);
        var totalRevenue = await _db.MarketplaceOrders
            .Where(o => o.SellerUserId == userId && o.Status == "completed")
            .SumAsync(o => o.TotalAmount ?? 0m);

        return Ok(new
        {
            success = true,
            data = new
            {
                active_listings = activeListings,
                draft_listings = draftListings,
                sold_listings = soldListings,
                expired_listings = expiredListings,
                total_listings = totalListings,
                total_views = totalViews,
                total_saves = totalSaves,
                pending_offers = pendingOffers,
                total_revenue = totalRevenue,
                revenue_currency = "EUR",
                profile,
                listings = totalListings,
                orders
            }
        });
    }

    [HttpGet("seller/onboard/status")]
    [Authorize]
    [EnableRateLimiting(RateLimitingExtensions.MarketplacePaymentReadPolicy)]
    public async Task<IActionResult> SellerOnboardStatus(CancellationToken ct)
    {
        var userId = RequireUserId();
        await _marketplace.GetOrCreateSellerProfileAsync(userId);
        if (_paymentService is null)
            return StatusCode(503, new { success = false, errors = new[] { new { code = "ONBOARDING_ERROR", message = "Marketplace payment service is unavailable.", field = (string?)null } } });
        return PaymentResult(await _paymentService.ConnectOnboardingStatusAsync(
            User.GetTenantId() ?? throw new UnauthorizedAccessException(), userId, ct));
    }

    [HttpPost("orders")]
    [Authorize]
    public async Task<IActionResult> CreateOrder([FromBody] CreateOrderRequest request)
    {
        var deliveryMethod = request.DeliveryMethod ?? request.ShippingMethod;
        var order = await _marketplace.CreateOrderAsync(request.ListingId, RequireUserId(), request.Quantity <= 0 ? 1 : request.Quantity, deliveryMethod, request.ShippingAddress);
        return order == null
            ? BadRequest(new { success = false, code = "VALIDATION_ERROR", error = "Order could not be created" })
            : Created($"/api/marketplace/orders/{order.Id}", new { success = true, data = MapMarketplaceOrder(order) });
    }

    [HttpGet("orders/purchases")]
    [Authorize]
    public async Task<IActionResult> Purchases(
        [FromQuery] string? status = null,
        [FromQuery] int limit = 20,
        [FromQuery] string? cursor = null)
    {
        var userId = RequireUserId();
        var query = BuildOrderQuery()
            .Where(o => o.BuyerUserId == userId);

        var (orders, nextCursor, hasMore) = await ApplyOrderListQueryAsync(query, status, limit, cursor);
        return Ok(new
        {
            success = true,
            data = await MapMarketplaceOrdersAsync(orders),
            meta = new { cursor = nextCursor, next_cursor = nextCursor, has_more = hasMore }
        });
    }

    [HttpGet("orders/sales")]
    [Authorize]
    public async Task<IActionResult> Sales(
        [FromQuery] string? status = null,
        [FromQuery] int limit = 20,
        [FromQuery] string? cursor = null)
    {
        var userId = RequireUserId();
        var query = BuildOrderQuery()
            .Where(o => o.SellerUserId == userId);

        var (orders, nextCursor, hasMore) = await ApplyOrderListQueryAsync(query, status, limit, cursor);
        return Ok(new
        {
            success = true,
            data = await MapMarketplaceOrdersAsync(orders),
            meta = new { cursor = nextCursor, next_cursor = nextCursor, has_more = hasMore }
        });
    }

    [HttpGet("orders/{id:int}")]
    [Authorize]
    public async Task<IActionResult> GetOrder(int id)
    {
        var userId = RequireUserId();
        var order = await BuildOrderQuery().FirstOrDefaultAsync(o => o.Id == id);
        if (order == null) return NotFound(new { success = false, error = "Order not found" });
        if (order.BuyerUserId != userId && order.SellerUserId != userId && !User.IsAdmin())
            return StatusCode(403, new { success = false, error = "Forbidden" });
        return Ok(new { success = true, data = await MapMarketplaceOrderAsync(order) });
    }

    [HttpPut("orders/{id:int}/ship")]
    [Authorize]
    public async Task<IActionResult> ShipOrder(int id, [FromBody] ShipOrderRequest request)
        => await OrderStatus(id, "shipped", request.TrackingNumber, request.TrackingUrl, request.ShippingMethod);

    [HttpPut("orders/{id:int}/confirm-delivery")]
    [Authorize]
    public async Task<IActionResult> ConfirmDelivery(int id, CancellationToken ct)
    {
        if (_paymentService is null)
            return StatusCode(503, new { success = false, errors = new[] { new { code = "PAYMENT_ERROR", message = "Marketplace payment service is unavailable.", field = (string?)null } } });
        var result = await _paymentService.ConfirmDeliveryAsync(
            User.GetTenantId() ?? throw new UnauthorizedAccessException(), RequireUserId(), id, ct);
        if (!result.Succeeded) return PaymentResult(result);
        var order = await BuildOrderQuery().SingleAsync(row => row.Id == id, ct);
        return Ok(new { success = true, data = await MapMarketplaceOrderAsync(order) });
    }

    [HttpPut("orders/{id:int}/cancel")]
    [Authorize]
    public Task<IActionResult> CancelOrder(int id) => OrderStatus(id, "cancelled");

    [HttpPost("orders/{id:int}/rate")]
    [Authorize]
    public async Task<IActionResult> RateOrder(int id, [FromBody] RateOrderRequest request)
    {
        var order = await _db.MarketplaceOrders.FirstOrDefaultAsync(o => o.Id == id);
        if (order == null) return NotFound(new { success = false, error = "Order not found" });
        var userId = RequireUserId();
        var role = order.BuyerUserId == userId ? "buyer" : order.SellerUserId == userId ? "seller" : null;
        if (role == null) return StatusCode(403, new { success = false, error = "You do not have access to this order." });
        if (!string.Equals(order.Status, "completed", StringComparison.OrdinalIgnoreCase))
            return UnprocessableEntity(new { success = false, code = "VALIDATION_ERROR", error = "Can only rate completed orders." });
        if (request.Rating is < 1 or > 5)
            return UnprocessableEntity(new { success = false, code = "VALIDATION_ERROR", error = "Rating must be between 1 and 5." });
        var existing = await _db.MarketplaceSellerRatings
            .AnyAsync(r => r.MarketplaceOrderId == id && r.RaterRole == role);
        if (existing)
            return UnprocessableEntity(new { success = false, code = "VALIDATION_ERROR", error = "You have already rated this order." });

        var rating = new MarketplaceSellerRating
        {
            MarketplaceOrderId = id,
            BuyerUserId = order.BuyerUserId,
            SellerUserId = order.SellerUserId,
            RaterRole = role,
            Rating = request.Rating,
            Comment = request.Comment,
            IsAnonymous = request.IsAnonymous ?? false
        };
        _db.MarketplaceSellerRatings.Add(rating);
        await _db.SaveChangesAsync();
        var users = await LoadUsersAsync(new[] { userId });
        return Created($"/api/marketplace/orders/{id}/ratings", new { success = true, data = MapMarketplaceRating(rating, users.GetValueOrDefault(userId)) });
    }

    [HttpGet("orders/{id:int}/ratings")]
    [Authorize]
    public async Task<IActionResult> OrderRatings(int id)
    {
        var ratings = await _db.MarketplaceSellerRatings.Where(r => r.MarketplaceOrderId == id).ToListAsync();
        var raterIds = ratings.Select(r => r.RaterRole == "seller" ? r.SellerUserId : r.BuyerUserId);
        var users = await LoadUsersAsync(raterIds);
        return Ok(new { success = true, data = ratings.Select(r => MapMarketplaceRating(r, users.GetValueOrDefault(r.RaterRole == "seller" ? r.SellerUserId : r.BuyerUserId))), meta = new { total = ratings.Count } });
    }

    [HttpPost("orders/{id:int}/dispute")]
    [Authorize]
    public async Task<IActionResult> DisputeOrder(int id, [FromBody] ReportRequest request, CancellationToken ct)
    {
        var result = await new MarketplaceDisputeService(_db).OpenAsync(
            User.GetTenantId() ?? throw new UnauthorizedAccessException(), RequireUserId(), id,
            request.Reason, request.Details ?? request.Description, request.EvidenceUrls, ct);
        if (result.Succeeded) return StatusCode(result.Status, new { success = true, data = result.Data });
        var error = result.Error!;
        return StatusCode(error.Status, new { success = false, errors = new[] { new { code = error.Code, message = error.Message, field = error.Field } } });
    }

    [HttpPost("payments/create-intent")]
    [Authorize]
    [EnableRateLimiting(RateLimitingExtensions.MarketplacePaymentCreatePolicy)]
    public async Task<IActionResult> CreatePaymentIntent([FromBody] PaymentRequest request, CancellationToken ct)
    {
        if (!request.OrderId.HasValue)
            return UnprocessableEntity(new { success = false, errors = new[] { new { code = "VALIDATION_ERROR", message = "Order is required.", field = "order_id" } } });
        if (_paymentService is null)
            return StatusCode(503, new { success = false, errors = new[] { new { code = "PAYMENT_ERROR", message = "Marketplace payment service is unavailable.", field = (string?)null } } });
        return PaymentResult(await _paymentService.CreateIntentAsync(
            User.GetTenantId() ?? throw new UnauthorizedAccessException(), RequireUserId(), request.OrderId.Value, ct));
    }

    [HttpPost("payments/confirm")]
    [Authorize]
    [EnableRateLimiting(RateLimitingExtensions.MarketplacePaymentConfirmPolicy)]
    public async Task<IActionResult> ConfirmPayment([FromBody] PaymentConfirmRequest request, CancellationToken ct)
    {
        if (_paymentService is null)
            return StatusCode(503, new { success = false, errors = new[] { new { code = "PAYMENT_ERROR", message = "Marketplace payment service is unavailable.", field = (string?)null } } });
        return PaymentResult(await _paymentService.ConfirmAsync(
            User.GetTenantId() ?? throw new UnauthorizedAccessException(), RequireUserId(), request.PaymentIntentId, ct));
    }

    [HttpGet("payments/{id}/status")]
    [Authorize]
    [EnableRateLimiting(RateLimitingExtensions.MarketplacePaymentReadPolicy)]
    public async Task<IActionResult> PaymentStatus(long id, CancellationToken ct)
    {
        if (_paymentService is null)
            return StatusCode(503, new { success = false, errors = new[] { new { code = "PAYMENT_ERROR", message = "Marketplace payment service is unavailable.", field = (string?)null } } });
        return PaymentResult(await _paymentService.StatusAsync(
            User.GetTenantId() ?? throw new UnauthorizedAccessException(), RequireUserId(), id, ct));
    }

    [HttpGet("seller/payouts")]
    [Authorize]
    [EnableRateLimiting(RateLimitingExtensions.MarketplacePaymentReadPolicy)]
    public async Task<IActionResult> SellerPayouts(
        [FromQuery] int limit = 20,
        [FromQuery] int page = 1,
        CancellationToken ct = default)
    {
        if (_paymentService is null)
            return StatusCode(503, new { success = false, errors = new[] { new { code = "PAYMENT_ERROR", message = "Marketplace payment service is unavailable.", field = (string?)null } } });

        var result = await _paymentService.SellerPayoutsAsync(
            User.GetTenantId() ?? throw new UnauthorizedAccessException(),
            RequireUserId(),
            Math.Clamp(page, 1, 1000),
            Math.Clamp(limit, 1, 100),
            ct);
        return Ok(new
        {
            success = true,
            data = result.Items,
            meta = new
            {
                current_page = result.Page,
                per_page = result.Limit,
                total = result.Total,
                total_pages = result.TotalPages,
                has_more = result.Page < result.TotalPages
            }
        });
    }

    [HttpGet("seller/balance")]
    [Authorize]
    [EnableRateLimiting(RateLimitingExtensions.MarketplacePaymentReadPolicy)]
    public async Task<IActionResult> SellerBalance(CancellationToken ct)
    {
        if (_paymentService is null)
            return StatusCode(503, new { success = false, errors = new[] { new { code = "PAYMENT_ERROR", message = "Marketplace payment service is unavailable.", field = (string?)null } } });
        var balance = await _paymentService.SellerBalanceAsync(
            User.GetTenantId() ?? throw new UnauthorizedAccessException(), RequireUserId(), ct);
        return Ok(new { success = true, data = balance });
    }

    [HttpPost("seller/onboard")]
    [Authorize]
    [EnableRateLimiting(RateLimitingExtensions.MarketplaceSellerOnboardPolicy)]
    public async Task<IActionResult> SellerOnboard(
        [FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] SellerProfileRequest? request = null,
        CancellationToken ct = default)
    {
        var userId = RequireUserId();
        await _marketplace.GetOrCreateSellerProfileAsync(userId, request?.DisplayName);
        if (_paymentService is null)
            return StatusCode(503, new { success = false, errors = new[] { new { code = "ONBOARDING_ERROR", message = "Marketplace payment service is unavailable.", field = (string?)null } } });
        return PaymentResult(await _paymentService.StartConnectOnboardingAsync(
            User.GetTenantId() ?? throw new UnauthorizedAccessException(), userId, ct));
    }

    [HttpGet("saved-searches")]
    [Authorize]
    public async Task<IActionResult> SavedSearches()
    {
        var userId = RequireUserId();
        var rows = await _db.MarketplaceSavedSearches.Where(s => s.UserId == userId).OrderByDescending(s => s.CreatedAt).ToListAsync();
        return Ok(new { success = true, data = rows.Select(MapSavedSearch), meta = new { total = rows.Count } });
    }

    [HttpPost("saved-searches")]
    [Authorize]
    public async Task<IActionResult> CreateSavedSearch([FromBody] SavedSearchRequest request)
    {
        var row = new MarketplaceSavedSearch
        {
            UserId = RequireUserId(),
            Name = request.Name ?? request.Query ?? "Saved search",
            Query = request.Query ?? string.Empty,
            FiltersJson = request.Filters == null ? null : JsonSerializer.Serialize(request.Filters),
            AlertsEnabled = request.AlertsEnabled ?? true
        };
        _db.MarketplaceSavedSearches.Add(row);
        await _db.SaveChangesAsync();
        return Created($"/api/marketplace/saved-searches/{row.Id}", new { success = true, data = MapSavedSearch(row) });
    }

    [HttpDelete("saved-searches/{id:int}")]
    [Authorize]
    public async Task<IActionResult> DeleteSavedSearch(int id)
    {
        var row = await _db.MarketplaceSavedSearches.FirstOrDefaultAsync(s => s.Id == id && s.UserId == RequireUserId());
        if (row == null) return NotFound(new { error = "Saved search not found" });
        _db.MarketplaceSavedSearches.Remove(row);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("collections")]
    [Authorize]
    public async Task<IActionResult> Collections()
    {
        var userId = RequireUserId();
        var rows = await _db.MarketplaceCollections.Where(c => c.UserId == userId || c.IsPublic).OrderByDescending(c => c.CreatedAt).ToListAsync();
        var collectionIds = rows.Select(c => c.Id).ToList();
        var itemCounts = await _db.MarketplaceCollectionItems
            .Where(i => collectionIds.Contains(i.MarketplaceCollectionId))
            .GroupBy(i => i.MarketplaceCollectionId)
            .Select(g => new { CollectionId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.CollectionId, g => g.Count);
        return Ok(new { success = true, data = rows.Select(c => MapCollection(c, itemCounts.GetValueOrDefault(c.Id))), meta = new { total = rows.Count } });
    }

    [HttpPost("collections")]
    [Authorize]
    public async Task<IActionResult> CreateCollection([FromBody] CollectionRequest request)
    {
        var row = new MarketplaceCollection { UserId = RequireUserId(), Name = request.Name ?? "Collection", Description = request.Description, IsPublic = request.IsPublic };
        _db.MarketplaceCollections.Add(row);
        await _db.SaveChangesAsync();
        return Created($"/api/marketplace/collections/{row.Id}", new { success = true, data = MapCollection(row, 0) });
    }

    [HttpPut("collections/{id:int}")]
    [Authorize]
    public async Task<IActionResult> UpdateCollection(int id, [FromBody] CollectionRequest request)
    {
        var row = await _db.MarketplaceCollections.FirstOrDefaultAsync(c => c.Id == id && c.UserId == RequireUserId());
        if (row == null) return NotFound(new { error = "Collection not found" });
        if (request.Name != null) row.Name = request.Name;
        if (request.Description != null) row.Description = request.Description;
        row.IsPublic = request.IsPublic;
        row.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        var itemCount = await _db.MarketplaceCollectionItems.CountAsync(i => i.MarketplaceCollectionId == id);
        return Ok(new { success = true, data = MapCollection(row, itemCount) });
    }

    [HttpDelete("collections/{id:int}")]
    [Authorize]
    public async Task<IActionResult> DeleteCollection(int id)
    {
        var row = await _db.MarketplaceCollections.FirstOrDefaultAsync(c => c.Id == id && c.UserId == RequireUserId());
        if (row == null) return NotFound(new { error = "Collection not found" });
        _db.MarketplaceCollections.Remove(row);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPost("collections/{id:int}/items")]
    [Authorize]
    public async Task<IActionResult> AddCollectionItem(int id, [FromBody] CollectionItemRequest request)
    {
        if (!await _db.MarketplaceCollections.AnyAsync(c => c.Id == id && c.UserId == RequireUserId())) return NotFound(new { error = "Collection not found" });
        var row = new MarketplaceCollectionItem { MarketplaceCollectionId = id, MarketplaceListingId = request.ListingId };
        _db.MarketplaceCollectionItems.Add(row);
        await _db.SaveChangesAsync();
        var listing = await _db.MarketplaceListings
            .Include(l => l.Images)
            .Include(l => l.Category)
            .Include(l => l.User)
            .FirstOrDefaultAsync(l => l.Id == request.ListingId);
        if (listing == null) return NotFound(new { success = false, error = "Listing not found" });
        return Created($"/api/marketplace/collections/{id}/items/{request.ListingId}", new { success = true, data = MapCollectionItem(row, listing) });
    }

    [HttpGet("collections/{id:int}/items")]
    [Authorize]
    public async Task<IActionResult> CollectionItems(int id)
    {
        var items = await _db.MarketplaceCollectionItems
            .Where(i => i.MarketplaceCollectionId == id)
            .OrderByDescending(i => i.CreatedAt)
            .ToListAsync();
        var listingIds = items.Select(i => i.MarketplaceListingId).ToList();
        var listings = await _db.MarketplaceListings
            .Include(l => l.Images)
            .Include(l => l.Category)
            .Include(l => l.User)
            .Where(l => listingIds.Contains(l.Id))
            .ToDictionaryAsync(l => l.Id);
        return Ok(new { success = true, data = items.Select(i => MapCollectionItem(i, listings.GetValueOrDefault(i.MarketplaceListingId))).Where(i => i != null), meta = new { total = items.Count } });
    }

    [HttpDelete("collections/{id:int}/items/{listingId:int}")]
    [Authorize]
    public async Task<IActionResult> DeleteCollectionItem(int id, int listingId)
    {
        var row = await _db.MarketplaceCollectionItems.FirstOrDefaultAsync(i => i.MarketplaceCollectionId == id && i.MarketplaceListingId == listingId);
        if (row == null) return NotFound(new { error = "Collection item not found" });
        _db.MarketplaceCollectionItems.Remove(row);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("promotions/products")]
    [AllowAnonymous]
    public IActionResult PromotionProducts()
        => Ok(new
        {
            success = true,
            data = new[]
            {
                new
                {
                    type = "bump",
                    code = "bump",
                    label = "Bump to Top",
                    name = "Bump to Top",
                    description = "Moves your listing to the top of search results.",
                    price = 0m,
                    currency = "EUR",
                    duration_hours = 24
                },
                new
                {
                    type = "featured",
                    code = "featured",
                    label = "Featured Listing",
                    name = "Featured Listing",
                    description = "Gets a featured badge and higher visibility.",
                    price = 4.99m,
                    currency = "EUR",
                    duration_hours = 168
                },
                new
                {
                    type = "homepage_carousel",
                    code = "homepage_carousel",
                    label = "Homepage Carousel",
                    name = "Homepage Carousel",
                    description = "Appears in the homepage carousel.",
                    price = 9.99m,
                    currency = "EUR",
                    duration_hours = 48
                }
            }
        });

    [HttpPost("listings/{id:int}/promote")]
    [Authorize]
    public async Task<IActionResult> PromoteListing(int id, [FromBody] PromotionRequest request)
    {
        var listing = await _db.MarketplaceListings.FirstOrDefaultAsync(l => l.Id == id);
        if (listing == null) return NotFound(new { error = "Listing not found" });
        if (listing.UserId != RequireUserId() && !User.IsAdmin()) return StatusCode(403, new { error = "Forbidden" });
        var product = ResolvePromotionProduct(request.PromotionType ?? request.ProductCode);
        if (product == null) return UnprocessableEntity(new { success = false, error = "Unknown promotion type" });

        var now = DateTime.UtcNow;
        listing.PromotionType = product.Type;
        listing.PromotedUntil = now.AddHours(product.DurationHours);
        var promotion = new MarketplacePromotion
        {
            MarketplaceListingId = id,
            UserId = listing.UserId,
            ProductCode = product.Type,
            Status = "active",
            StartsAt = now,
            EndsAt = listing.PromotedUntil.Value
        };
        _db.MarketplacePromotions.Add(promotion);
        await _db.SaveChangesAsync();
        return Created($"/api/marketplace/listings/{id}/promotion", new
        {
            success = true,
            data = new
            {
                id = promotion.Id,
                promotion_type = product.Type,
                amount_paid = product.Price,
                currency = product.Currency,
                started_at = promotion.StartsAt,
                expires_at = promotion.EndsAt,
                is_active = promotion.Status == "active"
            }
        });
    }

    [HttpGet("listings/{id:int}/promotion")]
    [AllowAnonymous]
    public async Task<IActionResult> ListingPromotion(int id)
    {
        var promotion = await _db.MarketplacePromotions.Where(p => p.MarketplaceListingId == id).OrderByDescending(p => p.CreatedAt).FirstOrDefaultAsync();
        return Ok(new { data = promotion });
    }

    [HttpGet("promotions/mine")]
    [Authorize]
    public async Task<IActionResult> MyPromotions()
    {
        var userId = RequireUserId();
        var rows = await _db.MarketplacePromotions.Where(p => p.UserId == userId).OrderByDescending(p => p.CreatedAt).ToListAsync();
        return Ok(new { data = rows, meta = new { total = rows.Count } });
    }

    [HttpGet("groups/{groupId:int}/listings")]
    [Authorize]
    public async Task<IActionResult> GroupListings(
        int groupId,
        [FromQuery] int? category_id = null,
        [FromQuery] string? search = null,
        [FromQuery] string? condition = null,
        [FromQuery] string? sort = null,
        [FromQuery] int limit = 20,
        [FromQuery] string? cursor = null)
    {
        var userId = RequireUserId();
        var access = await LoadGroupMarketplaceMemberIdsAsync(groupId, userId);
        if (access.Result != null)
            return access.Result;

        var memberIds = access.MemberIds;
        var pageSize = Math.Clamp(limit, 1, 100);
        var query = _db.MarketplaceListings
            .Include(l => l.User)
            .Include(l => l.Category)
            .Include(l => l.Images)
            .Where(l =>
                memberIds.Contains(l.UserId) &&
                l.Status == "active" &&
                l.ModerationStatus == "approved");

        if (category_id.HasValue)
            query = query.Where(l => l.CategoryId == category_id.Value);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLowerInvariant();
            query = query.Where(l => l.Title.ToLower().Contains(term) || l.Description.ToLower().Contains(term));
        }

        if (!string.IsNullOrWhiteSpace(condition))
        {
            var conditions = condition.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            query = query.Where(l => conditions.Contains(l.Condition));
        }

        var total = await query.CountAsync();
        var cursorId = DecodeListingCursor(cursor);
        if (cursorId.HasValue)
            query = query.Where(l => l.Id < cursorId.Value);

        query = sort switch
        {
            "price_asc" => query.OrderBy(l => l.Price ?? 0).ThenByDescending(l => l.Id),
            "price_desc" => query.OrderByDescending(l => l.Price ?? 0).ThenByDescending(l => l.Id),
            "popular" => query.OrderByDescending(l => l.ViewsCount).ThenByDescending(l => l.Id),
            _ => query.OrderByDescending(l => l.Id)
        };

        var items = await query.Take(pageSize + 1).ToListAsync();
        var hasMore = items.Count > pageSize;
        if (hasMore) items.RemoveAt(items.Count - 1);
        var nextCursor = hasMore && items.Count > 0 ? EncodeListingCursor(items[^1].Id) : null;
        var savedIds = await LoadSavedListingIdsAsync(userId, items.Select(l => l.Id));

        return Ok(new
        {
            success = true,
            data = items.Select(l => MapListing(l, currentUserId: userId, savedListingIds: savedIds)),
            meta = new { per_page = pageSize, has_more = hasMore, cursor = nextCursor, next_cursor = nextCursor, total }
        });
    }

    [HttpGet("groups/{groupId:int}/stats")]
    [Authorize]
    public async Task<IActionResult> GroupStats(int groupId)
    {
        var userId = RequireUserId();
        var access = await LoadGroupMarketplaceMemberIdsAsync(groupId, userId);
        if (access.Result != null)
            return access.Result;

        var memberIds = access.MemberIds;
        var listings = await _db.MarketplaceListings
            .Include(l => l.Category)
            .Where(l => memberIds.Contains(l.UserId))
            .ToListAsync();
        var activeListings = listings
            .Where(l => l.Status == "active" && l.ModerationStatus == "approved")
            .ToList();
        var categories = activeListings
            .Where(l => l.Category != null)
            .GroupBy(l => l.Category!)
            .OrderByDescending(g => g.Count())
            .Take(10)
            .Select(g => new
            {
                id = g.Key.Id,
                name = g.Key.Name,
                slug = g.Key.Slug,
                icon = g.Key.Icon,
                listing_count = g.Count()
            });

        return Ok(new
        {
            success = true,
            data = new
            {
                active_listings = activeListings.Count,
                total_listed = listings.Count,
                total_sellers = listings.Select(l => l.UserId).Distinct().Count(),
                categories
            }
        });
    }

    [HttpPost("orders/{orderId:int}/delivery-offers")]
    [Authorize]
    public async Task<IActionResult> CreateDeliveryOffer(int orderId, [FromBody] DeliveryOfferRequest request)
    {
        var timeCredits = request.TimeCredits ?? request.TimeCreditAmount;
        var offer = new MarketplaceDeliveryOffer { MarketplaceOrderId = orderId, DelivererUserId = RequireUserId(), TimeCreditAmount = timeCredits };
        _db.MarketplaceDeliveryOffers.Add(offer);
        await _db.SaveChangesAsync();
        return Created($"/api/marketplace/orders/{orderId}/delivery-offers", new { data = MapDeliveryOffer(offer) });
    }

    [HttpGet("orders/{orderId:int}/delivery-offers")]
    [Authorize]
    public async Task<IActionResult> DeliveryOffers(int orderId)
    {
        var rows = await _db.MarketplaceDeliveryOffers.Where(o => o.MarketplaceOrderId == orderId).ToListAsync();
        var delivererIds = rows.Select(o => o.DelivererUserId).Distinct().ToArray();
        var deliverers = await _db.Users
            .Where(u => delivererIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id);
        return Ok(new { data = rows.Select(o => MapDeliveryOffer(o, deliverers.GetValueOrDefault(o.DelivererUserId))), meta = new { total = rows.Count } });
    }

    [HttpPut("orders/{orderId:int}/delivery-offers/{delivererId:int}/accept")]
    [Authorize]
    public Task<IActionResult> AcceptDeliveryOffer(int orderId, int delivererId)
        => DeliveryOfferStatus(orderId, delivererId, "accepted", "Delivery offer accepted");

    [HttpPut("orders/{orderId:int}/delivery-offers/{delivererId:int}/confirm")]
    [Authorize]
    public Task<IActionResult> ConfirmDeliveryOffer(int orderId, int delivererId)
        => DeliveryOfferStatus(orderId, delivererId, "completed", "Delivery confirmed");

    [HttpPost("listings/{id:int}/auto-reply")]
    [Authorize]
    public async Task<IActionResult> AutoReply(int id, [FromBody] AutoReplyRequest request)
    {
        var listing = await _db.MarketplaceListings.FirstOrDefaultAsync(l => l.Id == id);
        if (listing == null)
            return NotFound(new { success = false, code = "NOT_FOUND", error = "Listing not found." });

        if (listing.UserId != RequireUserId())
            return StatusCode(StatusCodes.Status403Forbidden, new { success = false, code = "FORBIDDEN", error = "Only the listing owner can generate auto-replies." });

        var message = request.Message ?? request.Question;
        if (string.IsNullOrWhiteSpace(message) || message.Trim().Length < 5)
            return BadRequest(new { success = false, code = "VALIDATION_ERROR", error = "message is required" });

        return Ok(new { success = true, data = new { reply = $"Thanks for your message about this listing. {message.Trim()}".Trim() } });
    }

    [HttpPost("listings/{id:int}/report")]
    [Authorize]
    public async Task<IActionResult> ReportListing(int id, [FromBody] ReportRequest request, CancellationToken ct)
    {
        var result = await new MarketplaceReportCaseService(_db).CreateAsync(
            User.GetTenantId() ?? throw new UnauthorizedAccessException(),
            RequireUserId(), id, request.Reason, request.Details ?? request.Description,
            request.EvidenceUrls, ct);
        if (result.Succeeded) return StatusCode(result.Status, new { success = true, data = result.Data });
        var error = result.Error!;
        return StatusCode(error.Status, new { success = false, errors = new[] { new { code = error.Code, message = error.Message, field = error.Field } } });
    }

    [HttpGet("seller/coupons")]
    [Authorize]
    public async Task<IActionResult> SellerCoupons()
    {
        var userId = RequireUserId();
        var rows = await _db.MerchantCoupons
            .Where(c => c.SellerUserId == userId)
            .OrderByDescending(c => c.CreatedAt)
            .ToListAsync();
        return Ok(new { success = true, data = new { items = rows.Select(MapMerchantCoupon) }, meta = new { total = rows.Count } });
    }

    [HttpPost("seller/coupons")]
    [Authorize]
    public async Task<IActionResult> CreateSellerCoupon([FromBody] JsonElement request)
    {
        var code = NormalizeCouponCode(GetString(request, "code"));
        if (string.IsNullOrWhiteSpace(code))
            code = Guid.NewGuid().ToString("N")[..8].ToUpperInvariant();

        if (await _db.MerchantCoupons.AnyAsync(c => c.Code == code))
            return UnprocessableEntity(new { success = false, code = "VALIDATION_ERROR", error = "Coupon code is already in use." });

        var title = GetString(request, "title");
        if (string.IsNullOrWhiteSpace(title))
            return UnprocessableEntity(new { success = false, code = "VALIDATION_ERROR", error = "Title is required." });

        var status = NormalizeCouponStatus(GetString(request, "status") ?? "draft");
        var discountValue = GetDecimal(request, "discount_value", "discountAmount", "discount_amount") ?? 0m;
        var validUntil = GetDateTime(request, "valid_until", "expiresAt", "expires_at");

        var row = new MerchantCoupon
        {
            SellerUserId = RequireUserId(),
            Code = code,
            Title = title.Trim(),
            Description = GetString(request, "description") ?? string.Empty,
            DiscountAmount = discountValue,
            DiscountType = NormalizeDiscountType(GetString(request, "discount_type", "discountType")),
            MinOrderCents = GetInt(request, "min_order_cents"),
            MaxUses = GetInt(request, "max_uses"),
            MaxUsesPerMember = Math.Max(1, GetInt(request, "max_uses_per_member") ?? 1),
            ValidFrom = GetDateTime(request, "valid_from"),
            ExpiresAt = validUntil,
            Status = status,
            IsActive = status == "active",
            AppliesTo = NormalizeAppliesTo(GetString(request, "applies_to")),
            AppliesToIdsJson = GetJsonArray(request, "applies_to_ids")
        };
        _db.MerchantCoupons.Add(row);
        await _db.SaveChangesAsync();
        return Created($"/api/marketplace/seller/coupons/{row.Id}", new { success = true, data = MapMerchantCoupon(row) });
    }

    [HttpPut("seller/coupons/{id:int}")]
    [Authorize]
    public async Task<IActionResult> UpdateSellerCoupon(int id, [FromBody] JsonElement request)
    {
        var row = await _db.MerchantCoupons.FirstOrDefaultAsync(c => c.Id == id && c.SellerUserId == RequireUserId());
        if (row == null) return NotFound(new { success = false, code = "NOT_FOUND", error = "Coupon not found" });

        if (HasAny(request, "code"))
        {
            var code = NormalizeCouponCode(GetString(request, "code"));
            if (string.IsNullOrWhiteSpace(code))
                return UnprocessableEntity(new { success = false, code = "VALIDATION_ERROR", error = "Coupon code is required." });
            if (await _db.MerchantCoupons.AnyAsync(c => c.Code == code && c.Id != row.Id))
                return UnprocessableEntity(new { success = false, code = "VALIDATION_ERROR", error = "Coupon code is already in use." });
            row.Code = code;
        }
        if (HasAny(request, "title"))
            row.Title = GetString(request, "title")?.Trim() ?? string.Empty;
        if (HasAny(request, "description"))
            row.Description = GetString(request, "description") ?? string.Empty;
        if (HasAny(request, "discount_value", "discountAmount", "discount_amount"))
            row.DiscountAmount = GetDecimal(request, "discount_value", "discountAmount", "discount_amount") ?? 0m;
        if (HasAny(request, "discount_type", "discountType"))
            row.DiscountType = NormalizeDiscountType(GetString(request, "discount_type", "discountType"));
        if (HasAny(request, "min_order_cents"))
            row.MinOrderCents = GetInt(request, "min_order_cents");
        if (HasAny(request, "max_uses"))
            row.MaxUses = GetInt(request, "max_uses");
        if (HasAny(request, "max_uses_per_member"))
            row.MaxUsesPerMember = Math.Max(1, GetInt(request, "max_uses_per_member") ?? 1);
        if (HasAny(request, "valid_from"))
            row.ValidFrom = GetDateTime(request, "valid_from");
        if (HasAny(request, "valid_until", "expiresAt", "expires_at"))
            row.ExpiresAt = GetDateTime(request, "valid_until", "expiresAt", "expires_at");
        if (HasAny(request, "status"))
        {
            row.Status = NormalizeCouponStatus(GetString(request, "status") ?? "draft");
            row.IsActive = row.Status == "active";
        }
        if (HasAny(request, "applies_to"))
            row.AppliesTo = NormalizeAppliesTo(GetString(request, "applies_to"));
        if (HasAny(request, "applies_to_ids"))
            row.AppliesToIdsJson = GetJsonArray(request, "applies_to_ids");
        row.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = MapMerchantCoupon(row) });
    }

    [HttpDelete("seller/coupons/{id:int}")]
    [Authorize]
    public async Task<IActionResult> DeleteSellerCoupon(int id)
    {
        var row = await _db.MerchantCoupons.FirstOrDefaultAsync(c => c.Id == id && c.SellerUserId == RequireUserId());
        if (row == null) return NotFound(new { success = false, code = "NOT_FOUND", error = "Coupon not found" });
        _db.MerchantCoupons.Remove(row);
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = new { deleted = true } });
    }

    [HttpGet("seller/coupons/{id:int}/redemptions")]
    [Authorize]
    public async Task<IActionResult> CouponRedemptions(int id)
    {
        var rows = await _db.MerchantCouponRedemptions.Where(r => r.MerchantCouponId == id).ToListAsync();
        return Ok(new { data = rows, meta = new { total = rows.Count } });
    }

    [HttpGet("seller/shipping-options")]
    [Authorize]
    public async Task<IActionResult> ShippingOptions()
    {
        var rows = await _db.MarketplaceShippingOptions.Where(o => o.UserId == RequireUserId()).ToListAsync();
        return Ok(new { success = true, data = rows.Select(MapShippingOption), meta = new { total = rows.Count } });
    }

    [HttpPost("seller/shipping-options")]
    [Authorize]
    public async Task<IActionResult> CreateShippingOption([FromBody] ShippingOptionRequest request)
    {
        var userId = RequireUserId();
        if (request.IsDefault == true)
        {
            await _db.MarketplaceShippingOptions
                .Where(o => o.UserId == userId)
                .ExecuteUpdateAsync(setters => setters.SetProperty(o => o.IsDefault, false));
        }

        var row = new MarketplaceShippingOption
        {
            UserId = userId,
            Name = request.CourierName ?? request.Name ?? "Shipping",
            Price = request.Price,
            Currency = request.Currency ?? "EUR",
            Region = request.Region,
            EstimatedDays = request.EstimatedDays,
            IsDefault = request.IsDefault ?? false,
            IsActive = request.IsActive ?? true
        };
        _db.MarketplaceShippingOptions.Add(row);
        await _db.SaveChangesAsync();
        return Created($"/api/marketplace/seller/shipping-options/{row.Id}", new { success = true, data = MapShippingOption(row) });
    }

    [HttpPut("seller/shipping-options/{id:int}")]
    [Authorize]
    public async Task<IActionResult> UpdateShippingOption(int id, [FromBody] ShippingOptionRequest request)
    {
        var userId = RequireUserId();
        var row = await _db.MarketplaceShippingOptions.FirstOrDefaultAsync(o => o.Id == id && o.UserId == userId);
        if (row == null) return NotFound(new { error = "Shipping option not found" });
        if (request.IsDefault == true)
        {
            await _db.MarketplaceShippingOptions
                .Where(o => o.UserId == userId && o.Id != id)
                .ExecuteUpdateAsync(setters => setters.SetProperty(o => o.IsDefault, false));
        }

        if (request.CourierName != null || request.Name != null) row.Name = request.CourierName ?? request.Name!;
        row.Price = request.Price;
        if (request.Currency != null) row.Currency = request.Currency;
        if (request.Region != null) row.Region = request.Region;
        row.EstimatedDays = request.EstimatedDays;
        row.IsDefault = request.IsDefault ?? row.IsDefault;
        row.IsActive = request.IsActive ?? row.IsActive;
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = MapShippingOption(row) });
    }

    [HttpDelete("seller/shipping-options/{id:int}")]
    [Authorize]
    public async Task<IActionResult> DeleteShippingOption(int id)
    {
        var row = await _db.MarketplaceShippingOptions.FirstOrDefaultAsync(o => o.Id == id && o.UserId == RequireUserId());
        if (row == null) return NotFound(new { error = "Shipping option not found" });
        _db.MarketplaceShippingOptions.Remove(row);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("seller/pickup-slots")]
    [Authorize]
    public async Task<IActionResult> PickupSlots()
    {
        var rows = await _db.MarketplacePickupSlots.Where(s => s.UserId == RequireUserId()).ToListAsync();
        return Ok(new { success = true, data = rows.Select(MapPickupSlot), meta = new { total = rows.Count } });
    }

    [HttpPost("seller/pickup-slots")]
    [Authorize]
    public async Task<IActionResult> CreatePickupSlot([FromBody] PickupSlotRequest request)
    {
        var row = new MarketplacePickupSlot
        {
            UserId = RequireUserId(),
            Location = request.Location ?? string.Empty,
            StartsAt = request.SlotStart ?? request.StartsAt,
            EndsAt = request.SlotEnd ?? request.EndsAt,
            Capacity = Math.Max(1, request.Capacity),
            IsRecurring = request.IsRecurring ?? false,
            RecurringPattern = request.RecurringPattern,
            IsActive = request.IsActive ?? true
        };
        _db.MarketplacePickupSlots.Add(row);
        await _db.SaveChangesAsync();
        return Created($"/api/marketplace/seller/pickup-slots/{row.Id}", new { success = true, data = MapPickupSlot(row) });
    }

    [HttpPut("seller/pickup-slots/{id:int}")]
    [Authorize]
    public async Task<IActionResult> UpdatePickupSlot(int id, [FromBody] PickupSlotRequest request)
    {
        var row = await _db.MarketplacePickupSlots.FirstOrDefaultAsync(s => s.Id == id && s.UserId == RequireUserId());
        if (row == null) return NotFound(new { success = false, code = "NOT_FOUND", error = "Pickup slot not found" });
        if (request.Location != null) row.Location = request.Location;
        if ((request.SlotStart ?? request.StartsAt) != default) row.StartsAt = request.SlotStart ?? request.StartsAt;
        if ((request.SlotEnd ?? request.EndsAt) != default) row.EndsAt = request.SlotEnd ?? request.EndsAt;
        if (request.Capacity > 0) row.Capacity = request.Capacity;
        row.IsRecurring = request.IsRecurring ?? row.IsRecurring;
        if (request.RecurringPattern != null) row.RecurringPattern = request.RecurringPattern;
        row.IsActive = request.IsActive ?? row.IsActive;
        row.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = MapPickupSlot(row) });
    }

    [HttpDelete("seller/pickup-slots/{id:int}")]
    [Authorize]
    public async Task<IActionResult> DeletePickupSlot(int id)
    {
        var row = await _db.MarketplacePickupSlots.FirstOrDefaultAsync(s => s.Id == id && s.UserId == RequireUserId());
        if (row == null) return NotFound(new { success = false, code = "NOT_FOUND", error = "Pickup slot not found" });
        _db.MarketplacePickupSlots.Remove(row);
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = new { deleted = true } });
    }

    [HttpPost("seller/pickup-scan")]
    [Authorize]
    public async Task<IActionResult> PickupScan([FromBody] PickupScanRequest request)
    {
        var qrCode = request.QrCode ?? request.Code;
        if (string.IsNullOrWhiteSpace(qrCode))
            return BadRequest(new { success = false, code = "VALIDATION_ERROR", error = "qr_code is required" });

        var reservation = await _db.MarketplacePickupReservations.FirstOrDefaultAsync(r => r.QrCode == qrCode);
        if (reservation == null)
            return UnprocessableEntity(new { success = false, code = "QR_NOT_FOUND", error = "QR_NOT_FOUND" });

        var order = await _db.MarketplaceOrders.FirstOrDefaultAsync(o => o.Id == reservation.MarketplaceOrderId);
        if (order == null || order.SellerUserId != RequireUserId())
            return UnprocessableEntity(new { success = false, code = "NOT_FOR_SELLER", error = "NOT_FOR_SELLER" });

        if (reservation.Status == "picked_up")
            return UnprocessableEntity(new { success = false, code = "ALREADY_PICKED_UP", error = "ALREADY_PICKED_UP" });

        reservation.Status = "picked_up";
        reservation.PickedUpAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new { success = true, data = MapPickupReservation(reservation) });
    }

    [HttpGet("listings/{id:int}/pickup-slots")]
    [AllowAnonymous]
    public async Task<IActionResult> ListingPickupSlots(int id)
    {
        var listing = await _db.MarketplaceListings.FirstOrDefaultAsync(l => l.Id == id);
        if (listing == null) return NotFound(new { success = false, code = "NOT_FOUND", error = "Listing not found" });
        var rows = await _db.MarketplacePickupSlots
            .Where(s =>
                s.UserId == listing.UserId &&
                s.IsActive &&
                s.StartsAt >= DateTime.UtcNow &&
                s.BookedCount < s.Capacity)
            .OrderBy(s => s.StartsAt)
            .Take(50)
            .ToListAsync();
        return Ok(new { success = true, data = rows.Select(MapPickupSlot), meta = new { total = rows.Count } });
    }

    [HttpPost("orders/{id:int}/pickup-reservation")]
    [Authorize]
    public async Task<IActionResult> ReservePickup(int id, [FromBody] PickupReservationRequest request)
    {
        var slotId = request.SlotId ?? request.PickupSlotId;
        if (slotId <= 0)
            return BadRequest(new { success = false, code = "VALIDATION_ERROR", error = "slot_id is required" });

        var userId = RequireUserId();
        var order = await _db.MarketplaceOrders.FirstOrDefaultAsync(o => o.Id == id && o.BuyerUserId == userId);
        if (order == null)
            return UnprocessableEntity(new { success = false, code = "ORDER_NOT_FOUND", error = "ORDER_NOT_FOUND" });

        var slot = await _db.MarketplacePickupSlots.FirstOrDefaultAsync(s => s.Id == slotId);
        if (slot == null)
            return UnprocessableEntity(new { success = false, code = "SLOT_NOT_FOUND", error = "SLOT_NOT_FOUND" });
        if (slot.UserId != order.SellerUserId)
            return UnprocessableEntity(new { success = false, code = "SLOT_NOT_FOR_SELLER", error = "SLOT_NOT_FOR_SELLER" });
        if (!slot.IsActive)
            return UnprocessableEntity(new { success = false, code = "SLOT_INACTIVE", error = "SLOT_INACTIVE" });
        if (slot.StartsAt < DateTime.UtcNow)
            return UnprocessableEntity(new { success = false, code = "SLOT_PAST", error = "SLOT_PAST" });
        if (slot.BookedCount >= slot.Capacity)
            return UnprocessableEntity(new { success = false, code = "SLOT_FULL", error = "SLOT_FULL" });

        var existing = await _db.MarketplacePickupReservations
            .FirstOrDefaultAsync(r => r.MarketplaceOrderId == id && (r.Status == "reserved" || r.Status == "picked_up"));
        if (existing != null)
            return UnprocessableEntity(new { success = false, code = "DUPLICATE_RESERVATION", error = "DUPLICATE_RESERVATION" });

        slot.BookedCount += 1;
        var row = new MarketplacePickupReservation
        {
            TenantId = order.TenantId,
            MarketplaceOrderId = id,
            MarketplacePickupSlotId = slotId,
            MarketplaceListingId = order.MarketplaceListingId,
            UserId = userId,
            QrCode = GeneratePickupQrCode(),
            Status = "reserved",
            ReservedAt = DateTime.UtcNow
        };
        _db.MarketplacePickupReservations.Add(row);
        await _db.SaveChangesAsync();
        return Created($"/api/marketplace/orders/{id}/pickup-reservation", new { success = true, data = MapPickupReservation(row, slot) });
    }

    [HttpGet("me/pickups")]
    [Authorize]
    public async Task<IActionResult> MyPickups()
    {
        var rows = await _db.MarketplacePickupReservations.Where(r => r.UserId == RequireUserId()).ToListAsync();
        var slots = await _db.MarketplacePickupSlots
            .Where(s => rows.Select(r => r.MarketplacePickupSlotId).Contains(s.Id))
            .ToDictionaryAsync(s => s.Id);
        var listingIds = rows.Select(r => r.MarketplaceListingId).Where(id => id.HasValue).Select(id => id!.Value).Distinct().ToArray();
        var listings = listingIds.Length == 0
            ? new Dictionary<int, MarketplaceListing>()
            : await _db.MarketplaceListings.Where(l => listingIds.Contains(l.Id)).ToDictionaryAsync(l => l.Id);

        return Ok(new
        {
            success = true,
            data = rows.Select(r => MapPickupReservation(
                r,
                slots.GetValueOrDefault(r.MarketplacePickupSlotId),
                r.MarketplaceListingId.HasValue ? listings.GetValueOrDefault(r.MarketplaceListingId.Value) : null)),
            meta = new { total = rows.Count }
        });
    }

    [HttpPatch("seller/listings/{id:int}/inventory")]
    [Authorize]
    public async Task<IActionResult> UpdateInventory(int id, [FromBody] InventoryRequest request)
    {
        var listing = await _db.MarketplaceListings.FirstOrDefaultAsync(l => l.Id == id);
        if (listing == null) return NotFound(new { error = "Listing not found" });
        if (listing.UserId != RequireUserId() && !User.IsAdmin()) return StatusCode(403, new { error = "Forbidden" });
        listing.Quantity = Math.Max(0, request.Quantity);
        listing.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { data = MapListing(listing) });
    }

    [HttpGet("categories")]
    [AllowAnonymous]
    public async Task<IActionResult> Categories()
    {
        await _marketplace.EnsureDefaultCategoriesAsync();
        var rows = await _db.MarketplaceCategories
            .AsNoTracking()
            .Where(c => c.IsActive)
            .OrderBy(c => c.SortOrder)
            .ThenBy(c => c.Name)
            .ToListAsync();

        var categoryIds = rows.Select(c => c.Id).ToArray();
        var counts = await _db.MarketplaceListings
            .AsNoTracking()
            .Where(l =>
                l.CategoryId.HasValue &&
                categoryIds.Contains(l.CategoryId.Value) &&
                l.Status == "active" &&
                l.ModerationStatus == "approved")
            .GroupBy(l => l.CategoryId!.Value)
            .Select(g => new { CategoryId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.CategoryId, x => x.Count);

        var data = rows.Select(c => new
        {
            id = c.Id,
            name = c.Name,
            slug = c.Slug,
            description = c.Description,
            icon = c.Icon,
            parent_id = (int?)null,
            listing_count = counts.GetValueOrDefault(c.Id)
        });

        return Ok(new { success = true, data, meta = new { total = rows.Count } });
    }

    [HttpGet("categories/{slug}/listings")]
    [AllowAnonymous]
    public async Task<IActionResult> CategoryListings(
        string slug,
        [FromQuery] int limit = 20,
        [FromQuery] int page = 1,
        [FromQuery] string? cursor = null)
    {
        limit = Math.Clamp(limit, 1, 100);
        page = Math.Max(1, page);

        var category = await _db.MarketplaceCategories
            .AsNoTracking()
            .Where(c => c.Slug == slug && c.IsActive)
            .OrderBy(c => c.SortOrder)
            .ThenBy(c => c.Name)
            .FirstOrDefaultAsync();

        if (category == null)
            return Ok(Collection(Array.Empty<object>(), limit, hasMore: false));

        var cursorId = DecodeListingCursor(cursor);
        var query = _db.MarketplaceListings
            .Include(l => l.User)
            .Include(l => l.Category)
            .Include(l => l.Images)
            .Where(l =>
                l.CategoryId == category.Id
                && l.Status == "active"
                && l.ModerationStatus == "approved");

        if (cursorId.HasValue)
            query = query.Where(l => l.Id < cursorId.Value);

        var listings = await query
            .AsNoTracking()
            .OrderByDescending(l => l.Id)
            .Take(limit + 1)
            .ToListAsync();

        var hasMore = listings.Count > limit;
        if (hasMore)
            listings.RemoveAt(listings.Count - 1);

        var nextCursor = hasMore && listings.Count > 0
            ? EncodeListingCursor(listings[^1].Id)
            : null;

        return Ok(Collection(listings.Select(l => MapListing(l)), limit, hasMore, nextCursor));
    }

    [HttpGet("categories/{id:int}/template")]
    [AllowAnonymous]
    public IActionResult CategoryTemplate(int id)
        => Ok(new
        {
            success = true,
            data = new
            {
                category_id = id,
                name = (string?)null,
                fields = Array.Empty<object>()
            }
        });

    [HttpGet("sellers/{id:int}")]
    [AllowAnonymous]
    public async Task<IActionResult> Seller(int id)
    {
        var profile = await _db.MarketplaceSellerProfiles
            .Include(p => p.User)
            .FirstOrDefaultAsync(p => p.UserId == id)
            ?? await _db.MarketplaceSellerProfiles
                .Include(p => p.User)
                .FirstOrDefaultAsync(p => p.Id == id);
        if (profile == null)
            return NotFound(new { success = false, code = "NOT_FOUND", error = "Seller profile not found." });

        var activeListingCount = await _db.MarketplaceListings.CountAsync(l =>
            l.UserId == profile.UserId &&
            l.Status == "active" &&
            l.ModerationStatus == "approved");

        return Ok(new { success = true, data = MapPublicSellerProfile(profile, activeListingCount) });
    }

    [HttpGet("sellers/{id:int}/listings")]
    [AllowAnonymous]
    public async Task<IActionResult> SellerListings(int id, [FromQuery] int limit = 20, [FromQuery] int? per_page = null)
    {
        var profile = await _db.MarketplaceSellerProfiles.FirstOrDefaultAsync(p => p.UserId == id)
            ?? await _db.MarketplaceSellerProfiles.FirstOrDefaultAsync(p => p.Id == id);
        if (profile == null)
            return NotFound(new { success = false, code = "NOT_FOUND", error = "Seller profile not found." });

        var pageSize = Math.Clamp(per_page ?? limit, 1, 100);
        var query = _db.MarketplaceListings
            .Include(l => l.User)
            .Include(l => l.Category)
            .Include(l => l.Images)
            .Where(l =>
                l.UserId == profile.UserId &&
                l.Status == "active" &&
                l.ModerationStatus == "approved");
        var total = await query.CountAsync();
        var items = await query
            .OrderByDescending(l => l.PromotedUntil != null && l.PromotedUntil > DateTime.UtcNow)
            .ThenByDescending(l => l.CreatedAt)
            .Take(pageSize)
            .ToListAsync();
        var currentUserId = User.GetUserId();
        var savedIds = await LoadSavedListingIdsAsync(currentUserId, items.Select(l => l.Id));
        return Ok(new
        {
            success = true,
            data = items.Select(l => MapListing(l, currentUserId: currentUserId, savedListingIds: savedIds)),
            meta = new { total, per_page = pageSize, has_more = false, cursor = (string?)null, next_cursor = (string?)null }
        });
    }

    [HttpPost("webhooks/stripe")]
    [AllowAnonymous]
    public async Task<IActionResult> StripeWebhook(CancellationToken ct)
    {
        if (_paymentService is null || _configuration is null)
            return StatusCode(503, new { error = "marketplace_payment_service_unavailable" });
        var secret = _configuration["Stripe:WebhookSecret_Marketplace"] ?? _configuration["Stripe:WebhookSecret"];
        if (string.IsNullOrWhiteSpace(secret))
            return StatusCode(503, new { error = "webhook_secret_unconfigured" });

        Request.EnableBuffering();
        Request.Body.Position = 0;
        using var reader = new StreamReader(Request.Body, Encoding.UTF8, leaveOpen: true);
        var raw = await reader.ReadToEndAsync(ct);
        Request.Body.Position = 0;
        if (string.IsNullOrWhiteSpace(raw)) return BadRequest(new { error = "empty_body" });
        var signature = Request.Headers["Stripe-Signature"].FirstOrDefault();
        var (valid, reason) = StripeWebhookController.VerifyStripeSignature(raw, signature, secret);
        if (!valid) return Unauthorized(new { error = "signature_invalid", reason });

        try
        {
            using var document = JsonDocument.Parse(raw);
            var root = document.RootElement;
            var eventId = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
            var eventType = root.TryGetProperty("type", out var typeElement) ? typeElement.GetString() : null;
            if (!root.TryGetProperty("data", out var data) || !data.TryGetProperty("object", out var stripeObject) ||
                !stripeObject.TryGetProperty("id", out var intentIdElement) || intentIdElement.ValueKind != JsonValueKind.String)
                return BadRequest(new { error = "missing_data_object" });
            MarketplacePaymentResult result;
            if (eventType == "payment_intent.succeeded")
            {
                result = await _paymentService.ReconcileSucceededIntentAsync(intentIdElement.GetString()!, eventId, ct);
            }
            else if (eventType == "charge.refunded")
            {
                if (!stripeObject.TryGetProperty("payment_intent", out var paymentIntentElement) ||
                    paymentIntentElement.ValueKind != JsonValueKind.String ||
                    !stripeObject.TryGetProperty("amount_refunded", out var amountRefundedElement) ||
                    !amountRefundedElement.TryGetInt64(out var amountRefunded))
                    return BadRequest(new { error = "missing_refund_economics" });
                var refunds = new List<MarketplaceStripeRefund>();
                if (stripeObject.TryGetProperty("refunds", out var refundsObject) &&
                    refundsObject.TryGetProperty("data", out var refundData) &&
                    refundData.ValueKind == JsonValueKind.Array)
                {
                    foreach (var refund in refundData.EnumerateArray())
                    {
                        if (!refund.TryGetProperty("id", out var refundId) || refundId.ValueKind != JsonValueKind.String ||
                            !refund.TryGetProperty("amount", out var refundAmount) || !refundAmount.TryGetInt64(out var amount) ||
                            !refund.TryGetProperty("currency", out var refundCurrency) || refundCurrency.ValueKind != JsonValueKind.String)
                            return BadRequest(new { error = "invalid_refund_detail" });
                        var status = refund.TryGetProperty("status", out var refundStatus) && refundStatus.ValueKind == JsonValueKind.String
                            ? refundStatus.GetString()!
                            : "succeeded";
                        var transferReversed = refund.TryGetProperty("transfer_reversal", out var transferReversal) &&
                                               transferReversal.ValueKind != JsonValueKind.Null;
                        var applicationFeeRefunded = refund.TryGetProperty("application_fee_refund", out var feeRefund) &&
                                                     feeRefund.ValueKind != JsonValueKind.Null;
                        refunds.Add(new MarketplaceStripeRefund(
                            refundId.GetString()!, amount, refundCurrency.GetString()!.ToUpperInvariant(), status,
                            transferReversed, applicationFeeRefunded));
                    }
                }
                result = await _paymentService.ReconcileChargeRefundedAsync(
                    paymentIntentElement.GetString()!, intentIdElement.GetString()!, amountRefunded,
                    refunds, eventId, ct);
            }
            else if (eventType is "charge.dispute.created" or "charge.dispute.updated" or "charge.dispute.closed")
            {
                if (!stripeObject.TryGetProperty("charge", out var chargeElement) ||
                    chargeElement.ValueKind != JsonValueKind.String ||
                    !stripeObject.TryGetProperty("status", out var disputeStatusElement) ||
                    disputeStatusElement.ValueKind != JsonValueKind.String ||
                    !stripeObject.TryGetProperty("amount", out var disputeAmountElement) ||
                    !disputeAmountElement.TryGetInt64(out var disputeAmount))
                    return BadRequest(new { error = "missing_dispute_economics" });
                result = await _paymentService.ReconcileChargeDisputeAsync(
                    eventType,
                    intentIdElement.GetString()!,
                    chargeElement.GetString()!,
                    disputeStatusElement.GetString()!,
                    disputeAmount,
                    eventId,
                    ct);
            }
            else if (eventType == "account.updated")
            {
                if (!TryStripeBoolean(stripeObject, "details_submitted", out var detailsSubmitted) ||
                    !TryStripeBoolean(stripeObject, "charges_enabled", out var chargesEnabled) ||
                    !TryStripeBoolean(stripeObject, "payouts_enabled", out var payoutsEnabled))
                    return BadRequest(new { error = "missing_account_status" });
                result = await _paymentService.ReconcileConnectAccountAsync(
                    new MarketplaceStripeAccount(
                        intentIdElement.GetString()!,
                        detailsSubmitted,
                        chargesEnabled,
                        payoutsEnabled),
                    eventId,
                    ct);
            }
            else
            {
                return Ok(new { received = true, applied = false });
            }
            if (result.Succeeded) return Ok(result.Data);
            var error = result.Error!;
            return StatusCode(error.Status, new { error = error.Code, message = error.Message });
        }
        catch (JsonException)
        {
            return BadRequest(new { error = "invalid_json" });
        }
    }

    private static bool TryStripeBoolean(JsonElement value, string propertyName, out bool result)
    {
        result = false;
        if (!value.TryGetProperty(propertyName, out var property) ||
            property.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
            return false;
        result = property.GetBoolean();
        return true;
    }

    private static PromotionProduct? ResolvePromotionProduct(string? type)
    {
        var normalized = string.IsNullOrWhiteSpace(type) ? "featured" : type.Trim().ToLowerInvariant();
        return normalized switch
        {
            "bump" => new PromotionProduct("bump", 0m, "EUR", 24),
            "featured" or "featured_7d" => new PromotionProduct("featured", 4.99m, "EUR", 168),
            "top_of_category" => new PromotionProduct("top_of_category", 7.49m, "EUR", 72),
            "homepage_carousel" => new PromotionProduct("homepage_carousel", 9.99m, "EUR", 48),
            "featured_30d" => new PromotionProduct("featured", 19.99m, "EUR", 720),
            _ => null
        };
    }

    private async Task<IActionResult> OfferStatus(int id, string status, bool useCounterAmount = false)
    {
        var offer = await _marketplace.SetOfferStatusAsync(id, RequireUserId(), User.IsAdmin(), status);
        if (offer == null)
            return NotFound(new { success = false, code = "NOT_FOUND", error = "Offer not found" });

        if (useCounterAmount && offer.CounterAmount.HasValue)
        {
            offer.Amount = offer.CounterAmount;
            offer.UpdatedAt = DateTime.UtcNow;
            await _db.SaveChangesAsync();
        }

        return Ok(new { success = true, data = MapMarketplaceOffer(offer) });
    }

    private async Task<IActionResult> SellerOfferStatus(int id, string status)
    {
        var userId = RequireUserId();
        var offer = await _db.MarketplaceOffers.FirstOrDefaultAsync(o => o.Id == id);
        if (offer == null)
            return NotFound(new { success = false, code = "NOT_FOUND", error = "Offer not found" });

        if (offer.SellerUserId != userId && !User.IsAdmin())
            return StatusCode(403, new { success = false, code = "FORBIDDEN", error = "Only the seller can update this offer." });

        if (!string.Equals(offer.Status, "pending", StringComparison.OrdinalIgnoreCase)
            && !string.Equals(offer.Status, "countered", StringComparison.OrdinalIgnoreCase))
        {
            return UnprocessableEntity(new { success = false, code = "VALIDATION_ERROR", error = "Offer is no longer actionable." });
        }

        offer.Status = status;
        offer.UpdatedAt = DateTime.UtcNow;

        if (string.Equals(status, "accepted", StringComparison.OrdinalIgnoreCase))
        {
            var listing = await _db.MarketplaceListings.FirstOrDefaultAsync(l => l.Id == offer.MarketplaceListingId);
            if (listing != null)
            {
                listing.Status = "reserved";
                listing.UpdatedAt = DateTime.UtcNow;
            }

            var competingOffers = await _db.MarketplaceOffers
                .Where(o => o.MarketplaceListingId == offer.MarketplaceListingId
                    && o.Id != offer.Id
                    && (o.Status == "pending" || o.Status == "countered"))
                .ToListAsync();
            foreach (var competing in competingOffers)
            {
                competing.Status = "declined";
                competing.UpdatedAt = DateTime.UtcNow;
            }
        }

        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = MapMarketplaceOffer(offer) });
    }

    private static object MapMarketplaceOffer(MarketplaceOffer offer, MarketplaceListing? listing = null, User? buyer = null, User? seller = null) => new
    {
        id = offer.Id,
        marketplace_listing_id = offer.MarketplaceListingId,
        buyer_id = offer.BuyerUserId,
        seller_id = offer.SellerUserId,
        amount = offer.Amount,
        time_credit_amount = offer.TimeCreditAmount,
        currency = offer.Currency,
        message = offer.Message,
        status = offer.Status,
        counter_amount = offer.CounterAmount,
        counter_message = offer.CounterMessage,
        created_at = offer.CreatedAt,
        updated_at = offer.UpdatedAt,
        listing = listing == null
            ? null
            : new
            {
                id = listing.Id,
                title = listing.Title,
                price = listing.Price,
                price_currency = listing.PriceCurrency,
                status = listing.Status,
                image = listing.Images.OrderBy(i => i.SortOrder).Select(i => new
                {
                    url = i.Url,
                    thumbnail_url = i.Url
                }).FirstOrDefault()
            },
        buyer = buyer == null
            ? null
            : new
            {
                id = buyer.Id,
                name = DisplayName(buyer),
                avatar_url = buyer.AvatarUrl
            },
        seller = seller == null
            ? null
            : new
            {
                id = seller.Id,
                name = DisplayName(seller),
                avatar_url = seller.AvatarUrl
            }
    };

    private static object MapMerchantCoupon(MerchantCoupon coupon) => new
    {
        id = coupon.Id,
        seller_id = coupon.SellerUserId,
        code = coupon.Code,
        title = coupon.Title,
        description = string.IsNullOrEmpty(coupon.Description) ? null : coupon.Description,
        discount_type = coupon.DiscountType,
        discount_value = coupon.DiscountAmount,
        min_order_cents = coupon.MinOrderCents,
        max_uses = coupon.MaxUses,
        max_uses_per_member = coupon.MaxUsesPerMember <= 0 ? 1 : coupon.MaxUsesPerMember,
        valid_from = coupon.ValidFrom,
        valid_until = coupon.ExpiresAt,
        status = string.IsNullOrWhiteSpace(coupon.Status)
            ? coupon.IsActive ? "active" : "paused"
            : coupon.Status,
        applies_to = string.IsNullOrWhiteSpace(coupon.AppliesTo) ? "all_listings" : coupon.AppliesTo,
        applies_to_ids = ParseJsonArray(coupon.AppliesToIdsJson),
        usage_count = coupon.UsageCount,
        created_at = coupon.CreatedAt,
        updated_at = coupon.UpdatedAt
    };

    private static object MapShippingOption(MarketplaceShippingOption option) => new
    {
        id = option.Id,
        courier_name = option.Name,
        courier_code = (string?)null,
        price = option.Price,
        currency = option.Currency,
        estimated_days = option.EstimatedDays,
        is_default = option.IsDefault,
        is_active = option.IsActive
    };

    private static object MapSavedSearch(MarketplaceSavedSearch search) => new
    {
        id = search.Id,
        name = search.Name,
        search_query = string.IsNullOrWhiteSpace(search.Query) ? null : search.Query,
        filters = ParseJsonElementOrNull(search.FiltersJson),
        alert_frequency = search.AlertsEnabled ? "instant" : "weekly",
        alert_channel = "email",
        is_active = search.AlertsEnabled,
        last_alerted_at = (DateTime?)null,
        created_at = search.CreatedAt
    };

    private static object MapCollection(MarketplaceCollection collection, int itemCount) => new
    {
        id = collection.Id,
        name = collection.Name,
        description = collection.Description,
        is_public = collection.IsPublic,
        item_count = itemCount,
        created_at = collection.CreatedAt,
        updated_at = collection.UpdatedAt
    };

    private static object MapCollectionItem(MarketplaceCollectionItem item, MarketplaceListing? listing) => new
    {
        collection_item_id = item.Id,
        note = (string?)null,
        added_at = item.CreatedAt,
        listing = listing == null ? null : MapListing(listing)
    };

    private static object? ParseJsonElementOrNull(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;
        try
        {
            return JsonSerializer.Deserialize<JsonElement>(json);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private IQueryable<MarketplaceOrder> BuildOrderQuery()
        => _db.MarketplaceOrders
            .Include(o => o.Listing)
            .ThenInclude(l => l!.Images)
            .AsQueryable();

    private static async Task<(List<MarketplaceOrder> Orders, string? NextCursor, bool HasMore)> ApplyOrderListQueryAsync(
        IQueryable<MarketplaceOrder> query,
        string? status,
        int limit,
        string? cursor)
    {
        var take = Math.Clamp(limit, 1, 100);
        var cursorId = DecodeListingCursor(cursor);
        if (cursorId.HasValue)
        {
            query = query.Where(o => o.Id < cursorId.Value);
        }

        var statuses = status?
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(s => !string.IsNullOrWhiteSpace(s))
            .ToArray();
        if (statuses is { Length: > 0 })
        {
            query = query.Where(o => statuses.Contains(o.Status));
        }

        var orders = await query
            .OrderByDescending(o => o.Id)
            .Take(take + 1)
            .ToListAsync();
        var hasMore = orders.Count > take;
        if (hasMore)
        {
            orders.RemoveAt(orders.Count - 1);
        }

        var nextCursor = hasMore && orders.Count > 0 ? EncodeCursor(orders[^1].Id) : null;
        return (orders, nextCursor, hasMore);
    }

    private async Task<List<object>> MapMarketplaceOrdersAsync(IReadOnlyCollection<MarketplaceOrder> orders)
    {
        var userIds = orders
            .SelectMany(o => new[] { o.BuyerUserId, o.SellerUserId })
            .Distinct()
            .ToArray();
        var users = await _db.Users
            .Where(u => userIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id);

        return orders.Select(order => MapMarketplaceOrder(order, users)).ToList();
    }

    private async Task<object> MapMarketplaceOrderAsync(MarketplaceOrder order)
    {
        var mapped = await MapMarketplaceOrdersAsync(new[] { order });
        return mapped[0];
    }

    private static object MapMarketplaceOrder(MarketplaceOrder order, IReadOnlyDictionary<int, User>? users = null)
    {
        var unitPrice = order.Quantity > 0 && order.TotalAmount.HasValue
            ? order.TotalAmount.Value / order.Quantity
            : order.Listing?.Price;
        var primaryImage = order.Listing?.Images.OrderBy(i => i.SortOrder).FirstOrDefault();

        return new
    {
        id = order.Id,
        order_number = order.OrderNumber,
        listing_id = order.MarketplaceListingId,
        marketplace_listing_id = order.MarketplaceListingId,
        buyer_id = order.BuyerUserId,
        seller_id = order.SellerUserId,
        quantity = order.Quantity,
        status = order.Status,
        unit_price = unitPrice,
        total_price = order.TotalAmount,
        total_amount = order.TotalAmount,
        total_cents = order.TotalAmount.HasValue ? (int)Math.Round(order.TotalAmount.Value * 100m) : 0,
        currency = order.Currency,
        shipping_method = order.DeliveryMethod,
        shipping_cost = 0,
        delivery_method = order.DeliveryMethod,
        delivery_address = order.ShippingAddress,
        delivery_notes = (string?)null,
        shipping_address = order.ShippingAddress,
        tracking_number = order.TrackingNumber,
        tracking_url = order.TrackingUrl,
        buyer_confirmed_at = order.BuyerConfirmedAt,
        seller_confirmed_at = order.ShippedAt,
        auto_complete_at = order.AutoCompleteAt,
        shipped_at = order.ShippedAt,
        delivered_at = order.DeliveredAt,
        cancelled_at = order.CancelledAt,
        cancellation_reason = order.CancellationReason,
        escrow_released_at = order.EscrowReleasedAt,
        created_at = order.CreatedAt,
        updated_at = order.UpdatedAt,
        listing = order.Listing == null ? null : new
        {
            id = order.Listing.Id,
            title = order.Listing.Title,
            price = order.Listing.Price,
            price_currency = order.Listing.PriceCurrency,
            status = order.Listing.Status,
            delivery_method = order.Listing.DeliveryMethod,
            image = primaryImage == null ? null : new
            {
                url = primaryImage.Url,
                thumbnail_url = primaryImage.Url
            }
        },
        buyer = MapOrderUser(order.BuyerUserId, users),
        seller = MapOrderUser(order.SellerUserId, users),
        ratings = Array.Empty<object>(),
        dispute = (object?)null
    };
    }

    private static object MapOrderUser(int userId, IReadOnlyDictionary<int, User>? users)
    {
        User? user = null;
        users?.TryGetValue(userId, out user);
        var name = user == null
            ? $"User {userId}"
            : string.Join(' ', new[] { user.FirstName, user.LastName }.Where(part => !string.IsNullOrWhiteSpace(part)));

        return new
        {
            id = userId,
            name = string.IsNullOrWhiteSpace(name) ? user?.Email ?? $"User {userId}" : name,
            avatar_url = user?.AvatarUrl
        };
    }

    private static bool HasAny(JsonElement json, params string[] names) => TryGetAny(json, out _, names);

    private static bool TryGetAny(JsonElement json, out JsonElement value, params string[] names)
    {
        if (json.ValueKind == JsonValueKind.Object)
        {
            foreach (var property in json.EnumerateObject())
            {
                if (names.Any(name => string.Equals(property.Name, name, StringComparison.OrdinalIgnoreCase)))
                {
                    value = property.Value;
                    return true;
                }
            }
        }

        value = default;
        return false;
    }

    private static string? GetString(JsonElement json, params string[] names)
    {
        if (!TryGetAny(json, out var value, names) || value.ValueKind == JsonValueKind.Null)
            return null;

        return value.ValueKind == JsonValueKind.String ? value.GetString() : value.ToString();
    }

    private static decimal? GetDecimal(JsonElement json, params string[] names)
    {
        if (!TryGetAny(json, out var value, names) || value.ValueKind == JsonValueKind.Null)
            return null;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetDecimal(out var number))
            return number;
        return decimal.TryParse(value.ToString(), out var parsed) ? parsed : null;
    }

    private static int? GetInt(JsonElement json, params string[] names)
    {
        if (!TryGetAny(json, out var value, names) || value.ValueKind == JsonValueKind.Null)
            return null;
        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number))
            return number;
        return int.TryParse(value.ToString(), out var parsed) ? parsed : null;
    }

    private static DateTime? GetDateTime(JsonElement json, params string[] names)
    {
        if (!TryGetAny(json, out var value, names) || value.ValueKind == JsonValueKind.Null)
            return null;
        if (value.ValueKind == JsonValueKind.String && value.TryGetDateTime(out var date))
            return date.Kind == DateTimeKind.Unspecified ? DateTime.SpecifyKind(date, DateTimeKind.Utc) : date.ToUniversalTime();
        return DateTime.TryParse(value.ToString(), out var parsed)
            ? DateTime.SpecifyKind(parsed, parsed.Kind == DateTimeKind.Unspecified ? DateTimeKind.Utc : parsed.Kind).ToUniversalTime()
            : null;
    }

    private static string? GetJsonArray(JsonElement json, params string[] names)
    {
        if (!TryGetAny(json, out var value, names) || value.ValueKind == JsonValueKind.Null)
            return null;
        return value.ValueKind == JsonValueKind.Array ? value.GetRawText() : null;
    }

    private static object? ParseJsonArray(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return null;

        try
        {
            return JsonSerializer.Deserialize<JsonElement>(json);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string NormalizeCouponCode(string? code) => (code ?? string.Empty).Trim().ToUpperInvariant();

    private static string NormalizeDiscountType(string? type)
    {
        var normalized = (type ?? "percent").Trim().ToLowerInvariant();
        return normalized is "percent" or "fixed" or "bogo" ? normalized : "percent";
    }

    private static string NormalizeCouponStatus(string? status)
    {
        var normalized = (status ?? "draft").Trim().ToLowerInvariant();
        return normalized is "draft" or "active" or "paused" or "expired" ? normalized : "draft";
    }

    private static string NormalizeAppliesTo(string? appliesTo)
    {
        var normalized = (appliesTo ?? "all_listings").Trim().ToLowerInvariant();
        return normalized is "all_listings" or "listing_ids" or "category_ids" ? normalized : "all_listings";
    }

    private async Task<Dictionary<int, MarketplaceListing>> LoadListingsAsync(IEnumerable<int> listingIds)
    {
        var ids = listingIds.Distinct().ToArray();
        return ids.Length == 0
            ? new Dictionary<int, MarketplaceListing>()
            : await _db.MarketplaceListings
                .Include(l => l.Images)
                .Where(l => ids.Contains(l.Id))
                .ToDictionaryAsync(l => l.Id);
    }

    private async Task<Dictionary<int, User>> LoadUsersAsync(IEnumerable<int> userIds)
    {
        var ids = userIds.Distinct().ToArray();
        return ids.Length == 0
            ? new Dictionary<int, User>()
            : await _db.Users
                .Where(u => ids.Contains(u.Id))
                .ToDictionaryAsync(u => u.Id);
    }

    private static int ResolveOfferLimit(int? limit, int? perPage)
        => Math.Clamp(limit ?? perPage ?? 20, 1, 100);

    private static string EncodeCursor(int id)
        => Convert.ToBase64String(Encoding.UTF8.GetBytes(id.ToString()));

    private async Task<IActionResult> OrderStatus(
        int id,
        string status,
        string? trackingNumber = null,
        string? trackingUrl = null,
        string? shippingMethod = null)
    {
        var order = await _marketplace.SetOrderStatusAsync(
            id,
            RequireUserId(),
            User.IsAdmin(),
            status,
            trackingNumber,
            trackingUrl,
            shippingMethod);
        return order == null
            ? NotFound(new { success = false, error = "Order not found" })
            : Ok(new { success = true, data = await MapMarketplaceOrderAsync(order) });
    }

    private async Task<IActionResult> DeliveryOfferStatus(int orderId, int delivererId, string status, string message)
    {
        var offer = await _db.MarketplaceDeliveryOffers.FirstOrDefaultAsync(o => o.MarketplaceOrderId == orderId && o.DelivererUserId == delivererId);
        if (offer == null) return NotFound(new { error = "Delivery offer not found" });
        offer.Status = status;
        offer.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { data = new { message } });
    }

    private static object MapDeliveryOffer(MarketplaceDeliveryOffer offer, User? deliverer = null) => new
    {
        id = offer.Id,
        order_id = offer.MarketplaceOrderId,
        deliverer_id = offer.DelivererUserId,
        time_credits = offer.TimeCreditAmount,
        estimated_minutes = (int?)null,
        notes = (string?)null,
        status = offer.Status,
        accepted_at = (DateTime?)null,
        completed_at = (DateTime?)null,
        created_at = offer.CreatedAt,
        deliverer = deliverer == null
            ? null
            : new
            {
                id = deliverer.Id,
                name = DisplayName(deliverer),
                avatar_url = deliverer.AvatarUrl,
                is_verified = deliverer.EmailVerified || deliverer.EmailVerifiedAt != null
            }
    };

    private static object MapMarketplaceRating(MarketplaceSellerRating rating, User? rater = null) => new
    {
        id = rating.Id,
        order_id = rating.MarketplaceOrderId,
        rater_role = string.IsNullOrWhiteSpace(rating.RaterRole) ? "buyer" : rating.RaterRole,
        rating = rating.Rating,
        comment = rating.IsAnonymous ? null : rating.Comment,
        is_anonymous = rating.IsAnonymous,
        created_at = rating.CreatedAt,
        rater = rating.IsAnonymous || rater == null
            ? null
            : new
            {
                id = rater.Id,
                name = DisplayName(rater),
                avatar_url = rater.AvatarUrl
            }
    };

    private static object MapPublicSellerProfile(MarketplaceSellerProfile profile, int activeListingCount)
    {
        var displayName = string.IsNullOrWhiteSpace(profile.DisplayName)
            ? profile.User == null ? $"User {profile.UserId}" : DisplayName(profile.User)
            : profile.DisplayName;

        return new
        {
            id = profile.Id,
            user_id = profile.UserId,
            display_name = displayName,
            bio = profile.Bio,
            avatar_url = profile.User?.AvatarUrl,
            cover_image_url = (string?)null,
            location = (string?)null,
            seller_type = profile.SellerType,
            business_name = profile.SellerType == "business" ? displayName : null,
            business_verified = profile.IsVerified,
            is_verified = profile.IsVerified,
            is_community_endorsed = false,
            community_trust_score = profile.RatingAverage == 0 ? (decimal?)null : profile.RatingAverage,
            avg_rating = profile.RatingAverage == 0 ? (decimal?)null : profile.RatingAverage,
            total_ratings = profile.RatingCount,
            total_sales = profile.SalesCount,
            response_time_avg = (string?)null,
            response_rate = (decimal?)null,
            active_listings = activeListingCount,
            member_since = profile.User?.CreatedAt ?? profile.CreatedAt,
            joined_marketplace_at = profile.CreatedAt,
            marketplace_partner_badge_at = (DateTime?)null
        };
    }

    private static object MapPickupSlot(MarketplacePickupSlot slot) => new
    {
        id = slot.Id,
        seller_id = slot.UserId,
        slot_start = slot.StartsAt,
        slot_end = slot.EndsAt,
        capacity = slot.Capacity,
        booked_count = slot.BookedCount,
        remaining = Math.Max(0, slot.Capacity - slot.BookedCount),
        is_recurring = slot.IsRecurring,
        recurring_pattern = slot.RecurringPattern,
        is_active = slot.IsActive
    };

    private static object MapPickupReservation(
        MarketplacePickupReservation reservation,
        MarketplacePickupSlot? slot = null,
        MarketplaceListing? listing = null) => new
    {
        id = reservation.Id,
        slot_id = reservation.MarketplacePickupSlotId,
        order_id = reservation.MarketplaceOrderId,
        listing_id = reservation.MarketplaceListingId,
        listing_title = listing?.Title,
        qr_code = reservation.QrCode,
        status = reservation.Status,
        reserved_at = reservation.ReservedAt,
        picked_up_at = reservation.PickedUpAt,
        slot = slot == null
            ? null
            : new
            {
                slot_start = slot.StartsAt,
                slot_end = slot.EndsAt
            }
    };

    private static string GeneratePickupQrCode()
        => Guid.NewGuid().ToString("N").ToUpperInvariant();

    private static string DisplayName(User user)
    {
        var name = $"{user.FirstName} {user.LastName}".Trim();
        return string.IsNullOrWhiteSpace(name) ? user.Email : name;
    }

    private int RequireUserId()
        => User.GetUserId() ?? throw new UnauthorizedAccessException("Invalid token");

    private async Task<HashSet<int>> LoadSavedListingIdsAsync(int? userId, IEnumerable<int> listingIds)
    {
        if (!userId.HasValue)
            return new HashSet<int>();

        var ids = listingIds.Distinct().ToArray();
        if (ids.Length == 0)
            return new HashSet<int>();

        return (await _db.MarketplaceSavedListings
            .Where(s => s.UserId == userId.Value && ids.Contains(s.MarketplaceListingId))
            .Select(s => s.MarketplaceListingId)
            .ToListAsync())
            .ToHashSet();
    }

    private static object Paged(IEnumerable<object> data, int page, int limit, int total)
        => new { data, meta = new { page, limit, total, pages = (int)Math.Ceiling((double)total / limit) } };

    private static object Collection(IEnumerable<object> data, int perPage, bool hasMore, string? cursor = null)
        => cursor == null
            ? new { data, meta = new { per_page = perPage, has_more = hasMore } }
            : new { data, meta = new { per_page = perPage, has_more = hasMore, cursor } };

    private async Task<SellerProfileRequest> ReadSellerProfileRequestAsync()
    {
        if (Request.ContentLength is null or 0)
            return new SellerProfileRequest(null, null, null);

        var request = await JsonSerializer.DeserializeAsync<SellerProfileRequest>(
            Request.Body,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });

        return request ?? new SellerProfileRequest(null, null, null);
    }

    private async Task<IActionResult> UploadSellerProfileMediaAsync()
    {
        if (_fileUploadService == null)
            return StatusCode(500, new { success = false, code = "UPLOAD_UNAVAILABLE", error = "File uploads are not configured." });

        var field = Request.Form.Files.GetFile("avatar") != null
            ? "avatar"
            : Request.Form.Files.GetFile("cover_image") != null
                ? "cover_image"
                : Request.Form.Files.GetFile("file") != null
                    ? "file"
                    : null;

        var file = field == null ? null : Request.Form.Files.GetFile(field);
        if (file == null || file.Length == 0)
            return BadRequest(new { success = false, code = "VALIDATION_ERROR", error = "No file provided" });

        var userId = RequireUserId();
        var tenantId = User.GetTenantId();
        if (tenantId == null)
            return Unauthorized(new { success = false, code = "UNAUTHORIZED", error = "Invalid token" });

        var profile = await _marketplace.GetOrCreateSellerProfileAsync(userId);
        var category = field == "cover_image" ? FileCategory.Listing : FileCategory.Avatar;
        await using var stream = file.OpenReadStream();
        var (upload, error) = await _fileUploadService.UploadAsync(
            stream,
            file.FileName,
            file.ContentType,
            file.Length,
            userId,
            tenantId.Value,
            category,
            profile.Id,
            "marketplace_seller_profile");

        if (error != null)
            return BadRequest(new { success = false, code = "VALIDATION_ERROR", error });

        var savedUpload = upload!;
        var url = _fileUploadService.GetDownloadUrl(savedUpload);
        if (field == "avatar")
        {
            var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
            if (user != null)
            {
                user.AvatarUrl = url;
                user.UpdatedAt = DateTime.UtcNow;
            }
        }

        profile.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new
        {
            success = true,
            data = new
            {
                id = savedUpload.Id,
                url,
                avatar_url = field == "avatar" ? url : null,
                cover_image_url = field == "cover_image" ? url : null,
                field
            }
        });
    }

    private static int? DecodeListingCursor(string? cursor)
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

    private static string EncodeListingCursor(int id)
        => Convert.ToBase64String(Encoding.UTF8.GetBytes(id.ToString()));

    private static object MapListing(
        MarketplaceListing listing,
        bool detailed = false,
        int? currentUserId = null,
        IReadOnlySet<int>? savedListingIds = null,
        double? distanceKm = null)
    {
        var images = listing.Images
            .OrderBy(i => i.SortOrder)
            .Select(i => new
            {
                id = i.Id,
                url = i.Url,
                thumbnail_url = i.Url,
                alt_text = i.AltText,
                is_primary = i.SortOrder == 0,
                sort_order = i.SortOrder
            })
            .ToArray();
        var primaryImage = images.FirstOrDefault();
        var userName = listing.User == null
            ? $"User {listing.UserId}"
            : DisplayName(listing.User);
        var user = listing.User == null
            ? new { id = listing.UserId, name = userName, avatar_url = (string?)null, is_verified = false, member_since = (DateTime?)null }
            : new { id = listing.User.Id, name = userName, avatar_url = listing.User.AvatarUrl, is_verified = false, member_since = (DateTime?)listing.User.CreatedAt };

        return new
        {
            id = listing.Id,
            user_id = listing.UserId,
            userId = listing.UserId,
            category_id = listing.CategoryId,
            categoryId = listing.CategoryId,
            title = listing.Title,
            tagline = listing.Tagline,
            description = detailed ? listing.Description : listing.Description,
            price = listing.Price,
            price_currency = listing.PriceCurrency,
            priceCurrency = listing.PriceCurrency,
            currency = listing.PriceCurrency,
            price_type = listing.PriceType,
            priceType = listing.PriceType,
            time_credit_price = listing.TimeCreditPrice,
            timeCreditPrice = listing.TimeCreditPrice,
            condition = listing.Condition,
            quantity = listing.Quantity,
            location = listing.Location,
            latitude = listing.Latitude,
            longitude = listing.Longitude,
            distance_km = distanceKm,
            shipping_available = listing.ShippingAvailable,
            shippingAvailable = listing.ShippingAvailable,
            local_pickup = listing.LocalPickup,
            localPickup = listing.LocalPickup,
            delivery_method = listing.DeliveryMethod,
            deliveryMethod = listing.DeliveryMethod,
            seller_type = listing.SellerType,
            sellerType = listing.SellerType,
            status = listing.Status,
            marketplace_status = listing.MarketplaceStatus,
            marketplaceStatus = listing.MarketplaceStatus,
            moderation_status = listing.ModerationStatus,
            moderationStatus = listing.ModerationStatus,
            promotion_type = listing.PromotionType,
            promoted_until = listing.PromotedUntil,
            expires_at = listing.ExpiresAt,
            video_url = listing.VideoUrl,
            videoUrl = listing.VideoUrl,
            template_data = detailed ? ParseJsonObject(listing.TemplateDataJson) : null,
            views_count = listing.ViewsCount,
            viewsCount = listing.ViewsCount,
            saves_count = listing.SavesCount,
            savesCount = listing.SavesCount,
            contacts_count = listing.ContactsCount,
            contactsCount = listing.ContactsCount,
            image = primaryImage == null ? null : new { primaryImage.url, primaryImage.thumbnail_url, primaryImage.alt_text },
            image_count = images.Length,
            images,
            category = listing.Category == null ? null : new { id = listing.Category.Id, name = listing.Category.Name, slug = listing.Category.Slug, icon = listing.Category.Icon },
            user,
            seller = user,
            is_saved = savedListingIds?.Contains(listing.Id) == true,
            is_own = currentUserId.HasValue && listing.UserId == currentUserId.Value,
            is_promoted = listing.PromotedUntil.HasValue && listing.PromotedUntil.Value > DateTime.UtcNow,
            created_at = listing.CreatedAt,
            createdAt = listing.CreatedAt,
            updated_at = listing.UpdatedAt,
            updatedAt = listing.UpdatedAt,
            details = detailed ? new { listing.TemplateDataJson, listing.ModerationNotes, offers = listing.Offers.Count } : null
        };
    }

    private async Task<(IActionResult? Result, int[] MemberIds)> LoadGroupMarketplaceMemberIdsAsync(int groupId, int currentUserId)
    {
        var groupExists = await _db.Groups.AnyAsync(g => g.Id == groupId);
        if (!groupExists)
            return (NotFound(new { success = false, code = "NOT_FOUND", error = "Group not found." }), Array.Empty<int>());

        var memberIds = await _db.GroupMembers
            .Where(m => m.GroupId == groupId)
            .Select(m => m.UserId)
            .Distinct()
            .ToArrayAsync();

        if (!memberIds.Contains(currentUserId))
            return (StatusCode(StatusCodes.Status403Forbidden, new { success = false, code = "FORBIDDEN", error = "You must be a group member to view group marketplace data." }), memberIds);

        return (null, memberIds);
    }

    private static object? ParseJsonObject(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
            return null;

        try
        {
            return JsonSerializer.Deserialize<JsonElement>(json);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static object MapMarketplaceReport(MarketplaceReport report) => new
    {
        id = report.Id,
        listing_id = report.MarketplaceListingId,
        marketplace_listing_id = report.MarketplaceListingId,
        reporter_id = report.ReporterUserId,
        reporter_user_id = report.ReporterUserId,
        reason = report.Reason,
        details = report.Details,
        status = report.Status,
        created_at = report.CreatedAt
    };

    private async Task<List<ImageUploadValue>> ReadMarketplaceImageUploadsAsync()
    {
        if (Request.HasFormContentType)
        {
            var form = await Request.ReadFormAsync();
            return form.Files
                .Where(file => file.Length > 0)
                .Select(file =>
                {
                    var fileName = SafeUploadName(file.FileName, "image");
                    return new ImageUploadValue($"/uploads/marketplace/images/{fileName}", fileName);
                })
                .ToList();
        }

        try
        {
            var request = await JsonSerializer.DeserializeAsync<ImageRequest>(
                Request.Body,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            return string.IsNullOrWhiteSpace(request?.Url)
                ? new List<ImageUploadValue>()
                : new List<ImageUploadValue> { new(request.Url, request.AltText) };
        }
        catch (JsonException)
        {
            return new List<ImageUploadValue>();
        }
    }

    private async Task<string?> ReadMarketplaceVideoUploadAsync()
    {
        if (Request.HasFormContentType)
        {
            var form = await Request.ReadFormAsync();
            var file = form.Files.FirstOrDefault(f => f.Name == "video") ?? form.Files.FirstOrDefault();
            return file == null || file.Length == 0
                ? null
                : $"/uploads/marketplace/videos/{SafeUploadName(file.FileName, "video")}";
        }

        try
        {
            var request = await JsonSerializer.DeserializeAsync<VideoRequest>(
                Request.Body,
                new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            return request?.Url;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    private static string SafeUploadName(string? fileName, string fallback)
    {
        var safe = System.IO.Path.GetFileName(fileName ?? string.Empty)
            .Replace('\\', '-')
            .Replace('/', '-')
            .Trim();
        return string.IsNullOrWhiteSpace(safe) ? $"{fallback}-{Guid.NewGuid():N}" : safe;
    }

    private static object MapMarketplaceImage(MarketplaceImage image) => new
    {
        id = image.Id,
        url = image.Url,
        thumbnail_url = image.Url,
        alt_text = image.AltText,
        is_primary = image.SortOrder == 0,
        sort_order = image.SortOrder
    };

    private static double DistanceKm(double lat1, double lon1, double lat2, double lon2)
    {
        const double earth = 6371;
        var dLat = (lat2 - lat1) * Math.PI / 180;
        var dLon = (lon2 - lon1) * Math.PI / 180;
        var a = Math.Sin(dLat / 2) * Math.Sin(dLat / 2)
            + Math.Cos(lat1 * Math.PI / 180) * Math.Cos(lat2 * Math.PI / 180)
            * Math.Sin(dLon / 2) * Math.Sin(dLon / 2);
        return earth * 2 * Math.Atan2(Math.Sqrt(a), Math.Sqrt(1 - a));
    }

    private IActionResult PaymentResult(MarketplacePaymentResult result)
    {
        if (result.Succeeded) return StatusCode(result.Status, new { success = true, data = result.Data });
        var error = result.Error!;
        return StatusCode(error.Status, new
        {
            success = false,
            errors = new[] { new { code = error.Code, message = error.Message, field = error.Field } }
        });
    }
}

public record ImageRequest(string? Url, string? AltText);
public record ImageUploadValue(string Url, string? AltText);
public record ReorderImagesRequest(int[]? ImageIds);
public record VideoRequest(string? Url);
public record GenerateDescriptionRequest(string? Title, string? Keywords);
public record OfferRequest(
    decimal? Amount,
    [property: JsonPropertyName("time_credit_amount")] decimal? TimeCreditAmount,
    string? Currency,
    string? Message);
public record SellerProfileRequest(
    [property: JsonPropertyName("display_name")] string? DisplayName,
    [property: JsonPropertyName("bio")] string? Bio,
    [property: JsonPropertyName("seller_type")] string? SellerType);
public record CreateOrderRequest(
    [property: JsonPropertyName("listing_id")] int ListingId,
    int Quantity,
    [property: JsonPropertyName("delivery_method")] string? DeliveryMethod,
    [property: JsonPropertyName("shipping_method")] string? ShippingMethod,
    [property: JsonPropertyName("shipping_address")] string? ShippingAddress,
    [property: JsonPropertyName("delivery_notes")] string? DeliveryNotes,
    [property: JsonPropertyName("coupon_code")] string? CouponCode);
public record ShipOrderRequest(
    [property: JsonPropertyName("tracking_number")] string? TrackingNumber,
    [property: JsonPropertyName("tracking_url")] string? TrackingUrl,
    [property: JsonPropertyName("shipping_method")] string? ShippingMethod);
public record RateOrderRequest(int Rating, string? Comment, [property: JsonPropertyName("is_anonymous")] bool? IsAnonymous);
public record ReportRequest(
    string? Reason,
    string? Details,
    [property: JsonPropertyName("description")] string? Description,
    [property: JsonPropertyName("evidence_urls")] string[]? EvidenceUrls = null);
public sealed class PaymentRequest
{
    [JsonPropertyName("order_id")]
    public int? OrderId { get; set; }

    public decimal? Amount { get; set; }

    public string? Currency { get; set; }
}
public sealed class PaymentConfirmRequest
{
    [JsonPropertyName("payment_intent_id")]
    public string? PaymentIntentId { get; set; }
}
public record SavedSearchRequest(
    string? Name,
    string? Query,
    Dictionary<string, object>? Filters,
    [property: JsonPropertyName("alerts_enabled")] bool? AlertsEnabled);
public record CollectionRequest(string? Name, string? Description, [property: JsonPropertyName("is_public")] bool IsPublic);
public record CollectionItemRequest([property: JsonPropertyName("listing_id")] int ListingId);
public record PromotionRequest(
    [property: JsonPropertyName("product_code")] string? ProductCode,
    [property: JsonPropertyName("promotion_type")] string? PromotionType);
public sealed record PromotionProduct(string Type, decimal Price, string Currency, int DurationHours);
public sealed class DeliveryOfferRequest
{
    [JsonPropertyName("time_credits")]
    public decimal? TimeCredits { get; set; }

    public decimal TimeCreditAmount { get; set; }
}
public record AutoReplyRequest([property: JsonPropertyName("message")] string? Message, string? Question);
public record ShippingOptionRequest(
    string? Name,
    [property: JsonPropertyName("courier_name")] string? CourierName,
    decimal Price,
    string? Currency,
    string? Region,
    [property: JsonPropertyName("estimated_days")] int? EstimatedDays,
    [property: JsonPropertyName("is_default")] bool? IsDefault,
    [property: JsonPropertyName("is_active")] bool? IsActive);
public record PickupSlotRequest(
    string? Location,
    DateTime StartsAt,
    DateTime EndsAt,
    [property: JsonPropertyName("slot_start")] DateTime? SlotStart,
    [property: JsonPropertyName("slot_end")] DateTime? SlotEnd,
    int Capacity,
    [property: JsonPropertyName("is_recurring")] bool? IsRecurring,
    [property: JsonPropertyName("recurring_pattern")] string? RecurringPattern,
    [property: JsonPropertyName("is_active")] bool? IsActive);
public record PickupScanRequest(string? Code, [property: JsonPropertyName("qr_code")] string? QrCode);
public record PickupReservationRequest(int PickupSlotId, [property: JsonPropertyName("slot_id")] int? SlotId);
public record InventoryRequest(int Quantity);
public record BulkActionRequest(string? Action, int[]? Ids);
