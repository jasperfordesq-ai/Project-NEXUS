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
[Route("api/caring-community/providers")]
[Authorize]
public sealed class CaringCommunityProvidersController : ControllerBase
{
    private readonly CareProviderDirectoryService _providers;
    private readonly TenantContext _tenant;

    public CaringCommunityProvidersController(CareProviderDirectoryService providers, TenantContext tenant)
    {
        _providers = providers;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> Index(
        [FromQuery] string? type = null,
        [FromQuery] string? search = null,
        [FromQuery(Name = "sub_region_id")] int? subRegionId = null,
        [FromQuery(Name = "verified_only")] bool verifiedOnly = false,
        [FromQuery] int page = 1,
        CancellationToken ct = default)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _providers.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        var rows = await _providers.ListAsync(tenantId, type, search, subRegionId, verifiedOnly, page, ct);
        return Ok(new { data = rows });
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Show(int id, CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _providers.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        var row = await _providers.GetActiveAsync(tenantId, id, ct);
        if (row is null)
        {
            return NotFound(LaravelError("NOT_FOUND", "Resource not found."));
        }

        return Ok(new { data = row });
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
[Route("api/admin/caring-community/providers")]
[Authorize]
public sealed class AdminCaringCommunityProvidersController : ControllerBase
{
    private readonly CareProviderDirectoryService _providers;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityProvidersController(CareProviderDirectoryService providers, TenantContext tenant)
    {
        _providers = providers;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> Index([FromQuery] int page = 1, CancellationToken ct = default)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var rows = await _providers.AdminListAsync(_tenant.GetTenantIdOrThrow(), page, ct);
        return Ok(new { data = rows });
    }

    [HttpGet("duplicates")]
    public async Task<IActionResult> Duplicates([FromQuery] decimal threshold = 0.65m, CancellationToken ct = default)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var report = await _providers.FindPotentialDuplicatesAsync(_tenant.GetTenantIdOrThrow(), threshold, ct);
        return Ok(new { data = report });
    }

    [HttpPost]
    public async Task<IActionResult> Store([FromBody] CaringCareProviderRequest request, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var userId = User.GetUserId();
        if (userId is null)
        {
            return Unauthorized(CaringCommunityProvidersController.LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        var result = await _providers.CreateAsync(_tenant.GetTenantIdOrThrow(), request, userId.Value, ct);
        if (result.ErrorCode is not null)
        {
            return UnprocessableEntity(CaringCommunityProvidersController.LaravelError(
                result.ErrorCode,
                result.ErrorMessage ?? "Validation failed.",
                result.ErrorField));
        }

        return StatusCode(StatusCodes.Status201Created, new { data = result.Row });
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] CaringCareProviderRequest request, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _providers.UpdateAsync(_tenant.GetTenantIdOrThrow(), id, request, ct);
        if (result.NotFound)
        {
            return NotFound(CaringCommunityProvidersController.LaravelError("NOT_FOUND", "Resource not found."));
        }

        if (result.ErrorCode is not null)
        {
            return UnprocessableEntity(CaringCommunityProvidersController.LaravelError(
                result.ErrorCode,
                result.ErrorMessage ?? "Validation failed.",
                result.ErrorField));
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

        var result = await _providers.DeleteAsync(_tenant.GetTenantIdOrThrow(), id, ct);
        if (result.NotFound)
        {
            return NotFound(CaringCommunityProvidersController.LaravelError("NOT_FOUND", "Resource not found."));
        }

        return Ok(new { data = new { deleted = true } });
    }

    [HttpPost("{id:int}/verify")]
    public async Task<IActionResult> Verify(int id, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _providers.VerifyAsync(_tenant.GetTenantIdOrThrow(), id, ct);
        if (result.NotFound)
        {
            return NotFound(CaringCommunityProvidersController.LaravelError("NOT_FOUND", "Resource not found."));
        }

        return Ok(new { data = new { verified = true } });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        if (!User.IsAdmin())
        {
            return Forbid();
        }

        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _providers.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                CaringCommunityProvidersController.LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        return null;
    }
}
