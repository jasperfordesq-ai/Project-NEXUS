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
/// Reviews controller - CRUD operations for reviews on users and listings.
/// Demonstrates tenant-isolated queries and reviewer-based authorization.
/// </summary>
[ApiController]
[Authorize]
public class ReviewsController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<ReviewsController> _logger;
    private readonly GamificationService _gamification;

    public ReviewsController(NexusDbContext db, TenantContext tenantContext, ILogger<ReviewsController> logger, GamificationService gamification)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
        _gamification = gamification;
    }

    /// <summary>
    /// Get reviews for a specific user.
    /// </summary>
    [HttpGet("api/users/{userId:int}/reviews")]
    public async Task<IActionResult> GetUserReviews(
        int userId,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        if (page < 1) page = 1;
        limit = Math.Clamp(limit, 1, 100);
        var skip = (page - 1) * limit;

        // Verify user exists
        var userExists = await _db.Users.AnyAsync(u => u.Id == userId);
        if (!userExists)
        {
            return NotFound(new { error = "User not found" });
        }

        var query = _db.Reviews
            .Where(r => r.TargetUserId == userId);

        var total = await query.CountAsync();

        var reviews = await query
            .OrderByDescending(r => r.CreatedAt)
            .Skip(skip)
            .Take(limit)
            .Select(r => new
            {
                id = r.Id,
                rating = r.Rating,
                comment = r.Comment,
                created_at = r.CreatedAt,
                updated_at = r.UpdatedAt,
                reviewer = r.Reviewer == null ? null : new
                {
                    id = r.Reviewer.Id,
                    first_name = r.Reviewer.FirstName,
                    last_name = r.Reviewer.LastName
                }
            })
            .ToListAsync();

        // Calculate average rating
        var avgRating = total > 0
            ? await _db.Reviews.Where(r => r.TargetUserId == userId).AverageAsync(r => (double?)r.Rating) ?? 0
            : 0;

        return Ok(new
        {
            data = reviews,
            summary = new
            {
                average_rating = Math.Round(avgRating, 2),
                total_reviews = total
            },
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
    /// Create a review for a user.
    /// </summary>
    [HttpPost("api/users/{userId:int}/reviews")]
    public async Task<IActionResult> CreateUserReview(int userId, [FromBody] CreateReviewRequest request)
    {
        var currentUserId = GetCurrentUserId();
        if (currentUserId == null)
        {
            return Unauthorized(new { error = "Invalid token" });
        }

        // Cannot review yourself
        if (currentUserId.Value == userId)
        {
            return BadRequest(new { error = "You cannot review yourself" });
        }

        // Verify target user exists
        var targetUser = await _db.Users.FirstOrDefaultAsync(u => u.Id == userId);
        if (targetUser == null)
        {
            return NotFound(new { error = "User not found" });
        }

        // Check for existing review
        var existingReview = await _db.Reviews
            .AnyAsync(r => r.ReviewerId == currentUserId.Value && r.TargetUserId == userId);
        if (existingReview)
        {
            return Conflict(new { error = "You have already reviewed this user" });
        }

        // Validate rating
        if (request.Rating < 1 || request.Rating > 5)
        {
            return BadRequest(new { error = "Rating must be between 1 and 5" });
        }

        // Validate comment length
        if (request.Comment?.Length > 2000)
        {
            return BadRequest(new { error = "Comment must be 2000 characters or less" });
        }

        if (!_tenantContext.TenantId.HasValue)
        {
            return BadRequest(new { error = "Tenant context not resolved" });
        }

        var review = new Review
        {
            TenantId = _tenantContext.TenantId.Value,
            ReviewerId = currentUserId.Value,
            TargetUserId = userId,
            Rating = request.Rating,
            Comment = request.Comment?.Trim(),
            CreatedAt = DateTime.UtcNow
        };

        _db.Reviews.Add(review);
        await _db.SaveChangesAsync();

        // Award XP for leaving a review (non-critical)
        try
        {
            await _gamification.AwardXpAsync(currentUserId.Value, XpLog.Amounts.ReviewLeft, XpLog.Sources.ReviewLeft, review.Id, $"Left review for user {targetUser.FirstName}");
            await _gamification.CheckAndAwardBadgesAsync(currentUserId.Value, "review_left");
        }
        catch (DbUpdateException ex)
        {
            _logger.LogWarning(ex, "Failed to award XP/badges for review {ReviewId}", review.Id);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Failed to award XP/badges for review {ReviewId}", review.Id);
        }

        // Load reviewer info for response
        await _db.Entry(review).Reference(r => r.Reviewer).LoadAsync();

        _logger.LogInformation("User {ReviewerId} created review {ReviewId} for user {TargetUserId}",
            currentUserId, review.Id, userId);

        return CreatedAtAction(nameof(GetReviewById), new { id = review.Id }, new
        {
            id = review.Id,
            rating = review.Rating,
            comment = review.Comment,
            target_user_id = review.TargetUserId,
            created_at = review.CreatedAt,
            reviewer = review.Reviewer == null ? null : new
            {
                id = review.Reviewer.Id,
                first_name = review.Reviewer.FirstName,
                last_name = review.Reviewer.LastName
            }
        });
    }

    /// <summary>
    /// Get reviews for a specific listing.
    /// </summary>
    [HttpGet("api/listings/{listingId:int}/reviews")]
    public async Task<IActionResult> GetListingReviews(
        int listingId,
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        if (page < 1) page = 1;
        limit = Math.Clamp(limit, 1, 100);
        var skip = (page - 1) * limit;

        // Verify listing exists
        var listingExists = await _db.Listings.AnyAsync(l => l.Id == listingId);
        if (!listingExists)
        {
            return NotFound(new { error = "Listing not found" });
        }

        var query = _db.Reviews
            .Where(r => r.TargetListingId == listingId);

        var total = await query.CountAsync();

        var reviews = await query
            .OrderByDescending(r => r.CreatedAt)
            .Skip(skip)
            .Take(limit)
            .Select(r => new
            {
                id = r.Id,
                rating = r.Rating,
                comment = r.Comment,
                created_at = r.CreatedAt,
                updated_at = r.UpdatedAt,
                reviewer = r.Reviewer == null ? null : new
                {
                    id = r.Reviewer.Id,
                    first_name = r.Reviewer.FirstName,
                    last_name = r.Reviewer.LastName
                }
            })
            .ToListAsync();

        // Calculate average rating
        var avgRating = total > 0
            ? await _db.Reviews.Where(r => r.TargetListingId == listingId).AverageAsync(r => (double?)r.Rating) ?? 0
            : 0;

        return Ok(new
        {
            data = reviews,
            summary = new
            {
                average_rating = Math.Round(avgRating, 2),
                total_reviews = total
            },
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
    /// Create a review for a listing.
    /// </summary>
    [HttpPost("api/listings/{listingId:int}/reviews")]
    public async Task<IActionResult> CreateListingReview(int listingId, [FromBody] CreateReviewRequest request)
    {
        var currentUserId = GetCurrentUserId();
        if (currentUserId == null)
        {
            return Unauthorized(new { error = "Invalid token" });
        }

        // Verify listing exists
        var listing = await _db.Listings
            .Include(l => l.User)
            .FirstOrDefaultAsync(l => l.Id == listingId);
        if (listing == null)
        {
            return NotFound(new { error = "Listing not found" });
        }

        // Cannot review your own listing
        if (listing.UserId == currentUserId.Value)
        {
            return BadRequest(new { error = "You cannot review your own listing" });
        }

        // Require a completed exchange for this listing involving the reviewer
        var hasCompletedExchange = await _db.Exchanges.AnyAsync(e =>
            e.ListingId == listingId &&
            e.Status == Nexus.Api.Entities.ExchangeStatus.Completed &&
            (e.InitiatorId == currentUserId.Value || e.ListingOwnerId == currentUserId.Value));
        if (!hasCompletedExchange)
        {
            return BadRequest(new { error = "You must have completed an exchange for this listing before leaving a review" });
        }

        // Check for existing review
        var existingReview = await _db.Reviews
            .AnyAsync(r => r.ReviewerId == currentUserId.Value && r.TargetListingId == listingId);
        if (existingReview)
        {
            return Conflict(new { error = "You have already reviewed this listing" });
        }

        // Validate rating
        if (request.Rating < 1 || request.Rating > 5)
        {
            return BadRequest(new { error = "Rating must be between 1 and 5" });
        }

        // Validate comment length
        if (request.Comment?.Length > 2000)
        {
            return BadRequest(new { error = "Comment must be 2000 characters or less" });
        }

        if (!_tenantContext.TenantId.HasValue)
        {
            return BadRequest(new { error = "Tenant context not resolved" });
        }

        var review = new Review
        {
            TenantId = _tenantContext.TenantId.Value,
            ReviewerId = currentUserId.Value,
            TargetListingId = listingId,
            Rating = request.Rating,
            Comment = request.Comment?.Trim(),
            CreatedAt = DateTime.UtcNow
        };

        _db.Reviews.Add(review);
        await _db.SaveChangesAsync();

        // Award XP for leaving a review (non-critical)
        try
        {
            await _gamification.AwardXpAsync(currentUserId.Value, XpLog.Amounts.ReviewLeft, XpLog.Sources.ReviewLeft, review.Id, $"Left review for listing: {listing.Title}");
            await _gamification.CheckAndAwardBadgesAsync(currentUserId.Value, "review_left");
        }
        catch (DbUpdateException ex)
        {
            _logger.LogWarning(ex, "Failed to award XP/badges for review {ReviewId}", review.Id);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Failed to award XP/badges for review {ReviewId}", review.Id);
        }

        // Load reviewer info for response
        await _db.Entry(review).Reference(r => r.Reviewer).LoadAsync();

        _logger.LogInformation("User {ReviewerId} created review {ReviewId} for listing {TargetListingId}",
            currentUserId, review.Id, listingId);

        return CreatedAtAction(nameof(GetReviewById), new { id = review.Id }, new
        {
            id = review.Id,
            rating = review.Rating,
            comment = review.Comment,
            target_listing_id = review.TargetListingId,
            created_at = review.CreatedAt,
            reviewer = review.Reviewer == null ? null : new
            {
                id = review.Reviewer.Id,
                first_name = review.Reviewer.FirstName,
                last_name = review.Reviewer.LastName
            }
        });
    }

    /// <summary>
    /// Get a specific review by ID.
    /// </summary>
    [HttpGet("api/reviews/{id:int}")]
    public async Task<IActionResult> GetReviewById(int id)
    {
        var review = await _db.Reviews
            .Include(r => r.Reviewer)
            .Include(r => r.TargetUser)
            .Include(r => r.TargetListing)
            .FirstOrDefaultAsync(r => r.Id == id);

        if (review == null)
        {
            return NotFound(new { error = "Review not found" });
        }

        return Ok(new
        {
            id = review.Id,
            rating = review.Rating,
            comment = review.Comment,
            created_at = review.CreatedAt,
            updated_at = review.UpdatedAt,
            reviewer = review.Reviewer == null ? null : new
            {
                id = review.Reviewer.Id,
                first_name = review.Reviewer.FirstName,
                last_name = review.Reviewer.LastName
            },
            target_user = review.TargetUser != null ? new
            {
                id = review.TargetUser.Id,
                first_name = review.TargetUser.FirstName,
                last_name = review.TargetUser.LastName
            } : null,
            target_listing = review.TargetListing != null ? new
            {
                id = review.TargetListing.Id,
                title = review.TargetListing.Title
            } : null
        });
    }

    /// <summary>
    /// Update a review. Only the reviewer can update.
    /// </summary>
    [HttpPut("api/reviews/{id:int}")]
    public async Task<IActionResult> UpdateReview(int id, [FromBody] UpdateReviewRequest request)
    {
        var currentUserId = GetCurrentUserId();
        if (currentUserId == null)
        {
            return Unauthorized(new { error = "Invalid token" });
        }

        var review = await _db.Reviews
            .Include(r => r.Reviewer)
            .Include(r => r.TargetUser)
            .Include(r => r.TargetListing)
            .FirstOrDefaultAsync(r => r.Id == id);

        if (review == null)
        {
            return NotFound(new { error = "Review not found" });
        }

        // Check ownership
        if (review.ReviewerId != currentUserId.Value)
        {
            return StatusCode(403, new { error = "You can only update your own reviews" });
        }

        // Validate rating if provided
        if (request.Rating.HasValue)
        {
            if (request.Rating.Value < 1 || request.Rating.Value > 5)
            {
                return BadRequest(new { error = "Rating must be between 1 and 5" });
            }
            review.Rating = request.Rating.Value;
        }

        // Validate comment if provided
        if (request.Comment != null)
        {
            if (request.Comment.Length > 2000)
            {
                return BadRequest(new { error = "Comment must be 2000 characters or less" });
            }
            review.Comment = request.Comment.Trim();
        }

        review.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} updated review {ReviewId}", currentUserId, id);

        return Ok(new
        {
            id = review.Id,
            rating = review.Rating,
            comment = review.Comment,
            created_at = review.CreatedAt,
            updated_at = review.UpdatedAt,
            reviewer = review.Reviewer == null ? null : new
            {
                id = review.Reviewer.Id,
                first_name = review.Reviewer.FirstName,
                last_name = review.Reviewer.LastName
            },
            target_user = review.TargetUser != null ? new
            {
                id = review.TargetUser.Id,
                first_name = review.TargetUser.FirstName,
                last_name = review.TargetUser.LastName
            } : null,
            target_listing = review.TargetListing != null ? new
            {
                id = review.TargetListing.Id,
                title = review.TargetListing.Title
            } : null
        });
    }

    /// <summary>
    /// Delete a review. Only the reviewer can delete.
    /// </summary>
    [HttpDelete("api/reviews/{id:int}")]
    public async Task<IActionResult> DeleteReview(int id)
    {
        var currentUserId = GetCurrentUserId();
        if (currentUserId == null)
        {
            return Unauthorized(new { error = "Invalid token" });
        }

        var review = await _db.Reviews.FirstOrDefaultAsync(r => r.Id == id);

        if (review == null)
        {
            return NotFound(new { error = "Review not found" });
        }

        // Check ownership
        if (review.ReviewerId != currentUserId.Value)
        {
            return StatusCode(403, new { error = "You can only delete your own reviews" });
        }

        _db.Reviews.Remove(review);
        await _db.SaveChangesAsync();

        _logger.LogInformation("User {UserId} deleted review {ReviewId}", currentUserId, id);

        return NoContent();
    }

    private int? GetCurrentUserId() => User.GetUserId();
}

/// <summary>
/// Request model for creating a new review.
/// </summary>
public class CreateReviewRequest
{
    [JsonPropertyName("rating")]
    public int Rating { get; set; }

    [JsonPropertyName("comment")]
    public string? Comment { get; set; }
}

/// <summary>
/// Request model for updating a review.
/// </summary>
public class UpdateReviewRequest
{
    [JsonPropertyName("rating")]
    public int? Rating { get; set; }

    [JsonPropertyName("comment")]
    public string? Comment { get; set; }
}
