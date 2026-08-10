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
[Route("api/caring-community/sub-regions")]
[Authorize]
public sealed class CaringCommunitySubRegionsController : ControllerBase
{
    private readonly CaringSubRegionService _subRegions;
    private readonly TenantContext _tenant;

    public CaringCommunitySubRegionsController(CaringSubRegionService subRegions, TenantContext tenant)
    {
        _subRegions = subRegions;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> Index(
        [FromQuery] string? type = null,
        [FromQuery] string? search = null,
        [FromQuery] int page = 1,
        CancellationToken ct = default)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _subRegions.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        var rows = await _subRegions.ListAsync(tenantId, type, search, page, admin: false, ct);
        return Ok(new { data = rows });
    }

    public static object LaravelError(string code, string message, string? field = null)
    {
        var error = new Dictionary<string, object?>
        {
            ["code"] = code,
            ["message"] = message
        };
        if (field is not null) error["field"] = field;
        return new { errors = new[] { error } };
    }
}

[ApiController]
[Route("api/admin/caring-community/sub-regions")]
[Authorize]
public sealed class AdminCaringCommunitySubRegionsController : ControllerBase
{
    private readonly CaringSubRegionService _subRegions;
    private readonly TenantContext _tenant;

    public AdminCaringCommunitySubRegionsController(CaringSubRegionService subRegions, TenantContext tenant)
    {
        _subRegions = subRegions;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> Index(
        [FromQuery] string? type = null,
        [FromQuery] string? search = null,
        [FromQuery] int page = 1,
        CancellationToken ct = default)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var rows = await _subRegions.ListAsync(
            _tenant.GetTenantIdOrThrow(),
            type,
            search,
            page,
            admin: true,
            ct);
        return Ok(new { data = rows });
    }

    [HttpPost]
    public async Task<IActionResult> Store([FromBody] CaringSubRegionRequest request, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var userId = User.GetUserId();
        if (userId is null)
        {
            return Unauthorized(CaringCommunitySubRegionsController.LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        var result = await _subRegions.CreateAsync(_tenant.GetTenantIdOrThrow(), request, userId.Value, ct);
        if (result.ErrorCode is not null)
        {
            return UnprocessableEntity(CaringCommunitySubRegionsController.LaravelError(
                result.ErrorCode,
                result.ErrorMessage ?? "Validation failed."));
        }

        return StatusCode(StatusCodes.Status201Created, new { data = result.Row });
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] CaringSubRegionRequest request, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _subRegions.UpdateAsync(_tenant.GetTenantIdOrThrow(), id, request, ct);
        if (result.NotFound)
        {
            return NotFound(CaringCommunitySubRegionsController.LaravelError("NOT_FOUND", "Resource not found."));
        }

        if (result.ErrorCode is not null)
        {
            return UnprocessableEntity(CaringCommunitySubRegionsController.LaravelError(
                result.ErrorCode,
                result.ErrorMessage ?? "Validation failed."));
        }

        return Ok(new { data = result.Row });
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Destroy(int id, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _subRegions.DeleteAsync(_tenant.GetTenantIdOrThrow(), id, ct);
        if (result.NotFound)
        {
            return NotFound(CaringCommunitySubRegionsController.LaravelError("NOT_FOUND", "Resource not found."));
        }

        return Ok(new { data = new { deleted = true } });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        if (!User.IsAdmin())
        {
            return Forbid();
        }

        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _subRegions.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                CaringCommunitySubRegionsController.LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        return null;
    }
}
