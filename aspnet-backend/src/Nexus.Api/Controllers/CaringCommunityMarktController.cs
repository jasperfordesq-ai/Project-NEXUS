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
[Route("api/caring-community/markt")]
[Route("api/v2/caring-community/markt")]
[Authorize]
public sealed class CaringCommunityMarktController : ControllerBase
{
    private readonly CaringCommunityMarktService _markt;
    private readonly TenantContext _tenant;

    public CaringCommunityMarktController(
        CaringCommunityMarktService markt,
        TenantContext tenant)
    {
        _markt = markt;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> Index(
        [FromQuery] string? type = null,
        [FromQuery] int page = 1,
        [FromQuery(Name = "per_page")] int perPage = 20,
        [FromQuery] double? lat = null,
        [FromQuery] double? lng = null,
        [FromQuery(Name = "radius_km")] double? radiusKm = null,
        [FromQuery(Name = "sub_region_id")] int? subRegionId = null,
        CancellationToken ct = default)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _markt.ListAsync(
            _tenant.GetTenantIdOrThrow(),
            new CaringCommunityMarktQuery(
                type,
                page,
                perPage,
                lat,
                lng,
                radiusKm,
                subRegionId),
            ct);

        return Ok(new
        {
            data = result.Items,
            meta = result.Meta
        });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        var userId = User.GetUserId();
        if (userId is null)
        {
            return Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _markt.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        return null;
    }

    private static object LaravelError(string code, string message)
    {
        return new
        {
            errors = new[]
            {
                new
                {
                    code,
                    message
                }
            }
        };
    }
}
