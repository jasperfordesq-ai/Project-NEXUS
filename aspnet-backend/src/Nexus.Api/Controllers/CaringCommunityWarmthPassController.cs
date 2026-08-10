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
[Route("api/caring-community")]
[Authorize]
public sealed class CaringCommunityWarmthPassController : ControllerBase
{
    private readonly WarmthPassService _warmthPass;
    private readonly TenantContext _tenant;

    public CaringCommunityWarmthPassController(WarmthPassService warmthPass, TenantContext tenant)
    {
        _warmthPass = warmthPass;
        _tenant = tenant;
    }

    [HttpGet("my-warmth-pass")]
    public async Task<IActionResult> MyWarmthPass(CancellationToken ct)
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

        try
        {
            var data = await _warmthPass.BuildPassAsync(userId.Value, _tenant.GetTenantIdOrThrow(), ct);
            return Ok(new { data });
        }
        catch
        {
            return StatusCode(StatusCodes.Status500InternalServerError,
                LaravelError("SERVER_ERROR", "Server error."));
        }
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        if (!await _warmthPass.IsFeatureEnabledAsync(_tenant.GetTenantIdOrThrow(), ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        return null;
    }

    internal static object LaravelError(string code, string message, string? field = null)
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

[ApiController]
[Route("api/admin/caring-community")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunityWarmthPassController : ControllerBase
{
    private readonly WarmthPassService _warmthPass;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityWarmthPassController(WarmthPassService warmthPass, TenantContext tenant)
    {
        _warmthPass = warmthPass;
        _tenant = tenant;
    }

    [HttpGet("warmth-pass/{userId:int}")]
    public async Task<IActionResult> AdminViewWarmthPass(int userId, CancellationToken ct)
    {
        if (!await _warmthPass.IsFeatureEnabledAsync(_tenant.GetTenantIdOrThrow(), ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                CaringCommunityWarmthPassController.LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        try
        {
            var data = await _warmthPass.BuildPassAsync(userId, _tenant.GetTenantIdOrThrow(), ct);
            return Ok(new { data });
        }
        catch
        {
            return StatusCode(StatusCodes.Status500InternalServerError,
                CaringCommunityWarmthPassController.LaravelError("SERVER_ERROR", "Server error."));
        }
    }
}
