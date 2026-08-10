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
[Route("api/caring-community/caregiver")]
[Authorize]
public sealed class CaringCommunityCaregiverController : ControllerBase
{
    private readonly CaregiverSupportService _caregivers;
    private readonly TenantContext _tenant;

    public CaringCommunityCaregiverController(CaregiverSupportService caregivers, TenantContext tenant)
    {
        _caregivers = caregivers;
        _tenant = tenant;
    }

    [HttpGet("links")]
    public async Task<IActionResult> MyLinks(CancellationToken ct)
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

        var data = await _caregivers.GetLinksForCaregiverAsync(_tenant.GetTenantIdOrThrow(), userId.Value, ct);
        return Ok(new { data });
    }

    [HttpPost("links")]
    public async Task<IActionResult> AddLink([FromBody] CaregiverLinkRequest request, CancellationToken ct)
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

        var result = await _caregivers.CreateLinkAsync(_tenant.GetTenantIdOrThrow(), userId.Value, request, ct);
        if (result.ErrorCode == "VALIDATION_ERROR")
        {
            return UnprocessableEntity(LaravelError(
                result.ErrorCode,
                result.ErrorMessage ?? "Validation failed.",
                result.ErrorField));
        }

        if (result.ErrorCode == "CONFLICT")
        {
            return StatusCode(StatusCodes.Status409Conflict,
                LaravelError(result.ErrorCode, result.ErrorMessage ?? "Caregiver link conflict."));
        }

        return StatusCode(StatusCodes.Status202Accepted, new { data = result.Row });
    }

    [HttpDelete("links/{id:int}")]
    public async Task<IActionResult> RemoveLink(int id, CancellationToken ct)
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

        var result = await _caregivers.RemoveLinkAsync(_tenant.GetTenantIdOrThrow(), userId.Value, id, ct);
        if (result.NotFound)
        {
            return NotFound(LaravelError("NOT_FOUND", "Caregiver link not found."));
        }

        return NoContent();
    }

    [HttpGet("schedule/{caredForId:int}")]
    public async Task<IActionResult> CaregiverSchedule(int caredForId, CancellationToken ct)
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
        if (!await _caregivers.HasActiveLinkAsync(tenantId, userId.Value, caredForId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FORBIDDEN", "Active caregiver link required."));
        }

        var data = await _caregivers.GetScheduleForCaredForAsync(tenantId, caredForId, ct);
        return Ok(new { data });
    }

    [HttpGet("burnout-check")]
    public async Task<IActionResult> BurnoutCheck(CancellationToken ct)
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

        var data = await _caregivers.CheckBurnoutRiskAsync(
            _tenant.GetTenantIdOrThrow(),
            userId.Value,
            ct);
        return Ok(new { data });
    }

    [HttpPost("request-on-behalf")]
    public async Task<IActionResult> RequestOnBehalf(
        [FromBody] Dictionary<string, object?>? request,
        CancellationToken ct)
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

        var result = await _caregivers.CreateRequestOnBehalfAsync(
            _tenant.GetTenantIdOrThrow(),
            userId.Value,
            request ?? new Dictionary<string, object?>(),
            ct);

        if (result.ErrorCode == "VALIDATION_ERROR")
        {
            return UnprocessableEntity(LaravelError(
                result.ErrorCode,
                result.ErrorMessage ?? "Validation failed.",
                result.ErrorField));
        }

        if (result.ErrorCode == "FORBIDDEN")
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError(result.ErrorCode, result.ErrorMessage ?? "Active caregiver link required."));
        }

        return StatusCode(StatusCodes.Status201Created, new { data = result.Row });
    }

    [HttpGet("cover-requests")]
    public async Task<IActionResult> CoverRequests(CancellationToken ct)
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

        if (!_caregivers.CoverRequestsAvailable())
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                LaravelError("FEATURE_UNAVAILABLE", "Caregiver cover requests are unavailable."));
        }

        var data = await _caregivers.GetCoverRequestsForCaregiverAsync(
            _tenant.GetTenantIdOrThrow(),
            userId.Value,
            ct);
        return Ok(new { data });
    }

    [HttpPost("cover-requests")]
    public async Task<IActionResult> CreateCoverRequest(
        [FromBody] Dictionary<string, object?>? request,
        CancellationToken ct)
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

        if (!_caregivers.CoverRequestsAvailable())
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                LaravelError("FEATURE_UNAVAILABLE", "Caregiver cover requests are unavailable."));
        }

        var result = await _caregivers.CreateCoverRequestAsync(
            _tenant.GetTenantIdOrThrow(),
            userId.Value,
            request ?? new Dictionary<string, object?>(),
            ct);

        if (result.ErrorCode == "VALIDATION_ERROR")
        {
            return UnprocessableEntity(LaravelError(
                result.ErrorCode,
                result.ErrorMessage ?? "Validation failed.",
                result.ErrorField));
        }

        if (result.ErrorCode == "FORBIDDEN")
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError(result.ErrorCode, result.ErrorMessage ?? "Active caregiver link required."));
        }

        return StatusCode(StatusCodes.Status201Created, new { data = result.Row });
    }

    [HttpGet("cover-requests/{id:int}/candidates")]
    public async Task<IActionResult> CoverCandidates(int id, CancellationToken ct)
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

        if (!_caregivers.CoverRequestsAvailable())
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                LaravelError("FEATURE_UNAVAILABLE", "Caregiver cover requests are unavailable."));
        }

        var result = await _caregivers.SuggestCoverCandidatesAsync(
            _tenant.GetTenantIdOrThrow(),
            userId.Value,
            id,
            ct);
        if (result.NotFound)
        {
            return NotFound(LaravelError("NOT_FOUND", "Cover request not found."));
        }

        return Ok(new { data = result.Rows ?? [] });
    }

    [HttpPost("cover-requests/{id:int}/assign")]
    public async Task<IActionResult> AssignCoverCandidate(
        int id,
        [FromBody] Dictionary<string, object?>? request,
        CancellationToken ct)
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

        if (!_caregivers.CoverRequestsAvailable())
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                LaravelError("FEATURE_UNAVAILABLE", "Caregiver cover requests are unavailable."));
        }

        var result = await _caregivers.AssignCoverCandidateAsync(
            _tenant.GetTenantIdOrThrow(),
            userId.Value,
            id,
            request ?? new Dictionary<string, object?>(),
            ct);

        if (result.ErrorCode == "VALIDATION_ERROR")
        {
            return UnprocessableEntity(LaravelError(
                result.ErrorCode,
                result.ErrorMessage ?? "Validation failed.",
                result.ErrorField));
        }

        if (result.ErrorCode == "NOT_FOUND")
        {
            return NotFound(LaravelError(result.ErrorCode, result.ErrorMessage ?? "Cover request not found."));
        }

        return Ok(new { data = result.Row });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _caregivers.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        if (!_caregivers.IsAvailable())
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                LaravelError("FEATURE_UNAVAILABLE", "Service unavailable."));
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
