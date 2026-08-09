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
[Route("api/admin/caring-community")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunitySupportController : ControllerBase
{
    private readonly CaringHelpRequestSlaService _sla;
    private readonly CaringSupportRelationshipService _relationships;
    private readonly TenantContext _tenant;

    public AdminCaringCommunitySupportController(
        CaringHelpRequestSlaService sla,
        CaringSupportRelationshipService relationships,
        TenantContext tenant)
    {
        _sla = sla;
        _relationships = relationships;
        _tenant = tenant;
    }

    [HttpGet("sla-dashboard")]
    public async Task<IActionResult> SlaDashboard(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _sla.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FORBIDDEN", "Caring Community feature is not enabled for this tenant."));
        }

        return Ok(new { data = await _sla.DashboardAsync(tenantId, ct) });
    }

    [HttpGet("support-relationships")]
    public async Task<IActionResult> SupportRelationships([FromQuery] string? status, CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _relationships.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        return Ok(new { data = await _relationships.ListAsync(tenantId, status, ct) });
    }

    [HttpPost("support-relationships")]
    public async Task<IActionResult> CreateSupportRelationship(
        [FromBody] Dictionary<string, object?>? request,
        CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _relationships.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        var result = await _relationships.CreateAsync(
            tenantId,
            User.GetUserId() ?? 0,
            request,
            ct);

        if (!result.Succeeded)
        {
            var code = result.ErrorCode ?? "VALIDATION_ERROR";
            var message = code == "USER_NOT_FOUND"
                ? "User not found"
                : "Support relationship could not be created.";
            return StatusCode(StatusCodes.Status422UnprocessableEntity, LaravelError(code, message));
        }

        return StatusCode(StatusCodes.Status201Created, new { data = result.Relationship });
    }

    [HttpPut("support-relationships/{id}")]
    public async Task<IActionResult> UpdateSupportRelationship(
        int id,
        [FromBody] Dictionary<string, object?>? request,
        CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _relationships.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        var result = await _relationships.UpdateAsync(tenantId, id, request, ct);
        if (!result.Succeeded)
        {
            return StatusCode(StatusCodes.Status404NotFound,
                LaravelError("NOT_FOUND", "Support relationship not found."));
        }

        return Ok(new { data = result.Relationship });
    }

    [HttpPost("support-relationships/{id}/hours")]
    public async Task<IActionResult> LogSupportRelationshipHours(
        int id,
        [FromBody] Dictionary<string, object?>? request,
        CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _relationships.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        var result = await _relationships.LogHoursAsync(
            tenantId,
            id,
            User.GetUserId() ?? 0,
            request,
            ct);

        if (!result.Succeeded)
        {
            var code = result.ErrorCode ?? "VALIDATION_ERROR";
            var message = code switch
            {
                "NOT_FOUND" => "Support relationship not found.",
                "RELATIONSHIP_INACTIVE" => "Support relationship is not active.",
                "ALREADY_EXISTS" => "Support hours have already been logged for this relationship and date.",
                _ => "Support hours could not be logged."
            };
            var status = code switch
            {
                "NOT_FOUND" => StatusCodes.Status404NotFound,
                "SERVER_ERROR" => StatusCodes.Status500InternalServerError,
                _ => StatusCodes.Status422UnprocessableEntity
            };
            return StatusCode(status, LaravelError(code, message));
        }

        return StatusCode(StatusCodes.Status201Created, new { data = result.Payload });
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
