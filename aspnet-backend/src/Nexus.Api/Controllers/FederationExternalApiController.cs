// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Entities;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Federation External API v1 - endpoints callable by partner timebanks/servers.
/// Authenticated via API Key (X-Federation-Key) or Federation JWT.
/// All endpoints are prefixed with /api/v1/federation.
/// </summary>
[ApiController]
[Route("api/v1/federation")]
public class FederationExternalApiController : ControllerBase
{
    // Financial federation remains hard-disabled until a durable correlated
    // debit/credit saga, bilateral agreement and replay-safe settlement path
    // exist. This is deliberately not configuration-controlled.
    private static readonly bool DurableFederationTransactionSagaAvailable = false;
    private readonly NexusDbContext _db;
    private readonly FederationService _federationService;
    private readonly FederationJwtService _jwtService;
    private readonly FederationApiKeyService _apiKeyService;
    private readonly PersonalWalletLedgerService _personalWallet;
    private readonly ILogger<FederationExternalApiController> _logger;

    public FederationExternalApiController(
        NexusDbContext db,
        FederationService federationService,
        FederationJwtService jwtService,
        FederationApiKeyService apiKeyService,
        PersonalWalletLedgerService personalWallet,
        ILogger<FederationExternalApiController> logger)
    {
        _db = db;
        _federationService = federationService;
        _jwtService = jwtService;
        _apiKeyService = apiKeyService;
        _personalWallet = personalWallet;
        _logger = logger;
    }

    private int? GetFederationTenantId() =>
        HttpContext.Items.TryGetValue("FederationTenantId", out var id) ? (int?)id : null;

    private string GetFederationScopes() =>
        HttpContext.Items.TryGetValue("FederationScopes", out var scopes) ? scopes?.ToString() ?? "" : "";

    private bool HasScope(string scope)
    {
        var scopes = GetFederationScopes().Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        return scopes.Contains(scope, StringComparer.OrdinalIgnoreCase) || scopes.Contains("*");
    }

    /// <summary>
    /// GET /api/v1/federation - API info and endpoint directory (public, no auth required).
    /// </summary>
    [HttpGet]
    public IActionResult GetApiInfo()
    {
        return Ok(new
        {
            name = "Project NEXUS Federation API",
            version = "1.0",
            protocol = "nexus-federation-v1",
            endpoints = new[]
            {
                new { method = "GET", path = "/api/v1/federation", description = "API info (this endpoint)", auth = false },
                new { method = "GET", path = "/api/v1/federation/health", description = "Federation health check", auth = false },
                new { method = "POST", path = "/api/v1/federation/token", description = "Request federation JWT", auth = true },
                new { method = "POST", path = "/api/v1/federation/oauth/token", description = "V1.5-compatible federation token endpoint", auth = true },
                new { method = "GET", path = "/api/v1/federation/timebanks", description = "List partner timebanks", auth = true },
                new { method = "GET", path = "/api/v1/federation/listings", description = "Search shared listings", auth = true },
                new { method = "GET", path = "/api/v1/federation/listings/{id}", description = "Get listing details", auth = true },
                new { method = "GET", path = "/api/v1/federation/members", description = "Search shared members", auth = true },
                new { method = "GET", path = "/api/v1/federation/members/{id}", description = "Get member profile", auth = true },
                new { method = "GET", path = "/api/v1/federation/messages", description = "List federated messages", auth = true },
                new { method = "POST", path = "/api/v1/federation/messages", description = "Send federated message", auth = true },
                new { method = "GET", path = "/api/v1/federation/reviews", description = "List federated reviews", auth = true },
                new { method = "POST", path = "/api/v1/federation/reviews", description = "Create federated review", auth = true },
                new { method = "GET", path = "/api/v1/federation/transactions/{id}", description = "Get federated transaction", auth = true },
                new { method = "POST", path = "/api/v1/federation/transactions", description = "Create federated transaction", auth = true },
                new { method = "POST", path = "/api/v1/federation/exchanges", description = "Initiate exchange", auth = true },
                new { method = "GET", path = "/api/v1/federation/exchanges/{id}", description = "Get exchange status", auth = true },
                new { method = "POST", path = "/api/v1/federation/webhooks/test", description = "Test webhook", auth = true }
            }
        });
    }

    /// <summary>
    /// GET /api/v1/federation/health - V1.5-compatible public federation health endpoint.
    /// </summary>
    [HttpGet("health")]
    public IActionResult Health()
    {
        return Ok(new
        {
            status = "ok",
            service = "Project NEXUS Federation API",
            version = "1.0",
            protocol = "nexus-federation-v1",
            timestamp = DateTime.UtcNow
        });
    }

    /// <summary>
    /// POST /api/v1/federation/token - Request a federation JWT using API key authentication.
    /// The JWT can then be used for subsequent requests to specific tenants.
    /// </summary>
    [HttpPost("token")]
    public async Task<IActionResult> RequestToken([FromBody] FederationTokenRequest request)
    {
        var tenantId = GetFederationTenantId();
        if (tenantId == null)
            return Unauthorized(new { error = "API key authentication required" });

        // Verify the target tenant exists and has a partnership
        var targetTenant = await _db.Tenants
            .AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == request.TargetTenantId && t.IsActive);

        if (targetTenant == null)
            return BadRequest(new { error = "Target tenant not found or not active" });

