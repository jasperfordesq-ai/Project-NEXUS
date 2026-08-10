// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/caring-community/surveys")]
public sealed class CaringCommunitySurveysController : ControllerBase
{
    private readonly MunicipalSurveyService _surveys;
    private readonly TenantContext _tenant;

    public CaringCommunitySurveysController(MunicipalSurveyService surveys, TenantContext tenant)
    {
        _surveys = surveys;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> ActiveSurveys(CancellationToken ct)
    {
        var guard = await FeatureGuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _surveys.ActiveSurveysAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data });
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetSurvey(int id, CancellationToken ct)
    {
        var guard = await FeatureGuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _surveys.GetSurveyAsync(
            _tenant.GetTenantIdOrThrow(),
            id,
            includeDrafts: false,
            includeAnalytics: false,
            ct);

        return data is null
            ? StatusCode(StatusCodes.Status404NotFound, LaravelError("NOT_FOUND", "Not found."))
            : Ok(new { data });
    }

    [Authorize]
    [HttpPost("{id:int}/respond")]
    public async Task<IActionResult> SubmitSurvey(
        int id,
        [FromBody] MunicipalSurveySubmitRequest? request,
        CancellationToken ct)
    {
        var guard = await FeatureGuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var userId = User.GetUserId();
        if (userId is null)
        {
            return Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        var result = await _surveys.SubmitSurveyAsync(
            _tenant.GetTenantIdOrThrow(),
            id,
            userId.Value,
            request ?? new MunicipalSurveySubmitRequest(),
            IpHash(),
            ct);

        if (result.Ok)
        {
            return Ok(new { data = new { ok = true } });
        }

        var status = result.ErrorCode == "VALIDATION_ERROR"
            ? StatusCodes.Status422UnprocessableEntity
            : StatusCodes.Status422UnprocessableEntity;
        return StatusCode(status, LaravelError(
            result.ErrorCode ?? "SUBMIT_ERROR",
            result.Message ?? "Survey response could not be submitted.",
            result.Field));
    }

    private async Task<IActionResult?> FeatureGuardAsync(CancellationToken ct)
    {
        if (!await _surveys.IsFeatureEnabledAsync(_tenant.GetTenantIdOrThrow(), ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        return null;
    }

    private string? IpHash()
    {
        var ip = HttpContext.Connection.RemoteIpAddress?.ToString();
        if (string.IsNullOrWhiteSpace(ip))
        {
            return null;
        }

        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(ip));
        return Convert.ToHexString(bytes).ToLowerInvariant();
    }

    internal static object LaravelError(string code, string message, string? field = null)
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
[Route("api/admin/caring-community/surveys")]
[Authorize]
public sealed class AdminCaringCommunitySurveysController : ControllerBase
{
    private readonly MunicipalSurveyService _surveys;
    private readonly TenantContext _tenant;

    public AdminCaringCommunitySurveysController(MunicipalSurveyService surveys, TenantContext tenant)
    {
        _surveys = surveys;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> AdminListSurveys([FromQuery] string? status, CancellationToken ct)
    {
        var guard = await AdminGuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var normalizedStatus = status is "draft" or "active" or "closed" ? status : null;
        var data = await _surveys.ListSurveysAsync(_tenant.GetTenantIdOrThrow(), normalizedStatus, ct);
        return Ok(new { data });
    }

    [HttpPost]
    public async Task<IActionResult> AdminCreateSurvey(
        [FromBody] MunicipalSurveyRequest request,
        CancellationToken ct)
    {
        var guard = await AdminGuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var userId = User.GetUserId();
        if (userId is null)
        {
            return Unauthorized(CaringCommunitySurveysController.LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        try
        {
            var data = await _surveys.CreateSurveyAsync(_tenant.GetTenantIdOrThrow(), userId.Value, request, ct);
            return StatusCode(StatusCodes.Status201Created, new { data });
        }
        catch (MunicipalSurveyValidationException ex)
        {
            return UnprocessableEntity(
                CaringCommunitySurveysController.LaravelError("VALIDATION_ERROR", ex.Message, ex.Field));
        }
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> AdminGetSurvey(int id, CancellationToken ct)
    {
        var guard = await AdminGuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _surveys.GetSurveyAsync(
            _tenant.GetTenantIdOrThrow(),
            id,
            includeDrafts: true,
            includeAnalytics: true,
            ct);

        return data is null
            ? StatusCode(StatusCodes.Status404NotFound,
                CaringCommunitySurveysController.LaravelError("NOT_FOUND", "Not found."))
            : Ok(new { data });
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> AdminUpdateSurvey(
        int id,
        [FromBody] MunicipalSurveyRequest request,
        CancellationToken ct)
    {
        var guard = await AdminGuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var existing = await _surveys.GetSurveyAsync(
            _tenant.GetTenantIdOrThrow(),
            id,
            includeDrafts: true,
            includeAnalytics: false,
            ct);
        if (existing is null)
        {
            return StatusCode(StatusCodes.Status404NotFound,
                CaringCommunitySurveysController.LaravelError("NOT_FOUND", "Not found."));
        }

        if (existing.Status != "draft")
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                CaringCommunitySurveysController.LaravelError("INVALID_STATE", "Only draft surveys can be updated"));
        }

        try
        {
            var data = await _surveys.UpdateSurveyAsync(_tenant.GetTenantIdOrThrow(), id, request, ct);
            return Ok(new { data });
        }
        catch (MunicipalSurveyValidationException ex)
        {
            return UnprocessableEntity(
                CaringCommunitySurveysController.LaravelError("VALIDATION_ERROR", ex.Message, ex.Field));
        }
    }

    [HttpPost("{id:int}/publish")]
    public async Task<IActionResult> AdminPublishSurvey(int id, CancellationToken ct)
    {
        var guard = await AdminGuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _surveys.PublishSurveyAsync(_tenant.GetTenantIdOrThrow(), id, ct);
        return LifecycleResponse(result);
    }

    [HttpPost("{id:int}/close")]
    public async Task<IActionResult> AdminCloseSurvey(int id, CancellationToken ct)
    {
        var guard = await AdminGuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var result = await _surveys.CloseSurveyAsync(_tenant.GetTenantIdOrThrow(), id, ct);
        return LifecycleResponse(result);
    }

    [HttpGet("{id:int}/export")]
    public async Task<IActionResult> AdminExportCsv(int id, CancellationToken ct)
    {
        var guard = await AdminGuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var csv = await _surveys.ExportCsvAsync(_tenant.GetTenantIdOrThrow(), id, ct);
        if (csv is null)
        {
            return StatusCode(StatusCodes.Status404NotFound,
                CaringCommunitySurveysController.LaravelError("SERVICE_ERROR", "Survey not found"));
        }

        Response.Headers.ContentDisposition = $"attachment; filename=\"survey-{id}-responses.csv\"";
        return new ContentResult
        {
            Content = csv,
            ContentType = "text/csv",
            StatusCode = StatusCodes.Status200OK
        };
    }

    private async Task<IActionResult?> AdminGuardAsync(CancellationToken ct)
    {
        if (!HasAnnouncerAccess())
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                CaringCommunitySurveysController.LaravelError("FORBIDDEN", "Forbidden."));
        }

        if (!await _surveys.IsFeatureEnabledAsync(_tenant.GetTenantIdOrThrow(), ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                CaringCommunitySurveysController.LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        return null;
    }

    private IActionResult LifecycleResponse(MunicipalSurveyLifecycleResult result)
    {
        return result.Ok
            ? Ok(new { data = new { ok = true } })
            : StatusCode(StatusCodes.Status422UnprocessableEntity,
                CaringCommunitySurveysController.LaravelError(
                    result.ErrorCode ?? "SERVICE_ERROR",
                    result.Message ?? "Survey state could not be changed."));
    }

    private bool HasAnnouncerAccess()
    {
        if (User.IsAdmin())
        {
            return true;
        }

        return User.FindAll(ClaimTypes.Role)
            .Concat(User.FindAll("role"))
            .Any(claim => string.Equals(claim.Value, "municipality_announcer", StringComparison.OrdinalIgnoreCase));
    }
}
