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
[Route("api/caring-community/projects")]
[Authorize]
public sealed class CaringCommunityProjectsController : ControllerBase
{
    private readonly ProjectAnnouncementService _projects;
    private readonly TenantContext _tenant;

    public CaringCommunityProjectsController(ProjectAnnouncementService projects, TenantContext tenant)
    {
        _projects = projects;
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

        var data = await _projects.ListPublishedAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data });
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Show(int id, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var viewerId = User.GetUserId();
        var data = await _projects.GetProjectAsync(
            _tenant.GetTenantIdOrThrow(),
            id,
            includeDrafts: false,
            viewerId,
            ct);

        if (data is null)
        {
            return NotFound(LaravelError("NOT_FOUND", "Project not found."));
        }

        return Ok(new { data });
    }

    [HttpPost("{id:int}/subscribe")]
    public async Task<IActionResult> Subscribe(int id, CancellationToken ct)
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

        var result = await _projects.SubscribeAsync(_tenant.GetTenantIdOrThrow(), id, userId.Value, ct);
        if (result.NotFound)
        {
            return NotFound(LaravelError("SERVICE_ERROR", "Project not found."));
        }

        return Ok(new { data = new { ok = true } });
    }

    [HttpDelete("{id:int}/subscribe")]
    public async Task<IActionResult> Unsubscribe(int id, CancellationToken ct)
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

        await _projects.UnsubscribeAsync(_tenant.GetTenantIdOrThrow(), id, userId.Value, ct);
        return Ok(new { data = new { ok = true } });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _projects.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        if (!await _projects.IsAvailableAsync(ct))
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                LaravelError("SERVICE_UNAVAILABLE", "Project announcements are unavailable."));
        }

        return null;
    }

    public static object LaravelError(string code, string message)
    {
        return new { errors = new[] { new { code, message } } };
    }
}

[ApiController]
[Route("api/admin/caring-community/projects")]
[Authorize]
public sealed class AdminCaringCommunityProjectsController : ControllerBase
{
    private readonly ProjectAnnouncementService _projects;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityProjectsController(ProjectAnnouncementService projects, TenantContext tenant)
    {
        _projects = projects;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> Index([FromQuery] string? status = null, CancellationToken ct = default)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        if (!ProjectAnnouncementService.IsProjectStatus(status))
        {
            status = null;
        }

        var data = await _projects.ListAdminAsync(_tenant.GetTenantIdOrThrow(), status, ct);
        return Ok(new { data });
    }

    [HttpPost]
    public async Task<IActionResult> Store([FromBody] ProjectAnnouncementRequest request, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var userId = User.GetUserId();
        if (userId is null)
        {
            return Unauthorized(CaringCommunityProjectsController.LaravelError(
                "AUTH_REQUIRED",
                "Authentication required."));
        }

        var validation = ValidateProjectRequest(request, creating: true);
        if (validation is not null)
        {
            return UnprocessableEntity(validation);
        }

        var result = await _projects.CreateProjectAsync(_tenant.GetTenantIdOrThrow(), userId.Value, request, ct);
        return StatusCode(StatusCodes.Status201Created, new { data = result.Row });
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> Show(int id, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _projects.GetProjectAsync(
            _tenant.GetTenantIdOrThrow(),
            id,
            includeDrafts: true,
            viewerId: null,
            ct);

        if (data is null)
        {
            return NotFound(CaringCommunityProjectsController.LaravelError(
                "NOT_FOUND",
                "Project announcement not found."));
        }

        return Ok(new { data });
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Update(
        int id,
        [FromBody] ProjectAnnouncementRequest request,
        CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var validation = ValidateProjectRequest(request, creating: false);
        if (validation is not null)
        {
            return UnprocessableEntity(validation);
        }

        var result = await _projects.UpdateProjectAsync(_tenant.GetTenantIdOrThrow(), id, request, ct);
        if (result.NotFound)
        {
            return NotFound(CaringCommunityProjectsController.LaravelError(
                "SERVICE_ERROR",
                "Project announcement not found."));
        }

        return Ok(new { data = result.Row });
    }

    [HttpPost("{id:int}/publish")]
    public async Task<IActionResult> Publish(int id, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _projects.PublishProjectAsync(_tenant.GetTenantIdOrThrow(), id, ct);
        if (result.NotFound)
        {
            return NotFound(CaringCommunityProjectsController.LaravelError(
                "SERVICE_ERROR",
                "Project announcement not found."));
        }

        return Ok(new { data = result.Row });
    }

    [HttpPost("{id:int}/updates")]
    public async Task<IActionResult> CreateUpdate(
        int id,
        [FromBody] ProjectUpdateRequest request,
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
            return Unauthorized(CaringCommunityProjectsController.LaravelError(
                "AUTH_REQUIRED",
                "Authentication required."));
        }

        var validation = ValidateUpdateRequest(request);
        if (validation is not null)
        {
            return UnprocessableEntity(validation);
        }

        var result = await _projects.CreateUpdateAsync(_tenant.GetTenantIdOrThrow(), id, userId.Value, request, ct);
        if (result.NotFound)
        {
            return NotFound(CaringCommunityProjectsController.LaravelError(
                "SERVICE_ERROR",
                "Project announcement not found."));
        }

        return StatusCode(StatusCodes.Status201Created, new { data = result.Row });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _projects.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                CaringCommunityProjectsController.LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        if (!await _projects.IsAvailableAsync(ct))
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                CaringCommunityProjectsController.LaravelError(
                    "SERVICE_UNAVAILABLE",
                    "Project announcements are unavailable."));
        }