        var sourceTenant = await _db.Tenants
            .AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == tenantId.Value);

        if (sourceTenant == null)
            return BadRequest(new { error = "Source tenant not found" });

        // Check partnership exists
        var partnership = await _db.Set<FederationPartner>()
            .IgnoreQueryFilters()
            .AnyAsync(fp =>
                fp.Status == PartnerStatus.Active &&
                ((fp.TenantId == tenantId.Value && fp.PartnerTenantId == request.TargetTenantId) ||
                 (fp.TenantId == request.TargetTenantId && fp.PartnerTenantId == tenantId.Value)));

        if (!partnership)
            return BadRequest(new { error = "No active partnership with target tenant" });

        // Filter requested scopes to what the API key allows
        var allowedScopes = request.Scopes?.Where(s => HasScope(s)).ToArray()
            ?? new[] { "listings" };

        if (allowedScopes.Length == 0)
            return Forbid();

        var token = _jwtService.GenerateToken(
            tenantId.Value, sourceTenant.Slug,
            request.TargetTenantId, allowedScopes);

        return Ok(new
        {
            access_token = token,
            token_type = "Bearer",
            expires_in = 300, // 5 minutes
            scopes = allowedScopes
        });
    }

    /// <summary>
    /// POST /api/v1/federation/oauth/token - V1.5 alias for token issuance.
    /// Accepts target_tenant_id/scope(s); returns no-store OAuth-style response.
    /// </summary>
    [HttpPost("oauth/token")]
    public async Task<IActionResult> RequestOAuthToken([FromBody] FederationTokenRequest request)
    {
        var result = await RequestToken(request);
        Response.Headers.CacheControl = "no-store";
        Response.Headers.Pragma = "no-cache";
        return result;
    }

    /// <summary>
    /// GET /api/v1/federation/timebanks - List partner timebanks visible to the caller.
    /// </summary>
    [HttpGet("timebanks")]
    public async Task<IActionResult> ListTimebanks()
    {
        var tenantId = GetFederationTenantId();
        if (tenantId == null)
            return Unauthorized(new { error = "Authentication required" });

        var partners = await _db.Set<FederationPartner>()
            .IgnoreQueryFilters()
            .Where(fp => fp.Status == PartnerStatus.Active &&
                (fp.TenantId == tenantId.Value || fp.PartnerTenantId == tenantId.Value))
            .Include(fp => fp.Tenant)
            .Include(fp => fp.PartnerTenant)
            .AsNoTracking()
            .ToListAsync();

        var timebanks = partners.Select(p =>
        {
            var partnerTenant = p.TenantId == tenantId.Value ? p.PartnerTenant : p.Tenant;
            return new
            {
                id = partnerTenant?.Id,
                name = partnerTenant?.Name,
                slug = partnerTenant?.Slug,
                shared_listings = p.SharedListings,
                shared_events = p.SharedEvents,
                shared_members = p.SharedMembers,
                credit_exchange_rate = p.CreditExchangeRate,
                partnership_since = p.ApprovedAt
            };
        }).DistinctBy(t => t.id);

        return Ok(new { data = timebanks });
    }

    /// <summary>
    /// GET /api/v1/federation/listings - Search shared listings from the target tenant.
    /// </summary>
    [HttpGet("listings")]
    public async Task<IActionResult> SearchListings(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        [FromQuery] string? search = null,
        [FromQuery] string? type = null)
    {
        var tenantId = GetFederationTenantId();
        if (tenantId == null)
            return Unauthorized(new { error = "Authentication required" });

        if (!HasScope("listings"))
            return Forbid();

        page = Math.Max(1, page);
        limit = Math.Clamp(limit, 1, 100);

        // Find all active partnerships where this tenant can see listings
        var partnerTenantIds = await _db.Set<FederationPartner>()
            .IgnoreQueryFilters()
            .Where(fp => fp.Status == PartnerStatus.Active && fp.SharedListings &&
                (fp.TenantId == tenantId.Value || fp.PartnerTenantId == tenantId.Value))
            .Select(fp => fp.TenantId == tenantId.Value ? fp.PartnerTenantId : fp.TenantId)
            .Distinct()
            .ToArrayAsync();

        if (partnerTenantIds.Length == 0)
            return Ok(new { data = Array.Empty<object>(), pagination = new { page, limit, total = 0, pages = 0 } });

        var eligibleOwners = EligibleFederatedUsers(
            partnerTenantIds,
            tenantId.Value,
            requireProfileVisibility: true,
            requireListingsVisibility: true);
        var query = _db.Listings
            .IgnoreQueryFilters()
            .Where(l => partnerTenantIds.Contains(l.TenantId)
                && l.Status == ListingStatus.Active
                && eligibleOwners.Any(owner => owner.Id == l.UserId && owner.TenantId == l.TenantId))
            .Include(l => l.User)
            .AsNoTracking();

        if (!string.IsNullOrWhiteSpace(search))
        {
            var escapedSearch = EscapeLikePattern(search);
            query = query.Where(l => EF.Functions.ILike(l.Title, $"%{escapedSearch}%") ||
                                     (l.Description != null && EF.Functions.ILike(l.Description, $"%{escapedSearch}%")));
        }

        if (!string.IsNullOrWhiteSpace(type))
        {
            if (Enum.TryParse<ListingType>(type, true, out var listingType))
                query = query.Where(l => l.Type == listingType);
        }

        var total = await query.CountAsync();
        var listings = await query
            .OrderByDescending(l => l.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        var data = listings.Select(l => new
        {
            id = l.Id,
            tenant_id = l.TenantId,
            title = l.Title,
            description = l.Description,
            type = l.Type.ToString().ToLowerInvariant(),
            owner = l.User != null ? new
            {
                display_name = $"{l.User.FirstName} {l.User.LastName}"
            } : null,
            created_at = l.CreatedAt
        });

        return Ok(new
        {
            data,
            pagination = new { page, limit, total, pages = (int)Math.Ceiling((double)total / limit) }
        });
    }

    /// <summary>
    /// GET /api/v1/federation/listings/{id} - Get a specific listing by ID.
    /// </summary>
    [HttpGet("listings/{id:int}")]
    public async Task<IActionResult> GetListing(int id)
    {
        var tenantId = GetFederationTenantId();
        if (tenantId == null)
            return Unauthorized(new { error = "Authentication required" });

        if (!HasScope("listings"))
            return Forbid();

        // Find partner tenant IDs
        var partnerTenantIds = await _db.Set<FederationPartner>()
            .IgnoreQueryFilters()
            .Where(fp => fp.Status == PartnerStatus.Active && fp.SharedListings &&
                (fp.TenantId == tenantId.Value || fp.PartnerTenantId == tenantId.Value))
            .Select(fp => fp.TenantId == tenantId.Value ? fp.PartnerTenantId : fp.TenantId)
            .Distinct()
            .ToArrayAsync();

        var eligibleOwners = EligibleFederatedUsers(
            partnerTenantIds,
            tenantId.Value,
            requireProfileVisibility: true,
            requireListingsVisibility: true);

        var listing = await _db.Listings
            .IgnoreQueryFilters()
            .Include(l => l.User)
            .Include(l => l.Category)
            .AsNoTracking()
            .FirstOrDefaultAsync(l => l.Id == id
                && partnerTenantIds.Contains(l.TenantId)
                && l.Status == ListingStatus.Active
                && eligibleOwners.Any(owner => owner.Id == l.UserId && owner.TenantId == l.TenantId));

        if (listing == null)
            return NotFound(new { error = "Listing not found or not accessible" });

        return Ok(new
        {
            id = listing.Id,
            tenant_id = listing.TenantId,
            title = listing.Title,
            description = listing.Description,
            type = listing.Type.ToString().ToLowerInvariant(),
            category = listing.Category?.Name,
            estimated_hours = listing.EstimatedHours,
            owner = listing.User != null ? new
            {
                display_name = $"{listing.User.FirstName} {listing.User.LastName}",
                id = listing.User.Id
            } : null,
            created_at = listing.CreatedAt
        });
    }

    /// <summary>
    /// GET /api/v1/federation/members - Search shared members from partner tenants.
    /// </summary>
    [HttpGet("members")]
    public async Task<IActionResult> SearchMembers(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20,
        [FromQuery] string? search = null)
    {
        var tenantId = GetFederationTenantId();
        if (tenantId == null)
            return Unauthorized(new { error = "Authentication required" });

        if (!HasScope("members"))
            return Forbid();

        page = Math.Max(1, page);
        limit = Math.Clamp(limit, 1, 50);

        // Find partner tenants with member sharing
        var partnerTenantIds = await _db.Set<FederationPartner>()
            .IgnoreQueryFilters()
            .Where(fp => fp.Status == PartnerStatus.Active && fp.SharedMembers &&
                (fp.TenantId == tenantId.Value || fp.PartnerTenantId == tenantId.Value))
            .Select(fp => fp.TenantId == tenantId.Value ? fp.PartnerTenantId : fp.TenantId)
            .Distinct()
            .ToArrayAsync();

        if (partnerTenantIds.Length == 0)
            return Ok(new { data = Array.Empty<object>(), pagination = new { page, limit, total = 0, pages = 0 } });

        var query = EligibleFederatedUsers(
            partnerTenantIds,
            tenantId.Value,
            requireProfileVisibility: true,
            requireListingsVisibility: false);

        if (!string.IsNullOrWhiteSpace(search))
        {
            var escapedSearch = EscapeLikePattern(search);
            query = query.Where(u => EF.Functions.ILike(u.FirstName, $"%{escapedSearch}%") ||
                                     EF.Functions.ILike(u.LastName, $"%{escapedSearch}%"));
        }

        var total = await query.CountAsync();
        var members = await query
            .OrderBy(u => u.LastName).ThenBy(u => u.FirstName)
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();

        var data = members.Select(u => new
        {
            id = u.Id,
            tenant_id = u.TenantId,
            display_name = $"{u.FirstName} {u.LastName}",
            name = $"{u.FirstName} {u.LastName}",
            bio = u.Bio,
            avatar = u.AvatarUrl,
            created_at = u.CreatedAt
        });

        return Ok(new
        {
            data,
            pagination = new { page, limit, total, pages = (int)Math.Ceiling((double)total / limit) }
        });
    }

    /// <summary>
    /// GET /api/v1/federation/members/{id} - Get a specific member profile.
    /// </summary>
    [HttpGet("members/{id:int}")]
    public async Task<IActionResult> GetMember(int id)
    {
        var tenantId = GetFederationTenantId();
        if (tenantId == null)
            return Unauthorized(new { error = "Authentication required" });

        if (!HasScope("members"))
            return Forbid();

        var partnerTenantIds = await _db.Set<FederationPartner>()
            .IgnoreQueryFilters()
            .Where(fp => fp.Status == PartnerStatus.Active && fp.SharedMembers &&
                (fp.TenantId == tenantId.Value || fp.PartnerTenantId == tenantId.Value))
            .Select(fp => fp.TenantId == tenantId.Value ? fp.PartnerTenantId : fp.TenantId)
            .Distinct()
            .ToArrayAsync();

        var user = await EligibleFederatedUsers(
                partnerTenantIds,
                tenantId.Value,
                requireProfileVisibility: true,
                requireListingsVisibility: false)
            .FirstOrDefaultAsync(u => u.Id == id);

        if (user == null)
            return NotFound(new { error = "Member not found or not accessible" });

        return Ok(new
        {
            id = user.Id,
            tenant_id = user.TenantId,
            display_name = $"{user.FirstName} {user.LastName}",
            name = $"{user.FirstName} {user.LastName}",
            bio = user.Bio,
            avatar = user.AvatarUrl,
            created_at = user.CreatedAt
        });
    }

    /// <summary>
    /// GET /api/v1/federation/messages - V1.5-compatible federated message feed.
    /// </summary>
    [HttpGet("messages")]
    public async Task<IActionResult> GetMessages(
        [FromQuery] DateTime? since = null,
        [FromQuery] string direction = "all",
        [FromQuery(Name = "per_page")] int perPage = 20,
        [FromQuery] int page = 1)
    {
        var tenantId = GetFederationTenantId();
        if (tenantId == null)
            return Unauthorized(new { error = "Authentication required" });

        if (!HasScope("messages:read") && !HasScope("messages"))
            return Forbid();

        page = Math.Max(1, page);
        perPage = Math.Clamp(perPage, 1, 100);

        var query = _db.Messages
            .IgnoreQueryFilters()
            .Include(m => m.Sender)
            .ThenInclude(u => u!.Tenant)
            .Include(m => m.Conversation)
            .AsNoTracking()
            .Where(m => m.Sender != null && m.Conversation != null);

        query = direction.ToLowerInvariant() switch
        {
            "outbound" => query.Where(m => m.Sender!.TenantId == tenantId.Value),
            "inbound" => query.Where(m => m.Conversation!.Participant1Id != m.SenderId || m.Conversation.Participant2Id != m.SenderId)
                .Where(m => m.TenantId == tenantId.Value),
            _ => query.Where(m => m.TenantId == tenantId.Value || m.Sender!.TenantId == tenantId.Value)
        };

        if (since.HasValue)
            query = query.Where(m => m.CreatedAt >= since.Value);

        var total = await query.CountAsync();
        var messages = await query
            .OrderByDescending(m => m.CreatedAt)
            .Skip((page - 1) * perPage)
            .Take(perPage)
            .ToListAsync();

        var data = messages.Select(m => new
        {
            id = m.Id,
            subject = (string?)null,
            body = m.Content,
            sender = new
            {
                id = m.SenderId,
                name = m.Sender == null ? "Federation member" : $"{m.Sender.FirstName} {m.Sender.LastName}",
                tenant_id = m.Sender?.TenantId,
                tenant_name = m.Sender?.Tenant?.Name
            },
            receiver = new
            {
                id = m.Conversation?.Participant1Id == m.SenderId ? m.Conversation.Participant2Id : m.Conversation?.Participant1Id,
                tenant_id = m.TenantId
            },
            is_read = m.IsRead,
            created_at = m.CreatedAt
        });

        return Ok(new { data, pagination = new { page, per_page = perPage, total, pages = (int)Math.Ceiling((double)total / perPage) } });
    }

    /// <summary>
    /// POST /api/v1/federation/messages - V1.5-compatible message creation.
    /// </summary>
    [HttpPost("messages")]
    public IActionResult SendMessage([FromBody] FederatedMessageRequest request)
    {
        var tenantId = GetFederationTenantId();
        if (tenantId == null)
            return Unauthorized(new { error = "Authentication required" });

        if (!HasScope("messages:write") && !HasScope("messages"))
            return Forbid();

        // Federation API keys identify a tenant, not a stable remote user. Until
        // bilateral identity provenance is implemented, accepting sender_id
        // would let a partner impersonate any local or remote member.
        return StatusCode(StatusCodes.Status503ServiceUnavailable, new
        {
            error = "Federated message writes are unavailable until remote user identity provenance is enabled.",
            code = "FEDERATION_IDENTITY_UNAVAILABLE"
        });
    }

    /// <summary>
    /// GET /api/v1/federation/reviews - V1.5-compatible federated review feed.
    /// </summary>
    [HttpGet("reviews")]
    public async Task<IActionResult> GetReviews(
        [FromQuery(Name = "user_id")] int userId,
        [FromQuery(Name = "per_page")] int perPage = 20,
        [FromQuery] int page = 1)
    {
        var tenantId = GetFederationTenantId();
        if (tenantId == null)
            return Unauthorized(new { error = "Authentication required" });

        if (!HasScope("reviews:read") && !HasScope("reviews"))
            return Forbid();

        if (userId <= 0)
            return BadRequest(new { error = "Missing required parameter: user_id" });

        page = Math.Max(1, page);
        perPage = Math.Clamp(perPage, 1, 100);

        var query = _db.Reviews.IgnoreQueryFilters()
            .Include(r => r.Reviewer)
            .ThenInclude(u => u.Tenant)
            .AsNoTracking()
            .Where(r => r.TargetUserId == userId &&
                (r.TenantId == tenantId.Value || r.Reviewer.TenantId == tenantId.Value));

        var total = await query.CountAsync();
        var reviews = await query
            .OrderByDescending(r => r.CreatedAt)
            .Skip((page - 1) * perPage)
            .Take(perPage)
            .ToListAsync();

        var data = reviews.Select(r => new
        {
            id = r.Id,
            rating = r.Rating,
            comment = r.Comment,
            review_type = "federated",
            transaction_id = (int?)null,
            reviewer = new
            {
                id = r.ReviewerId,
                name = $"{r.Reviewer.FirstName} {r.Reviewer.LastName}",
                avatar = r.Reviewer.AvatarUrl,
                tenant_name = r.Reviewer.Tenant?.Name
            },
            created_at = r.CreatedAt
        });

        return Ok(new { data, pagination = new { page, per_page = perPage, total, pages = (int)Math.Ceiling((double)total / perPage) } });
    }

    /// <summary>
    /// POST /api/v1/federation/reviews - V1.5-compatible review creation.
    /// </summary>
    [HttpPost("reviews")]
    public IActionResult CreateReview([FromBody] FederatedReviewRequest request)
    {
        var tenantId = GetFederationTenantId();
        if (tenantId == null)
            return Unauthorized(new { error = "Authentication required" });

        if (!HasScope("reviews:write") && !HasScope("reviews"))
            return Forbid();

        // As with messages, reviewer_id is caller-controlled while the key only
        // authenticates a tenant. Fail closed rather than fabricating a review
        // whose human author cannot be proven.
        return StatusCode(StatusCodes.Status503ServiceUnavailable, new
        {
            error = "Federated review writes are unavailable until remote user identity provenance is enabled.",
            code = "FEDERATION_IDENTITY_UNAVAILABLE"
        });
    }

    /// <summary>
    /// POST /api/v1/federation/transactions - federated credit transfer.
    /// Until API keys carry Laravel's platform identity, this endpoint accepts
    /// only the provable internal-caller shape (sender in the key's tenant).
    /// </summary>
    [HttpPost("transactions")]
    public async Task<IActionResult> CreateTransaction(
        [FromBody] FederatedTransactionRequest request,
        CancellationToken ct)
    {
        var tenantId = GetFederationTenantId();
        if (tenantId == null)
            return Unauthorized(new { error = "Authentication required" });

        if (!HasScope("transactions:write") && !HasScope("transactions"))
            return Forbid();

        if (!DurableFederationTransactionSagaAvailable)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable, new
            {
                error = "Federated financial writes are unavailable until durable settlement reconciliation is enabled.",
                code = "FEDERATION_SETTLEMENT_UNAVAILABLE"
            });
        }

        var description = request.Description?.Trim();
        if (request.SenderId <= 0 || request.RecipientId <= 0 || request.Amount <= 0 ||
            string.IsNullOrWhiteSpace(description))
            return BadRequest(new
            {
                error = "sender_id, recipient_id, amount and description are required",
                code = "VALIDATION_ERROR"
            });
        if (request.SenderId == request.RecipientId)
            return BadRequest(new { error = "Cannot send a transaction to yourself", code = "SELF_TRANSACTION" });
        if (request.Amount > 100 || decimal.Truncate(request.Amount) != request.Amount)
            return BadRequest(new { error = "Amount must be between 1 and 100 whole hours", code = "INVALID_AMOUNT" });

        var sender = await _db.Users.IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == request.SenderId
                && u.TenantId == tenantId.Value
                && u.IsActive
                && u.SuspendedAt == null, ct);
        var recipient = await _db.Users.IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(u => u.Id == request.RecipientId
                && u.IsActive
                && u.SuspendedAt == null, ct);
        if (sender == null)
        {
            // Laravel distinguishes internal tenant callers from external
            // platforms via federation_api_keys.platform_id. The .NET key model
            // cannot represent that distinction yet, so accept only the provable
            // internal class: a sender in the authenticated tenant. Remote-sender
            // shaped requests fail closed instead of minting unbacked credits.
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                error = "Sender not found in the authenticated tenant or is not active",
                code = "SENDER_NOT_ELIGIBLE"
            });
        }
        if (recipient == null)
            return NotFound(new { error = "Recipient not found or not accessible", code = "RECIPIENT_NOT_FOUND" });
        if (recipient.TenantId == tenantId.Value)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                error = "Federation transactions require a partner tenant recipient",
                code = "TRANSACTIONS_NOT_ALLOWED"
            });
        }

        var hasPartnership = await HasTransactionPartnershipAsync(tenantId.Value, recipient.TenantId, ct);
        if (!hasPartnership)
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                error = "Partnership does not allow transactions",
                code = "TRANSACTIONS_NOT_ALLOWED"
            });
        }
        if (!await HasActiveCreditAgreementAsync(tenantId.Value, recipient.TenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                error = "No active credit agreement between tenants",
                code = "NO_CREDIT_AGREEMENT"
            });
        }

        var optedInUserIds = await _db.FederationUserSettings
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(setting => setting.FederationOptIn
                && setting.TransactionsEnabled
                && (setting.UserId == sender.Id || setting.UserId == recipient.Id))
            .Select(setting => setting.UserId)
            .Distinct()
            .ToListAsync(ct);
        if (!optedInUserIds.Contains(sender.Id))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                error = "Sender has not opted into federation",
                code = "SENDER_NOT_ELIGIBLE"
            });
        }
        if (!optedInUserIds.Contains(recipient.Id))
        {
            return StatusCode(StatusCodes.Status403Forbidden, new
            {
                error = "Recipient does not accept federated transactions",
                code = "TRANSACTIONS_DISABLED"
            });
        }

        var now = DateTime.UtcNow;
        var senderId = sender.Id;
        var recipientId = recipient.Id;
        var recipientTenantId = recipient.TenantId;
        var hasExplicitIdempotencyKey = !string.IsNullOrWhiteSpace(request.IdempotencyKey);
        var rawIdempotencyKey = hasExplicitIdempotencyKey
            ? request.IdempotencyKey!.Trim()
            : FormattableString.Invariant(
                $"{tenantId.Value}|{senderId}|{recipientId}|{request.Amount}|{description}");
        var idempotencyDigest = Convert.ToHexString(
            SHA256.HashData(Encoding.UTF8.GetBytes(rawIdempotencyKey)))
            .ToLowerInvariant();
        var noncePlatform = $"tenant:{tenantId.Value}:transactions";
        var nonce = $"tx:{idempotencyDigest}";
        var nonceExpiry = now.AddSeconds(hasExplicitIdempotencyKey ? 86400 : 120);

        await using var databaseTransaction = await _db.Database.BeginTransactionAsync(
            System.Data.IsolationLevel.ReadCommitted,
            ct);
        try
        {
            await _personalWallet.AcquireSpendLocksAsync([senderId, recipientId], ct);

            // Rehydrate every financial precondition after acquiring the shared
            // wallet lock. This closes the validation-to-write window and keeps
            // concurrent federation/personal spends in one serialization domain.
            sender = await _db.Users.IgnoreQueryFilters()
                .AsNoTracking()
                .SingleOrDefaultAsync(user => user.Id == senderId
                    && user.TenantId == tenantId.Value
                    && user.IsActive
                    && user.SuspendedAt == null, ct);
            recipient = await _db.Users.IgnoreQueryFilters()
                .AsNoTracking()
                .SingleOrDefaultAsync(user => user.Id == recipientId
                    && user.TenantId == recipientTenantId
                    && user.IsActive
                    && user.SuspendedAt == null, ct);
            if (sender == null || recipient == null)
            {
                await databaseTransaction.RollbackAsync(ct);
                return StatusCode(StatusCodes.Status403Forbidden, new
                {
                    error = "Sender or recipient is no longer eligible",
                    code = "TRANSACTION_PARTICIPANT_INELIGIBLE"
                });
            }

            var currentOptInCount = await _db.FederationUserSettings
                .IgnoreQueryFilters()
                .AsNoTracking()
                .Where(setting => setting.FederationOptIn
                    && setting.TransactionsEnabled
                    && (setting.UserId == senderId || setting.UserId == recipientId))
                .Select(setting => setting.UserId)
                .Distinct()
                .CountAsync(ct);
            if (currentOptInCount < 2 ||
                !await HasTransactionPartnershipAsync(tenantId.Value, recipient.TenantId, ct) ||
                !await HasActiveCreditAgreementAsync(tenantId.Value, recipient.TenantId, ct))
            {
                await databaseTransaction.RollbackAsync(ct);
                return StatusCode(StatusCodes.Status403Forbidden, new
                {
                    error = "Federation consent or partnership is no longer active",
                    code = "TRANSACTIONS_NOT_ALLOWED"
                });
            }

            var balance = await _personalWallet.GetBalanceAsync(tenantId.Value, senderId, ct);
            if (balance < request.Amount)
            {
                await databaseTransaction.RollbackAsync(ct);
                return BadRequest(new { error = "Insufficient balance", code = "INSUFFICIENT_BALANCE" });
            }

            // The existing nonce table already provides an atomic unique
            // (principal, key) claim. Expired short-window content claims may be
            // reclaimed; explicit keys remain protected for 24 hours.
            await _db.FederationWebhookNonces
                .Where(existing => existing.PlatformId == noncePlatform
                    && existing.Nonce == nonce
                    && existing.ExpiresAt <= now)
                .ExecuteDeleteAsync(ct);
            var claimed = await _db.Database.ExecuteSqlInterpolatedAsync(
                $@"INSERT INTO federation_webhook_nonces
                   (""PlatformId"", ""Nonce"", ""ExpiresAt"", ""CreatedAt"")
                   VALUES ({noncePlatform}, {nonce}, {nonceExpiry}, {now})
                   ON CONFLICT (""PlatformId"", ""Nonce"") DO NOTHING",
                ct);
            if (claimed == 0)
            {
                await databaseTransaction.RollbackAsync(ct);
                return Conflict(new
                {
                    error = "Duplicate transaction (idempotency replay)",
                    code = "DUPLICATE_REQUEST"
                });
            }

            // A single cross-tenant row cannot affect both tenant-scoped ASP.NET
            // wallets: it is visible in only one TenantId partition. Keep the
            // canonical destination row for lookup/recipient history and pair it
            // atomically with a one-sided source-tenant debit.
            var sourceDebit = new Transaction
            {
                TenantId = tenantId.Value,
                SenderId = senderId,
                ReceiverId = null,
                Amount = request.Amount,
                Description = description,
                TransactionType = PersonalWalletLedgerService.TransferTransactionType,
                Status = TransactionStatus.Completed,
                CreatedAt = now
            };
            var destinationCredit = new Transaction
            {
                TenantId = recipient.TenantId,
                SenderId = senderId,
                ReceiverId = recipientId,
                Amount = request.Amount,
                Description = description,
                TransactionType = PersonalWalletLedgerService.TransferTransactionType,
                Status = TransactionStatus.Pending,
                CreatedAt = now
            };
            _db.Transactions.AddRange(sourceDebit, destinationCredit);
            await _db.SaveChangesAsync(ct);
            await databaseTransaction.CommitAsync(ct);

            return Created($"/api/v1/federation/transactions/{destinationCredit.Id}", new
            {
                success = true,
                timestamp = now,
                transaction_id = destinationCredit.Id,
                status = "pending",
                amount = destinationCredit.Amount,
                note = "Transaction created successfully"
            });
        }
        catch (Exception exception) when (exception is DbUpdateException or InvalidOperationException)
        {
            await databaseTransaction.RollbackAsync(CancellationToken.None);
            _logger.LogWarning(exception,
                "Federation transaction failed for tenant {TenantId}, sender {SenderId}, recipient {RecipientId}",
                tenantId.Value,
                request.SenderId,
                request.RecipientId);
            return StatusCode(StatusCodes.Status500InternalServerError, new
            {
                error = "Transaction creation failed",
                code = "TRANSACTION_ERROR"
            });
        }
    }

    /// <summary>
    /// GET /api/v1/federation/transactions/{id} - V1.5-compatible transaction lookup.
    /// </summary>
    [HttpGet("transactions/{id:int}")]
    public async Task<IActionResult> GetTransaction(int id)
    {
        var tenantId = GetFederationTenantId();
        if (tenantId == null)
            return Unauthorized(new { error = "Authentication required" });

        if (!HasScope("transactions:read") && !HasScope("transactions"))
            return Forbid();

        var transaction = await _db.Transactions.IgnoreQueryFilters()
            .Include(t => t.Sender)
            .ThenInclude(u => u!.Tenant)
            .Include(t => t.Receiver)
            .ThenInclude(u => u!.Tenant)
            .AsNoTracking()
            .FirstOrDefaultAsync(t => t.Id == id &&
                (t.TenantId == tenantId.Value || t.Sender!.TenantId == tenantId.Value || t.Receiver!.TenantId == tenantId.Value));

        if (transaction == null)
            return NotFound(new { error = "Transaction not found or not accessible" });

        return Ok(new
        {
            data = new
            {
                id = transaction.Id,
                amount = transaction.Amount,
                status = transaction.Status.ToString().ToLowerInvariant(),
                description = transaction.Description,
                sender = new
                {
                    id = transaction.SenderId,
                    name = transaction.Sender == null ? null : $"{transaction.Sender.FirstName} {transaction.Sender.LastName}",
                    tenant_id = transaction.Sender?.TenantId,
                    tenant_name = transaction.Sender?.Tenant?.Name
                },
                receiver = new
                {
                    id = transaction.ReceiverId,
                    name = transaction.Receiver == null ? null : $"{transaction.Receiver.FirstName} {transaction.Receiver.LastName}",
                    tenant_id = transaction.Receiver?.TenantId,
                    tenant_name = transaction.Receiver?.Tenant?.Name
                },
                created_at = transaction.CreatedAt
            }
        });
    }

    /// <summary>
    /// POST /api/v1/federation/exchanges - Initiate a cross-tenant exchange via the external API.
    /// </summary>
    [HttpPost("exchanges")]
    public async Task<IActionResult> InitiateExchange([FromBody] ExternalExchangeRequest request)
    {
        var tenantId = GetFederationTenantId();
        if (tenantId == null)
            return Unauthorized(new { error = "Authentication required" });

        if (!HasScope("exchanges"))
            return Forbid();

        if (request.AgreedHours <= 0)
            return BadRequest(new { error = "Agreed hours must be greater than zero" });

        // Verify the listing belongs to a partner tenant
        var listing = await _db.Listings
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(l => l.Id == request.ListingId && l.Status == ListingStatus.Active);

        if (listing == null)
            return NotFound(new { error = "Listing not found" });

        // Check partnership
        var partnership = await _db.Set<FederationPartner>()
            .IgnoreQueryFilters()
            .FirstOrDefaultAsync(fp => fp.Status == PartnerStatus.Active &&
                ((fp.TenantId == tenantId.Value && fp.PartnerTenantId == listing.TenantId) ||
                 (fp.TenantId == listing.TenantId && fp.PartnerTenantId == tenantId.Value)));

        if (partnership == null)
            return BadRequest(new { error = "No active partnership with listing's tenant" });

        // Create the federated exchange record
        var exchange = new FederatedExchange
        {
            TenantId = listing.TenantId,
            PartnerTenantId = tenantId.Value,
            LocalUserId = listing.UserId,
            RemoteUserDisplayName = request.RequesterDisplayName ?? "Federation User",
            RemoteUserId = request.RequesterUserId,
            SourceListingId = listing.Id,
            Status = ExchangeStatus.Requested,
            AgreedHours = request.AgreedHours,
            CreditExchangeRate = partnership.CreditExchangeRate,
            Notes = request.Notes,
            CreatedAt = DateTime.UtcNow
        };

        _db.Set<FederatedExchange>().Add(exchange);

        _db.Set<FederationAuditLog>().Add(new FederationAuditLog
        {
            TenantId = listing.TenantId,
            PartnerTenantId = tenantId.Value,
            Action = "exchange.initiated.external",
            EntityType = "FederatedExchange",
            Details = System.Text.Json.JsonSerializer.Serialize(new
            {
                listing_id = listing.Id,
                requester = request.RequesterDisplayName,
                agreed_hours = request.AgreedHours
            }),
            CreatedAt = DateTime.UtcNow
        });

        await _db.SaveChangesAsync();

        return CreatedAtAction(nameof(GetExchange), new { id = exchange.Id }, new
        {
            id = exchange.Id,
            status = exchange.Status.ToString().ToLowerInvariant(),
            listing_id = listing.Id,
            agreed_hours = exchange.AgreedHours,
            credit_exchange_rate = exchange.CreditExchangeRate,
            created_at = exchange.CreatedAt
        });
    }

    /// <summary>
    /// GET /api/v1/federation/exchanges/{id} - Get exchange status.
    /// </summary>
    [HttpGet("exchanges/{id:int}")]
    public async Task<IActionResult> GetExchange(int id)
    {
        var tenantId = GetFederationTenantId();
        if (tenantId == null)
            return Unauthorized(new { error = "Authentication required" });

        if (!HasScope("exchanges"))
            return Forbid();

        var exchange = await _db.Set<FederatedExchange>()
            .IgnoreQueryFilters()
            .AsNoTracking()
            .FirstOrDefaultAsync(e => e.Id == id &&
                (e.TenantId == tenantId.Value || e.PartnerTenantId == tenantId.Value));

        if (exchange == null)
            return NotFound(new { error = "Exchange not found" });

        return Ok(new
        {
            id = exchange.Id,
            tenant_id = exchange.TenantId,
            partner_tenant_id = exchange.PartnerTenantId,
            status = exchange.Status.ToString().ToLowerInvariant(),
            source_listing_id = exchange.SourceListingId,
            agreed_hours = exchange.AgreedHours,
            actual_hours = exchange.ActualHours,
            credit_exchange_rate = exchange.CreditExchangeRate,
            completed_at = exchange.CompletedAt,
            created_at = exchange.CreatedAt
        });
    }

    /// <summary>
    /// POST /api/v1/federation/webhooks/test - Test webhook connectivity.
    /// </summary>
    [HttpPost("webhooks/test")]
    public IActionResult TestWebhook()
    {
        var tenantId = GetFederationTenantId();
        if (tenantId == null)
            return Unauthorized(new { error = "Authentication required" });

        return Ok(new
        {
            success = true,
            message = "Webhook test successful",
            tenant_id = tenantId.Value,
            timestamp = DateTime.UtcNow
        });
    }

    /// <summary>
    /// Escapes LIKE/ILIKE wildcard characters in user input to prevent wildcard injection.
    /// </summary>
    private static string EscapeLikePattern(string input)
    {
        return input
            .Replace("\\", "\\\\")
            .Replace("%", "\\%")
            .Replace("_", "\\_");
    }

    /// <summary>
    /// Applies the user-owned federation privacy boundary to partner reads.
    /// The composite join is intentional: a consent row from one tenant must
    /// never authorize a user record belonging to another tenant.
    /// </summary>
    private IQueryable<User> EligibleFederatedUsers(
        int[] partnerTenantIds,
        int requestingTenantId,
        bool requireProfileVisibility,
        bool requireListingsVisibility)
    {
        var blockedTenantToken = $",{requestingTenantId},";

        var query =
            from user in _db.Users.IgnoreQueryFilters()
            join setting in _db.FederationUserSettings.IgnoreQueryFilters()
                on new { user.TenantId, UserId = user.Id }
                equals new { setting.TenantId, setting.UserId }
            where partnerTenantIds.Contains(user.TenantId)
                && user.IsActive
                && user.SuspendedAt == null
                && setting.FederationOptIn
                && (!requireProfileVisibility || setting.ProfileVisible)
                && (!requireListingsVisibility || setting.ListingsVisible)
                && (setting.BlockedPartnerTenants == null
                    || !("," + setting.BlockedPartnerTenants.Replace(" ", string.Empty) + ",")
                        .Contains(blockedTenantToken))
            select user;

        return query.AsNoTracking();
    }

    private async Task<bool> HasActivePartnershipAsync(int tenantId, int partnerTenantId)
    {
        return await _db.Set<FederationPartner>()
            .IgnoreQueryFilters()
            .AnyAsync(fp => fp.Status == PartnerStatus.Active &&
                ((fp.TenantId == tenantId && fp.PartnerTenantId == partnerTenantId) ||
                 (fp.TenantId == partnerTenantId && fp.PartnerTenantId == tenantId)));
    }

    private async Task<bool> HasTransactionPartnershipAsync(
        int tenantId,
        int partnerTenantId,
        CancellationToken ct)
    {
        return await _db.Set<FederationPartner>()
            .IgnoreQueryFilters()
            .AnyAsync(partnership => partnership.Status == PartnerStatus.Active
                && partnership.TransactionsEnabled
                && ((partnership.TenantId == tenantId && partnership.PartnerTenantId == partnerTenantId)
                    || (partnership.TenantId == partnerTenantId && partnership.PartnerTenantId == tenantId)), ct);
    }

    private async Task<bool> HasActiveCreditAgreementAsync(
        int tenantId,
        int partnerTenantId,
        CancellationToken ct)
    {
        const string key = "admin_explicit.federation.credit_agreements";
        var documents = await _db.TenantConfigs
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Where(config => config.Key == key
                && (config.TenantId == tenantId || config.TenantId == partnerTenantId))
            .Select(config => config.Value)
            .ToListAsync(ct);

        foreach (var raw in documents)
        {
            try
            {
                using var document = JsonDocument.Parse(raw);
                if (document.RootElement.ValueKind != JsonValueKind.Array)
                    continue;

                foreach (var agreement in document.RootElement.EnumerateArray())
                {
                    var fromTenantId = AgreementInt(agreement, "fromTenantId", "from_tenant_id");
                    var toTenantId = AgreementInt(agreement, "toTenantId", "to_tenant_id");
                    var status = AgreementString(agreement, "status");
                    if (string.Equals(status, "active", StringComparison.OrdinalIgnoreCase)
                        && ((fromTenantId == tenantId && toTenantId == partnerTenantId)
                            || (fromTenantId == partnerTenantId && toTenantId == tenantId)))
                    {
                        return true;
                    }
                }
            }
            catch (JsonException)
            {
                // Malformed financial permission state fails closed.
            }
        }

        return false;
    }

    private static int AgreementInt(JsonElement element, params string[] names)
    {
        foreach (var name in names)
        {
            if (element.TryGetProperty(name, out var value)
                && value.ValueKind == JsonValueKind.Number
                && value.TryGetInt32(out var parsed))
            {
                return parsed;
            }
        }
        return 0;
    }

    private static string? AgreementString(JsonElement element, string name) =>
        element.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}

