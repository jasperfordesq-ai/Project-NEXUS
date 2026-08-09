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
[Route("api/admin/caring-community/digest")]
[Authorize]
public sealed class AdminCaringCommunityCivicDigestController : ControllerBase
{
    private readonly CivicDigestService _digest;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityCivicDigestController(CivicDigestService digest, TenantContext tenant)
    {
        _digest = digest;
        _tenant = tenant;
    }

    [HttpGet("cadence")]
    public async Task<IActionResult> Cadence(CancellationToken ct = default)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var cadence = await _digest.GetTenantCadenceAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data = new { cadence } });
    }

    [HttpPut("cadence")]
    public async Task<IActionResult> SetCadence(
        [FromBody] CivicDigestCadenceRequest request,
        CancellationToken ct = default)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _digest.SetTenantCadenceAsync(
            _tenant.GetTenantIdOrThrow(),
            request.Cadence,
            ct);

        if (result.ErrorField is not null)
        {
            return UnprocessableEntity(LaravelError(
                "VALIDATION_ERROR",
                result.ErrorMessage ?? "Validation failed.",
                result.ErrorField));
        }

        return Ok(new { data = new { cadence = result.Cadence } });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        if (!User.IsAdmin())
        {
            return Forbid();
        }

        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _digest.IsFeatureEnabledAsync(tenantId, ct))
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
