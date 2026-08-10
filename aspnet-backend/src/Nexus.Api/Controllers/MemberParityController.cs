// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Middleware;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// V1.5 member-facing compatibility endpoints.
/// </summary>
[ApiController]
[Route("api")]
[Authorize]
public class MemberParityController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenantContext;
    private readonly FileUploadService _fileUploadService;
    private readonly SafeguardingInteractionPolicy _safeguardingInteractionPolicy;
    private readonly GamificationService _gamification;
    private readonly IRealTimeMessagingService _realTimeMessaging;
    private readonly ILogger<MemberParityController> _logger;
    private readonly DirectMessageReactionService _messageReactions;
    private const string LocalAdvertisingCampaignsKey = "local_advertising.campaigns";
    private const string PaidPushCampaignsKey = "paid_push.campaigns";
    private const string MerchantOnboardingProfileKeyPrefix = "merchant_onboarding.profile.";
    private const string AppreciationsKey = "social.appreciations";
    private static readonly JsonSerializerOptions StoreJsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        PropertyNameCaseInsensitive = true
    };

    public MemberParityController(
        NexusDbContext db,
        TenantContext tenantContext,
        FileUploadService fileUploadService,
        SafeguardingInteractionPolicy safeguardingInteractionPolicy,
        GamificationService gamification,
        IRealTimeMessagingService realTimeMessaging,
        DirectMessageReactionService messageReactions,
        ILogger<MemberParityController> logger)
    {
        _db = db;
        _tenantContext = tenantContext;
        _fileUploadService = fileUploadService;
        _safeguardingInteractionPolicy = safeguardingInteractionPolicy;
        _gamification = gamification;
        _realTimeMessaging = realTimeMessaging;
        _messageReactions = messageReactions;
        _logger = logger;
    }

    [HttpGet("me/dashboard")]
    public async Task<IActionResult> Dashboard() => Ok(new { data = new { user = await CurrentUser(), listings = await _db.Listings.CountAsync(l => l.UserId == UserId()), groups = await _db.GroupMembers.CountAsync(g => g.UserId == UserId()), unread = await _db.Notifications.CountAsync(n => n.UserId == UserId() && !n.IsRead) } });

    [HttpGet("me/appreciations")]
    public async Task<IActionResult> Appreciations([FromQuery] string? tab = "received", [FromQuery] int page = 1, [FromQuery(Name = "per_page")] int perPage = 20)
    {
        var userId = UserId();
        var safePage = Math.Max(page, 1);
        var safePerPage = Math.Clamp(perPage, 1, 100);
        var includeSent = string.Equals(tab, "all", StringComparison.OrdinalIgnoreCase);
        var rows = (await LoadAppreciationsAsync())
            .Where(a => includeSent
                ? a.ReceiverId == userId || a.SenderId == userId
                : a.ReceiverId == userId)
            .OrderByDescending(a => a.CreatedAt)
            .ToList();
        var data = await MapAppreciationsAsync(rows.Skip((safePage - 1) * safePerPage).Take(safePerPage), userId);

        return Ok(new
        {
            success = true,
            data,
            meta = PageMeta(safePage, safePerPage, rows.Count)
        });
    }

    [HttpGet("me/data-export/history")]
    [HttpGet("v2/me/data-export/history")]
    public async Task<IActionResult> DataExportHistory()
    {
        var exports = await _db.DataExportRequests
            .AsNoTracking()
            .Where(r => r.UserId == UserId())
            .OrderByDescending(r => r.CreatedAt)
            .Take(10)
            .Select(r => new
            {
                id = r.Id,
                format = r.Format,
                status = r.Status.ToString().ToLowerInvariant(),
                file_size_bytes = r.FileSizeBytes,
                requested_at = r.RequestedAt,
                completed_at = r.CompletedAt,
                expires_at = r.ExpiresAt
            })
            .ToListAsync();

        return Ok(new { data = new { exports } });
    }

    [HttpPost("me/data-export")]
    [HttpPost("v2/me/data-export")]
    public async Task<IActionResult> RequestDataExport([FromBody] MemberDataExportRequest? body)
    {
        var format = string.Equals(body?.Format, "zip", StringComparison.OrdinalIgnoreCase) ? "zip" : "json";
        var user = await _db.Users.AsNoTracking().FirstOrDefaultAsync(u => u.Id == UserId());
        if (user == null) return Unauthorized(new { error = "Invalid token" });

        var payload = new
        {
            exported_at = DateTime.UtcNow,
            user = new
            {
                id = user.Id,
                email = user.Email,
                first_name = user.FirstName,
                last_name = user.LastName,
                role = user.Role,
                created_at = user.CreatedAt
            }
        };
        var json = JsonSerializer.Serialize(payload, StoreJsonOptions);
        var bytes = Encoding.UTF8.GetBytes(json);
        var filename = "personal-data.json";
        var contentType = "application/json";

        if (format == "zip")
        {
            await using var stream = new MemoryStream();
            using (var archive = new System.IO.Compression.ZipArchive(stream, System.IO.Compression.ZipArchiveMode.Create, leaveOpen: true))
            {
                var entry = archive.CreateEntry("personal-data.json");
                await using var entryStream = entry.Open();
                await entryStream.WriteAsync(bytes);
            }

            bytes = stream.ToArray();
            filename = "personal-data.zip";
            contentType = "application/zip";
        }

        var now = DateTime.UtcNow;
        var request = new DataExportRequest
        {
            TenantId = TenantId(),
            UserId = UserId(),
            Status = ExportStatus.Ready,
            Format = format,
            FileSizeBytes = bytes.LongLength,
            RequestedAt = now,
            CompletedAt = now,
            ExpiresAt = now.AddDays(30),
            CreatedAt = now
        };
        _db.DataExportRequests.Add(request);
        await _db.SaveChangesAsync();

        Response.Headers["X-Export-Id"] = request.Id.ToString();
        return File(bytes, contentType, filename);
    }

    [HttpGet("me/fadp/consent-history")]
    public async Task<IActionResult> FadpConsentHistory()
    {
        var history = await _db.ConsentRecords
            .AsNoTracking()
            .Where(c => c.UserId == UserId())
            .OrderByDescending(c => c.CreatedAt)
            .Select(c => new
            {
                id = c.Id,
                tenant_id = c.TenantId,
                user_id = c.UserId,
                consent_type = c.ConsentType,
                action = c.IsGranted ? "granted" : "withdrawn",
                consent_version = (string?)null,
                ip_address = c.IpAddress,
                user_agent = (string?)null,
                metadata = (string?)null,
                created_at = c.CreatedAt
            })
            .ToListAsync();

        return Ok(new { data = history });
    }

    [HttpPost("me/fadp/consent")]
    public async Task<IActionResult> FadpConsent([FromBody] JsonElement body)
    {
        var consentType = Str(body, "consent_type")?.Trim();
        if (string.IsNullOrWhiteSpace(consentType))
        {
            return BadRequest(new
            {
                errors = new[] { new { code = "VALIDATION_ERROR", message = "consent_type is required.", field = "consent_type" } }
            });
        }

        var action = Str(body, "action")?.Trim().ToLowerInvariant();
        if (string.IsNullOrWhiteSpace(action))
        {
            var grantedValue = Bool(body, "granted");
            action = grantedValue switch
            {
                true => "granted",
                false => "withdrawn",
                _ => null
            };
        }

        if (action is not ("granted" or "withdrawn"))
        {
            return BadRequest(new
            {
                errors = new[] { new { code = "VALIDATION_ERROR", message = "Invalid FADP consent action.", field = "action" } }
            });
        }

        var granted = action == "granted";
        var now = DateTime.UtcNow;
        var record = await _db.ConsentRecords.FirstOrDefaultAsync(c =>
            c.UserId == UserId() &&
            c.ConsentType == consentType);

        if (record == null)
        {
            record = new ConsentRecord
            {
                TenantId = TenantId(),
                UserId = UserId(),
                ConsentType = consentType,
                CreatedAt = now
            };
            _db.ConsentRecords.Add(record);
        }

        record.IsGranted = granted;
        record.GrantedAt = granted ? now : null;
        record.RevokedAt = granted ? null : now;
        record.UpdatedAt = now;
        record.IpAddress = HttpContext.Connection.RemoteIpAddress?.ToString();
        await _db.SaveChangesAsync();

        return Ok(new
        {
            data = new
            {
                recorded = true,
                consent_type = consentType,
                action
            }
        });
    }

    [HttpGet("me/residency-verification")]
    public IActionResult ResidencyVerification() => Ok(new { data = new { status = "not_started", user_id = UserId() } });

    [HttpPost("me/residency-verification")]
    public IActionResult StartResidencyVerification([FromBody] JsonElement body) => Ok(new { data = new { status = "pending", country = Str(body, "country"), user_id = UserId() } });

    [HttpGet("me/collections")]
    public async Task<IActionResult> Collections() => Ok(new { data = await _db.MarketplaceCollections.Where(c => c.UserId == UserId()).OrderBy(c => c.Name).ToListAsync() });

    [HttpPost("me/collections")]
    public async Task<IActionResult> CreateCollection([FromBody] JsonElement body)
    {
        var collection = new MarketplaceCollection { TenantId = TenantId(), UserId = UserId(), Name = Required(Str(body, "name"), "name"), Description = Str(body, "description"), IsPublic = Bool(body, "is_public") ?? false };
        _db.MarketplaceCollections.Add(collection);
        await _db.SaveChangesAsync();
        return Ok(new { data = collection });
    }

    [HttpPatch("me/collections/{collectionId:int}")]
    public async Task<IActionResult> UpdateCollection(int collectionId, [FromBody] JsonElement body)
    {
        var collection = await _db.MarketplaceCollections.FirstOrDefaultAsync(c => c.Id == collectionId && c.UserId == UserId());
        if (collection == null) return NotFound(new { error = "Collection not found" });
        collection.Name = Str(body, "name") ?? collection.Name;
        collection.Description = Str(body, "description") ?? collection.Description;
        collection.IsPublic = Bool(body, "is_public") ?? collection.IsPublic;
        await _db.SaveChangesAsync();
        return Ok(new { data = collection });
    }

    [HttpDelete("me/collections/{collectionId:int}")]
    public async Task<IActionResult> DeleteCollection(int collectionId)
    {
        var collection = await _db.MarketplaceCollections.FirstOrDefaultAsync(c => c.Id == collectionId && c.UserId == UserId());
        if (collection != null) _db.MarketplaceCollections.Remove(collection);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("me/collections/{collectionId:int}/items")]
    public async Task<IActionResult> CollectionItems(int collectionId) => Ok(new { data = await _db.MarketplaceCollectionItems.Where(i => i.MarketplaceCollectionId == collectionId && i.TenantId == TenantId()).ToListAsync() });

    [HttpPost("me/saved-items")]
    public async Task<IActionResult> SaveItem([FromBody] JsonElement body)
    {
        var listingId = Int(body, "listing_id") ?? Int(body, "item_id") ?? 0;
        if (listingId <= 0) return BadRequest(new { error = "listing_id is required" });
        if (!await _db.MarketplaceSavedListings.AnyAsync(s => s.UserId == UserId() && s.MarketplaceListingId == listingId))
            _db.MarketplaceSavedListings.Add(new MarketplaceSavedListing { TenantId = TenantId(), UserId = UserId(), MarketplaceListingId = listingId });
        await _db.SaveChangesAsync();
        return Ok(new { success = true });
    }

    [HttpDelete("me/saved-items")]
    public async Task<IActionResult> ClearSavedItems()
    {
        var items = await _db.MarketplaceSavedListings.Where(s => s.UserId == UserId()).ToListAsync();
        _db.MarketplaceSavedListings.RemoveRange(items);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpDelete("me/saved-items/{itemId:int}")]
    public async Task<IActionResult> DeleteSavedItem(int itemId)
    {
        var item = await _db.MarketplaceSavedListings.FirstOrDefaultAsync(s => s.UserId == UserId() && (s.Id == itemId || s.MarketplaceListingId == itemId));
        if (item != null) _db.MarketplaceSavedListings.Remove(item);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    [HttpGet("me/saved-items/check")]
    public async Task<IActionResult> CheckSavedItem([FromQuery] int item_id, [FromQuery] int? listing_id = null)
    {
        var id = listing_id ?? item_id;
        return Ok(new { data = new { item_id = id, saved = await _db.MarketplaceSavedListings.AnyAsync(s => s.UserId == UserId() && s.MarketplaceListingId == id) } });
    }

    [HttpPost("me/saved-items/check-bulk")]
    public async Task<IActionResult> CheckSavedBulk([FromBody] int[] ids)
    {
        var saved = await _db.MarketplaceSavedListings.Where(s => s.UserId == UserId() && ids.Contains(s.MarketplaceListingId)).Select(s => s.MarketplaceListingId).ToListAsync();
        return Ok(new { data = ids.ToDictionary(id => id, id => saved.Contains(id)) });
    }

    [HttpGet("me/ad-campaigns")]
    public async Task<IActionResult> AdCampaigns([FromQuery] string? status = null)
    {
        var userId = UserId();
        var records = await LoadAdCampaignsAsync();
        var campaigns = records
            .Where(c => c.CreatedBy == userId)
            .Where(c => string.IsNullOrWhiteSpace(status) || string.Equals(c.Status, status, StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(c => c.CreatedAt)
            .Select(MapAdCampaign)
            .ToList();

        return Ok(new { data = campaigns });
    }

    [HttpPost("me/ad-campaigns")]
    public async Task<IActionResult> CreateAdCampaign([FromBody] JsonElement body)
    {
        var name = Str(body, "name")?.Trim();
        if (string.IsNullOrWhiteSpace(name))
        {
            return BadRequest(new { error = "VALIDATION_ERROR", field = "name", message = "name is required" });
        }

        var userId = UserId();
        var tenantId = TenantId();
        var now = DateTime.UtcNow;
        var user = await CurrentUser();
        var records = await LoadAdCampaignsAsync();
        var campaign = new LocalAdCampaignRecord
        {
            Id = records.Count == 0 ? 1 : records.Max(c => c.Id) + 1,
            TenantId = tenantId,
            CreatedBy = userId,
            Name = name,
            Status = "pending_review",
            AdvertiserType = NormalizeAdChoice(Str(body, "advertiser_type"), "sme", new[] { "sme", "verein", "gemeinde", "private" }),
            BudgetCents = Math.Max(0, Int(body, "budget_cents") ?? 0),
            SpentCents = 0,
            StartDate = Str(body, "start_date"),
            EndDate = Str(body, "end_date"),
            AudienceFiltersJson = TryGetRawProperty(body, "audience_filters"),
            Placement = NormalizeAdChoice(Str(body, "placement"), "feed", new[] { "feed", "discovery", "markt", "all" }),
            ImpressionCount = 0,
            ClickCount = 0,
            AdvertiserName = DisplayName(user),
            AdvertiserEmail = user?.Email,
            CreatedAt = now,
            UpdatedAt = now
        };

        records.Add(campaign);
        await SaveAdCampaignsAsync(records);

        return Created($"/api/v2/me/ad-campaigns/{campaign.Id}", new { data = MapAdCampaign(campaign) });
    }

    [HttpPost("me/ad-campaigns/{campaignId:int}/creatives")]
    public async Task<IActionResult> AddAdCreative(int campaignId, [FromBody] JsonElement body)
    {
        var records = await LoadAdCampaignsAsync();
        var campaign = records.FirstOrDefault(c => c.Id == campaignId && c.CreatedBy == UserId());
        if (campaign == null)
        {
            return NotFound(new { error = "Campaign not found" });
        }

        if (campaign.Status is not ("pending_review" or "active"))
        {
            return UnprocessableEntity(new { error = "CAMPAIGN_NOT_EDITABLE" });
        }

        var headline = Str(body, "headline")?.Trim();
        var text = Str(body, "body")?.Trim();
        if (string.IsNullOrWhiteSpace(headline))
        {
            return BadRequest(new { error = "VALIDATION_ERROR", field = "headline" });
        }
        if (string.IsNullOrWhiteSpace(text))
        {
            return BadRequest(new { error = "VALIDATION_ERROR", field = "body" });
        }

        var now = DateTime.UtcNow;
        var creative = new LocalAdCreativeRecord
        {
            Id = campaign.Creatives.Count == 0 ? 1 : campaign.Creatives.Max(c => c.Id) + 1,
            CampaignId = campaignId,
            TenantId = TenantId(),
            Headline = headline,
            Body = text,
            CtaText = Str(body, "cta_text"),
            ImageUrl = Str(body, "image_url"),
            DestinationUrl = Str(body, "destination_url"),
            IsActive = 1,
            CreatedAt = now
        };

        campaign.Creatives.Add(creative);
        campaign.UpdatedAt = now;
        await SaveAdCampaignsAsync(records);

        return Created($"/api/v2/me/ad-campaigns/{campaignId}/creatives/{creative.Id}", new { data = MapAdCreative(creative) });
    }

    [HttpGet("me/ad-campaigns/{campaignId:int}/stats")]
    public async Task<IActionResult> AdCampaignStats(int campaignId)
    {
        var campaign = (await LoadAdCampaignsAsync())
            .FirstOrDefault(c => c.Id == campaignId && c.CreatedBy == UserId());
        return campaign == null
            ? NotFound(new { error = "Campaign not found" })
            : Ok(new { data = MapCampaignStats(campaign) });
    }

    [HttpGet("me/push-campaigns")]
    public async Task<IActionResult> PushCampaigns()
    {
        var userId = UserId();
        var campaigns = (await LoadPushCampaignsAsync())
            .Where(c => c.CreatedBy == userId)
            .OrderByDescending(c => c.CreatedAt)
            .Select(MapPushCampaign)
            .ToList();

        return Ok(new { success = true, data = campaigns });
    }

    [HttpPost("me/push-campaigns")]
    public async Task<IActionResult> CreatePushCampaign([FromBody] JsonElement body)
    {
        var name = Str(body, "name")?.Trim();
        var title = Str(body, "title")?.Trim();
        var text = Str(body, "body")?.Trim();
        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(title) || string.IsNullOrWhiteSpace(text))
        {
            return UnprocessableEntity(new
            {
                errors = new[]
                {
                    new { code = "VALIDATION_ERROR", field = string.IsNullOrWhiteSpace(name) ? "name" : string.IsNullOrWhiteSpace(title) ? "title" : "body" }
                }
            });
        }

        if (title.Length > 100)
        {
            return UnprocessableEntity(new { errors = new[] { new { code = "VALIDATION_ERROR", field = "title" } } });
        }

        if (text.Length > 400)
        {
            return UnprocessableEntity(new { errors = new[] { new { code = "VALIDATION_ERROR", field = "body" } } });
        }

        var now = DateTime.UtcNow;
        var user = await CurrentUser();
        var campaigns = await LoadPushCampaignsAsync();
        var scheduledAt = Str(body, "scheduled_at") ?? Str(body, "schedule_at");
        var radiusKm = Int(body, "audience_radius_km");
        var trustTier = NormalizePushTrustTier(Str(body, "audience_min_trust_tier"));
        var campaign = new PaidPushCampaignRecord
        {
            Id = campaigns.Count == 0 ? 1 : campaigns.Max(c => c.Id) + 1,
            TenantId = TenantId(),
            CreatedBy = UserId(),
            Name = name,
            Status = "draft",
            AdvertiserType = NormalizeAdChoice(Str(body, "advertiser_type"), "sme", new[] { "sme", "verein", "gemeinde", "private" }),
            Title = title,
            Body = text,
            CtaUrl = Str(body, "cta_url"),
            AudienceFilterJson = BuildPushAudienceFilterJson(body, radiusKm, trustTier),
            AudienceRadiusKm = radiusKm,
            AudienceMinTrustTier = trustTier,
            ScheduledAt = string.IsNullOrWhiteSpace(scheduledAt) ? null : scheduledAt,
            CostPerSend = Math.Clamp(Int(body, "cost_per_send") ?? 5, 1, 100),
            AdvertiserName = DisplayName(user),
            AdvertiserEmail = user?.Email,
            CreatedAt = now,
            UpdatedAt = now
        };

        campaigns.Add(campaign);
        await SavePushCampaignsAsync(campaigns);

        return Created($"/api/v2/me/push-campaigns/{campaign.Id}", new { success = true, data = MapPushCampaign(campaign) });
    }

    [HttpPut("me/push-campaigns/{campaignId:int}")]
    public async Task<IActionResult> UpdatePushCampaign(int campaignId, [FromBody] JsonElement body)
    {
        var campaigns = await LoadPushCampaignsAsync();
        var campaign = campaigns.FirstOrDefault(c => c.Id == campaignId && c.CreatedBy == UserId());
        if (campaign == null)
        {
            return NotFound(new { error = "Campaign not found" });
        }

        if (campaign.Status is not ("draft" or "pending_review"))
        {
            return UnprocessableEntity(new { error = "INVALID_STATUS" });
        }

        campaign.Name = Str(body, "name")?.Trim() ?? campaign.Name;
        campaign.Title = Str(body, "title")?.Trim() ?? campaign.Title;
        campaign.Body = Str(body, "body")?.Trim() ?? campaign.Body;
        campaign.AdvertiserType = NormalizeAdChoice(Str(body, "advertiser_type"), campaign.AdvertiserType, new[] { "sme", "verein", "gemeinde", "private" });
        campaign.CtaUrl = body.ValueKind == JsonValueKind.Object && body.TryGetProperty("cta_url", out _) ? Str(body, "cta_url") : campaign.CtaUrl;
        campaign.ScheduledAt = Str(body, "scheduled_at") ?? Str(body, "schedule_at") ?? campaign.ScheduledAt;
        campaign.CostPerSend = Math.Clamp(Int(body, "cost_per_send") ?? campaign.CostPerSend, 1, 100);
        campaign.UpdatedAt = DateTime.UtcNow;
        await SavePushCampaignsAsync(campaigns);

        return Ok(new { success = true, data = MapPushCampaign(campaign) });
    }

    [HttpDelete("me/push-campaigns/{campaignId:int}")]
    public async Task<IActionResult> DeletePushCampaign(int campaignId)
    {
        var campaigns = await LoadPushCampaignsAsync();
        var campaign = campaigns.FirstOrDefault(c => c.Id == campaignId && c.CreatedBy == UserId());
        if (campaign == null)
        {
            return NotFound(new { error = "Campaign not found" });
        }

        campaign.Status = "cancelled";
        campaign.UpdatedAt = DateTime.UtcNow;
        await SavePushCampaignsAsync(campaigns);

        return Ok(new { success = true, data = new { cancelled = true } });
    }

    [HttpPost("me/push-campaigns/{campaignId:int}/submit")]
    public async Task<IActionResult> SubmitPushCampaign(int campaignId)
    {
        var campaigns = await LoadPushCampaignsAsync();
        var campaign = campaigns.FirstOrDefault(c => c.Id == campaignId && c.CreatedBy == UserId());
        if (campaign == null)
        {
            return NotFound(new { error = "Campaign not found" });
        }

        if (campaign.Status != "draft")
        {
            return UnprocessableEntity(new { error = "INVALID_STATUS" });
        }

        campaign.Status = "pending_review";
        campaign.UpdatedAt = DateTime.UtcNow;
        await SavePushCampaignsAsync(campaigns);

        return Ok(new { success = true, data = MapPushCampaign(campaign) });
    }

    [HttpPost("me/push-campaigns/estimate-audience")]
    public async Task<IActionResult> EstimateAudience()
    {
        var count = await _db.Users.CountAsync(u => u.TenantId == TenantId() && u.IsActive);
        return Ok(new
        {
            success = true,
            data = new
            {
                estimated_reach = count,
                estimated_count = count,
                estimated_recipients = count,
                minimum_reached = count >= 5
            }
        });
    }

    [HttpGet("me/reports")]
    public IActionResult Reports() => Ok(new { data = Array.Empty<object>() });

    [HttpGet("me/reports/{reportId:int}/download")]
    public IActionResult DownloadReport(int reportId) => File(Encoding.UTF8.GetBytes($"Report {reportId}"), "text/plain", $"report-{reportId}.txt");

    [HttpGet("me/verein-dues")]
    public IActionResult VereinDues() => Ok(new { data = Array.Empty<object>() });

    [HttpGet("me/verein-dues/{dueId:int}")]
    public IActionResult VereinDue(int dueId) => Ok(new { data = new { id = dueId, status = "unpaid" } });

    [HttpPost("me/verein-dues/{dueId:int}/pay")]
    public IActionResult PayVereinDue(int dueId) => Ok(new { data = new { id = dueId, status = "paid" } });

    [HttpGet("me/verein-invitations")]
    public IActionResult VereinInvitations() => Ok(new { data = Array.Empty<object>() });

    [HttpPost("me/verein-invitations/{invitationId:int}/respond")]
    public IActionResult RespondVereinInvitation(int invitationId, [FromBody] JsonElement body) => Ok(new { data = new { id = invitationId, response = Str(body, "response") ?? "accepted" } });

    [HttpGet("member-premium/tiers")]
    [AllowAnonymous]
    public async Task<IActionResult> PremiumTiers()
    {
        var plans = await _db.SubscriptionPlans
            .AsNoTracking()
            .Where(p => p.TenantId == TenantId() && p.IsActive && p.IsPublic)
            .OrderBy(p => p.Price)
            .ThenBy(p => p.Name)
            .ThenBy(p => p.Id)
            .ToListAsync();

        var tiers = plans.Select((plan, index) => new
        {
            id = plan.Id,
            slug = Slugify(plan.Name),
            name = plan.Name,
            description = plan.Description,
            monthly_price_cents = ToCents(plan.Price),
            yearly_price_cents = ToCents(plan.Price * 12m),
            features = NormalizePlanFeatures(plan.Features),
            sort_order = index,
            is_active = plan.IsActive
        });

        return Ok(new { success = true, data = new { tiers } });
    }

    [HttpGet("member-premium/me")]
    public async Task<IActionResult> PremiumMe()
    {
        var subscription = await _db.UserSubscriptions
            .AsNoTracking()
            .Include(s => s.Plan)
            .Where(s => s.TenantId == TenantId() && s.UserId == UserId())
            .OrderByDescending(s => s.Status == SubscriptionStatus.Active)
            .ThenByDescending(s => s.UpdatedAt)
            .ThenByDescending(s => s.CreatedAt)
            .FirstOrDefaultAsync();

        if (subscription == null)
        {
            return Ok(new
            {
                success = true,
                data = new
                {
                    subscription = (object?)null,
                    entitled_tier = (object?)null,
                    unlocked_features = Array.Empty<string>()
                }
            });
        }

        var plan = subscription.Plan;
        var features = NormalizePlanFeatures(plan?.Features);
        var currentPeriodEnd = subscription.NextBillingDate
            ?? subscription.ExpiresAt
            ?? subscription.StartedAt.AddMonths(1);

        return Ok(new
        {
            success = true,
            data = new
            {
                subscription = new
                {
                    id = subscription.Id,
                    tier_id = subscription.PlanId,
                    tier_name = plan?.Name ?? string.Empty,
                    tier_slug = Slugify(plan?.Name ?? $"tier-{subscription.PlanId}"),
                    status = MemberPremiumStatusForReact(subscription.Status),
                    billing_interval = "monthly",
                    current_period_start = subscription.StartedAt,
                    current_period_end = currentPeriodEnd,
                    canceled_at = subscription.CancelledAt,
                    grace_period_ends_at = (DateTime?)null,
                    is_active = subscription.Status == SubscriptionStatus.Active
                },
                entitled_tier = new
                {
                    tier_id = subscription.PlanId,
                    tier_name = plan?.Name ?? string.Empty,
                    features
                },
                unlocked_features = features
            }
        });
    }

    [HttpPost("member-premium/checkout")]
    public IActionResult PremiumCheckout([FromBody] JsonElement body)
    {
        var tierId = Int(body, "tier_id") ?? 0;
        var interval = NormalizeAdChoice(Str(body, "interval"), "monthly", new[] { "monthly", "yearly" });
        var sessionId = $"cs_member_local_{TenantId()}_{UserId()}_{Math.Max(tierId, 1)}_{interval}_{Guid.NewGuid():N}";
        var returnUrl = SafeLocalReturnUrl(Str(body, "return_url"), "/premium/return");
        var separator = returnUrl.Contains('?', StringComparison.Ordinal) ? "&" : "?";
        var checkoutUrl = $"{returnUrl}{separator}session_id={Uri.EscapeDataString(sessionId)}";

        return Ok(new
        {
            success = true,
            data = new
            {
                checkout_url = checkoutUrl,
                session_id = sessionId
            }
        });
    }

    [HttpPost("member-premium/billing-portal")]
    public IActionResult BillingPortal([FromBody] JsonElement body)
    {
        var portalSession = $"bps_member_local_{TenantId()}_{UserId()}_{Guid.NewGuid():N}";
        var returnUrl = SafeLocalReturnUrl(Str(body, "return_url"), "/premium/manage");
        var separator = returnUrl.Contains('?', StringComparison.Ordinal) ? "&" : "?";
        var portalUrl = $"{returnUrl}{separator}portal_session={Uri.EscapeDataString(portalSession)}";

        return Ok(new { success = true, data = new { portal_url = portalUrl } });
    }

    [HttpPost("member-premium/cancel")]
    public async Task<IActionResult> CancelPremium()
    {
        var subscription = await _db.UserSubscriptions
            .Where(s => s.TenantId == TenantId() && s.UserId == UserId() && s.Status == SubscriptionStatus.Active)
            .OrderByDescending(s => s.UpdatedAt)
            .ThenByDescending(s => s.CreatedAt)
            .FirstOrDefaultAsync();

        if (subscription == null)
        {
            return NotFound(new
            {
                success = false,
                errors = new[] { new { code = "NO_SUBSCRIPTION", message = "No active member premium subscription found." } }
            });
        }

        var now = DateTime.UtcNow;
        subscription.Status = SubscriptionStatus.Cancelled;
        subscription.CancelledAt = now;
        subscription.UpdatedAt = now;
        await _db.SaveChangesAsync();

        return Ok(new { success = true, data = new { cancelled = true } });
    }

    [HttpPost("members/{memberId:int}/peer-endorse")]
    public IActionResult PeerEndorse(int memberId, [FromBody] JsonElement body) => Ok(new { data = new { member_id = memberId, skill = Str(body, "skill"), endorsed = true } });

    [HttpGet("members/availability/available")]
    public async Task<IActionResult> AvailableMembers() => Ok(new { data = await _db.Users.Where(u => u.TenantId == TenantId() && u.IsActive).Take(50).Select(u => new { u.Id, u.FirstName, u.LastName }).ToListAsync() });

    [HttpGet("members/availability/compatible")]
    public Task<IActionResult> CompatibleMembers() => AvailableMembers();

    [HttpGet("members/nearby")]
    public Task<IActionResult> NearbyMembers() => AvailableMembers();

    [HttpGet("members/suggested")]
    public Task<IActionResult> SuggestedMembers() => AvailableMembers();

    [HttpGet("mentions/me")]
    public async Task<IActionResult> MyMentions() => Ok(new { data = await _db.Notifications.Where(n => n.UserId == UserId() && n.Type.Contains("mention")).ToListAsync() });

    [HttpGet("mentions/search")]
    public async Task<IActionResult> MentionSearch([FromQuery] string? q = null)
    {
        var query = q?.Trim() ?? string.Empty;
        if (query.Length < 1)
        {
            return Ok(new { success = true, data = Array.Empty<object>() });
        }

        var tenantId = TenantId();
        var userId = UserId();
        var limit = Math.Clamp(IntFromQuery("limit") ?? 10, 1, 20);
        var term = query.ToLowerInvariant();

        var connectedUserIds = await _db.Connections
            .AsNoTracking()
            .Where(c =>
                c.TenantId == tenantId &&
                c.Status == Connection.Statuses.Accepted &&
                (c.RequesterId == userId || c.AddresseeId == userId))
            .Select(c => c.RequesterId == userId ? c.AddresseeId : c.RequesterId)
            .ToListAsync();
        var connected = connectedUserIds.ToHashSet();

        var matchedUsers = await _db.Users
            .AsNoTracking()
            .Where(u =>
                u.TenantId == tenantId &&
                u.IsActive &&
                u.Id != userId &&
                (u.FirstName.ToLower().Contains(term) ||
                 u.LastName.ToLower().Contains(term) ||
                 (u.Username != null && u.Username.ToLower().Contains(term)) ||
                 u.Email.ToLower().Contains(term)))
            .Select(u => new { u.Id, u.FirstName, u.LastName, u.Username, u.Email, u.AvatarUrl })
            .ToListAsync();

        var users = matchedUsers
            .OrderByDescending(u => connected.Contains(u.Id))
            .ThenBy(u => u.FirstName)
            .ThenBy(u => u.LastName)
            .Take(limit)
            .Select(u => new
            {
                id = u.Id,
                name = DisplayName(u.FirstName, u.LastName, u.Email),
                username = u.Username,
                avatar_url = u.AvatarUrl,
                is_connection = connected.Contains(u.Id)
            })
            .ToList();

        return Ok(new { success = true, data = users });
    }

    [HttpGet("menus/config")]
    [AllowAnonymous]
    public IActionResult MenuConfig() => Ok(new { data = new { locale = "en", cache = true } });

    [HttpGet("menus/{slug}")]
    [AllowAnonymous]
    public IActionResult Menu(string slug) => Ok(new { data = new { slug, items = Array.Empty<object>() } });

    [HttpPost("menus/clear-cache")]
    public IActionResult ClearMenuCache() => Ok(new { success = true });

    [HttpGet("merchant-onboarding/status")]
    public async Task<IActionResult> MerchantOnboardingStatus()
    {
        var profile = await FindMerchantProfileAsync();
        if (profile == null)
        {
            return Ok(new { data = new { has_profile = false, onboarding_completed = false, profile = (object?)null } });
        }

        var extras = await LoadMerchantOnboardingExtrasAsync();
        return Ok(new
        {
            data = new
            {
                has_profile = true,
                onboarding_completed = extras.ContainsKey("onboarding_completed_at"),
                profile = MapMerchantProfile(profile, extras)
            }
        });
    }

    [HttpPost("merchant-onboarding/step-1")]
    public Task<IActionResult> MerchantOnboardingStep1([FromBody] JsonElement body) => UpsertMerchant(body, 1);

    [HttpPost("merchant-onboarding/step-2")]
    public Task<IActionResult> MerchantOnboardingStep2([FromBody] JsonElement body) => UpsertMerchant(body, 2);

    [HttpPost("merchant-onboarding/step-3")]
    public Task<IActionResult> MerchantOnboardingStep3([FromBody] JsonElement body) => UpsertMerchant(body, 3);

    [HttpPost("merchant-onboarding/complete")]
    public Task<IActionResult> MerchantOnboardingComplete([FromBody] JsonElement body) => UpsertMerchant(body, 4);

    [HttpPost("merchant-onboarding/image")]
    [HttpPost("/api/v2/merchant-onboarding/image")]
    [RequestSizeLimit(10 * 1024 * 1024)]
    public async Task<IActionResult> MerchantOnboardingImage()
    {
        if (!Request.HasFormContentType)
        {
            return UnprocessableEntity(new
            {
                errors = new[] { new { code = "VALIDATION_ERROR", message = "No image uploaded.", field = "image" } }
            });
        }

        IFormCollection form;
        try
        {
            form = await Request.ReadFormAsync();
        }
        catch (InvalidDataException)
        {
            return UnprocessableEntity(new
            {
                errors = new[] { new { code = "VALIDATION_ERROR", message = "No image uploaded.", field = "image" } }
            });
        }

        var field = form.Files.GetFile("avatar") != null
            ? "avatar"
            : form.Files.GetFile("cover_image") != null
                ? "cover_image"
                : form.Files.GetFile("image") != null
                    ? "image"
                    : null;

        var file = field == null ? null : form.Files.GetFile(field);
        if (file == null || file.Length == 0)
        {
            return UnprocessableEntity(new
            {
                errors = new[] { new { code = "VALIDATION_ERROR", message = "No image uploaded.", field = "image" } }
            });
        }

        var profile = await FindMerchantProfileAsync();
        if (profile == null)
        {
            profile = new MarketplaceSellerProfile
            {
                TenantId = TenantId(),
                UserId = UserId(),
                DisplayName = $"Seller {UserId()}",
                SellerType = "business",
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            };
            _db.MarketplaceSellerProfiles.Add(profile);
            await _db.SaveChangesAsync();
        }

        var category = field == "cover_image" ? FileCategory.Listing : FileCategory.Avatar;
        await using var stream = file.OpenReadStream();
        var (upload, error) = await _fileUploadService.UploadAsync(
            stream,
            file.FileName,
            file.ContentType,
            file.Length,
            UserId(),
            TenantId(),
            category,
            profile.Id,
            "marketplace/sellers");

        if (error != null)
        {
            return UnprocessableEntity(new
            {
                errors = new[] { new { code = "VALIDATION_ERROR", message = error, field } }
            });
        }

        var savedUpload = upload!;
        var url = _fileUploadService.GetDownloadUrl(savedUpload);
        if (field == "avatar")
        {
            var user = await _db.Users.FirstOrDefaultAsync(u => u.Id == UserId() && u.TenantId == TenantId());
            if (user != null)
            {
                user.AvatarUrl = url;
                user.UpdatedAt = DateTime.UtcNow;
            }
        }

        profile.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new
        {
            data = new
            {
                id = savedUpload.Id,
                url,
                avatar_url = field == "avatar" ? url : null,
                cover_image_url = field == "cover_image" ? url : null,
                field
            }
        });
    }

    [HttpPost("messages/{messageId:int}/reactions")]
    [EnableRateLimiting(RateLimitingExtensions.MessagesReactionPolicy)]
    public async Task<IActionResult> MessageReactions(
        int messageId,
        [FromBody] JsonElement body,
        CancellationToken cancellationToken)
    {
        var emoji = Str(body, "emoji") ?? Str(body, "reaction");
        if (string.IsNullOrWhiteSpace(emoji))
        {
            return MessageReactionError("VALIDATION_ERROR", "Reaction emoji is required", 400, "emoji");
        }
        if (!DirectMessageReactionService.AllowedEmoji.Contains(emoji))
            return MessageReactionError("VALIDATION_ERROR", "Invalid reaction emoji", 400, "emoji");

        var outcome = await _messageReactions.ToggleAsync(
            TenantId(), UserId(), messageId, emoji, cancellationToken);
        if (!outcome.Succeeded)
        {
            var error = outcome.Error!;
            return StatusCode(error.Status, new
            {
                success = false,
                errors = new[]
                {
                    new
                    {
                        code = error.Code,
                        message = error.Message,
                        required_vetting_types = error.Decision?.RequiredAttestationCodes ?? [],
                        required_vetting_labels = error.Decision?.RequiredAttestationLabels ?? [],
                        can_request_coordinator = error.Decision?.CanRequestCoordinator
                    }
                }
            });
        }

        return Ok(new
        {
            success = true,
            data = new
            {
                action = outcome.Added ? "added" : "removed",
                emoji,
                message_id = messageId
            }
        });
    }

    [HttpPost("messages/{messageId:int}/translate")]
    public async Task<IActionResult> TranslateMessage(int messageId, [FromBody] JsonElement body)
    {
        var userId = UserId();
        var message = await _db.Messages
            .Include(m => m.Conversation)
            .FirstOrDefaultAsync(m => m.TenantId == TenantId() && m.Id == messageId);

        if (message?.Conversation == null
            || (message.Conversation.Participant1Id != userId && message.Conversation.Participant2Id != userId))
        {
            return NotFound(new { success = false, code = "NOT_FOUND", error = "Message not found" });
        }

        var sourceText = Str(body, "text") ?? Str(body, "message") ?? message.Content;
        if (string.IsNullOrWhiteSpace(sourceText))
        {
            return UnprocessableEntity(new { success = false, code = "NO_CONTENT", error = "Message has no translatable content" });
        }

        return Ok(new
        {
            success = true,
            data = new
            {
                message_id = messageId,
                translated_text = sourceText,
                locale = Str(body, "target_language") ?? Str(body, "locale") ?? "en",
                source_type = "body",
                context_used = false
            }
        });
    }

    [HttpPost("messages/delete")]
    public IActionResult DeleteMessages([FromBody] JsonElement body) => Ok(new { data = new { deleted = true } });

    [HttpPost("messages/delete-conversation")]
    public IActionResult DeleteConversation([FromBody] JsonElement body) => Ok(new { data = new { deleted = true } });

    [HttpPost("messages/reaction")]
    public IActionResult LegacyMessageReaction([FromBody] JsonElement body) => Ok(new { data = new { reaction = Str(body, "reaction") ?? "like" } });

    [HttpGet("messages/reactions/batch")]
    [EnableRateLimiting(RateLimitingExtensions.MessagesReactionBatchPolicy)]
    public async Task<IActionResult> MessageReactionsBatch(
        [FromQuery] string? ids,
        CancellationToken cancellationToken)
    {
        var reactions = await _messageReactions.BatchAsync(
            TenantId(), UserId(), ParseReactionIds(ids), cancellationToken);
        return Ok(new
        {
            success = true,
            data = new
            {
                reactions = reactions.ToDictionary(
                    pair => pair.Key,
                    pair => pair.Value.Select(group => new
                    {
                        emoji = group.Emoji,
                        count = group.Count,
                        user_ids = group.UserIds
                    }).ToArray())
            }
        });
    }

    private IActionResult MessageReactionError(string code, string message, int status, string? field)
        => StatusCode(status, new { success = false, errors = new[] { new { code, message, field } } });

    private static int[] ParseReactionIds(string? ids)
        => string.IsNullOrWhiteSpace(ids)
            ? []
            : ids.Split(',')
                .Select(value => int.TryParse(value.Trim(), out var id) ? id : 0)
                .Where(id => id > 0)
                .Take(100)
                .ToArray();

    [HttpPost("messages/upload-voice")]
    public IActionResult UploadVoiceMessage([FromBody] JsonElement body) => Ok(new { data = new { id = StableId(body), status = "uploaded" } });

    [HttpPost("messages/voice")]
    [RequestSizeLimit(12L * 1024 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = 12L * 1024 * 1024)]
    public async Task<IActionResult> CreateVoiceMessage(CancellationToken ct)
    {
        if (!Request.HasFormContentType)
        {
            return VoiceWriteError("VALIDATION_ERROR", "Recipient ID is required", "recipient_id", 400);
        }

        var form = await Request.ReadFormAsync(ct);
        if (!int.TryParse(form["recipient_id"].ToString(), out var recipientId) || recipientId <= 0)
            return VoiceWriteError("VALIDATION_ERROR", "Recipient ID is required", "recipient_id", 400);

        var voiceFile = form.Files.GetFile("voice_message");
        if (voiceFile == null || voiceFile.Length == 0)
            return VoiceWriteError("VALIDATION_ERROR", "Voice message file is required", "voice_message", 400);

        var tenantId = TenantId();
        var userId = UserId();
        if (recipientId == userId)
            return VoiceWriteError("VALIDATION_ERROR", "You cannot send a message to yourself", null, 422);

        var sender = await LoadActiveVoiceUserAsync(userId, tenantId, ct);
        if (sender == null)
            return VoiceWriteError("FORBIDDEN", "Your account is not allowed to send messages", null, 403);

        var recipient = await LoadVoiceRecipientAsync(recipientId, tenantId, ct);
        if (recipient == null)
            return VoiceWriteError("NOT_FOUND", "Recipient not found", null, 404);

        if (await IsVoiceSenderMessagingDisabledAsync(userId, tenantId, ct))
            return VoiceWriteError("MESSAGING_DISABLED", "Your messaging has been restricted by an administrator", null, 403);
        if (await IsVoicePairBlockedAsync(userId, recipientId, tenantId, ct))
            return VoiceWriteError("BLOCKED", "You cannot send messages to this user", null, 403);

        var preflightDecision = await _safeguardingInteractionPolicy.EvaluateLocalContactAsync(
            userId,
            recipientId,
            tenantId,
            "direct_message",
            ct);
        if (!preflightDecision.IsAllowed)
            return VoiceSafeguardingError(preflightDecision);

        FileUpload stagedUpload;
        int durationSeconds;
        try
        {
            await using var stream = voiceFile.OpenReadStream();
            var staged = await _fileUploadService.UploadVoiceAsync(
                stream,
                voiceFile.FileName,
                string.IsNullOrWhiteSpace(voiceFile.ContentType) ? "audio/webm" : voiceFile.ContentType,
                voiceFile.Length,
                0,
                userId,
                tenantId,
                ct);
            if (staged.Error != null || staged.File == null)
                return VoiceWriteError("UPLOAD_FAILED", "Failed to send voice message", "voice_message", 400);

            stagedUpload = staged.File;
            durationSeconds = staged.DurationSeconds;
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Voice message upload failed before persistence");
            return VoiceWriteError("UPLOAD_FAILED", "Failed to send voice message", "voice_message", 400);
        }

        _db.ChangeTracker.Clear();

        var participant1Id = Math.Min(userId, recipientId);
        var participant2Id = Math.Max(userId, recipientId);
        Conversation? conversation = null;
        Message? message = null;
        MessageAttachment? attachment = null;
        IDbContextTransaction? transaction = null;

        async Task<IActionResult> AbortAsync(IActionResult result)
        {
            if (transaction != null)
            {
                try { await transaction.RollbackAsync(CancellationToken.None); }
                catch (Exception exception) { _logger.LogCritical(exception, "Voice message rollback failed; cleanup will continue"); }
                try { await transaction.DisposeAsync(); }
                catch (Exception exception) { _logger.LogCritical(exception, "Voice message transaction disposal failed; cleanup will continue"); }
                transaction = null;
            }
            await _fileUploadService.DeleteStagedAsync(stagedUpload, CancellationToken.None);
            return result;
        }

        try
        {
            transaction = await _db.Database.BeginTransactionAsync(ct);
            sender = await LoadActiveVoiceUserAsync(userId, tenantId, ct);
            recipient = await LoadVoiceRecipientAsync(recipientId, tenantId, ct);
            if (sender == null)
                return await AbortAsync(VoiceWriteError("FORBIDDEN", "Your account is not allowed to send messages", null, 403));
            if (recipient == null)
                return await AbortAsync(VoiceWriteError("NOT_FOUND", "Recipient not found", null, 404));
            if (await IsVoiceSenderMessagingDisabledAsync(userId, tenantId, ct))
                return await AbortAsync(VoiceWriteError("MESSAGING_DISABLED", "Your messaging has been restricted by an administrator", null, 403));
            if (await IsVoicePairBlockedAsync(userId, recipientId, tenantId, ct))
                return await AbortAsync(VoiceWriteError("BLOCKED", "You cannot send messages to this user", null, 403));

            var lockedDecision = await _safeguardingInteractionPolicy.EvaluateLockedLocalContactAsync(
                userId,
                recipientId,
                tenantId,
                "direct_message",
                ct);
            if (!lockedDecision.IsAllowed)
                return await AbortAsync(VoiceSafeguardingError(lockedDecision));

            conversation = await _db.Conversations.IgnoreQueryFilters().FirstOrDefaultAsync(row =>
                row.TenantId == tenantId
                && row.Participant1Id == participant1Id
                && row.Participant2Id == participant2Id, ct);
            var now = DateTime.UtcNow;
            if (conversation == null)
            {
                conversation = new Conversation
                {
                    TenantId = tenantId,
                    Participant1Id = participant1Id,
                    Participant2Id = participant2Id,
                    CreatedAt = now,
                    UpdatedAt = now
                };
                _db.Conversations.Add(conversation);
            }
            else
            {
                conversation.UpdatedAt = now;
            }

            message = new Message
            {
                TenantId = tenantId,
                Conversation = conversation,
                SenderId = userId,
                Content = string.Empty,
                IsRead = false,
                CreatedAt = now
            };
            _db.Messages.Add(message);
            await _db.SaveChangesAsync(ct);

            var upload = await _db.FileUploads.IgnoreQueryFilters().SingleOrDefaultAsync(row =>
                row.Id == stagedUpload.Id
                && row.TenantId == tenantId
                && row.UserId == userId
                && row.EntityType == "message_voice", ct);
            if (upload == null)
                throw new InvalidOperationException("The staged voice upload is no longer available.");

            upload.EntityId = message.Id;
            attachment = new MessageAttachment
            {
                MessageId = message.Id,
                FileUploadId = upload.Id,
                UploadedById = userId,
                CreatedAt = now
            };
            _db.MessageAttachments.Add(attachment);
            _db.VoiceMessages.Add(new VoiceMessage
            {
                TenantId = tenantId,
                SenderId = userId,
                Conversation = conversation,
                AudioUrl = _fileUploadService.GetDownloadUrl(upload),
                DurationSeconds = durationSeconds,
                FileSizeBytes = upload.FileSizeBytes,
                Format = VoiceFormat(upload.ContentType),
                IsRead = false,
                CreatedAt = now
            });
            await _db.SaveChangesAsync(ct);

            await transaction.CommitAsync(ct);
            var committedTransaction = transaction;
            transaction = null;
            try { await committedTransaction.DisposeAsync(); }
            catch (Exception exception) { _logger.LogError(exception, "Committed voice message transaction disposal failed"); }
        }
        catch (OperationCanceledException)
        {
            await AbortAsync(new EmptyResult());
            throw;
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Voice message persistence failed");
            return await AbortAsync(VoiceWriteError("UPLOAD_FAILED", "Failed to send voice message", "voice_message", 400));
        }
        finally
        {
            if (transaction != null)
            {
                try { await transaction.DisposeAsync(); }
                catch (Exception exception) { _logger.LogCritical(exception, "Residual voice message transaction disposal failed"); }
            }
        }

        if (conversation == null || message == null || attachment == null || sender == null || recipient == null)
            throw new InvalidOperationException("Committed voice message graph is unavailable.");

        await DispatchVoiceMessageEffectsAsync(tenantId, sender, recipient, conversation.Id, message);
        var audioUrl = _fileUploadService.GetDownloadUrl(stagedUpload);
        return StatusCode(StatusCodes.Status201Created, new
        {
            data = new
            {
                id = message.Id,
                conversation_id = conversation.Id,
                sender_id = userId,
                recipient_id = recipientId,
                receiver_id = recipientId,
                body = string.Empty,
                content = string.Empty,
                is_voice = true,
                audio_url = audioUrl,
                audio_duration = durationSeconds,
                transcript = (string?)null,
                transcript_language = (string?)null,
                sender = new
                {
                    id = sender.Id,
                    first_name = sender.FirstName,
                    last_name = sender.LastName
                },
                recipient = new
                {
                    id = recipient.Id,
                    first_name = recipient.FirstName,
                    last_name = recipient.LastName
                },
                attachments = new[]
                {
                    new
                    {
                        id = attachment.Id,
                        message_id = message.Id,
                        file_upload_id = stagedUpload.Id,
                        original_filename = stagedUpload.OriginalFilename,
                        file_name = stagedUpload.OriginalFilename,
                        name = stagedUpload.OriginalFilename,
                        content_type = stagedUpload.ContentType,
                        mime_type = stagedUpload.ContentType,
                        type = "audio",
                        file_size_bytes = stagedUpload.FileSizeBytes,
                        file_size = stagedUpload.FileSizeBytes,
                        size = stagedUpload.FileSizeBytes,
                        url = audioUrl,
                        created_at = attachment.CreatedAt
                    }
                },
                is_read = message.IsRead,
                created_at = message.CreatedAt
            },
            meta = new { base_url = $"{Request.Scheme}://{Request.Host}" }
        });
    }

    [HttpPost("metrics")]
    [AllowAnonymous]
    public IActionResult Metrics([FromBody] JsonElement body) => Ok(new { data = new { accepted = true } });

    private async Task<IActionResult> UpsertMerchant(JsonElement body, int step)
    {
        if (step == 3 && string.IsNullOrWhiteSpace(Str(body, "avatar_url")))
        {
            return BadRequest(new
            {
                success = false,
                error = "avatar_url is required.",
                errors = new[] { new { code = "VALIDATION_ERROR", message = "avatar_url is required.", field = "avatar_url" } }
            });
        }

        var profile = await FindMerchantProfileAsync();
        if (profile == null)
        {
            profile = new MarketplaceSellerProfile
            {
                TenantId = TenantId(),
                UserId = UserId(),
                DisplayName = Str(body, "display_name") ?? Str(body, "business_name") ?? $"Seller {UserId()}",
                SellerType = Str(body, "seller_type") ?? "business"
            };
            _db.MarketplaceSellerProfiles.Add(profile);
        }

        var extras = await LoadMerchantOnboardingExtrasAsync();

        if (step == 1)
        {
            profile.DisplayName = Str(body, "display_name") ?? Str(body, "business_name") ?? profile.DisplayName;
            profile.Bio = Str(body, "bio") ?? profile.Bio;
            profile.SellerType = Str(body, "seller_type") ?? profile.SellerType;
            CopyString(body, extras, "business_name");
            CopyString(body, extras, "business_registration");
        }
        else if (step == 2)
        {
            CopyJson(body, extras, "business_address");
            CopyJson(body, extras, "opening_hours");
        }
        else if (step == 3)
        {
            CopyString(body, extras, "avatar_url");
            CopyString(body, extras, "cover_image_url");
        }
        else if (step >= 4)
        {
            if (!extras.ContainsKey("joined_marketplace_at"))
                extras["joined_marketplace_at"] = JsonSerializer.SerializeToElement(DateTime.UtcNow);
            if (!extras.ContainsKey("onboarding_completed_at"))
                extras["onboarding_completed_at"] = JsonSerializer.SerializeToElement(DateTime.UtcNow);
        }

        profile.UpdatedAt = DateTime.UtcNow;
        await SaveMerchantOnboardingExtrasAsync(extras);
        await _db.SaveChangesAsync();

        var mapped = MapMerchantProfile(profile, extras);
        if (step >= 4)
        {
            mapped["badge_granted"] = true;
            return Ok(new { data = mapped });
        }

        return Ok(new { data = new { profile = mapped } });
    }

    private async Task<MarketplaceSellerProfile?> FindMerchantProfileAsync()
        => await _db.MarketplaceSellerProfiles.FirstOrDefaultAsync(p => p.TenantId == TenantId() && p.UserId == UserId());

    private async Task<Dictionary<string, JsonElement>> LoadMerchantOnboardingExtrasAsync()
    {
        var row = await _db.TenantConfigs.FirstOrDefaultAsync(c =>
            c.TenantId == TenantId() && c.Key == MerchantOnboardingProfileKeyPrefix + UserId());

        if (row == null || string.IsNullOrWhiteSpace(row.Value))
            return new Dictionary<string, JsonElement>();

        try
        {
            return JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(row.Value, StoreJsonOptions)
                ?? new Dictionary<string, JsonElement>();
        }
        catch (JsonException)
        {
            return new Dictionary<string, JsonElement>();
        }
    }

    private async Task SaveMerchantOnboardingExtrasAsync(Dictionary<string, JsonElement> extras)
    {
        var key = MerchantOnboardingProfileKeyPrefix + UserId();
        var json = JsonSerializer.Serialize(extras, StoreJsonOptions);
        var row = await _db.TenantConfigs.FirstOrDefaultAsync(c => c.TenantId == TenantId() && c.Key == key);
        if (row == null)
        {
            _db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = TenantId(),
                Key = key,
                Value = json,
                UpdatedAt = DateTime.UtcNow
            });
            return;
        }

        row.Value = json;
        row.UpdatedAt = DateTime.UtcNow;
    }

    private static Dictionary<string, object?> MapMerchantProfile(
        MarketplaceSellerProfile profile,
        IReadOnlyDictionary<string, JsonElement> extras)
    {
        var mapped = new Dictionary<string, object?>
        {
            ["id"] = profile.Id,
            ["tenant_id"] = profile.TenantId,
            ["user_id"] = profile.UserId,
            ["seller_type"] = profile.SellerType,
            ["display_name"] = profile.DisplayName,
            ["bio"] = profile.Bio,
            ["is_verified"] = profile.IsVerified,
            ["is_suspended"] = profile.IsSuspended,
            ["rating_average"] = profile.RatingAverage,
            ["rating_count"] = profile.RatingCount,
            ["listings_count"] = profile.ListingsCount,
            ["sales_count"] = profile.SalesCount,
            ["stripe_account_id"] = profile.StripeAccountId,
            ["created_at"] = profile.CreatedAt,
            ["updated_at"] = profile.UpdatedAt
        };

        foreach (var key in new[]
        {
            "business_name",
            "business_registration",
            "business_address",
            "opening_hours",
            "avatar_url",
            "cover_image_url",
            "joined_marketplace_at",
            "onboarding_completed_at"
        })
        {
            if (extras.TryGetValue(key, out var value))
                mapped[key] = value;
        }

        return mapped;
    }

    private static void CopyString(JsonElement source, IDictionary<string, JsonElement> target, string key)
    {
        var value = Str(source, key);
        if (!string.IsNullOrWhiteSpace(value))
            target[key] = JsonSerializer.SerializeToElement(value);
    }

    private static void CopyJson(JsonElement source, IDictionary<string, JsonElement> target, string key)
    {
        if (source.ValueKind == JsonValueKind.Object
            && source.TryGetProperty(key, out var value)
            && value.ValueKind != JsonValueKind.Null)
        {
            target[key] = value.Clone();
        }
    }

    private async Task<List<AppreciationRecord>> LoadAppreciationsAsync()
    {
        var raw = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.TenantId == TenantId() && c.Key == AppreciationsKey)
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

    private async Task<List<object>> MapAppreciationsAsync(IEnumerable<AppreciationRecord> records, int currentUserId)
    {
        var items = records.ToList();
        var senderIds = items.Select(a => a.SenderId).Distinct().ToArray();
        var users = await _db.Users
            .AsNoTracking()
            .Where(u => u.TenantId == TenantId() && senderIds.Contains(u.Id))
            .ToDictionaryAsync(u => u.Id);

        return items.Select(record =>
        {
            users.TryGetValue(record.SenderId, out var sender);
            return (object)new
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
                    name = DisplayName(sender),
                    avatar_url = sender.AvatarUrl
                },
                my_reaction = record.Reactions.TryGetValue(currentUserId.ToString(), out var reaction)
                    ? reaction
                    : null
            };
        }).ToList();
    }

    private static object PageMeta(int page, int perPage, int total)
    {
        var totalPages = total == 0 ? 1 : (int)Math.Ceiling(total / (double)perPage);
        return new { current_page = page, page, per_page = perPage, total, last_page = totalPages, total_pages = totalPages };
    }

    private async Task<List<LocalAdCampaignRecord>> LoadAdCampaignsAsync()
    {
        var raw = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.Key == LocalAdvertisingCampaignsKey)
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

    private async Task SaveAdCampaignsAsync(List<LocalAdCampaignRecord> records)
    {
        var json = JsonSerializer.Serialize(records.OrderBy(c => c.Id).ToList(), StoreJsonOptions);
        var existing = await _db.TenantConfigs.FirstOrDefaultAsync(c => c.Key == LocalAdvertisingCampaignsKey);
        if (existing == null)
        {
            _db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = TenantId(),
                Key = LocalAdvertisingCampaignsKey,
                Value = json,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            });
        }
        else
        {
            existing.Value = json;
            existing.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();
    }

    private async Task<List<PaidPushCampaignRecord>> LoadPushCampaignsAsync()
    {
        var raw = await _db.TenantConfigs
            .AsNoTracking()
            .Where(c => c.Key == PaidPushCampaignsKey)
            .Select(c => c.Value)
            .FirstOrDefaultAsync();

        if (string.IsNullOrWhiteSpace(raw))
        {
            return [];
        }

        try
        {
            return JsonSerializer.Deserialize<List<PaidPushCampaignRecord>>(raw, StoreJsonOptions) ?? [];
        }
        catch (JsonException)
        {
            return [];
        }
    }

    private async Task SavePushCampaignsAsync(List<PaidPushCampaignRecord> records)
    {
        var json = JsonSerializer.Serialize(records.OrderBy(c => c.Id).ToList(), StoreJsonOptions);
        var existing = await _db.TenantConfigs.FirstOrDefaultAsync(c => c.Key == PaidPushCampaignsKey);
        if (existing == null)
        {
            _db.TenantConfigs.Add(new TenantConfig
            {
                TenantId = TenantId(),
                Key = PaidPushCampaignsKey,
                Value = json,
                CreatedAt = DateTime.UtcNow,
                UpdatedAt = DateTime.UtcNow
            });
        }
        else
        {
            existing.Value = json;
            existing.UpdatedAt = DateTime.UtcNow;
        }

        await _db.SaveChangesAsync();
    }

    private static object MapAdCampaign(LocalAdCampaignRecord campaign) => new
    {
        id = campaign.Id,
        tenant_id = campaign.TenantId,
        created_by = campaign.CreatedBy,
        name = campaign.Name,
        status = campaign.Status,
        advertiser_type = campaign.AdvertiserType,
        budget_cents = campaign.BudgetCents,
        spent_cents = campaign.SpentCents,
        start_date = campaign.StartDate,
        end_date = campaign.EndDate,
        audience_filters = campaign.AudienceFiltersJson,
        placement = campaign.Placement,
        approved_by = campaign.ApprovedBy,
        approved_at = campaign.ApprovedAt,
        rejection_reason = campaign.RejectionReason,
        impression_count = campaign.ImpressionCount,
        click_count = campaign.ClickCount,
        created_at = campaign.CreatedAt,
        updated_at = campaign.UpdatedAt,
        advertiser_name = campaign.AdvertiserName,
        advertiser_email = campaign.AdvertiserEmail,
        creative_count = campaign.Creatives.Count,
        creatives = campaign.Creatives.Select(MapAdCreative).ToList()
    };

    private static object MapAdCreative(LocalAdCreativeRecord creative) => new
    {
        id = creative.Id,
        campaign_id = creative.CampaignId,
        tenant_id = creative.TenantId,
        headline = creative.Headline,
        body = creative.Body,
        cta_text = creative.CtaText,
        image_url = creative.ImageUrl,
        destination_url = creative.DestinationUrl,
        is_active = creative.IsActive,
        created_at = creative.CreatedAt
    };

    private static object MapCampaignStats(LocalAdCampaignRecord campaign)
    {
        var ctr = campaign.ImpressionCount == 0
            ? 0
            : Math.Round(campaign.ClickCount * 100.0 / campaign.ImpressionCount, 2);

        return new
        {
            campaign_id = campaign.Id,
            impressions = campaign.ImpressionCount,
            clicks = campaign.ClickCount,
            ctr_percent = ctr,
            budget_cents = campaign.BudgetCents,
            spent_cents = campaign.SpentCents,
            budget_remaining = Math.Max(0, campaign.BudgetCents - campaign.SpentCents),
            daily = Enumerable.Range(0, 30)
                .Select(offset => new
                {
                    date = DateTime.UtcNow.Date.AddDays(-29 + offset).ToString("yyyy-MM-dd"),
                    impressions = 0,
                    clicks = 0
                })
                .ToList()
        };
    }

    private static object MapPushCampaign(PaidPushCampaignRecord campaign) => new
    {
        id = campaign.Id,
        tenant_id = campaign.TenantId,
        created_by = campaign.CreatedBy,
        name = campaign.Name,
        status = campaign.Status,
        advertiser_type = campaign.AdvertiserType,
        title = campaign.Title,
        body = campaign.Body,
        cta_url = campaign.CtaUrl,
        audience_filter = campaign.AudienceFilterJson,
        audience_radius_km = campaign.AudienceRadiusKm,
        audience_min_trust_tier = campaign.AudienceMinTrustTier,
        target_count = campaign.TargetCount,
        actual_send_count = campaign.ActualSendCount,
        schedule_at = campaign.ScheduledAt,
        scheduled_at = campaign.ScheduledAt,
        sent_at = campaign.SentAt,
        cost_per_send = campaign.CostPerSend,
        total_cost_cents = campaign.TotalCostCents,
        approved_by = campaign.ApprovedBy,
        approved_at = campaign.ApprovedAt,
        rejection_reason = campaign.RejectionReason,
        open_count = campaign.OpenCount,
        click_count = campaign.ClickCount,
        created_at = campaign.CreatedAt,
        updated_at = campaign.UpdatedAt,
        advertiser_name = campaign.AdvertiserName,
        advertiser_email = campaign.AdvertiserEmail
    };

    private static string? BuildPushAudienceFilterJson(JsonElement body, int? radiusKm, string trustTier)
    {
        var payload = new Dictionary<string, object?>();
        if (radiusKm.HasValue)
        {
            payload["radius_km"] = radiusKm.Value;
        }

        payload["min_trust_tier"] = trustTier;

        if (body.ValueKind == JsonValueKind.Object && body.TryGetProperty("audience_filter", out var filter) && filter.ValueKind != JsonValueKind.Null)
        {
            payload["raw"] = JsonSerializer.Deserialize<JsonElement>(filter.GetRawText());
        }

        return payload.Count == 0 ? null : JsonSerializer.Serialize(payload, StoreJsonOptions);
    }

    private static string NormalizePushTrustTier(string? value) =>
        NormalizeAdChoice(value, "any", new[] { "any", "member", "trusted", "verified" });

    private static string NormalizeAdChoice(string? value, string fallback, IEnumerable<string> allowed)
    {
        var normalized = value?.Trim().ToLowerInvariant();
        return !string.IsNullOrWhiteSpace(normalized) && allowed.Contains(normalized)
            ? normalized
            : fallback;
    }

    private static string SafeLocalReturnUrl(string? value, string fallback)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return fallback;
        }

        if (Uri.TryCreate(value, UriKind.Absolute, out var absolute)
            && (absolute.Scheme == Uri.UriSchemeHttp || absolute.Scheme == Uri.UriSchemeHttps))
        {
            return absolute.ToString();
        }

        return value.StartsWith("/", StringComparison.Ordinal) && !value.StartsWith("//", StringComparison.Ordinal)
            ? value
            : fallback;
    }

    private static string MemberPremiumStatusForReact(SubscriptionStatus status) => status switch
    {
        SubscriptionStatus.PastDue => "past_due",
        SubscriptionStatus.Cancelled => "canceled",
        SubscriptionStatus.Expired => "canceled",
        _ => "active"
    };

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

        var slug = builder.ToString().Trim('-');
        return string.IsNullOrWhiteSpace(slug) ? "tier" : slug;
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

    private static int ToCents(decimal amount) => (int)decimal.Round(amount * 100m, 0, MidpointRounding.AwayFromZero);

    private static string? TryGetRawProperty(JsonElement body, string name) =>
        body.ValueKind == JsonValueKind.Object && body.TryGetProperty(name, out var value) && value.ValueKind != JsonValueKind.Null
            ? value.GetRawText()
            : null;

    private static string? DisplayName(User? user)
    {
        if (user == null)
        {
            return null;
        }

        var name = $"{user.FirstName} {user.LastName}".Trim();
        return string.IsNullOrWhiteSpace(name) ? user.Email : name;
    }

    private static string DisplayName(string firstName, string lastName, string email)
    {
        var name = $"{firstName} {lastName}".Trim();
        return string.IsNullOrWhiteSpace(name) ? email : name;
    }

    private Task<User?> LoadActiveVoiceUserAsync(int userId, int tenantId, CancellationToken ct)
        => _db.Users.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(user =>
            user.Id == userId && user.TenantId == tenantId && user.IsActive && user.SuspendedAt == null, ct);

    private Task<User?> LoadVoiceRecipientAsync(int userId, int tenantId, CancellationToken ct)
        => _db.Users.IgnoreQueryFilters().AsNoTracking().SingleOrDefaultAsync(user =>
            user.Id == userId && user.TenantId == tenantId, ct);

    private Task<bool> IsVoicePairBlockedAsync(int senderId, int recipientId, int tenantId, CancellationToken ct)
        => _db.UserBlocks.IgnoreQueryFilters().AsNoTracking().AnyAsync(block =>
            block.TenantId == tenantId
            && ((block.UserId == senderId && block.BlockedUserId == recipientId)
                || (block.UserId == recipientId && block.BlockedUserId == senderId)), ct);

    private async Task<bool> IsVoiceSenderMessagingDisabledAsync(int senderId, int tenantId, CancellationToken ct)
    {
        var now = DateTime.UtcNow;
        await _db.UserMonitoringRestrictions.IgnoreQueryFilters()
            .Where(row => row.TenantId == tenantId
                && row.UserId == senderId
                && row.UnderMonitoring
                && row.MonitoringExpiresAt != null
                && row.MonitoringExpiresAt <= now)
            .ExecuteUpdateAsync(setters => setters
                .SetProperty(row => row.UnderMonitoring, false)
                .SetProperty(row => row.MessagingDisabled, false)
                .SetProperty(row => row.MonitoringExpiresAt, (DateTime?)null), ct);
        return await _db.UserMonitoringRestrictions.IgnoreQueryFilters().AsNoTracking().AnyAsync(row =>
            row.TenantId == tenantId && row.UserId == senderId && row.MessagingDisabled, ct);
    }

    private IActionResult VoiceWriteError(string code, string message, string? field, int status)
    {
        var error = new Dictionary<string, object?> { ["code"] = code, ["message"] = message };
        if (field != null)
            error["field"] = field;
        return StatusCode(status, new { errors = new[] { error } });
    }

    private IActionResult VoiceSafeguardingError(SafeguardingInteractionDecision decision)
    {
        var codes = decision.RequiredAttestationCodes?.ToArray() ?? [];
        var labels = decision.RequiredAttestationLabels?.ToArray() ?? [];
        Dictionary<string, object?> error;
        if (decision.IsUnavailable)
        {
            error = new()
            {
                ["code"] = "SAFEGUARDING_POLICY_UNAVAILABLE",
                ["message"] = "We cannot confirm the community safeguarding policy right now. No message has been sent. Please try again shortly.",
                ["title"] = "Safeguarding check temporarily unavailable",
                ["detail"] = "Project NEXUS could not safely evaluate the contact policy, so this interaction has been paused.",
                ["action_label"] = "Check again",
                ["required_vetting_types"] = codes,
                ["required_vetting_labels"] = labels,
                ["retryable"] = true
            };
        }
        else if (decision.Code == "VETTING_REQUIRED")
        {
            var types = string.Join(", ", labels);
            error = new()
            {
                ["code"] = "VETTING_REQUIRED",
                ["message"] = $"This conversation is paused by a community safeguarding rule. Your community must have recorded a current {types} confirmation for you before you can message this member. Ask your broker or community administrator to record this metadata-only status. Do not send or upload any vetting document.",
                ["title"] = "Safeguarding check needed",
                ["detail"] = $"This member can only be contacted for this type of interaction by members whose community has recorded a current {types} status. The record is metadata only; no document should be sent or uploaded.",
                ["action_label"] = "Open help",
                ["required_vetting_types"] = codes,
                ["required_vetting_labels"] = labels
            };
        }
        else
        {
            error = new()
            {
                ["code"] = "SAFEGUARDING_CONTACT_RESTRICTED",
                ["message"] = "This member has asked for a coordinator to arrange contact on their behalf. Your message has not been sent. Please contact your broker or community administrator so they can help arrange the next safe step.",
                ["title"] = "Coordinator arrangement needed",
                ["detail"] = "This member is not available for direct messages because their safeguarding preferences require coordinator-mediated contact. You can ask a coordinator to help arrange contact.",
                ["action_label"] = "Open help"
            };
        }
        return StatusCode(decision.IsUnavailable ? 503 : 403, new { errors = new[] { error } });
    }

    private async Task DispatchVoiceMessageEffectsAsync(
        int tenantId,
        User sender,
        User recipient,
        int conversationId,
        Message message)
    {
        try
        {
            var data = JsonSerializer.Serialize(new
            {
                message_id = message.Id,
                conversation_id = conversationId,
                sender_id = sender.Id
            });
            if (!await _db.Notifications.IgnoreQueryFilters().AnyAsync(row =>
                    row.TenantId == tenantId && row.UserId == recipient.Id
                    && row.Type == "new_message" && row.Data == data))
            {
                _db.Notifications.Add(new Notification
                {
                    TenantId = tenantId,
                    UserId = recipient.Id,
                    Type = "new_message",
                    Title = "New message",
                    Body = $"New message from {sender.FirstName}",
                    Data = data,
                    Link = $"/messages/{sender.Id}",
                    CreatedAt = DateTime.UtcNow
                });
                await _db.SaveChangesAsync();
            }

            if (!await _db.XpLogs.IgnoreQueryFilters().AnyAsync(row =>
                    row.TenantId == tenantId && row.UserId == sender.Id
                    && row.Source == "send_message" && row.ReferenceId == message.Id))
            {
                await _gamification.AwardXpAsync(
                    sender.Id,
                    XpLog.Amounts.MessageSent,
                    "send_message",
                    message.Id,
                    "Sent a message");
            }
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Post-commit effects failed for voice message {MessageId}", message.Id);
        }

        try
        {
            await _realTimeMessaging.NotifyNewMessageAsync(tenantId, recipient.Id, new MessageNotification
            {
                Id = message.Id,
                ConversationId = conversationId,
                Content = string.Empty,
                Sender = new SenderInfo { Id = sender.Id, FirstName = sender.FirstName },
                IsRead = false,
                CreatedAt = message.CreatedAt
            });
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Real-time delivery failed for committed voice message {MessageId}", message.Id);
        }
    }

    private static string VoiceFormat(string contentType) => contentType switch
    {
        "audio/webm" or "video/webm" => "webm",
        "audio/ogg" => "ogg",
        "audio/mpeg" or "audio/mp3" => "mp3",
        "audio/wav" or "audio/x-wav" => "wav",
        "audio/mp4" or "audio/x-m4a" or "video/mp4" => "m4a",
        "audio/aac" or "audio/x-hx-aac-adts" => "aac",
        _ => "webm"
    };

    private async Task<User?> CurrentUser() => await _db.Users.FirstOrDefaultAsync(u => u.Id == UserId());
    private int TenantId() => _tenantContext.TenantId ?? throw new InvalidOperationException("Tenant context not resolved");
    private int UserId() => User.GetUserId() ?? throw new UnauthorizedAccessException("Invalid token");
    private static string? Str(JsonElement e, string name) => e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind != JsonValueKind.Null ? v.ToString() : null;
    private static int? Int(JsonElement e, string name) => int.TryParse(Str(e, name), out var value) ? value : null;
    private static bool? Bool(JsonElement e, string name) => bool.TryParse(Str(e, name), out var value) ? value : null;
    private int? IntFromQuery(string name) => int.TryParse(Request.Query[name].FirstOrDefault(), out var value) ? value : null;
    private static string Required(string? value, string name) => string.IsNullOrWhiteSpace(value) ? throw new ArgumentException($"{name} is required") : value;
    private static int StableId(JsonElement body) => Math.Abs(HashCode.Combine(body.GetRawText()));
    private static string Hex(string value) => Convert.ToHexString(Encoding.UTF8.GetBytes(value));

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
        public string? AudienceFiltersJson { get; set; }
        public string Placement { get; set; } = "feed";
        public int? ApprovedBy { get; set; }
        public DateTime? ApprovedAt { get; set; }
        public string? RejectionReason { get; set; }
        public int ImpressionCount { get; set; }
        public int ClickCount { get; set; }
        public string? AdvertiserName { get; set; }
        public string? AdvertiserEmail { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
        public List<LocalAdCreativeRecord> Creatives { get; set; } = [];
    }

    private sealed class LocalAdCreativeRecord
    {
        public int Id { get; set; }
        public int CampaignId { get; set; }
        public int TenantId { get; set; }
        public string Headline { get; set; } = string.Empty;
        public string Body { get; set; } = string.Empty;
        public string? CtaText { get; set; }
        public string? ImageUrl { get; set; }
        public string? DestinationUrl { get; set; }
        public int IsActive { get; set; } = 1;
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }

    public sealed record MemberDataExportRequest([property: JsonPropertyName("format")] string? Format);

    private sealed class PaidPushCampaignRecord
    {
        public int Id { get; set; }
        public int TenantId { get; set; }
        public int CreatedBy { get; set; }
        public string Name { get; set; } = string.Empty;
        public string Status { get; set; } = "draft";
        public string AdvertiserType { get; set; } = "sme";
        public string Title { get; set; } = string.Empty;
        public string Body { get; set; } = string.Empty;
        public string? CtaUrl { get; set; }
        public string? AudienceFilterJson { get; set; }
        public int? AudienceRadiusKm { get; set; }
        public string AudienceMinTrustTier { get; set; } = "any";
        public int? TargetCount { get; set; }
        public int ActualSendCount { get; set; }
        public string? ScheduledAt { get; set; }
        public DateTime? SentAt { get; set; }
        public int CostPerSend { get; set; } = 5;
        public int TotalCostCents { get; set; }
        public int? ApprovedBy { get; set; }
        public DateTime? ApprovedAt { get; set; }
        public string? RejectionReason { get; set; }
        public int OpenCount { get; set; }
        public int ClickCount { get; set; }
        public string? AdvertiserName { get; set; }
        public string? AdvertiserEmail { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
    }
}
