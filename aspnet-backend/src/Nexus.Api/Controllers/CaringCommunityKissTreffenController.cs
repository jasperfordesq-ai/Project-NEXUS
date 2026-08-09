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
[Route("api/caring-community/kiss-treffen")]
[Authorize]
public sealed class CaringCommunityKissTreffenController : ControllerBase
{
    private readonly KissTreffenService _treffen;
    private readonly TenantContext _tenant;

    public CaringCommunityKissTreffenController(
        KissTreffenService treffen,
        TenantContext tenant)
    {
        _treffen = treffen;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> Index(
        [FromQuery(Name = "per_page")] int perPage = 20,
        CancellationToken ct = default)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var items = await _treffen.ListAsync(_tenant.GetTenantIdOrThrow(), perPage, ct);
        return Ok(new { data = new { items } });
    }

    [HttpGet("{eventId}")]
    public async Task<IActionResult> Show(int eventId, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var row = await _treffen.GetByEventIdAsync(_tenant.GetTenantIdOrThrow(), eventId, ct);
        return row is null
            ? StatusCode(StatusCodes.Status404NotFound,
                LaravelError("NOT_FOUND", "Caring Community Treffen meeting record not found."))
            : Ok(new { data = row });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        var userId = User.GetUserId();
        if (userId is null)
        {
            return Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _treffen.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        if (!await _treffen.IsAvailableAsync(ct))
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                LaravelError("SERVICE_UNAVAILABLE", "Caring Community Treffen meeting records are not available for this community."));
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
