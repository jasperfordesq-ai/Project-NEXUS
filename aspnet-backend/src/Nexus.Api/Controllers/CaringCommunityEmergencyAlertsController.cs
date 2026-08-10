// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/caring-community/emergency-alerts")]
[Authorize]
public sealed class CaringCommunityEmergencyAlertsController : ControllerBase
{
    private readonly CaringEmergencyAlertService _alerts;
    private readonly TenantContext _tenant;

    public CaringCommunityEmergencyAlertsController(CaringEmergencyAlertService alerts, TenantContext tenant)
    {
        _alerts = alerts;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> ActiveAlerts(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _alerts.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        var userId = User.GetUserId();
        if (userId is null)
        {
            return Unauthorized(LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        var rows = await _alerts.ActiveAlertsAsync(tenantId, userId.Value, ct);
        return Ok(new { data = rows });
    }

    [HttpPost("{id:int}/dismiss")]
    public async Task<IActionResult> Dismiss(int id, CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _alerts.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        await _alerts.RecordDismissalAsync(tenantId, id, ct);
        return Ok(new { data = new { ok = true } });
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
[Route("api/admin/caring-community/emergency-alerts")]
[Authorize]
public sealed class AdminCaringCommunityEmergencyAlertsController : ControllerBase
{
    private readonly CaringEmergencyAlertService _alerts;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityEmergencyAlertsController(CaringEmergencyAlertService alerts, TenantContext tenant)
    {
        _alerts = alerts;
        _tenant = tenant;
    }

    [HttpGet]
    public async Task<IActionResult> AdminList(CancellationToken ct)
    {
        if (!User.IsAdmin())
        {
            return Forbid();
        }

        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _alerts.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                CaringCommunityEmergencyAlertsController.LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        var rows = await _alerts.AllAlertsAsync(tenantId, ct);
        return Ok(new { data = rows });
    }

    [HttpPost]
    public async Task<IActionResult> Store([FromBody] CaringEmergencyAlertRequest request, CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _alerts.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                CaringCommunityEmergencyAlertsController.LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        if (!HasAnnouncerAccess())
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                CaringCommunityEmergencyAlertsController.LaravelError("FORBIDDEN", "Forbidden."));
        }

        var userId = User.GetUserId();
        if (userId is null)
        {
            return Unauthorized(CaringCommunityEmergencyAlertsController.LaravelError("AUTH_REQUIRED", "Authentication required."));
        }

        try
        {
            var row = await _alerts.CreateAsync(tenantId, userId.Value, request, ct);
            return StatusCode(StatusCodes.Status201Created, new { data = row });
        }
        catch (CaringEmergencyAlertValidationException ex)
        {
            return UnprocessableEntity(
                CaringCommunityEmergencyAlertsController.LaravelError("VALIDATION_ERROR", ex.Message));
        }
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Deactivate(int id, CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _alerts.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                CaringCommunityEmergencyAlertsController.LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        if (!HasAnnouncerAccess())
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                CaringCommunityEmergencyAlertsController.LaravelError("FORBIDDEN", "Forbidden."));
        }

        await _alerts.DeactivateAsync(tenantId, id, ct);
        return Ok(new { data = new { ok = true } });
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
