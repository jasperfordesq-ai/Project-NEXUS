// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Entities;
using Nexus.Api.Extensions;
using Nexus.Api.Services.ApiPartners;

namespace Nexus.Api.Controllers;

/// <summary>
/// Admin endpoints for third-party API partner registry.
/// </summary>
[ApiController]
[Route("api/admin/api-partners")]
[Authorize(Policy = "AdminOnly")]
public class AdminApiPartnersController : ControllerBase
{
    private readonly ApiPartnerService _service;

    public AdminApiPartnersController(ApiPartnerService service)
    {
        _service = service;
    }

    [HttpGet]
    public async Task<IActionResult> List(
        [FromQuery] string? status,
        [FromQuery(Name = "page")] int page = 1,
        [FromQuery(Name = "page_size")] int pageSize = 50,
        CancellationToken ct = default)
    {
        var rows = await _service.ListAsync(status, page, pageSize, ct);
        return Ok(new { data = rows.Select(Project), page, page_size = pageSize });
    }

    [HttpGet("{id:guid}")]
    public async Task<IActionResult> Get(Guid id, CancellationToken ct)
    {
        var p = await _service.GetAsync(id, ct);
        return p == null ? NotFound() : Ok(Project(p));
    }

    [HttpPost]
    public async Task<IActionResult> Register([FromBody] RegisterApiPartnerDto dto, CancellationToken ct)
    {
        try
        {
            var userId = User.GetUserId();
            var (partner, raw) = await _service.RegisterAsync(dto, userId, ct);
            var body = Project(partner);
            // api_key is only returned at registration / rotation.
            return CreatedAtAction(nameof(Get), new { id = partner.Id },
                new
                {
                    id = partner.Id,
                    api_key = raw,
                    partner = body
                });
        }
        catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPut("{id:guid}")]
    public async Task<IActionResult> Update(Guid id, [FromBody] UpdateApiPartnerDto dto, CancellationToken ct)
    {
        try { return Ok(Project(await _service.UpdateAsync(id, dto, ct))); }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("{id:guid}/rotate-key")]
    public async Task<IActionResult> RotateKey(Guid id, CancellationToken ct)
    {
        try
        {
            var (partner, raw) = await _service.RotateKeyAsync(id, ct);
            return Ok(new { id = partner.Id, api_key = raw, partner = Project(partner) });
        }
        catch (KeyNotFoundException) { return NotFound(); }
    }

    [HttpPost("{id:guid}/suspend")]
    public async Task<IActionResult> Suspend(Guid id, CancellationToken ct)
    {
        try { return Ok(Project(await _service.SuspendAsync(id, ct))); }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("{id:guid}/activate")]
    [HttpPost("{id:guid}/reactivate")]
    public async Task<IActionResult> Reactivate(Guid id, CancellationToken ct)
    {
        try { return Ok(Project(await _service.ReactivateAsync(id, ct))); }
        catch (KeyNotFoundException) { return NotFound(); }
        catch (InvalidOperationException ex) { return BadRequest(new { error = ex.Message }); }
    }

    [HttpPost("{id:guid}/revoke")]
    public async Task<IActionResult> Revoke(Guid id, [FromBody] ReasonBody body, CancellationToken ct)
    {
        try { return Ok(Project(await _service.RevokeAsync(id, body?.Reason ?? "", ct))); }
        catch (KeyNotFoundException) { return NotFound(); }
    }

    internal static object Project(ApiPartner p) => new
    {
        id = p.Id,
        tenant_id = p.TenantId,
        name = p.Name,
        contact_email = p.ContactEmail,
        description = p.Description,
        api_key_prefix = p.ApiKeyPrefix,
        scopes = p.Scopes,
        rate_limit_per_minute = p.RateLimitPerMinute,
        is_sandbox = p.IsSandbox,
        allowed_ip_cidrs = string.IsNullOrWhiteSpace(p.AllowedIpCidrs)
            ? Array.Empty<string>()
            : System.Text.Json.JsonSerializer.Deserialize<string[]>(p.AllowedIpCidrs) ?? Array.Empty<string>(),
        status = p.Status.ToString().ToLowerInvariant(),
        last_used_at = p.LastUsedAt,
        requests_last_24h = p.RequestsLast24h,
        created_at = p.CreatedAt,
        updated_at = p.UpdatedAt,
        created_by = p.CreatedBy,
        revoked_at = p.RevokedAt,
        revoked_reason = p.RevokedReason
    };

    public class ReasonBody
    {
        [JsonPropertyName("reason")] public string? Reason { get; set; }
    }
}
