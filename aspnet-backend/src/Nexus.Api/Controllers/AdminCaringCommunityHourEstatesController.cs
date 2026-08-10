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
[Route("api/admin/caring-community/hour-estates")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunityHourEstatesController : ControllerBase
{
    private readonly CaringHourEstateService _hourEstates;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityHourEstatesController(
        CaringHourEstateService hourEstates,
        TenantContext tenant)
    {
        _hourEstates = hourEstates;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> Index(
        [FromQuery] string? status = null,
        CancellationToken ct = default)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var items = await _hourEstates.ListEstatesAsync(_tenant.GetTenantIdOrThrow(), status, ct);
        return Ok(new { data = new { items } });
    }

    [HttpPost("{id:int}/report-deceased")]
    public async Task<IActionResult> ReportDeceased(
        int id,
        [FromBody] HourEstateAdminNotesRequest? request,
        CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var actorId = User.GetUserId();
        if (actorId is null)
        {
            return Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        var result = await _hourEstates.ReportDeceasedAsync(
            _tenant.GetTenantIdOrThrow(),
            id,
            actorId.Value,
            request ?? new HourEstateAdminNotesRequest(),
            ct);

        return MutationResponse(result);
    }

    [HttpPost("{id:int}/settle")]
    public async Task<IActionResult> Settle(
        int id,
        [FromBody] HourEstateAdminNotesRequest? request,
        CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var actorId = User.GetUserId();
        if (actorId is null)
        {
            return Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        var result = await _hourEstates.SettleAsync(
            _tenant.GetTenantIdOrThrow(),
            id,
            actorId.Value,
            request ?? new HourEstateAdminNotesRequest(),
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
