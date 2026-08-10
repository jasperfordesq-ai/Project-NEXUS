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
[Route("api/admin/caring-community/feedback")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunityMunicipalityFeedbackController : ControllerBase
{
    private readonly MunicipalityFeedbackService _feedback;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityMunicipalityFeedbackController(
        MunicipalityFeedbackService feedback,
        TenantContext tenant)
    {
        _feedback = feedback;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> Index(
        [FromQuery] string? status = null,
        [FromQuery] string? category = null,
        [FromQuery(Name = "sub_region_id")] string? subRegionId = null,
        [FromQuery] int page = 1,
        [FromQuery(Name = "per_page")] int perPage = 25,
        CancellationToken ct = default)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _feedback.ListForAdminAsync(
            _tenant.GetTenantIdOrThrow(),
            status,
            category,
            subRegionId,
            page,
            perPage,
            ct);

        return Ok(new { data = result.Items, meta = result.Meta });
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Show(int id, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var row = await _feedback.ShowAsync(_tenant.GetTenantIdOrThrow(), id, adminContext: true, ct);
        if (row is null)
        {
            return NotFound(LaravelError("NOT_FOUND", "Not found."));
        }

        return Ok(new { data = row });
    }

    [HttpPut("{id:int}/triage")]
    public async Task<IActionResult> Triage(
        int id,
        [FromBody] MunicipalityFeedbackTriageRequest request,
        CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _feedback.TriageAsync(_tenant.GetTenantIdOrThrow(), id, request, ct);
        return MutationResponse(result);
    }

    [HttpPost("{id:int}/resolve")]
    public async Task<IActionResult> Resolve(
        int id,
        [FromBody] MunicipalityFeedbackResolveRequest request,
        CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _feedback.ResolveAsync(_tenant.GetTenantIdOrThrow(), id, request, ct);
        return MutationResponse(result);
    }

    [HttpPost("{id:int}/close")]
    public async Task<IActionResult> Close(int id, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _feedback.CloseAsync(_tenant.GetTenantIdOrThrow(), id, ct);
        return MutationResponse(result);
    }

    [HttpGet("dashboard")]
    public async Task<IActionResult> Dashboard(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _feedback.DashboardStatsAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data });
    }

    [HttpGet("export.csv")]
    public async Task<IActionResult> ExportCsv(
        [FromQuery] string? status = null,
        [FromQuery] string? category = null,
        CancellationToken ct = default)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var csv = await _feedback.ExportCsvAsync(_tenant.GetTenantIdOrThrow(), status, category, ct);
        Response.Headers.CacheControl = "no-cache, no-store, must-revalidate";
        Response.Headers.ContentDisposition = "attachment; filename=\"municipality-feedback-export.csv\"";
        return Content(csv, "application/csv; charset=utf-8");
    }

    private IActionResult MutationResponse(MunicipalityFeedbackMutationResult result)
    {
        if (result.Errors is { Count: > 0 })
        {
            var status = result.Errors[0].Code == "NOT_FOUND"
                ? StatusCodes.Status404NotFound
                : StatusCodes.Status422UnprocessableEntity;

            return StatusCode(status, new { errors = result.Errors });
        }

        return Ok(new { data = result.Row });
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
