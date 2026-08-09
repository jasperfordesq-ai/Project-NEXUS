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
/// Exchange workflow controller - the core of timebanking.
/// Manages the full lifecycle: request → accept → in-progress → complete → rate.
/// </summary>
[ApiController]
[Route("api/exchanges")]
[Authorize]
public class ExchangesController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly ExchangeService _exchangeService;
    private readonly ILogger<ExchangesController> _logger;

    public ExchangesController(NexusDbContext db, ExchangeService exchangeService, ILogger<ExchangesController> logger)
    {
        _db = db;
        _exchangeService = exchangeService;
        _logger = logger;
    }

    /// <summary>
    /// List exchanges for the current user.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> ListExchanges(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        [FromQuery] string? status = null,
        [FromQuery] string? role = null) // "initiator", "owner", or null for all
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (page < 1) page = 1;
        limit = Math.Clamp(limit, 1, 100);

        var query = _db.Exchanges
            .Where(e => e.InitiatorId == userId.Value || e.ListingOwnerId == userId.Value);

        // Filter by role
        if (!string.IsNullOrEmpty(role))
        {
            query = role.ToLowerInvariant() switch
            {
                "initiator" => query.Where(e => e.InitiatorId == userId.Value),
                "owner" => query.Where(e => e.ListingOwnerId == userId.Value),
                _ => query
            };
        }

        // Filter by status
        if (!string.IsNullOrEmpty(status) && Enum.TryParse<ExchangeStatus>(status, true, out var parsedStatus))
        {
            query = query.Where(e => e.Status == parsedStatus);
        }

        var total = await query.CountAsync();

        var exchanges = (await query
            .OrderByDescending(e => e.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .Include(e => e.Listing)
            .Include(e => e.Initiator)
            .Include(e => e.ListingOwner)
            .Include(e => e.Ratings)
            .ToListAsync())
            .Select(e => MapExchangeResponse(e, userId.Value))
            .ToList();

        return Ok(new
        {
            data = exchanges,
            pagination = new { page, limit, total, pages = (int)Math.Ceiling((double)total / limit) }
        });
    }

    /// <summary>
    /// Get a single exchange by ID.
    /// </summary>
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetExchange(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var exchange = await _db.Exchanges
            .Include(e => e.Listing)
            .Include(e => e.Initiator)
            .Include(e => e.ListingOwner)
            .Include(e => e.Provider)
            .Include(e => e.Receiver)
            .Include(e => e.Transaction)
            .Include(e => e.Ratings)
            .FirstOrDefaultAsync(e => e.Id == id);

        if (exchange == null)
            return NotFound(new { error = "Exchange not found" });

        // Only participants can view
        if (exchange.InitiatorId != userId.Value && exchange.ListingOwnerId != userId.Value)
            return NotFound(new { error = "Exchange not found" });

        return Ok(MapExchangeDetailResponse(exchange, userId.Value));
    }

    /// <summary>
    /// Request a new exchange on a listing.
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> CreateExchange([FromBody] CreateExchangeRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (exchange, error) = await _exchangeService.CreateExchangeAsync(
            userId.Value, request.ListingId, request.AgreedHours, request.Message, request.ScheduledAt, request.GroupId);

        if (error != null)
            return BadRequest(new { error });

        return CreatedAtAction(nameof(GetExchange), new { id = exchange!.Id }, new
        {
            id = exchange.Id,
            listing_id = exchange.ListingId,
            status = exchange.Status.ToString().ToLowerInvariant(),
            agreed_hours = exchange.AgreedHours,
            message = exchange.RequestMessage,
            scheduled_at = exchange.ScheduledAt,
            created_at = exchange.CreatedAt
        });
    }

    /// <summary>
    /// Accept an exchange request.
    /// </summary>
    [HttpPut("{id:int}/accept")]
    public async Task<IActionResult> AcceptExchange(int id, [FromBody] AcceptExchangeRequest? request = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (exchange, error) = await _exchangeService.AcceptExchangeAsync(id, userId.Value, request?.AdjustedHours);

        if (error != null)
            return BadRequest(new { error });

        return Ok(new { id = exchange!.Id, status = exchange.Status.ToString().ToLowerInvariant(), agreed_hours = exchange.AgreedHours });
    }

    /// <summary>
    /// Decline an exchange request.
    /// </summary>
    [HttpPut("{id:int}/decline")]
    public async Task<IActionResult> DeclineExchange(int id, [FromBody] DeclineExchangeRequest? request = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (exchange, error) = await _exchangeService.DeclineExchangeAsync(id, userId.Value, request?.Reason);

        if (error != null)
            return BadRequest(new { error });

        return Ok(new { id = exchange!.Id, status = exchange.Status.ToString().ToLowerInvariant() });
    }

    /// <summary>
    /// Start an exchange (move to in-progress).
    /// </summary>
    [HttpPut("{id:int}/start")]
    public async Task<IActionResult> StartExchange(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (exchange, error) = await _exchangeService.StartExchangeAsync(id, userId.Value);

        if (error != null)
            return BadRequest(new { error });

        return Ok(new { id = exchange!.Id, status = exchange.Status.ToString().ToLowerInvariant(), started_at = exchange.StartedAt });
    }

    /// <summary>
    /// Complete an exchange and transfer credits.
    /// </summary>
    [HttpPut("{id:int}/complete")]
    public async Task<IActionResult> CompleteExchange(int id, [FromBody] CompleteExchangeRequest? request = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (exchange, error) = await _exchangeService.CompleteExchangeAsync(id, userId.Value, request?.ActualHours);

        if (error != null)
            return BadRequest(new { error });

        return Ok(new
        {
            id = exchange!.Id,
            status = exchange.Status.ToString().ToLowerInvariant(),
            actual_hours = exchange.ActualHours,
            completed_at = exchange.CompletedAt,
            transaction_id = exchange.TransactionId
        });
    }

    /// <summary>
    /// Cancel an exchange.
    /// </summary>
    [HttpPut("{id:int}/cancel")]
    public async Task<IActionResult> CancelExchange(int id, [FromBody] CancelExchangeRequest? request = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (exchange, error) = await _exchangeService.CancelExchangeAsync(id, userId.Value, request?.Reason);

        if (error != null)
            return BadRequest(new { error });

        return Ok(new { id = exchange!.Id, status = exchange.Status.ToString().ToLowerInvariant() });
    }

    /// <summary>
    /// Dispute a completed exchange.
    /// </summary>
    [HttpPut("{id:int}/dispute")]
    public async Task<IActionResult> DisputeExchange(int id, [FromBody] DisputeExchangeRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (exchange, error) = await _exchangeService.DisputeExchangeAsync(id, userId.Value, request.Reason);

        if (error != null)
            return BadRequest(new { error });

        return Ok(new { id = exchange!.Id, status = exchange.Status.ToString().ToLowerInvariant() });
    }

    /// <summary>
    /// Rate the other participant in an exchange.
    /// </summary>
    [HttpPost("{id:int}/rate")]
    public async Task<IActionResult> RateExchange(int id, [FromBody] RateExchangeRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (rating, error) = await _exchangeService.RateExchangeAsync(
            id, userId.Value, request.Rating, request.Comment, request.WouldWorkAgain);

        if (error != null)
            return BadRequest(new { error });

        return CreatedAtAction(nameof(GetExchange), new { id }, new
        {
            id = rating!.Id,
            exchange_id = rating.ExchangeId,
            rating = rating.Rating,
            comment = rating.Comment,
            would_work_again = rating.WouldWorkAgain,
            created_at = rating.CreatedAt
        });
    }

    /// <summary>
    /// Get exchanges for a specific listing.
    /// </summary>
    [HttpGet("by-listing/{listingId:int}")]
    public async Task<IActionResult> GetExchangesByListing(int listingId)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var listing = await _db.Listings.FirstOrDefaultAsync(l => l.Id == listingId);
        if (listing == null)
            return NotFound(new { error = "Listing not found" });

        // Only the listing owner or exchange participants can see exchanges
        var query = _db.Exchanges
            .Where(e => e.ListingId == listingId
                && (e.InitiatorId == userId.Value || e.ListingOwnerId == userId.Value));

        var exchanges = (await query
            .OrderByDescending(e => e.CreatedAt)
            .Include(e => e.Initiator)
            .Include(e => e.ListingOwner)
            .Include(e => e.Ratings)
            .ToListAsync())
            .Select(e => MapExchangeResponse(e, userId.Value))
            .ToList();

        return Ok(new { data = exchanges });
    }

    // === Response mapping ===

    private static object MapExchangeResponse(Exchange e, int currentUserId) => new
    {
        id = e.Id,
        listing_id = e.ListingId,
        listing_title = e.Listing != null ? e.Listing.Title : null,
        status = e.Status.ToString().ToLowerInvariant(),
        role = e.InitiatorId == currentUserId ? "initiator" : "owner",
        agreed_hours = e.AgreedHours,
        actual_hours = e.ActualHours,
        initiator = e.Initiator != null ? new { id = e.Initiator.Id, first_name = e.Initiator.FirstName, last_name = e.Initiator.LastName } : null,
        listing_owner = e.ListingOwner != null ? new { id = e.ListingOwner.Id, first_name = e.ListingOwner.FirstName, last_name = e.ListingOwner.LastName } : null,
        scheduled_at = e.ScheduledAt,
        completed_at = e.CompletedAt,
        has_rated = e.Ratings.Any(r => r.RaterId == currentUserId),
        rating_count = e.Ratings.Count,
        created_at = e.CreatedAt
    };

    private static object MapExchangeDetailResponse(Exchange e, int currentUserId) => new
    {
        id = e.Id,
        listing_id = e.ListingId,
        listing = e.Listing != null ? new { id = e.Listing.Id, title = e.Listing.Title, type = e.Listing.Type.ToString().ToLowerInvariant() } : null,
        status = e.Status.ToString().ToLowerInvariant(),
        role = e.InitiatorId == currentUserId ? "initiator" : "owner",
        agreed_hours = e.AgreedHours,
        actual_hours = e.ActualHours,
        request_message = e.RequestMessage,
        decline_reason = e.DeclineReason,
        notes = e.Notes,
        initiator = e.Initiator != null ? new { id = e.Initiator.Id, first_name = e.Initiator.FirstName, last_name = e.Initiator.LastName } : null,
        listing_owner = e.ListingOwner != null ? new { id = e.ListingOwner.Id, first_name = e.ListingOwner.FirstName, last_name = e.ListingOwner.LastName } : null,
        provider = e.Provider != null ? new { id = e.Provider.Id, first_name = e.Provider.FirstName, last_name = e.Provider.LastName } : null,
        receiver = e.Receiver != null ? new { id = e.Receiver.Id, first_name = e.Receiver.FirstName, last_name = e.Receiver.LastName } : null,
        transaction_id = e.TransactionId,
        group_id = e.GroupId,
        scheduled_at = e.ScheduledAt,
        started_at = e.StartedAt,
        completed_at = e.CompletedAt,
        cancelled_at = e.CancelledAt,
        ratings = e.Ratings.Select(r => new
        {
            id = r.Id,
            rater_id = r.RaterId,
            rated_user_id = r.RatedUserId,
            rating = r.Rating,
            comment = r.Comment,
            would_work_again = r.WouldWorkAgain,
            created_at = r.CreatedAt
        }),
        has_rated = e.Ratings.Any(r => r.RaterId == currentUserId),
        created_at = e.CreatedAt,
        updated_at = e.UpdatedAt
    };
}

