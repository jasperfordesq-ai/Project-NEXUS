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
[Route("api/admin/caring-community/hour-transfer")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunityHourTransferController : ControllerBase
{
    private readonly CaringHourTransferService _transfers;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityHourTransferController(
        CaringHourTransferService transfers,
        TenantContext tenant)
    {
        _transfers = transfers;
        _tenant = tenant;
    }

    [HttpGet("pending")]
    public async Task<IActionResult> Pending(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var items = await _transfers.PendingAtSourceAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data = new { items } });
    }

    [HttpPost("{id:int}/approve")]
    public async Task<IActionResult> Approve(int id, CancellationToken ct)
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

        var result = await _transfers.ApproveAtSourceAsync(
            _tenant.GetTenantIdOrThrow(),
            id,
            actorId.Value,
            ct);

        return MutationResponse(result);
    }

    [HttpPost("{id:int}/reject")]
    public async Task<IActionResult> Reject(
        int id,
        [FromBody] CaringHourTransferRejectRequest? request,
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

        var result = await _transfers.RejectAtSourceAsync(
            _tenant.GetTenantIdOrThrow(),
            id,
            actorId.Value,
            request ?? new CaringHourTransferRejectRequest(),
            ct);

        return MutationResponse(result);
    }

    [HttpGet("inbound")]
    public async Task<IActionResult> Inbound(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var items = await _transfers.RecentAtDestinationAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data = new { items } });
    }

    private IActionResult MutationResponse(HourTransferMutationResult result)
    {
        if (result.Errors is { Count: > 0 })
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity, new { errors = result.Errors });
        }

        return Ok(new { data = result.Data });
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
