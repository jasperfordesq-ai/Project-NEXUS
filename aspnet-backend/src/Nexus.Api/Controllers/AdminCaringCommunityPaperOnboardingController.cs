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
public sealed class AdminCaringCommunityPaperOnboardingController : ControllerBase
{
    private const long MaxUploadBytes = 10 * 1024 * 1024;

    private static readonly HashSet<string> AllowedMimeTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "application/pdf",
        "image/jpeg",
        "image/png",
        "image/webp"
    };

    private readonly PaperOnboardingIntakeService _intakes;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityPaperOnboardingController(
        PaperOnboardingIntakeService intakes,
        TenantContext tenant)
    {
        _intakes = intakes;
        _tenant = tenant;
    }

    [HttpGet("paper-onboarding")]
    public async Task<IActionResult> List(
        [FromQuery] string? status,
        [FromQuery] int limit = 20,
        CancellationToken ct = default)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _intakes.ListAsync(_tenant.GetTenantIdOrThrow(), status, limit, ct);
        return Ok(new { data });
    }

    [HttpPost("paper-onboarding")]
    [RequestSizeLimit(MaxUploadBytes)]
    public async Task<IActionResult> Upload(
        [FromForm] IFormFile? file,
        [FromForm(Name = "name")] string? name,
        [FromForm(Name = "date_of_birth")] string? dateOfBirth,
        [FromForm(Name = "address")] string? address,
        [FromForm(Name = "phone")] string? phone,
        [FromForm(Name = "email")] string? email,
        CancellationToken ct = default)
    {
        var actorId = User.GetUserId();
        if (actorId is null)
        {
            return Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        if (file is null || file.Length <= 0)
        {
            return UnprocessableEntity(LaravelError(
                "VALIDATION_ERROR",
                "A paper onboarding file is required.",
                "file"));
        }

        if (!AllowedMimeTypes.Contains(file.ContentType?.Trim() ?? string.Empty))
        {
            return UnprocessableEntity(LaravelError(
                "VALIDATION_ERROR",
                "Paper onboarding uploads must be a PDF, JPEG, PNG, or WebP file.",
                "file"));
        }

        if (file.Length > MaxUploadBytes)
        {
            return UnprocessableEntity(LaravelError(
                "VALIDATION_ERROR",
                "Paper onboarding uploads must be 10 MB or smaller.",
                "file"));
        }

        var data = await _intakes.CreateFromUploadAsync(
            _tenant.GetTenantIdOrThrow(),
            actorId.Value,
            file,
            new CaringPaperOnboardingSeedFields(name, dateOfBirth, address, phone, email),
            ct);

        return StatusCode(StatusCodes.Status201Created, new { data });
    }

    [HttpPost("paper-onboarding/{id:int}/confirm")]
    public async Task<IActionResult> Confirm(
        int id,
        [FromBody] CaringPaperOnboardingConfirmRequest? request,
        CancellationToken ct = default)
    {
        var actorId = User.GetUserId();
        if (actorId is null)
        {
            return Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _intakes.ConfirmAsync(
            _tenant.GetTenantIdOrThrow(),
            id,
            actorId.Value,
            request ?? new CaringPaperOnboardingConfirmRequest(),
            ct);

        if (!result.Success)
        {
            var code = result.Code ?? "CREATE_FAILED";
            var message = code switch
            {
                "NOT_FOUND" => "Paper onboarding intake not found.",
                "ALREADY_REVIEWED" => "Paper onboarding intake was already reviewed.",
                "EMAIL_EXISTS" => "Email already exists.",
                "VALIDATION_ERROR" => "Paper onboarding review fields are required.",
                _ => "User could not be created."
            };
            var status = code == "NOT_FOUND"
                ? StatusCodes.Status404NotFound
                : StatusCodes.Status422UnprocessableEntity;

            return StatusCode(status, LaravelError(code, message));
        }

        return StatusCode(StatusCodes.Status201Created, new
        {
            data = new
            {
                success = true,
                intake = result.Intake,
                user = result.User,
                temp_password = result.TempPassword
            }
        });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        if (!await _intakes.IsFeatureEnabledAsync(_tenant.GetTenantIdOrThrow(), ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        return null;
    }

    private static object LaravelError(string code, string message, string? field = null)
    {
        return new
        {
            errors = new[]
            {
                new LaravelErrorRow(code, message, field)
            }
        };
    }
}
