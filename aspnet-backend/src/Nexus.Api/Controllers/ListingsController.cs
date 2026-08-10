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
/// Listings controller - CRUD operations for marketplace listings.
/// Demonstrates tenant-isolated queries and owner-based authorization.
/// </summary>
[ApiController]
[Route("api/listings")]
[Authorize]
public class ListingsController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<ListingsController> _logger;
    private readonly GamificationService _gamification;

    public ListingsController(NexusDbContext db, TenantContext tenantContext, ILogger<ListingsController> logger, GamificationService gamification)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
        _gamification = gamification;
    }

    /// <summary>
    /// List listings in the current tenant with pagination.
    /// Optional filters: type (offer/request), status (active/fulfilled/etc.)
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        [FromQuery] string? type = null,
        [FromQuery] string? status = null)
    {
        if (page < 1) page = 1;
        limit = Math.Clamp(limit, 1, 100);
        var skip = (page - 1) * limit;

        // Build query with optional filters
        var query = _db.Listings.AsQueryable();

        // Filter by type if specified
        if (!string.IsNullOrEmpty(type) && Enum.TryParse<ListingType>(type, true, out var listingType))
        {
            query = query.Where(l => l.Type == listingType);
        }

        // Filter by status if specified (default: show only Active)
        if (!string.IsNullOrEmpty(status) && Enum.TryParse<ListingStatus>(status, true, out var listingStatus))
        {
            query = query.Where(l => l.Status == listingStatus);
        }

        // Get total count for pagination
        var total = await query.CountAsync();

        // Get paginated results with user info
        var listings = await query
            .AsNoTracking()
            .OrderByDescending(l => l.CreatedAt)
            .Skip(skip)
            .Take(limit)
            .Select(l => new
            {
                id = l.Id,
                title = l.Title,
                description = l.Description,
                type = l.Type.ToString().ToLower(),
                status = l.Status.ToString().ToLower(),
                location = l.Location,
                estimated_hours = l.EstimatedHours,
                is_featured = l.IsFeatured,
                view_count = l.ViewCount,
                expires_at = l.ExpiresAt,
                created_at = l.CreatedAt,
                updated_at = l.UpdatedAt,
                image_file_id = _db.FileUploads
                    .Where(f => f.EntityType == "listing" && f.EntityId == l.Id && f.Category == FileCategory.Listing)
                    .OrderByDescending(f => f.CreatedAt)
                    .Select(f => (int?)f.Id)
                    .FirstOrDefault(),
                user = l.User != null
                    ? new
                    {
                        id = l.User.Id,
                        first_name = l.User.FirstName,
                        last_name = l.User.LastName,
                        name = (l.User.FirstName + " " + l.User.LastName).Trim(),
                        avatar_url = l.User.AvatarUrl
                    }
                    : null
            })
            .ToListAsync();

        _logger.LogDebug("Listed {Count} listings for tenant {TenantId}", listings.Count, _tenantContext.TenantId);

        return Ok(new
        {
            data = listings.Select(l => new
            {
                l.id,
                l.title,
                l.description,
                l.type,
                l.status,
                l.location,
                l.estimated_hours,
                image_url = BuildFileDownloadUrl(l.image_file_id),
                l.is_featured,
                l.view_count,
                l.expires_at,
                l.created_at,
                l.updated_at,
                l.user
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
    /// Get a specific listing by ID.
    /// Returns 404 if listing doesn't exist or belongs to different tenant.
    /// </summary>
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id)
    {
        var listing = await _db.Listings
            .AsNoTracking()
            .Where(l => l.Id == id)
            .Select(l => new
            {
                id = l.Id,
                title = l.Title,
                description = l.Description,
                type = l.Type.ToString().ToLower(),
                status = l.Status.ToString().ToLower(),
                category_id = l.CategoryId,
                location = l.Location,
                estimated_hours = l.EstimatedHours,
                is_featured = l.IsFeatured,
                view_count = l.ViewCount,
                expires_at = l.ExpiresAt,
                created_at = l.CreatedAt,
                updated_at = l.UpdatedAt,
                image_file_id = _db.FileUploads
                    .Where(f => f.EntityType == "listing" && f.EntityId == l.Id && f.Category == FileCategory.Listing)
                    .OrderByDescending(f => f.CreatedAt)
                    .Select(f => (int?)f.Id)
                    .FirstOrDefault(),
                user = l.User != null
                    ? new
                    {
                        id = l.User.Id,
                        first_name = l.User.FirstName,
                        last_name = l.User.LastName,
                        name = (l.User.FirstName + " " + l.User.LastName).Trim(),
                        avatar_url = l.User.AvatarUrl
                    }
                    : null
            })
            .FirstOrDefaultAsync();

        if (listing == null)
        {
            return NotFound(new { error = "Listing not found" });
        }

        return Ok(new
        {
            listing.id,
            listing.title,
            listing.description,
            listing.type,
            listing.status,
            listing.category_id,
            listing.location,
            listing.estimated_hours,
            image_url = BuildFileDownloadUrl(listing.image_file_id),
            listing.is_featured,
            listing.view_count,
            listing.expires_at,
            listing.created_at,
            listing.updated_at,
            listing.user
        });
    }

    /// <summary>
    /// Create a new listing.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateListingRequest request)
    {
        // Validate title
        if (string.IsNullOrWhiteSpace(request.Title))
        {
            return BadRequest(new { error = "Title is required" });
        }
        if (request.Title.Length > 255)
        {
            return BadRequest(new { error = "Title must be 255 characters or less" });
        }

        // Validate type
        if (!Enum.TryParse<ListingType>(request.Type, true, out var listingType))
        {
            return BadRequest(new { error = "Type must be 'offer' or 'request'" });
        }

        // Validate status if provided
        var status = ListingStatus.Active; // default
        if (!string.IsNullOrEmpty(request.Status))
        {
            if (!Enum.TryParse<ListingStatus>(request.Status, true, out status))
            {
                return BadRequest(new { error = "Status must be 'draft' or 'active'" });
            }
            if (status != ListingStatus.Draft && status != ListingStatus.Active)
            {
                return BadRequest(new { error = "Status must be 'draft' or 'active'" });
            }
        }

        var userId = GetCurrentUserId();
        if (userId == null)
        {
            return Unauthorized(new { error = "Invalid token" });
        }

        if (!_tenantContext.TenantId.HasValue)
        {
            return BadRequest(new { error = "Tenant context not resolved" });
        }

        // Validate category exists in this tenant if provided
        if (request.CategoryId.HasValue)
        {
            var categoryExists = await _db.Categories.AnyAsync(c => c.Id == request.CategoryId.Value);
            if (!categoryExists)
            {
                return BadRequest(new { error = "Category not found" });
            }
        }

        // Validate estimated hours bounds
        if (request.EstimatedHours.HasValue && (request.EstimatedHours.Value <= 0 || request.EstimatedHours.Value > 1000))
        {
            return BadRequest(new { error = "Estimated hours must be between 0 and 1000" });
        }

        // Validate expiration date is in the future
        if (request.ExpiresAt.HasValue && request.ExpiresAt.Value <= DateTime.UtcNow)
        {
            return BadRequest(new { error = "Expiration date must be in the future" });
        }

        var listing = new Listing
        {
            TenantId = _tenantContext.TenantId.Value,
            UserId = userId.Value,
            Title = request.Title.Trim(),
            Description = request.Description?.Trim(),
            Type = listingType,
            Status = status,
            CategoryId = request.CategoryId,
            Location = request.Location?.Trim(),
            EstimatedHours = request.EstimatedHours,
            ExpiresAt = request.ExpiresAt,
            CreatedAt = DateTime.UtcNow
        };

        _db.Listings.Add(listing);
        await _db.SaveChangesAsync();

        // Award XP and check badges for creating a listing (non-critical)
        try
        {
            await _gamification.AwardXpAsync(userId.Value, XpLog.Amounts.ListingCreated, XpLog.Sources.ListingCreated, listing.Id, $"Created listing: {listing.Title}");
            await _gamification.CheckAndAwardBadgesAsync(userId.Value, "listing_created");
        }
        catch (DbUpdateException ex)
        {
            _logger.LogWarning(ex, "Failed to award XP/badges for listing {ListingId}", listing.Id);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Failed to award XP/badges for listing {ListingId}", listing.Id);
        }

        // Reload with user info for response
        await _db.Entry(listing).Reference(l => l.User).LoadAsync();

        _logger.LogInformation("Created listing {ListingId} for user {UserId} in tenant {TenantId}",
            listing.Id, userId, _tenantContext.TenantId);

        return CreatedAtAction(nameof(GetById), new { id = listing.Id }, new
        {
            id = listing.Id,
            title = listing.Title,
            description = listing.Description,
            type = listing.Type.ToString().ToLowerInvariant(),
            status = listing.Status.ToString().ToLowerInvariant(),
            category_id = listing.CategoryId,
            location = listing.Location,
            estimated_hours = listing.EstimatedHours,
            is_featured = listing.IsFeatured,
            view_count = listing.ViewCount,
            expires_at = listing.ExpiresAt,
            created_at = listing.CreatedAt,
            updated_at = listing.UpdatedAt,
            user = new
            {
                id = listing.User!.Id,
                first_name = listing.User.FirstName,
                last_name = listing.User.LastName,
                name = (listing.User.FirstName + " " + listing.User.LastName).Trim(),
                avatar_url = listing.User.AvatarUrl
            }
        });
    }

    /// <summary>
    /// Update an existing listing. Only the owner can update.
    /// </summary>
    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] UpdateListingRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null)
        {
            return Unauthorized(new { error = "Invalid token" });
        }

        var listing = await _db.Listings
            .Include(l => l.User)
            .FirstOrDefaultAsync(l => l.Id == id);

        if (listing == null)
        {
            return NotFound(new { error = "Listing not found" });
        }

        // Check ownership
        if (listing.UserId != userId.Value)
        {
            return StatusCode(403, new { error = "You can only update your own listings" });
        }

        // Validate title if provided
        if (request.Title != null)
        {
            if (string.IsNullOrWhiteSpace(request.Title))
            {
                return BadRequest(new { error = "Title cannot be empty" });
            }
            if (request.Title.Length > 255)
            {
                return BadRequest(new { error = "Title must be 255 characters or less" });
            }
            listing.Title = request.Title.Trim();
        }

        // Validate type if provided
        if (request.Type != null)
        {
            if (!Enum.TryParse<ListingType>(request.Type, true, out var listingType))
            {
                return BadRequest(new { error = "Type must be 'offer' or 'request'" });
            }
            listing.Type = listingType;
        }

        // Validate status if provided
        if (request.Status != null)
        {
            if (!Enum.TryParse<ListingStatus>(request.Status, true, out var status))
            {
                return BadRequest(new { error = "Invalid status" });
            }
            listing.Status = status;
        }

        // Update optional fields
        if (request.Description != null)
        {
            listing.Description = request.Description.Trim();
        }
        if (request.CategoryId.HasValue)
        {
            var categoryExists = await _db.Categories.AnyAsync(c => c.Id == request.CategoryId.Value);
            if (!categoryExists)
            {
                return BadRequest(new { error = "Category not found" });
            }
            listing.CategoryId = request.CategoryId;
        }
        if (request.Location != null)
        {
            listing.Location = request.Location.Trim();
        }
        if (request.EstimatedHours.HasValue)
        {
            if (request.EstimatedHours.Value <= 0 || request.EstimatedHours.Value > 1000)
            {
                return BadRequest(new { error = "Estimated hours must be between 0 and 1000" });
            }
            listing.EstimatedHours = request.EstimatedHours;
        }
        if (request.ExpiresAt.HasValue)
        {
            if (request.ExpiresAt.Value <= DateTime.UtcNow)
            {
                return BadRequest(new { error = "Expiration date must be in the future" });
            }
            listing.ExpiresAt = request.ExpiresAt;
        }

        listing.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Updated listing {ListingId} by user {UserId}", id, userId);

        return Ok(new
        {
            id = listing.Id,
            title = listing.Title,
            description = listing.Description,
            type = listing.Type.ToString().ToLowerInvariant(),
            status = listing.Status.ToString().ToLowerInvariant(),
            category_id = listing.CategoryId,
            location = listing.Location,
            estimated_hours = listing.EstimatedHours,
            is_featured = listing.IsFeatured,
            view_count = listing.ViewCount,
            expires_at = listing.ExpiresAt,
            created_at = listing.CreatedAt,
            updated_at = listing.UpdatedAt,
            user = new
            {
                id = listing.User!.Id,
                first_name = listing.User.FirstName,
                last_name = listing.User.LastName,
                name = (listing.User.FirstName + " " + listing.User.LastName).Trim(),
                avatar_url = listing.User.AvatarUrl
            }
        });
    }

    /// <summary>
    /// Delete a listing (soft delete). Only the owner can delete.
    /// </summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null)
        {
            return Unauthorized(new { error = "Invalid token" });
        }

        var listing = await _db.Listings.FirstOrDefaultAsync(l => l.Id == id);

        if (listing == null)
        {
            return NotFound(new { error = "Listing not found" });
        }

        // Check ownership
        if (listing.UserId != userId.Value)
        {
            return StatusCode(403, new { error = "You can only delete your own listings" });
        }

        // Soft delete
        listing.DeletedAt = DateTime.UtcNow;
        listing.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Soft-deleted listing {ListingId} by user {UserId}", id, userId);

        return NoContent();
    }

    private int? GetCurrentUserId() => User.GetUserId();

    private static string? BuildFileDownloadUrl(int? fileId)
    {
        return fileId.HasValue ? $"/api/files/{fileId.Value}/download" : null;
    }
}

