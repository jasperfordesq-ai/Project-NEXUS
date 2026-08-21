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
using Nexus.Api.Support.Exchanges;

namespace Nexus.Api.Controllers;

/// <summary>
/// Exchange workflow controller - the core of timebanking.
/// Manages the full lifecycle: request → accept → in-progress → complete → rate.
///
/// 🔴 EVERY RESPONSE HERE GOES THROUGH <see cref="ExchangeContractMapper"/>, and every
/// one of them is wrapped in Laravel's <c>{data: …}</c> envelope. Both were changed on
/// 2026-08-21 and the reason is worth keeping: settlement already worked, and ledger
/// row 1.21 was still dead, because the React app could not render an exchange page at
/// all. The detail read returned a bare object with `initiator`/`listing_owner`/
/// `agreed_hours` and statuses spelled `requested`/`inprogress`/`pendingconfirmation`,
/// while the client reads `requester_id`/`provider_id`/`proposed_hours` and
/// `pending_provider`/`in_progress`/`pending_confirmation`. So `proposed_hours` was
/// undefined, `.toString()` on it threw, and the catch rendered "exchange not found".
/// HTTP 200 throughout. Nothing but opening the page finds that.
///
/// Do NOT hand-roll another anonymous response object in this file. One projection,
/// one status vocabulary, one envelope — or the next field rename splits them again.
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
    ///
    /// 🔴 THE STATUS FILTER WAS SILENTLY DROPPED. This did
    /// <c>Enum.TryParse&lt;ExchangeStatus&gt;(status)</c>, and the React client's tabs send
    /// `active`, `pending_confirmation` and `completed` (ExchangesPage.tsx:60-62).
    /// `active` is a BUCKET, not a status, so the parse failed, the whole
    /// <c>if</c> was skipped, and the "Active" tab listed completed and cancelled
    /// exchanges too. Nothing errored; the page just showed the wrong rows. Filtering
    /// now goes through <see cref="ExchangeContractMapper.StatusFilter"/>, which knows
    /// Laravel's buckets (ExchangeService.php:55-68), and an unrecognised value
    /// returns an EMPTY page rather than the unfiltered list — a filter the server
    /// does not understand must never look like "no filter".
    ///
    /// 🔴 PAGINATION: both dialects. Laravel reads `per_page`/`cursor` and replies
    /// with <c>meta.has_more</c>/<c>meta.cursor</c>; the React list reads
    /// <c>response.meta.has_more</c> (ExchangesPage.tsx:145) and web-uk sends
    /// `per_page`/`cursor` (web-uk/src/lib/api.js:1968-1971). This backend's own
    /// `page`/`limit` + `pagination` block is KEPT — additive, and its existing
    /// readers are not part of this change.
    /// </summary>
    [HttpGet]
    public async Task<IActionResult> ListExchanges(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        [FromQuery(Name = "per_page")] int? perPage = null,
        [FromQuery] string? cursor = null,
        [FromQuery] string? status = null,
        [FromQuery] string? role = null) // "requester"/"initiator", "provider"/"owner", or null
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (page < 1) page = 1;
        limit = Math.Clamp(perPage ?? limit, 1, 100);

        var query = _db.Exchanges
            .Where(e => e.InitiatorId == userId.Value || e.ListingOwnerId == userId.Value);

        // Filter by role. Laravel's vocabulary is requester|provider
        // (ExchangeFilters, react-frontend/src/types/api.ts:1729); this backend's own
        // initiator|owner still works.
        if (!string.IsNullOrEmpty(role))
        {
            query = role.ToLowerInvariant() switch
            {
                "initiator" or "requester" => query.Where(e => e.InitiatorId == userId.Value),
                "owner" or "provider" => query.Where(e => e.ListingOwnerId == userId.Value),
                _ => query
            };
        }

        if (!string.IsNullOrWhiteSpace(status))
        {
            var wanted = ExchangeContractMapper.StatusFilter(status);
            if (wanted == null)
            {
                return BadRequest(new
                {
                    errors = new[]
                    {
                        new { code = "VALIDATION_ERROR", message = $"Unknown exchange status filter: {status}", field = "status" }
                    }
                });
            }

            query = query.Where(e => wanted.Contains(e.Status));
        }

        var total = await query.CountAsync();

        // Laravel's cursor is base64 of the last id and pages by `id <` (descending),
        // so ordering has to be by id too or the cursor walks a different sequence.
        IQueryable<Exchange> pageQuery;
        if (DecodeCursor(cursor) is int afterId)
        {
            pageQuery = query.Where(e => e.Id < afterId).OrderByDescending(e => e.Id);
        }
        else
        {
            // Offset paging retained for this backend's own `page` dialect.
            pageQuery = query.OrderByDescending(e => e.Id);
            if (page > 1) pageQuery = pageQuery.Skip((page - 1) * limit);
        }

        // limit + 1 tells us whether another page exists without a second count.
        var rows = await pageQuery
            .Take(limit + 1)
            .Include(e => e.Listing)
            .Include(e => e.Initiator)
            .Include(e => e.ListingOwner)
            .ToListAsync();

        var hasMore = rows.Count > limit;
        if (hasMore) rows.RemoveAt(rows.Count - 1);

        var exchanges = rows
            .Select(e => ExchangeContractMapper.Exchange(e, userId.Value))
            .ToList();

        return Ok(new
        {
            data = exchanges,
            meta = new
            {
                per_page = limit,
                has_more = hasMore,
                cursor = hasMore && rows.Count > 0 ? EncodeCursor(rows[^1].Id) : null
            },
            pagination = new { page, limit, total, pages = (int)Math.Ceiling((double)total / limit) }
        });
    }

    private static int? DecodeCursor(string? cursor)
    {
        if (string.IsNullOrWhiteSpace(cursor)) return null;
        try
        {
            var decoded = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(cursor));
            return int.TryParse(decoded, out var id) ? id : null;
        }
        catch (FormatException)
        {
            // A malformed cursor is not page one — page one would silently re-serve
            // rows the caller already has. Ignore it and let the caller notice.
            return null;
        }
    }

    private static string EncodeCursor(int id) =>
        Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(id.ToString()));

    /// <summary>
    /// Get a single exchange by ID — the read the whole journey turns on.
    ///
    /// Laravel: <c>ExchangesController::show</c> (app/Http/Controllers/Api/…:118-147),
    /// which replies <c>{data: formatExchange(...) + status_history}</c> and 404s a
    /// non-party rather than 403ing it, so an outsider cannot probe for ids.
    /// </summary>
    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetExchange(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var exchange = await LoadForResponseAsync(id);

        if (exchange == null)
            return NotFound(new { error = "Exchange not found" });

        // Only participants can view
        if (exchange.InitiatorId != userId.Value && exchange.ListingOwnerId != userId.Value)
            return NotFound(new { error = "Exchange not found" });

        return Ok(new { data = DetailPayload(exchange, userId.Value) });
    }

    /// <summary>
    /// Request a new exchange on a listing.
    ///
    /// 🔴 THE CLIENT SENDS `proposed_hours`, NOT `agreed_hours`
    /// (RequestExchangePage.tsx:145-150), and it is the number the member typed into
    /// the form. This DTO bound only `agreed_hours`, so the member's hours were
    /// dropped on the floor and the exchange was created at the listing's estimate
    /// instead — silently, at HTTP 201, with a plausible number in the response.
    /// Both spellings now bind; `proposed_hours` wins because Laravel's column is
    /// `proposed_hours` (mysql-schema.sql:8899).
    ///
    /// 🔴 `prep_time` is accepted and DROPPED. There is no column for it on this
    /// backend's Exchange entity, adding one is an EF migration, and inventing a place
    /// to put it (Notes, say) would be worse than losing it. It therefore always reads
    /// back null. Named gap — do not paper over it.
    ///
    /// Laravel replies <c>{data: formatExchange(...)}</c> with 201
    /// (ExchangesController.php:190).
    /// </summary>
    [HttpPost]
    public async Task<IActionResult> CreateExchange([FromBody] CreateExchangeRequest request)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (exchange, error) = await _exchangeService.CreateExchangeAsync(
            userId.Value, request.ListingId, request.ProposedHours ?? request.AgreedHours,
            request.Message, request.ScheduledAt, request.GroupId);

        if (error != null)
            return BadRequest(new { error });

        var created = await LoadForResponseAsync(exchange!.Id) ?? exchange;

        return CreatedAtAction(nameof(GetExchange), new { id = exchange.Id },
            new { data = ExchangeContractMapper.Exchange(created, userId.Value) });
    }

    /// <summary>
    /// Accept an exchange request.
    /// </summary>
    // 🔴 POST as well as PUT, and the POST is the one that matters. The React
    // client sends POST for every lifecycle action (ExchangeDetailPage.tsx:238, 258,
    // 279, 299, 330). Until 2026-08-21 this method answered PUT only, so the client's
    // accept landed on an AdminOnly empty-array stub in
    // ReactFrontendCompatibilityController and a member was told "Admin access
    // required". Route existence proved nothing: the route existed, the controller
    // was correct, and the journey was still dead.
    [HttpPut("{id:int}/accept")]
    [HttpPost("{id:int}/accept")]
    public async Task<IActionResult> AcceptExchange(int id, [FromBody] AcceptExchangeRequest? request = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (exchange, error) = await _exchangeService.AcceptExchangeAsync(id, userId.Value, request?.AdjustedHours);

        if (error != null)
            return BadRequest(new { error });

        return await RespondWithExchangeAsync(exchange!.Id, userId.Value);
    }

    /// <summary>
    /// Decline an exchange request.
    /// </summary>
    [HttpPut("{id:int}/decline")]
    [HttpPost("{id:int}/decline")]
    public async Task<IActionResult> DeclineExchange(int id, [FromBody] DeclineExchangeRequest? request = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (exchange, error) = await _exchangeService.DeclineExchangeAsync(id, userId.Value, request?.Reason);

        if (error != null)
            return BadRequest(new { error });

        // 🔴 The wire status here is `cancelled`, NOT `declined`. Laravel has no
        // `declined` status — declining writes `cancelled`
        // (ExchangeWorkflowService.php:249) — and the React client would index
        // EXCHANGE_STATUS_CONFIG['declined'], get undefined, and throw on
        // `statusConfig.color`. The stored enum member is still Declined; only the
        // spelling at the boundary changes. Laravel itself replies with just a message
        // (ExchangesController.php:250); the exchange body is a superset.
        return await RespondWithExchangeAsync(exchange!.Id, userId.Value, "Exchange request declined");
    }

    /// <summary>
    /// Start an exchange (move to in-progress).
    /// </summary>
    [HttpPut("{id:int}/start")]
    [HttpPost("{id:int}/start")]
    public async Task<IActionResult> StartExchange(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (exchange, error) = await _exchangeService.StartExchangeAsync(id, userId.Value);

        if (error != null)
            return BadRequest(new { error });

        return await RespondWithExchangeAsync(exchange!.Id, userId.Value);
    }

    /// <summary>
    /// Mark the work done. This hands the exchange to the two-party confirmation
    /// step; it does NOT transfer credits, which is also what Laravel's
    /// <c>POST /v2/exchanges/{id}/complete</c> does
    /// (ExchangesController.php:279-301 → <c>markReadyForConfirmation</c>).
    ///
    /// 🔴 The endpoint is called "complete" and does not complete anything. That
    /// naming is Laravel's and is part of the contract the React client is built
    /// against — <c>canComplete</c> is the provider's "Mark as Complete" button and
    /// the page then shows "awaiting confirmation", not a settled balance. Do not
    /// "fix" it by settling here.
    /// </summary>
    [HttpPut("{id:int}/complete")]
    [HttpPost("{id:int}/complete")]
    public async Task<IActionResult> CompleteExchange(int id, [FromBody] CompleteExchangeRequest? request = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (exchange, error) = await _exchangeService.CompleteExchangeAsync(id, userId.Value, request?.ActualHours);

        if (error != null)
            return BadRequest(new { error });

        return await RespondWithExchangeAsync(exchange!.Id, userId.Value);
    }

    /// <summary>
    /// Confirm the hours on an exchange — the step credits actually move on.
    ///
    /// 🔴 HISTORY, because the shape of this endpoint is the product of two
    /// separate mistakes. First it was a guard-free alias
    /// (CompatibilityAliasController, removed 2026-08-21) that answered
    /// 200 {"status":"confirmed"} and set Status = Accepted — no participant check,
    /// no transition check. Measured live as an ordinary member, it REOPENED a
    /// COMPLETED exchange that already carried a settled TransactionId. It was then
    /// replaced by an honest 501, because the `exchanges` table had nowhere to record
    /// two separate confirmations and settling on one party's word is the one thing
    /// this feature exists to prevent.
    ///
    /// The five columns arrived in migration
    /// 20260821164404_AddExchangeTwoPartyConfirmation, so this now does the real work
    /// in <see cref="ExchangeService.ConfirmHoursAsync"/>. What must NOT come back is
    /// either failure mode: a 200 that mutates without checking, or a settlement that
    /// pays out before both parties have agreed.
    ///
    /// Status codes follow Laravel (ExchangesController.php:304-345):
    ///   400 VALIDATION_REQUIRED_FIELD    missing / non-positive `hours`
    ///   404 NOT_FOUND                    not a party, or no such exchange in tenant
    ///   400 EXCHANGE_ERROR               wrong state, including already settled
    ///   422 INSUFFICIENT_BALANCE         payer cannot cover the agreed hours
    ///   409 EXCHANGE_PARTY_UNAVAILABLE   a party left the community mid-exchange
    /// </summary>
    [HttpPut("{id:int}/confirm")]
    [HttpPost("{id:int}/confirm")]
    public async Task<IActionResult> ConfirmExchangeHours(int id, [FromBody] ConfirmExchangeHoursRequest? request = null)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        // Laravel validates this before anything else: 400 VALIDATION_REQUIRED_FIELD
        // on a missing or non-positive `hours` (ExchangesController.php:318-321).
        if (request?.Hours is null or <= 0)
        {
            return BadRequest(new
            {
                errors = new[]
                {
                    new { code = "VALIDATION_REQUIRED_FIELD", message = "Missing required field: hours", field = "hours" }
                }
            });
        }

        var result = await _exchangeService.ConfirmHoursAsync(id, userId.Value, request.Hours.Value);

        if (!result.Ok)
        {
            // Non-participants are 404'd, not 403'd — Laravel's exchange reads do the
            // same (ExchangesController.php:127) so an outsider cannot probe for ids.
            var (status, code) = result.Error switch
            {
                ExchangeConfirmationError.NotFound => (StatusCodes.Status404NotFound, "NOT_FOUND"),
                ExchangeConfirmationError.Validation => (StatusCodes.Status400BadRequest, "VALIDATION_REQUIRED_FIELD"),
                ExchangeConfirmationError.InsufficientBalance => (StatusCodes.Status422UnprocessableEntity, "INSUFFICIENT_BALANCE"),
                ExchangeConfirmationError.PartyUnavailable => (StatusCodes.Status409Conflict, "EXCHANGE_PARTY_UNAVAILABLE"),
                _ => (StatusCodes.Status400BadRequest, "EXCHANGE_ERROR"),
            };

            _logger.LogWarning(
                "Refused hours confirmation for exchange {ExchangeId} by user {UserId}: {Code}. No credits moved.",
                id, userId.Value, code);

            return StatusCode(status, new
            {
                errors = new[] { new { code, message = result.Message } }
            });
        }

        // Laravel appends a `message` that names what actually happened — recorded,
        // settled, or sent to a broker (ExchangesController.php:341-348) — and the
        // wording differs per outcome, so it is derived from the resulting status
        // rather than hardcoded.
        var settled = result.Exchange!.Status;
        var message = settled switch
        {
            ExchangeStatus.Completed => "Exchange completed and credits transferred",
            ExchangeStatus.Disputed => "Hours disputed — a broker will review this exchange",
            _ => "Hours confirmed"
        };

        return await RespondWithExchangeAsync(result.Exchange!.Id, userId.Value, message);
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

        return await RespondWithExchangeAsync(exchange!.Id, userId.Value, "Exchange cancelled");
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

        return await RespondWithExchangeAsync(exchange!.Id, userId.Value);
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

        // Laravel replies 201 <c>{data: [every rating on this exchange]}</c>
        // (WalletFeaturesController.php:290-292) — an ARRAY, not the one row just
        // written. The React RatingModal only checks `success`, but a shape that
        // differs from Laravel's for no reason is a trap for the next reader.
        var ratings = await _db.ExchangeRatings.AsNoTracking()
            .Where(r => r.ExchangeId == id)
            .OrderBy(r => r.CreatedAt)
            .Select(r => new
            {
                id = r.Id,
                exchange_id = r.ExchangeId,
                rater_id = r.RaterId,
                rated_id = r.RatedUserId,
                rated_user_id = r.RatedUserId,
                rating = r.Rating,
                comment = r.Comment,
                would_work_again = r.WouldWorkAgain,
                created_at = r.CreatedAt
            })
            .ToListAsync();

        _logger.LogInformation("Rating {RatingId} recorded on exchange {ExchangeId}", rating!.Id, id);

        return CreatedAtAction(nameof(GetExchange), new { id }, new { data = ratings });
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
            .OrderByDescending(e => e.Id)
            .Include(e => e.Listing)
            .Include(e => e.Initiator)
            .Include(e => e.ListingOwner)
            .ToListAsync())
            .Select(e => ExchangeContractMapper.Exchange(e, userId.Value))
            .ToList();

        return Ok(new { data = exchanges });
    }

    // === Response mapping ===
    //
    // 🔴 There is exactly ONE projection, in ExchangeContractMapper. The two
    // hand-rolled anonymous objects that used to live here (MapExchangeResponse and
    // MapExchangeDetailResponse) had drifted apart from each other AND from what the
    // clients read — different party names, different hours name, and a status
    // produced by ToString().ToLowerInvariant(), which is how `pendingconfirmation`
    // reached the wire. Add a field to the mapper, not to a response object here.

    /// <summary>
    /// Reload an exchange with everything the projection needs. Laravel re-reads the
    /// row after every mutation for the same reason (ExchangesController.php:224, 275)
    /// — the response must describe the state that was actually persisted, not the
    /// in-memory object the service happened to hand back.
    /// </summary>
    private Task<Exchange?> LoadForResponseAsync(int id) => _db.Exchanges
        .AsNoTracking()
        .Include(e => e.Listing)
        .Include(e => e.Initiator)
        .Include(e => e.ListingOwner)
        .FirstOrDefaultAsync(e => e.Id == id);

    /// <summary>The detail read: the exchange plus its timeline.</summary>
    private static Dictionary<string, object?> DetailPayload(Exchange e, int viewerId)
    {
        var payload = ExchangeContractMapper.Exchange(e, viewerId);
        payload["status_history"] = ExchangeContractMapper.StatusHistory(e);
        return payload;
    }

    /// <summary>
    /// The shared reply for every lifecycle action: Laravel's <c>{data: …}</c> envelope
    /// around the re-read exchange, optionally carrying the message Laravel appends.
    /// </summary>
    private async Task<IActionResult> RespondWithExchangeAsync(int id, int viewerId, string? message = null)
    {
        var exchange = await LoadForResponseAsync(id);
        if (exchange == null) return NotFound(new { error = "Exchange not found" });

        var payload = DetailPayload(exchange, viewerId);
        if (message != null) payload["message"] = message;

        return Ok(new { data = payload });
    }
}

