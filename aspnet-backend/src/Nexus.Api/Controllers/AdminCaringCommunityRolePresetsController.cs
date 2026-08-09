// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/admin/caring-community")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunityRolePresetsController : ControllerBase
{
    private readonly CaringCommunityRolePresetService _rolePresets;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityRolePresetsController(
        CaringCommunityRolePresetService rolePresets,
        TenantContext tenant)
    {
        _rolePresets = rolePresets;
        _tenant = tenant;
    }

    [HttpGet("role-presets")]
    public async Task<IActionResult> RolePresets(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _rolePresets.IsCaringCommunityEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        var data = await _rolePresets.StatusAsync(tenantId, ct);
        return Ok(new { data });
    }

    [HttpPost("role-presets/install")]
    public async Task<IActionResult> InstallRolePresets([FromBody] Dictionary<string, object?>? request, CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _rolePresets.IsCaringCommunityEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        var preset = StringValue(request, "preset");
        var data = await _rolePresets.InstallAsync(tenantId, string.IsNullOrWhiteSpace(preset) ? null : preset, ct);
        return Ok(new { data });
    }

    private static string? StringValue(IReadOnlyDictionary<string, object?>? request, string key)
    {
        if (request is null || !request.TryGetValue(key, out var value) || value is null)
        {
            return null;
        }

        if (value is JsonElement element)
        {
            return element.ValueKind == JsonValueKind.String ? element.GetString() : null;
        }

        return value as string;
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
