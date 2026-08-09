// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

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

    public MiscParityController(NexusDbContext db, TenantContext tenantContext)
    {
        _db = db;
        _tenantContext = tenantContext;
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

    [HttpGet("ads/active")]
    [Authorize]
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

        return Ok(new { success = true, data = ads });
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

        return Ok(new { data });
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

    [HttpGet("clubs")]
    [Authorize]
    public async Task<IActionResult> Clubs() => Ok(new { data = await _db.Groups.Where(g => g.TenantId == TenantId()).ToListAsync() });

    [HttpGet("community/stats")]
    [AllowAnonymous]
    public async Task<IActionResult> CommunityStats() => Ok(new { data = new { members = await _db.Users.CountAsync(), listings = await _db.Listings.CountAsync(), groups = await _db.Groups.CountAsync() } });

    [HttpGet("config/google-maps")]
    [AllowAnonymous]
    public IActionResult GoogleMapsConfig() => Ok(new { data = new { enabled = false } });

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

    [HttpGet("connections/suggestions")]
    [Authorize]
    public async Task<IActionResult> ConnectionSuggestions() => Ok(new { data = await _db.Users.Where(u => u.TenantId == TenantId() && u.Id != UserId()).Take(20).ToListAsync() });

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

    [HttpPost("gdpr/delete-account")]
    [Authorize]
    public IActionResult GdprDeleteAccount() => Ok(new { data = new { queued = true } });

    [HttpPost("gdpr/request")]
    [Authorize]
    public IActionResult GdprRequest([FromBody] JsonElement body) => Ok(new { data = new { id = StableId(body), status = "pending" } });

    [HttpGet("gamification/badges/{id:int}")]
    [Authorize]
    public async Task<IActionResult> GamificationBadge(int id) => Ok(new { data = await _db.Badges.FirstOrDefaultAsync(b => b.Id == id) });

    [HttpGet("gamification/challenges")]
    [Authorize]
    public async Task<IActionResult> GamificationChallenges() => Ok(new { data = await _db.Challenges.Where(c => c.TenantId == TenantId()).Take(50).ToListAsync() });

    [HttpGet("gamification/community-dashboard")]
    [Authorize]
    public async Task<IActionResult> GamificationCommunityDashboard() => Ok(new { data = new { members = await _db.Users.CountAsync(u => u.TenantId == TenantId()), xp = await _db.Users.Where(u => u.TenantId == TenantId()).SumAsync(u => u.TotalXp) } });

    [HttpGet("gamification/engagement-history")]
    [Authorize]
    public async Task<IActionResult> GamificationEngagementHistory() => Ok(new { data = await _db.XpLogs.Where(x => x.UserId == UserId()).OrderByDescending(x => x.CreatedAt).Take(50).ToListAsync() });

    [HttpGet("gamification/member-spotlight")]
    [Authorize]
    public async Task<IActionResult> GamificationMemberSpotlight() => Ok(new { data = await _db.Users.Where(u => u.TenantId == TenantId()).OrderByDescending(u => u.TotalXp).Select(u => new { u.Id, u.FirstName, u.LastName, u.TotalXp }).FirstOrDefaultAsync() });

    [HttpGet("gamification/personal-journey")]
    [Authorize]
    public async Task<IActionResult> GamificationPersonalJourney() => Ok(new { data = await _db.XpLogs.Where(x => x.UserId == UserId()).OrderBy(x => x.CreatedAt).ToListAsync() });

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
    public IActionResult IdentityStatus() => Ok(new { data = new { status = "not_started" } });

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

    [HttpPost("legal/accept")]
    [Authorize]
    public IActionResult LegalAccept([FromBody] JsonElement body) => Ok(new { accepted = true });

    [HttpPost("legal/accept-all")]
    [Authorize]
    public IActionResult LegalAcceptAll() => Ok(new { accepted = "all" });

    [HttpGet("legal/status")]
    [Authorize]
    public IActionResult LegalStatus() => Ok(new { data = new { accepted = true } });

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

    [HttpGet("onboarding/config")]
    [Authorize]
    public IActionResult OnboardingConfig() => Ok(new { data = new { steps = Array.Empty<object>() } });

    [HttpGet("onboarding/status")]
    [Authorize]
    public IActionResult OnboardingStatus() => Ok(new { data = new { complete = false } });

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

    [HttpPost("reviews")]
    [Authorize]
    public IActionResult CreateReviewCompat([FromBody] JsonElement body) => Ok(new { data = new { id = StableId(body), created = true } });

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
    public IActionResult IdentityWebhook(string provider, [FromBody] JsonElement body) => Ok(new { provider, received = true });

    [HttpPost("webhooks/sendgrid/events")]
    [AllowAnonymous]
    public IActionResult SendgridEvents([FromBody] JsonElement body) => Ok(new { received = true });

    [HttpPost("webhooks/stripe")]
    [AllowAnonymous]
    public IActionResult StripeWebhook([FromBody] JsonElement body) => Ok(new { received = true });

    private int TenantId() => _tenantContext.TenantId ?? 0;
    private int UserId() => User.GetUserId() ?? 0;
    private static string Token() => Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
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
