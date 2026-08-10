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
public sealed class AdminCaringCommunityRecipientCircleController : ControllerBase
{
    private readonly CaringRecipientCircleService _circles;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityRecipientCircleController(
        CaringRecipientCircleService circles,
        TenantContext tenant)
    {
        _circles = circles;
        _tenant = tenant;
    }

    [HttpGet("recipient/{userId:int}/circle")]
    public async Task<IActionResult> RecipientCircle(int userId, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _circles.GetCircleAsync(_tenant.GetTenantIdOrThrow(), userId, ct);
        if (data is null)
        {
            return NotFound(LaravelError("NOT_FOUND", "User not found."));
        }

        return Ok(new { data });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        if (!await _circles.IsFeatureEnabledAsync(_tenant.GetTenantIdOrThrow(), ct))
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
