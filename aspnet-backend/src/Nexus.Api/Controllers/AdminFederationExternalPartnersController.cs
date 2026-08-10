// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/v2/admin/federation/external-partners")]
[Route("api/admin/federation/external-partners")]
[Authorize(Policy = "AdminOnly")]
public class AdminFederationExternalPartnersController : ControllerBase
{
    private readonly FederationExternalPartnerService _partners;
    private readonly TenantContext _tenant;

    public AdminFederationExternalPartnersController(FederationExternalPartnerService partners, TenantContext tenant)
    {
        _partners = partners;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> Index()
    {
        var tenantId = RequireTenant();
        if (tenantId == null) return BadRequest(new { error = "Tenant context not resolved" });
        var partners = await _partners.GetAllAsync(tenantId.Value);
        return Ok(new { data = partners.Select(ToDto) });
    }

    [HttpPost]
    public async Task<IActionResult> Store([FromBody] FederationExternalPartnerRequest request)
    {
        var tenantId = RequireTenant();
        if (tenantId == null) return BadRequest(new { error = "Tenant context not resolved" });
        var userId = User.GetUserId() ?? 0;
        var (partner, error) = await _partners.UpsertAsync(tenantId.Value, userId, request);
        if (error != null) return UnprocessableEntity(new { error });
        return Created($"/api/v2/admin/federation/external-partners/{partner!.Id}", new { data = new { id = partner.Id } });
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] FederationExternalPartnerRequest request)
    {
        var tenantId = RequireTenant();
        if (tenantId == null) return BadRequest(new { error = "Tenant context not resolved" });
        var userId = User.GetUserId() ?? 0;
        var (partner, error) = await _partners.UpsertAsync(tenantId.Value, userId, request, id);
        if (error != null) return UnprocessableEntity(new { error });
        return Ok(new { data = new { id = partner!.Id } });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Destroy(int id)
    {
        var tenantId = RequireTenant();
        if (tenantId == null) return BadRequest(new { error = "Tenant context not resolved" });
        var (success, error) = await _partners.DeleteAsync(tenantId.Value, id);
        if (!success) return NotFound(new { error });
        return Ok(new { data = new { deleted = true } });
    }

    [HttpPost("{id:int}/health-check")]
    public async Task<IActionResult> HealthCheck(int id)
    {
        var tenantId = RequireTenant();
        if (tenantId == null) return BadRequest(new { error = "Tenant context not resolved" });
        var result = await _partners.HealthCheckAsync(tenantId.Value, id);
        return Ok(new
        {
            data = new
            {
                healthy = result.Healthy,
                response_time_ms = result.ResponseTimeMs,
                status_code = result.StatusCode,
                error = result.Error
            }
        });
    }

    [HttpGet("{id:int}/logs")]
    public async Task<IActionResult> Logs(int id)
    {
        var tenantId = RequireTenant();
        if (tenantId == null) return BadRequest(new { error = "Tenant context not resolved" });
        var logs = await _partners.GetLogsAsync(tenantId.Value, id);
        return Ok(new { data = logs });
    }

    [HttpPost("enable-current-tenant")]
    public async Task<IActionResult> EnableCurrentTenant()
    {
        var tenantId = RequireTenant();
        if (tenantId == null) return BadRequest(new { error = "Tenant context not resolved" });
        await _partners.EnableTenantFederationAsync(tenantId.Value, User.GetUserId());
        return Ok(new { data = new { tenant_id = tenantId.Value, federation_enabled = true, all_users_opted_in = true } });
    }

    private int? RequireTenant() => _tenant.TenantId;

    private static object ToDto(Entities.FederationExternalPartner p) => new
    {
        id = p.Id,
        tenant_id = p.TenantId,
        name = p.Name,
        description = p.Description,
        base_url = p.BaseUrl,
        api_path = p.ApiPath,
        auth_method = p.AuthMethod,
        protocol_type = p.ProtocolType,
        oauth_client_id = p.OAuthClientId,
        oauth_token_url = p.OAuthTokenUrl,
        status = p.Status,
        verified_at = p.VerifiedAt,
        last_sync_at = p.LastSyncAt,
        last_error = p.LastError,
        error_count = p.ErrorCount,
        partner_name = p.PartnerName,
        partner_version = p.PartnerVersion,
        partner_member_count = p.PartnerMemberCount,
        partner_metadata = DecodeMetadata(p.PartnerMetadata),
        allow_member_search = p.AllowMemberSearch,
        allow_listing_search = p.AllowListingSearch,
        allow_messaging = p.AllowMessaging,
        allow_transactions = p.AllowTransactions,
        allow_events = p.AllowEvents,
        allow_groups = p.AllowGroups,
        allow_connections = p.AllowConnections,
        allow_volunteering = p.AllowVolunteering,
        allow_member_sync = p.AllowMemberSync,
        created_by = p.CreatedBy,
        created_at = p.CreatedAt,
        updated_at = p.UpdatedAt
    };

    private static object? DecodeMetadata(string? metadata)
    {
        if (string.IsNullOrWhiteSpace(metadata)) return null;
        try
        {
            return System.Text.Json.JsonSerializer.Deserialize<object>(metadata);
        }
        catch (System.Text.Json.JsonException)
        {
            return metadata;
        }
    }
}