// === Request DTOs ===

public class CreateExchangeRequest
{
    [JsonPropertyName("listing_id")]
    public int ListingId { get; set; }

    [JsonPropertyName("agreed_hours")]
    public decimal? AgreedHours { get; set; }

    [JsonPropertyName("message")]
    public string? Message { get; set; }

    [JsonPropertyName("scheduled_at")]
    public DateTime? ScheduledAt { get; set; }

    [JsonPropertyName("group_id")]
    public int? GroupId { get; set; }
}

public class AcceptExchangeRequest
{
    [JsonPropertyName("adjusted_hours")]
    public decimal? AdjustedHours { get; set; }
}

public class DeclineExchangeRequest
{
    [JsonPropertyName("reason")]
    public string? Reason { get; set; }
}

public class CompleteExchangeRequest
{
    [JsonPropertyName("actual_hours")]
    public decimal? ActualHours { get; set; }
}

public class CancelExchangeRequest
{
    [JsonPropertyName("reason")]
    public string? Reason { get; set; }
}

public class DisputeExchangeRequest
{
    [JsonPropertyName("reason")]
    public string Reason { get; set; } = string.Empty;
}

public class RateExchangeRequest
{
    [JsonPropertyName("rating")]
    public int Rating { get; set; }

    [JsonPropertyName("comment")]
    public string? Comment { get; set; }

    [JsonPropertyName("would_work_again")]
    public bool? WouldWorkAgain { get; set; }
}
