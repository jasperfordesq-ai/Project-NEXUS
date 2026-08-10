// Copyright (c) 2024-2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Data;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Route("api/admin/email-deliverability")]
[Route("api/v2/admin/email-deliverability")]
[Authorize(Policy = "AdminOnly")]
public sealed class AdminEmailDeliverabilityController : ControllerBase
{
    private readonly AdminEmailDeliverabilityService _deliverability;
    private readonly TenantContext _tenant;

    public AdminEmailDeliverabilityController(
        AdminEmailDeliverabilityService deliverability,
        TenantContext tenant)
    {
        _deliverability = deliverability;
        _tenant = tenant;
    }

    [HttpGet("summary")]
    public async Task<IActionResult> Summary([FromQuery] int days = 7, CancellationToken ct = default)
    {
        var data = await _deliverability.SummaryAsync(_tenant.GetTenantIdOrThrow(), days, ct);
        return Ok(new { data });
    }

    [HttpGet("push-summary")]
    public Task<IActionResult> PushSummary([FromQuery] int days = 7, CancellationToken ct = default)
    {
        _ = ct;
        return Task.FromResult<IActionResult>(Ok(new { data = _deliverability.PushSummary(days) }));
    }

    [HttpGet("trigger-audit")]
    public async Task<IActionResult> TriggerAudit([FromQuery] int hours = 24, CancellationToken ct = default)
    {
        var data = await _deliverability.TriggerAuditAsync(_tenant.GetTenantIdOrThrow(), hours, ct);
        return Ok(new { data });
    }

    [HttpGet("logs")]
    public async Task<IActionResult> Logs(
        [FromQuery] int limit = 50,
        [FromQuery] int offset = 0,
        [FromQuery(Name = "user_id")] int? userId = null,
        [FromQuery] string? email = null,
        [FromQuery] string? status = null,
        [FromQuery] string? category = null,
        [FromQuery] string? since = null,
        [FromQuery] string? until = null,
        CancellationToken ct = default)
    {
        var data = await _deliverability.LogsAsync(
            _tenant.GetTenantIdOrThrow(),
            limit,
            offset,
            userId,
            email,
            status,
            category,
            since,
            until,
            ct);

        return Ok(new { data });
    }

    [HttpGet("queues")]
    public async Task<IActionResult> Queues(
        [FromQuery] int limit = 50,
        [FromQuery] string? status = null,
        [FromQuery] string? source = null,
        CancellationToken ct = default)
    {
        var data = await _deliverability.QueuesAsync(
            _tenant.GetTenantIdOrThrow(),
            limit,
            status,
            source,
            ct);

        return Ok(new { data });
    }

    [HttpGet("suppressions")]
    public async Task<IActionResult> Suppressions(
        [FromQuery] int limit = 50,
        [FromQuery] int offset = 0,
        [FromQuery] string? email = null,
        [FromQuery] string? reason = null,
        CancellationToken ct = default)
    {
        var data = await _deliverability.SuppressionsAsync(
            _tenant.GetTenantIdOrThrow(),
            limit,
            offset,
            email,
            reason,
            ct);

        return Ok(new { data });
    }

    [HttpDelete("suppressions/{id:int}")]
    public async Task<IActionResult> RemoveSuppression(int id, CancellationToken ct)
    {
        try
        {
            var suppression = await _deliverability.RemoveSuppressionAsync(_tenant.GetTenantIdOrThrow(), id, ct);
            return Ok(new { data = new { removed = true, email = suppression.Email, reason = suppression.Reason } });
        }
        catch (AdminEmailDeliverabilityNotFoundException ex)
        {
            return StatusCode(StatusCodes.Status404NotFound, LaravelError("NOT_FOUND", ex.Message));
        }
    }

    [HttpGet("user/{userId:int}")]
    public async Task<IActionResult> UserHistory(int userId, CancellationToken ct)
    {
        try
        {
            var data = await _deliverability.UserHistoryAsync(_tenant.GetTenantIdOrThrow(), userId, ct);
            return Ok(new { data });
        }
        catch (AdminEmailDeliverabilityNotFoundException ex)
        {
            return StatusCode(StatusCodes.Status404NotFound, LaravelError("NOT_FOUND", ex.Message));
        }
    }

    private static object LaravelError(string code, string message)
    {
        return new
        {
            errors = new[]
            {
                new { code, message }
            }
        };
    }
}
