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
[Route("api/admin/caring-community")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunityPilotScoreboardController : ControllerBase
{
    private readonly PilotScoreboardService _scoreboard;
    private readonly TenantContext _tenant;

    public AdminCaringCommunityPilotScoreboardController(
        PilotScoreboardService scoreboard,
        TenantContext tenant)
    {
        _scoreboard = scoreboard;
        _tenant = tenant;
    }

    [HttpGet("pilot-scoreboard")]
    public async Task<IActionResult> Scoreboard(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _scoreboard.ScoreboardAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data });
    }

    [HttpGet("pilot-scoreboard/baselines")]
    public async Task<IActionResult> Baselines(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var items = await _scoreboard.ListBaselinesAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data = new { items } });
    }

    [HttpPost("pilot-scoreboard/pre-pilot")]
    public async Task<IActionResult> CapturePrePilot(
        [FromBody] PilotScoreboardCaptureRequest? request,
        CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _scoreboard.CapturePrePilotBaselineAsync(
            _tenant.GetTenantIdOrThrow(),
            CurrentUserId(),
            request?.Notes,
            ct);

        return Ok(new { data });
    }

    [HttpPost("pilot-scoreboard/quarterly")]
    public async Task<IActionResult> CaptureQuarterly(
        [FromBody] PilotScoreboardCaptureRequest? request,
        CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var label = NormalizeQuarterlyLabel(request?.Label);
        if (label == PilotScoreboardService.PrePilotLabel)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("VALIDATION_ERROR", "Field is required.", "label"));
        }

        var data = await _scoreboard.CaptureBaselineAsync(
            _tenant.GetTenantIdOrThrow(),
            label,
            CurrentUserId(),
            request?.Notes,
            isPrePilot: false,
            ct);

        return Ok(new { data });
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        if (!await _scoreboard.IsFeatureEnabledAsync(_tenant.GetTenantIdOrThrow(), ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        return null;
    }

    private int? CurrentUserId()
    {
        var raw = User.FindFirstValue(ClaimTypes.NameIdentifier)
            ?? User.FindFirstValue("sub")
            ?? User.FindFirstValue("user_id");

        return int.TryParse(raw, out var id) ? id : null;
    }

    private static string NormalizeQuarterlyLabel(string? rawLabel)
    {
        var trimmed = rawLabel?.Trim();
        if (string.IsNullOrEmpty(trimmed))
        {
            return $"quarterly_{DateTime.UtcNow:yyyy_MM}";
        }

        return trimmed.Length <= 120 ? trimmed : trimmed[..120];
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
