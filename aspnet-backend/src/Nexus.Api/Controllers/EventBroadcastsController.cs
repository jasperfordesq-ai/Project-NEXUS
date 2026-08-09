// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Authorize]
public sealed class EventBroadcastsController : ControllerBase
{
    private readonly EventBroadcastService _broadcasts;
    public EventBroadcastsController(EventBroadcastService broadcasts) => _broadcasts = broadcasts;

    [HttpGet("api/events/{eventId:int}/broadcasts")]
    [HttpGet("api/v2/events/{eventId:int}/broadcasts")]
    public async Task<IActionResult> Index(int eventId, [FromQuery] int page = 1, [FromQuery(Name = "per_page")] int perPage = 20, CancellationToken ct = default)
        => Respond(await _broadcasts.ListAsync(TenantId(), eventId, UserId(), page, perPage, ct));

    [HttpGet("api/event-broadcasts/{broadcastId:long}")]
    [HttpGet("api/v2/event-broadcasts/{broadcastId:long}")]
    public async Task<IActionResult> Show(long broadcastId, [FromQuery(Name = "history_page")] int historyPage = 1, [FromQuery(Name = "history_per_page")] int historyPerPage = 50, CancellationToken ct = default)
        => Respond(await _broadcasts.ShowAsync(TenantId(), broadcastId, UserId(), historyPage, historyPerPage, ct));

    [HttpPost("api/events/{eventId:int}/broadcasts/preview")]
    [HttpPost("api/v2/events/{eventId:int}/broadcasts/preview")]
    public async Task<IActionResult> Preview(int eventId, [FromBody] JsonElement body, CancellationToken ct)
        => Respond(await _broadcasts.PreviewAsync(TenantId(), eventId, UserId(), body, ct));

    [HttpPost("api/events/{eventId:int}/broadcasts")]
    [HttpPost("api/v2/events/{eventId:int}/broadcasts")]
    public async Task<IActionResult> Create(int eventId, [FromBody] JsonElement body, CancellationToken ct)
        => Respond(await _broadcasts.CreateAsync(TenantId(), eventId, UserId(), body, Key(), ct));

    [HttpPost("api/event-broadcasts/{broadcastId:long}/revisions")]
    [HttpPost("api/v2/event-broadcasts/{broadcastId:long}/revisions")]
    public async Task<IActionResult> Revise(long broadcastId, [FromBody] JsonElement body, CancellationToken ct)
        => Respond(await _broadcasts.ReviseAsync(TenantId(), broadcastId, UserId(), Int(body, "expected_version"), body, Key(), ct));

    [HttpPost("api/event-broadcasts/{broadcastId:long}/schedule")]
    [HttpPost("api/v2/event-broadcasts/{broadcastId:long}/schedule")]
    public async Task<IActionResult> Schedule(long broadcastId, [FromBody] JsonElement body, CancellationToken ct)
    {
        if (body.ValueKind == JsonValueKind.Object && body.TryGetProperty("scheduled_at", out var value) && value.ValueKind is not (JsonValueKind.Null or JsonValueKind.String)) return Validation("scheduled_at");
        if (body.ValueKind == JsonValueKind.Object && body.TryGetProperty("scheduled_at", out value) && value.ValueKind == JsonValueKind.String && !DateTime.TryParse(value.GetString(), out _)) return Validation("scheduled_at");
        return Respond(await _broadcasts.ScheduleAsync(TenantId(), broadcastId, UserId(), Int(body, "expected_version"), Date(body, "scheduled_at"), Key(), ct));
    }

    [HttpPost("api/event-broadcasts/{broadcastId:long}/cancel")]
    [HttpPost("api/v2/event-broadcasts/{broadcastId:long}/cancel")]
    public async Task<IActionResult> Cancel(long broadcastId, [FromBody] JsonElement body, CancellationToken ct)
        => Respond(await _broadcasts.CancelAsync(TenantId(), broadcastId, UserId(), Int(body, "expected_version"), String(body, "reason") ?? "", Key(), ct));

    [HttpPost("api/event-broadcasts/{broadcastId:long}/retry")]
    [HttpPost("api/v2/event-broadcasts/{broadcastId:long}/retry")]
    public async Task<IActionResult> Retry(long broadcastId, [FromBody] JsonElement body, CancellationToken ct)
        => Respond(await _broadcasts.RetryAsync(TenantId(), broadcastId, UserId(), Int(body, "expected_version"), Key(), ct));

    private IActionResult Respond(EventBroadcastResult result)
    {
        Response.Headers.CacheControl = "private, no-store"; Response.Headers.Pragma = "no-cache"; Response.Headers.Vary = "Authorization, Cookie, X-Tenant-ID";
        if (!result.Succeeded) return StatusCode(result.Error!.Status, new { success = false, error = new { code = result.Error.Code, message = result.Error.Message, field = result.Error.Field } });
        return result.Data is EventBroadcastCollection collection
            ? StatusCode(result.Status, new { success = true, data = collection.Items, meta = collection.Meta })
            : StatusCode(result.Status, new { success = true, data = result.Data });
    }
    private int TenantId() => User.GetTenantId() ?? throw new UnauthorizedAccessException("Invalid tenant claim");
    private int UserId() => User.GetUserId() ?? throw new UnauthorizedAccessException("Invalid user claim");
    private string Key() => Request.Headers["Idempotency-Key"].ToString();
    private static int Int(JsonElement body, string name) => body.ValueKind == JsonValueKind.Object && body.TryGetProperty(name, out var value) && value.TryGetInt32(out var parsed) && parsed > 0 ? parsed : 0;
    private static string? String(JsonElement body, string name) => body.ValueKind == JsonValueKind.Object && body.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String ? value.GetString() : null;
    private static DateTime? Date(JsonElement body, string name) => body.ValueKind == JsonValueKind.Object && body.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String && DateTime.TryParse(value.GetString(), out var parsed) ? parsed.ToUniversalTime() : null;
    private IActionResult Validation(string field) => StatusCode(422, new { success = false, error = new { code = "EVENT_BROADCAST_VALIDATION_FAILED", message = "Validation failed", field } });
}
