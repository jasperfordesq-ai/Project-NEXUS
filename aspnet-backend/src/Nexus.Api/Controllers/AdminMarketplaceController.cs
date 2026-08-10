// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/admin/marketplace")]
[Route("api/v2/admin/marketplace")]
[Authorize(Policy = "AdminOnly")]
public class AdminMarketplaceController : ControllerBase
{
    private readonly MarketplaceService _marketplace;
    private readonly NexusDbContext _db;
    private readonly MarketplacePaymentService? _paymentService;

    public AdminMarketplaceController(
        MarketplaceService marketplace,
        NexusDbContext db,
        MarketplacePaymentService? paymentService = null)
    {
        _marketplace = marketplace;
        _db = db;
        _paymentService = paymentService;
    }

    [HttpGet("dashboard")]
    public async Task<IActionResult> Dashboard()
    {
        var totalListings = await _db.MarketplaceListings.CountAsync();
        var activeListings = await _db.MarketplaceListings.CountAsync(l =>
            l.Status == "active" &&
            l.ModerationStatus == "approved");
        var pendingModeration = await _db.MarketplaceListings.CountAsync(l => l.ModerationStatus == "pending");
        var totalSellers = await _db.MarketplaceSellerProfiles.CountAsync();
        var totalOrders = await _db.MarketplaceOrders.CountAsync(o => o.Status != "cancelled" && o.Status != "refunded");
        var revenue = await _db.MarketplaceOrders
            .Where(o => o.Status == "completed")
            .SumAsync(o => o.TotalAmount ?? 0m);

        return Ok(new
        {
            success = true,
            data = new
            {
                total_listings = totalListings,
                active_listings = activeListings,
                pending_moderation = pendingModeration,
                total_sellers = totalSellers,
                total_orders = totalOrders,
                revenue,
                currency = "EUR"
            }
        });
    }

    [HttpGet("listings")]
    public async Task<IActionResult> Listings(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 50,
        [FromQuery] int? per_page = null,
        [FromQuery] string? status = null,
        [FromQuery] string? moderation_status = null,
        [FromQuery] string? q = null)
    {
        page = Math.Max(1, page);
        var pageSize = Math.Clamp(per_page ?? limit, 1, 100);
        var query = _db.MarketplaceListings
            .Include(l => l.User)
            .Include(l => l.Category)
            .Include(l => l.Images)
            .AsQueryable();

        if (!string.IsNullOrWhiteSpace(status)) query = query.Where(l => l.Status == status);
        if (!string.IsNullOrWhiteSpace(moderation_status)) query = query.Where(l => l.ModerationStatus == moderation_status);
        if (!string.IsNullOrWhiteSpace(q))
        {
            var term = q.Trim().ToLower();
            query = query.Where(l => l.Title.ToLower().Contains(term) || l.Description.ToLower().Contains(term));
        }

        var total = await query.CountAsync();
        var rows = await query
            .OrderByDescending(l => l.Id)
            .Skip((page - 1) * pageSize)
            .Take(pageSize)
            .ToListAsync();

        return Ok(new
        {
            success = true,
            data = rows.Select(MapAdminListing),
            meta = new { page, per_page = pageSize, total }
        });
    }

    [HttpPost("listings/{id:int}/approve")]
    public async Task<IActionResult> ApproveListing(int id)
    {
        var listing = await _marketplace.ModerateListingAsync(id, User.GetUserId() ?? 0, "approved", null);
        return listing == null
            ? NotFound(new { success = false, code = "NOT_FOUND", error = "Listing not found." })
            : Ok(new { success = true, data = new { message = "Listing approved." } });
    }

