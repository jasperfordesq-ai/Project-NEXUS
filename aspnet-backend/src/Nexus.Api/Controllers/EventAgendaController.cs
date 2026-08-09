// Copyright © 2024–2026 Jasper Ford
// SPDX-License-Identifier: AGPL-3.0-or-later

using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Nexus.Api.Extensions;
using Nexus.Api.Services;

namespace Nexus.Api.Controllers;

[ApiController, Authorize]
public sealed class EventAgendaController : ControllerBase
{
    private readonly EventAgendaService _agenda; public EventAgendaController(EventAgendaService agenda) => _agenda = agenda;
    [HttpGet("api/events/{id:int}/agenda"), HttpGet("api/v2/events/{id:int}/agenda")]
    public async Task<IActionResult> Index(int id, [FromQuery(Name = "include_cancelled")] string? raw, CancellationToken ct) { if (!Bool(raw, out var include)) return Respond(Validation("include_cancelled")); return Respond(await _agenda.ReadAsync(Tenant(), id, UserId(), include, ct)); }
    [HttpPost("api/events/{id:int}/agenda/sessions"), HttpPost("api/v2/events/{id:int}/agenda/sessions")]
    public async Task<IActionResult> Store(int id, [FromBody] JsonElement body, CancellationToken ct) => Respond(await _agenda.CreateAsync(Tenant(), id, UserId(), body, Key(body), ct));
    [HttpPut("api/events/{id:int}/agenda/sessions/{sessionId:long}"), HttpPut("api/v2/events/{id:int}/agenda/sessions/{sessionId:long}")]
    public async Task<IActionResult> Update(int id, long sessionId, [FromBody] JsonElement body, CancellationToken ct) => Respond(await _agenda.UpdateAsync(Tenant(), id, sessionId, UserId(), Long(body, "expected_version"), body, Key(body), ct));
    [HttpPost("api/events/{id:int}/agenda/sessions/{sessionId:long}/cancel"), HttpPost("api/v2/events/{id:int}/agenda/sessions/{sessionId:long}/cancel")]
    public async Task<IActionResult> Cancel(int id, long sessionId, [FromBody] JsonElement body, CancellationToken ct) => Respond(await _agenda.CancelAsync(Tenant(), id, sessionId, UserId(), Long(body, "expected_version"), Text(body, "reason"), Key(body), ct));
    [HttpPut("api/events/{id:int}/agenda/order"), HttpPut("api/v2/events/{id:int}/agenda/order")]
    public async Task<IActionResult> Reorder(int id, [FromBody] JsonElement body, CancellationToken ct) => Respond(await _agenda.ReorderAsync(Tenant(), id, UserId(), Long(body, "expected_agenda_version"), Longs(body, "ordered_session_ids"), Key(body), ct));
    [HttpPost("api/events/{id:int}/agenda/sessions/{sessionId:long}/registration"), HttpPost("api/v2/events/{id:int}/agenda/sessions/{sessionId:long}/registration")]
    public async Task<IActionResult> Register(int id, long sessionId, [FromBody] JsonElement body, CancellationToken ct) => Respond(await _agenda.RegisterAsync(Tenant(), id, sessionId, UserId(), Long(body, "expected_version"), Key(body), ct));
    [HttpPost("api/events/{id:int}/agenda/sessions/{sessionId:long}/registration/withdraw"), HttpPost("api/v2/events/{id:int}/agenda/sessions/{sessionId:long}/registration/withdraw")]
    public async Task<IActionResult> Withdraw(int id, long sessionId, [FromBody] JsonElement body, CancellationToken ct) => Respond(await _agenda.WithdrawAsync(Tenant(), id, sessionId, UserId(), Long(body, "expected_version"), Key(body), ct));
    private IActionResult Respond(EventAgendaResult r) { Response.Headers.CacheControl = "private, no-store"; Response.Headers.Pragma = "no-cache"; Response.Headers.Vary = "Authorization, Cookie, X-Tenant-ID"; return r.Succeeded ? StatusCode(r.Status, new { success = true, data = r.Data }) : StatusCode(r.Error!.Status, new { success = false, error = new { code = r.Error.Code, message = r.Error.Message, field = r.Error.Field } }); }
    private int Tenant() => User.GetTenantId() ?? throw new UnauthorizedAccessException(); private int UserId() => User.GetUserId() ?? throw new UnauthorizedAccessException(); private string Key(JsonElement x) { var h = Request.Headers["Idempotency-Key"].ToString(); var b = Text(x, "idempotency_key") ?? ""; return !string.IsNullOrWhiteSpace(h) && !string.IsNullOrWhiteSpace(b) && h != b ? "" : !string.IsNullOrWhiteSpace(h) ? h.Trim() : b.Trim(); } private static long Long(JsonElement x, string n) => x.TryGetProperty(n, out var p) && p.TryGetInt64(out var v) ? v : -1; private static long[] Longs(JsonElement x, string n) => x.TryGetProperty(n, out var p) && p.ValueKind == JsonValueKind.Array ? p.EnumerateArray().Where(y => y.TryGetInt64(out _)).Select(y => y.GetInt64()).ToArray() : [-1]; private static string? Text(JsonElement x, string n) => x.TryGetProperty(n, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString() : null; private static bool Bool(string? x, out bool value) { if (x is null) { value = false; return true; } return bool.TryParse(x, out value) || x == "1" && (value = true) || x == "0" && !(value = false); } private static EventAgendaResult Validation(string f) => new(null, new("EVENT_AGENDA_VALIDATION_FAILED", "Validation failed", 422, f));
}
