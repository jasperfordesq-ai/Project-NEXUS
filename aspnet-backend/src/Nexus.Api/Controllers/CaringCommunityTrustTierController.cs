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
public sealed class CaringCommunityTrustTierController : ControllerBase
{
    private readonly TrustTierService _trustTiers;
    private readonly TenantContext _tenant;

    public CaringCommunityTrustTierController(TrustTierService trustTiers, TenantContext tenant)
    {
        _trustTiers = trustTiers;
        _tenant = tenant;
    }

    [HttpGet("my-trust-tier")]
    public async Task<IActionResult> MyTrustTier(CancellationToken ct)
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

        var tenantId = _tenant.GetTenantIdOrThrow();
        var tier = await _trustTiers.RecomputeForUserAsync(userId.Value, tenantId, ct);
        var nextTier = tier < TrustTierService.TierCoordinator ? tier + 1 : (int?)null;

        return Ok(new
        {
            data = new
            {
                tier,
                label = _trustTiers.GetTierLabel(tier),
                next_tier = nextTier is null ? null : _trustTiers.GetTierLabel(nextTier.Value)
            }
        });
    }

    [HttpGet("me/trust-tier/breakdown")]
    public async Task<IActionResult> MyTrustTierBreakdown(CancellationToken ct)
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

        var data = await _trustTiers.ComputeBreakdownForUserAsync(
            userId.Value,
            _tenant.GetTenantIdOrThrow(),
            ct);

        return Ok(new { data });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _trustTiers.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        if (!_trustTiers.IsAvailable())
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                LaravelError("FEATURE_UNAVAILABLE", "Service unavailable."));
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
public sealed class AdminCaringCommunityTrustTierController : ControllerBase
{
    private readonly TrustTierService _trustTiers;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityTrustTierController(TrustTierService trustTiers, TenantContext tenant)
    {
        _trustTiers = trustTiers;
        _tenant = tenant;
    }

    [HttpGet("trust-tier/config")]
    public async Task<IActionResult> GetConfig(CancellationToken ct)
    {
        var guard = await FeatureGuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var criteria = await _trustTiers.GetConfigAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data = new { criteria } });
    }

    [HttpPut("trust-tier/config")]
    public async Task<IActionResult> UpdateConfig([FromBody] TrustTierConfigRequest? request, CancellationToken ct)
    {
        var guard = await FeatureGuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        if (request?.Criteria is null || request.Criteria.Count == 0)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                CaringCommunityTrustTierController.LaravelError("VALIDATION_ERROR", "Field is required.", "criteria"));
        }

        try
        {
            var criteria = await _trustTiers.UpdateConfigAsync(
                _tenant.GetTenantIdOrThrow(),
                request.Criteria,
                ct);

            return Ok(new { data = new { criteria } });
        }
        catch (TrustTierValidationException ex)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                CaringCommunityTrustTierController.LaravelError("VALIDATION_ERROR", "Field is required.", ex.Field));
        }
    }

    [HttpPost("trust-tier/recompute")]
    public async Task<IActionResult> Recompute(CancellationToken ct)
    {
        var guard = await FeatureGuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        if (!_trustTiers.IsAvailable())
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                CaringCommunityTrustTierController.LaravelError("FEATURE_UNAVAILABLE", "Service unavailable."));
        }

        var updated = await _trustTiers.RecomputeAllAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data = new { updated } });
    }

    private async Task<IActionResult?> FeatureGuardAsync(CancellationToken ct)
    {
        if (!await _trustTiers.IsFeatureEnabledAsync(_tenant.GetTenantIdOrThrow(), ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                CaringCommunityTrustTierController.LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        return null;
    }
}