        return null;
    }

    internal static object? ValidateProjectRequest(ProjectAnnouncementRequest request, bool creating)
    {
        if (creating && string.IsNullOrWhiteSpace(request.Title))
        {
            return CaringCommunityProjectsController.LaravelError(
                "VALIDATION_ERROR",
                "Project title is required.");
        }

        if (request.Title is not null && string.IsNullOrWhiteSpace(request.Title))
        {
            return CaringCommunityProjectsController.LaravelError(
                "VALIDATION_ERROR",
                "Project title is required.");
        }

        if (request.Status is not null && !ProjectAnnouncementService.IsProjectStatus(request.Status))
        {
            return CaringCommunityProjectsController.LaravelError(
                "VALIDATION_ERROR",
                "Project status is not valid.");
        }

        if (request.ProgressPercent is < 0 or > 100)
        {
            return CaringCommunityProjectsController.LaravelError(
                "VALIDATION_ERROR",
                "Project progress is not valid.");
        }

        if (!IsValidDateOrBlank(request.StartsAt) || !IsValidDateOrBlank(request.EndsAt))
        {
            return CaringCommunityProjectsController.LaravelError(
                "VALIDATION_ERROR",
                "Project date is not valid.");
        }

        return null;
    }

    internal static object? ValidateUpdateRequest(ProjectUpdateRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Title))
        {
            return CaringCommunityProjectsController.LaravelError(
                "VALIDATION_ERROR",
                "Project title is required.");
        }

        if (request.Status is not null && !ProjectAnnouncementService.IsUpdateStatus(request.Status))
        {
            return CaringCommunityProjectsController.LaravelError(
                "VALIDATION_ERROR",
                "Project status is not valid.");
        }

        if (request.ProgressPercent is < 0 or > 100)
        {
            return CaringCommunityProjectsController.LaravelError(
                "VALIDATION_ERROR",
                "Project progress is not valid.");
        }

        return null;
    }

    private static bool IsValidDateOrBlank(string? value)
    {
        return string.IsNullOrWhiteSpace(value) || ProjectAnnouncementService.DateOrNull(value) is not null;
    }
}

[ApiController]
[Route("api/admin/caring-community/project-updates")]
[Authorize]
public sealed class AdminCaringCommunityProjectUpdatesController : ControllerBase
{
    private readonly ProjectAnnouncementService _projects;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityProjectUpdatesController(ProjectAnnouncementService projects, TenantContext tenant)
    {
        _projects = projects;
        _tenant = tenant;
    }

    [HttpPost("{id:int}/publish")]
    public async Task<IActionResult> Publish(int id, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _projects.PublishUpdateAsync(_tenant.GetTenantIdOrThrow(), id, ct);
        if (result.NotFound)
        {
            return NotFound(CaringCommunityProjectsController.LaravelError(
                "SERVICE_ERROR",
                "Project update not found."));
        }

        return Ok(new { data = result.Row });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _projects.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                CaringCommunityProjectsController.LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        if (!await _projects.IsAvailableAsync(ct))
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                CaringCommunityProjectsController.LaravelError(
                    "SERVICE_UNAVAILABLE",
                    "Project announcements are unavailable."));
        }

        return null;
    }
}
