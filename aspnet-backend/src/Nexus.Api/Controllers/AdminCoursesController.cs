// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/admin/courses")]
[Route("api/v2/admin/courses")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCoursesController : ControllerBase
{
    private readonly AdminCoursesService _courses;
    private readonly TenantContext _tenant;

    public AdminCoursesController(AdminCoursesService courses, TenantContext tenant)
    {
        _courses = courses;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> Index([FromQuery(Name = "moderation_status")] string? moderationStatus, CancellationToken ct)
    {
        var rows = await _courses.ListCoursesAsync(_tenant.GetTenantIdOrThrow(), moderationStatus, ct);
        return Ok(new { data = rows });
    }

    [HttpGet("analytics")]
    public async Task<IActionResult> Analytics(CancellationToken ct)
    {
        var data = await _courses.AnalyticsAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data });
    }

    [HttpPost("{id:int}/moderate")]
    public async Task<IActionResult> Moderate(
        int id,
        [FromBody] AdminCourseModerationRequest request,
        CancellationToken ct)
    {
        try
        {
            var course = await _courses.ModerateAsync(
                _tenant.GetTenantIdOrThrow(),
                id,
                UserId(),
                request.Action,
                request.Notes,
                ct);

            return Ok(new { data = course });
        }
        catch (AdminCoursesValidationException ex)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity, LaravelError("VALIDATION_FAILED", ex.Message, "action"));
        }
        catch (AdminCoursesNotFoundException ex)
        {
            return StatusCode(StatusCodes.Status404NotFound, LaravelError("RESOURCE_NOT_FOUND", ex.Message));
        }
    }

    [HttpGet("instructors")]
    public async Task<IActionResult> ListInstructors(CancellationToken ct)
    {
        var rows = await _courses.ListInstructorsAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data = rows });
    }

    [HttpPost("instructors")]
    public async Task<IActionResult> GrantInstructor(
        [FromBody] AdminCourseInstructorRequest request,
        CancellationToken ct)
    {
        try
        {
            var grant = await _courses.GrantInstructorAsync(
                _tenant.GetTenantIdOrThrow(),
                request.UserId,
                UserId(),
                ct);

            return StatusCode(StatusCodes.Status201Created, new { data = grant });
        }
        catch (AdminCoursesValidationException ex)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity, LaravelError("VALIDATION_FAILED", ex.Message, "user_id"));
        }
    }

    [HttpDelete("instructors/{userId:int}")]
    public async Task<IActionResult> RevokeInstructor(int userId, CancellationToken ct)
    {
        await _courses.RevokeInstructorAsync(_tenant.GetTenantIdOrThrow(), userId, ct);
        return Ok(new { data = new { revoked = true } });
    }

    [HttpPost("categories")]
    public async Task<IActionResult> StoreCategory(
        [FromBody] AdminCourseCategoryRequest request,
        CancellationToken ct)
    {
        try
        {
            var category = await _courses.StoreCategoryAsync(_tenant.GetTenantIdOrThrow(), request, ct);
            return StatusCode(StatusCodes.Status201Created, new { data = category });
        }
        catch (AdminCoursesValidationException ex)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity, LaravelError("VALIDATION_FAILED", ex.Message, "name"));
        }
    }

    [HttpPut("categories/{id:int}")]
    public async Task<IActionResult> UpdateCategory(
        int id,
        [FromBody] AdminCourseCategoryRequest request,
        CancellationToken ct)
    {
        try
        {
            var category = await _courses.UpdateCategoryAsync(_tenant.GetTenantIdOrThrow(), id, request, ct);
            return Ok(new { data = category });
        }
        catch (AdminCoursesNotFoundException ex)
        {
            return StatusCode(StatusCodes.Status404NotFound, LaravelError("RESOURCE_NOT_FOUND", ex.Message));
        }
    }

    [HttpDelete("categories/{id:int}")]
    public async Task<IActionResult> DeleteCategory(int id, CancellationToken ct)
    {
        await _courses.DeleteCategoryAsync(_tenant.GetTenantIdOrThrow(), id, ct);
        return Ok(new { data = new { deleted = true } });
    }

    private int UserId()
    {
        var id = User.FindFirstValue(ClaimTypes.NameIdentifier) ?? User.FindFirstValue("sub");
        return int.TryParse(id, out var parsed) ? parsed : 0;
    }

    private static object LaravelError(string code, string message, string? field = null)
    {
        return new
        {
            errors = new[]
            {
                new { code, message, field }
            }
        };
    }
}
