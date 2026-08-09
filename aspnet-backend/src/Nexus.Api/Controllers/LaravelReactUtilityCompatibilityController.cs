// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Middleware;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
public sealed class LaravelReactUtilityCompatibilityController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly TenantContext _tenant;
    private readonly IConfiguration _config;
    private readonly IHostEnvironment _environment;
    private readonly SafeguardingCoordinationService _safeguardingCoordination;
    private readonly SsoOidcAuthenticationService _ssoAuthentication;

    public LaravelReactUtilityCompatibilityController(
        NexusDbContext db,
        TenantContext tenant,
        IConfiguration config,
        IHostEnvironment environment,
        SafeguardingCoordinationService safeguardingCoordination,
        SsoOidcAuthenticationService ssoAuthentication)
    {
        _db = db;
        _tenant = tenant;
        _config = config;
        _environment = environment;
        _safeguardingCoordination = safeguardingCoordination;
        _ssoAuthentication = ssoAuthentication;
    }

    [AllowAnonymous]
    [HttpGet("/api/health")]
    [HttpGet("/api/v2/health")]
    public IActionResult Health() => Ok(new { status = "ok" });

    [AllowAnonymous]
    [HttpGet("/api/public-changelog")]
    [HttpGet("/api/v2/public-changelog")]
    public IActionResult PublicChangelog()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "CHANGELOG.md");
        var repoPath = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "CHANGELOG.md"));
        var markdown = System.IO.File.Exists(repoPath)
            ? System.IO.File.ReadAllText(repoPath)
            : System.IO.File.Exists(path)
                ? System.IO.File.ReadAllText(path)
                : string.Empty;

        return Data(new
        {
            route_key = "changelog",
            path = "/changelog",
            content_source = "public_changelog_markdown",
            source_path = "CHANGELOG.md",
            title = FirstMarkdownHeading(markdown) ?? "CHANGELOG.md",
            items = ChangelogItems(markdown, 12)
        });
    }

    [AllowAnonymous]
    [HttpGet("/api/public-page-content/{pageKey}")]
    [HttpGet("/api/v2/public-page-content/{pageKey}")]
    public async Task<IActionResult> PublicPageContent(string pageKey)
    {
        var normalized = NormalizePageKey(pageKey);
        var page = await LoadPublishedPageAsync(normalized);
        if (page != null)
        {
            return Data(new
            {
                route_key = normalized,
                page_key = normalized,
                path = "/" + normalized,
                content_source = "aspnet_cms_page",
                title = page.Title,
                lead = page.MetaDescription ?? string.Empty,
                content = page.Content,
                sections = Array.Empty<object>(),
                tenant = TenantPayload()
            });
        }

        var fallback = PublicPageDefinition(normalized);
        return fallback == null
            ? NotFound(new { success = false, error = "RESOURCE_NOT_FOUND", message = "Page not found." })
            : Data(fallback);
    }

    [AllowAnonymous]
    [HttpGet("/api/public-static-route-content/{pageKey}")]
    [HttpGet("/api/v2/public-static-route-content/{pageKey}")]
    public IActionResult PublicStaticRouteContent(string pageKey)
    {
        var normalized = NormalizePageKey(pageKey);
        var fallback = StaticRouteDefinition(normalized);
        return fallback == null
            ? NotFound(new { success = false, error = "RESOURCE_NOT_FOUND", message = "Page not found." })
            : Data(fallback);
    }

    [AllowAnonymous]
    [HttpGet("/api/notifications/unsubscribe")]
    [HttpGet("/api/v2/notifications/unsubscribe")]
    public IActionResult NotificationUnsubscribePage([FromQuery] string? token)
    {
        var result = ProcessUnsubscribeToken(token);
        var html = RenderUnsubscribeHtml(result.Status, result.Category);
        return Content(html, "text/html", Encoding.UTF8);
    }

    [AllowAnonymous]
    [HttpPost("/api/notifications/unsubscribe")]
    [HttpPost("/api/v2/notifications/unsubscribe")]
    public async Task<IActionResult> NotificationUnsubscribeOneClick()
    {
        var token = Request.Query["token"].FirstOrDefault();
        if (string.IsNullOrWhiteSpace(token) && Request.ContentLength.GetValueOrDefault() > 0)
        {
            try
            {
                var body = await JsonSerializer.DeserializeAsync<JsonElement>(Request.Body);
                token = ReadString(body, "token");
            }
            catch (JsonException)
            {
                return BadRequest(new { success = false, error = "INVALID_TOKEN", message = "Unsubscribe token is invalid or expired." });
            }
        }

        var result = ProcessUnsubscribeToken(token);
        if (result.Status == "invalid")
        {
            return BadRequest(new { success = false, error = "INVALID_TOKEN", message = "Unsubscribe token is invalid or expired." });
        }

        return Data(new { unsubscribed = true, category = result.Category ?? "all" });
    }

    [Authorize]
    [HttpGet("/api/ai/chat/starters")]
    [HttpGet("/api/v2/ai/chat/starters")]
    public IActionResult AiChatStarters()
    {
        return Data(new
        {
            starters = new[]
            {
                "What can I do next in my community?",
                "Find exchanges that match my skills",
                "Summarise my active goals",
                "Suggest ways to help nearby members",
                "Explain how time credits work"
            }
        });
    }

    [Authorize]
    [HttpPost("/api/ai/chat/feedback")]
    [HttpPost("/api/v2/ai/chat/feedback")]
    public IActionResult AiChatFeedback([FromBody] JsonElement body)
    {
        var feedback = ReadString(body, "feedback");
        if (feedback != "up" && feedback != "down")
        {
            return UnprocessableEntity(new { success = false, error = "VALIDATION", message = "feedback must be \"up\" or \"down\"" });
        }

        var traceId = ReadInt(body, "trace_id");
        var messageId = ReadInt(body, "message_id");
        if (traceId is null && messageId is null)
        {
            return UnprocessableEntity(new { success = false, error = "VALIDATION", message = "Either trace_id or message_id is required" });
        }

        return NotFound(new { success = false, error = "NOT_FOUND", message = "No matching trace to update" });
    }

    [Authorize(Policy = "AdminOnly")]
    [HttpGet("/api/admin/volunteering/donations")]
    [HttpGet("/api/v2/admin/volunteering/donations")]
    public async Task<IActionResult> AdminVolunteeringDonations([FromQuery] string? status = null)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var query = _db.MoneyDonations
            .IgnoreQueryFilters()
            .Where(d => d.TenantId == tenantId);

        if (!string.IsNullOrWhiteSpace(status))
        {
            var normalized = status.Trim().ToLowerInvariant();
            query = normalized switch
            {
                "pending" => query.Where(d => d.Status == MoneyDonationStatus.Pending),
                "completed" => query.Where(d => d.Status == MoneyDonationStatus.Succeeded),
                "failed" => query.Where(d => d.Status == MoneyDonationStatus.Failed || d.Status == MoneyDonationStatus.Cancelled),
                "refunded" => query.Where(d => d.Status == MoneyDonationStatus.Refunded),
                _ => query
            };
        }

        var rows = await query.OrderByDescending(d => d.CreatedAt).Take(200).ToListAsync();
        return Data(new { items = rows.Select(MapVolunteerDonation) });
    }

    [Authorize(Policy = "AdminOnly")]
    [HttpPost("/api/admin/volunteering/donations/{id:int}/complete")]
    [HttpPost("/api/v2/admin/volunteering/donations/{id:int}/complete")]
    public async Task<IActionResult> CompleteAdminVolunteeringDonation(int id)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        var donation = await _db.MoneyDonations
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(d => d.Id == id && d.TenantId == tenantId);
        if (donation == null)
        {
            return NotFound(new { success = false, error = "NOT_FOUND", message = "Donation not found." });
        }

        if (donation.Status == MoneyDonationStatus.Succeeded)
        {
            return Data(new { id = donation.Id, status = "completed", already_completed = true });
        }

        if (donation.Status != MoneyDonationStatus.Pending)
        {
            return UnprocessableEntity(new { success = false, error = "VALIDATION_ERROR", message = "Only pending donations can be completed." });
        }

        donation.Status = MoneyDonationStatus.Succeeded;
        donation.CompletedAt = DateTime.UtcNow;
        donation.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Data(new { id = donation.Id, status = "completed", already_completed = false });
    }

    [AllowAnonymous]
    [HttpPost("/api/webhooks/postmark")]
    [HttpPost("/api/v2/webhooks/postmark")]
    public async Task<IActionResult> PostmarkWebhook()
    {
        var secret = _config["Postmark:WebhookSecret"] ?? _config["POSTMARK_WEBHOOK_SECRET"];
        if (!string.IsNullOrWhiteSpace(secret))
        {
            var provided = Request.Headers["X-Postmark-Webhook-Secret"].FirstOrDefault()
                ?? Request.Headers.Authorization.FirstOrDefault()?.Split(':').LastOrDefault();
            if (!string.Equals(secret, provided, StringComparison.Ordinal))
            {
                return Unauthorized(new { success = false, error = "UNAUTHORIZED", message = "Invalid webhook signature." });
            }
        }
        else if (_environment.IsProduction())
        {
            return StatusCode(500, new { success = false, error = "CONFIGURATION_ERROR", message = "Webhook authentication is not configured." });
        }

        JsonElement decoded;
        try
        {
            decoded = await JsonSerializer.DeserializeAsync<JsonElement>(Request.Body);
        }
        catch (JsonException)
        {
            return BadRequest(new { success = false, error = "INVALID_PAYLOAD", message = "Invalid JSON payload." });
        }

        var events = decoded.ValueKind == JsonValueKind.Array
            ? decoded.EnumerateArray().ToArray()
            : decoded.ValueKind == JsonValueKind.Object
                ? new[] { decoded }
                : Array.Empty<JsonElement>();
        if (events.Length == 0)
        {
            return BadRequest(new { success = false, error = "INVALID_PAYLOAD", message = "Invalid JSON payload." });
        }

        var processed = events.Count(e =>
        {
            var type = ReadString(e, "RecordType");
            var email = ReadString(e, "Email") ?? ReadString(e, "Recipient");
            return !string.IsNullOrWhiteSpace(type) && !string.IsNullOrWhiteSpace(email) && email.Contains('@');
        });

        return Ok(new { received = events.Length, processed });
    }

    [AllowAnonymous]
    [EnableRateLimiting(RateLimitingExtensions.AuthPolicy)]
    [HttpGet("/api/auth/sso/providers")]
    [HttpGet("/api/v2/auth/sso/providers")]
    public async Task<IActionResult> SsoProviders([FromQuery(Name = "tenant_id")] int? tenantId)
    {
        var resolvedTenantId = ResolveTenantId(tenantId);
        if (resolvedTenantId <= 0)
        {
            return Ok(new { success = true, providers = Array.Empty<object>() });
        }

        var providers = await _db.TenantSsoProviders
            .IgnoreQueryFilters()
            .Where(p => p.TenantId == resolvedTenantId && p.IsEnabled)
            .OrderBy(p => p.DisplayName)
            .Select(p => new
            {
                provider_key = p.ProviderKey,
                key = p.ProviderKey,
                display_name = p.DisplayName,
                name = p.DisplayName,
                preset = p.Preset,
                scopes = p.Scopes,
                auto_provision = p.AutoProvision
            })
            .ToListAsync();

        return Ok(new { success = true, providers });
    }

    [AllowAnonymous]
    [EnableRateLimiting(RateLimitingExtensions.AuthPolicy)]
    [HttpGet("/api/auth/sso/{provider}/redirect")]
    [HttpGet("/api/v2/auth/sso/{provider}/redirect")]
    public async Task<IActionResult> SsoRedirect(
        string provider,
        [FromQuery(Name = "tenant_id")] int? tenantId,
        [FromQuery(Name = "browser_challenge")] string? browserChallenge,
        CancellationToken ct)
    {
        var resolvedTenantId = ResolveTenantId(tenantId);
        if (resolvedTenantId <= 0)
        {
            return BadRequest(new { success = false, error = "tenant_required", message = "Tenant is required." });
        }

        try
        {
            var redirectUri = $"{Request.Scheme}://{Request.Host}/api/v2/auth/sso/callback";
            var authorization = await _ssoAuthentication.BeginAsync(
                resolvedTenantId,
                provider,
                browserChallenge,
                redirectUri,
                ct);
            return Ok(new { success = true, redirect_url = authorization.Url, provider });
        }
        catch (Exception ex) when (ex is SsoAuthenticationException or HttpRequestException)
        {
            return BadRequest(new { success = false, error = "sso_redirect_failed", message = "SSO sign-in could not be started." });
        }
    }

    [AllowAnonymous]
    [EnableRateLimiting(RateLimitingExtensions.AuthPolicy)]
    [HttpGet("/api/auth/sso/callback")]
    [HttpGet("/api/v2/auth/sso/callback")]
    public async Task<IActionResult> SsoCallback(
        [FromQuery] string? error = null,
        [FromQuery(Name = "error_description")] string? errorDescription = null,
        [FromQuery] string? code = null,
        [FromQuery] string? state = null,
        CancellationToken ct = default)
    {
        var tenantId = _ssoAuthentication.TenantIdFromState(state);
        var frontend = tenantId is > 0
            ? await _ssoAuthentication.FrontendCallbackBaseAsync(tenantId.Value, ct)
            : (_config["App:FrontendUrl"] ?? "http://localhost:5173").TrimEnd('/');
        try
        {
            if (!string.IsNullOrWhiteSpace(error) || string.IsNullOrWhiteSpace(code) || string.IsNullOrWhiteSpace(state))
                throw new SsoAuthenticationException(errorDescription ?? error ?? "SSO callback is incomplete.");
            var result = await _ssoAuthentication.HandleCallbackAsync(state, code, ct);
            var query = $"code={Uri.EscapeDataString(result.CallbackCode)}" +
                $"&provider={Uri.EscapeDataString(result.Provider)}" +
                $"&flow={Uri.EscapeDataString(result.BrowserChallenge)}";
            return Redirect(frontend + "/auth/oauth/callback?" + query);
        }
        catch (Exception ex) when (ex is SsoAuthenticationException or HttpRequestException or SecurityTokenException)
        {
            return Redirect(frontend + "/auth/oauth/callback?error=sso_failed&message=" +
                Uri.EscapeDataString("SSO sign-in failed."));
        }
    }

    [AllowAnonymous]
    [EnableRateLimiting(RateLimitingExtensions.AuthPolicy)]
    [HttpPost("/api/auth/oauth/exchange")]
    [HttpPost("/api/v2/auth/oauth/exchange")]
    public async Task<IActionResult> OauthExchange([FromBody] JsonElement body, CancellationToken ct)
    {
        var code = ReadString(body, "code");
        var browserVerifier = ReadString(body, "browser_verifier");
        try
        {
            var result = await _ssoAuthentication.ExchangeAsync(
                code,
                browserVerifier,
                HttpContext.Connection.RemoteIpAddress?.ToString(),
                ct);
            return Ok(new
            {
                success = true,
                token = result.Token,
                access_token = result.Token,
                refresh_token = result.RefreshToken,
                expires_in = result.ExpiresIn,
                refresh_expires_in = result.RefreshExpiresIn,
                token_type = "Bearer",
                provider = result.Provider,
                is_new = result.IsNew,
                tenant_id = result.TenantId
            });
        }
        catch (Exception ex) when (ex is SsoAuthenticationException or CryptographicException or DbUpdateException)
        {
            return BadRequest(new { success = false, error = "invalid_oauth_code", message = "OAuth sign-in failed." });
        }
    }

    [AllowAnonymous]
    [HttpGet("/api/geo/os-places/search")]
    [HttpGet("/api/v2/geo/os-places/search")]
    public async Task<IActionResult> OsPlacesSearch([FromQuery] string? q)
    {
        var tenantId = ResolveTenantId(null);
        var provider = tenantId > 0 ? await GetTenantConfigAsync(tenantId, "geocoding_provider") : null;
        var apiKey = tenantId > 0 ? await GetTenantConfigAsync(tenantId, "os_maps_api_key") : null;
        var enabled = provider == "os_places" && !string.IsNullOrWhiteSpace(apiKey);

        if (!enabled || string.IsNullOrWhiteSpace(q) || q.Trim().Length < 3)
        {
            return Data(new { enabled, results = Array.Empty<object>() });
        }

        return Data(new { enabled = true, results = Array.Empty<object>() });
    }

    [Authorize]
    [HttpGet("/api/exchanges/needs-attention-count")]
    [HttpGet("/api/v2/exchanges/needs-attention-count")]
    public async Task<IActionResult> ExchangesNeedsAttention()
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { success = false, error = "Invalid token" });
        var tenantId = _tenant.GetTenantIdOrThrow();

        var rows = await _db.Exchanges
            .IgnoreQueryFilters()
            .Include(e => e.Listing)
            .Where(e => e.TenantId == tenantId &&
                        (e.InitiatorId == userId.Value || e.ListingOwnerId == userId.Value || e.ProviderId == userId.Value || e.ReceiverId == userId.Value) &&
                        (e.Status == ExchangeStatus.Requested || e.Status == ExchangeStatus.Accepted || e.Status == ExchangeStatus.Completed))
            .OrderByDescending(e => e.UpdatedAt ?? e.CreatedAt)
            .Take(5)
            .Select(e => new
            {
                id = e.Id,
                status = e.Status.ToString().ToLowerInvariant(),
                listing_id = e.ListingId,
                listing_title = e.Listing != null ? e.Listing.Title : null,
                created_at = e.CreatedAt,
                updated_at = e.UpdatedAt
            })
            .ToListAsync();

        return Data(new { count = rows.Count, items = rows });
    }

    [Authorize]
    [HttpGet("/api/reviews/given")]
    [HttpGet("/api/v2/reviews/given")]
    public async Task<IActionResult> ReviewsGiven([FromQuery(Name = "per_page")] int perPage = 20)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { success = false, error = "Invalid token" });
        var tenantId = _tenant.GetTenantIdOrThrow();
        var limit = Math.Clamp(perPage, 1, 100);

        var reviews = await _db.Reviews
            .IgnoreQueryFilters()
            .Include(r => r.TargetUser)
            .Include(r => r.TargetListing)
            .Where(r => r.TenantId == tenantId && r.ReviewerId == userId.Value)
            .OrderByDescending(r => r.CreatedAt)
            .Take(limit + 1)
            .ToListAsync();
        var hasMore = reviews.Count > limit;
        var data = reviews.Take(limit).Select(r => new
        {
            id = r.Id,
            reviewer_id = r.ReviewerId,
            target_user_id = r.TargetUserId,
            target_listing_id = r.TargetListingId,
            target_name = r.TargetUser == null ? null : $"{r.TargetUser.FirstName} {r.TargetUser.LastName}".Trim(),
            listing_title = r.TargetListing?.Title,
            rating = r.Rating,
            comment = r.Comment,
            created_at = r.CreatedAt,
            updated_at = r.UpdatedAt
        }).ToArray();

        return Ok(new
        {
            success = true,
            data,
            meta = new { cursor = hasMore ? data.LastOrDefault()?.id.ToString() : null, per_page = limit, has_more = hasMore }
        });
    }

    [Authorize]
    [HttpGet("/api/goals/{id:int}/insights")]
    [HttpGet("/api/v2/goals/{id:int}/insights")]
    public async Task<IActionResult> GoalInsights(int id)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { success = false, error = "Invalid token" });
        var goal = await _db.Goals
            .IgnoreQueryFilters()
            .Include(g => g.Milestones)
            .FirstOrDefaultAsync(g => g.Id == id && g.TenantId == _tenant.GetTenantIdOrThrow());

        if (goal == null) return NotFound(new { success = false, code = "RESOURCE_NOT_FOUND", error = "Goal not found." });
        if (goal.UserId != userId.Value) return StatusCode(403, new { success = false, code = "RESOURCE_FORBIDDEN", error = "Goal is private." });

        var targetValue = goal.TargetValue.GetValueOrDefault();
        var progress = targetValue <= 0
            ? 0
            : Math.Round(Math.Min(100, goal.CurrentValue / targetValue * 100), 2);
        var completedMilestones = goal.Milestones.Count(m => m.IsCompleted);
        var milestoneCount = goal.Milestones.Count;

        return Data(new
        {
            goal_id = goal.Id,
            progress_percent = progress,
            current_value = goal.CurrentValue,
            target_value = goal.TargetValue,
            status = goal.Status,
            trend = goal.Status == "completed" ? "complete" : "steady",
            completed_milestones = completedMilestones,
            total_milestones = milestoneCount,
            next_action = milestoneCount == completedMilestones ? "Add a new milestone" : "Complete the next milestone",
            milestones = goal.Milestones.OrderBy(m => m.SortOrder).Select(m => new
            {
                id = m.Id,
                title = m.Title,
                is_completed = m.IsCompleted,
                completed_at = m.CompletedAt
            })
        });
    }

    [Authorize]
    [HttpPost("/api/goals/{id:int}/buddy/nudge")]
    [HttpPost("/api/v2/goals/{id:int}/buddy/nudge")]
    public async Task<IActionResult> GoalBuddyNudge(int id, [FromBody] JsonElement body)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { success = false, error = "Invalid token" });
        var goal = await _db.Goals.IgnoreQueryFilters().FirstOrDefaultAsync(g => g.Id == id && g.TenantId == _tenant.GetTenantIdOrThrow());
        if (goal == null) return NotFound(new { success = false, code = "RESOURCE_NOT_FOUND", error = "Goal not found." });
        if (goal.UserId != userId.Value) return StatusCode(403, new { success = false, code = "RESOURCE_FORBIDDEN", error = "Goal buddy required." });

        var type = ReadString(body, "type") ?? "encouragement";
        return StatusCode(StatusCodes.Status201Created, new
        {
            success = true,
            data = new
            {
                id = Math.Abs(HashCode.Combine(goal.Id, userId.Value, type, DateTime.UtcNow.Date)),
                goal_id = goal.Id,
                user_id = userId.Value,
                type,
                message = "Buddy nudge recorded.",
                created_at = DateTime.UtcNow
            }
        });
    }

    [Authorize]
    [HttpPost("/api/matches/{sourceType}/{sourceId:int}/dismiss")]
    [HttpPost("/api/v2/matches/{sourceType}/{sourceId:int}/dismiss")]
    public async Task<IActionResult> DismissTypedMatch(string sourceType, int sourceId, [FromBody] JsonElement body)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { success = false, error = "Invalid token" });
        if (sourceId <= 0) return BadRequest(new { success = false, code = "VALIDATION_ERROR", field = "sourceId", error = "Invalid source id." });

        if (sourceType != "listing" && sourceType != "group")
        {
            return BadRequest(new { success = false, code = "VALIDATION_ERROR", field = "sourceType", error = "Invalid source type." });
        }

        var tenantId = _tenant.GetTenantIdOrThrow();
        if (sourceType == "listing")
        {
            var matches = await _db.Set<MatchResult>()
                .IgnoreQueryFilters()
                .Where(m => m.TenantId == tenantId && m.UserId == userId.Value && m.MatchedListingId == sourceId)
                .ToListAsync();
            foreach (var match in matches)
            {
                match.Status = MatchStatus.Declined;
                match.RespondedAt = DateTime.UtcNow;
                match.UpdatedAt = DateTime.UtcNow;
            }

            if (matches.Count > 0) await _db.SaveChangesAsync();
        }

        return Data(new
        {
            dismissed = true,
            source_type = sourceType,
            source_id = sourceId,
            reason = ReadString(body, "reason") ?? "not_interested"
        });
    }

    [Authorize]
    [HttpPost("/api/messages/{id:int}/request-coordinator")]
    [HttpPost("/api/v2/messages/{id:int}/request-coordinator")]
    [EnableRateLimiting(RateLimitingExtensions.MessagesRequestCoordinatorPolicy)]
    public async Task<IActionResult> RequestCoordinator(int id, CancellationToken cancellationToken)
    {
        var userId = User.GetUserId();
        if (userId == null) return Unauthorized(new { success = false, error = "Invalid token" });
        var tenantId = _tenant.GetTenantIdOrThrow();
        var result = await _safeguardingCoordination.RequestAsync(
            tenantId,
            userId.Value,
            id,
            HttpContext.Connection.RemoteIpAddress?.ToString(),
            Request.Headers.UserAgent.ToString(),
            cancellationToken);
        if (!result.Succeeded)
        {
            return UnprocessableEntity(new
            {
                success = false,
                errors = new[] { new { code = result.Code, message = result.Message } }
            });
        }

        return Data(new { success = true, code = result.Code });
    }

    private async Task<Page?> LoadPublishedPageAsync(string pageKey)
    {
        if (!_tenant.IsResolved) return null;
        var tenantId = _tenant.GetTenantIdOrThrow();
        return await _db.Pages
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(p => p.TenantId == tenantId && p.IsPublished && p.Slug == pageKey)
            .OrderByDescending(p => p.UpdatedAt ?? p.CreatedAt)
            .FirstOrDefaultAsync();
    }

    private object? PublicPageDefinition(string pageKey)
    {
        var definitions = new Dictionary<string, (string RouteKey, string Path, string Title, string Lead)>(StringComparer.OrdinalIgnoreCase)
        {
            ["about"] = ("about", "/about", "About Project NEXUS", "A community timebank for trusted exchanges."),
            ["features"] = ("features", "/features", "Features", "Tools for members, coordinators, and community partners."),
            ["contact"] = ("contact", "/contact", "Contact", "Contact the Project NEXUS team."),
            ["trust-safety"] = ("trustSafety", "/trust-and-safety", "Trust and safety", "How Project NEXUS supports safe community exchange."),
            ["timebanking-guide"] = ("timebankingGuide", "/timebanking-guide", "Timebanking guide", "Learn how earning and spending time credits works."),
            ["legal"] = ("legal", "/legal", "Legal", "Policies and public legal documents.")
        };

        if (!definitions.TryGetValue(pageKey, out var definition)) return null;
        return new
        {
            route_key = definition.RouteKey,
            page_key = pageKey,
            path = definition.Path,
            content_source = "aspnet_public_fallback",
            translation_namespace = "govuk_alpha." + pageKey.Replace("-", "_"),
            tenant = TenantPayload(),
            title = definition.Title,
            lead = definition.Lead,
            sections = new[]
            {
                new
                {
                    key = "overview",
                    title = definition.Title,
                    body = definition.Lead,
                    items = Array.Empty<object>()
                }
            }
        };
    }

    private object? StaticRouteDefinition(string pageKey)
    {
        var definitions = new Dictionary<string, (string RouteKey, string Path, string Title, string Lead)>(StringComparer.OrdinalIgnoreCase)
        {
            ["developers"] = ("developers", "/developers", "Developers", "Build trusted integrations with Project NEXUS."),
            ["developers-auth"] = ("developersAuth", "/developers/auth", "Developer authentication", "Use OAuth credentials to access the API."),
            ["developers-endpoints"] = ("developersEndpoints", "/developers/endpoints", "API endpoints", "Explore core Project NEXUS API surfaces."),
            ["developers-webhooks"] = ("developersWebhooks", "/developers/webhooks", "Webhooks", "Receive event notifications from Project NEXUS."),
            ["regional-analytics"] = ("regionalAnalytics", "/regional-analytics", "Regional analytics", "Understand local demand, supply, and impact."),
            ["caring-community"] = ("caringCommunity", "/caring-community", "Caring Community", "Coordinate practical support through time credits."),
            ["partner"] = ("hourPartner", "/partner", "Partner with Project NEXUS", "Work with communities using timebank infrastructure."),
            ["social-prescribing"] = ("hourSocialPrescribing", "/social-prescribing", "Social prescribing", "Connect people to meaningful local support."),
            ["impact-summary"] = ("hourImpactSummary", "/impact-summary", "Impact summary", "A public summary of community outcomes."),
            ["impact-report"] = ("hourImpactReport", "/impact-report", "Impact report", "Evidence and reporting for Project NEXUS outcomes."),
            ["strategic-plan"] = ("hourStrategicPlan", "/strategic-plan", "Strategic plan", "The roadmap for sustainable community exchange."),
            ["platform-terms"] = ("platformTerms", "/platform/terms", "Platform terms", "Terms for using Project NEXUS."),
            ["platform-privacy"] = ("platformPrivacy", "/platform/privacy", "Platform privacy", "How Project NEXUS handles data."),
            ["platform-disclaimer"] = ("platformDisclaimer", "/platform/disclaimer", "Platform disclaimer", "Important public notices."),
            ["contact"] = ("contact", "/contact", "Contact", "Contact the Project NEXUS team.")
        };

        if (!definitions.TryGetValue(pageKey, out var definition)) return null;
        var items = new[] { new { id = "overview", key = "overview", title = definition.Title, description = definition.Lead } };
        return new
        {
            route_key = definition.RouteKey,
            page_key = pageKey,
            path = definition.Path,
            content_source = "aspnet_public_route_fallback",
            locale = "en",
            locale_file = "common.json",
            translation_namespace = "common." + pageKey.Replace("-", "_"),
            tenant = TenantPayload(),
            title = definition.Title,
            lead = definition.Lead,
            content = definition.Lead,
            sections = new[]
            {
                new
                {
                    key = "overview",
                    title = definition.Title,
                    body = definition.Lead,
                    items
                }
            },
            items
        };
    }

    private object TenantPayload()
    {
        if (_tenant.IsResolved)
        {
            var tenantId = _tenant.GetTenantIdOrThrow();
            return new { id = tenantId, slug = string.Empty, name = "Project NEXUS" };
        }

        return new { id = 0, slug = string.Empty, name = "Project NEXUS" };
    }

    private (string Status, string? Category) ProcessUnsubscribeToken(string? token)
    {
        if (string.IsNullOrWhiteSpace(token)) return ("invalid", null);

        var decoded = DecodeBase64Url(token);
        if (decoded == null) return ("invalid", null);

        var parts = decoded.Split('.');
        if (parts.Length != 4 ||
            !int.TryParse(parts[0], out var userId) ||
            !int.TryParse(parts[1], out var tenantId) ||
            userId <= 0 ||
            tenantId <= 0 ||
            string.IsNullOrWhiteSpace(parts[2]))
        {
            return ("invalid", null);
        }

        var category = parts[2];
        if (!AllowedUnsubscribeCategories.Contains(category)) return ("invalid", null);

        var secret = _config["App:Key"] ?? _config["Jwt:Secret"] ?? string.Empty;
        if (string.IsNullOrWhiteSpace(secret)) return ("invalid", null);

        var payload = $"{userId}.{tenantId}.{category}";
        var expected = HmacSha256(payload, secret);
        if (!CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(expected), Encoding.UTF8.GetBytes(parts[3])))
        {
            return ("invalid", null);
        }

        var user = _db.Users.IgnoreQueryFilters().FirstOrDefault(u => u.Id == userId && u.TenantId == tenantId);
        if (user == null) return ("invalid", null);

        user.NotificationPreferences = ApplyUnsubscribePreferences(user.NotificationPreferences, category);
        user.UpdatedAt = DateTime.UtcNow;
        _db.SaveChanges();
        return ("ok", category);
    }

    private string RenderUnsubscribeHtml(string status, string? category)
    {
        Response.StatusCode = status == "invalid" ? StatusCodes.Status400BadRequest : StatusCodes.Status200OK;
        var safeCategory = System.Net.WebUtility.HtmlEncode(category ?? "all");
        var title = status switch
        {
            "ok" => "You have been unsubscribed",
            "already" => "You were already unsubscribed",
            _ => "Unsubscribe link invalid"
        };
        var body = status switch
        {
            "ok" => $"You will no longer receive {safeCategory} emails from Project NEXUS.",
            "already" => $"Your {safeCategory} emails were already turned off for Project NEXUS.",
            _ => "This unsubscribe link is invalid or has expired."
        };

        return "<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"robots\" content=\"noindex,nofollow\"><title>"
            + title + "</title></head><body><main><h1>" + title + "</h1><p>" + body + "</p></main></body></html>";
    }

    private static readonly HashSet<string> AllowedUnsubscribeCategories = new(StringComparer.OrdinalIgnoreCase)
    {
        "all", "messages", "connections", "transactions", "reviews", "listings", "digest", "gamification", "org", "federation"
    };

    private static string ApplyUnsubscribePreferences(string? currentJson, string category)
    {
        var keys = category.ToLowerInvariant() switch
        {
            "messages" => new[] { "email_messages" },
            "connections" => new[] { "email_connections" },
            "transactions" => new[] { "email_transactions" },
            "reviews" => new[] { "email_reviews" },
            "listings" => new[] { "email_listings" },
            "digest" => new[] { "email_digest" },
            "gamification" => new[] { "email_gamification_digest", "email_gamification_milestones" },
            "org" => new[] { "email_org_payments", "email_org_transfers", "email_org_membership", "email_org_admin" },
            _ => new[]
            {
                "email_messages", "email_listings", "email_digest", "email_connections", "email_transactions",
                "email_reviews", "email_gamification_digest", "email_gamification_milestones", "email_org_payments",
                "email_org_transfers", "email_org_membership", "email_org_admin"
            }
        };

        Dictionary<string, object?> prefs;
        try
        {
            prefs = string.IsNullOrWhiteSpace(currentJson)
                ? new Dictionary<string, object?>()
                : JsonSerializer.Deserialize<Dictionary<string, object?>>(currentJson) ?? new Dictionary<string, object?>();
        }
        catch (JsonException)
        {
            prefs = new Dictionary<string, object?>();
        }

        foreach (var key in keys)
        {
            prefs[key] = false;
        }

        return JsonSerializer.Serialize(prefs);
    }

    private static string? DecodeBase64Url(string token)
    {
        try
        {
            var normalized = token.Replace('-', '+').Replace('_', '/');
            normalized = normalized.PadRight(normalized.Length + ((4 - normalized.Length % 4) % 4), '=');
            return Encoding.UTF8.GetString(Convert.FromBase64String(normalized));
        }
        catch (FormatException)
        {
            return null;
        }
    }

    private static string HmacSha256(string payload, string secret)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        return Convert.ToHexString(hmac.ComputeHash(Encoding.UTF8.GetBytes(payload))).ToLowerInvariant();
    }

    private static string? FirstMarkdownHeading(string markdown)
    {
        foreach (var line in markdown.Split('\n'))
        {
            var trimmed = line.Trim();
            if (trimmed.StartsWith("# ", StringComparison.Ordinal))
            {
                return trimmed[2..].Trim();
            }
        }

        return null;
    }

    private static object[] ChangelogItems(string markdown, int limit)
    {
        var items = new List<object>();
        string? currentId = null;
        string? currentTitle = null;
        string description = string.Empty;

        foreach (var rawLine in markdown.Split('\n'))
        {
            var line = rawLine.Trim();
            if (line.StartsWith("## ", StringComparison.Ordinal))
            {
                if (!string.IsNullOrWhiteSpace(currentTitle))
                {
                    items.Add(new { id = currentId, title = currentTitle, description });
                    if (items.Count >= limit) break;
                }

                currentTitle = line[3..].Trim().Trim('[', ']');
                currentId = NormalizePageKey(currentTitle);
                description = string.Empty;
                continue;
            }

            if (!string.IsNullOrWhiteSpace(currentTitle) && description == string.Empty && line.StartsWith("- ", StringComparison.Ordinal))
            {
                description = line[2..].Trim().Replace("**", string.Empty).Replace("`", string.Empty);
            }
        }

        if (items.Count < limit && !string.IsNullOrWhiteSpace(currentTitle))
        {
            items.Add(new { id = currentId, title = currentTitle, description });
        }

        return items.ToArray();
    }

    private static object MapVolunteerDonation(MoneyDonation donation) => new
    {
        id = donation.Id,
        user_id = donation.DonorUserId,
        opportunity_id = (int?)null,
        giving_day_id = (int?)null,
        amount = FormatMinorUnits(donation.AmountMinorUnits),
        currency = donation.Currency.ToUpperInvariant(),
        payment_method = "stripe",
        payment_reference = donation.StripePaymentIntentId ?? donation.StripeCheckoutSessionId,
        message = donation.Message,
        is_anonymous = donation.DonorUserId == null,
        status = ToVolunteerDonationStatus(donation.Status),
        donor_name = donation.DonorDisplayName,
        donor_email = donation.DonorEmail,
        created_at = donation.CreatedAt,
        completed_at = donation.CompletedAt
    };

    private static string ToVolunteerDonationStatus(MoneyDonationStatus status) => status switch
    {
        MoneyDonationStatus.Succeeded => "completed",
        MoneyDonationStatus.Refunded => "refunded",
        MoneyDonationStatus.Failed => "failed",
        MoneyDonationStatus.Cancelled => "failed",
        _ => "pending"
    };

    private static string FormatMinorUnits(long amount) =>
        (amount / 100m).ToString("0.00", CultureInfo.InvariantCulture);

    private static string NormalizePageKey(string value)
    {
        var builder = new StringBuilder();
        var previousDash = false;
        foreach (var ch in value.Trim().ToLowerInvariant())
        {
            if (char.IsLetterOrDigit(ch))
            {
                builder.Append(ch);
                previousDash = false;
            }
            else if (!previousDash)
            {
                builder.Append('-');
                previousDash = true;
            }
        }

        return builder.ToString().Trim('-');
    }

    private int ResolveTenantId(int? tenantId)
    {
        if (tenantId is > 0) return tenantId.Value;
        if (_tenant.IsResolved) return _tenant.GetTenantIdOrThrow();
        return User.GetTenantId() ?? 0;
    }

    private async Task<string?> GetTenantConfigAsync(int tenantId, string key)
    {
        return await _db.TenantConfigs
            .IgnoreQueryFilters()
            .Where(c => c.TenantId == tenantId && (c.Key == key || c.Key == "general." + key))
            .Select(c => c.Value)
            .FirstOrDefaultAsync();
    }

    private IActionResult Data(object data) => Ok(new { success = true, data });

    private static string? ReadString(JsonElement body, string property)
    {
        if (!TryGetProperty(body, property, out var value))
        {
            return null;
        }

        return value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    }

    private static int? ReadInt(JsonElement body, string property)
    {
        if (!TryGetProperty(body, property, out var value))
        {
            return null;
        }

        if (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var number))
        {
            return number;
        }

        if (value.ValueKind == JsonValueKind.String && int.TryParse(value.GetString(), out var parsed))
        {
            return parsed;
        }

        return null;
    }

    private static bool TryGetProperty(JsonElement body, string property, out JsonElement value)
    {
        if (body.ValueKind == JsonValueKind.Object)
        {
            if (body.TryGetProperty(property, out value))
            {
                return true;
            }

            foreach (var candidate in body.EnumerateObject())
            {
                if (string.Equals(candidate.Name, property, StringComparison.OrdinalIgnoreCase))
                {
                    value = candidate.Value;
                    return true;
                }
            }
        }

        value = default;
        return false;
    }
}
