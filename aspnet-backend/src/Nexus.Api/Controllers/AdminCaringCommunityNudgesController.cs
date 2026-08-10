// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using System.Text.Json;
using System.Text.Json.Serialization;
using Nexus.Api.Data;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/admin/caring-community")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunityNudgesController : ControllerBase
{
    private readonly CaringNudgeAnalyticsService _nudges;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityNudgesController(
        CaringNudgeAnalyticsService nudges,
        TenantContext tenant)
    {
        _nudges = nudges;
        _tenant = tenant;
    }

    [HttpGet("nudges/analytics")]
    public async Task<IActionResult> Analytics(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _nudges.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        var data = await _nudges.AnalyticsAsync(tenantId, ct);
        return Ok(new { data });
    }

    [HttpPut("nudges/config")]
    public async Task<IActionResult> UpdateConfig(
        [FromBody] JsonElement payload,
        CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _nudges.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        var config = await _nudges.UpdateConfigAsync(tenantId, payload, ct);
        return Ok(new { data = new { config } });
    }

    [HttpPost("nudges/dispatch")]
    public async Task<IActionResult> Dispatch(
        [FromBody] CaringNudgeDispatchRequest? request,
        CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _nudges.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        var data = await _nudges.DispatchDueAsync(
            tenantId,
            request?.Limit,
            request?.DryRun == true,
            ct);

        return StatusCode(request?.DryRun == true
            ? StatusCodes.Status200OK
            : StatusCodes.Status201Created,
            new { data });
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

public sealed class CaringNudgeDispatchRequest
{
    [JsonPropertyName("dry_run")] public bool? DryRun { get; set; }
    [JsonPropertyName("limit")] public int? Limit { get; set; }
}
