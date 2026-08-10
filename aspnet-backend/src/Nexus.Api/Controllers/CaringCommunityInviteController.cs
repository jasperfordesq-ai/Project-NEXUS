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
[Route("api/caring-community/invite")]
[AllowAnonymous]
public sealed class CaringCommunityInviteController : ControllerBase
{
    private readonly CaringInviteCodeService _inviteCodes;
    private readonly TenantContext _tenant;

    public CaringCommunityInviteController(
        CaringInviteCodeService inviteCodes,
        TenantContext tenant)
    {
        _inviteCodes = inviteCodes;
        _tenant = tenant;
    }

    [HttpGet("{code}")]
    public async Task<IActionResult> Lookup(string code, CancellationToken ct)
    {
        var data = await _inviteCodes.LookupAsync(_tenant.GetTenantIdOrThrow(), code, ct);
        return Ok(new { data });
    }
}

[ApiController]
[Route("api/admin/caring-community/invite-codes")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunityInviteCodesController : ControllerBase
{
    private readonly CaringInviteCodeService _inviteCodes;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityInviteCodesController(
        CaringInviteCodeService inviteCodes,
        TenantContext tenant)
    {
        _inviteCodes = inviteCodes;
        _tenant = tenant;
    }

    [HttpGet]
    [HttpGet("/api/v2/admin/caring-community/invite-codes")]
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _inviteCodes.ListAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data });
    }

    [HttpPost]
    [HttpPost("/api/v2/admin/caring-community/invite-codes")]
    public async Task<IActionResult> Store(
        [FromBody] CaringInviteCodeGenerateRequest? request,
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

        var result = await _inviteCodes.GenerateAsync(
            _tenant.GetTenantIdOrThrow(),
            actorId.Value,
            request ?? new CaringInviteCodeGenerateRequest(),
            ct);

        if (!result.Success || result.Code is null)
        {
            return StatusCode(StatusCodes.Status500InternalServerError,
                LaravelError("SERVER_ERROR", "Server error."));
        }

        return StatusCode(StatusCodes.Status201Created, new { data = result.Code });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _inviteCodes.IsFeatureEnabledAsync(tenantId, ct))
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
