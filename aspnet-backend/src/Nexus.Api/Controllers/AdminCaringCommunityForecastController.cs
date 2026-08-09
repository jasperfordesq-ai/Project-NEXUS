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
[Route("api/admin/caring-community/forecast")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunityForecastController : ControllerBase
{
    private readonly CaringCommunityForecastService _forecast;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityForecastController(
        CaringCommunityForecastService forecast,
        TenantContext tenant)
    {
        _forecast = forecast;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> Forecast(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _forecast.DashboardAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _forecast.IsFeatureEnabledAsync(tenantId, ct))
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
