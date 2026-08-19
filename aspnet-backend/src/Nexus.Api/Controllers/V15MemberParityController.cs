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
using Nexus.Api.Support;
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

    /// <summary>
    /// POST /api/v2/events — Laravel EventController::store.
    ///
    /// 🔴 This accepted anything and INVENTED what was missing. `title` fell back to
    /// the literal "Untitled event" and the start time to
    /// <c>DateTime.UtcNow.AddDays(7)</c> — so an event posted with no date at all was
    /// created a week from whenever the request happened to arrive, and an event
    /// posted with an unrecognised date field was silently given that fabricated one
    /// instead of the date the caller supplied. Laravel refuses both.
    ///
    /// Contract read from the running disposable Laravel on 2026-08-19:
    ///
    ///   - `title` required, `start_time` required
    ///   - refusal is 422 with a DIFFERENT envelope from the listing one:
    ///     <c>{"errors":[{"code":"validation_failed","message":"Validation failed",
    ///     "details":{"start_time":["The start time field is required."]}}],
    ///     "success":false}</c>
    ///   - `start_date` is NOT an accepted spelling: posting only `start_date`
    ///     returns the `start_time` required error. Laravel emits `start_date` in its
    ///     RESPONSE as a derived attribute, which is what makes this easy to get
    ///     backwards.
    ///
    /// 🔴 Laravel's error envelopes are per-endpoint, not global. Listings return
    /// `{"code":"VALIDATION_ERROR","field":…}`; this returns lowercase
    /// `validation_failed` with a `details` map of field to messages, plus
    /// `success:false`. Do not unify them — each was read from the live response.
    ///
    /// 🔴 `api/v2/events/series` shares this handler and therefore inherits the
    /// check. Laravel's series contract has NOT been measured; requiring a title and
    /// a start time is near-certainly a subset of what it demands, but if that route
    /// is ever compared directly it may need more (a recurrence rule) and should get
    /// its own handler rather than more branches here.
    /// </summary>
    [HttpPost("api/v2/events")]
    [HttpPost("api/v2/events/series")]
    public async Task<IActionResult> V2CreateEvent([FromBody] JsonElement body)
    {
        var userId = CurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        // Laravel collects every failure and returns them together, keyed by field.
        var details = new Dictionary<string, string[]>();

        var title = GetString(body, "title");
        if (string.IsNullOrWhiteSpace(title))
        {
            details["title"] = ["The title field is required."];
        }

        var startsAt = GetDate(body, "starts_at") ?? GetDate(body, "start_time");
        if (startsAt == null)
        {
            details["start_time"] = ["The start time field is required."];
        }

        if (details.Count > 0)
        {
            return UnprocessableEntity(new
            {
                errors = new[]
                {
                    new { code = "validation_failed", message = "Validation failed", details },
                },
                success = false,
            });
        }

        var ev = new Event
        {
            TenantId = TenantId(),
            CreatedById = userId.Value,
            Title = title!,
            Description = GetString(body, "description"),
            Location = GetString(body, "location"),
            StartsAt = startsAt!.Value,
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

    /// <summary>
    /// POST /api/v2/listings — create a listing.
    ///
    /// 🔴 This validated NOTHING, and worse, it INVENTED DATA: an absent title became
    /// the literal string "Untitled listing", an absent description was stored as null,
    /// an unparseable type silently became "offer", and no category was ever required.
    /// So a member — or a buggy client, or an empty form — could put a listing called
    /// "Untitled listing" into a real community. The write harness found it on its first
    /// run: Laravel answered 422 for the same body while this backend answered 201.
    ///
    /// Laravel refuses with ALL failures at once, 422, and Laravel's envelope:
    ///   {"errors":[{"code":"VALIDATION_ERROR","message":"...","field":"title"}, …]}
    /// Note the `field` key — a form uses it to mark the offending input.
    ///
    /// 🔴 THE RULES ARE PER-COMMUNITY CONFIGURATION, NOT CONSTANTS.
    /// ListingService::validateData reads them from listing configuration, so hardcoding
    /// them here would be wrong for any community that has changed them:
    ///   listing.min_title_length        (default 5)
    ///   listing.min_description_length  (default 20)
    ///   listing.require_category        (default true)
    ///   listing.allow_offers / allow_requests → the permitted `type` values
    /// The same keys and defaults this backend already publishes in
    /// /tenant/bootstrap's listing_config, so the switch and the enforcement finally
    /// read the same rows.
    /// </summary>
    [HttpPost("api/v2/listings")]
    public async Task<IActionResult> V2CreateListing([FromBody] JsonElement body)
    {
        var userId = CurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = TenantId();
        var config = await _db.Set<TenantConfig>().AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key.StartsWith("listing."))
            .ToDictionaryAsync(c => c.Key, c => c.Value);

        int ConfigInt(string key, int fallback, int min, int max) =>
            config.TryGetValue($"listing.{key}", out var raw) && int.TryParse(raw, out var v)
                ? Math.Clamp(v, min, max) : fallback;
        bool ConfigBool(string key, bool fallback) =>
            config.TryGetValue($"listing.{key}", out var raw)
                ? raw is "1" or "true" or "True" or "TRUE" : fallback;

        var minTitle = ConfigInt("min_title_length", 5, 1, 255);
        var minDescription = ConfigInt("min_description_length", 20, 1, 10000);
        var requireCategory = ConfigBool("require_category", true);

        var allowedTypes = new List<string>();
        if (ConfigBool("allow_offers", true)) allowedTypes.Add("offer");
        if (ConfigBool("allow_requests", true)) allowedTypes.Add("request");

        var title = GetString(body, "title");
        var description = GetString(body, "description");
        var typeRaw = GetString(body, "type");
        var categoryId = GetInt(body, "category_id");

        // 🔴 Collected, not short-circuited: Laravel reports every failure in one
        // response so a form can mark all of its bad fields at once.
        var errors = new List<object>();
        void Fail(string field, string message) =>
            errors.Add(new { code = "VALIDATION_ERROR", message, field });

        if (string.IsNullOrWhiteSpace(title)) Fail("title", "The title field is required.");
        else if (title.Trim().Length < minTitle)
            Fail("title", $"The title field must be at least {minTitle} characters.");
        else if (title.Trim().Length > 255)
            Fail("title", "The title field must not be greater than 255 characters.");

        if (string.IsNullOrWhiteSpace(description)) Fail("description", "The description field is required.");
        else if (description.Trim().Length < minDescription)
            Fail("description", $"The description field must be at least {minDescription} characters.");
        else if (description.Trim().Length > 10000)
            Fail("description", "The description field must not be greater than 10000 characters.");

        if (string.IsNullOrWhiteSpace(typeRaw)) Fail("type", "The type field is required.");
        else if (!allowedTypes.Contains(typeRaw.Trim().ToLowerInvariant()))
            Fail("type", "The selected type is invalid.");

        if (requireCategory && categoryId is null or <= 0)
            Fail("category_id", "The category id field is required.");

        if (errors.Count > 0)
        {
            return UnprocessableEntity(new { errors });
        }

        var listing = new Listing
        {
            TenantId = tenantId,
            UserId = userId.Value,
            Title = title!.Trim(),
            Description = description!.Trim(),
            Type = string.Equals(typeRaw!.Trim(), "request", StringComparison.OrdinalIgnoreCase)
                ? ListingType.Request
                : ListingType.Offer,
            CategoryId = categoryId,
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

    // 🔴 Anonymous, matching Laravel. popularTags carries an explicit
    // ->withoutMiddleware('auth:sanctum') at routes/api.php:556 -- somebody
    // deliberately opted it out of the auth group, which is about as clear an
    // intent signal as the routing file offers. Autocomplete keeps the
    // controller's default, since Laravel exposes only popular publicly.
    [AllowAnonymous]
    [HttpGet("api/v2/listings/tags/popular")]
    [HttpGet("api/v2/listings/tags/autocomplete")]
    public async Task<IActionResult> V2ListingTags([FromQuery] string? q = null)
    {
        var query = _db.ListingTags.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(q)) query = query.Where(t => t.Tag.ToLower().Contains(q.ToLower()));
        var tags = await query.GroupBy(t => t.Tag).OrderByDescending(g => g.Count()).Take(25).Select(g => new { tag = g.Key, count = g.Count() }).ToListAsync();
        return Ok(new
        {
            data = tags,
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
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
        return await BuildV2WalletBalanceAsync(targetUserId.Value);
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

    /// <summary>
    /// GET /api/v2/wallet/balance — the member's own wallet, in Laravel's shape.
    ///
    /// 🔴 Laravel wraps this in `data` and names the figures differently. Verified live
    /// 2026-08-19:
    ///   {"data":{"balance":N,"total_earned":N,"total_spent":N,"transaction_count":N,
    ///            "currency":"hours","pending_incoming":N,"pending_outgoing":N,
    ///            "pending_in":N,"pending_out":N},"meta":{...}}
    /// This backend sent {balance, currency, received_total, sent_total} at the ROOT, so
    /// a client reading data.total_earned got nothing from the production backend.
    ///
    /// 🔴 `pending_incoming`/`pending_outgoing` and `pending_in`/`pending_out` are BOTH
    /// sent, carrying the same values. That duplication is Laravel's, not a mistake here:
    /// the contract is what Laravel emits, and a client may read either spelling.
    ///
    /// 🔴 Deliberately NOT built on BuildWalletBalanceAsync. That helper also serves
    /// /api/partner/v1/wallet/balance/{userId}, a federation endpoint with its own
    /// contract and its own callers; re-shaping it would silently change the partner API.
    /// The computation is shared, the envelope is not.
    /// </summary>
    private async Task<IActionResult> BuildV2WalletBalanceAsync(int targetUserId)
    {
        var (balance, earned, spent, transactionCount, pendingIn, pendingOut) =
            await ComputeWalletFiguresAsync(targetUserId);

        return Ok(new
        {
            data = new
            {
                balance,
                total_earned = earned,
                total_spent = spent,
                transaction_count = transactionCount,
                currency = "hours",
                pending_incoming = pendingIn,
                pending_outgoing = pendingOut,
                pending_in = pendingIn,
                pending_out = pendingOut,
            }
        });
    }

    /// <summary>
    /// The wallet figures both the v2 member endpoint and the partner endpoint need.
    /// Adapter transaction types are excluded from the visible earned/spent totals for
    /// the same reason the partner helper excludes them: they are internal ledger
    /// movements, not exchanges the member made.
    /// </summary>
    private async Task<(decimal Balance, decimal Earned, decimal Spent, int Count, decimal PendingIn, decimal PendingOut)>
        ComputeWalletFiguresAsync(int targetUserId)
    {
        var received = await _db.Transactions
            .Where(t => t.ReceiverId == targetUserId && t.Status == TransactionStatus.Completed)
            .SumAsync(t => t.Amount);
        var sent = await _db.Transactions
            .Where(t => t.SenderId == targetUserId && t.Status == TransactionStatus.Completed)
            .SumAsync(t => t.Amount);

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

        var transactionCount = await _db.Transactions
            .CountAsync(t => (t.ReceiverId == targetUserId || t.SenderId == targetUserId)
                && t.Status == TransactionStatus.Completed);

        var pendingIn = await _db.Transactions
            .Where(t => t.ReceiverId == targetUserId && t.Status == TransactionStatus.Pending)
            .SumAsync(t => (decimal?)t.Amount) ?? 0m;
        var pendingOut = await _db.Transactions
            .Where(t => t.SenderId == targetUserId && t.Status == TransactionStatus.Pending)
            .SumAsync(t => (decimal?)t.Amount) ?? 0m;

        return (received - sent, visibleReceived, visibleSent, transactionCount, pendingIn, pendingOut);
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

    /// <summary>
    /// GET /api/v2/wallet/categories — the community's transaction categories.
    ///
    /// 🔴 CORRECTION. An earlier version of this comment said the query had no
    /// tenant predicate and "returned every community's categories". That was
    /// WRONG, and the mistake is worth recording so it is not repeated: an
    /// explicit `Where(TenantId == …)` is not the only thing that scopes a query
    /// here. `NexusDbContext.OnModelCreating` walks every entity type and applies
    /// `ApplyTenantQueryFilter` to anything implementing `ITenantEntity` (the
    /// reflection loop at :741-750), and `TransactionCategory` implements it. So
    /// the bare `_db.TransactionCategories.ToListAsync()` was already tenant-scoped.
    ///
    /// Verified rather than argued: a row was inserted for another tenant and this
    /// endpoint did not return it. The explicit `Where` below is kept because it
    /// makes the scoping legible at the call site, but it changed no behaviour.
    ///
    /// The real defects here were the envelope and the missing feature gate. It
    /// returned the raw entity, so the keys came out camelCase
    /// (`tenantId`, `isDefault`, `createdAt`) with a `tenant` navigation property
    /// attached, where Laravel sends snake_case and no tenant object.
    ///
    /// Contract from WalletFeaturesController::listCategories:190-201 — note the
    /// early return: when the community does not have the wallet switched on,
    /// Laravel answers `{"balance":0,"enabled":false}` rather than an empty list or
    /// a 403. A client checking `enabled` needs that exact body.
    /// </summary>
    [HttpGet("api/v2/wallet/categories")]
    public async Task<IActionResult> V2WalletCategories()
    {
        var tenantId = TenantId();

        // `wallet` is a MODULE in Laravel (MODULE_DEFAULTS), so it defaults ON.
        // Read through TenantFeatureKeys, which knows both stored spellings.
        var walletConfig = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && TenantFeatureKeys.BothKeys("wallet").Contains(c.Key))
            .ToDictionaryAsync(c => c.Key, c => c.Value ?? string.Empty);

        if (!TenantFeatureKeys.Read(walletConfig, "wallet", defaultValue: true))
        {
            return Ok(new { data = new { balance = 0, enabled = false } });
        }

        var data = await _db.TransactionCategories
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId)
            .OrderBy(c => c.Name)
            .Select(c => new
            {
                id = c.Id,
                tenant_id = c.TenantId,
                name = c.Name,
                description = c.Description,
                color = c.Color,
                icon = c.Icon,
                is_default = c.IsDefault,
                created_at = c.CreatedAt,
            })
            .ToListAsync();

        return Ok(new { data });
    }

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

    // ──────────────────────────────────────────────────────────────────────
    // Group conversations (R-25).
    //
    // 🔴 Every endpoint below was broken or a stub, while the React app ships a
    // working group-creation screen (pages/messages/components/CreateGroupModal.tsx).
    // Create read `participant_id`, which the client never sends — it sends
    // {name, member_ids:[…]} — so a member filled in the form, picked people and
    // got 400. Add/remove/rename returned 200 and changed nothing. List returned
    // every conversation as a pair.
    //
    // Membership now lives in conversation_participants. Participant1Id/
    // Participant2Id are still WRITTEN because the conversation list, unread
    // counts, attachments and voice-send still read them; they come out in a
    // later migration once nothing does.
    // ──────────────────────────────────────────────────────────────────────

    /// <summary>GET /api/v2/conversations/groups — group threads I am in.</summary>
    [HttpGet("api/v2/conversations/groups")]
    public async Task<IActionResult> V2Messages()
    {
        var userId = CurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var tenantId = TenantId();

        var data = await _db.Conversations.AsNoTracking()
            .Where(c => c.TenantId == tenantId
                && c.IsGroup
                && _db.ConversationParticipants.Any(p =>
                    p.ConversationId == c.Id && p.UserId == userId.Value && p.LeftAt == null))
            .OrderByDescending(c => c.UpdatedAt ?? c.CreatedAt)
            .Take(50)
            .Select(c => new
            {
                id = c.Id,
                is_group = c.IsGroup,
                name = c.GroupName,
                avatar_url = c.GroupAvatarUrl,
                created_by = c.CreatedBy,
                member_count = _db.ConversationParticipants
                    .Count(p => p.ConversationId == c.Id && p.LeftAt == null),
                created_at = c.CreatedAt,
                updated_at = c.UpdatedAt,
            })
            .ToListAsync(HttpContext.RequestAborted);

        return Ok(new { data });
    }

    [HttpPost("api/v2/conversations/{id:int}/messages")]
    public async Task<IActionResult> V2SendConversationMessage(int id, [FromBody] JsonElement body)
    {
        var userId = CurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        // 🔴 Authorisation moved from "am I participant 1 or 2" to a membership
        // lookup. Getting this wrong posts into a stranger's thread.
        if (!await IsActiveParticipantAsync(id, userId.Value))
            return StatusCode(StatusCodes.Status403Forbidden, new { error = "Not a participant in this conversation" });

        var message = new Message { TenantId = TenantId(), ConversationId = id, SenderId = userId.Value, Content = GetString(body, "content") ?? GetString(body, "message") ?? string.Empty };
        _db.Messages.Add(message);
        await _db.SaveChangesAsync();
        return Ok(new { success = true, data = message });
    }

    /// <summary>POST /api/v2/conversations/groups — create a group thread.</summary>
    [HttpPost("api/v2/conversations/groups")]
    public async Task<IActionResult> V2CreateGroupConversation([FromBody] JsonElement body)
    {
        var userId = CurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });
        var tenantId = TenantId();

        var name = (GetString(body, "name") ?? GetString(body, "group_name"))?.Trim();
        if (string.IsNullOrWhiteSpace(name))
            return UnprocessableEntity(new { message = "A group name is required.", errors = new Dictionary<string, string[]> { ["name"] = new[] { "A group name is required." } } });

        var memberIds = ReadMemberIds(body).Where(m => m != userId.Value).Distinct().ToList();
        if (memberIds.Count < 2)
            return UnprocessableEntity(new { message = "A group needs at least two other members.", errors = new Dictionary<string, string[]> { ["member_ids"] = new[] { "A group needs at least two other members." } } });

        // Everyone must be a real, active member of THIS community, or a crafted
        // id would drop a stranger — or someone from another tenant — into a
        // private thread.
        var valid = await _db.Users.AsNoTracking()
            .Where(u => u.TenantId == tenantId && u.IsActive && memberIds.Contains(u.Id))
            .Select(u => u.Id)
            .ToListAsync(HttpContext.RequestAborted);
        if (valid.Count != memberIds.Count)
            return UnprocessableEntity(new { message = "One or more members could not be found.", errors = new Dictionary<string, string[]> { ["member_ids"] = new[] { "One or more members could not be found." } } });

        var conversation = new Conversation
        {
            TenantId = tenantId,
            IsGroup = true,
            GroupName = name,
            CreatedBy = userId.Value,
            Participant1Id = userId.Value,
            Participant2Id = valid[0],
            CreatedAt = DateTime.UtcNow,
        };
        _db.Conversations.Add(conversation);
        await _db.SaveChangesAsync(HttpContext.RequestAborted);

        _db.ConversationParticipants.Add(new ConversationParticipant
        {
            TenantId = tenantId,
            ConversationId = conversation.Id,
            UserId = userId.Value,
            Role = ConversationParticipant.Roles.Admin,
        });
        foreach (var memberId in valid)
        {
            _db.ConversationParticipants.Add(new ConversationParticipant
            {
                TenantId = tenantId,
                ConversationId = conversation.Id,
                UserId = memberId,
                Role = ConversationParticipant.Roles.Member,
            });
        }
        await _db.SaveChangesAsync(HttpContext.RequestAborted);

        return Ok(new
        {
            success = true,
            data = new
            {
                id = conversation.Id,
                is_group = true,
                name = conversation.GroupName,
                created_by = conversation.CreatedBy,
                member_count = valid.Count + 1,
                created_at = conversation.CreatedAt,
            },
        });
    }

    /// <summary>GET /api/v2/conversations/{id}/participants</summary>
    [HttpGet("api/v2/conversations/{id:int}/participants")]
    public async Task<IActionResult> V2ConversationParticipants(int id)
    {
        var userId = CurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        // Not a participant means "no such conversation" — confirming it exists
        // leaks who is talking to whom.
        if (!await IsActiveParticipantAsync(id, userId.Value))
            return NotFound(new { error = "Conversation not found" });

        var data = await _db.ConversationParticipants.AsNoTracking()
            .Where(p => p.ConversationId == id && p.LeftAt == null)
            .Join(_db.Users.AsNoTracking(), p => p.UserId, u => u.Id, (p, u) => new
            {
                user_id = p.UserId,
                name = (u.FirstName + " " + u.LastName).Trim(),
                avatar_url = u.AvatarUrl,
                role = p.Role,
                joined_at = p.JoinedAt,
            })
            .ToListAsync(HttpContext.RequestAborted);

        return Ok(new { data });
    }

    /// <summary>POST /api/v2/conversations/{id}/participants — add someone.</summary>
    [HttpPost("api/v2/conversations/{id:int}/participants")]
    public async Task<IActionResult> V2AddParticipant(int id, [FromBody] JsonElement body)
    {
        var actorId = CurrentUserId();
        if (actorId == null) return Unauthorized(new { error = "Invalid token" });
        var tenantId = TenantId();

        var conversation = await _db.Conversations
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Id == id, HttpContext.RequestAborted);
        if (conversation is null) return NotFound(new { error = "Conversation not found" });
        if (!conversation.IsGroup)
            return Conflict(new { error = "Only group conversations can have members added" });
        if (!await IsGroupAdminAsync(id, actorId.Value))
            return StatusCode(StatusCodes.Status403Forbidden, new { error = "Only a group admin can add members" });

        var newUserId = GetInt(body, "user_id") ?? GetInt(body, "participant_id");
        if (newUserId is null)
            return UnprocessableEntity(new { message = "user_id is required.", errors = new Dictionary<string, string[]> { ["user_id"] = new[] { "user_id is required." } } });

        var exists = await _db.Users.AsNoTracking()
            .AnyAsync(u => u.TenantId == tenantId && u.Id == newUserId.Value && u.IsActive, HttpContext.RequestAborted);
        if (!exists) return NotFound(new { error = "Member not found" });

        var existing = await _db.ConversationParticipants
            .FirstOrDefaultAsync(p => p.ConversationId == id && p.UserId == newUserId.Value, HttpContext.RequestAborted);
        if (existing is not null)
        {
            // Re-joining reuses the row; the unique key forbids a second one.
            if (existing.LeftAt is null)
                return Ok(new { success = true, data = new { user_id = newUserId.Value, added = false } });
            existing.LeftAt = null;
            existing.JoinedAt = DateTime.UtcNow;
        }
        else
        {
            _db.ConversationParticipants.Add(new ConversationParticipant
            {
                TenantId = tenantId,
                ConversationId = id,
                UserId = newUserId.Value,
                Role = ConversationParticipant.Roles.Member,
            });
        }

        conversation.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(HttpContext.RequestAborted);
        return Ok(new { success = true, data = new { user_id = newUserId.Value, added = true } });
    }

    /// <summary>DELETE /api/v2/conversations/{id}/participants/{userId}</summary>
    [HttpDelete("api/v2/conversations/{id:int}/participants/{userId:int}")]
    public async Task<IActionResult> V2RemoveParticipant(int id, int userId)
    {
        var actorId = CurrentUserId();
        if (actorId == null) return Unauthorized(new { error = "Invalid token" });
        var tenantId = TenantId();

        var conversation = await _db.Conversations
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Id == id, HttpContext.RequestAborted);
        if (conversation is null) return NotFound(new { error = "Conversation not found" });

        // Anyone may remove themselves (leave). Removing someone else needs
        // group-admin rights.
        if (userId != actorId.Value && !await IsGroupAdminAsync(id, actorId.Value))
            return StatusCode(StatusCodes.Status403Forbidden, new { error = "Only a group admin can remove members" });

        var participant = await _db.ConversationParticipants
            .FirstOrDefaultAsync(p => p.ConversationId == id && p.UserId == userId && p.LeftAt == null,
                HttpContext.RequestAborted);
        if (participant is null) return NotFound(new { error = "That member is not in this conversation" });

        // Kept rather than deleted, so who could see what stays answerable.
        participant.LeftAt = DateTime.UtcNow;
        conversation.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(HttpContext.RequestAborted);
        return Ok(new { success = true, data = new { user_id = userId, removed = true } });
    }

    /// <summary>PATCH /api/v2/conversations/{id}/group — rename or re-avatar.</summary>
    [HttpPatch("api/v2/conversations/{id:int}/group")]
    public async Task<IActionResult> V2UpdateGroup(int id, [FromBody] JsonElement body)
    {
        var actorId = CurrentUserId();
        if (actorId == null) return Unauthorized(new { error = "Invalid token" });
        var tenantId = TenantId();

        var conversation = await _db.Conversations
            .FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Id == id && c.IsGroup, HttpContext.RequestAborted);
        if (conversation is null) return NotFound(new { error = "Group conversation not found" });
        if (!await IsGroupAdminAsync(id, actorId.Value))
            return StatusCode(StatusCodes.Status403Forbidden, new { error = "Only a group admin can change the group" });

        var newName = GetString(body, "name") ?? GetString(body, "group_name");
        if (!string.IsNullOrWhiteSpace(newName)) conversation.GroupName = newName.Trim();

        var avatar = GetString(body, "avatar_url");
        if (avatar is not null)
            conversation.GroupAvatarUrl = string.IsNullOrWhiteSpace(avatar) ? null : avatar.Trim();

        conversation.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync(HttpContext.RequestAborted);

        return Ok(new
        {
            success = true,
            data = new { id = conversation.Id, name = conversation.GroupName, avatar_url = conversation.GroupAvatarUrl },
        });
    }

    private Task<bool> IsActiveParticipantAsync(int conversationId, int userId)
        => _db.ConversationParticipants.AsNoTracking()
            .AnyAsync(p => p.ConversationId == conversationId && p.UserId == userId && p.LeftAt == null,
                HttpContext.RequestAborted);

    private Task<bool> IsGroupAdminAsync(int conversationId, int userId)
        => _db.ConversationParticipants.AsNoTracking()
            .AnyAsync(p => p.ConversationId == conversationId
                    && p.UserId == userId
                    && p.LeftAt == null
                    && p.Role == ConversationParticipant.Roles.Admin,
                HttpContext.RequestAborted);

    private static List<int> ReadMemberIds(JsonElement body)
    {
        var keys = new[] { "member_ids", "participant_ids", "user_ids" };
        foreach (var key in keys)
        {
            if (body.ValueKind == JsonValueKind.Object
                && body.TryGetProperty(key, out var arr)
                && arr.ValueKind == JsonValueKind.Array)
            {
                var ids = new List<int>();
                foreach (var element in arr.EnumerateArray())
                {
                    if (element.ValueKind == JsonValueKind.Number && element.TryGetInt32(out var value))
                        ids.Add(value);
                }
                return ids;
            }
        }
        return new List<int>();
    }

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

    /// <summary>
    /// Laravel's v2 collection envelope: <c>{data, meta:{per_page, has_more}}</c>.
    ///
    /// 🔴 NOT <c>pagination:{page, limit, total, pages}</c>, which is what this
    /// emitted until 2026-08-17. Laravel's respondWithCollection
    /// (BaseApiController.php:200-220) reports how many fit on a page and
    /// whether another page exists, under <c>meta</c> — verified live on
    /// /events, /feed, /groups, /polls, /kb and eight more, all
    /// <c>{"base_url":…,"per_page":20,"has_more":false}</c>. A client reading
    /// `pagination.pages` to build a pager finds nothing on the real backend.
    ///
    /// base_url is added by <see cref="Nexus.Api.Filters.LaravelDataEnvelopeFilter"/>,
    /// which fills it into an existing meta rather than replacing one.
    /// </summary>
    private static object Paged<T>(IEnumerable<T> data, int page, int limit, int total)
    {
        var perPage = Limit(limit);
        var currentPage = Math.Max(page, 1);
        return new
        {
            data,
            meta = new
            {
                per_page = perPage,
                has_more = (long)currentPage * perPage < total,
            },
        };
    }

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
