// Copyright (c) 2024-2026 Jasper Ford
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
[Route("api/admin/caring-community/external-integrations")]
[Authorize]
public sealed class AdminCaringCommunityExternalIntegrationsController : ControllerBase
{
    private readonly ExternalIntegrationBacklogService _service;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityExternalIntegrationsController(
        ExternalIntegrationBacklogService service,
        TenantContext tenant)
    {
        _service = service;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _service.ListAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data });
    }

    [HttpPost("seed-defaults")]
    public async Task<IActionResult> SeedDefaults(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _service.SeedDefaultsAsync(_tenant.GetTenantIdOrThrow(), ct);
        if (result.AlreadySeeded)
        {
            return StatusCode(StatusCodes.Status409Conflict,
                LaravelError("ALREADY_SEEDED", "Backlog already contains items - refusing to seed defaults."));
        }

        return Ok(new
        {
            data = new
            {
                items = result.Items ?? [],
                last_updated_at = result.LastUpdatedAt
            }
        });
    }

    [HttpPost]
    public async Task<IActionResult> Store([FromBody] ExternalIntegrationRequest request, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _service.CreateAsync(_tenant.GetTenantIdOrThrow(), request, ct);
        if (result.Errors is { Count: > 0 })
        {
            return UnprocessableEntity(new { errors = result.Errors });
        }

        return StatusCode(StatusCodes.Status201Created, new { data = new { item = result.Item } });
    }

    [HttpPut("{itemId}")]
    public async Task<IActionResult> Update(string itemId, [FromBody] ExternalIntegrationRequest request, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _service.UpdateAsync(_tenant.GetTenantIdOrThrow(), itemId, request, ct);
        if (result.NotFound)
        {
            return NotFound(LaravelError("NOT_FOUND", "Integration backlog item not found."));
        }

        if (result.Errors is { Count: > 0 })
        {
            return UnprocessableEntity(new { errors = result.Errors });
        }

        return Ok(new { data = new { item = result.Item } });
    }

    [HttpDelete("{itemId}")]
    public async Task<IActionResult> Destroy(string itemId, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _service.DeleteAsync(_tenant.GetTenantIdOrThrow(), itemId, ct);
        if (result.NotFound)
        {
            return NotFound(LaravelError("NOT_FOUND", "Integration backlog item not found."));
        }

        return Ok(new { data = new { ok = true } });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        if (!User.IsAdmin())
        {
            return Forbid();
        }

        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _service.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Caring Community feature is not enabled for this tenant."));
        }

        return null;
    }

    private static object LaravelError(string code, string message, string? field = null)
    {
        var error = new Dictionary<string, object?>
        {
            ["code"] = code,
            ["message"] = message
        };
        if (field is not null)
        {
            error["field"] = field;
        }

        return new { errors = new[] { error } };
    }
}
