// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController, Authorize]
public sealed class EventTicketController(EventTicketService tickets) : ControllerBase
{
    [HttpGet("api/events/{id:int}/tickets"), HttpGet("api/v2/events/{id:int}/tickets")]
    public Task<IActionResult> Catalogue(int id, CancellationToken ct) =>
        Run(tickets.Catalogue(Tenant(), id, UserId(), ct));

    [HttpPost("api/events/{id:int}/tickets/{ticketTypeId:long}/quote"), HttpPost("api/v2/events/{id:int}/tickets/{ticketTypeId:long}/quote")]
    public Task<IActionResult> Quote(int id, long ticketTypeId, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(tickets.Quote(Tenant(), id, ticketTypeId, UserId(), Int(body, "units", 1), ct));

    [HttpPost("api/events/{id:int}/ticket-types"), HttpPost("api/v2/events/{id:int}/ticket-types")]
    public Task<IActionResult> CreateType(int id, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(tickets.Create(Tenant(), id, UserId(), body, Key(), ct));

    [HttpPut("api/events/{id:int}/ticket-types/{ticketTypeId:long}"), HttpPut("api/v2/events/{id:int}/ticket-types/{ticketTypeId:long}")]
    public Task<IActionResult> UpdateType(int id, long ticketTypeId, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(tickets.Update(Tenant(), id, ticketTypeId, UserId(), Long(body, "expected_version"), body, Key(), ct));

    [HttpPost("api/events/{id:int}/ticket-types/{ticketTypeId:long}/{transition:regex(^(activate|pause|archive)$)}"),
     HttpPost("api/v2/events/{id:int}/ticket-types/{ticketTypeId:long}/{transition:regex(^(activate|pause|archive)$)}")]
    public Task<IActionResult> TransitionType(int id, long ticketTypeId, string transition, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(tickets.Transition(Tenant(), id, ticketTypeId, UserId(), transition, Long(body, "expected_version"), Text(body, "reason"), Key(), ct));

    [HttpPost("api/events/{id:int}/tickets/{ticketTypeId:long}/allocate"), HttpPost("api/v2/events/{id:int}/tickets/{ticketTypeId:long}/allocate")]
    public Task<IActionResult> AllocateSelf(int id, long ticketTypeId, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(tickets.AllocateSelf(Tenant(), id, ticketTypeId, UserId(), Int(body, "units", 1), Key(), ct));

    [HttpPost("api/events/{id:int}/tickets/{ticketTypeId:long}/allocate/{userId:int}"), HttpPost("api/v2/events/{id:int}/tickets/{ticketTypeId:long}/allocate/{userId:int}")]
    public Task<IActionResult> AllocateMember(int id, long ticketTypeId, int userId, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(tickets.AllocateMember(Tenant(), id, ticketTypeId, userId, UserId(), Int(body, "units", 1), Key(), ct));

    [HttpPost("api/events/{id:int}/ticket-entitlements/{entitlementId:long}/cancel"), HttpPost("api/v2/events/{id:int}/ticket-entitlements/{entitlementId:long}/cancel")]
    public Task<IActionResult> Cancel(int id, long entitlementId, [FromBody] JsonElement body, CancellationToken ct) =>
        Run(tickets.Cancel(Tenant(), id, entitlementId, UserId(), Long(body, "expected_version"), Text(body, "reason"), Key(), ct));

    [HttpGet("api/events/{id:int}/tickets/reconciliation"), HttpGet("api/v2/events/{id:int}/tickets/reconciliation")]
    public Task<IActionResult> Reconcile(int id, CancellationToken ct) =>
        Run(tickets.Reconcile(Tenant(), id, UserId(), ct));

    private async Task<IActionResult> Run(Task<EventTicketResult> task)
    {
        var result = await task;
        Response.Headers.CacheControl = "private, no-store";
        Response.Headers.Pragma = "no-cache";
        Response.Headers["X-Event-Ticket-Contract"] = "1";
        if (result.Succeeded)
            return StatusCode(result.Status, new { success = true, data = result.Data });

        var error = result.Error!;
        var errors = error.Field is null
            ? null
            : new Dictionary<string, string[]> { [error.Field] = [error.Message] };
        return StatusCode(error.Status, new
        {
            success = false,
            message = error.Message,
            code = error.Code,
            error = new { code = error.Code, message = error.Message, field = error.Field },
            errors
        });
    }

    private int Tenant() => User.GetTenantId() ?? throw new UnauthorizedAccessException();
    private int UserId() => User.GetUserId() ?? throw new UnauthorizedAccessException();
    private string Key() => Request.Headers["Idempotency-Key"].ToString().Trim();
    private static string? Text(JsonElement body, string name) =>
        body.ValueKind == JsonValueKind.Object && body.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
    private static int Int(JsonElement body, string name, int fallback = 0) =>
        body.ValueKind == JsonValueKind.Object && body.TryGetProperty(name, out var value) && value.TryGetInt32(out var parsed)
            ? parsed
            : fallback;
    private static long Long(JsonElement body, string name) =>
        body.ValueKind == JsonValueKind.Object && body.TryGetProperty(name, out var value) && value.TryGetInt64(out var parsed)
            ? parsed
            : 0;
}