#region External API Request DTOs

public class FederationTokenRequest
{
    [JsonPropertyName("target_tenant_id")]
    public int TargetTenantId { get; set; }

    [JsonPropertyName("scopes")]
    public string[]? Scopes { get; set; }
}

public class ExternalExchangeRequest
{
    [JsonPropertyName("listing_id")]
    public int ListingId { get; set; }

    [JsonPropertyName("agreed_hours")]
    public decimal AgreedHours { get; set; }

    [JsonPropertyName("requester_display_name")]
    public string? RequesterDisplayName { get; set; }

    [JsonPropertyName("requester_user_id")]
    public int? RequesterUserId { get; set; }

    [JsonPropertyName("notes")]
    public string? Notes { get; set; }
}

public class FederatedMessageRequest
{
    [JsonPropertyName("recipient_id")]
    public int RecipientId { get; set; }

    [JsonPropertyName("sender_id")]
    public int SenderId { get; set; }

    [JsonPropertyName("subject")]
    public string? Subject { get; set; }

    [JsonPropertyName("body")]
    public string Body { get; set; } = string.Empty;
}

public class FederatedReviewRequest
{
    [JsonPropertyName("reviewer_id")]
    public int ReviewerId { get; set; }

    [JsonPropertyName("reviewee_id")]
    public int RevieweeId { get; set; }

    [JsonPropertyName("rating")]
    public int Rating { get; set; }

    [JsonPropertyName("comment")]
    public string? Comment { get; set; }
}

public class FederatedTransactionRequest
{
    [JsonPropertyName("sender_id")]
    public int SenderId { get; set; }

    [JsonPropertyName("recipient_id")]
    public int RecipientId { get; set; }

    [JsonPropertyName("amount")]
    public decimal Amount { get; set; }

    [JsonPropertyName("description")]
    public string? Description { get; set; }

    [JsonPropertyName("idempotency_key")]
    public string? IdempotencyKey { get; set; }
}

#endregion