/// <summary>
/// Request model for creating a new listing.
/// </summary>
public class CreateListingRequest
{
    [JsonPropertyName("title")]
    public string Title { get; set; } = string.Empty;

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("type")]
    public string Type { get; set; } = "offer";

    [JsonPropertyName("status")]
    public string? Status { get; set; }

    [JsonPropertyName("category_id")]
    public int? CategoryId { get; set; }

    [JsonPropertyName("location")]
    public string? Location { get; set; }

    [JsonPropertyName("estimated_hours")]
    public decimal? EstimatedHours { get; set; }

    [JsonPropertyName("expires_at")]
    public DateTime? ExpiresAt { get; set; }
}

/// <summary>
/// Request model for updating a listing.
/// </summary>
public class UpdateListingRequest
{
    [JsonPropertyName("title")]
    public string? Title { get; set; }

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("type")]
    public string? Type { get; set; }

    [JsonPropertyName("status")]
    public string? Status { get; set; }

    [JsonPropertyName("category_id")]
    public int? CategoryId { get; set; }

    [JsonPropertyName("location")]
    public string? Location { get; set; }

    [JsonPropertyName("estimated_hours")]
    public decimal? EstimatedHours { get; set; }

    [JsonPropertyName("expires_at")]
    public DateTime? ExpiresAt { get; set; }
}
