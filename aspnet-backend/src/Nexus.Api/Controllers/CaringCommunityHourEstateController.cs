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
[Route("api/caring-community/hour-estate")]
[Authorize]
public sealed class CaringCommunityHourEstateController : ControllerBase
{
    private readonly CaringHourEstateService _hourEstates;
    private readonly TenantContext _tenant;

    public CaringCommunityHourEstateController(
        CaringHourEstateService hourEstates,
        TenantContext tenant)
    {
        _hourEstates = hourEstates;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> MyEstate(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var userId = User.GetUserId();
        if (userId is null)
        {
            return Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        var data = await _hourEstates.MyEstateAsync(_tenant.GetTenantIdOrThrow(), userId.Value, ct);
        return Ok(new { data });
    }

    [HttpPut]
    public async Task<IActionResult> Nominate(
        [FromBody] HourEstateNominateRequest? request,
        CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var userId = User.GetUserId();
        if (userId is null)
        {
            return Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        var result = await _hourEstates.NominateAsync(
            _tenant.GetTenantIdOrThrow(),
            userId.Value,
            request ?? new HourEstateNominateRequest(),
            ct);
        return MutationResponse(result);
    }

    private IActionResult MutationResponse(HourEstateMutationResult result)
    {
        if (result.Errors is { Count: > 0 })
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity, new { errors = result.Errors });
        }

        return Ok(new { data = result.Row });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _hourEstates.IsFeatureEnabledAsync(tenantId, ct))
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
                new LaravelErrorRow(code, message)
            }
        };
    }
}
