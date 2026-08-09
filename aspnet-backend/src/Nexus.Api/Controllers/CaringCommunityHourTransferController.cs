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
[Route("api/caring-community/hour-transfer")]
[Authorize]
public sealed class CaringCommunityHourTransferController : ControllerBase
{
    private readonly CaringHourTransferService _transfers;
    private readonly TenantContext _tenant;

    public CaringCommunityHourTransferController(
        CaringHourTransferService transfers,
        TenantContext tenant)
    {
        _transfers = transfers;
        _tenant = tenant;
    }

    [HttpPost("initiate")]
    public async Task<IActionResult> Initiate(
        [FromBody] CaringHourTransferInitiateRequest? request,
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

        var result = await _transfers.InitiateAsync(
            _tenant.GetTenantIdOrThrow(),
            userId.Value,
            request ?? new CaringHourTransferInitiateRequest(),
            ct);

        return MutationResponse(result);
    }

    [HttpGet("my-history")]
    public async Task<IActionResult> MyHistory(CancellationToken ct)
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

        var items = await _transfers.MemberHistoryAsync(_tenant.GetTenantIdOrThrow(), userId.Value, ct);
        return Ok(new { data = new { items } });
    }

    private IActionResult MutationResponse(HourTransferMutationResult result)
    {
        if (result.Errors is { Count: > 0 })
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity, new { errors = result.Errors });
        }

        return StatusCode(result.StatusCode, new { data = result.Data });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _transfers.IsFeatureEnabledAsync(tenantId, ct))
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
