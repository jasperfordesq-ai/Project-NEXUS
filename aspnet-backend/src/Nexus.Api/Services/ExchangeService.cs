// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Observability;

namespace Nexus.Api.Services;

/// <summary>
/// Manages the exchange workflow lifecycle.
/// Handles state transitions, credit transfers, and ratings.
/// </summary>
public class ExchangeService
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly GamificationService _gamification;
    private readonly ILogger<ExchangeService> _logger;
    private readonly IConfiguration _configuration;

    // Valid state transitions: from -> allowed destinations
    private static readonly Dictionary<ExchangeStatus, ExchangeStatus[]> ValidTransitions = new()
    {
        [ExchangeStatus.Requested] = new[] { ExchangeStatus.Accepted, ExchangeStatus.Declined, ExchangeStatus.Cancelled, ExchangeStatus.Expired },
        [ExchangeStatus.Accepted] = new[] { ExchangeStatus.InProgress, ExchangeStatus.Cancelled },
        [ExchangeStatus.InProgress] = new[] { ExchangeStatus.Completed, ExchangeStatus.Cancelled, ExchangeStatus.Disputed },
        [ExchangeStatus.Completed] = new[] { ExchangeStatus.Disputed },
        [ExchangeStatus.Disputed] = new[] { ExchangeStatus.Resolved },
        [ExchangeStatus.Declined] = Array.Empty<ExchangeStatus>(),
        [ExchangeStatus.Cancelled] = Array.Empty<ExchangeStatus>(),
        [ExchangeStatus.Resolved] = Array.Empty<ExchangeStatus>(),
        [ExchangeStatus.Expired] = Array.Empty<ExchangeStatus>(),
    };

    public ExchangeService(NexusDbContext db, TenantContext tenantContext, GamificationService gamification, ILogger<ExchangeService> logger, IConfiguration configuration)
    {
        _db = db;
        _tenantContext = tenantContext;
        _gamification = gamification;
        _logger = logger;
        _configuration = configuration;
    }

    /// <summary>
    /// Create a new exchange request on a listing.
    /// </summary>
    public async Task<(Exchange? Exchange, string? Error)> CreateExchangeAsync(
        int initiatorId, int listingId, decimal? agreedHours, string? message, DateTime? scheduledAt, int? groupId)
    {
        var listing = await _db.Listings
            .FirstOrDefaultAsync(l => l.Id == listingId && l.Status == ListingStatus.Active);

        if (listing == null)
            return (null, "Listing not found or not active");

        if (listing.UserId == initiatorId)
            return (null, "Cannot request an exchange on your own listing");

        // Check for existing active exchange between these users on this listing
        var existingExchange = await _db.Exchanges
            .AnyAsync(e => e.ListingId == listingId
                && e.InitiatorId == initiatorId
                && e.Status != ExchangeStatus.Declined
                && e.Status != ExchangeStatus.Cancelled
                && e.Status != ExchangeStatus.Expired
                && e.Status != ExchangeStatus.Completed
                && e.Status != ExchangeStatus.Resolved);

        if (existingExchange)
            return (null, "You already have an active exchange request on this listing");

        // Determine provider and receiver based on listing type
        int? providerId = null;
        int? receiverId = null;

        if (listing.Type == ListingType.Offer)
        {
            // Listing owner offers a service, initiator receives it
            providerId = listing.UserId;
            receiverId = initiatorId;
        }
        else
        {
            // Listing owner requests a service, initiator provides it
            providerId = initiatorId;
            receiverId = listing.UserId;
        }

        // Configurable hour limits (defaults match V1)
        var minHours = _configuration.GetValue("ExchangeLimits:MinHours", 0.25m);
        var maxHours = _configuration.GetValue("ExchangeLimits:MaxHours", 24.0m);
        var hours = agreedHours ?? listing.EstimatedHours ?? 1.0m;
        if (hours < minHours)
            return (null, $"Minimum exchange duration is {minHours} hours");
        if (hours > maxHours)
            return (null, $"Maximum exchange duration is {maxHours} hours");

        var exchange = new Exchange
        {
            ListingId = listingId,
            InitiatorId = initiatorId,
            ListingOwnerId = listing.UserId,
            ProviderId = providerId,
            ReceiverId = receiverId,
            AgreedHours = hours,
            RequestMessage = message?.Trim(),
            ScheduledAt = scheduledAt,
            GroupId = groupId,
            Status = ExchangeStatus.Requested,
            CreatedAt = DateTime.UtcNow
        };

        _db.Exchanges.Add(exchange);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Exchange {ExchangeId} created: user {InitiatorId} → listing {ListingId}",
            exchange.Id, initiatorId, listingId);

        return (exchange, null);
    }

    /// <summary>
    /// Accept an exchange request. Only the listing owner can accept.
    /// </summary>
    public async Task<(Exchange? Exchange, string? Error)> AcceptExchangeAsync(
        int exchangeId, int userId, decimal? adjustedHours)
    {
        var exchange = await GetExchangeWithValidation(exchangeId, userId);
        if (exchange == null)
            return (null, "Exchange not found");

        if (exchange.ListingOwnerId != userId)
            return (null, "Only the listing owner can accept this exchange");

        var transitionError = ValidateTransition(exchange, ExchangeStatus.Accepted);
        if (transitionError != null)
            return (null, transitionError);

        exchange.Status = ExchangeStatus.Accepted;
        if (adjustedHours.HasValue && adjustedHours.Value > 0)
            exchange.AgreedHours = adjustedHours.Value;
        exchange.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Exchange {ExchangeId} accepted by user {UserId}", exchangeId, userId);
        return (exchange, null);
    }

    /// <summary>
    /// Decline an exchange request. Only the listing owner can decline.
    /// </summary>
    public async Task<(Exchange? Exchange, string? Error)> DeclineExchangeAsync(
        int exchangeId, int userId, string? reason)
    {
        var exchange = await GetExchangeWithValidation(exchangeId, userId);
        if (exchange == null)
            return (null, "Exchange not found");

        if (exchange.ListingOwnerId != userId)
            return (null, "Only the listing owner can decline this exchange");

        var transitionError = ValidateTransition(exchange, ExchangeStatus.Declined);
        if (transitionError != null)
            return (null, transitionError);

        exchange.Status = ExchangeStatus.Declined;
        exchange.DeclineReason = reason?.Trim();
        exchange.CancelledAt = DateTime.UtcNow;
        exchange.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Exchange {ExchangeId} declined by user {UserId}", exchangeId, userId);
        return (exchange, null);
    }

    /// <summary>
    /// Start the exchange (move to InProgress). Either party can start.
    /// </summary>
    public async Task<(Exchange? Exchange, string? Error)> StartExchangeAsync(int exchangeId, int userId)
    {
        var exchange = await GetExchangeWithValidation(exchangeId, userId);
        if (exchange == null)
            return (null, "Exchange not found");

        if (!IsParticipant(exchange, userId))
            return (null, "You are not a participant in this exchange");

        var transitionError = ValidateTransition(exchange, ExchangeStatus.InProgress);
        if (transitionError != null)
            return (null, transitionError);

        exchange.Status = ExchangeStatus.InProgress;
        exchange.StartedAt = DateTime.UtcNow;
        exchange.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Exchange {ExchangeId} started by user {UserId}", exchangeId, userId);
        return (exchange, null);
    }

    /// <summary>
    /// Fail closed until the canonical two-party hours-confirmation state and
    /// exactly-once settlement evidence are represented in this model.
    /// </summary>
    public async Task<(Exchange? Exchange, string? Error)> CompleteExchangeAsync(
        int exchangeId, int userId, decimal? actualHours)
    {
        var exchange = await GetExchangeWithValidation(exchangeId, userId);
        if (exchange == null)
            return (null, "Exchange not found");

        if (!IsParticipant(exchange, userId))
            return (null, "You are not a participant in this exchange");

        _logger.LogWarning(
            "Blocked one-party completion for exchange {ExchangeId} by user {UserId}: two-party confirmation evidence is unavailable",
            exchangeId,
            userId);
        return (null,
            "Exchange completion requires matching confirmation from both participants and is not available on this endpoint.");
    }

    /// <summary>
    /// Cancel an exchange. Either party can cancel before completion.
    /// </summary>
    public async Task<(Exchange? Exchange, string? Error)> CancelExchangeAsync(
        int exchangeId, int userId, string? reason)
    {
        var exchange = await GetExchangeWithValidation(exchangeId, userId);
        if (exchange == null)
            return (null, "Exchange not found");

        if (!IsParticipant(exchange, userId))
            return (null, "You are not a participant in this exchange");

        var transitionError = ValidateTransition(exchange, ExchangeStatus.Cancelled);
        if (transitionError != null)
            return (null, transitionError);

        exchange.Status = ExchangeStatus.Cancelled;
        exchange.DeclineReason = reason?.Trim();
        exchange.CancelledAt = DateTime.UtcNow;
        exchange.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogInformation("Exchange {ExchangeId} cancelled by user {UserId}", exchangeId, userId);
        return (exchange, null);
    }

    /// <summary>
    /// Dispute a completed exchange.
    /// </summary>
    public async Task<(Exchange? Exchange, string? Error)> DisputeExchangeAsync(
        int exchangeId, int userId, string reason)
    {
        var exchange = await GetExchangeWithValidation(exchangeId, userId);
        if (exchange == null)
            return (null, "Exchange not found");

        if (!IsParticipant(exchange, userId))
            return (null, "You are not a participant in this exchange");

        if (string.IsNullOrWhiteSpace(reason))
            return (null, "A reason is required for disputes");

        var transitionError = ValidateTransition(exchange, ExchangeStatus.Disputed);
        if (transitionError != null)
            return (null, transitionError);

        exchange.Status = ExchangeStatus.Disputed;
        exchange.Notes = $"Disputed by user {userId}: {reason.Trim()}";
        exchange.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync();

        _logger.LogWarning("Exchange {ExchangeId} disputed by user {UserId}: {Reason}",
            exchangeId, userId, reason);
        return (exchange, null);
    }

    /// <summary>
    /// Rate the other participant after exchange completion.
    /// </summary>
    public async Task<(ExchangeRating? Rating, string? Error)> RateExchangeAsync(
        int exchangeId, int raterId, int rating, string? comment, bool? wouldWorkAgain)
    {
        var exchange = await _db.Exchanges
            .Include(e => e.Ratings)
            .FirstOrDefaultAsync(e => e.Id == exchangeId);

        if (exchange == null)
            return (null, "Exchange not found");

        if (!IsParticipant(exchange, raterId))
            return (null, "You are not a participant in this exchange");

        if (exchange.Status != ExchangeStatus.Completed && exchange.Status != ExchangeStatus.Resolved)
            return (null, "Can only rate completed exchanges");

        if (rating < 1 || rating > 5)
            return (null, "Rating must be between 1 and 5");

        // Check if already rated
        if (exchange.Ratings.Any(r => r.RaterId == raterId))
            return (null, "You have already rated this exchange");

        // Determine who is being rated
        var ratedUserId = GetOtherParticipant(exchange, raterId);
        if (ratedUserId == null)
            return (null, "Cannot determine the other participant");

        var exchangeRating = new ExchangeRating
        {
            ExchangeId = exchangeId,
            RaterId = raterId,
            RatedUserId = ratedUserId.Value,
            Rating = rating,
            Comment = comment?.Trim(),
            WouldWorkAgain = wouldWorkAgain,
            CreatedAt = DateTime.UtcNow
        };

        _db.ExchangeRatings.Add(exchangeRating);
        await _db.SaveChangesAsync();

        // Award XP and check badges (non-critical)
        try
        {
            await _gamification.AwardXpAsync(raterId, XpLog.Amounts.ReviewLeft, XpLog.Sources.ReviewLeft, exchangeId, "Rated an exchange");
            await _gamification.CheckAndAwardBadgesAsync(raterId, "review_left");
            if (rating == 5)
                await _gamification.CheckAndAwardBadgesAsync(ratedUserId.Value, "five_star_received");
        }
        catch (DbUpdateException ex)
        {
            _logger.LogWarning(ex, "Failed to award XP for rating exchange {ExchangeId}", exchangeId);
        }
        catch (InvalidOperationException ex)
        {
            _logger.LogWarning(ex, "Failed to award XP for rating exchange {ExchangeId}", exchangeId);
        }

        _logger.LogInformation("Exchange {ExchangeId} rated by user {RaterId}: {Rating}/5",
            exchangeId, raterId, rating);
        return (exchangeRating, null);
    }

    private async Task<Exchange?> GetExchangeWithValidation(int exchangeId, int userId)
    {
        return await _db.Exchanges
            .Include(e => e.Listing)
            .FirstOrDefaultAsync(e => e.Id == exchangeId);
    }

    private static bool IsParticipant(Exchange exchange, int userId)
    {
        return exchange.InitiatorId == userId || exchange.ListingOwnerId == userId;
    }

    private static int? GetOtherParticipant(Exchange exchange, int userId)
    {
        if (exchange.InitiatorId == userId) return exchange.ListingOwnerId;
        if (exchange.ListingOwnerId == userId) return exchange.InitiatorId;
        return null;
    }

    private static string? ValidateTransition(Exchange exchange, ExchangeStatus newStatus)
    {
        if (!ValidTransitions.TryGetValue(exchange.Status, out var allowed) || !allowed.Contains(newStatus))
            return $"Cannot transition from {exchange.Status} to {newStatus}";
        return null;
    }
}
