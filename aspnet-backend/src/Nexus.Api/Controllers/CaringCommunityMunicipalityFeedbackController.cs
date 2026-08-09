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
[Route("api/caring-community/feedback")]
[Authorize]
public sealed class CaringCommunityMunicipalityFeedbackController : ControllerBase
{
    private readonly MunicipalityFeedbackService _feedback;
    private readonly TenantContext _tenant;

    public CaringCommunityMunicipalityFeedbackController(
        MunicipalityFeedbackService feedback,
        TenantContext tenant)
    {
        _feedback = feedback;
        _tenant = tenant;
    }

    [HttpPost]
    public async Task<IActionResult> Submit([FromBody] MunicipalityFeedbackRequest request, CancellationToken ct)
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

        var result = await _feedback.SubmitAsync(_tenant.GetTenantIdOrThrow(), userId.Value, request, ct);
        if (result.Errors is { Count: > 0 })
        {
            return UnprocessableEntity(new { errors = result.Errors });
        }

        return StatusCode(StatusCodes.Status201Created, new { data = result.Row });
    }

    [HttpGet("mine")]
    public async Task<IActionResult> Mine([FromQuery] int limit = 50, CancellationToken ct = default)
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

        var data = await _feedback.ListForMemberAsync(_tenant.GetTenantIdOrThrow(), userId.Value, limit, ct);
        return Ok(new { data });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _feedback.IsFeatureEnabledAsync(tenantId, ct))
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
