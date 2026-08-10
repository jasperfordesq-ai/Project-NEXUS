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

[ApiController]
[Route("api/admin/system/federation")]
[Authorize(Policy = "AdminOnly")]
public class AdminFederationController : ControllerBase
{
    private readonly FederationAdminService _svc;
    private readonly TenantContext _tenant;

    public AdminFederationController(FederationAdminService svc, TenantContext tenant)
    {
        _svc = svc;
        _tenant = tenant;
    }

    public class SetToggleRequest
    {
        [JsonPropertyName("feature_name")] public string FeatureName { get; set; } = string.Empty;
        [JsonPropertyName("enabled")] public bool Enabled { get; set; }
    }

    [HttpGet("partners")]
    public async Task<IActionResult> ListPartners([FromQuery] string? status)
    {
        var partners = await _svc.GetAllPartnersAsync(status);
        var data = partners.Select(p => new {
            id = p.Id, tenant_id = p.TenantId, partner_tenant_id = p.PartnerTenantId,
            status = p.Status.ToString().ToLower(), shared_listings = p.SharedListings,
            shared_events = p.SharedEvents, shared_members = p.SharedMembers,
            credit_exchange_rate = p.CreditExchangeRate, created_at = p.CreatedAt
        });
        return Ok(new { data, total = partners.Count });
    }

    [HttpPut("partners/{id:int}/suspend")]
    public async Task<IActionResult> SuspendPartner(int id)
    {
        var adminId = User.GetUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });
        var (partner, error) = await _svc.SuspendPartnerAsync(id, adminId.Value);
        if (error != null) return BadRequest(new { error });
        return Ok(new { id = partner!.Id, status = partner.Status.ToString().ToLower(), message = "Partner suspended" });
    }

    [HttpPut("partners/{id:int}/revoke")]
    public async Task<IActionResult> RevokePartner(int id)
    {
        var adminId = User.GetUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });
        var (partner, error) = await _svc.RevokePartnerAsync(id, adminId.Value);
        if (error != null) return BadRequest(new { error });
        return Ok(new { id = partner!.Id, status = partner.Status.ToString().ToLower(), message = "Partner revoked" });
    }

    [HttpPut("partners/{id:int}/reactivate")]
    public async Task<IActionResult> ReactivatePartner(int id)
    {
        var adminId = User.GetUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });
        var (partner, error) = await _svc.ReactivatePartnerAsync(id, adminId.Value);
        if (error != null) return BadRequest(new { error });
        return Ok(new { id = partner!.Id, status = partner.Status.ToString().ToLower(), message = "Partner reactivated" });
    }

    [HttpPut("partners/{id:int}/force-disconnect")]
    public async Task<IActionResult> ForceDisconnect(int id)
    {
        var adminId = User.GetUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });
        var (partner, error) = await _svc.ForceDisconnectAsync(id, adminId.Value);
        if (error != null) return BadRequest(new { error });
        return Ok(new { id = partner!.Id, status = partner.Status.ToString().ToLower(), message = "Partner force-disconnected" });
    }

    [HttpGet("stats")]
    public async Task<IActionResult> GetStats()
    {
        var stats = await _svc.GetFederationStatsAsync();
        return Ok(stats);
    }

    [HttpGet("audit-log")]
    public async Task<IActionResult> GetAuditLog([FromQuery] int? partnerId, [FromQuery] int page = 1, [FromQuery] int limit = 20)
    {
        page = Math.Max(page, 1);
        limit = Math.Clamp(limit, 1, 100);
        var (logs, total) = await _svc.GetAuditLogAsync(partnerId, page, limit);
        var data = logs.Select(l => new {
            id = l.Id, tenant_id = l.TenantId, partner_tenant_id = l.PartnerTenantId,
            action = l.Action, entity_type = l.EntityType, entity_id = l.EntityId,
            details = l.Details, created_at = l.CreatedAt
        });
        var pages = limit > 0 ? (int)Math.Ceiling(total / (double)limit) : 1;
        return Ok(new { data, pagination = new { page, limit, total, pages } });
    }

    [HttpGet("tenants/{tenantId:int}/toggles")]
    public async Task<IActionResult> GetToggles(int tenantId)
    {
        var toggles = await _svc.GetFeatureTogglesAsync(tenantId);
        var data = toggles.Select(t => new {
            id = t.Id, feature = t.Feature, is_enabled = t.IsEnabled, configuration = t.Configuration
        });
        return Ok(new { data });
    }

    [HttpPut("tenants/{tenantId:int}/toggles")]
    public async Task<IActionResult> SetToggle(int tenantId, [FromBody] SetToggleRequest request)
    {
        var (toggle, error) = await _svc.SetFeatureToggleAsync(tenantId, request.FeatureName, request.Enabled);
        if (error != null) return BadRequest(new { error });
        return Ok(new { id = toggle!.Id, feature = toggle.Feature, is_enabled = toggle.IsEnabled });
    }

    [HttpGet("api-keys/usage")]
    public async Task<IActionResult> GetApiKeyUsage([FromQuery] int? tenantId)
    {
        var stats = await _svc.GetApiKeyUsageAsync(tenantId);
        return Ok(stats);
    }

    [HttpPut("api-keys/{id:int}/revoke")]
    public async Task<IActionResult> RevokeApiKey(int id)
    {
        var adminId = User.GetUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });
        var (key, error) = await _svc.RevokeApiKeyAsync(id, adminId.Value);
        if (error != null) return NotFound(new { error });
        return Ok(new { id = key!.Id, is_active = key.IsActive, message = "API key revoked" });
    }

    [HttpPut("api-keys/{id:int}/regenerate")]
    public async Task<IActionResult> RegenerateApiKey(int id)
    {
        var adminId = User.GetUserId();
        if (adminId == null) return Unauthorized(new { error = "Invalid token" });
        var (key, rawKey, error) = await _svc.RegenerateApiKeyAsync(id, adminId.Value);
        if (error != null) return NotFound(new { error });
        return Ok(new { id = key!.Id, key_prefix = key.KeyPrefix, message = "API key regenerated" });
    }
}
