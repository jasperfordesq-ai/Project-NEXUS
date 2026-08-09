// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/admin/caring-community/kpi-baselines")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunityKpiBaselinesController : ControllerBase
{
    private readonly CaringKpiBaselineService _baselines;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityKpiBaselinesController(
        CaringKpiBaselineService baselines,
        TenantContext tenant)
    {
        _baselines = baselines;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> List(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _baselines.ListBaselinesAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data });
    }

    [HttpPost]
    public async Task<IActionResult> Capture([FromBody] JsonElement payload, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _baselines.CaptureBaselineAsync(
            _tenant.GetTenantIdOrThrow(),
            CurrentUserId(),
            payload,
            ct);

        return StatusCode(StatusCodes.Status201Created, new { data });
    }

    [HttpGet("{id}/compare")]
    public async Task<IActionResult> Compare(long id, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _baselines.CompareWithBaselineAsync(id, _tenant.GetTenantIdOrThrow(), ct);
        if (data is null)
        {
            return StatusCode(StatusCodes.Status404NotFound, LaravelError("NOT_FOUND", "Not found."));
        }

        return Ok(new { data });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _baselines.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        return null;
    }

    private int? CurrentUserId()
    {
        var raw = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub")
            ?? User.FindFirstValue("user_id");

        return int.TryParse(raw, out var id) ? id : null;
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
