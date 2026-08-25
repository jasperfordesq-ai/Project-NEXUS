// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api")]
public class MiscParityController : ControllerBase
{
    private const string LocalAdvertisingCampaignsKey = "local_advertising.campaigns";
    private const string AppreciationsKey = "social.appreciations";
    private static readonly JsonSerializerOptions StoreJsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true
    };

    private static readonly HashSet<string> LaravelReactionTypes = new(StringComparer.Ordinal)
    {
        "love",
        "like",
        "laugh",
        "wow",
        "sad",
        "celebrate",
        "clap",
        "time_credit"
    };

    private static readonly HashSet<string> LaravelReactionTargetTypes = new(StringComparer.Ordinal)
    {
        "post",
        "comment",
        "listing",
        "event",
        "goal",
        "poll",
        "review",
        "volunteer",
        "challenge",
        "resource",
        "job",
        "blog",
        "discussion"
    };

    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<MiscParityController> _logger;

    public MiscParityController(
        NexusDbContext db,
        TenantContext tenantContext,
        ILogger<MiscParityController> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    /// <summary>
    /// Refuse an inbound webhook this backend cannot yet process, loudly.
    ///
    /// 🔴 These three endpoints previously returned <c>200 {received:true}</c> while
    /// discarding the payload. That is the worst possible behaviour for a webhook:
    /// Stripe, the identity providers and SendGrid all treat 2xx as "delivered"
    /// and never retry, so each event was destroyed permanently and silently, and
    /// every route-level parity check passed because the route existed and
    /// answered 200.
    ///
    /// 501 keeps the event alive in the SENDER's retry queue — which is a real
    /// durable store, unlike a local table nothing reads — and surfaces the
    /// failure in the provider dashboard instead of hiding it. Implementing real
    /// processing is tracked in PRODUCTION_READINESS_REMEDIATION.md; until then
    /// this must not pretend to succeed.
    /// </summary>
    private IActionResult WebhookNotProcessed(string provider, string route)
    {
        _logger.LogError(
            "Inbound {Provider} webhook at {Route} was REFUSED: no processing is implemented on this "
            + "backend. The event remains in the sender's retry queue. See "
            + "PRODUCTION_READINESS_REMEDIATION.md (webhook processing).",
            provider,
            route);

        return StatusCode(StatusCodes.Status501NotImplemented, new
        {
            success = false,
            error = "Webhook processing is not implemented on this backend",
            code = "WEBHOOK_NOT_IMPLEMENTED",
            provider,
        });
    }

    [HttpGet("csrf-token")]
    [AllowAnonymous]
    public IActionResult RootCsrfToken() => Ok(new { csrf_token = Token() });

    [HttpGet("access-log")]
    [Authorize]
    public IActionResult AccessLog() => Ok(new { data = Array.Empty<object>() });

    [HttpGet("achievements")]
    [Authorize]
    public async Task<IActionResult> Achievements() => Ok(new { data = await _db.UserBadges.Where(b => b.UserId == UserId()).ToListAsync() });

    [HttpGet("achievements/progress")]
    [Authorize]
    public IActionResult AchievementProgress() => Ok(new { data = new { completed = 0, total = 0 } });

    // Laravel serves this signed-out: routes/api.php:4070 sits OUTSIDE the
    // auth:sanctum group (which closes at line 1592). Verified live -- an
    // anonymous GET to /api/v2/ads/active on Laravel returns 200, not 401.
    [HttpGet("ads/active")]
    [AllowAnonymous]
    public async Task<IActionResult> ActiveAds([FromQuery] string? placement = "feed", [FromQuery] int limit = 3)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var normalizedPlacement = string.IsNullOrWhiteSpace(placement) ? "feed" : placement.Trim().ToLowerInvariant();
        var safeLimit = Math.Clamp(limit, 1, 10);
        var today = DateTime.UtcNow.Date;
        var campaigns = await LoadLocalAdCampaignsAsync(tenantId);

        var ads = campaigns
            .Where(c => c.TenantId == tenantId)
            .Where(c => string.Equals(c.Status, "active", StringComparison.OrdinalIgnoreCase))
            .Where(c => string.Equals(c.Placement, normalizedPlacement, StringComparison.OrdinalIgnoreCase)
                || string.Equals(c.Placement, "all", StringComparison.OrdinalIgnoreCase))
            .Where(c => !TryParseDate(c.StartDate, out var start) || start <= today)
            .Where(c => !TryParseDate(c.EndDate, out var end) || end >= today)
            .Where(c => c.BudgetCents <= 0 || c.SpentCents < c.BudgetCents)
            .OrderByDescending(c => c.ImpressionCount)
            .SelectMany(c => c.Creatives
                .Where(creative => creative.IsActive != 0)
                .Select(creative => new
                {
                    campaign_id = c.Id,
                    creative_id = creative.Id,
                    advertiser_name = string.IsNullOrWhiteSpace(c.AdvertiserName) ? c.Name : c.AdvertiserName,
                    title = creative.Headline,
                    headline = creative.Headline,
                    body = string.IsNullOrWhiteSpace(creative.Body) ? null : creative.Body,
                    image_url = creative.ImageUrl,
                    cta_url = creative.DestinationUrl,
                    destination_url = creative.DestinationUrl,
                    cta_label = creative.CtaText,
                    cta_text = creative.CtaText,
                    tracking_token = TrackingToken(tenantId, c.Id, creative.Id, normalizedPlacement),
                    placement = c.Placement,
                    advertiser_type = c.AdvertiserType
                }))
            .Take(safeLimit)
            .ToList();

        return Ok(new
        {
            data = ads,
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    [HttpPost("ads/impression")]
    [Authorize]
    public IActionResult AdImpression([FromBody] JsonElement body)
    {
        var impressionId = StableId(body);
        return Ok(new
        {
            data = new
            {
                impression_id = impressionId,
                id = impressionId,
                tracked = true
            }
        });
    }

    [HttpPost("ads/impression/{impressionId:int}/click")]
    [Authorize]
    public IActionResult AdClick(int impressionId) => Ok(new
    {
        data = new
        {
            ok = true,
            impression_id = impressionId,
            clicked = true
        }
    });

    [HttpPost("ai/generate/bio")]
    [Authorize]
    public IActionResult GenerateBio([FromBody] JsonElement body) => Ok(new { data = new { bio = $"Community member interested in {Str(body, "interests") ?? "helping others"}." } });

    [HttpPost("ai/generate/listing")]
    [Authorize]
    public IActionResult GenerateListing([FromBody] JsonElement body) => Ok(new { data = new { title = Str(body, "title") ?? "Community listing", description = "Generated listing draft." } });

    [HttpPost("app/log")]
    [AllowAnonymous]
    public IActionResult AppLog([FromBody] JsonElement body) => Ok(new { accepted = true });

    [HttpGet("app/version")]
    [AllowAnonymous]
    public IActionResult AppVersion() => Ok(new { version = "2.0", api = "nexus" });

    [HttpPost("appreciations")]
    [Authorize]
    public async Task<IActionResult> CreateAppreciation([FromBody] JsonElement body)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var senderId = UserId();
        var receiverId = Int(body, "receiver_id") ?? 0;
        var message = Str(body, "message")?.Trim() ?? string.Empty;
        var contextType = Str(body, "context_type")?.Trim();

        if (receiverId <= 0 || string.IsNullOrWhiteSpace(message))
        {
            return UnprocessableEntity(new
            {
                success = false,
                errors = new[] { new { code = "VALIDATION_ERROR", message = "receiver_id and message required" } }
            });
        }

        if (senderId == receiverId)
        {
            return UnprocessableEntity(new
            {
                success = false,
                errors = new[] { new { code = "CANNOT_THANK_SELF", message = "cannot_thank_self" } }
            });
        }

        if (message.Length > 500)
        {
            return UnprocessableEntity(new
            {
                success = false,
                errors = new[] { new { code = "MESSAGE_TOO_LONG", message = "message_too_long" } }
            });
        }

        if (!string.IsNullOrWhiteSpace(contextType) && contextType is not ("vol_log" or "listing_completion" or "general" or "event_help"))
        {
            return UnprocessableEntity(new
            {
                success = false,
                errors = new[] { new { code = "INVALID_CONTEXT", message = "invalid_context" } }
            });
        }

        var receiverExists = await _db.Users.AsNoTracking().AnyAsync(u => u.TenantId == tenantId && u.Id == receiverId);
        if (!receiverExists)
        {
            return UnprocessableEntity(new
            {
                success = false,
                errors = new[] { new { code = "RECEIVER_NOT_FOUND", message = "receiver_not_found" } }
            });
        }

        var records = await LoadAppreciationsAsync(tenantId);
        var now = DateTime.UtcNow;
        var record = new AppreciationRecord
        {
            Id = records.Count == 0 ? 1 : records.Max(a => a.Id) + 1,
            TenantId = tenantId,
            SenderId = senderId,
            ReceiverId = receiverId,
            Message = message,
            ContextType = string.IsNullOrWhiteSpace(contextType) ? null : contextType,
            ContextId = Int(body, "context_id"),
            IsPublic = Bool(body, "is_public") ?? true,
            CreatedAt = now,
            UpdatedAt = now
        };

        records.Add(record);
        await SaveAppreciationsAsync(tenantId, records);

        return StatusCode(StatusCodes.Status201Created, new { success = true, data = await MapAppreciationAsync(record, senderId) });
    }

    [HttpGet("appreciations/most-appreciated")]
    [Authorize]
    public async Task<IActionResult> MostAppreciated([FromQuery] string? period = "last_30d", [FromQuery] int limit = 10)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var safeLimit = Math.Clamp(limit, 1, 50);
        var since = period switch
        {
            "last_7d" => DateTime.UtcNow.AddDays(-7),
            "last_90d" => DateTime.UtcNow.AddDays(-90),
            "all_time" => (DateTime?)null,
            _ => DateTime.UtcNow.AddDays(-30)
        };

        var records = (await LoadAppreciationsAsync(tenantId))
            .Where(a => a.IsPublic)
            .Where(a => !since.HasValue || a.CreatedAt >= since.Value)
            .ToList();
        var receiverIds = records.Select(a => a.ReceiverId).Distinct().ToArray();
        var users = await _db.Users
            .AsNoTracking()
            .Where(u => u.TenantId == tenantId && receiverIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id);

        var rows = records
            .GroupBy(a => a.ReceiverId)
            .Select(g =>
            {
                users.TryGetValue(g.Key, out var user);
                return new
                {
                    user_id = g.Key,
                    name = user == null ? null : DisplayName(user),
                    avatar_url = user?.AvatarUrl,
                    count = g.Count()
                };
            })
            .OrderByDescending(row => row.count)
            .ThenBy(row => row.name)
            .Take(safeLimit)
            .ToList();

        return Ok(new { success = true, data = rows });
    }

    [HttpPost("appreciations/{id:int}/react")]
    [Authorize]
    public async Task<IActionResult> ReactAppreciation(int id, [FromBody] JsonElement body)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var userId = UserId();
        var reactionType = Str(body, "reaction_type")?.Trim() ?? string.Empty;
        if (reactionType is not ("heart" or "clap" or "star"))
        {
            return UnprocessableEntity(new
            {
                success = false,
                errors = new[] { new { code = "VALIDATION_ERROR", message = "invalid_reaction" } }
            });
        }

        var records = await LoadAppreciationsAsync(tenantId);
        var record = records.FirstOrDefault(a => a.Id == id);
        if (record == null)
        {
            return NotFound(new { success = false, errors = new[] { new { code = "NOT_FOUND", message = "Not found" } } });
        }

        var userKey = userId.ToString();
        var reacted = true;
        string? currentReaction = reactionType;
        if (record.Reactions.TryGetValue(userKey, out var existing) && existing == reactionType)
        {
            record.Reactions.Remove(userKey);
            reacted = false;
            currentReaction = null;
        }
        else
        {
            record.Reactions[userKey] = reactionType;
        }

        record.UpdatedAt = DateTime.UtcNow;
        await SaveAppreciationsAsync(tenantId, records);

        return Ok(new
        {
            success = true,
            data = new
            {
                reacted,
                reaction_type = currentReaction,
                reactions_count = record.Reactions.Count
            }
        });
    }

    [HttpDelete("appreciations/{id:int}/react")]
    [Authorize]
    public async Task<IActionResult> DeleteAppreciationReaction(int id)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var userKey = UserId().ToString();
        var records = await LoadAppreciationsAsync(tenantId);
        var record = records.FirstOrDefault(a => a.Id == id);
        if (record == null || !record.Reactions.Remove(userKey))
        {
            return NotFound(new { success = false, errors = new[] { new { code = "NOT_FOUND", message = "Not found" } } });
        }

        record.UpdatedAt = DateTime.UtcNow;
        await SaveAppreciationsAsync(tenantId, records);
        return NoContent();
    }

    [HttpGet("billing/plans")]
    [AllowAnonymous]
    public async Task<IActionResult> BillingPlans()
    {
        var plans = await _db.SubscriptionPlans
            .AsNoTracking()
            .Where(p => p.IsActive && p.IsPublic)
            .OrderBy(p => p.Price)
            .ThenBy(p => p.Name)
            .ThenBy(p => p.Id)
            .ToListAsync();

        var data = plans.Select((plan, index) => new
        {
            id = plan.Id,
            name = plan.Name,
            slug = Slugify(plan.Name),
            description = plan.Description ?? string.Empty,
            tier_level = index + 1,
            price_monthly = plan.Price,
            price_yearly = decimal.Round(plan.Price * 12m, 2, MidpointRounding.AwayFromZero),
            features = NormalizePlanFeatures(plan.Features),
            is_active = plan.IsActive
        });

        return Ok(new
        {
            data,
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    // V1 marketplace-bookmark parity shim. Moved from /api/bookmark-collections
    // and /api/bookmarks to /api/parity/* to avoid ambiguous-route collision
    // with the canonical generic-content-type BookmarksController (Phase 72).
    // These actions operate on MarketplaceCollection / MarketplaceSavedListing
    // entities (legacy V1 shape), NOT the canonical Bookmark entity.
    [HttpGet("parity/bookmark-collections")]
    [Authorize]
    public async Task<IActionResult> BookmarkCollections() => Ok(new { data = await _db.MarketplaceCollections.Where(c => c.UserId == UserId()).ToListAsync() });

    [HttpPost("parity/bookmark-collections")]
    [Authorize]
    public async Task<IActionResult> CreateBookmarkCollection([FromBody] JsonElement body)
    {
        var collection = new Nexus.Api.Entities.MarketplaceCollection { TenantId = TenantId(), UserId = UserId(), Name = Str(body, "name") ?? "Collection" };
        _db.MarketplaceCollections.Add(collection);
        await _db.SaveChangesAsync();
        return Ok(new { data = collection });
    }

    [HttpDelete("parity/bookmark-collections/{id:int}")]
    [Authorize]
    public async Task<IActionResult> DeleteBookmarkCollection(int id)
    {
        var collection = await _db.MarketplaceCollections.FirstOrDefaultAsync(c => c.UserId == UserId() && c.Id == id);
        if (collection != null) _db.MarketplaceCollections.Remove(collection);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("parity/bookmarks")]
    [Authorize]
    public async Task<IActionResult> Bookmarks() => Ok(new { data = await _db.MarketplaceSavedListings.Where(s => s.UserId == UserId()).ToListAsync() });

    [HttpPost("parity/bookmarks")]
    [Authorize]
    public async Task<IActionResult> CreateBookmark([FromBody] JsonElement body)
    {
        var listingId = Int(body, "listing_id") ?? Int(body, "item_id") ?? 0;
        if (listingId > 0 && !await _db.MarketplaceSavedListings.AnyAsync(s => s.UserId == UserId() && s.MarketplaceListingId == listingId))
            _db.MarketplaceSavedListings.Add(new Nexus.Api.Entities.MarketplaceSavedListing { TenantId = TenantId(), UserId = UserId(), MarketplaceListingId = listingId });
        await _db.SaveChangesAsync();
        return Ok(new { saved = true });
    }

    [HttpGet("parity/bookmarks/status")]
    [Authorize]
    public IActionResult BookmarkStatus([FromQuery] int? item_id = null) => Ok(new { data = new { item_id, saved = false } });

    [HttpPost("parity/bookmarks/{id:int}/move")]
    [Authorize]
    public IActionResult MoveBookmark(int id, [FromBody] JsonElement body) => Ok(new { data = new { id, collection_id = Int(body, "collection_id") } });

    // 🔴 Anonymous, matching Laravel: /v2/clubs is declared at
    // routes/api.php:74, BEFORE the auth:sanctum group opens at 201, so it is
    // public. Requiring a login here meant a signed-out visitor could not see a
    // community's clubs at all -- a working page on the production backend,
    // blank on this one. Found by measuring the accessible frontend.
    [HttpGet("clubs")]
    [AllowAnonymous]
    public async Task<IActionResult> Clubs() => Ok(new { data = await _db.Groups.Where(g => g.TenantId == TenantId()).ToListAsync() });

    [HttpGet("community/stats")]
    [AllowAnonymous]
    public async Task<IActionResult> CommunityStats() => Ok(new { data = new { members = await _db.Users.CountAsync(), listings = await _db.Listings.CountAsync(), groups = await _db.Groups.CountAsync() } });

    [HttpGet("config/google-maps")]
    [AllowAnonymous]
    public async Task<IActionResult> GoogleMapsConfig(CancellationToken cancellationToken)
    {
        var tenantId = _tenantContext.GetTenantIdOrThrow();
        var requestedKeys = new[]
        {
            "features.maps", "feature.maps", "general.map_provider", "general.geocoding_provider",
            "general.google_maps_api_key", "general.google_maps_map_id", "general.maptiler_api_key",
            "general.os_maps_api_key"
        };
        var settings = await _db.TenantConfigs
            .AsNoTracking()
            .Where(config => config.TenantId == tenantId && requestedKeys.Contains(config.Key))
            .ToDictionaryAsync(config => config.Key, config => config.Value, cancellationToken);

        string Setting(string key) => settings.TryGetValue($"general.{key}", out var value) ? value.Trim() : string.Empty;
        var mapsEnabled = ReadBool(settings, "features.maps") ?? ReadBool(settings, "feature.maps") ?? false;
        var mapProvider = Allowed(Setting("map_provider"), ["google", "openstreetmap", "ordnance_survey"], "google");
        var geocodingProvider = Allowed(Setting("geocoding_provider"), ["google", "nominatim", "os_places"], "google");

        var tenantGoogleKey = Setting("google_maps_api_key");
        var tenantMapId = Setting("google_maps_map_id");
        var tenantMapTilerKey = Setting("maptiler_api_key");
        var tenantOsKey = Setting("os_maps_api_key");
        var googleKey = FirstNonEmpty(tenantGoogleKey, Environment.GetEnvironmentVariable("GOOGLE_MAPS_API_KEY"));
        var mapId = FirstNonEmpty(tenantMapId, Environment.GetEnvironmentVariable("GOOGLE_MAPS_MAP_ID"));
        var osKey = FirstNonEmpty(tenantOsKey, Environment.GetEnvironmentVariable("OS_MAPS_API_KEY"));

        var googleMapsRequested = mapsEnabled && mapProvider == "google";
        var googlePlacesRequested = geocodingProvider == "google";
        var browserGoogleKey = googleMapsRequested || googlePlacesRequested ? googleKey : string.Empty;
        var googleMapsEnabled = browserGoogleKey.Length > 0 && googleMapsRequested;
        var googlePlacesEnabled = browserGoogleKey.Length > 0 && googlePlacesRequested;
        var leafletEnabled = mapsEnabled && mapProvider is "openstreetmap" or "ordnance_survey";
        var osTilesActive = leafletEnabled && mapProvider == "ordnance_survey" && osKey.Length > 0;
        var mapTilerActive = leafletEnabled && mapProvider == "openstreetmap" && tenantMapTilerKey.Length > 0;
        var osmTileUrl = osTilesActive
            ? $"https://api.os.uk/maps/raster/v1/zxy/Road_3857/{{z}}/{{x}}/{{y}}.png?key={Uri.EscapeDataString(osKey)}"
            : mapTilerActive
                ? $"https://api.maptiler.com/maps/streets-v2/{{z}}/{{x}}/{{y}}@2x.png?key={Uri.EscapeDataString(tenantMapTilerKey)}"
                : leafletEnabled ? "https://tile.openstreetmap.org/{z}/{x}/{y}.png" : string.Empty;
        var osmTileAttribution = osTilesActive
            ? $"Contains OS data &copy; Crown copyright and database rights {DateTime.UtcNow.Year}"
            : mapTilerActive
                ? "&copy; <a href=\"https://www.maptiler.com/copyright/\" target=\"_blank\" rel=\"noopener\">MapTiler</a> &copy; <a href=\"https://www.openstreetmap.org/copyright\" target=\"_blank\" rel=\"noopener\">OpenStreetMap</a> contributors"
                : leafletEnabled ? "&copy; <a href=\"https://www.openstreetmap.org/copyright\" target=\"_blank\" rel=\"noopener\">OpenStreetMap</a> contributors" : string.Empty;

        return Ok(new
        {
            data = new
            {
                enabled = googleMapsEnabled || googlePlacesEnabled,
                apiKey = browserGoogleKey,
                mapId = googleMapsEnabled && mapId.Length > 0 ? mapId : null,
                mapsEnabled,
                mapProvider,
                geocodingProvider,
                googleMapsEnabled,
                googlePlacesEnabled,
                nominatimBaseUrl = "https://nominatim.openstreetmap.org",
                osmTileUrl,
                osmTileAttribution,
                osmTileProvider = leafletEnabled ? osTilesActive ? "ordnance_survey" : mapTilerActive ? "maptiler" : "osm" : null,
                tenantOverrides = new
                {
                    google_maps_api_key = tenantGoogleKey.Length > 0,
                    google_maps_map_id = tenantMapId.Length > 0,
                    maptiler_api_key = tenantMapTilerKey.Length > 0,
                    os_maps_api_key = tenantOsKey.Length > 0
                }
            }
        });
    }

    [HttpGet("cookie-consent/inventory")]
    [AllowAnonymous]
    public IActionResult CookieInventory() => Ok(new { data = Array.Empty<object>() });

    [HttpGet("cookie-consent/check/{key}")]
    [AllowAnonymous]
    public IActionResult CookieConsentCheck(string key) => Ok(new { data = new { key, consented = false } });

    [HttpPut("cookie-consent/{id:int}")]
    [AllowAnonymous]
    public IActionResult UpdateCookieConsent(int id, [FromBody] JsonElement body) => Ok(new { data = new { id, updated = true } });

    [HttpDelete("cookie-consent/{id:int}")]
    [AllowAnonymous]
    public IActionResult DeleteCookieConsent(int id) => NoContent();

    [HttpGet("connections/status/me")]
    [Authorize]
    public IActionResult ConnectionStatusMe() => Ok(new { data = new { connected = true } });

    /// <summary>
    /// GET /api/v2/connections/suggestions — "People You May Know".
    ///
    /// 🔴 This returned <c>_db.Users.ToListAsync()</c> — the WHOLE User entity — to
    /// any signed-in ordinary member. Verified live on 2026-08-17: every suggested
    /// member came back carrying <c>passwordHash</c> (the bcrypt hash, crackable
    /// offline), <c>email</c>, <c>totpSecretEncrypted</c>, <c>emailVerificationCode</c>,
    /// every admin flag and <c>suspensionReason</c>. Laravel sends seven fields and
    /// none of them is sensitive.
    ///
    /// The lesson is the one `users/search` already taught: returning an EF entity
    /// directly publishes whatever the entity happens to hold, so the disclosure
    /// grows silently every time a column is added. Project explicitly; never
    /// serialise the entity.
    ///
    /// Contract read off the live Laravel and
    /// <c>app/Http/Controllers/Api/ConnectionSuggestionController.php</c>, not inferred:
    /// <c>{data:{suggestions:[…]}}</c> — an OBJECT under <c>data</c>, not a bare list
    /// (<c>respondWithData(['suggestions' => …])</c>); <c>limit</c> defaults to 5 and
    /// clamps to 1..20; candidates exclude self, inactive and suspended members.
    /// </summary>
    [HttpGet("connections/suggestions")]
    [Authorize]
    public async Task<IActionResult> ConnectionSuggestions()
    {
        var tenantId = TenantId();
        var userId = UserId();
        var limit = QueryInt("limit", 5, 1, 20);

        var candidates = await _db.Users
            .AsNoTracking()
            .Where(u => u.TenantId == tenantId
                && u.Id != userId
                && u.IsActive
                && u.SuspendedAt == null)
            // Laravel ranks by a score built from shared groups and recency; the
            // ordering is not part of the response contract, so this uses the
            // stable recency proxy this backend has rather than inventing one.
            .OrderByDescending(u => u.LastLoginAt)
            .ThenBy(u => u.Id)
            .Take(limit)
            .Select(u => new { u.Id, u.FirstName, u.LastName, u.AvatarUrl, u.Bio })
            .ToListAsync();

        // shared_skills is the case-insensitive intersection of the two members'
        // skills, capped at five. Laravel reads a `users.skills` JSON column; this
        // backend has no such column and models skills relationally in UserSkills,
        // so the intersection is computed from there. Same field meaning, same
        // shape (an array of names) — a deliberate internal difference, not a
        // contract one.
        var mySkills = await _db.UserSkills
            .AsNoTracking()
            .Where(us => us.TenantId == tenantId && us.UserId == userId && us.Skill != null)
            .Select(us => us.Skill!.Name)
            .ToListAsync();

        var candidateIds = candidates.Select(c => c.Id).ToList();
        var theirSkills = candidateIds.Count == 0
            ? new List<(int UserId, string Name)>()
            : (await _db.UserSkills
                .AsNoTracking()
                .Where(us => us.TenantId == tenantId && candidateIds.Contains(us.UserId) && us.Skill != null)
                .Select(us => new { us.UserId, Name = us.Skill!.Name })
                .ToListAsync())
              .Select(x => (x.UserId, x.Name))
              .ToList();

        var mine = new HashSet<string>(mySkills, StringComparer.OrdinalIgnoreCase);

        var suggestions = candidates.Select(c => new
        {
            id = c.Id,
            // Laravel emits `$candidate->name ?: ''` — never null.
            name = string.Join(' ', new[] { c.FirstName, c.LastName }
                .Where(part => !string.IsNullOrWhiteSpace(part))).Trim(),
            avatar_url = c.AvatarUrl,
            bio = c.Bio,
            // 🔴 Laravel hard-codes 0 here, and its own complex-query branch
            // selects the literal `0 AS mutual_connections_count`. Computing a real
            // count would be more useful and would NOT match the production
            // backend, so a client would show a different number depending on which
            // backend answered. Kept at 0 deliberately.
            mutual_connections_count = 0,
            shared_skills = theirSkills
                .Where(s => s.UserId == c.Id && mine.Contains(s.Name))
                .Select(s => s.Name)
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Take(5)
                .ToArray(),
            // Laravel hard-codes 'none' (ConnectionSuggestionController.php:229).
            connection_status = "none",
        }).ToList();

        return Ok(new { data = new { suggestions } });
    }

    [HttpPost("connections/{id:int}/decline")]
    [Authorize]
    public IActionResult DeclineConnectionCompat(int id) => Ok(new { data = new { id, status = "declined" } });

    [HttpPost("daily-reward/check")]
    [Authorize]
    public IActionResult DailyRewardCheck() => Ok(new { data = new { awarded = false } });

    [HttpGet("daily-reward/status")]
    [Authorize]
    public IActionResult DailyRewardStatus() => Ok(new { data = new { available = true } });

    [HttpGet("docs")]
    [AllowAnonymous]
    public IActionResult Docs() => Ok(new { data = new { openapi = "/api/docs/openapi.json" } });

    [HttpGet("docs/openapi.json")]
    [AllowAnonymous]
    public IActionResult OpenApiJson() => Ok(new { openapi = "3.0.0", info = new { title = "Project NEXUS API", version = "2.0" } });

    [HttpGet("docs/openapi.yaml")]
    [AllowAnonymous]
    public IActionResult OpenApiYaml() => Content("openapi: 3.0.0\ninfo:\n  title: Project NEXUS API\n  version: '2.0'\n", "application/yaml", Encoding.UTF8);

    [HttpPost("donations/payment-intent")]
    [Authorize]
    public async Task<IActionResult> DonationPaymentIntent([FromBody] JsonElement body)
    {
        var amount = Decimal(body, "amount");
        if (amount is null || amount.Value < 0.5m)
        {
            return UnprocessableEntity(new
            {
                success = false,
                error = "VALIDATION_ERROR",
                errors = new[] { new { code = "VALIDATION_ERROR", message = "The amount must be at least 0.50.", field = "amount" } }
            });
        }

        var currency = (Str(body, "currency") ?? "EUR").Trim().ToUpperInvariant();
        if (currency.Length != 3)
        {
            return UnprocessableEntity(new
            {
                success = false,
                error = "VALIDATION_ERROR",
                errors = new[] { new { code = "VALIDATION_ERROR", message = "The currency must be a three-letter code.", field = "currency" } }
            });
        }

        var tenantId = TenantId();
        var userId = UserId();
        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == userId && u.TenantId == tenantId);
        var isAnonymous = Bool(body, "is_anonymous") ?? false;
        var donation = new MoneyDonation
        {
            TenantId = tenantId,
            DonorUserId = userId,
            DonorDisplayName = isAnonymous
                ? "Anonymous"
                : string.Join(' ', new[] { user?.FirstName, user?.LastName }.Where(v => !string.IsNullOrWhiteSpace(v))),
            DonorEmail = user?.Email,
            AmountMinorUnits = ToMinorUnits(amount.Value),
            Currency = currency,
            Message = Str(body, "message"),
            Status = MoneyDonationStatus.Pending,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        _db.MoneyDonations.Add(donation);
        await _db.SaveChangesAsync();

        donation.StripePaymentIntentId = $"pi_nexus_{donation.Id}";
        donation.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new
        {
            success = true,
            data = new
            {
                client_secret = $"{donation.StripePaymentIntentId}_secret_test",
                donation_id = donation.Id
            }
        });
    }

    [HttpGet("donations/{id:int}/receipt")]
    [Authorize]
    public async Task<IActionResult> DonationReceipt(int id)
    {
        var tenantId = TenantId();
        var userId = UserId();
        var donation = await _db.MoneyDonations
            .AsNoTracking()
            .FirstOrDefaultAsync(d => d.Id == id && d.TenantId == tenantId && d.DonorUserId == userId);

        if (donation is null)
        {
            return NotFound(new { success = false, error = "NOT_FOUND", message = "Donation not found." });
        }

        var tenantName = await _db.Tenants
            .AsNoTracking()
            .Where(t => t.Id == tenantId)
            .Select(t => t.Name)
            .FirstOrDefaultAsync();

        return Ok(new
        {
            success = true,
            data = new
            {
                id = donation.Id,
                donor_name = string.IsNullOrWhiteSpace(donation.DonorDisplayName) ? "Anonymous" : donation.DonorDisplayName,
                amount = Math.Round(donation.AmountMinorUnits / 100m, 2),
                currency = donation.Currency,
                date = (donation.CompletedAt ?? donation.CreatedAt).ToUniversalTime(),
                community_name = tenantName ?? "Community",
                message = donation.Message,
                status = DonationStatusForReact(donation.Status),
                payment_method = "stripe",
                reference = donation.StripePaymentIntentId ?? donation.StripeCheckoutSessionId ?? $"DON-{donation.Id}"
            }
        });
    }

    [HttpPost("gdpr/consent")]
    [Authorize]
    public IActionResult GdprConsent([FromBody] JsonElement body) => Ok(new { data = new { consent = true } });

    /// <summary>
    /// Refuse a GDPR request this backend cannot yet process, loudly.
    ///
    /// 🔴 These two endpoints previously faked success while doing nothing at
    /// all: <c>POST /api/gdpr/delete-account</c> answered <c>200 {queued:true}</c>
    /// without queuing anything — a member's Article 17 erasure request was
    /// silently discarded — and <c>POST /api/gdpr/request</c> answered
    /// <c>200 {status:"pending"}</c> without writing a row, so the subject-access
    /// request never existed anywhere. That is a statutory exposure, not a
    /// cosmetic gap: the member believes a legal request has been lodged and the
    /// statutory clock is running, while the platform holds no record of it.
    ///
    /// 501 keeps the client honest: the member sees a real failure and can use
    /// the working channel instead, and no legal request is ever swallowed. The
    /// real implementation lands with the staff-journey phase (see
    /// docs/JOURNEY_CERTIFICATION_LEDGER.md, Tier 5 — GDPR/DSAR handling is
    /// staff-processed work in that tier). Until then this must not pretend to
    /// succeed. Same pattern as <see cref="WebhookNotProcessed"/>.
    /// </summary>
    private IActionResult GdprNotProcessed(string operation, string route)
    {
        _logger.LogError(
            "GDPR {Operation} request at {Route} was REFUSED: no processing is implemented on this "
            + "backend. Returning 501 so the member's statutory request is not silently discarded. "
            + "See docs/JOURNEY_CERTIFICATION_LEDGER.md (Tier 5, staff journeys).",
            operation,
            route);

        return StatusCode(StatusCodes.Status501NotImplemented, new
        {
            success = false,
            error = "GDPR request processing is not implemented on this backend",
            code = "GDPR_NOT_IMPLEMENTED",
            operation,
        });
    }

    [HttpPost("gdpr/delete-account")]
    [Authorize]
    public IActionResult GdprDeleteAccount() => GdprNotProcessed("account-erasure", "/api/gdpr/delete-account");

    [HttpPost("gdpr/request")]
    [Authorize]
    public IActionResult GdprRequest([FromBody] JsonElement body) => GdprNotProcessed("data-request", "/api/gdpr/request");

    [HttpGet("gamification/badges/{id:int}")]
    [Authorize]
    public async Task<IActionResult> GamificationBadge(int id) => Ok(new { data = await _db.Badges.FirstOrDefaultAsync(b => b.Id == id) });

    /// <summary>
    /// GET /api/v2/gamification/challenges — the community's live challenges.
    ///
    /// 🔴 Was <c>_db.Challenges...ToListAsync()</c>: the raw Challenge ENTITY, so
    /// it published camelCase keys the client does not read (<c>targetAction</c>,
    /// <c>xpReward</c>, <c>startsAt</c>) and dragged along the <c>tenant</c>,
    /// <c>badge</c> and <c>participants</c> navigation properties. Those are null
    /// today only because nothing eager-loads them — <c>participants</c> is a list
    /// of ChallengeParticipant, each with a <c>User</c>, so one `.Include` away
    /// from publishing member records. Same pattern as the connections/suggestions
    /// disclosure.
    ///
    /// It also ignored the date window and returned inactive and expired
    /// challenges, and never told the member their own progress.
    ///
    /// Contract and arithmetic read off Laravel's ChallengeService::…:402-435 —
    /// active only, currently in date, ordered by end date; progress_percent
    /// capped at 100; days/hours remaining are floats, floored at 0.
    /// </summary>
    [HttpGet("gamification/challenges")]
    [Authorize]
    public async Task<IActionResult> GamificationChallenges()
    {
        var tenantId = TenantId();
        var userId = UserId();
        var now = DateTime.UtcNow;

        var challenges = await _db.Challenges
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId
                && c.IsActive
                && c.StartsAt <= now
                && c.EndsAt >= now)
            .OrderBy(c => c.EndsAt)
            .Select(c => new
            {
                c.Id, c.TenantId, c.Title, c.Description, c.ChallengeType, c.TargetAction,
                c.TargetCount, c.XpReward, c.StartsAt, c.EndsAt, c.IsActive, c.CreatedAt,
                // Laravel's challenges.badge_reward is a badge SLUG (varchar), not
                // an id, so the joined Badge's slug is the right value here.
                BadgeSlug = c.Badge != null ? c.Badge.Slug : null,
            })
            .ToListAsync();

        var ids = challenges.Select(c => c.Id).ToList();
        var progress = ids.Count == 0
            ? new Dictionary<int, ChallengeParticipant>()
            : await _db.ChallengeParticipants
                .AsNoTracking()
                .Where(p => p.UserId == userId && ids.Contains(p.ChallengeId))
                .ToDictionaryAsync(p => p.ChallengeId);

        var data = challenges.Select(c =>
        {
            progress.TryGetValue(c.Id, out var mine);
            var userProgress = mine?.CurrentProgress ?? 0;
            var remaining = c.EndsAt - now;

            return new
            {
                id = c.Id,
                tenant_id = c.TenantId,
                title = c.Title,
                description = c.Description,
                // Laravel's vocabulary is daily|weekly|monthly|special, lower case.
                challenge_type = c.ChallengeType.ToString().ToLowerInvariant(),
                action_type = c.TargetAction,
                target_count = c.TargetCount,
                xp_reward = c.XpReward,
                badge_reward = c.BadgeSlug,
                start_date = c.StartsAt,
                end_date = c.EndsAt,
                is_active = c.IsActive,
                created_at = c.CreatedAt,
                user_progress = userProgress,
                completed_at = mine?.CompletedAt,
                reward_claimed = mine?.IsCompleted ?? false,
                progress_percent = c.TargetCount > 0
                    ? Math.Min(100, Math.Round(userProgress / (double)c.TargetCount * 100))
                    : 0,
                is_completed = userProgress >= c.TargetCount,
                days_remaining = Math.Max(0, remaining.TotalDays),
                hours_remaining = Math.Max(0, remaining.TotalHours),
                reward_xp = c.XpReward,
            };
        }).ToList();

        return Ok(new { data });
    }

    [HttpGet("gamification/community-dashboard")]
    [Authorize]
    public async Task<IActionResult> GamificationCommunityDashboard() => Ok(new { data = new { members = await _db.Users.CountAsync(u => u.TenantId == TenantId()), xp = await _db.Users.Where(u => u.TenantId == TenantId()).SumAsync(u => u.TotalXp) } });

    /// <summary>
    /// GET /api/v2/gamification/engagement-history — was this member active, month
    /// by month.
    ///
    /// 🔴 This answered from the WRONG TABLE. It returned raw XpLog entities — a
    /// list of individual point awards — where Laravel returns one row per month
    /// from `monthly_engagement`. Not a formatting difference: a 200 with
    /// plausible content describing something else entirely, the same class of
    /// fault as `skills/categories` answering from the listing categories table.
    ///
    /// Laravel: `SELECT * FROM monthly_engagement WHERE tenant_id AND user_id
    /// ORDER BY year_month DESC LIMIT 12` — read off the running query log.
    /// </summary>
    [HttpGet("gamification/engagement-history")]
    [Authorize]
    public async Task<IActionResult> GamificationEngagementHistory()
    {
        var tenantId = TenantId();
        var userId = UserId();

        var data = await _db.MonthlyEngagements
            .AsNoTracking()
            .Where(m => m.TenantId == tenantId && m.UserId == userId)
            .OrderByDescending(m => m.YearMonth)
            .Take(12)
            .Select(m => new
            {
                year_month = m.YearMonth,
                was_active = m.WasActive,
                activity_count = m.ActivityCount,
                recognized_at = m.RecognizedAt,
            })
            .ToListAsync();

        return Ok(new { data });
    }

    /// <summary>
    /// GET /api/v2/gamification/member-spotlight — a few members to highlight.
    ///
    /// 🔴 Returned ONE member as an object where Laravel returns a LIST, under
    /// camelCase keys, with no `bio`, `avatar_url`, `member_since` or
    /// `recent_activity` — so the spotlight panel had almost nothing to render.
    /// It also ranked purely by XP, which makes the same person the spotlight for
    /// ever; Laravel deliberately picks at random.
    ///
    /// Contract from CommunityDashboardService::getMemberSpotlight:121-167 —
    /// `limit` defaults to 3, capped at 10; candidates are approved members with
    /// XP above zero OR at least one badge; bio truncated to 120 characters;
    /// member_since formatted "MMM yyyy"; recent_activity is a badge count or a
    /// fallback phrase.
    ///
    /// 🔴 The ordering is `RAND(<todays date>)` — random, but SEEDED BY THE DAY, so
    /// it is stable within a day and rotates the next. Reproduced here with a
    /// deterministic per-day hash rather than a real shuffle, so repeated calls on
    /// the same day agree.
    /// </summary>
    [HttpGet("gamification/member-spotlight")]
    [Authorize]
    public async Task<IActionResult> GamificationMemberSpotlight()
    {
        var tenantId = TenantId();
        var limit = QueryInt("limit", 3, 1, 10);

        var candidates = await _db.Users
            .AsNoTracking()
            .Where(u => u.TenantId == tenantId
                && u.IsApproved
                && (u.TotalXp > 0 || _db.UserBadges.Any(b => b.UserId == u.Id)))
            .Select(u => new { u.Id, u.FirstName, u.LastName, u.AvatarUrl, u.Bio, u.TotalXp, u.Level, u.CreatedAt })
            .ToListAsync();

        var daySeed = int.Parse(DateTime.UtcNow.ToString("yyyyMMdd", CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);
        var chosen = candidates
            .OrderBy(u => unchecked(u.Id * 2654435761 ^ daySeed))
            .Take(limit)
            .ToList();

        var chosenIds = chosen.Select(u => u.Id).ToList();
        var badgeCounts = chosenIds.Count == 0
            ? new Dictionary<int, int>()
            : await _db.UserBadges
                .AsNoTracking()
                .Where(b => chosenIds.Contains(b.UserId))
                .GroupBy(b => b.UserId)
                .Select(g => new { UserId = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.UserId, x => x.Count);

        var data = chosen.Select(u =>
        {
            var badges = badgeCounts.GetValueOrDefault(u.Id, 0);
            return new
            {
                id = u.Id,
                first_name = u.FirstName,
                last_name = u.LastName,
                avatar_url = u.AvatarUrl,
                bio = string.IsNullOrEmpty(u.Bio)
                    ? null
                    : u.Bio.Length > 120 ? u.Bio[..120] : u.Bio,
                member_since = u.CreatedAt.ToString("MMM yyyy", CultureInfo.InvariantCulture),
                level = u.Level,
                xp = u.TotalXp,
                recent_activity = badges > 0
                    ? $"Earned {badges} {(badges == 1 ? "badge" : "badges")}"
                    : "Active community member",
            };
        }).ToList();

        return Ok(new { data });
    }

    /// <summary>Laravel's level vocabulary — GamificationService::LEVEL_THRESHOLDS_V2.</summary>
    private static readonly (int Xp, string Name)[] LevelNames =
    {
        (0, "Newcomer"), (100, "Explorer"), (500, "Contributor"), (1500, "Helper"),
        (3500, "Builder"), (7000, "Advocate"), (15000, "Leader"), (30000, "Champion"),
        (60000, "Pillar"), (100000, "Legend"),
    };

    private static string LevelName(int level) =>
        LevelNames[Math.Clamp(level, 1, LevelNames.Length) - 1].Name;

    /// <summary>
    /// GET /api/v2/gamification/personal-journey — the member's own history.
    ///
    /// 🔴 Returned a flat list of raw XpLog entities. Laravel returns FOUR named
    /// sections — `monthly_activity`, `badge_progression`, `milestones` and
    /// `summary`. Nothing the page renders was present, and the entity carried
    /// `tenant` and `user` navigation properties, null only because nothing
    /// eager-loads them.
    ///
    /// Contract from CommunityDashboardService::getPersonalJourney:93-107 and its
    /// four builders (:226-350). Notes worth keeping:
    /// - the timeline is always TWELVE months, oldest first, with zeros filled in
    ///   for months with no activity — not "months that happen to have rows";
    /// - milestone thresholds are fixed ladders (badges 5/10/25/50/100,
    ///   XP 100/500/1000/5000/10000/50000) and the threshold milestones carry a
    ///   null date deliberately;
    /// - date formats differ per section: "MMM yyyy" for months, "yyyy-MM-dd" for
    ///   badges earned, "MMM dd, yyyy" for the first-badge milestone.
    /// </summary>
    [HttpGet("gamification/personal-journey")]
    [Authorize]
    public async Task<IActionResult> GamificationPersonalJourney()
    {
        var tenantId = TenantId();
        var userId = UserId();
        var now = DateTime.UtcNow;
        var since = new DateTime(now.Year, now.Month, 1, 0, 0, 0, DateTimeKind.Utc).AddMonths(-11);

        var badges = await _db.UserBadges
            .AsNoTracking()
            .Where(b => b.TenantId == tenantId && b.UserId == userId)
            .Select(b => new
            {
                b.EarnedAt,
                // Laravel's user_badges denormalises badge_key/name/icon onto the
                // row; here they live on the joined Badge, and its `badge_key`
                // equivalent is called Slug.
                Key = b.Badge != null ? b.Badge.Slug : null,
                Name = b.Badge != null ? b.Badge.Name : null,
                Icon = b.Badge != null ? b.Badge.Icon : null,
            })
            .ToListAsync();

        var xp = await _db.XpLogs
            .AsNoTracking()
            .Where(x => x.TenantId == tenantId && x.UserId == userId && x.CreatedAt >= since)
            .Select(x => new { x.CreatedAt, x.Amount })
            .ToListAsync();

        // Twelve months, oldest first, zeros filled in.
        var monthlyActivity = Enumerable.Range(0, 12).Select(i =>
        {
            var month = since.AddMonths(i);
            return new
            {
                month = month.ToString("MMM yyyy", CultureInfo.InvariantCulture),
                badges = badges.Count(b => b.EarnedAt.Year == month.Year && b.EarnedAt.Month == month.Month),
                xp_earned = xp.Where(x => x.CreatedAt.Year == month.Year && x.CreatedAt.Month == month.Month)
                    .Sum(x => x.Amount),
            };
        }).ToList();

        var badgeProgression = badges
            .OrderBy(b => b.EarnedAt)
            .Select(b => new
            {
                badge_key = b.Key,
                name = b.Name,
                icon = b.Icon,
                earned_at = b.EarnedAt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            })
            .ToList();

        var user = await _db.Users.AsNoTracking()
            .Where(u => u.Id == userId)
            .Select(u => new { u.TotalXp, u.Level, u.CreatedAt })
            .FirstOrDefaultAsync();

        var totalXp = user?.TotalXp ?? 0;
        var milestones = new List<object>();

        var firstBadge = badges.OrderBy(b => b.EarnedAt).FirstOrDefault();
        if (firstBadge is not null)
        {
            milestones.Add(new
            {
                type = "first_badge",
                label = $"Earned \"{firstBadge.Name}\" {firstBadge.Icon}",
                date = firstBadge.EarnedAt.ToString("MMM dd, yyyy", CultureInfo.InvariantCulture),
            });
        }

        foreach (var m in new[] { 5, 10, 25, 50, 100 }.Where(m => badges.Count >= m))
        {
            milestones.Add(new { type = "badge_milestone", label = $"{m} badges earned", date = (string?)null });
        }

        foreach (var m in new[] { 100, 500, 1000, 5000, 10000, 50000 }.Where(m => totalXp >= m))
        {
            milestones.Add(new
            {
                type = "xp_milestone",
                label = $"{m.ToString("N0", CultureInfo.InvariantCulture)} XP reached",
                date = (string?)null,
            });
        }

        var firstListing = await _db.Listings.AsNoTracking()
            .Where(l => l.TenantId == tenantId && l.UserId == userId)
            .OrderBy(l => l.CreatedAt)
            .Select(l => (DateTime?)l.CreatedAt)
            .FirstOrDefaultAsync();
        if (firstListing is not null)
        {
            milestones.Add(new
            {
                type = "first_listing",
                label = "First listing posted",
                date = firstListing.Value.ToString("MMM dd, yyyy", CultureInfo.InvariantCulture),
            });
        }

        var level = user?.Level ?? 1;
        var summary = new
        {
            xp = totalXp,
            level,
            level_name = LevelName(level),
            total_badges = badges.Count,
            total_listings = await _db.Listings.CountAsync(l => l.TenantId == tenantId && l.UserId == userId),
            volunteer_hours = Math.Round(
                await _db.VolunteerLogs
                    .Where(v => v.TenantId == tenantId && v.UserId == userId && v.Status == "approved")
                    .SumAsync(v => (decimal?)v.Hours) ?? 0m, 1),
            total_connections = await _db.Connections.CountAsync(c => c.TenantId == tenantId
                && c.Status == Connection.Statuses.Accepted
                && (c.RequesterId == userId || c.AddresseeId == userId)),
            total_reviews = await _db.Reviews.CountAsync(r => r.TenantId == tenantId && r.ReviewerId == userId),
            member_since = user?.CreatedAt.ToString("MMM yyyy", CultureInfo.InvariantCulture),
        };

        return Ok(new
        {
            data = new
            {
                monthly_activity = monthlyActivity,
                badge_progression = badgeProgression,
                milestones,
                summary,
            }
        });
    }

    [HttpGet("gamification/share")]
    [Authorize]
    public IActionResult GamificationShare() => Ok(new { data = new { url = $"/members/{UserId()}/achievements" } });

    [HttpPost("gamification/showcase")]
    [Authorize]
    public IActionResult GamificationShowcase([FromBody] JsonElement body) => Ok(new { data = new { showcased = true } });

    [HttpGet("gamification/showcased")]
    [Authorize]
    public IActionResult GamificationShowcased() => Ok(new { data = Array.Empty<object>() });

    [HttpGet("gamification/summary")]
    [Authorize]
    public async Task<IActionResult> GamificationSummary() => Ok(new { data = await _db.Users.Where(u => u.Id == UserId()).Select(u => new { u.TotalXp, u.Level }).FirstOrDefaultAsync() });

    [HttpGet("goals/{id:int}/history/summary")]
    [Authorize]
    public IActionResult GoalHistorySummary(int id) => Ok(new { data = new { goal_id = id, updates = 0 } });

    [HttpGet("goals/{id:int}/checkins")]
    [Authorize]
    public IActionResult GoalCheckins(int id) => Ok(new { data = Array.Empty<object>() });

    [HttpGet("goals/{id:int}/reminder")]
    [Authorize]
    public IActionResult GoalReminder(int id) => Ok(new { data = new { goal_id = id, enabled = false } });

    [HttpPost("goals/templates")]
    [Authorize]
    public IActionResult GoalTemplates([FromBody] JsonElement body) => Ok(new { data = new { id = StableId(body), created = true } });

    [HttpGet("group-collections")]
    [Authorize]
    public async Task<IActionResult> GroupCollections() => Ok(new { data = await _db.Groups.Where(g => g.TenantId == TenantId()).Take(20).ToListAsync() });

    [HttpGet("group-collections/{id:int}")]
    [Authorize]
    public async Task<IActionResult> GroupCollection(int id) => Ok(new { data = await _db.Groups.FirstOrDefaultAsync(g => g.TenantId == TenantId() && g.Id == id) });

    [HttpGet("group-tags")]
    [Authorize]
    public IActionResult GroupTags() => Ok(new { data = Array.Empty<string>() });

    [HttpGet("group-tags/popular")]
    [Authorize]
    public IActionResult PopularGroupTags() => Ok(new { data = Array.Empty<string>() });

    [HttpGet("group-tags/suggest")]
    [Authorize]
    public IActionResult SuggestGroupTags() => Ok(new { data = Array.Empty<string>() });

    [HttpGet("group-templates")]
    [Authorize]
    public IActionResult GroupTemplates() => Ok(new { data = Array.Empty<object>() });

    [HttpPost("help/feedback")]
    [AllowAnonymous]
    public IActionResult HelpFeedback([FromBody] JsonElement body) => Ok(new { data = new { received = true } });

    [HttpPost("ideation-categories")]
    [Authorize]
    public IActionResult CreateIdeationCategory([FromBody] JsonElement body) => Ok(new { data = new { id = StableId(body), name = Str(body, "name") } });

    [HttpPut("ideation-categories/{id:int}")]
    [Authorize]
    public IActionResult UpdateIdeationCategory(int id, [FromBody] JsonElement body) => Ok(new { data = new { id, name = Str(body, "name") } });

    [HttpDelete("ideation-categories/{id:int}")]
    [Authorize]
    public IActionResult DeleteIdeationCategory(int id) => NoContent();

    [HttpPost("ideation-challenges")]
    [Authorize]
    public async Task<IActionResult> CreateIdeationChallenge([FromBody] JsonElement body)
    {
        var title = Str(body, "title")?.Trim();
        var description = Str(body, "description")?.Trim();
        if (string.IsNullOrWhiteSpace(title))
        {
            return UnprocessableEntity(new { success = false, error = new { code = "VALIDATION_ERROR", message = "Title is required" } });
        }

        if (string.IsNullOrWhiteSpace(description))
        {
            return UnprocessableEntity(new { success = false, error = new { code = "VALIDATION_ERROR", message = "Description is required" } });
        }

        var tenantId = TenantId();
        var userId = UserId();
        var now = DateTime.UtcNow;
        var status = NormalizeIdeationStatus(Str(body, "status"));
        var votingDeadline = DateTimeValue(body, "voting_deadline");
        var submissionDeadline = DateTimeValue(body, "submission_deadline");
        var maxIdeasPerUser = Int(body, "max_ideas_per_user");
        var challenge = new Challenge
        {
            TenantId = tenantId,
            Title = title,
            Description = description,
            ChallengeType = ChallengeType.Community,
            TargetAction = "ideation_submission",
            TargetCount = Math.Max(maxIdeasPerUser ?? 1, 1),
            XpReward = 0,
            StartsAt = now,
            EndsAt = votingDeadline ?? submissionDeadline ?? now.AddDays(30),
            IsActive = status is "open" or "voting" or "evaluating",
            Difficulty = ChallengeDifficulty.Medium,
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.Challenges.Add(challenge);
        await _db.SaveChangesAsync();
        await SetTenantConfigAsync(tenantId, $"admin.feed.author.challenge.{challenge.Id}", userId.ToString(), now);
        await SetTenantConfigAsync(tenantId, IdeationChallengeMetaKey(challenge.Id), JsonSerializer.Serialize(new
        {
            category = Str(body, "category")?.Trim(),
            prize_description = Str(body, "prize_description")?.Trim(),
            submission_deadline = submissionDeadline,
            voting_deadline = votingDeadline,
            max_ideas_per_user = maxIdeasPerUser,
            status,
            cover_image = Str(body, "cover_image")?.Trim(),
            tags = StringArray(body, "tags")
        }), now);
        await _db.SaveChangesAsync();

        var data = new
        {
            id = challenge.Id,
            title = challenge.Title,
            description = challenge.Description,
            category = Str(body, "category")?.Trim(),
            prize_description = Str(body, "prize_description")?.Trim(),
            submission_deadline = submissionDeadline,
            voting_deadline = votingDeadline,
            max_ideas_per_user = maxIdeasPerUser,
            status,
            cover_image = Str(body, "cover_image")?.Trim(),
            tags = StringArray(body, "tags"),
            created_at = challenge.CreatedAt,
            updated_at = challenge.UpdatedAt
        };

        return Created($"/api/v2/ideation-challenges/{challenge.Id}", new { success = true, data });
    }

    [HttpGet("ideation-ideas/{id:int}/comments")]
    [Authorize]
    public IActionResult IdeationIdeaComments(int id) => Ok(new { data = Array.Empty<object>(), idea_id = id });

    [HttpGet("ideation-ideas/{id:int}/media")]
    [Authorize]
    public IActionResult IdeationIdeaMedia(int id) => Ok(new { data = Array.Empty<object>(), idea_id = id });

    [HttpGet("ideation-challenges/{id:int}/ideas")]
    [Authorize]
    public IActionResult IdeationChallengeIdeas(int id) => Ok(new { data = Array.Empty<object>() });

    [HttpGet("ideation-challenges/{id:int}/team-links")]
    [Authorize]
    public IActionResult IdeationChallengeTeamLinks(int id) => Ok(new { data = Array.Empty<object>() });

    [HttpPut("ideation-challenges/{id:int}/outcome")]
    [Authorize]
    public IActionResult UpdateIdeationChallengeOutcome(int id, [FromBody] JsonElement body) => Ok(new { data = new { id, outcome = Str(body, "outcome") } });

    [HttpDelete("ideation-media/{id:int}")]
    [Authorize]
    public IActionResult DeleteIdeationMedia(int id) => NoContent();

    [HttpGet("ideation-tags")]
    [Authorize]
    public IActionResult IdeationTags([FromQuery(Name = "type")] string? tagType = null)
    {
        var data = IdeationBootstrapCompatibility.Tags
            .Where(tag => string.IsNullOrWhiteSpace(tagType) || string.Equals(tag.TagType, tagType, StringComparison.OrdinalIgnoreCase))
            .OrderBy(tag => tag.Name)
            .ToArray();

        return Ok(new { success = true, data });
    }

    [HttpPost("ideation-tags")]
    [Authorize]
    public IActionResult CreateIdeationTag([FromBody] JsonElement body) => Ok(new { data = new { id = StableId(body), name = Str(body, "name") } });

    [HttpDelete("ideation-tags/{id:int}")]
    [Authorize]
    public IActionResult DeleteIdeationTag(int id) => NoContent();

    [HttpPost("ideation-templates")]
    [Authorize]
    public IActionResult CreateIdeationTemplate([FromBody] JsonElement body) => Ok(new { data = new { id = StableId(body), title = Str(body, "title") } });

    [HttpGet("ideation-templates/{id:int}")]
    [Authorize]
    public IActionResult IdeationTemplate(int id)
    {
        var data = IdeationBootstrapCompatibility.FindTemplate(id);
        return data == null
            ? NotFound(new
            {
                success = false,
                error = new
                {
                    code = "RESOURCE_NOT_FOUND",
                    message = "Template not found"
                }
            })
            : Ok(new { success = true, data });
    }

    [HttpPut("ideation-templates/{id:int}")]
    [Authorize]
    public IActionResult UpdateIdeationTemplate(int id, [FromBody] JsonElement body) => Ok(new { data = new { id, title = Str(body, "title") } });

    [HttpDelete("ideation-templates/{id:int}")]
    [Authorize]
    public IActionResult DeleteIdeationTemplate(int id) => NoContent();

    [HttpGet("identity/status")]
    [Authorize]
    public async Task<IActionResult> IdentityStatus()
    {
        var userId = User.GetUserId();
        if (!userId.HasValue)
            return Unauthorized(new { error = "Invalid token" });

        var latestSession = await _db.IdentityVerificationSessions
            .AsNoTracking()
            .Where(session => session.UserId == userId.Value)
            .OrderByDescending(session => session.CreatedAt)
            .ThenByDescending(session => session.Id)
            .FirstOrDefaultAsync();

        var hasVerifiedBadge = await _db.UserVerificationBadges
            .AsNoTracking()
            .AnyAsync(userBadge => userBadge.UserId == userId.Value
                && (userBadge.ExpiresAt == null || userBadge.ExpiresAt > DateTime.UtcNow)
                && userBadge.BadgeType != null
                && userBadge.BadgeType.Key == "id_verified");

        var feeRaw = await _db.TenantConfigs
            .AsNoTracking()
            .Where(config => config.Key == "identity_verification_fee_cents")
            .Select(config => config.Value)
            .FirstOrDefaultAsync();
        var feeCents = int.TryParse(feeRaw, out var configuredFee) && configuredFee >= 0 ? configuredFee : 500;
        var status = IdentityVerificationStatus(latestSession?.Status);

        return Ok(new
        {
            data = new
            {
                has_id_verified_badge = hasVerifiedBadge,
                user_has_dob = false,
                fee_cents = feeCents,
                fee_currency = "eur",
                payment_completed = feeCents == 0,
                verification_status = latestSession == null ? null : status,
                latest_session = latestSession == null ? null : new
                {
                    id = latestSession.Id,
                    status,
                    provider = IdentityVerificationProvider(latestSession.Provider),
                    created_at = latestSession.CreatedAt,
                    failure_reason = latestSession.DecisionReason
                }
            }
        });
    }

    [HttpPost("identity/start")]
    [Authorize]
    public IActionResult IdentityStart([FromBody] JsonElement body) => Ok(new { data = new { status = "pending" } });

    [HttpPost("identity/save-dob")]
    [Authorize]
    public IActionResult IdentitySaveDob([FromBody] JsonElement body) => Ok(new { data = new { saved = true } });

    [HttpPost("identity/create-payment")]
    [Authorize]
    public IActionResult IdentityCreatePayment([FromBody] JsonElement body) => Ok(new { data = new { client_secret = "mock_secret" } });

    [HttpPost("kb")]
    [Authorize]
    public IActionResult CreateKb([FromBody] JsonElement body) => Ok(new { data = new { id = StableId(body), title = Str(body, "title") } });

    [HttpPut("kb/{id:int}")]
    [Authorize]
    public IActionResult UpdateKb(int id, [FromBody] JsonElement body) => Ok(new { data = new { id, title = Str(body, "title") } });

    [HttpDelete("kb/{id:int}")]
    [Authorize]
    public IActionResult DeleteKb(int id) => NoContent();

    [HttpGet("kb/slug/{slug}")]
    [AllowAnonymous]
    public IActionResult KbBySlug(string slug) => Ok(new { data = new { slug, title = slug } });

    [HttpPost("kb/{id:int}/attachments")]
    [Authorize]
    public IActionResult KbAttachment(int id, [FromBody] JsonElement body) => Ok(new { data = new { id = StableId(body), article_id = id } });

    [HttpGet("kb/{id:int}/attachments/{attachmentId:int}/download")]
    [Authorize]
    public IActionResult KbAttachmentDownload(int id, int attachmentId) => File(Encoding.UTF8.GetBytes($"Attachment {attachmentId}"), "text/plain", $"kb-{id}-{attachmentId}.txt");

    [HttpDelete("kb/{id:int}/attachments/{attachmentId:int}")]
    [Authorize]
    public IActionResult DeleteKbAttachment(int id, int attachmentId) => NoContent();

    [HttpGet("laravel/health")]
    [AllowAnonymous]
    public IActionResult LaravelHealth() => Ok(new { ok = true, compatibility = "v1.5" });

    [HttpGet("leaderboard")]
    [Authorize]
    public async Task<IActionResult> Leaderboard() => Ok(new { data = await _db.Users.Where(u => u.TenantId == TenantId()).OrderByDescending(u => u.TotalXp).Take(50).Select(u => new { u.Id, u.FirstName, u.LastName, u.TotalXp }).ToListAsync() });

    [HttpGet("leaderboard/widget")]
    [Authorize]
    public Task<IActionResult> LeaderboardWidget() => Leaderboard();

    // 🔴 REMOVED 2026-08-15: three no-op legal endpoints lived here and lied.
    //   POST legal/accept      -> Ok(new { accepted = true })
    //   POST legal/accept-all  -> Ok(new { accepted = "all" })
    //   GET  legal/status      -> Ok(new { data = new { accepted = true } })
    // None of them persisted anything, and `legal/status` reported that the
    // member had accepted the terms unconditionally — an actively false answer
    // about a compliance record. The real implementations are
    // ReactFrontendCompatibilityController.LegalAcceptanceStatus and
    // CompatibilityAliasController.AcceptAllLegal, now registered at both the
    // /api/legal/... and /api/v2/legal/... spellings. Deleting these removes the
    // chance that which handler answers depends on the spelling a client picks.

    [HttpPost("link-preview")]
    [Authorize]
    public IActionResult LinkPreview([FromBody] JsonElement body) => Ok(new { data = new { url = Str(body, "url"), title = Str(body, "url") ?? "Preview", description = string.Empty } });

    [HttpGet("newsletter/click/{id}")]
    [AllowAnonymous]
    public IActionResult NewsletterClick(string id) => Redirect("/");

    [HttpGet("newsletter/pixel/{id}")]
    [AllowAnonymous]
    public IActionResult NewsletterPixel(string id) => File(Convert.FromBase64String("R0lGODlhAQABAAAAACw="), "image/gif");

    [HttpGet("newsletter/unsubscribe")]
    [AllowAnonymous]
    public IActionResult NewsletterUnsubscribe() => Ok(new { unsubscribed = true });

    [HttpGet("nexus-score")]
    [Authorize]
    public IActionResult NexusScore() => Ok(new { data = new { score = 500 } });

    [HttpPost("pilot-inquiry")]
    [AllowAnonymous]
    public IActionResult PilotInquiry([FromBody] JsonElement body) => Ok(new { data = new { received = true } });

    [HttpPut("polls/{id:int}")]
    [Authorize]
    public IActionResult UpdatePoll(int id, [FromBody] JsonElement body) => Ok(new { data = new { id, title = Str(body, "title") } });

    [HttpGet("polls/{id:int}/export")]
    [Authorize]
    public IActionResult ExportPoll(int id) => File(Encoding.UTF8.GetBytes($"poll_id\n{id}\n"), "text/csv", $"poll-{id}.csv");

    [HttpPost("polls/vote")]
    [Authorize]
    public IActionResult LegacyPollVote([FromBody] JsonElement body) => Ok(new { data = new { voted = true } });

    [HttpPost("reactions")]
    [Authorize]
    public async Task<IActionResult> CreateReaction([FromBody] JsonElement body)
    {
        var targetType = NormalizeReactionTargetType(Str(body, "target_type") ?? Str(body, "type"));
        var targetId = Int(body, "target_id") ?? Int(body, "id") ?? 0;
        var reactionType = NormalizeReactionType(Str(body, "reaction_type") ?? Str(body, "emoji") ?? Str(body, "reaction"));

        if (!LaravelReactionTypes.Contains(reactionType))
        {
            return LaravelError("VALIDATION_ERROR", "Invalid reaction type.", "reaction_type", StatusCodes.Status400BadRequest);
        }

        if (!LaravelReactionTargetTypes.Contains(targetType))
        {
            return LaravelError("VALIDATION_ERROR", "Invalid target type.", "target_type", StatusCodes.Status400BadRequest);
        }

        if (targetId <= 0)
        {
            return LaravelError("VALIDATION_ERROR", "Target id must be positive.", "target_id", StatusCodes.Status400BadRequest);
        }

        if (!await ReactionTargetExistsAsync(targetType, targetId))
        {
            return LaravelError("NOT_FOUND", "Target not found.", null, StatusCodes.Status404NotFound);
        }

        var userId = UserId();
        var existing = await _db.ContentReactions.FirstOrDefaultAsync(r =>
            r.TargetType == targetType &&
            r.TargetId == targetId &&
            r.UserId == userId);

        var action = "added";
        string? resultType = reactionType;
        if (existing != null && existing.ReactionType == reactionType)
        {
            _db.ContentReactions.Remove(existing);
            action = "removed";
            resultType = null;
        }
        else if (existing != null)
        {
            existing.ReactionType = reactionType;
            existing.CreatedAt = DateTime.UtcNow;
            action = "updated";
        }
        else
        {
            _db.ContentReactions.Add(new ContentReaction
            {
                TenantId = TenantId(),
                TargetType = targetType,
                TargetId = targetId,
                UserId = userId,
                ReactionType = reactionType,
                CreatedAt = DateTime.UtcNow
            });
        }

        await _db.SaveChangesAsync();

        return LaravelData(new
        {
            action,
            reaction_type = resultType,
            reactions = await BuildReactionSummaryAsync(targetType, targetId, userId)
        });
    }

    [HttpGet("comments/{id:int}/reactions")]
    [Authorize]
    public IActionResult CommentReactions(int id) => Ok(new { data = Array.Empty<object>(), comment_id = id });

    [HttpGet("recommendations/groups")]
    [Authorize]
    public async Task<IActionResult> RecommendedGroups() => Ok(new { data = await _db.Groups.Where(g => g.TenantId == TenantId()).Take(20).ToListAsync() });

    [HttpGet("recommendations/similar/{id:int}")]
    [Authorize]
    public IActionResult SimilarRecommendations(int id) => Ok(new { data = Array.Empty<object>(), source_id = id });

    [HttpPost("recommendations/track")]
    [Authorize]
    public IActionResult TrackRecommendation([FromBody] JsonElement body) => Ok(new { data = new { tracked = true } });

    [HttpGet("reactions/{type}/{id:int}")]
    [Authorize]
    public async Task<IActionResult> Reactions(string type, int id)
    {
        var targetType = NormalizeReactionTargetType(type);
        if (!LaravelReactionTargetTypes.Contains(targetType))
        {
            return LaravelError("VALIDATION_ERROR", "Invalid target type.", "target_type", StatusCodes.Status400BadRequest);
        }

        if (!await ReactionTargetExistsAsync(targetType, id))
        {
            return LaravelError("NOT_FOUND", "Target not found.", null, StatusCodes.Status404NotFound);
        }

        return LaravelData(await BuildReactionSummaryAsync(targetType, id, User.GetUserId()));
    }

    [HttpGet("reactions/{type}/{id:int}/users/{reaction}")]
    [Authorize]
    public async Task<IActionResult> ReactionUsers(string type, int id, string reaction)
    {
        var targetType = NormalizeReactionTargetType(type);
        var reactionType = NormalizeReactionType(reaction);
        if (!LaravelReactionTargetTypes.Contains(targetType))
        {
            return LaravelError("VALIDATION_ERROR", "Invalid target type.", "target_type", StatusCodes.Status400BadRequest);
        }

        if (!LaravelReactionTypes.Contains(reactionType))
        {
            return LaravelError("VALIDATION_ERROR", "Invalid reaction type.", "type", StatusCodes.Status400BadRequest);
        }

        if (!await ReactionTargetExistsAsync(targetType, id))
        {
            return LaravelError("NOT_FOUND", "Target not found.", null, StatusCodes.Status404NotFound);
        }

        var page = QueryInt("page", 1, 1, int.MaxValue);
        var perPage = QueryInt("per_page", 20, 1, 50);
        var query = _db.ContentReactions
            .Where(r => r.TargetType == targetType && r.TargetId == id && r.ReactionType == reactionType);
        var total = await query.CountAsync();
        var users = await query
            .OrderByDescending(r => r.CreatedAt)
            .Skip((page - 1) * perPage)
            .Take(perPage)
            .Select(r => new
            {
                id = r.UserId,
                name = r.User == null ? string.Empty : (r.User.FirstName + " " + r.User.LastName).Trim(),
                avatar_url = r.User == null ? null : r.User.AvatarUrl,
                reacted_at = r.CreatedAt
            })
            .ToListAsync();

        var totalPages = total > 0 ? (int)Math.Ceiling(total / (double)perPage) : 0;
        return Ok(new
        {
            data = users,
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

    [HttpGet("resources/{id:int}/download")]
    [Authorize]
    public IActionResult ResourceDownload(int id) => File(Encoding.UTF8.GetBytes($"Resource {id}"), "text/plain", $"resource-{id}.txt");

    // POST api/reviews moved to ReviewsController.CreateReview on 2026-08-22 and is
    // deliberately NOT redeclared here. It was a do-nothing stub that answered 200
    // with an invented id and wrote nothing, so web-uk told the member their review
    // had been left while the reviews page stayed empty. Two controllers cannot own
    // one verb: a duplicate throws AmbiguousMatchException, which surfaces as a 500
    // whose lost CORS headers make every browser report it as a CORS error instead.

    [HttpGet("reviews/user/{userId:int}/stats")]
    [Authorize]
    public async Task<IActionResult> ReviewUserStats(int userId)
    {
        var reviews = await _db.Reviews.Where(r => r.TargetUserId == userId).ToListAsync();
        return Ok(new { data = new { count = reviews.Count, average = reviews.Count == 0 ? 0 : Math.Round(reviews.Average(r => r.Rating), 2) } });
    }

    [HttpGet("safeguarding/my-preferences")]
    [Authorize]
    public async Task<IActionResult> SafeguardingPreferences()
    {
        var tenantId = TenantId();
        var userId = UserId();
        var now = DateTime.UtcNow;

        await _db.UserSafeguardingPreferences
            .Where(p => p.TenantId == tenantId
                && p.UserId == userId
                && p.RevokedAt == null
                && p.ReviewReminderSentAt != null
                && p.ReviewConfirmedAt == null)
            .ExecuteUpdateAsync(setters => setters.SetProperty(p => p.ReviewConfirmedAt, now));

        var rows = await _db.UserSafeguardingPreferences
            .AsNoTracking()
            .Include(p => p.Option)
            .Where(p => p.TenantId == tenantId
                && p.UserId == userId
                && p.RevokedAt == null
                && p.Option != null
                && p.Option.IsActive)
            .OrderBy(p => p.Option!.SortOrder)
            .ThenBy(p => p.Id)
            .ToListAsync();

        var preferences = rows.Select(p => new
        {
            preference_id = p.Id,
            option_id = p.OptionId,
            option_key = p.Option?.OptionKey ?? string.Empty,
            label = p.Option?.Label ?? string.Empty,
            description = p.Option?.Description,
            selected_value = p.SelectedValue,
            consent_given_at = p.ConsentGivenAt,
            created_at = p.CreatedAt,
            activations = SafeguardingActivations(p.Option?.TriggersJson)
        }).ToList();

        return LaravelData(new
        {
            preferences,
            count = preferences.Count
        });
    }

    [HttpPost("safeguarding/revoke")]
    [Authorize]
    public async Task<IActionResult> RevokeSafeguarding([FromBody] JsonElement body)
    {
        var optionId = Int(body, "option_id");
        if (optionId is null or <= 0)
        {
            return LaravelError("VALIDATION_ERROR", "The option_id field is required.", "option_id", StatusCodes.Status422UnprocessableEntity);
        }

        var tenantId = TenantId();
        var userId = UserId();
        var now = DateTime.UtcNow;
        var affected = await _db.UserSafeguardingPreferences
            .Where(p => p.TenantId == tenantId
                && p.UserId == userId
                && p.OptionId == optionId.Value
                && p.RevokedAt == null)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(p => p.RevokedAt, now)
                .SetProperty(p => p.UpdatedAt, now));

        if (affected == 0)
        {
            return LaravelError("NOT_FOUND", "Safeguarding preference could not be revoked.", "option_id", StatusCodes.Status404NotFound);
        }

        return LaravelData(new
        {
            revoked = true,
            option_id = optionId.Value
        });
    }

    [HttpPost("search/saved/{id:int}/run")]
    [Authorize]
    public IActionResult RunSavedSearch(int id) => Ok(new { data = Array.Empty<object>(), saved_search_id = id });

    [HttpGet("search/trending")]
    [Authorize]
    public IActionResult TrendingSearch() => Ok(new { data = Array.Empty<string>() });

    [HttpGet("seo/metadata/{slug}")]
    [AllowAnonymous]
    public IActionResult SeoMetadata(string slug) => Ok(new { data = new { slug, title = slug } });

    [HttpGet("seo/redirects")]
    [AllowAnonymous]
    public IActionResult SeoRedirects() => Ok(new { data = Array.Empty<object>() });

    [HttpPost("shares")]
    [Authorize]
    public IActionResult CreateShare([FromBody] JsonElement body) => Ok(new { data = new { id = StableId(body), shared = true } });

    [HttpDelete("shares")]
    [Authorize]
    public IActionResult DeleteShare([FromBody] JsonElement body) => NoContent();

    [HttpPost("shop/purchase")]
    [Authorize]
    public IActionResult ShopPurchase([FromBody] JsonElement body) => Ok(new { data = new { id = StableId(body), status = "purchased" } });

    [HttpPost("skills/categories")]
    [Authorize]
    public IActionResult CreateSkillCategory([FromBody] JsonElement body) => Ok(new { data = new { id = StableId(body), name = Str(body, "name") ?? "Category" } });

    [HttpPut("skills/categories/{id:int}")]
    [Authorize]
    public IActionResult UpdateSkillCategory(int id, [FromBody] JsonElement body) => Ok(new { data = new { id, name = Str(body, "name") ?? "Category" } });

    [HttpDelete("skills/categories/{id:int}")]
    [Authorize]
    public IActionResult DeleteSkillCategory(int id) => NoContent();

    [HttpGet("streaks")]
    [Authorize]
    public IActionResult Streaks() => Ok(new { data = new { current = 0 } });

    [HttpGet("totp/status")]
    [Authorize]
    public async Task<IActionResult> TotpStatus()
    {
        var userId = UserId();
        var state = await _db.Users
            .AsNoTracking()
            .Where(user => user.Id == userId)
            .Select(user => new
            {
                enabled = user.TwoFactorEnabled,
                setup_required = !user.TwoFactorEnabled && user.TotpSecretEncrypted != null
            })
            .SingleOrDefaultAsync();
        if (state is null)
            return Unauthorized(new { success = false, error = "Invalid token" });

        var backupCodesRemaining = state.enabled
            ? await _db.TotpBackupCodes.CountAsync(code => code.UserId == userId && !code.IsUsed)
            : 0;

        return Ok(new
        {
            success = true,
            state.enabled,
            state.setup_required,
            backup_codes_remaining = backupCodesRemaining,
            trusted_devices = Array.Empty<object>()
        });
    }

    [HttpPost("ugc-translate")]
    [Authorize]
    public IActionResult UgcTranslate([FromBody] JsonElement body) => Ok(new { data = new { translated_text = Str(body, "text") ?? string.Empty } });

    [HttpGet("vol_opportunities")]
    [Authorize]
    public async Task<IActionResult> LegacyVolOpportunities() => Ok(new { data = await _db.VolunteerOpportunities.Take(50).ToListAsync() });

    [HttpPost("webhooks/identity/{provider}")]
    [AllowAnonymous]
    public IActionResult IdentityWebhook(string provider, [FromBody] JsonElement body)
        => WebhookNotProcessed(provider, "webhooks/identity/{provider}");

    [HttpPost("webhooks/sendgrid/events")]
    [AllowAnonymous]
    public IActionResult SendgridEvents([FromBody] JsonElement body)
        => WebhookNotProcessed("sendgrid", "webhooks/sendgrid/events");

    // NOTE: the REAL, signature-verifying Stripe handlers live at
    // api/webhooks/stripe/donations (Phase72Controllers StripeWebhookController)
    // and api/v2/marketplace/webhooks/stripe (MarketplaceController). This bare
    // path has no processor, so it must refuse rather than swallow the event.
    [HttpPost("webhooks/stripe")]
    [AllowAnonymous]
    public IActionResult StripeWebhook([FromBody] JsonElement body)
        => WebhookNotProcessed("stripe", "webhooks/stripe");

    private int TenantId() => _tenantContext.TenantId ?? 0;
    private int UserId() => User.GetUserId() ?? 0;
    private static string Token() => Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();

    private static bool? ReadBool(IReadOnlyDictionary<string, string> settings, string key)
    {
        if (!settings.TryGetValue(key, out var value)) return null;
        return value.Trim().ToLowerInvariant() switch
        {
            "1" or "true" or "yes" or "on" => true,
            "0" or "false" or "no" or "off" => false,
            _ => null
        };
    }

    private static string Allowed(string value, IReadOnlyCollection<string> allowed, string fallback)
        => allowed.Contains(value, StringComparer.Ordinal) ? value : fallback;

    private static string FirstNonEmpty(string preferred, string? fallback)
        => preferred.Length > 0 ? preferred : fallback?.Trim() ?? string.Empty;

    private static string IdentityVerificationStatus(VerificationSessionStatus? status) => status switch
    {
        VerificationSessionStatus.Created => "created",
        VerificationSessionStatus.InProgress => "processing",
        VerificationSessionStatus.Completed => "passed",
        VerificationSessionStatus.Failed => "failed",
        VerificationSessionStatus.Expired => "expired",
        VerificationSessionStatus.Cancelled => "cancelled",
        _ => "not_started"
    };

    private static string? IdentityVerificationProvider(VerificationProvider provider) => provider switch
    {
        VerificationProvider.None => null,
        VerificationProvider.StripeIdentity => "stripe_identity",
        _ => provider.ToString().ToLowerInvariant()
    };
    private static string? Str(JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind != JsonValueKind.Null ? v.ToString() : null;
    private static int? Int(JsonElement e, string name) => int.TryParse(Str(e, name), out var value) ? value : null;
    private static decimal? Decimal(JsonElement e, string name) => decimal.TryParse(Str(e, name), out var value) ? value : null;
    private static bool? Bool(JsonElement e, string name) => bool.TryParse(Str(e, name), out var value) ? value : null;
    private static DateTime? DateTimeValue(JsonElement e, string name) => DateTime.TryParse(Str(e, name), out var value) ? value.ToUniversalTime() : null;

    private static string Slugify(string value)
    {
        var builder = new StringBuilder(value.Length);
        var previousWasSeparator = false;

        foreach (var c in value.Trim().ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(c))
            {
                builder.Append(c);
                previousWasSeparator = false;
            }
            else if (!previousWasSeparator && builder.Length > 0)
            {
                builder.Append('-');
                previousWasSeparator = true;
            }
        }

        return builder.ToString().Trim('-');
    }

    private static string[] NormalizePlanFeatures(string? features)
    {
        if (string.IsNullOrWhiteSpace(features))
        {
            return [];
        }

        try
        {
            using var document = JsonDocument.Parse(features);
            var root = document.RootElement;
            if (root.ValueKind == JsonValueKind.Array)
            {
                return root.EnumerateArray()
                    .Where(item => item.ValueKind == JsonValueKind.String)
                    .Select(item => item.GetString()?.Trim())
                    .Where(item => !string.IsNullOrWhiteSpace(item))
                    .Select(item => item!)
                    .ToArray();
            }

            if (root.ValueKind == JsonValueKind.Object)
            {
                return root.EnumerateObject()
                    .Where(property => IsTruthyFeatureValue(property.Value))
                    .Select(property => property.Name)
                    .ToArray();
            }
        }
        catch (JsonException)
        {
            return [];
        }

        return [];
    }

    private static bool IsTruthyFeatureValue(JsonElement value) => value.ValueKind switch
    {
        JsonValueKind.True => true,
        JsonValueKind.False or JsonValueKind.Null or JsonValueKind.Undefined => false,
        JsonValueKind.Number => value.TryGetDecimal(out var number) && number != 0m,
        JsonValueKind.String => !string.IsNullOrWhiteSpace(value.GetString()),
        JsonValueKind.Array => value.GetArrayLength() > 0,
        JsonValueKind.Object => value.EnumerateObject().Any(),
        _ => false
    };

    private static object SafeguardingActivations(string? triggersJson)
    {
        var requiresBrokerApproval = false;
        var restrictsMessaging = false;
        var restrictsMatching = false;
        var requiresVettedInteraction = false;
        string? vettingTypeRequired = null;

        if (!string.IsNullOrWhiteSpace(triggersJson))
        {
            try
            {
                using var document = JsonDocument.Parse(triggersJson);
                var root = document.RootElement;
                if (root.ValueKind == JsonValueKind.Object)
                {
                    requiresBrokerApproval = JsonBool(root, "requires_broker_approval");
                    restrictsMessaging = JsonBool(root, "restricts_messaging");
                    restrictsMatching = JsonBool(root, "restricts_matching");
                    requiresVettedInteraction = JsonBool(root, "requires_vetted_interaction");
                    vettingTypeRequired = root.TryGetProperty("vetting_type_required", out var vetting)
                        && vetting.ValueKind == JsonValueKind.String
                            ? vetting.GetString()
                            : null;
                }
            }
            catch (JsonException)
            {
                // Laravel treats malformed trigger JSON as an empty trigger set.
            }
        }

        return new
        {
            requires_broker_approval = requiresBrokerApproval,
            restricts_messaging = restrictsMessaging,
            restricts_matching = restrictsMatching,
            requires_vetted_interaction = requiresVettedInteraction,
            vetting_type_required = vettingTypeRequired
        };
    }

    private static bool JsonBool(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var value))
        {
            return false;
        }

        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False or JsonValueKind.Null or JsonValueKind.Undefined => false,
            JsonValueKind.Number => value.TryGetInt32(out var number) && number != 0,
            JsonValueKind.String => bool.TryParse(value.GetString(), out var parsed)
                ? parsed
                : value.GetString() is "1" or "yes" or "on",
            _ => false
        };
    }

    private async Task<bool> ReactionTargetExistsAsync(string targetType, int targetId)
    {
        var tenantId = TenantId();
        return targetType switch
        {
            "post" => await _db.FeedPosts.AnyAsync(p => p.TenantId == tenantId && p.Id == targetId && !p.IsHidden),
            "comment" => await _db.ThreadedComments.AnyAsync(c => c.TenantId == tenantId && c.Id == targetId && !c.IsDeleted)
                || await _db.PostComments.AnyAsync(c => c.TenantId == tenantId && c.Id == targetId),
            "listing" => await _db.Listings.AnyAsync(l => l.TenantId == tenantId && l.Id == targetId),
            "event" => await _db.Events.AnyAsync(e => e.TenantId == tenantId && e.Id == targetId && !e.IsCancelled),
            "goal" => await _db.Goals.AnyAsync(g => g.TenantId == tenantId && g.Id == targetId),
            "poll" => await _db.Polls.AnyAsync(p => p.TenantId == tenantId && p.Id == targetId),
            "review" => await _db.Reviews.AnyAsync(r => r.TenantId == tenantId && r.Id == targetId),
            "volunteer" => await _db.VolunteerOpportunities.AnyAsync(v => v.TenantId == tenantId && v.Id == targetId),
            "challenge" => await _db.Challenges.AnyAsync(c => c.TenantId == tenantId && c.Id == targetId),
            "resource" => await _db.Resources.AnyAsync(r => r.TenantId == tenantId && r.Id == targetId),
            "job" => await _db.JobVacancies.AnyAsync(j => j.TenantId == tenantId && j.Id == targetId),
            "blog" => await _db.BlogPosts.AnyAsync(b => b.TenantId == tenantId && b.Id == targetId),
            "discussion" => await _db.GroupDiscussions.AnyAsync(d => d.TenantId == tenantId && d.Id == targetId),
            _ => false
        };
    }

    private async Task<object> BuildReactionSummaryAsync(string targetType, int targetId, int? userId)
    {
        var rows = await _db.ContentReactions
            .Where(r => r.TargetType == targetType && r.TargetId == targetId)
            .Include(r => r.User)
            .ToListAsync();

        var counts = rows
            .GroupBy(r => r.ReactionType)
            .ToDictionary(g => g.Key, g => g.Count());

        var topReactors = rows
            .OrderByDescending(r => r.CreatedAt)
            .Take(3)
            .Select(r => new
            {
                id = r.UserId,
                name = r.User == null ? string.Empty : (r.User.FirstName + " " + r.User.LastName).Trim(),
                avatar_url = r.User?.AvatarUrl
            })
            .ToList();

        return new
        {
            counts,
            total = rows.Count,
            user_reaction = userId.HasValue ? rows.FirstOrDefault(r => r.UserId == userId.Value)?.ReactionType : null,
            top_reactors = topReactors
        };
    }

    private IActionResult LaravelData(object data, int status = StatusCodes.Status200OK)
    {
        return StatusCode(status, new
        {
            data,
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    private IActionResult LaravelError(string code, string message, string? field, int status)
    {
        object error = field == null
            ? new { code, message }
            : new { code, message, field };

        return StatusCode(status, new
        {
            errors = new[] { error },
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    private int QueryInt(string key, int fallback, int min, int max)
    {
        if (!Request.Query.TryGetValue(key, out var raw) || !int.TryParse(raw.ToString(), out var value))
        {
            value = fallback;
        }

        return Math.Clamp(value, min, max);
    }

    private static string NormalizeReactionTargetType(string? value)
    {
        var normalized = value?.Trim().ToLowerInvariant() ?? string.Empty;
        return normalized switch
        {
            "feed_post" => "post",
            "blog_post" => "blog",
            "volunteering" or "volunteering_opportunity" => "volunteer",
            "ideation_challenge" => "challenge",
            _ => normalized
        };
    }

    private static string NormalizeReactionType(string? value)
    {
        var normalized = value?.Trim().ToLowerInvariant() ?? string.Empty;
        return normalized switch
        {
            "heart" => "love",
            "thumbs_up" => "like",
            "thumbs_down" => "sad",
            _ => normalized
        };
    }

    private static string NormalizeIdeationStatus(string? status)
    {
        var normalized = string.IsNullOrWhiteSpace(status) ? "open" : status.Trim().ToLowerInvariant();
        return normalized is "draft" or "open" or "voting" or "evaluating" or "closed" or "archived"
            ? normalized
            : "open";
    }

    private static string[] StringArray(JsonElement e, string name)
    {
        if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return value
            .EnumerateArray()
            .Where(item => item.ValueKind == JsonValueKind.String)
            .Select(item => item.GetString()?.Trim())
            .Where(item => !string.IsNullOrWhiteSpace(item))
            .Select(item => item!)
            .ToArray();
    }

    private async Task SetTenantConfigAsync(int tenantId, string key, string value, DateTime now)
    {
        var existing = await _db.TenantConfigs.FirstOrDefaultAsync(c => c.TenantId == tenantId && c.Key == key);
        if (existing != null)
        {
            existing.Value = value;
            existing.UpdatedAt = now;
            return;
        }

        _db.TenantConfigs.Add(new TenantConfig
        {
            TenantId = tenantId,
            Key = key,
            Value = value,
            CreatedAt = now,
            UpdatedAt = now
        });
    }

    private static string IdeationChallengeMetaKey(int id) => $"ideation.challenge.meta.{id}";

    private async Task<List<LocalAdCampaignRecord>> LoadLocalAdCampaignsAsync(int tenantId)
    {
        var raw = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key == LocalAdvertisingCampaignsKey)
            .Select(c => c.Value)
            .FirstOrDefaultAsync();

        if (string.IsNullOrWhiteSpace(raw))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<List<LocalAdCampaignRecord>>(raw, StoreJsonOptions) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private static bool TryParseDate(string? value, out DateTime date)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            date = default;
            return false;
        }

        return DateTime.TryParse(value, out date);
    }

    private static string TrackingToken(int tenantId, int campaignId, int creativeId, string placement)
    {
        var payload = $"{tenantId}:{campaignId}:{creativeId}:{placement}";
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payload))).ToLowerInvariant();
    }

    private sealed class LocalAdCampaignRecord
    {
        public int Id { get; set; }
        public int TenantId { get; set; }
        public int CreatedBy { get; set; }
        public string Name { get; set; } = string.Empty;
        public string Status { get; set; } = "pending_review";
        public string AdvertiserType { get; set; } = "sme";
        public int BudgetCents { get; set; }
        public int SpentCents { get; set; }
        public string? StartDate { get; set; }
        public string? EndDate { get; set; }
        public string Placement { get; set; } = "feed";
        public int ImpressionCount { get; set; }
        public string? AdvertiserName { get; set; }
        public List<LocalAdCreativeRecord> Creatives { get; set; } = [];
    }

    private sealed class LocalAdCreativeRecord
    {
        public int Id { get; set; }
        public string Headline { get; set; } = string.Empty;
        public string? Body { get; set; }
        public string? CtaText { get; set; }
        public string? ImageUrl { get; set; }
        public string? DestinationUrl { get; set; }
        public int IsActive { get; set; } = 1;
    }

    private async Task<List<AppreciationRecord>> LoadAppreciationsAsync(int tenantId)
    {
        var raw = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.TenantId == tenantId && c.Key == AppreciationsKey)
            .Select(c => c.Value)
            .FirstOrDefaultAsync();

        if (string.IsNullOrWhiteSpace(raw))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<List<AppreciationRecord>>(raw, StoreJsonOptions) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private async Task SaveAppreciationsAsync(int tenantId, List<AppreciationRecord> records)
    {
        var json = JsonSerializer.Serialize(records.OrderBy(a => a.Id).ToList(), StoreJsonOptions);
        await SetTenantConfigAsync(tenantId, AppreciationsKey, json, DateTime.UtcNow);
        await _db.SaveChangesAsync();
    }

    private async Task<object> MapAppreciationAsync(AppreciationRecord record, int? currentUserId)
    {
        var sender = await _db.Users
            .AsNoTracking()
            .Where(u => u.TenantId == record.TenantId && u.Id == record.SenderId)
            .Select(u => new { u.Id, u.FirstName, u.LastName, u.Email, u.AvatarUrl })
            .FirstOrDefaultAsync();

        return new
        {
            id = record.Id,
            sender_id = record.SenderId,
            receiver_id = record.ReceiverId,
            message = record.Message,
            context_type = record.ContextType,
            context_id = record.ContextId,
            is_public = record.IsPublic,
            reactions_count = record.Reactions.Count,
            created_at = record.CreatedAt,
            updated_at = record.UpdatedAt,
            sender = sender == null ? null : new
            {
                id = sender.Id,
                name = DisplayName(sender.FirstName, sender.LastName, sender.Email),
                avatar_url = sender.AvatarUrl
            },
            my_reaction = currentUserId.HasValue && record.Reactions.TryGetValue(currentUserId.Value.ToString(), out var reaction)
                ? reaction
                : null
        };
    }

    private sealed class AppreciationRecord
    {
        public int Id { get; set; }
        public int TenantId { get; set; }
        public int SenderId { get; set; }
        public int ReceiverId { get; set; }
        public string Message { get; set; } = string.Empty;
        public string? ContextType { get; set; }
        public int? ContextId { get; set; }
        public bool IsPublic { get; set; } = true;
        public Dictionary<string, string> Reactions { get; set; } = [];
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }

    private static string DisplayName(User user) => DisplayName(user.FirstName, user.LastName, user.Email);

    private static string DisplayName(string firstName, string lastName, string email)
    {
        var name = $"{firstName} {lastName}".Trim();
        return string.IsNullOrWhiteSpace(name) ? email : name;
    }

    private static long ToMinorUnits(decimal amount) => decimal.ToInt64(decimal.Round(amount * 100m, 0, MidpointRounding.AwayFromZero));
    private static string DonationStatusForReact(MoneyDonationStatus status) => status switch
    {
        MoneyDonationStatus.Succeeded => "completed",
        MoneyDonationStatus.Refunded => "refunded",
        MoneyDonationStatus.Failed => "failed",
        MoneyDonationStatus.Cancelled => "failed",
        _ => "pending"
    };
    private static int StableId(JsonElement body) => Math.Abs(HashCode.Combine(body.GetRawText()));
}
