// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Collections.Concurrent;
using System.Data;
using System.IdentityModel.Tokens.Jwt;
using System.Globalization;
using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.IdentityModel.Tokens;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Middleware;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Compact member-facing V1.5 compatibility surface for route parity.
/// These endpoints bridge legacy frontend/API paths onto the existing V2 data model.
/// </summary>
[ApiController]
[Authorize]
public class V15MemberParityController : ControllerBase
{
    private const int PartnerTokenTtlSeconds = 3600;
    private const string ApiVersionHeader = "API-Version";
    private const string ApiVersion = "2.0";

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly IConfiguration _config;
    private readonly IMemoryCache _cache;
    private readonly PersonalWalletLedgerService _personalWallet;
    private readonly PersonalWalletTransferEffectsService _transferEffects;
    private readonly OrganisationService _organisationService;
    private readonly OrgWalletService _orgWalletService;
    private readonly EventLifecycleService _eventLifecycle;
    private static readonly ConcurrentDictionary<Guid, object> PartnerRateLocks = new();

    public V15MemberParityController(
        NexusDbContext db,
        TenantContext tenantContext,
        IConfiguration config,
        IMemoryCache cache,
        PersonalWalletLedgerService personalWallet,
        PersonalWalletTransferEffectsService transferEffects,
        OrganisationService organisationService,
        OrgWalletService orgWalletService,
        EventLifecycleService eventLifecycle)
    {
        _db = db;
        _tenantContext = tenantContext;
        _config = config;
        _cache = cache;
        _personalWallet = personalWallet;
        _transferEffects = transferEffects;
        _organisationService = organisationService;
        _orgWalletService = orgWalletService;
        _eventLifecycle = eventLifecycle;
    }

    [HttpGet("api/v2/events")]
    public async Task<IActionResult> V2Events([FromQuery] int page = 1, [FromQuery] int limit = 20, [FromQuery] string? search = null)
    {
        var query = _db.Events.AsNoTracking().Where(e => !e.IsCancelled);
        if (!string.IsNullOrWhiteSpace(search))
        {
            var term = search.Trim().ToLowerInvariant();
            query = query.Where(e => e.Title.ToLower().Contains(term) || (e.Description != null && e.Description.ToLower().Contains(term)));
        }

        var total = await query.CountAsync();
        var events = await query.OrderBy(e => e.StartsAt).Skip(Skip(page, limit)).Take(Limit(limit)).Select(e => new
        {
            id = e.Id,
            title = e.Title,
            description = e.Description,
            location = e.Location,
            starts_at = e.StartsAt,
            ends_at = e.EndsAt,
            image_url = e.ImageUrl,
            max_attendees = e.MaxAttendees,
            rsvp_count = e.Rsvps.Count(r => r.Status == Event.RsvpStatus.Going),
            is_cancelled = e.IsCancelled,
            created_at = e.CreatedAt
        }).ToListAsync();

        return Ok(Paged(events, page, limit, total));
    }

    [HttpGet("api/v2/events/nearby")]
    [HttpGet("api/v2/events/series")]
    [HttpGet("api/v2/events/series/{seriesId:int}")]
    public async Task<IActionResult> V2EventCollections()
    {
        var data = await _db.Events.AsNoTracking().Where(e => !e.IsCancelled && e.StartsAt >= DateTime.UtcNow)
            .OrderBy(e => e.StartsAt).Take(20).Select(e => new { id = e.Id, title = e.Title, starts_at = e.StartsAt, location = e.Location }).ToListAsync();
        return Ok(new { data });
    }

    [HttpPost("api/v2/events")]
    [HttpPost("api/v2/events/series")]
    public async Task<IActionResult> V2CreateEvent([FromBody] JsonElement body)
    {
        var userId = CurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var title = GetString(body, "title") ?? "Untitled event";
        var startsAt = GetDate(body, "starts_at") ?? GetDate(body, "start_time") ?? DateTime.UtcNow.AddDays(7);
        var ev = new Event
        {
            TenantId = TenantId(),
            CreatedById = userId.Value,
            Title = title,
            Description = GetString(body, "description"),
            Location = GetString(body, "location"),
            StartsAt = startsAt,
            EndsAt = GetDate(body, "ends_at") ?? GetDate(body, "end_time"),
            MaxAttendees = GetInt(body, "max_attendees"),
            ImageUrl = GetString(body, "image_url") ?? GetString(body, "cover_image")
        };

        _db.Events.Add(ev);
        await _db.SaveChangesAsync();
        return Created($"api/v2/events/{ev.Id}", new { success = true, data = EventDto(ev) });
    }

    [HttpGet("api/v2/events/{id:int}")]
    public async Task<IActionResult> V2Event(int id)
    {
        var ev = await _db.Events.AsNoTracking().FirstOrDefaultAsync(e => e.Id == id);
        return ev == null ? NotFound(new { error = "Event not found" }) : Ok(new { data = EventDto(ev) });
    }

