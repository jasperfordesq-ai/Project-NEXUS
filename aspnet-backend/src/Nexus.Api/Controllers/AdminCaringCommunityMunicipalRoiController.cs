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
[Route("api/admin/caring-community")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunityMunicipalRoiController : ControllerBase
{
    private readonly MunicipalRoiService _roi;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityMunicipalRoiController(
        MunicipalRoiService roi,
        TenantContext tenant)
    {
        _roi = roi;
        _tenant = tenant;
    }

    [HttpGet("municipal-roi")]
    public async Task<IActionResult> Show(
        [FromQuery] string? from,
        [FromQuery] string? to,
        [FromQuery(Name = "sub_region_id")] int? subRegionId,
        CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _roi.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        var report = await _roi.ReportAsync(
            tenantId,
            new MunicipalRoiFilters(from, to, subRegionId),
            ct);

        return Ok(new { data = report });
    }

    [HttpGet("municipal-roi/export")]
    public async Task<IActionResult> Export(
        [FromQuery] string? from,
        [FromQuery] string? to,
        [FromQuery(Name = "sub_region_id")] int? subRegionId,
        CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _roi.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        var csv = await _roi.ExportAsync(
            tenantId,
            new MunicipalRoiFilters(from, to, subRegionId),
            ct);

        Response.Headers.CacheControl = "no-store";
        return File(csv.FileContents, "text/csv; charset=UTF-8", csv.Filename);
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
