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
[Route("api/admin/caring-community/commercial-boundary")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunityCommercialBoundaryController : ControllerBase
{
    private readonly CommercialBoundaryService _boundary;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityCommercialBoundaryController(
        CommercialBoundaryService boundary,
        TenantContext tenant)
    {
        _boundary = boundary;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> Matrix(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _boundary.MatrixAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data });
    }

    [HttpPut("override")]
    public async Task<IActionResult> SetOverride(
        [FromBody] CommercialBoundaryOverrideRequest request,
        CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        if (string.IsNullOrWhiteSpace(request.CapabilityKey))
        {
            return UnprocessableEntity(LaravelError(
                "VALIDATION_REQUIRED_FIELD",
                "capability_key is required",
                "capability_key"));
        }

        if (!CommercialBoundaryService.TryReadClassification(request.Classification, out var classification))
        {
            return UnprocessableEntity(LaravelError(
                "VALIDATION_INVALID",
                "classification must be a string or null",
                "classification"));
        }

        var result = await _boundary.SetOverrideAsync(
            _tenant.GetTenantIdOrThrow(),
            request.CapabilityKey,
            classification,
            ct);

        if (result.Errors?.Count > 0)
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

        return Ok(new { data = result.Matrix });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _boundary.IsFeatureEnabledAsync(tenantId, ct))
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
