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

        // 🔴 This check is now the WHOLE rule, where it used to be belt and braces.
        // A unique index on (TenantId, ReviewerId, TargetUserId) used to back it up; it
        // was removed on 2026-08-22 because it was stricter than Laravel and rejected a
        // legitimate second review after a second exchange with the same member (see
        // ReviewConfiguration.cs and migration AddReviewTransactionLink). The consequence
        // to be honest about: two simultaneous submissions on THIS route can now both
        // pass this check and insert. Laravel has no such index either, so this matches
        // its real guarantee rather than exceeding it — but if this route ever needs a
        // hard guarantee, add a filtered unique index scoped to reviews with a NULL
        // TransactionId. Do not restore the old one.
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

    /// <summary>
    /// POST /api/reviews - Leave a review about another member, optionally attached to
    /// the transaction it is about.
    /// </summary>
    /// <remarks>
    /// 🔴 This route used to be a do-nothing stub in MiscParityController:
    ///   [HttpPost("reviews")] IActionResult CreateReviewCompat(JsonElement body)
    ///       => Ok(new { data = new { id = StableId(body), created = true } });
    /// It answered 200 with an invented id and wrote nothing. web-uk posts here
    /// (web-uk/src/lib/api.js:3602) and then redirects to ?status=review-submitted, so
    /// the member was told their review had been left and the reviews page stayed
    /// empty for ever. An ADR-0004 condition 5 failure: a success-shaped response over
    /// missing work. An honest 501 would have been better than that 200; a real
    /// implementation is better than either.
    ///
    /// Mirrors ReviewService::create (app/Services/ReviewService.php:382-494), whose
    /// checks are load-bearing rather than decorative:
    ///  - no self-review;
    ///  - receiver and transaction must exist IN THIS TENANT (Laravel scopes both
    ///    exists() rules by tenant_id; without that a member can point a review at a
    ///    foreign-tenant user);
    ///  - a review attached to a transaction must be BETWEEN the two parties of that
    ///    transaction — this is what stops review-bombing by cycling transaction ids;
    ///  - one review per reviewer per transaction (409);
    ///  - with no transaction, one review per receiver per 24 hours.
    /// </remarks>
    [HttpPost("api/reviews")]
    public async Task<IActionResult> CreateReview([FromBody] CreateMemberReviewRequest request)
    {
        var reviewerId = GetCurrentUserId();
        if (reviewerId == null)
        {
            return Unauthorized(new { error = "Invalid token" });
        }

        if (!_tenantContext.TenantId.HasValue)
        {
            return BadRequest(new { error = "Tenant context not resolved" });
        }

        var tenantId = _tenantContext.TenantId.Value;
        var receiverId = request.ReceiverId;

        if (receiverId > 0 && receiverId == reviewerId.Value)
        {
            return BadRequest(new { error = "You cannot review yourself" });
        }

        if (receiverId <= 0)
        {
            return UnprocessableEntity(new
            {
                errors = new[] { new { code = "VALIDATION_ERROR", message = "The receiver id field is required.", field = "receiver_id" } }
            });
        }

        if (request.Rating < 1 || request.Rating > 5)
        {
            return UnprocessableEntity(new
            {
                errors = new[] { new { code = "VALIDATION_ERROR", message = "The rating must be between 1 and 5.", field = "rating" } }
            });
        }

        if (request.Comment is { Length: > 2000 })
        {
            return UnprocessableEntity(new
            {
                errors = new[] { new { code = "VALIDATION_ERROR", message = "The comment may not be greater than 2000 characters.", field = "comment" } }
            });
        }

        var receiverExists = await _db.Users.AnyAsync(u => u.Id == receiverId && u.TenantId == tenantId);
        if (!receiverExists)
        {
            return UnprocessableEntity(new
            {
                errors = new[] { new { code = "VALIDATION_ERROR", message = "The selected receiver id is invalid.", field = "receiver_id" } }
            });
        }

        var transactionId = request.TransactionId is > 0 ? request.TransactionId : null;
        if (transactionId is not null)
        {
            var parties = await _db.Transactions
                .Where(t => t.Id == transactionId.Value && t.TenantId == tenantId)
                .Select(t => new { t.SenderId, t.ReceiverId })
                .FirstOrDefaultAsync();

            if (parties is null)
            {
                return UnprocessableEntity(new
                {
                    errors = new[] { new { code = "VALIDATION_ERROR", message = "The selected transaction id is invalid.", field = "transaction_id" } }
                });
            }

            var isReviewerAParty = parties.SenderId == reviewerId.Value || parties.ReceiverId == reviewerId.Value;
            var isReceiverAParty = parties.SenderId == receiverId || parties.ReceiverId == receiverId;
            if (!isReviewerAParty || !isReceiverAParty)
            {
                return BadRequest(new { error = "You can only review the other party of a transaction you took part in" });
            }

            var alreadyReviewed = await _db.Reviews
                .AnyAsync(r => r.ReviewerId == reviewerId.Value && r.TransactionId == transactionId.Value);
            if (alreadyReviewed)
            {
                return Conflict(new { error = "You have already reviewed this exchange" });
            }
        }
        else
        {
            // Laravel's spam guard for reviews with no transaction behind them. A unique
            // index cannot express a time window, so this check is the whole rule — do
            // not assume the database will catch it.
            var since = DateTime.UtcNow.AddDays(-1);
            var recentExists = await _db.Reviews
                .AnyAsync(r => r.ReviewerId == reviewerId.Value
                            && r.TargetUserId == receiverId
                            && r.TransactionId == null
                            && r.CreatedAt >= since);
            if (recentExists)
            {
                return Conflict(new { error = "You have already reviewed this member recently" });
            }
        }

        var review = new Review
        {
            TenantId = tenantId,
            ReviewerId = reviewerId.Value,
            TargetUserId = receiverId,
            TransactionId = transactionId,
            Rating = request.Rating,
            Comment = string.IsNullOrWhiteSpace(request.Comment) ? null : request.Comment.Trim(),
            CreatedAt = DateTime.UtcNow
        };

        _db.Reviews.Add(review);

        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            // A concurrent duplicate won the race past the check above; the unique index
            // is the backstop. Report the same contract as the fast path so the caller
            // sees one answer, not two.
            return Conflict(new { error = "You have already reviewed this exchange" });
        }

        try
        {
            await _gamification.AwardXpAsync(reviewerId.Value, XpLog.Amounts.ReviewLeft, XpLog.Sources.ReviewLeft, review.Id, "Left a review");
            await _gamification.CheckAndAwardBadgesAsync(reviewerId.Value, "review_left");
        }
        catch (DbUpdateException ex)
        {
            _logger.LogWarning(ex, "Failed to award XP/badges for review {ReviewId}", review.Id);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Failed to award XP/badges for review {ReviewId}", review.Id);
        }

        _logger.LogInformation(
            "User {ReviewerId} reviewed user {ReceiverId} (review {ReviewId}, transaction {TransactionId})",
            reviewerId, receiverId, review.Id, transactionId);

        return Ok(new
        {
            data = new
            {
                id = review.Id,
                rating = review.Rating,
                comment = review.Comment,
                receiver_id = review.TargetUserId,
                transaction_id = review.TransactionId,
                message = "Review submitted successfully"
            }
        });
    }

    private static bool IsUniqueViolation(DbUpdateException ex) =>
        ex.InnerException is Npgsql.PostgresException { SqlState: "23505" };


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
/// Request model for POST /api/reviews — a review ABOUT a member, optionally attached
/// to the transaction it concerns. Distinct from <see cref="CreateReviewRequest"/>,
/// which carries no subject because the subject is in that route's URL.
/// </summary>
public class CreateMemberReviewRequest
{
    [JsonPropertyName("receiver_id")]
    public int ReceiverId { get; set; }

    [JsonPropertyName("rating")]
    public int Rating { get; set; }

    [JsonPropertyName("comment")]
    public string? Comment { get; set; }

    [JsonPropertyName("transaction_id")]
    public int? TransactionId { get; set; }
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
