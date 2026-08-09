// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController]
[Authorize]
public sealed class EventPeopleController : ControllerBase
{
    private readonly EventPeopleWorkflowService _people;
    public EventPeopleController(EventPeopleWorkflowService people) => _people = people;

    [HttpGet("api/events/{id:int}/relationship")]
    [HttpGet("api/v2/events/{id:int}/relationship")]
    public async Task<IActionResult> Relationship(int id, CancellationToken ct) => Respond(await _people.RelationshipAsync(TenantId(), id, UserId(), ct));

    [HttpGet("api/events/{id:int}/people")]
    [HttpGet("api/v2/events/{id:int}/people")]
    public async Task<IActionResult> Index(int id, CancellationToken ct) => Respond(await _people.ListAsync(TenantId(), id, UserId(), Query(), ct));

    [HttpGet("api/events/{id:int}/people/export.csv")]
    [HttpGet("api/v2/events/{id:int}/people/export.csv")]
    public async Task<IActionResult> Export(int id, CancellationToken ct) { var result = await _people.CsvAsync(TenantId(), id, UserId(), Query(), ct); if (!result.Succeeded) return Respond(result); Response.Headers.CacheControl = "private, no-store, max-age=0"; Response.Headers["X-Content-Type-Options"] = "nosniff"; return File(Encoding.UTF8.GetBytes((string)result.Data!), "text/csv; charset=UTF-8", $"event-{id}-people.csv"); }

    [HttpPost("api/events/{id:int}/people/bulk")]
    [HttpPost("api/v2/events/{id:int}/people/bulk")]
    public async Task<IActionResult> Bulk(int id, [FromBody] JsonElement body, CancellationToken ct) => Respond(await _people.BulkAsync(TenantId(), id, UserId(), body, ct));

    [HttpGet("api/events/{id:int}/people/{userId:int}/history")]
    [HttpGet("api/v2/events/{id:int}/people/{userId:int}/history")]
    public async Task<IActionResult> History(int id, int userId, [FromQuery] int page = 1, [FromQuery(Name = "per_page")] int perPage = 50, CancellationToken ct = default) => Respond(await _people.HistoryAsync(TenantId(), id, userId, UserId(), page, perPage, ct));

    [HttpPost("api/events/{id:int}/people/{userId:int}/attendance")]
    [HttpPost("api/v2/events/{id:int}/people/{userId:int}/attendance")]
    public async Task<IActionResult> Attendance(int id, int userId, [FromBody] JsonElement body, CancellationToken ct) => Respond(await _people.AttendanceAsync(TenantId(), id, userId, UserId(), Text(body, "action") ?? "", Long(body, "expected_version"), HeaderOrBodyKey(body), Text(body, "reason"), ct));

    [HttpPost("api/events/{id:int}/people/{userId:int}/approve")]
    [HttpPost("api/v2/events/{id:int}/people/{userId:int}/approve")]
    public Task<IActionResult> Approve(int id, int userId, [FromBody] JsonElement body, CancellationToken ct) => Registration(id, userId, "approve", body, ct);
    [HttpPost("api/events/{id:int}/people/{userId:int}/reject")]
    [HttpPost("api/v2/events/{id:int}/people/{userId:int}/reject")]
    public Task<IActionResult> Reject(int id, int userId, [FromBody] JsonElement body, CancellationToken ct) => Registration(id, userId, "reject", body, ct);
    [HttpPost("api/events/{id:int}/people/{userId:int}/cancel")]
    [HttpPost("api/v2/events/{id:int}/people/{userId:int}/cancel")]
    public Task<IActionResult> Cancel(int id, int userId, [FromBody] JsonElement body, CancellationToken ct) => Registration(id, userId, "cancel", body, ct);

    private async Task<IActionResult> Registration(int id, int userId, string action, JsonElement body, CancellationToken ct) => Respond(await _people.RegistrationAsync(TenantId(), id, userId, UserId(), action, Long(body, "expected_version"), HeaderOrBodyKey(body), Text(body, "reason"), ct));
    private IActionResult Respond(EventPeopleResult result) { Response.Headers.CacheControl = "private, no-store"; if (!result.Succeeded) return StatusCode(result.Error!.Status, new { success = false, error = new { code = result.Error.Code, message = result.Error.Message, field = result.Error.Field } }); return result.Meta is null ? StatusCode(result.Status, new { success = true, data = result.Data }) : StatusCode(result.Status, new { success = true, data = result.Data, meta = result.Meta }); }
    private Dictionary<string, string?> Query() => Request.Query.ToDictionary(x => x.Key, x => (string?)x.Value.ToString());
    private int TenantId() => User.GetTenantId() ?? throw new UnauthorizedAccessException("Invalid tenant claim"); private int UserId() => User.GetUserId() ?? throw new UnauthorizedAccessException("Invalid user claim"); private string HeaderOrBodyKey(JsonElement body) { var header = Request.Headers["Idempotency-Key"].ToString(); return string.IsNullOrWhiteSpace(header) ? Text(body, "idempotency_key") ?? "" : header; }
    private static long Long(JsonElement body, string name) => body.ValueKind == JsonValueKind.Object && body.TryGetProperty(name, out var p) && p.TryGetInt64(out var v) ? v : -1; private static string? Text(JsonElement body, string name) => body.ValueKind == JsonValueKind.Object && body.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null;
}
