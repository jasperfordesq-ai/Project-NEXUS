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
public sealed class CaringCommunityCivicDigestController : ControllerBase
{
    private readonly CivicDigestService _digest;
    private readonly TenantContext _tenant;

    public CaringCommunityCivicDigestController(CivicDigestService digest, TenantContext tenant)
    {
        _digest = digest;
        _tenant = tenant;
    }

    [HttpGet("digest")]
    public async Task<IActionResult> Digest([FromQuery] int? limit = null, CancellationToken ct = default)
    {
        var guard = await GuardAsync(ct);
        if (guard.Error is not null)
        {
            return guard.Error;
        }

        var result = await _digest.GetDigestForMemberAsync(guard.TenantId, guard.UserId, limit, ct);
        return Ok(new
        {
            data = new
            {
                items = result.Items,
                prefs = result.Prefs,
                tenant_default_cadence = result.TenantDefaultCadence
            }
        });
    }

    [HttpGet("digest/prefs")]
    public async Task<IActionResult> Prefs(CancellationToken ct = default)
    {
        var guard = await GuardAsync(ct);
        if (guard.Error is not null)
        {
            return guard.Error;
        }

        var result = await _digest.GetPrefsEnvelopeAsync(guard.TenantId, guard.UserId, ct);
        return Ok(new
        {
            data = new
            {
                prefs = result.Prefs,
                tenant_default_cadence = result.TenantDefaultCadence
            }
        });
    }

    [HttpPut("digest/prefs")]
    public async Task<IActionResult> UpdatePrefs(
        [FromBody] CivicDigestPrefsRequest request,
        CancellationToken ct = default)
    {
        var guard = await GuardAsync(ct);
        if (guard.Error is not null)
        {
            return guard.Error;
        }

        var result = await _digest.SetUserPrefsAsync(guard.TenantId, guard.UserId, request, ct);
        if (result.Errors.Count > 0)
        {
            return UnprocessableEntity(new
            {
                errors = result.Errors.Select(error => new
                {
                    code = "VALIDATION_ERROR",
                    message = error.Message,
                    field = error.Field
                })
            });
        }

        return Ok(new { data = new { prefs = result.Prefs } });
    }

    private async Task<CivicDigestGuardResult> GuardAsync(CancellationToken ct)
    {
        var userId = User.GetUserId();
        if (userId is null)
        {
            return new CivicDigestGuardResult(
                Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required.")),
                0,
                0);
        }

        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _digest.IsFeatureEnabledAsync(tenantId, ct))
        {
            return new CivicDigestGuardResult(
                StatusCode(StatusCodes.Status403Forbidden,
                    LaravelError("FEATURE_DISABLED", "Service unavailable.")),
                0,
                0);
        }

        return new CivicDigestGuardResult(null, tenantId, userId.Value);
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

    private sealed record CivicDigestGuardResult(IActionResult? Error, int TenantId, int UserId);
}