// === Request DTOs ===

public class CreateExchangeRequest
{
    [JsonPropertyName("listing_id")]
    public int ListingId { get; set; }

    /// <summary>
    /// 🔴 What the clients actually send (RequestExchangePage.tsx:147,
    /// web-uk/src/routes/listings.js:1040) and Laravel's column name
    /// (mysql-schema.sql:8899). Binding only `agreed_hours` meant the hours the
    /// member typed were dropped and the exchange was created at the listing's
    /// estimate instead — at HTTP 201, with a plausible number in the reply.
    /// </summary>
    [JsonPropertyName("proposed_hours")]
    public decimal? ProposedHours { get; set; }

    /// <summary>This backend's own older spelling; kept so nothing that sends it breaks.</summary>
    [JsonPropertyName("agreed_hours")]
    public decimal? AgreedHours { get; set; }

    /// <summary>
    /// 🔴 ACCEPTED AND DROPPED, deliberately and visibly. The client sends it
    /// (RequestExchangePage.tsx:149) and reads it back on the detail page, but this
    /// backend's Exchange entity has no column for it and adding one is an EF
    /// migration. Bound here so the request does not 400 on an unknown member, and
    /// documented as a named gap rather than stuffed into `Notes`.
    /// </summary>
    [JsonPropertyName("prep_time")]
    public decimal? PrepTime { get; set; }

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

public class ConfirmExchangeHoursRequest
{
    /// <summary>
    /// The client always sends this, and sends it as `hours`
    /// (ExchangeDetailPage.tsx:330). Nullable so a missing body produces Laravel's
    /// VALIDATION_REQUIRED_FIELD rather than a model-binding 400 with a different shape.
    /// </summary>
    [JsonPropertyName("hours")]
    public decimal? Hours { get; set; }
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
