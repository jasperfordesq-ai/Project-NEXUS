// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

/// <summary>
/// Federation controller - manages cross-tenant partnerships, listing sharing, and exchanges.
/// Admin endpoints for partnership management, API keys, feature toggles.
/// User endpoints for browsing, exchanges, and federation settings.
/// </summary>
[ApiController]
[Authorize]
public class FederationController : ControllerBase
{
    private readonly FederationService _federationService;
    private readonly FederationGatewayService _gatewayService;
    private readonly FederationApiKeyService _apiKeyService;
    private readonly TenantContext _tenantContext;
    private readonly ILogger<FederationController> _logger;

    public FederationController(
        FederationService federationService,
        FederationGatewayService gatewayService,
        FederationApiKeyService apiKeyService,
        TenantContext tenantContext,
        ILogger<FederationController> logger)
    {
        _federationService = federationService;
        _gatewayService = gatewayService;
        _apiKeyService = apiKeyService;
        _tenantContext = tenantContext;
        _logger = logger;
    }

    private int? GetCurrentUserId() => User.GetUserId();

    #region Admin Endpoints

    /// <summary>
    /// GET /api/admin/federation/partners - List all federation partners for the current tenant.
    /// </summary>
    [HttpGet("api/admin/federation/partners")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> ListPartners()
    {
        var tenantId = _tenantContext.TenantId;
        if (!tenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var partners = await _federationService.GetPartnersAsync(tenantId.Value);

        var data = partners.Select(p => new
        {
            id = p.Id,
            tenant_id = p.TenantId,
            partner_tenant = p.PartnerTenant != null ? new
            {
                id = p.PartnerTenant.Id,
                name = p.PartnerTenant.Name,
                slug = p.PartnerTenant.Slug
            } : null,
            status = p.Status.ToString().ToLowerInvariant(),
            shared_listings = p.SharedListings,
            shared_events = p.SharedEvents,
            shared_members = p.SharedMembers,
            transactions_enabled = p.TransactionsEnabled,
            credit_exchange_rate = p.CreditExchangeRate,
            requested_by = p.RequestedBy != null ? new
            {
                id = p.RequestedBy.Id,
                first_name = p.RequestedBy.FirstName,
                last_name = p.RequestedBy.LastName
            } : null,
            approved_by = p.ApprovedBy != null ? new
            {
                id = p.ApprovedBy.Id,
                first_name = p.ApprovedBy.FirstName,
                last_name = p.ApprovedBy.LastName
            } : null,
            approved_at = p.ApprovedAt,
            created_at = p.CreatedAt,
            updated_at = p.UpdatedAt
        });

        return Ok(new { data });
    }

    /// <summary>
    /// POST /api/admin/federation/partners - Request a new federation partnership.
    /// </summary>
    [HttpPost("api/admin/federation/partners")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> RequestPartnership([FromBody] RequestPartnershipRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.TenantId;
        if (!tenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var (partner, error) = await _federationService.RequestPartnershipAsync(
            tenantId.Value,
            request.PartnerTenantId,
            userId.Value,
            request.SharedListings,
            request.SharedEvents,
            request.SharedMembers,
            request.TransactionsEnabled);

        if (error != null)
            return BadRequest(new { error });

        return CreatedAtAction(nameof(ListPartners), null, new
        {
            id = partner!.Id,
            tenant_id = partner.TenantId,
            partner_tenant = partner.PartnerTenant != null ? new
            {
                id = partner.PartnerTenant.Id,
                name = partner.PartnerTenant.Name,
                slug = partner.PartnerTenant.Slug
            } : null,
            status = partner.Status.ToString().ToLowerInvariant(),
            shared_listings = partner.SharedListings,
            shared_events = partner.SharedEvents,
            shared_members = partner.SharedMembers,
            transactions_enabled = partner.TransactionsEnabled,
            credit_exchange_rate = partner.CreditExchangeRate,
            created_at = partner.CreatedAt
        });
    }

    /// <summary>
    /// PUT /api/admin/federation/partners/{id}/approve - Approve a pending partnership.
    /// </summary>
    [HttpPut("api/admin/federation/partners/{id:int}/approve")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> ApprovePartnership(int id)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.TenantId;
        if (!tenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var (partner, error) = await _federationService.ApprovePartnershipAsync(id, userId.Value);

        if (partner == null && error == "Partnership not found")
            return BadRequest(new { error });

        if (error != null)
            return BadRequest(new { error });

        return Ok(new
        {
            id = partner!.Id,
            status = partner.Status.ToString().ToLowerInvariant(),
            approved_by = userId.Value,
            approved_at = partner.ApprovedAt,
            message = "Partnership approved successfully"
        });
    }

    /// <summary>
    /// PUT /api/admin/federation/partners/{id}/suspend - Suspend an active partnership.
    /// </summary>
    [HttpPut("api/admin/federation/partners/{id:int}/suspend")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> SuspendPartnership(int id, [FromBody] SuspendPartnershipRequest? request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.TenantId;
        if (!tenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var (partner, error) = await _federationService.SuspendPartnershipAsync(id, userId.Value, request?.Reason);

        if (partner == null && error == "Partnership not found")
            return BadRequest(new { error });

        if (error != null)
            return BadRequest(new { error });

        return Ok(new
        {
            id = partner!.Id,
            status = partner.Status.ToString().ToLowerInvariant(),
            message = "Partnership suspended successfully"
        });
    }

    /// <summary>
    /// POST /api/admin/federation/partners/{id}/sync - Sync listings to a partner tenant.
    /// </summary>
    [HttpPost("api/admin/federation/partners/{id:int}/sync")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> SyncListings(int id)
    {
        var tenantId = _tenantContext.TenantId;
        if (!tenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var (syncedCount, error) = await _federationService.SyncListingsToPartnerAsync(id);

        if (syncedCount == 0 && error == "Partnership not found")
            return BadRequest(new { error });

        if (error != null)
            return BadRequest(new { error });

        return Ok(new
        {
            synced_count = syncedCount,
            message = $"Successfully synced {syncedCount} listings to partner"
        });
    }

    /// <summary>
    /// GET /api/admin/federation/stats - Get federation statistics.
    /// </summary>
    [HttpGet("api/admin/federation/stats")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> GetStats()
    {
        var tenantId = _tenantContext.TenantId;
        if (!tenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var stats = await _federationService.GetFederationStatsAsync(tenantId.Value);

        return Ok(new
        {
            total_partners = stats.TotalPartners,
            active_partners = stats.ActivePartners,
            pending_partners = stats.PendingPartners,
            suspended_partners = stats.SuspendedPartners,
            shared_listings_received = stats.SharedListingsReceived,
            total_exchanges = stats.TotalExchanges,
            completed_exchanges = stats.CompletedExchanges,
            active_exchanges = stats.ActiveExchanges,
            total_hours_exchanged = stats.TotalHoursExchanged
        });
    }

    /// <summary>
    /// GET /api/admin/federation/api-keys - List API keys for the current tenant.
    /// </summary>
    [HttpGet("api/admin/federation/api-keys")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> ListApiKeys()
    {
        var tenantId = _tenantContext.TenantId;
        if (!tenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var keys = await _apiKeyService.ListApiKeysAsync(tenantId.Value);

        var data = keys.Select(k => new
        {
            id = k.Id,
            name = k.Name,
            key_prefix = k.KeyPrefix,
            scopes = k.Scopes,
            is_active = k.IsActive,
            rate_limit_per_minute = k.RateLimitPerMinute,
            expires_at = k.ExpiresAt,
            last_used_at = k.LastUsedAt,
            created_at = k.CreatedAt
        });

        return Ok(new { data });
    }

    /// <summary>
    /// POST /api/admin/federation/api-keys - Create a new federation API key.
    /// </summary>
    [HttpPost("api/admin/federation/api-keys")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> CreateApiKey([FromBody] CreateApiKeyRequest request)
    {
        var tenantId = _tenantContext.TenantId;
        if (!tenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var (key, rawKey, error) = await _apiKeyService.CreateApiKeyAsync(
            tenantId.Value, request.Name, request.Scopes,
            request.RateLimitPerMinute, request.ExpiresAt);

        if (error != null)
            return BadRequest(new { error });

        return CreatedAtAction(nameof(ListApiKeys), null, new
        {
            id = key.Id,
            name = key.Name,
            key = rawKey, // Only shown once!
            key_prefix = key.KeyPrefix,
            scopes = key.Scopes,
            rate_limit_per_minute = key.RateLimitPerMinute,
            expires_at = key.ExpiresAt,
            created_at = key.CreatedAt,
            warning = "Store this key securely. It will not be shown again."
        });
    }

    /// <summary>
    /// DELETE /api/admin/federation/api-keys/{id} - Revoke an API key.
    /// </summary>
    [HttpDelete("api/admin/federation/api-keys/{id:int}")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> RevokeApiKey(int id)
    {
        var tenantId = _tenantContext.TenantId;
        if (!tenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var (success, error) = await _apiKeyService.RevokeApiKeyAsync(tenantId.Value, id);

        if (!success)
            return BadRequest(new { error });

        return Ok(new { message = "API key revoked successfully" });
    }

    /// <summary>
    /// GET /api/admin/federation/features - List feature toggles for the current tenant.
    /// </summary>
    [HttpGet("api/admin/federation/features")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> ListFeatureToggles()
    {
        var tenantId = _tenantContext.TenantId;
        if (!tenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var toggles = await _gatewayService.GetTenantTogglesAsync(tenantId.Value);

        var data = toggles.Select(t => new
        {
            id = t.Id,
            feature = t.Feature,
            is_enabled = t.IsEnabled,
            configuration = t.Configuration,
            created_at = t.CreatedAt,
            updated_at = t.UpdatedAt
        });

        var systemStatus = _gatewayService.GetSystemStatus();

        return Ok(new { data, system = systemStatus });
    }

    /// <summary>
    /// PUT /api/admin/federation/features - Set a feature toggle.
    /// </summary>
    [HttpPut("api/admin/federation/features")]
    [Authorize(Policy = "AdminOnly")]
    public async Task<IActionResult> SetFeatureToggle([FromBody] SetFeatureToggleRequest request)
    {
        var tenantId = _tenantContext.TenantId;
        if (!tenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var toggle = await _gatewayService.SetFeatureToggleAsync(
            tenantId.Value, request.Feature, request.IsEnabled, request.Configuration);

        return Ok(new
        {
            id = toggle.Id,
            feature = toggle.Feature,
            is_enabled = toggle.IsEnabled,
            configuration = toggle.Configuration,
            message = $"Feature '{request.Feature}' set to {(request.IsEnabled ? "enabled" : "disabled")}"
        });
    }

    #endregion

    #region User Endpoints

    /// <summary>
    /// GET /api/federation/listings - Browse federated listings from partner tenants.
    /// </summary>
    [HttpGet("api/federation/listings")]
    public async Task<IActionResult> ListFederatedListings(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        var tenantId = _tenantContext.TenantId;
        if (!tenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        if (page < 1) page = 1;
        limit = Math.Clamp(limit, 1, 100);

        var (listings, total) = await _federationService.GetFederatedListingsAsync(tenantId.Value, page, limit);

        var data = listings.Select(l => new
        {
            id = l.Id,
            source_tenant = l.SourceTenant != null ? new
            {
                id = l.SourceTenant.Id,
                name = l.SourceTenant.Name,
                slug = l.SourceTenant.Slug
            } : null,
            source_listing_id = l.SourceListingId,
            title = l.Title,
            description = l.Description,
            listing_type = l.ListingType,
            owner_display_name = l.OwnerDisplayName,
            status = l.Status.ToString().ToLowerInvariant(),
            synced_at = l.SyncedAt,
            created_at = l.CreatedAt
        });

        return Ok(new
        {
            data,
            pagination = new
            {
                page,
                limit,
                total,
                pages = (int)Math.Ceiling((double)total / limit)
            }
        });
    }

    /// <summary>
    /// POST /api/federation/exchanges - Initiate a cross-tenant exchange.
    /// </summary>
    [HttpPost("api/federation/exchanges")]
    public async Task<IActionResult> InitiateExchange([FromBody] InitiateFederatedExchangeRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (exchange, error) = await _federationService.InitiateFederatedExchangeAsync(
            userId.Value, request.FederatedListingId, request.AgreedHours);

        if (error != null)
            return BadRequest(new { error });

        return CreatedAtAction(nameof(ListFederatedExchanges), null, new
        {
            id = exchange!.Id,
            tenant_id = exchange.TenantId,
            partner_tenant_id = exchange.PartnerTenantId,
            local_user_id = exchange.LocalUserId,
            remote_user_display_name = exchange.RemoteUserDisplayName,
            source_listing_id = exchange.SourceListingId,
            status = exchange.Status.ToString().ToLowerInvariant(),
            agreed_hours = exchange.AgreedHours,
            credit_exchange_rate = exchange.CreditExchangeRate,
            created_at = exchange.CreatedAt
        });
    }

    /// <summary>
    /// PUT /api/federation/exchanges/{id}/complete - Complete a federated exchange.
    /// </summary>
    [HttpPut("api/federation/exchanges/{id:int}/complete")]
    public async Task<IActionResult> CompleteExchange(int id, [FromBody] CompleteFederatedExchangeRequest? request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var (exchange, error) = await _federationService.CompleteFederatedExchangeAsync(
            id, userId.Value, request?.ActualHours);

        if (error != null)
            return BadRequest(new { error });

        return Ok(new
        {
            id = exchange!.Id,
            status = exchange.Status.ToString().ToLowerInvariant(),
            actual_hours = exchange.ActualHours,
            credit_exchange_rate = exchange.CreditExchangeRate,
            local_transaction_id = exchange.LocalTransactionId,
            completed_at = exchange.CompletedAt,
            message = "Exchange completed successfully"
        });
    }

    /// <summary>
    /// GET /api/federation/exchanges - List current user's federated exchanges.
    /// </summary>
    [HttpGet("api/federation/exchanges")]
    public async Task<IActionResult> ListFederatedExchanges(
        [FromQuery] int page = 1,
        [FromQuery] int limit = 20)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        if (page < 1) page = 1;
        limit = Math.Clamp(limit, 1, 100);

        var (exchanges, total) = await _federationService.GetFederatedExchangesAsync(userId.Value, page, limit);

        var data = exchanges.Select(e => new
        {
            id = e.Id,
            tenant_id = e.TenantId,
            partner_tenant = e.PartnerTenant != null ? new
            {
                id = e.PartnerTenant.Id,
                name = e.PartnerTenant.Name,
                slug = e.PartnerTenant.Slug
            } : null,
            local_user_id = e.LocalUserId,
            remote_user_display_name = e.RemoteUserDisplayName,
            source_listing_id = e.SourceListingId,
            status = e.Status.ToString().ToLowerInvariant(),
            agreed_hours = e.AgreedHours,
            actual_hours = e.ActualHours,
            credit_exchange_rate = e.CreditExchangeRate,
            local_transaction_id = e.LocalTransactionId,
            notes = e.Notes,
            completed_at = e.CompletedAt,
            created_at = e.CreatedAt,
            updated_at = e.UpdatedAt
        });

        return Ok(new
        {
            data,
            pagination = new
            {
                page,
                limit,
                total,
                pages = (int)Math.Ceiling((double)total / limit)
            }
        });
    }

    /// <summary>
    /// GET /api/federation/settings - Get current user's federation settings.
    /// </summary>
    [HttpGet("api/federation/settings")]
    public async Task<IActionResult> GetMyFederationSettings()
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.TenantId;
        if (!tenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var settings = await _gatewayService.GetUserSettingsAsync(tenantId.Value, userId.Value);

        if (settings == null)
            return Ok(new
            {
                federation_opt_in = false,
                profile_visible = false,
                listings_visible = true,
                transactions_enabled_federated = false,
                blocked_partner_tenants = (string?)null
            });

        return Ok(new
        {
            federation_opt_in = settings.FederationOptIn,
            profile_visible = settings.ProfileVisible,
            listings_visible = settings.ListingsVisible,
            transactions_enabled_federated = settings.TransactionsEnabled,
            blocked_partner_tenants = settings.BlockedPartnerTenants
        });
    }

    /// <summary>
    /// PUT /api/federation/settings - Update current user's federation settings.
    /// </summary>
    [HttpPut("api/federation/settings")]
    public async Task<IActionResult> UpdateMyFederationSettings([FromBody] UpdateFederationSettingsRequest request)
    {
        var userId = GetCurrentUserId();
        if (userId == null) return Unauthorized(new { error = "Invalid token" });

        var tenantId = _tenantContext.TenantId;
        if (!tenantId.HasValue)
            return BadRequest(new { error = "Tenant context not resolved" });

        var settings = await _gatewayService.UpdateUserSettingsAsync(
            tenantId.Value, userId.Value,
            request.FederationOptIn, request.ProfileVisible,
            request.ListingsVisible, request.TransactionsEnabledFederated,
            request.BlockedPartnerTenants);

        return Ok(new
        {
            federation_opt_in = settings.FederationOptIn,
            profile_visible = settings.ProfileVisible,
            listings_visible = settings.ListingsVisible,
            transactions_enabled_federated = settings.TransactionsEnabled,
            blocked_partner_tenants = settings.BlockedPartnerTenants,
            message = "Federation settings updated"
        });
    }

    #endregion
}

#region Request DTOs

/// <summary>
/// Request to create a federation partnership.
/// </summary>
public class RequestPartnershipRequest
{
    [JsonPropertyName("partner_tenant_id")]
    public int PartnerTenantId { get; set; }

    [JsonPropertyName("shared_listings")]
    public bool SharedListings { get; set; } = true;

    [JsonPropertyName("shared_events")]
    public bool SharedEvents { get; set; } = false;

    [JsonPropertyName("shared_members")]
    public bool SharedMembers { get; set; } = false;

    [JsonPropertyName("transactions_enabled")]
    public bool TransactionsEnabled { get; set; }
}

/// <summary>
/// Request to suspend a partnership.
/// </summary>
public class SuspendPartnershipRequest
{
    [JsonPropertyName("reason")]
    public string? Reason { get; set; }
}

/// <summary>
/// Request to initiate a federated exchange.
/// </summary>
public class InitiateFederatedExchangeRequest
{
    [JsonPropertyName("federated_listing_id")]
    public int FederatedListingId { get; set; }

    [JsonPropertyName("agreed_hours")]
    public decimal AgreedHours { get; set; }
}

/// <summary>
/// Request to complete a federated exchange.
/// </summary>
public class CompleteFederatedExchangeRequest
{
    [JsonPropertyName("actual_hours")]
    public decimal? ActualHours { get; set; }
}

/// <summary>
/// Request to create a federation API key.
/// </summary>
public class CreateApiKeyRequest
{
    [JsonPropertyName("name")]
    public string Name { get; set; } = string.Empty;

    [JsonPropertyName("scopes")]
    public string Scopes { get; set; } = "listings";

    [JsonPropertyName("rate_limit_per_minute")]
    public int? RateLimitPerMinute { get; set; } = 60;

    [JsonPropertyName("expires_at")]
    public DateTime? ExpiresAt { get; set; }
}

/// <summary>
/// Request to set a feature toggle.
/// </summary>
public class SetFeatureToggleRequest
{
    [JsonPropertyName("feature")]
    public string Feature { get; set; } = string.Empty;

    [JsonPropertyName("is_enabled")]
    public bool IsEnabled { get; set; }

    [JsonPropertyName("configuration")]
    public string? Configuration { get; set; }
}

/// <summary>
/// Request to update user federation settings.
/// </summary>
public class UpdateFederationSettingsRequest
{
    [JsonPropertyName("federation_opt_in")]
    public bool FederationOptIn { get; set; }

    [JsonPropertyName("profile_visible")]
    public bool ProfileVisible { get; set; }

    [JsonPropertyName("listings_visible")]
    public bool ListingsVisible { get; set; } = true;

    [JsonPropertyName("transactions_enabled_federated")]
    public bool? TransactionsEnabledFederated { get; set; }

    [JsonPropertyName("blocked_partner_tenants")]
    public string? BlockedPartnerTenants { get; set; }
}

#endregion
