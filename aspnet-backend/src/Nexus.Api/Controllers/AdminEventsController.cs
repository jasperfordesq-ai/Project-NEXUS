// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later
// Author: Jasper Ford
// See NOTICE file for attribution and acknowledgements.

using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Nexus.Api.Data;
using Nexus.Api.Extensions;
using Nexus.Api.Services;
using System.Text.Json;

namespace Nexus.Api.Controllers;

/// <summary>
/// Admin event management endpoints.
/// </summary>
[ApiController]
[Route("api/admin/events")]
[Route("api/v2/admin/events")]
[Authorize(Policy = "AdminOnly")]
public class AdminEventsController : ControllerBase
{
    private readonly NexusDbContext _db;
    private readonly EventLifecycleService _lifecycle;

    public AdminEventsController(NexusDbContext db, EventLifecycleService lifecycle)
    {
        _db = db;
        _lifecycle = lifecycle;
    }

    [HttpGet]
    public async Task<IActionResult> ListEvents([FromQuery] int page = 1, [FromQuery] int limit = 20)
    {
        var clampedLimit = Math.Clamp(limit, 1, 100);
        var clampedPage = Math.Max(1, page);

        var total = await _db.Events.CountAsync();

        var events = await _db.Events
            .Include(e => e.CreatedBy)
            .Include(e => e.Rsvps)
            .OrderByDescending(e => e.StartsAt)
            .Skip((clampedPage - 1) * clampedLimit)
            .Take(clampedLimit)
            .Select(e => new
            {
                e.Id, e.Title, starts_at = e.StartsAt, ends_at = e.EndsAt,
                is_cancelled = e.IsCancelled, e.MaxAttendees, created_at = e.CreatedAt,
                rsvp_count = e.Rsvps.Count(r => r.Status == Nexus.Api.Entities.Event.RsvpStatus.Going),
                created_by = e.CreatedBy != null ? new { e.CreatedBy.Id, e.CreatedBy.FirstName, e.CreatedBy.LastName } : null
            })
            .ToListAsync();

        return Ok(new
        {
            data = events,
            meta = new { page, limit, total }
        });
    }

    [HttpGet("stats")]
    public async Task<IActionResult> GetStats()
    {
        var total = await _db.Events.CountAsync();
        var upcoming = await _db.Events.CountAsync(e => e.StartsAt > DateTime.UtcNow && !e.IsCancelled);
        var cancelled = await _db.Events.CountAsync(e => e.IsCancelled);
        var totalRsvps = await _db.EventRsvps.CountAsync();

        return Ok(new { data = new { total, upcoming, cancelled, total_rsvps = totalRsvps } });
    }

    [HttpPut("{id:int}/cancel")]
    [HttpPost("{id:int}/cancel")]
    public Task<IActionResult> CancelEvent(int id, [FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] JsonElement? body, CancellationToken ct)
        => Transition(id, "cancel", body, ct);

    [HttpDelete("{id:int}")]
    public Task<IActionResult> DeleteEvent(int id, [FromBody(EmptyBodyBehavior = Microsoft.AspNetCore.Mvc.ModelBinding.EmptyBodyBehavior.Allow)] JsonElement? body, CancellationToken ct)
        => Transition(id, "archive", body, ct);

    [HttpPost("{id:int}/approve")]
    public Task<IActionResult> Approve(int id, [FromBody] JsonElement? body, CancellationToken ct) => Transition(id, "approve", body, ct);

    [HttpPost("{id:int}/reject")]
    public Task<IActionResult> Reject(int id, [FromBody] JsonElement? body, CancellationToken ct) => Transition(id, "reject", body, ct);

    [HttpPost("{id:int}/postpone")]
    public Task<IActionResult> Postpone(int id, [FromBody] JsonElement? body, CancellationToken ct) => Transition(id, "postpone", body, ct);

    [HttpPost("{id:int}/complete")]
    public Task<IActionResult> Complete(int id, [FromBody] JsonElement? body, CancellationToken ct) => Transition(id, "complete", body, ct);

    [HttpPost("{id:int}/archive")]
    public Task<IActionResult> Archive(int id, [FromBody] JsonElement? body, CancellationToken ct) => Transition(id, "archive", body, ct);

    [HttpPost("{id:int}/restore")]
    public Task<IActionResult> Restore(int id, [FromBody] JsonElement? body, CancellationToken ct) => Transition(id, "restore", body, ct);

    [HttpPost("{id:int}/reschedule")]
    public Task<IActionResult> Reschedule(int id, [FromBody] JsonElement? body, CancellationToken ct) => Transition(id, "reschedule", body, ct);

    private async Task<IActionResult> Transition(int id, string action, JsonElement? body, CancellationToken ct)
    {
        string? reason = null;
        if (body is { ValueKind: JsonValueKind.Object } value && value.TryGetProperty("reason", out var property) && property.ValueKind == JsonValueKind.String)
            reason = property.GetString();
        var tenantId = User.GetTenantId() ?? throw new UnauthorizedAccessException("Invalid tenant claim");
        var actorId = User.GetUserId() ?? throw new UnauthorizedAccessException("Invalid user claim");
        var result = await _lifecycle.TransitionAsync(tenantId, id, actorId, action, reason, ct);
        return result.Succeeded
            ? Ok(new { data = result.Data })
            : StatusCode(result.Error!.Status, new { error = new { code = result.Error.Code, message = result.Error.Message, field = result.Error.Field } });
    }
}
