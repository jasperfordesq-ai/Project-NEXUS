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
    /// GET /api/reviews/pending - completed transactions the current user has taken part
    /// in and not yet reviewed.
    /// </summary>
    /// <remarks>
    /// 🔴 Two faults fixed here on 2026-08-22, and the first is the instructive one.
    ///
    /// The rows OMITTED receiver_id. web-uk builds the review form from this response
    /// (normalizePendingReview, web-uk/src/routes/reviews.js:180-188) and puts
    /// receiver_id into a hidden field; with the field missing, the form rendered with
    /// an EMPTY recipient and posted receiver_id=0. The endpoint answered 200, every
    /// field it did send was correct, and the page rendered without an error — the
    /// journey was broken by a field that was not there. Nothing that checks status
    /// codes, and nothing that diffs the fields two backends have in common, can see an
    /// absence like that. Only filling in the rendered form and reading the effect can.
    ///
    /// Second, the SOURCE was wrong. This read completed Exchanges and unreviewed
    /// ExchangeRatings; Laravel reads completed TRANSACTIONS and unreviewed reviews
    /// (ReviewService::getPendingReviews, app/Services/ReviewService.php:210-304).
    /// Those are different populations: an exchange that never settled has no
    /// transaction, and a credit transfer between two members that was never an
    /// exchange still earns a review. Laravel's rules, reproduced:
    ///   - completed transactions only, excluding system credit grants, which have no
    ///     peer to review;
    ///   - both legs present and not the same person;
    ///   - the viewer is a party AND has not hidden the row from their own wallet;
    ///   - the viewer has not already reviewed that transaction;
    ///   - the counterparty must still be an active account and have a displayable
    ///     name — otherwise the row is dropped rather than shown as a blank prompt.
    /// </remarks>
    [HttpGet("api/reviews/pending")]
    public async Task<IActionResult> GetPendingReviews([FromQuery] int limit = 20, [FromQuery(Name = "transaction_id")] int? transactionId = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var me = userId.Value;
        limit = Math.Clamp(limit, 1, 100);

        // System credit grants (starting balances, admin grants, community fund) have no
        // peer to review.
        var systemTypes = new[] { "starting_balance", "admin_grant", "community_fund" };

        var query = _db.Transactions
            .AsNoTracking()
            .Where(t => t.Status == TransactionStatus.Completed)
            .Where(t => !systemTypes.Contains(t.TransactionType))
            .Where(t => t.SenderId != null && t.ReceiverId != null && t.SenderId != t.ReceiverId)
            .Where(t => (t.SenderId == me && !t.DeletedForSender)
                     || (t.ReceiverId == me && !t.DeletedForReceiver))
            .Where(t => !_db.Reviews.Any(r => r.TransactionId == t.Id && r.ReviewerId == me));

        if (transactionId is > 0)
        {
            query = query.Where(t => t.Id == transactionId.Value);
        }

        var rows = await query
            .OrderByDescending(t => t.Id)
            .Take(limit)
            .Select(t => new
            {
                t.Id,
                t.SenderId,
                t.ReceiverId,
                t.Description,
                t.CreatedAt,
                t.UpdatedAt
            })
            .ToListAsync();

        if (rows.Count == 0)
        {
            return Ok(new { data = Array.Empty<object>(), meta = new { total = 0 } });
        }

        var counterpartyIds = rows
            .Select(r => r.SenderId == me ? r.ReceiverId : r.SenderId)
            .Where(id => id != null)
            .Select(id => id!.Value)
            .Distinct()
            .ToList();

        var counterparties = await _db.Users
            .AsNoTracking()
            .Where(u => counterpartyIds.Contains(u.Id))
            // Laravel drops counterparties whose users.status is banned or suspended.
            // This schema has no status string; the same state is IsActive plus
            // SuspendedAt (AdminController.cs:88 maps exactly that pair to "active").
            .Where(u => u.IsActive && u.SuspendedAt == null)
            .Select(u => new
            {
                u.Id,
                u.FirstName,
                u.LastName,
                u.AvatarUrl
            })
            .ToDictionaryAsync(u => u.Id);

        var items = new List<object>();
        foreach (var row in rows)
        {
            var counterpartyId = row.SenderId == me ? row.ReceiverId : row.SenderId;
            if (counterpartyId is null || !counterparties.TryGetValue(counterpartyId.Value, out var peer))
            {
                continue; // counterparty missing / suspended / closed — nothing to review
            }

            // Laravel prefers an organisation's registered name over a person name here.
            // This schema keeps organization_name in the JSON profile bag
            // (UsersController.cs:269) rather than a users column, so an organisation
            // counterparty falls back to its contact person's name. That is a recorded
            // difference, not an oversight — promoting it to a column is its own change.
            var name = $"{peer.FirstName} {peer.LastName}".Trim();
            if (string.IsNullOrWhiteSpace(name))
            {
                continue; // no displayable name — skip rather than show a blank prompt
            }

            var description = (row.Description ?? string.Empty).Trim();

            items.Add(new
            {
                exchange_id = row.Id,
                exchange_title = description.Length > 0 ? description : null,
                // 🔴 web-uk's hidden form field. Leave this out and the review form
                // renders with no recipient and posts receiver_id=0.
                receiver_id = counterpartyId.Value,
                receiver_name = name,
                receiver_avatar = peer.AvatarUrl,
                transaction_id = row.Id,
                completed_at = row.UpdatedAt ?? row.CreatedAt
            });
        }

        // 🔴 Laravel sends meta{base_url, total} on this endpoint — the count belongs in
        // META, not at the root. Verified live 2026-08-18. base_url is filled in by
        // LaravelDataEnvelopeFilter, which preserves an existing meta rather than
        // replacing it.
        return Ok(new
        {
            data = items,
            meta = new { total = items.Count }
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
