// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/admin/caring-community/disclosure-pack")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunityDisclosurePackController : ControllerBase
{
    private readonly PilotDisclosurePackService _packs;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityDisclosurePackController(
        PilotDisclosurePackService packs,
        TenantContext tenant)
    {
        _packs = packs;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> Show(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _packs.GetAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data });
    }

    [HttpPut]
    public async Task<IActionResult> Update(
        [FromBody] DisclosurePackUpdateRequest? request,
        CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _packs.UpdateAsync(_tenant.GetTenantIdOrThrow(), request, ct);
        if (result.Errors?.Count > 0)
        {
            return UnprocessableEntity(new
            {
                errors = result.Errors.Select(error => new
                {
                    code = "VALIDATION_ERROR",
                    message = error.Message,
                    field = error.Field
                })
            });
        }

        return Ok(new { data = new { pack = result.Pack } });
    }

    [HttpGet("export")]
    public async Task<IActionResult> Export(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var content = await _packs.RenderMarkdownAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new
        {
            data = new
            {
                format = "markdown",
                content,
                filename = "fadp-ndsg-disclosure-pack.md"
            }
        });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _packs.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
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