    [HttpPut("api/v2/events/{id:int}")]
    [HttpPut("api/v2/events/{id:int}/recurring")]
    public async Task<IActionResult> V2UpdateEvent(int id, [FromBody] JsonElement body)
    {
        var ev = await _db.Events.FirstOrDefaultAsync(e => e.Id == id);
        if (ev == null) return NotFound(new { error = "Event not found" });

        ev.Title = GetString(body, "title") ?? ev.Title;
        ev.Description = GetString(body, "description") ?? ev.Description;
        ev.Location = GetString(body, "location") ?? ev.Location;
        ev.StartsAt = GetDate(body, "starts_at") ?? ev.StartsAt;
        ev.EndsAt = GetDate(body, "ends_at") ?? ev.EndsAt;
        ev.MaxAttendees = GetInt(body, "max_attendees") ?? ev.MaxAttendees;
        ev.ImageUrl = GetString(body, "image_url") ?? ev.ImageUrl;
        ev.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = EventDto(ev) });
    }

    [HttpDelete("api/v2/events/{id:int}")]
    public async Task<IActionResult> V2DeleteEvent(int id, [FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] JsonElement? body, CancellationToken ct)
    {
        var tenantId = TenantId();
        var userId = CurrentUserId() ?? throw new UnauthorizedAccessException();
        var before = await _db.Events.IgnoreQueryFilters().AsNoTracking()
            .SingleOrDefaultAsync(e => e.TenantId == tenantId && e.Id == id, ct);
        if (before == null) return NotFound(new { success = false, code = "NOT_FOUND", message = "Event not found" });
        var reason = body is { ValueKind: JsonValueKind.Object } value ? GetString(value, "reason") : null;
        var result = await _eventLifecycle.TransitionAsync(tenantId, id, userId, "archive", reason, ct);
        if (!result.Succeeded) return LifecycleFailure(result.Error!);
        var after = await _db.Events.IgnoreQueryFilters().AsNoTracking()
            .SingleAsync(e => e.TenantId == tenantId && e.Id == id, ct);
        var changed = after.LifecycleVersion != before.LifecycleVersion;
        return Ok(new
        {
            success = true,
            data = new
            {
                action = "archive",
                requested_action = "delete",
                outcome = changed ? "archived" : "already_archived",
                event_id = id,
                changed,
                replayed = !changed,
                idempotent_replay = !changed,
                archived = true,
                already_archived = !changed,
                deleted = false,
                publication_status = after.PublicationStatus,
                operational_status = after.OperationalStatus,
                lifecycle_version = after.LifecycleVersion,
                reason = after.LifecycleReason
            }
        });
    }

    [HttpPost("api/v2/events/{id:int}/cancel")]
    public async Task<IActionResult> V2CancelEvent(int id, [FromBody] JsonElement body, CancellationToken ct)
    {
        var reason = GetString(body, "reason")?.Trim();
        if (string.IsNullOrEmpty(reason))
            return UnprocessableEntity(new { success = false, code = "VALIDATION_REQUIRED_FIELD", message = "Reason is required", errors = new[] { new { code = "VALIDATION_REQUIRED_FIELD", message = "Reason is required", field = "reason" } } });
        var result = await _eventLifecycle.TransitionAsync(TenantId(), id, CurrentUserId() ?? throw new UnauthorizedAccessException(), "cancel", reason, ct);
        if (!result.Succeeded) return LifecycleFailure(result.Error!);
        return Ok(new { success = true, data = new { cancelled = true, event_id = id, reason } });
    }

    private IActionResult LifecycleFailure(EventLifecycleError error)
        => StatusCode(error.Status, new { success = false, code = error.Code, message = error.Message, errors = new[] { new { code = error.Code, message = error.Message, field = error.Field } } });

    [HttpGet("api/v2/events/{id:int}/attendees")]
    [HttpGet("api/v2/events/{id:int}/attendance")]
    public async Task<IActionResult> V2EventAttendees(int id)
    {
        var attendees = await _db.EventRsvps.AsNoTracking().Where(r => r.EventId == id)
            .Select(r => new { id = r.UserId, user_id = r.UserId, status = r.Status, responded_at = r.RespondedAt }).ToListAsync();
        return Ok(new { data = attendees });
    }

    [HttpPost("api/events/rsvp")]
    [HttpPost("api/v2/events/{id:int}/rsvp")]
    [HttpPost("api/v2/events/{id:int}/attendance")]
    [HttpPost("api/v2/events/{id:int}/attendance/bulk")]
    [HttpPost("api/v2/events/{id:int}/attendees/{attendeeId:int}/check-in")]
    [HttpPost("api/v2/events/{id:int}/waitlist")]
    public async Task<IActionResult> V2Rsvp(int? id, [FromBody] JsonElement body)
    {
        var eventId = id ?? GetInt(body, "event_id");
        var userId = GetInt(body, "user_id") ?? CurrentUserId();
        if (eventId == null || userId == null) return BadRequest(new { error = "event_id is required" });
        if (!await _db.Events.AnyAsync(e => e.Id == eventId.Value)) return NotFound(new { error = "Event not found" });

        var status = GetString(body, "status") ?? Event.RsvpStatus.Going;
        var rsvp = await _db.EventRsvps.FirstOrDefaultAsync(r => r.EventId == eventId.Value && r.UserId == userId.Value);
        if (rsvp == null)
        {
            rsvp = new EventRsvp { TenantId = TenantId(), EventId = eventId.Value, UserId = userId.Value, Status = status };
            _db.EventRsvps.Add(rsvp);
        }
        else
        {
            rsvp.Status = status;
            rsvp.RespondedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = new { event_id = eventId, user_id = userId, status = rsvp.Status, checked_in = true } });
    }

    [HttpDelete("api/v2/events/{id:int}/rsvp")]
    [HttpDelete("api/v2/events/{id:int}/waitlist")]
    public async Task<IActionResult> V2RemoveRsvp(int id)
    {
        var userId = CurrentUserId();
        var rsvp = await _db.EventRsvps.FirstOrDefaultAsync(r => r.EventId == id && r.UserId == userId);
        if (rsvp != null)
        {
            _db.EventRsvps.Remove(rsvp);
            await _db.SaveChangesAsync();
        }
        return Ok(new { success = true });
    }

    [HttpPost("api/v2/events/{id:int}/image")]
    [HttpPost("api/v2/events/{id:int}/series")]
    [HttpGet("api/v2/events/{id:int}/waitlist")]
    public IActionResult V2EventLightweight(int id) => Ok(new { data = Array.Empty<object>(), event_id = id, success = true });

    [HttpGet("api/v2/listings")]
    [HttpGet("api/v2/listings/featured")]
    [HttpGet("api/v2/listings/nearby")]
    [HttpGet("api/v2/users/{id:int}/listings")]
    [HttpGet("api/v2/users/me/listings")]
    [HttpGet("api/v2/federation/listings")]
    public async Task<IActionResult> V2Listings([FromQuery] int page = 1, [FromQuery] int limit = 20, [FromQuery] string? type = null)
    {
        var query = _db.Listings.AsNoTracking().Where(l => l.DeletedAt == null);
        if (type != null && Enum.TryParse<ListingType>(type, true, out var parsedType)) query = query.Where(l => l.Type == parsedType);
        if (Request.Path.Value?.Contains("featured", StringComparison.OrdinalIgnoreCase) == true) query = query.Where(l => l.IsFeatured);

        var total = await query.CountAsync();
        var listings = await query.OrderByDescending(l => l.CreatedAt).Skip(Skip(page, limit)).Take(Limit(limit)).Select(l => new
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
            created_at = l.CreatedAt,
            user_id = l.UserId
        }).ToListAsync();
        return Ok(Paged(listings, page, limit, total));
    }

    [HttpGet("api/v2/listings/saved")]
    public async Task<IActionResult> V2SavedListings()
    {
        var userId = CurrentUserId();
        var saved = await _db.ListingFavorites.AsNoTracking().Where(f => f.UserId == userId)
            .Select(f => new { id = f.ListingId, saved_at = f.CreatedAt }).ToListAsync();
        return Ok(new { data = saved });
    }

    [HttpGet("api/v2/listings/{id:int}")]
    public async Task<IActionResult> V2Listing(int id)
    {
        var listing = await _db.Listings.AsNoTracking().FirstOrDefaultAsync(l => l.Id == id && l.DeletedAt == null);
        return listing == null ? NotFound(new { error = "Listing not found" }) : Ok(new { data = ListingDto(listing) });
    }

    [HttpPost("api/v2/listings")]
    public async Task<IActionResult> V2CreateListing([FromBody] JsonElement body)
    {
        var userId = CurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var listing = new Listing
        {
            TenantId = TenantId(),
            UserId = userId.Value,
            Title = GetString(body, "title") ?? "Untitled listing",
            Description = GetString(body, "description"),
            Type = Enum.TryParse<ListingType>(GetString(body, "type"), true, out var type) ? type : ListingType.Offer,
            Status = ListingStatus.Active,
            Location = GetString(body, "location"),
            EstimatedHours = GetDecimal(body, "estimated_hours")
        };
        _db.Listings.Add(listing);
        await _db.SaveChangesAsync();
        return Created($"api/v2/listings/{listing.Id}", new { success = true, data = ListingDto(listing) });
    }

    [HttpPut("api/v2/listings/{id:int}")]
    public async Task<IActionResult> V2UpdateListing(int id, [FromBody] JsonElement body)
    {
        var listing = await _db.Listings.FirstOrDefaultAsync(l => l.Id == id && l.DeletedAt == null);
        if (listing == null) return NotFound(new { error = "Listing not found" });
        listing.Title = GetString(body, "title") ?? listing.Title;
        listing.Description = GetString(body, "description") ?? listing.Description;
        listing.Location = GetString(body, "location") ?? listing.Location;
        listing.EstimatedHours = GetDecimal(body, "estimated_hours") ?? listing.EstimatedHours;
        listing.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = ListingDto(listing) });
    }

    [HttpDelete("api/v2/listings/{id:int}")]
    [HttpPost("api/listings/delete")]
    public async Task<IActionResult> V2DeleteListing(int? id, [FromBody] JsonElement body)
    {
        var listingId = id ?? GetInt(body, "id") ?? GetInt(body, "listing_id");
        if (listingId == null) return BadRequest(new { error = "listing id is required" });
        var listing = await _db.Listings.FirstOrDefaultAsync(l => l.Id == listingId.Value);
        if (listing == null) return NotFound(new { error = "Listing not found" });
        listing.DeletedAt = DateTime.UtcNow;
        listing.Status = ListingStatus.Cancelled;
        await _db.SaveChangesAsync();
        return Ok(new { success = true });
    }

    [HttpPost("api/v2/listings/{id:int}/save")]
    public async Task<IActionResult> V2SaveListing(int id)
    {
        var userId = CurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        if (!await _db.ListingFavorites.AnyAsync(f => f.ListingId == id && f.UserId == userId.Value))
        {
            _db.ListingFavorites.Add(new ListingFavorite { TenantId = TenantId(), ListingId = id, UserId = userId.Value });
            await _db.SaveChangesAsync();
        }
        return Ok(new { success = true });
    }

    [HttpDelete("api/v2/listings/{id:int}/save")]
    public async Task<IActionResult> V2UnsaveListing(int id)
    {
        var userId = CurrentUserId();
        var favorite = await _db.ListingFavorites.FirstOrDefaultAsync(f => f.ListingId == id && f.UserId == userId);
        if (favorite != null)
        {
            _db.ListingFavorites.Remove(favorite);
            await _db.SaveChangesAsync();
        }
        return Ok(new { success = true });
    }

    [HttpPut("api/v2/listings/{id:int}/tags")]
    public async Task<IActionResult> V2UpdateListingTags(int id, [FromBody] JsonElement body)
    {
        var tags = ReadStringArray(body, "tags");
        var existing = await _db.ListingTags.Where(t => t.ListingId == id).ToListAsync();
        _db.ListingTags.RemoveRange(existing);
        foreach (var tag in tags.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            _db.ListingTags.Add(new ListingTag { TenantId = TenantId(), ListingId = id, Tag = tag, TagType = "skill" });
        }
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = tags });
    }

    [HttpGet("api/v2/listings/tags/popular")]
    [HttpGet("api/v2/listings/tags/autocomplete")]
    public async Task<IActionResult> V2ListingTags([FromQuery] string? q = null)
    {
        var query = _db.ListingTags.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(q)) query = query.Where(t => t.Tag.ToLower().Contains(q.ToLower()));
        var tags = await query.GroupBy(t => t.Tag).OrderByDescending(g => g.Count()).Take(25).Select(g => new { tag = g.Key, count = g.Count() }).ToListAsync();
        return Ok(new { data = tags });
    }

    [HttpPost("api/ai/generate/listing")]
    [HttpPost("api/v2/listings/generate-description")]
    public IActionResult V2GenerateListingDescription([FromBody] JsonElement body)
    {
        var title = GetString(body, "title") ?? GetString(body, "keywords") ?? "Community listing";
        return Ok(new { success = true, description = $"Share details, availability, and expected time credits for {title}.", title });
    }

    [HttpGet("api/v2/listings/{id:int}/analytics")]
    [HttpPost("api/v2/listings/{id:int}/image")]
    [HttpDelete("api/v2/listings/{id:int}/image")]
    [HttpPost("api/v2/listings/{id:int}/images")]
    [HttpDelete("api/v2/listings/{id:int}/images/{imageId:int}")]
    [HttpPut("api/v2/listings/{id:int}/images/reorder")]
    [HttpPost("api/v2/listings/{id:int}/renew")]
    [HttpPost("api/v2/listings/{id:int}/report")]
    public IActionResult V2ListingLightweight(int id) => Ok(new { success = true, data = new { listing_id = id } });

    [HttpGet("api/v2/wallet/balance")]
    public async Task<IActionResult> V2WalletBalance()
    {
        var targetUserId = CurrentUserId();
        if (targetUserId == null) return Unauthorized(new { error = "Invalid token" });
        return await BuildWalletBalanceAsync(targetUserId.Value);
    }

    [HttpGet("api/partner/v1/wallet/balance/{userId:int}")]
    [AllowAnonymous]
    public async Task<IActionResult> PartnerWalletBalance(int userId)
    {
        // Partner federation endpoint: must be invoked through the federation
        // auth middleware (which sets FederationTenantId on HttpContext.Items).
        // Without that context, treat as unauthorized — never let an ordinary
        // authenticated user pass an arbitrary userId here.
        if (!TryRequirePartnerScope("wallet.read", out var partnerResult, out _))
        {
            return partnerResult!;
        }

        if (!await IsPartnerWalletUserAsync(TenantId(), userId))
        {
            return PartnerError("USER_NOT_FOUND", "User not found.", 404);
        }

        var received = await _db.Transactions.Where(t => t.ReceiverId == userId && t.Status == TransactionStatus.Completed).SumAsync(t => t.Amount);
        var sent = await _db.Transactions.Where(t => t.SenderId == userId && t.Status == TransactionStatus.Completed).SumAsync(t => t.Amount);
        return PartnerData(new
        {
            user_id = userId,
            balance_hours = Math.Round(received - sent, 4),
            currency = "time_credits"
        });
    }

    private async Task<IActionResult> BuildWalletBalanceAsync(int targetUserId)
    {
        var received = await _db.Transactions.Where(t => t.ReceiverId == targetUserId && t.Status == TransactionStatus.Completed).SumAsync(t => t.Amount);
        var sent = await _db.Transactions.Where(t => t.SenderId == targetUserId && t.Status == TransactionStatus.Completed).SumAsync(t => t.Amount);
        var visibleReceived = await _db.Transactions
            .Where(t => t.ReceiverId == targetUserId
                && t.Status == TransactionStatus.Completed
                && t.TransactionType != PersonalWalletLedgerService.VolunteerOrganisationBalanceAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringLoyaltyAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringHourEstateAdapterTransactionType)
            .SumAsync(t => t.Amount);
        var visibleSent = await _db.Transactions
            .Where(t => t.SenderId == targetUserId
                && t.Status == TransactionStatus.Completed
                && t.TransactionType != PersonalWalletLedgerService.VolunteerOrganisationBalanceAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringLoyaltyAdapterTransactionType
                && t.TransactionType != PersonalWalletLedgerService.CaringHourEstateAdapterTransactionType)
            .SumAsync(t => t.Amount);
        return Ok(new { balance = received - sent, currency = "hours", received_total = visibleReceived, sent_total = visibleSent });
    }

    [HttpGet("api/v2/wallet/transactions")]
    [HttpGet("api/v2/wallet/statement")]
    public async Task<IActionResult> V2WalletTransactions([FromQuery] int page = 1, [FromQuery] int limit = 20)
    {
        var userId = CurrentUserId();
        if (!userId.HasValue) return Unauthorized(new { error = "Invalid token" });
        var tenantId = TenantId();
        var query = _db.Transactions.AsNoTracking().Where(t =>
            t.TenantId == tenantId
            && t.TransactionType != PersonalWalletLedgerService.VolunteerOrganisationBalanceAdapterTransactionType
            && t.TransactionType != PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType
            && t.TransactionType != PersonalWalletLedgerService.CaringLoyaltyAdapterTransactionType
            && t.TransactionType != PersonalWalletLedgerService.CaringHourEstateAdapterTransactionType
            && ((t.SenderId == userId.Value && !t.DeletedForSender)
                || (t.ReceiverId == userId.Value && !t.DeletedForReceiver)));
        var total = await query.CountAsync();
        var data = await query.OrderByDescending(t => t.CreatedAt).Skip(Skip(page, limit)).Take(Limit(limit)).Select(t => new
        {
            id = t.Id,
            amount = t.Amount,
            description = t.Description,
            type = t.SenderId == userId ? "debit" : "credit",
            status = t.Status.ToString().ToLowerInvariant(),
            created_at = t.CreatedAt
        }).ToListAsync();
        return Ok(Paged(data, page, limit, total));
    }

    [HttpGet("api/v2/wallet/transactions/{id:int}")]
    public async Task<IActionResult> V2WalletTransaction(int id)
    {
        var userId = CurrentUserId();
        if (!userId.HasValue) return Unauthorized(new { error = "Invalid token" });
        var tenantId = TenantId();
        var tx = await _db.Transactions.AsNoTracking().FirstOrDefaultAsync(t =>
            t.Id == id
            && t.TenantId == tenantId
            && t.TransactionType != PersonalWalletLedgerService.VolunteerOrganisationBalanceAdapterTransactionType
            && t.TransactionType != PersonalWalletLedgerService.CaringHourGiftAdapterTransactionType
            && t.TransactionType != PersonalWalletLedgerService.CaringLoyaltyAdapterTransactionType
            && t.TransactionType != PersonalWalletLedgerService.CaringHourEstateAdapterTransactionType
            && ((t.SenderId == userId.Value && !t.DeletedForSender)
                || (t.ReceiverId == userId.Value && !t.DeletedForReceiver)));
        return tx == null ? NotFound(new { error = "Transaction not found" }) : Ok(new { data = tx });
    }

    [HttpDelete("api/v2/wallet/transactions/{id:int}")]
    public async Task<IActionResult> V2DeleteWalletTransaction(int id)
    {
        var userId = CurrentUserId();
        if (!userId.HasValue) return Unauthorized(new { error = "Invalid token" });
        var tenantId = TenantId();
        var tx = await _db.Transactions.FirstOrDefaultAsync(t =>
            t.Id == id
            && t.TenantId == tenantId
            && (t.SenderId == userId.Value || t.ReceiverId == userId.Value));
        if (tx == null) return NotFound(new { error = "Transaction not found" });

        if (tx.SenderId == userId.Value)
            tx.DeletedForSender = true;
        if (tx.ReceiverId == userId.Value)
            tx.DeletedForReceiver = true;
        tx.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPost("api/v2/wallet/transfer")]
    [EnableRateLimiting(RateLimitingExtensions.PersonalWalletTransferPolicy)]
    public async Task<IActionResult> V2WalletTransfer(
        [FromBody] JsonElement body,
        CancellationToken cancellationToken = default)
    {
        var senderId = CurrentUserId();
        if (!senderId.HasValue) return Unauthorized(new { error = "Invalid token" });
        var tenantId = TenantId();
        Response.Headers[ApiVersionHeader] = ApiVersion;
        Response.Headers["X-Tenant-ID"] = tenantId.ToString();
        var recipient = GetString(body, "recipient")
            ?? GetString(body, "recipient_id")
            ?? GetString(body, "user_id")
            ?? GetString(body, "username")
            ?? GetString(body, "email")
            ?? GetString(body, "receiver_id");
        var bodyIdempotencyKey = GetString(body, "idempotency_key")?.Trim();
        var idempotencyKey = string.IsNullOrWhiteSpace(bodyIdempotencyKey)
            ? Request.Headers["Idempotency-Key"].FirstOrDefault()
            : bodyIdempotencyKey;
        var result = await _personalWallet.TransferAsync(
            tenantId,
            senderId.Value,
            recipient,
            GetDecimal(body, "amount") ?? 0m,
            GetString(body, "description") ?? GetString(body, "message"),
            idempotencyKey,
            cancellationToken);
        if (!result.Success)
        {
            var status = result.ErrorCode switch
            {
                "NOT_FOUND" => StatusCodes.Status404NotFound,
                "INSUFFICIENT_FUNDS" or "VALIDATION_ERROR" => StatusCodes.Status400BadRequest,
                "DUPLICATE_TRANSACTION" => StatusCodes.Status409Conflict,
                "SERVER_ERROR" => StatusCodes.Status500InternalServerError,
                _ => StatusCodes.Status422UnprocessableEntity
            };
            return StatusCode(status, new
            {
                errors = new[] { new { code = result.ErrorCode, message = result.ErrorMessage } }
            });
        }

        await _transferEffects.RunAsync(tenantId, result);

        return StatusCode(StatusCodes.Status201Created, new
        {
            data = new
            {
                id = result.TransactionId,
                type = "debit",
                status = "completed",
                amount = result.Amount,
                description = result.Description,
                transaction_type = "transfer",
                sender = new
                {
                    id = result.SenderId,
                    name = $"{result.SenderFirstName} {result.SenderLastName}".Trim(),
                    avatar = result.SenderAvatarUrl
                },
                receiver = new
                {
                    id = result.ReceiverId,
                    name = $"{result.ReceiverFirstName} {result.ReceiverLastName}".Trim(),
                    avatar = result.ReceiverAvatarUrl
                },
                other_user = new
                {
                    id = result.ReceiverId,
                    name = $"{result.ReceiverFirstName} {result.ReceiverLastName}".Trim(),
                    avatar = result.ReceiverAvatarUrl
                },
                balance_after = (decimal?)null,
                created_at = result.CreatedAt
            },
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    [HttpPost("api/partner/v1/wallet/credit")]
    [AllowAnonymous]
    public async Task<IActionResult> PartnerWalletCredit([FromBody] JsonElement body)
    {
        if (!TryRequirePartnerScope("wallet.write", out var partnerResult, out var partner))
        {
            return partnerResult!;
        }

        var userId = GetInt(body, "user_id") ?? 0;
        var hours = GetDecimal(body, "hours") ?? 0m;
        var reference = GetString(body, "reference")?.Trim() ?? string.Empty;
        var note = GetString(body, "note")?.Trim();
        if (userId <= 0 || hours <= 0 || string.IsNullOrWhiteSpace(reference))
        {
            return PartnerError("invalid_request", "user_id, hours and reference are required.", 422);
        }

        if (hours > 24m || decimal.Round(hours, 2) != hours || reference.Length > 191)
        {
            return PartnerError("invalid_request", "The supplied amount or reference is invalid.", 422);
        }

        var tenantId = TenantId();
        var referenceNormalized = reference.ToUpperInvariant();
        if (referenceNormalized.Length > 191)
        {
            return PartnerError("invalid_request", "The supplied reference is invalid.", 422);
        }
        if (partner is null || partner.TenantId != tenantId)
        {
            return PartnerError("invalid_partner", "Partner authentication is invalid.", 403);
        }

        if (!await IsPartnerWalletUserAsync(tenantId, userId))
        {
            return PartnerError("USER_NOT_FOUND", "User not found.", 404);
        }

        await using var databaseTransaction = _db.Database.IsRelational()
            ? await _db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted)
            : null;
        if (databaseTransaction is not null)
        {
            var lockHash = SHA256.HashData(Encoding.UTF8.GetBytes($"{partner.Id:N}|{referenceNormalized}"));
            var lockKey = BitConverter.ToInt32(lockHash, 0);
            await _db.Database.ExecuteSqlRawAsync(
                "SELECT pg_advisory_xact_lock({0}, {1})",
                -17001,
                lockKey);
        }

        var credit = await _db.ApiPartnerWalletCredits
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(row => row.TenantId == tenantId
                && row.PartnerId == partner.Id
                && row.ReferenceNormalized == referenceNormalized);
        if (credit is not null
            && (credit.UserId != userId || credit.Hours != hours))
        {
            if (databaseTransaction is not null)
            {
                await databaseTransaction.RollbackAsync();
            }
            return PartnerError(
                "idempotency_conflict",
                "This partner reference was already used for a different wallet credit.",
                409);
        }

        if (credit?.TransactionId is int replayTransactionId)
        {
            if (databaseTransaction is not null)
            {
                await databaseTransaction.RollbackAsync();
            }
            return PartnerData(new
            {
                transaction_id = replayTransactionId,
                user_id = userId,
                hours,
                reference,
                replayed = true
            });
        }

        var now = DateTime.UtcNow;
        if (credit is null)
        {
            credit = new ApiPartnerWalletCredit
            {
                TenantId = tenantId,
                PartnerId = partner.Id,
                UserId = userId,
                Reference = reference,
                ReferenceNormalized = referenceNormalized,
                Hours = hours,
                Status = "processing",
                CreatedAt = now,
                UpdatedAt = now
            };
            _db.ApiPartnerWalletCredits.Add(credit);
        }

        if (databaseTransaction is not null)
        {
            await _personalWallet.AcquireSpendLockAsync(userId);
        }
        if (!await IsPartnerWalletUserAsync(tenantId, userId))
        {
            if (databaseTransaction is not null)
            {
                await databaseTransaction.RollbackAsync();
            }
            return PartnerError("USER_NOT_FOUND", "User not found.", 404);
        }

        var description = $"Partner wallet credit from {partner.Name} ({reference})";
        if (!string.IsNullOrWhiteSpace(note))
        {
            description += $": {note}";
        }

        var tx = new Transaction
        {
            TenantId = tenantId,
            SenderId = null,
            ReceiverId = userId,
            Amount = hours,
            Description = description,
            TransactionType = "other",
            Status = TransactionStatus.Completed,
            CreatedAt = now
        };
        _db.Transactions.Add(tx);
        await _db.SaveChangesAsync();
        credit.TransactionId = tx.Id;
        credit.Status = "completed";
        credit.CompletedAt = now;
        credit.UpdatedAt = now;
        await _db.SaveChangesAsync();
        if (databaseTransaction is not null)
        {
            await databaseTransaction.CommitAsync();
        }

        return PartnerData(new
        {
            transaction_id = tx.Id,
            user_id = userId,
            hours = tx.Amount,
            reference,
            replayed = false
        }, 201);
    }

    [HttpGet("api/v2/wallet/categories")]
    public async Task<IActionResult> V2WalletCategories() => Ok(new { data = await _db.TransactionCategories.AsNoTracking().ToListAsync() });

    [HttpPost("api/v2/wallet/categories")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> V2CreateWalletCategory([FromBody] JsonElement body)
    {
        var category = new TransactionCategory { TenantId = TenantId(), Name = GetString(body, "name") ?? "General", Description = GetString(body, "description"), Color = GetString(body, "color"), Icon = GetString(body, "icon") };
        _db.TransactionCategories.Add(category);
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = category });
    }

    [HttpPut("api/v2/wallet/categories/{id:int}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> V2UpdateWalletCategory(int id, [FromBody] JsonElement body)
    {
        var category = await _db.TransactionCategories.FirstOrDefaultAsync(c => c.Id == id);
        if (category == null) return NotFound(new { error = "Category not found" });
        category.Name = GetString(body, "name") ?? category.Name;
        category.Description = GetString(body, "description") ?? category.Description;
        category.Color = GetString(body, "color") ?? category.Color;
        category.Icon = GetString(body, "icon") ?? category.Icon;
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = category });
    }

    [HttpDelete("api/v2/wallet/categories/{id:int}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> V2DeleteWalletCategory(int id)
    {
        var category = await _db.TransactionCategories.FirstOrDefaultAsync(c => c.Id == id);
        if (category != null)
        {
            _db.TransactionCategories.Remove(category);
            await _db.SaveChangesAsync();
        }
        return Ok(new { success = true });
    }

    [HttpPost("api/v2/wallet/donate")]
    [HttpPost("api/v2/wallet/community-fund/donate")]
    [HttpPost("api/v2/wallet/community-fund/deposit")]
    [HttpPost("api/v2/wallet/community-fund/withdraw")]
    public IActionResult V2WalletDonation() => StatusCode(StatusCodes.Status503ServiceUnavailable, new
    {
        error = "This compatibility route cannot safely record a wallet donation. Use the canonical wallet donation endpoint."
    });

    [HttpGet("api/v2/wallet/donations")]
    public async Task<IActionResult> V2WalletDonations()
    {
        var userId = CurrentUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });
        return Ok(new
        {
            data = await _db.CreditDonations
                .AsNoTracking()
                .Where(d => d.DonorId == userId.Value || d.RecipientId == userId.Value)
                .OrderByDescending(d => d.CreatedAt)
                .Take(50)
                .ToListAsync()
        });
    }

    [HttpGet("api/v2/wallet/community-fund")]
    public async Task<IActionResult> V2CommunityFund()
    {
        var donations = _db.CreditDonations
            .AsNoTracking()
            .Where(donation => donation.RecipientId == null);
        var totalDonated = await donations.SumAsync(donation => (decimal?)donation.Amount) ?? 0m;

        return Ok(new
        {
            data = new
            {
                id = (int?)null,
                balance = totalDonated,
                total_deposited = 0m,
                total_withdrawn = 0m,
                total_donated = totalDonated,
                description = "Community time credit fund"
            }
        });
    }

    [HttpGet("api/v2/wallet/community-fund/transactions")]
    public async Task<IActionResult> V2CommunityFundTransactions(
        [FromQuery] int limit = 20,
        [FromQuery] int offset = 0)
    {
        limit = Math.Clamp(limit, 1, 100);
        offset = Math.Max(offset, 0);
        var rows = await _db.CreditDonations
            .AsNoTracking()
            .Include(donation => donation.Donor)
            .Where(donation => donation.RecipientId == null)
            .OrderBy(donation => donation.CreatedAt)
            .ThenBy(donation => donation.Id)
            .ToListAsync();

        var running = 0m;
        var projected = rows.Select(donation =>
        {
            running += donation.Amount;
            return new
            {
                donation.Id,
                type = "donation",
                donation.Amount,
                balance_after = running,
                description = donation.Message ?? string.Empty,
                user_id = donation.IsAnonymous ? null : (int?)donation.DonorId,
                user_name = donation.IsAnonymous || donation.Donor == null
                    ? string.Empty
                    : (donation.Donor.FirstName + " " + donation.Donor.LastName).Trim(),
                user_avatar = donation.IsAnonymous ? string.Empty : donation.Donor?.AvatarUrl ?? string.Empty,
                admin_id = (int?)null,
                admin_name = string.Empty,
                created_at = donation.CreatedAt
            };
        }).Reverse().Skip(offset).Take(limit).ToArray();

        return Ok(new { data = projected, meta = new { total = rows.Count } });
    }

    [HttpGet("api/v2/wallet/pending-count")]
    public async Task<IActionResult> V2WalletPendingCount()
    {
        var userId = CurrentUserId();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });
        var count = await _db.Transactions.CountAsync(transaction =>
            (transaction.SenderId == userId.Value || transaction.ReceiverId == userId.Value) &&
            transaction.Status == TransactionStatus.Pending);
        return Ok(new { count });
    }

    [HttpGet("api/v2/wallet/starting-balance")]
    public async Task<IActionResult> V2GetStartingBalance()
    {
        const string primaryKey = "wallet.starting_balance";
        const string legacyKey = "general.welcome_credits";
        var values = await _db.TenantConfigs
            .AsNoTracking()
            .Where(config => config.Key == primaryKey || config.Key == legacyKey)
            .ToDictionaryAsync(config => config.Key, config => config.Value);
        var raw = values.GetValueOrDefault(primaryKey) ?? values.GetValueOrDefault(legacyKey) ?? "5";
        var amount = decimal.TryParse(raw, NumberStyles.Number, CultureInfo.InvariantCulture, out var parsed)
            ? Math.Max(0m, parsed)
            : 5m;
        return Ok(new { data = new { starting_balance = amount } });
    }

    [HttpPut("api/v2/wallet/starting-balance")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> V2SetStartingBalance([FromBody] JsonElement body)
    {
        var requested = GetDecimal(body, "amount");
        if (!requested.HasValue)
        {
            return BadRequest(new { error = "amount is required" });
        }

        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var amount = Math.Max(0m, requested.Value);
        var row = await _db.TenantConfigs
            .FirstOrDefaultAsync(config => config.Key == "wallet.starting_balance");
        if (row == null)
        {
            row = new TenantConfig
            {
                TenantId = tenantId,
                Key = "wallet.starting_balance",
                CreatedAt = DateTime.UtcNow
            };
            _db.TenantConfigs.Add(row);
        }

        row.Value = amount.ToString(CultureInfo.InvariantCulture);
        row.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();
        return Ok(new
        {
            data = new
            {
                starting_balance = amount,
                message = "Starting balance updated"
            }
        });
    }

    [HttpGet("api/v2/wallet/user-search")]
    [HttpPost("api/wallet/user-search")]
    [EnableRateLimiting(RateLimitingExtensions.PersonalWalletUserSearchPolicy)]
    public async Task<IActionResult> V2WalletUserSearch([FromQuery] string? q = null)
    {
        var userId = CurrentUserId();
        var term = q?.Trim();
        if (userId is null) return Unauthorized(new { error = "Invalid token" });
        if (string.IsNullOrWhiteSpace(term)) return Ok(new { data = new { users = Array.Empty<object>() } });

        var normalized = term.ToLowerInvariant();
        var users = await _db.Users
            .AsNoTracking()
            .Where(u => u.Id != userId.Value
                && u.IsActive
                && u.SuspendedAt == null
                && (u.FirstName.ToLower().Contains(normalized)
                    || u.LastName.ToLower().Contains(normalized)
                    || (u.FirstName + " " + u.LastName).ToLower().Contains(normalized)))
            .Take(20)
            .Select(u => new
            {
                id = u.Id,
                username = (string?)null,
                name = (u.FirstName + " " + u.LastName).Trim(),
                first_name = u.FirstName,
                last_name = u.LastName,
                avatar = u.AvatarUrl
            })
            .ToListAsync();
        return Ok(new { data = new { users } });
    }

    [HttpGet("api/organizations/{id:int}/wallet/balance")]
    [HttpGet("api/organisations/{id:int}/wallet/balance")]
    public async Task<IActionResult> V2OrganisationWallet(int id)
    {
        var userId = CurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var access = await _organisationService.GetWalletAccessAsync(id, userId.Value);
        if (!access.Exists) return NotFound(new { error = "Organisation not found" });
        if (!access.Allowed)
            return StatusCode(403, new { error = "You must be a member of this organisation" });

        var wallet = await _orgWalletService.GetWalletAsync(id);
        if (wallet == null) return NotFound(new { error = "Wallet not found" });

        return Ok(new
        {
            data = new
            {
                wallet.Id,
                organisation_id = wallet.OrganisationId,
                wallet.Balance,
                total_received = wallet.TotalReceived,
                total_spent = wallet.TotalSpent,
                created_at = wallet.CreatedAt
            },
            balance = wallet.Balance
        });
    }

    [HttpGet("api/organizations/{id:int}/wallet/transactions")]
    public async Task<IActionResult> V2OrganisationWalletTransactions(int id)
    {
        var userId = CurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var access = await _organisationService.GetWalletAccessAsync(id, userId.Value);
        if (!access.Exists) return NotFound(new { error = "Organisation not found" });
        if (!access.Allowed)
            return StatusCode(403, new { error = "You must be a member of this organisation" });

        var wallet = await _orgWalletService.GetWalletAsync(id);
        if (wallet == null) return NotFound(new { error = "Wallet not found" });

        var transactions = await _orgWalletService.GetTransactionsAsync(id, page: 1, limit: 100);
        return Ok(new
        {
            data = transactions.Select(transaction => new
            {
                transaction.Id,
                transaction.Type,
                transaction.Amount,
                balance_after = transaction.BalanceAfter,
                transaction.Category,
                transaction.Description,
                created_at = transaction.CreatedAt,
                initiated_by = transaction.InitiatedBy != null
                    ? new { transaction.InitiatedBy.Id, transaction.InitiatedBy.FirstName, transaction.InitiatedBy.LastName }
                    : null,
                from_user = transaction.FromUser != null
                    ? new { transaction.FromUser.Id, transaction.FromUser.FirstName, transaction.FromUser.LastName }
                    : null,
                to_user = transaction.ToUser != null
                    ? new { transaction.ToUser.Id, transaction.ToUser.FirstName, transaction.ToUser.LastName }
                    : null
            })
        });
    }

    [HttpGet("api/organizations/{id:int}/members")]
    public async Task<IActionResult> V2OrganisationMembers(int id)
    {
        var userId = CurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var members = await _organisationService.GetMembersAsync(id, userId.Value);
        if (members == null) return NotFound(new { error = "Organisation not found" });

        return Ok(new
        {
            data = members.Select(member => new
            {
                id = member.Id,
                user_id = member.UserId,
                role = member.Role,
                joined_at = member.JoinedAt,
                user = member.User != null
                    ? new { member.User.Id, member.User.FirstName, member.User.LastName }
                    : null
            })
        });
    }

    [HttpGet("api/v2/conversations/{id:int}/messages")]
    [HttpGet("api/ai/conversations/{id:int}")]
    public async Task<IActionResult> V2ConversationMessages(int id)
    {
        var messages = await _db.Messages.AsNoTracking().Where(m => m.ConversationId == id).OrderBy(m => m.CreatedAt)
            .Select(m => new { id = m.Id, conversation_id = m.ConversationId, sender_id = m.SenderId, content = m.Content, is_read = m.IsRead, created_at = m.CreatedAt }).ToListAsync();
        return Ok(new { data = messages });
    }

    [HttpGet("api/v2/conversations/groups")]
    public async Task<IActionResult> V2Messages()
    {
        var userId = CurrentUserId();
        var data = await _db.Conversations.AsNoTracking().Where(c => c.Participant1Id == userId || c.Participant2Id == userId)
            .OrderByDescending(c => c.UpdatedAt ?? c.CreatedAt).Take(50)
            .Select(c => new { id = c.Id, participant1_id = c.Participant1Id, participant2_id = c.Participant2Id, created_at = c.CreatedAt, updated_at = c.UpdatedAt }).ToListAsync();
        return Ok(new { data });
    }

    [HttpPost("api/v2/conversations/{id:int}/messages")]
    public async Task<IActionResult> V2SendConversationMessage(int id, [FromBody] JsonElement body)
    {
        var userId = CurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var message = new Message { TenantId = TenantId(), ConversationId = id, SenderId = userId.Value, Content = GetString(body, "content") ?? GetString(body, "message") ?? string.Empty };
        _db.Messages.Add(message);
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = message });
    }

    [HttpPost("api/v2/conversations/groups")]
    public async Task<IActionResult> V2CreateGroupConversation([FromBody] JsonElement body)
    {
        var userId = CurrentUserId();
        var otherId = GetInt(body, "participant_id") ?? GetInt(body, "user_id");
        if (userId == null || otherId == null) return BadRequest(new { error = "participant_id is required" });
        var conversation = new Conversation { TenantId = TenantId(), Participant1Id = userId.Value, Participant2Id = otherId.Value };
        _db.Conversations.Add(conversation);
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = conversation });
    }

    [HttpGet("api/v2/conversations/{id:int}/participants")]
    public async Task<IActionResult> V2ConversationParticipants(int id)
    {
        var c = await _db.Conversations.AsNoTracking().FirstOrDefaultAsync(x => x.Id == id);
        return c == null ? NotFound(new { error = "Conversation not found" }) : Ok(new { data = new[] { c.Participant1Id, c.Participant2Id } });
    }

    [HttpPost("api/v2/conversations/{id:int}/participants")]
    [HttpDelete("api/v2/conversations/{id:int}/participants/{userId:int}")]
    [HttpPatch("api/v2/conversations/{id:int}/group")]
    public IActionResult V2ConversationLightweight(int id) => Ok(new { success = true, conversation_id = id });

    [HttpDelete("api/ai/conversations/{id:int}")]
    public async Task<IActionResult> V2DeleteConversation(int id)
    {
        var messages = await _db.Messages.Where(m => m.ConversationId == id).ToListAsync();
        _db.Messages.RemoveRange(messages);
        var conversation = await _db.Conversations.FirstOrDefaultAsync(c => c.Id == id);
        if (conversation != null) _db.Conversations.Remove(conversation);
        await _db.SaveChangesAsync();
        return Ok(new { success = true });
    }

    [HttpGet("api/v2/explore")]
    [HttpGet("api/v2/explore/for-you")]
    [HttpGet("api/v2/explore/trending")]
    [HttpGet("api/v2/explore/popular-listings")]
    [HttpGet("api/v2/explore/category/{slug}")]
    public async Task<IActionResult> V2Explore()
    {
        var listings = await _db.Listings.AsNoTracking().Where(l => l.DeletedAt == null).OrderByDescending(l => l.IsFeatured).ThenByDescending(l => l.CreatedAt).Take(12)
            .Select(l => new { id = l.Id, title = l.Title, type = "listing", score = l.ViewCount }).ToListAsync();
        var events = await _db.Events.AsNoTracking().Where(e => !e.IsCancelled && e.StartsAt >= DateTime.UtcNow).OrderBy(e => e.StartsAt).Take(8)
            .Select(e => new { id = e.Id, title = e.Title, type = "event", score = 0 }).ToListAsync();
        return Ok(new { data = listings.Concat(events), generated_at = DateTime.UtcNow });
    }

    [HttpGet("api/v2/explore/analytics")]
    [HttpGet("api/v2/explore/experiments")]
    [HttpPost("api/v2/explore/track")]
    [HttpPost("api/v2/explore/dismiss")]
    public IActionResult V2ExploreLightweight() => Ok(new { success = true, data = Array.Empty<object>() });

    [HttpGet("api/recommendations/metrics")]
    [HttpGet("api/v2/groups/recommendations/metrics")]
    [HttpGet("api/v2/metrics/summary")]
    public async Task<IActionResult> V2MetricsSummary()
    {
        return Ok(new
        {
            users = await _db.Users.CountAsync(),
            listings = await _db.Listings.CountAsync(l => l.DeletedAt == null),
            events = await _db.Events.CountAsync(e => !e.IsCancelled),
            transactions = await _db.Transactions.CountAsync(),
            generated_at = DateTime.UtcNow
        });
    }

    [HttpPost("api/v2/metrics")]
    public IActionResult V2MetricsIngest() => Accepted(new { success = true });

    [HttpPost("api/v2/exchanges/{id:int}/rate")]
    [HttpGet("api/v2/exchanges/{id:int}/ratings")]
    [HttpGet("api/v2/users/{id:int}/rating")]
    [HttpGet("api/me/reports/{id:int}/download")]
    public IActionResult V2SmallClusterLightweight(int id) => Ok(new { success = true, data = Array.Empty<object>(), id });

    [HttpGet("api/partner/v1/aggregates/community")]
    [AllowAnonymous]
    public async Task<IActionResult> PartnerCommunityAggregate()
    {
        if (!TryRequirePartnerScope("aggregates.read", out var partnerResult, out _))
        {
            return partnerResult!;
        }

        var tenantId = TenantId();
        var activeMembers = await _db.Users.CountAsync(u => u.TenantId == tenantId && u.IsActive);
        var activeListings = await _db.Listings.CountAsync(l => l.TenantId == tenantId && l.Status == ListingStatus.Active && l.DeletedAt == null);
        return PartnerData(new
        {
            tenant_id = tenantId,
            active_members_bucket = BucketCount(activeMembers),
            active_listings_bucket = BucketCount(activeListings),
            generated_at = DateTime.UtcNow
        });
    }

    [HttpGet("api/partner/v1/listings")]
    [AllowAnonymous]
    public async Task<IActionResult> PartnerListings([FromQuery] int page = 1, [FromQuery(Name = "per_page")] int perPage = 25)
    {
        if (!TryRequirePartnerScope("listings.read", out var partnerResult, out _))
        {
            return partnerResult!;
        }

        page = Math.Max(page, 1);
        perPage = Math.Clamp(perPage, 1, 100);
        var tenantId = TenantId();
        var query = _db.Listings.AsNoTracking()
            .Where(l => l.TenantId == tenantId
                && l.Status == ListingStatus.Active
                && l.DeletedAt == null
                && _db.Users.IgnoreQueryFilters().Any(owner =>
                    owner.TenantId == tenantId
                    && owner.Id == l.UserId
                    && owner.IsActive
                    && owner.SuspendedAt == null)
                && _db.FederationUserSettings.IgnoreQueryFilters().Any(settings =>
                    settings.TenantId == tenantId
                    && settings.UserId == l.UserId
                    && settings.FederationOptIn
                    && settings.ProfileVisible
                    && settings.ListingsVisible));
        var total = await query.CountAsync();
        var data = await query
            .OrderByDescending(l => l.Id)
            .Skip((page - 1) * perPage)
            .Take(perPage)
            .Select(l => new
            {
                id = l.Id,
                user_id = l.UserId,
                title = l.Title,
                type = l.Type.ToString().ToLowerInvariant(),
                created_at = l.CreatedAt
            })
            .ToListAsync();

        return PartnerPaginated(data, total, page, perPage);
    }

    [HttpGet("api/partner/v1/users")]
    [AllowAnonymous]
    public async Task<IActionResult> PartnerUsers([FromQuery] int page = 1, [FromQuery(Name = "per_page")] int perPage = 25)
    {
        if (!TryRequirePartnerScope("users.read", out var partnerResult, out _))
        {
            return partnerResult!;
        }

        page = Math.Max(page, 1);
        perPage = Math.Clamp(perPage, 1, 100);
        var tenantId = TenantId();
        var includePii = PartnerScopes().Contains("users.pii", StringComparer.OrdinalIgnoreCase);
        var query = _db.Users.AsNoTracking().Where(u => u.TenantId == tenantId
            && u.IsActive
            && u.SuspendedAt == null
            && _db.FederationUserSettings.IgnoreQueryFilters().Any(settings =>
                settings.TenantId == tenantId
                && settings.UserId == u.Id
                && settings.FederationOptIn
                && settings.ProfileVisible));
        var total = await query.CountAsync();
        var data = await query
            .OrderBy(u => u.Id)
            .Skip((page - 1) * perPage)
            .Take(perPage)
            .Select(u => new
            {
                id = u.Id,
                name = (u.FirstName + " " + u.LastName).Trim(),
                username = (string?)null,
                created_at = u.CreatedAt,
                status = u.IsActive ? "active" : "inactive",
                email = includePii ? u.Email : null
            })
            .ToListAsync();

        return PartnerPaginated(data, total, page, perPage);
    }

    [HttpGet("api/partner/v1/users/{id:int}")]
    [AllowAnonymous]
    public async Task<IActionResult> PartnerUser(int id)
    {
        if (!TryRequirePartnerScope("users.read", out var partnerResult, out _))
        {
            return partnerResult!;
        }

        var includePii = PartnerScopes().Contains("users.pii", StringComparer.OrdinalIgnoreCase);
        var tenantId = TenantId();
        var user = await _db.Users.AsNoTracking()
            .Where(u => u.TenantId == tenantId
                && u.Id == id
                && u.IsActive
                && u.SuspendedAt == null
                && _db.FederationUserSettings.IgnoreQueryFilters().Any(settings =>
                    settings.TenantId == tenantId
                    && settings.UserId == u.Id
                    && settings.FederationOptIn
                    && settings.ProfileVisible))
            .Select(u => new
            {
                user = new
                {
                    id = u.Id,
                    name = (u.FirstName + " " + u.LastName).Trim(),
                    username = (string?)null,
                    created_at = u.CreatedAt,
                    status = u.IsActive ? "active" : "inactive",
                    email = includePii ? u.Email : null
                }
            })
            .FirstOrDefaultAsync();

        return user == null ? PartnerError("USER_NOT_FOUND", "User not found.", 404) : PartnerData(user);
    }

    [HttpPost("api/partner/v1/oauth/token")]
    [AllowAnonymous]
    public async Task<IActionResult> PartnerToken([FromBody] JsonElement body)
    {
        var grantType = GetString(body, "grant_type") ?? string.Empty;
        if (!string.Equals(grantType, "client_credentials", StringComparison.Ordinal))
        {
            return PartnerError("unsupported_grant_type", "Only client_credentials is supported.", 400);
        }

        var clientId = GetString(body, "client_id") ?? BasicAuthClientId();
        var clientSecret = GetString(body, "client_secret") ?? BasicAuthClientSecret();
        if (string.IsNullOrWhiteSpace(clientId) || string.IsNullOrWhiteSpace(clientSecret))
        {
            return PartnerError("invalid_client", "client_id and client_secret are required.", 400);
        }

        var partner = await FindPartnerClientAsync(clientId, clientSecret);
        if (partner == null)
        {
            return PartnerError("invalid_client", "Client authentication failed.", 401);
        }

        var requestedScopes = (GetString(body, "scope") ?? string.Empty)
            .Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var allowedScopes = SplitScopes(partner.Scopes);
        var grantedScopes = requestedScopes.Length == 0
            ? allowedScopes
            : requestedScopes.Where(scope => allowedScopes.Contains(scope, StringComparer.OrdinalIgnoreCase)).ToArray();

        var accessToken = GeneratePartnerAccessToken(partner, grantedScopes);
        var expiresAt = DateTime.UtcNow.AddSeconds(PartnerTokenTtlSeconds);
        _db.ApiPartnerAccessTokens.Add(new ApiPartnerAccessToken
        {
            PartnerId = partner.Id,
            TenantId = partner.TenantId,
            AccessTokenHash = Sha256Hex(accessToken),
            Scopes = string.Join(' ', grantedScopes),
            ExpiresAt = expiresAt,
            CreatedAt = DateTime.UtcNow
        });
        await _db.SaveChangesAsync();

        return PartnerJson(new
        {
            access_token = accessToken,
            token_type = "bearer",
            expires_in = PartnerTokenTtlSeconds,
            scope = string.Join(' ', grantedScopes)
        });
    }

    [HttpPost("api/partner/v1/oauth/revoke")]
    [AllowAnonymous]
    public async Task<IActionResult> PartnerRevoke([FromBody] JsonElement body)
    {
        var clientId = GetString(body, "client_id") ?? BasicAuthClientId();
        var clientSecret = GetString(body, "client_secret") ?? BasicAuthClientSecret();
        if (string.IsNullOrWhiteSpace(clientId) || string.IsNullOrWhiteSpace(clientSecret))
        {
            return PartnerError("invalid_client", "client_id and client_secret are required.", 401);
        }

        var partner = await FindPartnerClientAsync(clientId, clientSecret);
        if (partner == null)
        {
            return PartnerError("invalid_client", "Client authentication failed.", 401);
        }

        var token = GetString(body, "token")?.Trim();
        if (!string.IsNullOrWhiteSpace(token))
        {
            var tokenHash = Sha256Hex(token);
            var row = await _db.ApiPartnerAccessTokens
                .IgnoreQueryFilters()
                .FirstOrDefaultAsync(candidate => candidate.PartnerId == partner.Id
                    && candidate.TenantId == partner.TenantId
                    && candidate.AccessTokenHash == tokenHash);
            if (row is not null && row.RevokedAt is null)
            {
                row.RevokedAt = DateTime.UtcNow;
                await _db.SaveChangesAsync();
            }
        }

        return PartnerJson(new { revoked = true });
    }

    [HttpGet("api/partner/v1/webhooks/subscriptions")]
    [AllowAnonymous]
    public IActionResult PartnerWebhookSubscriptions()
    {
        if (!TryRequirePartnerScope("webhooks.manage", out var partnerResult, out _))
        {
            return partnerResult!;
        }

        return PartnerError(
            "webhook_subscriptions_unavailable",
            "Webhook subscriptions are unavailable until durable storage is configured.",
            StatusCodes.Status503ServiceUnavailable);
    }

    [HttpPost("api/partner/v1/webhooks/subscriptions")]
    [AllowAnonymous]
    public IActionResult PartnerWebhookSubscriptionCreate()
    {
        if (!TryRequirePartnerScope("webhooks.manage", out var partnerResult, out _))
        {
            return partnerResult!;
        }

        return PartnerError(
            "webhook_subscriptions_unavailable",
            "Webhook subscriptions are unavailable until durable storage is configured.",
            StatusCodes.Status503ServiceUnavailable);
    }

    [HttpPost("api/webhooks/sendgrid/events")]
    [AllowAnonymous]
    public IActionResult SendgridEvents() => Accepted(new { success = true });

    private IActionResult PartnerJson(object payload, int status = 200)
    {
        Response.Headers[ApiVersionHeader] = ApiVersion;
        return StatusCode(status, payload);
    }

    private IActionResult PartnerData(object data, int status = 200)
    {
        return PartnerJson(new
        {
            data,
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        }, status);
    }

    private IActionResult PartnerPaginated<T>(IReadOnlyCollection<T> data, int total, int page, int perPage)
    {
        var totalPages = total > 0 ? (int)Math.Ceiling(total / (double)perPage) : 0;
        return PartnerJson(new
        {
            data,
            meta = new
            {
                base_url = $"{Request.Scheme}://{Request.Host}",
                current_page = page,
                per_page = perPage,
                total,
                total_pages = totalPages,
                has_more = page < totalPages
            }
        });
    }

    private IActionResult PartnerError(string code, string message, int status)
    {
        return PartnerJson(new
        {
            errors = new[]
            {
                new { code, message }
            }
        }, status);
    }

    private bool TryRequirePartnerScope(string requiredScope, out IActionResult? result, out ApiPartner? partner)
    {
        result = null;
        partner = null;

        if (User.Identity?.IsAuthenticated != true || User.FindFirst("partner_id")?.Value is not { Length: > 0 } partnerIdRaw)
        {
            result = PartnerError("AUTH_REQUIRED", "Partner bearer token required.", 401);
            return false;
        }

        if (!Guid.TryParse(partnerIdRaw, out var partnerId))
        {
            result = PartnerError("AUTH_REQUIRED", "Partner bearer token required.", 401);
            return false;
        }

        var scopes = PartnerScopes();
        if (!scopes.Contains(requiredScope, StringComparer.OrdinalIgnoreCase))
        {
            result = PartnerError("FORBIDDEN", "Required partner scope is missing.", 403);
            return false;
        }

        partner = _db.ApiPartners.IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefault(p => p.Id == partnerId
                && p.TenantId == TenantId()
                && p.Status == ApiPartnerStatus.Active);
        if (partner == null)
        {
            result = PartnerError("AUTH_REQUIRED", "Partner bearer token required.", 401);
            return false;
        }

        var bearerToken = PartnerBearerToken();
        if (string.IsNullOrWhiteSpace(bearerToken))
        {
            result = PartnerError("invalid_token", "The access token is invalid or expired.", 401);
            return false;
        }

        var tokenHash = Sha256Hex(bearerToken);
        var authorizedPartnerId = partner.Id;
        var authorizedTenantId = partner.TenantId;
        var tokenActive = _db.ApiPartnerAccessTokens
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Any(token => token.PartnerId == authorizedPartnerId
                && token.TenantId == authorizedTenantId
                && token.AccessTokenHash == tokenHash
                && token.RevokedAt == null
                && token.ExpiresAt > DateTime.UtcNow);
        if (!tokenActive)
        {
            result = PartnerError("invalid_token", "The access token is invalid or expired.", 401);
            return false;
        }

        if (!PartnerIpAllowed(partner, HttpContext.Connection.RemoteIpAddress))
        {
            result = PartnerError("ip_not_allowed", "Caller IP is not in the partner allowlist.", 403);
            return false;
        }

        if (partner.IsSandbox && !HttpMethods.IsGet(Request.Method) && !HttpMethods.IsHead(Request.Method))
        {
            result = PartnerError("sandbox_write_disabled", "Sandbox partners may only call read-only endpoints.", 403);
            return false;
        }

        if (!TryConsumePartnerRateLimit(partner, out var retryAfter))
        {
            Response.Headers["Retry-After"] = retryAfter.ToString();
            result = PartnerError("rate_limited", "Rate limit exceeded.", 429);
            return false;
        }

        return true;
    }

    private string? PartnerBearerToken()
    {
        var authorization = Request.Headers.Authorization.ToString();
        return authorization.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
            ? authorization["Bearer ".Length..].Trim()
            : null;
    }

    private bool TryConsumePartnerRateLimit(ApiPartner partner, out int retryAfter)
    {
        var limit = Math.Max(1, partner.RateLimitPerMinute);
        var now = DateTimeOffset.UtcNow;
        var minute = now.ToUnixTimeSeconds() / 60;
        retryAfter = Math.Max(1, 60 - now.Second);
        var cacheKey = $"partner-api-rate:{partner.Id:N}";
        var sync = PartnerRateLocks.GetOrAdd(partner.Id, static _ => new object());
        lock (sync)
        {
            _cache.TryGetValue(cacheKey, out PartnerRateWindow? window);
            var count = window is not null && window.Minute == minute ? window.Count : 0;
            Response.Headers["X-RateLimit-Limit"] = limit.ToString();
            if (count >= limit)
            {
                Response.Headers["X-RateLimit-Remaining"] = "0";
                return false;
            }

            count++;
            _cache.Set(
                cacheKey,
                new PartnerRateWindow(minute, count),
                TimeSpan.FromMinutes(2));
            Response.Headers["X-RateLimit-Remaining"] = Math.Max(0, limit - count).ToString();
            return true;
        }
    }

    private static bool PartnerIpAllowed(ApiPartner partner, IPAddress? remoteIp)
    {
        if (string.IsNullOrWhiteSpace(partner.AllowedIpCidrs))
            return true;
        if (remoteIp is null)
            return false;

        string[] cidrs;
        try
        {
            cidrs = JsonSerializer.Deserialize<string[]>(partner.AllowedIpCidrs) ?? [];
        }
        catch (JsonException)
        {
            return false;
        }
        if (cidrs.Length == 0)
            return true;

        return cidrs.Any(cidr => IpInCidr(remoteIp, cidr));
    }

    private static bool IpInCidr(IPAddress address, string rawCidr)
    {
        var parts = rawCidr.Trim().Split('/', 2, StringSplitOptions.TrimEntries);
        if (!IPAddress.TryParse(parts[0], out var network))
            return false;
        if (address.IsIPv4MappedToIPv6)
            address = address.MapToIPv4();
        if (network.IsIPv4MappedToIPv6)
            network = network.MapToIPv4();
        if (address.AddressFamily != network.AddressFamily)
            return false;
        if (parts.Length == 1)
            return address.Equals(network);
        if (!int.TryParse(parts[1], out var prefixLength))
            return false;

        var addressBytes = address.GetAddressBytes();
        var networkBytes = network.GetAddressBytes();
        if (prefixLength < 0 || prefixLength > addressBytes.Length * 8)
            return false;
        var fullBytes = prefixLength / 8;
        var remainingBits = prefixLength % 8;
        for (var index = 0; index < fullBytes; index++)
        {
            if (addressBytes[index] != networkBytes[index])
                return false;
        }
        if (remainingBits == 0)
            return true;

        var mask = (byte)(0xFF << (8 - remainingBits));
        return (addressBytes[fullBytes] & mask) == (networkBytes[fullBytes] & mask);
    }

    private sealed record PartnerRateWindow(long Minute, int Count);

    private async Task<bool> IsPartnerWalletUserAsync(int tenantId, int userId)
    {
        var userEligible = await _db.Users
            .IgnoreQueryFilters()
            .AnyAsync(user => user.Id == userId
                && user.TenantId == tenantId
                && user.IsActive
                && user.SuspendedAt == null);
        if (!userEligible)
        {
            return false;
        }

        return await _db.FederationUserSettings
            .IgnoreQueryFilters()
            .AnyAsync(settings => settings.TenantId == tenantId
                && settings.UserId == userId
                && settings.FederationOptIn
                && settings.ProfileVisible
                && settings.TransactionsEnabled);
    }

    private string[] PartnerScopes()
    {
        var scopeText = User.FindFirst("partner_scopes")?.Value ?? User.FindFirst("scope")?.Value ?? string.Empty;
        return scopeText.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    }

    private async Task<ApiPartner?> FindPartnerClientAsync(string clientId, string clientSecret)
    {
        if (!Guid.TryParse(clientId, out var partnerId))
        {
            return null;
        }

        var hash = Sha256Hex(clientSecret);
        return await _db.ApiPartners
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(p => p.Id == partnerId && p.ApiKeyHash == hash && p.Status == ApiPartnerStatus.Active);
    }

    private string GeneratePartnerAccessToken(ApiPartner partner, IEnumerable<string> scopes)
    {
        var secret = _config["Jwt:Secret"]
            ?? throw new InvalidOperationException("JWT secret not configured");
        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var credentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);
        var scopeText = string.Join(' ', scopes);
        var claims = new[]
        {
            new Claim(JwtRegisteredClaimNames.Sub, "0"),
            new Claim("tenant_id", partner.TenantId.ToString()),
            new Claim("role", "partner"),
            new Claim("partner_id", partner.Id.ToString()),
            new Claim("partner_scopes", scopeText),
            new Claim("scope", scopeText),
            new Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("N")),
            new Claim(JwtRegisteredClaimNames.Iat, DateTimeOffset.UtcNow.ToUnixTimeSeconds().ToString(), ClaimValueTypes.Integer64)
        };

        var token = new JwtSecurityToken(
            issuer: _config["Jwt:Issuer"],
            audience: _config["Jwt:Audience"],
            claims: claims,
            expires: DateTime.UtcNow.AddSeconds(PartnerTokenTtlSeconds),
            signingCredentials: credentials);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    private string? BasicAuthClientId() => BasicAuthParts()?.ClientId;

    private string? BasicAuthClientSecret() => BasicAuthParts()?.ClientSecret;

    private (string ClientId, string ClientSecret)? BasicAuthParts()
    {
        var auth = Request.Headers.Authorization.ToString();
        if (!auth.StartsWith("Basic ", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        try
        {
            var decoded = Encoding.UTF8.GetString(Convert.FromBase64String(auth["Basic ".Length..].Trim()));
            var separator = decoded.IndexOf(':', StringComparison.Ordinal);
            return separator <= 0
                ? null
                : (decoded[..separator], decoded[(separator + 1)..]);
        }
        catch (FormatException)
        {
            return null;
        }
    }

    private static string[] SplitScopes(string? scopes)
    {
        return string.IsNullOrWhiteSpace(scopes)
            ? Array.Empty<string>()
            : scopes.Split([',', ' '], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
    }

    private static string Sha256Hex(string value)
    {
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value))).ToLowerInvariant();
    }

    private static int BucketCount(int count)
    {
        if (count < 10)
        {
            return 0;
        }

        return count < 100 ? count / 10 * 10 : count / 100 * 100;
    }

    private int? CurrentUserId() => User.GetUserId();

    private int TenantId() => _tenantContext.TenantId ?? User.GetTenantId() ?? 0;

    private static int Limit(int limit) => Math.Clamp(limit, 1, 100);

    private static int Skip(int page, int limit) => (Math.Max(page, 1) - 1) * Limit(limit);

    private static object Paged<T>(IEnumerable<T> data, int page, int limit, int total) => new
    {
        data,
        pagination = new { page = Math.Max(page, 1), limit = Limit(limit), total, pages = (int)Math.Ceiling(total / (double)Limit(limit)) }
    };

    private static object EventDto(Event ev) => new
    {
        id = ev.Id,
        title = ev.Title,
        description = ev.Description,
        location = ev.Location,
        starts_at = ev.StartsAt,
        ends_at = ev.EndsAt,
        image_url = ev.ImageUrl,
        max_attendees = ev.MaxAttendees,
        is_cancelled = ev.IsCancelled,
        created_at = ev.CreatedAt
    };

    private static object ListingDto(Listing listing) => new
    {
        id = listing.Id,
        title = listing.Title,
        description = listing.Description,
        type = listing.Type.ToString().ToLowerInvariant(),
        status = listing.Status.ToString().ToLowerInvariant(),
        location = listing.Location,
        estimated_hours = listing.EstimatedHours,
        is_featured = listing.IsFeatured,
        view_count = listing.ViewCount,
        created_at = listing.CreatedAt,
        user_id = listing.UserId
    };

    private static string? GetString(JsonElement body, string name)
    {
        if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty(name, out var prop)) return null;
        return prop.ValueKind == JsonValueKind.String ? prop.GetString() : prop.ToString();
    }

    private static int? GetInt(JsonElement body, string name)
    {
        if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty(name, out var prop)) return null;
        if (prop.ValueKind == JsonValueKind.Number && prop.TryGetInt32(out var value)) return value;
        return int.TryParse(prop.ToString(), out var parsed) ? parsed : null;
    }

    private static decimal? GetDecimal(JsonElement body, string name)
    {
        if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty(name, out var prop)) return null;
        if (prop.ValueKind == JsonValueKind.Number && prop.TryGetDecimal(out var value)) return value;
        return decimal.TryParse(prop.ToString(), out var parsed) ? parsed : null;
    }

    private static DateTime? GetDate(JsonElement body, string name)
    {
        if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty(name, out var prop)) return null;
        return DateTime.TryParse(prop.ToString(), out var value) ? value.ToUniversalTime() : null;
    }

    private static string[] ReadStringArray(JsonElement body, string name)
    {
        if (body.ValueKind != JsonValueKind.Object || !body.TryGetProperty(name, out var prop) || prop.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<string>();
        }

        return prop.EnumerateArray().Select(x => x.ToString()).Where(x => !string.IsNullOrWhiteSpace(x)).ToArray();
    }
}