    [HttpPost("listings/{id:int}/reject")]
    public async Task<IActionResult> RejectListing(int id, [FromBody] AdminModerationRequest request)
    {
        var listing = await _marketplace.ModerateListingAsync(id, User.GetUserId() ?? 0, "rejected", request.Notes);
        if (listing == null) return NotFound(new { success = false, code = "NOT_FOUND", error = "Listing not found." });

        listing.Status = "removed";
        listing.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = new { message = "Listing rejected." } });
    }

    [HttpDelete("listings/{id:int}")]
    public async Task<IActionResult> DeleteListing(int id)
    {
        var listing = await _db.MarketplaceListings.FirstOrDefaultAsync(l => l.Id == id);
        if (listing == null) return NotFound(new { success = false, code = "NOT_FOUND", error = "Listing not found." });

        listing.Status = "removed";
        listing.ModerationStatus = "rejected";
        listing.ModeratedByUserId = User.GetUserId();
        listing.ModeratedAt = DateTime.UtcNow;
        listing.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = new { message = "Listing removed." } });
    }

    [HttpPost("bulk-reject")]
    public async Task<IActionResult> BulkReject([FromBody] AdminBulkModerationRequest request)
    {
        var ids = (request.ListingIds ?? request.Ids ?? Array.Empty<int>())
            .Where(id => id > 0)
            .Distinct()
            .Take(100)
            .ToArray();
        var reason = (request.Reason ?? request.Notes ?? string.Empty).Trim();
        var adminUserId = User.GetUserId() ?? 0;

        var listings = await _db.MarketplaceListings
            .Where(l => ids.Contains(l.Id))
            .ToListAsync();
        var eligibleIds = listings.Select(l => l.Id).ToHashSet();
        var skippedIds = ids.Where(id => !eligibleIds.Contains(id)).ToList();

        foreach (var listing in listings)
        {
            listing.ModerationStatus = "rejected";
            listing.ModerationNotes = reason;
            listing.ModeratedByUserId = adminUserId;
            listing.ModeratedAt = DateTime.UtcNow;
            listing.Status = "removed";
            listing.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();
        return Ok(new
        {
            success = true,
            data = new
            {
                success = listings.Count,
                failed = skippedIds.Count,
                skipped_ids = skippedIds
            }
        });
    }

    [HttpGet("sellers")]
    public async Task<IActionResult> Sellers(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 50,
        [FromQuery] int? per_page = null,
        [FromQuery] string? seller_type = null,
        [FromQuery] string? verified = null,
        [FromQuery] string? search = null)
    {
        page = Math.Max(1, page);
        var pageSize = Math.Clamp(per_page ?? limit, 1, 100);
        var query = _db.MarketplaceSellerProfiles.Include(p => p.User).AsQueryable();
        if (!string.IsNullOrWhiteSpace(seller_type))
            query = query.Where(p => p.SellerType == seller_type);

        if (verified is "1" or "true")
        {
            query = query.Where(p => p.IsVerified);
        }
        else if (verified is "0" or "false")
        {
            query = query.Where(p => p.SellerType == "business" && !p.IsVerified);
        }

        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLower();
            query = query.Where(p =>
                p.DisplayName.ToLower().Contains(term) ||
                (p.User != null && (
                    p.User.Email.ToLower().Contains(term) ||
                    p.User.FirstName.ToLower().Contains(term) ||
                    p.User.LastName.ToLower().Contains(term))));
        }

        var total = await query.CountAsync();
        var rows = await query.OrderByDescending(p => p.Id).Skip((page - 1) * pageSize).Take(pageSize).ToListAsync();
        var sellerUserIds = rows.Select(p => p.UserId).ToArray();
        var activeListingCounts = await _db.MarketplaceListings
            .Where(l => sellerUserIds.Contains(l.UserId) && l.Status == "active")
            .GroupBy(l => l.UserId)
            .Select(g => new { UserId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.UserId, x => x.Count);

        return Ok(new
        {
            success = true,
            data = rows.Select(profile => MapAdminSeller(profile, activeListingCounts.GetValueOrDefault(profile.UserId))),
            meta = new { page, per_page = pageSize, total }
        });
    }

    [HttpPost("sellers/{id:int}/verify")]
    public async Task<IActionResult> VerifySeller(int id)
    {
        var profile = await _db.MarketplaceSellerProfiles.FirstOrDefaultAsync(p => p.Id == id);
        if (profile == null) return NotFound(new { success = false, code = "NOT_FOUND", error = "Seller not found." });
        if (profile.SellerType != "business")
        {
            return UnprocessableEntity(new
            {
                success = false,
                code = "VALIDATION_ERROR",
                error = "Only business sellers can be verified."
            });
        }

        profile.IsVerified = true;
        profile.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = new { message = "Seller verified." } });
    }

    [HttpPost("sellers/{id:int}/suspend")]
    public async Task<IActionResult> SuspendSeller(
        int id,
        [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] AdminModerationRequest? request = null)
    {
        var profile = await _db.MarketplaceSellerProfiles.FirstOrDefaultAsync(p => p.Id == id);
        if (profile == null) return NotFound(new { success = false, code = "NOT_FOUND", error = "Seller not found." });

        profile.IsSuspended = true;
        profile.SuspensionReason = request?.Notes;
        profile.UpdatedAt = DateTime.UtcNow;

        var activeListings = await _db.MarketplaceListings
            .Where(l => l.TenantId == profile.TenantId && l.UserId == profile.UserId && l.Status == "active")
            .ToListAsync();
        foreach (var listing in activeListings)
        {
            listing.Status = "removed";
            listing.ModerationStatus = "rejected";
            listing.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = new { message = "Seller suspended." } });
    }

    [HttpGet("reports")]
    public async Task<IActionResult> Reports([FromQuery] string? status = null, [FromQuery] int page = 1, [FromQuery(Name = "per_page")] int perPage = 20, CancellationToken ct = default)
    {
        var result = await new MarketplaceReportCaseService(_db).AdminListAsync(
            User.GetTenantId() ?? throw new UnauthorizedAccessException(), status, page, perPage, ct);
        return CaseResult(result);
    }

    [HttpPost("reports/{id:int}/acknowledge")]
    public async Task<IActionResult> AcknowledgeReport(int id, CancellationToken ct)
    {
        var result = await new MarketplaceReportCaseService(_db).AcknowledgeAsync(
            User.GetTenantId() ?? throw new UnauthorizedAccessException(),
            User.GetUserId() ?? throw new UnauthorizedAccessException(), id, ct);
        return CaseResult(result);
    }

    [HttpPut("reports/{id:int}/resolve")]
    public async Task<IActionResult> ResolveReport(int id, [FromBody] MarketplaceReportResolutionRequest request, CancellationToken ct)
    {
        var result = await new MarketplaceReportCaseService(_db).ResolveAsync(
            User.GetTenantId() ?? throw new UnauthorizedAccessException(),
            User.GetUserId() ?? throw new UnauthorizedAccessException(), id,
            request.ActionTaken, request.ResolutionReason, false, ct);
        return CaseResult(result);
    }

    [HttpPut("reports/{id:int}/resolve-appeal")]
    public async Task<IActionResult> ResolveReportAppeal(int id, [FromBody] MarketplaceReportResolutionRequest request, CancellationToken ct)
    {
        var result = await new MarketplaceReportCaseService(_db).ResolveAsync(
            User.GetTenantId() ?? throw new UnauthorizedAccessException(),
            User.GetUserId() ?? throw new UnauthorizedAccessException(), id,
            request.ActionTaken, request.ResolutionReason, true, ct);
        return CaseResult(result);
    }

    [HttpGet("disputes")]
    public async Task<IActionResult> Disputes([FromQuery] string? status = null, [FromQuery] int page = 1, [FromQuery(Name = "per_page")] int perPage = 20, CancellationToken ct = default)
    {
        var result = await new MarketplaceDisputeService(_db).AdminListAsync(
            User.GetTenantId() ?? throw new UnauthorizedAccessException(), status, page, perPage, ct);
        return DisputeResult(result);
    }

    [HttpPut("disputes/{id:long}/resolve")]
    public async Task<IActionResult> ResolveDispute(long id, [FromBody] MarketplaceDisputeResolutionRequest request, CancellationToken ct)
    {
        var result = await new MarketplaceDisputeService(_db, _paymentService).ResolveAsync(
            User.GetTenantId() ?? throw new UnauthorizedAccessException(),
            User.GetUserId() ?? throw new UnauthorizedAccessException(), id,
            request.Resolution, request.ResolutionNotes, request.RefundAmount, ct);
        return DisputeResult(result);
    }

    [HttpGet("transparency")]
    public async Task<IActionResult> Transparency()
    {
        var reports = await _db.MarketplaceReports.CountAsync();
        var resolved = await _db.MarketplaceReports.CountAsync(r => r.Status == "resolved");
        var rejected = await _db.MarketplaceListings.CountAsync(l => l.ModerationStatus == "rejected");
        return Ok(new { data = new { reports, resolved, rejected_listings = rejected } });
    }

    [HttpGet("listings/{id:int}/reports")]
    public async Task<IActionResult> ListingReports(int id)
    {
        var rows = await _db.MarketplaceReports.Where(r => r.MarketplaceListingId == id).OrderByDescending(r => r.CreatedAt).ToListAsync();
        return Ok(new { data = rows, meta = new { total = rows.Count } });
    }

    [HttpGet("coupons")]
    public async Task<IActionResult> Coupons()
    {
        var rows = await _db.MerchantCoupons
            .AsNoTracking()
            .OrderByDescending(c => c.CreatedAt)
            .ToListAsync();
        return Ok(new
        {
            success = true,
            data = new { items = rows.Select(MapMerchantCoupon) },
            meta = new { total = rows.Count }
        });
    }

    [HttpPost("coupons/{id:int}/suspend")]
    public async Task<IActionResult> SuspendCoupon(int id)
    {
        var coupon = await _db.MerchantCoupons.FirstOrDefaultAsync(c => c.Id == id);
        if (coupon == null) return NotFound(new { success = false, code = "NOT_FOUND", error = "Coupon not found." });
        coupon.IsActive = false;
        coupon.Status = "paused";
        coupon.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = MapMerchantCoupon(coupon) });
    }

    [HttpDelete("coupons/{id:int}")]
    public async Task<IActionResult> DeleteCoupon(int id)
    {
        var coupon = await _db.MerchantCoupons.FirstOrDefaultAsync(c => c.Id == id);
        if (coupon == null) return NotFound(new { success = false, code = "NOT_FOUND", error = "Coupon not found." });
        _db.MerchantCoupons.Remove(coupon);
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = new { deleted = true } });
    }

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

    private static object MapAdminSeller(MarketplaceSellerProfile profile, int activeListings)
    {
        var displayName = string.IsNullOrWhiteSpace(profile.DisplayName)
            ? profile.User == null ? string.Empty : DisplayName(profile.User)
            : profile.DisplayName;

        return new
        {
            id = profile.Id,
            user_id = profile.UserId,
            display_name = displayName,
            seller_type = profile.SellerType,
            business_name = profile.SellerType == "business" ? displayName : null,
            business_verified = profile.IsVerified,
            is_community_endorsed = false,
            total_sales = profile.SalesCount,
            avg_rating = profile.RatingAverage,
            total_ratings = profile.RatingCount,
            active_listings = activeListings,
            joined_marketplace_at = profile.CreatedAt,
            user = profile.User == null
                ? null
                : new
                {
                    id = profile.User.Id,
                    name = DisplayName(profile.User),
                    email = profile.User.Email,
                    avatar_url = profile.User.AvatarUrl
                }
        };
    }

    private static object MapAdminListing(MarketplaceListing listing)
    {
        var primaryImage = listing.Images
            .OrderBy(i => i.SortOrder)
            .ThenBy(i => i.Id)
            .FirstOrDefault();

        return new
        {
            id = listing.Id,
            title = listing.Title,
            price = listing.Price,
            price_currency = listing.PriceCurrency,
            price_type = listing.PriceType,
            status = listing.Status,
            moderation_status = listing.ModerationStatus,
            moderation_notes = listing.ModerationNotes,
            seller_type = listing.SellerType,
            views_count = listing.ViewsCount,
            image = primaryImage?.Url,
            category = listing.Category?.Name,
            user = listing.User == null
                ? null
                : new
                {
                    id = listing.User.Id,
                    name = DisplayName(listing.User)
                },
            created_at = listing.CreatedAt
        };
    }

    private static string DisplayName(User user)
    {
        var name = $"{user.FirstName} {user.LastName}".Trim();
        return string.IsNullOrWhiteSpace(name) ? user.Email : name;
    }

    private static object[] ParseJsonArray(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return Array.Empty<object>();
        try
        {
            return System.Text.Json.JsonSerializer.Deserialize<object[]>(json) ?? Array.Empty<object>();
        }
        catch
        {
            return Array.Empty<object>();
        }
    }

    private IActionResult CaseResult(MarketplaceReportCaseResult result)
    {
        if (result.Succeeded) return StatusCode(result.Status, new { success = true, data = result.Data });
        var error = result.Error!;
        return StatusCode(error.Status, new { success = false, errors = new[] { new { code = error.Code, message = error.Message, field = error.Field } } });
    }

    private IActionResult DisputeResult(MarketplaceDisputeResult result)
    {
        if (result.Succeeded) return StatusCode(result.Status, new { success = true, data = result.Data });
        var error = result.Error!;
        return StatusCode(error.Status, new { success = false, errors = new[] { new { code = error.Code, message = error.Message, field = error.Field } } });
    }
}

public record AdminModerationRequest(string? Notes);
public sealed record MarketplaceReportResolutionRequest(
    [property: JsonPropertyName("action_taken")] string? ActionTaken,
    [property: JsonPropertyName("resolution_reason")] string? ResolutionReason);
public sealed record MarketplaceDisputeResolutionRequest(
    string? Resolution,
    [property: JsonPropertyName("resolution_notes")] string? ResolutionNotes,
    [property: JsonPropertyName("refund_amount")] decimal? RefundAmount);
public record AdminBulkModerationRequest(
    int[]? Ids,
    string? Notes,
    [property: JsonPropertyName("listing_ids")] int[]? ListingIds = null,
    [property: JsonPropertyName("reason")] string? Reason = null);
