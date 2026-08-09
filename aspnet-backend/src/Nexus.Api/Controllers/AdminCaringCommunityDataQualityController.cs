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
[Route("api/admin/caring-community/data-quality")]
[Authorize]
public sealed class AdminCaringCommunityDataQualityController : ControllerBase
{
    private readonly TenantDataQualityService _dataQuality;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityDataQualityController(TenantDataQualityService dataQuality, TenantContext tenant)
    {
        _dataQuality = dataQuality;
        _tenant = tenant;
    }

    [HttpGet("dashboard")]
    public async Task<IActionResult> Dashboard(CancellationToken ct = default)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var report = await _dataQuality.RunChecksAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data = report });
    }

    [HttpGet("checks/{checkKey}/rows")]
    public async Task<IActionResult> AffectedRows(
        string checkKey,
        [FromQuery] int? limit = null,
        CancellationToken ct = default)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        if (!TenantDataQualityService.AllowedDrilldownKeys.Contains(checkKey, StringComparer.Ordinal))
        {
            return UnprocessableEntity(LaravelError(
                "VALIDATION_ERROR",
                "Unknown data-quality check key.",
                "check_key"));
        }

        var rows = await _dataQuality.AffectedRowsAsync(
            _tenant.GetTenantIdOrThrow(),
            checkKey,
            limit,
            ct);

        return Ok(new { data = rows });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        if (!User.IsAdmin())
        {
            return Forbid();
        }

        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _dataQuality.IsFeatureEnabledAsync(tenantId, ct))
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
