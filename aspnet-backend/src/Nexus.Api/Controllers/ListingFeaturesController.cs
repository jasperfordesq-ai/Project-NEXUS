// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Expanded listing features: analytics, favorites, tags, featured, expiring, renew.
/// Phase 20: Expanded Listings.
/// </summary>
[ApiController]
[Route("api/listings")]
[Authorize]
public class ListingFeaturesController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ListingFeatureService _listingFeatures;
    private readonly ILogger<ListingFeaturesController> _logger;

    public ListingFeaturesController(
        NexusDbContext db,
        TenantContext tenantContext,
        ListingFeatureService listingFeatures,
        ILogger<ListingFeaturesController> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _listingFeatures = listingFeatures;
        _logger = logger;
    }

    /// <summary>
    /// POST /api/listings/{id}/view - Track a view on a listing.
    /// </summary>
    [HttpPost("{id:int}/view")]
    public async Task<IActionResult> TrackView(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var listing = await _db.Listings.FirstOrDefaultAsync(l => l.Id == id && l.DeletedAt == null);
        if (listing == null)
        {
            return NotFound(new { error = "Listing not found." });
        }

        await _listingFeatures.TrackListingViewAsync(id, userId.Value);

        return Ok(new { message = "View tracked." });
    }

    /// <summary>
    /// GET /api/listings/{id}/analytics - Get analytics for a listing (owner only).
    /// </summary>
    [HttpGet("{id:int}/analytics")]
    public async Task<IActionResult> GetAnalytics(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var listing = await _db.Listings.FirstOrDefaultAsync(l => l.Id == id && l.DeletedAt == null);
        if (listing == null)
        {
            return NotFound(new { error = "Listing not found." });
        }

        if (listing.UserId != userId.Value)
        {
            return Forbid();
        }

        var analytics = await _listingFeatures.GetListingAnalyticsAsync(id);

        if (analytics == null)
        {
            return Ok(new
            {
                listing_id = id,
                view_count = 0,
                unique_view_count = 0,
                contact_count = 0,
                favorite_count = 0,
                share_count = 0,
                last_viewed_at = (DateTime?)null
            });
        }

        return Ok(new
        {
            listing_id = analytics.ListingId,
            view_count = analytics.ViewCount,
            unique_view_count = analytics.UniqueViewCount,
            contact_count = analytics.ContactCount,
            favorite_count = analytics.FavoriteCount,
            share_count = analytics.ShareCount,
            last_viewed_at = analytics.LastViewedAt
        });
    }

    /// <summary>
    /// POST /api/listings/{id}/favorite - Favorite a listing.
    /// </summary>
    [HttpPost("{id:int}/favorite")]
    public async Task<IActionResult> Favorite(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var listing = await _db.Listings.FirstOrDefaultAsync(l => l.Id == id && l.DeletedAt == null);
        if (listing == null)
        {
            return NotFound(new { error = "Listing not found." });
        }

        var added = await _listingFeatures.FavoriteListingAsync(id, userId.Value);

        if (!added)
        {
            return Ok(new { message = "Already favorited." });
        }

        return CreatedAtAction(nameof(GetFavorites), null, new { message = "Listing favorited." });
    }

    /// <summary>
    /// DELETE /api/listings/{id}/favorite - Unfavorite a listing.
    /// </summary>
    [HttpDelete("{id:int}/favorite")]
    public async Task<IActionResult> Unfavorite(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var removed = await _listingFeatures.UnfavoriteListingAsync(id, userId.Value);

        if (!removed)
        {
            return NotFound(new { error = "Listing not in favorites." });
        }

        return Ok(new { message = "Listing unfavorited." });
    }

    /// <summary>
    /// GET /api/listings/favorites - Get my favorited listings.
    /// </summary>
    [HttpGet("favorites")]
    public async Task<IActionResult> GetFavorites([FromQuery] int page = 1, [FromQuery] int limit = 20)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (page < 1) page = 1;
        if (limit < 1 || limit > 100) limit = 20;

        var (favorites, total) = await _listingFeatures.GetUserFavoritesAsync(userId.Value, page, limit);

        return Ok(new
        {
            data = favorites.Select(f => new
            {
                id = f.Id,
                listing = f.Listing == null ? null : new
                {
                    id = f.Listing.Id,
                    title = f.Listing.Title,
                    description = f.Listing.Description,
                    type = f.Listing.Type.ToString().ToLowerInvariant(),
                    status = f.Listing.Status.ToString().ToLowerInvariant(),
                    location = f.Listing.Location,
                    estimated_hours = f.Listing.EstimatedHours,
                    expires_at = f.Listing.ExpiresAt,
                    user = f.Listing.User == null ? null : new
                    {
                        id = f.Listing.User.Id,
                        first_name = f.Listing.User.FirstName,
                        last_name = f.Listing.User.LastName
                    },
                    category = f.Listing.Category == null ? null : new
                    {
                        id = f.Listing.Category.Id,
                        name = f.Listing.Category.Name
                    }
                },
                favorited_at = f.CreatedAt
            }),
            pagination = new
            {
                page,
                limit,
                total,
                pages = (int)Math.Ceiling((double)total / limit)
            }
        });
    }

    /// <summary>
    /// POST /api/listings/{id}/tags - Add a tag to a listing.
    /// </summary>
    [HttpPost("{id:int}/tags")]
    public async Task<IActionResult> AddTag(int id, [FromBody] AddTagRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var listing = await _db.Listings.FirstOrDefaultAsync(l => l.Id == id && l.DeletedAt == null);
        if (listing == null)
        {
            return NotFound(new { error = "Listing not found." });
        }

        if (listing.UserId != userId.Value)
        {
            return Forbid();
        }

        if (string.IsNullOrWhiteSpace(request.Tag))
        {
            return BadRequest(new { error = "Tag is required." });
        }

        var tagType = request.TagType?.Trim().ToLowerInvariant() ?? "skill";
        if (tagType != "skill" && tagType != "risk")
        {
            return BadRequest(new { error = "Tag type must be 'skill' or 'risk'." });
        }

        var tag = await _listingFeatures.AddListingTagAsync(id, request.Tag, tagType);

        if (tag == null)
        {
            return Ok(new { message = "Tag already exists on this listing." });
        }

        return CreatedAtAction(nameof(GetFavorites), null, new
        {
            id = tag.Id,
            listing_id = tag.ListingId,
            tag = tag.Tag,
            tag_type = tag.TagType,
            created_at = tag.CreatedAt
        });
    }

    /// <summary>
    /// DELETE /api/listings/{id}/tags/{tag} - Remove a tag from a listing.
    /// </summary>
    [HttpDelete("{id:int}/tags/{tag}")]
    public async Task<IActionResult> RemoveTag(int id, string tag)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var listing = await _db.Listings.FirstOrDefaultAsync(l => l.Id == id && l.DeletedAt == null);
        if (listing == null)
        {
            return NotFound(new { error = "Listing not found." });
        }

        if (listing.UserId != userId.Value)
        {
            return Forbid();
        }

        var removed = await _listingFeatures.RemoveListingTagAsync(id, tag);

        if (!removed)
        {
            return NotFound(new { error = "Tag not found on this listing." });
        }

        return Ok(new { message = "Tag removed." });
    }

    /// <summary>
    /// GET /api/listings/featured - Get featured listings.
    /// </summary>
    [HttpGet("featured")]
    public async Task<IActionResult> GetFeatured([FromQuery] int limit = 10)
    {
        if (limit < 1 || limit > 50) limit = 10;

        var listings = await _listingFeatures.GetFeaturedListingsAsync(limit);

        return Ok(new
        {
            data = listings.Select(l => new
            {
                id = l.Id,
                title = l.Title,
                description = l.Description,
                type = l.Type.ToString().ToLowerInvariant(),
                status = l.Status.ToString().ToLowerInvariant(),
                location = l.Location,
                estimated_hours = l.EstimatedHours,
                is_featured = l.IsFeatured,
                view_count = l.ViewCount,
                expires_at = l.ExpiresAt,
                user = l.User == null ? null : new
                {
                    id = l.User.Id,
                    first_name = l.User.FirstName,
                    last_name = l.User.LastName
                },
                category = l.Category == null ? null : new
                {
                    id = l.Category.Id,
                    name = l.Category.Name
                },
                created_at = l.CreatedAt
            })
        });
    }

    /// <summary>
    /// GET /api/listings/expiring - Get listings about to expire.
    /// </summary>
    [HttpGet("expiring")]
    public async Task<IActionResult> GetExpiring([FromQuery] int days = 7)
    {
        if (days < 1 || days > 90) days = 7;

        var listings = await _listingFeatures.GetExpiringListingsAsync(days);

        return Ok(new
        {
            data = listings.Select(l => new
            {
                id = l.Id,
                title = l.Title,
                description = l.Description,
                type = l.Type.ToString().ToLowerInvariant(),
                status = l.Status.ToString().ToLowerInvariant(),
                location = l.Location,
                estimated_hours = l.EstimatedHours,
                expires_at = l.ExpiresAt,
                days_until_expiry = l.ExpiresAt.HasValue
                    ? (int)Math.Ceiling((l.ExpiresAt.Value - DateTime.UtcNow).TotalDays)
                    : (int?)null,
                user = l.User == null ? null : new
                {
                    id = l.User.Id,
                    first_name = l.User.FirstName,
                    last_name = l.User.LastName
                },
                category = l.Category == null ? null : new
                {
                    id = l.Category.Id,
                    name = l.Category.Name
                },
                created_at = l.CreatedAt
            })
        });
    }

    /// <summary>
    /// PUT /api/listings/{id}/renew - Renew a listing.
    /// </summary>
    [HttpPut("{id:int}/renew")]
    public async Task<IActionResult> Renew(int id, [FromBody] RenewListingRequest? request = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var daysToAdd = request?.DaysToAdd ?? 30;
        if (daysToAdd < 1 || daysToAdd > 365)
        {
            return BadRequest(new { error = "Days to add must be between 1 and 365." });
        }

        var listing = await _listingFeatures.RenewListingAsync(id, userId.Value, daysToAdd);

        if (listing == null)
        {
            return NotFound(new { error = "Listing not found or you are not the owner." });
        }

        return Ok(new
        {
            id = listing.Id,
            title = listing.Title,
            status = listing.Status.ToString().ToLowerInvariant(),
            expires_at = listing.ExpiresAt,
            message = "Listing renewed successfully."
        });
    }

    private int? GetCurrentUserId() => User.GetUserId();
}

/// <summary>
/// Request model for adding a tag to a listing.
/// </summary>
public class AddTagRequest
{
    [JsonPropertyName("tag")]
    public string Tag { get; set; } = string.Empty;

    [JsonPropertyName("tag_type")]
    public string? TagType { get; set; } = "skill";
}

/// <summary>
/// Request model for renewing a listing.
/// </summary>
public class RenewListingRequest
{
    [JsonPropertyName("days_to_add")]
    public int DaysToAdd { get; set; } = 30;
}
