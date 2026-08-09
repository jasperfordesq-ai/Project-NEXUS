// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;

namespace Nexus.Api.Controllers;

/// <summary>
/// Review trust controller - trust scores and pending reviews.
/// Supplements the existing ReviewsController with trust computation
/// and pending-review discovery endpoints.
/// </summary>
[ApiController]
[Authorize]
public class ReviewTrustController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly ILogger<ReviewTrustController> _logger;

    public ReviewTrustController(NexusDbContext db, ILogger<ReviewTrustController> logger)
    {
        _db = db;
        _logger = logger;
    }

    /// <summary>
    /// GET /api/reviews/pending - Get exchanges the current user has completed but not yet reviewed.
    /// </summary>
    [HttpGet("api/reviews/pending")]
    public async Task<IActionResult> GetPendingReviews()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        // Find completed exchanges where user is initiator or listing owner,
        // but has not yet left an ExchangeRating for the other party.
        var completedExchanges = await _db.Exchanges
            .Include(e => e.Listing)
            .Include(e => e.Initiator)
            .Include(e => e.ListingOwner)
            .Where(e => e.Status == ExchangeStatus.Completed
                     && (e.InitiatorId == userId.Value || e.ListingOwnerId == userId.Value))
            .ToListAsync();

        var pendingReviews = new List<object>();

        foreach (var exchange in completedExchanges)
        {
            // Determine who the "other" user is
            var otherUserId = exchange.InitiatorId == userId.Value
                ? exchange.ListingOwnerId
                : exchange.InitiatorId;

            // Check if current user has already rated this exchange
            var hasRated = await _db.ExchangeRatings
                .AnyAsync(r => r.ExchangeId == exchange.Id && r.RaterId == userId.Value);

            if (!hasRated)
            {
                var otherUser = exchange.InitiatorId == userId.Value
                    ? exchange.ListingOwner
                    : exchange.Initiator;

                pendingReviews.Add(new
                {
                    exchange_id = exchange.Id,
                    listing_id = exchange.ListingId,
                    listing_title = exchange.Listing?.Title,
                    other_user = otherUser != null ? new
                    {
                        id = otherUser.Id,
                        first_name = otherUser.FirstName,
                        last_name = otherUser.LastName
                    } : null,
                    completed_at = exchange.CompletedAt,
                    agreed_hours = exchange.AgreedHours
                });
            }
        }

        return Ok(new
        {
            data = pendingReviews,
            total = pendingReviews.Count
        });
    }

    /// <summary>
    /// GET /api/reviews/user/{userId}/trust - Get trust score for a user.
    /// Uses time-decay weighted average: newer reviews count more.
    /// Weight = 1 / (1 + daysSinceReview / 365)
    /// </summary>
    [HttpGet("api/reviews/user/{userId:int}/trust")]
    public async Task<IActionResult> GetUserTrustScore(int userId)
    {
        // Check user exists
        var userExists = await _db.Users.AnyAsync(u => u.Id == userId);
        if (!userExists)
            return NotFound(new { error = "User not found" });

        var reviews = await _db.Reviews
            .Where(r => r.TargetUserId == userId)
            .Select(r => new { r.Rating, r.CreatedAt })
            .ToListAsync();

        if (reviews.Count == 0)
        {
            return Ok(new
            {
                score = (double?)null,
                review_count = 0,
                weighted_score = (double?)null,
                oldest_review = (DateTime?)null,
                newest_review = (DateTime?)null
            });
        }

        var now = DateTime.UtcNow;
        double totalWeight = 0;
        double weightedSum = 0;

        foreach (var review in reviews)
        {
            var daysSince = (now - review.CreatedAt).TotalDays;
            var weight = 1.0 / (1.0 + daysSince / 365.0);
            weightedSum += review.Rating * weight;
            totalWeight += weight;
        }

        var weightedScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
        var simpleAverage = reviews.Average(r => (double)r.Rating);

        return Ok(new
        {
            score = Math.Round(simpleAverage, 2),
            review_count = reviews.Count,
            weighted_score = Math.Round(weightedScore, 2),
            oldest_review = reviews.Min(r => r.CreatedAt),
            newest_review = reviews.Max(r => r.CreatedAt)
        });
    }

    /// <summary>
    /// GET /api/reviews/exchange/{exchangeId}/rating - Get the rating for a specific exchange.
    /// </summary>
    [HttpGet("api/reviews/exchange/{exchangeId:int}/rating")]
    public async Task<IActionResult> GetExchangeRating(int exchangeId)
    {
        var exchange = await _db.Exchanges.FirstOrDefaultAsync(e => e.Id == exchangeId);
        if (exchange == null)
            return NotFound(new { error = "Exchange not found" });

        var ratings = await _db.ExchangeRatings
            .Include(r => r.Rater)
            .Include(r => r.RatedUser)
            .Where(r => r.ExchangeId == exchangeId)
            .Select(r => new
            {
                id = r.Id,
                rater = new
                {
                    id = r.Rater!.Id,
                    first_name = r.Rater.FirstName,
                    last_name = r.Rater.LastName
                },
                rated_user = new
                {
                    id = r.RatedUser!.Id,
                    first_name = r.RatedUser.FirstName,
                    last_name = r.RatedUser.LastName
                },
                rating = r.Rating,
                comment = r.Comment,
                would_work_again = r.WouldWorkAgain,
                created_at = r.CreatedAt
            })
            .ToListAsync();

        return Ok(new
        {
            exchange_id = exchangeId,
            data = ratings,
            total = ratings.Count
        });
    }
}
