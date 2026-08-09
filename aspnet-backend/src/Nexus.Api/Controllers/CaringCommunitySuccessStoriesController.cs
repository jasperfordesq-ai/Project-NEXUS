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
[Route("api/caring-community/success-stories")]
[Authorize]
public sealed class CaringCommunitySuccessStoriesController : ControllerBase
{
    private readonly SuccessStoryService _stories;
    private readonly TenantContext _tenant;

    public CaringCommunitySuccessStoriesController(SuccessStoryService stories, TenantContext tenant)
    {
        _stories = stories;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _stories.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Caring Community feature is not enabled for this tenant."));
        }

        var data = await _stories.ListPublishedAsync(tenantId, ct);
        return Ok(new { data });
    }

    public static object LaravelError(string code, string message, string? field = null)
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
[Route("api/admin/caring-community/success-stories")]
[Authorize]
public sealed class AdminCaringCommunitySuccessStoriesController : ControllerBase
{
    private readonly SuccessStoryService _stories;
    private readonly TenantContext _tenant;

    public AdminCaringCommunitySuccessStoriesController(SuccessStoryService stories, TenantContext tenant)
    {
        _stories = stories;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> Index(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _stories.ListAdminAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data });
    }

    [HttpPost]
    public async Task<IActionResult> Store([FromBody] SuccessStoryRequest request, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _stories.CreateAsync(_tenant.GetTenantIdOrThrow(), request, ct);
        if (result.Errors is { Count: > 0 })
        {
            return UnprocessableEntity(new { errors = result.Errors });
        }

        return StatusCode(StatusCodes.Status201Created, new { data = new { story = result.Story } });
    }

    [HttpPost("seed-demo")]
    public async Task<IActionResult> SeedDemo(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _stories.SeedDemoAsync(_tenant.GetTenantIdOrThrow(), ct);
        if (result.AlreadySeeded)
        {
            return StatusCode(StatusCodes.Status409Conflict,
                CaringCommunitySuccessStoriesController.LaravelError(
                    "ALREADY_SEEDED",
                    "Success stories already exist for this tenant."));
        }

        return Ok(new
        {
            data = new
            {
                items = result.Items ?? [],
                last_updated_at = result.LastUpdatedAt
            }
        });
    }

    [HttpPut("{storyId}")]
    public async Task<IActionResult> Update(
        string storyId,
        [FromBody] SuccessStoryRequest request,
        CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _stories.UpdateAsync(_tenant.GetTenantIdOrThrow(), storyId, request, ct);
        if (result.NotFound)
        {
            return NotFound(CaringCommunitySuccessStoriesController.LaravelError("NOT_FOUND", "Success story not found."));
        }

        if (result.Errors is { Count: > 0 })
        {
            return UnprocessableEntity(new { errors = result.Errors });
        }

        return Ok(new { data = new { story = result.Story } });
    }

    [HttpDelete("{storyId}")]
    public async Task<IActionResult> Destroy(string storyId, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _stories.DeleteAsync(_tenant.GetTenantIdOrThrow(), storyId, ct);
        if (result.NotFound)
        {
            return NotFound(CaringCommunitySuccessStoriesController.LaravelError("NOT_FOUND", "Success story not found."));
        }

        return Ok(new { data = new { ok = true } });
    }

    [HttpPost("{storyId}/refresh-live")]
    public async Task<IActionResult> RefreshLive(string storyId, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _stories.RefreshLiveMetricAsync(_tenant.GetTenantIdOrThrow(), storyId, ct);
        if (result.NotFound)
        {
            return NotFound(CaringCommunitySuccessStoriesController.LaravelError("NOT_FOUND", "Success story not found."));
        }

        if (result.ErrorCode is "MANUAL_METRIC")
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                CaringCommunitySuccessStoriesController.LaravelError(result.ErrorCode, result.ErrorMessage ?? "Metric cannot be refreshed."));
        }

        if (result.ErrorCode is not null)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                CaringCommunitySuccessStoriesController.LaravelError(result.ErrorCode, result.ErrorMessage ?? "Metric unavailable."));
        }

        return Ok(new { data = new { story = result.Story } });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        if (!User.IsAdmin())
        {
            return Forbid();
        }

        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _stories.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                CaringCommunitySuccessStoriesController.LaravelError(
                    "FEATURE_DISABLED",
                    "Caring Community feature is not enabled for this tenant."));
        }

        return null;
    }
}
