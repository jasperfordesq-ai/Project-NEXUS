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
[Route("api/admin/caring-community/launch-readiness")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunityLaunchReadinessController : ControllerBase
{
    private readonly PilotLaunchReadinessService _readiness;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityLaunchReadinessController(
        PilotLaunchReadinessService readiness,
        TenantContext tenant)
    {
        _readiness = readiness;
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

        var data = await _readiness.ReportAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data });
    }

    [HttpPost("acknowledge-boundary")]
    public async Task<IActionResult> AcknowledgeBoundary(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var tenantId = _tenant.GetTenantIdOrThrow();
        var acknowledgement = await _readiness.AcknowledgeBoundaryAsync(tenantId, ct);
        var report = await _readiness.ReportAsync(tenantId, ct);

        return Ok(new
        {
            data = new
            {
                acknowledged = acknowledgement.Acknowledged,
                report
            }
        });
    }

    [HttpPost("launch")]
    public async Task<IActionResult> Launch(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var tenantId = _tenant.GetTenantIdOrThrow();
        var result = await _readiness.LaunchPilotAsync(tenantId, CurrentUserId(), ct);

        return result.Error switch
        {
            "ALREADY_LAUNCHED" => StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("ALREADY_LAUNCHED", "This pilot has already been launched.")),
            "CANNOT_LAUNCH" => StatusCode(StatusCodes.Status422UnprocessableEntity,
                CannotLaunchError(result.Blockers ?? [])),
            { Length: > 0 } => StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError(result.Error, "Launch failed.")),
            _ => Ok(new
            {
                data = new
                {
                    launched_at = result.LaunchedAt,
                    launched_by_id = result.LaunchedById,
                    report = await _readiness.ReportAsync(tenantId, ct)
                }
            })
        };
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        var tenantId = _tenant.GetTenantIdOrThrow();
        if (!await _readiness.IsFeatureEnabledAsync(tenantId, ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        return null;
    }

    private int CurrentUserId()
    {
        var raw = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub")
            ?? User.FindFirstValue("user_id");

        return int.TryParse(raw, out var id) ? id : 0;
    }

    private static object CannotLaunchError(IReadOnlyList<PilotLaunchReadinessBlocker> blockers)
    {
        const string message = "Launch readiness gate is not closed.";
        return new
        {
            success = false,
            errors = new[]
            {
                new
                {
                    code = "CANNOT_LAUNCH",
                    message
                }
            },
            error = new
            {
                code = "CANNOT_LAUNCH",
                message,
                blockers
            }
        };
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
