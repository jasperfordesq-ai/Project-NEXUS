// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/admin/caring-community/safeguarding")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminCaringCommunitySafeguardingController : ControllerBase
{
    private readonly CaringSafeguardingService _safeguarding;
    private readonly TenantContext _tenant;

    public AdminCaringCommunitySafeguardingController(
        CaringSafeguardingService safeguarding,
        TenantContext tenant)
    {
        _safeguarding = safeguarding;
        _tenant = tenant;
    }

    [HttpGet("dashboard")]
    public async Task<IActionResult> Dashboard(CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _safeguarding.DashboardSummaryAsync(_tenant.GetTenantIdOrThrow(), ct);
        return Ok(new { data });
    }

    [HttpGet("reports")]
    public async Task<IActionResult> Reports(
        [FromQuery] string? status,
        [FromQuery] string? severity,
        CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var items = await _safeguarding.ListReportsAsync(_tenant.GetTenantIdOrThrow(), status, severity, ct);
        return Ok(new { data = new { items } });
    }

    [HttpGet("reports/{id:long}")]
    public async Task<IActionResult> Report(long id, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var data = await _safeguarding.ReportDetailAsync(_tenant.GetTenantIdOrThrow(), id, ct);
        if (data is null)
        {
            return StatusCode(StatusCodes.Status404NotFound, LaravelError("NOT_FOUND", "Not found."));
        }

        return Ok(new { data });
    }

    [HttpPost("reports/{id:long}/assign")]
    public async Task<IActionResult> Assign(long id, [FromBody] Dictionary<string, object?>? request, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var assigneeId = IntValue(request, "assignee_user_id", min: 1);
        if (assigneeId is null)
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("VALIDATION_ERROR", "Field is required.", "assignee_user_id"));
        }

        var assigned = await _safeguarding.AssignReportAsync(
            _tenant.GetTenantIdOrThrow(),
            id,
            assigneeId.Value,
            CurrentUserId(),
            ct);
        if (!assigned)
        {
            return StatusCode(StatusCodes.Status404NotFound,
                LaravelError("NOT_FOUND", "Not found."));
        }

        return Ok(new { data = new { success = true } });
    }

    [HttpPost("reports/{id:long}/escalate")]
    public async Task<IActionResult> Escalate(long id, [FromBody] Dictionary<string, object?>? request, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var note = StringValue(request, "note")?.Trim();
        var escalated = await _safeguarding.EscalateReportAsync(
            _tenant.GetTenantIdOrThrow(),
            id,
            CurrentUserId(),
            string.IsNullOrWhiteSpace(note) ? null : note,
            ct);
        if (!escalated)
        {
            return StatusCode(StatusCodes.Status404NotFound,
                LaravelError("NOT_FOUND", "Not found."));
        }

        return Ok(new { data = new { success = true } });
    }

    [HttpPost("reports/{id:long}/note")]
    public async Task<IActionResult> Note(long id, [FromBody] Dictionary<string, object?>? request, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var note = StringValue(request, "note")?.Trim();
        if (string.IsNullOrWhiteSpace(note))
        {
            return StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("VALIDATION_ERROR", "Note is required."));
        }

        var added = await _safeguarding.AddNoteAsync(
            _tenant.GetTenantIdOrThrow(),
            id,
            CurrentUserId(),
            note,
            ct);
        if (!added)
        {
            return StatusCode(StatusCodes.Status404NotFound,
                LaravelError("NOT_FOUND", "Not found."));
        }

        return Ok(new { data = new { success = true } });
    }

    [HttpPost("reports/{id:long}/status")]
    public async Task<IActionResult> Status(long id, [FromBody] Dictionary<string, object?>? request, CancellationToken ct)
    {
        var guard = await GuardAsync(ct);
        if (guard is not null)
        {
            return guard;
        }

        var status = StringValue(request, "status") ?? string.Empty;
        var notes = StringValue(request, "notes")?.Trim();
        var changed = await _safeguarding.ChangeStatusAsync(
            _tenant.GetTenantIdOrThrow(),
            id,
            status,
            CurrentUserId(),
            string.IsNullOrWhiteSpace(notes) ? null : notes,
            ct);

        return changed switch
        {
            SafeguardingStatusChangeResult.Changed => Ok(new { data = new { success = true } }),
            SafeguardingStatusChangeResult.NotFound => StatusCode(StatusCodes.Status404NotFound,
                LaravelError("NOT_FOUND", "Not found.")),
            _ => StatusCode(StatusCodes.Status422UnprocessableEntity,
                LaravelError("VALIDATION_ERROR", "Invalid safeguarding status."))
        };
    }

    private async Task<IActionResult?> GuardAsync(CancellationToken ct)
    {
        if (!await _safeguarding.IsCaringCommunityEnabledAsync(_tenant.GetTenantIdOrThrow(), ct))
        {
            return StatusCode(StatusCodes.Status403Forbidden,
                LaravelError("FEATURE_DISABLED", "Service unavailable."));
        }

        return null;
    }

    private int CurrentUserId()
    {
        var value = User.FindFirst(System.Security.Claims.ClaimTypes.NameIdentifier)?.Value
            ?? User.FindFirst("sub")?.Value
            ?? "0";
        return int.TryParse(value, out var id) ? id : 0;
    }

    private static int? IntValue(IReadOnlyDictionary<string, object?>? request, string key, int min)
    {
        if (request is null || !request.TryGetValue(key, out var value) || value is null)
        {
            return null;
        }

        var parsed = value switch
        {
            int i => i,
            long l when l <= int.MaxValue && l >= int.MinValue => (int)l,
            decimal d when d == decimal.Truncate(d) && d <= int.MaxValue && d >= int.MinValue => (int)d,
            string s when int.TryParse(s, out var i) => i,
            JsonElement element when element.ValueKind == JsonValueKind.Number && element.TryGetInt32(out var i) => i,
            JsonElement element when element.ValueKind == JsonValueKind.String && int.TryParse(element.GetString(), out var i) => i,
            _ => 0
        };

        return parsed >= min ? parsed : null;
    }

    private static string? StringValue(IReadOnlyDictionary<string, object?>? request, string key)
    {
        if (request is null || !request.TryGetValue(key, out var value) || value is null)
        {
            return null;
        }

        return value switch
        {
            string s => s,
            JsonElement element when element.ValueKind == JsonValueKind.String => element.GetString(),
            _ => null
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
